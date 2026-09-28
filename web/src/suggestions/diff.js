// Reviewing a draft: the lines it keeps, removes and adds, grouped into
// changes that are accepted or rejected one at a time.

// Past this many cells, a line-by-line comparison would take seconds and
// hundreds of megabytes, so the differing middle becomes one change instead.
const DIFF_LIMIT = 4_000_000;

/** Line operations turning `a` into `b`: [{type: "same" | "del" | "add", line}]. */
export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const n = x.length;
  const m = y.length;
  const ops = a.slice(0, start).map((line) => ({ type: "same", line }));
  if (n * m > DIFF_LIMIT) {
    for (const line of x) ops.push({ type: "del", line });
    for (const line of y) ops.push({ type: "add", line });
  } else {
    // Longest common subsequence over what differs.
    const lcs = new Int32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * (m + 1) + j] = x[i] === y[j]
          ? lcs[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) {
        ops.push({ type: "same", line: x[i++] });
        j++;
      } else if (j < m && (i === n || lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j])) {
        ops.push({ type: "add", line: y[j++] });
      } else {
        ops.push({ type: "del", line: x[i++] });
      }
    }
  }
  for (const line of a.slice(endA)) ops.push({ type: "same", line });
  // Within a run of changes, show what goes before what replaces it.
  for (let k = 0; k < ops.length;) {
    if (ops[k].type === "same") {
      k++;
      continue;
    }
    let e = k;
    while (e < ops.length && ops[e].type !== "same") e++;
    const run = ops.slice(k, e);
    ops.splice(k, e - k, ...run.filter((o) => o.type === "del"), ...run.filter((o) => o.type === "add"));
    k = e;
  }
  return ops;
}

const lines = (text) => (text ? text.replace(/\r\n/g, "\n").split("\n") : []);

/** The line ending a page uses, so a change keeps the page's own. */
const eol = (text) => (text && text.includes("\r\n") ? "\r\n" : "\n");

const HEADING = /^#{1,6}\s/;
const FENCE = /^\s{0,3}(```|~~~)/;
const cache = new Map();

/**
 * A draft's changes. Each hunk is a run of removed and added lines between
 * unchanged ones: {index, from, to (into ops), section, del: [], add: []}.
 * `section` is the heading the change sits under ("Properties" in the
 * frontmatter), or the heading it adds or changes. Results are cached, since
 * the review asks for the same draft many times.
 */
export function changes(base, draft) {
  const key = `${base ?? ""}\u0000${draft}`;
  if (cache.has(key)) return cache.get(key);
  const result = compute(base, draft);
  cache.set(key, result);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return result;
}

function compute(base, draft) {
  const ops = diffLines(lines(base), lines(draft));
  const hunks = [];
  let heading = null;
  let inFront = false;
  let inCode = false;
  let newLine = 0;
  for (let k = 0; k < ops.length;) {
    const op = ops[k];
    if (op.type === "same") {
      track(op.line);
      k++;
      continue;
    }
    let e = k;
    while (e < ops.length && ops[e].type !== "same") e++;
    const run = ops.slice(k, e);
    const add = run.filter((o) => o.type === "add").map((o) => o.line);
    const del = run.filter((o) => o.type === "del").map((o) => o.line);
    // A change that adds or rewrites a heading is about that heading's section.
    const ownHeading = !inCode && (add.find((l) => HEADING.test(l)) ?? del.find((l) => HEADING.test(l)));
    const section = inFront || (newLine === 0 && add[0] === "---")
      ? "Properties"
      : ownHeading ? ownHeading.replace(/^#+\s*/, "").trim() : (heading ?? "Top of the page");
    hunks.push({ index: hunks.length, from: k, to: e, section, del, add });
    for (const l of add) track(l);
    k = e;
  }
  return { ops, hunks };

  function track(line) {
    if (newLine === 0 && line === "---") inFront = true;
    else if (inFront && (line === "---" || line === "...")) inFront = false;
    else if (!inFront && FENCE.test(line)) inCode = !inCode;
    else if (!inFront && !inCode && HEADING.test(line)) heading = line.replace(/^#+\s*/, "").trim();
    newLine++;
  }
}

/** The page after accepting some changes: accepted hunks take the draft's lines, others keep the page's. */
export function applyChanges(base, draft, accepted) {
  const { ops, hunks } = changes(base, draft);
  const take = new Set(accepted);
  const out = [];
  let k = 0;
  for (const hunk of hunks) {
    for (; k < hunk.from; k++) out.push(ops[k].line);
    out.push(...(take.has(hunk.index) ? hunk.add : hunk.del));
    k = hunk.to;
  }
  for (; k < ops.length; k++) out.push(ops[k].line);
  return out.join(eol(base ?? draft));
}

/** The runs of change turning `a` into `b`, by position in `a`: [{from, to, lines}]. */
function edits(a, b) {
  const out = [];
  let i = 0;
  let current = null;
  for (const op of diffLines(a, b)) {
    if (op.type === "same") {
      if (current) out.push(current);
      current = null;
      i++;
      continue;
    }
    current ??= { from: i, to: i, lines: [] };
    if (op.type === "del") current.to = ++i;
    else current.lines.push(op.line);
  }
  if (current) out.push(current);
  return out;
}

const sameEdit = (x, y) => x.from === y.from && x.to === y.to && x.lines.join("\n") === y.lines.join("\n");

/**
 * Carry a draft's changes over to a page edited since the draft was written.
 * Changes from base to `mine` (the page now) are all kept; changes from base
 * to `theirs` (the draft) are added where they don't touch the same lines. A
 * draft change the page already has is kept once and is no clash. Returns
 * {text, clashes}: the merged page and how many draft changes clashed.
 */
export function merge3(base, mine, theirs) {
  const b = lines(base);
  const ours = edits(b, lines(mine)).map((e) => ({ ...e, side: 0 }));
  const drafts = edits(b, lines(theirs)).map((e) => ({ ...e, side: 1 }));
  const overlap = (x, y) => (x.from < y.to && y.from < x.to) || (x.from === y.from && (x.from === x.to || y.from === y.to));
  const already = drafts.filter((d) => ours.some((o) => sameEdit(o, d)));
  const kept = drafts.filter((d) => !already.includes(d) && !ours.some((o) => overlap(o, d)));
  const clashes = drafts.length - kept.length - already.length;
  const all = [...ours, ...kept].sort((x, y) => x.from - y.from || x.side - y.side);
  const out = [];
  let i = 0;
  for (const e of all) {
    for (; i < e.from; i++) out.push(b[i]);
    out.push(...e.lines);
    i = Math.max(i, e.to);
  }
  for (; i < b.length; i++) out.push(b[i]);
  return { text: out.join(eol(mine)), clashes };
}
