// Wikilink parsing and resolution. Mirrors resolve_link in ory/vault.py;
// keep the two in step so the editor and the backlinks panel agree.

export const NOTE_EXT = ".md";
// A link target ending in one of these is a file rather than a note.
const FILE_EXT = /\.[A-Za-z0-9]{1,8}$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export const isImage = (path) => IMAGE_EXT.test(path);
/** An HTML page from the notes folder, shown inside Ory rather than downloaded. */
export const isPage = (path) => /\.html?$/i.test(path);

export function fileName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function noteName(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.toLowerCase().endsWith(NOTE_EXT) ? base.slice(0, -NOTE_EXT.length) : base;
}

export function folderOf(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Split the inside of `[[...]]` into target, heading and alias. */
export function parseLink(inner) {
  const pipe = inner.indexOf("|");
  const alias = pipe === -1 ? null : inner.slice(pipe + 1);
  const ref = pipe === -1 ? inner : inner.slice(0, pipe);
  const hash = ref.indexOf("#");
  const target = (hash === -1 ? ref : ref.slice(0, hash)).replace(/\\$/, "").trim();
  const heading = hash === -1 ? null : ref.slice(hash + 1);
  return { target, heading, alias };
}

/** Resolve "." and ".." segments; null if the path climbs above the vault. */
function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/**
 * Resolve a link target to a note or file path, or null if nothing matches.
 * `byName` maps lower-cased note names to their paths; `byFile` does the same
 * for attachments by file name. "chart.png" is tried as a file first; if no
 * file matches it can still be a note whose name ends in something like ".2".
 */
export function resolveLink(target, source, paths, byName, files = [], byFile = new Map()) {
  const stripped = target.trim().replace(/\\/g, "/");
  if (FILE_EXT.test(stripped) && !stripped.toLowerCase().endsWith(NOTE_EXT)) {
    const found = resolveIn(stripped, source, files, byFile, "");
    if (found) return found;
  }
  return resolveIn(target, source, paths, byName, NOTE_EXT);
}

function resolveIn(target, source, paths, byName, ext) {
  target = target.trim().replace(/\\/g, "/");
  if (ext && target.toLowerCase().endsWith(ext)) target = target.slice(0, -ext.length);
  if (!target) return null;
  const sourceDir = source ? folderOf(source) : "";

  if (target.startsWith("./") || target.startsWith("../")) {
    const joined = normalize(`${sourceDir}/${target}`);
    if (joined === null) return null;
    const wanted = (joined + ext).toLowerCase();
    return paths.find((p) => p.toLowerCase() === wanted) ?? null;
  }

  target = target.replace(/^\/+/, "");
  if (target.includes("/")) {
    const wanted = (target + ext).toLowerCase();
    const exact = paths.find((p) => p.toLowerCase() === wanted);
    if (exact) return exact;
    const suffix = paths.filter((p) => p.toLowerCase().endsWith("/" + wanted));
    return suffix.sort(byLength)[0] ?? null;
  }

  const candidates = byName.get(target.toLowerCase()) ?? [];
  return [...candidates].sort((a, b) =>
    (folderOf(a) !== sourceDir) - (folderOf(b) !== sourceDir) || byLength(a, b))[0] ?? null;
}

function byLength(a, b) {
  return a.length - b.length || (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
}
