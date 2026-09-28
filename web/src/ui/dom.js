// Small DOM helpers. No framework: the UI is a handful of views that re-render
// from the store.

import {
  AppWindow, ArrowRight, BookOpen, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Code, Copy, Ellipsis, File,
  FileImage, FilePlus, FolderPlus, Highlighter, LayoutGrid, Link, List, ListChecks, ListOrdered, ListTree, Monitor, Moon,
  Lightbulb, NotebookPen, Paperclip, Plus, Search, Settings, SquarePen, Sun, Table, TableProperties, TextQuote, TriangleAlert,
} from "lucide";

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "value") el.value = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// Icons: Lucide, one stroke weight everywhere.
const ICONS = {
  chevron: ChevronRight,
  chevronLeft: ChevronLeft,
  file: File,
  image: FileImage,
  attach: Paperclip,
  page: AppWindow,
  plus: Plus,
  outline: ListTree,
  propertyTable: TableProperties,
  chevronDown: ChevronDown,
  code: Code,
  highlight: Highlighter,
  link: Link,
  bullets: List,
  numbers: ListOrdered,
  checklist: ListChecks,
  quote: TextQuote,
  table: Table,
  calendar: CalendarDays,
  more: Ellipsis,
  newNote: FilePlus,
  newFolder: FolderPlus,
  search: Search,
  sun: Sun,
  moon: Moon,
  system: Monitor,
  book: BookOpen,
  notebook: NotebookPen,
  edit: SquarePen,
  check: Check,
  arrowRight: ArrowRight,
  grid: LayoutGrid,
  copy: Copy,
  warning: TriangleAlert,
  suggestions: Lightbulb,
  settings: Settings,
};

const SVG = "http://www.w3.org/2000/svg";

export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
    class: "icon",
  })) svg.setAttribute(k, v);
  for (const [tag, attrs] of ICONS[name]) {
    const child = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, v);
    svg.append(child);
  }
  return svg;
}

// Keyboard ------------------------------------------------------------------

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** True when the platform's command key (Cmd on Mac, Ctrl elsewhere) is held. */
export const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);

const KEY_LABELS = isMac
  ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↵", Up: "↑", Down: "↓" }
  : { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Enter: "Enter", Up: "↑", Down: "↓" };

/** Render a shortcut such as "Mod-Shift-F" as one key cap. */
export function keys(combo) {
  const sep = isMac ? "" : "+";
  return h("kbd", { class: "kbd" }, combo.split("-").map((k) => KEY_LABELS[k] ?? k).join(sep));
}

/** Let a floating layer fade out the way it arrived, then run `done`. */
export function leave(node, done) {
  if (node.classList.contains("is-leaving")) return;
  node.classList.add("is-leaving");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
  setTimeout(done, 120);
}

// Dates ---------------------------------------------------------------------

const DAY = 86400000;

export function formatDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "just now", "4 min ago", "3 h ago", "yesterday", "5 days ago", then a date. */
export function timeAgo(ms, now = Date.now()) {
  const diff = Math.max(0, now - ms);
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / 3600000)} h ago`;
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return `on ${formatDate(new Date(ms))}`;
}

/** Days from today to a date, in words: "today", "in 14 days", "3 days ago". */
export function relativeDay(date, now = new Date()) {
  const startOfDay = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
