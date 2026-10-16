import testenv  # noqa: F401  (must run before the app is imported)

import json
import pathlib
import struct
import unittest

from fastapi.testclient import TestClient

import tts_service

STATIC = pathlib.Path(tts_service.STATIC_DIR)


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
            for tag in ('rel="manifest"', 'apple-mobile-web-app-capable', 'rel="apple-touch-icon"',
                        'viewport-fit=cover', '/static/pwa-register.js?v=' + tts_service.ASSET_VERSION):
                self.assertIn(tag, html, (path, tag))
            self.assertEqual(html.count('rel="manifest"'), 1)

    def test_service_worker_is_versioned_and_never_caches_dynamic_routes(self):
        res = self.client.get("/sw.js")
        self.assertEqual(res.status_code, 200)
        self.assertIn("javascript", res.headers["content-type"])
        self.assertEqual(res.headers["cache-control"], "no-cache")
        src = res.text
        self.assertIn(f"const VERSION = '{tts_service.ASSET_VERSION}';", src)
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
