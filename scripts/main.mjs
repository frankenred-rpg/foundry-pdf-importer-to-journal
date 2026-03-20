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

  // Try on ready with delays
  setTimeout(addImportButton, 500);
  setTimeout(addImportButton, 2000);

  // Listen for clicks on the Journal tab button
  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab='journal'], [aria-controls='journal'], [data-action='tab']");
    if (tab) setTimeout(addImportButton, 100);
  });

  // Also watch sidebar-content for when journal tab becomes active
  const sidebarContent = document.querySelector("#sidebar-content");
  if (sidebarContent) {
    const observer = new MutationObserver(() => {
      const journalActive = document.querySelector("#journal.active, #journal.active-tab, section#journal:not(.hidden)");
      if (journalActive) addImportButton();
    });
    observer.observe(sidebarContent, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
});
