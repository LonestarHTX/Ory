// Colour arithmetic for text colour: conversions, contrast, and keeping any
// picked colour readable in both themes.

export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: s * 100, l: l * 100 };
}

/** "#abc", "abc", "#aabbcc" or "rgb(1, 2, 3)" as "#aabbcc", or null. */
export function normaliseHex(text) {
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(text?.trim() ?? "");
  if (rgb) return "#" + rgb.slice(1, 4).map((v) => Math.min(255, Number(v)).toString(16).padStart(2, "0")).join("");
  let hex = (text ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(hex) ? "#" + hex.toLowerCase() : null;
}

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const over = (rgb, alpha, white) => rgb.map((v) => v * (1 - alpha) + (white ? 255 : 0) * alpha);

// The surfaces coloured text sits on: the note (card), and the card under a
// highlight or selection. Values match the tokens in styles.css.
const SURFACES = {
  light: [channels("#ffffff"), over(channels("#ffffff"), 0.08, false)],
  dark: [channels("#252528"), over(channels("#252528"), 0.1, true)],
};

/**
 * The picked colour as shown in each theme: unchanged if it passes 4.5:1 on
 * every surface there, else darkened (light theme) or lightened (dark theme)
 * just enough. The note keeps the colour exactly as picked.
 */
export function readableInks(hex) {
  const { h, s, l } = hexToHsl(hex);
  const fit = (theme) => {
    const step = theme === "light" ? -1 : 1;
    for (let light = l; light >= 0 && light <= 100; light += step) {
      const candidate = light === l ? hex : hslToHex(h, s, light);
      const rgb = channels(candidate);
      if (SURFACES[theme].every((bg) => contrast(rgb, bg) >= 4.5)) return candidate;
    }
    return theme === "light" ? "#000000" : "#ffffff";
  };
  return { light: fit("light"), dark: fit("dark") };
}

/**
 * How to paint text in `color`: theme inks (var(--ink-...)) already suit both
 * themes; a picked colour gets a readable version for each, which the .ink
 * class switches between. Returns {className, style} or null if unusable.
 */
export function inkPaint(color) {
  const value = color.trim();
  if (/^var\(--[\w-]+\)$/.test(value)) return { className: "", style: `color: ${value}` };
  const hex = normaliseHex(value);
  if (!hex) return null;
  const { light, dark } = readableInks(hex);
  return { className: "ink", style: `--ink-light: ${light}; --ink-dark: ${dark}` };
}

/**
 * The colour of a coloured highlight, as the CSS --mark of .cm-mark: a theme
 * ink, or a hex or rgb colour (other tools write #rrggbbaa; the alpha is
 * dropped, since Ory shows every highlight as a wash). Null if unusable.
 */
export function markPaint(color) {
  const value = color.trim();
  if (/^var\(--[\w-]+\)$/.test(value)) return value;
  return normaliseHex(/^#[0-9a-f]{8}$/i.test(value) ? value.slice(0, 7) : value);
}

// OKLCH: perceptual lightness, chroma and hue. The colour picker's honeycomb,
// palettes and Custom field are laid out in it, so equal steps look equal.

function oklchLinear(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const toByte = (v) => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
const toLinear = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** [r, g, b] for an OKLCH colour, its chroma reduced as little as needed to fit sRGB. */
export function oklchRgb(L, C, h) {
  const fits = (c) => oklchLinear(L, c, h).every((v) => v >= -1e-4 && v <= 1.0001);
  let c = C;
  if (!fits(c)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  return oklchLinear(L, c, h).map(toByte);
}

export const rgbToHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
export const oklchHex = (L, C, h) => rgbToHex(oklchRgb(L, C, h));
export const hexToRgb = channels;

export function hexToOklch(hex) {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** The most chroma a colour of lightness L and hue h can have and still fit sRGB. */
export function maxChroma(L, h) {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (oklchLinear(L, mid, h).every((v) => v >= -1e-4 && v <= 1.0001)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Whether an [r, g, b] colour reads (4.5:1) on every surface text sits on in `theme`. */
export const readsIn = (theme, rgb) => SURFACES[theme].every((bg) => contrast(rgb, bg) >= 4.5);

/**
 * An OKLCH colour made readable in one theme by moving only its lightness:
 * lighter in dark mode, darker in light mode, as little as needed.
 */
export function readableAt(theme, L, C, h) {
  const step = theme === "dark" ? 0.004 : -0.004;
  for (let l = L; l > 0 && l < 1; l += step) {
    const rgb = oklchRgb(l, C, h);
    if (readsIn(theme, rgb)) return rgbToHex(rgb);
  }
  return theme === "dark" ? "#ffffff" : "#000000";
}
