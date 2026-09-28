// App-wide state: the vault index and the open note. Views subscribe to it.

import { api } from "./api.js";
import { fileName, noteName, resolveLink } from "./links.js";

export const store = {
  vaultName: "",
  dailyFolder: "Daily",
  wikisFolder: "Wikis",
  version: -1,
  notes: [], // [{path, name, aliases, mtime, tags, properties, links}]
  files: [], // attachments: [{path, name, size, mtime}]
  folders: [],
  paths: [],
  filePaths: [],
  byName: new Map(),
  byFile: new Map(),
  currentPath: null,
};

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, detail) {
  for (const fn of listeners.get(event) ?? []) fn(detail);
}

export async function loadIndex() {
  const index = await api.index();
  store.vaultName = index.name;
  store.dailyFolder = index.dailyFolder;
  store.wikisFolder = index.wikisFolder || "Wikis";
  store.version = index.version;
  store.notes = index.notes;
  store.folders = index.folders;
  store.paths = index.notes.map((n) => n.path);
  store.files = index.files;
  store.filePaths = index.files.map((f) => f.path);
  store.byName = groupBy(store.paths, noteName);
  store.byFile = groupBy(store.filePaths, fileName);
  emit("index");
}

function groupBy(paths, keyOf) {
  const map = new Map();
  for (const path of paths) {
    const key = keyOf(path).toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(path);
  }
  return map;
}

export function resolve(target, source = store.currentPath) {
  return resolveLink(target, source, store.paths, store.byName, store.filePaths, store.byFile);
}

/** The shortest link text that resolves to `path` (a note or a file) from the current note. */
export function linkTextFor(path, source = store.currentPath) {
  const isNote = /\.md$/i.test(path);
  const name = isNote ? noteName(path) : fileName(path);
  if (resolve(name, source) === path) return name;
  return isNote ? path.replace(/\.md$/i, "") : path;
}

export function setCurrent(path) {
  store.currentPath = path;
  if (path) rememberRecent(path);
  emit("current", path);
}

// Recently opened notes, for the quick switcher's empty state.
const RECENT_KEY = "ory.recent";

export function recentPaths() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch {
    return [];
  }
}

function rememberRecent(path) {
  const list = [path, ...recentPaths().filter((p) => p !== path)].slice(0, 30);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the switcher falls back to modified time */
  }
}
