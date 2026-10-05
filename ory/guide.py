"""The guide for AI agents: `AGENTS.md` in the notes folder, and a `CLAUDE.md`
that points to it. Ory writes both and keeps them current, so any agent opened
in the folder knows how it is laid out, the conventions its notes follow, and
the commands that read and change it safely.

A file keeps Ory's marker on its first line while Ory owns it. Remove the
marker to keep your own version; Ory then leaves the file alone. The files sit
at the top of the notes folder and are left out of Ory's index.
"""

from __future__ import annotations

import os
import shlex
import sys

from .vault import Vault, _atomic_write

MARKER = "<!-- Written by Ory; kept up to date. Delete this line to keep your own version. -->"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def command_prefix(vault: Vault) -> str:
    """How to run Ory's commands against this notes folder, from anywhere."""
    python = "python3" if sys.platform != "win32" else "python"
    return f"PYTHONPATH={shlex.quote(REPO_ROOT)} {python} -m ory --notes {shlex.quote(vault.root)}"


def agents_md(vault: Vault) -> str:
    wikis = vault.wikis_folder
    daily = vault.daily_folder
    attachments = vault.attachments_folder() or "the top of the folder"
    ory = command_prefix(vault)
    days = vault.archive_days
    kept = f"for {days} days" if days else "until the person deletes them"
    deletes = f"which Ory deletes {days} days after they were archived" if days else "which Ory keeps until the person deletes them"
    return f"""{MARKER}
# Working in this notes folder

This folder belongs to Ory: plain Markdown files, written and read by a person in Ory and by AI agents like you. Everything is a file; there is no database. You may read and change anything here.

## Layout

- **Notes** are every `.md` file outside `{wikis}/`. They are where the person thinks: quick, dated, messy. Daily notes are `{daily}/YYYY-MM-DD.md`.
- **Wikis** are the folders inside `{wikis}/`, one folder per wiki. Their pages are written to be read later by someone new to the subject.
  - `Home.md` is a wiki's front page. Its `summary` property is the wiki's one-line description, and `start: "[[Page]]"` names the page to read first.
  - `Instructions.md`, if present, says who the wiki is for and how its pages should read. Follow it.
  - `Log.md` records what changed and why.
  - Subfolders are sections. An `order:` property sets a page's place; otherwise pages go by name.
- **Attachments** (pasted images, files) go in `{attachments}`.
- Folders starting with a dot are ignored. `.archive/` holds archived files, {deletes}. `{wikis}/.ory/suggestions.json` is Ory's own state: don't edit it by hand; use the commands below.

## Conventions

- **Links:** `[[Note name]]`, `[[Folder/Note]]`, `[[Note#Heading]]` and `[[Note|shown text]]`. A bare name matches any note with that file name, preferring the linking note's folder. `![[file.png]]` embeds a file; `![[Page.html]]` embeds an HTML page.
- **Properties** are YAML frontmatter between `---` lines at the top of a file.
- **Wiki pages** use these properties:
  - `summary`: one line.
  - `tags` and `cover` (an image).
  - `sources`: a list of links to the notes the page draws on, like `"[[{daily}/2026-09-27]]"`.
  - Properties whose names start with a capital letter form the page's infobox, for example `Distance: 9.5 AU`. Lower-case ones don't.
- **Writing:** put each paragraph on one line. Use `##` headings, lists, `- [ ]` tasks, tables, `**bold**`, `==highlight==`, `<span style="color: var(--ink-blue)">coloured text</span>` and `<mark style="background: var(--ink-amber)">a coloured highlight</mark>` (inks: grey, red, orange, amber, green, teal, blue, violet, pink).
- **Property tables** are ```` ```notes ```` code blocks holding a YAML query (filters, views, sort) that lists notes by their properties. Leave them as they are unless asked.

## Working here

- **Keep file names unless asked.** To rename or move a file, use the `move` command below: it rewrites every link to the file. Renaming the file yourself leaves those links broken.
- **Never delete permanently.** Use the `archive` command, which moves files to `.archive/`; the person can restore them {kept}.
- **When you add to a wiki from notes:**
  - Add those notes to the page's `sources`.
  - Add an entry to the wiki's `Log.md`: a line `## YYYY-MM-DD · <what happened>`, then items like `- Changed [[Page]]: why (from [[note]])`.
- **For anything the person may want to weigh first,** such as a new page, a rewrite or a contradiction, file a suggestion instead of editing. It appears in Ory's Suggestions for them to approve.

## Commands

Every command prints JSON. Run them from anywhere:

    {ory} <command>

| Command | Does |
| --- | --- |
| `index` | Every note (path, name, tags, properties, links) and file |
| `wikis` | Each wiki, its pages and their summaries |
| `read PATH` | A note's text, properties, links and `rev` |
| `search QUERY` | Notes containing every word, with matching lines |
| `backlinks PATH` | Notes that link to PATH, with the lines |
| `write PATH [--rev REV]` | Create or replace a note with the text on stdin; `--rev` refuses if it changed since you read it |
| `append PATH` | Add the text on stdin to the end of a note (creating it) |
| `daily [--date YYYY-MM-DD]` | Today's (or that day's) daily note, creating it |
| `move FROM TO` | Rename or move, rewriting links |
| `archive PATH` | Move to `.archive/`, restorable {kept} |
| `archived` | What is in the archive, with ids and when each is deleted |
| `restore ID` | Put an archived item back where it came from |
| `unread` | Notes changed since suggestions last read them |
| `suggestions` | Findings and drafts waiting for the person |
| `suggest` | File suggestions: JSON on stdin (below) |

An MCP server offers the same actions as tools: `{ory} mcp`.

## Suggestions

To keep the wikis current from the notes, start with the notes from `unread`. Read them alongside the wikis (`wikis`, then `read` the pages involved), and file what the wikis should gain:

    {{
      "findings": [{{"kind": "add", "wiki": "Night sky", "page": "Finding Saturn",
                    "section": "Where to look", "title": "Saturn rises around 21:40 in late September",
                    "why": "One or two sentences on what the notes show.",
                    "sources": ["{daily}/2026-09-27.md"]}}],
      "drafts": [{{"path": "{wikis}/Night sky/Finding Saturn.md", "text": "(the whole page)",
                  "changes": [{{"section": "Where to look", "reason": "adds the rising time"}}]}}],
      "read": {{"{daily}/2026-09-27.md": 1790000000.0}}
    }}

- **Finding kinds:** `page` (a new page), `add` (something a page should say), `conflict` (a note disagrees with a page), `link` (one page should point to another), `wiki` (a subject for a new wiki), and `fix` (something wrong or stale).
- **Drafts** are whole pages. The person reviews them change by change. A draft's `findingIds` names the findings it answers: ids from `suggestions`, or positions (0, 1, …) in this call's `findings`.
- **`read`** lists the notes you went through, with the `mtime` that `unread` gave for each, so the next run skips them but still sees any later edit. A plain list of paths also works.
- **Leave out chatter,** to-dos, plans and anything personal. Group related notes into one finding.
"""


def claude_md() -> str:
    return f"{MARKER}\n@AGENTS.md\n"


def remove_guides(vault: Vault) -> list:
    """Remove the guides Ory wrote (never one whose marker was taken out)."""
    removed = []
    for name in ("AGENTS.md", "CLAUDE.md"):
        full = os.path.join(vault.root, name)
        try:
            with open(full, encoding="utf-8") as fh:
                if not fh.readline().startswith(MARKER):
                    continue
            os.remove(full)
            removed.append(name)
        except OSError:
            continue
    return removed


def write_guides(vault: Vault) -> list:
    """Write AGENTS.md and CLAUDE.md where Ory still owns them. Returns what changed."""
    written = []
    for name, text in (("AGENTS.md", agents_md(vault)), ("CLAUDE.md", claude_md())):
        full = os.path.join(vault.root, name)
        if os.path.exists(full):
            try:
                with open(full, encoding="utf-8") as fh:
                    current = fh.read()
            except OSError:
                continue
            if not current.startswith(MARKER) or current == text:
                continue
        try:
            _atomic_write(full, text)
            written.append(name)
        except OSError:
            pass
    return written
