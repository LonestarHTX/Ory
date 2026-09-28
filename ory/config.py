"""Settings: defaults, then `ory.config.json`, then command-line flags."""

from __future__ import annotations

import argparse
import json
import os
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
    open_browser: bool = False
    command: List[str] = field(default_factory=list)  # e.g. ["read", "Welcome"]; empty runs the app


class ConfigError(Exception):
    pass


def load(argv: Optional[List[str]] = None) -> Config:
    parser = argparse.ArgumentParser(
        prog="python3 -m ory",
        description="Run Ory on localhost, or run one of its commands (python3 -m ory help).",
    )
    parser.add_argument("--notes", help="notes folder to open (overrides notes_dir in the config file)")
    parser.add_argument("--port", type=int, help="port to serve on (default 4747)")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="config file (default ory.config.json in the repo)")
    parser.add_argument("--open", action="store_true", help="open Ory in the default browser")
    # Anything after the options is a command for agents and scripts (cli.py).
    args, command = parser.parse_known_args(argv)

    data = {}
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
        open_browser=args.open,
        command=command,
    )
