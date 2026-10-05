// Tabs: the open notes and pages, as small chips in the title bar. Opening a
// note shows it in the current tab, or switches to its tab if it's open
// already; Cmd-click, or the tabs' +, opens a new one. Other places (All wikis,
// Search, the Archive...) leave the tabs as they are, none of them chosen.
// Kept in this browser, one set per notes folder.

import { closeNote, onMove, openNote } from "../actions.js";
import { fileName, isPage, noteName } from "../links.js";
import { on, store } from "../store.js";
import { wikiOf } from "../wikis.js";
import { h, icon } from "./dom.js";

const key = () => `ory.tabs:${store.vaultName}`;

export function createTabs({ onAdd }) {
  let tabs = []; // paths
  let active = -1; // the tab shown, or -1 when another place is
  let last = 0; // the tab to reuse when a note opens from another place

  const list = h("div", { class: "tab-list", role: "tablist", "aria-label": "Open notes" });
  const add = h("button", {
    class: "iconbtn tab-add", type: "button", "aria-label": "Open a note in a new tab",
    dataset: { tip: "Open a note in a new tab" }, onClick: () => onAdd(),
  }, icon("plus", 14));
  const el = h("div", { class: "tabs" }, list, add);

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(key()));
      tabs = Array.isArray(saved) ? saved.filter((p) => typeof p === "string") : [];
    } catch {
      tabs = [];
    }
    active = -1;
    last = 0;
  }

  function save() {
    try {
      localStorage.setItem(key(), JSON.stringify(tabs));
    } catch {
      /* lasts for this page only */
    }
  }

  /** A note or page is shown: put it in a tab. */
  function shown(path, { newTab = false } = {}) {
    const open = tabs.indexOf(path);
    if (open >= 0) active = open;
    else if (newTab || !tabs.length) {
      tabs.splice(active + 1 || tabs.length, 0, path);
      active = tabs.indexOf(path);
    } else {
      active = active >= 0 ? active : Math.min(last, tabs.length - 1);
      tabs[active] = path;
    }
    last = active;
    save();
    render();
  }

  /** Another place is shown: no tab is chosen. */
  function none() {
    if (active >= 0) last = active;
    active = -1;
    render();
  }

  function close(i) {
    const wasActive = i === active;
    tabs.splice(i, 1);
    if (active > i) active--;
    save();
    if (wasActive) {
      const next = tabs[i] ?? tabs[i - 1];
      active = -1;
      if (next) openNote(next, { replace: true });
      else closeNote();
    }
    render();
  }

  function render() {
    list.replaceChildren(...tabs.map((path, i) => {
      const name = isPage(path) ? fileName(path).replace(/\.html?$/i, "") : noteName(path);
      const kind = isPage(path) ? "page" : wikiOf(path) ? "book" : path.startsWith(store.dailyFolder + "/") ? "calendar" : "file";
      const chosen = i === active;
      const tab = h("div", {
        class: `tab${chosen ? " is-selected" : ""}`, role: "tab", "aria-selected": String(chosen), tabindex: chosen ? "0" : "-1",
        title: path,
        onClick: () => !chosen && openNote(path),
        onAuxclick: (e) => e.button === 1 && close(i), // middle-click closes, as in a browser
        onKeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!chosen) openNote(path);
          } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
            if (next) openNote(next);
          }
        },
      },
      icon(kind, 14),
      h("span", { class: "tab-name" }, name),
      h("button", {
        class: "tab-close", type: "button", tabindex: "-1", "aria-label": `Close ${name}`,
        onClick: (e) => {
          e.stopPropagation();
          close(i);
        },
      }, icon("close", 12)));
      return tab;
    }));
    // Keep the chosen tab in view when there are more than fit.
    list.querySelector(".is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // Moves rename tabs; archiving closes them.
  onMove({
    before() {},
    after(from, to) {
      const before = tabs.join("\n");
      tabs = tabs.flatMap((p) => (p !== from && !p.startsWith(from + "/") ? [p] : to ? [to + p.slice(from.length)] : []));
      if (tabs.join("\n") !== before) {
        if (active >= tabs.length) active = tabs.length - 1;
        save();
        render();
      }
    },
  });

  // A note gone from disk (an agent archived it, say) leaves its tab.
  let vault = null;
  on("index", () => {
    if (store.vaultName !== vault) {
      vault = store.vaultName;
      load();
    }
    const known = new Set([...store.paths, ...store.filePaths]);
    const kept = tabs.filter((p) => known.has(p));
    if (kept.length !== tabs.length) {
      const current = tabs[active];
      tabs = kept;
      active = tabs.indexOf(current);
      save();
    }
    render();
  });

  return { el, shown, none };
}
