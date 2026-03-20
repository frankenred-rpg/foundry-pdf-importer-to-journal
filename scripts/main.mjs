/**
 * PDF to Journal Importer — main.mjs
 * Foundry VTT v13 compatible
 */

import { PdfImporterApp } from "./pdf-importer-app.mjs";

const MODULE_ID = "pdf-to-journal";

function addImportButton() {
  if (!game.user.isGM) return;
  if (document.querySelector(".pdf-import-btn")) return;

  const target = document.querySelector("#journal .header-actions.action-buttons")
              ?? document.querySelector("#journal .action-buttons")
              ?? document.querySelector("#journal .directory-header");

  if (!target) return;

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

  // Try immediately and with delays to cover different load timings
  addImportButton();
  setTimeout(addImportButton, 500);
  setTimeout(addImportButton, 1500);

  // Watch for sidebar re-renders via MutationObserver
  const sidebar = document.querySelector("#sidebar");
  if (sidebar) {
    const observer = new MutationObserver(() => {
      if (!document.querySelector(".pdf-import-btn")) {
        addImportButton();
      }
    });
    observer.observe(sidebar, { childList: true, subtree: true });
    console.log(`${MODULE_ID} | MutationObserver watching sidebar`);
  }
});
