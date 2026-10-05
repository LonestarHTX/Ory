"""What an AI agent can do with a notes folder: the one set of operations
behind the command line (cli.py) and the MCP server (mcp.py).

Agents have full access: they read, write, append, move and archive like the
person does. Moves go through the vault so links follow; archiving moves files
to `.archive/`, where the person can restore them (for the period set in
Settings, 30 days unless changed), and never deletes. Changes the person
should review first are filed as suggestions, in the same file and shape the
app uses (`<wikis>/.ory/suggestions.json`), and show up in the app within
seconds.
"""

from __future__ import annotations

import datetime as dt
import itertools
import time
from typing import Any, Dict, List, Optional

from .vault import NOTE_EXT, Vault, VaultError

FINDING_KINDS = ("page", "add", "conflict", "link", "wiki", "fix")
_KIND_WORDS = {
    "new page": "page", "page": "page",
    "add": "add", "add to page": "add", "addition": "add", "update": "add",
    "conflict": "conflict",
    "link": "link", "missing link": "link",
    "wiki": "wiki", "new wiki": "wiki",
    "fix": "fix",
}
_ids = itertools.count()


def _new_id(prefix: str) -> str:
    return f"{prefix}{int(time.time() * 1000):x}{next(_ids):x}"


class Agent:
    def __init__(self, vault: Vault):
        self.vault = vault

    # Reading ----------------------------------------------------------------

    def index(self) -> Dict[str, Any]:
        """Every note and file, with names, tags and properties, but not text."""
        listing = self.vault.listing()
        return {
            "notesFolder": self.vault.root,
            "dailyFolder": listing["dailyFolder"],
            "wikisFolder": listing["wikisFolder"],
            "notes": [
                {k: n[k] for k in ("path", "name", "aliases", "tags", "properties", "links", "mtime")}
                for n in listing["notes"]
            ],
            "files": [f["path"] for f in listing["files"]],
        }

    def wikis(self) -> List[Dict[str, Any]]:
        """Each wiki: its pages (with summaries) and its upkeep pages."""
        prefix = self.vault.wikis_folder + "/"
        out: Dict[str, Dict[str, Any]] = {}
        for n in self.vault.listing()["notes"]:
            if not n["path"].startswith(prefix):
                continue
            rest = n["path"][len(prefix):]
            if "/" not in rest:
                continue
            name = rest.split("/", 1)[0]
            wiki = out.setdefault(name, {"name": name, "folder": prefix + name, "home": None, "pages": [], "upkeep": []})
            local = rest[len(name) + 1:]
            page = {"path": n["path"], "title": local[: -len(NOTE_EXT)], "summary": n["properties"].get("summary")}
            if local.lower() == "home.md":
                wiki["home"] = n["path"]
                wiki["summary"] = n["properties"].get("summary")
            elif local.lower() in ("instructions.md", "log.md"):
                wiki["upkeep"].append(n["path"])
            else:
                wiki["pages"].append(page)
        return sorted(out.values(), key=lambda w: w["name"].lower())

    def read(self, path: str) -> Dict[str, Any]:
        note = self.vault.get(self._note(path))
        return {
            "path": note.path,
            "rev": note.rev,
            "text": note.text,
            "properties": note.properties,
            "links": sorted({r for r in (self.vault.resolve(l.target, note.path) for l in note.links) if r}),
        }

    def search(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        return [
            {"path": r["path"], "name": r["name"], "lines": [{"line": m["line"] + 1, "text": m["text"]} for m in r["matches"]]}
            for r in self.vault.search(query, limit)
        ]

    def backlinks(self, path: str) -> List[Dict[str, Any]]:
        """Notes that link here, with the linking lines (numbered from 1)."""
        return [
            {**b, "lines": [{"line": l["line"] + 1, "text": l["text"]} for l in b["lines"]]}
            for b in self.vault.backlinks(self._note(path))
        ]

    # Writing ----------------------------------------------------------------

    def write(self, path: str, text: str, rev: Optional[str] = None) -> Dict[str, Any]:
        """Create a note, or replace one. With `rev`, refuse if it changed since that read."""
        path = self._note(path)
        if path in self.vault.notes():
            note = self.vault.save(path, text, rev)
            return {"path": note.path, "rev": note.rev, "created": False}
        if rev:
            raise VaultError(f"'{path}' does not exist, so there is no version to check against.", 404)
        note = self.vault.create(path, text)
        return {"path": note.path, "rev": note.rev, "created": True}

    def append(self, path: str, text: str) -> Dict[str, Any]:
        """Add text to the end of a note on a new line, creating the note if needed."""
        path = self._note(path)
        if path not in self.vault.notes():
            return self.write(path, text if text.endswith("\n") else text + "\n")
        note = self.vault.get(path)
        eol = "\r\n" if "\r\n" in note.text else "\n"  # keep the note's own line endings
        text = text.replace("\r\n", "\n").replace("\n", eol)
        joined = note.text.rstrip("\r\n") + (eol if note.text.strip() else "") + text
        if not joined.endswith(eol):
            joined += eol
        saved = self.vault.save(path, joined, note.rev)
        return {"path": saved.path, "rev": saved.rev, "created": False}

    def daily(self, date: Optional[str] = None) -> Dict[str, Any]:
        note, created = self.vault.daily(date or dt.date.today().isoformat())
        return {"path": note.path, "created": created}

    def move(self, src: str, dest: str) -> Dict[str, Any]:
        """Rename or move a note or folder; links to it are rewritten."""
        return self.vault.move(src, dest)

    def archive(self, path: str) -> Dict[str, Any]:
        return {"archived": self.vault.archive(path)}

    def archived(self) -> Dict[str, Any]:
        """What is in the archive, and when Ory deletes each item."""
        return {"days": self.vault.archive_days, "items": self.vault.archived()}  # days 0: kept until deleted

    def restore(self, item: str) -> Dict[str, Any]:
        """Put an archived item (an id from archived) back where it came from."""
        return {"path": self.vault.restore(item)}

    # Suggestions ------------------------------------------------------------

    def _suggestions(self) -> Dict[str, Any]:
        data = self.vault.suggestions()["data"] or {}
        base = {"version": 1, "read": {}, "findings": [], "drafts": [], "history": [], "lastRun": None}
        base.update(data)
        return base

    def unread(self) -> List[Dict[str, Any]]:
        """Notes changed since suggestions last read them (wiki pages are not sources)."""
        read = self._suggestions()["read"]
        prefix = self.vault.wikis_folder + "/"
        return [
            {"path": n["path"], "mtime": n["mtime"]}
            for n in self.vault.listing()["notes"]
            if not n["path"].startswith(prefix) and not (read.get(n["path"], -1) >= n["mtime"])
        ]

    def suggestions(self) -> Dict[str, Any]:
        """Findings waiting for a decision, approved ones, and drafts waiting for review."""
        data = self._suggestions()
        return {
            "open": [f for f in data["findings"] if f.get("status") == "open"],
            "approved": [f for f in data["findings"] if f.get("status") == "approved"],
            "drafts": [{k: d.get(k) for k in ("id", "path", "changes", "findingIds")} for d in data["drafts"]],
            "unread": len(self.unread()),
        }

    def suggest(self, findings: Any = None, drafts: Any = None, read: Any = None) -> Dict[str, Any]:
        """File findings and page drafts for the person to review in Ory, and
        mark notes as read so the next run doesn't raise them again.

        A draft's `findingIds` may name findings already filed (by id) or ones
        in this same call (by their position, from 0); those become "drafted".
        `read` is a list of paths, or {path: mtime} with the mtimes `unread`
        gave, so a note edited after you read it stays unread.
        """
        findings = _list_of_dicts(findings, "findings")
        drafts = _list_of_dicts(drafts, "drafts")
        if read is None:
            read = {}
        elif isinstance(read, list):
            read = {str(p): None for p in read}
        elif not isinstance(read, dict):
            raise VaultError("read must be a list of paths or {path: mtime}.")
        known = self.vault.notes()
        added_findings, added_drafts = [], []
        now = int(time.time() * 1000)
        for f in findings:
            kind = _KIND_WORDS.get(str(f.get("kind", "")).strip().lower())
            if not kind:
                raise VaultError(f"Unknown finding kind {f.get('kind')!r}. Use one of: {', '.join(FINDING_KINDS)}.")
            if not f.get("title"):
                raise VaultError("Every finding needs a title.")
            raw = f.get("sources") or []
            if isinstance(raw, str):
                raw = [raw]
            if not isinstance(raw, list):
                raise VaultError("A finding's sources must be a list of note paths.")
            sources = [self._note(s) for s in raw]
            added_findings.append({
                "id": _new_id("f"), "kind": kind,
                "wiki": str(f.get("wiki") or ""), "page": str(f.get("page") or ""),
                "section": str(f.get("section") or ""), "title": str(f["title"]),
                "why": str(f.get("why") or ""), "sources": [s for s in sources if s in known],
                "status": "open", "created": now,
            })
        prefix = self.vault.wikis_folder + "/"
        for d in drafts:
            path = self._note(str(d.get("path", "")))
            parts = path.split("/")
            if not path.startswith(prefix) or len(parts) < 3 or any(p.startswith(".") or p in ("", "..") for p in parts):
                raise VaultError(f"'{path}' is not a page inside a wiki.")
            if not isinstance(d.get("text"), str):
                raise VaultError("Every draft needs its whole page as text.")
            base = known[path].text if path in known else None
            ids = []
            for ref in d.get("findingIds") or []:
                if isinstance(ref, int) and not isinstance(ref, bool):
                    if not 0 <= ref < len(added_findings):
                        raise VaultError(f"A draft names finding {ref}, but this call has {len(added_findings)}.")
                    ids.append(added_findings[ref]["id"])
                else:
                    ids.append(str(ref))
            added_drafts.append({
                "id": _new_id("d"), "path": path, "base": base,
                "text": d["text"] if d["text"].endswith("\n") else d["text"] + "\n",
                "changes": [{"section": str(c.get("section", "")), "reason": str(c.get("reason", ""))}
                            for c in _list_of_dicts(d.get("changes"), "changes")],
                "findingIds": ids, "accepted": [], "rejected": [], "created": now,
            })
        mtimes = {n.path: n.mtime for n in known.values()}
        drafted = {i for d in added_drafts for i in d["findingIds"]}
        for f in added_findings:
            if f["id"] in drafted:
                f["status"] = "drafted"
        for attempt in range(3):
            state = self.vault.suggestions()
            data = self._suggestions()
            data["findings"].extend(added_findings)
            for f in data["findings"]:
                if f["id"] in drafted and f.get("status") in ("open", "approved"):
                    f["status"] = "drafted"
            # A new draft for a page replaces the one waiting, and takes on its findings.
            for new in added_drafts:
                old = next((x for x in data["drafts"] if x["path"] == new["path"]), None)
                if old:
                    new["base"] = old.get("base", new["base"])
                    new["findingIds"] = list(dict.fromkeys(old.get("findingIds", []) + new["findingIds"]))
            new_paths = {d["path"] for d in added_drafts}
            data["drafts"] = [d for d in data["drafts"] if d["path"] not in new_paths] + added_drafts
            for p, seen in read.items():
                p = self._note(p)
                if p in mtimes:
                    # As of the version you read, if you say which; else as it is now.
                    data["read"][p] = mtimes[p] if seen is None else min(float(seen), mtimes[p])
            if added_findings or read:
                data["lastRun"] = now
            try:
                self.vault.save_suggestions(data, state["rev"])
                break
            except VaultError as exc:
                if exc.status != 409 or attempt == 2:
                    raise
        return {
            "findings": [f["id"] for f in added_findings],
            "drafts": [d["id"] for d in added_drafts],
            "read": len(read),
        }

    # Helpers ------------------------------------------------------------------

    @staticmethod
    def _note(path: str) -> str:
        path = str(path).strip().replace("\\", "/").strip("/")
        return path if path.lower().endswith(NOTE_EXT) else path + NOTE_EXT


def _list_of_dicts(value: Any, name: str) -> List[Dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(v, dict) for v in value):
        raise VaultError(f"{name} must be a list of objects.")
    return value
