/**
 * PDF to Journal Importer — main.mjs
 * Foundry VTT v13 compatible
 */

import { PdfImporterApp } from "./pdf-importer-app.mjs";

const MODULE_ID = "pdf-to-journal";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initialising PDF to Journal Importer`);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
});

Hooks.on("renderJournalDirectory", (_app, html, _data) => {
  if (!game.user.isGM) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("pdf-import-btn");
  btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> ${game.i18n.localize("PDFJOURNAL.ImportButton")}`;
  btn.addEventListener("click", () => new PdfImporterApp().render(true));

  const root = html instanceof HTMLElement ? html : html[0];

  const target = root.querySelector(".header-actions.action-buttons")
              ?? root.querySelector(".action-buttons")
              ?? root.querySelector(".directory-header");

  if (target) target.prepend(btn);
  else console.warn(`${MODULE_ID} | Could not find action-buttons in Journal sidebar`);
});
