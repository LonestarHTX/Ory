"""Settings: defaults, then `ory.config.json`, then command-line flags."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import List, Optional

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CONFIG = os.path.join(REPO_ROOT, "ory.config.json")


@dataclass
class Config:
    notes_dir: str
    port: int = 4747
    daily_folder: str = "Daily"
    attachments_folder: Optional[str] = None  # None means "Attachments"
    wikis_folder: str = "Wikis"
    guides: bool = True  # keep AGENTS.md and CLAUDE.md in the notes folder (guide.py)
    prompt_budget: int = 60000  # characters per Suggestions prompt, for pasting into a chat
    open_browser: bool = False
    config_path: str = DEFAULT_CONFIG
    notes_from_flag: bool = False  # --notes was given, so the file's notes_dir is not in use
    command: List[str] = field(default_factory=list)  # e.g. ["read", "Welcome"]; empty runs the app


class ConfigError(Exception):
    pass


def load(argv: Optional[List[str]] = None) -> Config:
    parser = argparse.ArgumentParser(
        prog="python3 -m ory",
        description="Run Ory on localhost, or run one of its commands (python3 -m ory help).",
        allow_abbrev=False,
    )
    parser.add_argument("--notes", help="notes folder to open (overrides notes_dir in the config file)")
    parser.add_argument("--port", type=int, help="port to serve on (default 4747)")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="config file (default ory.config.json in the repo)")
    parser.add_argument("--open", action="store_true", help="open Ory in the default browser")
    # Options come first; from the first word that isn't one, the rest is a
    # command for agents and scripts (cli.py), with its own options.
    argv = list(sys.argv[1:] if argv is None else argv)
    split = len(argv)
    i = 0
    while i < len(argv):
        token = argv[i]
        if token in ("--notes", "--port", "--config"):
            i += 2
        elif token.split("=", 1)[0] in ("--notes", "--port", "--config") or token in ("--open", "-h", "--help"):
            i += 1
        else:
            split = i
            break
    args = parser.parse_args(argv[:split])
    command = argv[split:]

    data = {}
    if args.config != DEFAULT_CONFIG and not os.path.exists(args.config):
        raise ConfigError(f"The config file does not exist: {args.config}")
    if os.path.exists(args.config):
        try:
            with open(args.config, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as exc:
            raise ConfigError(f"Could not read {args.config}: {exc}")
    config_dir = os.path.dirname(os.path.abspath(args.config))

    notes_dir = args.notes or data.get("notes_dir")
    if not notes_dir:
        raise ConfigError(
            "No notes folder is set.\n"
            "  Run:  python3 -m ory --notes ~/path/to/notes\n"
            "  Or copy ory.config.example.json to ory.config.json and set notes_dir."
        )
    notes_dir = os.path.expanduser(notes_dir)
    if not os.path.isabs(notes_dir):
        base = os.getcwd() if args.notes else config_dir
        notes_dir = os.path.join(base, notes_dir)
    notes_dir = os.path.normpath(notes_dir)
    if not os.path.isdir(notes_dir):
        raise ConfigError(f"The notes folder does not exist: {notes_dir}")

    return Config(
        notes_dir=notes_dir,
        port=args.port or int(data.get("port", 4747)),
        daily_folder=str(data.get("daily_folder", "Daily")),
        attachments_folder=data.get("attachments_folder"),
        wikis_folder=str(data.get("wikis_folder", "Wikis")),
        guides=bool(data.get("guides", True)),
        prompt_budget=int(data.get("prompt_budget", 60000)),
        open_browser=args.open,
        command=command,
        config_path=os.path.abspath(args.config),
        notes_from_flag=bool(args.notes),
    )


def save(cfg: Config) -> None:
    """Write the settings the Settings screen changes back to the config file,
    keeping anything else in it."""
    data: dict = {}
    if os.path.exists(cfg.config_path):
        try:
            with open(cfg.config_path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            data = {}
    if not cfg.notes_from_flag:
        data["notes_dir"] = cfg.notes_dir
    data["daily_folder"] = cfg.daily_folder
    data["attachments_folder"] = cfg.attachments_folder if cfg.attachments_folder is not None else "Attachments"
    data["wikis_folder"] = cfg.wikis_folder
    data["guides"] = cfg.guides
    data["prompt_budget"] = cfg.prompt_budget
    tmp = cfg.config_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, cfg.config_path)
