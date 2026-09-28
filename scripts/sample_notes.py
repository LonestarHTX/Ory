"""Write a small, generic sample vault for trying Ory.

    python3 scripts/sample_notes.py            # writes ./sample-notes (gitignored)
    python3 scripts/sample_notes.py ~/somewhere

The content is small and generic. Existing files are
left alone unless --force is given.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def notes(today: dt.date):
    yesterday = today - dt.timedelta(days=1)
    return {
        "Welcome.md": """\
---
tags: [ory, start]
aliases: [Start here]
---
# Welcome

This is a sample vault for trying Ory. Everything is a plain Markdown file.

- Links look like [[Orrery]] or [[Planets/Mars|the red planet]].
- A link to a note that does not exist yet, like [[Telescope wishlist]], creates it when you click it.
- Today's note lives in [[Daily/{yesterday}]] and the daily folder.

## Things to try

- [ ] Open the quick switcher and jump to [[Saturn]]
- [x] Search for `rings`
- [ ] Rename [[Reading list]] and watch the links update
""".replace("{yesterday}", yesterday.isoformat()),
        "Orrery.md": """\
---
aliases: [Clockwork solar system]
tags: [history]
built: 1713
---
# Orrery

A mechanical model of the solar system that shows the relative positions and motions of
the planets. The name comes from Charles Boyle, 4th Earl of Orrery.

Related: [[Planets/Mars]], [[Saturn]], [[Reading list]].
""",
        "Reading list.md": """\
---
status: in progress
tags:
  - books
  - astronomy
---
# Reading list

1. *Cosmos* by Carl Sagan
2. *The Sleepwalkers* by Arthur Koestler, on Kepler and **planetary orbits**
3. A field guide to the night sky

See also [[Orrery]].
""",
        "Planets/Mars.md": """\
---
type: planet
moons: 2
rings: false
---
# Mars

Fourth planet from the Sun. Two small moons, Phobos and Deimos.

Compare with [[Saturn]], which has rings and many moons.
""",
        "Planets/Saturn.md": """\
---
type: planet
moons: 146
rings: true
related: "[[Planets/Mars]]"
---
# Saturn

Sixth planet, best known for its rings of ice and rock.

```
Inside a code block, [[Not a link]] is ignored.
```

Back to [[Welcome]].
""",
        "Projects/Backyard observatory.md": """\
---
status: planning
due: 2026-11-01
---
# Backyard observatory

## Checklist

- [ ] Level the pier
- [ ] Wire power for the mount
- [ ] Choose a camera, see [[Telescope wishlist]]

Notes from [[Daily/{yesterday}]].
""".replace("{yesterday}", yesterday.isoformat()),
        "Wikis/Night sky/Home.md": """\
---
summary: What you can see from a backyard, and how to find it.
start: "[[Finding Saturn]]"
---
# Night sky

A small wiki built from the notes in this vault. Notes are quick and dated; pages here are written to be read. Press E to edit this page.
""",
        "Wikis/Night sky/Finding Saturn.md": """\
---
summary: Where to look, and what the rings do over the years.
order: 1
tags: [planets]
Distance: 9.5 AU from the Sun
Moons: 146
Best seen: Around opposition
Related: "[[Planets/Saturn]]"
---
# Finding Saturn

Saturn looks like a steady, pale yellow star. It does not twinkle the way stars do.

## Where to look

Saturn stays close to the ecliptic, the path the Sun and Moon follow across the sky. It is brightest around **opposition**, when Earth passes between it and the Sun.

## The rings

The rings tilt towards us and away again over about fifteen years. When they are edge-on they almost disappear, even in a good telescope.
""",
        f"Daily/{yesterday.isoformat()}.md": """\
# {date}

- Poured the base for the [[Projects/Backyard observatory|observatory]] pier.
- Saturn was clear through the small scope; rings tilted well.
""".replace("{date}", f"{yesterday:%b} {yesterday.day}, {yesterday.year}"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dest", nargs="?", default=os.path.join(REPO_ROOT, "sample-notes"))
    parser.add_argument("--force", action="store_true", help="overwrite existing files")
    args = parser.parse_args()

    written = 0
    for rel, text in notes(dt.date.today()).items():
        full = os.path.join(args.dest, *rel.split("/"))
        if os.path.exists(full) and not args.force:
            continue
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(text)
        written += 1
    print(f"Wrote {written} notes to {args.dest}")


if __name__ == "__main__":
    main()
