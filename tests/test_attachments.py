import http.client
import io
import json
import os
import tempfile
import threading
import unittest

from ory import markdown
from ory.server import make_server
from ory.vault import Vault, VaultError


def write(root, rel, data):
    full = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb" if isinstance(data, bytes) else "w") as fh:
        fh.write(data)


class AttachmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        write(self.root, "Home.md", "Chart: ![[chart.png]] and [[Specs/manual.pdf]] #reference\n")
        write(self.root, "Specs/manual.pdf", b"%PDF-1.4")
        write(self.root, "Attachments/chart.png", b"\x89PNG")
        write(self.root, "v1.2.md", "A note whose name looks like it has an extension.")
        self.vault = Vault(self.root)
        self.vault.refresh()

    def tearDown(self):
        self.tmp.cleanup()

    def test_listing_and_resolution(self):
        listing = self.vault.listing()
        self.assertEqual([f["path"] for f in listing["files"]], ["Attachments/chart.png", "Specs/manual.pdf"])
        self.assertEqual(self.vault.resolve("chart.png"), "Attachments/chart.png")
        self.assertEqual(self.vault.resolve("Specs/manual.pdf"), "Specs/manual.pdf")
        self.assertEqual(self.vault.resolve("v1.2"), "v1.2.md")
        home = next(n for n in listing["notes"] if n["path"] == "Home.md")
        self.assertEqual(home["tags"], ["reference"])
        self.assertEqual(home["links"], ["Attachments/chart.png", "Specs/manual.pdf"])

    def test_add_file_picks_a_free_name(self):
        first = self.vault.add_file("chart.png", io.BytesIO(b"abc"), 3)
        self.assertEqual(first.path, "Attachments/chart 1.png")
        odd = self.vault.add_file("a:b#c.txt", io.BytesIO(b"x"), 1, folder="")
        self.assertEqual(odd.path, "a-b-c.txt")
        with self.assertRaises(VaultError):
            self.vault.add_file("sneaky.md", io.BytesIO(b"x"), 1)

    def test_attachments_folder_setting(self):
        self.assertEqual(self.vault.attachments_folder("Projects/Plan.md"), "Attachments")
        beside = Vault(self.root, attachments_folder="./assets")
        self.assertEqual(beside.attachments_folder("Projects/Plan.md"), "Projects/assets")
        self.assertEqual(Vault(self.root, attachments_folder="/").attachments_folder("x.md"), "")

    def test_renaming_a_file_updates_embeds(self):
        self.vault.move("Attachments/chart.png", "Attachments/lead times.png")
        with open(os.path.join(self.root, "Home.md")) as fh:
            self.assertIn("![[lead times.png]]", fh.read())

    def test_tags_skip_headings_code_and_links(self):
        text = "# Heading\n`#code` [[Note#Section]] http://x.com/#frag #real #2026 #a/b\n```\n#fenced\n```"
        self.assertEqual(markdown.extract_tags(text), ["real", "a/b"])


class UploadServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Vault(self.tmp.name)
        self.server = make_server(self.vault, 0)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        data = response.read()
        conn.close()
        return response, data

    def test_upload_then_serve(self):
        response, data = self.request("POST", "/api/files?name=shot.png", b"\x89PNG", {"X-Ory-Upload": "1"})
        self.assertEqual(response.status, 201)
        self.assertEqual(json.loads(data)["path"], "Attachments/shot.png")
        response, data = self.request("GET", "/files/Attachments/shot.png")
        self.assertEqual((response.status, data), (200, b"\x89PNG"))
        self.assertIn("sandbox", response.getheader("Content-Security-Policy"))

    def test_html_pages_are_shown_sandboxed(self):
        write(self.tmp.name, "Pages/Model.html", "<script>1</script>")
        response, data = self.request("GET", "/files/Pages/Model.html")
        self.assertEqual(response.status, 200)
        self.assertIsNone(response.getheader("Content-Disposition"))
        policy = response.getheader("Content-Security-Policy")
        self.assertTrue(policy.startswith("sandbox allow-scripts"))
        self.assertNotIn("allow-same-origin", policy)
        self.assertIn("connect-src 'none'", policy)

    def test_upload_needs_header_and_origin(self):
        response, _ = self.request("POST", "/api/files?name=a.png", b"x")
        self.assertEqual(response.status, 403)
        response, _ = self.request("POST", "/api/files?name=a.png", b"x",
                                   {"X-Ory-Upload": "1", "Origin": "http://evil.example"})
        self.assertEqual(response.status, 403)

    def test_serving_refuses_notes_folder_escapes_and_dotfiles(self):
        write(self.tmp.name, ".obsidian/app.json", "{}")
        for path in ("/files/../ory.config.json", "/files/.obsidian/app.json", "/files/%2e%2e/x"):
            response, _ = self.request("GET", path)
            self.assertIn(response.status, (400, 404), path)


if __name__ == "__main__":
    unittest.main()
