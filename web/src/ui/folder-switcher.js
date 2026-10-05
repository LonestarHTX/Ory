// The sidebar header's notes-folder switcher: the open folder's name; click it
// for the folders opened before, to switch back, or Settings to choose another.

import { alertError, openSettings } from "../actions.js";
import { api } from "../api.js";
import { on, store } from "../store.js";
import { h, icon } from "./dom.js";
import { openMenu } from "./menu.js";

export function createFolderSwitcher() {
  const name = h("span", { class: "folder-name" });
  const button = h("button", {
    class: "folder-switcher", type: "button", "aria-haspopup": "menu", "aria-label": "Notes folder",
    onClick: async () => {
      let recent = [];
      try {
        recent = (await api.settings()).recentNotesDirs ?? [];
      } catch {
        /* still offer Settings */
      }
      openMenu(button, [
        { label: store.vaultName, checked: true, run: () => {} },
        ...recent.map((dir) => ({ label: dir.split("/").filter(Boolean).pop() || dir, checked: false, run: () => switchTo(dir) })),
        { label: "Choose another folder…", run: () => openSettings("folders") },
      ], { align: "start" });
    },
  }, name, icon("chevronDown", 14));

  async function switchTo(dir) {
    try {
      await api.saveSettings({ notesDir: dir });
      location.hash = "#/";
      location.reload(); // another notes folder: everything starts again from it
    } catch (err) {
      alertError(err);
    }
  }

  on("index", () => {
    name.textContent = store.vaultName;
    button.title = `${store.vaultName}: switch notes folder`;
  });
  return button;
}
