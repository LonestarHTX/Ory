// Tables as a grid. In live preview each Markdown table is drawn as a real
// table you edit in place, like a spreadsheet; the note still stores an
// ordinary Markdown table, rewritten (with padded columns) on every edit.
// Source mode (Mod-E) shows the Markdown.

import { undo, redo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Prec, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, WidgetType } from "@codemirror/view";

import { parseLink } from "../links.js";
import { inkPaint } from "../ui/color.js";
import { openMenu } from "../ui/menu.js";
import { isReading, setReading, setSourceMode, sourceMode } from "./live-preview.js";

// Markdown <-> model ---------------------------------------------------------------

/**
 * Split a table row into raw cell texts. "\|" is a literal pipe, and so is a
 * pipe inside [[a wikilink|alias]] or `code`, where people write it unescaped.
 */
function splitRow(line) {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells = [];
  let cell = "";
  let inLink = false;
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "|") {
      cell += "|";
      i++;
      continue;
    }
    if (!inCode && text.startsWith("[[", i)) inLink = true;
    if (!inCode && inLink && text.startsWith("]]", i)) inLink = false;
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inLink && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

export function parseTable(text) {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const header = splitRow(lines[0]);
  const align = splitRow(lines[1] ?? "").map((d) => {
    const left = d.startsWith(":");
    const right = d.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  const body = lines.slice(2).filter((l) => l.trim()).map(splitRow);
  const cols = Math.max(header.length, ...body.map((r) => r.length));
  const pad = (row) => [...row, ...Array(cols - row.length).fill("")];
  return {
    align: Array.from({ length: cols }, (_, c) => align[c] ?? null),
    rows: [pad(header), ...body.map(pad)],
  };
}

export function serializeTable({ align, rows }) {
  const esc = (s) => s.replace(/\n/g, " ").replace(/\|/g, "\\|");
  const cells = rows.map((row) => row.map(esc));
  const widths = align.map((_, c) => Math.max(3, ...cells.map((row) => row[c].length)));
  const line = (row) => "| " + row.map((cell, c) => cell.padEnd(widths[c])).join(" | ") + " |";
  const rule = "| " + align.map((a, c) => {
    const dashes = "-".repeat(widths[c] - (a === "center" ? 2 : a ? 1 : 0));
    return a === "center" ? `:${dashes}:` : a === "left" ? `:${dashes}` : a === "right" ? `${dashes}:` : dashes;
  }).join(" | ") + " |";
  return [line(cells[0]), rule, ...cells.slice(1).map(line)].join("\n");
}

// Cell display ----------------------------------------------------------------------

const NUMBER = /^[-+]?[$€£¥]?\d[\d,]*(\.\d+)?%?$/;

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}

/** Render a cell's inline Markdown for display: emphasis, code, links. */
function renderInline(raw, resolve) {
  const codes = [];
  let html = escapeHtml(raw).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code class="cm-md-code">${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  html = html
    .replace(/\[\[([^\[\]]+)\]\]/g, (_, inner) => {
      const { target, alias } = parseLink(inner);
      const missing = !resolve(target);
      return `<span class="cm-wikilink cm-link-live${missing ? " cm-wikilink-missing" : ""}" data-wikilink="${inner}">${alias ?? target}</span>`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="cm-md-link cm-link-live" data-href="$2">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="cm-md-strong">$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em class="cm-md-em">$2</em>')
    .replace(/~~([^~]+)~~/g, '<s class="cm-md-strike">$1</s>')
    .replace(/==([^=]+)==/g, '<mark class="cm-md-highlight">$1</mark>')
    // Coloured text, as the toolbar writes it (escaped above, so rebuilt here).
    .replace(/&lt;span style=&quot;color:\s*([^;&]+?);?\s*&quot;&gt;(.*?)&lt;\/span&gt;/g, (whole, color, text) => {
      const paint = inkPaint(color);
      return paint ? `<span class="${paint.className}" style="${paint.style}">${text}</span>` : whole;
    });
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i]);
}

function showCell(cell, raw, resolve) {
  cell.dataset.raw = raw;
  cell.innerHTML = renderInline(raw, resolve);
  cell.closest("td, th").classList.toggle("is-number", NUMBER.test(raw));
}

// The widget ----------------------------------------------------------------------

class TableWidget extends WidgetType {
  constructor(text, env, reading) {
    super();
    this.text = text;
    this.env = env;
    this.reading = reading;
  }

  eq(other) {
    return other.text === this.text && other.reading === this.reading;
  }

  toDOM(view) {
    const { align, rows } = parseTable(this.text);
    const wrap = document.createElement("div");
    wrap.className = "md-table-wrap";
    wrap.contentEditable = "false";
    wrap.oryText = this.text;
    wrap.oryReading = this.reading;

    const scroll = document.createElement("div");
    scroll.className = "md-table-scroll";
    const table = document.createElement("table");
    table.className = "md-table";
    rows.forEach((row, r) => {
      const tr = table.insertRow();
      row.forEach((raw, c) => {
        const td = document.createElement(r === 0 ? "th" : "td");
        const cell = document.createElement("div");
        cell.className = "md-cell";
        cell.dataset.r = r;
        cell.dataset.c = c;
        if (!this.reading) {
          cell.contentEditable = "plaintext-only";
          cell.spellcheck = true;
          cell.setAttribute("role", "textbox");
          cell.setAttribute("aria-label", r === 0 ? `Column ${c + 1} heading` : `Row ${r}, column ${c + 1}`);
        }
        td.append(cell);
        tr.append(td);
        showCell(cell, raw, this.env.resolve);
      });
    });
    setAlign(table, align);
    scroll.append(table);

    const addRow = document.createElement("button");
    addRow.type = "button";
    addRow.className = "md-table-add";
    addRow.textContent = "+ Add row";
    addRow.addEventListener("mousedown", (e) => e.preventDefault());
    addRow.addEventListener("click", () => edit(view, wrap, (m) => m.rows.push(m.align.map(() => "")), { r: rows.length, c: 0 }));

    wrap.append(scroll);
    if (!this.reading) wrap.append(addRow);
    wire(view, wrap, this.env);
    return wrap;
  }

  /** Keep the DOM (and the focused cell) when only cell text changed. */
  updateDOM(dom, view) {
    if (dom.oryReading !== this.reading) return false;
    const { align, rows } = parseTable(this.text);
    const table = dom.querySelector("table");
    const sameShape = table.rows.length === rows.length && [...table.rows].every((tr) => tr.cells.length === rows[0].length);
    if (!sameShape) return false;
    dom.oryText = this.text;
    dom.oryEnv = this.env;
    rows.forEach((row, r) => row.forEach((raw, c) => {
      const cell = table.rows[r].cells[c].firstChild;
      if (cell.dataset.raw === raw && cell !== document.activeElement) return;
      if (cell === document.activeElement) {
        if (cell.textContent !== raw) {
          cell.textContent = raw; // an undo changed the cell being edited
          placeCaret(cell, raw.length);
        }
        cell.dataset.raw = raw;
      } else {
        showCell(cell, raw, this.env.resolve);
      }
    }));
    setAlign(table, align);
    return true;
  }

  ignoreEvent() {
    return true;
  }

  ignoreMutation() {
    return true;
  }
}

function setAlign(table, align) {
  for (const tr of table.rows) {
    [...tr.cells].forEach((td, c) => {
      td.dataset.align = align[c] ?? "";
    });
  }
}

function placeCaret(cell, offset) {
  const range = document.createRange();
  const text = cell.firstChild ?? cell;
  range.setStart(text, Math.min(offset, text.textContent.length));
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function selectAll(cell) {
  const range = document.createRange();
  range.selectNodeContents(cell);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Where the table currently is in the document. */
function rangeOf(view, wrap) {
  const from = view.posAtDOM(wrap);
  return { from, to: from + wrap.oryText.length };
}

/** Read the model from the DOM's current text, change it, and write it back. */
function edit(view, wrap, change, focus) {
  if (isReading(view.state)) return;
  const { from, to } = rangeOf(view, wrap);
  const model = parseTable(wrap.oryText);
  change(model);
  const text = serializeTable(model);
  wrap.oryText = text;
  view.dispatch({ changes: { from, to, insert: text }, userEvent: "input.table" });
  if (focus) focusCell(view, from, focus.r, focus.c, true);
}

/** Focus a cell of the table at `pos`. CodeMirror updates the DOM as it dispatches, so it is there. */
export function focusCell(view, pos, r, c, select = false) {
  for (const wrap of view.contentDOM.querySelectorAll(".md-table-wrap")) {
    if (view.posAtDOM(wrap) !== pos) continue;
    const table = wrap.querySelector("table");
    const row = table.rows[Math.max(0, Math.min(r, table.rows.length - 1))];
    const cell = row.cells[Math.max(0, Math.min(c, row.cells.length - 1))].firstChild;
    cell.focus();
    if (select) selectAll(cell);
    return;
  }
}

function leave(view, pos) {
  view.focus();
  view.dispatch({ selection: { anchor: Math.max(0, Math.min(pos, view.state.doc.length)) }, scrollIntoView: true });
}

/** Events for one table: editing, moving between cells, the menu, links. */
function wire(view, wrap, env) {
  wrap.oryEnv = env;
  const cellAt = (r, c) => wrap.querySelector("table").rows[r]?.cells[c]?.firstChild ?? null;
  const shape = () => {
    const table = wrap.querySelector("table");
    return { rows: table.rows.length, cols: table.rows[0].cells.length };
  };

  wrap.addEventListener("focusin", (e) => {
    const cell = e.target.closest(".md-cell");
    if (!cell) return;
    cell.textContent = cell.dataset.raw;
    selectAll(cell);
  });

  wrap.addEventListener("focusout", (e) => {
    const cell = e.target.closest(".md-cell");
    if (cell) showCell(cell, cell.dataset.raw, wrap.oryEnv.resolve);
  });

  wrap.addEventListener("input", (e) => {
    const cell = e.target.closest(".md-cell");
    if (!cell) return;
    const raw = cell.textContent.replace(/\n/g, " ");
    cell.dataset.raw = raw;
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    edit(view, wrap, (m) => {
      m.rows[r][c] = raw;
    });
  });

  // Pasting several cells (tab-separated, as Excel copies them) fills the grid.
  wrap.addEventListener("paste", (e) => {
    const cell = e.target.closest(".md-cell");
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!cell || !/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const grid = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
    const r0 = +cell.dataset.r;
    const c0 = +cell.dataset.c;
    edit(view, wrap, (m) => {
      const cols = Math.max(m.align.length, c0 + Math.max(...grid.map((g) => g.length)));
      while (m.align.length < cols) m.align.push(null);
      m.rows.forEach((row) => row.push(...Array(cols - row.length).fill("")));
      grid.forEach((values, i) => {
        if (!m.rows[r0 + i]) m.rows.push(Array(cols).fill(""));
        values.forEach((v, j) => {
          m.rows[r0 + i][c0 + j] = v.trim();
        });
      });
    }, { r: r0, c: c0 });
  });

  wrap.addEventListener("keydown", (e) => {
    const cell = e.target.closest(".md-cell");
    if (!cell) return;
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    const { rows, cols } = shape();
    const mod = e.metaKey || e.ctrlKey;
    const sel = window.getSelection();
    const caret = sel.rangeCount && sel.isCollapsed ? sel.getRangeAt(0).startOffset : null;
    const go = (nr, nc, select = true) => {
      e.preventDefault();
      const target = cellAt(nr, nc);
      if (!target) return;
      target.focus();
      if (!select) placeCaret(target, target.textContent.length);
    };
    const { from, to } = rangeOf(view, wrap);

    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        if (c > 0) go(r, c - 1);
        else if (r > 0) go(r - 1, cols - 1);
      } else if (c < cols - 1) go(r, c + 1);
      else if (r < rows - 1) go(r + 1, 0);
      else edit(view, wrap, (m) => m.rows.push(m.align.map(() => "")), { r: rows, c: 0 });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        if (r > 0) go(r - 1, c);
      } else if (r < rows - 1) go(r + 1, c);
      else edit(view, wrap, (m) => m.rows.push(m.align.map(() => "")), { r: rows, c });
    } else if (e.key === "ArrowDown" && !e.shiftKey) {
      if (r < rows - 1) go(r + 1, c);
      else {
        e.preventDefault();
        leave(view, to + 1);
      }
    } else if (e.key === "ArrowUp" && !e.shiftKey) {
      if (r > 0) go(r - 1, c);
      else {
        e.preventDefault();
        leave(view, from - 1);
      }
    } else if (e.key === "ArrowLeft" && caret === 0 && !e.shiftKey && (c > 0 || r > 0)) {
      go(c > 0 ? r : r - 1, c > 0 ? c - 1 : cols - 1, false);
    } else if (e.key === "ArrowRight" && caret === cell.textContent.length && !e.shiftKey && (c < cols - 1 || r < rows - 1)) {
      e.preventDefault();
      const target = c < cols - 1 ? cellAt(r, c + 1) : cellAt(r + 1, 0);
      target.focus();
      placeCaret(target, 0);
    } else if (e.key === "Escape") {
      e.preventDefault();
      leave(view, to + 1);
    } else if (mod && (e.key === "b" || e.key === "i")) {
      e.preventDefault();
      wrapSelection(cell, e.key === "b" ? "**" : "*");
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      (e.shiftKey ? redo : undo)(view);
    } else if (mod && e.key === "y") {
      e.preventDefault();
      redo(view);
    }
  });

  // Links in a cell open on click while the cell is not being edited.
  wrap.addEventListener("mousedown", (e) => {
    const link = e.target.closest("[data-wikilink], [data-href]");
    const cell = e.target.closest(".md-cell");
    if (!link || !cell || cell === document.activeElement || e.button !== 0) return;
    e.preventDefault();
    wrap.oryEnv.openLink(link.dataset.wikilink != null ? { wikilink: link.dataset.wikilink } : { href: link.dataset.href });
  });

  // Right-click a cell for rows, columns and alignment.
  wrap.addEventListener("contextmenu", (e) => {
    const cell = e.target.closest(".md-cell");
    if (!cell || isReading(view.state)) return;
    e.preventDefault();
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    const rowItems = [
      { label: "Insert row above", run: () => edit(view, wrap, (m) => m.rows.splice(Math.max(1, r), 0, m.align.map(() => "")), { r: Math.max(1, r), c }) },
      { label: "Insert row below", run: () => edit(view, wrap, (m) => m.rows.splice(r + 1, 0, m.align.map(() => "")), { r: r + 1, c }) },
    ];
    if (r === 0) rowItems.shift(); // nothing can go above the heading row
    const alignTo = (a) => () => edit(view, wrap, (m) => {
      m.align[c] = a;
    }, { r, c });
    const items = [
      ...rowItems,
      { label: "Insert column left", run: () => edit(view, wrap, (m) => insertColumn(m, c), { r, c }) },
      { label: "Insert column right", run: () => edit(view, wrap, (m) => insertColumn(m, c + 1), { r, c: c + 1 }) },
      { label: "Align column left", checked: !cell.parentElement.dataset.align || cell.parentElement.dataset.align === "left", run: alignTo(null) },
      { label: "Align column centre", checked: cell.parentElement.dataset.align === "center", run: alignTo("center") },
      { label: "Align column right", checked: cell.parentElement.dataset.align === "right", run: alignTo("right") },
    ];
    if (r > 0) {
      items.push({ label: "Delete row", run: () => edit(view, wrap, (m) => m.rows.splice(r, 1), { r: Math.min(r, shape().rows - 2), c }) });
    }
    if (shape().cols > 1) {
      items.push({ label: "Delete column", run: () => edit(view, wrap, (m) => deleteColumn(m, c), { r, c: Math.max(0, c - 1) }) });
    }
    items.push({
      label: "Delete table",
      confirm: "Delete this table?",
      run: () => {
        const { from, to } = rangeOf(view, wrap);
        const end = Math.min(to + 1, view.state.doc.length);
        view.dispatch({ changes: { from, to: end }, selection: { anchor: from }, userEvent: "delete.table" });
        view.focus();
      },
    });
    openMenu(cell, items, { align: "start" });
  });
}

function insertColumn(model, at) {
  model.align.splice(at, 0, null);
  model.rows.forEach((row, r) => row.splice(at, 0, r === 0 ? `Column ${model.align.length}` : ""));
}

function deleteColumn(model, at) {
  model.align.splice(at, 1);
  model.rows.forEach((row) => row.splice(at, 1));
}

function wrapSelection(cell, mark) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const text = range.toString();
  // execCommand keeps the edit in the cell's own undo and fires "input".
  document.execCommand("insertText", false, mark + text + mark);
  if (!text) {
    const offset = sel.getRangeAt(0).startOffset - mark.length;
    placeCaret(cell, offset);
  }
}

// The extension ----------------------------------------------------------------------

function tableRanges(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const out = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "Table") return;
      const start = state.doc.lineAt(node.from);
      const end = state.doc.lineAt(node.to);
      // Only whole-line tables become grids; one inside a quote or list stays text.
      if (start.from === node.from && end.to === node.to) out.push({ from: node.from, to: node.to });
      return false;
    },
  });
  return out;
}

export function tables(env) {
  const build = (state) => {
    if (state.field(sourceMode) && !isReading(state)) return Decoration.none;
    const read = isReading(state);
    return Decoration.set(tableRanges(state).map(({ from, to }) =>
      Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to), env, read), block: true }).range(from, to)));
  };

  const field = StateField.define({
    create: build,
    update(deco, tr) {
      if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)
          || tr.effects.some((e) => e.is(setSourceMode) || e.is(setReading))) {
        return build(tr.state);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  // Arrow keys step into a table from the line above or below it.
  const enter = (dir) => (view) => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || state.field(sourceMode)) return false;
    const line = state.doc.lineAt(sel.head);
    const ranges = tableRanges(state);
    if (dir > 0) {
      const next = ranges.find((t) => t.from === line.to + 1);
      if (!next) return false;
      focusCell(view, next.from, 0, 0, true);
    } else {
      const prev = ranges.find((t) => t.to === line.from - 1);
      if (!prev) return false;
      const rows = state.sliceDoc(prev.from, prev.to).split("\n").length - 1;
      focusCell(view, prev.from, rows - 1, 0, true);
    }
    return true;
  };

  return [
    field,
    Prec.high(keymap.of([
      { key: "ArrowDown", run: enter(1) },
      { key: "ArrowUp", run: enter(-1) },
    ])),
  ];
}
