// Ory's web UI: layout, routing, global shortcuts and keeping in step with disk.

import "./styles.css";

import {
  alertError, closeNote, currentRoute, newFolder, newNote, notify, openNote, openSearch, openToday, openWikis, takeOpenOptions,
} from "./actions.js";
import { api } from "./api.js";
import { loadIndex, on, recentPaths, setCurrent, store } from "./store.js";
import { createBacklinks } from "./ui/backlinks.js";
import { h, icon, keys, mod } from "./ui/dom.js";
import { createNoteView } from "./ui/note-view.js";
import { createOutline } from "./ui/outline.js";
import { broadcastTheme, createPageView } from "./ui/page-view.js";
import { createSearchView } from "./ui/search-view.js";
import { createSwitcher } from "./ui/switcher.js";
import { installTooltips } from "./ui/tooltip.js";
import { createTree } from "./ui/tree.js";
import { loadSuggestions, suggestions, waiting } from "./suggestions/state.js";
import { silverBulb } from "./ui/silver-icon.js";
import { createSuggestionsView } from "./ui/suggestions-view.js";
import { createWikiNav } from "./ui/wiki-nav.js";
import { createWikisHome } from "./ui/wikis-home.js";
import { wikiOf } from "./wikis.js";

const POLL_MS = 2000;

// Theme: follows the system until chosen, then remembered ---------------------

const THEME_KEY = "ory.theme";
const THEMES = ["system", "light", "dark"];
const THEME_LABELS = { system: "System theme", light: "Light theme", dark: "Dark theme" };
const THEME_ICONS = { system: "system", light: "sun", dark: "moon" };

function readTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEMES.includes(value) ? value : "system";
  } catch {
    return "system";
  }
}

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme(theme) {
  // Colour transitions are held off so no element fades between themes by itself.
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = theme === "system" ? (systemDark.matches ? "dark" : "light") : theme;
  void root.offsetWidth; // apply the new colours before transitions return
  root.classList.remove("theme-switching");
  broadcastTheme(); // pages in frames that listen for it
}

// The theme cross-fades over 0.24s like any other state change.
// Without view transitions, or with reduced motion, it switches at once.
function fadeTo(theme) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || still) return applyTheme(theme);
  const root = document.documentElement;
  root.dataset.themeFade = "";
  const transition = document.startViewTransition(() => applyTheme(theme));
  // A hidden tab skips the animation and rejects `ready`; the theme still switches.
  transition.ready.catch(() => {});
  transition.finished.finally(() => delete root.dataset.themeFade);
}

// Layout ------------------------------------------------------------------------

const switcher = createSwitcher();
installTooltips();

const navSearch = navItem("search", "Search", "Mod-Shift-F", () => openSearch());
const themeButton = h("button", { class: "nav-item", type: "button" });
const tree = h("div", { class: "tree" });

// Notes and wikis are two spaces in one notes folder: the switch at the top
// of the sidebar moves between them, and the sidebar shows the one you're in.
const spaceTab = (name, iconName, label, run) => h("button", {
  class: "space-tab", type: "button", role: "tab", dataset: { space: name }, onClick: run,
}, icon(iconName, 14), label);
const notesTab = spaceTab("notes", "notebook", "Notes", () => {
  const last = recentPaths().find((p) => store.paths.includes(p) && !wikiOf(p));
  setSpace("notes");
  if (last) openNote(last);
  else closeNote();
});
const wikisTab = spaceTab("wikis", "book", "Wikis", () => openWikis());
// A silver lightbulb beside "Wikis" while suggestions wait (ui/silver-icon.js).
const tabBulb = silverBulb(14);
tabBulb.el.hidden = true;
wikisTab.append(tabBulb.el);
const spaceSwitch = h("div", { class: "space-switch", role: "tablist", "aria-label": "Space" }, notesTab, wikisTab);

const notesPanel = h("div", { class: "space-panel", dataset: { space: "notes" } },
  h("div", { class: "nav-list" },
    navItem("newNote", "Open note", "Mod-O", () => switcher.open()),
    navSearch,
    navItem("calendar", "Today's note", "Mod-Shift-D", openToday)),
  h("div", { class: "side-section-head" },
    h("h2", { class: "side-title" }, "Notes"),
    h("div", { class: "side-actions" },
      h("button", {
        class: "iconbtn", type: "button", "aria-label": "New note", dataset: { tip: "New note" },
        onClick: () => newNote().catch(alertError),
      }, icon("newNote", 16)),
      h("button", {
        class: "iconbtn", type: "button", "aria-label": "New folder", dataset: { tip: "New folder" },
        onClick: () => newFolder().catch(alertError),
      }, icon("newFolder", 16)))),
  tree);
const wikisPanel = h("div", { class: "space-panel", dataset: { space: "wikis" }, hidden: true });

const left = h("nav", { class: "sidebar sidebar-left", "aria-label": "Sidebar" },
  h("div", { class: "side-head" }, spaceSwitch),
  notesPanel,
  wikisPanel,
  h("div", { class: "side-foot" }, themeButton));

const errorBar = h("div", { class: "app-error", role: "alert", hidden: true });
const noteEl = h("section", { class: "view note-view", hidden: true });
const searchEl = h("section", { class: "view search-view", hidden: true });
const emptyEl = h("section", { class: "view empty-view", hidden: true });
const pageEl = h("section", { class: "view page-view", hidden: true });
const wikisEl = h("section", { class: "view wikis-view", hidden: true });
const suggestionsEl = h("section", { class: "view suggestions-view", hidden: true });
const main = h("main", { class: "main" }, errorBar, noteEl, pageEl, wikisEl, suggestionsEl, searchEl, emptyEl);
const right = h("aside", { class: "sidebar sidebar-right", "aria-label": "Backlinks" });

const app = h("div", { class: "app" }, left, main, right);
document.body.append(app);

function navItem(iconName, label, shortcut, run) {
  return h("button", { class: "nav-item", type: "button", onClick: run },
    icon(iconName, 16), h("span", { class: "nav-label" }, label), keys(shortcut));
}

let theme = readTheme();
function renderTheme(fade = false) {
  if (fade) fadeTo(theme);
  else applyTheme(theme);
  themeButton.replaceChildren(icon(THEME_ICONS[theme], 16), h("span", { class: "nav-label" }, THEME_LABELS[theme]));
  themeButton.setAttribute("aria-label", `${THEME_LABELS[theme]}. Change theme`);
}
themeButton.addEventListener("click", () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* the choice lasts for this page only */
  }
  renderTheme(true);
});
systemDark.addEventListener("change", () => theme === "system" && fadeTo("system"));
renderTheme();

const noteView = createNoteView(noteEl);
const pageView = createPageView(pageEl);
const searchView = createSearchView(searchEl);
const backlinks = createBacklinks(right);
createOutline(right, { goToLine: (line) => noteView.goToLine(line) });
createTree(tree);
const wikiNav = createWikiNav(wikisPanel);
const wikisHome = createWikisHome(wikisEl);
const suggestionsView = createSuggestionsView(suggestionsEl);

// What needs you in the wikis, on the Wikis side of the switch.
on("suggestions", () => {
  const n = waiting();
  wikisTab.setAttribute("aria-label", n ? `Wikis, ${n} ${n === 1 ? "suggestion" : "suggestions"} waiting` : "Wikis");
  updateBulbs();
});

// While suggestions wait, a lightbulb cast in liquid silver shows beside "Wikis"
// in Notes; in Wikis the Suggestions row's own bulb turns silver instead
// (ui/wiki-nav.js). One at a time. New ones arriving send a glint across it.
let waitingBefore = 0;
function updateBulbs() {
  const n = waiting();
  tabBulb.el.hidden = !(n && space === "notes");
  tabBulb.wake();
  wikiNav.bulb.wake();
  if (n > waitingBefore) (space === "notes" ? tabBulb : wikiNav.bulb).ping();
  waitingBefore = n;
}

let space = "notes";
function setSpace(next) {
  space = next;
  for (const tab of [notesTab, wikisTab]) {
    const on = tab.dataset.space === space;
    tab.classList.toggle("is-selected", on);
    tab.setAttribute("aria-selected", String(on));
  }
  notesPanel.hidden = space !== "notes";
  wikisPanel.hidden = space !== "wikis";
  updateBulbs();
}
setSpace("notes");

function renderEmpty(message) {
  document.title = "Ory";
  const row = (label, shortcut) => h("div", { class: "shortcut" }, h("dt", null, label), h("dd", null, shortcut));
  const key = (text) => h("kbd", { class: "kbd" }, text);
  emptyEl.replaceChildren(
    h("header", { class: "note-head" }, h("div", { class: "note-name" }, h("h1", { class: "note-heading" }, "Nothing open"))),
    h("div", { class: "empty-state" },
      message ? h("p", { class: "field-error" }, h("span", { class: "status-dot error" }), message) : null,
      h("p", null, `Everything lives as Markdown files in the ${store.vaultName} folder. Notes are where you think; wikis, in ${store.wikisFolder}, are where finished pages live.`),
      h("dl", { class: "shortcuts" },
        row("Open or create a note", keys("Mod-O")),
        row("Search everything", keys("Mod-Shift-F")),
        row("Open today's note", keys("Mod-Shift-D")),
        row("Link to a note or page", key("[[")),
        row("Open the link at the cursor", keys("Mod-Enter")),
        row("Edit the wiki page you're reading", key("E")),
        row("Go back to reading it", key("Esc")),
        row("Switch between live preview and source", keys("Mod-E"))),
      h("div", { class: "empty-actions" },
        h("button", { class: "btn btn--small", type: "button", onClick: openToday }, icon("calendar", 14), "Today's note"),
        h("button", { class: "btn btn--small", type: "button", onClick: () => openWikis() }, icon("book", 14), "Wikis"))));
}

// Routing ---------------------------------------------------------------------

function showOnly(view) {
  for (const el of [noteEl, pageEl, wikisEl, suggestionsEl, searchEl, emptyEl]) el.hidden = el !== view;
  // Backlinks and the outline belong to a note; other views get the width.
  app.classList.toggle("has-rail", view === noteEl || view === pageEl);
  if (view !== pageEl) pageView.close(); // stop a page's animation when it is not shown
  navSearch.classList.toggle("is-selected", view === searchEl);
}

/** Navigating fades the new page in; ordinary updates do not. */
function arrive(view) {
  view.classList.remove("is-arriving");
  void view.offsetWidth;
  view.classList.add("is-arriving");
}

let routing = Promise.resolve();
let routeToken = 0;
let arrivedPath = null;

function route() {
  const r = currentRoute();
  const options = takeOpenOptions();
  // Leaving a note: take focus out of its editor now, so nothing typed while
  // the next view loads lands in it.
  if (noteEl.contains(document.activeElement) && !(r.view === "note" && r.path === noteView.path)) {
    document.activeElement.blur();
  }
  if (r.view === "search" && searchEl.hidden) {
    showOnly(searchEl);
    arrive(searchEl);
  }
  if (r.view === "search") searchView.show(r.query);
  const token = ++routeToken;
  // Search and the empty view keep whichever space you were in.
  if (r.view === "wikis" || r.view === "suggestions" || ((r.view === "note" || r.view === "page") && wikiOf(r.path))) setSpace("wikis");
  else if (r.view === "note" || r.view === "page") setSpace("notes");
  // Serialise: a route waits for the previous one (and its save) to finish.
  routing = routing.then(async () => {
    // A newer route came in while this one waited: it decides what's shown.
    if (token !== routeToken) return;
    if (r.view === "search") {
      await noteView.close();
      setCurrent(null);
      showOnly(searchEl); // a note route that finished meanwhile may have shown itself
      return;
    }
    if (r.view === "suggestions") {
      await noteView.close();
      setCurrent(null);
      if (suggestionsEl.hidden) arrive(suggestionsEl);
      showOnly(suggestionsEl);
      suggestionsView.show(options);
      return;
    }
    if (r.view === "wikis") {
      await noteView.close();
      setCurrent(null);
      if (wikisEl.hidden) arrive(wikisEl);
      showOnly(wikisEl);
      wikisHome.show(options);
      return;
    }
    if (r.view === "page") {
      await noteView.close();
      if (pageEl.hidden || pageView.path !== r.path) arrive(pageEl);
      showOnly(pageEl);
      pageView.show(r.path);
      return;
    }
    if (r.view === "note") {
      const { error } = await noteView.show(r.path);
      if (token !== routeToken) return; // you went elsewhere while it loaded
      if (error) {
        showOnly(emptyEl);
        renderEmpty(error.status === 404 ? `"${r.path}" does not exist. It may have been moved or deleted.` : error.message);
      } else {
        if (noteEl.hidden || arrivedPath !== r.path) arrive(noteEl);
        arrivedPath = r.path;
        showOnly(noteEl);
        noteView.focus(options);
      }
    } else {
      await noteView.close();
      setCurrent(null);
      if (r.view === "empty") {
        if (emptyEl.hidden) arrive(emptyEl);
        showOnly(emptyEl);
        renderEmpty();
      }
    }
  }).catch(alertError);
  return routing;
}

window.addEventListener("hashchange", route);

// Errors ----------------------------------------------------------------------

window.addEventListener("ory:message", (e) => {
  delete errorBar.dataset.offline;
  errorBar.hidden = false;
  errorBar.replaceChildren(
    h("p", null, h("span", { class: `status-dot ${e.detail.level}` }), e.detail.message),
    h("button", { class: "btn btn--small btn--plain", type: "button", onClick: () => (errorBar.hidden = true) }, "Dismiss"));
});

// Shortcuts -------------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  if (!mod(e) || e.altKey) return;
  const key = e.key.toLowerCase();
  let handled = true;
  if (key === "o" && !e.shiftKey) switcher.open();
  else if (key === "f" && e.shiftKey) {
    switcher.close(false);
    openSearch(window.getSelection()?.toString().trim().split("\n")[0] || "");
  } else if (key === "d" && e.shiftKey) {
    switcher.close(false);
    document.activeElement?.blur(); // keys typed while it loads must not land here
    openToday();
  } else if (key === "e" && !e.shiftKey && !noteEl.hidden) noteView.toggleSource();
  else handled = false;
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// Keeping in step with the disk ---------------------------------------------

let polling = false;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const { version, suggestions: suggestionsRev } = await api.version();
    if (version !== store.version) await loadIndex(); // emits "index", handled below
    // An agent filed suggestions (python3 -m ory suggest, or over MCP).
    if (suggestionsRev !== undefined && suggestionsRev !== suggestions.rev) await loadSuggestions();
    if (!errorBar.hidden && errorBar.dataset.offline) errorBar.hidden = true;
  } catch (err) {
    if (err.status === 0) {
      errorBar.hidden = false;
      errorBar.dataset.offline = "1";
      errorBar.replaceChildren(h("p", null, h("span", { class: "status-dot error" }), err.message));
    }
  } finally {
    polling = false;
  }
}

// Any change to the notes folder, from the poll or from an action here (a
// rename can rewrite links inside the open note), brings every view up to date.
on("index", () => {
  noteView.refreshLinks();
  wikisHome.refresh();
  backlinks.refresh();
  noteView.checkDisk();
  if (!searchEl.hidden) searchView.rerun();
});

// Boot ------------------------------------------------------------------------

(async () => {
  try {
    await loadIndex();
  } catch (err) {
    showOnly(emptyEl);
    renderEmpty(err.message);
    return;
  }
  // A broken suggestions file mustn't keep the notes from opening.
  loadSuggestions().catch((err) => notify(`Suggestions could not be loaded: ${err.message}`, "error"));
  if (!location.hash) {
    const last = recentPaths().find((p) => store.paths.includes(p));
    if (last) return openNote(last, { replace: true });
  }
  route();
})();

setInterval(poll, POLL_MS);
window.addEventListener("focus", poll);
