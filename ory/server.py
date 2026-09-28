"""Local HTTP server: the built web UI plus a small JSON API over the vault."""

from __future__ import annotations

import json
import mimetypes
import os
import posixpath
import shutil
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

from .vault import Note, Vault, VaultError

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]")
MAX_BODY = 20 * 1024 * 1024
MAX_UPLOAD = 200 * 1024 * 1024
# Files shown in the browser; anything else downloads.
INLINE_TYPES = ("image/", "video/", "audio/", "application/pdf", "text/plain")


def note_json(note: Note) -> Dict[str, Any]:
    return {"path": note.path, "name": note.name, "text": note.text, "rev": note.rev, "mtime": note.mtime}


def page_policy(host: str) -> str:
    """The rules an HTML page from the notes folder runs under.

    Its scripts run, in a sandbox with no origin of its own, so it cannot
    reach Ory's page, the API or other notes. It may load files that sit
    beside it in the notes folder, but nothing from the network, and it
    cannot send data anywhere.
    """
    here = f"http://{host}" if host else "'self'"
    return "; ".join([
        "sandbox allow-scripts allow-downloads allow-popups allow-modals",
        "default-src 'none'",
        f"script-src 'unsafe-inline' 'unsafe-eval' {here}",
        f"style-src 'unsafe-inline' {here}",
        f"img-src {here} data: blob:",
        f"font-src {here} data:",
        f"media-src {here} data: blob:",
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
    ])


class Handler(BaseHTTPRequestHandler):
    vault: Vault  # set by make_server
    server_version = "Ory"

    # Routing ----------------------------------------------------------------

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def do_PUT(self) -> None:
        self._dispatch("PUT")

    def _dispatch(self, method: str) -> None:
        if not self._host_allowed():
            self._send_json({"error": "Ory only answers on localhost."}, HTTPStatus.FORBIDDEN)
            return
        url = urlparse(self.path)
        if method == "GET" and url.path.startswith("/files/"):
            self._send_vault_file(unquote(url.path[len("/files/"):]))
            return
        if not url.path.startswith("/api/"):
            if method == "GET":
                self._send_static(url.path)
            else:
                self._send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
            return
        if method == "POST" and url.path == "/api/files":
            self._receive_upload({k: v[0] for k, v in parse_qs(url.query).items()})
            return
        if method != "GET" and not self._same_origin_json():
            self._send_json({"error": "Requests must come from the Ory page as JSON."}, HTTPStatus.FORBIDDEN)
            return
        route: Optional[Callable[..., Tuple[Any, int]]] = ROUTES.get((method, url.path))
        if not route:
            self._send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
            return
        try:
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            body = self._read_json() if method != "GET" else {}
            payload, status = route(self.vault, query, body)
        except VaultError as exc:
            self._send_json({"error": str(exc)}, exc.status)
            return
        except (ValueError, KeyError, TypeError) as exc:
            self._send_json({"error": f"Bad request: {exc}"}, HTTPStatus.BAD_REQUEST)
            return
        except OSError as exc:
            self._send_json({"error": f"File system error: {exc.strerror or exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        self._send_json(payload, status)

    # Guards -----------------------------------------------------------------
    # The server can write files, so it refuses requests that did not come from
    # its own page: a foreign Host header (DNS rebinding) or a foreign Origin.

    def _host_allowed(self) -> bool:
        host = self.headers.get("Host") or ""
        name = host.split("]")[0] + "]" if host.startswith("[") else host.rsplit(":", 1)[0]
        return name in LOCAL_HOSTS

    def _same_origin_json(self) -> bool:
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin == f"http://{self.headers.get('Host')}"

    # Attachments --------------------------------------------------------------

    def _receive_upload(self, query: Dict[str, str]) -> None:
        """A file pasted or dropped into a note. The body is the raw bytes.

        The custom header makes the browser ask permission (a CORS preflight)
        before any other site could send one, and this server never grants it.
        """
        origin = self.headers.get("Origin")
        if self.headers.get("X-Ory-Upload") != "1" or (origin and origin != f"http://{self.headers.get('Host')}"):
            self._send_json({"error": "Uploads must come from the Ory page."}, HTTPStatus.FORBIDDEN)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_UPLOAD:
                raise VaultError("Files over 200 MB are not accepted.", 413)
            attachment = self.vault.add_file(query.get("name", "file"), self.rfile, length,
                                             note=query.get("note"), folder=query.get("folder"))
        except VaultError as exc:
            self._send_json({"error": str(exc)}, exc.status)
            return
        except OSError as exc:
            self._send_json({"error": f"File system error: {exc.strerror or exc}"}, 500)
            return
        self._send_json({"path": attachment.path, "name": attachment.name, "size": attachment.size}, 201)

    def _send_vault_file(self, rel: str) -> None:
        """Serve an attachment. It runs sandboxed: a file in the notes folder can
        never script this page or reach the API."""
        try:
            full = self.vault.file_path(rel)
        except VaultError as exc:
            self._send_json({"error": str(exc)}, exc.status)
            return
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        size = os.path.getsize(full)
        is_page = ctype == "text/html"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if is_page else ""))
        self.send_header("Content-Length", str(size))
        if is_page:
            self.send_header("Content-Security-Policy", page_policy(self.headers.get("Host") or ""))
        elif ctype != "application/pdf":
            # Chrome will not open its PDF viewer in a sandboxed document; a PDF
            # cannot script this page either way.
            self.send_header("Content-Security-Policy",
                             "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        if not is_page and (not ctype.startswith(INLINE_TYPES) or ctype == "image/svg+xml"):
            name = os.path.basename(full).replace('"', "")
            self.send_header("Content-Disposition", f'attachment; filename="{name}"')
        self.end_headers()
        with open(full, "rb") as fh:
            shutil.copyfileobj(fh, self.wfile)

    # IO ---------------------------------------------------------------------

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise VaultError("That note is too large.", 413)
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("expected a JSON object")
        return data

    def _send_json(self, payload: Any, status: int) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, path: str) -> None:
        rel = posixpath.normpath(path).lstrip("/")
        if rel in ("", "."):
            rel = "index.html"
        full = os.path.realpath(os.path.join(STATIC_DIR, rel))
        if os.path.commonpath([full, STATIC_DIR]) != STATIC_DIR or not os.path.isfile(full):
            # Unknown paths get the app, so reloads on any route still work.
            full = os.path.join(STATIC_DIR, "index.html")
        if not os.path.isfile(full):
            self._send_json({"error": "The web bundle is missing. Run npm run build in web/."}, 500)
            return
        with open(full, "rb") as fh:
            body = fh.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
        # Quiet by default; errors still reach stderr through log_error.
        pass


# Routes ---------------------------------------------------------------------
# Each takes (vault, query, body) and returns (payload, status).

def _index(v: Vault, q, b):
    return v.listing(), 200


def _version(v: Vault, q, b):
    # The suggestions file changes when an agent files suggestions (agent.py).
    return {"version": v.refresh(), "suggestions": v.suggestions_rev()}, 200


def _get_note(v: Vault, q, b):
    return note_json(v.get(q["path"])), 200


def _save_note(v: Vault, q, b):
    try:
        note = v.save(b["path"], b["text"], b.get("rev"))
    except VaultError as exc:
        if exc.status != 409:
            raise
        current = v.get(b["path"])
        return {"error": str(exc), "current": note_json(current)}, 409
    return {"rev": note.rev, "mtime": note.mtime}, 200


def _create_note(v: Vault, q, b):
    return note_json(v.create(b["path"], b.get("text", ""))), 201


def _create_folder(v: Vault, q, b):
    return {"path": v.create_folder(b["path"])}, 201


def _move(v: Vault, q, b):
    return v.move(b["from"], b["to"]), 200


def _trash(v: Vault, q, b):
    return {"trashed": v.trash(b["path"])}, 200


def _daily(v: Vault, q, b):
    note, created = v.daily(b["date"])
    return {"path": note.path, "created": created}, 200


def _backlinks(v: Vault, q, b):
    return {"backlinks": v.backlinks(q["path"])}, 200


def _search(v: Vault, q, b):
    return {"results": v.search(q.get("q", ""))}, 200


def _read_many(v: Vault, q, b):
    paths = b["paths"]
    if not isinstance(paths, list):
        raise TypeError("paths must be a list")
    return {"notes": v.read_many(paths)}, 200


def _get_suggestions(v: Vault, q, b):
    return v.suggestions(), 200


def _save_suggestions(v: Vault, q, b):
    return v.save_suggestions(b["data"], b.get("rev")), 200


ROUTES: Dict[Tuple[str, str], Callable[..., Tuple[Any, int]]] = {
    ("GET", "/api/index"): _index,
    ("GET", "/api/version"): _version,
    ("GET", "/api/note"): _get_note,
    ("PUT", "/api/note"): _save_note,
    ("POST", "/api/notes"): _create_note,
    ("POST", "/api/folders"): _create_folder,
    ("POST", "/api/move"): _move,
    ("POST", "/api/trash"): _trash,
    ("POST", "/api/daily"): _daily,
    ("GET", "/api/backlinks"): _backlinks,
    ("GET", "/api/search"): _search,
    ("POST", "/api/read"): _read_many,
    ("GET", "/api/suggestions"): _get_suggestions,
    ("PUT", "/api/suggestions"): _save_suggestions,
}


def make_server(vault: Vault, port: int) -> ThreadingHTTPServer:
    handler = type("OryHandler", (Handler,), {"vault": vault})
    return ThreadingHTTPServer(("127.0.0.1", port), handler)
