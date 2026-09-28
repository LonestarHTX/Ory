// A Lezer Markdown extension for ==highlight==. It works like
// GitHub's ~~strikethrough~~: a pair of delimiters around inline content.

import { Tag, tags } from "@lezer/highlight";

/** Styled by the editor's highlight style as .cm-md-highlight. */
export const highlightTag = Tag.define();

const EQUALS = 61;
const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1‐-‧]/;
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

export const HighlightSyntax = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": highlightTag } },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      after: "Emphasis",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = PUNCTUATION.test(before);
        const punctAfter = PUNCTUATION.test(after);
        return cx.addDelimiter(HighlightDelim, pos, pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter));
      },
    },
  ],
};
