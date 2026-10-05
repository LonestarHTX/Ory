// An HTML page from the notes folder, shown across the main area: an
// interactive model, a calculator, a generated report. It runs in a sandboxed
// frame (see page_policy in ory/server.py), so it can script itself but
// cannot reach Ory, the notes or the network.

import { archivePath, archiveNote, openFile } from "../actions.js";
import { fileName, folderOf } from "../links.js";
import { linkTextFor, setCurrent } from "../store.js";
import { h, icon } from "./dom.js";
import { openMenu } from "./menu.js";

/** Where a page is served. */
export function pageUrl(path) {
  return "/files/" + path.split("/").map(encodeURIComponent).join("/");
}

/**
 * A frame for a page. `fragment` (from ![[Page.html#part]]) is passed on as the
 * URL's #fragment, so one page can show different parts in different notes. The sandbox comes from the server: every HTML file is
 * served with a "sandbox allow-scripts" policy, which gives the page no origin
 * of its own, so it cannot reach this page or the API, in a frame or in its
 * own tab. The frame carries no sandbox attribute of its own because some
 * embedded browsers (the Claude app's browser pane among them) refuse to load
 * sandboxed frames at all. Ory tells the page the theme when it loads.
 */
export function pageFrame(path, title, fragment = null) {
  const frame = h("iframe", {
    class: "page-frame",
    src: pageUrl(path) + (fragment ? "#" + encodeURIComponent(fragment) : ""),
    title,
    loading: "lazy",
    referrerpolicy: "no-referrer",
  });
  frame.addEventListener("load", () => sendTheme(frame));
  return frame;
}

// Themes ------------------------------------------------------------------------
// A page opens in Ory's theme without doing anything: the frame's colour scheme
// is what the page sees as prefers-color-scheme. When the theme changes while a
// page is open, browsers do not reliably tell the page, so:
//   - a page that listens for {type: "ory:theme", theme: "light" | "dark"} and
//     answers {type: "ory:theme-applied"} is told, and keeps its state;
//   - any other page is reloaded in the new theme.

const themeAware = new WeakSet();
let lastTheme = document.documentElement.dataset.theme;

window.addEventListener("message", (event) => {
  if (event.data?.type !== "ory:theme-applied") return;
  for (const frame of document.querySelectorAll("iframe.page-frame")) {
    if (frame.contentWindow === event.source) themeAware.add(frame);
  }
});

export function sendTheme(frame) {
  frame.contentWindow?.postMessage({ type: "ory:theme", theme: document.documentElement.dataset.theme }, "*");
}

export function broadcastTheme() {
  const theme = document.documentElement.dataset.theme;
  if (theme === lastTheme) return;
  lastTheme = theme;
  for (const frame of document.querySelectorAll("iframe.page-frame")) {
    if (themeAware.has(frame)) {
      sendTheme(frame);
    } else {
      const fresh = frame.cloneNode(false); // a new frame loads the page again
      fresh.addEventListener("load", () => sendTheme(fresh));
      frame.replaceWith(fresh);
    }
  }
}

export function createPageView(el) {
  const crumb = h("span", { class: "note-crumb" });
  const title = h("h1", { class: "note-heading" });
  const more = h("button", {
    class: "iconbtn",
    type: "button",
    "aria-label": "Page actions",
    "aria-haspopup": "menu",
    dataset: { tip: "Page actions" },
    onClick: () => openMenu(more, [
      { label: "Open in new tab", run: () => openFile(current) },
      { label: "Copy link", run: () => navigator.clipboard?.writeText(`[[${linkTextFor(current, null)}]]`) },
      { label: "Copy embed", run: () => navigator.clipboard?.writeText(`![[${linkTextFor(current, null)}]]`) },
      {
        label: "Archive",
        confirm: `Archive "${fileName(current)}"? ${archiveNote()}`,
        run: () => archivePath(current),
      },
    ]),
  }, icon("more", 16));
  const body = h("div", { class: "page-body" });

  el.append(
    h("header", { class: "note-head" },
      h("div", { class: "note-name" }, crumb, title),
      h("div", { class: "note-meta" },
        h("button", { class: "btn btn--small btn--plain", type: "button", onClick: () => openFile(current) }, "Open in new tab"),
        more)),
    body,
  );

  let current = null;

  return {
    show(path) {
      const folder = folderOf(path);
      crumb.textContent = folder ? `${folder} / ` : "";
      const name = fileName(path).replace(/\.html?$/i, "");
      title.textContent = name;
      document.title = `${name} · Ory`;
      setCurrent(path);
      if (current !== path) {
        current = path;
        body.replaceChildren(pageFrame(path, name));
      }
    },
    close() {
      current = null;
      body.replaceChildren();
    },
    get path() {
      return current;
    },
  };
}
