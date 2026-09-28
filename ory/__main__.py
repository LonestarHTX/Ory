"""Entry point: `python3 -m ory` runs the app; `python3 -m ory COMMAND` runs
one of the commands for agents and scripts (cli.py)."""

from __future__ import annotations

import sys
import webbrowser

from . import cli, config
from .guide import write_guides
from .server import make_server
from .vault import Vault


def main() -> int:
    if sys.version_info < (3, 8):
        print("Ory needs Python 3.8 or newer.", file=sys.stderr)
        return 1
    try:
        cfg = config.load()
    except config.ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1

    vault = Vault(
        cfg.notes_dir,
        daily_folder=cfg.daily_folder,
        attachments_folder=cfg.attachments_folder,
        wikis_folder=cfg.wikis_folder,
    )
    vault.refresh()
    if cfg.command:
        return cli.run(vault, cfg.command)

    if cfg.guides:
        write_guides(vault)
    try:
        server = make_server(vault, cfg.port, cfg)
    except OSError as exc:
        print(f"Could not listen on port {cfg.port}: {exc.strerror}. Try --port 4748.", file=sys.stderr)
        return 1

    url = f"http://127.0.0.1:{cfg.port}"
    print(f"Ory  {url}")
    print(f"Notes  {vault.root}  ({len(vault.listing()['notes'])} notes)")
    print("Press Ctrl+C to stop.")
    if cfg.open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
