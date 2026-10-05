// Word-style formatting commands. Each one writes plain Markdown, so a note
// formatted from the toolbar is the same file you would get by typing.

import { startCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";

import { focusCell } from "./tables.js";

// Inline styles: the Markdown mark and the syntax node it produces.
export const INLINE = {
  bold: { mark: "**", node: "StrongEmphasis" },
  italic: { mark: "*", node: "Emphasis" },
  strike: { mark: "~~", node: "Strikethrough" },
  highlight: { mark: "==", node: "Highlight" },
  code: { mark: "`", node: "InlineCode" },
};

// Line prefixes, checked in this order (a task is also a bullet).
const PREFIX = {
  task: /^(\s*)[-*+][ \t]+\[[ xX]\][ \t]+/,
  bullet: /^(\s*)[-*+][ \t]+/,
  number: /^(\s*)\d{1,9}[.)][ \t]+/,
};
const QUOTE = /^(\s*)>[ \t]?/;
const HEADING = /^(#{1,6})(?:[ \t]+|$)/;

/**
 * The innermost `name` node around the selection. A cursor must sit strictly
 * inside it (at its edge it is outside, as in Word); a selection may cover it.
 */
function enclosing(state, from, to, name) {
  for (const side of [1, -1]) {
    for (let node = syntaxTree(state).resolveInner(from, side); node; node = node.parent) {
      if (node.name !== name) continue;
      const inside = from === to ? node.from < from && to < node.to : node.from <= from && to <= node.to;
      if (inside) return node;
    }
  }
  return null;
}

function listKind(text) {
  for (const [kind, re] of Object.entries(PREFIX)) if (re.test(text)) return kind;
  return null;
}

/** Lines touched by the selection, each once. */
function selectedLines(state) {
  const seen = new Map();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
      const line = state.doc.line(n);
      // A selection ending at the start of a line does not include that line.
      if (n > 1 && n === last && range.to === line.from && range.from !== range.to) continue;
      seen.set(n, line);
    }
  }
  return [...seen.values()];
}

/** Apply line changes, keeping cursors after any prefix inserted where they stood. */
function dispatchLines(view, changes) {
  const set = view.state.changes(changes);
  view.dispatch({
    changes: set,
    selection: view.state.selection.map(set, 1),
    userEvent: "input.format",
    scrollIntoView: true,
  });
  return true;
}

// Inline --------------------------------------------------------------------------

/**
 * Toggle bold, italic and the rest, the way Word does: with a selection it
 * wraps or unwraps the selection; with a cursor inside a word it formats the
 * word; elsewhere it opens a pair of marks to type into.
 */
export function toggleInline(kind) {
  const { mark, node: nodeName } = INLINE[kind];
  return (view) => {
    const { state } = view;
    if (kind === "code" && state.selection.ranges.some((r) => state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number)) {
      return toggleCodeBlock(view);
    }
    view.dispatch(state.changeByRange((range) => {
      const node = enclosing(state, range.from, range.to, nodeName);
      if (node) {
        const open = node.firstChild;
        const close = node.lastChild;
        const openLen = open.to - open.from;
        const closeLen = close.to - close.from;
        const map = (p) => (p <= open.from ? p : p <= open.to ? open.from : p <= close.from ? p - openLen
          : p <= close.to ? close.from - openLen : p - openLen - closeLen);
        return {
          changes: [{ from: open.from, to: open.to }, { from: close.from, to: close.to }],
          range: EditorSelection.range(map(range.anchor), map(range.head)),
        };
      }
      let { from, to } = range;
      if (from === to) {
        const word = state.wordAt(from);
        if (!word || word.from === from || word.to === from) {
          return { changes: { from, insert: mark + mark }, range: EditorSelection.cursor(from + mark.length) };
        }
        ({ from, to } = word);
      }
      // Marks must hug the text: "** word**" is not bold in Markdown.
      const text = state.sliceDoc(from, to);
      from += text.length - text.trimStart().length;
      to -= text.length - text.trimEnd().length;
      if (from >= to) return { range };
      const m = mark.length;
      return {
        changes: [{ from, insert: mark }, { from: to, insert: mark }],
        range: range.empty ? EditorSelection.cursor(range.head + m) : EditorSelection.range(from + m, to + m),
      };
    }), { userEvent: "input.format", scrollIntoView: true });
    return true;
  };
}

function toggleCodeBlock(view) {
  const lines = selectedLines(view.state);
  const first = lines[0];
  const last = lines[lines.length - 1];
  const isFenced = /^```/.test(first.text) && /^```\s*$/.test(last.text) && lines.length > 1;
  if (isFenced) {
    return dispatchLines(view, [
      { from: first.from, to: Math.min(first.to + 1, view.state.doc.length) },
      { from: Math.max(last.from - 1, 0), to: last.to },
    ]);
  }
  return dispatchLines(view, [{ from: first.from, insert: "```\n" }, { from: last.to, insert: "\n```" }]);
}

// Blocks ----------------------------------------------------------------------------

/** The line's list marker (with its indent) and heading marks, as one prefix. */
function blockPrefix(text) {
  const kind = listKind(text);
  const list = kind ? PREFIX[kind].exec(text)[0] : "";
  const heading = HEADING.exec(text.slice(list.length));
  return { kind, indent: kind ? PREFIX[kind].exec(text)[1] : "", length: list.length + (heading ? heading[0].length : 0) };
}

/**
 * Set the paragraph style of the selected lines: 0 for body text, 1-3 for
 * headings. As in Word, a heading replaces a list: Markdown cannot number one.
 */
export function setHeading(level) {
  return (view) => {
    const changes = selectedLines(view.state).map((line) => {
      const prefix = blockPrefix(line.text);
      const keep = level ? "" : (prefix.kind ? PREFIX[prefix.kind].exec(line.text)[0] : "");
      return { from: line.from, to: line.from + prefix.length, insert: level ? "#".repeat(level) + " " : keep };
    });
    return dispatchLines(view, changes);
  };
}

/** Toggle bulleted, numbered or checklist formatting on the selected lines. */
export function toggleList(kind) {
  return (view) => {
    const lines = selectedLines(view.state);
    const allOn = lines.every((line) => listKind(line.text) === kind);
    let n = 0;
    const changes = lines.map((line) => {
      // A list item replaces a heading, and any other kind of list.
      const prefix = blockPrefix(line.text);
      const indent = prefix.kind ? prefix.indent : /^[ \t]*/.exec(line.text)[0];
      const from = line.from;
      const to = line.from + Math.max(prefix.length, prefix.kind ? 0 : indent.length);
      if (allOn) return { from, to, insert: indent };
      n += 1;
      const marker = kind === "task" ? "- [ ] " : kind === "number" ? `${n}. ` : "- ";
      return { from, to, insert: indent + marker };
    });
    return dispatchLines(view, changes);
  };
}

export function toggleQuote(view) {
  const lines = selectedLines(view.state);
  const allOn = lines.every((line) => QUOTE.test(line.text));
  const changes = lines.map((line) => {
    const match = QUOTE.exec(line.text);
    if (allOn) return { from: line.from + match[1].length, to: line.from + match[0].length };
    return { from: line.from, insert: "> " };
  });
  return dispatchLines(view, changes);
}

// Inserts ---------------------------------------------------------------------------

/**
 * Insert a block (a table, say) below the current line, or on it if it is
 * empty, with a blank line on each side: without them Markdown reads the
 * block as part of the paragraph next to it. Returns where the block starts.
 * The cursor goes to its start, or with {after: true} to the line after it.
 */
export function insertBlock(view, block, { after: cursorAfter = false } = {}) {
  const { doc } = view.state;
  const line = doc.lineAt(view.state.selection.main.head);
  const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
  let from;
  let to;
  let before;
  let after;
  if (line.text.trim()) {
    // After a line with text: the line's own newline follows the insert.
    from = to = line.to;
    before = "\n\n";
    after = "\n";
  } else {
    const prev = line.number > 1 ? doc.line(line.number - 1) : null;
    from = line.from;
    to = line.to;
    before = prev && prev.text.trim() ? "\n" : "";
    after = next ? (next.text.trim() ? "\n" : "") : "\n";
  }
  const start = from + before.length;
  const end = Math.min(start + block.length + 1, view.state.doc.length - (to - from) + before.length + block.length + after.length);
  view.dispatch({
    changes: { from, to, insert: before + block + after },
    selection: { anchor: cursorAfter ? end : start },
    userEvent: "input",
    scrollIntoView: true,
  });
  return start;
}

/** Insert a three-column table and start typing in its first heading. */
export function insertTable(view) {
  const start = insertBlock(view, "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |");
  // In live preview the table is a grid: go straight to its first heading.
  focusCell(view, start, 0, 0, true);
  return true;
}

/** Insert a property table with its query showing, ready to edit. */
export function insertPropertyTable(view) {
  insertBlock(view, [
    "```notes",
    "filters:",
    "  and:",
    '    - file.inFolder("Projects")',
    "views:",
    "  - type: table",
    "    name: Projects",
    "    order:",
    "      - file.name",
    "      - status",
    "      - due",
    "```",
  ].join("\n"), { after: true }); // a table from the start, edited where it stands
  return true;
}

/** Start a link to a note: "[[" with the note list open. */
export function startNoteLink(view) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: "[[]]" },
    selection: { anchor: from + 2 },
    userEvent: "input.format",
  });
  startCompletion(view);
  return true;
}

/** The web link at the cursor, if any: {from, to, text, url}. */
export function linkAt(state) {
  const { from, to } = state.selection.main;
  const node = enclosing(state, from, to, "Link");
  if (!node) return null;
  const marks = node.getChildren("LinkMark");
  const url = node.getChild("URL");
  if (marks.length < 2 || !url) return null;
  return {
    from: node.from,
    to: node.to,
    text: state.sliceDoc(marks[0].to, marks[1].from),
    url: state.sliceDoc(url.from, url.to),
  };
}

/** Make the selection (or the link at the cursor) a web link to `url`. */
export function applyLink(view, url, target) {
  const { state } = view;
  const text = target?.text ?? state.sliceDoc(state.selection.main.from, state.selection.main.to);
  const from = target?.from ?? state.selection.main.from;
  const to = target?.to ?? state.selection.main.to;
  const insert = `[${text || url}](${url})`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.format",
  });
}

// Text colour and highlight colour --------------------------------------------------
// Both are HTML in the note, which any Markdown renderer shows:
//   <span style="color: var(--ink-red)">text</span>        coloured text
//   <mark style="background: var(--ink-blue)">text</mark>  a coloured highlight
// (the same form Obsidian's Highlightr writes). A plain ==highlight== is the
// grey one. Theme inks follow light and dark mode; a hex colour written by
// another tool is shown readably (ui/color.js).

const TAGGED = {
  color: {
    re: /<span style="color:\s*([^";]+?);?\s*">([^]*?)<\/span>/g,
    open: (color) => `<span style="color: ${color}">`,
    close: "</span>",
  },
  mark: {
    re: /<mark style="background(?:-color)?:\s*([^";]+?);?\s*">([^]*?)<\/mark>/g,
    open: (color) => `<mark style="background: ${color}">`,
    close: "</mark>",
  },
};

/** The coloured span (`kind` color or mark) holding [from, to] on one line: its tags, content and colour. */
function taggedAt(state, from, to, kind) {
  const line = state.doc.lineAt(from);
  if (to > line.to) return null;
  for (const m of line.text.matchAll(TAGGED[kind].re)) {
    const start = line.from + m.index;
    const contentFrom = start + m[0].indexOf(">") + 1;
    const contentTo = contentFrom + m[2].length;
    if (contentFrom <= from && to <= contentTo) {
      return { start, end: start + m[0].length, contentFrom, contentTo, color: m[1].trim() };
    }
  }
  return null;
}

/**
 * Colour the selection, or the word at the cursor, with `color` (null removes
 * it). Text already in such a span is recoloured, not nested.
 */
function setTagged(kind, color) {
  const { open, close } = TAGGED[kind];
  return (view) => {
    const { state } = view;
    view.dispatch(state.changeByRange((range) => {
      const span = taggedAt(state, range.from, range.to, kind);
      if (span) {
        const oldOpen = span.contentFrom - span.start;
        if (!color) {
          const shift = (p) => (p <= span.contentFrom ? span.start : p <= span.contentTo ? p - oldOpen : span.start + (span.contentTo - span.contentFrom));
          return {
            changes: [{ from: span.start, to: span.contentFrom }, { from: span.contentTo, to: span.end }],
            range: EditorSelection.range(shift(range.anchor), shift(range.head)),
          };
        }
        const tag = open(color);
        const delta = tag.length - oldOpen;
        return {
          changes: { from: span.start, to: span.contentFrom, insert: tag },
          range: EditorSelection.range(range.anchor + delta, range.head + delta),
        };
      }
      if (!color) return { range };
      let { from, to } = range;
      if (from === to) {
        const word = state.wordAt(from);
        if (!word) {
          const tag = open(color);
          return { changes: { from, insert: tag + close }, range: EditorSelection.cursor(from + tag.length) };
        }
        ({ from, to } = word);
      }
      // Hug the text, like ** marks: a wash over a stray space looks like a mistake.
      const text = state.sliceDoc(from, to);
      from += text.length - text.trimStart().length;
      to -= text.length - text.trimEnd().length;
      if (from >= to) return { range };
      // One span per line: an inline tag cannot cross a paragraph break.
      const changes = [];
      const tag = open(color);
      for (let pos = from; pos <= to;) {
        const line = state.doc.lineAt(pos);
        const a = Math.max(from, line.from);
        const b = Math.min(to, line.to);
        if (b > a) changes.push({ from: a, insert: tag }, { from: b, insert: close });
        pos = line.to + 1;
      }
      const set = state.changes(changes);
      return {
        changes: set,
        // The selection keeps to the coloured text (trimmed), inside the tags.
        range: range.empty
          ? EditorSelection.cursor(set.mapPos(range.head, 1))
          : range.anchor <= range.head
            ? EditorSelection.range(set.mapPos(from, 1), set.mapPos(to, -1))
            : EditorSelection.range(set.mapPos(to, -1), set.mapPos(from, 1)),
      };
    }), { userEvent: "input.format", scrollIntoView: true });
    return true;
  };
}

/** Colour the selection's text (null: back to the default colour). */
export function setColor(color) {
  return setTagged("color", color);
}

/** The plain, grey highlight: ==text==. */
export const PLAIN_HIGHLIGHT = "plain";

/**
 * Highlight the selection (or the highlight or word at the cursor):
 * PLAIN_HIGHLIGHT for ==text==, a colour for a coloured <mark>, or null for
 * none. A highlight that is already there changes in place: its marks are
 * swapped, so it keeps its extent.
 */
export function setHighlight(color) {
  return (view) => {
    const { state } = view;
    const { from, to } = state.selection.main;
    const marked = taggedAt(state, from, to, "mark");
    const plain = enclosing(state, from, to, INLINE.highlight.node);
    if (color === PLAIN_HIGHLIGHT) {
      if (plain) return true;
      if (marked) return swapTags(view, marked, "==", "==");
      return toggleInline("highlight")(view);
    }
    if (plain && !marked) {
      if (!color) return toggleInline("highlight")(view);
      const open = plain.firstChild;
      const close = plain.lastChild;
      const span = { start: open.from, contentFrom: open.to, contentTo: close.from, end: close.to };
      return swapTags(view, span, TAGGED.mark.open(color), TAGGED.mark.close);
    }
    return setTagged("mark", color)(view);
  };
}

/** Replace a span's opening and closing marks, keeping its content and the selection on it. */
function swapTags(view, span, open, close) {
  const changes = view.state.changes([
    { from: span.start, to: span.contentFrom, insert: open },
    { from: span.contentTo, to: span.end, insert: close },
  ]);
  view.dispatch({ changes, selection: view.state.selection.map(changes), userEvent: "input.format", scrollIntoView: true });
  return true;
}

// State for the toolbar ----------------------------------------------------------

/** What formatting applies at the main cursor, for the toolbar's pressed states. */
export function formatState(state) {
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(state.selection.main.head);
  const heading = HEADING.exec(line.text);
  const out = {
    heading: heading ? heading[1].length : 0,
    list: listKind(line.text),
    quote: QUOTE.test(line.text),
    link: !!enclosing(state, from, to, "Link"),
  };
  for (const [kind, { node }] of Object.entries(INLINE)) out[kind] = !!enclosing(state, from, to, node);
  out.color = taggedAt(state, from, to, "color")?.color ?? null;
  out.mark = taggedAt(state, from, to, "mark")?.color ?? (out.highlight ? PLAIN_HIGHLIGHT : null);
  return out;
}
