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
import { formatDate, h } from "../ui/dom.js";
import { isReading, sourceMode } from "./live-preview.js";
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
      const d = compare(cell(x, s.property), cell(y, s.property));
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

class QueryWidget extends WidgetType {
  constructor(yaml, version, env) {
    super();
    this.yaml = yaml;
    this.version = version;
    this.env = env;
  }

  eq(other) {
    return other.yaml === this.yaml && other.version === this.version;
  }

  toDOM(view) {
    const el = h("div", { class: "ptable" });
    let viewIndex = 0;
    let sortCol = null;
    let sortDir = "ASC";

    const render = () => {
      let result;
      try {
        result = runQuery(this.yaml, this.env, viewIndex);
      } catch (err) {
        const where = err.mark ? ` (line ${err.mark.line + 1})` : "";
        el.replaceChildren(h("div", { class: "ptable-head" },
          h("p", { class: "ptable-error" }, h("span", { class: "status-dot error" }),
            `This property table has a problem${where}: ${err.message.split("\n")[0]}`),
          editButton()));
        return;
      }
      const { views, columns, headings, rows, total, cell, sortBy } = result;
      if (sortCol) sortBy(rows, [{ property: sortCol, direction: sortDir }]);

      const tabs = views.length > 1
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
        : h("span", { class: "ptable-name" }, views[0].name ?? "Property table");

      const table = h("table", { class: "md-table ptable-table" },
        h("tr", null, columns.map((col, c) => h("th", {
          "aria-sort": sortCol === col ? (sortDir === "ASC" ? "ascending" : "descending") : null,
        }, h("button", {
          class: "ptable-sort",
          type: "button",
          dataset: { tip: `Sort by ${headings[c]}` },
          onClick: () => {
            sortDir = sortCol === col && sortDir === "ASC" ? "DESC" : "ASC";
            sortCol = col;
            render();
          },
        }, headings[c], sortCol === col ? (sortDir === "ASC" ? " ↑" : " ↓") : "")))),
        rows.map((row) => h("tr", null, columns.map((col) => {
          const value = cell(row, col);
          return h("td", { class: NUMBER.test(String(value ?? "")) ? "is-number" : null, dataset: { align: "" } },
            h("div", { class: "md-cell" }, renderCell(value, col, row, this.env)));
        }))));

      el.replaceChildren(
        h("div", { class: "ptable-head" },
          tabs,
          h("span", { class: "ptable-count" }, `${total} ${total === 1 ? "note" : "notes"}${rows.length < total ? `, showing ${rows.length}` : ""}`),
          editButton()),
        rows.length
          ? h("div", { class: "md-table-scroll" }, table)
          : h("p", { class: "ptable-empty" }, "No notes match these filters yet."));
    };

    const editButton = () => h("button", {
      class: "btn btn--small btn--plain ptable-edit",
      type: "button",
      onClick: () => {
        const from = view.posAtDOM(el);
        view.focus();
        view.dispatch({ selection: { anchor: Math.min(from + 8, view.state.doc.length) } });
      },
    }, "Edit");

    render();
    return el;
  }

  ignoreEvent() {
    return true;
  }
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

/** env: { notes(), resolve(), currentPath(), version(), openPath(path), openLink(link) } */
export function propertyTables(env) {
  const build = (state) => {
    if (state.field(sourceMode) && !isReading(state)) return Decoration.none;
    const version = env.version();
    const decos = [];
    for (const block of queryBlocks(state)) {
      // The query shows as text while you edit it, like the properties' YAML.
      const inside = state.selection.ranges.some((r) => r.from <= block.to && r.to >= block.from);
      if (inside && state.field(focused, false)) continue;
      decos.push(Decoration.replace({ widget: new QueryWidget(block.yaml, version, env), block: true }).range(block.from, block.to));
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
