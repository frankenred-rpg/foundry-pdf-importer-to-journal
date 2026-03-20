# PDF to Journal Importer

A **Foundry VTT v13** module that imports PDF files and converts them into Journal Entries, creating one page per section.

## Features

- 📑 **Outline-aware**: If the PDF has a table of contents / bookmarks, each bookmark becomes a Journal page.
- 🔍 **Heading detection fallback**: If no outline exists, the module scans every page for large/bold text to detect section headings automatically.
- 📋 **Preview before import**: See the detected sections before committing.
- 📁 **Folder support**: Choose an existing journal folder to organise imports.
- 🌐 **Bilingual**: English and Spanish included.

## Installation

### Manual
1. Download the latest release ZIP.
2. Extract it into your Foundry `Data/modules/` folder so the path is `Data/modules/pdf-to-journal/module.json`.
3. Restart Foundry and enable the module in **Game Settings → Manage Modules**.

### Via manifest URL
Paste the following URL in **Foundry → Install Module**:
```
https://raw.githubusercontent.com/yourname/pdf-to-journal/main/module.json
```

## Usage

1. Open the **Journal** sidebar (book icon).
2. Click the **Import PDF** button at the top (GMs only).
3. Choose a PDF file and select the outline depth.
4. Click **Preview Sections** to see what will be imported.
5. Enter a name for the Journal Entry (optional) and choose a folder.
6. Click **Import** — the Journal Entry opens automatically when done.

## File Structure

```
pdf-to-journal/
├── module.json                   ← Foundry manifest
├── scripts/
│   ├── main.mjs                  ← Entry point / Hooks
│   ├── pdf-importer-app.mjs      ← ApplicationV2 UI
│   ├── pdf-parser.mjs            ← PDF parsing logic (uses pdfjs-dist bundled with Foundry)
│   └── journal-creator.mjs       ← Creates the JournalEntry + pages
├── styles/
│   └── pdf-to-journal.css
├── templates/
│   └── importer.hbs
└── lang/
    ├── en.json
    └── es.json
```

## Technical Notes

- Uses **`pdfjsLib`** which is bundled with Foundry VTT — no external library needed.
- Heading detection uses font-size heuristics and common heading regex patterns as a fallback.
- The module only handles **text-based PDFs**. Scanned/image PDFs require OCR and are out of scope.
- Built for **ApplicationV2** (Foundry v13+). Not backward compatible with v11/v12.

## License

MIT
