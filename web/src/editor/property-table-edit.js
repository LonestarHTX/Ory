// Editing a property table where it stands, the way a Markdown table is edited:
// its name, its columns (each heading's menu, and the + after them), its
// filters (the chips above it) and its cells, which are the notes' own
// properties. Every change to the table rewrites the block's YAML, which stays
// the file format; "Edit as text" in its "..." shows that.

import { dump } from "js-yaml";

import { h, icon } from "../ui/dom.js";
import { byOry } from "./live-preview.js";

// The block -----------------------------------------------------------------------

/** The ```notes block a widget stands for: its opening and closing lines. */
function blockLines(view, el) {
  let pos;
  try {
    pos = view.posAtDOM(el);
  } catch {
    return null;
  }
  const doc = view.state.doc;
  const open = doc.lineAt(pos);
  for (let n = open.number + 1; n <= doc.lines; n++) {
    if (/^\s*(```|~~~)\s*$/.test(doc.line(n).text)) return { open, close: doc.line(n) };
  }
  return null;
}

/** Write `spec` as the block's YAML: Ory's change, so it also works while reading. */
export function writeSpec(view, el, spec) {
  const lines = blockLines(view, el);
  if (!lines) return;
  const from = lines.open.to + 1, to = lines.close.from;
  view.dispatch({
    changes: { from, to: Math.max(from, to), insert: dump(spec, { lineWidth: -1, noRefs: true }) },
    annotations: byOry.of(true),
  });
}

/** Take the block (fences and all) out of the note. */
export function deleteBlock(view, el) {
  const lines = blockLines(view, el);
  if (!lines) return;
  const doc = view.state.doc;
  view.dispatch({ changes: { from: lines.open.from, to: Math.min(lines.close.to + 1, doc.length) }, annotations: byOry.of(true) });
}

/** Put the cursor in the block, which shows its YAML. */
export function editAsText(view, el) {
  const lines = blockLines(view, el);
  if (!lines) return;
  view.focus();
  view.dispatch({ selection: { anchor: Math.min(lines.open.to + 1, view.state.doc.length) } });
}

// Filters ---------------------------------------------------------------------------
// The table's filters as chips: one per condition when they are a plain list
// ("and" of expressions, or one expression); a filter written some other way
// (or, not, nested) is shown and edited as text.

/** The filters as a list of expressions, or null when chips can't show them. */
export function filterList(filters) {
  if (filters == null) return [];
  if (typeof filters === "string") return [filters];
  if (typeof filters === "object" && !Array.isArray(filters)) {
    const keys = Object.keys(filters);
    if (keys.length === 1 && keys[0] === "and" && Array.isArray(filters.and) && filters.and.every((f) => typeof f === "string")) {
      return [...filters.and];
    }
  }
  return null;
}

/** Ory's own fields, besides the notes' properties. */
export const OWN_FIELDS = [["file.folder", "Folder"], ["file.tags", "Tag"], ["file.links", "Links to"], ["file.mtime", "Edited"]];

const CONDITIONS = {
  property: [["is", "is"], ["isnot", "is not"], ["contains", "contains"], ["more", "is more than"], ["less", "is less than"], ["empty", "is empty"], ["notempty", "is not empty"]],
  "file.folder": [["is", "is"]],
  "file.tags": [["is", "is"]],
  "file.links": [["is", "is"]],
  "file.mtime": [["after", "after"], ["before", "before"]],
};
export const conditionsFor = (field) => CONDITIONS[field] ?? CONDITIONS.property;
export const needsValue = (cond) => cond !== "empty" && cond !== "notempty";
const OPS = { is: "==", isnot: "!=", more: ">", less: "<" };

function literalOf(text) {
  const t = text.trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return JSON.parse(t);
  if (/^'(?:[^'\\]|\\.)*'$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true" || t === "false") return t === "true";
  return undefined;
}

const quoted = (v) => JSON.stringify(String(v));
const literal = (v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : quoted(v));

/** An expression as {field, cond, value}, when it's one the filter builder writes. */
export function readFilter(expr) {
  const e = String(expr).trim();
  let m;
  if ((m = /^file\.inFolder\(("(?:[^"\\]|\\.)*")\)$/.exec(e))) return { field: "file.folder", cond: "is", value: JSON.parse(m[1]) };
  if ((m = /^file\.hasTag\(("(?:[^"\\]|\\.)*")\)$/.exec(e))) return { field: "file.tags", cond: "is", value: JSON.parse(m[1]) };
  if ((m = /^file\.hasLink\(("(?:[^"\\]|\\.)*")\)$/.exec(e))) return { field: "file.links", cond: "is", value: JSON.parse(m[1]) };
  if ((m = /^file\.mtime\s*([<>])\s*date\(("(?:[^"\\]|\\.)*")\)$/.exec(e))) {
    return { field: "file.mtime", cond: m[1] === ">" ? "after" : "before", value: JSON.parse(m[2]) };
  }
  if ((m = /^(!?)([A-Za-z_]\w*)\.isEmpty\(\)$/.exec(e))) return { field: m[2], cond: m[1] ? "notempty" : "empty", value: "" };
  if ((m = /^([A-Za-z_]\w*)\.contains\((.+)\)$/.exec(e))) {
    const value = literalOf(m[2]);
    if (value !== undefined) return { field: m[1], cond: "contains", value };
  }
  if ((m = /^([A-Za-z_]\w*)\s*(==|!=|>|<)\s*(.+)$/.exec(e))) {
    const value = literalOf(m[3]);
    const cond = Object.keys(OPS).find((k) => OPS[k] === m[2]);
    if (value !== undefined && m[1] !== "file") return { field: m[1], cond, value };
  }
  return null;
}

/** {field, cond, value} as an expression. */
export function writeFilter({ field, cond, value }) {
  switch (field) {
    case "file.folder": return `file.inFolder(${quoted(String(value).replace(/^\/+|\/+$/g, ""))})`;
    case "file.tags": return `file.hasTag(${quoted(String(value).replace(/^#/, ""))})`;
    case "file.links": return `file.hasLink(${quoted(value)})`;
    case "file.mtime": return `file.mtime ${cond === "before" ? "<" : ">"} date(${quoted(value)})`;
    default:
      if (cond === "empty") return `${field}.isEmpty()`;
      if (cond === "notempty") return `!${field}.isEmpty()`;
      if (cond === "contains") return `${field}.contains(${literal(value)})`;
      return `${field} ${OPS[cond] ?? "=="} ${literal(value)}`;
  }
}

const shown = (v) => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

/** What a chip says: "In Planets", "rings is No", or the expression itself. */
export function filterLabel(expr) {
  const f = readFilter(expr);
  if (!f) return String(expr);
  switch (f.field) {
    case "file.folder": return f.value ? `In ${f.value}` : "In the top folder";
    case "file.tags": return `Tagged #${f.value}`;
    case "file.links": return `Links to ${f.value}`;
    case "file.mtime": return `Edited ${f.cond} ${f.value}`;
    default: {
      const words = conditionsFor(f.field).find(([k]) => k === f.cond)?.[1] ?? f.cond;
      return needsValue(f.cond) ? `${f.field} ${words} ${shown(f.value)}` : `${f.field} ${words}`;
    }
  }
}

/** A typed value as the property's kind: a number, Yes/No for a true/false property, or text. */
export function typedValue(text, examples = []) {
  const t = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const booleans = examples.length > 0 && examples.every((v) => typeof v === "boolean");
  if (booleans || /^(true|false)$/i.test(t)) {
    if (/^(yes|true)$/i.test(t)) return true;
    if (/^(no|false)$/i.test(t)) return false;
  }
  return t;
}

/**
 * The filter builder: a field (a property or Folder, Tag, Links to, Edited),
 * a condition and a value; or, for a filter it can't read, the expression as
 * text. Shown under `anchor` inside `host`; save(expression) or remove().
 */
export function openFilterEditor({ host, anchor, expr = null, fields, valuesOf, save, remove }) {
  host.querySelector(".ptable-pop")?.remove();
  const known = expr == null ? { field: "file.folder", cond: "is", value: "" } : readFilter(expr);
  const pop = h("div", { class: "ptable-pop", role: "dialog", "aria-label": expr == null ? "Add a filter" : "Edit filter" });
  const close = () => {
    pop.remove();
    document.removeEventListener("pointerdown", away, true);
  };
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const done = (text) => {
    close();
    if (text) save(text);
  };

  let read; // () => the expression, or "" when incomplete
  const body = h("div", { class: "ptable-pop-body" });
  if (known) {
    const field = h("select", { class: "input ptable-select", "aria-label": "Property" },
      h("optgroup", { label: "Properties" }, fields.map((f) => h("option", { value: f }, f))),
      h("optgroup", { label: "Ory" }, OWN_FIELDS.map(([v, label]) => h("option", { value: v }, label))));
    const cond = h("select", { class: "input ptable-select", "aria-label": "Condition" });
    const list = h("datalist", { id: `ptable-values-${Math.random().toString(36).slice(2)}` });
    const value = h("input", { class: "input ptable-value", "aria-label": "Value", list: list.id, spellcheck: "false" });
    const fill = (keepCond) => {
      const conds = conditionsFor(field.value);
      cond.replaceChildren(...conds.map(([v, label]) => h("option", { value: v }, label)));
      if (keepCond && conds.some(([v]) => v === keepCond)) cond.value = keepCond;
      list.replaceChildren(...[...new Set(valuesOf(field.value).map(shown))].slice(0, 50).map((v) => h("option", { value: v })));
      value.placeholder = field.value === "file.mtime" ? "2026-10-01" : field.value === "file.folder" ? "Folder" : "Value";
      value.hidden = !needsValue(cond.value);
    };
    if (!fields.includes(known.field) && !OWN_FIELDS.some(([v]) => v === known.field)) {
      field.prepend(h("option", { value: known.field }, known.field));
    }
    field.value = known.field;
    fill(known.cond);
    value.value = known.value === "" ? "" : shown(known.value);
    field.addEventListener("change", () => fill(cond.value));
    cond.addEventListener("change", () => { value.hidden = !needsValue(cond.value); });
    body.append(h("div", { class: "ptable-pop-row" }, field, cond, value, list),
      h("p", { class: "ptable-pop-hint" }, "Properties come from the notes in this folder. Yes and No are true and false."));
    read = () => {
      if (needsValue(cond.value) && !value.value.trim()) return "";
      const isOwn = field.value.startsWith("file.");
      return writeFilter({
        field: field.value,
        cond: cond.value,
        value: isOwn ? value.value.trim() : typedValue(value.value, valuesOf(field.value)),
      });
    };
  } else {
    const text = h("input", { class: "input ptable-expr", value: expr, "aria-label": "Filter", spellcheck: "false" });
    body.append(text, h("p", { class: "ptable-pop-hint" }, "An expression, as in the YAML: status != \"done\", file.hasTag(\"space\")…"));
    read = () => text.value.trim();
  }

  const primary = h("button", { class: "btn btn--small btn--primary", type: "button", onClick: () => done(read()) }, expr == null ? "Add" : "Save");
  pop.append(
    h("p", { class: "ptable-pop-title" }, expr == null ? "Add a filter" : "Filter"),
    body,
    h("div", { class: "ptable-pop-foot" },
      remove ? h("button", { class: "btn btn--small btn--plain ptable-pop-remove", type: "button", onClick: () => { close(); remove(); } }, "Remove") : null,
      h("button", { class: "btn btn--small btn--plain", type: "button", onClick: close }, "Cancel"),
      primary));
  pop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      anchor.focus();
    } else if (e.key === "Enter" && e.target.tagName !== "SELECT") {
      e.preventDefault();
      done(read());
    }
  });

  const top = anchor.offsetTop + anchor.offsetHeight + 4;
  pop.style.top = `${top}px`;
  pop.style.left = `${Math.max(0, Math.min(anchor.offsetLeft, host.clientWidth - 320))}px`;
  host.append(pop);
  document.addEventListener("pointerdown", away, true);
  (pop.querySelector("select, input") ?? primary).focus();
}

/** A chip: a filter you can click to change, with × to take it off. */
export function chip(label, { onOpen, onRemove, editable }) {
  const el = h("span", { class: "ptable-chip" },
    h("button", { class: "ptable-chip-label", type: "button", disabled: editable ? null : true, onClick: onOpen }, label));
  if (editable && onRemove) {
    el.append(h("button", {
      class: "ptable-chip-x", type: "button", "aria-label": `Remove the filter ${label}`, onClick: onRemove,
    }, icon("close", 12)));
  }
  return el;
}
