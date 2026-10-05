// Things the user can do from anywhere: open, create, rename, archive and search.
// Views call these; navigation goes through the URL hash so Back and Forward work.

import { api } from "./api.js";
import { folderOf, isPage, noteName, parseLink } from "./links.js";
import { loadIndex, resolve, store } from "./store.js";
import { todayISO } from "./ui/dom.js";

// Routing ----------------------------------------------------------------------

/**
 * Parse the hash into a route: {view: "note", path} | {view: "page", path} |
 * {view: "search", query} | {view: "wikis"} | {view: "suggestions"} | {view: "archive"} | {view: "empty"}.
 */
export function currentRoute() {
  let hash;
  try {
    hash = decodeURIComponent(location.hash.slice(1));
  } catch {
    return { view: "empty" }; // a hand-typed "%" that isn't an escape
  }
  if (hash === "/wikis") return { view: "wikis" };
  if (hash === "/suggestions") return { view: "suggestions" };
  if (hash === "/archive") return { view: "archive" };
  if (hash === "/search" || hash.startsWith("/search?")) {
    return { view: "search", query: new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "" };
  }
  if (hash.length > 1 && hash.startsWith("/")) {
    const path = hash.slice(1);
    return { view: isPage(path) ? "page" : "note", path };
  }
  return { view: "empty" };
}

/**
 * Change route now. Setting location.hash would route a task later, and keys
 * typed in between would land in the note being left.
 */
function go(hash, replace = false) {
  if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

let pendingOptions = null;

/** Options for the next note shown (line to jump to, focus the title), consumed once. */
export function takeOpenOptions() {
  const options = pendingOptions ?? {};
  pendingOptions = null;
  return options;
}

export function openNote(path, options = {}) {
  pendingOptions = options;
  go("#/" + encodeURI(path), options.replace);
}

/** The Wikis space's home: every wiki. {create: true} opens the new-wiki field. */
export function openWikis(options = {}) {
  pendingOptions = options;
  go("#/wikis");
}

/** What has been archived, to restore or delete now. */
export function openArchive() {
  go("#/archive");
}

/** Settings is a window over whatever is open (ui/settings.js, opened by main.js). */
export function openSettings(section) {
  window.dispatchEvent(new CustomEvent("ory:settings", { detail: { section } }));
}

/** Suggestions for the wikis. {tab: "drafts"} opens on a tab. */
export function openSuggestions(options = {}) {
  pendingOptions = options;
  go("#/suggestions");
}

export function openSearch(query = "") {
  go("#/search" + (query ? "?" + new URLSearchParams({ q: query }) : ""));
}

export function closeNote() {
  go("#/", true);
}

// Notes ------------------------------------------------------------------------

export async function createNote(path, text = "") {
  const note = await api.create(path, text);
  await loadIndex();
  return note.path;
}

/** Create "Untitled", "Untitled 1", ... in a folder and open it with the title ready to type. */
export async function newNote(folder = "") {
  const prefix = folder ? folder + "/" : "";
  let name = "Untitled";
  for (let n = 1; store.paths.includes(`${prefix}${name}.md`); n++) name = `Untitled ${n}`;
  const path = await createNote(prefix + name);
  openNote(path, { focusTitle: true });
}

export async function newFolder(parent = "") {
  const prefix = parent ? parent + "/" : "";
  let name = "New folder";
  for (let n = 1; store.folders.includes(prefix + name); n++) name = `New folder ${n}`;
  const { path } = await api.createFolder(prefix + name);
  await loadIndex();
  return path;
}

/** Follow a link from a note: open it, creating the note first if it is missing. */
export async function followLink(link) {
  if (link.href) {
    // Web, mail and phone links only: a javascript: or data: link in a note must never run.
    if (/^(https?|mailto|tel):/i.test(link.href)) window.open(link.href, "_blank", "noopener");
    return;
  }
  const { target, heading } = parseLink(link.wikilink);
  // [[#Section]] jumps within the open note; [[Note#Section]] opens at it.
  if (!target) return heading && store.currentPath ? openNote(store.currentPath, { heading }) : undefined;
  const path = resolve(target);
  if (path && isPage(path)) return openNote(path);
  if (path && !/\.md$/i.test(path)) return openFile(path);
  if (path) return openNote(path, heading ? { heading } : {});
  if (/\.[A-Za-z0-9]{1,8}$/.test(target) && !/\.(md|\d+)$/i.test(target)) {
    return notify(`"${target}" is not in the notes folder.`, "error");
  }
  try {
    // A missing page linked from a wiki page is made in that wiki, beside it.
    const current = store.currentPath ?? "";
    const inWiki = current.startsWith(store.wikisFolder + "/") && current.split("/").length > 2 && !target.includes("/");
    openNote(await createNote(inWiki ? `${folderOf(current)}/${target}` : target));
  } catch (err) {
    alertError(err);
  }
}

/** Open an attachment in a new tab (or download it, for types a browser cannot show). */
export function openFile(path) {
  window.open("/files/" + path.split("/").map(encodeURIComponent).join("/"), "_blank", "noopener");
}

export async function openToday() {
  try {
    const { path } = await api.daily(todayISO());
    await loadIndex();
    openNote(path);
  } catch (err) {
    alertError(err);
  }
}

/**
 * Rename or move a note or folder. `to` is a full vault path. Returns the new
 * path; the server rewrites links in other notes that pointed here.
 */
const moveHooks = [];

/**
 * Register {before(from), after(from, to)} around every move. The note view
 * uses it to save before a move and to follow its note to the new path.
 * `after` gets to = null when the move fails.
 */
export function onMove(hooks) {
  moveHooks.push(hooks);
}

export async function movePath(from, to) {
  // Where you were when the move began: by the time it ends you may have gone on.
  const route = currentRoute();
  const was = route.view === "note" || route.view === "page" ? route.path : null;
  for (const hook of moveHooks) await hook.before(from);
  let result = null;
  try {
    result = await api.move(from, to);
  } finally {
    for (const hook of moveHooks) hook.after(from, result?.path ?? null);
  }
  await loadIndex();
  const now = currentRoute();
  const still = now.view === "note" || now.view === "page" ? now.path : null;
  if (still === was && was === from) openNote(result.path, { replace: true });
  else if (still === was && was?.startsWith(from + "/")) openNote(result.path + was.slice(from.length), { replace: true });
  return result;
}

export function renamePath(path, newName) {
  const folder = folderOf(path);
  const isNote = store.paths.includes(path);
  const to = (folder ? folder + "/" : "") + newName.trim() + (isNote ? ".md" : "");
  return movePath(path, to);
}

/** Archive a note, file or folder: it moves to `.archive/`, restorable for 30
    days, then Ory deletes it. Returns whether it went. */
export async function archivePath(path) {
  try {
    // Same hooks as a move: pending edits are saved before the file goes.
    for (const hook of moveHooks) await hook.before(path);
    try {
      await api.archive(path);
    } finally {
      for (const hook of moveHooks) hook.after(path, null);
    }
    await loadIndex();
    const current = store.currentPath;
    if (current === path || (current && current.startsWith(path + "/"))) {
      // Archiving a wiki page lands on that wiki's Home, if it still has one.
      const m = current.startsWith(store.wikisFolder + "/") ? /^([^/]+)\//.exec(current.slice(store.wikisFolder.length + 1)) : null;
      const home = m ? `${store.wikisFolder}/${m[1]}/Home.md` : null;
      if (home && home !== current && store.paths.includes(home)) openNote(home, { replace: true });
      else closeNote();
    }
    return true;
  } catch (err) {
    alertError(err);
    return false;
  }
}

/** Archive a wiki, its folder and everything in it. From inside it, you land
    on All wikis. */
export async function archiveWiki(name) {
  const folder = `${store.wikisFolder}/${name}`;
  const inside = !!store.currentPath?.startsWith(folder + "/");
  if ((await archivePath(folder)) && inside) openWikis();
}

/** Words for how long the archive keeps things, for confirmations. */
export const ARCHIVE_NOTE = "You can restore it from the Archive for 30 days.";

export function displayName(path) {
  return store.paths.includes(path) ? noteName(path) : path.slice(path.lastIndexOf("/") + 1);
}

// Errors and notices that have no field to sit beside go in the app's message line.
export function notify(message, level = "warning") {
  window.dispatchEvent(new CustomEvent("ory:message", { detail: { message, level } }));
}

export function alertError(err) {
  notify(err.message || String(err), "error");
}
