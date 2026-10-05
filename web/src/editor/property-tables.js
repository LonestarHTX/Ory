// Property tables: a ```notes block drawn as a live table of the notes its
// filters match, like a small database over the notes folder:
//
//   filters:              and / or / not lists of expressions, or one expression
//     and:
//       - file.inFolder("Projects")
//       - 'status != "done"'
//   views:
//     - type: table
//       name: Open projects
//       order: [file.name, status, due]      the columns
//       sort: [{property: due, direction: ASC}]
//       limit: 20
//   properties:
//     status: {displayName: Status}          column headings
//
// Expressions: properties by name (status, note.status), file.name, file.path,
// file.folder, file.ext, file.mtime, file.tags, this (the note holding the
// table); == != < <= > >= && || ! and parentheses; strings, numbers, true,
// false, null; file.inFolder(), file.hasTag(), file.hasLink(), file.hasProperty();
// .contains() .containsAny() .containsAll() .startsWith() .endsWith()
// .isEmpty() .lower() .length; date("2026-10-01"), today(), now(), if(a, b, c).
// Dates compare as ISO text ("2026-10-01"), which orders correctly.

import { syntaxTree } from "@codemirror/language";
import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { load as parseYaml } from "js-yaml";

import { folderOf, parseLink } from "../links.js";
import { formatDate, h, icon } from "../ui/dom.js";
import { openMenu } from "../ui/menu.js";
import { isReading, sourceMode } from "./live-preview.js";
import { chip, deleteBlock, editAsText, filterLabel, filterList, openFilterEditor, writeSpec } from "./property-table-edit.js";
import { focused } from "./properties.js";

// Expressions --------------------------------------------------------------------

class ExprError extends Error {}

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_][\w]*)|(==|!=|>=|<=|&&|\|\||[()<>!.,+-]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new ExprError(`Unexpected "${src.slice(pos).trim()[0]}" in ${src}`);
    if (m[1]) tokens.push({ t: "num", v: Number(m[1]) });
    else if (m[2]) tokens.push({ t: "str", v: m[2].slice(1, -1).replace(/\\(.)/g, "$1") });
    else if (m[3]) tokens.push({ t: "id", v: m[3] });
    else tokens.push({ t: "op", v: m[4] });
    pos = re.lastIndex;
  }
  return tokens;
}

/** Parse an expression into a small tree. */
function parseExpr(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = (v) => tokens[i]?.t === "op" && tokens[i].v === v;
  const take = (v) => {
    if (!peek(v)) throw new ExprError(`Expected "${v}" in ${src}`);
    i++;
  };
  const or = () => {
    let left = and();
    while (peek("||")) {
      i++;
      left = { k: "or", a: left, b: and() };
    }
    return left;
  };
  const and = () => {
    let left = not();
    while (peek("&&")) {
      i++;
      left = { k: "and", a: left, b: not() };
    }
    return left;
  };
  const not = () => {
    if (peek("!")) {
      i++;
      return { k: "not", a: not() };
    }
    return compare();
  };
  const compare = () => {
    const left = additive();
    const op = tokens[i];
    if (op?.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(op.v)) {
      i++;
      return { k: "cmp", op: op.v, a: left, b: additive() };
    }
    return left;
  };
  const additive = () => {
    let left = postfix();
    while (peek("+") || peek("-")) {
      const op = tokens[i++].v;
      left = { k: "arith", op, a: left, b: postfix() };
    }
    return left;
  };
  const postfix = () => {
    let node = primary();
    for (;;) {
      if (peek(".")) {
        i++;
        const name = tokens[i++];
        if (name?.t !== "id") throw new ExprError(`Expected a name after "." in ${src}`);
        node = { k: "member", obj: node, name: name.v };
      } else if (peek("(")) {
        i++;
        const args = [];
        while (!peek(")")) {
          args.push(or());
          if (!peek(")")) take(",");
        }
        take(")");
        node = { k: "call", fn: node, args };
      } else return node;
    }
  };
  const primary = () => {
    const tok = tokens[i++];
    if (!tok) throw new ExprError(`${src} ends too soon`);
    if (tok.t === "num" || tok.t === "str") return { k: "lit", v: tok.v };
    if (tok.t === "id") {
      if (tok.v === "true" || tok.v === "false") return { k: "lit", v: tok.v === "true" };
      if (tok.v === "null") return { k: "lit", v: null };
      return { k: "id", name: tok.v };
    }
    if (tok.v === "(") {
      const inner = or();
      take(")");
      return inner;
    }
    if (tok.v === "-") return { k: "arith", op: "-", a: { k: "lit", v: 0 }, b: primary() };
    throw new ExprError(`Unexpected "${tok.v}" in ${src}`);
  };
  const tree = or();
  if (i < tokens.length) throw new ExprError(`Unexpected "${tokens[i].v}" in ${src}`);
  return tree;
}

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A note as expressions see it. */
function fileOf(note, env) {
  const folder = folderOf(note.path);
  return {
    name: note.name,
    basename: note.name,
    path: note.path,
    folder,
    ext: "md",
    mtime: new Date(note.mtime * 1000).toISOString(),
    tags: note.tags ?? [],
    links: note.links ?? [],
    inFolder: (f) => {
      const want = String(f ?? "").replace(/^\/+|\/+$/g, "");
      return !want || folder === want || folder.startsWith(want + "/");
    },
    hasTag: (...tags) => tags.some((t) => (note.tags ?? []).some((own) => {
      const want = String(t).replace(/^#/, "");
      return own === want || own.startsWith(want + "/");
    })),
    hasLink: (target) => {
      const path = typeof target === "object" && target?.path ? target.path : env.resolve(String(target));
      return !!path && (note.links ?? []).includes(path);
    },
    hasProperty: (name) => Object.prototype.hasOwnProperty.call(note.properties ?? {}, name),
  };
}

function method(value, name, args) {
  const list = Array.isArray(value) ? value : null;
  const text = value == null ? "" : String(value);
  const has = (v) => (list ? list.map(String).includes(String(v)) : text.includes(String(v)));
  switch (name) {
    case "contains": return has(args[0]);
    case "containsAny": return args.some(has);
    case "containsAll": return args.every(has);
    case "startsWith": return text.startsWith(String(args[0]));
    case "endsWith": return text.endsWith(String(args[0]));
    case "isEmpty": return list ? !list.length : value == null || text === "";
    case "lower": return text.toLowerCase();
    case "upper": return text.toUpperCase();
    default: throw new ExprError(`Unknown function .${name}()`);
  }
}

function evaluate(node, ctx) {
  switch (node.k) {
    case "lit": return node.v;
    case "id": {
      if (node.name === "file") return ctx.file;
      if (node.name === "note") return ctx.props;
      if (node.name === "this") return ctx.self;
      if (["date", "today", "now", "if", "link"].includes(node.name)) return { fn: node.name };
      return ctx.props[node.name] ?? null;
    }
    case "member": {
      const obj = evaluate(node.obj, ctx);
      if (obj == null) return null;
      if (node.name === "length" && (Array.isArray(obj) || typeof obj === "string")) return obj.length;
      if (typeof obj === "object" && !Array.isArray(obj) && node.name in obj) return obj[node.name];
      return { method: node.name, of: obj };
    }
    case "call": {
      const fn = evaluate(node.fn, ctx);
      const args = node.args.map((a) => evaluate(a, ctx));
      if (typeof fn === "function") return fn(...args);
      if (fn?.method) return method(fn.of, fn.method, args);
      switch (fn?.fn) {
        case "date": return String(args[0] ?? "").slice(0, 10);
        case "today": return isoDay(new Date());
        case "now": return new Date().toISOString();
        case "if": return args[0] ? args[1] : args[2] ?? null;
        case "link": return { path: ctx.resolve(String(args[0])) };
        default: throw new ExprError("That is not a function.");
      }
    }
    case "not": return !evaluate(node.a, ctx);
    case "and": return !!evaluate(node.a, ctx) && !!evaluate(node.b, ctx);
    case "or": return !!evaluate(node.a, ctx) || !!evaluate(node.b, ctx);
    case "arith": {
      const a = evaluate(node.a, ctx);
      const b = evaluate(node.b, ctx);
      return node.op === "+" ? (typeof a === "number" && typeof b === "number" ? a + b : `${a ?? ""}${b ?? ""}`) : a - b;
    }
    case "cmp": {
      let a = evaluate(node.a, ctx);
      let b = evaluate(node.b, ctx);
      if (a instanceof Date) a = isoDay(a);
      if (b instanceof Date) b = isoDay(b);
      switch (node.op) {
        case "==": return looseEq(a, b);
        case "!=": return !looseEq(a, b);
        default:
          if (a == null || b == null) return false;
          return node.op === "<" ? a < b : node.op === "<=" ? a <= b : node.op === ">" ? a > b : a >= b;
      }
    }
    default: throw new ExprError("Cannot read that expression.");
  }
}

function looseEq(a, b) {
  if (Array.isArray(a)) return a.map(String).includes(String(b));
  if (a == null || b == null) return a == b; // eslint-disable-line eqeqeq
  return String(a) === String(b);
}

function filterFn(spec, env) {
  if (spec == null) return () => true;
  if (typeof spec === "string" || typeof spec === "boolean") {
    const tree = parseExpr(String(spec));
    return (ctx) => !!evaluate(tree, ctx);
  }
  if (typeof spec !== "object") throw new ExprError("Filters are a list of conditions.");
  const [kind] = Object.keys(spec);
  const parts = (Array.isArray(spec[kind]) ? spec[kind] : [spec[kind]]).map((s) => filterFn(s, env));
  if (kind === "and") return (ctx) => parts.every((p) => p(ctx));
  if (kind === "or") return (ctx) => parts.some((p) => p(ctx));
  if (kind === "not") return (ctx) => !parts.some((p) => p(ctx));
  throw new ExprError(`Filters use "and", "or" or "not", not "${kind}".`);
}

// Query ----------------------------------------------------------------------------

/** Run a property table's query: {views, rows, columns, error}. */
export function runQuery(yaml, env, viewIndex = 0) {
  const spec = parseYaml(yaml) ?? {};
  const views = (spec.views ?? [{ type: "table", name: "Table" }]).filter((v) => !v.type || v.type === "table");
  if (!views.length) throw new ExprError("A property table needs a view of type table.");
  const view = views[Math.min(viewIndex, views.length - 1)];
  const keep = [filterFn(spec.filters, env), filterFn(view.filters, env)];

  const selfNote = env.notes().find((n) => n.path === env.currentPath());
  const self = selfNote ? { file: fileOf(selfNote, env) } : {};
  self.file = self.file ?? {};

  const rows = [];
  for (const note of env.notes()) {
    const props = note.properties ?? {};
    const ctx = { file: fileOf(note, env), props, self, resolve: env.resolve };
    if (keep.every((f) => f(ctx))) rows.push({ note, ctx });
  }

  const columns = (view.order ?? ["file.name"]).map(String);
  const cell = (row, col) => {
    const name = col.replace(/^note\./, "");
    if (col.startsWith("file.")) return row.ctx.file[col.slice(5)] ?? null;
    if (col.startsWith("formula.")) return null;
    return row.ctx.props[name] ?? null;
  };

  const sorts = (view.sort ?? []).map((s) => (typeof s === "string" ? { property: s, direction: "ASC" } : s));
  const compare = (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  };
  const sortBy = (list, specs) => list.sort((x, y) => {
    for (const s of specs) {
      const a = cell(x, s.property), b = cell(y, s.property);
      if ((a == null) !== (b == null)) return a == null ? 1 : -1; // empty last, whichever way
      const d = compare(a, b);
      if (d) return String(s.direction).toUpperCase() === "DESC" ? -d : d;
    }
    return compare(x.note.name, y.note.name);
  });
  sortBy(rows, sorts);

  const limited = view.limit ? rows.slice(0, Number(view.limit)) : rows;
  const heading = (col) => spec.properties?.[col]?.displayName
    ?? spec.properties?.[col.replace(/^note\./, "")]?.displayName
    ?? { "file.name": "Name", "file.folder": "Folder", "file.mtime": "Modified", "file.tags": "Tags", "file.path": "Path" }[col]
    ?? col.replace(/^note\./, "");
  return { views, view, columns, headings: columns.map(heading), rows: limited, total: rows.length, cell, sortBy };
}

// Display ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

function renderCell(value, col, row, env) {
  if (col === "file.name") {
    const link = h("span", { class: "cm-wikilink cm-link-live" }, row.note.name);
    link.addEventListener("click", () => env.openPath(row.note.path));
    return link;
  }
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.flatMap((v, i) => (i ? [", ", renderCell(v, "", row, env)] : [renderCell(v, "", row, env)]));
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value);
  if (ISO_DATE.test(text)) {
    const d = new Date(text.length === 10 ? text + "T00:00:00" : text);
    if (!Number.isNaN(d.getTime())) return formatDate(d);
  }
  const link = /^\[\[([^\[\]]+)\]\]$/.exec(text.trim());
  if (link) {
    const { target, alias } = parseLink(link[1]);
    const el = h("span", { class: `cm-wikilink cm-link-live${env.resolve(target) ? "" : " cm-wikilink-missing"}` }, alias ?? target);
    el.addEventListener("click", () => env.openLink({ wikilink: link[1] }));
    return el;
  }
  return text;
}

const NUMBER = /^[-+]?\d[\d,]*(\.\d+)?%?$/;

const LIST_KEYS = new Set(["tags", "tag", "aliases", "alias", "cssclasses"]);

/** What a cell's field starts with when you edit it. */
function cellText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** What was typed in a cell, as a value of the property's kind. */
function cellValue(text, key, old) {
  const t = text.trim();
  if (Array.isArray(old) || LIST_KEYS.has(key.toLowerCase())) return t ? t.split(",").map((x) => x.trim()).filter(Boolean) : [];
  if (!t) return null;
  if (typeof old === "boolean") {
    if (/^(yes|true)$/i.test(t)) return true;
    if (/^(no|false)$/i.test(t)) return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

/** The table's views of type table, as [view, index in the YAML's views]. */
const tableViews = (spec) => (spec.views ?? []).map((v, i) => [v, i]).filter(([v]) => !v.type || v.type === "table");

/**
 * A ```notes block drawn as its table, and edited where it stands (unless the
 * note is being read): the name renames in place; a heading's menu sorts,
 * renames, moves or hides its column; + adds one; chips above are the
 * filters; a cell is a note's property, and typing changes that note.
 */
class QueryWidget extends WidgetType {
  constructor(yaml, version, env, canEdit) {
    super();
    this.yaml = yaml;
    this.version = version;
    this.env = env;
    this.canEdit = canEdit; // not "editable": WidgetType has that, read-only
  }

  eq(other) {
    return other.yaml === this.yaml && other.version === this.version && other.canEdit === this.canEdit;
  }

  // The notes changed (any save does that), not the table: draw its rows again
  // where it stands, so a filter being built or a cell being typed in stays.
  updateDOM(dom) {
    if (dom.ptable?.yaml !== this.yaml || dom.ptable.canEdit !== this.canEdit) return false;
    dom.ptable.refresh();
    return true;
  }

  toDOM(view) {
    const el = h("div", { class: `ptable${this.canEdit ? " is-editable" : ""}` });
    const env = this.env;
    const editable = this.canEdit;
    let viewIndex = 0;
    let sortCol = null; // while reading: a sort for now, not saved
    let sortDir = "ASC";

    let spec = {};
    try {
      spec = parseYaml(this.yaml) ?? {};
    } catch {
      /* shown as the table's problem below */
    }
    /** Change the YAML: fn(spec, view) on a copy, then write it into the block. */
    const change = (fn, columns) => {
      const next = structuredClone(spec);
      if (!tableViews(next).length) next.views = [...(next.views ?? []), { type: "table", name: "Table" }];
      const [v] = tableViews(next)[Math.min(viewIndex, tableViews(next).length - 1)];
      v.order = (v.order ?? columns ?? ["file.name"]).map(String);
      fn(next, v);
      writeSpec(view, el, next);
    };

    const moreButton = () => {
      const more = h("button", {
        class: "iconbtn ptable-more", type: "button", "aria-label": "Property table actions", "aria-haspopup": "menu",
        dataset: { tip: "Property table actions" },
        onClick: () => openMenu(more, [
          { label: "Edit as text", run: () => editAsText(view, el) },
          { label: "Delete table", confirm: "Delete this property table? The notes it lists stay as they are.", run: () => deleteBlock(view, el) },
        ]),
      }, icon("more", 16));
      return more;
    };

    // Every property any note has (that an expression can name), and what each holds.
    let allNotes = env.notes();
    const propertyNames = () => [...new Set(allNotes.flatMap((n) => Object.keys(n.properties ?? {})))]
      .filter((k) => /^[A-Za-z_]\w*$/.test(k)).sort((a, b) => a.localeCompare(b));
    const valuesOf = (field) => {
      if (field === "file.folder") return [...new Set(allNotes.map((n) => folderOf(n.path)).filter(Boolean))];
      if (field === "file.tags") return [...new Set(allNotes.flatMap((n) => n.tags ?? []))];
      if (field === "file.links") return allNotes.map((n) => n.name);
      if (field === "file.mtime") return [];
      return allNotes.flatMap((n) => {
        const v = n.properties?.[field];
        return v == null ? [] : Array.isArray(v) ? v : [v];
      });
    };

    const render = () => {
      allNotes = env.notes();
      let result;
      try {
        result = runQuery(this.yaml, env, viewIndex);
      } catch (err) {
        const where = err.mark ? ` (line ${err.mark.line + 1})` : "";
        el.replaceChildren(h("div", { class: "ptable-head" },
          h("p", { class: "ptable-error" }, h("span", { class: "status-dot error" }),
            `This property table has a problem${where}: ${err.message.split("\n")[0]}`),
          editable ? h("button", { class: "btn btn--small btn--plain ptable-edit", type: "button", onClick: () => editAsText(view, el) }, "Edit as text") : null));
        return;
      }
      const { views, view: shownView, columns, headings, rows, total, cell, sortBy } = result;
      if (sortCol) sortBy(rows, [{ property: sortCol, direction: sortDir }]);
      const saved = (shownView.sort ?? []).map((x) => (typeof x === "string" ? { property: x, direction: "ASC" } : x))[0];
      const arrowFor = (col) => {
        const s = sortCol ? { property: sortCol, direction: sortDir } : saved;
        return s?.property === col ? (String(s.direction).toUpperCase() === "DESC" ? " ↓" : " ↑") : "";
      };

      // The name, or the views' tabs; the name renames in place.
      const nameEl = views.length > 1
        ? h("div", { class: "ptable-tabs", role: "tablist" }, views.map((v, i) => h("button", {
          class: `ptable-tab${i === viewIndex ? " is-selected" : ""}`,
          type: "button",
          role: "tab",
          "aria-selected": String(i === viewIndex),
          onClick: () => {
            viewIndex = i;
            render();
          },
        }, v.name ?? `View ${i + 1}`)))
        : editable
          ? h("button", {
            class: "ptable-name ptable-rename", type: "button", dataset: { tip: "Rename" },
            onClick: (e) => renameInPlace(e.currentTarget, shownView.name ?? "", (name) => change((_, v) => { v.name = name || "Table"; }, columns)),
          }, shownView.name ?? "Property table")
          : h("span", { class: "ptable-name" }, shownView.name ?? "Property table");

      // Filters, as chips.
      const filters = filterList(spec.filters);
      const setFilters = (list) => change((next) => {
        if (!list.length) delete next.filters;
        else next.filters = { and: list };
      }, columns);
      const chips = h("div", { class: "ptable-filters" });
      const fields = propertyNames();
      if (filters) {
        filters.forEach((expr, i) => {
          const c = chip(filterLabel(expr), {
            editable,
            onOpen: (e) => openFilterEditor({
              host: el, anchor: e.currentTarget, expr, fields, valuesOf,
              save: (text) => setFilters(filters.map((f, j) => (j === i ? text : f))),
              remove: () => setFilters(filters.filter((_, j) => j !== i)),
            }),
            onRemove: () => setFilters(filters.filter((_, j) => j !== i)),
          });
          chips.append(c);
        });
        if (editable) {
          const add = h("button", {
            class: "ptable-chip ptable-chip-add", type: "button",
            onClick: () => openFilterEditor({
              host: el, anchor: add, fields, valuesOf,
              save: (text) => setFilters([...filters, text]),
            }),
          }, icon("plus", 12), "Filter");
          chips.append(add);
        }
      } else if (spec.filters != null) {
        // and/or/not written by hand: shown as one chip that opens the YAML.
        chips.append(chip("Filters written as text", { editable, onOpen: () => editAsText(view, el) }));
      }
      if (shownView.filters != null) chips.append(chip("This view's own filters", { editable, onOpen: () => editAsText(view, el) }));
      if (chips.childElementCount) chips.prepend(h("span", { class: "ptable-filters-label" }, "Notes"));

      // A heading: while reading, a click sorts for now; otherwise its menu.
      const numeric = (col) => rows.some((r) => typeof cell(r, col) === "number");
      const headingCell = (col, c) => {
        const button = h("button", {
          class: "ptable-sort",
          type: "button",
          "aria-haspopup": editable ? "menu" : null,
          dataset: { tip: editable ? null : `Sort by ${headings[c]}` },
          onClick: () => {
            if (!editable) {
              sortDir = sortCol === col && sortDir === "ASC" ? "DESC" : "ASC";
              sortCol = col;
              render();
              return;
            }
            const [up, down] = numeric(col) ? ["Sort 1 → 9", "Sort 9 → 1"] : ["Sort A → Z", "Sort Z → A"];
            const is = (dir) => saved?.property === col && String(saved.direction).toUpperCase() === dir;
            const sortTo = (dir) => change((_, v) => {
              if (is(dir)) delete v.sort;
              else v.sort = [{ property: col, direction: dir }];
            }, columns);
            const move = (by) => change((_, v) => {
              const at = v.order.indexOf(col);
              if (at < 0 || at + by < 0 || at + by >= v.order.length) return;
              [v.order[at], v.order[at + by]] = [v.order[at + by], v.order[at]];
            }, columns);
            openMenu(button, [
              { label: up, checked: is("ASC"), run: () => sortTo("ASC") },
              { label: down, checked: is("DESC"), run: () => sortTo("DESC") },
              null,
              {
                label: "Rename heading…",
                run: () => renameInPlace(button, headings[c], (text) => change((next) => {
                  const key = col.replace(/^note\./, "");
                  next.properties ??= {};
                  next.properties[key] = { ...(next.properties[key] ?? {}) };
                  if (text && text !== key) next.properties[key].displayName = text;
                  else delete next.properties[key].displayName;
                  if (!Object.keys(next.properties[key]).length) delete next.properties[key];
                  if (!Object.keys(next.properties).length) delete next.properties;
                }, columns)),
              },
              ...(c > 0 ? [{ label: "Move left", run: () => move(-1) }] : []),
              ...(c < columns.length - 1 ? [{ label: "Move right", run: () => move(1) }] : []),
              ...(columns.length > 1 ? [null, { label: "Hide column", run: () => change((_, v) => { v.order = v.order.filter((x) => x !== col); }, columns) }] : []),
            ], { align: "start" });
          },
        }, headings[c], arrowFor(col));
        return h("th", null, button);
      };

      // A cell: a note's property, typed into in place; Ory's own fields aren't.
      const bodyCell = (row, col) => {
        let value = cell(row, col);
        const key = col.replace(/^note\./, "");
        const own = col.startsWith("file.") || col.startsWith("formula.");
        const div = h("div", { class: "md-cell" }, renderCell(value, col, row, env));
        const td = h("td", { class: NUMBER.test(String(value ?? "")) ? "is-number" : null, dataset: { align: "" } }, div);
        if (!editable || own) return td;
        div.contentEditable = "plaintext-only";
        div.spellcheck = false;
        // A link in the cell still opens; the rest of the cell edits.
        div.addEventListener("mousedown", (e) => {
          if (e.target.closest(".cm-wikilink") && document.activeElement !== div) e.preventDefault();
        });
        div.setAttribute("aria-label", `${headings[columns.indexOf(col)]} of ${row.note.name}`);
        let before = null;
        div.addEventListener("focus", () => {
          before = cellText(value);
          div.textContent = before;
          const range = document.createRange();
          range.selectNodeContents(div);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
        });
        div.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            div.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            div.textContent = before;
            div.blur();
          }
        });
        div.addEventListener("blur", () => {
          const text = div.textContent ?? "";
          if (before == null || text === before) {
            div.replaceChildren(...[renderCell(value, col, row, env)].flat());
            return;
          }
          const next = cellValue(text, key, value);
          value = next; // what the cell holds now, until the notes come back with it
          div.replaceChildren(...[renderCell(next, col, row, env)].flat());
          env.setProperty(row.note.path, key, next);
        });
        return td;
      };

      const table = h("table", { class: "md-table ptable-table" },
        h("tr", null, columns.map(headingCell)),
        rows.map((row) => h("tr", null, columns.map((col) => bodyCell(row, col)))));

      // + after the headings: a column for a property these notes have, or one of Ory's.
      const addColumn = editable ? h("button", {
        class: "ptable-addcol", type: "button", "aria-label": "Add a column", "aria-haspopup": "menu", dataset: { tip: "Add a column" },
        onClick: () => {
          const have = new Set(columns.map((c) => c.replace(/^note\./, "")));
          const props = [...new Set(rows.flatMap((r) => Object.keys(r.note.properties ?? {})))].filter((k) => !have.has(k)).sort();
          const others = propertyNames().filter((k) => !have.has(k) && !props.includes(k));
          const own = [["file.folder", "Folder"], ["file.mtime", "Edited"], ["file.tags", "Tags"]].filter(([k]) => !have.has(k));
          const add = (col) => change((_, v) => { v.order = [...v.order, col]; }, columns);
          openMenu(addColumn, [
            ...props.map((k) => ({ label: k, run: () => add(k) })),
            ...(others.length ? [null, ...others.map((k) => ({ label: k, run: () => add(k) }))] : []),
            ...(own.length ? [null, ...own.map(([k, label]) => ({ label, run: () => add(k) }))] : []),
          ]);
        },
      }, icon("plus", 14)) : null;

      el.replaceChildren(
        h("div", { class: "ptable-head" },
          nameEl,
          h("span", { class: "ptable-count" }, `${total} ${total === 1 ? "note" : "notes"}${rows.length < total ? `, showing ${rows.length}` : ""}`),
          editable ? moreButton() : null),
        chips.childElementCount ? chips : null,
        rows.length
          ? h("div", { class: "ptable-grid" }, h("div", { class: "md-table-scroll" }, table), addColumn)
          : h("p", { class: "ptable-empty" }, "No notes match these filters yet."));
    };

    // Busy: building a filter, renaming, or typing in a cell. A refresh waits for it.
    let stale = false;
    const busy = () => !!el.querySelector(".ptable-pop, .ptable-rename-input")
      || (el.contains(document.activeElement) && document.activeElement.isContentEditable);
    el.ptable = {
      yaml: this.yaml,
      canEdit: this.canEdit,
      refresh: () => {
        if (busy()) stale = true;
        else render();
      },
    };
    el.addEventListener("focusout", () => setTimeout(() => {
      if (stale && !busy()) {
        stale = false;
        render();
      }
    }, 0));

    render();
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

/** Rename in place: `target`'s text becomes a field; Enter (or leaving it) saves, Esc keeps it. */
function renameInPlace(target, text, save) {
  const input = h("input", { class: "input input--bare ptable-rename-input", value: text, spellcheck: "false", "aria-label": "Name" });
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    input.replaceWith(target);
    if (keep && value !== text) save(value);
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  target.replaceWith(input);
  input.focus();
  input.select();
}

// The extension ----------------------------------------------------------------------

function queryBlocks(state) {
  const out = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const info = node.node.getChild("CodeInfo");
      // Only a block on lines of its own can be replaced by the table (not one inside a list or quote).
      const whole = state.doc.lineAt(node.from).from === node.from && state.doc.lineAt(node.to).to === node.to;
      if (whole && info && state.sliceDoc(info.from, info.to).trim() === "notes") {
        const text = node.node.getChild("CodeText");
        out.push({ from: node.from, to: node.to, yaml: text ? state.sliceDoc(text.from, text.to) : "" });
      }
      return false;
    },
  });
  return out;
}

/** env: { notes(), resolve(), currentPath(), version(), openPath(path), openLink(link), setProperty(path, key, value) } */
export function propertyTables(env) {
  const build = (state) => {
    if (state.field(sourceMode) && !isReading(state)) return Decoration.none;
    const version = env.version();
    const decos = [];
    for (const block of queryBlocks(state)) {
      // The query shows as text while you edit it, like the properties' YAML.
      const inside = state.selection.ranges.some((r) => r.from <= block.to && r.to >= block.from);
      if (inside && state.field(focused, false)) continue;
      decos.push(Decoration.replace({ widget: new QueryWidget(block.yaml, version, env, !isReading(state)), block: true }).range(block.from, block.to));
    }
    return Decoration.set(decos);
  };
  return StateField.define({
    create: build,
    update(deco, tr) {
      if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)
          || tr.effects.length) {
        return build(tr.state);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
