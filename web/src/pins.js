// Pinned notes, shown at the top of the notes sidebar. Kept in this browser,
// one list per notes folder. They follow a note when it moves, and drop it
// when it's archived.

import { onMove } from "./actions.js";
import { emit, store } from "./store.js";

const key = () => `ory.pins:${store.vaultName}`;

export function pinned() {
  try {
    const list = JSON.parse(localStorage.getItem(key()));
    return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(key(), JSON.stringify(list));
  } catch {
    /* lasts for this page only */
  }
  emit("pins");
}

export const isPinned = (path) => pinned().includes(path);

export function togglePin(path) {
  const list = pinned();
  save(list.includes(path) ? list.filter((p) => p !== path) : [...list, path]);
}

onMove({
  before() {},
  after(from, to) {
    const list = pinned();
    const next = list.flatMap((p) => {
      if (p !== from && !p.startsWith(from + "/")) return [p];
      return to ? [to + p.slice(from.length)] : [];
    });
    if (next.join("\n") !== list.join("\n")) save(next);
  },
});
