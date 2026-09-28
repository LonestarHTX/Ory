"""Markdown parsing that Ory needs on the server: frontmatter and wikilinks.

Only the standard library is used, so the YAML support is a deliberate subset:
the flat `key: value` properties that Obsidian writes, block lists, inline
lists, quoted strings, booleans, numbers and null. Anything nested is kept as
its raw text rather than guessed at.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, NamedTuple, Optional, Tuple

_FENCE = re.compile(r"^([ \t]*)(`{3,}|~{3,})(.*)$")
_LIST_ITEM = re.compile(r"^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)")
_INLINE_CODE = re.compile(r"(`+)(?!`)(.+?)(?<!`)\1(?!`)")
_WIKILINK = re.compile(r"(!?)\[\[([^\[\]\n]+?)\]\]")
_KEY_LINE = re.compile(r"^([^\s#:][^:]*?)\s*:(?:\s+(.*))?$")


# Frontmatter --------------------------------------------------------------


def split_frontmatter(text: str) -> Tuple[Optional[str], int]:
    """Return (frontmatter_text, body_start_offset).

    Frontmatter is a block that starts on the first line with `---` and ends at
    the next line that is `---` or `...`. Without one, returns (None, 0).
    """
    if not (text.startswith("---\n") or text.startswith("---\r\n")):
        return None, 0
    first_break = text.index("\n") + 1
    pos = first_break
    while pos <= len(text):
        end = text.find("\n", pos)
        line_end = len(text) if end == -1 else end
        line = text[pos:line_end].rstrip("\r")
        if line in ("---", "..."):
            body_start = len(text) if end == -1 else end + 1
            return text[first_break:pos], body_start
        if end == -1:
            break
        pos = end + 1
    return None, 0


def parse_properties(frontmatter: Optional[str]) -> Dict[str, Any]:
    """Parse the YAML subset Obsidian uses for properties."""
    if not frontmatter:
        return {}
    props: Dict[str, Any] = {}
    lines = frontmatter.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#") or line[0] in " \t":
            i += 1
            continue
        match = _KEY_LINE.match(line)
        if not match:
            i += 1
            continue
        key = _unquote(match.group(1).strip())
        value = (match.group(2) or "").strip()
        i += 1
        if value:
            props[key] = _scalar_or_inline_list(value)
            continue
        # Block value: indented lines that follow the key.
        block: List[str] = []
        while i < len(lines) and (not lines[i].strip() or lines[i][0] in " \t-"):
            block.append(lines[i])
            i += 1
        items = [b.strip() for b in block if b.strip()]
        if items and all(item.startswith("-") for item in items):
            props[key] = [_scalar(item[1:].strip()) for item in items]
        elif items:
            props[key] = "\n".join(block).strip("\n")
        else:
            props[key] = None
    return props


def _scalar_or_inline_list(value: str) -> Any:
    value = _strip_comment(value)
    if value.startswith("[") and value.endswith("]") and not value.startswith("[["):
        inner = value[1:-1].strip()
        return [_scalar(part.strip()) for part in _split_inline(inner)] if inner else []
    return _scalar(value)


def _split_inline(inner: str) -> List[str]:
    parts, current, quote = [], "", ""
    for ch in inner:
        if quote:
            current += ch
            if ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
            current += ch
        elif ch == ",":
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)
    return parts


def _strip_comment(value: str) -> str:
    if value[:1] in "'\"":
        return value
    idx = value.find(" #")
    return value[:idx].rstrip() if idx != -1 else value


def _scalar(value: str) -> Any:
    value = _strip_comment(value)
    if value[:1] in "'\"" and value[-1:] == value[:1] and len(value) >= 2:
        return _unquote(value)
    lowered = value.lower()
    if lowered in ("true", "false"):
        return lowered == "true"
    if lowered in ("null", "~", ""):
        return None
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if re.fullmatch(r"-?\d+\.\d+", value):
        return float(value)
    return value


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        inner = value[1:-1]
        if value[0] == "'":
            return inner.replace("''", "'")
        return inner.replace('\\"', '"').replace("\\\\", "\\")
    return value


def as_list(value: Any) -> List[str]:
    """Normalise a property that may be a string or a list into strings."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v is not None]
    return [part.strip() for part in str(value).split(",") if part.strip()]


# Wikilinks ----------------------------------------------------------------


class Link(NamedTuple):
    """One `[[wikilink]]` occurrence.

    `start` and `end` are offsets of the link target inside the text, so the
    target can be rewritten without touching `#heading` or `|alias` parts.
    """

    target: str
    start: int
    end: int
    line: int
    embed: bool


def extract_links(text: str) -> List[Link]:
    """Find wikilinks, ignoring any inside code blocks or inline code."""
    links: List[Link] = []
    offset = 0
    # Split on "\n" only, as the editor does; str.splitlines() also breaks on
    # other separators and would put line numbers out of step.
    lines = re.split(r"(?<=\n)", text)
    code = _code_lines(lines)
    for line_no, line in enumerate(lines):
        if line_no not in code:
            masked = _INLINE_CODE.sub(lambda m: " " * len(m.group(0)), line)
            for match in _WIKILINK.finditer(masked):
                inner = match.group(2)
                target = re.split(r"[|#]", inner, maxsplit=1)[0]
                # A `|` escaped for a Markdown table leaves a trailing backslash.
                target = target.rstrip("\\").rstrip()
                if not target:
                    continue
                start = offset + match.start(2)
                links.append(Link(target, start, start + len(target), line_no, bool(match.group(1))))
        offset += len(line)
    return links


def _code_lines(lines: List[str]) -> set:
    """Line numbers inside fenced or indented code blocks.

    Follows CommonMark closely enough to agree with the editor on real notes:
    fences may be indented inside list items, a fence closes only on a bare
    fence at least as long, and indented code needs a blank line before it and
    cannot sit inside a list (where indentation means a nested item).
    """
    code = set()
    fence = None
    in_list = False
    in_indented = False
    prev_blank = True
    for n, raw in enumerate(lines):
        line = raw.rstrip("\r\n")
        indent = len(line) - len(line.lstrip(" \t"))
        indent = len(line[:indent].expandtabs(4))
        match = _FENCE.match(line)
        if fence is not None:
            code.add(n)
            if match and match.group(2)[0] == fence[0] and len(match.group(2)) >= len(fence) \
                    and not match.group(3).strip():
                fence = None
            continue
        if match and (indent <= 3 or in_list) and not (match.group(2)[0] == "`" and "`" in match.group(3)):
            fence = match.group(2)
            code.add(n)
            continue
        if not line.strip():
            prev_blank = True
            continue
        if indent >= 4 and not in_list and (prev_blank or in_indented):
            in_indented = True
            code.add(n)
        else:
            in_indented = False
            if _LIST_ITEM.match(line):
                in_list = True
            elif indent == 0 and prev_blank:
                in_list = False
        prev_blank = False
    return code


_TAG = re.compile(r"(?<![\w/&#])#([A-Za-z0-9_/-]*[A-Za-z_/-][A-Za-z0-9_/-]*)")


def extract_tags(text: str) -> List[str]:
    """#tags in the body, as Obsidian reads them: not in code, not all digits."""
    tags: List[str] = []
    _, body_start = split_frontmatter(text)
    lines = re.split(r"(?<=\n)", text[body_start:])
    code = _code_lines(lines)
    for n, line in enumerate(lines):
        if n in code or re.match(r"^\s{0,3}#{1,6}\s", line):
            continue  # headings start with "#" too
        masked = _INLINE_CODE.sub(lambda m: " " * len(m.group(0)), line)
        masked = re.sub(r"\[\[[^\]]*\]\]|\]\([^)]*\)|https?://\S+", " ", masked)
        for match in _TAG.finditer(masked):
            if match.group(1) not in tags:
                tags.append(match.group(1))
    return tags


def lines_of(text: str) -> List[str]:
    """Lines as the editor numbers them: split on "\n", without line endings."""
    return [line.rstrip("\r") for line in text.split("\n")]


def line_at(text: str, line_no: int) -> str:
    lines = lines_of(text)
    return lines[line_no] if 0 <= line_no < len(lines) else ""
