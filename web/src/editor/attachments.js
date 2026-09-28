// Screenshots and files in notes. Pasting or dropping a file uploads it to the
// attachments folder and inserts an embed (![[name.png]]) where it
// landed. Pasting cells copied from Excel inserts them as a table.

import { StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { api } from "../api.js";
import { insertBlock } from "./format.js";
import { serializeTable } from "./tables.js";

const addPending = StateEffect.define();
const removePending = StateEffect.define();

/** Where each upload in flight will be inserted, kept in step with edits. */
const pending = StateField.define({
  create: () => new Map(),
  update(map, tr) {
    let next = map;
    if (tr.docChanged && map.size) {
      next = new Map();
      for (const [id, pos] of map) next.set(id, tr.changes.mapPos(pos, 1));
    }
    for (const e of tr.effects) {
      if (e.is(addPending)) next = new Map(next).set(e.value.id, e.value.pos);
      if (e.is(removePending)) {
        next = new Map(next);
        next.delete(e.value);
      }
    }
    return next;
  },
});

let nextId = 0;

/** "image.png" from the clipboard becomes "Pasted image 20260927184512.png". */
function uploadName(file) {
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name);
  if (!generic) return file.name;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
  return `Pasted image ${stamp}.${ext}`;
}

/**
 * Upload files and insert an embed for each at `pos`.
 * env: { notePath(), linkTextFor(path), afterUpload(), onError(message) }
 */
export async function insertFiles(view, files, pos, env) {
  const jobs = [...files].map(async (file) => {
    const id = ++nextId;
    view.dispatch({ effects: addPending.of({ id, pos }) });
    try {
      const saved = await api.upload(file, { name: uploadName(file), note: env.notePath() });
      await env.afterUpload();
      // The note was left while the file uploaded: it's saved, but not embedded elsewhere.
      const at = view.state.field(pending).get(id);
      if (at == null || view.state.readOnly) return;
      const insert = `![[${env.linkTextFor(saved.path)}]]`;
      view.dispatch({
        changes: { from: at, insert: files.length > 1 ? insert + "\n" : insert },
        effects: removePending.of(id),
        userEvent: "input.paste",
      });
    } catch (err) {
      view.dispatch({ effects: removePending.of(id) });
      env.onError(`Could not add "${file.name || "the file"}": ${err.message}`);
    }
  });
  await Promise.all(jobs);
}

/** Tab-separated rows (as Excel copies them) as a Markdown table, or null. */
function tableFromClipboard(text) {
  const lines = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
  if (lines.length < 2 || !lines.every((l) => l.includes("\t"))) return null;
  const rows = lines.map((l) => l.split("\t").map((c) => c.trim()));
  const cols = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => [...r, ...Array(cols - r.length).fill("")]);
  return serializeTable({ align: Array(cols).fill(null), rows: padded });
}

export function attachments(env) {
  return [
    pending,
    EditorView.domEventHandlers({
      paste(event, view) {
        const data = event.clipboardData;
        if (!data || view.state.readOnly) return false;
        const text = data.getData("text/plain");
        // Text wins: Word and Excel put a picture of the selection on the
        // clipboard too, but people mean the text.
        if (text) {
          const table = tableFromClipboard(text);
          if (!table) return false;
          event.preventDefault();
          insertBlock(view, table);
          return true;
        }
        if (!data.files.length) return false;
        event.preventDefault();
        insertFiles(view, data.files, view.state.selection.main.head, env);
        return true;
      },
      dragover(event, view) {
        if (view.state.readOnly) return false;
        const types = event.dataTransfer?.types ?? [];
        if (types.includes("Files") || types.includes("application/x-ory-path")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = types.includes("Files") ? "copy" : "link";
          return true;
        }
        return false;
      },
      drop(event, view) {
        const transfer = event.dataTransfer;
        if (!transfer || view.state.readOnly) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        // A note or file dragged from the tree becomes a link to it.
        const dragged = transfer.getData("application/x-ory-path");
        if (dragged) {
          event.preventDefault();
          const embed = /\.md$/i.test(dragged) ? "" : "!";
          const text = `${embed}[[${env.linkTextFor(dragged)}]]`;
          view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, userEvent: "input.drop" });
          view.focus();
          return true;
        }
        if (!transfer.files.length) return false;
        event.preventDefault();
        insertFiles(view, transfer.files, pos, env);
        return true;
      },
    }),
  ];
}
