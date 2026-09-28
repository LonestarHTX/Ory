// The two prompts behind Suggestions, and reading the replies to them.
//
// Find: the wikis as they stand and the notes changed since the last run go
// in; findings come out, short claims to approve or dismiss.
// Write: the approved findings, the pages they touch and their source notes
// go in; whole pages come out, which Ory compares with the pages as they are.
//
// Both work with any AI chat by copy and paste, so the formats are plain text
// with "=== " markers that are easy for a model to follow and for Ory to read.

/** Characters per prompt (Settings › AI). Larger runs are split into rounds, each its own paste. */
let BUDGET = 60000;
export function setBudget(size) {
  if (Number.isFinite(size) && size >= 5000) BUDGET = size;
}
const NOTE_LIMIT = 20000;

export const KINDS = {
  page: "New page",
  add: "Add to page",
  conflict: "Conflict",
  link: "Missing link",
  wiki: "New wiki",
  fix: "Fix",
};

const ROLE = `You help keep a person's wikis up to date from their notes. Notes are quick, dated and messy; they are the raw material. Wiki pages are written to be read later by someone new to the subject. You never change the notes.`;

// Find ---------------------------------------------------------------------------

const FIND_TASK = `Read the notes below and list findings: things the wikis should gain or fix because of these notes.

Kinds of finding:
- new page: a topic the notes cover that no page does. Give the wiki and a page title.
- add to page: something a page should say. Give the page and, if you can, the section heading.
- conflict: a note disagrees with a page. Say which looks right, or that the person should check.
- missing link: one page should point to another.
- new wiki: a subject that fits none of the wikis. Give it a short name.
- fix: something on a page is wrong, unclear or out of date.

Only raise findings worth a reader's time. Skip chatter, to-dos, plans and anything personal. Group related notes into one finding. Don't raise anything listed under "Already decided".

Reply with findings only, each in exactly this form, and nothing else:

=== finding
kind: add to page
wiki: Night sky
page: Finding Saturn
section: Where to look
title: Saturn rises around 21:40 in late September
why: One or two sentences on what the notes show and why the page should say it.
sources: Daily/2026-09-27.md, Projects/Backyard observatory.md

"sources" lists the paths of the notes the finding comes from, exactly as given below. Leave out "section" when it doesn't apply. If nothing is worth raising, reply with: === none`;

/**
 * Find prompts, one per round.
 * wikis: [{name, instructions, pages: [{title, summary, headings}]}]
 * notes: [{path, text, mtime}]; decided: [{kind, wiki, page, title, status}]
 * Returns [{text, paths}], `paths` being the notes each round reads.
 */
export function findPrompts({ wikis, notes, decided, wikisFolder }) {
  // The wikis' summary is repeated in every round, so it never takes more
  // than half of one: section names go first, then summaries, then pages.
  const build = (detail) => [
    ROLE,
    FIND_TASK,
    "# The wikis",
    wikis.length
      ? wikis.map((w) => wikiSummary(w, detail)).join("\n\n")
      : `There are no wikis yet. Suggest new ones where the notes support them. Wikis live in the "${wikisFolder}" folder.`,
    decided.length
      ? "# Already decided\n\n" + decided.slice(-80).map((f) => `- ${f.status}: ${KINDS[f.kind] ?? f.kind} · ${target(f)} · ${f.title}`).join("\n")
      : "",
  ].filter(Boolean).join("\n\n");
  let head = build(3);
  for (let detail = 2; head.length > BUDGET / 2 && detail >= 0; detail--) head = build(detail);
  return rounds(head, notes.map((n) => ({ path: n.path, block: noteBlock(n) })), (i, total) =>
    `# Notes${total > 1 ? ` (part ${i + 1} of ${total}; the other parts come in separate messages)` : ""}`);
}

/** detail 3: pages, summaries and sections; 2: pages and summaries; 1: pages; 0: the first 40 pages. */
function wikiSummary(w, detail = 3) {
  const list = detail === 0 ? w.pages.slice(0, 40) : w.pages;
  const pages = list.map((p) => {
    const parts = [`- ${p.title}`];
    if (detail >= 2 && p.summary) parts.push(`: ${p.summary}`);
    if (detail >= 3 && p.headings.length) parts.push(` (sections: ${p.headings.join("; ")})`);
    return parts.join("");
  });
  if (list.length < w.pages.length) pages.push(`- …and ${w.pages.length - list.length} more pages`);
  return [
    `## ${w.name}`,
    w.instructions ? `Instructions for this wiki:\n${w.instructions.trim()}` : "",
    pages.length ? `Pages:\n${pages.join("\n")}` : "No pages yet.",
  ].filter(Boolean).join("\n\n");
}

function noteBlock(n) {
  let text = n.text;
  if (text.length > NOTE_LIMIT) text = text.slice(0, NOTE_LIMIT) + "\n[… the rest of this note is left out]";
  const when = n.mtime ? ` (last changed ${new Date(n.mtime * 1000).toISOString().slice(0, 10)})` : "";
  return `=== note: ${n.path}${when}\n${text.trim()}\n`;
}

/** Split blocks into rounds that each fit the budget alongside the shared head. */
function rounds(head, blocks, title) {
  const groups = [];
  let current = [];
  let size = head.length;
  for (const b of blocks) {
    if (current.length && size + b.block.length > BUDGET) {
      groups.push(current);
      current = [];
      size = head.length;
    }
    current.push(b);
    size += b.block.length;
  }
  if (current.length) groups.push(current);
  return groups.map((group, i) => ({
    text: [head, title(i, groups.length), group.map((b) => b.block).join("\n")].join("\n\n"),
    paths: group.map((b) => b.path).filter(Boolean),
    keys: group.map((b) => b.key).filter(Boolean),
  }));
}

export function target(f) {
  return [f.wiki, f.page, f.section].filter(Boolean).join(" › ");
}

const KIND_WORDS = [
  [/^new\s*wiki/, "wiki"],
  [/^new\s*page|^page/, "page"],
  [/^add|^addition|^update/, "add"],
  [/^conflict|^contradict/, "conflict"],
  [/link/, "link"],
  [/^fix|^correct|^stale|^wrong/, "fix"],
];

/**
 * Findings from a reply. Lenient about what chat apps and models do to the
 * format: fences, "**kind:**" and bulleted fields, "=== finding 1" headers,
 * any case, and prose before, between or after the findings.
 * Returns {findings, problems, none}.
 */
export function parseFindings(reply) {
  const findings = [];
  const problems = [];
  const text = unfence(reply);
  if (/^[ \t>*_#-]*===\s*none\b/im.test(text) && !/===\s*finding/i.test(text)) return { findings, problems, none: true };
  const blocks = text.split(/^[ \t>*_#-]*===\s*finding\b.*$/im).slice(1);
  if (!blocks.length) problems.push("No findings were found in the reply. Paste the AI's whole answer, starting at the first === finding.");
  for (const block of blocks) {
    const fields = readFields(block, ["kind", "wiki", "page", "section", "title", "why", "sources"]);
    const kindText = clean(fields.kind).replace(/`/g, "").toLowerCase();
    const kind = KIND_WORDS.find(([re]) => re.test(kindText))?.[1] ?? "fix";
    if (!fields.title && !fields.why) {
      problems.push(`A finding had no title or reason and was skipped.`);
      continue;
    }
    findings.push({
      kind,
      wiki: clean(fields.wiki),
      page: clean(fields.page),
      section: clean(fields.section),
      title: clean(fields.title) || clean(fields.why).slice(0, 80),
      why: clean(fields.why),
      sources: splitSources(fields.sources),
    });
  }
  return { findings, problems };
}

// Write --------------------------------------------------------------------------

const WRITE_TASK = `The person approved the findings below. Write the wiki pages they call for.

- Write for a reader new to the subject: plain words, short paragraphs, one idea per section. Explain a term or symbol where it is first used.
- Keep a page's existing structure and wording except where a finding needs a change. Don't drop anything without a reason.
- Put each paragraph on a single line. Use Markdown: ## headings, lists, tables, **bold**, and [[Page title]] links to other wiki pages.
- Start every page with its YAML properties between --- lines. Keep the existing ones. Give each page a one-line "summary". Add each note a page draws on to "sources" as a list of links, like "[[Daily/2026-09-27]]".
- Say only what the notes support. Label illustrative numbers as illustrative.
- For a new wiki, write its Home.md (a summary and a short introduction) and its first pages.

Reply with whole pages only, each in exactly this form, and nothing else:

=== page: Wikis/Night sky/Finding Saturn.md
changes:
- Where to look: adds the rising time from 27 September
=== text
(the whole page, properties first)
=== end

"changes" lists each section you changed and why, one line each. Use the page paths given below; a new page goes in its wiki's folder.`;

/**
 * Write prompts, one per round.
 * groups: [{key, findings, page: {path, text} | null, notes: [{path, text}]}]
 * instructions: {wikiName: text}
 * Returns [{text, keys}], `keys` being the groups in each round.
 */
export function writePrompts({ groups, instructions, wikisFolder }) {
  const wikisInvolved = [...new Set(groups.flatMap((g) => g.findings.map((f) => f.wiki)).filter(Boolean))];
  const head = [
    ROLE,
    WRITE_TASK.replace("Wikis/Night sky/Finding Saturn.md", `${wikisFolder}/Night sky/Finding Saturn.md`),
    wikisInvolved.some((w) => instructions[w])
      ? "# Instructions\n\n" + wikisInvolved.filter((w) => instructions[w]).map((w) => `## ${w}\n${instructions[w].trim()}`).join("\n\n")
      : "",
  ].filter(Boolean).join("\n\n");
  const blocks = groups.map((g) => ({
    key: g.key,
    block: [
      `## ${g.page ? `Page: ${g.page.path}` : `New: ${g.newPath}`}`,
      "Findings:",
      g.findings.map((f, i) => `${i + 1}. [${KINDS[f.kind] ?? f.kind}] ${target(f)}: ${f.title}. ${f.why}`).join("\n"),
      g.page ? `=== current: ${g.page.path}\n${g.page.text.trim()}\n=== end` : "",
      g.notes.map((n) => noteBlock(n)).join("\n"),
    ].filter(Boolean).join("\n\n"),
  }));
  return rounds(head, blocks, (i, total) =>
    `# What to write${total > 1 ? ` (part ${i + 1} of ${total}; the other parts come in separate messages)` : ""}`);
}

/**
 * Pages from a reply: {pages: [{path, changes: [{section, reason}], text}], problems}.
 * A page runs from its "=== page:" line to its last "=== end" (so a page may
 * itself contain one), or to the next page if the end marker was forgotten.
 */
export function parsePages(reply) {
  const pages = [];
  const problems = [];
  const text = unfence(reply);
  const headers = [...text.matchAll(/^[ \t>*_#-]*===\s*page:\s*(.+?)\s*$/gim)];
  headers.forEach((m, i) => {
    const path = cleanPath(m[1]);
    let body = text.slice(m.index + m[0].length, i + 1 < headers.length ? headers[i + 1].index : text.length);
    const ends = [...body.matchAll(/^[ \t>*_#-]*===\s*end\s*$/gim)];
    if (ends.length) body = body.slice(0, ends[ends.length - 1].index);
    else problems.push(`"${path}" had no === end, so check that it came through whole.`);
    // The page starts after "=== text"; without it, at its first "---" or "#" line.
    let split = /^[ \t>*_#-]*===\s*text\s*$/im.exec(body);
    let head = "";
    let page = body;
    if (split) {
      head = body.slice(0, split.index);
      page = body.slice(split.index + split[0].length);
    } else if ((split = /^(---|#{1,6}\s)/m.exec(body))) {
      head = body.slice(0, split.index);
      page = body.slice(split.index);
    }
    page = unfence(page.replace(/^\s*\n/, "")).replace(/\s+$/, "") + "\n";
    const changes = [];
    for (const line of head.split("\n")) {
      const item = /^\s*[-*]\s*(.+?)\s*:\s*(.+)$/.exec(line);
      if (item) changes.push({ section: clean(item[1]), reason: item[2].trim() });
    }
    pages.push({ path, changes, text: page });
  });
  if (!pages.length) problems.push("No pages were found in the reply. Paste the AI's whole answer, from the first === page: to the last === end.");
  return { pages, problems };
}

/** A page path as a model may write it: in bold, in [[ ]], in quotes or backticks, without ".md". */
function cleanPath(value) {
  let path = String(value).trim().replace(/^\*\*|\*\*$/g, "").replace(/^\[\[|\]\]$/g, "").replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!/\.md$/i.test(path)) path += ".md";
  return path;
}

// Helpers -----------------------------------------------------------------------------

/** Drop a ``` fence a chat app may have put around the whole reply (or a page). */
function unfence(text) {
  const t = String(text ?? "").replace(/\r\n/g, "\n");
  const m = /^\s*```[\w-]*[ \t]*\n([\s\S]*?)\n```[ \t]*\s*$/.exec(t);
  return m ? m[1] + "\n" : t;
}

/**
 * "key: value" lines, where a value runs on until the next known key or a
 * blank line. Keys may be bold or bulleted ("- **kind:** add"). A key seen
 * once in a block is not read again, so a reason whose next line begins
 * "Page: 12 …" stays one reason.
 */
function readFields(block, keys) {
  const fields = {};
  let key = null;
  const keyRe = new RegExp(`^[\\s>*-]*\\**\\s*(${keys.join("|")})\\s*\\**\\s*:\\s*\\**\\s*(.*)$`, "i");
  for (const line of block.split("\n")) {
    const m = keyRe.exec(line);
    // "why" is free text: once it starts, only "sources" can follow it.
    if (m && !(m[1].toLowerCase() in fields) && (key !== "why" || m[1].toLowerCase() === "sources")) {
      key = m[1].toLowerCase();
      fields[key] = m[2];
    } else if (!line.trim()) {
      key = null;
    } else if (key) {
      fields[key] += " " + line.trim();
    }
  }
  return fields;
}

function clean(value) {
  return (value ?? "").trim().replace(/^["']|["']$/g, "").replace(/^\*\*|\*\*$/g, "").trim();
}

/** Note paths from a sources field; anything after a path (a stray sentence) is dropped. */
function splitSources(value) {
  return (value ?? "")
    .split(/,|;|\n/)
    .map((s) => {
      let item = s.trim().replace(/^["'`*]+|["'`*]+$/g, "");
      const link = /^\[\[([^\]|#]+)/.exec(item);
      if (link) return link[1].trim();
      const md = /^(.+?\.md)\b/i.exec(item);
      return (md ? md[1] : item).trim();
    })
    .filter(Boolean);
}
