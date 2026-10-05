// Backlinks for the open note: a view of the right panel (ui/panel.js).

import { clickOptions, openNote } from "../actions.js";
import { api } from "../api.js";
import { on, store } from "../store.js";
import { h } from "./dom.js";
import { readable } from "./readable.js";

export function createBacklinks(el) {
  const count = h("span", { class: "count" });
  const body = h("div", { class: "backlinks" });
  el.append(body);

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
        h("button", { class: "backlink-note", type: "button", onClick: (e) => openNote(b.path, clickOptions(e)) }, b.name),
        b.lines.map((l) =>
          h("button", { class: "backlink-line", type: "button", onClick: (e) => openNote(b.path, clickOptions(e, { line: l.line })) },
            readable(l.text))))));
  }

  on("current", refresh);
  refresh();
  return { refresh, count }; // the panel shows the count in its header
}
