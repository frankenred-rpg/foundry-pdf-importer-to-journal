/**
 * PDF to Journal Importer — main.mjs
 * Foundry VTT v13 compatible
 */

import { PdfImporterApp } from "./pdf-importer-app.mjs";

const MODULE_ID = "pdf-to-journal";

function addImportButton() {
  if (!game.user.isGM) return false;
  if (document.querySelector(".pdf-import-btn")) return true;

  const target = document.querySelector("#journal .header-actions.action-buttons")
              ?? document.querySelector("#journal .action-buttons")
              ?? document.querySelector("#journal .directory-header");

  if (!target) return false;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("pdf-import-btn");
  btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> ${game.i18n.localize("PDFJOURNAL.ImportButton")}`;
  btn.addEventListener("click", () => new PdfImporterApp().render(true));
  target.prepend(btn);
  console.log(`${MODULE_ID} | Import button added`);
  return true;
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initialising PDF to Journal Importer`);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);

  // Poll every 300ms until the button is added, give up after 30 seconds
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    const done = addImportButton();
    if (done || attempts > 100) {
      clearInterval(interval);
      if (!done) console.warn(`${MODULE_ID} | Could not add import button after ${attempts} attempts`);
    }
  }, 300);

  // Also re-add if button disappears (e.g. sidebar tab switch)
  document.addEventListener("click", () => {
    setTimeout(addImportButton, 200);
  });
});
