// The folder tree in the left sidebar: folders, notes and attachments.
// Keyboard: Up/Down move, Right/Left expand/collapse, Enter opens, F2 renames.
// Drag anything onto a folder to move it there; drop files from the desktop
// onto a folder to add them.

import {
  alertError, displayName, movePath, newFolder, newNote, openFile, openNote, renamePath, trashPath,
} from "../actions.js";
import { api } from "../api.js";
import { fileName, folderOf, isImage, isPage } from "../links.js";
import { loadIndex, on, store } from "../store.js";
import { inWikis } from "../wikis.js";
import { h, icon } from "./dom.js";
import { openMenu } from "./menu.js";

const EXPANDED_KEY = "ory.expanded";
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function loadExpanded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY)) || []);
  } catch {
    return new Set();
  }
}

export function createTree(el) {
  const expanded = loadExpanded();
  let renaming = null; // path being renamed inline
  let renameError = "";

  const saveExpanded = () => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      /* per-browser convenience only */
    }
  };

  const toggle = (folder, open = !expanded.has(folder)) => {
    if (open) expanded.add(folder);
    else expanded.delete(folder);
    saveExpanded();
    render(folder);
  };

  function build() {
    const root = { path: "", folders: new Map(), notes: [] };
    const folderNode = (path) => {
      let node = root;
      if (!path) return node;
      let sofar = "";
      for (const part of path.split("/")) {
        sofar = sofar ? `${sofar}/${part}` : part;
        if (!node.folders.has(part)) node.folders.set(part, { path: sofar, name: part, folders: new Map(), notes: [] });
        node = node.folders.get(part);
      }
      return node;
    };
    // The wikis folder has its own space (ui/wiki-nav.js); the tree is notes.
    for (const folder of store.folders) if (!inWikis(folder)) folderNode(folder);
    for (const note of store.notes) if (!inWikis(note.path)) folderNode(folderOf(note.path)).notes.push({ ...note, kind: "note" });
    for (const file of store.files) if (!inWikis(file.path)) folderNode(folderOf(file.path)).notes.push({ ...file, kind: "file" });
    return root;
  }

  function rows(node, depth, out) {
    const folders = [...node.folders.values()].sort((a, b) => collator.compare(a.name, b.name));
    for (const folder of folders) {
      const isOpen = expanded.has(folder.path);
      out.push(row({ kind: "folder", path: folder.path, name: folder.name, depth, isOpen }));
      if (isOpen) rows(folder, depth + 1, out);
    }
    for (const item of [...node.notes].sort((a, b) => collator.compare(a.name, b.name))) {
      out.push(row({ kind: item.kind, path: item.path, name: item.name, depth }));
    }
    return out;
  }

  function row({ kind, path, name, depth, isOpen }) {
    const selected = kind !== "folder" && path === store.currentPath;
    const wrap = h("div", {
      class: `tree-row${selected ? " is-selected" : ""}`,
      style: `--depth: ${depth}`,
      role: "treeitem",
      "aria-level": depth + 1,
      "aria-selected": selected ? "true" : "false",
      "aria-expanded": kind === "folder" ? String(isOpen) : null,
      draggable: renaming === path ? null : "true",
      dataset: { path, kind },
    });

    if (renaming === path) {
      const input = h("input", {
        class: "input input--bare tree-rename",
        value: name,
        "aria-label": `Rename ${name}`,
        spellcheck: "false",
        onKeydown: (e) => {
          if (e.key === "Enter") commitRename(path, input.value);
          if (e.key === "Escape") cancelRename(path);
          e.stopPropagation();
        },
        onBlur: () => renaming === path && commitRename(path, input.value),
      });
      wrap.append(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      return renameError ? [wrap, h("p", { class: "field-error tree-error", style: `--depth: ${depth}`, role: "alert" }, renameError)] : wrap;
    }

    const main = h("button", {
      class: "tree-item",
      type: "button",
      tabindex: -1,
      onClick: () => (kind === "folder" ? toggle(path) : kind === "file" && !isPage(path) ? openFile(path) : openNote(path)),
    },
    kind === "folder" ? h("span", { class: `tree-chevron${isOpen ? " is-open" : ""}` }, icon("chevron", 14)) : null,
    kind === "file"
      ? h("span", { class: "tree-file-icon" }, icon(isPage(path) ? "page" : isImage(path) ? "image" : "file", 14))
      : null,
    h("span", { class: "tree-name" }, name));

    const more = h("button", {
      class: "iconbtn tree-more",
      type: "button",
      tabindex: -1,
      "aria-label": `Actions for ${name}`,
      "aria-haspopup": "menu",
      dataset: { tip: kind === "folder" ? "New note or folder, rename, trash" : "Rename or move to trash" },
      onClick: (e) => {
        e.stopPropagation();
        openMenu(more, menuItems(kind, path, name));
      },
    }, icon("more", 16));

    wrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openMenu(more, menuItems(kind, path, name));
    });
    wrap.append(main, more);
    return wrap;
  }

  function menuItems(kind, path, name) {
    const items = [];
    if (kind === "folder") {
      items.push({ label: "New note", run: () => newNote(path).catch(alertError) });
      items.push({
        label: "New folder",
        run: async () => {
          try {
            const created = await newFolder(path);
            expanded.add(path);
            startRename(created);
          } catch (err) {
            alertError(err);
          }
        },
      });
    }
    items.push({ label: "Rename", run: () => startRename(path) });
    items.push({
      label: "Move to trash",
      confirm: kind === "folder" ? `Move "${name}" and everything in it to the trash?` : `Move "${name}" to the trash?`,
      run: () => trashPath(path),
    });
    return items;
  }

  function startRename(path) {
    renaming = path;
    renameError = "";
    render();
  }

  function cancelRename(path) {
    renaming = null;
    renameError = "";
    render(path);
  }

  async function commitRename(path, value) {
    if (!value.trim() || value.trim() === displayName(path)) return cancelRename(path);
    try {
      renaming = null;
      const { path: newPath } = await renamePath(path, value);
      if (expanded.delete(path)) {
        expanded.add(newPath);
        saveExpanded();
      }
      renameError = "";
      render(newPath);
    } catch (err) {
      renaming = path;
      renameError = err.message;
      render();
    }
  }

  function render(focusPath) {
    const hadFocus = el.contains(document.activeElement);
    const active = focusPath ?? document.activeElement?.closest?.(".tree-row")?.dataset.path;
    el.replaceChildren(...rows(build(), 0, []).flat());
    const rowsEls = [...el.querySelectorAll(".tree-row")];
    const target = rowsEls.find((r) => r.dataset.path === active)
      ?? rowsEls.find((r) => r.classList.contains("is-selected"))
      ?? rowsEls[0];
    target?.querySelector(".tree-item")?.setAttribute("tabindex", "0");
    if ((hadFocus || focusPath) && target && !renaming) target.querySelector(".tree-item").focus();
  }

  // Dragging ----------------------------------------------------------------

  /** The folder a drop at this element lands in: a folder row, a row's folder, or the root. */
  const dropFolder = (target) => {
    const rowEl = target.closest?.(".tree-row");
    if (!rowEl) return "";
    return rowEl.dataset.kind === "folder" ? rowEl.dataset.path : folderOf(rowEl.dataset.path);
  };
  const markDrop = (folder) => {
    for (const r of el.querySelectorAll(".is-drop")) r.classList.remove("is-drop");
    el.classList.toggle("is-drop-root", folder === "");
    if (folder) el.querySelector(`.tree-row[data-kind="folder"][data-path="${CSS.escape(folder)}"]`)?.classList.add("is-drop");
  };
  const clearDrop = () => {
    for (const r of el.querySelectorAll(".is-drop")) r.classList.remove("is-drop");
    el.classList.remove("is-drop-root");
  };

  el.addEventListener("dragstart", (e) => {
    const rowEl = e.target.closest?.(".tree-row");
    if (!rowEl) return;
    e.dataTransfer.setData("application/x-ory-path", rowEl.dataset.path);
    e.dataTransfer.setData("text/plain", rowEl.dataset.path);
    e.dataTransfer.effectAllowed = "all";
  });
  el.addEventListener("dragover", (e) => {
    const types = e.dataTransfer.types;
    if (!types.includes("application/x-ory-path") && !types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes("Files") ? "copy" : "move";
    markDrop(dropFolder(e.target));
  });
  el.addEventListener("dragleave", (e) => {
    if (!el.contains(e.relatedTarget)) clearDrop();
  });
  el.addEventListener("dragend", clearDrop);
  el.addEventListener("drop", async (e) => {
    const folder = dropFolder(e.target);
    clearDrop();
    const path = e.dataTransfer.getData("application/x-ory-path");
    const files = [...e.dataTransfer.files];
    if (!path && !files.length) return;
    e.preventDefault();
    try {
      if (path) {
        const to = folder ? `${folder}/${fileName(path)}` : fileName(path);
        if (to !== path && folder !== path) await movePath(path, to);
      } else {
        for (const file of files) await api.upload(file, { folder });
        await loadIndex();
      }
      if (folder) {
        expanded.add(folder);
        saveExpanded();
        render();
      }
    } catch (err) {
      alertError(err);
    }
  });

  el.setAttribute("role", "tree");
  el.setAttribute("aria-label", "Notes");
  el.addEventListener("keydown", (e) => {
    const rowEl = e.target.closest(".tree-row");
    if (!rowEl || e.target.tagName === "INPUT") return;
    const all = [...el.querySelectorAll(".tree-row")];
    const i = all.indexOf(rowEl);
    const move = (j) => {
      const next = all[Math.max(0, Math.min(all.length - 1, j))];
      for (const b of el.querySelectorAll(".tree-item")) b.setAttribute("tabindex", "-1");
      next.querySelector(".tree-item").setAttribute("tabindex", "0");
      next.querySelector(".tree-item").focus();
    };
    const { kind, path } = rowEl.dataset;
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(all.length - 1);
    else if (e.key === "ArrowRight" && kind === "folder") {
      if (!expanded.has(path)) toggle(path, true);
      else move(i + 1);
    } else if (e.key === "ArrowLeft") {
      if (kind === "folder" && expanded.has(path)) toggle(path, false);
      else {
        const parent = all.findIndex((r) => r.dataset.path === folderOf(path));
        if (parent !== -1) move(parent);
      }
    } else if (e.key === "F2") startRename(path);
    else return;
    e.preventDefault();
  });

  // Opening a note reveals it by expanding its folders; after that the user
  // may collapse them again.
  const reveal = (path) => {
    for (let folder = folderOf(path ?? ""); folder; folder = folderOf(folder)) expanded.add(folder);
    saveExpanded();
  };

  on("index", () => render());
  on("current", (path) => {
    reveal(path);
    render();
  });
  render();
}
