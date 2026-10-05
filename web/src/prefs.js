// Preferences kept in this browser (Settings → Appearance and Editing).
// Reads fall back to the default when storage is blocked; writes then last
// for this page only.

export const SOURCE_KEY = "ory.sourceMode";
export const READ_WIKI_KEY = "ory.readWiki";
export const SPELLCHECK_KEY = "ory.spellcheck";
export const MARKS_KEY = "ory.marks";
export const PAIR_KEY = "ory.pairBrackets";
export const NOTE_WIDTH_KEY = "ory.noteWidth"; // default | wide | full
export const NOTE_FONT_KEY = "ory.noteFont"; // sans | serif
export const NEW_NOTES_KEY = "ory.newNotesIn"; // here | top
export const START_KEY = "ory.startWith"; // last | today | wikis
export const OPEN_IN_KEY = "ory.openIn"; // same | new
export const SIDE_SHOWS = { today: "ory.sideToday", pinned: "ory.sidePinned", recent: "ory.sideRecent" };
export const SIDE_WIDTH_KEY = "ory.sideWidth";
export const PANEL_WIDTH_KEY = "ory.panelWidth";

export function pref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* lasts for this page only */
  }
}

/** Whether wiki pages open for reading (the default) rather than editing. */
export const readsWiki = () => pref(READ_WIKI_KEY, "1") === "1";

/** Whether the browser marks misspelt words while you write (on by default). */
export const spellchecks = () => pref(SPELLCHECK_KEY, "1") === "1";

/** Whether formatting marks (**, #, [[ ]]...) stay hidden even where you're typing (the default). */
export const hidesMarks = () => pref(MARKS_KEY, "hidden") === "hidden";

/** Whether typing ( [ " or ` adds its partner after the cursor (on by default). */
export const pairsBrackets = () => pref(PAIR_KEY, "1") === "1";

/** Whether the sidebar shows a group: "today", "pinned" or "recent" (all on by default). */
export const sideShows = (group) => pref(SIDE_SHOWS[group], "1") === "1";
