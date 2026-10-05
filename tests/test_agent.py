import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

from ory import cli, mcp
from ory.agent import Agent
from ory.guide import MARKER, agents_md, write_guides
from ory.vault import Vault, VaultError


def write(root, rel, text):
    full = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(text)


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        write(self.root, "Daily/2026-09-27.md", "Saturn rose at 21:40.\n")
        write(self.root, "Planets/Saturn.md", "# Saturn\n\nSee [[Mars]].\n")
        write(self.root, "Planets/Mars.md", "# Mars\n")
        write(self.root, "Wikis/Night sky/Home.md", "---\nsummary: What to see.\n---\n")
        write(self.root, "Wikis/Night sky/Finding Saturn.md", "---\nsummary: Where to look.\n---\n# Finding Saturn\n")
        self.vault = Vault(self.root)
        self.agent = Agent(self.vault)

    def tearDown(self):
        self.tmp.cleanup()

    def test_read_write_append(self):
        note = self.agent.read("Planets/Saturn")
        self.assertEqual(note["links"], ["Planets/Mars.md"])
        self.assertEqual(self.agent.write("Planets/Saturn", "new\n", note["rev"])["created"], False)
        with self.assertRaises(VaultError):
            self.agent.write("Planets/Saturn", "stale\n", note["rev"])  # changed since that rev
        self.assertTrue(self.agent.write("Ideas", "one")["created"])
        self.agent.append("Ideas", "two")
        self.assertEqual(self.agent.read("Ideas")["text"], "one\ntwo\n")
        self.assertTrue(self.agent.append("Fresh", "hello")["created"])

    def test_move_rewrites_links_and_archive_keeps_files(self):
        result = self.agent.move("Planets/Mars.md", "Planets/Red planet.md")
        self.assertIn("Planets/Saturn.md", result["updated"])
        self.assertIn("[[Red planet]]", self.agent.read("Planets/Saturn")["text"])
        archived = self.agent.archive("Planets/Red planet.md")["archived"]
        self.assertTrue(archived.startswith(".archive/"))
        self.assertTrue(os.path.exists(os.path.join(self.root, archived)))
        [item] = self.agent.archived()["items"]
        self.assertEqual(self.agent.restore(item["id"]), {"path": "Planets/Red planet.md"})

    def test_wikis_and_backlinks(self):
        wikis = self.agent.wikis()
        self.assertEqual([w["name"] for w in wikis], ["Night sky"])
        self.assertEqual(wikis[0]["summary"], "What to see.")
        self.assertEqual([p["title"] for p in wikis[0]["pages"]], ["Finding Saturn"])
        backlinks = self.agent.backlinks("Planets/Mars")
        self.assertEqual(backlinks[0]["lines"][0]["line"], 3)  # numbered from 1

    def test_suggest_files_findings_and_drafts_and_marks_read(self):
        self.assertEqual({n["path"] for n in self.agent.unread()},
                         {"Daily/2026-09-27.md", "Planets/Saturn.md", "Planets/Mars.md"})
        result = self.agent.suggest(
            findings=[{"kind": "add to page", "wiki": "Night sky", "page": "Finding Saturn",
                       "title": "Rising time", "sources": ["Daily/2026-09-27", "Nope.md"]}],
            drafts=[{"path": "Wikis/Night sky/Finding Saturn.md", "text": "# Finding Saturn\n\nRises at 21:40.",
                     "changes": [{"section": "Top", "reason": "adds the time"}]}],
            read=["Daily/2026-09-27.md"],
        )
        self.assertEqual(len(result["findings"]), 1)
        data = self.vault.suggestions()["data"]
        finding = data["findings"][0]
        self.assertEqual((finding["kind"], finding["status"]), ("add", "open"))
        self.assertEqual(finding["sources"], ["Daily/2026-09-27.md"])  # unknown notes dropped
        draft = data["drafts"][0]
        self.assertIn("summary: Where to look.", draft["base"])
        self.assertTrue(draft["text"].endswith("\n"))
        self.assertNotIn("Daily/2026-09-27.md", {n["path"] for n in self.agent.unread()})
        self.assertEqual(len(self.agent.suggestions()["open"]), 1)

    def test_suggest_refuses_bad_input(self):
        with self.assertRaises(VaultError):
            self.agent.suggest(findings=[{"kind": "rumour", "title": "x"}])
        with self.assertRaises(VaultError):
            self.agent.suggest(drafts=[{"path": "Planets/Saturn.md", "text": "x"}])  # not in a wiki
        with self.assertRaises(VaultError):
            self.agent.suggest(drafts=[{"path": "Wikis/.ory/x.md", "text": "x"}])


class GuideTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        write(self.root, "Note.md", "x\n")
        self.vault = Vault(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_guides_are_written_kept_current_and_left_alone_without_the_marker(self):
        self.assertEqual(write_guides(self.vault), ["AGENTS.md", "CLAUDE.md"])
        self.assertEqual(write_guides(self.vault), [])  # already current
        with open(os.path.join(self.root, "AGENTS.md"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertTrue(text.startswith(MARKER))
        self.assertIn("python3 -m ory --notes", text)
        write(self.root, "AGENTS.md", "My own rules.\n")
        write_guides(self.vault)
        with open(os.path.join(self.root, "AGENTS.md"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "My own rules.\n")
        paths = [n["path"] for n in self.vault.listing()["notes"]]
        self.assertEqual(paths, ["Note.md"])  # the guides are not notes

    def test_guide_tells_agents_how_long_the_archive_keeps_things(self):
        self.assertIn("deletes 30 days after", agents_md(self.vault))
        self.vault.archive_days = 0
        text = agents_md(self.vault)
        self.assertIn("keeps until the person deletes them", text)
        self.assertNotIn("30 days", text)


class InterfaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        write(self.root, "Planets/Saturn.md", "# Saturn\n\nRings of ice.\n")
        self.vault = Vault(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *argv, stdin=""):
        out = io.StringIO()
        with redirect_stdout(out), mock.patch("sys.stdin", io.StringIO(stdin)):
            code = cli.run(self.vault, list(argv))
        return code, out.getvalue()

    def test_cli_prints_json_and_errors(self):
        code, out = self.run_cli("search", "rings")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)[0]["path"], "Planets/Saturn.md")
        code, out = self.run_cli("write", "Ideas", stdin="Telescope.\n")
        self.assertEqual(json.loads(out)["created"], True)
        code, out = self.run_cli("read", "Nope")
        self.assertEqual(code, 1)
        self.assertIn("error", json.loads(out))

    def test_mcp_handshake_and_tools(self):
        lines = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "read_note", "arguments": {"path": "Planets/Saturn"}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "read_note", "arguments": {"path": "Nope"}}},
            {"jsonrpc": "2.0", "id": 5, "method": "nothing"},
        ]
        out = io.StringIO()
        mcp.serve(self.vault, io.StringIO("\n".join(json.dumps(l) for l in lines) + "\n"), out)
        replies = [json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual([r["id"] for r in replies], [1, 2, 3, 4, 5])  # no reply to the notification
        self.assertEqual(replies[0]["result"]["protocolVersion"], "2025-06-18")
        self.assertIn("Working in this notes folder", replies[0]["result"]["instructions"])
        self.assertIn("suggest", [t["name"] for t in replies[1]["result"]["tools"]])
        self.assertIn("Rings of ice", json.loads(replies[2]["result"]["content"][0]["text"])["text"])
        self.assertTrue(replies[3]["result"]["isError"])
        self.assertEqual(replies[4]["error"]["code"], -32601)


if __name__ == "__main__":
    unittest.main()


class HardeningTests(unittest.TestCase):
    """Bugs found in review, kept fixed."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        write(self.root, "projects/Plan.md", "plan\n")
        write(self.root, "Index.md", "See [[projects/Plan]].\n")
        write(self.root, ".git/config", "[remote] url=https://token@host\n")
        self.vault = Vault(self.root)
        self.agent = Agent(self.vault)

    def tearDown(self):
        self.tmp.cleanup()

    def test_dot_folders_stay_private(self):
        with self.assertRaises(VaultError):
            self.vault.file_path("x\\..\\.git\\config")  # a backslash is still a path separator
        for path in (".git", ".archive", "x/../.git"):
            with self.assertRaises(VaultError):
                self.agent.archive(path)
        with self.assertRaises(VaultError):
            self.agent.move(".git", "Visible")

    def test_existing_folder_case_is_reused(self):
        created = self.agent.write("Projects/Idea", "idea\n")
        self.assertEqual(created["path"], "projects/Idea.md")
        self.assertTrue(os.path.exists(os.path.join(self.root, "projects", "Idea.md")))

    def test_move_accepts_paths_as_typed(self):
        result = self.agent.move("projects/", "Work")
        self.assertEqual(result["path"], "Work")
        self.assertEqual(self.agent.read("Index")["links"], ["Work/Plan.md"])  # the link follows
        self.agent.move("Index", "Home")  # no ".md"
        self.assertEqual(self.agent.read("Home")["path"], "Home.md")

    def test_append_keeps_windows_line_endings(self):
        with open(os.path.join(self.root, "Win.md"), "wb") as fh:
            fh.write(b"one\r\ntwo\r\n")
        self.agent.append("Win", "three")
        with open(os.path.join(self.root, "Win.md"), "rb") as fh:
            self.assertEqual(fh.read(), b"one\r\ntwo\r\nthree\r\n")

    def test_drafts_can_answer_findings_in_the_same_call(self):
        write(self.root, "Wikis/Sky/Home.md", "# Sky\n")
        result = self.agent.suggest(
            findings=[{"kind": "add", "wiki": "Sky", "page": "Home", "title": "More"}],
            drafts=[{"path": "Wikis/Sky/Home.md", "text": "# Sky\n\nMore.\n", "findingIds": [0]}],
        )
        data = self.vault.suggestions()["data"]
        self.assertEqual(data["drafts"][0]["findingIds"], result["findings"])
        self.assertEqual(data["findings"][0]["status"], "drafted")
        with self.assertRaises(VaultError):
            self.agent.suggest(findings=["just a string"])
        with self.assertRaises(VaultError):
            self.agent.suggest(drafts=[{"path": "Wikis/Sky/Home.md", "text": "x", "changes": ["s"]}])

    def test_mcp_survives_bad_calls(self):
        calls = [
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "write_note", "arguments": {"path": "Index.md/child", "text": "x"}}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "append_to_note", "arguments": {"path": "Index", "text": None}}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "todays_note", "arguments": ["x"]}},
            5,
            {"jsonrpc": "2.0", "id": 4, "method": "ping"},
        ]
        out = io.StringIO()
        mcp.serve(self.vault, io.StringIO("\n".join(json.dumps(c) for c in calls) + "\n"), out)
        replies = [json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual(len(replies), 5)
        self.assertTrue(all(r["result"]["isError"] for r in replies[:3]))
        self.assertEqual(replies[3]["error"]["code"], -32600)
        self.assertEqual(replies[4]["result"], {})

    def test_cli_argument_errors_are_json(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = cli.run(self.vault, ["search", "--foo", "x"])
        self.assertEqual(code, 1)
        self.assertIn("error", json.loads(out.getvalue()))
