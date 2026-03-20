/**
 * PDF to Journal Importer — main.mjs
 * Foundry VTT v13 compatible
 */

import { PdfImporterApp } from "./pdf-importer-app.mjs";

const MODULE_ID = "pdf-to-journal";

/* ------------------------------------------------------------------ */
/*  Hooks                                                               */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initialising PDF to Journal Importer`);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
});

/**
 * Add an "Import PDF" button to the Journal sidebar header.
 */
Hooks.on("renderJournalDirectory", (_app, html, _data) => {
  // Only GMs can import
  if (!game.user.isGM) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("pdf-import-btn");
  btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> ${game.i18n.localize("PDFJOURNAL.ImportButton")}`;
  btn.addEventListener("click", () => new PdfImporterApp().render(true));

  // Insert before the "Create Journal Entry" button
  const header = html[0].querySelector(".directory-header .action-buttons") 
               ?? html[0].querySelector(".directory-header");
  if (header) header.prepend(btn);
});
