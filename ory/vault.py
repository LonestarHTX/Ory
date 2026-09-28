"""The notes folder: reading, writing, indexing, links, backlinks and search.

The folder on disk is the only source of truth. The index is an in-memory
cache that `refresh()` brings up to date by comparing file modification
times, so edits made by Obsidian, git or an AI tool are picked up without a
file watcher.
"""

from __future__ import annotations

import json
import os
import posixpath
import re
import shutil
import tempfile
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple

from . import markdown

NOTE_EXT = ".md"
# Guides for AI agents at the top of the notes folder (guide.py); not notes.
AGENT_GUIDES = ("AGENTS.md", "CLAUDE.md")
TRASH_DIR = ".trash"
DEFAULT_ATTACHMENTS = "Attachments"
# A link target ending in one of these is a file rather than a note.
_FILE_EXT = re.compile(r"\.[A-Za-z0-9]{1,8}$")
# Characters Obsidian refuses in file names, plus the link syntax characters.
_BAD_NAME_CHARS = set('\\:*?"<>|#^[]')
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class VaultError(Exception):
    """A request the vault cannot carry out. `status` is the HTTP status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class Note:
    path: str  # POSIX path relative to the vault root, including `.md`
    rev: str  # changes whenever the file changes on disk
    mtime: float
    text: str
    properties: Dict[str, Any] = field(default_factory=dict)
    links: List[markdown.Link] = field(default_factory=list)
    body_tags: List[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return note_name(self.path)

    @property
    def aliases(self) -> List[str]:
        return markdown.as_list(self.properties.get("aliases") or self.properties.get("alias"))

    @property
    def tags(self) -> List[str]:
        """Tags from the `tags` property and #tags in the text, without the "#"."""
        found = [t.lstrip("#") for t in markdown.as_list(self.properties.get("tags") or self.properties.get("tag"))]
        for tag in self.body_tags:
            if tag not in found:
                found.append(tag)
        return found


@dataclass
class Attachment:
    """Any file in the vault that is not a note: images, PDFs, spreadsheets."""

    path: str
    rev: str
    mtime: float
    size: int

    @property
    def name(self) -> str:
        return posixpath.basename(self.path)


def note_name(path: str) -> str:
    base = posixpath.basename(path)
    return base[: -len(NOTE_EXT)] if base.lower().endswith(NOTE_EXT) else base


def _rev(stat: os.stat_result) -> str:
    return f"{stat.st_mtime_ns:x}-{stat.st_size:x}"


class Vault:
    def __init__(
        self,
        root: str,
        daily_folder: str = "Daily",
        attachments_folder: Optional[str] = None,
        wikis_folder: str = "Wikis",
    ):
        self.root = os.path.realpath(os.path.expanduser(root))
        self.daily_folder = daily_folder.strip("/")
        # Each folder inside this one is a wiki; everything outside it is notes.
        self.wikis_folder = wikis_folder.strip("/") or "Wikis"
        self.attachments_setting = attachments_folder
        self._notes: Dict[str, Note] = {}
        self._files: Dict[str, Attachment] = {}
        self._folders: List[str] = []
        self._by_name: Dict[str, List[str]] = {}
        self._by_file: Dict[str, List[str]] = {}
        self._lock = threading.RLock()
        self.version = 0

    # Paths ----------------------------------------------------------------

    def _abs(self, rel: str) -> str:
        """Resolve a vault-relative path, refusing anything outside the vault."""
        if not isinstance(rel, str) or not rel.strip():
            raise VaultError("A path is required.")
        rel = rel.replace("\\", "/").strip("/")
        norm = posixpath.normpath(rel)
        if norm.startswith("..") or posixpath.isabs(norm) or norm == ".":
            raise VaultError(f"'{rel}' is outside the notes folder.")
        # Check the real folder the path sits in, but act on the path itself, so
        # a symlinked note is renamed or trashed as the link, not its target.
        full = os.path.join(self.root, *norm.split("/"))
        parent = os.path.realpath(os.path.dirname(full))
        if os.path.commonpath([parent, self.root]) != self.root:
            raise VaultError(f"'{rel}' is outside the notes folder.")
        return os.path.join(parent, os.path.basename(full))

    @staticmethod
    def check_name(rel: str) -> str:
        """Validate a new note or folder path and return it normalised."""
        rel = rel.replace("\\", "/").strip().strip("/")
        if not rel:
            raise VaultError("Enter a name.")
        for part in rel.split("/"):
            part_name = part[: -len(NOTE_EXT)] if part.lower().endswith(NOTE_EXT) else part
            if not part_name.strip():
                raise VaultError("Names cannot be empty.")
            if part.startswith("."):
                raise VaultError("Names cannot start with a dot.")
            bad = sorted(set(part) & _BAD_NAME_CHARS)
            if bad:
                raise VaultError("Names cannot contain " + " ".join(bad) + ".")
        return rel

    @staticmethod
    def _note_path(rel: str) -> str:
        return rel if rel.lower().endswith(NOTE_EXT) else rel + NOTE_EXT

    # Index ----------------------------------------------------------------

    def refresh(self) -> int:
        """Bring the index in line with the disk. Returns the index version."""
        with self._lock:
            seen: Dict[str, Tuple[os.stat_result, str]] = {}
            files: Dict[str, Attachment] = {}
            folders: List[str] = []
            for dirpath, dirnames, filenames in os.walk(self.root):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
                rel_dir = os.path.relpath(dirpath, self.root).replace(os.sep, "/")
                if rel_dir != ".":
                    folders.append(rel_dir)
                for filename in filenames:
                    if filename.startswith(".") or (rel_dir == "." and filename in AGENT_GUIDES):
                        continue
                    full = os.path.join(dirpath, filename)
                    rel = filename if rel_dir == "." else f"{rel_dir}/{filename}"
                    try:
                        stat = os.stat(full)
                    except OSError:
                        continue
                    if filename.lower().endswith(NOTE_EXT):
                        seen[rel] = (stat, full)
                    else:
                        files[rel] = Attachment(rel, _rev(stat), stat.st_mtime, stat.st_size)

            changed = bool(set(self._notes) - set(seen)) or folders != self._folders
            if {k: v.rev for k, v in files.items()} != {k: v.rev for k, v in self._files.items()}:
                changed = True
                self._files = files
            for rel, (stat, full) in seen.items():
                existing = self._notes.get(rel)
                if existing and existing.rev == _rev(stat):
                    continue
                note = self._load(rel, full, stat)
                if note:
                    self._notes[rel] = note
                    changed = True
            for rel in set(self._notes) - set(seen):
                del self._notes[rel]
            self._folders = folders

            if changed:
                self._by_name = {}
                for rel in self._notes:
                    self._by_name.setdefault(note_name(rel).lower(), []).append(rel)
                self._by_file = {}
                for rel in self._files:
                    self._by_file.setdefault(posixpath.basename(rel).lower(), []).append(rel)
                self.version += 1
            return self.version

    def _load(self, rel: str, full: str, stat: os.stat_result) -> Optional[Note]:
        try:
            with open(full, "r", encoding="utf-8", errors="replace", newline="") as fh:
                text = fh.read()
        except OSError:
            return None
        frontmatter, _ = markdown.split_frontmatter(text)
        return Note(
            path=rel,
            rev=_rev(stat),
            mtime=stat.st_mtime,
            text=text,
            properties=markdown.parse_properties(frontmatter),
            links=markdown.extract_links(text),
            body_tags=markdown.extract_tags(text),
        )

    def listing(self) -> Dict[str, Any]:
        with self._lock:
            self.refresh()
            return {
                "version": self.version,
                "name": os.path.basename(self.root),
                "dailyFolder": self.daily_folder,
                "wikisFolder": self.wikis_folder,
                "folders": list(self._folders),
                "notes": [
                    {
                        "path": n.path, "name": n.name, "aliases": n.aliases, "mtime": n.mtime,
                        "tags": n.tags, "properties": n.properties,
                        "links": sorted({r for r in (self.resolve(l.target, n.path) for l in n.links) if r}),
                    }
                    for n in sorted(self._notes.values(), key=lambda n: n.path.lower())
                ],
                "files": [
                    {"path": f.path, "name": f.name, "size": f.size, "mtime": f.mtime}
                    for f in sorted(self._files.values(), key=lambda f: f.path.lower())
                ],
            }

    # Link resolution --------------------------------------------------------
    # Mirrors web/src/links.js. Keep the two in step.

    def resolve(self, target: str, source: Optional[str] = None) -> Optional[str]:
        """Resolve a wikilink target to a note path, the way Obsidian does.

        A bare name matches any note with that file name (case-insensitive);
        when several match, the one in the source note's folder wins, then the
        shortest path. A target containing `/` matches a path, either from the
        vault root, as a suffix, or relative to the source note (`./`, `../`).
        """
        with self._lock:
            return resolve_link(target, source, self._notes.keys(), self._by_name,
                                self._files.keys(), self._by_file)

    def link_text_for(self, path: str, source: Optional[str] = None) -> str:
        """The shortest link text that resolves to `path` from `source`."""
        is_note = path.lower().endswith(NOTE_EXT)
        name = note_name(path) if is_note else posixpath.basename(path)
        if self.resolve(name, source) == path:
            return name
        return path[: -len(NOTE_EXT)] if is_note else path

    def notes(self) -> Dict[str, Note]:
        """Every note by path, fresh from disk."""
        with self._lock:
            self.refresh()
            return dict(self._notes)

    def read_many(self, paths: Iterable[str]) -> List[Dict[str, Any]]:
        """Several notes' text at once, for building a prompt. Unknown paths are skipped."""
        with self._lock:
            self.refresh()
            out = []
            for rel in paths:
                note = self._notes.get(rel) if isinstance(rel, str) else None
                if note:
                    out.append({"path": note.path, "text": note.text, "rev": note.rev, "mtime": note.mtime})
            return out

    # Suggestions ------------------------------------------------------------
    # What the AI found and drafted, and which notes it has read, as JSON in a
    # dot-folder of the wikis folder: out of the index and the backlinks, but
    # in the notes folder's git history with everything else.

    def _suggestions_file(self) -> str:
        return os.path.join(self.root, *self.wikis_folder.split("/"), ".ory", "suggestions.json")

    def suggestions_rev(self) -> Optional[str]:
        full = self._suggestions_file()
        return _rev(os.stat(full)) if os.path.exists(full) else None

    def suggestions(self) -> Dict[str, Any]:
        full = self._suggestions_file()
        with self._lock:
            if not os.path.exists(full):
                return {"data": None, "rev": None}
            try:
                with open(full, encoding="utf-8") as fh:
                    data = json.load(fh)
            except ValueError as exc:
                raise VaultError(f"{self.wikis_folder}/.ory/suggestions.json is not valid JSON: {exc}", 500)
            return {"data": data, "rev": _rev(os.stat(full))}

    def save_suggestions(self, data: Any, base_rev: Optional[str]) -> Dict[str, Any]:
        """Replace the suggestions file. Refuses if it changed since `base_rev` (None: it did not exist)."""
        if not isinstance(data, dict):
            raise VaultError("Suggestions must be a JSON object.")
        full = self._suggestions_file()
        with self._lock:
            current = _rev(os.stat(full)) if os.path.exists(full) else None
            if current != base_rev:
                raise VaultError("Suggestions changed in another window. Reload to see them.", 409)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            _atomic_write(full, json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            return {"rev": _rev(os.stat(full))}

    # Notes ------------------------------------------------------------------

    def get(self, rel: str) -> Note:
        self._abs(rel)
        with self._lock:
            self.refresh()
            note = self._notes.get(rel)
            if not note:
                raise VaultError(f"'{rel}' does not exist.", 404)
            return note

    def save(self, rel: str, text: str, base_rev: Optional[str]) -> Note:
        """Overwrite a note. Refuses if it changed on disk since `base_rev`."""
        full = self._abs(rel)
        with self._lock:
            self.refresh()
            if rel not in self._notes:
                # Only notes the index knows can be saved, never other files.
                raise VaultError(f"'{rel}' no longer exists.", 404)
            if base_rev is not None:
                current = _rev(os.stat(full))
                if current != base_rev:
                    raise VaultError("The note changed on disk since it was opened.", 409)
            _atomic_write(full, text)
            self.refresh()
            return self._notes[rel]

    def create(self, rel: str, text: str = "") -> Note:
        rel = self._note_path(self.check_name(rel))
        full = self._abs(rel)
        with self._lock:
            if os.path.exists(full):
                raise VaultError(f"'{rel}' already exists.", 409)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            _atomic_write(full, text)
            self.refresh()
            return self._notes[rel]

    def create_folder(self, rel: str) -> str:
        rel = self.check_name(rel)
        full = self._abs(rel)
        with self._lock:
            if os.path.exists(full):
                raise VaultError(f"'{rel}' already exists.", 409)
            os.makedirs(full)
            self.refresh()
            return rel

    def daily(self, date: str) -> Tuple[Note, bool]:
        if not _DATE.match(date or ""):
            raise VaultError("Dates look like 2026-09-27.")
        rel = f"{self.daily_folder}/{date}{NOTE_EXT}" if self.daily_folder else date + NOTE_EXT
        with self._lock:
            self.refresh()
            if rel in self._notes:
                return self._notes[rel], False
            return self.create(rel), True

    # Attachments --------------------------------------------------------------

    def attachments_folder(self, note: Optional[str] = None) -> str:
        """Where new attachments go: the config file's `attachments_folder`,
        else "Attachments". "/" means the top of the notes folder, and "./" or
        "./sub" mean next to the note (or a folder beside it).
        """
        setting = DEFAULT_ATTACHMENTS if self.attachments_setting is None else str(self.attachments_setting)
        if setting.startswith("./"):
            base = posixpath.dirname(note) if note else ""
            folder = posixpath.normpath(posixpath.join(base, setting[2:])) if setting[2:] else base
        else:
            folder = setting.strip("/")
        return "" if folder in (".", "") else folder

    def add_file(self, name: str, stream, length: int, note: Optional[str] = None,
                 folder: Optional[str] = None) -> Attachment:
        """Save an uploaded file, next to others of its kind, under a free name."""
        name = posixpath.basename(name.replace("\\", "/")).strip() or "file"
        name = "".join("-" if ch in _BAD_NAME_CHARS else ch for ch in name).lstrip(".") or "file"
        if name.lower().endswith(NOTE_EXT):
            raise VaultError("Notes are created, not uploaded.")
        folder = self.attachments_folder(note) if folder is None else folder.strip("/")
        stem, ext = posixpath.splitext(name)
        with self._lock:
            n = 0
            while True:
                candidate = f"{stem}{f' {n}' if n else ''}{ext}"
                rel = f"{folder}/{candidate}" if folder else candidate
                full = self._abs(rel)
                if not os.path.exists(full):
                    break
                n += 1
            os.makedirs(os.path.dirname(full), exist_ok=True)
            fd, tmp = tempfile.mkstemp(prefix=".ory-", suffix=".tmp", dir=os.path.dirname(full))
            try:
                with os.fdopen(fd, "wb") as fh:
                    remaining = length
                    while remaining > 0:
                        chunk = stream.read(min(1 << 16, remaining))
                        if not chunk:
                            raise VaultError("The upload was cut short.")
                        fh.write(chunk)
                        remaining -= len(chunk)
                os.chmod(tmp, 0o644)
                os.replace(tmp, full)
            except BaseException:
                if os.path.exists(tmp):
                    os.unlink(tmp)
                raise
            self.refresh()
            return self._files[rel]

    def file_path(self, rel: str) -> str:
        """The absolute path of an attachment, for serving it."""
        full = self._abs(rel)
        if any(part.startswith(".") for part in rel.split("/")) or not os.path.isfile(full):
            raise VaultError(f"'{rel}' does not exist.", 404)
        return full

    def trash(self, rel: str) -> str:
        """Move a note or folder into `.trash/`, as Obsidian does."""
        full = self._abs(rel)
        with self._lock:
            if not os.path.exists(full):
                raise VaultError(f"'{rel}' does not exist.", 404)
            trash_root = os.path.join(self.root, TRASH_DIR)
            dest = os.path.join(trash_root, os.path.basename(full))
            stem, ext = os.path.splitext(dest)
            n = 1
            while os.path.exists(dest):
                dest = f"{stem} {n}{ext}"
                n += 1
            os.makedirs(trash_root, exist_ok=True)
            shutil.move(full, dest)
            self.refresh()
            return os.path.relpath(dest, self.root).replace(os.sep, "/")

    def move(self, src: str, dest: str) -> Dict[str, Any]:
        """Rename or move a note or folder and update links that point into it."""
        src_full = self._abs(src)
        with self._lock:
            self.refresh()
            is_note = src in self._notes
            is_file = src in self._files
            if not is_note and not is_file and not os.path.isdir(src_full):
                raise VaultError(f"'{src}' does not exist.", 404)
            dest = self.check_name(dest)
            if is_note:
                dest = self._note_path(dest)
            dest_full = self._abs(dest)
            if dest == src:
                return {"path": dest, "updated": []}
            if os.path.exists(dest_full) and not os.path.samefile(src_full, dest_full):
                raise VaultError(f"'{dest}' already exists.", 409)
            if not is_note and not is_file and (dest + "/").startswith(src + "/"):
                raise VaultError("A folder cannot be moved into itself.")

            # Record what every link resolves to before anything moves.
            if is_note or is_file:
                mapping = {src: dest}
            else:
                inside = list(self._notes) + list(self._files)
                mapping = {p: dest + p[len(src):] for p in inside if p.startswith(src + "/")}
            before = {
                path: [(link, self.resolve(link.target, path)) for link in note.links]
                for path, note in self._notes.items()
            }

            os.makedirs(os.path.dirname(dest_full), exist_ok=True)
            os.rename(src_full, dest_full)
            self.refresh()

            updated = []
            for old_source, resolved_links in before.items():
                source = mapping.get(old_source, old_source)
                edits = []
                for link, old_target in resolved_links:
                    # Rewrite a link if it no longer lands where it did, either
                    # because its target moved or because its source did.
                    new_target = mapping.get(old_target, old_target) if old_target else None
                    if new_target and self.resolve(link.target, source) != new_target:
                        edits.append((link.start, link.end, self.link_text_for(new_target, source)))
                if edits and source in self._notes:
                    text = self._notes[source].text
                    for start, end, replacement in sorted(edits, reverse=True):
                        text = text[:start] + replacement + text[end:]
                    _atomic_write(self._abs(source), text)
                    updated.append(source)
            if updated:
                self.refresh()
            return {"path": dest, "updated": sorted(updated)}

    # Backlinks and search ---------------------------------------------------

    def backlinks(self, rel: str) -> List[Dict[str, Any]]:
        with self._lock:
            self.refresh()
            results = []
            for source, note in sorted(self._notes.items(), key=lambda item: item[0].lower()):
                if source == rel:
                    continue
                lines = sorted({l.line for l in note.links if self.resolve(l.target, source) == rel})
                if lines:
                    results.append({
                        "path": source,
                        "name": note.name,
                        "lines": [{"line": n, "text": markdown.line_at(note.text, n).strip()} for n in lines],
                    })
            return results

    def search(self, query: str, limit: int = 50) -> List[Dict[str, Any]]:
        terms = [t.lower() for t in _split_query(query)]
        if not terms:
            return []
        with self._lock:
            self.refresh()
            results = []
            for note in self._notes.values():
                haystack = note.text.lower()
                name = note.name.lower()
                if not all(t in haystack or t in name for t in terms):
                    continue
                score = sum(10 for t in terms if t in name) + sum(haystack.count(t) for t in terms)
                results.append((score, note))
            results.sort(key=lambda item: (-item[0], item[1].path.lower()))
            return [
                {"path": note.path, "name": note.name, "matches": _snippets(note.text, terms)}
                for _, note in results[:limit]
            ]


def resolve_link(target: str, source: Optional[str], paths: Iterable[str],
                 by_name: Dict[str, List[str]], files: Iterable[str] = (),
                 by_file: Optional[Dict[str, List[str]]] = None) -> Optional[str]:
    # "chart.png" or "Specs/part.pdf" may be a file; if none matches, it can
    # still be a note whose name ends in something like ".2".
    stripped = target.strip().replace("\\", "/")
    if _FILE_EXT.search(stripped) and not stripped.lower().endswith(NOTE_EXT):
        found = _resolve(stripped, source, list(files), by_file or {}, "")
        if found:
            return found
    return _resolve(target, source, paths, by_name, NOTE_EXT)


def _resolve(target: str, source: Optional[str], paths: Iterable[str],
             by_name: Dict[str, List[str]], ext: str) -> Optional[str]:
    # JavaScript's trim() also drops a byte-order mark; match it.
    target = target.strip().strip("\ufeff").strip().replace("\\", "/")
    if ext and target.lower().endswith(ext):
        target = target[: -len(ext)]
    if not target:
        return None
    source_dir = posixpath.dirname(source) if source else ""

    if target.startswith("./") or target.startswith("../"):
        joined = posixpath.normpath(posixpath.join(source_dir, target))
        wanted = (joined + ext).lower()
        return next((p for p in paths if p.lower() == wanted), None)

    target = target.lstrip("/")
    if "/" in target:
        wanted = (target + ext).lower()
        exact = [p for p in paths if p.lower() == wanted]
        if exact:
            return exact[0]
        suffix = [p for p in paths if p.lower().endswith("/" + wanted)]
        return min(suffix, key=lambda p: (len(p), p.lower())) if suffix else None

    candidates = by_name.get(target.lower(), [])
    if not candidates:
        return None
    return min(candidates, key=lambda p: (posixpath.dirname(p) != source_dir, len(p), p.lower()))


def _split_query(query: str) -> List[str]:
    return [a or b for a, b in re.findall(r'"([^"]+)"|(\S+)', query or "")]


def _snippets(text: str, terms: List[str], max_lines: int = 3, width: int = 160) -> List[Dict[str, Any]]:
    out = []
    for line_no, line in enumerate(markdown.lines_of(text)):
        lowered = line.lower()
        hits = [(lowered.find(t), t) for t in terms if t in lowered]
        if not hits:
            continue
        first = min(pos for pos, _ in hits)
        start = max(0, first - width // 3)
        if start:
            # Start at a word boundary so the snippet does not open mid-word.
            space = line.find(" ", start)
            start = space + 1 if 0 <= space < first else start
        snippet = line[start:start + width]
        ranges = []
        low_snippet = snippet.lower()
        for t in terms:
            pos = low_snippet.find(t)
            while pos != -1:
                ranges.append([pos, pos + len(t)])
                pos = low_snippet.find(t, pos + len(t))
        out.append({
            "line": line_no,
            "text": snippet,
            "cutStart": start > 0,
            "cutEnd": start + width < len(line),
            "ranges": sorted(ranges),
        })
        if len(out) >= max_lines:
            break
    return out


def _atomic_write(full: str, text: str) -> None:
    directory = os.path.dirname(full)
    fd, tmp = tempfile.mkstemp(prefix=".ory-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        if os.path.exists(full):
            shutil.copymode(full, tmp)
        else:
            os.chmod(tmp, 0o644)
        os.replace(tmp, full)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
