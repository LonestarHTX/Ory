// Text colour picker: a dish of
// overlapping colour petals with a curved lightness slider beside it, the
// theme inks, and a hex field. The dish glows in the chosen colour, like the
// corona in an eclipse. It is the design system's one playful object, and the
// one deliberate exception to its scales (see DESIGN.md).
//
// openColorPicker({ anchor, color, onPick, onClose }): onPick gets a hex
// string, a theme ink such as "var(--ink-red)", or null for "back to default".

import { Check } from "lucide";

import { hexToHsl, hslToHex, normaliseHex } from "./color.js";
import { leave } from "./dom.js";

/** Theme inks follow light and dark mode; picked colours are shown readably in both. */
export const THEME_INKS = [
  ["Blue", "var(--ink-blue)"],
  ["Green", "var(--ink-green)"],
  ["Amber", "var(--ink-amber)"],
  ["Red", "var(--ink-red)"],
  ["Grey", "var(--ink-grey)"],
];

const SVG = "http://www.w3.org/2000/svg";
let closeCurrent = () => {};

export function closeColorPicker() {
  closeCurrent();
}

export function openColorPicker({ anchor, color, onPick, onClose }) {
  closeCurrent();
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const svgNode = (tag, attrs) => {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };

  let { h, s, l } = hexToHsl(normaliseHex(color || "") || "#d9a05b");
  const pop = make("div", "cp");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Text colour");

  /* The dish of petals */
  const SIZE = 232;
  const dish = make("div", "cp__dish");
  const addPetal = (hue, sat, light, distance, angle, radius, order, name) => {
    const petal = make("button", "cp__petal");
    petal.type = "button";
    petal.setAttribute("aria-label", name);
    petal.dataset.tip = name;
    const rad = (angle * Math.PI) / 180;
    petal.style.cssText = `--x:${(Math.sin(rad) * distance).toFixed(1)}px;--y:${(-Math.cos(rad) * distance).toFixed(1)}px;--d:${order * 18}ms;width:${radius * 2}px;height:${radius * 2}px;background:${hslToHex(hue, sat, light)}`;
    petal.addEventListener("click", () => {
      h = hue;
      s = sat;
      l = light;
      update(true);
    });
    dish.append(petal);
  };
  const HUES = ["Red", "Orange", "Amber", "Yellow", "Lime", "Green", "Teal", "Cyan", "Blue", "Indigo", "Violet", "Pink"];
  HUES.forEach((name, i) => addPetal(i * 30, 82, 56, 74, i * 30, 33, i, name));
  HUES.filter((_, i) => i % 2 === 0).forEach((name, i) => addPetal(i * 60, 70, 76, 37, i * 60 + 30, 31, 12 + i, `Pale ${name.toLowerCase()}`));
  dish.append(make("span", "cp__heart"));

  /* The curved lightness slider, concentric with the dish */
  const CX = -(SIZE / 2 + 10);
  const CY = SIZE / 2;
  const R = SIZE / 2 + 34;
  const SPAN = 38;
  const point = (deg) => [CX + R * Math.cos((deg * Math.PI) / 180), CY + R * Math.sin((deg * Math.PI) / 180)];
  const arc = svgNode("svg", {
    class: "cp__arc", width: 56, height: SIZE, viewBox: `0 0 56 ${SIZE}`, role: "slider", tabindex: 0,
    "aria-label": "Lightness", "aria-valuemin": 5, "aria-valuemax": 95,
  });
  const gradId = "cp-grad-" + Math.random().toString(36).slice(2, 8);
  const grad = svgNode("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
  const stops = [0, 0.5, 1].map((offset) => svgNode("stop", { offset }));
  grad.append(...stops);
  const defs = svgNode("defs");
  defs.append(grad);
  const [sx, sy] = point(-SPAN);
  const [ex, ey] = point(SPAN);
  const track = svgNode("path", {
    d: `M${sx} ${sy} A${R} ${R} 0 0 1 ${ex} ${ey}`, fill: "none", stroke: `url(#${gradId})`,
    "stroke-width": 14, "stroke-linecap": "round",
  });
  const thumb = svgNode("circle", { r: 11, class: "cp__thumb" });
  arc.append(defs, track, thumb);

  const setLightFromPointer = (event) => {
    const box = arc.getBoundingClientRect();
    const deg = (Math.atan2(event.clientY - box.top - CY, event.clientX - box.left - CX) * 180) / Math.PI;
    const t = (Math.max(-SPAN, Math.min(SPAN, deg)) + SPAN) / (SPAN * 2);
    l = Math.round(95 - t * 90);
    if (s < 4) s = 0;
    update(false);
  };
  arc.addEventListener("pointerdown", (event) => {
    arc.setPointerCapture(event.pointerId);
    setLightFromPointer(event);
    const move = (e) => setLightFromPointer(e);
    const up = () => {
      arc.removeEventListener("pointermove", move);
      arc.removeEventListener("pointerup", up);
      update(true);
    };
    arc.addEventListener("pointermove", move);
    arc.addEventListener("pointerup", up);
  });
  arc.addEventListener("keydown", (event) => {
    const step = { ArrowUp: 3, ArrowRight: 3, ArrowDown: -3, ArrowLeft: -3 }[event.key];
    if (!step) return;
    event.preventDefault();
    l = Math.max(5, Math.min(95, l + step));
    update(true);
  });

  const stage = make("div", "cp__stage");
  stage.append(dish, arc);

  /* Theme inks and Default */
  const inks = make("div", "cp__inks");
  THEME_INKS.forEach(([name, value]) => {
    const dot = make("button", "cp__ink");
    dot.type = "button";
    dot.style.background = value;
    dot.setAttribute("aria-label", `${name}, adapts to light and dark mode`);
    dot.dataset.tip = `${name} · adapts to light and dark mode`;
    dot.addEventListener("click", () => onPick(value));
    inks.append(dot);
  });
  const reset = make("button", "btn btn--small btn--plain cp__reset", "Default");
  reset.type = "button";
  reset.addEventListener("click", () => onPick(null));
  inks.append(reset);

  /* Hex field */
  const pill = make("form", "cp__pill");
  const swatch = make("span", "cp__swatch");
  const hexInput = make("input", "cp__hex");
  hexInput.type = "text";
  hexInput.spellcheck = false;
  hexInput.maxLength = 7;
  hexInput.setAttribute("aria-label", "Hex colour");
  const done = make("button", "cp__done");
  done.type = "submit";
  done.setAttribute("aria-label", "Apply and close");
  done.dataset.tip = "Apply and close";
  const tick = svgNode("svg", {
    width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.75,
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
  });
  for (const [tag, attrs] of Check) tick.append(svgNode(tag, attrs));
  done.append(tick);
  pill.append(swatch, hexInput, done);
  pill.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const typed = normaliseHex(hexInput.value);
    if (!typed) return hexInput.classList.add("is-invalid");
    ({ h, s, l } = hexToHsl(typed));
    update(true);
    closeCurrent();
  });
  hexInput.addEventListener("input", () => hexInput.classList.remove("is-invalid"));

  function update(apply) {
    const hex = hslToHex(h, s, l);
    pop.style.setProperty("--pick", hex);
    hexInput.value = hex.toUpperCase();
    stops[0].setAttribute("stop-color", hslToHex(h, s, 95));
    stops[1].setAttribute("stop-color", hslToHex(h, s, 50));
    stops[2].setAttribute("stop-color", hslToHex(h, s, 5));
    const [tx, ty] = point(-SPAN + ((95 - l) / 90) * SPAN * 2);
    thumb.setAttribute("cx", tx);
    thumb.setAttribute("cy", ty);
    arc.setAttribute("aria-valuenow", Math.round(l));
    if (apply) onPick(hex);
  }

  pop.append(stage, inks, pill);
  document.body.append(pop);
  update(false);

  // Open under the button, flipped above or nudged sideways to stay on screen.
  const a = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const left = Math.max(12, Math.min(a.left + a.width / 2 - p.width / 2, window.innerWidth - p.width - 12));
  const below = a.bottom + 10;
  const top = below + p.height > window.innerHeight - 12 ? Math.max(12, a.top - p.height - 10) : below;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.transformOrigin = `${a.left + a.width / 2 - left}px ${top < a.top ? "100%" : "0%"}`;

  const onOutside = (event) => {
    if (!pop.contains(event.target) && !anchor.contains(event.target)) closeCurrent();
  };
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeCurrent();
  };
  pop.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onOutside, true);
  anchor.setAttribute("aria-expanded", "true");
  closeCurrent = () => {
    document.removeEventListener("pointerdown", onOutside, true);
    anchor.setAttribute("aria-expanded", "false");
    leave(pop, () => pop.remove());
    closeCurrent = () => {};
    onClose?.();
  };

  hexInput.focus({ preventScroll: true });
  hexInput.select();
}
