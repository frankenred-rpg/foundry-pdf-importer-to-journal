/**
 * pdf-parser.mjs
 * Loads pdfjs from CDN and parses a PDF into sections.
 * Handles two-column layouts and duplicate text layers.
 */

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
const PDFJS_WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

let _pdfjs = null;

async function getPdfJs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import(PDFJS_CDN);
  _pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
  return _pdfjs;
}

/* ------------------------------------------------------------------ */
/*  Outline helpers                                                     */
/* ------------------------------------------------------------------ */

async function destToPageIndex(pdf, dest) {
  try {
    let resolved = dest;
    if (typeof dest === "string") resolved = await pdf.getDestination(dest);
    if (!Array.isArray(resolved) || resolved.length === 0) return null;
    return await pdf.getPageIndex(resolved[0]);
  } catch { return null; }
}

async function flattenOutline(pdf, items, depth = 0) {
  const result = [];
  for (const item of items) {
    const pageIndex = await destToPageIndex(pdf, item.dest);
    if (pageIndex !== null) {
      result.push({ title: item.title?.trim() || "Untitled", pageIndex, depth });
    }
    if (Array.isArray(item.items) && item.items.length > 0) {
      result.push(...await flattenOutline(pdf, item.items, depth + 1));
    }
  }
  result.sort((a, b) => a.pageIndex - b.pageIndex);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Text extraction                                                     */
/* ------------------------------------------------------------------ */

/**
 * Remove near-duplicate text items (same text at nearly same position).
 * Handles InDesign PDFs that export duplicate text layers.
 */
function deduplicateItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${Math.round(item.x / 3)}_${Math.round(item.y / 3)}_${item.str.trim().substring(0, 20)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Detect if a page has two columns.
 * Returns the X midpoint if two columns detected, null otherwise.
 */
function detectColumnMidpoint(items, pageWidth) {
  if (items.length < 8) return null;
  const margin = pageWidth * 0.1;
  const midMin = pageWidth * 0.38;
  const midMax = pageWidth * 0.62;
  const bodyItems = items.filter(i => i.x > margin && i.x < pageWidth - margin);
  const midItems = bodyItems.filter(i => i.x > midMin && i.x < midMax);
  if (bodyItems.length > 8 && (midItems.length / bodyItems.length) < 0.12) {
    return pageWidth / 2;
  }
  return null;
}

/**
 * Group items into lines by Y proximity.
 */
function groupIntoLines(items, tolerance = 4) {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => {
    const dy = a.y - b.y;
    return Math.abs(dy) > tolerance ? dy : a.x - b.x;
  });
  const lines = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - sorted[i-1].y) <= tolerance) {
      cur.push(sorted[i]);
    } else {
      lines.push(cur);
      cur = [sorted[i]];
    }
  }
  lines.push(cur);
  return lines;
}

/**
 * Convert lines to HTML. Only uses h3 for clearly large headings.
 * Does NOT create new sections — just formats text within a section.
 */
function linesToHtml(lines, medianFont) {
  const parts = [];
  let inParagraph = false;
  let prevY = null;

  for (const line of lines) {
    const text = line.map(i => i.str).join(" ").replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) continue;

    const maxFont = Math.max(...line.map(i => i.fontSize));
    const lineY = line[0].y;
    const bigGap = prevY !== null && (lineY - prevY) > medianFont * 2.5;
    const isHeading = maxFont >= medianFont * 1.5 && text.length < 100;

    if (isHeading) {
      if (inParagraph) { parts.push("</p>"); inParagraph = false; }
      parts.push(`<h3>${text}</h3>`);
    } else if (bigGap || !inParagraph) {
      if (inParagraph) parts.push("</p>");
      parts.push(`<p>${text}`);
      inParagraph = true;
    } else {
      parts.push(` ${text}`);
    }
    prevY = lineY;
  }

  if (inParagraph) parts.push("</p>");
  return parts.join("");
}

/**
 * Extract and format text from a range of pages [startPage, endPage).
 */
async function extractTextForPages(pdf, startPage, endPage) {
  const allHtml = [];

  for (let i = startPage; i < endPage; i++) {
    try {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;

      let items = content.items
        .filter(item => item.str && item.str.trim().length > 0)
        .map(item => ({
          str: item.str,
          x: item.transform[4],
          y: pageHeight - item.transform[5],
          fontSize: Math.abs(item.transform[0]) || Math.abs(item.transform[3]) || 12,
        }));

      items = deduplicateItems(items);
      if (items.length === 0) continue;

      const sizes = items.map(i => i.fontSize).filter(s => s > 2).sort((a, b) => a - b);
      const medianFont = sizes[Math.floor(sizes.length / 2)] || 12;

      const colMid = detectColumnMidpoint(items, pageWidth);

      if (colMid) {
        // Split into left and right columns, process each separately
        const leftItems = items.filter(i => i.x < colMid - 5);
        const rightItems = items.filter(i => i.x >= colMid - 5);
        const leftLines = groupIntoLines(leftItems);
        const rightLines = groupIntoLines(rightItems);
        allHtml.push(linesToHtml(leftLines, medianFont));
        allHtml.push(linesToHtml(rightLines, medianFont));
      } else {
        const lines = groupIntoLines(items);
        allHtml.push(linesToHtml(lines, medianFont));
      }

    } catch (err) {
      console.warn(`pdf-to-journal | Could not read page ${i + 1}:`, err);
    }
  }

  return allHtml.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Heading detection fallback (only used when NO outline exists)      */
/* ------------------------------------------------------------------ */

const HEADING_PATTERNS = [
  /^(chapter|capítulo|parte|part|section|sección|appendix|apéndice)\s+[\dIVXivx]+/i,
  /^\d+[\.\)]\s+\S/,
  /^[IVXLCDM]+[\.\)]\s+\S/,
];

async function detectHeadings(pdf, totalPages, onProgress) {
  const headings = [];
  const seen = new Set();

  for (let i = 0; i < totalPages; i++) {
    onProgress?.(i + 1, totalPages);
    try {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      const pageHeight = page.getViewport({ scale: 1 }).height;

      let items = content.items
        .filter(it => it.str?.trim())
        .map(it => ({
          str: it.str.trim(),
          x: it.transform[4],
          y: pageHeight - it.transform[5],
          fontSize: Math.abs(it.transform[0]) || 12,
        }));

      items = deduplicateItems(items);
      const sizes = items.map(i => i.fontSize).filter(s => s > 2).sort((a,b) => a-b);
      const med = sizes[Math.floor(sizes.length / 2)] || 12;

      for (const item of items) {
        const str = item.str;
        if (str.length > 80 || str.length < 2) continue;
        // Only detect as heading if font is significantly larger AND matches a pattern
        const bigFont = item.fontSize >= med * 1.6;
        const matchesPattern = HEADING_PATTERNS.some(re => re.test(str));
        if ((bigFont && str.length < 60) || matchesPattern) {
          const key = str.toLowerCase().trim();
          if (!seen.has(key)) {
            seen.add(key);
            headings.push({ title: str, pageIndex: i });
          }
        }
      }
    } catch { /* skip */ }
  }
  return headings;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

export async function parsePdf(buffer, { maxDepth = 0, onProgress } = {}) {
  const pdfjsLib = await getPdfJs();
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = pdf.numPages;

  let outline = null;
  try { outline = await pdf.getOutline(); } catch { outline = null; }

  let sections = [];

  if (outline && outline.length > 0) {
    // ---- OUTLINE MODE: sections defined strictly by outline ----
    let flatOutline = await flattenOutline(pdf, outline);
    if (maxDepth >= 0) flatOutline = flatOutline.filter(item => item.depth <= maxDepth);

    // Merge entries that point to the same page
    const merged = [];
    for (const item of flatOutline) {
      const prev = merged[merged.length - 1];
      if (prev && prev.pageIndex === item.pageIndex) {
        prev.title = `${prev.title} / ${item.title}`;
      } else {
        merged.push({ ...item });
      }
    }

    for (let i = 0; i < merged.length; i++) {
      const current = merged[i];
      const next = merged[i + 1];
      onProgress?.(i + 1, merged.length);
      // Extract text for this section's page range only
      const content = await extractTextForPages(
        pdf,
        current.pageIndex,
        next ? next.pageIndex : totalPages
      );
      sections.push({ title: current.title, content });
    }

  } else {
    // ---- FALLBACK MODE: detect headings from text ----
    const detectedHeadings = await detectHeadings(pdf, totalPages, onProgress);

    if (detectedHeadings.length === 0) {
      const content = await extractTextForPages(pdf, 0, totalPages);
      sections.push({ title: game.i18n.localize("PDFJOURNAL.DefaultSection"), content });
    } else {
      for (let i = 0; i < detectedHeadings.length; i++) {
        const current = detectedHeadings[i];
        const next = detectedHeadings[i + 1];
        const content = await extractTextForPages(
          pdf,
          current.pageIndex,
          next ? next.pageIndex : totalPages
        );
        sections.push({ title: current.title, content });
      }
    }
  }

  return sections;
}
