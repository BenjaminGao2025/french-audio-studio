"""Word notes use the testenv temporary database, never live user data."""
import unittest
import testenv
from fastapi.testclient import TestClient
import tts_service


class WordNotesTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.a = testenv.session_headers()
        self.b = testenv.session_headers()

    def test_auth_required(self):
        for method, path, body in [('GET', '/api/word-notes?word=chat', None),
                                   ('POST', '/api/word-notes', {'word': 'chat', 'text': 'note'}),
                                   ('PATCH', '/api/word-notes/1', {'text': 'edit'}),
                                   ('DELETE', '/api/word-notes/1', None)]:
            self.assertEqual(self.client.request(method, path, json=body).status_code, 401)

    def test_multiple_notes_crud_normalization_and_word_filter(self):
        def add(word, text):
            response = self.client.post('/api/word-notes', headers=self.a, json={'word': word, 'text': text})
            self.assertEqual(response.status_code, 201)
            return response.json()
        first = add('  MACHINE À LAVER ', 'first')
        second = add('machine à laver', 'second')
        add('chat', 'other')
        notes = self.client.get('/api/word-notes?word=machine%20à%20laver', headers=self.a).json()['notes']
        self.assertEqual([n['id'] for n in notes], [first['id'], second['id']])
        path = f"/api/word-notes/{first['id']}"
        edited = self.client.patch(path, headers=self.a, json={'text': 'edited'}).json()
        self.assertEqual(edited['text'], 'edited')
        self.assertEqual(edited['created_at'], first['created_at'])
        self.assertGreaterEqual(edited['updated_at'], first['updated_at'])
        self.assertEqual(self.client.delete(path, headers=self.a).status_code, 200)
        self.assertEqual(self.client.delete(path, headers=self.a).status_code, 404)

    def test_users_cannot_read_edit_or_delete_each_others_notes(self):
        note = self.client.post('/api/word-notes', headers=self.a, json={'word': 'chat', 'text': 'private'}).json()
        self.assertEqual(self.client.get('/api/word-notes?word=chat', headers=self.b).json()['notes'], [])
        path = f"/api/word-notes/{note['id']}"
        self.assertEqual(self.client.patch(path, headers=self.b, json={'text': 'stolen'}).status_code, 404)
        self.assertEqual(self.client.delete(path, headers=self.b).status_code, 404)
        self.assertEqual(self.client.get('/api/word-notes?word=chat', headers=self.a).json()['notes'][0]['text'], 'private')
