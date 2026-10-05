"""An MCP server over stdio, standard library only: `python3 -m ory mcp`.

AI apps that speak the Model Context Protocol (Claude Desktop, Claude Code
and others) get Ory's operations (agent.py) as tools, and the guide for
agents (guide.py) as the server's instructions. Messages are JSON-RPC 2.0,
one per line; stdout carries nothing else.
"""

from __future__ import annotations

import io
import json
import sys
from typing import Any, Callable, Dict, Optional

from .agent import FINDING_KINDS, Agent
from .guide import agents_md
from .vault import Vault, VaultError

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
VERSION = "1.0"

_path = {"type": "string", "description": "A note's path in the notes folder, like \"Daily/2026-09-27.md\" (\".md\" may be left off)."}


def _obj(properties: Dict[str, Any], required: tuple = ()) -> Dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


_finding = _obj({
    "kind": {"type": "string", "enum": list(FINDING_KINDS),
             "description": "page: a new page; add: something a page should say; conflict: a note disagrees with a page; link: one page should point to another; wiki: a new wiki; fix: something wrong or stale."},
    "wiki": {"type": "string"},
    "page": {"type": "string"},
    "section": {"type": "string"},
    "title": {"type": "string", "description": "A short claim, readable on its own."},
    "why": {"type": "string", "description": "One or two sentences on what the notes show."},
    "sources": {"type": "array", "items": {"type": "string"}, "description": "Paths of the notes it comes from."},
}, ("kind", "title"))

_draft = _obj({
    "path": {"type": "string", "description": "The page's path inside a wiki."},
    "text": {"type": "string", "description": "The whole page, properties first."},
    "changes": {"type": "array", "items": _obj({"section": {"type": "string"}, "reason": {"type": "string"}}),
                "description": "Each section changed and why."},
}, ("path", "text"))

# name: (description, input schema, call)
TOOLS: Dict[str, tuple] = {
    "list_notes": ("Every note (path, name, tags, properties, links) and file in the notes folder.",
                   _obj({}), lambda a, x: a.index()),
    "list_wikis": ("Each wiki, its pages and their one-line summaries.", _obj({}), lambda a, x: a.wikis()),
    "read_note": ("A note's full text, properties, resolved links and rev (for a safe write).",
                  _obj({"path": _path}, ("path",)), lambda a, x: a.read(x["path"])),
    "search_notes": ("Notes containing every word of the query (quote a phrase to match it exactly), with matching lines.",
                     _obj({"query": {"type": "string"}}, ("query",)), lambda a, x: a.search(x["query"])),
    "get_backlinks": ("Notes that link to a note, with the linking lines.",
                      _obj({"path": _path}, ("path",)), lambda a, x: a.backlinks(x["path"])),
    "write_note": ("Create a note, or replace one's whole text. Pass the rev from read_note to refuse if it changed meanwhile.",
                   _obj({"path": _path, "text": {"type": "string"}, "rev": {"type": "string"}}, ("path", "text")),
                   lambda a, x: a.write(x["path"], x["text"], x.get("rev"))),
    "append_to_note": ("Add text to the end of a note on a new line, creating the note if needed.",
                       _obj({"path": _path, "text": {"type": "string"}}, ("path", "text")),
                       lambda a, x: a.append(x["path"], x["text"])),
    "todays_note": ("The daily note for today (or a given date), creating it. Returns its path.",
                    _obj({"date": {"type": "string", "description": "YYYY-MM-DD; today if left out."}}),
                    lambda a, x: a.daily(x.get("date"))),
    "move_note": ("Rename or move a note or folder. Every link to it is rewritten.",
                  _obj({"from": {"type": "string"}, "to": {"type": "string"}}, ("from", "to")),
                  lambda a, x: a.move(x["from"], x["to"])),
    "archive_note": ("Archive a note, file or folder: it moves to .archive/, where the person can restore it.",
                     _obj({"path": {"type": "string"}}, ("path",)), lambda a, x: a.archive(x["path"])),
    "list_archive": ("What is in the archive: each item's id, where it came from, and when Ory deletes it.",
                     _obj({}), lambda a, x: a.archived()),
    "restore_from_archive": ("Put an archived item back where it came from. Takes an id from list_archive.",
                             _obj({"id": {"type": "string"}}, ("id",)), lambda a, x: a.restore(x["id"])),
    "unread_notes": ("Notes changed since suggestions last read them: what the wikis may not reflect yet.",
                     _obj({}), lambda a, x: a.unread()),
    "list_suggestions": ("Findings and drafts waiting for the person to review in Ory.",
                         _obj({}), lambda a, x: a.suggestions()),
    "suggest": ("File findings and page drafts for the person to review in Ory's Suggestions, and mark the notes you read.",
                _obj({"findings": {"type": "array", "items": _finding}, "drafts": {"type": "array", "items": _draft},
                      "read": {"type": "array", "items": {"type": "string"}, "description": "Paths of the notes you went through."}}),
                lambda a, x: a.suggest(x.get("findings"), x.get("drafts"), x.get("read"))),
}


def handle(agent: Agent, vault: Vault, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One JSON-RPC message in, its response out (None for notifications)."""
    method = message.get("method")
    msg_id = message.get("id")
    params = message.get("params") or {}
    if msg_id is None:
        return None  # notifications/initialized, cancellations: nothing to answer
    if not isinstance(method, str) or not isinstance(params, dict):
        return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32600, "message": "Invalid request"}}

    def result(value: Any) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": msg_id, "result": value}

    def error(code: int, text: str) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": text}}

    if method == "initialize":
        asked = params.get("protocolVersion")
        return result({
            "protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "ory", "version": VERSION},
            "instructions": agents_md(vault),
        })
    if method == "ping":
        return result({})
    if method == "tools/list":
        return result({"tools": [
            {"name": name, "description": desc, "inputSchema": schema} for name, (desc, schema, _) in TOOLS.items()
        ]})
    if method == "tools/call":
        name = params.get("name")
        if name not in TOOLS:
            return error(-32602, f"Unknown tool: {name}")
        call: Callable = TOOLS[name][2]
        arguments = params.get("arguments") or {}
        if not isinstance(arguments, dict):
            return result({"content": [{"type": "text", "text": "Arguments must be an object."}], "isError": True})
        try:
            value = call(agent, arguments)
        except KeyError as exc:
            return result({"content": [{"type": "text", "text": f"Missing argument: {exc}"}], "isError": True})
        except Exception as exc:  # a bad call is the caller's error, never the server's end
            text = exc.strerror if isinstance(exc, OSError) and exc.strerror else str(exc)
            return result({"content": [{"type": "text", "text": text or type(exc).__name__}], "isError": True})
        return result({"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False, default=str)}]})
    return error(-32601, f"Method not found: {method}")


def _safe(agent: Agent, vault: Vault, message: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(message, dict):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}
    try:
        return handle(agent, vault, message)
    except Exception as exc:  # keep serving whatever one message does
        return {"jsonrpc": "2.0", "id": message.get("id"), "error": {"code": -32603, "message": f"Internal error: {exc}"}}


def serve(vault: Vault, stdin=None, stdout=None) -> int:
    # JSON-RPC is UTF-8 whatever the console's code page.
    stdin = stdin or io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
    stdout = stdout or io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", newline="\n")
    agent = Agent(vault)
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        else:
            if isinstance(message, list) and not message:
                reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}
            else:
                batch = message if isinstance(message, list) else [message]
                replies = [r for r in (_safe(agent, vault, m) for m in batch) if r]
                if not replies:
                    continue
                reply = replies if isinstance(message, list) else replies[0]
        stdout.write(json.dumps(reply, ensure_ascii=False, default=str) + "\n")
        stdout.flush()
    return 0
