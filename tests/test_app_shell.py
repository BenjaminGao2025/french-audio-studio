import testenv  # noqa: F401  (must be first: isolates OUTPUT_DIR and secrets)

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

import tts_service
from routers import app_shell

APP_DIR = Path(tts_service.STATIC_DIR) / "app"
INDEX = APP_DIR / "index.html"


class _Tags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


def _parse_index():
    parser = _Tags()
    parser.feed(INDEX.read_text(encoding="utf-8"))
    return parser.tags


def _entry_js():
    scripts = [a["src"] for t, a in _parse_index() if t == "script"]
    return scripts[0]


class AppShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(tts_service.app)

    def test_shell_served_for_app_root_and_deep_links(self):
        for path in ("/app", "/app/", "/app/hours", "/app/cards?block=x", "/app/login"):
            with self.subTest(path=path):
                res = self.client.get(path)
                self.assertEqual(res.status_code, 200)
                self.assertIn("text/html", res.headers["content-type"])
                self.assertIn('<div id="root">', res.text)
                self.assertIn("no-store", res.headers["cache-control"])

    def test_head_request_is_allowed(self):
        res = self.client.head("/app")
        self.assertEqual(res.status_code, 200)
        self.assertIn("no-store", res.headers["cache-control"])

    def test_shell_requires_no_login(self):
        # The SPA itself redirects to /app/login when an API call returns 401.
        self.assertEqual(self.client.get("/app/me").status_code, 200)

    def test_shell_has_no_inline_scripts(self):
        tags = _parse_index()
        scripts = [attrs for tag, attrs in tags if tag == "script"]
        self.assertGreaterEqual(len(scripts), 1)
        for attrs in scripts:
            self.assertTrue(attrs.get("src", "").startswith("/app/assets/"), attrs)
        for tag, attrs in tags:
            for name in attrs:
                self.assertFalse(name.startswith("on"), f"inline handler {name} on <{tag}>")
            for name in ("src", "href"):
                self.assertFalse(
                    re.match(r"(?i)(https?:)?//", attrs.get(name) or ""),
                    f"external {name}: {attrs.get(name)}",
                )
        # No script body either: parser text data inside <script> would show up here.
        html = INDEX.read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html))

    def test_shell_references_existing_assets(self):
        refs = re.findall(r'(?:src|href)="(/app/assets/[^"]+)"', INDEX.read_text(encoding="utf-8"))
        self.assertTrue(refs)
        for ref in refs:
            with self.subTest(ref=ref):
                self.assertTrue((APP_DIR / ref.removeprefix("/app/")).is_file())
                res = self.client.get(ref)
                self.assertEqual(res.status_code, 200)
                self.assertIn("immutable", res.headers["cache-control"])

    def test_js_asset_mime_type(self):
        res = self.client.get(_entry_js())
        self.assertEqual(res.status_code, 200)
        self.assertIn("javascript", res.headers["content-type"])

    def test_css_and_font_mime_types(self):
        css = re.search(r'href="(/app/assets/[^"]+\.css)"', INDEX.read_text(encoding="utf-8")).group(1)
        self.assertIn("text/css", self.client.get(css).headers["content-type"])
        woff2 = next((APP_DIR / "assets").glob("*.woff2")).name
        self.assertIn("font/woff2", self.client.get(f"/app/assets/{woff2}").headers["content-type"])

    def test_csp_header_on_shell_is_unchanged(self):
        for path in ("/app", _entry_js()):
            with self.subTest(path=path):
                csp = self.client.get(path).headers["content-security-policy"]
                self.assertEqual(csp, tts_service.CONTENT_SECURITY_POLICY)
        script_src = next(
            d for d in tts_service.CONTENT_SECURITY_POLICY.split("; ") if d.startswith("script-src")
        )
        self.assertNotIn("'unsafe-inline'", script_src)
        self.assertNotIn("'unsafe-eval'", script_src)

    def test_missing_asset_is_404_not_shell(self):
        for path in ("/app/assets/nope.js", "/app/nope.txt", "/app/assets/"):
            with self.subTest(path=path):
                res = self.client.get(path)
                self.assertEqual(res.status_code, 404)
                self.assertNotIn("<div id=\"root\">", res.text)

    def test_path_traversal_rejected(self):
        for path in (
            "/app/..%2f..%2ftts_service.py",
            "/app/assets/..%2f..%2f..%2fweb_common.py",
            "/app/%2e%2e%2f%2e%2e%2ftts_service.py",
            "/app/assets/..%5c..%5c..%5cweb_common.py",
        ):
            with self.subTest(path=path):
                res = self.client.get(path)
                self.assertEqual(res.status_code, 404)
                self.assertNotIn("import", res.text)

    def test_unusable_file_names_are_404_not_500(self):
        client = TestClient(tts_service.app, raise_server_exceptions=False)
        for path in ("/app/assets/%00.js", "/app/x%00.png", "/app/assets/" + "a" * 5000 + ".js"):
            with self.subTest(path=path[:40]):
                self.assertEqual(client.get(path).status_code, 404)

    def test_no_external_fonts_in_build(self):
        for path in APP_DIR.rglob("*"):
            if path.is_file() and path.suffix in {".html", ".css", ".js"}:
                text = path.read_text(encoding="utf-8", errors="ignore")
                self.assertNotIn("fonts.googleapis.com", text, path.name)
                self.assertNotIn("fonts.gstatic.com", text, path.name)
        self.assertTrue(list((APP_DIR / "assets").glob("*.woff2")))

    def test_legacy_pages_survive_build(self):
        # Guards the emptyOutDir mistake: the build must never clear static/ itself.
        for name in ("index.html", "study.html", "review.html", "landing.html", "i18n.js"):
            with self.subTest(name=name):
                self.assertTrue((Path(tts_service.STATIC_DIR) / name).is_file())
        self.assertEqual(self.client.get("/study").status_code, 200)
        self.assertEqual(self.client.get("/static/study.html").status_code, 200)

    def test_legacy_pages_with_a_nav_link_to_the_app(self):
        for name in ("index", "study", "review", "listen", "write", "speak", "coach"):
            with self.subTest(page=name):
                html = (Path(tts_service.STATIC_DIR) / f"{name}.html").read_text(encoding="utf-8")
                self.assertEqual(html.count('<a href="/app/" class="nav-tab">'), 1)
                self.assertLess(html.index('href="/app/"'), html.index('href="/coach"'))

    def test_unbuilt_frontend_gives_503_with_hint(self):
        with mock.patch.object(app_shell, "APP_DIR", APP_DIR / "does-not-exist"):
            res = self.client.get("/app/hours")
        self.assertEqual(res.status_code, 503)
        self.assertIn("npm run build", res.text)


if __name__ == "__main__":
    unittest.main()
