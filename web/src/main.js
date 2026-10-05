// Ory's web UI: layout, routing, global shortcuts and keeping in step with disk.

import "./styles.css";

import {
  alertError, closeNote, currentRoute, newNote, notify, openArchive, openNote, openSearch, openSettings, openSuggestions,
  openToday, openWikis, takeOpenOptions,
} from "./actions.js";
import { api } from "./api.js";
import { emit, linkTextFor, loadIndex, on, recentPaths, resolve, setCurrent, store } from "./store.js";
import { createArchiveView } from "./ui/archive-view.js";
import { noteName } from "./links.js";
import { pinned } from "./pins.js";
import { pref, setPref } from "./prefs.js";
import { createBacklinks } from "./ui/backlinks.js";
import { createFolderSwitcher } from "./ui/folder-switcher.js";
import { createInfo } from "./ui/info.js";
import { createPanel } from "./ui/panel.js";
import { createTabs, TAB_DRAG } from "./ui/tabs.js";
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
import { createSettings } from "./ui/settings.js";
import { createSuggestionsView } from "./ui/suggestions-view.js";
import { setBudget } from "./suggestions/prompts.js";
import { createWikiNav } from "./ui/wiki-nav.js";
import { createWikisHome } from "./ui/wikis-home.js";
import { isUpkeep, wikiOf } from "./wikis.js";

const POLL_MS = 2000;

// Theme: two choices, both remembered. Light or dark (following the system
// until chosen), and the theme, Neutral or Dusk (see Themes in styles.css).

const MODE_KEY = "ory.theme";
const MODES = ["system", "light", "dark"];
const PALETTE_KEY = "ory.palette";
const PALETTES = ["neutral", "dusk"];

function readChoice(key, choices) {
  try {
    const value = localStorage.getItem(key);
    return choices.includes(value) ? value : choices[0];
  } catch {
    return choices[0];
  }
}

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {
  // Colour transitions are held off so no element fades between themes by itself.
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = mode === "system" ? (systemDark.matches ? "dark" : "light") : mode;
  root.dataset.palette = palette;
  void root.offsetWidth; // apply the new colours before transitions return
  root.classList.remove("theme-switching");
  broadcastTheme(); // pages in frames that listen for it
}

// The theme cross-fades over 0.24s like any other state change.
// Without view transitions, or with reduced motion, it switches at once.
function fadeTheme() {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || still) return applyTheme();
  const root = document.documentElement;
  root.dataset.themeFade = "";
  const transition = document.startViewTransition(applyTheme);
  // A hidden tab skips the animation and rejects `ready`; the theme still switches.
  transition.ready.catch(() => {});
  transition.finished.finally(() => delete root.dataset.themeFade);
}

// Layout ------------------------------------------------------------------------
// One title bar over everything; under it, on one line, the rail of places,
// the sidebar for the place you're in, the open view set in as a card, and
// the panel about the open note.

const switcher = createSwitcher();
installTooltips();

const iconButton = (iconName, label, run, tipKeys = null, cls = "") => h("button", {
  class: `iconbtn${cls ? " " + cls : ""}`, type: "button", "aria-label": label, dataset: { tip: label, tipKeys }, onClick: run,
}, icon(iconName, 16));

// Showing the sidebar and the panel: each remembered.
const SIDE_KEY = "ory.sidebar";
const PANEL_KEY = "ory.panel";
let sideShown = pref(SIDE_KEY, "1") === "1";
let panelShown = pref(PANEL_KEY, "1") === "1";

// Title bar.
const sideToggle = iconButton("panelLeft", "Sidebar", () => toggleSidebar(), "Mod-\\");
const titleSlot = h("div", { class: "title-what" }); // the open view's header, moved here
const tabs = createTabs({
  onAdd: () => switcher.open({ newTab: true }),
  onCloseBeside: (path) => (path === sideView.path ? closeSide() : closeMainSide()),
});
const besideToggle = iconButton("beside", "Side by side", () => toggleBeside(), "Mod-Shift-\\", "beside-toggle");
const panelToggle = iconButton("panelRight", "Panel", () => togglePanel(), null, "panel-toggle");
const titlebar = h("header", { class: "titlebar" },
  h("div", { class: "title-nav" },
    sideToggle,
    iconButton("arrowLeft", "Back", () => history.back()),
    iconButton("arrowRight", "Forward", () => history.forward())),
  titleSlot,
  h("div", { class: "title-end" }, tabs.el, besideToggle, panelToggle));

// Rail: the places. Suggestions turns silver, with a count, while they wait.
const railButton = (place, iconName, label, run, tipKeys = null) => h("button", {
  class: "rail-btn", type: "button", "aria-label": label, dataset: { place, tip: label, tipKeys }, onClick: run,
}, icon(iconName, 16));
const railSuggestions = railButton("suggestions", "suggestions", "Suggestions", () => openSuggestions());
const railBulb = silverBulb(16);
const railBadge = h("span", { class: "rail-badge", hidden: true });
railBulb.el.hidden = true;
railSuggestions.append(railBulb.el, railBadge);
const rail = h("nav", { class: "rail", "aria-label": "Places" },
  railButton("notes", "notebook", "Notes", () => openNotes()),
  railButton("wikis", "book", "Wikis", () => openWikis()),
  railSuggestions,
  railButton("archive", "archive", "Archive", () => openArchive()),
  h("span", { class: "rail-gap" }),
  railButton("settings", "settings", "Settings", () => openSettings(), "Mod-,"));

/** Notes: back to the note you were last in, outside the wikis. */
function openNotes() {
  const last = (isSplit() && pausedMain) || recentPaths().find((p) => store.paths.includes(p) && !wikiOf(p));
  setSpace("notes");
  if (last) openNote(last);
  else closeNote();
}

// Sidebar: its header (the notes folder, and the space's actions), then the
// space's groups.
const notesActions = h("div", { class: "side-actions" },
  iconButton("search", "Search", () => openSearch(), "Mod-Shift-F"),
  iconButton("edit", "New note", () => newNote().catch(alertError)));
const wikisActions = h("div", { class: "side-actions", hidden: true },
  iconButton("search", "Search", () => openSearch(), "Mod-Shift-F"),
  iconButton("plus", "New wiki", () => openWikis({ create: true })));
const sideHead = h("div", { class: "side-head" }, createFolderSwitcher(), notesActions, wikisActions);

const sectionHead = (title, ...actions) => h("div", { class: "side-section-head" },
  h("h2", { class: "side-title" }, title), h("div", { class: "side-actions" }, actions));
const pinnedList = h("div", { class: "nav-list" });
const pinnedGroup = h("div", { hidden: true }, sectionHead("Pinned"), pinnedList);
const recentList = h("div", { class: "nav-list" });
const recentGroup = h("div", { hidden: true }, sectionHead("Recent"), recentList);
const tree = h("div", { class: "tree" });

const notesPanel = h("div", { class: "space-panel", dataset: { space: "notes" } },
  h("div", { class: "nav-list" },
    navItem("edit", "New note", null, () => newNote().catch(alertError)),
    navItem("calendar", "Today's note", "Mod-Shift-D", openToday)),
  pinnedGroup,
  sectionHead("Folders", iconButton("newFolder", "New folder", () => treeView.newFolder())),
  tree,
  recentGroup);
const wikisPanel = h("div", { class: "space-panel", dataset: { space: "wikis" }, hidden: true });

const left = h("nav", { class: "sidebar sidebar-left", "aria-label": "Sidebar" }, sideHead, notesPanel, wikisPanel);

const RECENT_ROWS = 5;

/** A note's row in Pinned or Recent. */
function noteRow(path) {
  const row = navItem(path.startsWith(store.dailyFolder + "/") ? "calendar" : "file", noteName(path), null,
    (e) => openNote(path, { newTab: mod(e), beside: e.altKey }));
  row.classList.toggle("is-selected", path === store.currentPath);
  return row;
}

function renderPinned() {
  const paths = pinned().filter((p) => store.paths.includes(p));
  pinnedGroup.hidden = !paths.length;
  pinnedList.replaceChildren(...paths.map(noteRow));
}

// Recent: where you were, not the note you're in.
function renderRecent() {
  const paths = recentPaths().filter((p) => p !== store.currentPath && store.paths.includes(p) && !wikiOf(p)).slice(0, RECENT_ROWS);
  recentGroup.hidden = !paths.length;
  recentList.replaceChildren(...paths.map(noteRow));
}

const errorBar = h("div", { class: "app-error", role: "alert", hidden: true });
const noteEl = h("section", { class: "view note-view", hidden: true });
const searchEl = h("section", { class: "view search-view", hidden: true });
const emptyEl = h("section", { class: "view empty-view", hidden: true });
const pageEl = h("section", { class: "view page-view", hidden: true });
const wikisEl = h("section", { class: "view wikis-view", hidden: true });
const suggestionsEl = h("section", { class: "view suggestions-view", hidden: true });
const archiveEl = h("section", { class: "view archive-view", hidden: true });
const views = [noteEl, pageEl, wikisEl, suggestionsEl, archiveEl, searchEl, emptyEl];
const main = h("main", { class: "main" }, errorBar, views);

// Side by side: a second card for the note beside, the gap between the two a
// handle for resizing them, and where a dragged tab is dropped to open beside.
const sideEl = h("section", { class: "view note-view" });
const sideCard = h("div", { class: "main", hidden: true }, sideEl);
const gutter = h("div", {
  class: "pane-gutter", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize the two sides",
  tabindex: "0", hidden: true, dataset: { tip: "Drag to resize; double-click for half and half" },
}, icon("grip", 14));
const dropZone = h("div", { class: "drop-zone", hidden: true }, h("span", { class: "drop-label" }, "Open beside", icon("beside", 14)));
const panes = h("div", { class: "panes" }, main, gutter, sideCard, dropZone);

// The panel: Backlinks, Outline and Info, one at a time.
const backlinksEl = h("div");
const outlineEl = h("div");
const infoEl = h("div");

function navItem(iconName, label, shortcut, run) {
  return h("button", { class: "nav-item", type: "button", onClick: run },
    icon(iconName, 16), h("span", { class: "nav-label" }, label), shortcut ? keys(shortcut) : null);
}

// Both are chosen in Settings → Appearance.
let mode = readChoice(MODE_KEY, MODES);
let palette = readChoice(PALETTE_KEY, PALETTES);
const choice = (key, choices, get, set) => ({
  get,
  set(next) {
    if (!choices.includes(next) || next === get()) return;
    set(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* the choice lasts for this page only */
    }
    fadeTheme();
  },
});
const themeControl = {
  mode: choice(MODE_KEY, MODES, () => mode, (v) => (mode = v)),
  palette: choice(PALETTE_KEY, PALETTES, () => palette, (v) => (palette = v)),
};
systemDark.addEventListener("change", () => mode === "system" && fadeTheme());
applyTheme();

const noteView = createNoteView(noteEl);
const sideView = createNoteView(sideEl);
const pageView = createPageView(pageEl);
const searchView = createSearchView(searchEl);
const backlinks = createBacklinks(backlinksEl);
createOutline(outlineEl, { goToLine: (line) => noteView.goToLine(line) });
createInfo(infoEl);
const panel = createPanel([
  { id: "backlinks", label: "Backlinks", icon: "link", el: backlinksEl, count: backlinks.count },
  { id: "outline", label: "Outline", icon: "outline", el: outlineEl },
  { id: "info", label: "Info", icon: "info", el: infoEl },
]);
const treeView = createTree(tree);
createWikiNav(wikisPanel);
const wikisHome = createWikisHome(wikisEl);
const suggestionsView = createSuggestionsView(suggestionsEl);
const archiveView = createArchiveView(archiveEl);

const app = h("div", { class: "app" }, titlebar, rail, left, panes, panel.el);
document.body.append(app);

// Each view keeps its own header (name, state, actions); the title bar shows
// the open view's. A view that redraws its header has the new one moved too.
const heads = new Map();
let shownView = null;
function adoptHead(view) {
  const head = [...view.children].find((c) => c.classList.contains("note-head"));
  if (!head || (view === noteEl && splitShown())) return; // side by side, each card keeps its header
  heads.set(view, head);
  head.remove();
  if (view === shownView) titleSlot.replaceChildren(head);
}
for (const view of views) {
  adoptHead(view);
  new MutationObserver(() => adoptHead(view)).observe(view, { childList: true });
}

function toggleSidebar() {
  sideShown = !sideShown;
  setPref(SIDE_KEY, sideShown ? "1" : "0");
  applyPanes();
}

// Side by side the panel has its own setting, hidden at first, to give the two sides room.
const PANEL_SPLIT_KEY = "ory.panelSplit";
let panelInSplit = pref(PANEL_SPLIT_KEY, "0") === "1";

function togglePanel() {
  if (splitShown()) {
    panelInSplit = !panelInSplit;
    setPref(PANEL_SPLIT_KEY, panelInSplit ? "1" : "0");
  } else {
    panelShown = !panelShown;
    setPref(PANEL_KEY, panelShown ? "1" : "0");
  }
  applyPanes();
}

function applyPanes() {
  const panelOn = splitShown() ? panelInSplit : panelShown;
  app.classList.toggle("is-side-hidden", !sideShown);
  app.classList.toggle("is-panel-hidden", !panelOn);
  sideToggle.classList.toggle("is-on", sideShown);
  sideToggle.setAttribute("aria-pressed", String(sideShown));
  panelToggle.classList.toggle("is-on", panelOn);
  panelToggle.setAttribute("aria-pressed", String(panelOn));
}

// Side by side ---------------------------------------------------------------------
// Two notes at most, each its own card with its own header. The address, the
// tabs and the panel follow the side you're in; the other side's note keeps
// its tab, marked beside. Notes only: other places, and HTML pages, use the
// whole card, and the side comes back with the next note.

const BESIDE_KEY = () => `ory.beside:${store.vaultName}`;
const RATIO_KEY = "ory.splitRatio";
let active = "main"; // the side you're in: "main" or "side"
let ratio = Math.min(0.75, Math.max(0.25, Number(pref(RATIO_KEY, "0.5")) || 0.5));
const narrow = window.matchMedia("(max-width: 1100px)");

function isSplit() {
  return !!sideView.path;
}

/** Side by side is showing: a note in each card. */
function splitShown() {
  return isSplit() && shownView === noteEl && !!noteView.path;
}

function activeView() {
  return active === "side" && splitShown() ? sideView : noteView;
}

const closeButton = (run) => h("button", {
  class: "iconbtn", type: "button", "aria-label": "Close this side", dataset: { tip: "Close this side" }, hidden: true, onClick: run,
}, icon("close", 14));
const closeMain = closeButton(() => closeMainSide());
const closeBeside = closeButton(() => closeSide());
heads.get(noteEl)?.querySelector(".note-meta").append(closeMain);
sideEl.querySelector(":scope > .note-head .note-meta").append(closeBeside);

function layoutSplit() {
  const on = splitShown();
  if (!on) active = "main";
  panes.classList.toggle("is-split", on);
  sideCard.hidden = !on;
  gutter.hidden = !on;
  main.classList.toggle("is-inactive", on && active !== "main");
  sideCard.classList.toggle("is-inactive", on && active !== "side");
  closeMain.hidden = !on;
  closeBeside.hidden = !on;
  besideToggle.hidden = shownView !== noteEl;
  besideToggle.classList.toggle("is-on", on);
  besideToggle.setAttribute("aria-pressed", String(on));
  tabs.setBeside(on ? (active === "side" ? noteView.path : sideView.path) : null);
  layoutRatio();
  placeHeads();
  applyPanes();
  updateSourceLine();
  saveBeside();
}

function layoutRatio() {
  panes.style.setProperty("--left", `${ratio}fr`);
  panes.style.setProperty("--right", `${1 - ratio}fr`);
}

// One note: its header is in the title bar. Side by side: each in its card.
function placeHeads() {
  if (splitShown()) {
    const head = heads.get(noteEl);
    if (head && head.parentNode !== noteEl) noteEl.prepend(head);
    titleSlot.replaceChildren();
  } else {
    titleSlot.replaceChildren(heads.get(shownView) ?? "");
  }
}

/** Go to one side: the address, tabs, panel and outline follow it. */
function setActive(which) {
  active = splitShown() ? which : "main";
  const view = activeView();
  if (view.path) {
    history.replaceState(null, "", "#/" + encodeURI(view.path));
    document.title = `${noteName(view.path)} · Ory`;
    setCurrent(view.path);
    tabs.shown(view.path);
    emit("note-state", view.state);
  }
  layoutSplit();
}

for (const [card, which] of [[main, "main"], [sideCard, "side"]]) {
  const go = () => splitShown() && active !== which && setActive(which);
  card.addEventListener("focusin", go);
  card.addEventListener("pointerdown", go);
}

// Both sides, and the one you're in, so a reload brings them back as they were.
function saveBeside() {
  if (restoreBeside) return; // not before a reload's sides are back
  const main = noteView.path ?? pausedMain;
  setPref(BESIDE_KEY(), sideView.path && main ? JSON.stringify({ main, side: sideView.path, active }) : "");
}

// Leaving for another place (All wikis, Search...) closes the first side's
// note but keeps the side beside; coming back brings both.
let pausedMain = null;
async function leaveNotes() {
  if (isSplit() && noteView.path) pausedMain = noteView.path;
  await noteView.close();
}

/** Close the side beside; the other stays. */
async function closeSide() {
  if (!isSplit()) return;
  pausedMain = null;
  await sideView.close();
  saveBeside();
  setActive("main");
}

/** Close the first side: the note beside takes its place. */
async function closeMainSide() {
  const path = sideView.path;
  pausedMain = null;
  await sideView.close();
  saveBeside();
  active = "main";
  layoutSplit();
  if (path) openNote(path, { replace: true });
}

/** The side-by-side button: close the side, or open the note you were in before beside. */
function toggleBeside() {
  if (splitShown()) return closeSide();
  if (noteEl.hidden || !noteView.path) return;
  const before = recentPaths().find((p) => p !== noteView.path && store.paths.includes(p));
  if (before) openNote(before, { beside: true });
  else switcher.open({ beside: true });
}
window.addEventListener("ory:pick-beside", () => switcher.open({ beside: true }));

// Narrow windows have room for one: the note beside stays as a tab.
window.addEventListener("resize", () => narrow.matches && splitShown() && closeSide());

// The gap between the sides resizes them; double-click for half and half.
function setRatio(next) {
  ratio = Math.min(0.75, Math.max(0.25, next));
  layoutRatio();
  setPref(RATIO_KEY, String(ratio));
}
gutter.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  gutter.setPointerCapture(e.pointerId);
  const box = panes.getBoundingClientRect();
  const move = (ev) => setRatio((ev.clientX - box.left) / box.width);
  gutter.addEventListener("pointermove", move);
  gutter.addEventListener("pointerup", () => gutter.removeEventListener("pointermove", move), { once: true });
});
gutter.addEventListener("dblclick", () => setRatio(0.5));
gutter.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  setRatio(ratio + (e.key === "ArrowRight" ? 0.05 : -0.05));
});

// A tab dragged onto the card opens beside.
panes.addEventListener("dragover", (e) => {
  if (!e.dataTransfer.types.includes(TAB_DRAG) || noteEl.hidden || !noteView.path) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  dropZone.hidden = false;
});
panes.addEventListener("dragleave", (e) => {
  if (!panes.contains(e.relatedTarget)) dropZone.hidden = true;
});
panes.addEventListener("drop", (e) => {
  const path = e.dataTransfer.getData(TAB_DRAG);
  dropZone.hidden = true;
  if (!path) return;
  e.preventDefault();
  openNote(path, { beside: true });
});
document.addEventListener("dragend", () => (dropZone.hidden = true));

// With a note beside a wiki page, the page offers to take the note as a source.
const sourceText = h("span", { class: "source-line-text" });
const sourceLine = h("div", { class: "source-line" },
  icon("link", 14), sourceText,
  h("button", { class: "text-link", type: "button", onClick: () => addSource() }, "Add as source"),
  h("button", {
    class: "iconbtn", type: "button", "aria-label": "Not now", dataset: { tip: "Not now" },
    onClick: () => {
      passed.add(pairKey(sourcePair));
      updateSourceLine();
    },
  }, icon("close", 14)));
const passed = new Set(); // pairs added or dismissed, this session
let sourcePair = null;
const pairKey = (pair) => `${pair.page}\n${pair.note}`;

function sourcesOf(page) {
  const raw = store.notes.find((n) => n.path === page)?.properties?.sources;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
}

function updateSourceLine() {
  sourcePair = null;
  if (splitShown()) {
    const sides = [[noteView, noteEl], [sideView, sideEl]];
    const page = sides.find(([v]) => v.path && wikiOf(v.path) && !isUpkeep(v.path));
    const note = sides.find(([v]) => v.path && !wikiOf(v.path));
    if (page && note) {
      const pair = { page: page[0].path, note: note[0].path, view: page[0], el: page[1] };
      const linked = sourcesOf(pair.page).map((s) => resolve(s.replace(/^\[\[|\]\]$/g, "").split("|")[0], pair.page));
      if (!passed.has(pairKey(pair)) && !linked.includes(pair.note)) sourcePair = pair;
    }
  }
  if (!sourcePair) return sourceLine.remove();
  sourceText.replaceChildren(h("b", null, noteName(sourcePair.note)), ", open beside this page, isn't one of its sources.");
  const head = sourcePair.el.querySelector(":scope > .note-head");
  if (head) head.after(sourceLine);
  else sourcePair.el.prepend(sourceLine);
}

function addSource() {
  const { page, note, view } = sourcePair;
  view.setProperty("sources", [...sourcesOf(page), `[[${linkTextFor(note, page)}]]`]);
  passed.add(pairKey(sourcePair));
  updateSourceLine();
}

applyPanes();
const settings = createSettings({ theme: themeControl });
window.addEventListener("ory:settings", (e) => settings.open(e.detail?.section));

// While suggestions wait, the rail's Suggestions bulb is cast in liquid silver
// (ui/silver-icon.js), with how many; new ones arriving send a glint across it.
let waitingBefore = 0;
on("suggestions", () => {
  const n = waiting();
  railSuggestions.setAttribute("aria-label", n ? `Suggestions, ${n} waiting` : "Suggestions");
  railSuggestions.querySelector(":scope > .icon").toggleAttribute("hidden", !!n);
  railBulb.el.hidden = !n;
  railBadge.hidden = !n;
  railBadge.textContent = String(n);
  railBulb.wake();
  if (n > waitingBefore) railBulb.ping();
  waitingBefore = n;
});

// Notes and wikis are two spaces in one notes folder: the rail moves between
// them, and the sidebar shows the one you're in.
let space = "notes";
function setSpace(next) {
  space = next;
  notesPanel.hidden = space !== "notes";
  wikisPanel.hidden = space !== "wikis";
  notesActions.hidden = space !== "notes";
  wikisActions.hidden = space !== "wikis";
  setPlace();
}

// The rail marks where you are: the Archive or Suggestions when open, else the space.
function setPlace() {
  const place = shownView === archiveEl ? "archive" : shownView === suggestionsEl ? "suggestions" : space;
  for (const b of rail.querySelectorAll(".rail-btn")) {
    const here = b.dataset.place === place;
    b.classList.toggle("is-selected", here);
    b.toggleAttribute("aria-current", here);
  }
}
setSpace("notes");

on("pins", renderPinned);
on("current", () => {
  renderPinned();
  renderRecent();
  updateSourceLine();
});

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
  for (const el of views) el.hidden = el !== view;
  shownView = view;
  if (view !== archiveEl) archiveView.hide();
  // The panel belongs to a note or page; other views get the width.
  const panelled = view === noteEl || view === pageEl;
  app.classList.toggle("has-panel", panelled);
  panelToggle.hidden = !panelled;
  if (!panelled) tabs.none();
  setPlace();
  layoutSplit(); // places the view's header too
  if (view !== pageEl) pageView.close(); // stop a page's animation when it is not shown
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
      await leaveNotes();
      setCurrent(null);
      showOnly(searchEl); // a note route that finished meanwhile may have shown itself
      return;
    }
    if (r.view === "suggestions") {
      await leaveNotes();
      setCurrent(null);
      if (suggestionsEl.hidden) arrive(suggestionsEl);
      showOnly(suggestionsEl);
      suggestionsView.show(options);
      return;
    }
    if (r.view === "archive") {
      await leaveNotes();
      setCurrent(null);
      if (archiveEl.hidden) arrive(archiveEl);
      showOnly(archiveEl);
      archiveView.show();
      return;
    }
    if (r.view === "wikis") {
      await leaveNotes();
      setCurrent(null);
      if (wikisEl.hidden) arrive(wikisEl);
      showOnly(wikisEl);
      wikisHome.show(options);
      return;
    }
    if (r.view === "page") {
      await leaveNotes();
      if (pageEl.hidden || pageView.path !== r.path) arrive(pageEl);
      showOnly(pageEl);
      pageView.show(r.path);
      tabs.shown(r.path, options);
      return;
    }
    if (r.view === "note") {
      // Side by side, a note opens in the side you're in, or goes to the side
      // it's open in already. Opening beside sends it to the second card.
      const mainHasNote = !noteEl.hidden && !!noteView.path;
      if (options.beside && mainHasNote && r.path !== noteView.path && !narrow.matches) active = "side";
      if (isSplit() && mainHasNote) {
        if (r.path === noteView.path) return setActive("main");
        if (r.path === sideView.path) return setActive("side");
      } else if (isSplit() && r.path === sideView.path) {
        // Back from another place to the note beside: both sides come back.
        if (pausedMain && store.paths.includes(pausedMain) && !(await noteView.show(pausedMain)).error) {
          if (token !== routeToken) return;
          showOnly(noteEl);
          return setActive("side");
        }
        await sideView.close(); // the first side's note is gone: this one takes its place
        saveBeside();
      }
      const view = active === "side" && mainHasNote ? sideView : noteView;
      const { error } = await view.show(r.path);
      if (token !== routeToken) return; // you went elsewhere while it loaded
      if (error && view === sideView) {
        active = "main";
        layoutSplit();
        notify(error.status === 404 ? `"${r.path}" does not exist.` : error.message, "error");
      } else if (error) {
        showOnly(emptyEl);
        renderEmpty(error.status === 404 ? `"${r.path}" does not exist. It may have been moved or deleted.` : error.message);
      } else {
        if (view === noteView) {
          if (noteEl.hidden || arrivedPath !== r.path) arrive(noteEl);
          arrivedPath = r.path;
          showOnly(noteEl);
        } else {
          arrive(sideEl);
          saveBeside();
        }
        // Opened beside: a tab of its own; the first side keeps its tab.
        tabs.shown(r.path, view === sideView && options.beside ? { newTab: true } : options);
        layoutSplit();
        view.focus(options);
        if (restoreBeside) {
          restoreBeside = false;
          await reopenBeside();
        }
      }
    } else {
      await leaveNotes();
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
  else if (key === "," && !e.shiftKey) settings.toggle();
  else if (key === "\\" && !e.shiftKey) toggleSidebar();
  else if ((key === "\\" || key === "|") && e.shiftKey) toggleBeside();
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
  renderPinned();
  renderRecent();
  noteView.refreshLinks();
  sideView.refreshLinks();
  wikisHome.refresh();
  backlinks.refresh();
  noteView.checkDisk();
  sideView.checkDisk();
  layoutSplit();
  if (!searchEl.hidden) searchView.rerun();
});

// Boot ------------------------------------------------------------------------

// The note that was beside comes back with the first note opened.
let restoreBeside = true;
async function reopenBeside() {
  let saved = null;
  try {
    saved = JSON.parse(pref(BESIDE_KEY(), "") || "null");
  } catch {
    /* nothing saved, or from before */
  }
  if (!saved?.main || !saved.side || narrow.matches || ![saved.main, saved.side].every((p) => store.paths.includes(p))) return;
  // The address is the side you were in; put each note back on its own side.
  const inSide = noteView.path === saved.side;
  if (!inSide && noteView.path !== saved.main) return; // you opened something else
  if (inSide && (await noteView.show(saved.main)).error) return;
  if ((await sideView.show(saved.side)).error) return;
  tabs.shown(saved.side, { newTab: true });
  setActive(inSide ? "side" : "main");
}

(async () => {
  try {
    await loadIndex();
  } catch (err) {
    showOnly(emptyEl);
    renderEmpty(err.message);
    return;
  }
  api.settings().then((s) => setBudget(s.promptBudget)).catch(() => {});
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
