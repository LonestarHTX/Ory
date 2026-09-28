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
