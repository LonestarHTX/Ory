"""What an AI agent can do with a notes folder: the one set of operations
behind the command line (cli.py) and the MCP server (mcp.py).

Agents have full access: they read, write, append, move and trash like the
person does. Moves go through the vault so links follow; trashing moves files
to `.trash/`, never deletes. Changes the person should review first are filed
as suggestions, in the same file and shape the app uses
(`<wikis>/.ory/suggestions.json`), and show up in the app within seconds.
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
        joined = note.text.rstrip("\n") + ("\n" if note.text.strip() else "") + text
        if not joined.endswith("\n"):
            joined += "\n"
        saved = self.vault.save(path, joined, note.rev)
        return {"path": saved.path, "rev": saved.rev, "created": False}

    def daily(self, date: Optional[str] = None) -> Dict[str, Any]:
        note, created = self.vault.daily(date or dt.date.today().isoformat())
        return {"path": note.path, "created": created}

    def move(self, src: str, dest: str) -> Dict[str, Any]:
        """Rename or move a note or folder; links to it are rewritten."""
        return self.vault.move(src, dest)

    def trash(self, path: str) -> Dict[str, Any]:
        return {"trashed": self.vault.trash(path)}

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

    def suggest(self, findings: Optional[List[Dict[str, Any]]] = None,
                drafts: Optional[List[Dict[str, Any]]] = None,
                read: Optional[List[str]] = None) -> Dict[str, Any]:
        """File findings and page drafts for the person to review in Ory, and
        mark notes as read so the next run doesn't raise them again."""
        findings = findings or []
        drafts = drafts or []
        read = read or []
        known = self.vault.notes()
        added_findings, added_drafts = [], []
        now = int(time.time() * 1000)
        for f in findings:
            kind = _KIND_WORDS.get(str(f.get("kind", "")).strip().lower())
            if not kind:
                raise VaultError(f"Unknown finding kind {f.get('kind')!r}. Use one of: {', '.join(FINDING_KINDS)}.")
            if not f.get("title"):
                raise VaultError("Every finding needs a title.")
            sources = [s if s.endswith(NOTE_EXT) else s + NOTE_EXT for s in f.get("sources", [])]
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
            added_drafts.append({
                "id": _new_id("d"), "path": path, "base": base,
                "text": d["text"] if d["text"].endswith("\n") else d["text"] + "\n",
                "changes": [{"section": str(c.get("section", "")), "reason": str(c.get("reason", ""))} for c in d.get("changes", [])],
                "findingIds": list(d.get("findingIds", [])), "accepted": [], "rejected": [], "created": now,
            })
        mtimes = {n.path: n.mtime for n in known.values()}
        for attempt in range(3):
            state = self.vault.suggestions()
            data = self._suggestions()
            data["findings"].extend(added_findings)
            new_paths = {d["path"] for d in added_drafts}
            data["drafts"] = [d for d in data["drafts"] if d["path"] not in new_paths] + added_drafts
            for p in read:
                p = self._note(p)
                if p in mtimes:
                    data["read"][p] = mtimes[p]
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
