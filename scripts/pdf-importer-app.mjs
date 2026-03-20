/**
 * pdf-importer-app.mjs
 * ApplicationV2 UI for Foundry VTT v13
 */

import { parsePdf } from "./pdf-parser.mjs";
import { createJournalFromSections } from "./journal-creator.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PdfImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "pdf-to-journal-importer",
    tag: "div",
    window: {
      title: "PDFJOURNAL.AppTitle",
      icon: "fa-solid fa-file-pdf",
      resizable: true,
    },
    position: { width: 480, height: "auto" },
    classes: ["pdf-to-journal-app"],
  };

  static PARTS = {
    form: { template: "modules/pdf-to-journal/templates/importer.hbs" },
  };

  #file = null;
  #sections = null;
  #busy = false;

  async _prepareContext(_options) {
    const folders = game.journal.directory?.folders
      ? [...game.journal.directory.folders].map(f => ({ id: f.id, name: f.name }))
      : [];
    return {
      folders,
      hasSections: Array.isArray(this.#sections),
      sections: this.#sections ?? [],
      sectionCount: this.#sections?.length ?? 0,
      busy: this.#busy,
    };
  }

  async _onPreview(event) {
    if (this.#busy) return;
    const form = this.element.querySelector("form");
    const fileInput = form.querySelector('input[name="pdf-file"]');
    const modeSelect = form.querySelector('select[name="detection-mode"]');
    const depthSelect = form.querySelector('select[name="depth"]');

    const file = fileInput?.files?.[0];
    if (!file) return ui.notifications.warn(game.i18n.localize("PDFJOURNAL.NoFileSelected"));

    this.#file = file;
    this.#sections = null;
    this.#busy = true;
    this._updateProgressBar(0, 1, game.i18n.localize("PDFJOURNAL.Parsing"));
    await this.render();

    try {
      const buffer = await file.arrayBuffer();
      const useOutline = modeSelect?.value === "outline";
      const maxDepth = parseInt(depthSelect?.value ?? "0", 10);

      this.#sections = await parsePdf(buffer, {
        useOutline,
        maxDepth,
        onProgress: (cur, total) =>
          this._updateProgressBar(cur, total, game.i18n.localize("PDFJOURNAL.Parsing")),
      });
    } catch (err) {
      console.error("pdf-to-journal |", err);
      ui.notifications.error(game.i18n.format("PDFJOURNAL.ParseError", { error: err.message }));
      this.#sections = null;
    }

    this.#busy = false;
    this._hideProgressBar();
    await this.render();
  }

  async _onImport(event) {
    if (this.#busy || !this.#sections) return;
    const form = this.element.querySelector("form");
    const nameInput = form.querySelector('input[name="journal-name"]');
    const folderSelect = form.querySelector('select[name="folder"]');

    const journalName = nameInput?.value?.trim() || this.#file?.name?.replace(/\.pdf$/i, "") || "Imported PDF";
    const folderId = folderSelect?.value || undefined;

    this.#busy = true;
    this._updateProgressBar(0, this.#sections.length, game.i18n.localize("PDFJOURNAL.Creating"));
    await this.render();

    try {
      const journal = await createJournalFromSections(journalName, this.#sections, {
        folder: folderId,
        onProgress: (cur, total) =>
          this._updateProgressBar(cur, total, game.i18n.localize("PDFJOURNAL.Creating")),
      });
      journal.sheet.render(true);
      await this.close();
    } catch (err) {
      console.error("pdf-to-journal |", err);
      ui.notifications.error(game.i18n.format("PDFJOURNAL.ImportError", { error: err.message }));
      this.#busy = false;
      this._hideProgressBar();
      await this.render();
    }
  }

  _updateProgressBar(current, total, label) {
    const bar = this.element?.querySelector(".pdf-progress");
    if (!bar) return;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    bar.style.display = "block";
    bar.querySelector(".pdf-progress__fill").style.width = `${pct}%`;
    bar.querySelector(".pdf-progress__label").textContent = `${label} — ${current} / ${total}`;
  }

  _hideProgressBar() {
    const bar = this.element?.querySelector(".pdf-progress");
    if (bar) bar.style.display = "none";
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector("[data-action='preview']")
      ?.addEventListener("click", e => this._onPreview(e));
    this.element.querySelector("[data-action='import']")
      ?.addEventListener("click", e => this._onImport(e));
  }
}
