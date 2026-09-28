"""Ory's commands, for AI agents and scripts: `python3 -m ory [options] COMMAND`.

Every command prints JSON on stdout. Errors print {"error": ...} and exit 1.
The operations themselves are in agent.py; `mcp` serves them over MCP.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, List

from .agent import Agent
from .guide import agents_md
from .vault import Vault, VaultError

USAGE = """Commands (every one prints JSON):
  index                        every note and file
  wikis                        each wiki and its pages
  read PATH                    a note's text, properties, links and rev
  search QUERY...              notes containing every word
  backlinks PATH               notes that link to PATH
  write PATH [--rev REV]       create or replace a note with the text on stdin
  append PATH                  add the text on stdin to the end of a note
  daily [--date YYYY-MM-DD]    today's daily note, creating it
  move FROM TO                 rename or move, rewriting links
  trash PATH                   move to .trash/
  unread                       notes changed since suggestions last read them
  suggestions                  findings and drafts waiting for review
  suggest                      file suggestions: JSON on stdin
  guide                        print the guide for agents (AGENTS.md)
  mcp                          serve these as tools over MCP (stdio)
"""


def run(vault: Vault, argv: List[str]) -> int:
    if not argv or argv[0] in ("help", "-h", "--help"):
        print(USAGE)
        return 0
    name, rest = argv[0], argv[1:]
    if name == "mcp":
        from .mcp import serve
        return serve(vault)
    if name == "guide":
        print(agents_md(vault))
        return 0
    agent = Agent(vault)
    try:
        result = dispatch(agent, name, rest)
    except VaultError as exc:
        return fail(str(exc))
    except (ValueError, KeyError, TypeError) as exc:
        return fail(f"Bad input: {exc}")
    except SystemExit as exc:  # argparse on a bad command line
        return int(exc.code or 0) or 2
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    return 0


def dispatch(agent: Agent, name: str, rest: List[str]) -> Any:
    def parser(*positional: str, **options: str) -> argparse.Namespace:
        p = argparse.ArgumentParser(prog=f"python3 -m ory {name}")
        for arg in positional:
            p.add_argument(arg, nargs="+" if arg == "query" else None)
        for opt, help_text in options.items():
            p.add_argument(f"--{opt}", help=help_text)
        return p.parse_args(rest)

    if name == "index":
        return agent.index()
    if name == "wikis":
        return agent.wikis()
    if name == "read":
        return agent.read(parser("path").path)
    if name == "search":
        return agent.search(" ".join(parser("query").query))
    if name == "backlinks":
        return agent.backlinks(parser("path").path)
    if name == "write":
        args = parser("path", rev="refuse if the note changed since this rev")
        return agent.write(args.path, sys.stdin.read(), args.rev)
    if name == "append":
        return agent.append(parser("path").path, sys.stdin.read())
    if name == "daily":
        return agent.daily(parser(date="YYYY-MM-DD").date)
    if name == "move":
        args = parser("source", "dest")
        return agent.move(args.source, args.dest)
    if name == "trash":
        return agent.trash(parser("path").path)
    if name == "unread":
        return agent.unread()
    if name == "suggestions":
        return agent.suggestions()
    if name == "suggest":
        data = json.loads(sys.stdin.read() or "{}")
        return agent.suggest(data.get("findings"), data.get("drafts"), data.get("read"))
    raise VaultError(f"Unknown command {name!r}. Run: python3 -m ory help")


def fail(message: str) -> int:
    print(json.dumps({"error": message}))
    return 1
