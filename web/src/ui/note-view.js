// The open note: a header (folder, editable title, save state, "..." menu)
// over the editor. Saves as you type and picks up edits made on disk.
//
// A wiki page opens for reading: a page header (cover, title, summary,
// infobox) over the text with every mark hidden and nothing editable. E or
// Edit switches to the editor, Esc or Done back. A blank page opens ready to
// write. A wiki's Home adds its pages and recent changes below the text.

import { closeNote, followLink, movePath, notify, onMove, openNote, trashPath } from "../actions.js";
import { api } from "../api.js";
import { createEditor } from "../editor/index.js";
import { focusAddProperty, frontmatterRange, syncFocus } from "../editor/properties.js";
import { folderOf, noteName, parseLink } from "../links.js";
import { emit, linkTextFor, loadIndex, resolve, setCurrent, store } from "../store.js";
import { coverUrl, infoboxRows, isBlank, isHome, pageParts, pageTitle, wiki as wikiInfo, wikiFolder, wikiOf } from "../wikis.js";
import { clear, formatDate, h, icon, keys, timeAgo, todayISO } from "./dom.js";
import { readsWiki } from "./settings-view.js";
import { createFormatToolbar } from "./format-toolbar.js";
import { headings } from "./outline.js";
import { openMenu } from "./menu.js";

const SAVE_DELAY = 500;
const SOURCE_KEY = "ory.sourceMode";

export function createNoteView(el) {
  const crumb = h("span", { class: "note-crumb" });
  const title = h("input", { class: "input input--bare note-title", "aria-label": "Note name", spellcheck: "false" });
  const titleError = h("p", { class: "field-error", role: "alert", hidden: true });
  const modeLabel = h("span", { class: "note-mode", hidden: true }, "Source");
  const status = h("span", { class: "note-status", role: "status" });
  const more = h("button", {
    class: "iconbtn",
    type: "button",
    "aria-label": "Note actions",
    "aria-haspopup": "menu",
    dataset: { tip: "Note actions" },
    onClick: () => openMenu(more, menuItems()),
  }, icon("more", 16));
  const conflict = h("div", { class: "note-conflict", hidden: true });
  const host = h("div", { class: "note-editor" });
  const pageHead = h("div", { class: "page-head", hidden: true });
  const pageFoot = h("div", { class: "page-foot", hidden: true });
  const scroller = h("div", { class: "note-scroll" }, pageHead, host, pageFoot);
  const modeButton = h("button", { class: "btn btn--small", type: "button", hidden: true, onClick: () => setReading(!reading) });
  const toolbar = createFormatToolbar(() => editor.view, { attach: (files) => editor.insertFiles(files) });

  el.append(
    h("header", { class: "note-head" },
      h("div", { class: "note-name" }, crumb, title),
      h("div", { class: "note-meta" }, modeLabel, status, modeButton, more)),
    titleError,
    conflict,
    toolbar.el,
    scroller,
  );

  const editor = createEditor(host, {
    onChange: () => {
      dirty = true;
      setStatus("saving");
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY);
    },
    openLink: (link) => followLink(link),
    notes: () => store.notes,
    resolve: (target) => resolve(target),
    linkTextFor: (path) => linkTextFor(path),
    files: () => store.files,
    fileSize: (path) => store.files.find((f) => f.path === path)?.size ?? null,
    notePath: () => note?.path ?? null,
    indexVersion: () => store.version,
    openPath: (path) => openNote(path),
    afterUpload: () => loadIndex(),
    onError: (message) => notify(message, "error"),
    onSelection: (state) => {
      toolbar.update(state);
      emit("note-state", state);
    },
    editLink: (view) => toolbar.editLink(view),
    // A reused editor view keeps its focus across notes; the new state must know it.
    afterOpen: (view) => syncFocus(view),
  });

  let note = null; // {path, rev, mtime}
  let wiki = null; // the open page's wiki, or null for a note
  let reading = false;
  let dirty = false;
  let saving = null;
  let timer = null;
  let statusState = "idle";
  let savedAt = 0;
  let sourcePref = readSourcePref();
  let moving = null; // a promise while the open note's file is being moved

  // Saving -----------------------------------------------------------------------

  async function save() {
    clearTimeout(timer);
    // While the file is being renamed, wait and save to the new path.
    while (moving || saving) await (moving || saving);
    if (!dirty || !note || !conflict.hidden) return;
    const target = note;
    const text = editor.text();
    dirty = false;
    saving = api.save(target.path, text, target.rev)
      .then((result) => {
        target.rev = result.rev;
        target.mtime = result.mtime * 1000;
        savedAt = Date.now();
        if (target === note && !dirty) setStatus("saved");
      })
      .catch((err) => {
        if (err.status === 409 && err.data?.current) {
          dirty = true;
          if (target === note) showConflict(err.data.current);
        } else {
          dirty = true;
          if (target === note) setStatus("error", err.message);
          timer = setTimeout(save, 5000);
        }
      })
      .finally(() => {
        saving = null;
      });
    await saving;
  }

  /** Save anything pending. Called before switching notes or leaving the page. */
  async function flush() {
    clearTimeout(timer);
    while (moving || saving) await (moving || saving);
    if (!dirty || !note) return;
    if (conflict.hidden) await save();
    else await keepConflictCopy();
  }

  /**
   * Leaving a note with an unresolved conflict: the disk version stays, and the
   * edits made here are kept beside it as a copy rather than thrown away.
   */
  async function keepConflictCopy() {
    const folder = folderOf(note.path);
    const now = new Date();
    const time = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");
    const name = `${noteName(note.path)} (conflict ${todayISO(now)} ${time})`;
    const path = (folder ? folder + "/" : "") + name;
    try {
      await api.create(path, editor.text());
      notify(`"${noteName(note.path)}" changed on disk, so your edits were kept as "${name}".`);
    } catch (err) {
      notify(`Your edits to "${noteName(note.path)}" could not be kept: ${err.message}`, "error");
      return;
    }
    dirty = false;
    conflict.hidden = true;
  }

  function showConflict(current) {
    conflict.hidden = false;
    conflict.replaceChildren(
      h("p", null, h("span", { class: "status-dot warning" }), "This note changed on disk while you were editing it."),
      h("div", { class: "note-conflict-actions" },
        h("button", {
          class: "btn btn--small", type: "button",
          onClick: () => {
            conflict.hidden = true;
            dirty = false;
            note.rev = current.rev;
            note.mtime = current.mtime * 1000;
            editor.replace(current.text);
            setStatus("idle");
          },
        }, "Load disk version"),
        h("button", {
          class: "btn btn--small btn--plain", type: "button",
          onClick: () => {
            conflict.hidden = true;
            note.rev = current.rev;
            dirty = true;
            save();
          },
        }, "Keep mine")),
    );
    setStatus("conflict");
  }

  function setStatus(state, message = "") {
    statusState = state;
    status.replaceChildren();
    if (state === "saving") status.textContent = "Saving";
    else if (state === "saved") status.textContent = "Saved";
    else if (state === "conflict") status.textContent = "Not saved";
    else if (state === "error") status.append(h("span", { class: "status-dot error" }), `Not saved. ${message}`);
    else if (note) status.textContent = `Edited ${timeAgo(note.mtime)}`;
  }

  // "Saved" settles into "Edited 4 min ago".
  setInterval(() => {
    if (statusState === "saved" && Date.now() - savedAt > 4000) setStatus("idle");
    else if (statusState === "idle") setStatus("idle");
  }, 5000);

  // Showing notes ----------------------------------------------------------------

  async function show(path) {
    if (note?.path === path) {
      // Already open (for example, just renamed): keep the editor as it is.
      setCurrent(path);
      renderHead();
      return {};
    }
    await flush();
    editor.remember(note?.path);
    let data;
    try {
      data = await api.note(path);
    } catch (err) {
      note = null;
      wiki = null;
      reading = false;
      setCurrent(null);
      return { error: err };
    }
    note = { path: data.path, rev: data.rev, mtime: data.mtime * 1000 };
    dirty = false;
    conflict.hidden = true;
    wiki = wikiOf(data.path);
    reading = wiki != null && readsWiki() && !isBlank(data.text);
    sourcePref = readSourcePref(); // Settings may have changed it
    toolbar.reset(); // a link field left open belongs to the note being left
    setCurrent(data.path);
    renderHead();
    editor.open(data.path, data.text, { source: sourcePref, reading });
    renderMode();
    scroller.scrollTop = 0;
    setStatus("idle");
    return {};
  }

  // Reading and editing wiki pages ------------------------------------------------

  function setReading(on) {
    if (!note || !wiki || on === reading) return;
    reading = on;
    editor.setReading(on);
    renderMode();
    if (!on) editor.view.focus();
  }

  function renderMode() {
    el.classList.toggle("is-wiki", wiki != null);
    el.classList.toggle("is-reading", reading);
    toolbar.el.hidden = reading;
    modeLabel.hidden = reading || !sourcePref;
    modeButton.hidden = wiki == null;
    modeButton.className = `btn btn--small${reading ? "" : " btn--primary"}`;
    modeButton.replaceChildren(
      icon(reading ? "edit" : "check", 14),
      reading ? "Edit" : "Done",
      keys(reading ? "E" : "Esc"));
    modeButton.dataset.tip = reading ? "Edit this page" : "Finish editing";
    renderPage();
  }

  /** The page header and, for a wiki's Home, its pages and recent changes. */
  function renderPage() {
    if (!note) return;
    pageHead.hidden = !(wiki && reading);
    pageFoot.hidden = !(wiki && reading && isHome(note.path));
    if (pageHead.hidden) {
      pageHead.replaceChildren();
      pageFoot.replaceChildren();
      return;
    }
    const { properties } = pageParts(editor.text());
    const rows = infoboxRows(properties);
    const cover = coverUrl(properties.cover);
    const tags = [properties.tags ?? []].flat().filter(Boolean);
    const start = isHome(note.path) ? linkIn(properties.start) : null;
    clear(pageHead,
      cover ? h("div", { class: "page-cover" }, h("img", { src: cover, alt: "" })) : null,
      h("div", { class: `page-intro${rows.length ? " has-infobox" : ""}` },
        h("div", { class: "page-intro-text" },
          h("h1", { class: "page-title" }, pageTitle(note.path)),
          properties.summary ? h("p", { class: "page-summary" }, String(properties.summary)) : null,
          tags.length ? h("div", { class: "page-meta" },
            tags.map((tag) => h("span", { class: "tag" }, String(tag).replace(/^#/, "")))) : null,
          start ? h("button", {
            class: "btn btn--primary page-start", type: "button",
            onClick: () => followLink({ wikilink: start }),
          }, `Start here: ${parseLink(start).alias ?? parseLink(start).target}`, icon("arrowRight", 14)) : null),
        rows.length ? h("aside", { class: "infobox", "aria-label": "At a glance" },
          h("dl", null, rows.map(([key, value]) => [h("dt", null, key), h("dd", null, infoValue(value))]))) : null));
    pageFoot.replaceChildren(...(isHome(note.path) ? homeSections() : []));
  }

  function homeSections() {
    const w = wikiInfo(wiki);
    const card = (page) => h("button", { class: "page-card", type: "button", onClick: () => openNote(page.path) },
      h("span", { class: "page-card-title" }, noteName(page.path)),
      page.properties?.summary ? h("span", { class: "page-card-summary" }, String(page.properties.summary)) : null);
    const out = [];
    if (w.pages.length) out.push(h("section", null, h("h2", { class: "page-foot-title" }, "Pages"), h("div", { class: "page-cards" }, w.pages.map(card))));
    for (const s of w.sections) {
      if (!s.pages.length) continue;
      out.push(h("section", null,
        h("h2", { class: "page-foot-title" }, s.name, h("span", { class: "count" }, String(s.pages.length))),
        h("div", { class: "page-cards" }, s.pages.map(card))));
    }
    const recent = [...w.pages, ...w.sections.flatMap((s) => s.pages)].sort((a, b) => b.mtime - a.mtime).slice(0, 5);
    if (recent.length) {
      out.push(h("section", null,
        h("h2", { class: "page-foot-title" }, "Recently changed"),
        h("div", { class: "page-recent" }, recent.map((page) => h("button", {
          class: "page-recent-row", type: "button", onClick: () => openNote(page.path),
        }, h("span", null, noteName(page.path)), h("span", { class: "page-recent-when" }, timeAgo(page.mtime * 1000)))))));
    }
    return out;
  }

  /** A property value as page text: dates read as dates, [[links]] open. */
  function infoValue(value) {
    if (Array.isArray(value)) return value.flatMap((v, i) => (i ? [", ", infoValue(v)] : [infoValue(v)]));
    if (value instanceof Date) return formatDate(new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    if (value && typeof value === "object") return JSON.stringify(value);
    const text = String(value);
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(/\[\[([^\[\]]+)\]\]/g)) {
      parts.push(text.slice(last, m.index));
      const { target, alias, heading } = parseLink(m[1]);
      parts.push(h("a", {
        class: `wl${resolve(target) ? "" : " is-missing"}`, href: "#",
        onClick: (e) => (e.preventDefault(), followLink({ wikilink: m[1] })),
      }, alias ?? (heading ? `${target} › ${heading}` : target)));
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    return parts;
  }

  /** The inside of a [[link]] in a property, or null. */
  function linkIn(value) {
    const m = /^\s*\[\[([^\[\]]+)\]\]\s*$/.exec(String(value ?? ""));
    return m ? m[1] : null;
  }


  /** Focus the note once its view is visible: the title for a new note, else the text. */
  function focus(options = {}) {
    if (options.focusTitle) {
      title.focus();
      title.select();
    } else if (options.line != null) {
      editor.goToLine(options.line);
    } else if (options.heading) {
      // A link to a heading: the first heading whose text matches, ignoring case.
      const want = options.heading.trim().toLowerCase();
      const found = headings(editor.view.state).find((x) => x.text.toLowerCase() === want);
      if (found) editor.goToLine(found.line);
      else editor.view.focus();
    } else {
      editor.view.focus();
    }
  }

  function renderHead() {
    const folder = folderOf(note.path);
    // In a wiki the path reads from the wiki's name: "Night sky / Planets / ".
    const shown = wiki ? folder.slice(wikiFolder(wiki).length - wiki.length) : folder;
    crumb.textContent = shown ? `${shown} / ` : "";
    title.value = noteName(note.path);
    titleError.hidden = true;
    modeLabel.hidden = !sourcePref;
    document.title = `${noteName(note.path)} · Ory`;
  }

  /** Pick up edits made outside Ory, unless there are unsaved edits here. */
  async function checkDisk() {
    if (!note || dirty || saving || moving || !conflict.hidden) return;
    const path = note.path;
    let data;
    try {
      data = await api.note(path);
    } catch (err) {
      if (err.status === 404 && note?.path === path) {
        editor.forget(path);
        // A wiki page that went away: back to its wiki's Home, if there is one.
        const home = wiki ? wikiInfo(wiki).home : null;
        if (home && home.path !== path) openNote(home.path, { replace: true });
        else closeNote();
      }
      return;
    }
    if (note?.path !== path || dirty || saving || data.rev === note.rev) return;
    note.rev = data.rev;
    note.mtime = data.mtime * 1000;
    if (data.text !== editor.text()) editor.replace(data.text);
    setStatus("idle");
    renderPage();
  }

  // Title rename -----------------------------------------------------------------

  let renamingTitle = null;

  function commitTitle() {
    // Enter commits, then moving focus away blurs: both land here once.
    renamingTitle ??= doCommitTitle().finally(() => (renamingTitle = null));
    return renamingTitle;
  }

  async function doCommitTitle() {
    const value = title.value.trim();
    if (!note || value === noteName(note.path)) {
      titleError.hidden = true;
      return;
    }
    if (!value) {
      title.value = noteName(note.path);
      return;
    }
    const folder = folderOf(note.path);
    try {
      await movePath(note.path, `${folder ? folder + "/" : ""}${value}.md`);
      titleError.hidden = true;
    } catch (err) {
      titleError.hidden = false;
      titleError.replaceChildren(h("span", { class: "status-dot error" }), err.message);
    }
  }

  // Any rename or move that includes the open note, from here or the tree.
  let movingNote = null;
  let moveDone = null;
  onMove({
    before: async (from) => {
      if (note && (note.path === from || note.path.startsWith(from + "/"))) {
        await flush();
        movingNote = note;
        moving = new Promise((resolve) => (moveDone = resolve));
      }
    },
    after: (from, to) => {
      if (!moving) return;
      // Only the note that was open when the move began follows it.
      if (to && movingNote) {
        const newPath = movingNote.path === from ? to : to + movingNote.path.slice(from.length);
        editor.rekey(movingNote.path, newPath);
        movingNote.path = newPath;
        if (movingNote === note) {
          wiki = wikiOf(newPath);
          if (!wiki && reading) {
            reading = false;
            editor.setReading(false);
          }
          renderHead();
          renderMode();
        }
      }
      moving = null;
      movingNote = null;
      moveDone();
    },
  });

  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Focus moves on at once so typing carries on in the note; the blur commits.
      editor.view.focus();
    } else if (e.key === "Escape") {
      title.value = noteName(note.path);
      titleError.hidden = true;
      editor.view.focus();
    }
  });
  title.addEventListener("blur", commitTitle);

  // Menu -----------------------------------------------------------------------

  function toggleSource() {
    if (!note || reading) return;
    sourcePref = !sourcePref;
    try {
      localStorage.setItem(SOURCE_KEY, sourcePref ? "1" : "0");
    } catch {
      /* per-browser convenience only */
    }
    editor.setSourceMode(sourcePref);
    modeLabel.hidden = !sourcePref;
  }

  // E edits the page being read; Esc in the editor goes back to reading.
  window.addEventListener("keydown", (e) => {
    if (el.hidden || !wiki || !reading || e.key !== "e" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only'], .menu, dialog, [role='dialog']")) return;
    if (document.querySelector("[role='dialog']:not([hidden]), .menu")) return; // the switcher or a menu is open
    e.preventDefault();
    setReading(false);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || !wiki || reading || !host.contains(e.target)) return;
    e.preventDefault();
    setReading(true);
  });
  // Double-click while reading: edit there.
  host.addEventListener("dblclick", (e) => {
    if (!wiki || !reading || e.target.closest("a, button, input, .cm-wikilink, .cm-md-link, iframe")) return;
    const pos = editor.view.posAtCoords({ x: e.clientX, y: e.clientY });
    setReading(false);
    if (pos != null) editor.view.dispatch({ selection: { anchor: pos } });
  });

  function menuItems() {
    const items = [{ label: "Rename", run: () => (title.focus(), title.select()) }];
    if (!reading) items.push({ label: sourcePref ? "Show live preview" : "Show source", run: toggleSource });
    if (!reading && !frontmatterRange(editor.view.state.doc)) {
      items.push({
        label: "Add properties",
        run: () => {
          // An empty block shows as the properties table, ready to add the first one.
          focusAddProperty();
          editor.view.dispatch({ changes: { from: 0, insert: "---\n---\n" } });
        },
      });
    }
    items.push({ label: "Copy link", run: () => navigator.clipboard?.writeText(`[[${linkTextFor(note.path, null)}]]`) });
    items.push({
      label: "Move to trash",
      confirm: `Move "${noteName(note.path)}" to the trash?`,
      run: () => {
        editor.forget(note.path);
        trashPath(note.path);
      },
    });
    return items;
  }

  window.addEventListener("beforeunload", () => {
    if (dirty && note) api.save(note.path, editor.text(), note.rev, { keepalive: true }).catch(() => {});
  });

  return {
    show,
    focus,
    flush,
    checkDisk,
    toggleSource,
    refreshLinks: () => {
      editor.refreshLinks();
      if (reading) renderPage();
    },
    get reading() {
      return reading;
    },
    focusEditor: () => editor.view.focus(),
    get path() {
      return note?.path ?? null;
    },
    async close() {
      await flush();
      editor.remember(note?.path);
      note = null;
      wiki = null;
      reading = false;
      toolbar.reset();
      emit("note-state", null);
    },
    goToLine: (line) => editor.goToLine(line),
  };
}

function readSourcePref() {
  try {
    return localStorage.getItem(SOURCE_KEY) === "1";
  } catch {
    return false;
  }
}
