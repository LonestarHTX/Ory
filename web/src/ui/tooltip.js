// Labels for buttons that show only an icon. Any element with data-tip gets
// one: its name, and its shortcut as a key cap when data-tip-keys is set.
// It appears after a short pause on hover (then at once while you move along
// a toolbar) and straight away on keyboard focus. The browser's own title
// tooltip is not used: it is slow, unstyled and absent on keyboard focus.

import { h, keys } from "./dom.js";

const DELAY = 450;
const WARM = 400; // after a tooltip hides, the next one shows at once for this long

let tip = null;
let target = null;
let timer = null;
let warmUntil = 0;

function show(el) {
  hide(false);
  target = el;
  const label = el.dataset.tip;
  if (!label) return;
  tip = h("div", { class: "tip", role: "tooltip", id: "ory-tip" },
    h("span", null, label),
    el.dataset.tipKeys ? keys(el.dataset.tipKeys) : null);
  document.body.append(tip);
  if (label !== el.getAttribute("aria-label")) el.setAttribute("aria-describedby", "ory-tip");

  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  const below = r.bottom + 6 + hgt <= window.innerHeight;
  tip.style.top = `${below ? r.bottom + 6 : r.top - 6 - hgt}px`;
  tip.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
}

function hide(warm = true) {
  clearTimeout(timer);
  timer = null;
  if (tip) {
    tip.remove();
    tip = null;
    if (warm) warmUntil = Date.now() + WARM;
  }
  target?.removeAttribute("aria-describedby");
  target = null;
}

export function installTooltips() {
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    if (Date.now() < warmUntil) show(el);
    else timer = setTimeout(() => show(el), DELAY);
  });
  document.addEventListener("pointerout", (e) => {
    if (target && !target.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el && el.matches(":focus-visible")) show(el);
  });
  document.addEventListener("focusout", () => hide(false));
  document.addEventListener("pointerdown", () => hide(false), true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide(false);
  }, true);
  window.addEventListener("scroll", () => hide(false), true);
}
