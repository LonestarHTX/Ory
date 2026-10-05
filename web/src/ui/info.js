// Info: facts about the open note or page, a view of the right panel. Where it
// is, when it changed, how long it is, and its links, tags and aliases.

import { folderOf, isPage } from "../links.js";
import { on, store } from "../store.js";
import { h, timeAgo } from "./dom.js";

export function createInfo(el) {
  let words = null; // counted from the editor as you write

  function render() {
    const path = store.currentPath;
    if (!path) return el.replaceChildren(h("p", { class: "side-empty" }, "Open a note to see its details."));
    const note = store.notes.find((n) => n.path === path);
    const file = note ? null : store.files.find((f) => f.path === path);
    const rows = [["Folder", folderOf(path) || "Top of the notes folder"]];
    if (note) {
      rows.push(["Edited", when(note.mtime * 1000)]);
      if (words != null) rows.push(["Words", words.toLocaleString("en-US")]);
      rows.push(["Links to", count(note.links.length, "note")]);
      if (note.tags.length) rows.push(["Tags", note.tags.join(", ")]);
      if (note.aliases.length) rows.push(["Aliases", note.aliases.join(", ")]);
    } else if (file) {
      rows.push(["Edited", when(file.mtime * 1000)]);
      rows.push(["Size", size(file.size)]);
      if (isPage(path)) rows.push(["Kind", "HTML page"]);
    }
    el.replaceChildren(h("dl", { class: "info" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])));
  }

  on("current", () => {
    words = null;
    render();
  });
  on("index", render);
  // The editor reports its state as you write; count the body's words.
  on("note-state", (state) => {
    if (!state) return; // the note closed
    const text = state.doc.toString().replace(/^---\n[\s\S]*?\n---\n?/, "");
    const next = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    if (next !== words) {
      words = next;
      render();
    }
  });
  render();
  return { render };
}

/** "4 min ago", "Yesterday", "Oct 2, 2026". */
function when(ms) {
  const words = timeAgo(ms).replace(/^on /, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function size(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
