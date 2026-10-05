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
  browser. A theme only sets the frame and the card: `--chrome`, `--content` and the
  chosen tab's `--tab-on` and `--tab-ring` (Themes in `styles.css`).
  Neutral is Ory's own greys and is the default. Dusk is the one place hue and a
  gradient are allowed: violet grey `#282237` on the left warming to wine `#3a1e1e`,
  warmest at the top right (`#492221`), with a darker card (`#131215`) and the chosen
  tab outlined lilac to peach. Every text colour passes 4.5:1 on all of its
  surfaces in both modes (the closest is hint text on light Dusk's top right, 4.56).
  Floating layers keep Ory's own surfaces in every theme.

## Layout

- **One title bar over everything** (48px, a hairline below). Over the rail and
  sidebar: the sidebar toggle (Cmd+\), Back and Forward. Over the card: the open
  view's own header (where it is, its name, its state such as "Edited 2 min ago",
  and its one action and "..."), which `main.js` moves out of the view into the
  title bar. At the right: the tabs and the panel toggle. Views have no header row
  of their own on the card.
- **Every column starts on one line under the title bar.** The card, and the first
  row of the rail, sidebar and panel, all start 8px below it; the sidebar's and
  panel's headers are 40px rows, so the rail's first icon, the folder's name, the
  note's toolbar (or each card's header, side by side) and the panel's title share
  one centre. Horizontally, the folder's name, the sidebar rows' icons and the
  section labels share one left edge; the title bar's first button sits over the
  rail's icons (both 32px, 8px in); the title bar's, sidebar's and panel's right-hand
  buttons sit 16px in. With the sidebar hidden, the title bar's first column grows to
  fit its buttons.
- **Inside the card, every page starts `--gutter` (24px) in, top and left**: All
  wikis, Suggestions, the Archive, Search and the empty page alike. Notes and wiki
  pages keep their centred column.
- **The rail** (48px) holds the places: Notes, Wikis, Suggestions and the Archive,
  with Settings at its foot. The place you're in has the selected fill. Suggestions
  is the silver bulb, with its count, while suggestions wait.
- **The sidebar** (264px) starts with its header: the notes folder's name, which is
  a menu for switching back to folders opened before (or Settings for another), and
  the space's actions (Search, and New note or New wiki). Below it, the space's
  groups under 11px labels. Notes: New note and Today's note, Pinned (only when
  something is pinned), Folders (the tree, which scrolls), and Recent (the last five
  notes you were in, not the one you're in) at the bottom. Settings → Layout can hide
  Today's note, Pinned or Recent.
- **Edges resize.** The sidebar's and the panel's inner edges can be dragged (200–400px
  and 240–440px); double-click one, or Settings → Layout, for its usual width. The
  handle is an 8px strip over the frame that shows a 2px line on hover.
- **Tabs** are 28px chips in the title bar, at most 160px wide; the chosen one takes
  the card's colour (Dusk outlines it). A note opens in the current tab, or in its
  own tab if it's open already; Cmd-click (in the tree, Pinned or Recent) and the
  tabs' + open a new one. Places other than notes leave the tabs with none chosen.
  Tabs follow moves, close for archived notes, and are remembered per notes folder.
- **The open view is set into the frame as a card** (`--content`, 6px corners, 8px
  clear of the title bar, the bottom, and the right edge when the panel is hidden).
  The title bar, rail, sidebar and panel are one surface (`--chrome`) with no
  hairlines between them. In light mode the card also has a hairline and a faint
  shadow.
- **The panel** (280px) is about the open note or page, one view at a time: its
  header names the view and switches between Backlinks (with the count), Outline and
  Info (folder, when edited, words, links, tags, aliases). The choice, and whether the
  panel is shown, are remembered; it hides below 1100px.
- **Side by side.** Two notes at most, each its own card, with the frame showing in
  an 8px gap between them that resizes them (double-click for half and half; arrow
  keys when focused). Each card then has its own header row (where it is, its name,
  state, its action, "..." and × to close that side) and the title bar's middle stays
  empty. The side you're in has its name in full text colour, the other's in
  `--text-2`: the only sign of which is which. The address, the tabs, the tree's
  selection and the panel follow the side you're in; the other side's note keeps its
  tab, marked with the side-by-side icon. A note opens beside from the tree's "...",
  Option-click (on a link or tree row), a tab dragged onto the card (the right half
  shows "Open beside" on the selected fill), "Open a note beside..." in a note's
  "...", or the side-by-side button (Cmd+Shift+\), which opens the note you were in
  before. Closing the first side moves the note beside into it. Other places use the
  whole card; coming back brings both sides. The panel has its own shown setting while
  split (hidden at first); below 1100px the side closes and its note stays a tab.
  With a note beside a wiki page that doesn't list it in `sources`, the page shows
  one quiet line under its header: the note's name, "Add as source" (which adds it,
  even while reading) and × for not now.
- **The note sits on the card, not the canvas.** A note is a document read for a long
  time; in light mode that makes it white rather than grey.
- **Keyboard hints in the sidebar** appear while a row is hovered or focused.
- **The sidebar and panel share the 24px `--gutter`.**

## Ory-specific rules

- **Two spaces, one tool.** Notes and Wikis are the rail's first two places; the
  sidebar belongs to the space you're in: the notes tree, or the wikis. The tree
  never shows the wikis folder.
- **Wikis sidebar** has no nested tree, and its groups scroll together. It starts
  with All wikis and Suggestions (with how many wait). On All wikis: the wikis, each
  with a 20px picture (its cover, or its initial on a card) and its page count, then
  the five pages edited most recently, each with its wiki's name. Inside a wiki: its
  contents under its name (with New page and "..."), subfolders as quieter section
  headings with their pages indented, upkeep pages last in tertiary text above a
  hairline; then Other wikis. A wiki's "..." holds Archive, confirmed in place with
  the page count; it is on each wiki row (on hover, in place of the count, and on
  right-click), beside the wiki's name inside it, and on each All wikis card (on
  hover, over the cover).
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
  opened by the gear at the foot of the rail or Cmd+,; Esc, a click outside or Cmd+, again closes it. It has its own sidebar of
  sections (Notes, Appearance, Layout, Editing, Archive, AI, Shortcuts), moved through with the
  arrow keys, and remembers the last one. Tab stays inside it, and focus stays put
  when a choice redraws the section. Each section starts with a short line saying
  where its settings are kept. Choices of a few options use the segmented control of
  the space switch and apply at once; folders are fields saved together with one
  primary button, which is disabled until something changes, with Revert beside it
  and "Unsaved" beside Notes in the window's sidebar. A note setting (the daily
  template) is a field-like row with × to clear it and "Choose..." to pick through the
  quick switcher. On/off lists (what the sidebar shows) are checkboxes, one per row,
  with a 12px hint under any that needs one. Connection status is a status
  dot and a sentence, rechecked while the window is open. Shortcuts are rows split by
  hairlines, the keys right-aligned.
- **Wiki cards** (All wikis, and a Home's pages) are bordered cards that darken their
  border on hover; the "start a wiki" card is dashed.

- **Missing links** are secondary text with a dashed underline, so the difference
  does not rest on colour alone. Clicking one creates the note.
- **Live preview reads like a document.** Formatting marks (`**`, `*`, `~~`, `==`,
  backticks, `#`, `>`, `[[ ]]`, link syntax, list and task marks) stay hidden even
  where you're typing, and each is one step for the cursor. Typing Markdown still
  works: `# ` makes a heading and `**bold**` turns bold as it closes. The cursor
  never sits before a heading's or quote's hidden mark; Backspace at the start of one
  makes the line body text, Enter there adds a line above (on an empty heading, it
  makes it body text), and deleting the last character inside bold or a colour
  removes its marks too. Code fences show while you're in the block. Settings →
  Editing can show marks at the cursor instead ("At the cursor"), and Cmd+E shows all
  the Markdown.
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
  honeycomb under the band (its cells arriving ring by ring from the centre), laid out like Office's (hue round, colour outward, the text
  colour at the centre), and a row of greys. *Custom* (Custom ›) slides out to the side: hue
  and colourfulness (as a share of the most that hue can have) in a field drawn at one vivid lightness, lightness in a bar (for text, what can't be read in this
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
  puts the text back after 90ms, so sweeping across seams doesn't flicker. While
  the selection shows a highlight colour (being previewed, or the words' own), it draws as
  a 1px ring instead of the grey fill, so the colour reads true; with Custom open
  the text shows the colour being made. A pick or Apply applies and closes; Escape steps
  back one level (menu, Custom, More, picker); Tab stays inside. Hex tiles are laid out by
  their apothem with exact seams (2px on the band, 1.5px in the honeycomb), each polygon
  inset by half its stroke; they are the one off-scale geometry. The toolbar button is an
  "A" over a bar in the text colour, sitting on the highlight's wash. It is the only
  colour and highlight button: there is no separate Highlight button (Cmd+Shift+H still
  toggles a plain highlight).
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
  the image, so nothing jumps. A click selects a picture: a 1px outline in the text
  colour, square handles on its right corners and side (pictures sit at the left of
  the column, so the left edge never moves), and its size on the bottom edge.
- **Resizing** (pictures and pages, `ui/resize.js`, after Azlen's bounding-box study):
  a handle at rest (a picture's 8px square, a page edge's 40 × 4 bar) turns into a
  double arrow as you take it, on a spring, and the system pointer hides so the arrow
  is the cursor. The size is a 20px pill on the edge: quiet (the card, a hairline,
  `--text-2`) while you can click it, filled in the text colour while you drag.
  Clicking it (or, for a selected picture, just typing) opens a field with Fit beside
  it; it takes sums and, for pictures, a percentage of the column. A typed size
  settles on the study's measured spring (response 0.32 s, damping 0.89). Nothing is
  blue: handles and pills are the text colour.
- **Pages** (HTML files) open across the whole main area under the usual note header
  (folder / name, "Open in new tab", "..."). Embedded in a note they are a bordered
  card: a 32px head with the page icon and name, then Wide (a text toggle on the
  selected fill), Open across the main area (arrow) and "..." (Reload, Open in new
  tab, Set height..., and "Use the page's own height" once you've set one); under it
  the frame. Its height is the note's (`|640`), else what the page says it needs, else
  480px, so a page that sizes itself is never cut off or letterboxed. The height
  shows only near the bottom edge (on it, or within 28px below it in the note; inside
  the page the pointer is the page's), so it never sits over the page; the edge is a
  10px strip where the bar comes to the pointer (see Resizing). A height of your own is written into the link; Fit, or a
  double-click on the edge, hands it back. Wide (`|wide`) runs the
  card's width less the gutter each side, at most 1280px, centred on the text column.
  Resizing never reloads the page. A page keeps its own design; to look like part of
  Ory it should use the shared tokens.
- **Property tables** use the note-table style, read-only, under a heading row: the
  view's name (or tabs), the count, and Edit on the right.
- **Outline** sits under Backlinks in the right sidebar; the heading the cursor is
  in is selected.
- **Search** is a view in the main area: the field at the top, results filtering
  as you type. The quick switcher is a short job, so it floats, docked over the
  header's field.
- **Destructive actions** live in "..." menus and confirm in place. Nothing is
  deleted at once: Archive moves a note, file, folder or wiki to `.archive/`, and the
  confirmation says how long it can be restored (30 days unless Settings → Archive
  says otherwise).
- **The Archive** is a full page (a place on the rail, selected while you're on it). One row per item, newest first:
  name with its kind's icon (and note count for folders and wikis), where it was,
  when it was archived, and when it will be deleted, with a warning dot in the last
  three days. Restore is the row's button; Delete now is in its "..." menu and
  confirms in place. Items the archive didn't record itself (put in `.archive/` some
  other way) are never deleted on their own: they read "Not scheduled". With the
  period set to keep, recorded items read "Kept".
- **Reading width and font** are the reader's: Settings → Appearance sets the notes'
  column (Default 784px, Wide 944px, Full) and font (Sans, or a serif for the text and
  page heads; properties stay sans). Text size is left to the browser's zoom.
- **Tree indents** are derived values (depth × 12 plus the 18px chevron and gap), so
  note names line up with folder names. They are the only off-scale spacing.
