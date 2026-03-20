/**
 * pdf-importer-app.mjs
 *
 * The main UI for the PDF importer, built with Foundry VTT v13's ApplicationV2.
 */

import { parsePdf } from "./pdf-parser.mjs";
import { createJournalFromSections } from "./journal-creator.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PdfImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /* ---------------------------------------------------------------- */
  /*  Static metadata                                                   */
  /* ---------------------------------------------------------------- */

  static DEFAULT_OPTIONS = {
    id: "pdf-to-journal-importer",
    tag: "div",
    window: {
      title: "PDFJOURNAL.AppTitle",
      icon: "fa-solid fa-file-pdf",
      resizable: true,
    },
    position: {
      width: 480,
      height: "auto",
    },
    classes: ["pdf-to-journal-app"],
  };

  static PARTS = {
    form: {
      template: "modules/pdf-to-journal/templates/importer.hbs",
    },
  };

  /* ---------------------------------------------------------------- */
  /*  Instance state                                                    */
  /* ---------------------------------------------------------------- */

  #file = null;         // File object chosen by the user
  #sections = null;     // Parsed sections after preview
  #busy = false;        // Prevent double-submission

  /* ---------------------------------------------------------------- */
  /*  Data for the template                                             */
  /* ---------------------------------------------------------------- */

  async _prepareContext(_options) {
    const folders = game.journal.directory?.folders
      ? [...game.journal.directory.folders].map((f) => ({ id: f.id, name: f.name }))
      : [];

    return {
      folders,
      hasSections: Array.isArray(this.#sections),
      sections: this.#sections ?? [],
      sectionCount: this.#sections?.length ?? 0,
      busy: this.#busy,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Actions (wired via data-action attributes in the template)        */
  /* ---------------------------------------------------------------- */

  /**
   * Called when the user picks a file and clicks "Preview".
   */
  async _onPreview(event, _target) {
    if (this.#busy) return;

    const form = this.element.querySelector("form");
    const fileInput = form.querySelector('input[name="pdf-file"]');
    const depthInput = form.querySelector('select[name="depth"]');

    const file = fileInput?.files?.[0];
    if (!file) {
      return ui.notifications.warn(game.i18n.localize("PDFJOURNAL.NoFileSelected"));
    }

    this.#file = file;
    this.#sections = null;
    this.#busy = true;
    this._updateProgressBar(0, 1, game.i18n.localize("PDFJOURNAL.Parsing"));
    await this.render();

    try {
      const buffer = await file.arrayBuffer();
      const maxDepth = parseInt(depthInput?.value ?? "0", 10);

      this.#sections = await parsePdf(buffer, {
        maxDepth,
        onProgress: (cur, total) => this._updateProgressBar(cur, total, game.i18n.localize("PDFJOURNAL.Parsing")),
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

  /**
   * Called when the user clicks "Import".
   */
  async _onImport(event, _target) {
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
        onProgress: (cur, total) => this._updateProgressBar(cur, total, game.i18n.localize("PDFJOURNAL.Creating")),
      });
      // Open the new journal
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

  /* ---------------------------------------------------------------- */
  /*  Progress bar helpers                                              */
  /* ---------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------- */
  /*  Event listener registration (v13 ApplicationV2 pattern)          */
  /* ---------------------------------------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);

    this.element.querySelector("[data-action='preview']")
      ?.addEventListener("click", (e) => this._onPreview(e));

    this.element.querySelector("[data-action='import']")
      ?.addEventListener("click", (e) => this._onImport(e));
  }
}
