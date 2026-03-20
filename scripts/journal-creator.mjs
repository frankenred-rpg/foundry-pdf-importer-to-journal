/**
 * journal-creator.mjs
 *
 * Takes an array of sections ({ title, content }) and creates a Foundry VTT
 * JournalEntry with one JournalEntryPage per section.
 *
 * Compatible with Foundry VTT v13.
 */

/**
 * Create a JournalEntry from an array of sections.
 *
 * @param {string} journalName  Name for the new JournalEntry
 * @param {Array<{title:string, content:string}>} sections
 * @param {object} options
 * @param {string} [options.folder]   Folder ID to place the journal in
 * @param {Function} [options.onProgress]  Called with (current, total)
 * @returns {Promise<JournalEntry>}
 */
export async function createJournalFromSections(journalName, sections, { folder, onProgress } = {}) {
  if (!sections || sections.length === 0) {
    throw new Error("pdf-to-journal | No sections to import.");
  }

  // Build the pages array for JournalEntry.create()
  const pages = sections.map((section, index) => {
    onProgress?.(index + 1, sections.length);
    return {
      name: section.title || `${game.i18n.localize("PDFJOURNAL.DefaultSection")} ${index + 1}`,
      type: "text",
      title: {
        show: true,
        level: 1,
      },
      text: {
        content: section.content || "",
        format: 1, // CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML
      },
      sort: (index + 1) * 100,
    };
  });

  // Create the JournalEntry with all pages in one operation
  const journalData = {
    name: journalName,
    pages,
  };

  if (folder) journalData.folder = folder;

  const journal = await JournalEntry.create(journalData);

  ui.notifications.info(
    game.i18n.format("PDFJOURNAL.ImportSuccess", {
      name: journalName,
      count: pages.length,
    })
  );

  return journal;
}
