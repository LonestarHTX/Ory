// Live preview: Markdown syntax marks are hidden unless the cursor is in the
// element they belong to, so the note reads as formatted text while staying a
// plain text file. Source mode (Mod-E) turns the hiding off.
//
// Wikilinks are styled in both modes: resolved links underlined, links to
// missing notes dashed. Clicking a rendered link opens it; Mod-click always does.

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Annotation, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType } from "@codemirror/view";

import { fileName, isImage, isPage, parseLink } from "../links.js";
import { hidesMarks } from "../prefs.js";
import { inkPaint, markPaint } from "../ui/color.js";
import { h, icon } from "../ui/dom.js";
import { openFile } from "../actions.js";
import { openMenu } from "../ui/menu.js";
import { pageFrame, reloadFrame } from "../ui/page-view.js";
import { animate, createHandle, createSizePill, onDrag, readSize, sizeSpring } from "../ui/resize.js";

/** Marks a change Ory makes for you (adding a source, sizing a page), allowed even while reading. */
export const byOry = Annotation.define();

export const setSourceMode = StateEffect.define();
/** Fired when the vault index changes, so link styles re-resolve. */
export const indexChanged = StateEffect.define();

export const sourceMode = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSourceMode)) value = e.value;
    return value;
  },
});

/**
 * Reading: a wiki page shown as a finished page. Nothing is editable, every
 * mark stays hidden and the properties give way to the page's header.
 */
export const setReading = StateEffect.define();

export const reading = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setReading)) value = e.value;
    return value;
  },
});

export const isReading = (state) => state.field(reading, false) ?? false;

/**
 * Quiet: a note just opened shows no marks at the cursor, so it doesn't open
 * with "# " on its title. The first move, click or keystroke ends it.
 */
export const setQuiet = StateEffect.define();

export const quiet = StateField.define({
  create: () => true,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setQuiet)) return e.value;
    if (value && (tr.docChanged || tr.isUserEvent("select") || tr.isUserEvent("input") || tr.isUserEvent("delete"))) return false;
    return value;
  },
});

/** Whether the selection touches [from, to]. Nothing is touched while unfocused, reading or quiet. */
export function touches(view, from, to) {
  if (!view.hasFocus || isReading(view.state) || view.state.field(quiet, false)) return false;
  return view.state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

// Widgets ---------------------------------------------------------------------

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-bullet";
    el.textContent = "•";
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(checked, pos, disabled) {
    super();
    this.checked = checked;
    this.pos = pos;
    this.disabled = disabled;
  }
  eq(other) {
    return other.checked === this.checked && other.pos === this.pos && other.disabled === this.disabled;
  }
  toDOM(view) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-md-task";
    box.checked = this.checked;
    box.disabled = this.disabled;
    box.setAttribute("aria-label", this.checked ? "Mark as not done" : "Mark as done");
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      // The marker is "[ ]" or "[x]"; flip the middle character.
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-rule";
    return el;
  }
}

/** The URL an attachment is served at. */
export function fileUrl(path) {
  return "/files/" + path.split("/").map(encodeURIComponent).join("/");
}

/**
 * A picture embedded in a note. Click it to select it: a handle on each right
 * corner and on the right side (pictures sit at the left of the column, so the
 * left edge never moves), and its size on the bottom edge. Drag a handle, or
 * type a width (click the size, or just start typing; "50%" is half the
 * column) and press Enter; Fit goes back to its own size. The width is written
 * into the link (|320). Nothing reloads as it changes.
 */
class ImageWidget extends WidgetType {
  constructor(src, width, alt) {
    super();
    this.src = src;
    this.width = width;
    this.alt = alt;
  }
  eq(other) {
    return other.src === this.src && other.width === this.width;
  }
  updateDOM(dom) {
    if (!dom.oryImage || dom.oryImage.src !== this.src) return false;
    dom.oryImage.set(this.width);
    return true;
  }
  toDOM(view) {
    const img = h("img", { class: "cm-embed-image", src: this.src, alt: this.alt, loading: "lazy", draggable: "false" });
    const box = h("span", { class: "cm-embed-image-box", tabindex: "-1" }, img);
    img.addEventListener("error", () => img.classList.add("is-broken"));
    const column = () => box.parentElement?.clientWidth || view.contentDOM.clientWidth;
    const W = sizeSpring(0);
    let stop = null;

    const size = createSizePill({
      label: "Width",
      fitFirst: true,
      commit: (text) => {
        const v = readSize(text, column());
        if (v == null) return;
        const px = Math.round(Math.min(column(), Math.max(24, v)));
        glide(px);
        setEmbedAlias(view, box, String(px));
      },
      fit: () => {
        glide(Math.min(img.naturalWidth || column(), column()), true);
        setEmbedAlias(view, box, null);
      },
    });
    const label = () => {
      const w = Math.round(img.offsetWidth), ht = Math.round(img.offsetHeight);
      size.show(`${w} × ${ht}`, String(w));
    };
    const setWidth = (px) => {
      img.style.width = px == null ? "" : `${Math.round(px)}px`;
      label();
      view.requestMeasure();
    };
    // A typed width settles on the spring; `free` lets go of the width at the end (its own size).
    const glide = (to, free = false) => {
      stop?.();
      W.snap(img.offsetWidth);
      W.target = to;
      stop = animate((dt) => {
        W.step(dt);
        setWidth(W.x);
        if (!W.settled) return true;
        setWidth(free ? null : W.target);
        stop = null;
        return false;
      });
    };

    // The handles: each square turns into the arrow you drag it with.
    for (const [where, deg] of [["ne", 45], ["e", 90], ["se", -45]]) {
      const handle = createHandle("square", deg);
      const spot = h("span", { class: `cm-embed-image-handle cm-embed-image-handle--${where}` }, handle.el);
      let startW = 0, dragging = false;
      spot.addEventListener("pointerenter", () => handle.take(true));
      spot.addEventListener("pointerleave", () => { if (!dragging) handle.take(false); });
      onDrag(spot, {
        start: () => {
          stop?.();
          dragging = true;
          startW = img.offsetWidth;
          box.classList.add("is-resizing");
        },
        move: (dx) => setWidth(Math.min(column(), Math.max(24, startW + dx))),
        end: (dx) => {
          dragging = false;
          box.classList.remove("is-resizing");
          if (!spot.matches(":hover")) handle.take(false);
          if (Math.abs(dx) >= 2) setEmbedAlias(view, box, String(Math.round(img.offsetWidth)));
        },
      });
      box.append(spot);
    }
    box.append(size.el);

    // Selecting: a click on the picture; a click anywhere else lets it go.
    const away = (e) => { if (!box.contains(e.target)) select(false); };
    const select = (on) => {
      box.classList.toggle("is-selected", on);
      if (on) {
        label();
        box.focus({ preventScroll: true });
        document.addEventListener("pointerdown", away, true);
      } else {
        size.close();
        document.removeEventListener("pointerdown", away, true);
      }
    };
    img.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      select(true);
    });
    // Selected, it takes a width as you type it; Esc lets go of it.
    box.addEventListener("keydown", (e) => {
      if (e.target !== box) return;
      if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        size.open(e.key, false);
      } else if (e.key === "Escape") {
        e.preventDefault();
        select(false);
        view.focus();
      }
    });
    img.addEventListener("load", label);

    box.oryImage = {
      src: this.src,
      set(width) {
        if (stop) return; // settling on the spring already
        setWidth(width);
      },
    };
    box.oryImage.set(this.width);
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class FileWidget extends WidgetType {
  constructor(path, size) {
    super();
    this.path = path;
    this.size = size;
  }
  eq(other) {
    return other.path === this.path && other.size === this.size;
  }
  toDOM() {
    const link = document.createElement("a");
    link.className = "cm-embed-file";
    link.href = fileUrl(this.path);
    link.target = "_blank";
    link.rel = "noopener";
    link.title = `Open ${fileName(this.path)}`;
    const name = document.createElement("span");
    name.textContent = fileName(this.path);
    link.append(icon("file", 16), name);
    if (this.size != null) {
      const size = document.createElement("span");
      size.className = "cm-embed-size";
      size.textContent = formatSize(this.size);
      link.append(size);
    }
    return link;
  }
  ignoreEvent() {
    return true;
  }
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** An embed's "|300" or "|300x200" sets the image width. */
function embedWidth(alias) {
  const match = /^\s*(\d{1,4})(?:x\d{1,4})?\s*$/.exec(alias ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * A page embed's "|640", "|wide" or "|wide 640": a height of your own (which
 * wins over the page's), and whether it runs the card's width.
 */
export function pageAlias(alias) {
  let height = null, wide = false;
  for (const word of (alias ?? "").trim().split(/[\s,]+/)) {
    const size = /^(\d{1,4})(?:x\d{1,4})?$/.exec(word);
    if (size) height = Number(size[1]);
    else if (word.toLowerCase() === "wide") wide = true;
  }
  return { height, wide };
}

const PAGE_HEIGHT = 480; // a page that says nothing about its height
const PAGE_MIN = 120, PAGE_MAX = 2000;
const clampHeight = (px) => Math.round(Math.min(PAGE_MAX, Math.max(PAGE_MIN, px)));

/**
 * Rewrite the alias of the embed whose widget is `dom` (![[file|alias]]); null
 * takes it away. Ory makes the change for you, so it also works while reading.
 */
function setEmbedAlias(view, dom, alias) {
  let pos;
  try {
    pos = view.posAtDOM(dom);
  } catch {
    return;
  }
  const line = view.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const start = before.lastIndexOf("![[");
  if (start === -1 || !before.endsWith("]]")) return;
  const inner = before.slice(start + 3, -2);
  const pipe = inner.indexOf("|");
  const ref = pipe === -1 ? inner : inner.slice(0, pipe);
  const from = line.from + start + 3, to = pos - 2;
  const insert = alias ? `${ref}|${alias}` : ref;
  if (view.state.sliceDoc(from, to) === insert) return;
  view.dispatch({ changes: { from, to, insert }, annotations: byOry.of(true) });
}

/** A page embed's alias: ![[Page.html|wide 640]]. */
const setPageAlias = (view, dom, { height, wide }) =>
  setEmbedAlias(view, dom, [wide ? "wide" : "", height ? String(height) : ""].filter(Boolean).join(" ") || null);

/**
 * An HTML page embedded in a note: a titled frame, sandboxed (see
 * ui/page-view.js). Its height is the note's (|640) if it gives one, else what
 * the page says it needs ({type: "ory:size", height}), else 480px. Over the
 * page its height waits on the bottom edge: click it (or Set height... in the
 * menu) to type one, or drag the edge, where a bar comes to the pointer and
 * turns into the arrow you drag with. Fit, or a double-click on the edge, gives
 * the height back to the page. Wide (|wide) lets it run the card's width while
 * the text keeps its column.
 * Changing the height or width keeps the page as it is; nothing reloads.
 */
class PageEmbedWidget extends WidgetType {
  constructor(path, fragment, height, wide, openPage) {
    super();
    this.path = path;
    this.fragment = fragment;
    this.height = height;
    this.wide = wide;
    this.openPage = openPage;
  }
  eq(other) {
    return other.path === this.path && other.fragment === this.fragment && other.height === this.height && other.wide === this.wide;
  }
  updateDOM(dom) {
    if (!dom.oryPage || dom.oryPage.path !== this.path || dom.oryPage.fragment !== this.fragment) return false;
    dom.oryPage.set(this.height, this.wide);
    return true;
  }
  toDOM(view) {
    const name = fileName(this.path).replace(/\.html?$/i, "");
    const state = { own: this.height, wide: this.wide, told: null };
    const wrap = h("div", { class: "cm-embed-page" });
    const frameOf = () => wrap.querySelector("iframe");
    const write = (change) => setPageAlias(view, wrap, { height: state.own, wide: state.wide, ...change });
    const H = sizeSpring(0);
    let stop = null;
    const setHeight = (px) => {
      frameOf().style.height = `${Math.round(px)}px`;
      size.show(String(Math.round(px)));
      view.requestMeasure();
    };
    // A typed height settles on the spring; anything else is set at once.
    const glide = (to) => {
      stop?.();
      H.snap(frameOf().offsetHeight || to);
      H.target = to;
      stop = animate((dt) => {
        H.step(dt);
        setHeight(H.x);
        if (!H.settled) return true;
        setHeight(H.target);
        stop = null;
        return false;
      });
    };
    const fit = () => {
      const to = clampHeight(state.own ?? state.told ?? PAGE_HEIGHT);
      if (stop) H.target = to;
      else setHeight(to);
    };
    const own = (height) => {
      state.own = height;
      glide(clampHeight(height ?? state.told ?? PAGE_HEIGHT));
      write({ height });
    };
    const size = createSizePill({
      label: "Height",
      commit: (text) => {
        const v = readSize(text);
        if (v != null) own(clampHeight(v));
      },
      fit: () => own(null),
    });

    const wideBtn = h("button", {
      class: "cm-embed-page-wide", type: "button", "aria-pressed": "false",
      dataset: { tip: "Run the card's width" },
      onClick: () => write({ wide: !state.wide }),
    }, "Wide");
    const more = h("button", {
      class: "iconbtn iconbtn--small", type: "button", "aria-label": "Page actions", "aria-haspopup": "menu",
      dataset: { tip: "Page actions" },
      onClick: () => openMenu(more, [
        { label: "Reload", run: () => reloadFrame(frameOf()) },
        { label: "Open in new tab", run: () => openFile(this.path) },
        { label: "Set height…", run: () => size.open(String(Math.round(frameOf().offsetHeight))) },
        ...(state.own ? [{ label: "Use the page's own height", run: () => own(null) }] : []),
      ]),
    }, icon("more", 16));
    const head = h("div", { class: "cm-embed-page-head" },
      h("span", { class: "cm-embed-page-title" }, icon("page", 14), name),
      h("span", { class: "cm-embed-page-actions" },
        wideBtn,
        h("button", {
          class: "iconbtn iconbtn--small", type: "button", "aria-label": `Open ${name}`,
          dataset: { tip: "Open across the main area" },
          onClick: () => this.openPage(this.path),
        }, icon("arrowRight", 16)),
        more));

    // The bottom edge: a bar comes to the pointer and turns into the arrow you
    // drag with; the height sits beside it. A double-click gives the height back.
    const handle = createHandle("bar");
    const edge = h("div", { class: "cm-embed-page-edge" });
    let placed = false, dragging = false;
    const place = (x) => {
      placed = true;
      handle.el.style.left = `${x}px`;
      if (!size.editing) size.el.style.left = `${x + 28}px`;
    };
    wrap.addEventListener("pointerenter", () => { if (!placed) place(wrap.clientWidth / 2); });
    edge.addEventListener("pointerenter", () => {
      wrap.classList.add("on-edge");
      handle.take(true);
    });
    edge.addEventListener("pointermove", (e) => {
      if (!dragging) place(Math.max(24, Math.min(wrap.clientWidth - 72, e.clientX - wrap.getBoundingClientRect().left)));
    });
    edge.addEventListener("pointerleave", () => {
      if (dragging) return;
      wrap.classList.remove("on-edge");
      handle.take(false);
    });
    let startH = 0;
    onDrag(edge, {
      start: () => {
        stop?.();
        stop = null;
        dragging = true;
        startH = frameOf().offsetHeight;
        wrap.classList.add("is-resizing");
      },
      move: (dx, dy) => setHeight(clampHeight(startH + dy)),
      end: (dx, dy) => {
        dragging = false;
        wrap.classList.remove("is-resizing");
        if (!edge.matches(":hover")) {
          wrap.classList.remove("on-edge");
          handle.take(false);
        }
        if (Math.abs(dy) >= 2) {
          state.own = frameOf().offsetHeight;
          write({ height: state.own });
        }
      },
    });
    edge.addEventListener("dblclick", () => { if (state.own != null) own(null); });

    // The page says how tall it is at the width it's given (see ui/page-view.js).
    wrap.addEventListener("ory:page-size", (e) => {
      state.told = e.detail;
      if (state.own == null) fit();
    });

    wrap.append(head, pageFrame(this.path, name, this.fragment), edge, handle.el, size.el);
    wrap.oryPage = {
      path: this.path,
      fragment: this.fragment,
      set(height, wide) {
        state.own = height;
        state.wide = wide;
        wrap.classList.toggle("is-wide", wide);
        wideBtn.setAttribute("aria-pressed", String(wide));
        wideBtn.classList.toggle("is-on", wide);
        fit();
      },
    };
    wrap.oryPage.set(this.height, this.wide);
    return wrap;
  }
  get estimatedHeight() {
    return (this.height ?? PAGE_HEIGHT) + 33;
  }
  ignoreEvent() {
    return true;
  }
  ignoreMutation() {
    return true; // the frame may be swapped for a fresh one when the theme changes
  }
}

/** A code block's language, in place of its opening fence while you're not in it. */
class LanguageWidget extends WidgetType {
  constructor(lang) {
    super();
    this.lang = lang;
  }
  eq(other) {
    return other.lang === this.lang;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-code-lang";
    el.textContent = this.lang;
    return el;
  }
}

const hide = Decoration.replace({});

/** A heading's or quote's mark at the start of a line, as text. */
const LINE_PREFIX = /^(#{1,6}[ \t]+|>[ \t]?)/;

/** Hidden marks are on: live preview, not reading, and Settings keeps them hidden at the cursor. */
const concealing = (state) => !state.field(sourceMode, false) && !isReading(state) && hidesMarks();

/**
 * Where the cursor is just after a heading's or quote's hidden mark: {line, end},
 * or null. Only a real heading or quote (not "# " inside a code block).
 */
function prefixEnd(state) {
  const sel = state.selection;
  if (sel.ranges.length > 1 || !sel.main.empty || !concealing(state)) return null;
  const line = state.doc.lineAt(sel.main.head);
  const m = LINE_PREFIX.exec(line.text);
  if (!m || sel.main.head !== line.from + m[0].length) return null;
  const node = syntaxTree(state).resolveInner(line.from, 1);
  if (node.name !== "HeaderMark" && node.name !== "QuoteMark") return null;
  return { line, end: line.from + m[0].length };
}

// While marks stay hidden, the cursor never sits before a heading's or quote's
// mark (typing there would break it): it goes just after the mark, or, moving
// left from there, to the end of the line above.
const prefixSnap = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.selection.ranges.length > 1 || !tr.selection.main.empty) return tr;
  const state = tr.state;
  if (!concealing(state)) return tr;
  const head = tr.selection.main.head;
  const line = state.doc.lineAt(head);
  if (head !== line.from) return tr;
  const m = LINE_PREFIX.exec(line.text);
  if (!m) return tr;
  const node = syntaxTree(state).resolveInner(line.from, 1);
  if (node.name !== "HeaderMark" && node.name !== "QuoteMark") return tr;
  const end = line.from + m[0].length;
  const was = tr.startState.selection.main;
  const leftward = !tr.docChanged && was.empty && was.head === end && line.number > 1;
  return [tr, { selection: { anchor: leftward ? line.from - 1 : end }, sequential: true }];
});

/** A heading, quote or task's mark at the start of its line ("## ", "> ", "- [ ] "). */
const BLOCK_PREFIX = /^(#{1,6}\s|>\s?|\s*([-*+]|\d+[.)])\s+\[[ xX]\]\s?)$/;
/** Inline marks that open and close alike: **bold**, *italic*, ~~struck~~, ==marked==, `code`. */
const INLINE_MARKS = new Set(["**", "__", "*", "_", "~~", "==", "`"]);

class SeparatorWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.textContent = " › ";
    return el;
  }
}
const headingSeparator = Decoration.replace({ widget: new SeparatorWidget() });

// Coloured text, <span style="color: ...">, and coloured highlights,
// <mark style="background: ...">. Only a theme ink or a hex/rgb colour is
// applied: text readably (ui/color.js), a highlight as a wash of its colour.
const COLOR_OPEN = /^<span style="color:\s*([^";]+?);?\s*">$/;
const MARK_OPEN = /^<mark style="background(?:-color)?:\s*([^";]+?);?\s*">$/;
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const line = (cls) => Decoration.line({ class: cls });

// Building decorations ----------------------------------------------------------

function build(view, { resolve, fileSize, openPage }) {
  const { state } = view;
  const read = isReading(state);
  const live = read || !state.field(sourceMode);
  const doc = state.doc;
  const out = [];
  const atomic = [];
  // A page's own "# Title" line repeats the title in its header, so reading hides it.
  if (read) {
    const first = firstBodyLine(doc);
    if (first && /^#\s/.test(first.text)) out.push(Decoration.line({ class: "cm-reading-hidden" }).range(first.from));
  }
  // Marks need a non-empty range; line and widget decorations are points.
  // A plugin may not replace a line break (a link's title can sit on the next
  // line), so such ranges are left visible.
  const add = (from, to, deco) => {
    if (deco.point && from < to && doc.lineAt(from).to < to) return;
    if (from < to || deco.point) out.push(deco.range(from, to));
  };
  // Formatting marks (**, #, >, [[ ]], list and task marks) are hidden. By
  // default they stay hidden at the cursor too, so a note reads like a
  // document, and each becomes one step for the cursor (atomic). Settings can
  // show them where you're typing instead. Code fences show while you're in
  // the block either way, and Cmd+E shows all the Markdown.
  const concealAll = live && !read && hidesMarks();
  const near = (from, to) => !concealAll && touches(view, from, to);
  const conceal = (from, to) => {
    if (from >= to || doc.lineAt(from).to < to) return;
    out.push(hide.range(from, to));
    if (concealAll) atomic.push(hide.range(from, to));
  };
  const lineTouched = (pos) => {
    const l = doc.lineAt(pos);
    return near(l.from, l.to);
  };
  // Only the part on screen: a long block (or an unclosed fence) mustn't cost every line.
  let visible = { from: 0, to: doc.length };
  const eachLine = (from, to, fn) => {
    from = Math.max(from, visible.from);
    to = Math.min(to, visible.to);
    for (let pos = from; pos <= to;) {
      const l = doc.lineAt(pos);
      fn(l);
      pos = l.to + 1;
    }
  };

  for (const range of view.visibleRanges) {
    visible = range;
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(ref) {
        const node = ref.node;
        switch (ref.name) {
          case "WikiLink": {
            const target = node.getChild("WikiLinkTarget");
            const alias = node.getChild("WikiLinkAlias");
            if (!target) return false;
            const inner = doc.sliceString(target.from, (alias ?? target).to);
            const { target: name, alias: aliasText, heading } = parseLink(inner);
            const resolved = resolve(name);
            const missing = !resolved;
            const shown = alias ?? target;
            const active = near(node.from, node.to);
            // ![[file]] shows the image, the page or a file chip, always drawn
            // just after the embed so it is never rebuilt (a page would reload)
            // as the cursor comes and goes. Away from the cursor the Markdown
            // itself is hidden; at the cursor it shows above the embed.
            if (live && doc.sliceString(node.from, node.from + 1) === "!" && resolved && !/\.md$/i.test(resolved)) {
              const size = embedWidth(aliasText);
              const page = isPage(resolved) && pageAlias(aliasText);
              const widget = page
                ? new PageEmbedWidget(resolved, heading, page.height, page.wide, openPage)
                : isImage(resolved)
                  ? new ImageWidget(fileUrl(resolved), size, name)
                  : new FileWidget(resolved, fileSize(resolved));
              add(node.to, node.to, Decoration.widget({ widget, side: 1 }));
              if (!active) {
                conceal(node.from, node.to);
                return false;
              }
            }
            const cls = `cm-wikilink${missing ? " cm-wikilink-missing" : ""}${live && !active ? " cm-link-live" : ""}`;
            add(shown.from, shown.to, Decoration.mark({
              class: cls,
              attributes: { "data-wikilink": inner, "data-tip": missing ? `Create note "${name}"` : `Open ${name}` },
            }));
            if (live && !active) {
              conceal(node.from, shown.from);
              conceal(shown.to, node.to);
              // [[Note#Heading]] reads as "Note › Heading".
              const hash = alias ? -1 : inner.indexOf("#");
              if (hash > 0) add(target.from + hash, target.from + hash + 1, headingSeparator);
            }
            return false;
          }
          case "Link": {
            const marks = node.getChildren("LinkMark");
            const url = node.getChild("URL");
            if (marks.length < 2 || !url) return false;
            const active = near(node.from, node.to);
            add(marks[0].to, marks[1].from, Decoration.mark({
              class: `cm-md-link${live && !active ? " cm-link-live" : ""}`,
              attributes: { "data-href": doc.sliceString(url.from, url.to), "data-tip": doc.sliceString(url.from, url.to) },
            }));
            if (live && !active) {
              conceal(marks[0].from, marks[0].to);
              conceal(marks[1].from, node.to);
            }
            return false;
          }
          case "URL": {
            // A bare URL (GFM autolink) outside a Markdown link.
            add(node.from, node.to, Decoration.mark({
              class: `cm-md-link${live ? " cm-link-live" : ""}`,
              attributes: { "data-href": doc.sliceString(node.from, node.to) },
            }));
            return false;
          }
          case "HTMLTag": {
            const tag = doc.sliceString(node.from, node.to);
            let deco = null;
            let closing = "</span>";
            const color = COLOR_OPEN.exec(tag);
            const marked = !color && MARK_OPEN.exec(tag);
            if (color) {
              const paint = inkPaint(color[1]);
              if (paint) deco = Decoration.mark({ class: paint.className, attributes: { style: paint.style } });
            } else if (marked) {
              const wash = markPaint(marked[1]);
              if (wash) deco = Decoration.mark({ class: "cm-mark", attributes: { style: `--mark: ${wash}` } });
              closing = "</mark>";
            }
            if (!deco) return;
            let close = node.nextSibling;
            while (close && !(close.name === "HTMLTag" && doc.sliceString(close.from, close.to) === closing)) {
              close = close.nextSibling;
            }
            if (!close) return;
            add(node.to, close.from, deco);
            // Unlike ** marks, colour tags stay hidden at the cursor too: they
            // are long HTML, and the colour itself shows what they do. The
            // cursor steps over each tag as one unit (see atomic below).
            if (live) {
              add(node.from, node.to, hide);
              add(close.from, close.to, hide);
              atomic.push(hide.range(node.from, node.to), hide.range(close.from, close.to));
            }
            return;
          }
          case "Image": {
            // ![alt](path) and ![alt](https://...) images.
            const url = node.getChild("URL");
            if (!live || !url) return false;
            const href = doc.sliceString(url.from, url.to);
            let src = null;
            if (/^https?:/i.test(href)) src = href;
            else {
              let path = null;
              try {
                path = resolve(decodeURI(href));
              } catch {
                path = null;
              }
              if (path && isImage(path)) src = fileUrl(path);
            }
            if (!src) return false;
            const marks = node.getChildren("LinkMark");
            const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
            const widget = new ImageWidget(src, null, alt);
            if (near(node.from, node.to)) add(node.to, node.to, Decoration.widget({ widget, side: 1 }));
            else {
              add(node.from, node.to, Decoration.replace({ widget }));
              if (concealAll && doc.lineAt(node.from).to >= node.to) atomic.push(hide.range(node.from, node.to));
            }
            return false;
          }
          case "FencedCode": {
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            // Away from the block, its ``` fences give way: the opening one to
            // the language, if any, the closing one to a sliver of padding.
            // The whole lines: the cursor in a fence's indent, list or quote mark counts too.
            const quietFences = live && !touches(view, doc.lineAt(node.from).from, doc.lineAt(node.to).to);
            const marks = node.getChildren("CodeMark");
            const info = node.getChild("CodeInfo");
            const closes = marks.length > 1 && last !== first && doc.lineAt(marks[marks.length - 1].from).number === last;
            eachLine(node.from, node.to, (l) => {
              let cls = "cm-md-codeblock";
              if (l.number === first) cls += " cm-md-codeblock-first";
              if (l.number === last) cls += " cm-md-codeblock-last";
              if (quietFences && ((l.number === first && !info) || (l.number === last && closes))) cls += " cm-md-fence";
              if (quietFences && l.number === first && info) cls += " cm-md-fence-label";
              add(l.from, l.from, line(cls));
            });
            if (quietFences) {
              const open = doc.lineAt(node.from);
              if (info) add(open.from, open.to, Decoration.replace({ widget: new LanguageWidget(doc.sliceString(info.from, info.to)) }));
              else if (open.from < open.to) add(open.from, open.to, hide);
              if (closes) {
                const close = doc.lineAt(node.to);
                if (close.from < close.to) add(close.from, close.to, hide);
              }
            }
            return false;
          }
          case "Table":
            // Monospace keeps the pipes of a Markdown table in columns.
            eachLine(node.from, node.to, (l) => add(l.from, l.from, line("cm-md-table")));
            return false;
          case "Blockquote":
            eachLine(node.from, node.to, (l) => add(l.from, l.from, line("cm-md-quote")));
            return;
          case "QuoteMark":
            if (live && !lineTouched(node.from)) conceal(node.from, spaceAfter(doc, node.to));
            return;
          case "HeaderMark":
            if (live && node.parent?.name.startsWith("ATXHeading") && !lineTouched(node.from)) {
              // Hide the opening "## " (and a closing "##", if present).
              const isOpening = node.from === node.parent.from;
              conceal(isOpening ? node.from : node.from - 1, isOpening ? spaceAfter(doc, node.to) : node.to);
            }
            return;
          case "EmphasisMark":
          case "CodeMark":
          case "StrikethroughMark":
          case "HighlightMark":
            if (live && node.parent && node.parent.name !== "FencedCode" && !near(node.parent.from, node.parent.to)) {
              conceal(node.from, node.to);
            }
            return;
          case "HorizontalRule":
            if (live && !lineTouched(node.from)) add(node.from, node.to, rule);
            return false;
          case "ListMark": {
            if (!live) return;
            const item = node.parent;
            const task = item?.getChild("Task");
            const markEnd = spaceAfter(doc, node.to);
            if (task) {
              const marker = task.getChild("TaskMarker");
              if (marker && !near(node.from, marker.to)) {
                conceal(node.from, markEnd);
                const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
                add(marker.from, marker.to, Decoration.replace({ widget: new CheckboxWidget(checked, marker.from, read) }));
              }
            } else if (item?.parent?.name === "BulletList" && !near(node.from, node.to)) {
              add(node.from, node.to, bullet);
            }
            return;
          }
        }
      },
    });
  }
  return { decorations: Decoration.set(out, true), atomic: Decoration.set(atomic, true) };
}

/** The first non-blank line after any frontmatter. */
function firstBodyLine(doc) {
  let n = 1;
  if (doc.lines > 1 && doc.line(1).text === "---") {
    for (let i = 2; i <= Math.min(doc.lines, 500); i++) {
      if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) {
        n = i + 1;
        break;
      }
    }
  }
  for (; n <= doc.lines; n++) if (doc.line(n).text.trim()) return doc.line(n);
  return null;
}

function spaceAfter(doc, pos) {
  return doc.sliceString(pos, pos + 1) === " " ? pos + 1 : pos;
}

/** Redraw the marks: Settings changed whether they hide at the cursor ("ory:marks"). */
const restyle = StateEffect.define();

export function livePreview({ resolve, openLink, fileSize = () => null, openPage = () => {} }) {
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        ({ decorations: this.decorations, atomic: this.atomic } = build(view, { resolve, fileSize, openPage }));
        this.onMarks = () => view.dispatch({ effects: restyle.of(null) });
        window.addEventListener("ory:marks", this.onMarks);
      }
      destroy() {
        window.removeEventListener("ory:marks", this.onMarks);
      }
      update(u) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged
            || syntaxTree(u.state) !== syntaxTree(u.startState)
            || u.transactions.some((tr) => tr.effects.some((e) =>
              e.is(setSourceMode) || e.is(setReading) || e.is(setQuiet) || e.is(indexChanged) || e.is(restyle)))
            || u.startState.field(quiet, false) !== u.state.field(quiet, false)) {
          ({ decorations: this.decorations, atomic: this.atomic } = build(u.view, { resolve, fileSize, openPage }));
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false;
      const el = e.target.closest?.("[data-wikilink], [data-href]");
      if (!el || !view.contentDOM.contains(el)) return false;
      const modClick = e.metaKey || e.ctrlKey;
      if (!modClick && !e.altKey && !el.classList.contains("cm-link-live")) return false;
      e.preventDefault();
      // Option-click opens a note beside this one.
      if (el.dataset.wikilink != null) openLink({ wikilink: el.dataset.wikilink, event: e });
      else openLink({ href: el.dataset.href });
      return true;
    },
  });

  // Hidden colour tags, and formatting marks while they stay hidden, are
  // single steps for the cursor.
  const atomic = EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none);

  // Backspace just after a hidden tag or mark deletes the character before it,
  // not the mark (which would leave half a span or half a bold); emptying a
  // span or a bold removes it; at the start of a heading, quote or task,
  // Backspace turns the line back into body text, as in a word processor.
  const tagAt = (view, pos, side) => {
    let found = null;
    view.plugin(plugin)?.atomic.between(pos - 1, pos + 1, (from, to) => {
      if ((side < 0 ? to : from) === pos) found = { from, to };
    });
    return found;
  };
  const deleteAround = (dir) => (view) => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const text = view.state.doc;
    // The last character between two hidden marks (**a**, <span>a</span>):
    // deleting it removes the marks too, rather than leaving "****" behind.
    const char = dir < 0 ? sel.head - 1 : sel.head;
    if (char >= 0 && char < text.length && text.sliceString(char, char + 1) !== "\n") {
      const open = tagAt(view, char, -1);
      const close = tagAt(view, char + 1, 1);
      const pair = open && close && (
        (INLINE_MARKS.has(text.sliceString(open.from, open.to)) && text.sliceString(open.from, open.to) === text.sliceString(close.from, close.to))
        || (text.sliceString(open.from, open.from + 1) === "<" && text.sliceString(close.from, close.from + 2) === "</"));
      if (pair) {
        view.dispatch({ changes: { from: open.from, to: close.to }, selection: { anchor: open.from }, userEvent: "delete" });
        return true;
      }
    }
    const tag = tagAt(view, sel.head, dir);
    if (!tag) return false;
    const left = tagAt(view, sel.head, -1);
    const right = tagAt(view, sel.head, 1);
    const slice = (t) => text.sliceString(t.from, t.to);
    // The start of a heading, quote or task: the line becomes body text.
    if (dir < 0 && left && left.from === text.lineAt(left.from).from && BLOCK_PREFIX.test(slice(left))) {
      view.dispatch({ changes: { from: left.from, to: left.to }, selection: { anchor: left.from }, userEvent: "delete.backward" });
      return true;
    }
    // An empty span or bold (opening, cursor, closing): remove it whole.
    const emptySpan = left && right && slice(left).startsWith("<span") && slice(right) === "</span>";
    const emptyPair = left && right && INLINE_MARKS.has(slice(left)) && slice(left) === slice(right);
    if (emptySpan || emptyPair) {
      view.dispatch({ changes: { from: left.from, to: right.to }, selection: { anchor: left.from }, userEvent: "delete" });
      return true;
    }
    // Otherwise step over the tag and delete the character beyond it.
    const edge = dir < 0 ? tag.from : tag.to;
    const at = dir < 0 ? edge - 1 : edge;
    if (at < 0 || at >= text.length) return false;
    view.dispatch({
      changes: { from: at, to: at + 1 },
      selection: { anchor: dir < 0 ? at : sel.head },
      userEvent: dir < 0 ? "delete.backward" : "delete.forward",
    });
    return true;
  };
  // Enter at the start of a heading's (or quote's) text, while its mark is
  // hidden, adds a line above and leaves the heading whole; on an empty
  // heading it makes the line body text, as a word processor does.
  const enterAtPrefix = (view) => {
    const at = prefixEnd(view.state);
    if (!at) return false;
    const { line, end } = at;
    if (line.to === end) {
      view.dispatch({ changes: { from: line.from, to: end }, selection: { anchor: line.from }, userEvent: "delete" });
    } else {
      view.dispatch({ changes: { from: line.from, insert: "\n" }, selection: { anchor: end + 1 }, userEvent: "input" });
    }
    return true;
  };

  const keys = Prec.high(keymap.of([
    { key: "Backspace", run: deleteAround(-1) },
    { key: "Delete", run: deleteAround(1) },
    { key: "Enter", run: enterAtPrefix },
  ]));

  return [sourceMode, reading, quiet, plugin, clicks, atomic, keys, prefixSnap, readingFlow];
}

// Reading: a paragraph written across several lines reads as one, as in any
// Markdown viewer. Each soft line break becomes a space; a hard break (two
// trailing spaces or a backslash) stays. Replacing a line break must come
// from a state field, not the view plugin above.
class SpaceWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    return document.createTextNode(" ");
  }
}
const space = Decoration.replace({ widget: new SpaceWidget() });

function flow(state) {
  if (!isReading(state)) return Decoration.none;
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);
  const out = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "Paragraph") return;
      const a = doc.lineAt(node.from).number;
      const b = doc.lineAt(node.to).number;
      // Deliberate breaks, as the parser sees them (two spaces or a backslash).
      const hard = new Set();
      node.node.getChildren("HardBreak").forEach((br) => hard.add(doc.lineAt(br.from).number));
      for (let n = a; n < b; n++) {
        const here = doc.line(n);
        if (hard.has(n)) continue;
        const next = doc.line(n + 1);
        const indent = /^[ \t]*/.exec(next.text)[0].length;
        out.push(space.range(here.to, next.from + indent));
      }
      return false;
    },
  });
  return Decoration.set(out, true);
}

const readingFlow = StateField.define({
  create: flow,
  update(deco, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setReading)) || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return flow(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The link under the cursor, for opening it from the keyboard. */
export function linkAt(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (; node; node = node.parent) {
    if (node.name === "WikiLink") {
      const target = node.getChild("WikiLinkTarget");
      const alias = node.getChild("WikiLinkAlias");
      if (target) return { wikilink: state.doc.sliceString(target.from, (alias ?? target).to) };
    }
    if (node.name === "Link") {
      const url = node.getChild("URL");
      if (url) return { href: state.doc.sliceString(url.from, url.to) };
    }
    if (node.name === "URL") return { href: state.doc.sliceString(node.from, node.to) };
  }
  return null;
}
