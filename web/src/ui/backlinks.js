// Backlinks for the open note, in the right sidebar.

import { openNote } from "../actions.js";
import { api } from "../api.js";
import { on, store } from "../store.js";
import { h } from "./dom.js";
import { readable } from "./readable.js";

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
