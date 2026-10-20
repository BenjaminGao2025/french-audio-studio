import pathlib
import unittest

import testenv  # noqa: F401
from fastapi.testclient import TestClient
import tts_service


class SingleAudioTests(unittest.TestCase):
    def test_pages_load_controller_before_players(self):
        client = TestClient(tts_service.app)
        for route in ('/', '/study', '/review', '/speak', '/listen', '/write', '/coach', '/home'):
            with self.subTest(route=route):
                response = client.get(route)
                self.assertEqual(response.status_code, 200)
                script = f'/static/audio-controller.js?v={tts_service.ASSET_VERSION}'
                self.assertEqual(response.text.count(script), 1)
                self.assertLess(response.text.index(script), response.text.index('/static/theme.js'))

    def test_controller_is_external_and_changes_worker_version(self):
        client = TestClient(tts_service.app)
        response = client.get('/static/audio-controller.js')
        self.assertEqual(response.status_code, 200)
        self.assertIn('FrenchAudio', response.text)
        # Asset hashes include every top-level JS asset, including the controller.
        self.assertEqual(tts_service._asset_version(), tts_service.ASSET_VERSION)
        self.assertIn(f"const VERSION = '{tts_service.ASSET_VERSION}'", client.get('/sw.js').text)
        study = pathlib.Path('static/study.html').read_text()
        self.assertIn('/static/homework.js', study)
        self.assertIn('/static/mini-listen.js', pathlib.Path('static/listen.html').read_text())
