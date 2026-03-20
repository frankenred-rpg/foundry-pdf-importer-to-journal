/**
 * pdf-parser.mjs
 * Loads pdfjs from CDN and parses a PDF into sections.
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
/*  Text extraction with better formatting                             */
/* ------------------------------------------------------------------ */

/**
 * Extract text from a range of pages with improved formatting.
 * Handles multi-column layouts by sorting text items by Y then X position.
 */
async function extractTextForPages(pdf, startPage, endPage) {
  const htmlParts = [];

  for (let i = startPage; i < endPage; i++) {
    try {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;

      // Sort items by Y position (top to bottom), then X (left to right)
      // PDF Y axis is inverted (0 = bottom), so we invert it
      const items = content.items
        .filter(item => item.str && item.str.trim().length > 0)
        .map(item => ({
          str: item.str,
          x: item.transform[4],
          y: pageHeight - item.transform[5], // invert Y
          fontSize: Math.abs(item.transform[0]),
          height: item.height || Math.abs(item.transform[0]),
        }))
        .sort((a, b) => {
          // Group lines within 3px of each other
          const yDiff = a.y - b.y;
          if (Math.abs(yDiff) > 3) return yDiff;
          return a.x - b.x;
        });

      if (items.length === 0) continue;

      // Detect page median font size
      const fontSizes = items.map(i => i.fontSize).filter(s => s > 0).sort((a,b) => a-b);
      const medianFont = fontSizes[Math.floor(fontSizes.length / 2)] || 12;

      // Group items into lines based on Y proximity
      const lines = [];
      let currentLine = [];
      let lastY = null;

      for (const item of items) {
        if (lastY === null || Math.abs(item.y - lastY) <= 3) {
          currentLine.push(item);
          lastY = item.y;
        } else {
          if (currentLine.length > 0) lines.push(currentLine);
          currentLine = [item];
          lastY = item.y;
        }
      }
      if (currentLine.length > 0) lines.push(currentLine);

      // Convert lines to HTML
      let prevY = null;
      for (const line of lines) {
        const lineText = line.map(i => i.str).join(" ").trim();
        if (!lineText) continue;

        const lineY = line[0].y;
        const lineFont = Math.max(...line.map(i => i.fontSize));
        const isHeading = lineFont >= medianFont * 1.2;
        const isLargeParagraphGap = prevY !== null && (lineY - prevY) > (medianFont * 2.5);

        if (isHeading) {
          htmlParts.push(`<h3>${lineText}</h3>`);
        } else {
          // Add paragraph break if there's a large vertical gap
          if (isLargeParagraphGap && htmlParts.length > 0 && !htmlParts[htmlParts.length-1].startsWith("<h")) {
            htmlParts.push(`</p><p>${lineText}`);
          } else if (htmlParts.length === 0 || htmlParts[htmlParts.length-1].startsWith("<h")) {
            htmlParts.push(`<p>${lineText}`);
          } else {
            // Same paragraph — join with space
            htmlParts[htmlParts.length-1] += ` ${lineText}`;
          }
        }
        prevY = lineY;
      }

      // Close any open paragraph
      if (htmlParts.length > 0) {
        const last = htmlParts[htmlParts.length - 1];
        if (last.startsWith("<p>") && !last.endsWith("</p>")) {
          htmlParts[htmlParts.length - 1] += "</p>";
        }
      }

    } catch (err) {
      console.warn(`pdf-to-journal | Could not read page ${i + 1}:`, err);
    }
  }

  return htmlParts.join("\n");
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
      const sizes = content.items.map(it => Math.abs(it.transform?.[0] ?? 12)).filter(s => s > 0).sort((a,b)=>a-b);
      const med = sizes[Math.floor(sizes.length / 2)] || 12;
      for (const item of content.items) {
        const fontSize = Math.abs(item.transform?.[0] ?? 12);
        const str = item.str?.trim();
        if (!str || str.length > 120) continue;
        if (fontSize >= med * 1.25 || HEADING_PATTERNS.some(re => re.test(str))) {
          headings.push({ title: str, pageIndex: i });
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

    // Merge sections that point to the same page (avoids empty sections)
    const merged = [];
    for (const item of flatOutline) {
      const prev = merged[merged.length - 1];
      if (prev && prev.pageIndex === item.pageIndex) {
        // Combine titles for same-page entries
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
