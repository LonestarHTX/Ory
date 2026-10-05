// The note editor: CodeMirror 6 configured for Markdown with frontmatter,
// wikilinks, live preview and link autocomplete.

import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, indentNodeProp, Language, languageDataProp, LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { GFM, parser as commonmark } from "@lezer/markdown";

import { pairsBrackets, spellchecks } from "../prefs.js";
import { attachments, insertFiles } from "./attachments.js";
import { colourPreview } from "./colour-preview.js";
import { wikilinkCompletion } from "./autocomplete.js";
import { setHeading, startNoteLink, toggleInline, toggleList } from "./format.js";
import { highlightTag, HighlightSyntax } from "./highlight-syntax.js";
import { byOry, indexChanged, isReading, linkAt, livePreview, setQuiet, setReading, setSourceMode, sourceMode } from "./live-preview.js";
import { frontmatterRange, properties } from "./properties.js";
import { tables } from "./tables.js";
import { propertyTables } from "./property-tables.js";
import { WikiLinkSyntax } from "./wikilink-syntax.js";

// Colours and sizes come from the CSS tokens in styles.css.
const highlight = HighlightStyle.define([
  { tag: t.heading1, class: "cm-md-h1" },
  { tag: t.heading2, class: "cm-md-h2" },
  { tag: t.heading3, class: "cm-md-h3" },
  { tag: [t.heading4, t.heading5, t.heading6], class: "cm-md-h4" },
  { tag: t.strong, class: "cm-md-strong" },
  { tag: t.emphasis, class: "cm-md-em" },
  { tag: t.strikethrough, class: "cm-md-strike" },
  { tag: highlightTag, class: "cm-md-highlight" },
  { tag: t.monospace, class: "cm-md-code" },
  { tag: [t.processingInstruction, t.contentSeparator, t.labelName], class: "cm-md-syntax" },
  { tag: [t.url, t.link], class: "cm-md-url" },
  { tag: t.quote, class: "cm-md-quote-text" },
  { tag: [t.propertyName, t.meta, t.comment], class: "cm-md-syntax" },
]);

/** Marks changes that came from disk, which must not be saved back. */
const fromDisk = Annotation.define();

/** Whether the text can be changed: not while a wiki page is being read. */
const editability = new Compartment();

/** Pairing ( [ { and ` as you type (Settings → Editing). */
const pairing = new Compartment();
const pairs = () => (pairsBrackets() ? closeBrackets() : []);
const editable = (on) => (on ? [] : [EditorView.editable.of(false), EditorState.readOnly.of(true)]);

// A backstop for reading: no command, keymap or widget can change the text
// while a page is read. Only a change from disk, or one Ory makes for you, gets through.
const readingGuard = EditorState.changeFilter.of((tr) =>
  !isReading(tr.startState) || tr.annotation(fromDisk) === true || tr.annotation(byOry) === true);

/** Line endings: the editor always works in "\n"; a Windows note is saved back with "\r\n". */
const toLF = (text) => text.replace(/\r\n?/g, "\n");
const usesCRLF = (text) => text.includes("\r\n") && !/(^|[^\r])\n/.test(text);
// Notes kept in memory, most recently used last; older ones are dropped.
const KEEP_STATES = 40;

// Markdown for notes: CommonMark, GitHub's extensions (tables, task lists,
// strikethrough), [[wikilinks]] and ==highlight==.
// Built directly rather than with markdown(), which bundles HTML, CSS and
// JavaScript parsers for embedded code. The Markdown keymap (Enter continuing a
// list, Backspace taking its marker away) only acts where the document node
// carries markdownLanguage's data, as lang-markdown's own parser has it; the
// bare @lezer/markdown parser doesn't, so it's added here.
const markdownSupport = new LanguageSupport(new Language(
  markdownLanguage.data,
  commonmark.configure([GFM, WikiLinkSyntax, HighlightSyntax, {
    props: [
      languageDataProp.add({ Document: markdownLanguage.data }),
      indentNodeProp.add({ Document: () => null }),
    ],
  }]),
  [],
  "markdown",
));

/**
 * handlers: { onChange(), openLink({wikilink}|{href}), notes(), resolve(target), linkTextFor(path) }
 */
export function createEditor(parent, handlers) {
  const uploadEnv = {
    notePath: handlers.notePath,
    linkTextFor: handlers.linkTextFor,
    afterUpload: handlers.afterUpload,
    onError: handlers.onError,
  };
  const extensions = [
    editability.of(editable(true)),
    readingGuard,
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(true),
    yamlFrontmatter({ content: markdownSupport }),
    markdownLanguage.data.of({ closeBrackets: { brackets: ["(", "[", "{", "`"] } }),
    syntaxHighlighting(highlight),
    pairing.of(pairs()),
    search({ top: true }),
    livePreview({
      resolve: handlers.resolve,
      openLink: handlers.openLink,
      fileSize: handlers.fileSize,
      openPage: handlers.openPath,
    }),
    attachments(uploadEnv),
    colourPreview,
    properties({ openLink: handlers.openLink }),
    tables({ resolve: handlers.resolve, openLink: handlers.openLink }),
    propertyTables({
      notes: handlers.notes,
      resolve: handlers.resolve,
      currentPath: handlers.notePath,
      version: handlers.indexVersion,
      openPath: handlers.openPath,
      openLink: handlers.openLink,
      setProperty: handlers.setNoteProperty,
    }),
    wikilinkCompletion({ notes: handlers.notes, files: handlers.files, linkTextFor: handlers.linkTextFor }),
    placeholder("Start writing"),
    keymap.of([
      { key: "Mod-Enter", run: (view) => openLinkAtCursor(view, handlers.openLink) },
      // Word-style formatting; see format.js and the toolbar.
      { key: "Mod-b", run: toggleInline("bold") },
      { key: "Mod-i", run: toggleInline("italic") },
      { key: "Mod-Shift-x", run: toggleInline("strike") },
      { key: "Mod-Shift-h", run: toggleInline("highlight") },
      { key: "Mod-k", run: (view) => handlers.editLink?.(view) ?? startNoteLink(view) },
      { key: "Mod-Shift-7", run: toggleList("number") },
      { key: "Mod-Shift-8", run: toggleList("bullet") },
      { key: "Mod-Shift-9", run: toggleList("task") },
      { key: "Mod-Alt-0", run: setHeading(0) },
      { key: "Mod-Alt-1", run: setHeading(1) },
      { key: "Mod-Alt-2", run: setHeading(2) },
      { key: "Mod-Alt-3", run: setHeading(3) },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...markdownKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromDisk))) handlers.onChange(u);
      if (u.docChanged || u.selectionSet || u.focusChanged) handlers.onSelection?.(u.state);
    }),
    // Read on every update, so a change in Settings reaches open notes too.
    EditorView.contentAttributes.of(() => ({ "aria-label": "Note", spellcheck: String(spellchecks()), autocorrect: "on" })),
  ];

  const view = new EditorView({ parent });
  // Settings changed pairing: the open note follows at once; others as they open.
  window.addEventListener("ory:pairing", () => view.dispatch({ effects: pairing.reconfigure(pairs()) }));
  const states = new Map(); // path -> EditorState, to keep undo history and cursor per note
  let crlf = false; // the open note's line endings on disk

  return {
    view,

    /** Show a note. Reuses the note's previous state when its text is unchanged. */
    open(path, text, { source = false, reading = false } = {}) {
      crlf = usesCRLF(text);
      const doc = toLF(text);
      let state = states.get(path);
      if (!state || state.sliceDoc() !== doc) {
        state = EditorState.create({ doc, extensions });
        const fm = frontmatterRange(state.doc);
        state = state.update({ selection: { anchor: fm ? fm.bodyFrom : 0 } }).state;
      }
      view.setState(state);
      view.dispatch({
        effects: [setSourceMode.of(source), setReading.of(reading), setQuiet.of(true), editability.reconfigure(editable(!reading)), pairing.reconfigure(pairs())],
      });
      handlers.afterOpen?.(view);
      handlers.onSelection?.(view.state);
    },

    /** Replace the text after an outside change, keeping the cursor near where it was. */
    replace(text) {
      crlf = usesCRLF(text);
      const doc = toLF(text);
      const head = Math.min(view.state.selection.main.head, doc.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        selection: EditorSelection.cursor(head),
        annotations: fromDisk.of(true),
      });
    },

    remember(path) {
      if (!path) return;
      states.delete(path);
      states.set(path, view.state);
      while (states.size > KEEP_STATES) states.delete(states.keys().next().value);
    },

    forget(path) {
      states.delete(path);
    },

    rekey(from, to) {
      if (states.has(from)) states.set(to, states.get(from));
      states.delete(from);
    },

    /** Make a change for you, even while a page is read; it saves like your own edits. */
    apply(changes) {
      view.dispatch({ changes, annotations: byOry.of(true) });
    },

    goToLine(lineNo) {
      const n = Math.min(Math.max(1, lineNo + 1), view.state.doc.lines);
      const line = view.state.doc.line(n);
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      view.focus();
    },

    get sourceMode() {
      return view.state.field(sourceMode);
    },

    get reading() {
      return isReading(view.state);
    },

    /** Switch between reading a wiki page and editing it. */
    setReading(on) {
      if (on && view.hasFocus) view.contentDOM.blur();
      view.dispatch({ effects: [setReading.of(on), editability.reconfigure(editable(!on))] });
    },

    setSourceMode(on) {
      view.dispatch({ effects: setSourceMode.of(on) });
    },

    refreshLinks() {
      view.dispatch({ effects: indexChanged.of(null) });
    },

    /** The note's text, with its own line endings. */
    text: () => (crlf ? view.state.sliceDoc().replace(/\n/g, "\r\n") : view.state.sliceDoc()),

    /** Upload files chosen from the toolbar and embed them at the cursor. */
    insertFiles(files) {
      return insertFiles(view, files, view.state.selection.main.head, uploadEnv);
    },
  };
}

function openLinkAtCursor(view, openLink) {
  const link = linkAt(view.state, view.state.selection.main.head);
  if (!link) return false;
  openLink(link);
  return true;
}
