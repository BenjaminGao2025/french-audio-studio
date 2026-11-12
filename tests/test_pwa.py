import json
import pathlib
import shutil
import struct
import subprocess
from unittest.mock import patch
import unittest
from urllib.parse import urlsplit

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.responses import Response

import routers.pages
import routers.app_shell
import tts_service
import web_common

STATIC = pathlib.Path(web_common.STATIC_DIR)


def _png_size(path):
    data = path.read_bytes()[:24]
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", data[16:24])


class PwaTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_manifest_is_installable(self):
        res = self.client.get("/manifest.webmanifest")
        self.assertEqual(res.status_code, 200)
        self.assertIn("application/manifest+json", res.headers["content-type"])
        m = json.loads(res.text)
        self.assertEqual((m["start_url"], m["scope"], m["display"]), ("/app/study", "/app/", "standalone"))
        self.assertEqual(m["id"], "/app/study")
        self.assertEqual(m["name"], "1000H French")
        self.assertEqual(m["theme_color"], "#f7f4ee")
        self.assertEqual(m["background_color"], "#f7f4ee")
        self.assertEqual(res.headers["cache-control"], "no-cache")
        sizes = {(i["sizes"], i["purpose"]) for i in m["icons"]}
        self.assertIn(("192x192", "any"), sizes)
        self.assertIn(("512x512", "any"), sizes)
        self.assertIn(("512x512", "maskable"), sizes)
        for icon in m["icons"]:
            w, h = _png_size(STATIC / urlsplit(icon["src"]).path.removeprefix("/static/"))
            self.assertEqual(f"{w}x{h}", icon["sizes"])
            response = self.client.get(icon["src"])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "image/png")
        self.assertEqual(_png_size(STATIC / "pwa" / "apple-touch-icon.png"), (180, 180))

    def test_every_page_has_ios_app_tags(self):
        for path in ("/home", "/privacy", "/for-institutions"):
            html = self.client.get(path).text
            for tag in (
                'rel="manifest"',
                'name="apple-mobile-web-app-capable" content="yes"',
                'name="mobile-web-app-capable" content="yes"',
                'name="apple-mobile-web-app-status-bar-style" content="default"',
                'name="apple-mobile-web-app-title" content="1000H French"',
                'name="theme-color" content="#f7f4ee"',
                'rel="apple-touch-icon"',
                "viewport-fit=cover",
                "/static/pwa-register.js?v=" + routers.pages.ASSET_VERSION,
            ):
                self.assertIn(tag, html, (path, tag))
            self.assertEqual(html.count('rel="manifest"'), 1)

    def test_service_worker_is_versioned_and_never_caches_dynamic_routes(self):
        res = self.client.get("/sw.js")
        self.assertEqual(res.status_code, 200)
        self.assertIn("javascript", res.headers["content-type"])
        self.assertEqual(res.headers["cache-control"], "no-cache")
        src = res.text
        self.assertIn(f"const VERSION = '{routers.pages.ASSET_VERSION}';", src)
        self.assertNotIn("__ASSET_VERSION__", src)
        self.assertIn("self.skipWaiting()", src)
        self.assertIn("self.clients.claim()", src)
        pages = src.split("const PAGES = new Set(")[1].split(")")[0]
        for dynamic in ("/api", "/tts", "/files", "/episodes", "/auth"):
            self.assertNotIn(f"'{dynamic}", pages)
        # Only versioned /static/ files are cached; everything else is left to the network
        self.assertIn("url.pathname.startsWith('/static/') && url.searchParams.get('v') === VERSION", src)

    def test_csp_allows_worker_and_manifest(self):
        csp = self.client.get("/home").headers["content-security-policy"]
        self.assertIn("worker-src 'self'", csp)
        self.assertIn("manifest-src 'self'", csp)

    def test_lucide_is_local_versioned_and_served_on_every_page(self):
        paths = ("/home", "/privacy", "/for-institutions")
        script = "/static/vendor/lucide.min.js?v=" + routers.pages.ASSET_VERSION
        for path in paths:
            response = self.client.get(path)
            self.assertIn(script, response.text, path)
            self.assertNotIn("unpkg.com", response.headers["content-security-policy"])
        response = self.client.get(script)
        self.assertEqual(response.status_code, 200)
        self.assertIn("lucide", response.text[:200].lower())

    def test_asset_version_includes_nested_scripts(self):
        import tempfile
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            vendor = root / "vendor"
            vendor.mkdir()
            script = vendor / "lucide.min.js"
            script.write_text("one", encoding="utf-8")
            with patch.object(routers.pages, "STATIC_DIR", root):
                first = routers.pages._asset_version()
                script.write_text("two", encoding="utf-8")
                self.assertNotEqual(first, routers.pages._asset_version())

    def test_spa_source_and_built_shell_have_ios_tags(self):
        web = pathlib.Path(__file__).resolve().parents[1] / "web"
        indexes = [web / "index.html"]
        if (web / "dist" / "index.html").is_file():
            indexes.append(web / "dist" / "index.html")
        for index in indexes:
            html = index.read_text()
            for tag in (
                'name="apple-mobile-web-app-capable" content="yes"',
                'name="mobile-web-app-capable" content="yes"',
                'name="apple-mobile-web-app-status-bar-style" content="default"',
                'name="apple-mobile-web-app-title" content="1000H French"',
                'name="theme-color" content="#f7f4ee" media="(prefers-color-scheme: light)"',
                'name="theme-color" content="#141a23" media="(prefers-color-scheme: dark)"',
                '<script src="/static/theme-boot.js"></script>',
                'rel="apple-touch-icon"', 'viewport-fit=cover',
                '/static/pwa-register.js?v=1.3.2',
            ):
                self.assertIn(tag, html, (index, tag))
            self.assertEqual(html.count('rel="manifest"'), 1)
            with patch.object(routers.app_shell, "APP_DIR", index.parent):
                for path in ("/app", "/app/study", "/app/index.html"):
                    res = self.client.get(path)
                    self.assertEqual(res.status_code, 200)
                    self.assertEqual(res.text, html)
                    self.assertIn("no-store", res.headers["cache-control"])

    def test_service_worker_leaves_sensitive_routes_and_spa_on_network(self):
        # Execute the actual fetch handler: assertions about comments alone cannot prove safety.
        src = (STATIC / "sw.js").read_text()
        script = """
const vm = require('node:vm');
const assert = require('node:assert/strict');
const handlers = {};
vm.runInNewContext(SOURCE, {
    URL, self: {location: {origin: 'https://example.test'},
        addEventListener: (name, handler) => handlers[name] = handler}
});
for (const path of ['/api/study', '/tts', '/files/a.mp3', '/auth/login',
                    '/users.db', '/episodes', '/app', '/app/study', '/app/index.html',
                    '/app/assets/index-hash.js', '/static/plain.js',
                    '/static/versioned.js?v=wrong']) {
    for (const mode of ['navigate', 'cors']) {
        let intercepted = false;
        handlers.fetch({request: {method: 'GET', url: 'https://example.test' + path, mode},
            respondWith: () => intercepted = true});
        assert.equal(intercepted, false, path + ' ' + mode);
    }
}
""".replace("SOURCE", json.dumps(src), 1)
        # The production Python image has no Node; source assertions below always run.
        node = shutil.which("node")
        if node is not None:
            subprocess.run([node, "-e", script], check=True, capture_output=True, text=True)
        self.assertIn("await caches.delete(key)", src)
        registration = (STATIC / "pwa-register.js").read_text()
        self.assertIn("location.protocol !== 'https:'", registration)
        self.assertIn("register('/sw.js', { scope: '/' })", registration)

    def test_service_worker_source_checks_still_run_without_node(self):
        with patch("shutil.which", return_value=None), patch("subprocess.run") as run:
            self.test_service_worker_leaves_sensitive_routes_and_spa_on_network()
            run.assert_not_called()

    def test_standalone_session_cookie_is_same_origin_and_secure(self):
        request = Request({"type": "http", "scheme": "http", "path": "/app/study",
                           "headers": [(b"x-forwarded-proto", b"https")],
                           "client": ("127.0.0.1", 12345), "server": ("localhost", 443)})
        response = Response()
        web_common._set_session_cookie(response, "test-token", request)
        cookie = response.headers["set-cookie"]
        for value in ("fas_session=", "Path=/", "HttpOnly", "SameSite=lax", "Secure"):
            self.assertIn(value, cookie)
