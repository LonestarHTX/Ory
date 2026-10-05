// Resizing a page or a picture in a note. A handle that turns into the arrow
// you're moving it with, a pill on the edge that shows the size (click it, or
// for a picture just start typing, to type one), and the spring a typed size
// settles with. After Azlen's bounding-box study, in Ory's own colours.

import { h } from "./dom.js";

/** A damped spring (response in seconds, damping ratio), stepped by the frame. */
export class Spring {
  constructor(response, damping, value = 0) {
    this.k = (2 * Math.PI / response) ** 2;
    this.c = (4 * Math.PI * damping) / response;
    this.x = this.target = value;
    this.v = 0;
  }
  snap(value) {
    this.x = this.target = value;
    this.v = 0;
  }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt * 240)), dh = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * (this.x - this.target) - this.c * this.v) * dh;
      this.x += this.v * dh;
    }
  }
  get settled() {
    return Math.abs(this.x - this.target) < 0.05 && Math.abs(this.v) < 0.05;
  }
}

/** The study's resize spring, measured from its video. */
export const sizeSpring = (value) => new Spring(0.319, 0.886, value);

/** Run step(dt) every frame until it returns false. Returns a stop function. */
export function animate(step) {
  let last = null, id = 0, on = true;
  const frame = (t) => {
    const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
    last = t;
    if (on && step(dt) !== false) id = requestAnimationFrame(frame);
  };
  id = requestAnimationFrame(frame);
  return () => {
    on = false;
    cancelAnimationFrame(id);
  };
}

// Handles ------------------------------------------------------------------------
// One ten-point outline, so a rest shape (a bar or a square) can turn into a
// double arrow point for point.

const ARROW = [[0, -10], [5, -4.5], [1.4, -4.5], [1.4, 4.5], [5, 4.5], [0, 10], [-5, 4.5], [-1.4, 4.5], [-1.4, -4.5], [-5, -4.5]];
const BAR = [[0, -2], [20, -2], [20, -2], [20, 2], [20, 2], [0, 2], [-20, 2], [-20, 2], [-20, -2], [-20, -2]];
const SQUARE = [[0, -4], [4, -4], [4, -4], [4, 4], [4, 4], [0, 4], [-4, 4], [-4, 4], [-4, -4], [-4, -4]];

const rotate = (pts, deg) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};

/**
 * A handle: "bar" (a page's bottom edge) or "square" (a picture's corner or
 * side), which turns into an arrow pointing `deg` from vertical as it's taken.
 * Its element is centred on the point it's placed at (left/top in px).
 */
export function createHandle(rest, deg = 0) {
  const from = rest === "bar" ? BAR : SQUARE;
  const to = rotate(ARROW, deg);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `resize-handle resize-handle--${rest}`);
  svg.setAttribute("viewBox", "-22 -12 44 24");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  svg.append(shape);
  const m = new Spring(0.22, 0.72);
  let stop = null;
  const draw = () => {
    const t = Math.max(-0.05, Math.min(1.1, m.x));
    shape.setAttribute("points", from.map(([x, y], i) => `${(x + (to[i][0] - x) * t).toFixed(2)},${(y + (to[i][1] - y) * t).toFixed(2)}`).join(" "));
    svg.classList.toggle("is-arrow", t > 0.5);
  };
  draw();
  return {
    el: svg,
    /** Turn into the arrow (true) or back (false), on the spring. */
    take(on) {
      m.target = on ? 1 : 0;
      if (stop) return;
      stop = animate((dt) => {
        m.step(dt);
        draw();
        if (m.settled) {
          m.snap(m.target);
          draw();
          stop = null;
          return false;
        }
        return true;
      });
    },
  };
}

// Typed sizes --------------------------------------------------------------------

/**
 * A typed size: a number or sum (+ - * / and brackets), or a percentage of
 * `whole` ("50%"). Null if it isn't one.
 */
export function readSize(text, whole = null) {
  let s = text.trim();
  const percent = s.endsWith("%");
  if (percent) {
    if (whole == null) return null;
    s = s.slice(0, -1);
  }
  let at = 0;
  const peek = () => s[at];
  const space = () => { while (s[at] === " ") at++; };
  function number() {
    space();
    if (peek() === "(") {
      at++;
      const v = sum();
      space();
      if (s[at++] !== ")") throw new Error("bracket");
      return v;
    }
    if (peek() === "-") { at++; return -number(); }
    const m = /^\d*\.?\d+/.exec(s.slice(at));
    if (!m) throw new Error("number");
    at += m[0].length;
    return Number(m[0]);
  }
  function product() {
    let v = number();
    for (space(); peek() === "*" || peek() === "/"; space()) {
      const op = s[at++], w = number();
      v = op === "*" ? v * w : v / w;
    }
    return v;
  }
  function sum() {
    let v = product();
    for (space(); peek() === "+" || peek() === "-"; space()) {
      const op = s[at++], w = product();
      v = op === "+" ? v + w : v - w;
    }
    return v;
  }
  try {
    const v = sum();
    space();
    if (at !== s.length || !Number.isFinite(v)) return null;
    return percent ? (whole * v) / 100 : v;
  } catch {
    return null;
  }
}

/**
 * The size on an edge: a pill showing it, which opens a field to type one,
 * with Fit beside it (back to the thing's own size). The caller places `el`
 * and keeps the pill's text current with show().
 *   commit(text): the typed text, on Enter;  fit(): Fit was pressed.
 */
export function createSizePill({ label, commit, fit, fitFirst = false }) {
  const pill = h("button", { class: "resize-pill", type: "button", "aria-label": label, dataset: { tip: `${label}: click to type` } });
  const input = h("input", {
    class: "resize-input", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "aria-label": label,
  });
  const fitBtn = h("button", { class: "resize-fit", type: "button" }, "Fit");
  const field = h("span", { class: "resize-field" }, fitFirst ? [fitBtn, input] : [input, fitBtn]);
  field.hidden = true;
  const el = h("span", { class: "resize-size" }, pill, field);

  let editing = false;
  const size = () => {
    input.style.width = `${Math.max(3, input.value.length + 1)}ch`;
  };
  const close = () => {
    if (!editing) return;
    editing = false;
    field.hidden = true;
    pill.hidden = false;
    el.classList.remove("is-editing");
  };
  const api = {
    el,
    get editing() {
      return editing;
    },
    /** What the pill says, and what the field opens with (the width of "320 × 225"). */
    show(text, value = text) {
      pill.textContent = text;
      pill.dataset.value = value;
    },
    /** Open the field with `value`: all of it selected, or the caret after it. */
    open(value, selectAll = true) {
      editing = true;
      el.classList.add("is-editing");
      pill.hidden = true;
      field.hidden = false;
      input.value = value;
      size();
      input.focus({ preventScroll: true });
      if (selectAll) input.select();
      else input.setSelectionRange(value.length, value.length);
    },
    close,
  };
  pill.addEventListener("pointerdown", (e) => e.stopPropagation());
  pill.addEventListener("click", (e) => {
    e.stopPropagation();
    api.open(pill.dataset.value ?? pill.textContent);
  });
  input.addEventListener("input", () => {
    const clean = input.value.replace(/[^\d.+\-*/() %]/g, "");
    if (clean !== input.value) input.value = clean;
    size();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      const text = input.value;
      close();
      commit(text);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  input.addEventListener("blur", () => setTimeout(() => { if (!el.contains(document.activeElement)) close(); }, 0));
  fitBtn.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the field's focus until the click lands
  fitBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
    fit();
  });
  return api;
}

/** A drag on `el`: start() when pressed, move(dx, dy) as it goes, end(dx, dy) when let go. */
export function onDrag(el, { start, move, end }) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    let dx = 0, dy = 0;
    start();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer */
    }
    const moved = (ev) => {
      dx = ev.clientX - x0;
      dy = ev.clientY - y0;
      move(dx, dy);
    };
    const done = () => {
      el.removeEventListener("pointermove", moved);
      el.removeEventListener("pointerup", done);
      el.removeEventListener("pointercancel", done);
      end(dx, dy);
    };
    el.addEventListener("pointermove", moved);
    el.addEventListener("pointerup", done);
    el.addEventListener("pointercancel", done);
  });
}
