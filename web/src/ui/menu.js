// The "..." menu: a floating list of actions. Destructive actions confirm in
// place, replacing the menu with the action and "Cancel".

import { h, leave } from "./dom.js";

let open = null;

export function closeMenu({ restoreFocus = true } = {}) {
  if (!open) return;
  const { el, anchor, cleanup } = open;
  open = null;
  cleanup();
  leave(el, () => el.remove());
  anchor.setAttribute("aria-expanded", "false");
  if (restoreFocus) anchor.focus();
}

/**
 * items: [{label, run, confirm?, checked?}]. `confirm` is the question shown
 * before a destructive action runs; `checked` marks the current choice in a
 * menu of options. `align` is "end" (default) or "start".
 */
export function openMenu(anchor, items, { align = "end" } = {}) {
  if (open?.anchor === anchor) return closeMenu();
  closeMenu({ restoreFocus: false });

  const el = h("div", { class: "menu", role: "menu" });
  const renderItems = () => {
    el.replaceChildren(...items.map((item) => item === null
      ? h("div", { class: "menu-sep", role: "separator" }) // null: a hairline between groups
      : h("button", {
        class: `menu-item${item.checked ? " is-selected" : ""}`,
        role: item.checked == null ? "menuitem" : "menuitemradio",
        "aria-checked": item.checked == null ? null : String(item.checked),
        type: "button",
        onClick: () => (item.confirm ? renderConfirm(item) : finish(item)),
      }, item.label)));
    (el.querySelector(".is-selected") ?? el.querySelector("button"))?.focus();
  };
  const renderConfirm = (item) => {
    el.replaceChildren(
      h("p", { class: "menu-confirm" }, item.confirm),
      h("div", { class: "menu-actions" },
        h("button", { class: "btn btn--small", type: "button", onClick: () => finish(item) }, item.label),
        h("button", { class: "btn btn--small btn--plain", type: "button", onClick: renderItems }, "Cancel")),
    );
    el.querySelector("button").focus();
  };
  const finish = (item) => {
    closeMenu();
    item.run();
  };

  document.body.append(el);
  const rect = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  el.style.top = `${rect.bottom + 4}px`;
  // "end" lines the menu up with the anchor's right edge ("..." menus);
  // "start" with its left edge (dropdowns such as the paragraph style).
  const left = align === "start" ? rect.left : rect.right - width;
  el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const buttons = [...el.querySelectorAll("button")];
      const i = buttons.indexOf(document.activeElement);
      buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Tab") {
      closeMenu({ restoreFocus: false });
    }
  };
  const onPointer = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu({ restoreFocus: false });
  };
  const onBlur = () => closeMenu({ restoreFocus: false });
  el.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("blur", onBlur);
  open = {
    el,
    anchor,
    cleanup: () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
    },
  };
  anchor.setAttribute("aria-expanded", "true");
  renderItems();
}
