// Settings: a floating window, opened from the gear at the foot of the
// sidebar (or Cmd+,), with its own sidebar of sections: Folders (saved to
// ory.config.json on this computer), Appearance and Editing (this browser),
// AI (connecting Claude, the guide for agents, the Suggestions prompt size),
// and a list of the keyboard shortcuts.

import { api } from "../api.js";
import { pref, READ_WIKI_KEY, setPref, SOURCE_KEY, SPELLCHECK_KEY, spellchecks } from "../prefs.js";
import { setBudget } from "../suggestions/prompts.js";
import { closeMenu } from "./menu.js";
import { clear, h, icon, keys, leave } from "./dom.js";

const SECTIONS = [
  { id: "folders", label: "Folders", icon: "folder" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "editing", label: "Editing", icon: "edit" },
  { id: "ai", label: "AI", icon: "suggestions" },
  { id: "shortcuts", label: "Shortcuts", icon: "keyboard" },
];
const SECTION_KEY = "ory.settingsSection";
const THEMES = [
  ["neutral", "Neutral", "Ory's own greys"],
  ["dusk", "Dusk", "Violet warming to wine"],
];
const FOLDER_KEYS = ["notesDir", "dailyFolder", "attachmentsFolder", "wikisFolder"];
const DESKTOP_CHECK_MS = 2500;

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent);

/** theme: {mode, palette}, each {get(), set(value)}, from main.js, which owns the theme. */
export function createSettings({ theme }) {
  let settings = null;
  let error = "";
  let busy = false;
  let draft = null; // folder fields being edited; kept if the window closes unsaved
  let saved = false; // "Saved" beside the folders' button until the next edit
  let section = pref(SECTION_KEY, "folders");
  if (!SECTIONS.some((s) => s.id === section)) section = "folders";
  let dialog = null;
  let content = null;
  let nav = null;
  let returnFocus = null;
  let desktopTimer = null;

  async function open(which) {
    if (which && SECTIONS.some((s) => s.id === which)) section = which;
    if (!dialog) {
      closeMenu({ restoreFocus: false });
      returnFocus = document.activeElement;
      error = "";
      saved = false;
      nav = h("nav", { class: "settings-nav", "aria-label": "Settings sections", onKeydown: navKeys });
      content = h("div", { class: "settings-content" });
      dialog = h("div", { class: "scrim", onMousedown: (e) => e.target === dialog && close() },
        h("div", {
          class: "window settings", role: "dialog", "aria-modal": "true", "aria-label": "Settings",
          onKeydown: windowKeys,
        }, nav, content));
      document.body.append(dialog);
      document.addEventListener("keydown", escape);
    }
    render();
    nav.querySelector(".is-selected")?.focus();
    try {
      settings = await api.settings();
      setBudget(settings.promptBudget);
    } catch (err) {
      error = err.message;
    }
    render();
  }

  function close() {
    if (!dialog) return;
    stopDesktopCheck();
    document.removeEventListener("keydown", escape);
    const leaving = dialog;
    leave(leaving.firstChild, () => {});
    leave(leaving, () => leaving.remove());
    dialog = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  // Keys: Esc closes (wherever focus is), Tab stays inside the window, arrows
  // move between sections.
  function escape(e) {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  }

  function windowKeys(e) {
    if (e.key === "Tab") {
      const all = focusables(e.currentTarget);
      if (!all.length) return;
      const [first, last] = [all[0], all[all.length - 1]];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function navKeys(e) {
    const i = SECTIONS.findIndex((s) => s.id === section);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: SECTIONS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    show(SECTIONS[(to + SECTIONS.length) % SECTIONS.length].id);
    nav.querySelector(".is-selected")?.focus();
  }

  function show(id) {
    section = id;
    setPref(SECTION_KEY, section);
    error = "";
    render();
  }

  async function save(change, { reload = false } = {}) {
    if (busy) return false;
    busy = true;
    error = "";
    try {
      settings = await api.saveSettings(change);
      setBudget(settings.promptBudget);
      if (reload) {
        location.hash = "#/";
        location.reload(); // another notes folder: everything starts again from it
        return true;
      }
      return true;
    } catch (err) {
      error = err.message;
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  function render() {
    if (!dialog) return;
    const focusedNav = nav.contains(document.activeElement);
    // Redrawing replaces the controls; focus goes back to the same place.
    const focusedAt = focusables(content).indexOf(document.activeElement);
    clear(nav,
      h("h2", { class: "settings-title" }, "Settings"),
      SECTIONS.map((s) => h("button", {
        class: `nav-item${s.id === section ? " is-selected" : ""}`, type: "button",
        "aria-current": s.id === section ? "page" : null,
        tabindex: s.id === section ? null : "-1", // one stop in Tab order; arrows move within
        dataset: { section: s.id },
        onClick: () => s.id !== section && show(s.id),
      }, icon(s.icon, 16), h("span", { class: "nav-label" }, s.label),
      s.id === "folders" && folderChanges() ? unsavedBadge() : null)));
    if (focusedNav) nav.querySelector(".is-selected")?.focus();
    const current = SECTIONS.find((s) => s.id === section);
    const scroll = content.querySelector(".settings-body")?.scrollTop ?? 0;
    const body = { folders, appearance, editing, ai, shortcuts }[current.id];
    clear(content,
      h("header", { class: "settings-head" },
        h("h2", null, current.label),
        h("button", { class: "iconbtn", type: "button", "aria-label": "Close settings", dataset: { tip: "Close", tipKeys: "Esc" }, onClick: close },
          icon("close", 16))),
      h("div", { class: "settings-body" },
        settings || current.id === "shortcuts" ? body() : null,
        error ? h("p", { class: "field-error", role: "alert" }, h("span", { class: "status-dot error" }), error) : null));
    content.querySelector(".settings-body").scrollTop = scroll;
    if (focusedAt >= 0) (focusables(content)[focusedAt] ?? nav.querySelector(".is-selected"))?.focus();
    watchDesktop();
  }

  // Folders -----------------------------------------------------------------------

  const unsavedBadge = () => h("span", { class: "settings-unsaved" }, "Unsaved");

  /** The folder fields changed from what's saved, as a change to send. */
  function folderChanges() {
    if (!draft || !settings) return null;
    const change = {};
    for (const key of FOLDER_KEYS) {
      if (draft[key].trim() !== String(settings[key]).trim()) change[key] = draft[key];
    }
    return Object.keys(change).length ? change : null;
  }

  function folders() {
    draft ??= Object.fromEntries(FOLDER_KEYS.map((key) => [key, settings[key]]));
    const saveButton = h("button", { class: "btn btn--small btn--primary", type: "button", onClick: () => saveFolders() }, "Save folders");
    const revertButton = h("button", {
      class: "btn btn--small btn--plain", type: "button",
      onClick: () => {
        draft = null;
        render();
        content.querySelector(".settings-body input")?.focus();
      },
    }, "Revert");
    const status = h("span", { class: "setting-status" }, h("span", { class: "status-dot success" }), "Saved");
    const sync = () => {
      const dirty = !!folderChanges();
      saveButton.disabled = busy || !dirty;
      revertButton.hidden = !dirty;
      status.hidden = dirty || !saved;
      nav.querySelector(".settings-unsaved")?.remove();
      if (dirty) nav.querySelector("[data-section=folders]")?.append(unsavedBadge());
    };
    const saveFolders = async () => {
      const change = folderChanges();
      if (!change || busy) return;
      const moving = "notesDir" in change;
      if (await save(change, { reload: moving })) {
        draft = null;
        saved = true;
        render();
      }
    };
    const field = (key, label, hint) => h("label", { class: "setting" },
      h("span", { class: "setting-label" }, label),
      h("input", {
        class: "input", value: draft[key], spellcheck: "false", "data-key": key,
        onInput: (e) => {
          draft[key] = e.target.value;
          saved = false;
          sync();
        },
        onKeydown: (e) => e.key === "Enter" && saveFolders(),
      }),
      hint ? h("span", { class: "setting-hint" }, hint) : null);
    const form = h("section", { class: "settings-section" },
      h("p", { class: "settings-intro" }, "Saved on this computer in ", h("code", null, settings.configPath), ". Changing a folder's name here doesn't move anything; Ory looks in the folder you name."),
      field("notesDir", "Notes folder", settings.notesFromFlag
        ? "Ory was started with --notes; switching here also saves it for next time."
        : "The folder of Markdown files Ory opens. Switching reopens Ory on the new folder."),
      field("dailyFolder", "Daily notes", "Inside the notes folder. Leave empty for the top."),
      field("attachmentsFolder", "Attachments", "Where pasted pictures and files go. \"/\" is the top of the notes folder; \"./\" is next to the note."),
      field("wikisFolder", "Wikis", "Each folder inside it is one wiki."),
      h("div", { class: "setting-actions" }, saveButton, revertButton, status));
    sync();
    return form;
  }

  // Appearance and Editing ---------------------------------------------------------------

  function appearance() {
    return h("section", { class: "settings-section" },
      h("p", { class: "settings-intro" }, "Kept in this browser."),
      themes(),
      choice("Light or dark", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], theme.mode.get(), (v) => {
        theme.mode.set(v);
        render();
      }, "System follows your computer's setting."));
  }

  /** The themes as cards, each drawing a small Ory window in its own colours. */
  function themes() {
    const preview = (id) => h("span", { class: "theme-preview", dataset: { palette: id }, "aria-hidden": "true" },
      h("span", { class: "theme-preview-head" }, h("span", { class: "theme-preview-switch" }), h("span", { class: "theme-preview-field" })),
      h("span", { class: "theme-preview-side" }, h("i"), h("i"), h("i")),
      h("span", { class: "theme-preview-card" }, h("i"), h("i"), h("i")));
    const current = theme.palette.get();
    return h("div", { class: "setting" },
      h("span", { class: "setting-label" }, "Theme"),
      h("div", { class: "theme-cards", role: "radiogroup", "aria-label": "Theme" },
        THEMES.map(([id, name, note]) => h("button", {
          class: `theme-card${id === current ? " is-selected" : ""}`, type: "button", role: "radio",
          "aria-checked": String(id === current),
          onClick: () => {
            if (id === current) return;
            theme.palette.set(id);
            render();
          },
        }, preview(id), h("span", { class: "theme-card-name" }, name), h("span", { class: "theme-card-note" }, note)))));
  }

  function editing() {
    return h("section", { class: "settings-section" },
      h("p", { class: "settings-intro" }, "Kept in this browser."),
      choice("Notes open in", [["0", "Live preview"], ["1", "Source"]], pref(SOURCE_KEY, "0"), (v) => {
        setPref(SOURCE_KEY, v);
        render();
      }, h("span", null, keys("Mod-E"), " switches while you write.")),
      choice("Wiki pages open", [["1", "For reading"], ["0", "For editing"]], pref(READ_WIKI_KEY, "1"), (v) => {
        setPref(READ_WIKI_KEY, v);
        render();
      }, h("span", null, keys("E"), " edits a page you're reading; ", keys("Esc"), " goes back.")),
      choice("Spell check", [["1", "On"], ["0", "Off"]], spellchecks() ? "1" : "0", (v) => {
        setPref(SPELLCHECK_KEY, v);
        // Open notes and tables pick it up at once; new ones read it as they open.
        for (const el of document.querySelectorAll(".note-editor .cm-content, .md-cell[contenteditable]")) el.spellcheck = v === "1";
        render();
      }, "Your browser underlines words it doesn't know as you write."));
  }

  // AI --------------------------------------------------------------------------------

  function ai() {
    const { desktop, code } = settings.mcp;
    const status = (on, text) => h("span", { class: "setting-status" }, h("span", { class: `status-dot ${on ? "success" : ""}` }), text);
    return h("section", { class: "settings-section" },
      h("p", { class: "settings-intro" }, "Ory's tools let an AI search, read and write your notes, and file suggestions for you to review, over MCP."),
      h("div", { class: "setting" },
        h("span", { class: "setting-label" }, "Claude Desktop"),
        !desktop.installed ? status(false, "Not installed on this computer")
          : desktop.connected ? status(true, desktop.running
            ? "Connected. If Ory's tools don't show yet, quit and reopen Claude Desktop."
            : "Connected. Ory's tools load when Claude Desktop starts.")
            : desktop.running ? [
              status(false, "Not connected"),
              h("span", { class: "setting-hint" }, "Claude Desktop rewrites its settings while it's open, so connect it while it's closed. Quit it and a Connect button appears here; or run this in a terminal once it's closed. Then open it again."),
              command(settings.mcp.desktopCommand),
            ]
              : h("div", { class: "setting-row" }, status(false, "Not connected"),
                h("button", {
                  class: "btn btn--small btn--primary", type: "button", disabled: busy ? true : null,
                  onClick: async () => {
                    busy = true;
                    error = "";
                    try {
                      settings.mcp = await api.connectDesktop();
                    } catch (err) {
                      error = err.message;
                    } finally {
                      busy = false;
                    }
                    render();
                  },
                }, "Connect"))),
      h("div", { class: "setting" },
        h("span", { class: "setting-label" }, "Claude Code"),
        code.connected ? status(true, "Connected in every project.")
          : [status(false, "Not connected. Run this once in a terminal:"), command(code.command)]),
      h("label", { class: "setting setting--check" },
        h("input", {
          type: "checkbox", checked: settings.guides ? true : null,
          onChange: (e) => save({ guides: e.target.checked }),
        }),
        h("span", null,
          h("span", { class: "setting-label" }, "Keep a guide for AI agents in the notes folder"),
          h("span", { class: "setting-hint" }, "AGENTS.md and CLAUDE.md explain the folder's layout, conventions and commands to any agent opened in it. Hidden from Ory's own lists."))),
      choice("Suggestions prompt size", settings.promptSizes.map((n) => [String(n), `${n / 1000}k`]), String(settings.promptBudget),
        (v) => save({ promptBudget: Number(v) }),
        "The longest prompt Ory asks you to paste, in characters (about four to a word). A bigger run is split into parts. Choose the smallest if your AI chat turns long messages away."));
  }

  /** A command to run in a terminal, with a Copy button that says when it worked. */
  function command(text) {
    const label = h("span", null, "Copy");
    const button = h("button", {
      class: "btn btn--small", type: "button",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          button.replaceChildren(icon("check", 14), "Copied");
        } catch {
          button.replaceChildren(icon("warning", 14), "Select and copy it");
        }
        setTimeout(() => button.isConnected && button.replaceChildren(icon("copy", 14), label), 2000);
      },
    }, icon("copy", 14), label);
    return h("div", { class: "setting-command-row" }, h("code", { class: "setting-command" }, text), button);
  }

  // Claude Desktop can only be connected while it's closed, so while it's open
  // and not connected, keep checking: the Connect button appears once it quits.
  function watchDesktop() {
    const desktop = settings?.mcp?.desktop;
    const waiting = dialog && section === "ai" && desktop?.installed && !desktop.connected && desktop.running;
    if (!waiting) return stopDesktopCheck();
    if (desktopTimer) return;
    desktopTimer = setInterval(async () => {
      try {
        const next = (await api.settings()).mcp;
        const was = settings.mcp.desktop;
        settings.mcp = next;
        if (next.desktop.running !== was.running || next.desktop.connected !== was.connected) render();
      } catch {
        /* try again next time */
      }
    }, DESKTOP_CHECK_MS);
  }

  function stopDesktopCheck() {
    clearInterval(desktopTimer);
    desktopTimer = null;
  }

  // Shortcuts ---------------------------------------------------------------------------

  function shortcuts() {
    const group = (title, rows) => h("div", { class: "setting" },
      h("h3", { class: "setting-label" }, title),
      h("dl", { class: "settings-keys" }, rows.map(([label, ...combos]) => h("div", { class: "settings-key" },
        h("dt", null, label),
        h("dd", null, combos.map((c) => (c.startsWith("[") || c.length === 1 ? h("kbd", { class: "kbd" }, c) : keys(c))))))));
    return h("section", { class: "settings-section" },
      group("Anywhere", [
        ["Open or create a note", "Mod-O"],
        ["Search everything", "Mod-Shift-F"],
        ["Open today's note", "Mod-Shift-D"],
        ["Settings", "Mod-,"],
      ]),
      group("Writing", [
        ["Live preview or source", "Mod-E"],
        ["Bold", "Mod-B"],
        ["Italic", "Mod-I"],
        ["Strikethrough", "Mod-Shift-X"],
        ["Highlight", "Mod-Shift-H"],
        ["Link", "Mod-K"],
        ["Link to a note or page", "[["],
        ["Open the link at the cursor", "Mod-Enter"],
        ["Bulleted list", "Mod-Shift-8"],
        ["Numbered list", "Mod-Shift-7"],
        ["Checklist", "Mod-Shift-9"],
        ["Heading 1, 2, 3", "Mod-Alt-1", "Mod-Alt-2", "Mod-Alt-3"],
        ["Body text", "Mod-Alt-0"],
        ["Find in this note", "Mod-F"],
        ["Undo", "Mod-Z"],
        ["Redo", "Mod-Shift-Z"],
      ]),
      group("Wiki pages", [
        ["Edit the page you're reading", "E"],
        ["Back to reading", "Esc"],
      ]),
      group("Lists and windows", [
        ["Move through results", "Up", "Down"],
        ["Open", "Enter"],
        ["Create a note with the name typed", "Shift-Enter"],
        ["Close", "Esc"],
      ]));
  }

  function choice(label, options, value, onPick, hint) {
    return h("div", { class: "setting" },
      h("span", { class: "setting-label" }, label),
      h("div", { class: "seg-control", role: "radiogroup", "aria-label": label },
        options.map(([v, text]) => h("button", {
          class: `seg-option${v === value ? " is-selected" : ""}`, type: "button", role: "radio",
          "aria-checked": String(v === value),
          onClick: () => v !== value && onPick(v),
        }, text))),
      hint ? h("span", { class: "setting-hint" }, hint) : null);
  }

  return {
    open,
    close,
    toggle: () => (dialog ? close() : open()),
    get isOpen() {
      return !!dialog;
    },
  };
}
