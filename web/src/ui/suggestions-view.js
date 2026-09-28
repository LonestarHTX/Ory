// Suggestions: the AI's findings about the wikis, and the drafts written
// from the ones you approve. Every step goes through the AI you paste into:
// Ory shows the prompt to copy and reads the reply you paste back.
//
// Findings: approve or dismiss each. Write drafts: whole pages come back and
// each change on them is accepted or rejected. Apply saves what was accepted.

import { alertError, notify, openNote, openSettings } from "../actions.js";
import { noteName } from "../links.js";
import { on, store } from "../store.js";
import { changes } from "../suggestions/diff.js";
import {
  applyDrafts, approvedFindings, decide, decideAll, decideChange, discardDrafts, drafts, KINDS, openFindings,
  prepareFind, prepareWrite, suggestions, takeFindings, takePages, target, unreadNotes,
} from "../suggestions/state.js";
import { wikiOf } from "../wikis.js";
import { formatDate, h, icon, timeAgo } from "./dom.js";

const KIND_ICONS = { page: "plus", add: "plus", conflict: "warning", link: "link", wiki: "book", fix: "edit" };

export function createSuggestionsView(el) {
  let tab = "findings";
  let run = null; // {kind, rounds, index, problems, copied, showPrompt}
  let selected = null; // the draft being reviewed
  let busy = false;

  function show(options = {}) {
    if (options.tab) tab = options.tab;
    document.title = "Suggestions · Ory";
    render();
    if (options.find && !run) startFind();
  }

  const work = async (fn) => {
    if (busy) return;
    busy = true;
    render();
    try {
      await fn();
    } catch (err) {
      alertError(err);
    } finally {
      busy = false;
      render();
    }
  };

  // Layout ---------------------------------------------------------------------------

  function render() {
    if (el.hidden) return;
    const scroll = el.querySelector(".sugg-body")?.scrollTop ?? 0;
    const pasting = document.activeElement?.matches?.(".sugg-paste")
      ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const unread = unreadNotes().length;
    const last = suggestions.data.lastRun;
    el.replaceChildren(
      h("header", { class: "note-head" },
        h("div", { class: "note-name" }, h("h1", { class: "note-heading" }, "Suggestions")),
        h("div", { class: "note-meta" },
          h("span", { class: "note-status" },
            last ? `Last run ${timeAgo(last)}` : "Not run yet",
            unread ? ` · ${unread} ${unread === 1 ? "note" : "notes"} to read` : ""),
          h("button", {
            class: "btn btn--small", type: "button",
            disabled: run || busy || !unread ? true : null,
            dataset: { tip: unread ? "Ask the AI what the wikis should gain from your notes" : "Every note has been read" },
            onClick: () => startFind(),
          }, icon("search", 14), "Find suggestions"))),
      h("div", { class: "sugg-tabs", role: "tablist" },
        tabButton("findings", "Findings", openFindings().length + approvedFindings().length),
        tabButton("drafts", "Drafts", drafts().length),
        tabButton("history", "History", null)),
      h("div", { class: `sugg-body${tab === "drafts" && !run && drafts().length ? " is-review" : ""}` },
        run ? runPanel() : null,
        tab === "findings" ? findingsTab() : tab === "drafts" ? draftsTab() : historyTab()));
    const body = el.querySelector(".sugg-body");
    if (body) body.scrollTop = scroll;
    const paste = el.querySelector(".sugg-paste");
    if (pasting && paste) {
      paste.focus();
      paste.setSelectionRange(...pasting);
    }
  }

  function tabButton(name, label, count) {
    return h("button", {
      class: `sugg-tab${tab === name ? " is-selected" : ""}`, type: "button", role: "tab",
      "aria-selected": String(tab === name),
      onClick: () => {
        tab = name;
        render();
      },
    }, label, count ? h("span", { class: "count" }, String(count)) : null);
  }

  // Copy and paste ---------------------------------------------------------------------

  function startFind() {
    work(async () => {
      const rounds = await prepareFind();
      if (!rounds.length) return notify("Every note has been read. New and changed notes will show up here.");
      run = { kind: "find", rounds, index: 0, problems: [] };
      tab = "findings";
    });
  }

  function startWrite() {
    work(async () => {
      const rounds = await prepareWrite();
      if (!rounds.length) return;
      run = { kind: "write", rounds, index: 0, problems: [] };
      tab = "drafts";
    });
  }

  function runPanel() {
    const round = run.rounds[run.index];
    const many = run.rounds.length > 1;
    const words = Math.round(round.text.split(/\s+/).length / 100) * 100;
    const reply = h("textarea", {
      class: "input sugg-paste",
      placeholder: run.kind === "find" ? "Paste the AI's reply here, starting at === finding" : "Paste the AI's reply here, starting at === page:",
      "aria-label": "The AI's reply",
      spellcheck: "false",
      value: run.reply ?? "",
      onInput: (e) => (run.reply = e.target.value),
    });
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(round.text);
        run.copied = run.index;
      } catch {
        run.showPrompt = true; // copy it by hand from the box
      }
      render();
      el.querySelector(".sugg-paste")?.focus();
    };
    const read = () => work(async () => {
      if (!reply.value.trim()) return;
      const result = run.kind === "find" ? await takeFindings(round, reply.value) : await takePages(round, reply.value);
      run.problems = result.problems;
      if (!result.added && result.problems.length) return; // nothing read: try again
      if (run.index + 1 < run.rounds.length) {
        run.index += 1;
        run.copied = null;
        run.showPrompt = false;
        run.reply = "";
      } else {
        const problems = run.problems;
        const kind = run.kind;
        run = null;
        if (problems.length) notify(problems.join(" "));
        if (kind === "write") {
          tab = "drafts";
          selected = null;
        }
      }
    });
    return h("section", { class: "sugg-run", "aria-label": run.kind === "find" ? "Find suggestions" : "Write drafts" },
      h("div", { class: "sugg-run-head" },
        h("h2", null, run.kind === "find" ? "Find suggestions" : "Write drafts"),
        many ? h("span", { class: "count" }, `Part ${run.index + 1} of ${run.rounds.length}`) : null,
        h("button", { class: "btn btn--small btn--plain", type: "button", onClick: () => ((run = null), render()) }, "Cancel")),
      h("ol", { class: "sugg-steps" },
        h("li", null,
          h("div", { class: "sugg-step-title" }, "Copy the prompt into your AI chat"),
          h("p", { class: "sugg-step-note" },
            run.kind === "find"
              ? `${round.paths.length} ${round.paths.length === 1 ? "note" : "notes"}, the wikis' pages and instructions, about ${words.toLocaleString()} words.`
              : `${round.findingIds.length} approved ${round.findingIds.length === 1 ? "finding" : "findings"} with their pages and notes, about ${words.toLocaleString()} words.`,
            many ? [" Use a new chat for each part, or say it continues. How big a part can be is in ",
              h("button", { class: "text-link", type: "button", onClick: () => openSettings("ai") }, "Settings"), "."] : ""),
          h("div", { class: "sugg-step-actions" },
            h("button", { class: `btn btn--small${run.copied === run.index ? "" : " btn--primary"}`, type: "button", onClick: copy },
              icon(run.copied === run.index ? "check" : "copy", 14), run.copied === run.index ? "Copied" : "Copy prompt"),
            h("button", {
              class: "btn btn--small btn--plain", type: "button",
              onClick: () => ((run.showPrompt = !run.showPrompt), render()),
            }, run.showPrompt ? "Hide prompt" : "Show prompt")),
          run.showPrompt ? h("textarea", { class: "input sugg-prompt", readonly: true, "aria-label": "The prompt", value: round.text }) : null),
        h("li", null,
          h("div", { class: "sugg-step-title" }, "Paste the whole reply here"),
          reply,
          run.problems.length
            ? h("ul", { class: "sugg-problems", role: "alert" }, run.problems.map((p) => h("li", null, h("span", { class: "status-dot warning" }), p)))
            : null,
          h("div", { class: "sugg-step-actions" },
            h("button", { class: "btn btn--small btn--primary", type: "button", disabled: busy ? true : null, onClick: read },
              run.kind === "find" ? "Read findings" : "Read drafts")))));
  }

  // Findings ------------------------------------------------------------------------------

  function findingsTab() {
    const open = openFindings();
    const approved = approvedFindings();
    const drafted = suggestions.data.findings.filter((f) => f.status === "drafted").length;
    if (!open.length && !approved.length) {
      if (run) return null;
      return h("div", { class: "sugg-empty" },
        h("p", null, "Ory asks an AI what your wikis should gain from your notes: new pages, additions, conflicts, links, even new wikis. You decide what's worth writing, and review every change before it's saved. The AI never changes your notes."),
        h("p", null, unreadNotes().length
          ? `${unreadNotes().length} ${unreadNotes().length === 1 ? "note hasn't" : "notes haven't"} been read yet. Choose Find suggestions to start.`
          : "Every note has been read. New and changed notes will be read next time."),
        drafted ? h("p", null, `${drafted} approved ${drafted === 1 ? "finding has a draft" : "findings have drafts"} to review under Drafts.`) : null);
    }
    return h("div", { class: "sugg-list" },
      open.length ? [h("h2", { class: "sugg-group" }, "To review", h("span", { class: "count" }, String(open.length))), open.map(findingCard)] : null,
      approved.length ? [h("h2", { class: "sugg-group" }, "Approved", h("span", { class: "count" }, String(approved.length))), approved.map(findingCard)] : null,
      approved.length ? h("div", { class: "sugg-bar" },
        h("span", { class: "grow" }, "Dismissed findings are remembered, so the AI won't raise them again."),
        h("button", { class: "btn btn--small btn--primary", type: "button", disabled: run || busy ? true : null, onClick: startWrite },
          icon("edit", 14), `Write ${approved.length} ${approved.length === 1 ? "draft" : "drafts"}`)) : null);
  }

  function findingCard(f) {
    const approvedNow = f.status === "approved";
    return h("article", { class: `finding${approvedNow ? " is-approved" : ""}` },
      h("div", { class: `finding-kind${f.kind === "conflict" ? " is-warning" : ""}` }, icon(KIND_ICONS[f.kind] ?? "edit", 14), KINDS[f.kind] ?? f.kind),
      h("div", { class: "finding-title" }, f.title),
      target(f) ? h("div", { class: "finding-target" }, target(f)) : null,
      f.why ? h("p", { class: "finding-why" }, f.why) : null,
      f.sources.length ? h("div", { class: "finding-sources" }, f.sources.map(sourceChip)) : null,
      h("div", { class: "finding-actions" },
        approvedNow
          ? [h("span", { class: "finding-done" }, icon("check", 14), "Approved"),
            h("button", { class: "btn btn--small", type: "button", onClick: () => work(() => decide(f.id, "open")) }, "Undo")]
          : [h("button", { class: "btn btn--small", type: "button", onClick: () => work(() => decide(f.id, "dismissed")) }, "Dismiss"),
            h("button", { class: "btn btn--small btn--primary", type: "button", onClick: () => work(() => decide(f.id, "approved")) }, "Approve")]));
  }

  function sourceChip(path) {
    return h("button", { class: "chip", type: "button", dataset: { tip: `Open ${path}` }, onClick: () => openNote(path) },
      icon("notebook", 12), noteName(path));
  }

  // Drafts ---------------------------------------------------------------------------------

  function draftsTab() {
    const list = drafts();
    if (!list.length) {
      return h("div", { class: "sugg-empty" },
        h("p", null, approvedFindings().length
          ? "Approved findings are written up as drafts: choose Write drafts under Findings."
          : "Drafts appear here once approved findings are written up. Each change is yours to accept or reject."));
    }
    if (!list.some((d) => d.id === selected)) selected = list[0].id;
    const draft = list.find((d) => d.id === selected);
    const stats = list.map((d) => ({ d, hunks: changes(d.base ?? "", d.text).hunks }));
    const total = stats.reduce((n, s) => n + s.hunks.length, 0);
    const accepted = list.reduce((n, d) => n + d.accepted.length, 0);
    // Apply also sets aside drafts whose every change was rejected.
    const settled = stats.some(({ d, hunks }) => !d.accepted.length && d.rejected.length === hunks.length);
    return h("div", { class: "review" },
      h("nav", { class: "review-list", "aria-label": "Drafts" },
        stats.map(({ d, hunks }) => {
          const add = hunks.reduce((n, x) => n + x.add.length, 0);
          const del = hunks.reduce((n, x) => n + x.del.length, 0);
          const decided = d.accepted.length + d.rejected.length;
          return h("button", {
            class: `review-item${d.id === selected ? " is-selected" : ""}`, type: "button",
            onClick: () => ((selected = d.id), render()),
          },
          icon(d.base == null ? "plus" : "file", 14),
          h("span", { class: "review-item-name" }, h("span", null, noteName(d.path)), h("span", { class: "review-item-wiki" }, wikiOf(d.path))),
          h("span", { class: "review-item-stat" },
            decided === hunks.length ? icon("check", 14) : null,
            d.base == null ? "new" : [h("span", { class: "is-add" }, `+${add}`), " ", h("span", { class: "is-del" }, `−${del}`)]));
        })),
      h("div", { class: "review-page" },
        draftReview(draft),
        h("div", { class: "sugg-bar" },
          h("span", { class: "grow" }, `${accepted} of ${total} ${total === 1 ? "change" : "changes"} accepted. Changes you don't accept are left out.`),
          h("button", {
            class: "btn btn--small", type: "button", disabled: busy ? true : null,
            onClick: () => confirm("Discard every draft? Their findings go back to Approved.") && work(discardDrafts),
          }, "Discard all"),
          h("button", {
            class: "btn btn--small btn--primary", type: "button", disabled: busy || (!accepted && !settled) ? true : null,
            onClick: () => work(async () => {
              const r = await applyDrafts();
              const parts = [];
              if (r.applied) parts.push(`Saved ${r.applied} ${r.applied === 1 ? "page" : "pages"}.`);
              if (r.rebased) parts.push(`${r.rebased} ${r.rebased === 1 ? "page was" : "pages were"} edited since ${r.rebased === 1 ? "its draft was" : "their drafts were"} written. Your edits are kept; look over the draft's changes again.`);
              if (r.failed.length) parts.push(r.failed.join(" "));
              if (parts.length) notify(parts.join(" "), r.failed.length ? "error" : "warning");
            }),
          }, "Apply accepted"))));
  }

  function draftReview(d) {
    const { ops, hunks } = changes(d.base ?? "", d.text);
    const findings = suggestions.data.findings.filter((f) => d.findingIds.includes(f.id));
    const reasonFor = (section) => d.changes.find((c) => c.section.toLowerCase() === section.toLowerCase())?.reason;
    const matched = new Set(d.base == null ? d.changes.slice(0, 1).map((c) => c.section.toLowerCase()) : hunks.map((x) => x.section.toLowerCase()));
    const otherReasons = d.changes.filter((c) => !matched.has(c.section.toLowerCase()));
    return h("div", { class: "review-draft" },
      h("div", { class: "review-head" },
        h("div", null,
          h("h2", null, noteName(d.path), d.base == null ? h("span", { class: "tag" }, "New page") : null),
          h("div", { class: "review-path" }, d.path)),
        h("div", { class: "review-head-actions" },
          d.base != null && store.paths.includes(d.path)
            ? h("button", { class: "btn btn--small btn--plain", type: "button", onClick: () => openNote(d.path) }, "Open page")
            : null,
          h("button", { class: "btn btn--small", type: "button", onClick: () => work(() => decideAll(d.id, "reject")) }, "Reject all"),
          h("button", { class: "btn btn--small", type: "button", onClick: () => work(() => decideAll(d.id, "accept")) }, "Accept all"))),
      d.rebased ? h("p", { class: "review-note" }, h("span", { class: "status-dot warning" }),
        "This page was edited after the draft was written. Your edits are kept, and the draft's changes are shown against the page as it is now.",
        d.clashes ? ` ${d.clashes} of the draft's ${d.clashes === 1 ? "changes touched" : "changes touched"} the same lines as your edits and ${d.clashes === 1 ? "was" : "were"} left out.` : "") : null,
      findings.length ? h("ul", { class: "review-findings" }, findings.map((f) =>
        h("li", null, h("span", { class: "finding-kind" }, KINDS[f.kind] ?? f.kind), " ", f.title, f.sources.length ? h("span", { class: "review-sources" }, f.sources.map(sourceChip)) : null))) : null,
      otherReasons.length ? h("ul", { class: "review-reasons" }, otherReasons.map((c) => h("li", null, h("b", null, c.section), `: ${c.reason}`))) : null,
      hunks.length ? hunks.map((x) => {
        const state = d.accepted.includes(x.index) ? "accepted" : d.rejected.includes(x.index) ? "rejected" : "";
        // Context: up to two unchanged lines, never reaching back into the change before.
        const prevEnd = x.index > 0 ? hunks[x.index - 1].to : 0;
        const before = ops.slice(Math.max(prevEnd, x.from - 2), x.from).filter((o) => o.type === "same");
        const after = ops.slice(x.to, x.to + 2).filter((o) => o.type === "same");
        // A new page is one change: the whole page.
        const section = d.base == null ? "The whole page" : x.section;
        const reason = reasonFor(x.section) ?? (d.base == null ? d.changes[0]?.reason : null);
        return h("section", { class: `hunk${state ? " is-" + state : ""}` },
          h("div", { class: "hunk-head" },
            h("span", { class: "hunk-why" }, h("b", null, section), reason ? ` · ${reason}` : ""),
            h("button", {
              class: `btn btn--small${state === "rejected" ? " is-on" : ""}`, type: "button", "aria-pressed": String(state === "rejected"),
              onClick: () => work(() => decideChange(d.id, x.index, state === "rejected" ? null : "reject")),
            }, "Reject"),
            h("button", {
              class: `btn btn--small${state === "accepted" ? " btn--primary" : ""}`, type: "button", "aria-pressed": String(state === "accepted"),
              onClick: () => work(() => decideChange(d.id, x.index, state === "accepted" ? null : "accept")),
            }, state === "accepted" ? [icon("check", 14), "Accepted"] : "Accept")),
          h("div", { class: "hunk-lines" },
            before.map((o) => line(" ", o.line, "ctx")),
            x.del.map((l) => line("−", l, "del")),
            x.add.map((l) => line("+", l, "add")),
            after.map((o) => line(" ", o.line, "ctx"))));
      }) : h("p", { class: "sugg-empty" }, "The draft is the same as the page."));
  }

  const line = (mark, text, kind) => h("div", { class: `dl is-${kind}` }, h("span", { class: "dl-mark", "aria-hidden": "true" }, mark), h("span", null, text || " "));

  // History ----------------------------------------------------------------------------------

  function historyTab() {
    const done = [...suggestions.data.history].reverse();
    const dismissed = suggestions.data.findings.filter((f) => f.status === "dismissed").sort((a, b) => (b.decided ?? 0) - (a.decided ?? 0));
    if (!done.length && !dismissed.length) return h("div", { class: "sugg-empty" }, h("p", null, "Applied changes and dismissed findings are listed here."));
    return h("div", { class: "sugg-list" },
      done.length ? [h("h2", { class: "sugg-group" }, "Applied"), done.map((x) =>
        h("div", { class: "history-row" },
          h("button", { class: "history-page", type: "button", onClick: () => store.paths.includes(x.path) && openNote(x.path) },
            `${x.created ? "Added" : "Changed"} ${noteName(x.path)}`),
          h("span", { class: "history-what" }, x.findings.join("; ")),
          h("span", { class: "history-when" }, formatDate(new Date(x.at)))))] : null,
      dismissed.length ? [h("h2", { class: "sugg-group" }, "Dismissed"), dismissed.map((f) =>
        h("div", { class: "history-row" },
          h("span", { class: "history-page" }, f.title),
          h("span", { class: "history-what" }, target(f)),
          h("button", { class: "btn btn--small btn--plain", type: "button", onClick: () => work(() => decide(f.id, "open")) }, "Restore")))] : null);
  }

  on("suggestions", render);
  on("index", render);
  return { show, refresh: render };
}
