import json
import os
import tempfile
import unittest

from ory import settings
from ory.config import Config
from ory.guide import write_guides
from ory.settings import State
from ory.vault import Vault, VaultError


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = self.tmp.name
        self.first = os.path.join(base, "first")
        self.second = os.path.join(base, "second")
        for folder in (self.first, self.second):
            os.makedirs(folder)
        with open(os.path.join(self.second, "Hello.md"), "w") as fh:
            fh.write("hi\n")
        self.config_path = os.path.join(base, "ory.config.json")
        with open(self.config_path, "w") as fh:
            json.dump({"notes_dir": self.first, "port": 4800}, fh)
        cfg = Config(notes_dir=self.first, config_path=self.config_path)
        self.state = State(cfg, Vault(self.first))

    def tearDown(self):
        self.tmp.cleanup()

    def saved(self):
        with open(self.config_path) as fh:
            return json.load(fh)

    def test_switching_remembers_the_folders_left(self):
        result = settings.update(self.state, {"notesDir": self.second})
        self.assertEqual(result["recentNotesDirs"], [os.path.realpath(self.first)])
        self.assertEqual(self.saved()["recent_notes_dirs"], [os.path.realpath(self.first)])
        result = settings.update(self.state, {"notesDir": self.first})
        self.assertEqual(result["recentNotesDirs"], [os.path.realpath(self.second)])  # never the open one

    def test_switching_the_notes_folder_swaps_the_vault_and_saves(self):
        result = settings.update(self.state, {"notesDir": self.second})
        self.assertEqual(result["notesDir"], os.path.realpath(self.second))
        self.assertEqual([n["path"] for n in self.state.vault.listing()["notes"]], ["Hello.md"])
        self.assertEqual(self.saved()["notes_dir"], self.second)
        self.assertEqual(self.saved()["port"], 4800)  # other settings kept

    def test_folder_names_apply_to_the_running_vault(self):
        settings.update(self.state, {"dailyFolder": "Journal", "wikisFolder": "Handbooks"})
        self.assertEqual(self.state.vault.daily_folder, "Journal")
        self.assertEqual(self.state.vault.listing()["wikisFolder"], "Handbooks")

    def test_bad_values_are_refused(self):
        for change in ({"notesDir": "relative/path"}, {"notesDir": "/no/such/folder"},
                       {"wikisFolder": ".hidden"}, {"dailyFolder": "../out"}, {"promptBudget": 10}):
            with self.assertRaises(VaultError, msg=change):
                settings.update(self.state, change)

    def test_turning_the_guide_off_removes_only_orys_files(self):
        write_guides(self.state.vault)
        settings.update(self.state, {"guides": False})
        self.assertFalse(os.path.exists(os.path.join(self.first, "AGENTS.md")))
        with open(os.path.join(self.first, "AGENTS.md"), "w") as fh:
            fh.write("My own.\n")
        settings.update(self.state, {"guides": False})
        self.assertTrue(os.path.exists(os.path.join(self.first, "AGENTS.md")))  # not Ory's, left alone


if __name__ == "__main__":
    unittest.main()
