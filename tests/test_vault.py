import os
import shutil
import tempfile
import unittest

from ory import markdown
from ory.vault import Vault, VaultError


def write(root, rel, text):
    full = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(text)


def read(root, rel):
    with open(os.path.join(root, *rel.split("/")), encoding="utf-8") as fh:
        return fh.read()


class FrontmatterTests(unittest.TestCase):
    def test_properties(self):
        text = "---\ntitle: 'It''s here'\ntags: [a, \"b, c\"]\naliases:\n  - One\n  - Two\ncount: 3\ndone: false\nempty:\n---\nBody"
        fm, body_start = markdown.split_frontmatter(text)
        self.assertEqual(text[body_start:], "Body")
        props = markdown.parse_properties(fm)
        self.assertEqual(props["title"], "It's here")
        self.assertEqual(props["tags"], ["a", "b, c"])
        self.assertEqual(props["aliases"], ["One", "Two"])
        self.assertEqual(props["count"], 3)
        self.assertIs(props["done"], False)
        self.assertIsNone(props["empty"])

    def test_link_value_is_not_a_list(self):
        props = markdown.parse_properties('related: [[Mars]]\n')
        self.assertEqual(props["related"], "[[Mars]]")

    def test_no_frontmatter(self):
        self.assertEqual(markdown.split_frontmatter("# Title\n---\n"), (None, 0))
        self.assertEqual(markdown.split_frontmatter("---\nunterminated: yes\n"), (None, 0))


class LinkTests(unittest.TestCase):
    def test_extract(self):
        text = "See [[A]] and [[B#Head|alias]] and ![[C.png]].\n`[[code]]`\n```\n[[fenced]]\n```\n| [[D\\|x]] |"
        links = markdown.extract_links(text)
        self.assertEqual([l.target for l in links], ["A", "B", "C.png", "D"])
        self.assertEqual(text[links[1].start:links[1].end], "B")
        self.assertTrue(links[2].embed)
        self.assertEqual(links[3].line, 5)


class CodeBlockTests(unittest.TestCase):
    def targets(self, text):
        return [l.target for l in markdown.extract_links(text)]

    def test_indented_code_is_skipped(self):
        self.assertEqual(self.targets("Para [[A]]\n\n    [[Code]]\n\n[[B]]"), ["A", "B"])

    def test_nested_list_items_are_not_code(self):
        self.assertEqual(self.targets("- [[A]]\n    - [[B]]\n\t- [[C]]"), ["A", "B", "C"])

    def test_fence_in_list_and_info_string_close(self):
        text = "- item\n    ```\n    [[Code]]\n    ```\n- [[A]]\n```py\n[[X]]\n```py\n[[Y]]\n```\n[[B]]"
        self.assertEqual(self.targets(text), ["A", "B"])


class VaultTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        write(self.root, "Home.md", "Links: [[Mars]], [[Planets/Mars|red]], [[Mars#Moons]], [[Missing]]\n")
        write(self.root, "Planets/Mars.md", "---\naliases: [Red planet]\n---\nSee [[Home]].\n")
        write(self.root, "Other/Mars.md", "A second Mars.\n")
        write(self.root, "Other/Notes.md", "Local [[Mars]] and [[../Home]].\n")
        write(self.root, ".obsidian/app.md", "ignored")
        self.vault = Vault(self.root)
        self.vault.refresh()

    def tearDown(self):
        self.tmp.cleanup()

    def test_listing_skips_dot_folders(self):
        paths = [n["path"] for n in self.vault.listing()["notes"]]
        self.assertEqual(paths, ["Home.md", "Other/Mars.md", "Other/Notes.md", "Planets/Mars.md"])
        mars = next(n for n in self.vault.listing()["notes"] if n["path"] == "Planets/Mars.md")
        self.assertEqual(mars["aliases"], ["Red planet"])

    def test_suggestions_round_trip_and_refuse_stale_writes(self):
        self.assertEqual(self.vault.suggestions(), {"data": None, "rev": None})
        rev = self.vault.save_suggestions({"findings": []}, None)["rev"]
        self.assertEqual(self.vault.suggestions(), {"data": {"findings": []}, "rev": rev})
        with self.assertRaises(VaultError) as ctx:
            self.vault.save_suggestions({"findings": [1]}, None)
        self.assertEqual(ctx.exception.status, 409)
        # Kept out of the index, like any dot-folder.
        self.assertNotIn("Wikis/.ory", self.vault.listing()["folders"])

    def test_read_many_skips_unknown_paths(self):
        notes = self.vault.read_many(["Home.md", "Nope.md", 3])
        self.assertEqual([n["path"] for n in notes], ["Home.md"])
        self.assertIn("text", notes[0])

    def test_listing_names_the_wikis_folder(self):
        self.assertEqual(self.vault.listing()["wikisFolder"], "Wikis")
        self.assertEqual(Vault(self.root, wikis_folder="/Handbooks/").listing()["wikisFolder"], "Handbooks")

    def test_resolve(self):
        v = self.vault
        self.assertEqual(v.resolve("Mars", "Home.md"), "Other/Mars.md")  # shortest path, then name
        self.assertEqual(v.resolve("Mars", "Other/Notes.md"), "Other/Mars.md")  # same folder wins
        self.assertEqual(v.resolve("mars", "Planets/x.md"), "Planets/Mars.md")
        self.assertEqual(v.resolve("Planets/Mars"), "Planets/Mars.md")
        self.assertEqual(v.resolve("../Home", "Other/Notes.md"), "Home.md")
        self.assertIsNone(v.resolve("Missing"))

    def test_backlinks(self):
        backlinks = self.vault.backlinks("Home.md")
        self.assertEqual([b["path"] for b in backlinks], ["Other/Notes.md", "Planets/Mars.md"])
        self.assertEqual(backlinks[1]["lines"][0]["text"], "See [[Home]].")

    def test_rename_updates_links(self):
        result = self.vault.move("Planets/Mars.md", "Planets/Ares")
        self.assertEqual(result["path"], "Planets/Ares.md")
        self.assertEqual(result["updated"], ["Home.md"])
        # Only the link that pointed at Planets/Mars changes; the others resolved elsewhere.
        self.assertEqual(read(self.root, "Home.md"),
                         "Links: [[Mars]], [[Ares|red]], [[Mars#Moons]], [[Missing]]\n")

    def test_folder_move_keeps_links_working(self):
        self.vault.move("Other", "Archive/Other")
        self.assertEqual(self.vault.resolve("../Home", "Archive/Other/Notes.md"), None)
        self.assertEqual(read(self.root, "Archive/Other/Notes.md"), "Local [[Mars]] and [[Home]].\n")

    def test_save_conflict(self):
        note = self.vault.get("Home.md")
        self.vault.save("Home.md", "one", note.rev)
        with self.assertRaises(VaultError) as ctx:
            self.vault.save("Home.md", "two", note.rev)
        self.assertEqual(ctx.exception.status, 409)
        self.assertEqual(read(self.root, "Home.md"), "one")

    def test_paths_stay_inside_vault(self):
        for bad in ("../x.md", "/etc/passwd", "a/../../x.md"):
            with self.assertRaises(VaultError):
                self.vault.get(bad)
        with self.assertRaises(VaultError):
            self.vault.create("Bad: name")

    def test_save_refuses_files_that_are_not_notes(self):
        write(self.root, ".obsidian/app.json", "{}")
        with self.assertRaises(VaultError):
            self.vault.save(".obsidian/app.json", "x", None)
        self.assertEqual(read(self.root, ".obsidian/app.json"), "{}")

    def test_rename_moves_a_symlink_not_its_target(self):
        os.symlink(os.path.join(self.root, "Other", "Mars.md"), os.path.join(self.root, "Link.md"))
        self.vault.move("Link.md", "Renamed")
        self.assertTrue(os.path.islink(os.path.join(self.root, "Renamed.md")))
        self.assertTrue(os.path.isfile(os.path.join(self.root, "Other", "Mars.md")))

    def test_relative_link_above_root(self):
        self.assertIsNone(self.vault.resolve("../../Home", "Other/Notes.md"))

    def test_daily_and_archive(self):
        note, created = self.vault.daily("2026-09-27")
        self.assertTrue(created)
        self.assertEqual(note.path, "Daily/2026-09-27.md")
        self.assertFalse(self.vault.daily("2026-09-27")[1])
        self.assertEqual(self.vault.archive("Daily/2026-09-27.md"), ".archive/2026-09-27.md")
        self.assertNotIn("Daily/2026-09-27.md", [n["path"] for n in self.vault.listing()["notes"]])

    def test_archive_restores_to_where_it_was(self):
        self.vault.archive("Other/Mars.md", now=1000.0)
        [item] = self.vault.archived(now=2000.0)
        self.assertEqual((item["kind"], item["name"], item["from"]), ("note", "Mars", "Other/Mars.md"))
        self.assertEqual(item["deletesAt"], 1000.0 + 30 * 86400)
        shutil.rmtree(os.path.join(self.root, "Other"))  # its folder is gone meanwhile
        self.assertEqual(self.vault.restore(item["id"]), "Other/Mars.md")
        self.assertIn("Other/Mars.md", [n["path"] for n in self.vault.listing()["notes"]])
        self.assertEqual(self.vault.archived(now=2000.0), [])

    def test_restore_beside_a_note_of_the_same_name(self):
        self.vault.archive("Other/Mars.md")
        write(self.root, "Other/Mars.md", "a new Mars\n")
        self.vault.refresh()
        [item] = self.vault.archived()
        self.assertEqual(self.vault.restore(item["id"]), "Other/Mars 1.md")
        self.assertEqual(read(self.root, "Other/Mars.md"), "a new Mars\n")

    def test_archive_deletes_after_thirty_days(self):
        self.vault.archive("Other/Mars.md", now=1000.0)
        self.assertEqual(len(self.vault.archived(now=1000.0 + 30 * 86400 - 1)), 1)
        self.assertEqual(self.vault.archived(now=1000.0 + 30 * 86400), [])
        self.assertFalse(os.path.exists(os.path.join(self.root, ".archive", "Mars.md")))

    def test_archived_folders_and_wikis(self):
        write(self.root, "Wikis/Night sky/Home.md", "# Night sky\n")
        write(self.root, "Wikis/Night sky/Saturn.md", "# Saturn\n")
        self.vault.refresh()
        self.vault.archive("Wikis/Night sky")
        self.vault.archive("Other")
        kinds = {i["name"]: (i["kind"], i["notes"]) for i in self.vault.archived()}
        self.assertEqual(kinds, {"Night sky": ("wiki", 2), "Other": ("folder", 2)})

    def test_things_already_in_the_archive_folder_are_kept(self):
        write(self.root, ".archive/Course/Lesson.md", "a lesson\n")
        [item] = self.vault.archived(now=1000.0)
        self.assertEqual((item["name"], item["archivedAt"], item["deletesAt"]), ("Course", None, None))
        self.assertEqual(len(self.vault.archived(now=1000.0 + 365 * 86400)), 1)  # never deleted on its own
        self.assertTrue(os.path.isfile(os.path.join(self.root, ".archive", "Course", "Lesson.md")))

    def test_old_trash_moves_into_the_archive(self):
        write(self.root, ".trash/Old.md", "old\n")
        [item] = self.vault.archived(now=5000.0)
        self.assertEqual((item["name"], item["from"], item["archivedAt"]), ("Old", None, 5000.0))
        self.assertFalse(os.path.exists(os.path.join(self.root, ".trash")))
        self.assertEqual(self.vault.restore(item["id"]), "Old.md")

    def test_delete_archived_and_bad_ids(self):
        self.vault.archive("Other/Mars.md")
        [item] = self.vault.archived()
        for bad in ("../Home.md", ".archive.json", "Nothing.md", None):
            with self.assertRaises(VaultError):
                self.vault.delete_archived(bad)
        self.vault.delete_archived(item["id"])
        self.assertEqual(self.vault.archived(), [])
        self.assertTrue(os.path.isfile(os.path.join(self.root, "Home.md")))

    def test_search(self):
        results = self.vault.search('mars "second"')
        self.assertEqual([r["path"] for r in results], ["Other/Mars.md"])
        match = results[0]["matches"][0]
        self.assertEqual([match["text"][a:b].lower() for a, b in match["ranges"]], ["second", "mars"])

    def test_external_edit_is_picked_up(self):
        version = self.vault.version
        write(self.root, "New.md", "[[Home]]")
        self.assertGreater(self.vault.refresh(), version)
        self.assertIn("New.md", [b["path"] for b in self.vault.backlinks("Home.md")])


if __name__ == "__main__":
    unittest.main()
