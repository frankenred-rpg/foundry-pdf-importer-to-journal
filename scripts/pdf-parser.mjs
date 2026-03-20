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
/*  Text extraction with column detection and deduplication            */
/* ------------------------------------------------------------------ */

/**
 * Remove duplicate text items that appear at nearly the same position.
 * Some PDFs (exported from InDesign) have duplicate text layers.
 */
function deduplicateItems(items) {
  const seen = new Set();
  return items.filter(item => {
    // Round coordinates to nearest 2px to catch near-duplicates
    const key = `${Math.round(item.x / 2)}_${Math.round(item.y / 2)}_${item.str.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Detect if a page has two columns by analyzing X coordinate distribution.
 * Returns the X midpoint if two columns are detected, or null for single column.
 */
function detectColumns(items, pageWidth) {
  if (items.length < 10) return null;

  // Look at X positions of text items
  const margin = pageWidth * 0.1; // ignore items in margins
  const midZone = { min: pageWidth * 0.35, max: pageWidth * 0.65 };

  // Count items in the middle zone vs outside
  const inMiddle = items.filter(i => i.x > midZone.min && i.x < midZone.max).length;
  const total = items.filter(i => i.x > margin && i.x < pageWidth - margin).length;

  // If very few items in the middle zone, it's likely two columns
  if (total > 10 && (inMiddle / total) < 0.15) {
    return pageWidth / 2;
  }
  return null;
}

/**
 * Group text items into lines (items with similar Y coordinates).
 */
function groupIntoLines(items, tolerance = 3) {
  if (items.length === 0) return [];
  
  const sorted = [...items].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > tolerance) return yDiff;
    return a.x - b.x;
  });

  const lines = [];
  let currentLine = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (Math.abs(curr.y - prev.y) <= tolerance) {
      currentLine.push(curr);
    } else {
      lines.push(currentLine);
      currentLine = [curr];
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);
  
  return lines;
}

/**
 * Convert lines array to HTML, detecting headings by font size.
 */
function linesToHtml(lines, medianFontSize) {
  const parts = [];
  let inParagraph = false;
  let prevY = null;

  for (const line of lines) {
    const text = line.map(i => i.str).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const maxFont = Math.max(...line.map(i => i.fontSize));
    const lineY = line[0].y;
    const isHeading = maxFont >= medianFontSize * 1.3;
    const bigGap = prevY !== null && (lineY - prevY) > medianFontSize * 2;

    if (isHeading) {
      if (inParagraph) { parts.push("</p>"); inParagraph = false; }
      parts.push(`<h3>${text}</h3>`);
    } else {
      if (!inParagraph || bigGap) {
        if (inParagraph) parts.push("</p>");
        parts.push(`<p>${text}`);
        inParagraph = true;
      } else {
        parts.push(` ${text}`);
      }
    }
    prevY = lineY;
  }

  if (inParagraph) parts.push("</p>");
  return parts.join("");
}

async function extractTextForPages(pdf, startPage, endPage) {
  const allHtml = [];

  for (let i = startPage; i < endPage; i++) {
    try {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;

      // Map items to normalized coordinates (Y=0 at top)
      let items = content.items
        .filter(item => item.str && item.str.trim().length > 0)
        .map(item => ({
          str: item.str,
          x: item.transform[4],
          y: pageHeight - item.transform[5],
          fontSize: Math.abs(item.transform[0]) || Math.abs(item.transform[3]) || 12,
        }));

      // Deduplicate
      items = deduplicateItems(items);
      if (items.length === 0) continue;

      // Compute median font size
      const sizes = items.map(i => i.fontSize).filter(s => s > 2).sort((a, b) => a - b);
      const medianFont = sizes[Math.floor(sizes.length / 2)] || 12;

      // Detect columns
      const colMid = detectColumns(items, pageWidth);

      if (colMid) {
        // Split items into left and right columns
        // Items spanning more than 60% width go to a "full width" group (titles, etc.)
        const leftItems = items.filter(i => i.x < colMid - 10);
        const rightItems = items.filter(i => i.x >= colMid - 10);
        const fullItems = items.filter(i => {
          // Check if this is a centered/full-width title (large font, centered X)
          return i.fontSize >= medianFont * 1.4 && i.x > pageWidth * 0.2 && i.x < pageWidth * 0.8;
        });

        // Build page HTML: full-width titles first (by Y), then left col, then right col
        // Actually we interleave by Y position for full-width vs columnar content
        const leftLines = groupIntoLines(leftItems);
        const rightLines = groupIntoLines(rightItems);

        // Interleave columns by Y position: go line by line
        // Find full-width breaks (rows where both columns have a gap)
        const pageHtml = linesToHtml(leftLines, medianFont) + 
                         linesToHtml(rightLines, medianFont);
        allHtml.push(pageHtml);
      } else {
        // Single column
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
/*  Heading detection fallback                                          */
/* ------------------------------------------------------------------ */

const HEADING_PATTERNS = [
  /^(chapter|capítulo|parte|part|section|sección|appendix|apéndice)\s+[\dIVXivx]+/i,
  /^\d+[\.\)]\s+\S/,
  /^[IVXLCDM]+[\.\)]\s+\S/,
];

async function detectHeadings(pdf, totalPages, onProgress) {
  const headings = [];
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
        if (item.str.length > 120) continue;
        if (item.fontSize >= med * 1.4 || HEADING_PATTERNS.some(re => re.test(item.str))) {
          headings.push({ title: item.str, pageIndex: i });
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
    let flatOutline = await flattenOutline(pdf, outline);
    if (maxDepth >= 0) flatOutline = flatOutline.filter(item => item.depth <= maxDepth);

    // Merge sections on same page
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
      const content = await extractTextForPages(pdf, current.pageIndex, next ? next.pageIndex : totalPages);
      sections.push({ title: current.title, content });
    }
  } else {
    const detectedHeadings = await detectHeadings(pdf, totalPages, onProgress);

    if (detectedHeadings.length === 0) {
      const content = await extractTextForPages(pdf, 0, totalPages);
      sections.push({ title: game.i18n.localize("PDFJOURNAL.DefaultSection"), content });
    } else {
      for (let i = 0; i < detectedHeadings.length; i++) {
        const current = detectedHeadings[i];
        const next = detectedHeadings[i + 1];
        const content = await extractTextForPages(pdf, current.pageIndex, next ? next.pageIndex : totalPages);
        sections.push({ title: current.title, content });
      }
    }
  }

  return sections;
}
