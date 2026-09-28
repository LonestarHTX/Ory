// A wiki's cover when it has no image: a quiet line drawing made from its
// name, so each wiki looks like itself and the same wiki always looks the
// same. Monochrome, drawn in the current colour.

const SVG = "http://www.w3.org/2000/svg";

/** A small seeded random number generator: the same name, the same drawing. */
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  let s = h >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}

const W = 280;
const H = 96;
const f = (n) => n.toFixed(1);

const MOTIFS = [
  // Contours: stacked waves, like a map of gentle hills.
  (r) => {
    const lines = 7 + Math.floor(r() * 5);
    const k1 = 1 + r() * 2.5;
    const k2 = 2 + r() * 4;
    const p1 = r() * 6.28;
    const p2 = r() * 6.28;
    const amp = 5 + r() * 9;
    let out = "";
    for (let i = 0; i < lines; i++) {
      const y0 = ((i + 0.5) / lines) * H;
      let d = "";
      for (let x = 0; x <= W; x += 6) {
        const t = x / W;
        const y = y0 + amp * Math.sin(t * 6.28 * k1 + p1 + i * 0.35) * 0.7 + amp * 0.4 * Math.sin(t * 6.28 * k2 + p2 - i * 0.2);
        d += `${x ? "L" : "M"}${f(x)} ${f(y)}`;
      }
      out += `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1" opacity="${f(0.35 + 0.5 * (i % 2))}"/>`;
    }
    return out;
  },
  // Dots: a grid whose dots swell and shrink across the band.
  (r) => {
    const step = 10 + Math.floor(r() * 5);
    const cx = r() * W;
    const cy = r() * H;
    const spread = 60 + r() * 90;
    let out = "";
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        const d = Math.hypot(x - cx, y - cy);
        const size = 0.6 + 2.4 * Math.exp(-(d * d) / (spread * spread));
        out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(size)}" fill="currentColor"/>`;
      }
    }
    return out;
  },
  // Rings: circles spreading from a point off to one side.
  (r) => {
    const cx = r() < 0.5 ? r() * W * 0.3 : W - r() * W * 0.3;
    const cy = r() * H;
    const gap = 9 + r() * 7;
    let out = "";
    for (let rad = gap; rad < W; rad += gap) {
      out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="none" stroke="currentColor" stroke-width="1" opacity="${f(0.8 - (rad / W) * 0.5)}"/>`;
    }
    return out;
  },
  // Hatching: diagonal lines, closer together in a few bands.
  (r) => {
    const angle = 0.5 + r() * 0.6;
    const bands = [r() * W, r() * W];
    let out = "";
    for (let x = -H; x < W + H; ) {
      const near = Math.min(...bands.map((b) => Math.abs(b - x)));
      out += `<line x1="${f(x)}" y1="0" x2="${f(x + H / Math.tan(angle))}" y2="${H}" stroke="currentColor" stroke-width="1" opacity="0.6"/>`;
      x += 4 + Math.min(near / 8, 14);
    }
    return out;
  },
];

/** The cover drawing for a wiki called `name`, as an <svg> element. */
export function coverPattern(name) {
  const r = seeded(name.toLowerCase());
  const motif = MOTIFS[Math.floor(r() * MOTIFS.length)];
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "cover-pattern");
  svg.innerHTML = motif(r);
  return svg;
}
