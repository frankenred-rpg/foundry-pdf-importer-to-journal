/**
 * pdf-parser.mjs
 *
 * Uses the pdf.js library that ships with Foundry VTT (available globally as
 * `pdfjsLib` inside the Foundry client environment).
 *
 * Exports one async function: parsePdf(arrayBuffer) → Array<Section>
 *
 * Section = { title: string, pageStart: number, pageEnd: number, content: string }
 */

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Resolve an outline destination to a 0-based page index.
 * pdf.js destinations can be arrays or named strings.
 */
async function destToPageIndex(pdf, dest) {
  try {
    let resolved = dest;
    if (typeof dest === "string") {
      resolved = await pdf.getDestination(dest);
    }
    if (!Array.isArray(resolved) || resolved.length === 0) return null;
    return await pdf.getPageIndex(resolved[0]);
  } catch {
    return null;
  }
}

/**
 * Recursively flatten a pdf.js outline tree into a sorted list of
 * { title, pageIndex } objects.
 */
async function flattenOutline(pdf, items, depth = 0) {
  const result = [];
  for (const item of items) {
    const pageIndex = await destToPageIndex(pdf, item.dest);
    if (pageIndex !== null) {
      result.push({ title: item.title?.trim() || "Untitled", pageIndex, depth });
    }
    if (Array.isArray(item.items) && item.items.length > 0) {
      const children = await flattenOutline(pdf, item.items, depth + 1);
      result.push(...children);
    }
  }
  // Sort by page position (outlines are usually ordered but just in case)
  result.sort((a, b) => a.pageIndex - b.pageIndex);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Heading detection fallback                                          */
/* ------------------------------------------------------------------ */

// Heuristics to detect headings when there is no PDF outline.
// A text item is considered a heading if:
//   - Its font size is significantly larger than the page median, OR
//   - It is the only item in its line and uses bold/large font, OR
//   - It matches common heading patterns (ALL CAPS short line, numbered "1.", "Chapter X", etc.)

const HEADING_PATTERNS = [
  /^(chapter|capítulo|parte|part|section|sección|appendix|apéndice)\s+[\dIVXivx]+/i,
  /^\d+[\.\)]\s+\S/,          // "1. Title" or "1) Title"
  /^[IVXLCDM]+[\.\)]\s+\S/,  // Roman numerals
];

function looksLikeHeading(str, fontSize, medianFontSize) {
  if (!str || str.trim().length === 0) return false;
  const trimmed = str.trim();
  if (trimmed.length > 120) return false;           // Too long to be a heading
  if (fontSize >= medianFontSize * 1.25) return true; // Significantly bigger font
  if (HEADING_PATTERNS.some((re) => re.test(trimmed))) return true;
  return false;
}

function median(arr) {
  if (!arr.length) return 12;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Detect section headings from raw text items on a single page.
 * Returns an array of heading strings found on that page.
 */
function detectHeadingsOnPage(items) {
  const sizes = items.map((i) => i.transform?.[0] ?? 12).filter((s) => s > 0);
  const med = median(sizes);
  const headings = [];
  for (const item of items) {
    const fontSize = item.transform?.[0] ?? 12;
    if (looksLikeHeading(item.str, fontSize, med)) {
      headings.push(item.str.trim());
    }
  }
  return headings;
}

/* ------------------------------------------------------------------ */
/*  Text extraction                                                     */
/* ------------------------------------------------------------------ */

/**
 * Extract all text from a range of pages [startPage, endPage) (0-based indices).
 * Returns a single HTML string with paragraph breaks.
 */
async function extractTextForPages(pdf, startPage, endPage) {
  const parts = [];
  for (let i = startPage; i < endPage; i++) {
    try {
      const page = await pdf.getPage(i + 1); // pdf.js uses 1-based page numbers
      const content = await page.getTextContent();
      let pageText = "";
      let lastY = null;
      for (const item of content.items) {
        if (!item.str) continue;
        const y = item.transform?.[5] ?? 0;
        // Insert a line break when the Y position changes significantly
        if (lastY !== null && Math.abs(y - lastY) > 5) {
          pageText += "\n";
        }
        pageText += item.str;
        lastY = y;
      }
      // Convert line breaks to HTML paragraphs
      const paragraphs = pageText
        .split(/\n{2,}/)
        .map((p) => p.replace(/\n/g, " ").trim())
        .filter((p) => p.length > 0)
        .map((p) => `<p>${p}</p>`)
        .join("\n");
      parts.push(paragraphs);
    } catch (err) {
      console.warn(`pdf-to-journal | Could not read page ${i + 1}:`, err);
    }
  }
  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Parse a PDF from an ArrayBuffer.
 *
 * @param {ArrayBuffer} buffer
 * @param {object} options
 * @param {number} [options.maxDepth=0]  Max outline depth to import (0 = top-level only, -1 = all)
 * @param {Function} [options.onProgress] Called with (current, total) as pages are processed
 * @returns {Promise<Array<{title:string, content:string}>>}
 */
export async function parsePdf(buffer, { maxDepth = 0, onProgress } = {}) {
  // pdfjsLib is exposed globally by Foundry VTT
  const pdfjsLib = globalThis.pdfjsLib ?? window.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("pdf-to-journal | pdfjsLib not found. Is Foundry VTT running?");
  }

  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = pdf.numPages;

  /* ---- Step 1: Try to get the PDF outline (table of contents) ---- */
  let outline = null;
  try {
    outline = await pdf.getOutline();
  } catch {
    outline = null;
  }

  let sections = [];

  if (outline && outline.length > 0) {
    /* ---- Outline-based sectioning ---- */
    let flatOutline = await flattenOutline(pdf, outline);

    // Filter by depth if requested
    if (maxDepth >= 0) {
      flatOutline = flatOutline.filter((item) => item.depth <= maxDepth);
    }

    for (let i = 0; i < flatOutline.length; i++) {
      const current = flatOutline[i];
      const next = flatOutline[i + 1];
      const pageStart = current.pageIndex;           // 0-based
      const pageEnd = next ? next.pageIndex : totalPages; // exclusive

      onProgress?.(i + 1, flatOutline.length);

      const content = await extractTextForPages(pdf, pageStart, pageEnd);
      sections.push({ title: current.title, content });
    }
  } else {
    /* ---- Fallback: detect headings by scanning every page ---- */
    // Collect (pageIndex, headingTitle) pairs
    const detectedHeadings = [];

    for (let i = 0; i < totalPages; i++) {
      onProgress?.(i + 1, totalPages);
      try {
        const page = await pdf.getPage(i + 1);
        const content = await page.getTextContent();
        const headings = detectHeadingsOnPage(content.items);
        for (const h of headings) {
          detectedHeadings.push({ title: h, pageIndex: i });
        }
      } catch {
        /* skip unreadable pages */
      }
    }

    if (detectedHeadings.length === 0) {
      // No headings found at all — create a single section with all content
      const content = await extractTextForPages(pdf, 0, totalPages);
      sections.push({ title: game.i18n.localize("PDFJOURNAL.DefaultSection"), content });
    } else {
      for (let i = 0; i < detectedHeadings.length; i++) {
        const current = detectedHeadings[i];
        const next = detectedHeadings[i + 1];
        const pageStart = current.pageIndex;
        const pageEnd = next ? next.pageIndex : totalPages;
        const content = await extractTextForPages(pdf, pageStart, pageEnd);
        sections.push({ title: current.title, content });
      }
    }
  }

  return sections;
}
