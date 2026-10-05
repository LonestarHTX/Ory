// A line of Markdown shown the way it reads, for search results and backlinks:
// list, task, quote and heading marks dropped, emphasis marks and colour tags
// removed, [[links]] as their text (without the quotes a property puts round
// them). Search matches stay marked where they fell in the original line.

import { parseLink } from "../links.js";
import { h } from "./dom.js";

const PREFIX = /^\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+)?/;
// A single * is emphasis when it touches a word ("*italic*"), not in "2 * 3".
const TOKENS = /"?!?\[\[([^\[\]]+)\]\]"?|\*\*|__|==|~~|`|<\/?(?:span|mark)[^>]*>|\*(?=\S)|(?<=\S)\*/g;

/** Nodes for `text`, with [from, to) `ranges` of the original text marked. */
export function readable(text, ranges = []) {
  const pieces = []; // {text, from, to, exact}: exact pieces map character for character
  const start = PREFIX.exec(text)[0].length;
  let pos = start;
  TOKENS.lastIndex = 0;
  for (const m of text.matchAll(TOKENS)) {
    if (m.index < start) continue;
    if (m.index > pos) pieces.push({ text: text.slice(pos, m.index), from: pos, to: m.index, exact: true });
    if (m[1] != null) {
      const { target, alias, heading } = parseLink(m[1]);
      // An embed's "|640" is a size, not a name to show.
      const embed = m[0].replace(/^"/, "").startsWith("!");
      const shown = embed ? target.replace(/\.html?$/i, "") : alias ?? (heading ? `${target} › ${heading}` : target);
      pieces.push({ text: shown, from: m.index, to: m.index + m[0].length, exact: false, link: true });
    }
    pos = m.index + m[0].length;
  }
  if (pos < text.length) pieces.push({ text: text.slice(pos), from: pos, to: text.length, exact: true });

  const out = [];
  for (const p of pieces) {
    const node = (content, marked) => {
      const inner = p.link ? h("span", { class: "backlink-link" }, content) : content;
      return marked ? h("mark", null, inner) : inner;
    };
    if (!p.exact) {
      out.push(node(p.text, ranges.some(([a, b]) => a < p.to && b > p.from)));
      continue;
    }
    // Split an exact piece where the matches begin and end.
    let at = p.from;
    for (const [a, b] of ranges) {
      const from = Math.max(a, p.from);
      const to = Math.min(b, p.to);
      if (to <= from || from < at) continue;
      if (from > at) out.push(text.slice(at, from));
      out.push(node(text.slice(from, to), true));
      at = to;
    }
    if (at < p.to) out.push(text.slice(at, p.to));
  }
  return out;
}
