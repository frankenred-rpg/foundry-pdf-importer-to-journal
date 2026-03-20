/**
 * pdf-parser.mjs — v1.1.2
 * Smart section detection: ignores outline, detects real chapter/section
 * headings by font size, filters page numbers and decorative text.
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
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Remove duplicate text items at nearly the same position */
function dedupe(items) {
  const seen = new Set();
  return items.filter(it => {
    const key = `${Math.round(it.x/3)}_${Math.round(it.y/3)}_${it.str.trim().slice(0,20)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Returns true if a string looks like a page number or decorative spaced text */
function isNoise(str) {
  const s = str.trim();
  if (!s || s.length === 0) return true;
  // Pure page numbers: "25", "– 25 –", "• 25 •" etc.
  if (/^[•\-–—\s\d]+$/.test(s)) return true;
  // Very short isolated numbers
  if (/^\d{1,3}$/.test(s)) return true;
  // Spaced decorative text like "C H A P T E R" — single chars separated by spaces
  if (/^([A-Z] ){3,}[A-Z]?$/.test(s)) return true;
  // Pure symbols/decorators
  if (/^[→←•·\-–—=_\s]+$/.test(s)) return true;
  return false;
}

/** Detect two-column layout, returns midpoint X or null */
function detectColumns(items, pageWidth) {
  if (items.length < 8) return null;
  const margin = pageWidth * 0.1;
  const midMin = pageWidth * 0.38;
  const midMax = pageWidth * 0.62;
  const body = items.filter(i => i.x > margin && i.x < pageWidth - margin);
  const mid = body.filter(i => i.x > midMin && i.x < midMax);
  if (body.length > 8 && mid.length / body.length < 0.12) return pageWidth / 2;
  return null;
}

/** Group items into lines by Y proximity */
function toLines(items, tol = 4) {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) =>
    Math.abs(a.y - b.y) > tol ? a.y - b.y : a.x - b.x
  );
  const lines = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    Math.abs(sorted[i].y - sorted[i-1].y) <= tol
      ? cur.push(sorted[i])
      : (lines.push(cur), cur = [sorted[i]]);
  }
  lines.push(cur);
  return lines;
}

/** Convert lines to HTML with headings and paragraphs */
function linesToHtml(lines, medianFont) {
  const parts = [];
  let inP = false;
  let prevY = null;

  for (const line of lines) {
    const text = line.map(i => i.str).join(" ").replace(/\s+/g, " ").trim();
    if (isNoise(text)) continue;

    const maxFont = Math.max(...line.map(i => i.fontSize));
    const lineY = line[0].y;
    const bigGap = prevY !== null && lineY - prevY > medianFont * 2.5;
    const isH = maxFont >= medianFont * 1.45 && text.length < 100;

    if (isH) {
      if (inP) { parts.push("</p>"); inP = false; }
      parts.push(`<h3>${text}</h3>`);
    } else if (!inP || bigGap) {
      if (inP) parts.push("</p>");
      parts.push(`<p>${text}`);
      inP = true;
    } else {
      parts.push(` ${text}`);
    }
    prevY = lineY;
  }
  if (inP) parts.push("</p>");
  return parts.join("");
}

/* ------------------------------------------------------------------ */
/*  Page text extraction                                                */
/* ------------------------------------------------------------------ */

async function extractPage(pdf, pageIndex) {
  const page = await pdf.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  const vp = page.getViewport({ scale: 1 });
  const pageWidth = vp.width;
  const pageHeight = vp.height;

  let items = content.items
    .filter(it => it.str?.trim())
    .map(it => ({
      str: it.str,
      x: it.transform[4],
      y: pageHeight - it.transform[5],
      fontSize: Math.abs(it.transform[0]) || Math.abs(it.transform[3]) || 12,
    }));

  items = dedupe(items);
  if (!items.length) return { html: "", medianFont: 12, items: [] };

  const sizes = items.map(i => i.fontSize).filter(s => s > 2).sort((a,b) => a-b);
  const medianFont = sizes[Math.floor(sizes.length / 2)] || 12;

  const colMid = detectColumns(items, pageWidth);
  let html = "";

  if (colMid) {
    const left = toLines(items.filter(i => i.x < colMid - 5));
    const right = toLines(items.filter(i => i.x >= colMid - 5));
    html = linesToHtml(left, medianFont) + linesToHtml(right, medianFont);
  } else {
    html = linesToHtml(toLines(items), medianFont);
  }

  return { html, medianFont, items };
}

async function extractTextForPages(pdf, startPage, endPage) {
  const parts = [];
  for (let i = startPage; i < endPage; i++) {
    try {
      const { html } = await extractPage(pdf, i);
      if (html) parts.push(html);
    } catch (e) {
      console.warn(`pdf-to-journal | page ${i+1}:`, e);
    }
  }
  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Section detection — ignores outline, uses font size only           */
/* ------------------------------------------------------------------ */

/**
 * Scan all pages and collect (pageIndex, title, fontSize) for items
 * whose font is in the TOP fontPercentile% of the document.
 */
async function detectSectionHeadings(pdf, totalPages, onProgress, fontPercentile = 85) {
  // First pass: collect all font sizes across the document
  const allSizes = [];
  const pageData = [];

  for (let i = 0; i < totalPages; i++) {
    onProgress?.(i + 1, totalPages);
    try {
      const { items, medianFont } = await extractPage(pdf, i);
      pageData.push({ items, medianFont });
      items.forEach(it => allSizes.push(it.fontSize));
    } catch {
      pageData.push({ items: [], medianFont: 12 });
    }
  }

  // Compute the threshold font size (top N% of document)
  const sorted = [...allSizes].filter(s => s > 2).sort((a,b) => a-b);
  const threshold = sorted[Math.floor(sorted.length * fontPercentile / 100)] || 18;

  // Second pass: find headings above threshold
  const headings = [];
  const seen = new Set();

  for (let i = 0; i < totalPages; i++) {
    const { items } = pageData[i];
    const lines = toLines(items.filter(it => it.fontSize >= threshold && !isNoise(it.str)));
    
    for (const line of lines) {
      const text = line.map(it => it.str).join(" ").replace(/\s+/g, " ").trim();
      if (!text || text.length < 2 || text.length > 80 || isNoise(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      headings.push({ title: text, pageIndex: i });
    }
  }

  return headings;
}

/* ------------------------------------------------------------------ */
/*  Outline helpers (kept for outline mode)                            */
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
    if (pageIndex !== null)
      result.push({ title: item.title?.trim() || "Untitled", pageIndex, depth });
    if (item.items?.length)
      result.push(...await flattenOutline(pdf, item.items, depth + 1));
  }
  return result.sort((a, b) => a.pageIndex - b.pageIndex);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {ArrayBuffer} buffer
 * @param {object} options
 * @param {number} [options.maxDepth]   Outline depth filter (ignored if useOutline=false)
 * @param {boolean} [options.useOutline=true]  Use PDF outline if available
 * @param {Function} [options.onProgress]
 */
export async function parsePdf(buffer, { maxDepth = 0, useOutline = true, onProgress } = {}) {
  const pdfjsLib = await getPdfJs();
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = pdf.numPages;

  let outline = null;
  if (useOutline) {
    try { outline = await pdf.getOutline(); } catch { outline = null; }
  }

  let sections = [];

  if (outline && outline.length > 0) {
    // ---- OUTLINE MODE ----
    let flat = await flattenOutline(pdf, outline);
    if (maxDepth >= 0) flat = flat.filter(it => it.depth <= maxDepth);

    // Merge same-page entries
    const merged = [];
    for (const item of flat) {
      const prev = merged[merged.length - 1];
      if (prev && prev.pageIndex === item.pageIndex) {
        prev.title += ` / ${item.title}`;
      } else {
        merged.push({ ...item });
      }
    }

    for (let i = 0; i < merged.length; i++) {
      const cur = merged[i];
      const next = merged[i + 1];
      onProgress?.(i + 1, merged.length);
      const content = await extractTextForPages(pdf, cur.pageIndex, next ? next.pageIndex : totalPages);
      sections.push({ title: cur.title, content });
    }

  } else {
    // ---- SMART DETECTION MODE ----
    const headings = await detectSectionHeadings(pdf, totalPages, onProgress);

    if (headings.length === 0) {
      const content = await extractTextForPages(pdf, 0, totalPages);
      sections.push({ title: game.i18n.localize("PDFJOURNAL.DefaultSection"), content });
    } else {
      for (let i = 0; i < headings.length; i++) {
        const cur = headings[i];
        const next = headings[i + 1];
        const content = await extractTextForPages(pdf, cur.pageIndex, next ? next.pageIndex : totalPages);
        sections.push({ title: cur.title, content });
      }
    }
  }

  return sections;
}
