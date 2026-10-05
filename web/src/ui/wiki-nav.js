// The sidebar in the Wikis space, under the sidebar's header (main.js): All
// wikis and Suggestions, then labelled groups. On All wikis: the wikis and the
// pages edited most recently. Inside a wiki: its contents under its name (Home,
// its pages, a heading per subfolder, upkeep pages last), then the other wikis.

import { alertError, createNote, currentRoute, newNote, openNote, openSuggestions, openWikis, archiveWiki, ARCHIVE_NOTE } from "../actions.js";
import { waiting } from "../suggestions/state.js";
import { noteName } from "../links.js";
import { on, store } from "../store.js";
import { coverUrl, HOME_TEMPLATE, isUpkeep, wiki as wikiInfo, wikiFolder, wikiOf, wikis } from "../wikis.js";

const RECENT_PAGES = 5;
import { clear, h, icon, keys } from "./dom.js";
import { openMenu } from "./menu.js";

export function createWikiNav(el) {
  function render() {
    const name = wikiOf(store.currentPath);
    // Keep keyboard focus on the same row when the list is rebuilt.
    const focused = el.contains(document.activeElement) ? document.activeElement.closest(".nav-item")?.textContent : null;
    clear(el, name ? inside(wikiInfo(name)) : library()); // flattens the groups, skipping empty ones
    if (focused != null) [...el.querySelectorAll(".nav-item")].find((b) => b.textContent === focused)?.focus();
  }

  // The rail's bulb turns silver while suggestions wait; here the row shows how many.
  const suggestionsRow = () => {
    const n = waiting();
    const el = row({ iconName: "suggestions", label: "Suggestions", selected: currentRoute().view === "suggestions", run: () => openSuggestions() });
    if (n) {
      el.append(h("span", { class: "nav-badge" }, String(n)));
      el.setAttribute("aria-label", `Suggestions, ${n} waiting`);
    }
    return el;
  };

  const top = () => h("div", { class: "nav-list" },
    row({ iconName: "grid", label: "All wikis", selected: currentRoute().view === "wikis", run: openWikis }),
    suggestionsRow());

  const section = (title, ...actions) => h("div", { class: "side-section-head" },
    h("h2", { class: "side-title" }, title), h("div", { class: "side-actions" }, actions));

  const iconButton = (iconName, label, run) => h("button", {
    class: "iconbtn", type: "button", "aria-label": label, dataset: { tip: label }, onClick: run,
  }, icon(iconName, 16));

  /** A wiki's row, with a "..." on hover as in the notes tree; right-click opens it too. */
  const wikiRow = (w) => {
    const more = moreButton(w, { tabindex: -1, cls: "wiki-row-more" });
    return h("div", {
      class: "wiki-row",
      onContextmenu: (e) => {
        e.preventDefault();
        openMenu(more, wikiActions(w));
      },
    }, row({ thumb: thumb(w), label: w.name, count: w.count, run: () => openWiki(w) }), more);
  };

  /** All wikis: the wikis, then the pages changed most recently in any of them. */
  function library() {
    const list = wikis();
    const recent = store.notes.filter((n) => wikiOf(n.path) && !isUpkeep(n.path))
      .sort((a, b) => b.mtime - a.mtime).slice(0, RECENT_PAGES);
    return [
      top(),
      section("Wikis", iconButton("plus", "New wiki", () => openWikis({ create: true }))),
      h("div", { class: "nav-list wiki-list" },
        list.map(wikiRow),
        list.length ? null : h("p", { class: "side-empty" }, "No wikis yet.")),
      recent.length ? [
        section("Recently edited"),
        h("div", { class: "nav-list" }, recent.map((n) => row({
          iconName: "file", label: noteName(n.path), hint: wikiOf(n.path), run: () => openNote(n.path),
        }))),
      ] : null,
    ];
  }

  /** Inside a wiki: its contents under its name, then the other wikis. */
  function inside(w) {
    const current = store.currentPath;
    const page = (note, extra = "") => row({
      iconName: "file",
      label: noteName(note.path),
      selected: note.path === current,
      run: () => openNote(note.path),
      cls: extra,
    });
    const others = wikis().filter((o) => o.name !== w.name);
    return [
      top(),
      section(w.name,
        iconButton("plus", `New page in ${w.name}`, () => newNote(w.folder).catch(alertError)),
        moreButton(w)),
      h("div", { class: "nav-list" },
        w.home ? row({ iconName: "file", label: "Home", selected: w.home.path === current, run: () => openNote(w.home.path) }) : null,
        w.pages.map((note) => page(note))),
      w.sections.map((s) => [
        h("div", { class: "side-section-head wiki-section" },
          h("h3", { class: "side-subtitle" }, s.name),
          h("div", { class: "side-actions" },
            iconButton("plus", `New page in ${s.name}`, () => newNote(s.folder).catch(alertError)))),
        h("div", { class: "nav-list" }, s.pages.map((note) => page(note, "is-indented"))),
      ]),
      w.upkeep.length ? h("div", { class: "nav-list wiki-upkeep" }, w.upkeep.map((note) => page(note, "is-quiet"))) : null,
      others.length ? [section("Other wikis"), h("div", { class: "nav-list wiki-list" }, others.map(wikiRow))] : null,
    ];
  }

  on("index", render);
  on("current", render);
  on("suggestions", render);
  window.addEventListener("hashchange", render);
  render();
  return { render };
}

/** What can be done to a whole wiki, for its "..." menus. */
export function wikiActions(w) {
  const pages = `${w.count} ${w.count === 1 ? "page" : "pages"}`;
  return [{
    label: "Archive",
    confirm: `Archive the ${w.name} wiki and its ${pages}? ${ARCHIVE_NOTE}`,
    run: () => archiveWiki(w.name),
  }];
}

/** A wiki's "..." button. */
export function moreButton(w, { tabindex = null, cls = "" } = {}) {
  const button = h("button", {
    class: `iconbtn${cls ? " " + cls : ""}`, type: "button", tabindex,
    "aria-label": `Actions for the ${w.name} wiki`, "aria-haspopup": "menu", dataset: { tip: "Archive" },
    onClick: (e) => {
      e.stopPropagation();
      openMenu(button, wikiActions(w));
    },
  }, icon("more", 16));
  return button;
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

function row({ iconName, thumb: thumbEl, label, hint, shortcut, count, selected, run, cls = "" }) {
  return h("button", {
    class: `nav-item${selected ? " is-selected" : ""}${cls ? " " + cls : ""}`,
    type: "button",
    "aria-current": selected ? "page" : null,
    onClick: run,
  },
  thumbEl ?? (iconName ? icon(iconName, 16) : null),
  h("span", { class: "nav-label" }, label),
  hint ? h("span", { class: "nav-hint" }, hint) : null,
  shortcut ? keys(shortcut) : null,
  count != null ? h("span", { class: "count" }, String(count)) : null);
}

/** A wiki's small picture: its cover, or its initial. */
export function thumb(w, large = false) {
  const src = coverUrl(w.cover);
  return h("span", { class: `wiki-thumb${large ? " is-large" : ""}`, "aria-hidden": "true" },
    src ? h("img", { src, alt: "" }) : w.name.slice(0, 1).toUpperCase());
}
