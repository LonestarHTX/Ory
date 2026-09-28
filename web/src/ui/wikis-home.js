// All wikis: the Wikis space's home. A card for each wiki (its cover, summary,
// size and when it last changed), and a card to start a new one.

import { alertError, createNote, openNote, openSuggestions } from "../actions.js";
import { on, store } from "../store.js";
import { decide, drafts, KINDS, openFindings, target, unreadNotes } from "../suggestions/state.js";
import { coverUrl, HOME_TEMPLATE, wikiFolder, wikis } from "../wikis.js";
import { h, icon, timeAgo } from "./dom.js";
import { coverPattern } from "./pattern.js";
import { openWiki } from "./wiki-nav.js";

export function createWikisHome(el) {
  let creating = false;
  let error = "";

  function show({ create = false } = {}) {
    if (create) creating = true;
    document.title = "Wikis · Ory";
    render();
    if (creating) el.querySelector(".wiki-new-input")?.focus();
  }

  function render() {
    const list = wikis();
    el.replaceChildren(
      h("header", { class: "note-head" },
        h("div", { class: "note-name" }, h("h1", { class: "note-heading" }, "All wikis")),
        h("div", { class: "note-meta" },
          h("button", { class: "btn btn--small", type: "button", onClick: () => startCreate() }, icon("plus", 14), "New wiki"))),
      h("div", { class: "wikis-home" },
        suggestionsCard(),
        h("p", { class: "wikis-intro" },
          list.length
            ? `Each wiki is a folder in ${store.wikisFolder}. Its pages open ready to read; press E to edit one.`
            : `A wiki is a folder of pages in ${store.wikisFolder}, written to be read. Notes stay where they are.`),
        h("div", { class: "wiki-cards" },
          list.map((w) => {
            const cover = coverUrl(w.cover);
            return h("button", { class: "wiki-card", type: "button", onClick: () => openWiki(w) },
              h("span", { class: "wiki-card-cover" }, cover ? h("img", { src: cover, alt: "" }) : coverPattern(w.name)),
              h("span", { class: "wiki-card-body" },
                h("span", { class: "wiki-card-name" }, w.name),
                w.summary ? h("span", { class: "wiki-card-summary" }, w.summary) : null,
                h("span", { class: "wiki-card-meta" },
                  `${w.count} ${w.count === 1 ? "page" : "pages"}`,
                  w.mtime ? ` · edited ${timeAgo(w.mtime * 1000)}` : "")));
          }),
          creating ? newCard() : h("button", { class: "wiki-card is-new", type: "button", onClick: () => startCreate() },
            h("span", { class: "wiki-card-cover" }, icon("plus", 24)),
            h("span", { class: "wiki-card-body" },
              h("span", { class: "wiki-card-name" }, "Start a wiki"),
              h("span", { class: "wiki-card-summary" }, "A folder of pages with a Home page to begin from."))))));
  }

  /** What needs you, above the wikis: findings to decide, drafts to review, notes to read. */
  function suggestionsCard() {
    const open = openFindings();
    const waitingDrafts = drafts().length;
    const unread = unreadNotes().length;
    if (!open.length && !waitingDrafts && !unread) return null;
    const summary = [
      open.length ? `${open.length} ${open.length === 1 ? "finding" : "findings"} to review` : "",
      waitingDrafts ? `${waitingDrafts} ${waitingDrafts === 1 ? "draft" : "drafts"} to look over` : "",
      !open.length && !waitingDrafts ? `${unread} ${unread === 1 ? "note" : "notes"} not read yet` : "",
    ].filter(Boolean).join(" · ");
    const act = (f, status) => decide(f.id, status).catch(alertError);
    return h("section", { class: "home-suggestions", "aria-label": "Suggestions" },
      h("div", { class: "home-suggestions-head" },
        icon("suggestions", 16),
        h("span", { class: "home-suggestions-title" }, "Suggestions"),
        h("span", { class: "home-suggestions-sub" }, summary),
        h("button", {
          class: "btn btn--small btn--primary", type: "button",
          onClick: () => openSuggestions(open.length ? {} : waitingDrafts ? { tab: "drafts" } : { find: true }),
        }, open.length || waitingDrafts ? "Review" : "Find suggestions")),
      open.slice(0, 3).map((f) => h("div", { class: "home-suggestion" },
        h("span", { class: `finding-kind${f.kind === "conflict" ? " is-warning" : ""}` }, KINDS[f.kind] ?? f.kind),
        h("span", { class: "home-suggestion-text" }, h("b", null, target(f) || f.title), target(f) ? ` · ${f.title}` : ""),
        h("button", { class: "btn btn--small", type: "button", onClick: () => act(f, "dismissed") }, "Dismiss"),
        h("button", { class: "btn btn--small", type: "button", onClick: () => act(f, "approved") }, "Approve"))),
      open.length > 3 ? h("div", { class: "home-suggestions-more" }, `${open.length - 3} more`) : null);
  }

  function newCard() {
    const input = h("input", {
      class: "input wiki-new-input",
      placeholder: "Wiki name",
      "aria-label": "Name of the new wiki",
      spellcheck: "false",
      onKeydown: (e) => {
        if (e.key === "Enter") create(input.value);
        if (e.key === "Escape") {
          creating = false;
          error = "";
          render();
        }
      },
    });
    return h("div", { class: "wiki-card is-new is-editing" },
      h("span", { class: "wiki-card-cover" }, icon("book", 24)),
      h("span", { class: "wiki-card-body" },
        input,
        error
          ? h("span", { class: "field-error", role: "alert" }, h("span", { class: "status-dot error" }), error)
          : h("span", { class: "wiki-card-summary" }, "Enter to create it, Esc to cancel.")));
  }

  function startCreate() {
    creating = true;
    error = "";
    render();
    el.querySelector(".wiki-new-input")?.focus();
  }

  async function create(value) {
    const name = value.trim();
    if (!name) return;
    if (/[\\/]/.test(name)) {
      error = "A wiki's name can't contain a slash.";
      render();
      el.querySelector(".wiki-new-input").value = value;
      return el.querySelector(".wiki-new-input").focus();
    }
    if (wikis().some((w) => w.name.toLowerCase() === name.toLowerCase())) {
      error = `There is already a wiki called "${name}".`;
      render();
      el.querySelector(".wiki-new-input").value = value;
      return el.querySelector(".wiki-new-input").focus();
    }
    try {
      const path = await createNote(`${wikiFolder(name)}/Home`, HOME_TEMPLATE);
      creating = false;
      error = "";
      openNote(path);
    } catch (err) {
      error = err.message;
      render();
      el.querySelector(".wiki-new-input").value = value;
    }
  }

  // A refresh waits while a wiki's name is being typed.
  const typing = () => el.contains(document.activeElement) && document.activeElement.matches("input");
  on("suggestions", () => !el.hidden && !typing() && render());

  return {
    show,
    refresh: () => !el.hidden && !typing() && render(),
  };
}
