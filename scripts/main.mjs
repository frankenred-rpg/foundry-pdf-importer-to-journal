/**
 * PDF to Journal Importer — main.mjs
 * Foundry VTT v13 compatible
 */

import { PdfImporterApp } from "./pdf-importer-app.mjs";

const MODULE_ID = "pdf-to-journal";

function addImportButton() {
  if (!game.user.isGM) return;

  // Avoid adding the button twice
  if (document.querySelector(".pdf-import-btn")) return;

  const target = document.querySelector("#journal .header-actions.action-buttons")
              ?? document.querySelector("#journal .action-buttons")
              ?? document.querySelector("#journal .directory-header");

  if (!target) {
    console.warn(`${MODULE_ID} | Could not find journal sidebar buttons`);
    return;
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("pdf-import-btn");
  btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> ${game.i18n.localize("PDFJOURNAL.ImportButton")}`;
  btn.addEventListener("click", () => new PdfImporterApp().render(true));

  target.prepend(btn);
  console.log(`${MODULE_ID} | Import button added`);
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initialising PDF to Journal Importer`);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
  // Try adding on ready in case the sidebar is already rendered
  setTimeout(addImportButton, 500);
});

Hooks.on("renderJournalDirectory", () => {
  setTimeout(addImportButton, 100);
});
