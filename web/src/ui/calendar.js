// A small calendar under a date field. Never the
// browser's own date picker. Arrow keys move by day and week, Page Up/Down by
// month, Enter picks, Escape closes. The chosen date is shown in words.

import { formatDate, h, icon, leave, relativeDay } from "./dom.js";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
let open = null;

export const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function parseISO(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function closeCalendar() {
  if (!open) return;
  const { el, cleanup } = open;
  open = null;
  cleanup();
  leave(el, () => el.remove());
}

/** Open under `anchor`. onPick receives "YYYY-MM-DD", or null for Clear. */
export function openCalendar(anchor, { value, onPick, onClose }) {
  closeCalendar();
  const picked = parseISO(value);
  const today = new Date();
  let month = new Date((picked ?? today).getFullYear(), (picked ?? today).getMonth(), 1);
  let focusDay = picked ?? today;

  const el = h("div", { class: "menu cal", role: "dialog", "aria-label": "Choose a date" });
  const title = h("span", { class: "cal__month", "aria-live": "polite" });
  const grid = h("div", { class: "cal__grid", role: "grid" });
  const foot = h("div", { class: "cal__foot" });
  const nav = (delta) => {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    focusDay = new Date(month.getFullYear(), month.getMonth(), Math.min(focusDay.getDate(), 28));
    render(false);
  };
  el.append(
    h("div", { class: "cal__head" },
      title,
      h("button", { class: "iconbtn", type: "button", "aria-label": "Previous month", dataset: { tip: "Previous month" }, onClick: () => nav(-1) }, icon("chevronLeft", 16)),
      h("button", { class: "iconbtn", type: "button", "aria-label": "Next month", dataset: { tip: "Next month" }, onClick: () => nav(1) }, icon("chevron", 16))),
    grid,
    foot,
  );

  const pick = (iso) => {
    closeCalendar();
    onPick(iso);
  };

  function render(focus = true) {
    title.textContent = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    grid.replaceChildren(...DAYS.map((d) => h("span", { class: "cal__dow", "aria-hidden": "true" }, d)));
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
    for (let i = 0; i < 42; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = toISO(day);
      const cls = ["cal__day"];
      if (day.getMonth() !== month.getMonth()) cls.push("is-out");
      if (iso === toISO(today)) cls.push("is-now");
      if (picked && iso === toISO(picked)) cls.push("is-picked");
      grid.append(h("button", {
        class: cls.join(" "),
        type: "button",
        tabindex: iso === toISO(focusDay) ? 0 : -1,
        "aria-label": formatDate(day),
        "aria-pressed": picked && iso === toISO(picked) ? "true" : "false",
        dataset: { iso },
        onClick: () => pick(iso),
      }, String(day.getDate())));
    }
    foot.replaceChildren(
      picked
        ? h("span", null, `${formatDate(picked)} · ${relativeDay(picked)}`)
        : h("span", { class: "cal__none" }, "No date chosen"),
      h("span", { class: "cal__actions" },
        h("button", { class: "btn btn--small btn--plain", type: "button", onClick: () => pick(toISO(today)) }, "Today"),
        picked ? h("button", { class: "btn btn--small btn--plain", type: "button", onClick: () => pick(null) }, "Clear") : null),
    );
    if (focus) grid.querySelector(`[data-iso="${toISO(focusDay)}"]`)?.focus();
  }

  el.addEventListener("keydown", (e) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeCalendar();
      anchor.focus?.();
      onClose?.();
    } else if (steps[e.key] && e.target.classList.contains("cal__day")) {
      e.preventDefault();
      focusDay = new Date(focusDay.getFullYear(), focusDay.getMonth(), focusDay.getDate() + steps[e.key]);
      month = new Date(focusDay.getFullYear(), focusDay.getMonth(), 1);
      render();
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      nav(e.key === "PageUp" ? -1 : 1);
      render();
    }
  });

  document.body.append(el);
  render(false);
  const rect = anchor.getBoundingClientRect();
  el.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - el.offsetHeight - 8)}px`;
  el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - el.offsetWidth - 8))}px`;
  grid.querySelector(`[data-iso="${toISO(focusDay)}"]`)?.focus();

  const onPointer = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) {
      closeCalendar();
      onClose?.();
    }
  };
  document.addEventListener("pointerdown", onPointer, true);
  open = { el, cleanup: () => document.removeEventListener("pointerdown", onPointer, true) };
}
