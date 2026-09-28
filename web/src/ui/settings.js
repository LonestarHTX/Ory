// Settings: a floating window, opened from the gear at the foot of the
// sidebar (or Cmd+,), with its own sidebar of sections: Folders (saved to
// ory.config.json on this computer), Appearance (this browser), and AI
// (connecting Claude, the guide for agents, the Suggestions prompt size).

import { alertError, notify } from "../actions.js";
import { api } from "../api.js";
import { setBudget } from "../suggestions/prompts.js";
import { closeMenu } from "./menu.js";
import { clear, h, icon, keys, leave } from "./dom.js";

export const SOURCE_KEY = "ory.sourceMode";
export const READ_WIKI_KEY = "ory.readWiki";

function pref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function setPref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* lasts for this page only */
  }
}

/** Whether wiki pages open for reading (the default) rather than editing. */
export const readsWiki = () => pref(READ_WIKI_KEY, "1") === "1";

const SECTIONS = [
  { id: "folders", label: "Folders", icon: "folder" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "ai", label: "AI", icon: "suggestions" },
];
const SECTION_KEY = "ory.settingsSection";

/** theme: {get(), set(name)} from main.js, which owns the theme. */
export function createSettings({ theme }) {
  let settings = null;
  let error = "";
  let busy = false;
  let draft = null; // folder fields being edited
  let section = pref(SECTION_KEY, "folders");
  let dialog = null;
  let content = null;
  let nav = null;
  let returnFocus = null;

  async function open(which) {
    if (which) section = which;
    if (!dialog) {
      closeMenu({ restoreFocus: false });
      returnFocus = document.activeElement;
      nav = h("nav", { class: "settings-nav", "aria-label": "Settings sections" });
      content = h("div", { class: "settings-content" });
      dialog = h("div", { class: "scrim", onMousedown: (e) => e.target === dialog && close() },
        h("div", {
          class: "window settings", role: "dialog", "aria-modal": "true", "aria-label": "Settings",
          onKeydown: (e) => {
            if (e.key === "Escape" && !e.defaultPrevented) {
              e.preventDefault();
              close();
            }
          },
        }, nav, content));
      document.body.append(dialog);
    }
    render();
    nav.querySelector(".is-selected")?.focus();
    try {
      settings = await api.settings();
      setBudget(settings.promptBudget);
      draft = null;
    } catch (err) {
      error = err.message;
    }
    render();
  }

  function close() {
    if (!dialog) return;
    const leaving = dialog;
    leave(leaving.firstChild, () => {});
    leave(leaving, () => leaving.remove());
    dialog = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  const el = { get hidden() { return !dialog; } };

  async function save(change, { reload = false } = {}) {
    if (busy) return;
    busy = true;
    error = "";
    try {
      settings = await api.saveSettings(change);
      setBudget(settings.promptBudget);
      draft = null;
      if (reload) {
        location.hash = "#/";
        location.reload(); // another notes folder: everything starts again from it
        return;
      }
    } catch (err) {
      error = err.message;
    } finally {
      busy = false;
    }
    render();
  }

  function render() {
    if (!dialog) return;
    const focusedNav = nav.contains(document.activeElement);
    clear(nav,
      h("h2", { class: "settings-title" }, "Settings"),
      SECTIONS.map((s) => h("button", {
        class: `nav-item${s.id === section ? " is-selected" : ""}`, type: "button",
        "aria-current": s.id === section ? "page" : null,
        onClick: () => {
          section = s.id;
          setPref(SECTION_KEY, section);
          error = "";
          render();
        },
      }, icon(s.icon, 16), h("span", { class: "nav-label" }, s.label))));
    if (focusedNav) nav.querySelector(".is-selected")?.focus();
    const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
    const scroll = content.querySelector(".settings-body")?.scrollTop ?? 0;
    clear(content,
      h("header", { class: "settings-head" },
        h("h2", null, current.label),
        h("button", { class: "iconbtn", type: "button", "aria-label": "Close settings", dataset: { tip: "Close", tipKeys: "Esc" }, onClick: close },
          icon("close", 16))),
      h("div", { class: "settings-body" },
        settings ? (current.id === "folders" ? folders() : current.id === "appearance" ? appearance() : ai()) : null,
        error ? h("p", { class: "field-error", role: "alert" }, h("span", { class: "status-dot error" }), error) : null));
    const body = content.querySelector(".settings-body");
    if (body) body.scrollTop = scroll;
  }

  // Folders -----------------------------------------------------------------------

  function folders() {
    draft ??= {
      notesDir: settings.notesDir,
      dailyFolder: settings.dailyFolder,
      attachmentsFolder: settings.attachmentsFolder,
      wikisFolder: settings.wikisFolder,
    };
    const field = (key, label, hint) => h("label", { class: "setting" },
      h("span", { class: "setting-label" }, label),
      h("input", {
        class: "input", value: draft[key], spellcheck: "false",
        onInput: (e) => (draft[key] = e.target.value),
        onKeydown: (e) => e.key === "Enter" && saveFolders(),
      }),
      hint ? h("span", { class: "setting-hint" }, hint) : null);
    const saveFolders = () => {
      const change = {};
      for (const key of ["dailyFolder", "attachmentsFolder", "wikisFolder"]) {
        if (draft[key] !== settings[key]) change[key] = draft[key];
      }
      const moving = draft.notesDir.trim() !== settings.notesDir;
      if (moving) change.notesDir = draft.notesDir;
      if (Object.keys(change).length) save(change, { reload: moving });
    };
    return h("section", { class: "settings-section" },
      h("p", { class: "settings-intro" }, "Saved on this computer in ", h("code", null, settings.configPath), ". Changing a folder's name here doesn't move anything; Ory looks in the folder you name."),
      field("notesDir", "Notes folder", settings.notesFromFlag
        ? "Ory was started with --notes; switching here also saves it for next time."
        : "The folder of Markdown files Ory opens. Switching reopens Ory on the new folder."),
      field("dailyFolder", "Daily notes", "Inside the notes folder. Leave empty for the top."),
      field("attachmentsFolder", "Attachments", "Where pasted pictures and files go. \"/\" is the top of the notes folder; \"./\" is next to the note."),
      field("wikisFolder", "Wikis", "Each folder inside it is one wiki."),
      h("div", { class: "setting-actions" },
        h("button", { class: "btn btn--small btn--primary", type: "button", disabled: busy ? true : null, onClick: saveFolders }, "Save folders")));
  }

  // Appearance and editing ---------------------------------------------------------------

  function appearance() {
    return h("section", { class: "settings-section" },
      h("p", { class: "settings-intro" }, "Kept in this browser."),
      choice("Theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], theme.get(), (v) => {
        theme.set(v);
        render();
      }),
      choice("Notes open in", [["0", "Live preview"], ["1", "Source"]], pref(SOURCE_KEY, "0"), (v) => {
        setPref(SOURCE_KEY, v);
        render();
      }, h("span", null, keys("Mod-E"), " switches while you write.")),
      choice("Wiki pages open", [["1", "For reading"], ["0", "For editing"]], pref(READ_WIKI_KEY, "1"), (v) => {
        setPref(READ_WIKI_KEY, v);
        render();
      }, h("span", null, keys("E"), " edits a page you're reading; ", keys("Esc"), " goes back.")));
  }

  // AI --------------------------------------------------------------------------------

  function ai() {
    const { desktop, code } = settings.mcp;
    const status = (on, text) => h("span", { class: "setting-status" }, h("span", { class: `status-dot ${on ? "success" : ""}` }), text);
    const copy = (text) => h("button", {
      class: "btn btn--small", type: "button",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          notify("Copied. Paste it into a terminal.");
        } catch {
          alertError(new Error("Couldn't copy; select the line and copy it instead."));
        }
      },
    }, icon("copy", 14), "Copy");
    const sizes = settings.promptSizes.map((n) => [String(n), `${n / 1000}k`]);
    return h("section", { class: "settings-section" },
      h("p", { class: "settings-intro" }, "Ory's tools let an AI search, read and write your notes, and file suggestions for you to review, over MCP."),
      h("div", { class: "setting" },
        h("span", { class: "setting-label" }, "Claude Desktop"),
        !desktop.installed ? status(false, "Not installed on this computer")
          : desktop.connected ? status(true, "Connected. Ory's tools load when Claude Desktop starts.")
            : desktop.running ? [
              status(false, "Not connected"),
              h("span", { class: "setting-hint" }, "Claude Desktop rewrites its settings while it's open, so connect it while it's closed: quit it, then either come back here and choose Connect, or run this in a terminal. Then open it again."),
              h("div", { class: "setting-row" },
                h("code", { class: "setting-command" }, settings.mcp.desktopCommand),
                copy(settings.mcp.desktopCommand),
                h("button", { class: "btn btn--small btn--plain", type: "button", onClick: () => open() }, "Check again")),
            ]
              : h("div", { class: "setting-row" }, status(false, "Not connected"),
              h("button", {
                class: "btn btn--small btn--primary", type: "button", disabled: busy ? true : null,
                onClick: async () => {
                  busy = true;
                  try {
                    settings.mcp = await api.connectDesktop();
                    notify("Connected. Quit and reopen Claude Desktop to load Ory's tools.");
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
          : [status(false, "Not connected. Run this once in a terminal:"),
            h("div", { class: "setting-row" }, h("code", { class: "setting-command" }, code.command), copy(code.command))]),
      h("label", { class: "setting setting--check" },
        h("input", {
          type: "checkbox", checked: settings.guides ? true : null,
          onChange: (e) => save({ guides: e.target.checked }),
        }),
        h("span", null,
          h("span", { class: "setting-label" }, "Keep a guide for AI agents in the notes folder"),
          h("span", { class: "setting-hint" }, "AGENTS.md and CLAUDE.md explain the folder's layout, conventions and commands to any agent opened in it. Hidden from Ory's own lists."))),
      choice("Suggestions prompt size", sizes, String(settings.promptBudget), (v) => save({ promptBudget: Number(v) }),
        h("span", null, "The longest prompt Ory asks you to paste, in characters (about four to a word). A bigger run is split into parts. Choose the smallest if your AI chat turns long messages away.")));
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
