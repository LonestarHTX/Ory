// A Lezer Markdown extension that parses [[wikilinks]] and ![[embeds]] into
// syntax nodes, so the editor treats them like any other inline element.
//
//   WikiLink
//     WikiLinkMark   "[[" or "![["
//     WikiLinkTarget "Note#Heading"
//     WikiLinkMark   "|"            (only with an alias)
//     WikiLinkAlias  "shown text"   (only with an alias)
//     WikiLinkMark   "]]"

import { tags } from "@lezer/highlight";

const BANG = 33;
const OPEN = 91; // [
const CLOSE = 93; // ]
const PIPE = 124;
const NEWLINE = 10;

export const WikiLinkSyntax = {
  defineNodes: [
    { name: "WikiLink" },
    { name: "WikiLinkMark", style: tags.processingInstruction },
    { name: "WikiLinkTarget" },
    { name: "WikiLinkAlias" },
  ],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        const embed = next === BANG;
        const open = pos + (embed ? 1 : 0);
        if (cx.char(open) !== OPEN || cx.char(open + 1) !== OPEN) return -1;
        const inner = open + 2;
        let close = -1;
        let pipe = -1;
        for (let i = inner; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === NEWLINE || ch === OPEN) return -1;
          if (ch === PIPE && pipe === -1) pipe = i;
          if (ch === CLOSE) {
            if (cx.char(i + 1) !== CLOSE) return -1;
            close = i;
            break;
          }
        }
        if (close <= inner) return -1;

        const children = [cx.elt("WikiLinkMark", pos, inner)];
        if (pipe === -1) {
          children.push(cx.elt("WikiLinkTarget", inner, close));
        } else {
          children.push(cx.elt("WikiLinkTarget", inner, pipe));
          children.push(cx.elt("WikiLinkMark", pipe, pipe + 1));
          children.push(cx.elt("WikiLinkAlias", pipe + 1, close));
        }
        children.push(cx.elt("WikiLinkMark", close, close + 2));
        return cx.addElement(cx.elt("WikiLink", pos, close + 2, children));
      },
    },
  ],
};
