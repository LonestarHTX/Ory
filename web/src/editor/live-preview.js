// Live preview: Markdown syntax marks are hidden unless the cursor is in the
// element they belong to, so the note reads as formatted text while staying a
// plain text file. Source mode (Mod-E) turns the hiding off.
//
// Wikilinks are styled in both modes: resolved links underlined, links to
// missing notes dashed. Clicking a rendered link opens it; Mod-click always does.

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType } from "@codemirror/view";

import { fileName, isImage, isPage, parseLink } from "../links.js";
import { inkPaint } from "../ui/color.js";
import { icon } from "../ui/dom.js";
import { pageFrame } from "../ui/page-view.js";

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
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-embed-image";
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    img.draggable = false;
    if (this.width) img.style.width = `${this.width}px`;
    img.addEventListener("error", () => img.classList.add("is-broken"));
    return img;
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
 * An HTML page embedded in a note: a titled frame, and a button to open it
 * across the whole main area. The frame is sandboxed (see ui/page-view.js).
 */
class PageEmbedWidget extends WidgetType {
  constructor(path, height, openPage, fragment) {
    super();
    this.path = path;
    this.height = height;
    this.openPage = openPage;
    this.fragment = fragment;
  }
  eq(other) {
    return other.path === this.path && other.height === this.height && other.fragment === this.fragment;
  }
  toDOM() {
    const name = fileName(this.path).replace(/\.html?$/i, "");
    const wrap = document.createElement("div");
    wrap.className = "cm-embed-page";
    const head = document.createElement("div");
    head.className = "cm-embed-page-head";
    const title = document.createElement("span");
    title.className = "cm-embed-page-title";
    title.append(icon("page", 14), name);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn btn--small btn--plain";
    open.textContent = "Open";
    open.addEventListener("click", () => this.openPage(this.path));
    head.append(title, open);
    const frame = pageFrame(this.path, name, this.fragment);
    frame.style.height = `${this.height}px`;
    wrap.append(head, frame);
    return wrap;
  }
  get estimatedHeight() {
    return this.height + 37;
  }
  ignoreEvent() {
    return true;
  }
  ignoreMutation() {
    return true; // the frame may be swapped for a fresh one when the theme changes
  }
}

const PAGE_HEIGHT = 480;

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

// Coloured text: <span style="color: ...">. Only a theme ink or a hex/rgb
// colour is applied, and a picked colour is shown readably (ui/color.js).
const COLOR_OPEN = /^<span style="color:\s*([^";]+?);?\s*">$/;
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
  const lineTouched = (pos) => {
    const l = doc.lineAt(pos);
    return touches(view, l.from, l.to);
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
            const active = touches(view, node.from, node.to);
            // ![[file]] shows the image, the page or a file chip, always drawn
            // just after the embed so it is never rebuilt (a page would reload)
            // as the cursor comes and goes. Away from the cursor the Markdown
            // itself is hidden; at the cursor it shows above the embed.
            if (live && doc.sliceString(node.from, node.from + 1) === "!" && resolved && !/\.md$/i.test(resolved)) {
              const size = embedWidth(aliasText);
              const widget = isPage(resolved)
                ? new PageEmbedWidget(resolved, size ?? PAGE_HEIGHT, openPage, heading)
                : isImage(resolved)
                  ? new ImageWidget(fileUrl(resolved), size, name)
                  : new FileWidget(resolved, fileSize(resolved));
              add(node.to, node.to, Decoration.widget({ widget, side: 1 }));
              if (!active) {
                add(node.from, node.to, hide);
                return false;
              }
            }
            const cls = `cm-wikilink${missing ? " cm-wikilink-missing" : ""}${live && !active ? " cm-link-live" : ""}`;
            add(shown.from, shown.to, Decoration.mark({
              class: cls,
              attributes: { "data-wikilink": inner, "data-tip": missing ? `Create note "${name}"` : `Open ${name}` },
            }));
            if (live && !active) {
              add(node.from, shown.from, hide);
              add(shown.to, node.to, hide);
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
            const active = touches(view, node.from, node.to);
            add(marks[0].to, marks[1].from, Decoration.mark({
              class: `cm-md-link${live && !active ? " cm-link-live" : ""}`,
              attributes: { "data-href": doc.sliceString(url.from, url.to), "data-tip": doc.sliceString(url.from, url.to) },
            }));
            if (live && !active) {
              add(marks[0].from, marks[0].to, hide);
              add(marks[1].from, node.to, hide);
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
            const open = COLOR_OPEN.exec(doc.sliceString(node.from, node.to));
            const paint = open && inkPaint(open[1]);
            if (!paint) return;
            let close = node.nextSibling;
            while (close && !(close.name === "HTMLTag" && doc.sliceString(close.from, close.to) === "</span>")) {
              close = close.nextSibling;
            }
            if (!close) return;
            add(node.to, close.from, Decoration.mark({ class: paint.className, attributes: { style: paint.style } }));
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
            if (touches(view, node.from, node.to)) add(node.to, node.to, Decoration.widget({ widget, side: 1 }));
            else add(node.from, node.to, Decoration.replace({ widget }));
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
            if (live && !lineTouched(node.from)) add(node.from, spaceAfter(doc, node.to), hide);
            return;
          case "HeaderMark":
            if (live && node.parent?.name.startsWith("ATXHeading") && !lineTouched(node.from)) {
              // Hide the opening "## " (and a closing "##", if present).
              const isOpening = node.from === node.parent.from;
              add(isOpening ? node.from : node.from - 1, isOpening ? spaceAfter(doc, node.to) : node.to, hide);
            }
            return;
          case "EmphasisMark":
          case "CodeMark":
          case "StrikethroughMark":
          case "HighlightMark":
            if (live && node.parent && node.parent.name !== "FencedCode" && !touches(view, node.parent.from, node.parent.to)) {
              add(node.from, node.to, hide);
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
              if (marker && !touches(view, node.from, marker.to)) {
                add(node.from, markEnd, hide);
                const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
                add(marker.from, marker.to, Decoration.replace({ widget: new CheckboxWidget(checked, marker.from, read) }));
              }
            } else if (item?.parent?.name === "BulletList" && !touches(view, node.from, node.to)) {
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

export function livePreview({ resolve, openLink, fileSize = () => null, openPage = () => {} }) {
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        ({ decorations: this.decorations, atomic: this.atomic } = build(view, { resolve, fileSize, openPage }));
      }
      update(u) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged
            || syntaxTree(u.state) !== syntaxTree(u.startState)
            || u.transactions.some((tr) => tr.effects.some((e) => e.is(setSourceMode) || e.is(setReading) || e.is(setQuiet) || e.is(indexChanged)))
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
      if (!modClick && !el.classList.contains("cm-link-live")) return false;
      e.preventDefault();
      if (el.dataset.wikilink != null) openLink({ wikilink: el.dataset.wikilink });
      else openLink({ href: el.dataset.href });
      return true;
    },
  });

  // Hidden colour tags are single steps for the cursor.
  const atomic = EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none);

  // Backspace just after a hidden tag deletes the character before it, not
  // the tag (which would leave half a span); emptying a span removes it.
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
    const tag = tagAt(view, sel.head, dir);
    if (!tag) return false;
    const text = view.state.doc;
    // An empty span (opening tag, cursor, closing tag): remove the whole span.
    const left = tagAt(view, sel.head, -1);
    const right = tagAt(view, sel.head, 1);
    if (left && right && text.sliceString(left.from, left.from + 5) === "<span"
        && text.sliceString(right.from, right.to) === "</span>") {
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
  const keys = Prec.high(keymap.of([
    { key: "Backspace", run: deleteAround(-1) },
    { key: "Delete", run: deleteAround(1) },
  ]));

  return [sourceMode, reading, quiet, plugin, clicks, atomic, keys, readingFlow];
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
