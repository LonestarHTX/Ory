// Colour picker, in three depths that open from each other in place:
//
//   the band     what the colour applies to (Text or Highlight), the palette, and a band of
//                hex tiles like a heat shield: none, nine colours and +. The plain rows
//                above and below fade out, so the band reads as a strip.
//   More         + opens a honeycomb under the band (hue round, colour outward, the text
//                colour at the centre) and a row of greys.
//   Custom       slides out to the side: hue and colourfulness in a field, lightness in a
//                bar, Hex and R G B, New over Current, and "Add to my colours".
//
// Tiles are solid for text colour and a wash with a coloured edge for a highlight. Every
// colour offered is readable in both themes. Pointing at a colour previews it on the text
// (onPreview); picking one applies it and closes the picker. The palette menu swaps the
// band's nine: Ory's inks, a few built-in sets, or My colours (saved from Custom).
//
// openColorPicker({ anchor, text, mark, onPreview, onPick, onClose }):
//   text, mark                 the text colour and highlight at the cursor, shown as current
//   onPreview(kind, value, o)  kind "text" or "mark"; value undefined ends the preview;
//                              o.still: no wave (a drag in Custom)
//   onPick(kind, value)        a theme ink such as "var(--ink-red)", a hex colour, or null
//                              for none. The Ory palette's grey as a highlight is a plain
//                              ==highlight==.

import { pref, setPref } from "../prefs.js";
import { hexToOklch, hexToRgb, normaliseHex, oklchRgb, readableAt, readableInks, readsIn, rgbToHex } from "./color.js";
import { leave } from "./dom.js";

/** Ory's own colours: theme inks, which follow light and dark mode. */
export const THEME_INKS = [
  ["Grey", "var(--ink-grey)"],
  ["Red", "var(--ink-red)"],
  ["Orange", "var(--ink-orange)"],
  ["Amber", "var(--ink-amber)"],
  ["Green", "var(--ink-green)"],
  ["Teal", "var(--ink-teal)"],
  ["Blue", "var(--ink-blue)"],
  ["Violet", "var(--ink-violet)"],
  ["Pink", "var(--ink-pink)"],
];
export const GREY = "var(--ink-grey)";

/** A highlight's wash: this much of its colour over the page (--mark-mix), plus `extra`. */
export const washOf = (color, extra = 0) => `color-mix(in srgb, ${color} calc(var(--mark-mix) + ${extra}%), transparent)`;

const MODE_KEY = "ory.colourMode";
const PALETTE_KEY = "ory.colourPalette";
const MINE_KEY = "ory.myColours";
const SVG = "http://www.w3.org/2000/svg";

const theme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

// ---------------------------------------------------------------------------------------
// Colours. Ory's inks sit on one ring of OKLCH lightness and chroma; the built-in palettes
// and the honeycomb are made the same way, readable in the theme in use.

const RING = { dark: { L: 0.744, C: 0.082 }, light: { L: 0.482, C: 0.088 } };
const onRing = (th, h, C, lift = 0) => readableAt(th, RING[th].L + (th === "dark" ? lift : -lift), C, h);
const HUES = [["Grey", 286, 0], ["Red", 25.6, 1], ["Orange", 52, 1], ["Amber", 78.2, 1], ["Green", 160.1, 1], ["Teal", 200, 1], ["Blue", 245.6, 1], ["Violet", 300, 1], ["Pink", 350, 1]];

const PALETTES = [
  { key: "ory", name: "Ory", colours: () => THEME_INKS },
  { key: "soft", name: "Soft", colours: (th) => HUES.map(([n, h, c]) => [n, onRing(th, h, c ? 0.045 : 0.006, 0.03)]) },
  { key: "vivid", name: "Vivid", colours: (th) => HUES.map(([n, h, c]) => [n, onRing(th, h, c ? 0.16 : 0.012)]) },
  {
    key: "earth",
    name: "Earth",
    colours: (th) => [["Stone", 70, 0.015], ["Clay", 40, 0.07], ["Rust", 35, 0.12], ["Ochre", 75, 0.11], ["Sand", 85, 0.05], ["Olive", 110, 0.08], ["Moss", 130, 0.08], ["Sage", 150, 0.05], ["Umber", 55, 0.06]]
      .map(([n, h, c]) => [n, onRing(th, h, c)]),
  },
  {
    key: "sea",
    name: "Sea",
    colours: (th) => [["Slate", 250, 0.02], ["Navy", 265, 0.11], ["Blue", 245, 0.1], ["Sky", 230, 0.08], ["Cyan", 210, 0.09], ["Teal", 195, 0.09], ["Seafoam", 175, 0.08], ["Kelp", 150, 0.07], ["Lilac", 290, 0.07]]
      .map(([n, h, c]) => [n, onRing(th, h, c)]),
  },
  { key: "mine", name: "My colours", colours: () => myColours().map((hex) => [hex.toUpperCase(), hex]) },
];

function myColours() {
  try {
    const list = JSON.parse(pref(MINE_KEY, "[]"));
    return Array.isArray(list) ? list.map(normaliseHex).filter(Boolean).slice(-9) : [];
  } catch {
    return [];
  }
}

const RINGS = 6;
// A honeycomb cell, `k` rings out at `angle`: hue goes round, colour grows outward, and the
// centre is the text colour (near white in dark mode, near black in light).
function cellColour(th, k, angle) {
  const t = k / RINGS;
  const L = th === "dark" ? 0.97 - 0.25 * t : 0.3 + 0.2 * t;
  return readableAt(th, L, 0.16 * t, (angle + 360) % 360);
}
const greyColour = (th, i) => readableAt(th, th === "dark" ? 1 - 0.38 * (i / 8) : 0.08 + 0.42 * (i / 8), 0, 0);

// Cached per theme: a picker opens often, and the colours only change with the theme.
const cache = {};
function colourSet(th) {
  if (cache[th]) return cache[th];
  const cells = [];
  for (let r = -RINGS; r <= RINGS; r++) {
    for (let q = Math.max(-RINGS, -r - RINGS); q <= Math.min(RINGS, -r + RINGS); q++) {
      const k = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      const x = q + r / 2;
      const y = r * (Math.sqrt(3) / 2);
      // Clockwise from the top, as in Office's: blue, magenta, then red and yellow below, green on the left.
      const angle = 250 + (Math.atan2(x, -y) * 180) / Math.PI;
      cells.push({ q, r, value: cellColour(th, k, angle) });
    }
  }
  const greys = [...Array(9)].map((_, i) => greyColour(th, i));
  const palettes = Object.fromEntries(PALETTES.filter((p) => p.key !== "mine").map((p) => [p.key, p.colours(th)]));
  cache[th] = { cells, greys, palettes };
  return cache[th];
}

// ---------------------------------------------------------------------------------------
// Hex geometry. Tiles are laid out by their apothem A (half the flat-to-flat width) with
// seams G wide: neighbours sit 2A + G apart, rows step that times √3/2, and alternate rows
// shift by half of it. Each polygon is inset by half its stroke (which rounds the corners),
// so fill and stroke end at the tile's edge and every seam is exactly G.

function hexGrid(A, G, stroke) {
  const SX = 2 * A + G;
  const k = Math.sqrt(3) / 2;
  return { SX, SY: SX * k, R: A / k, poly: (A - stroke / 2) / k };
}
const BAND = hexGrid(11.25, 2, 1.5);
const COMB = hexGrid(8.66, 1.5, 1);

const svgNode = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const hexPoints = (cx, cy, r) => [...Array(6)].map((_, k) => {
  const a = ((60 * k - 90) * Math.PI) / 180;
  return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
}).join(" ");
const plusGlyph = (cx, cy, className) => {
  const g = svgNode("g", { class: className });
  g.append(svgNode("line", { x1: cx - 5, y1: cy, x2: cx + 5, y2: cy }), svgNode("line", { x1: cx, y1: cy - 5, x2: cx, y2: cy + 5 }));
  return g;
};
const ICON = {
  chevronDown: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>',
  chevronRight: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6.5 4.5 3.5 3.5-3.5 3.5"/></svg>',
  plus: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 2v8M2 6h8"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>',
};

// A colour value as a hex in the theme in use (theme inks are resolved through the page).
function toHex(value) {
  if (!value) return null;
  const hex = normaliseHex(value);
  if (hex) return hex;
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g);
  probe.remove();
  return m ? rgbToHex(m.slice(0, 3).map(Number)) : null;
}

let closeCurrent = () => {};

/** Close the picker. `quiet` (leaving the note) skips the preview's way back and the return of focus. */
export function closeColorPicker({ quiet = false } = {}) {
  closeCurrent({ quiet });
}

export function openColorPicker({ anchor, text = null, mark = null, onPreview = () => {}, onPick, onClose }) {
  closeCurrent();
  const th = theme();
  const set = colourSet(th);
  let mode = pref(MODE_KEY, "text") === "mark" ? "mark" : "text";
  let palette = PALETTES.some((p) => p.key === pref(PALETTE_KEY, "")) ? pref(PALETTE_KEY, "ory") : "ory";
  let previewing = false;
  let restTimer = null;
  let dragging = false;
  let lastHex = null; // the last honeycomb colour pointed at, for Custom to start from
  let hsl = null; // Custom's colour as OKLCH { L, C, h }
  let picked = null; // ...and as the hex it saves
  const current = () => (mode === "text" ? text : mark);

  const pop = make("div", "cp");
  pop.tabIndex = -1;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Colour");
  const main = make("div", "cp__main");

  /* Text | Highlight, and the palette */
  const top = make("div", "cp__top");
  const seg = make("div", "seg-control");
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-label", "Colour the");
  const modeButtons = [["text", "Text"], ["mark", "Highlight"]].map(([value, label]) => {
    const b = make("button", "seg-option", label);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.addEventListener("click", () => setMode(value));
    seg.append(b);
    return [value, b];
  });
  const paletteButton = make("button", "btn btn--small btn--plain cp__palette");
  paletteButton.type = "button";
  paletteButton.setAttribute("aria-haspopup", "menu");
  paletteButton.setAttribute("aria-expanded", "false");
  paletteButton.dataset.tip = "Palette";
  paletteButton.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu()));
  top.append(seg, paletteButton);

  /* The band */
  const n = THEME_INKS.length + 2; // none, nine, +
  const bandW = n * BAND.SX;
  const bandH = 2 * BAND.R + 2 * BAND.SY;
  const band = svgNode("svg", {
    class: "cp__hive", width: bandW.toFixed(2), height: bandH.toFixed(2),
    viewBox: `0 0 ${bandW.toFixed(2)} ${bandH.toFixed(2)}`, role: "listbox", "aria-label": "Colours",
  });
  const id = Math.random().toString(36).slice(2, 8);
  const defs = svgNode("defs");
  const fade = (name, x2, y2, stops) => {
    const g = svgNode("linearGradient", { id: `${name}${id}`, x1: 0, y1: 0, x2, y2 });
    for (const [offset, a] of stops) g.append(svgNode("stop", { offset, "stop-color": "#fff", "stop-opacity": a }));
    const m = svgNode("mask", { id: `m${name}${id}`, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: bandW, height: bandH });
    m.append(svgNode("rect", { x: 0, y: 0, width: bandW, height: bandH, fill: `url(#${name}${id})` }));
    defs.append(g, m);
  };
  // The plain rows fade toward the outside edge and toward both ends.
  fade("v", 0, 1, [[0.02, 0], [0.24, 1], [0.76, 1], [0.98, 0]]);
  fade("h", 1, 0, [[0, 0], [0.1, 1], [0.9, 1], [1, 0]]);
  band.append(defs);
  const outer = svgNode("g", { mask: `url(#mh${id})` });
  const plainGroup = svgNode("g", { mask: `url(#mv${id})` });
  outer.append(plainGroup);
  band.append(outer);
  const rowY = BAND.R + BAND.SY;
  for (const cy of [BAND.R, BAND.R + 2 * BAND.SY]) {
    for (let j = 0; j <= n; j++) plainGroup.append(svgNode("polygon", { class: "cp__tile cp__tile--plain", points: hexPoints(j * BAND.SX, cy, BAND.poly) }));
  }
  // Slot 0 is none; 1-9 hold the palette's colours (or, in My colours, an empty slot).
  const slots = [...Array(10)].map((_, i) => {
    const cx = BAND.SX / 2 + i * BAND.SX;
    const t = svgNode("polygon", { class: "cp__tile cp__tile--colour", points: hexPoints(cx, rowY, BAND.poly), role: "option", tabindex: -1 });
    band.append(t);
    const slot = { t, name: "None", value: null, empty: false };
    if (i === 0) band.append(svgNode("line", { class: "cp__slash", x1: cx - 5, y1: rowY + 5, x2: cx + 5, y2: rowY - 5 }));
    else {
      slot.add = plusGlyph(cx, rowY, "cp__glyph cp__glyph--add");
      band.append(slot.add);
    }
    t.addEventListener("pointerenter", () => (slot.empty ? leaveColour() : show(slot.value)));
    t.addEventListener("pointerleave", leaveColour);
    t.addEventListener("focus", () => {
      if (t.matches(":focus-visible") && !slot.empty) show(slot.value);
    });
    t.addEventListener("click", () => (slot.empty ? startAdding() : pick(slot.value)));
    t.addEventListener("contextmenu", (event) => {
      if (palette !== "mine" || slot.empty || i === 0) return;
      event.preventDefault();
      saveMine(myColours().filter((hex) => hex !== slot.value));
      dressBand();
      rest();
    });
    return slot;
  });
  const plusX = BAND.SX / 2 + 10 * BAND.SX;
  const plus = svgNode("polygon", { class: "cp__tile cp__tile--plain cp__tile--more", points: hexPoints(plusX, rowY, BAND.poly), role: "button", tabindex: -1 });
  band.append(plus, plusGlyph(plusX, rowY, "cp__glyph cp__glyph--more"));
  plus.addEventListener("pointerenter", leaveColour);
  plus.addEventListener("click", () => toggleMore());
  band.addEventListener("keydown", (event) => onTileKeys(event, [...slots.map((s) => s.t), plus], (i) => (i === 10 ? toggleMore() : slots[i].empty ? startAdding() : pick(slots[i].value))));

  /* More: the honeycomb, the greys, and the way to Custom */
  const more = make("div", "cp__more");
  const moreInner = make("div", "cp__more-inner");
  const moreBody = make("div", "cp__more-body");
  const combW = (2 * RINGS + 1) * COMB.SX;
  const combH = 2 * RINGS * COMB.SY + 2 * COMB.R;
  const comb = svgNode("svg", { class: "cp__hive", width: combW.toFixed(2), height: combH.toFixed(2), viewBox: `0 0 ${combW.toFixed(2)} ${combH.toFixed(2)}`, role: "listbox", "aria-label": "More colours" });
  const cells = set.cells.map(({ q, r, value }) => addCell(comb, combW / 2 + COMB.SX * (q + r / 2), combH / 2 + COMB.SY * r, value));
  const greysW = 9 * COMB.SX;
  const greys = svgNode("svg", { class: "cp__hive", width: greysW.toFixed(2), height: (2 * COMB.R).toFixed(2), viewBox: `0 0 ${greysW.toFixed(2)} ${(2 * COMB.R).toFixed(2)}`, role: "listbox", "aria-label": "Greys" });
  const greyCells = set.greys.map((value, i) => addCell(greys, COMB.SX / 2 + i * COMB.SX, COMB.R, value));
  for (const s of [comb, greys]) {
    s.hover = svgNode("polygon", { class: "cp__cell-hover" });
    s.append(s.hover);
    s.addEventListener("pointerleave", () => {
      s.hover.classList.remove("is-on");
      footSwatch.style.background = "";
      footLabel.textContent = "Point at a colour";
      footHex.textContent = "";
    });
  }
  const allCells = [...cells, ...greyCells];
  const cellKeys = (event) => onTileKeys(event, allCells, (i) => pick(allCells[i].dataset.value), true);
  comb.addEventListener("keydown", cellKeys);
  greys.addEventListener("keydown", cellKeys);
  const foot = make("div", "cp__foot");
  const footSwatch = make("span", "cp__swatch");
  const footLabel = make("span", "cp__foot-label", "Point at a colour");
  const footHex = make("span", "cp__hex");
  const customButton = make("button", "btn btn--small btn--plain cp__custom-button");
  customButton.type = "button";
  customButton.innerHTML = `Custom ${ICON.chevronRight}`;
  customButton.setAttribute("aria-expanded", "false");
  customButton.addEventListener("click", () => (pop.classList.contains("is-custom") ? closeCustom() : openCustom()));
  foot.append(footSwatch, footLabel, footHex, customButton);
  moreBody.append(comb, greys, foot);
  moreInner.append(moreBody);
  more.append(moreInner);

  function addCell(parent, x, y, value) {
    const t = svgNode("polygon", { class: "cp__tile cp__tile--cell", points: hexPoints(x, y, COMB.poly), role: "option", tabindex: -1, "aria-label": value.toUpperCase() });
    t.dataset.value = value;
    parent.insertBefore(t, parent.hover ?? null);
    const enter = () => {
      clearTimeout(restTimer);
      parent.hover.setAttribute("points", t.getAttribute("points"));
      parent.hover.style.fill = t.style.fill;
      parent.hover.classList.add("is-on");
      lastHex = value;
      footSwatch.style.background = t.style.fill;
      footLabel.textContent = "Reads in both themes";
      footHex.textContent = value.toUpperCase();
      show(value);
    };
    t.addEventListener("pointerenter", enter);
    t.addEventListener("pointerleave", leaveColour);
    t.addEventListener("focus", () => {
      if (t.matches(":focus-visible")) enter();
    });
    t.addEventListener("click", () => pick(value));
    return t;
  }

  /* Custom */
  const custom = make("div", "cp__custom");
  const customBody = make("div", "cp__custom-body");
  const customTop = make("div", "cp__custom-top");
  const field = make("div", "cp__field");
  // Drawn at half size and scaled up: the field is a smooth gradient, and this keeps a drag smooth.
  const fieldCanvas = make("canvas");
  fieldCanvas.width = 100;
  fieldCanvas.height = 84;
  const fieldThumb = make("span", "cp__field-thumb");
  field.append(fieldCanvas, fieldThumb);
  field.tabIndex = 0;
  field.setAttribute("role", "slider");
  field.setAttribute("aria-label", "Hue and colourfulness");
  const light = make("div", "cp__light");
  const lightCanvas = make("canvas");
  lightCanvas.width = 16;
  lightCanvas.height = 168;
  const lightThumb = make("span", "cp__light-thumb");
  light.append(lightCanvas, lightThumb);
  light.tabIndex = 0;
  light.setAttribute("role", "slider");
  light.setAttribute("aria-label", "Lightness");
  const newCurrent = make("div", "cp__newcur");
  const newSwatch = make("i");
  const currentSwatch = make("i");
  newCurrent.append(make("span", null, "New"), newSwatch, currentSwatch, make("span", null, "Current"));
  customTop.append(field, light, newCurrent);
  const fields = make("div", "cp__fields");
  const hexInput = make("input", "cp__input cp__input--hex");
  hexInput.spellcheck = false;
  hexInput.maxLength = 7;
  hexInput.setAttribute("aria-label", "Hex");
  const rgbRow = make("div", "cp__rgb");
  const rgbInputs = ["R", "G", "B"].map((k) => {
    const input = make("input", "cp__input");
    input.type = "number";
    input.min = 0;
    input.max = 255;
    input.setAttribute("aria-label", k);
    rgbRow.append(make("span", null, k), input);
    return input;
  });
  fields.append(make("span", null, "Hex"), hexInput, make("span", null, "RGB"), rgbRow);
  const customNote = make("p", "cp__note");
  const actions = make("div", "cp__actions");
  const addButton = make("button", "btn btn--small cp__add");
  addButton.type = "button";
  addButton.innerHTML = `${ICON.plus} Add to my colours`;
  const cancelButton = make("button", "btn btn--small btn--plain", "Cancel");
  cancelButton.type = "button";
  const applyButton = make("button", "btn btn--small btn--primary", "Apply");
  applyButton.type = "button";
  actions.append(addButton, make("span", "cp__grow"), cancelButton, applyButton);
  customBody.append(customTop, fields, customNote, actions);
  custom.append(customBody);

  /* The palette menu, beside the picker so the band stays in view */
  const menu = make("div", "menu cp__menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");

  main.append(top, band, more);
  pop.append(main, custom, menu);
  document.body.append(pop);

  // ---------------------------------------------------------------------------------------
  // Previews and picks

  function show(value) {
    clearTimeout(restTimer);
    previewing = true;
    onPreview(mode, value);
  }

  // Leaving a colour for anything that isn't one (a seam, a plain tile, the gap) puts the
  // text back after a beat; reaching another colour first cancels it, so a sweep across
  // seams doesn't flicker.
  function leaveColour() {
    clearTimeout(restTimer);
    restTimer = setTimeout(() => {
      if (!dragging) rest();
    }, 90);
  }

  // What the text shows when no colour is pointed at: with Custom open, the colour being
  // made (Apply keeps it, Cancel drops it); otherwise its own colours.
  function rest() {
    clearTimeout(restTimer);
    if (pop.classList.contains("is-custom") && picked) {
      previewing = true;
      onPreview(mode, picked, { still: true });
    } else if (previewing) {
      previewing = false;
      onPreview(mode, undefined);
    }
  }

  function pick(value) {
    clearTimeout(restTimer);
    previewing = false;
    onPick(mode, value);
    closeCurrent({ picked: true });
  }

  // ---------------------------------------------------------------------------------------
  // Dressing: tiles solid for text, a wash with a coloured edge for a highlight

  const fillOf = (value, extra = 14) => (mode === "text" ? value : washOf(value, extra));

  function dressBand() {
    const p = PALETTES.find((x) => x.key === palette);
    const colours = p.key === "mine" ? p.colours() : set.palettes[p.key];
    paletteButton.innerHTML = `${p.name}${ICON.chevronDown}`;
    slots.forEach((slot, i) => {
      if (i > 0) {
        const c = colours[i - 1];
        slot.name = c?.[0] ?? null;
        slot.value = c?.[1] ?? null;
        slot.empty = !c;
        slot.firstEmpty = !c && i - 1 === colours.length;
        slot.t.style.transitionDelay = `${(i - 1) * 18}ms, ${(i - 1) * 18}ms, 0ms`; // fill and stroke ripple; the hover never waits
      }
      const { t, value, empty } = slot;
      // An empty slot in My colours is dashed, like the "start a wiki" card; the first carries a +.
      t.classList.toggle("is-empty", empty);
      t.style.fill = empty ? "" : !value ? "var(--tile)" : fillOf(value);
      t.style.stroke = empty ? "" : value ?? "var(--tile)";
      t.classList.toggle("is-on", !empty && value === current());
      if (slot.add) slot.add.style.display = empty && slot.firstEmpty ? "inline" : "";
      const label = empty ? "Add a colour"
        : !value ? (mode === "text" ? "Default colour" : "No highlight")
          : mode === "mark" && value === GREY ? "Grey, a plain highlight" : slot.name;
      t.setAttribute("aria-label", label);
      t.dataset.tip = palette === "mine" && !empty && i > 0 ? `${label} · right-click to remove` : label;
    });
    const on = Math.max(0, slots.findIndex((s) => !s.empty && s.value === current()));
    slots.forEach(({ t }, j) => t.setAttribute("tabindex", j === on ? "0" : "-1"));
    plus.dataset.tip = pop.classList.contains("is-more") ? "Fewer colours" : "More colours";
    plus.setAttribute("aria-label", plus.dataset.tip);
  }

  function dressCells() {
    for (const t of allCells) {
      t.style.fill = mode === "text" ? t.dataset.value : washOf(t.dataset.value, 22);
      t.style.stroke = mode === "text" ? t.dataset.value : washOf(t.dataset.value, 40);
    }
    allCells.forEach((t, j) => t.setAttribute("tabindex", j === 0 ? "0" : "-1"));
  }

  function setMode(next) {
    if (next === mode && seg.querySelector(".is-selected")) return;
    if (previewing) onPreview(mode, undefined);
    previewing = false;
    mode = next;
    setPref(MODE_KEY, mode);
    for (const [value, b] of modeButtons) {
      b.classList.toggle("is-selected", value === mode);
      b.setAttribute("aria-checked", String(value === mode));
    }
    dressBand();
    dressCells();
    if (hsl) updateCustom({ quiet: true });
    rest();
  }

  // ---------------------------------------------------------------------------------------
  // More and Custom

  function toggleMore(open = !pop.classList.contains("is-more")) {
    pop.classList.toggle("is-more", open);
    if (!open) closeCustom();
    plus.dataset.tip = open ? "Fewer colours" : "More colours";
    plus.setAttribute("aria-label", plus.dataset.tip);
  }

  function openCustom() {
    pop.classList.add("is-custom");
    customButton.setAttribute("aria-expanded", "true");
    seed(lastHex ?? toHex(current()) ?? "#68bcc0", { quiet: true });
    rest();
  }

  function closeCustom() {
    if (!pop.classList.contains("is-custom")) return;
    pop.classList.remove("is-custom");
    customButton.setAttribute("aria-expanded", "false");
    rest();
  }

  // Adding a colour: Custom opens, ready, and "Add to my colours" pulses to show where to finish.
  function startAdding() {
    closeMenu();
    toggleMore(true);
    if (!pop.classList.contains("is-custom")) openCustom();
    addButton.classList.remove("is-ready");
    void addButton.offsetWidth;
    addButton.classList.add("is-ready");
  }

  function saveMine(list) {
    setPref(MINE_KEY, JSON.stringify(list.slice(-9)));
  }

  // from: "hex" or "rgb" when typed there (that field is left as typed); quiet: no preview.
  function seed(hex, { from = null, quiet = false } = {}) {
    const o = hexToOklch(hex);
    hsl = { L: o.L, C: o.C, h: o.C < 0.002 ? (hsl?.h ?? 200) : o.h };
    picked = hex;
    drawField();
    updateCustom({ skipHex: from === "hex", skipRgb: from === "rgb", quiet });
  }

  function drawField() {
    const ctx = fieldCanvas.getContext("2d");
    const { width: w, height: h } = fieldCanvas;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const C = (1 - y / (h - 1)) * 0.32;
      for (let x = 0; x < w; x++) {
        const rgb = oklchRgb(hsl.L, C, (x / (w - 1)) * 360);
        const o = (y * w + x) * 4;
        img.data.set([rgb[0], rgb[1], rgb[2], 255], o);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // Lightness, top to bottom. For text, what can't be read in this theme is shaded and hatched.
  function drawLight() {
    const ctx = lightCanvas.getContext("2d");
    const { width: w, height: h } = lightCanvas;
    const img = ctx.createImageData(w, h);
    const bg = hexToRgb(toHex("var(--card)") ?? (th === "dark" ? "#252528" : "#ffffff"));
    for (let y = 0; y < h; y++) {
      const rgb = oklchRgb(1 - y / (h - 1), hsl.C, hsl.h);
      const bad = mode === "text" && !readsIn(th, rgb);
      const dim = rgb.map((v, i) => v * 0.35 + bg[i] * 0.65);
      for (let x = 0; x < w; x++) {
        const c = !bad ? rgb : (x + y) % 6 < 2 ? bg : dim;
        img.data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // fromDrag: the colour comes from the field or bar; otherwise `picked` was typed and stays exact.
  function updateCustom({ fromDrag = false, skipHex = false, skipRgb = false, quiet = false } = {}) {
    if (fromDrag) picked = rgbToHex(oklchRgb(hsl.L, hsl.C, hsl.h));
    drawLight();
    fieldThumb.style.left = `${(hsl.h / 360) * 100}%`;
    fieldThumb.style.top = `${(1 - Math.min(hsl.C, 0.32) / 0.32) * 100}%`;
    fieldThumb.style.background = picked;
    lightThumb.style.top = `${(1 - hsl.L) * 100}%`;
    field.setAttribute("aria-valuetext", `hue ${Math.round(hsl.h)}, colourfulness ${hsl.C.toFixed(2)}`);
    light.setAttribute("aria-valuetext", `${Math.round(hsl.L * 100)}%`);
    if (!skipHex) {
      hexInput.value = picked.toUpperCase();
      hexInput.classList.remove("is-invalid");
    }
    if (!skipRgb) hexToRgb(picked).forEach((v, i) => { rgbInputs[i].value = v; });
    newSwatch.style.background = fillOf(readableInks(picked)[th]);
    const cur = current();
    currentSwatch.style.background = cur ? (mode === "text" ? cur : washOf(cur, 14)) : mode === "text" ? "var(--text)" : "var(--tile)";
    // Say plainly what each theme will show.
    if (mode === "text") {
      const { light: l, dark: d } = readableInks(picked);
      const changed = [d !== picked && "lighter in dark mode", l !== picked && "darker in light mode"].filter(Boolean);
      customNote.textContent = changed.length
        ? `Saved as ${picked.toUpperCase()}, shown ${changed.join(" and ")} so it stays readable.`
        : "Reads as picked in both themes.";
    } else {
      customNote.textContent = "Shown as a wash behind the text, which keeps its own colour.";
    }
    if (!quiet && pop.classList.contains("is-custom")) {
      previewing = true;
      onPreview(mode, picked, { still: true });
    }
  }

  // A drag redraws at most once a frame.
  let frame = null;
  let redrawField = false;
  function schedule(field) {
    redrawField ||= field;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (redrawField) drawField();
      redrawField = false;
      updateCustom({ fromDrag: true });
    });
  }

  const drag = (target, fn) => {
    target.addEventListener("pointerdown", (event) => {
      target.setPointerCapture(event.pointerId);
      dragging = true;
      fn(event);
      const move = (e) => fn(e);
      const up = () => {
        dragging = false;
        target.removeEventListener("pointermove", move);
        target.removeEventListener("lostpointercapture", up);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("lostpointercapture", up);
    });
  };
  drag(field, (event) => {
    const r = fieldCanvas.getBoundingClientRect();
    hsl.h = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) * 360;
    hsl.C = (1 - Math.max(0, Math.min(1, (event.clientY - r.top) / r.height))) * 0.32;
    schedule(false);
  });
  drag(light, (event) => {
    const r = lightCanvas.getBoundingClientRect();
    hsl.L = 1 - Math.max(0, Math.min(1, (event.clientY - r.top) / r.height));
    schedule(true);
  });
  field.addEventListener("keydown", (event) => {
    const d = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, 0.01], ArrowDown: [0, -0.01] }[event.key];
    if (!d) return;
    event.preventDefault();
    hsl.h = (hsl.h + d[0] + 360) % 360;
    hsl.C = Math.max(0, Math.min(0.32, hsl.C + d[1]));
    schedule(false);
  });
  light.addEventListener("keydown", (event) => {
    const d = { ArrowUp: 0.02, ArrowDown: -0.02 }[event.key];
    if (!d) return;
    event.preventDefault();
    hsl.L = Math.max(0, Math.min(1, hsl.L + d));
    schedule(true);
  });
  hexInput.addEventListener("input", () => {
    const hex = normaliseHex(hexInput.value);
    hexInput.classList.toggle("is-invalid", !hex && hexInput.value.replace("#", "").length >= 6);
    if (hex && hexInput.value.replace("#", "").length === 6) seed(hex, { from: "hex" });
  });
  hexInput.addEventListener("blur", () => {
    const hex = normaliseHex(hexInput.value);
    if (hex) hexInput.value = hex.toUpperCase();
  });
  for (const input of rgbInputs) {
    input.addEventListener("input", () => seed(rgbToHex(rgbInputs.map((x) => Math.max(0, Math.min(255, Math.round(+x.value) || 0)))), { from: "rgb" }));
  }
  // Enter in any field applies, as in a dialog.
  for (const input of [hexInput, ...rgbInputs]) {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      pick(picked);
    });
  }
  applyButton.addEventListener("click", () => pick(picked));
  cancelButton.addEventListener("click", closeCustom);
  let addTimer = null;
  addButton.addEventListener("click", () => {
    const list = myColours();
    let said = "Added to my colours";
    if (list.includes(picked)) said = "Already in my colours";
    else {
      list.push(picked);
      if (list.length > 9) {
        list.shift();
        said = "Added; the oldest made room";
      }
      saveMine(list);
    }
    palette = "mine";
    setPref(PALETTE_KEY, palette);
    dressBand();
    // Show where it went: its tile gives a small bounce.
    const slot = slots.find((s) => s.value === picked);
    if (slot) {
      slot.t.classList.remove("is-new");
      void slot.t.getBBox();
      slot.t.classList.add("is-new");
    }
    addButton.innerHTML = `${ICON.check} ${said}`;
    clearTimeout(addTimer);
    addTimer = setTimeout(() => { addButton.innerHTML = `${ICON.plus} Add to my colours`; }, 1400);
  });

  // ---------------------------------------------------------------------------------------
  // The palette menu: pointing at a palette shows it on the band; clicking keeps it.

  let shownPalette = palette;
  function showPalette(key) {
    if (key === shownPalette) return;
    const keep = palette;
    palette = key;
    dressBand();
    palette = keep;
    paletteButton.innerHTML = `${PALETTES.find((x) => x.key === palette).name}${ICON.chevronDown}`;
    shownPalette = key;
  }

  function openMenu() {
    menu.replaceChildren();
    for (const p of PALETTES) {
      if (p.key === "mine") menu.append(make("div", "cp__menu-sep"));
      const colours = p.key === "mine" ? p.colours() : set.palettes[p.key];
      const item = make("button", `menu-item cp__menu-item${p.key === palette ? " is-selected" : ""}`);
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(p.key === palette));
      const strip = make("span", "cp__strip");
      for (let i = 0; i < 9; i++) {
        const d = make("i", colours[i] ? "" : "is-empty");
        if (colours[i]) d.style.background = mode === "text" ? colours[i][1] : washOf(colours[i][1], 30);
        strip.append(d);
      }
      item.append(make("span", null, p.name), strip);
      item.addEventListener("pointerenter", () => showPalette(p.key));
      item.addEventListener("focus", () => showPalette(p.key));
      item.addEventListener("click", () => {
        palette = p.key;
        setPref(PALETTE_KEY, palette);
        shownPalette = null;
        closeMenu();
      });
      menu.append(item);
    }
    const add = make("button", "menu-item cp__menu-item cp__menu-add");
    add.type = "button";
    add.setAttribute("role", "menuitem");
    add.innerHTML = `<span>${ICON.plus} Add a colour…</span>`;
    add.addEventListener("pointerenter", () => showPalette("mine"));
    add.addEventListener("click", () => {
      palette = "mine";
      setPref(PALETTE_KEY, palette);
      shownPalette = null;
      startAdding();
    });
    menu.append(add);
    menu.hidden = false;
    // Beside the picker, on whichever side has room.
    const box = pop.getBoundingClientRect();
    menu.classList.toggle("is-left", box.right + 8 + menu.offsetWidth > window.innerWidth - 8);
    paletteButton.setAttribute("aria-expanded", "true");
    (menu.querySelector(".is-selected") ?? menu.querySelector("button"))?.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    paletteButton.setAttribute("aria-expanded", "false");
    shownPalette = null;
    dressBand();
    shownPalette = palette;
  }

  menu.addEventListener("pointerleave", () => showPalette(palette));
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(i + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
  });

  // ---------------------------------------------------------------------------------------
  // Keyboard: arrows move between tiles (to the nearest one that way), Enter picks.

  function onTileKeys(event, list, activate, spatial = false) {
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(i);
      return;
    }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!dir) return;
    event.preventDefault();
    let next = i;
    if (!spatial) {
      if (dir[0]) next = Math.max(0, Math.min(list.length - 1, i + dir[0]));
    } else {
      const at = (t) => { const r = t.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
      const [x, y] = at(list[i]);
      let best = Infinity;
      list.forEach((t, j) => {
        const [tx, ty] = at(t);
        const ahead = (tx - x) * dir[0] + (ty - y) * dir[1];
        if (ahead <= 1) return;
        const d = ahead + 2 * Math.abs((tx - x) * dir[1] + (ty - y) * dir[0]);
        if (d < best) { best = d; next = j; }
      });
    }
    list.forEach((t, j) => t.setAttribute("tabindex", j === next ? "0" : "-1"));
    list[next].focus();
  }

  // ---------------------------------------------------------------------------------------
  // Open: under the button, kept on screen as the picker grows.

  setMode(mode);
  seed("#68bcc0", { quiet: true });
  const a = anchor.getBoundingClientRect();
  const placeAt = Math.max(12, a.left + a.width / 2 - pop.offsetWidth / 2);
  function place() {
    const w = pop.offsetWidth;
    const hgt = pop.offsetHeight;
    const left = Math.max(12, Math.min(placeAt, window.innerWidth - w - 12));
    const below = a.bottom + 8;
    const top = below + hgt <= window.innerHeight - 12 ? below : Math.max(12, Math.min(a.top - hgt - 8, window.innerHeight - hgt - 12));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }
  place();
  pop.style.transformOrigin = `${a.left + a.width / 2 - placeAt}px 0%`;
  const sizer = new ResizeObserver(place);
  sizer.observe(pop);

  pop.addEventListener("pointerleave", () => {
    if (!dragging) rest();
  });
  // Tab stays inside the picker, like Settings; only what is showing takes part.
  pop.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const stops = [...pop.querySelectorAll('button, input, [tabindex="0"]')].filter((el) => el.getClientRects().length && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden");
    if (!stops.length) return;
    const i = stops.indexOf(document.activeElement);
    const next = event.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i === -1 || i === stops.length - 1 ? 0 : i + 1);
    event.preventDefault();
    stops[next].focus();
  });
  // Escape steps back one level: the palette menu, Custom, More, then the picker.
  pop.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (!menu.hidden) {
      closeMenu();
      paletteButton.focus();
    } else if (pop.classList.contains("is-custom")) closeCustom();
    else if (pop.classList.contains("is-more")) toggleMore(false);
    else closeCurrent();
  });
  const onOutside = (event) => {
    if (!pop.contains(event.target) && !anchor.contains(event.target)) closeCurrent();
    else if (!menu.hidden && !menu.contains(event.target) && !paletteButton.contains(event.target)) closeMenu();
  };
  document.addEventListener("pointerdown", onOutside, true);
  anchor.setAttribute("aria-expanded", "true");
  closeCurrent = ({ quiet = false, picked: chose = false } = {}) => {
    document.removeEventListener("pointerdown", onOutside, true);
    sizer.disconnect();
    clearTimeout(restTimer);
    anchor.setAttribute("aria-expanded", "false");
    if (!quiet && !chose && previewing) onPreview(mode, undefined);
    leave(pop, () => pop.remove());
    closeCurrent = () => {};
    onClose?.({ quiet });
  };

  pop.focus({ preventScroll: true });
}
