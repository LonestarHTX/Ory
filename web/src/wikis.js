// Wikis: each folder inside the wikis folder ("Wikis" by default) is one wiki.
// Everything outside it is notes. A wiki's pages are ordinary Markdown notes;
// Home.md is its front page, and Instructions.md and Log.md belong to its
// upkeep rather than its contents.

import { load as parseYaml } from "js-yaml";

import { fileUrl } from "./editor/live-preview.js";
import { folderOf, isImage, noteName, parseLink } from "./links.js";
import { resolve, store } from "./store.js";

const HOME = "home";
const UPKEEP = ["instructions", "log"];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The wiki a path belongs to, as its folder name, or null for notes. */
export function wikiOf(path) {
  const prefix = store.wikisFolder + "/";
  if (!path || !path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("/");
  return slash > 0 ? rest.slice(0, slash) : null;
}

/** Whether a path is in the wikis folder at all (a wiki, or the folder itself). */
export function inWikis(path) {
  return path === store.wikisFolder || (path ?? "").startsWith(store.wikisFolder + "/");
}

export const wikiFolder = (name) => `${store.wikisFolder}/${name}`;

export const isHome = (path) => wikiOf(path) != null && folderOf(path) === wikiFolder(wikiOf(path))
  && noteName(path).toLowerCase() === HOME;

export const isUpkeep = (path) => wikiOf(path) != null && folderOf(path) === wikiFolder(wikiOf(path))
  && UPKEEP.includes(noteName(path).toLowerCase());

/** Page order: an `order` property first, then by name. */
function byOrder(a, b) {
  const oa = Number(a.properties?.order);
  const ob = Number(b.properties?.order);
  const ha = Number.isFinite(oa);
  const hb = Number.isFinite(ob);
  if (ha && hb && oa !== ob) return oa - ob;
  if (ha !== hb) return ha ? -1 : 1;
  return collator.compare(a.name, b.name);
}

/**
 * One wiki, from the index: {name, folder, home, pages, sections, upkeep, mtime}.
 * `pages` are the wiki's own pages at its top level; `sections` are its
 * subfolders, each {name, folder, pages}, with deeper folders' pages folded in.
 */
export function wiki(name) {
  const folder = wikiFolder(name);
  const notes = store.notes.filter((n) => n.path.startsWith(folder + "/"));
  let home = null;
  const pages = [];
  const upkeep = [];
  const sections = new Map();
  for (const note of notes) {
    const parent = folderOf(note.path);
    if (parent === folder) {
      if (isHome(note.path)) home = note;
      else if (isUpkeep(note.path)) upkeep.push(note);
      else pages.push(note);
    } else {
      const section = parent.slice(folder.length + 1).split("/")[0];
      if (!sections.has(section)) sections.set(section, { name: section, folder: `${folder}/${section}`, pages: [] });
      sections.get(section).pages.push(note);
    }
  }
  // Empty subfolders still show, so a new section is visible before its first page.
  for (const f of store.folders) {
    if (folderOf(f) === folder && !sections.has(f.slice(folder.length + 1))) {
      const section = f.slice(folder.length + 1);
      sections.set(section, { name: section, folder: f, pages: [] });
    }
  }
  pages.sort(byOrder);
  upkeep.sort(byOrder);
  const sectionList = [...sections.values()].sort((a, b) => collator.compare(a.name, b.name));
  for (const s of sectionList) s.pages.sort(byOrder);
  return {
    name,
    folder,
    home,
    pages,
    sections: sectionList,
    upkeep,
    count: notes.length - upkeep.length,
    mtime: Math.max(0, ...notes.map((n) => n.mtime)),
    summary: textOf(home?.properties?.summary),
    cover: home?.properties?.cover ?? null,
  };
}

/** Every wiki, by name. */
export function wikis() {
  const prefix = store.wikisFolder + "/";
  const names = new Set();
  for (const f of store.folders) if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) names.add(f.slice(prefix.length));
  for (const n of store.notes) {
    const name = wikiOf(n.path);
    if (name) names.add(name);
  }
  return [...names].sort(collator.compare).map(wiki);
}

/** A page's title: the wiki's name for its Home, else the file name. */
export function pageTitle(path) {
  return isHome(path) ? wikiOf(path) : noteName(path);
}

// Page metadata --------------------------------------------------------------------

/** Split a page's text into its properties (parsed YAML) and body. */
export function pageParts(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { properties: {}, body: text };
  let properties = {};
  try {
    const data = parseYaml(match[1]);
    if (data && typeof data === "object" && !Array.isArray(data)) properties = data;
  } catch {
    /* unreadable YAML: the page shows without a header */
  }
  return { properties, body: text.slice(match[0].length) };
}

/** Whether a page has nothing written yet, so it opens ready for writing. */
export function isBlank(text) {
  return !pageParts(text).body.trim();
}

/**
 * The infobox: properties whose names start with a capital letter, in the
 * order written. Lower-case ones (tags, summary, cover, order) are not shown.
 */
export function infoboxRows(properties) {
  return Object.entries(properties).filter(([key, value]) => /^\p{Lu}/u.test(key) && value != null && value !== "");
}

/** A cover property ([[image.png]] or a path) as an image URL, if it names an image here. */
export function coverUrl(value) {
  if (!value) return null;
  const m = /^\s*\[\[([^\[\]]+)\]\]\s*$/.exec(String(value));
  const target = m ? parseLink(m[1]).target : String(value).trim();
  const path = resolve(target);
  return path && isImage(path) ? fileUrl(path) : null;
}

/** What a new wiki's Home starts with. */
export const HOME_TEMPLATE = "---\nsummary:\n---\n\n";

function textOf(value) {
  if (value == null) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}
