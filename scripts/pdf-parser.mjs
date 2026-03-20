/**
 * pdf-parser.mjs
 *
 * Loads pdfjs from CDN and parses a PDF into sections.
 */

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
const PDFJS_WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

let _pdfjs = null;

async function getPdfJs() {
  if (_pdfjs) return _pdfjs;
  try {
    _pdfjs = await import(PDFJS_CDN);
    _pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
    console.log("pdf-to-journal | pdfjs loaded from CDN");
    return _pdfjs;
  } catch (err) {
    throw new Error(`Could not load pdfjs from CDN: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

async function destToPageIndex(pdf, dest) {
  try {
    let resolved = dest;
    if (typeof dest === "string") resolved = await pdf.getDestination(dest);
    if (!Array.isArray(resolved) || resolved.length === 0) return null;
    return await pdf.getPageIndex(resolved[0]);
  } catch {
    return null;
  }
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

const HEADING_PATTERNS = [
  /^(chapter|capítulo|parte|part|section|sección|appendix|apéndice)\s+[\dIVXivx]+/i,
  /^\d+[\.\)]\s+\S/,
  /^[IVXLCDM]+[\.\)]\s+\S/,
];

function median(arr) {
  if (!arr.length) return 12;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function looksLikeHeading(str, fontSize, medianFontSize) {
  if (!str || str.trim().length === 0) return false;
  const trimmed = str.trim();
  if (trimmed.length > 120) return false;
  if (fontSize >= medianFontSize * 1.25) return true;
  if (HEADING_PATTERNS.some((re) => re.test(trimmed))) return true;
  return false;
}

function detectHeadingsOnPage(items) {
  const sizes = items.map((i) => i.transform?.[0] ?? 12).filter((s) => s > 0);
  const med = median(sizes);
  return items
    .filter(item => looksLikeHeading(item.str, item.transform?.[0] ?? 12, med))
    .map(item => item.str.trim());
}

async function extractTextForPages(pdf, startPage, endPage) {
  const parts = [];
  for (let i = startPage; i < endPage; i++) {
    try {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      let pageText = "";
      let lastY = null;
      for (const item of content.items) {
        if (!item.str) continue;
        const y = item.transform?.[5] ?? 0;
        if (lastY !== null && Math.abs(y - lastY) > 5) pageText += "\n";
        pageText += item.str;
        lastY = y;
      }
      const paragraphs = pageText
        .split(/\n{2,}/)
        .map(p => p.replace(/\n/g, " ").trim())
        .filter(p => p.length > 0)
        .map(p => `<p>${p}</p>`)
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

    for (let i = 0; i < flatOutline.length; i++) {
      const current = flatOutline[i];
      const next = flatOutline[i + 1];
      onProgress?.(i + 1, flatOutline.length);
      const content = await extractTextForPages(pdf, current.pageIndex, next ? next.pageIndex : totalPages);
      sections.push({ title: current.title, content });
    }
  } else {
    const detectedHeadings = [];
    for (let i = 0; i < totalPages; i++) {
      onProgress?.(i + 1, totalPages);
      try {
        const page = await pdf.getPage(i + 1);
        const content = await page.getTextContent();
        for (const h of detectHeadingsOnPage(content.items)) {
          detectedHeadings.push({ title: h, pageIndex: i });
        }
      } catch { /* skip */ }
    }

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
