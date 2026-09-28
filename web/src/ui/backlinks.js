// Backlinks for the open note, in the right sidebar.

import { openNote } from "../actions.js";
import { api } from "../api.js";
import { parseLink } from "../links.js";
import { on, store } from "../store.js";
import { h } from "./dom.js";

export function createBacklinks(el) {
  const count = h("span", { class: "count" });
  const body = h("div", { class: "backlinks" });
  el.append(h("h2", { class: "side-title" }, "Backlinks", count), body);

  let seq = 0;

  async function refresh() {
    const path = store.currentPath;
    const mine = ++seq;
    if (!path) {
      count.textContent = "";
      body.replaceChildren(h("p", { class: "side-empty" }, "Open a note to see the notes that link to it."));
      return;
    }
    let backlinks;
    try {
      ({ backlinks } = await api.backlinks(path));
    } catch (err) {
      if (mine === seq) body.replaceChildren(h("p", { class: "field-error" }, h("span", { class: "status-dot error" }), err.message));
      return;
    }
    if (mine !== seq) return;
    count.textContent = backlinks.length ? String(backlinks.length) : "";
    if (!backlinks.length) {
      body.replaceChildren(h("p", { class: "side-empty" }, "No notes link here yet. Link to this note from another with [[."));
      return;
    }
    body.replaceChildren(...backlinks.map((b) =>
      h("section", { class: "backlink" },
        h("button", { class: "backlink-note", type: "button", onClick: () => openNote(b.path) }, b.name),
        b.lines.map((l) =>
          h("button", { class: "backlink-line", type: "button", onClick: () => openNote(b.path, { line: l.line }) },
            readable(l.text))))));
  }

  on("current", refresh);
  refresh();
  return { refresh };
}

/** Show a Markdown line the way it reads: list marks dropped, links as their text. */
function readable(text) {
  const line = text.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").replace(/^#+\s+/, "")
    .replace(/<\/?span[^>]*>/g, "");
  const out = [];
  let pos = 0;
  for (const m of line.matchAll(/!?\[\[([^\[\]]+)\]\]/g)) {
    const { target, alias } = parseLink(m[1]);
    // An embed's "|640" is a size, not a name to show.
    const shown = m[0].startsWith("!") ? target.replace(/\.html?$/i, "") : alias ?? target;
    out.push(line.slice(pos, m.index), h("span", { class: "backlink-link" }, shown));
    pos = m.index + m[0].length;
  }
  out.push(line.slice(pos));
  return out;
}
