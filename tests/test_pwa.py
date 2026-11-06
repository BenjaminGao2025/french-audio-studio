import json
import pathlib
import struct
import unittest

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi.testclient import TestClient

import routers.pages
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
        self.assertEqual((m["start_url"], m["scope"], m["display"]), ("/study", "/", "standalone"))
        sizes = {(i["sizes"], i["purpose"]) for i in m["icons"]}
        self.assertIn(("192x192", "any"), sizes)
        self.assertIn(("512x512", "any"), sizes)
        self.assertIn(("512x512", "maskable"), sizes)
        for icon in m["icons"]:
            w, h = _png_size(STATIC / icon["src"].removeprefix("/static/"))
            self.assertEqual(f"{w}x{h}", icon["sizes"])
            self.assertEqual(self.client.get(icon["src"]).status_code, 200)
        self.assertEqual(_png_size(STATIC / "pwa" / "apple-touch-icon.png"), (180, 180))

    def test_every_page_has_ios_app_tags(self):
        for path in ("/", "/study", "/review", "/listen"):
            html = self.client.get(path).text
            for tag in (
                'rel="manifest"',
                "apple-mobile-web-app-capable",
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
        csp = self.client.get("/study").headers["content-security-policy"]
        self.assertIn("worker-src 'self'", csp)
        self.assertIn("manifest-src 'self'", csp)

    def test_lucide_is_local_versioned_and_served_on_every_page(self):
        paths = (
            "/",
            "/study",
            "/review",
            "/listen",
            "/speak",
            "/write",
            "/coach",
            "/grammar",
            "/home",
            "/account",
            "/privacy",
            "/for-institutions",
        )
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
