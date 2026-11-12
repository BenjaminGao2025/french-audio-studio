"""The React SPA at /app (source web/, built into static/app by the Docker build).

The build is not in git, so these tests serve a small fake build from a temporary APP_DIR.
"""

import re
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

import testenv  # noqa: F401  (sets AUTH_SECRET / OUTPUT_DIR before the app is imported)
from fastapi.testclient import TestClient

import tts_service
from routers import app_shell, pages

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

FAKE_INDEX = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>1000H French</title>
    <script type="module" crossorigin src="/app/assets/index-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="/app/assets/index-abc123.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
"""


class _Tags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class AppShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(tmp.cleanup)
        cls.app_dir = Path(tmp.name).resolve() / "app"
        assets = cls.app_dir / "assets"
        assets.mkdir(parents=True)
        (cls.app_dir / "index.html").write_text(FAKE_INDEX, encoding="utf-8")
        (assets / "index-abc123.js").write_text("console.log('app');", encoding="utf-8")
        (assets / "index-abc123.css").write_text("body{margin:0}", encoding="utf-8")
        (assets / "font-abc123.woff2").write_bytes(b"wOF2")
        (cls.app_dir / "robots.txt").write_text("User-agent: *", encoding="utf-8")
        patcher = mock.patch.object(app_shell, "APP_DIR", cls.app_dir)
        patcher.start()
        cls.addClassCleanup(patcher.stop)
        cls.client = TestClient(tts_service.app)

    def test_shell_served_for_app_root_and_deep_links(self):
        for path in ("/app", "/app/", "/app/index.html", "/app/study", "/app/review/session", "/app/progress/history?tab=x", "/app/login"):
            with self.subTest(path=path):
                res = self.client.get(path, follow_redirects=False)
                self.assertEqual(res.status_code, 200)
                self.assertIn("text/html", res.headers["content-type"])
                self.assertIn('<div id="root">', res.text)
                self.assertIn("no-store", res.headers["cache-control"])

    def test_head_request_is_allowed(self):
        res = self.client.head("/app")
        self.assertEqual(res.status_code, 200)
        self.assertIn("no-store", res.headers["cache-control"])

    def test_public_and_app_pages_still_send_no_store(self):
        # The stale "/" + "/study" no-cache block in the security middleware is gone; the pages
        # that really need no-store still get it from pages._html_page and the SPA shell itself.
        for path in ("/privacy", "/app/study"):
            with self.subTest(path=path):
                res = self.client.get(path, follow_redirects=False)
                self.assertEqual(res.status_code, 200)
                self.assertIn("no-store", res.headers["cache-control"])
        # "/" and "/study" are now redirects, so the old middleware block must not fire on them.
        for path in ("/", "/study"):
            with self.subTest(path=path):
                res = self.client.get(path, follow_redirects=False)
                self.assertEqual(res.status_code, 302)
                self.assertNotIn("no-store", res.headers.get("cache-control", ""))

    def test_shell_requires_no_login(self):
        # The SPA itself redirects to /app/login when an API call returns 401.
        self.assertEqual(self.client.get("/app/settings").status_code, 200)

    def test_assets_are_immutable_with_explicit_types(self):
        for path, kind in (
            ("/app/assets/index-abc123.js", "javascript"),
            ("/app/assets/index-abc123.css", "text/css"),
            ("/app/assets/font-abc123.woff2", "font/woff2"),
        ):
            with self.subTest(path=path):
                res = self.client.get(path)
                self.assertEqual(res.status_code, 200)
                self.assertIn(kind, res.headers["content-type"])
                self.assertIn("immutable", res.headers["cache-control"])

    def test_top_level_file_is_served_without_immutable_cache(self):
        res = self.client.get("/app/robots.txt")
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/plain", res.headers["content-type"])
        self.assertNotIn("immutable", res.headers.get("cache-control", ""))

    def test_csp_header_on_shell_is_unchanged(self):
        for path in ("/app", "/app/assets/index-abc123.js"):
            with self.subTest(path=path):
                csp = self.client.get(path).headers["content-security-policy"]
                self.assertEqual(csp, tts_service.CONTENT_SECURITY_POLICY)
        script_src = next(d for d in tts_service.CONTENT_SECURITY_POLICY.split("; ") if d.startswith("script-src"))
        self.assertNotIn("'unsafe-inline'", script_src)
        self.assertNotIn("'unsafe-eval'", script_src)

    def test_missing_asset_is_404_not_shell(self):
        for path in ("/app/assets/nope.js", "/app/nope.txt", "/app/assets/"):
            with self.subTest(path=path):
                res = self.client.get(path)
                self.assertEqual(res.status_code, 404)
                self.assertNotIn('<div id="root">', res.text)

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

    def test_unbuilt_frontend_gives_503_with_hint(self):
        with mock.patch.object(app_shell, "APP_DIR", self.app_dir / "does-not-exist"):
            res = self.client.get("/app/study")
        self.assertEqual(res.status_code, 503)
        self.assertIn("npm run build", res.text)

    def test_old_pages_redirect_into_the_app(self):
        for old, new in pages.OLD_PAGES.items():
            res = self.client.get(old, follow_redirects=False)
            self.assertEqual(res.status_code, 302, old)
            self.assertEqual(res.headers["location"], new, old)
        self.assertEqual(self.client.get("/", follow_redirects=False).headers["location"], "/app/study")
        self.assertEqual(self.client.get("/static/study.html").status_code, 404)


class WebSourceTests(unittest.TestCase):
    """The SPA source must build into something the site's CSP allows."""

    def test_index_has_no_inline_scripts_or_external_urls(self):
        html = (WEB / "index.html").read_text(encoding="utf-8")
        parser = _Tags()
        parser.feed(html)
        scripts = [attrs for tag, attrs in parser.tags if tag == "script"]
        self.assertEqual([a.get("src") for a in scripts], ["/static/pwa-register.js?v=1.3.2", "/src/main.tsx"])
        for tag, attrs in parser.tags:
            for name in attrs:
                self.assertFalse(name.startswith("on"), f"inline handler {name} on <{tag}>")
            for name in ("src", "href"):
                self.assertFalse(re.match(r"(?i)(https?:)?//", attrs.get(name) or ""), f"external {name}")
        self.assertIsNone(re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html))

    def test_vite_builds_under_app(self):
        config = (WEB / "vite.config.ts").read_text(encoding="utf-8")
        self.assertIn('base: "/app/"', config)
        self.assertIn('outDir: "dist"', config)

    def test_no_external_fonts_in_source(self):
        for path in (WEB / "src").rglob("*"):
            if path.is_file() and path.suffix in {".css", ".ts", ".tsx"}:
                text = path.read_text(encoding="utf-8")
                self.assertNotIn("fonts.googleapis.com", text, path.name)
                self.assertNotIn("fonts.gstatic.com", text, path.name)

    def test_build_output_is_not_committed(self):
        ignored = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
        for entry in ("static/app/", "web/dist/", "web/node_modules/"):
            self.assertIn(entry, ignored)


if __name__ == "__main__":
    unittest.main()
