// The Archive: everything archived from the notes folder (notes, files,
// folders, whole wikis), newest first. Each item stays 30 days, then Ory
// deletes it (vault.archived). Restore puts it back where it was; Delete now,
// in its "..." menu, deletes it at once.

import { alertError, notify } from "../actions.js";
import { api } from "../api.js";
import { folderOf } from "../links.js";
import { on } from "../store.js";
import { formatDate, h, icon, relativeDay } from "./dom.js";
import { openMenu } from "./menu.js";

const DAY = 86400000;
const SOON_DAYS = 3; // deletions this close get a warning dot

const KIND_ICON = { note: "file", file: "file", folder: "folder", wiki: "book" };

export function createArchiveView(el) {
  let items = null;
  let error = "";
  let busy = null; // the id being restored or deleted
  let visible = false;

  async function load() {
    try {
      items = (await api.archived()).items;
      error = "";
    } catch (err) {
      error = err.message;
    }
    if (visible) render();
  }

  function show() {
    visible = true;
    document.title = "Archive · Ory";
    render();
    load();
  }

  function hide() {
    visible = false;
  }

  async function restore(item) {
    busy = item.id;
    render();
    try {
      const { path } = await api.restore(item.id);
      const folder = folderOf(path);
      notify(`Restored "${item.name}" to ${folder || "the top of the notes folder"}.`, "success");
      await load();
    } catch (err) {
      alertError(err);
    } finally {
      busy = null;
      render();
    }
  }

  async function deleteNow(item) {
    busy = item.id;
    render();
    try {
      await api.deleteArchived(item.id);
      await load();
    } catch (err) {
      alertError(err);
    } finally {
      busy = null;
      render();
    }
  }

  function render() {
    if (!visible) return;
    const head = h("header", { class: "note-head" },
      h("div", { class: "note-name" },
        h("h1", { class: "note-heading" }, "Archive"),
        items?.length ? h("span", { class: "count" }, String(items.length)) : null));
    if (error) {
      return el.replaceChildren(head, h("div", { class: "empty-state" },
        h("p", { class: "field-error", role: "alert" }, h("span", { class: "status-dot error" }), error)));
    }
    if (!items) return el.replaceChildren(head);
    if (!items.length) {
      return el.replaceChildren(head, h("div", { class: "empty-state" },
        h("p", null, "Nothing archived. Archived notes, folders and wikis stay here for 30 days, then they're deleted for good.")));
    }
    el.replaceChildren(head, h("div", { class: "archive-body" },
      h("table", { class: "archive-table" },
        h("thead", null, h("tr", null,
          h("th", null, "Name"), h("th", null, "Was in"), h("th", null, "Archived"), h("th", null, "Deleted"), h("th", { "aria-label": "Actions" }))),
        h("tbody", null, items.map(row)))));
  }

  function row(item) {
    // Something put in the archive folder some other way has no time: it's kept.
    const kept = item.deletesAt == null;
    const soon = !kept && item.deletesAt * 1000 - Date.now() < SOON_DAYS * DAY;
    const folder = item.from == null ? null : folderOf(item.from);
    const size = item.notes != null ? `${item.kind === "wiki" ? "wiki · " : ""}${item.notes} ${item.notes === 1 ? "note" : "notes"}` : null;
    const more = h("button", {
      class: "iconbtn", type: "button", "aria-label": `Actions for ${item.name}`, "aria-haspopup": "menu",
      disabled: busy ? true : null,
      onClick: () => openMenu(more, [{
        label: "Delete now",
        confirm: `Delete "${item.name}" now? It can't be restored.`,
        run: () => deleteNow(item),
      }]),
    }, icon("more", 16));
    return h("tr", null,
      h("td", null, h("span", { class: "archive-name" },
        icon(KIND_ICON[item.kind] ?? "file", 14),
        h("span", null, item.name),
        size ? h("span", { class: "archive-size" }, size) : null)),
      h("td", { class: folder == null ? "is-quiet" : "" },
        folder == null ? "Not recorded" : folder || "Top of the notes folder"),
      h("td", { class: kept ? "is-quiet" : "" }, kept ? "Not recorded" : archivedWords(item.archivedAt * 1000)),
      h("td", { class: kept ? "is-quiet" : "" }, kept ? "Not scheduled" : h("span", { class: "archive-when" },
        soon ? h("span", { class: "status-dot warning" }) : null,
        capital(relativeDay(new Date(item.deletesAt * 1000))))),
      h("td", { class: "archive-actions" },
        h("button", {
          class: "btn btn--small", type: "button", disabled: busy ? true : null,
          onClick: () => restore(item),
        }, busy === item.id ? "Restoring" : "Restore"),
        more));
  }

  // Archiving anywhere (or an agent restoring) changes the index; follow it.
  on("index", () => visible && load());

  return { show, hide };
}

const capital = (words) => words.charAt(0).toUpperCase() + words.slice(1);

/** "Today", "Yesterday", then the date. */
function archivedWords(ms) {
  const words = relativeDay(new Date(ms));
  return words === "today" || words === "yesterday" ? capital(words) : formatDate(new Date(ms));
}
