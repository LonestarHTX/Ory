// Preferences kept in this browser (Settings → Appearance and Editing).
// Reads fall back to the default when storage is blocked; writes then last
// for this page only.

export const SOURCE_KEY = "ory.sourceMode";
export const READ_WIKI_KEY = "ory.readWiki";
export const SPELLCHECK_KEY = "ory.spellcheck";

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
