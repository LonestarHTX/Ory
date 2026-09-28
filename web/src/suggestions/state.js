// Suggestions state: findings, drafts, what has been read and what was done,
// kept by the server in Wikis/.ory/suggestions.json. This module loads it,
// saves it, and runs the steps between: gathering what a prompt needs,
// reading replies into findings and drafts, and applying accepted changes.

import { api } from "../api.js";
import { folderOf, noteName } from "../links.js";
import { emit, loadIndex, store } from "../store.js";
import { todayISO } from "../ui/dom.js";
import { inWikis, pageParts, wikiFolder, wikiOf, wikis } from "../wikis.js";
import { applyChanges, changes, merge3 } from "./diff.js";
import { findPrompts, KINDS, parseFindings, parsePages, target, writePrompts } from "./prompts.js";

const empty = () => ({ version: 1, read: {}, findings: [], drafts: [], history: [], lastRun: null });

export const suggestions = { data: empty(), rev: null, loaded: false };

let seq = 0;
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function loadSuggestions() {
  const { data, rev } = await api.suggestions();
  suggestions.data = { ...empty(), ...(data ?? {}) };
  suggestions.rev = rev;
  suggestions.loaded = true;
  emit("suggestions");
}

/**
 * Change the state and save it. Another writer (an agent filing suggestions,
 * another window) may have saved first: then the latest state is loaded and
 * the change made again on it. Changes find things by id, so they apply the
 * same way to the newer state.
 */
export async function update(change) {
  for (let attempt = 0; ; attempt++) {
    const next = structuredClone(suggestions.data);
    change(next);
    try {
      const { rev } = await api.saveSuggestions(next, suggestions.rev);
      suggestions.data = next;
      suggestions.rev = rev;
      break;
    } catch (err) {
      if (err.status !== 409 || attempt >= 3) {
        if (err.status === 409) await loadSuggestions();
        throw err;
      }
      await loadSuggestions();
    }
  }
  emit("suggestions");
}

// Counts ------------------------------------------------------------------------------

export const openFindings = () => suggestions.data.findings.filter((f) => f.status === "open");
export const approvedFindings = () => suggestions.data.findings.filter((f) => f.status === "approved");
export const drafts = () => suggestions.data.drafts;

/** What needs you: findings to decide and drafts to review. */
export const waiting = () => openFindings().length + drafts().length;

/** Notes changed since they were last read. Wiki pages are the output, never the input. */
export function unreadNotes() {
  const read = suggestions.data.read;
  return store.notes.filter((n) => !inWikis(n.path) && !(read[n.path] >= n.mtime));
}

// Find ----------------------------------------------------------------------------------

/** Everything the find prompt needs, as rounds: [{text, paths, mtimes}]. */
export async function prepareFind() {
  const notes = unreadNotes();
  const all = wikis();
  const pagePaths = all.flatMap((w) => [w.home, ...w.pages, ...w.sections.flatMap((s) => s.pages), ...w.upkeep]).filter(Boolean).map((n) => n.path);
  const { notes: texts } = await api.readNotes([...pagePaths, ...notes.map((n) => n.path)]);
  const textOf = new Map(texts.map((t) => [t.path, t.text]));
  const summaries = all.map((w) => ({
    name: w.name,
    instructions: instructionsOf(w, textOf),
    pages: [w.home, ...w.pages, ...w.sections.flatMap((s) => s.pages)].filter(Boolean).map((n) => {
      const text = textOf.get(n.path) ?? "";
      return {
        title: w.home && n.path === w.home.path ? "Home" : (folderOf(n.path) === w.folder ? "" : folderOf(n.path).slice(w.folder.length + 1) + "/") + noteName(n.path),
        summary: String(n.properties?.summary ?? ""),
        headings: [...pageParts(text).body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 20),
      };
    }),
  }));
  const decided = suggestions.data.findings.filter((f) => f.status !== "open");
  // Empty notes have nothing to say; they are marked read with the first round.
  const worth = notes.filter((n) => pageParts(textOf.get(n.path) ?? "").body.trim());
  const blank = notes.filter((n) => !worth.includes(n));
  const rounds = findPrompts({
    wikis: summaries,
    notes: worth.map((n) => ({ path: n.path, text: textOf.get(n.path) ?? "", mtime: n.mtime })),
    decided,
    wikisFolder: store.wikisFolder,
  });
  const mtimes = Object.fromEntries(notes.map((n) => [n.path, n.mtime]));
  if (!rounds.length && blank.length) {
    await update((data) => Object.assign(data.read, Object.fromEntries(blank.map((n) => [n.path, n.mtime]))));
  }
  return rounds.map((r, i) => ({
    ...r,
    mtimes: Object.fromEntries([...r.paths, ...(i === 0 ? blank.map((n) => n.path) : [])].map((p) => [p, mtimes[p]])),
  }));
}

function instructionsOf(w, textOf) {
  const page = w.upkeep.find((n) => noteName(n.path).toLowerCase() === "instructions");
  return page ? pageParts(textOf.get(page.path) ?? "").body.trim() : "";
}

/** Read a find reply into open findings, and mark the round's notes as read. */
export async function takeFindings(round, reply) {
  const { findings, problems, none } = parseFindings(reply);
  if (!findings.length && !none) return { added: 0, problems };
  const known = new Set(store.paths);
  const now = Date.now();
  await update((data) => {
    for (const f of findings) {
      data.findings.push({
        id: newId("f"),
        ...f,
        sources: f.sources.map((s) => resolveNote(s, known)).filter(Boolean),
        status: "open",
        created: now,
      });
    }
    Object.assign(data.read, round.mtimes);
    data.lastRun = now;
  });
  return { added: findings.length, problems };
}

function resolveNote(source, known) {
  const path = /\.md$/i.test(source) ? source : source + ".md";
  if (known.has(path)) return path;
  // A bare name: the note with that name, if there is just one.
  const matches = store.byName.get(noteName(path).toLowerCase()) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export async function decide(id, status) {
  await update((data) => {
    const f = data.findings.find((x) => x.id === id);
    if (f) {
      f.status = status;
      f.decided = Date.now();
    }
  });
}

// Write --------------------------------------------------------------------------------

/** The wiki a finding names, as its folder is actually spelt, or a new one's name. */
function wikiName(name) {
  const want = String(name ?? "").trim();
  return wikis().find((w) => w.name.toLowerCase() === want.toLowerCase())?.name ?? want;
}

/**
 * Where a finding's page lives: its existing path, or where a new one would
 * go. Wiki and page names match whatever their case, and a page given as a
 * whole path ("Wikis/Night sky/Finding Saturn.md") is taken as it is.
 */
export function pagePathFor(f) {
  if (!f.wiki) return null;
  const wiki = wikiName(f.wiki);
  const folder = wikiFolder(wiki);
  if (f.kind === "wiki") return `${folder}/Home.md`;
  if (!f.page) return null;
  let page = f.page.trim().replace(/\.md$/i, "");
  const inside = `${folder}/`.toLowerCase();
  if (page.toLowerCase().startsWith(inside)) page = page.slice(inside.length);
  else if (page.toLowerCase().startsWith(`${store.wikisFolder}/`.toLowerCase())) page = page.slice(page.indexOf("/", store.wikisFolder.length + 1) + 1);
  const want = page.toLowerCase();
  const pages = store.notes.filter((n) => n.path.toLowerCase().startsWith(inside));
  const existing = pages.find((n) => n.path.slice(folder.length + 1).replace(/\.md$/i, "").toLowerCase() === want)
    ?? (page.includes("/") ? null : pages.filter((n) => noteName(n.path).toLowerCase() === want).length === 1
      ? pages.find((n) => noteName(n.path).toLowerCase() === want) : null);
  return existing?.path ?? `${folder}/${page}.md`;
}

const samePath = (a, b) => a != null && b != null && a.toLowerCase() === b.toLowerCase();

/**
 * The write prompt's rounds for the approved findings: [{text, keys, findingIds, bases}].
 * A page that already has a draft waiting is written on from that draft, and
 * the new draft carries both sets of findings, so nothing drafted is lost.
 */
export async function prepareWrite() {
  const approved = approvedFindings();
  const groups = new Map();
  for (const f of approved) {
    const key = pagePathFor(f) ?? `?${f.id}`;
    if (!groups.has(key)) groups.set(key, { key, findings: [] });
    groups.get(key).findings.push(f);
  }
  const pending = new Map(drafts().map((d) => [d.path, d]));
  for (const [key, g] of groups) {
    const d = pending.get(key);
    if (!d) continue;
    g.draft = d;
    g.findings.push(...suggestions.data.findings.filter((f) => d.findingIds.includes(f.id) && !g.findings.includes(f)));
  }
  const existing = [...groups.keys()].filter((k) => store.paths.includes(k));
  const sources = [...new Set(approved.flatMap((f) => f.sources))];
  const instructionPaths = [...new Set(approved.map((f) => f.wiki).filter(Boolean))]
    .map((w) => `${wikiFolder(w)}/Instructions.md`).filter((p) => store.paths.includes(p));
  const { notes: texts } = await api.readNotes([...existing, ...sources, ...instructionPaths]);
  const byPath = new Map(texts.map((t) => [t.path, t]));
  const instructions = {};
  for (const p of instructionPaths) instructions[wikiOf(p)] = pageParts(byPath.get(p)?.text ?? "").body;
  const list = [...groups.values()].map((g) => ({
    ...g,
    page: g.draft ? { path: g.key, text: g.draft.text }
      : byPath.has(g.key) ? { path: g.key, text: byPath.get(g.key).text } : null,
    newPath: g.key.startsWith("?") ? "a page of your choosing in the right wiki" : g.key,
    notes: [...new Set(g.findings.flatMap((f) => f.sources))].map((p) => byPath.get(p)).filter(Boolean),
  }));
  const rounds = writePrompts({ groups: list, instructions, wikisFolder: store.wikisFolder });
  const bases = Object.fromEntries(existing.map((p) => [p, byPath.get(p)?.text ?? null]));
  return rounds.map((r) => ({ ...r, findingIds: r.keys.flatMap((k) => groups.get(k).findings.map((f) => f.id)), bases }));
}

/** Whether a path is one the AI may write: a Markdown page inside a wiki. */
function writable(path) {
  if (!path || !/\.md$/i.test(path) || !wikiOf(path)) return false;
  return !path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."));
}

/** Read a write reply into drafts. Findings the round covered become "drafted". */
export async function takePages(round, reply) {
  const { pages, problems } = parsePages(reply);
  const ok = [];
  for (const p of pages) {
    const path = p.path.replace(/^\/+/, "");
    if (!writable(path)) problems.push(`"${p.path}" is not a page inside a wiki, so it was skipped.`);
    else ok.push({ ...p, path });
  }
  if (!ok.length) return { added: 0, problems };
  // A page the prompt didn't include (the AI chose to touch it): compare with it as it is now.
  const missing = ok.map((p) => p.path).filter((p) => !(p in round.bases) && store.paths.includes(p));
  const extra = missing.length ? (await api.readNotes(missing)).notes : [];
  const bases = { ...round.bases, ...Object.fromEntries(extra.map((n) => [n.path, n.text])) };
  const findings = suggestions.data.findings.filter((f) => round.findingIds.includes(f.id));
  // Which findings each page answers: those whose page it is (or whose new
  // wiki it's in); findings with no page of their own go with a page from
  // their wiki, or with the first page if they name no wiki.
  const answers = new Map(ok.map((p) => [p.path, new Set()]));
  const pageless = [];
  for (const f of findings) {
    const own = ok.find((p) => samePath(pagePathFor(f), p.path) || (f.kind === "wiki" && samePath(wikiOf(p.path), wikiName(f.wiki))));
    if (own) answers.get(own.path).add(f.id);
    else if (!pagePathFor(f)) pageless.push(f);
  }
  for (const f of pageless) {
    const home = ok.find((p) => f.wiki && samePath(wikiOf(p.path), wikiName(f.wiki))) ?? (f.wiki ? null : ok[0]);
    if (home) answers.get(home.path).add(f.id);
  }
  const covered = new Set([...answers.values()].flatMap((s) => [...s]));
  const unchanged = [];
  await update((data) => {
    for (const p of ok) {
      const base = bases[p.path] ?? null;
      const ids = [...answers.get(p.path)];
      // A page that comes back as it already is changes nothing: no draft.
      if (base != null && base.replace(/\r\n/g, "\n").trimEnd() === p.text.replace(/\r\n/g, "\n").trimEnd()) {
        unchanged.push(p.path);
        ids.forEach((id) => covered.delete(id));
        continue;
      }
      const previous = data.drafts.find((d) => d.path === p.path);
      data.drafts = data.drafts.filter((d) => d !== previous);
      data.drafts.push({
        id: newId("d"),
        path: p.path,
        base: previous ? previous.base : base,
        text: p.text,
        changes: p.changes,
        findingIds: [...new Set([...(previous?.findingIds ?? []), ...ids])],
        accepted: [],
        rejected: [],
        created: Date.now(),
      });
    }
    // Findings no page answered stay approved, to write again or dismiss.
    for (const f of data.findings) if (covered.has(f.id) && f.status === "approved") f.status = "drafted";
  });
  if (unchanged.length) problems.push(`${unchanged.length === 1 ? "A page" : `${unchanged.length} pages`} came back unchanged, so there is nothing to review for ${unchanged.length === 1 ? "it" : "them"}.`);
  const left = findings.filter((f) => f.status === "approved" && !covered.has(f.id)).length;
  if (left) problems.push(`${left} approved ${left === 1 ? "finding" : "findings"} got no page back and stay approved.`);
  return { added: ok.length - unchanged.length, problems };
}

export async function decideChange(draftId, index, verdict) {
  await update((data) => {
    const d = data.drafts.find((x) => x.id === draftId);
    if (!d) return;
    d.accepted = d.accepted.filter((i) => i !== index);
    d.rejected = d.rejected.filter((i) => i !== index);
    if (verdict === "accept") d.accepted.push(index);
    if (verdict === "reject") d.rejected.push(index);
  });
}

export async function decideAll(draftId, verdict) {
  await update((data) => {
    const d = data.drafts.find((x) => x.id === draftId);
    if (!d) return;
    const all = changes(d.base ?? "", d.text).hunks.map((h) => h.index);
    d.accepted = verdict === "accept" ? all : [];
    d.rejected = verdict === "reject" ? all : [];
  });
}

/**
 * Save every draft's accepted changes; changes not accepted are left out. A
 * page edited since its draft was written is not touched: its draft is
 * compared again with the page as it is now and left for another look. A
 * draft whose every change was rejected is set aside. Returns
 * {applied, rebased, failed}.
 */
export async function applyDrafts() {
  const ready = drafts().filter((d) => d.accepted.length);
  // Set aside: drafts whose every change was rejected, and drafts with no change left.
  const turnedDown = drafts().filter((d) => {
    const count = changes(d.base ?? "", d.text).hunks.length;
    return !d.accepted.length && d.rejected.length === count;
  });
  const existing = ready.map((d) => d.path).filter((p) => store.paths.includes(p));
  const { notes: now } = existing.length ? await api.readNotes(existing) : { notes: [] };
  const current = new Map(now.map((n) => [n.path, n]));
  const applied = [];
  const rebased = [];
  const failed = [];
  for (const d of ready) {
    const page = current.get(d.path);
    try {
      if (d.base == null) {
        if (page) {
          // Written as a new page, but a page by that name appeared since:
          // show the draft against that page instead.
          rebased.push({ ...d, base: page.text, clashes: 0 });
          continue;
        }
        await api.create(d.path, applyChanges("", d.text, d.accepted));
      } else if (!page) {
        failed.push(`${noteName(d.path)} no longer exists.`);
        continue;
      } else if (page.text !== d.base) {
        // Edited since: keep those edits and carry the draft's changes over to them.
        const merged = merge3(d.base, page.text, d.text);
        rebased.push({ ...d, base: page.text, text: merged.text, clashes: merged.clashes });
        continue;
      } else {
        await api.save(d.path, applyChanges(d.base, d.text, d.accepted), page.rev);
      }
      applied.push(d);
    } catch (err) {
      failed.push(`${noteName(d.path)}: ${err.message}`);
    }
  }
  await writeLogs(applied);
  const doneIds = new Set([...applied, ...turnedDown].map((d) => d.id));
  await update((data) => {
    const byId = new Map(data.findings.map((f) => [f.id, f]));
    for (const d of turnedDown) {
      for (const id of d.findingIds) {
        const f = byId.get(id);
        if (f) {
          f.status = "dismissed";
          f.decided = Date.now();
        }
      }
    }
    for (const d of applied) {
      for (const id of d.findingIds) {
        const f = byId.get(id);
        if (f) {
          f.status = "applied";
          f.decided = Date.now();
        }
      }
      data.history.push({ at: Date.now(), path: d.path, created: d.base == null, findings: d.findingIds.map((id) => byId.get(id)?.title).filter(Boolean) });
    }
    data.drafts = data.drafts.filter((d) => !doneIds.has(d.id)).map((d) => {
      const r = rebased.find((x) => x.id === d.id);
      if (!r) return d;
      // Looked at again from scratch: the page moved on, so earlier choices may not fit.
      return { ...d, base: r.base, text: r.text ?? d.text, accepted: [], rejected: [], rebased: true, clashes: r.clashes ?? 0 };
    });
  });
  await loadIndex();
  return { applied: applied.length, rebased: rebased.length, failed, turnedDown: turnedDown.length };
}

/** A line in each wiki's Log.md for what was just applied. */
async function writeLogs(applied) {
  const byWiki = new Map();
  for (const d of applied) {
    const w = wikiOf(d.path);
    if (!byWiki.has(w)) byWiki.set(w, []);
    byWiki.get(w).push(d);
  }
  const findings = new Map(suggestions.data.findings.map((f) => [f.id, f]));
  for (const [w, list] of byWiki) {
    const path = `${wikiFolder(w)}/Log.md`;
    const lines = list.map((d) => {
      const titles = d.findingIds.map((id) => findings.get(id)?.title).filter(Boolean);
      const sources = [...new Set(d.findingIds.flatMap((id) => findings.get(id)?.sources ?? []))]
        .map((p) => `[[${p.replace(/\.md$/i, "")}]]`);
      return `- ${d.base == null ? "Added" : "Changed"} [[${noteName(d.path)}]]${titles.length ? `: ${titles.join("; ")}` : ""}${sources.length ? ` (from ${sources.join(", ")})` : ""}`;
    });
    const entry = `## ${todayISO()} · Suggestions applied\n\n${lines.join("\n")}\n`;
    try {
      const [log] = (await api.readNotes([path])).notes;
      if (log) await api.save(path, log.text.replace(/\s*$/, "\n\n") + entry, log.rev);
      else await api.create(path, `# Log\n\nWhat changed in this wiki, and why.\n\n${entry}`);
    } catch {
      /* the pages are saved; a missing log line is not worth failing over */
    }
  }
}

export async function discardDrafts() {
  await update((data) => {
    const ids = new Set(data.drafts.flatMap((d) => d.findingIds));
    for (const f of data.findings) if (ids.has(f.id) && f.status === "drafted") f.status = "approved";
    data.drafts = [];
  });
}

export { KINDS, target };
