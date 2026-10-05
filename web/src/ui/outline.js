// The open note's headings: a view of the right panel (ui/panel.js). The
// heading the cursor is in is selected; clicking one jumps to it.

import { syntaxTree } from "@codemirror/language";

import { on } from "../store.js";
import { h } from "./dom.js";

/** Headings as [{level, text, line, from}], skipping any in the frontmatter. */
export function headings(state) {
  const out = [];
  syntaxTree(state).iterate({
    enter(node) {
      const m = /^(ATX|Setext)Heading(\d)$/.exec(node.name);
      if (!m) return node.name === "Document" || node.name === "Frontmatter" ? undefined : node.name !== "FencedCode";
      const line = state.doc.lineAt(node.from);
      const text = line.text.replace(/^\s{0,3}#{1,6}\s*/, "").replace(/\s+#+\s*$/, "").trim();
      if (text) out.push({ level: Number(m[2]), text, line: line.number - 1, from: node.from });
      return false;
    },
  });
  return out;
}

export function createOutline(el, { goToLine }) {
  const list = h("div", { class: "outline" });
  el.append(list);

  let items = [];
  let key = "";

  function render(state) {
    if (!state) {
      key = "";
      list.replaceChildren(h("p", { class: "side-empty" }, "Open a note to see its headings."));
      return;
    }
    const found = headings(state);
    const next = found.map((x) => `${x.level}:${x.text}:${x.line}`).join("|");
    const head = state.selection.main.head;
    const current = found.reduce((cur, x, i) => (x.from <= head ? i : cur), -1);
    if (next !== key) {
      key = next;
      items = found;
      list.replaceChildren(...(found.length
        ? found.map((x) => h("button", {
          class: "outline-item",
          type: "button",
          style: `--level: ${x.level - Math.min(...found.map((f) => f.level))}`,
          onClick: () => goToLine(x.line),
        }, x.text))
        : [h("p", { class: "side-empty" }, "Headings in this note appear here.")]));
    }
    [...list.querySelectorAll(".outline-item")].forEach((b, i) => b.classList.toggle("is-selected", i === current));
  }

  on("note-state", render);
  render(null);
  return { items: () => items };
}
