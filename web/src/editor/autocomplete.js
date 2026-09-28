// Autocomplete for [[wikilinks]]: note names and aliases from the vault index.

import { autocompletion } from "@codemirror/autocomplete";

import { folderOf } from "../links.js";

const LINK_START = /\[\[([^\[\]|#\n]*)$/;

export function wikilinkCompletion({ notes, files = () => [], linkTextFor }) {
  const source = (context) => {
    const before = context.state.doc.sliceString(Math.max(0, context.pos - 200), context.pos);
    const match = LINK_START.exec(before);
    if (!match) return null;
    const from = context.pos - match[1].length;

    const options = [];
    for (const note of notes()) {
      const folder = folderOf(note.path);
      options.push({ label: note.name, detail: folder, type: "note", apply: insertLink(() => linkTextFor(note.path)) });
      for (const alias of note.aliases) {
        options.push({
          label: alias,
          detail: note.name,
          type: "alias",
          boost: -1,
          apply: insertLink(() => `${linkTextFor(note.path)}|${alias}`),
        });
      }
    }
    for (const file of files()) {
      options.push({
        label: file.name,
        detail: folderOf(file.path) || "file",
        type: "file",
        boost: -2,
        apply: insertLink(() => linkTextFor(file.path)),
      });
    }
    return { from, options, validFor: /^[^\[\]|#\n]*$/ };
  };
  return autocompletion({
    override: [source],
    icons: false,
    closeOnBlur: true,
    maxRenderedOptions: 50,
  });
}

/** Insert the link text and close the link, reusing a "]]" already after the cursor. */
function insertLink(text) {
  return (view, _completion, from, to) => {
    const linkText = text();
    const after = view.state.doc.sliceString(to, to + 2);
    const closing = after === "]]" ? "" : "]]";
    const end = from + linkText.length + 2;
    view.dispatch({
      changes: { from, to, insert: linkText + closing },
      selection: { anchor: end },
      userEvent: "input.complete",
    });
  };
}
