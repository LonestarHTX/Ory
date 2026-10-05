// Quick switcher (Mod-O, or the tabs' +): type to find a note by name, alias
// or path. Enter opens; Shift+Enter creates a note with the typed name; the
// last row, or Mod+Enter, searches every note for it. Opened from the tabs' +,
// what you choose opens in a new tab.

import { createNote, openNote, openSearch } from "../actions.js";
import { folderOf } from "../links.js";
import { recentPaths, store } from "../store.js";
import { closeMenu } from "./menu.js";
import { h, keys, leave } from "./dom.js";

const LIMIT = 50;

/** Score how well `query` matches `text`: exact > prefix > substring > in-order letters. */
export function matchScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;
  const i = t.indexOf(q);
  if (i !== -1) return 600 - i - t.length / 10 + (/[\s/_-]/.test(t[i - 1]) ? 100 : 0);
  let from = 0;
  let score = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const j = t.indexOf(ch, from);
    if (j === -1) return -1;
    run = j === from ? run + 1 : 0;
    score += 1 + run * 2;
    from = j + 1;
  }
  return 100 + score - t.length / 10;
}

function results(query) {
  query = query.trim();
  if (!query) {
    const known = new Set(store.paths);
    const recent = recentPaths().filter((p) => known.has(p));
    const rest = [...store.notes].sort((a, b) => b.mtime - a.mtime).map((n) => n.path).filter((p) => !recent.includes(p));
    const byPath = new Map(store.notes.map((n) => [n.path, n]));
    return [...recent, ...rest].slice(0, LIMIT).map((p) => ({ note: byPath.get(p) }));
  }
  const scored = [];
  for (const note of store.notes) {
    let best = { score: matchScore(query, note.name) };
    for (const alias of note.aliases) {
      const s = matchScore(query, alias) - 5;
      if (s > best.score) best = { score: s, alias };
    }
    const pathScore = matchScore(query, note.path) - 50;
    if (pathScore > best.score) best = { score: pathScore };
    if (best.score >= 0) scored.push({ note, ...best });
  }
  scored.sort((a, b) => b.score - a.score || a.note.name.localeCompare(b.note.name));
  return scored.slice(0, LIMIT);
}

export function createSwitcher() {
  let dialog = null;
  let returnFocus = null;

  /**
   * {newTab}: what's chosen opens in a new tab; {beside}: beside the note you're in.
   * {pick(path)}: choose a note for something (a template) instead of opening it.
   */
  function open({ newTab = false, beside = false, pick = null } = {}) {
    if (dialog) return dialog.querySelector("input").focus();
    closeMenu({ restoreFocus: false }); // a "…" menu would sit above the switcher
    returnFocus = document.activeElement;
    let items = [];
    let selected = 0;

    const input = h("input", {
      class: "input switcher-field",
      placeholder: pick ? "Choose a note" : "Open a note or search",
      "aria-label": "Note name",
      "aria-controls": "switcher-list",
      "aria-autocomplete": "list",
      role: "combobox",
      "aria-expanded": "true",
      spellcheck: "false",
      autocomplete: "off",
    });
    const list = h("div", { class: "switcher-list", id: "switcher-list", role: "listbox", "aria-label": "Notes" });
    const error = h("p", { class: "field-error", role: "alert", hidden: true });
    const foot = h("div", { class: "switcher-foot" },
      h("span", null, keys("Up"), keys("Down"), " Move"),
      h("span", null, keys("Enter"), " Open"),
      pick ? null : h("span", null, keys("Shift-Enter"), " Create"),
      pick ? null : h("span", null, keys("Mod-Enter"), " Search"),
      h("span", null, h("kbd", { class: "kbd" }, "esc"), " Close"));

    const render = () => {
      const query = input.value.trim();
      items = results(input.value);
      const exact = store.notes.some((n) => n.name.toLowerCase() === query.toLowerCase() || n.path.toLowerCase() === (query + ".md").toLowerCase());
      if (query && !exact && !pick) items.push({ create: query });
      if (query && !pick) items.push({ search: query });
      selected = Math.min(selected, Math.max(0, items.length - 1));
      list.replaceChildren(...items.map((item, i) => {
        const option = item.create
          ? h("div", { class: "switcher-item" }, h("span", { class: "switcher-name" }, `Create "${item.create}"`), keys("Shift-Enter"))
          : item.search
            ? h("div", { class: "switcher-item" }, h("span", { class: "switcher-name" }, `Search every note for "${item.search}"`), keys("Mod-Enter"))
            : h("div", { class: "switcher-item" },
              h("span", { class: "switcher-name" }, item.note.name),
              item.alias ? h("span", { class: "switcher-hint" }, item.alias) : null,
              h("span", { class: "switcher-path" }, folderOf(item.note.path)));
        option.id = `switcher-option-${i}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(i === selected));
        option.classList.toggle("is-selected", i === selected);
        option.addEventListener("mousedown", (e) => e.preventDefault());
        option.addEventListener("click", () => choose(i));
        return option;
      }));
      if (!items.length) list.append(h("p", { class: "switcher-empty" }, "No notes yet. Type a name to create one."));
      input.setAttribute("aria-activedescendant", items.length ? `switcher-option-${selected}` : "");
      list.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
    };

    const choose = async (i, forceCreate = false) => {
      const item = items[i];
      const query = input.value.trim();
      if (item?.search) {
        close(false);
        openSearch(item.search);
        return;
      }
      if (forceCreate || item?.create) {
        const name = forceCreate ? query : item.create;
        if (!name) return;
        try {
          const path = await createNote(name);
          close(false);
          openNote(path, { newTab, beside });
        } catch (err) {
          // An existing note with that name: open it instead of failing.
          if (err.status === 409) {
            close(false);
            openNote(name.toLowerCase().endsWith(".md") ? name : name + ".md", { newTab, beside });
          } else {
            error.hidden = false;
            error.replaceChildren(h("span", { class: "status-dot error" }), err.message);
          }
        }
        return;
      }
      if (!item) return;
      if (pick) {
        close();
        pick(item.note.path);
        return;
      }
      close(false);
      openNote(item.note.path, { newTab, beside });
    };

    input.addEventListener("input", () => {
      selected = 0;
      error.hidden = true;
      render();
    });
    input.addEventListener("keydown", (e) => {
      const move = (d) => {
        e.preventDefault();
        selected = (selected + d + items.length) % Math.max(1, items.length);
        render();
      };
      if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) move(1);
      else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) move(-1);
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (input.value.trim() && !pick) {
          close(false);
          openSearch(input.value.trim());
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(selected, e.shiftKey && !pick);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        e.preventDefault(); // focus stays in the dialog
      }
    });

    dialog = h("div", { class: "scrim", onMousedown: (e) => e.target === dialog && close() },
      h("div", { class: "window switcher", role: "dialog", "aria-modal": "true", "aria-label": "Open a note or search" },
        input, error, list, foot));
    document.body.append(dialog);
    render();
    input.focus();
  }

  function close(restore = true) {
    if (dialog) {
      const leaving = dialog;
      leave(leaving.firstChild, () => {});
      leave(leaving, () => leaving.remove());
    }
    dialog = null;
    if (restore && returnFocus?.isConnected) returnFocus.focus();
  }

  return { open, close, get isOpen() { return !!dialog; } };
}
