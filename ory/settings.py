"""Settings: what the app's Settings window reads and changes.

Folder settings live in `ory.config.json` beside the code (one per machine;
gitignored), and apply at once: switching the notes folder swaps the vault
the server serves, without a restart. Appearance settings are per browser and
never reach the server. The AI section reports whether Claude Code and Claude
Desktop can reach Ory's MCP server, and can add it to Claude Desktop.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from typing import Any, Dict, Optional

from . import config as config_mod
from .guide import REPO_ROOT, remove_guides, write_guides
from .vault import Vault, VaultError

PROMPT_SIZES = (30000, 60000, 150000)


class State:
    """What the running server serves: the settings and the vault they point at."""

    def __init__(self, cfg: config_mod.Config, vault: Vault):
        self.config = cfg
        self.vault = vault


def mcp_entry() -> Dict[str, Any]:
    """How an app starts Ory's MCP server on this machine. No notes folder is
    given, so it follows ory.config.json when the folder changes."""
    return {"command": _python(), "args": ["-m", "ory", "mcp"], "env": {"PYTHONPATH": REPO_ROOT}}


def _python() -> str:
    """A Python path that survives upgrades (Homebrew's python3, not python3.14's own)."""
    found = shutil.which("python3")
    return found if found and os.path.realpath(found) == os.path.realpath(sys.executable) else sys.executable


def desktop_running() -> bool:
    """Claude Desktop rewrites its settings file while it runs, dropping anything
    added meanwhile, so Ory is only added while it is closed."""
    if sys.platform == "darwin":
        try:
            out = subprocess.run(["ps", "-axo", "comm"], capture_output=True, text=True).stdout
            return any(line.strip().endswith("/Claude.app/Contents/MacOS/Claude") for line in out.splitlines())
        except OSError:
            return False
    if sys.platform == "win32":
        try:
            out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Claude.exe"], capture_output=True, text=True).stdout
            return "Claude.exe" in out
        except OSError:
            return False
    return False


def _desktop_config() -> Optional[str]:
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/Claude/claude_desktop_config.json")
    if sys.platform == "win32" and os.environ.get("APPDATA"):
        return os.path.join(os.environ["APPDATA"], "Claude", "claude_desktop_config.json")
    return os.path.expanduser("~/.config/Claude/claude_desktop_config.json")


def _read_json(path: Optional[str]) -> Optional[Dict[str, Any]]:
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def mcp_status() -> Dict[str, Any]:
    desktop_path = _desktop_config()
    desktop = _read_json(desktop_path)
    code = _read_json(os.path.expanduser("~/.claude.json"))
    entry = mcp_entry()
    command = " ".join([
        "claude mcp add ory --scope user",
        f"-e PYTHONPATH={_quote(REPO_ROOT)}",
        "--", _quote(_python()), "-m ory mcp",
    ])
    return {
        "desktop": {
            "installed": bool(desktop_path and os.path.isdir(os.path.dirname(desktop_path))),
            "connected": bool(desktop and "ory" in (desktop.get("mcpServers") or {})),
            "running": desktop_running(),
            "configPath": desktop_path,
        },
        "code": {
            "connected": bool(code and "ory" in (code.get("mcpServers") or {})),
            "command": command,
        },
        "entry": entry,
        "desktopCommand": f"cd {_quote(REPO_ROOT)} && {_quote(_python())} -m ory connect-desktop",
    }


def _quote(text: str) -> str:
    return f'"{text}"' if any(ch in text for ch in " '\"$") else text


def connect_desktop() -> Dict[str, Any]:
    """Add Ory to Claude Desktop's MCP servers, keeping a backup of its settings."""
    path = _desktop_config()
    if not path or not os.path.isdir(os.path.dirname(path)):
        raise VaultError("Claude Desktop doesn't seem to be installed on this computer.", 404)
    if desktop_running():
        raise VaultError("Quit Claude Desktop first: while it's open it rewrites its settings and would drop Ory. "
                         "Then connect, and open it again.", 409)
    data = _read_json(path) if os.path.exists(path) else {}
    if data is None:
        raise VaultError("Claude Desktop's settings file couldn't be read, so it was left alone.", 409)
    if os.path.exists(path):
        shutil.copy2(path, path + ".before-ory")
    data.setdefault("mcpServers", {})["ory"] = mcp_entry()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)
    return mcp_status()


def current(state: State) -> Dict[str, Any]:
    cfg = state.config
    return {
        "notesDir": state.vault.root,
        "dailyFolder": state.vault.daily_folder,
        "attachmentsFolder": cfg.attachments_folder if cfg.attachments_folder is not None else "Attachments",
        "wikisFolder": state.vault.wikis_folder,
        "guides": cfg.guides,
        "promptBudget": cfg.prompt_budget,
        "promptSizes": list(PROMPT_SIZES),
        "configPath": cfg.config_path,
        "notesFromFlag": cfg.notes_from_flag,
        "mcp": mcp_status(),
    }


def _folder(value: Any, label: str) -> str:
    text = str(value).strip().strip("/")
    if any(part in ("", ".", "..") or part.startswith(".") for part in text.split("/")) and text not in ("",):
        raise VaultError(f"{label} must be a folder inside the notes folder, not starting with a dot.")
    return text


def update(state: State, body: Dict[str, Any]) -> Dict[str, Any]:
    """Apply changed settings, save them to ory.config.json, and return them."""
    cfg = state.config
    vault = state.vault
    if "notesDir" in body:
        notes = os.path.normpath(os.path.expanduser(str(body["notesDir"]).strip()))
        if not os.path.isabs(notes):
            raise VaultError("Give the notes folder's full path, like /Users/you/Notes.")
        if not os.path.isdir(notes):
            raise VaultError(f"There is no folder at {notes}.", 404)
        cfg.notes_dir = notes
        cfg.notes_from_flag = False
    if "dailyFolder" in body:
        cfg.daily_folder = _folder(body["dailyFolder"], "The daily notes folder")
    if "attachmentsFolder" in body:
        value = str(body["attachmentsFolder"]).strip()
        if value not in ("/", "./") and not value.startswith("./"):
            _folder(value, "The attachments folder")
        cfg.attachments_folder = value or "Attachments"
    if "wikisFolder" in body:
        cfg.wikis_folder = _folder(body["wikisFolder"], "The wikis folder") or "Wikis"
    if "guides" in body:
        cfg.guides = bool(body["guides"])
    if "promptBudget" in body:
        size = int(body["promptBudget"])
        if not 5000 <= size <= 1000000:
            raise VaultError("The prompt size should be between 5,000 and 1,000,000 characters.")
        cfg.prompt_budget = size
    config_mod.save(cfg)

    if os.path.realpath(cfg.notes_dir) != vault.root:
        vault = Vault(cfg.notes_dir, daily_folder=cfg.daily_folder,
                      attachments_folder=cfg.attachments_folder, wikis_folder=cfg.wikis_folder)
        vault.refresh()
        state.vault = vault
    else:
        vault.daily_folder = cfg.daily_folder.strip("/")
        vault.attachments_setting = cfg.attachments_folder
        vault.wikis_folder = cfg.wikis_folder.strip("/") or "Wikis"
        vault.version += 1  # the app reloads its index with the new names
    if cfg.guides:
        write_guides(vault)
    else:
        remove_guides(vault)
    return current(state)
