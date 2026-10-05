// The formatting toolbar above a note: a style picker, then inline styles,
// lists and inserts. Every button writes Markdown. The link button swaps the
// tools for an address field. When the note is too narrow for every tool, the
// last ones move into a "More" menu at the end instead of wrapping.

import { endColourPreview, previewColour } from "../editor/colour-preview.js";
import {
  applyLink, formatState, insertPropertyTable, insertTable, linkAt, PLAIN_HIGHLIGHT, setColor, setHeading,
  setHighlight, startNoteLink, toggleInline, toggleList, toggleQuote,
} from "../editor/format.js";
import { inkPaint, markPaint } from "./color.js";
import { closeColorPicker, GREY, openColorPicker, THEME_INKS, washOf } from "./color-picker.js";
import { h, icon } from "./dom.js";
import { openMenu } from "./menu.js";

const STYLES = [
  { level: 0, label: "Body", shortcut: "Mod-Alt-0" },
  { level: 1, label: "Heading 1", shortcut: "Mod-Alt-1" },
  { level: 2, label: "Heading 2", shortcut: "Mod-Alt-2" },
  { level: 3, label: "Heading 3", shortcut: "Mod-Alt-3" },
];

// null draws a separator. `state` names the formatState field that presses it.
const TOOLS = [
  { label: "Bold", shortcut: "Mod-B", text: "B", cls: "is-bold", state: "bold", run: toggleInline("bold") },
  { label: "Italic", shortcut: "Mod-I", text: "I", cls: "is-italic", state: "italic", run: toggleInline("italic") },
  { label: "Strikethrough", shortcut: "Mod-Shift-X", text: "S", cls: "is-strike", state: "strike", run: toggleInline("strike") },
  // Text colour and highlights are one picker (Text | Highlight); Mod-Shift-H
  // still toggles a plain highlight from the keyboard.
  { label: "Colour and highlight", ink: true },
  null,
  { label: "Bulleted list", shortcut: "Mod-Shift-8", icon: "bullets", state: "list:bullet", run: toggleList("bullet") },
  { label: "Numbered list", shortcut: "Mod-Shift-7", icon: "numbers", state: "list:number", run: toggleList("number") },
  { label: "Checklist", shortcut: "Mod-Shift-9", icon: "checklist", state: "list:task", run: toggleList("task") },
  { label: "Quote", icon: "quote", state: "quote", run: toggleQuote },
  null,
  { label: "Link", shortcut: "Mod-K", icon: "link", state: "link", link: true },
  { label: "Code", icon: "code", state: "code", run: toggleInline("code") },
  { label: "Table", icon: "table", run: insertTable },
  { label: "Property table", icon: "propertyTable", run: insertPropertyTable },
  { label: "Attach file or picture", icon: "attach", attach: true },
];

/** options.attach(files) uploads files chosen with the attach button. */
export function createFormatToolbar(getView, options = {}) {
  const tools = h("div", { class: "format-tools" });
  const linkRow = h("div", { class: "format-link", hidden: true });
  const picker = h("input", { type: "file", multiple: true, hidden: true, tabindex: -1 });
  picker.addEventListener("change", () => {
    if (picker.files.length) options.attach?.([...picker.files]);
    picker.value = "";
    getView().focus();
  });
  const bar = h("div", { class: "format-bar", role: "toolbar", "aria-label": "Formatting" }, tools, linkRow, picker);

  const styleLabel = h("span", { class: "format-style-label" }, "Body");
  const styleButton = h("button", {
    class: "format-style",
    type: "button",
    "aria-haspopup": "menu",
    "aria-label": "Paragraph style",
    dataset: { tip: "Paragraph style" },
    onClick: () => openMenu(styleButton, STYLES.map((s) => ({
      label: s.label,
      checked: s.level === current.heading,
      run: () => runOnEditor(setHeading(s.level)),
    })), { align: "start" }),
  }, styleLabel, icon("chevronDown", 14));

  const buttons = [];
  const items = []; // the tools after the style picker, separators included, in order
  tools.append(styleButton, h("span", { class: "format-sep" }));
  for (const tool of TOOLS) {
    if (!tool) {
      const sep = h("span", { class: "format-sep" });
      items.push({ el: sep, tool: null });
      tools.append(sep);
      continue;
    }
    const button = h("button", {
      class: `format-btn${tool.cls ? " " + tool.cls : ""}${tool.ink ? " format-btn--ink" : ""}`,
      type: "button",
      "aria-label": tool.label,
      "aria-haspopup": tool.ink ? "menu" : null,
      dataset: { tip: tool.label, tipKeys: tool.shortcut ?? "" },
      "aria-pressed": tool.state ? "false" : null,
      onClick: () => (tool.link ? editLink(getView())
        : tool.attach ? picker.click()
          : tool.ink ? openInks(button)
            : runOnEditor(tool.run)),
    }, tool.ink ? [h("span", null, "A"), h("span", { class: "format-ink" })] : tool.icon ? icon(tool.icon, 16) : tool.text);
    buttons.push({ button, tool });
    items.push({ el: button, tool });
    tools.append(button);
  }

  // Overflow: tools that don't fit go into "More", from the end.
  const more = h("button", {
    class: "format-btn format-more", type: "button", hidden: true, tabindex: -1,
    "aria-label": "More formatting", "aria-haspopup": "menu", dataset: { tip: "More" },
    onClick: () => openMenu(more, items.filter((it) => it.tool && it.el.hidden).map(({ el, tool }) => ({
      label: tool.label,
      checked: tool.state ? el.getAttribute("aria-pressed") === "true" : null,
      run: () => (tool.link ? editLink(getView())
        : tool.attach ? picker.click()
          : tool.ink ? openInks(more)
            : runOnEditor(tool.run)),
    }))),
  }, icon("more", 16));
  tools.append(more);

  function fit() {
    for (const it of items) it.el.hidden = false;
    more.hidden = true;
    if (tools.hidden || tools.clientWidth === 0 || tools.scrollWidth <= tools.clientWidth) return;
    more.hidden = false;
    for (let i = items.length - 1; i >= 0 && tools.scrollWidth > tools.clientWidth; i--) items[i].el.hidden = true;
    // No separator right before "More".
    const last = items.findLast((it) => !it.el.hidden);
    if (last && !last.tool) last.el.hidden = true;
    // The toolbar is one tab stop; if its button was hidden, the first one takes it.
    const visible = focusables();
    if (visible.length && !visible.some((b) => b.getAttribute("tabindex") === "0")) visible[0].setAttribute("tabindex", "0");
  }
  new ResizeObserver(() => fit()).observe(tools);

  // Clicking a tool must not take focus or the selection away from the note.
  tools.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });

  // One tab stop for the whole toolbar; arrow keys move between its buttons.
  const focusables = () => [...tools.querySelectorAll("button")].filter((b) => !b.hidden);
  focusables().forEach((b, i) => b.setAttribute("tabindex", i === 0 ? "0" : "-1"));
  tools.addEventListener("keydown", (e) => {
    const list = focusables();
    const i = list.indexOf(document.activeElement);
    if (i === -1) return;
    let next = null;
    if (e.key === "ArrowRight") next = list[(i + 1) % list.length];
    else if (e.key === "ArrowLeft") next = list[(i - 1 + list.length) % list.length];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    else if (e.key === "Escape") return getView().focus();
    if (!next) return;
    e.preventDefault();
    list.forEach((b) => b.setAttribute("tabindex", "-1"));
    next.setAttribute("tabindex", "0");
    next.focus();
  });

  /**
   * The colour picker, for text colour or a highlight. Pointing at a colour
   * previews it on the text; picking applies it; focus returns to the note.
   * The picker's grey highlight is the plain ==highlight==.
   */
  function openInks(anchor) {
    const view = getView();
    const asHighlight = (value) => (value === GREY ? PLAIN_HIGHLIGHT : value);
    openColorPicker({
      anchor,
      text: current.color,
      mark: current.mark === PLAIN_HIGHLIGHT ? GREY : current.mark,
      onPreview: (kind, value, options) => previewColour(view, kind, kind === "mark" ? asHighlight(value) : value, options),
      onPick: (kind, value) => {
        endColourPreview(view);
        if (kind === "text") setColor(value)(view);
        else setHighlight(asHighlight(value))(view);
      },
      onClose: ({ quiet }) => {
        if (quiet) endColourPreview(view);
        else view.focus();
      },
    });
  }

  function runOnEditor(command) {
    const view = getView();
    command(view);
    // Back to the note, unless the command moved focus into a table cell.
    if (!document.activeElement?.closest?.(".md-cell")) view.focus();
  }

  // Link: with text selected (or the cursor in a web link) ask for the address;
  // otherwise start a link to a note, which is the common case in Ory.
  function editLink(view) {
    const target = linkAt(view.state);
    const { from, to } = view.state.selection.main;
    if (!target && from === to) {
      startNoteLink(view);
      view.focus();
      return true;
    }
    const field = h("input", {
      class: "input format-link-field",
      type: "url",
      placeholder: "https://",
      "aria-label": "Link address",
      value: target?.url ?? "",
      spellcheck: "false",
    });
    const close = () => {
      linkRow.hidden = true;
      tools.hidden = false;
      view.focus();
    };
    const apply = () => {
      let url = field.value.trim();
      if (!url) return field.focus();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
      applyLink(view, url, target);
      close();
    };
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
    linkRow.replaceChildren(
      field,
      h("button", { class: "btn btn--small", type: "button", onClick: apply }, target ? "Update link" : "Add link"),
      h("button", { class: "btn btn--small btn--plain", type: "button", onClick: close }, "Cancel"),
    );
    tools.hidden = true;
    linkRow.hidden = false;
    field.focus();
    field.select();
    return true;
  }

  let current = { heading: 0 };

  /** Reflect the formatting at the cursor: pressed buttons and the style name. */
  function update(state) {
    current = formatState(state);
    styleLabel.textContent = STYLES.find((s) => s.level === current.heading)?.label ?? `Heading ${current.heading}`;
    const ink = THEME_INKS.find(([, value]) => value === current.color);
    const inkButton = tools.querySelector(".format-btn--ink");
    // The bar shows the text colour as the note does (readable in this theme),
    // and the letter sits on the highlight's wash, if there is one.
    const bar = inkButton.querySelector(".format-ink");
    const paint = current.color ? inkPaint(current.color) : null;
    bar.className = `format-ink ${paint?.className ?? ""}`;
    bar.setAttribute("style", paint?.style ?? "");
    const wash = current.mark === PLAIN_HIGHLIGHT ? "var(--selected)" : current.mark ? markPaint(current.mark) : null;
    inkButton.firstChild.style.background = wash && wash !== "var(--selected)" ? washOf(wash) : wash ?? "";
    const marked = THEME_INKS.find(([, value]) => value === current.mark)?.[0] ?? (current.mark === PLAIN_HIGHLIGHT ? "Grey" : current.mark);
    inkButton.setAttribute("aria-label", `Colour: text ${ink?.[0] ?? current.color ?? "default"}${marked ? `, ${marked} highlight` : ""}`);
    for (const { button, tool } of buttons) {
      if (!tool.state) continue;
      const [key, value] = tool.state.split(":");
      const on = value ? current[key] === value : !!current[key];
      button.setAttribute("aria-pressed", String(on));
    }
  }

  /** Close the link field and the colour picker, as when the note they were editing is left. */
  function reset() {
    closeColorPicker({ quiet: true });
    linkRow.hidden = true;
    linkRow.replaceChildren();
    tools.hidden = false;
  }

  return { el: bar, update, editLink, reset };
}
