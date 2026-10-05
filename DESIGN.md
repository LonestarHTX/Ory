# Ory design rules

The rules Ory's interface follows. A value outside the scales below is a mistake.

## Foundations

- **Tokens:** `--canvas` `--sidebar` `--card` for the three surfaces; `--hover` and
  `--selected` overlays; `--line` `--line-strong` `--border-strong`; `--field`;
  `--text` `--text-2` `--text-3`; `--success` `--warning` `--error` (status dots only);
  `--veil`, `--float`; corners `--r-sm` 4, `--r-ctl`/`--r-card` 6, `--r-window` 10.
- **Scales:** type 11, 12, 13, 14, 17, 24 on whole-pixel line heights 16, 20, 24, 32;
  spacing 4, 8, 12, 16, 24, 32, 48; motion 0.12s and 0.24s.
- **Type:** the system text face for anything you read; monospace only for counts,
  keys and code, one pixel under the text beside it. Medium for titles and selection;
  sidebar section labels are 11px medium. Markdown bold is semibold (600): it is the
  writer's own emphasis, not chrome, and needs to stand apart from medium headings.
- **Controls:** `.btn` (outlined, medium, border darkens on hover), `.input` (40px well),
  `.input--bare` (reads as text until hovered or edited), `.iconbtn` (30px), `.kbd`
  (bordered key cap), `.menu`, `.window`.
- **Motion:** hovers fade over 0.12s; menus and windows arrive over 0.24s and leave over
  0.12s; navigating to a note fades it in; the theme cross-fades over 0.24s.
- **States:** selection is the selected fill plus a medium, full-colour label. Focus is
  a 2px ring in the text colour with a gap. Links are underlined text.
- **Contrast:** every text colour passes 4.5:1 wherever it sits. Hint text never sits
  on a selected fill; inside a selected row it steps up to `--text-2`.
- **Colour** is for status only (a small dot beside a status word), with three
  exceptions: colour a writer puts in a note is content, the silver bulb below, and
  the Dusk theme, which someone chooses.
- **Themes.** Light or dark is one choice (System, Light, Dark) and the theme is
  another (Neutral, Dusk), both under Settings → Appearance and remembered in the
  browser. A theme only sets the frame and the card: `--chrome`, `--content`,
  `--head-well` and the space switch's `--switch-*` tokens (Themes in `styles.css`).
  Neutral is Ory's own greys and is the default. Dusk is the one place hue and a
  gradient are allowed: violet grey `#282237` on the left warming to wine `#3a1e1e`,
  warmest at the top right (`#492221`), with a darker card (`#131215`) and the chosen
  space outlined lilac to peach. Every text colour passes 4.5:1 on all of its
  surfaces in both modes (the closest is hint text on light Dusk's top right, 4.56).
  Floating layers keep Ory's own surfaces in every theme.

## Layout

- **The frame.** A header row runs across the window: the Notes | Wikis switch over
  the left sidebar, and a field over the open view. Below it are both sidebars. The
  header and sidebars are one surface (`--chrome`), with no hairlines between them,
  and the open view is set in as a card (`--content`, 6px corners, 8px clear of the
  bottom, and of the right edge when there is no right sidebar). In light mode the
  card also has a hairline and a faint shadow.
- **The header's field is the quick switcher, docked.** Clicking it, or Cmd+O, opens
  the switcher with its field exactly over the header's (the window's border and the
  field's margin are taken off each side) and its list below, with no veil. The last
  row, or Cmd+Enter, searches every note. So the left sidebar's navigation is only
  Today's note.
- **The note sits on the card, not the canvas.** A note is a document read for a long
  time; in light mode that makes it white rather than grey.
- **Keyboard hints in the sidebar** appear while a row is hovered or focused.
- **Sidebars are 280px** and share the 24px `--gutter`.

## Ory-specific rules

- **Two spaces, one tool.** Notes | Wikis is a segmented control in the header, over
  the left sidebar (the selected segment takes the card's colour). The
  sidebar below it belongs to the space: the notes tree, or the wikis. The tree never
  shows the wikis folder.
- **Wikis sidebar** has no nested tree. Outside a wiki it lists the wikis, each with
  a 20px picture (its cover, or its initial on a card) and its page count. Inside one
  it becomes that wiki's contents under an "All wikis" back row and a header with the
  wiki's 32px picture, name and size. Subfolders are section headings with their
  pages indented; upkeep pages sit last, in tertiary text, above a hairline. A wiki's
  "..." holds Archive, confirmed in place with the page count; it is on each
  wiki row (on hover, in place of the count, and on right-click), in the header
  inside a wiki, and on each All wikis card (on hover, over the cover).
- **Reading view.** Wiki pages open read-only with every mark hidden, no caret and no
  toolbar. The header's Edit button (with its E key cap) becomes Done (primary, Esc)
  while editing. The page header is 24px semibold title, 17px secondary summary, tags
  as small selected-fill chips, and a 176px cover band; the infobox is a 240px bordered
  card beside the title, not floated into the text, so the text column keeps its
  width. The page's own `# Title` line is hidden while reading, since the header
  carries it.
- **Suggestions** sits at the top of the Wikis space, above every wiki, because a
  finding can start a new wiki. What needs you (findings to decide, drafts to review)
  shows as the silver bulb, and as a card above the wikis on All wikis.
- **The silver bulb** (`ui/silver-icon.js`) is the one material in Ory. It marks
  the AI's work: liquid metal (a few drifting softboxes reflected in a polished
  dome, over a silver floor with a faint colour fringe) cast as a lightbulb. It appears only while suggestions are waiting: beside "Wikis" on the
  space switch while you're in Notes, and as the Suggestions row's icon while
  you're in Wikis. Only one is ever shown. The space switch never carries a number;
  in Wikis the Suggestions row shows how many wait, as a small primary pill. When more
  suggestions arrive, one glint crosses it. Light rolls round the dome about every
  14 seconds, over a slow ripple. On a light sidebar the metal runs
  darker so the bulb keeps 3:1. It holds still under reduced motion and in a hidden
  tab, and without WebGL it is a flat bulb in the text colour. Never on cards,
  pages or anything you read.
- **Copy and paste** is a two-step panel on the sidebar fill: copy the prompt (primary
  until copied), paste the reply into a monospace field, then read it. Problems with a
  reply are listed under the field; nothing already read is lost.
- **Findings** are bordered cards: kind (tertiary, amber for a conflict), title
  (semibold), where it lands, the reason, and the notes it came from as small chips that
  open them. Approved ones take the sidebar fill.
- **Draft review** is a diff: a change per section, headed by the
  section and the AI's reason, removed lines on a faint red and added lines on a faint
  green (status colours at 14%). Accept turns primary when chosen; a rejected change
  dims. The draft list on the left shows each page's +/− counts and a tick when every
  change is decided.
- **Settings** is a floating window over whatever is open, like the quick switcher,
  opened by the small gear at the foot of the sidebar (beside the notes folder's name)
  or Cmd+,; Esc, a click outside or Cmd+, again closes it. It has its own sidebar of
  sections (Folders, Appearance, Editing, AI, Shortcuts), moved through with the
  arrow keys, and remembers the last one. Tab stays inside it, and focus stays put
  when a choice redraws the section. Each section starts with a short line saying
  where its settings are kept. Choices of a few options use the segmented control of
  the space switch and apply at once; folders are fields saved together with one
  primary button, which is disabled until something changes, with Revert beside it
  and "Unsaved" beside Folders in the window's sidebar. Connection status is a status
  dot and a sentence, rechecked while the window is open. Shortcuts are rows split by
  hairlines, the keys right-aligned.
- **Wiki cards** (All wikis, and a Home's pages) are bordered cards that darken their
  border on hover; the "start a wiki" card is dashed.

- **Missing links** are secondary text with a dashed underline, so the difference
  does not rest on colour alone. Clicking one creates the note.
- **Live preview** hides Markdown syntax except in the element holding the cursor.
  Frontmatter shows as a properties table until the cursor enters it; dates show in
  words ("Nov 1, 2026 in 35 days").
- **Save as you go.** The header shows "Saving", "Saved", then "Edited 4 min ago".
  An edit made on disk while you type raises a conflict bar ("Load disk version" /
  "Keep mine"); leaving without choosing keeps your version as a
  "(conflict …)" copy.
- **Formatting toolbar:** 30×28 buttons, pressed state as the selected fill,
  hairline separators, and a link button that swaps the tools for an address field.
  A paragraph-style dropdown leads it, as in Word. It only offers what Markdown can
  store, so there is no underline.
  `==Highlight==` uses the selected fill, like a search match.
- **Colour** (`ui/color-picker.js`) colours the text or a highlight behind it, in three
  depths that open from each other in place. *The band:* a segmented Text | Highlight
  control (remembered) and the palette button over a band of hex tiles, like a heat
  shield: none, nine colours and +, with plain rows above and below that fade out; the
  plain tiles touching the one you point at take a faint tint of it. *More* (+) opens a
  honeycomb under the band, laid out like Office's (hue round, colour outward, the text
  colour at the centre), and a row of greys. *Custom* (Custom ›) slides out to the side: hue
  and colourfulness in a field, lightness in a bar (for text, what can't be read in this
  theme is hatched), Hex and R G B, New over Current, a line saying how each theme will
  show it, and Add to my colours, Cancel and Apply. The *palette* menu, beside the picker so
  the band stays in view, swaps the band's nine: Ory (the inks), Soft, Vivid, Earth, Sea, and
  My colours (the nine newest saved from Custom; an empty slot is dashed like the "start a
  wiki" card and opens Custom; right-click removes one). Tiles are solid for text and a wash
  with a coloured edge for a highlight; tooltips name them. Every colour offered reads in
  both themes. Pointing at a colour (or arrowing to it) previews it on the text as a wave
  (`editor/colour-preview.js`): letters switch in reading order over 0.117 · ∛n seconds, each
  with a short bold pulse (and a glow in dark mode only, since a glow on white reads as a
  smudge); a drag in Custom shows the colour at once. Leaving a colour for anything else
  puts the text back after 90ms, so sweeping across seams doesn't flicker; with Custom open
  the text shows the colour being made. A pick or Apply applies and closes; Escape steps
  back one level (menu, Custom, More, picker); Tab stays inside. Hex tiles are laid out by
  their apothem with exact seams (2px on the band, 1.5px in the honeycomb), each polygon
  inset by half its stroke; they are the one off-scale geometry. The toolbar button is an
  "A" over a bar in the text colour, sitting on the highlight's wash.
- **Inks.** Theme inks are tokens (`--ink-blue`, `--ink-green`, `--ink-amber`,
  `--ink-red`, `--ink-grey`, and `--ink-orange`, `--ink-teal`, `--ink-violet`,
  `--ink-pink`). The chromatic ones sit on one ring of OKLCH lightness and chroma
  (0.74 and 0.08 in dark mode, 0.48 and 0.09 in light), so each passes 4.5:1 on
  the card and under a selection; dark-mode red is `#dc958e`, a step lighter than
  the status red. Text colour is `<span style="color: …">`; a coloured highlight is
  `<mark style="background: …">` (as Obsidian's Highlightr writes it), shown as a
  wash of the colour (`--mark-mix`, 26% dark, 16% light) so the text keeps its own
  colour; grey as a highlight is plain `==text==`, and changing one highlight into
  another swaps its marks in place. Colours from the honeycomb, the other palettes and Custom are saved as hex (the colour as shown in the theme it was picked in); hex colours, including ones from elsewhere, are shown readably
  (text, via `.ink` and `ui/color.js`) or as a wash (highlights, alpha dropped).
  Colour in a note is the writer's content, so it is outside the "colour means
  status" rule for the interface.
- **Tooltips** name every icon button, with its shortcut as a key cap: a small raised
  label (hairline, float shadow, 12px, standard 6px corner; the 10px window corner
  would read as a pill at this size). After 450ms on hover, at once while moving along
  a toolbar or on keyboard focus. Never the browser's `title` tooltip.
- **Tables** are grids in live preview: a card with a hairline border, 12px medium
  headings, row lines and row hover, plus spreadsheet column lines, a
  heading band in the hover fill, and the focus ring on the cell being edited, like
  Excel's active cell. Numbers right-align unless the column says otherwise. A cell
  shows formatted text until you edit it. "+ Add row" appears under a table while
  you point at or work in it; everything else is on the right-click menu. In
  source mode the table is Markdown in monospace, so the pipes line up.
- **Properties** are a table edited in place: rows share columns (subgrid) so names
  line up, hover shows a row's "..." (remove, rename, edit as YAML), and the last row
  is the quiet add row: a plus, a plain field, an Enter hint that becomes Add. Yes/no
  values are checkboxes; dates open the calendar and read in words.
- **Calendar:** month heading with arrows, a 7-column grid,
  today outlined, the chosen day in `--primary`, and the choice in words underneath.
- **Attachments**: images embed at their own size up to the text width with a
  hairline border and the card corner; other files are a chip (icon, name, size in
  mono) that opens them. While the cursor is on an embed its Markdown shows above
  the image, so nothing jumps.
- **Pages** (HTML files) open across the whole main area under the usual note header
  (folder / name, "Open in new tab", "..."). Embedded in a note they are a bordered
  card: a heading strip in the hover fill with the page icon, name and Open, over the
  frame at the given height (480px by default). A page keeps its own design; to look
  like part of Ory it should use the shared tokens.
- **Property tables** use the note-table style, read-only, under a heading row: the
  view's name (or tabs), the count, and Edit on the right.
- **Outline** sits under Backlinks in the right sidebar; the heading the cursor is
  in is selected.
- **Search** is a view in the main area: the field at the top, results filtering
  as you type. The quick switcher is a short job, so it floats, docked over the
  header's field.
- **Destructive actions** live in "..." menus and confirm in place. Nothing is
  deleted at once: Archive moves a note, file, folder or wiki to `.archive/`, and the
  confirmation says it can be restored for 30 days.
- **The Archive** is a full page (the archive button at the foot of the sidebar,
  beside Settings, selected while you're on it). One row per item, newest first:
  name with its kind's icon (and note count for folders and wikis), where it was,
  when it was archived, and when it will be deleted, with a warning dot in the last
  three days. Restore is the row's button; Delete now is in its "..." menu and
  confirms in place. Items the archive didn't record itself (put in `.archive/` some
  other way) are never deleted on their own: they read "Not scheduled".
- **Tree indents** are derived values (depth × 12 plus the 18px chevron and gap), so
  note names line up with folder names. They are the only off-scale spacing.
