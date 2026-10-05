// The right panel: about the open note or page, one view at a time. A header
// row names the view and switches between them (Backlinks, Outline, Info);
// the choice is remembered.

import { pref, setPref } from "../prefs.js";
import { h, icon } from "./dom.js";

const VIEW_KEY = "ory.panelView";

/** views: [{id, label, icon, el, count?}] (each view's own element, built by its module). */
export function createPanel(views) {
  let current = pref(VIEW_KEY, views[0].id);
  if (!views.some((v) => v.id === current)) current = views[0].id;

  const title = h("h2", { class: "panel-title" });
  const switcher = h("div", { class: "panel-views", role: "tablist", "aria-label": "Panel view" });
  const body = h("div", { class: "panel-body" }, views.map((v) => v.el));
  const el = h("aside", { class: "panel", "aria-label": "About this note" },
    h("header", { class: "panel-head" }, title, switcher), body);

  function show(id) {
    current = id;
    setPref(VIEW_KEY, id);
    render();
  }

  function render() {
    const view = views.find((v) => v.id === current);
    title.replaceChildren(view.label, view.count ?? "");
    for (const v of views) v.el.hidden = v.id !== current;
    switcher.replaceChildren(...views.map((v) => h("button", {
      class: `panel-view${v.id === current ? " is-selected" : ""}`, type: "button", role: "tab",
      "aria-selected": String(v.id === current), "aria-label": v.label, dataset: { tip: v.label },
      onClick: () => v.id !== current && show(v.id),
    }, icon(v.icon, 14))));
  }

  render();
  return { el, show };
}
