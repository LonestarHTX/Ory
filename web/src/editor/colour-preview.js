// Previewing a colour from the picker on the text it will apply to. The
// colour runs through the selection in reading order as a wave: each letter
// switches as the wave reaches it, with a short bold pulse (styles.css,
// .cm-wave). Only decorations: the note itself is untouched until a colour is
// picked, so a preview never reaches the undo history or the file.
//
// The timing was measured from a screen recording of the interaction this
// comes from: the whole selection takes 0.117 · ∛(letters) seconds (27
// letters in 0.35 s, 110 in 0.55 s), and each letter's pulse lasts 0.6 s.

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

import { washOf } from "../ui/color-picker.js";
import { normaliseHex, readableInks } from "../ui/color.js";
import { PLAIN_HIGHLIGHT } from "./format.js";

const WAVE_K = 0.117;
const PULSE = 600; // ms each letter animates for
const MOST = 4000; // past this many letters, colour at once (one mark per range)

const setWave = StateEffect.define();

export const colourPreview = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setWave)) deco = e.value;
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** What a format command would colour: the selection, or the word at a cursor. */
function targets(state) {
  const out = [];
  for (const range of state.selection.ranges) {
    if (!range.empty) out.push(range);
    else {
      const word = state.wordAt(range.head);
      if (word) out.push(word);
    }
  }
  return out;
}

// Per view: what the text is showing now, for the next wave to start from.
const shown = new WeakMap();
const clearers = new WeakMap();

const theme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** The CSS each kind of preview paints with. A picked hex shows as Ory will show it: readable. */
function paint(kind, value) {
  if (kind === "text") {
    const hex = value && normaliseHex(value);
    return { to: hex ? readableInks(hex)[theme()] : value ?? "var(--text)" };
  }
  if (value === PLAIN_HIGHLIGHT) return { to: "var(--selected)", flash: "var(--line-strong)" };
  if (value) return { to: washOf(value), flash: washOf(value, 30) };
  return { to: "transparent", flash: "transparent" };
}

/**
 * Preview `value` (as format.js would apply it) for `kind` "text" or "mark";
 * value undefined runs the wave back to the note's own colours and ends it.
 * `still`: no wave, the colour at once (a drag in the picker's Custom).
 */
export function previewColour(view, kind, value, { still = false } = {}) {
  clearTimeout(clearers.get(view));
  const ending = value === undefined;
  const last = shown.get(view);
  const from = last && last.kind === kind ? last.css : kind === "text" ? "currentColor" : "transparent";
  if (ending && !last) return;
  const { to, flash } = ending
    ? { to: kind === "text" ? "currentColor" : "transparent", flash: "transparent" }
    : paint(kind, value);

  const letters = [];
  for (const { from: a, to: b } of targets(view.state)) {
    const text = view.state.sliceDoc(a, b);
    let pos = a;
    for (const ch of text) {
      if (ch !== "\n") letters.push([pos, pos + ch.length]);
      pos += ch.length;
    }
  }
  if (!letters.length) return;
  const n = letters.length;
  const span = n > MOST || still ? 0 : WAVE_K * Math.cbrt(n) * 1000;
  const style = (k) => `--wave-from: ${from}; --wave-to: ${to}; --wave-d: ${Math.round(n > 1 ? (span * k) / (n - 1) : 0)}ms`
    + (flash ? `; --wave-flash: ${flash}` : "");
  const cls = `cm-wave cm-wave--${kind}${still ? " cm-wave--still" : ""}`;
  const marks = n > MOST
    ? targets(view.state).map((r) => Decoration.mark({ class: cls, attributes: { style: style(0) } }).range(r.from, r.to))
    : letters.map(([a, b], k) => Decoration.mark({ class: cls, attributes: { style: style(k) } }).range(a, b));
  view.dispatch({ effects: setWave.of(Decoration.set(marks, true)) });

  if (ending) {
    shown.delete(view);
    clearers.set(view, setTimeout(() => endColourPreview(view), span + PULSE));
  } else {
    shown.set(view, { kind, css: to });
  }
}

/** Drop the preview at once, as when the colour has been applied. */
export function endColourPreview(view) {
  clearTimeout(clearers.get(view));
  shown.delete(view);
  if (view.state.field(colourPreview, false)?.size) view.dispatch({ effects: setWave.of(Decoration.none) });
}
