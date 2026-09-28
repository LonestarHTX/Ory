# Ory

A local notes tool and wiki over a folder of plain Markdown files: a live editor with
links, backlinks, properties, tables and embedded pages, and wikis whose pages read as
finished documents, served from a small Python server at `localhost`. Named after the
orrery, a model of the solar system that shows how everything relates.

It needs only **Python 3.8+ and a browser**. The server uses the standard library, and the
web UI is committed pre-built in `ory/static/`, so there is nothing to install.

## Run it

```bash
python3 -m ory --notes ~/path/to/notes
```

Then open <http://127.0.0.1:4747>. Run it from the repo root. Stop it with Ctrl+C.

To avoid passing `--notes` every time, set the folder in a config file:

```bash
cp ory.config.example.json ory.config.json
```

```json
{
  "notes_dir": "~/Notes",
  "port": 4747,
  "daily_folder": "Daily",
  "attachments_folder": "Attachments",
  "wikis_folder": "Wikis"
}
```

`attachments_folder` is where pasted screenshots and files go (`Attachments` if left
out). `"/"` means the top of the notes folder and `"./"` means next to the note.
`wikis_folder` holds the wikis (`Wikis` if left out).

`ory.config.json` is gitignored, so each machine points at its own notes. `--notes` and
`--port` override the file for one run; `--open` also opens the browser. A relative
`notes_dir` is resolved from the config file's folder.

### Try it with sample notes

```bash
python3 scripts/sample_notes.py
```

```bash
python3 -m ory --notes sample-notes
```

This writes a small, generic vault to `sample-notes/` (gitignored).

## The notes folder

Notes are the folder's `.md` files and nothing else: no database and no sidecar files, so
git, AI tools and other Markdown editors can work on the same folder. Ory uses common
conventions for them, but its features are its own and are not limited to what other
tools can show:

- `[[Note name]]`, `[[Folder/Note]]`, `[[Note#Heading]]` and `[[Note|shown text]]` links.
  A bare name matches any note with that file name, preferring the linking note's folder.
- YAML frontmatter at the top of a note is shown as properties.
- Deleted notes go to `.trash/` in the notes folder, so nothing is lost by accident.
- Folders that start with a dot (such as `.git` or `.trash`) are ignored.
- Screenshots and files pasted or dropped into a note are saved to the attachments
  folder and embedded as `![[Pasted image 20260927194019.png]]`.

## Notes and wikis

Ory has two spaces over the same folder, switched at the top of the sidebar:

- **Notes** are where you think: quick, dated, messy. They open straight into the
  editor. Everything outside the wikis folder is notes.
- **Wikis** are where the result lives: pages written to be read. Each folder inside
  `Wikis/` is one wiki, and its `Home.md` is its front page.

**All wikis** (the Wikis side of the switch) shows a card for each wiki, with its
summary and size, and a card to start a new one. Opening a wiki turns the sidebar into
its contents: Home, its pages, a heading for each subfolder, and upkeep pages
(`Instructions.md`, `Log.md`) at the bottom. An `order:` property sets a page's place;
otherwise pages go by name.

A wiki page opens for **reading**: a header with the title, the `summary:` property, the
tags and a `cover:` image, then the text with no Markdown showing and nothing editable.
Press **E** or **Edit** (or double-click) to edit and **Esc** or **Done** to go back to
reading. A new, empty page opens ready to write. Properties whose names start with a
capital letter (`Held by: Main anchors`) form the page's **infobox**; lower-case ones
(`tags`, `summary`, `cover`, `order`, `start`) don't. A wiki's Home also lists its pages,
grouped by subfolder, and what changed recently; `start: "[[First page]]"` adds a
"Start here" button.

```markdown
---
summary: Where to look, and what the rings do over the years.
tags: [planets]
Moons: 146
Related: "[[Planets/Saturn]]"
---
```

### Suggestions: wikis drafted from notes

An AI can read your notes and suggest what the wikis should say. It works with any AI
chat by copy and paste, so nothing needs installing or connecting:

1. **Find suggestions** (under Suggestions, or on All wikis) builds a prompt from the
   notes changed since the last run, plus each wiki's pages and instructions. Copy it
   into your AI chat and paste the whole reply back. A large first run is split into
   parts, each its own paste.
2. **Findings** come back as short claims: a new page, something to add to a page, a
   conflict between a note and a page, a missing link, something to fix, or a whole new
   wiki. Approve or dismiss each one. Dismissed findings are remembered, so the AI isn't
   told the same thing twice.
3. **Write drafts** sends the approved findings with the pages and notes they touch.
   The AI replies with whole pages; Ory shows each change, section by section, to
   accept or reject. **Apply accepted** saves what you accepted, and adds a line to
   the wiki's `Log.md`.

The AI never changes a note, and nothing is saved until you apply it. If you edit a page
after its draft was written, your edits are kept and the draft's changes are carried over
to them; any that touch the same lines as your edits are left out. Pages record the notes
they came from in a `sources:` property.

A wiki's `Instructions.md` (optional) is sent with every prompt: who the wiki is for,
how its pages should read, what to leave out. Ory keeps the findings, drafts and which
notes have been read in `Wikis/.ory/suggestions.json`, a dot-folder so it stays out of
your notes and backlinks while still being part of the notes folder's git history.

Edits made outside Ory (in another editor, by git or by an AI tool) are picked up within two
seconds. If a note changes on disk while you have unsaved edits to it, Ory asks which
version to keep instead of overwriting either.

## Keys

| Key | Does |
| --- | --- |
| Cmd+O | Open or create a note (Shift+Enter creates) |
| Cmd+Shift+F | Search all notes |
| Cmd+Shift+D | Open today's note (`Daily/YYYY-MM-DD.md`) |
| `[[` | Link to a note, with autocomplete |
| Cmd+Enter | Open the link at the cursor |
| Cmd+click | Open a link while editing it |
| Cmd+E | Switch between live preview and source |
| E / Esc | Edit the wiki page being read / go back to reading |
| Cmd+F | Find in the note |
| Cmd+B / Cmd+I | Bold / italic (the word at the cursor, or the selection) |
| Cmd+Shift+X / Cmd+Shift+H | Strikethrough / highlight |
| Cmd+K | Link: a web link for selected text, otherwise a link to a note |
| Cmd+Shift+8 / 7 / 9 | Bulleted list / numbered list / checklist |
| Cmd+Option+1 / 2 / 3 / 0 | Heading 1 / 2 / 3 / body text |
| F2 in the tree | Rename |

The formatting toolbar above each note does the same, Word-style, and shows what
applies at the cursor; hover over (or tab to) any button for its name and shortcut.
It writes ordinary Markdown (`**bold**`, `==highlight==`, `- [ ] task`), so notes stay
readable as plain text.

**Text colour** (the "A" button) opens a colour picker: any colour from the petals,
the lightness arc or a hex code, plus five theme inks (blue, green, amber, red, grey)
that follow light and dark mode, and Default. It is stored as an HTML tag that any
Markdown viewer shows: `<span style="color: #d9a05b">text</span>`. A picked colour is
kept exactly as chosen; if it would be hard to read on screen (dark navy in dark mode,
pale yellow in light mode) Ory shows a lighter or darker step of it that passes 4.5:1.
Ory hides the tags while you edit; Cmd+E shows them.

Tables show as a grid you edit in place, like a spreadsheet: click a cell and
type, Tab and Enter move between cells (and add a row at the end), right-click a
cell to insert or delete rows and columns or align a column, and paste cells
copied from Excel to fill the grid. The note still stores an ordinary Markdown
table, with its columns padded so it reads well in any editor. Cmd+E shows it.

**Screenshots and files:** paste a screenshot, drop files onto a note, or use the
paperclip on the toolbar. Images show in the note; other files show as a chip that
opens them. Drop files onto a folder in the tree to add them there. Pasting cells
copied from Excel into a note makes a table.

**Properties** at the top of a note are edited in place: click a value or a name,
tick yes/no values, pick dates from a calendar, add one from the row at the bottom,
remove one from its "..." menu. The note stores ordinary YAML frontmatter.

**Property tables** list notes by their properties, like a small database. The
toolbar's property table button inserts one: a ```` ```notes ```` block holding the query.

````
```notes
filters:
  and:
    - file.inFolder("Projects")
    - 'status != "closed"'
views:
  - type: table
    name: Open projects
    order: [file.name, status, due]
    sort:
      - property: due
        direction: ASC
```
````

Filters can use any property by name, `file.name`, `file.folder`, `file.tags`,
`file.mtime`, `file.inFolder()`, `file.hasTag()`, `file.hasLink()`, comparisons,
`&&`, `||`, `!`, `.contains()` and `today()`. Click a column heading to sort; click
Edit (or move the cursor into it) to change the query. Views are tables; there are no
formulas yet.

**Pages:** an `.html` file in the notes folder (an interactive model, a calculator, a
generated report) opens inside Ory across the main area when you click it in the tree
or follow a `[[Page.html]]` link. Embed one in a note with `![[Page.html]]`, or
`![[Page.html|640]]` to set its height; Open takes it full size. Pages run sandboxed:
their own scripts work, but they cannot reach Ory, your other notes or the network, so
a page from anywhere is safe to open. Pages open in Ory's theme. When the theme changes,
a page is reloaded in the new one, unless it listens for
`{type: "ory:theme", theme}` messages and answers `{type: "ory:theme-applied"}`,
in which case it keeps its state:

```js
window.addEventListener("message", (e) => {
  if (e.data?.type !== "ory:theme") return;
  document.documentElement.dataset.theme = e.data.theme;
  e.source.postMessage({ type: "ory:theme-applied" }, "*");
});
```

**The right sidebar** shows backlinks and an outline of the note's headings.
**The tree**: drag a note, file or folder onto a folder to move it (links follow).

Ctrl replaces Cmd on Windows and Linux. Clicking a link to a note that does not exist
creates it. Renaming a note (edit its name in the header, or use the tree's "..." menu)
updates links to it in other notes.

## Layout

```
ory/            Python server, standard library only
  __main__.py   python3 -m ory
  config.py     ory.config.json and command-line flags
  server.py     HTTP server and JSON API, localhost only
  vault.py      the notes folder: index, links, backlinks, search, rename
  markdown.py   frontmatter and wikilink parsing
  static/       built web UI (committed; do not edit by hand)
web/            web UI source: CodeMirror 6 and plain JavaScript
tests/          python3 -m unittest
scripts/        sample_notes.py
DESIGN.md       the design rules the UI follows
```

## Changing the web UI

Only needed to change the interface. Edit `web/src`, then rebuild and commit
`ory/static/` with the change:

```bash
cd web && npm install && npm run build
```

`npm run watch` rebuilds on save.

## Tests

```bash
python3 -m unittest
```

## Security

The server binds to `127.0.0.1` only. Because it can write files, it also refuses requests
whose `Host` is not localhost (DNS rebinding) and writes that come from another origin or
are not JSON. Paths are confined to the notes folder.

## Roadmap

- **v0 (this):** notes core.
- **v1 (started):** wikis drafted from notes by copy and paste (Suggestions, above).
  Next: API adapters so the paste steps can be one button, and asking the wikis
  questions.
- **v2:** one-way publishing of wiki pages to a shared site, with their `sources` left out.
