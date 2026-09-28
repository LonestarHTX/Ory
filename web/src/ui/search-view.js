// Full-text search in the main area. Results filter live as you type.
// Down from the field moves into the results; Enter opens one.

import { openNote } from "../actions.js";
import { api } from "../api.js";
import { folderOf } from "../links.js";
import { h, keys } from "./dom.js";

export function createSearchView(el) {
  const count = h("span", { class: "note-status", role: "status" });
  const input = h("input", {
    class: "input search-field",
    type: "search",
    placeholder: "Search notes",
    "aria-label": "Search notes",
    spellcheck: "false",
    autocomplete: "off",
  });
  const error = h("p", { class: "field-error", role: "alert", hidden: true });
  const list = h("div", { class: "search-results" });

  el.append(
    h("header", { class: "note-head" },
      h("div", { class: "note-name" }, h("h1", { class: "note-heading" }, "Search")),
      h("div", { class: "note-meta" }, count)),
    h("div", { class: "search-body" }, input, error, list),
  );

  let timer = null;
  let seq = 0;

  async function run() {
    if (el.hidden) return; // a late keystroke after leaving search must not route back
    const query = input.value.trim();
    const params = query ? "?" + new URLSearchParams({ q: query }) : "";
    history.replaceState(null, "", "#/search" + params);
    if (!query) {
      count.textContent = "";
      list.replaceChildren(
        h("div", { class: "empty-state" },
          h("p", null, "Searches note names and text. Every word must appear; put a phrase in quotes to match it exactly."),
          h("p", null, keys("Down"), " moves into the results, ", keys("Enter"), " opens one.")));
      return;
    }
    const mine = ++seq;
    let results;
    try {
      ({ results } = await api.search(query));
    } catch (err) {
      error.hidden = false;
      error.replaceChildren(h("span", { class: "status-dot error" }), err.message);
      return;
    }
    if (mine !== seq || el.hidden) return;
    error.hidden = true;
    count.textContent = results.length === 1 ? "1 note" : `${results.length >= 50 ? "50+" : results.length} notes`;
    if (!results.length) {
      list.replaceChildren(h("div", { class: "empty-state" }, h("p", null, `No notes contain "${query}".`)));
      return;
    }
    list.replaceChildren(...results.map((r) =>
      h("section", { class: "result" },
        h("button", { class: "result-note", type: "button", onClick: () => openNote(r.path) },
          h("span", { class: "result-name" }, r.name),
          h("span", { class: "result-path" }, folderOf(r.path))),
        r.matches.map((m) =>
          h("button", { class: "result-line", type: "button", onClick: () => openNote(r.path, { line: m.line }) },
            highlight(m))))));
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list.querySelector("button")?.focus();
    }
  });
  list.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...list.querySelectorAll("button")];
    const i = buttons.indexOf(document.activeElement);
    const next = i + (e.key === "ArrowDown" ? 1 : -1);
    if (next < 0) input.focus();
    else buttons[Math.min(next, buttons.length - 1)]?.focus();
  });

  return {
    show(query) {
      document.title = "Search · Ory";
      if (query !== input.value) input.value = query;
      run();
      input.focus();
    },
    rerun: () => input.value.trim() && run(),
  };
}

function highlight({ text, ranges, cutStart, cutEnd }) {
  const out = [];
  let pos = 0;
  for (const [from, to] of ranges) {
    if (from < pos) continue;
    out.push(text.slice(pos, from), h("mark", null, text.slice(from, to)));
    pos = to;
  }
  out.push(text.slice(pos));
  return [cutStart ? "…" : "", ...out, cutEnd ? "…" : ""];
}
