// The sidebar in the Wikis space. Outside a wiki it lists the wikis; inside
// one it becomes that wiki's contents: Home, its pages, a heading for each
// subfolder, then the wiki's upkeep pages (Instructions, Log) at the bottom.

import { alertError, createNote, currentRoute, newNote, openNote, openSearch, openSuggestions, openWikis } from "../actions.js";
import { waiting } from "../suggestions/state.js";
import { silverBulb } from "./silver-icon.js";
import { noteName } from "../links.js";
import { on, store } from "../store.js";
import { coverUrl, HOME_TEMPLATE, wiki as wikiInfo, wikiFolder, wikiOf, wikis } from "../wikis.js";
import { h, icon, keys } from "./dom.js";

export function createWikiNav(el) {
  function render() {
    const name = wikiOf(store.currentPath);
    el.replaceChildren(...(name ? inside(wikiInfo(name)) : library()));
  }

  // While suggestions wait, the row's lightbulb is cast in liquid silver. The
  // bulb is made once, so its WebGL context outlives re-renders.
  const bulb = silverBulb(16);
  const suggestionsRow = () => {
    const n = waiting();
    const selected = currentRoute().view === "suggestions";
    const el = row({ label: "Suggestions", selected, run: () => openSuggestions() });
    el.prepend(n ? bulb.el : icon("suggestions", 16));
    // The number shows here, in the Wikis sidebar; the space switch shows only the bulb.
    if (n) {
      el.append(h("span", { class: "nav-badge" }, String(n)));
      el.setAttribute("aria-label", `Suggestions, ${n} waiting`);
    }
    bulb.wake();
    return el;
  };

  function library() {
    const home = currentRoute().view === "wikis";
    return [
      h("div", { class: "nav-list" },
        row({ iconName: "grid", label: "All wikis", selected: home, run: openWikis }),
        suggestionsRow(),
        row({ iconName: "search", label: "Search", shortcut: "Mod-Shift-F", run: () => openSearch() })),
      h("div", { class: "side-section-head" },
        h("h2", { class: "side-title" }, "Wikis"),
        h("div", { class: "side-actions" },
          h("button", {
            class: "iconbtn", type: "button", "aria-label": "New wiki", dataset: { tip: "New wiki" },
            onClick: () => openWikis({ create: true }),
          }, icon("plus", 16)))),
      h("div", { class: "nav-list wiki-list" },
        wikis().map((w) => row({
          thumb: thumb(w),
          label: w.name,
          count: w.count,
          run: () => openWiki(w),
        })),
        wikis().length ? null : h("p", { class: "side-empty" }, "No wikis yet.")),
    ];
  }

  function inside(w) {
    const current = store.currentPath;
    const page = (note, extra = "") => row({
      label: noteName(note.path),
      selected: note.path === current,
      run: () => openNote(note.path),
      cls: extra,
    });
    return [
      h("div", { class: "nav-list" },
        row({ iconName: "chevronLeft", label: "All wikis", run: openWikis, cls: "nav-back" }),
        suggestionsRow()),
      h("div", { class: "wiki-head" },
        thumb(w, true),
        h("div", { class: "wiki-head-text" },
          h("div", { class: "wiki-head-name" }, w.name),
          h("div", { class: "wiki-head-count" }, `${w.count} ${w.count === 1 ? "page" : "pages"}`)),
        h("button", {
          class: "iconbtn", type: "button", "aria-label": `New page in ${w.name}`, dataset: { tip: "New page" },
          onClick: () => newNote(w.folder).catch(alertError),
        }, icon("plus", 16))),
      h("div", { class: "wiki-contents" },
        h("div", { class: "nav-list" },
          w.home ? row({ label: "Home", selected: w.home.path === current, run: () => openNote(w.home.path) }) : null,
          w.pages.map((note) => page(note))),
        w.sections.map((s) => [
          h("div", { class: "side-section-head wiki-section" },
            h("h2", { class: "side-title" }, s.name),
            h("div", { class: "side-actions" },
              h("button", {
                class: "iconbtn", type: "button", "aria-label": `New page in ${s.name}`, dataset: { tip: `New page in ${s.name}` },
                onClick: () => newNote(s.folder).catch(alertError),
              }, icon("plus", 16)))),
          h("div", { class: "nav-list" }, s.pages.map((note) => page(note, "is-indented"))),
        ]),
        w.upkeep.length ? h("div", { class: "nav-list wiki-upkeep" }, w.upkeep.map((note) => page(note, "is-quiet"))) : null),
    ];
  }

  on("index", render);
  on("current", render);
  on("suggestions", render);
  window.addEventListener("hashchange", render);
  render();
  return { render, bulb };
}

/** Open a wiki at its Home, making the Home page if it has none yet. */
export async function openWiki(w) {
  if (w.home) return openNote(w.home.path);
  const first = w.pages[0] ?? w.sections.flatMap((s) => s.pages)[0];
  if (first) return openNote(first.path);
  try {
    openNote(await createNote(`${wikiFolder(w.name)}/Home`, HOME_TEMPLATE));
  } catch (err) {
    alertError(err);
  }
}

function row({ iconName, thumb: thumbEl, label, shortcut, count, selected, run, cls = "" }) {
  return h("button", {
    class: `nav-item${selected ? " is-selected" : ""}${cls ? " " + cls : ""}`,
    type: "button",
    "aria-current": selected ? "page" : null,
    onClick: run,
  },
  thumbEl ?? (iconName ? icon(iconName, 16) : null),
  h("span", { class: "nav-label" }, label),
  shortcut ? keys(shortcut) : null,
  count != null ? h("span", { class: "count" }, String(count)) : null);
}

/** A wiki's small picture: its cover, or its initial. */
export function thumb(w, large = false) {
  const src = coverUrl(w.cover);
  return h("span", { class: `wiki-thumb${large ? " is-large" : ""}`, "aria-hidden": "true" },
    src ? h("img", { src, alt: "" }) : w.name.slice(0, 1).toUpperCase());
}
