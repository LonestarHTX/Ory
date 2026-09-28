// Frontmatter properties. In live preview the YAML block at the top of a note
// is a properties table you edit in place: click a value or a key to change
// it, tick a yes/no value, pick a date from a calendar, add a property from
// the row at the bottom, remove one from its "..." menu. Each change rewrites
// only that property's lines. Moving the cursor into the block (arrow up from
// the first line) or source mode shows the YAML itself.

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { load as parseYaml } from "js-yaml";

import { openCalendar, parseISO, toISO } from "../ui/calendar.js";
import { formatDate, h, icon, keys, relativeDay } from "../ui/dom.js";
import { openMenu } from "../ui/menu.js";
import { isReading, sourceMode } from "./live-preview.js";

/** The frontmatter block as {from, to, yamlFrom, yamlTo, bodyFrom}, or null. Mirrors ory/markdown.py. */
export function frontmatterRange(doc) {
  if (doc.lines < 2 || doc.line(1).text !== "---") return null;
  for (let n = 2; n <= Math.min(doc.lines, 500); n++) {
    const text = doc.line(n).text.replace(/\r$/, "");
    if (text === "---" || text === "...") {
      const end = doc.line(n);
      return { from: 0, to: end.to, yamlFrom: doc.line(2).from, yamlTo: end.from, bodyFrom: Math.min(end.to + 1, doc.length) };
    }
  }
  return null;
}

// Writing YAML -------------------------------------------------------------------

const KEY_LINE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#:"'][^:]*?)\s*:(?=\s|$)/;
// Properties that are always lists.
const LIST_KEYS = new Set(["tags", "tag", "aliases", "alias", "cssclasses"]);

function unquoteKey(key) {
  if (/^".*"$/.test(key)) return JSON.parse(key);
  if (/^'.*'$/.test(key)) return key.slice(1, -1).replace(/''/g, "'");
  return key;
}

/** Each top-level key and the lines [start, end) it spans. */
function yamlBlocks(lines) {
  const blocks = [];
  lines.forEach((line, i) => {
    if (!line.trim() || /^[\s#-]/.test(line)) return;
    const match = KEY_LINE.exec(line);
    if (!match) return;
    if (blocks.length) blocks[blocks.length - 1].end = i;
    blocks.push({ key: unquoteKey(match[1].trim()), start: i, end: lines.length });
  });
  // Trailing blank lines do not belong to the last property.
  const last = blocks[blocks.length - 1];
  if (last) while (last.end > last.start + 1 && !lines[last.end - 1].trim()) last.end -= 1;
  return blocks;
}

const NEEDS_QUOTES = [
  /^\s|\s$/,
  /^[-?:,[\]{}#&*!|>'"%@`]/,
  /:\s|\s#|:$/,
  /^(true|false|yes|no|on|off|null|~)$/i,
  /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/,
];

function yamlScalar(value) {
  if (value == null || value === "") return "";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value instanceof Date) return toISO(new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  if (value.isoDate) return value.isoDate; // from the calendar: a bare YAML date
  const text = String(value);
  return NEEDS_QUOTES.some((re) => re.test(text)) ? JSON.stringify(text) : text;
}

function propertyLines(key, value) {
  const k = KEY_LINE.test(`${key}: x`) && !/^["']/.test(key) ? key : JSON.stringify(key);
  if (Array.isArray(value)) {
    return value.length ? [`${k}:`, ...value.map((v) => `  - ${yamlScalar(v)}`)] : [`${k}: []`];
  }
  return [`${k}: ${yamlScalar(value)}`.trimEnd()];
}

/** Change one property in the YAML text: {value} sets, {rename} renames, {remove} removes. */
export function editYaml(yaml, key, change) {
  const lines = yaml.replace(/\n$/, "").split("\n").filter((l, i, all) => all.length > 1 || l.trim());
  const blocks = yamlBlocks(lines);
  const block = blocks.find((b) => b.key === key);
  if ("add" in change) {
    lines.push(...propertyLines(change.add, change.value ?? null));
  } else if (block && change.remove) {
    lines.splice(block.start, block.end - block.start);
  } else if (block && "rename" in change) {
    const first = lines[block.start];
    const match = KEY_LINE.exec(first);
    const k = propertyLines(change.rename, null)[0].replace(/:$/, "");
    lines[block.start] = k + first.slice(match[0].length - 1);
  } else if (block && "value" in change) {
    lines.splice(block.start, block.end - block.start, ...propertyLines(key, change.value));
  }
  const text = lines.join("\n");
  return text.trim() ? text + "\n" : "";
}

// Reading values --------------------------------------------------------------------

function asDate(value) {
  if (value instanceof Date) return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  return typeof value === "string" ? parseISO(value) : null;
}

/** What the edit field starts with. */
function editText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Turn what was typed back into a value of the property's kind. */
function parseInput(text, key, old) {
  const trimmed = text.trim();
  if (Array.isArray(old) || LIST_KEYS.has(key.toLowerCase())) {
    return trimmed ? trimmed.split(",").map((s) => s.trim()).filter(Boolean) : [];
  }
  if (!trimmed) return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function span(cls, text) {
  const el = document.createElement("span");
  if (cls) el.className = cls;
  el.textContent = text;
  return el;
}

function renderValue(value) {
  if (value == null || value === "") return span("cm-prop-empty", "Empty");
  if (Array.isArray(value)) {
    if (!value.length) return span("cm-prop-empty", "Empty");
    const wrap = document.createElement("span");
    value.forEach((item, i) => {
      if (i) wrap.append(", ");
      wrap.append(renderValue(item));
    });
    return wrap;
  }
  const date = asDate(value);
  if (date) {
    const wrap = span("", formatDate(date));
    wrap.append(" ", span("cm-prop-hint", relativeDay(date)));
    return wrap;
  }
  if (typeof value === "object") return span("cm-prop-raw", JSON.stringify(value));
  const text = String(value);
  const link = /^\[\[([^\[\]]+)\]\]$/.exec(text.trim());
  if (link) {
    const inner = link[1];
    const pipe = inner.indexOf("|");
    const el = span("cm-wikilink cm-link-live", pipe === -1 ? inner : inner.slice(pipe + 1));
    el.dataset.wikilink = inner;
    return el;
  }
  return span("", text);
}

// The widget ----------------------------------------------------------------------

/** Which field to open after the next render: {key, part: "value"|"key"} or {add: true}. */
let focusNext = null;

export function focusAddProperty() {
  focusNext = { add: true };
}

class PropertiesWidget extends WidgetType {
  constructor(yaml, openLink) {
    super();
    this.yaml = yaml;
    this.openLink = openLink;
  }

  eq(other) {
    return other.yaml === this.yaml;
  }

  toDOM(view) {
    const el = h("div", { class: "cm-props" });
    let data;
    try {
      data = parseYaml(this.yaml) ?? {};
    } catch (err) {
      const line = err.mark ? ` on line ${err.mark.line + 2}` : "";
      el.append(h("p", { class: "cm-props-error" },
        h("span", { class: "status-dot error" }),
        `The properties are not valid YAML${line}. `,
        h("button", { class: "btn btn--small", type: "button", onClick: () => revealYaml(view) }, "Edit YAML")));
      return el;
    }
    if (typeof data !== "object" || Array.isArray(data)) data = {};

    const write = (key, change, next) => {
      const yaml = editYaml(this.yaml, key, change);
      focusNext = next ?? null;
      const range = frontmatterRange(view.state.doc);
      if (!range || yaml === this.yaml) {
        focusNext = null;
        return;
      }
      view.dispatch({ changes: { from: range.yamlFrom, to: range.yamlTo, insert: yaml }, userEvent: "input.property" });
    };

    for (const [key, value] of Object.entries(data)) el.append(this.row(view, key, value, write));
    el.append(this.addRow(data, write));

    // Open the field a change asked for (a new property's value, say).
    const want = focusNext;
    focusNext = null;
    if (want) {
      queueMicrotask(() => {
        const target = want.add
          ? el.querySelector(".cm-prop-add input")
          : el.querySelector(`.cm-prop-row[data-key="${CSS.escape(want.key)}"] .cm-prop-${want.part}`);
        if (target?.tagName === "INPUT") target.focus();
        else target?.click();
      });
    }
    return el;
  }

  row(view, key, value, write) {
    const date = asDate(value);
    const keyCell = h("button", { class: "cm-prop-key", type: "button", dataset: { tip: "Rename property" } }, key);
    const valueCell = h("div", { class: "cm-prop-value", tabindex: typeof value === "boolean" ? null : 0 });
    const row = h("div", { class: "cm-prop-row", dataset: { key } }, keyCell, valueCell);

    if (typeof value === "boolean") {
      const box = h("input", { type: "checkbox", class: "cm-md-task", "aria-label": key });
      box.checked = value;
      box.addEventListener("change", () => write(key, { value: box.checked }));
      valueCell.append(box);
    } else {
      valueCell.append(renderValue(value));
    }

    const editValue = () => {
      if (date) {
        openCalendar(valueCell, {
          value: toISO(date),
          onPick: (iso) => write(key, { value: iso ? { isoDate: iso } : null }),
        });
        return;
      }
      const input = h("input", {
        class: "input input--bare cm-prop-input",
        value: editText(value),
        "aria-label": key,
        spellcheck: "false",
      });
      let done = false;
      const commit = (save) => {
        if (done) return;
        done = true;
        if (save) write(key, { value: parseInput(input.value, key, value) });
        else valueCell.replaceChildren(renderValue(value));
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(true);
          view.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          commit(false);
          view.focus();
        }
      });
      input.addEventListener("blur", () => commit(true));
      valueCell.replaceChildren(input);
      input.focus();
      input.select();
    };

    valueCell.addEventListener("click", (e) => {
      const link = e.target.closest("[data-wikilink]");
      if (link) return this.openLink({ wikilink: link.dataset.wikilink });
      if (typeof value !== "boolean" && !valueCell.querySelector("input")) editValue();
    });
    valueCell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === valueCell) {
        e.preventDefault();
        editValue();
      }
    });

    keyCell.addEventListener("click", () => {
      const input = h("input", { class: "input input--bare cm-prop-input", value: key, "aria-label": "Property name", spellcheck: "false" });
      let done = false;
      const commit = (save) => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (save && name && name !== key) write(key, { rename: name });
        else input.replaceWith(keyCell);
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          commit(e.key === "Enter");
        }
      });
      input.addEventListener("blur", () => commit(true));
      keyCell.replaceWith(input);
      input.focus();
      input.select();
    });

    const more = h("button", {
      class: "iconbtn cm-prop-more",
      type: "button",
      "aria-label": `Actions for ${key}`,
      "aria-haspopup": "menu",
      dataset: { tip: "Rename, remove, edit as YAML" },
      onClick: () => openMenu(more, [
        { label: "Rename", run: () => keyCell.click() },
        { label: "Remove property", confirm: `Remove "${key}"?`, run: () => write(key, { remove: true }) },
        { label: "Edit as YAML", run: () => revealYaml(view) },
      ]),
    }, icon("more", 16));
    row.append(more);
    return row;
  }

  /** The quiet add row: a plus, a plain field, and an Enter hint that becomes Add. */
  addRow(data, write) {
    const input = h("input", {
      class: "input input--bare cm-prop-input",
      placeholder: "Add property",
      "aria-label": "New property name",
      spellcheck: "false",
    });
    const hint = keys("Enter");
    const add = h("button", { class: "btn btn--small", type: "button", hidden: true }, "Add");
    const error = h("span", { class: "field-error", hidden: true });
    const submit = () => {
      const name = input.value.trim();
      if (!name) return;
      if (name in data) {
        error.hidden = false;
        error.textContent = `"${name}" is already a property.`;
        return;
      }
      write(null, { add: name, value: LIST_KEYS.has(name.toLowerCase()) ? [] : null }, { key: name, part: "value" });
    };
    input.addEventListener("input", () => {
      add.hidden = !input.value.trim();
      hint.hidden = !add.hidden;
      error.hidden = true;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    add.addEventListener("click", submit);
    return h("div", { class: "cm-prop-add" }, icon("plus", 16), input, hint, add, error);
  }

  ignoreEvent() {
    // The table handles its own clicks and keys.
    return true;
  }
}

/** Show the YAML itself, with the cursor in it. */
export function revealYaml(view) {
  const range = frontmatterRange(view.state.doc);
  if (!range) return;
  view.focus();
  view.dispatch({ selection: { anchor: range.yamlFrom } });
}

// The extension ----------------------------------------------------------------------

const focusEffect = StateEffect.define();

/** Whether the editor has focus, as state, so decorations can depend on it. */
export const focused = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(focusEffect)) value = e.value;
    return value;
  },
});

export function properties({ openLink }) {
  const decorate = (state) => {
    const range = frontmatterRange(state.doc);
    if (!range) return Decoration.none;
    // Reading a wiki page: its header shows the properties instead.
    if (isReading(state)) return Decoration.set(Decoration.replace({ block: true }).range(range.from, range.to));
    if (state.field(sourceMode)) return Decoration.none;
    const inside = state.selection.ranges.some((r) => r.from <= range.to && r.to >= range.from);
    if (inside && state.field(focused)) return Decoration.none;
    const yaml = state.doc.sliceString(range.yamlFrom, range.yamlTo);
    return Decoration.set(Decoration.replace({ widget: new PropertiesWidget(yaml, openLink), block: true }).range(range.from, range.to));
  };

  const field = StateField.define({
    create: decorate,
    update(deco, tr) {
      if (tr.docChanged || tr.selection || tr.effects.length) return decorate(tr.state);
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [
    focused,
    EditorView.focusChangeEffect.of((_, isFocused) => focusEffect.of(isFocused)),
    field,
  ];
}
