import testenv  # noqa: F401
import datetime as dt
import json
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
import auth_db
import comprehension as core
import cockpit
import journal
import srs
import tts_service as host


class ComprehensionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(host.app)
        reg = auth_db.register_user(f'lr_{uuid.uuid4().hex}@example.com', 'password123')
        self.uid = reg['user']['id']
        self.headers = {'Authorization': 'Bearer ' + reg['token']}
        self.offline = patch.object(host, 'SERVER_WEB2API_KEY', '')
        self.offline.start()
        self.addCleanup(self.offline.stop)
        core.init_db()

    def post(self, path, body=None, status=200):
        r = self.client.post(path, json=body, headers=self.headers)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()

    def learned(self, sentence='Je voudrais un café.'):
        return srs.add_note(self.uid, sentence, translation_en='I would like a coffee.', modes=['listen'])

    def session(self):
        self.learned()
        return self.post('/api/listening/sessions', {})

    def reveal(self, sid):
        path = f'/api/listening/sessions/{sid}'
        self.post(path + '/blind', {'self': 2, 'plays': 1})
        return self.post(path + '/reveal')

    def complete(self, sid, correct=True):
        self.reveal(sid)
        path = f'/api/listening/sessions/{sid}'
        for i, stage in enumerate(('slow20', 'normal', 'normal')):
            self.post(path + '/relisten', {'stage': stage, 'index': i})
        with auth_db.connect() as c:
            row = core.get(c, 'listening_sessions', self.uid, sid)
            answer = json.loads(row['payload_json'])['material']['question']['answer_index']
            c.execute('UPDATE listening_sessions SET created_at=? WHERE id=?', ((core.now() - dt.timedelta(seconds=90)).isoformat(), sid))
        return self.post(path + '/check', {'answer_index': answer if correct else (answer+1)%4, 'seconds': 60, 'tz_offset': 420})

    def passage(self, kind='notice', level='A2'):
        return self.post('/api/reading/passages', {'generate': {'text_type': kind, 'level': level}})

    def test_schema_is_idempotent(self):
        core.init_db(); core.init_db()
        self.assertEqual(core.gate(self.uid)['hours']['value'], 0)

    def test_empty_pool_has_actionable_error(self):
        self.post('/api/listening/sessions', {}, 409)

    def test_blind_payload_hides_text_answers_and_analysis(self):
        s = self.session()
        self.assertEqual(s['material']['text'], '')
        self.assertEqual(s['material']['words'], [])
        self.assertNotIn('answer_index', s['material']['question'])
        self.assertNotIn('evidence', s['material']['question'])
        self.assertIsNone(s['analysis'])
        self.assertNotIn('text=', s['audio_url_normal'])

    def test_requires_blind_before_reveal_and_check(self):
        s = self.session(); path = f'/api/listening/sessions/{s["id"]}'
        self.post(path + '/reveal', status=409)
        self.post(path + '/check', {'answer_index': 0}, 409)
        self.post(path + '/blind', {'self': 2, 'plays': 0}, 422)

    def test_reveal_reuses_analysis_and_is_idempotent(self):
        s = self.session()
        a = self.reveal(s['id'])
        self.assertTrue(a['revealed'])
        self.assertEqual(a['material']['text'], 'Je voudrais un café.')
        self.assertEqual(a['analysis']['sentences'][0]['sentence'], 'Je voudrais un café.')
        with patch('routers.comprehension.analyze', new_callable=AsyncMock) as analyze:
            self.post(f'/api/listening/sessions/{s["id"]}/reveal')
            analyze.assert_not_called()

    def test_relisten_order_and_retry(self):
        s = self.session(); path = f'/api/listening/sessions/{s["id"]}'
        self.post(path + '/relisten', {'stage': 'normal', 'index': 0}, 409)
        self.reveal(s['id'])
        self.post(path + '/relisten', {'stage': 'normal', 'index': 1}, 409)
        for _ in range(2):
            self.post(path + '/relisten', {'stage': 'slow20', 'index': 0})
        self.post(path + '/check', {'answer_index': 0}, 409)

    def test_ladder_advances_only_on_success_and_caps(self):
        self.assertEqual(self.complete(self.session()['id'], False)['result'], {'correct': False})
        for rate in (.75, .9, 1., 1.):
            s = self.session(); self.assertEqual(s['rate'], rate)
            self.complete(s['id'])

    def test_completion_logs_listening_once(self):
        s = self.session(); result = self.complete(s['id'])
        self.post(f'/api/listening/sessions/{s["id"]}/check', {'answer_index': 0, 'seconds': 240})
        with auth_db.connect() as c:
            rows = c.execute("SELECT seconds,source FROM study_time WHERE user_id=? AND lane='listening'", (self.uid,)).fetchall()
        self.assertEqual([tuple(r) for r in rows], [(60, 'auto')])
        self.assertIn('explanation', result['material']['question'])

    def test_srs_without_translation_is_eligible(self):
        srs.add_note(self.uid, 'Je suis libre mardi.', modes=['speak'])
        self.assertTrue(self.post('/api/listening/sessions', {})['id'])

    def test_journal_source(self):
        j = journal.create(self.uid, '今天我想喝咖啡。')
        journal.prepared(self.uid, j['id'], 'Je voudrais un café.', '')
        s = self.post('/api/listening/sessions', {'source': 'journal'})
        self.assertEqual(self.reveal(s['id'])['material']['source'], 'journal')

    def test_story_offline_uses_only_known_sentences(self):
        self.learned()
        s = self.post('/api/listening/sessions', {'source': 'story'})
        self.assertEqual(self.reveal(s['id'])['material']['text'], 'Je voudrais un café.')
        self.assertFalse(core.known_story('Je voudrais un bateau.', core.material_pool(self.uid)))

    def test_pool_rotates(self):
        self.learned(); self.learned('Je suis libre mardi.')
        a = self.post('/api/listening/sessions', {})
        b = self.post('/api/listening/sessions', {})
        self.assertNotEqual(self.reveal(a['id'])['material']['text'], self.reveal(b['id'])['material']['text'])

    def test_unknown_word_creates_idempotent_cloze(self):
        s = self.session(); self.reveal(s['id'])
        for _ in range(2):
            self.post(f'/api/listening/sessions/{s["id"]}/words', {'sentence': 'Je voudrais un café.', 'word': 'café'})
        cards = [c for c in srs.list_cards(self.uid) if c['mode'] == 'cloze']
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]['target'], 'café')
        self.post(f'/api/listening/sessions/{s["id"]}/words', {'sentence': 'Une autre phrase.', 'word': 'autre'}, 409)

    def test_all_reading_types_offline(self):
        for kind in core.FIXTURES:
            for level in ('A1', 'A2'):
                p = self.passage(kind, level)
                self.assertEqual(p['text_type'], kind)
                self.assertEqual(p['source'], 'fixture')
                self.assertEqual(len(p['questions']), 2)
                self.assertTrue(p['analysis']['sentences'])
                self.assertTrue(all(len(q['options']) == 4 and 'answer_index' not in q for q in p['questions']))

    def test_pasted_text_and_validation(self):
        p = self.post('/api/reading/passages', {'text': 'Je suis libre mardi. Nous prenons un café.'})
        self.assertEqual(p['source'], 'user')
        for body in ({}, {'text': 'short'}, {'generate': {'level': 'B1'}}, {'text': ' ' * 25}):
            self.post('/api/reading/passages', body, 422)

    def test_reading_attempt_explanations_and_time_once(self):
        p = self.passage()
        with auth_db.connect() as c:
            row = core.get(c, 'reading_passages', self.uid, p['id'])
            questions = json.loads(row['payload_json'])['questions']
            c.execute('UPDATE reading_passages SET created_at=? WHERE id=?', ((core.now() - dt.timedelta(seconds=150)).isoformat(), p['id']))
        body = {'answers': [q['answer_index'] for q in questions], 'seconds': 120}
        for _ in range(2):
            result = self.post(f'/api/reading/passages/{p["id"]}/done', body)
            self.assertEqual(result['result']['correct'], 2)
            self.assertTrue(all(q['evidence'] in p['text'] and q['explanation'] for q in result['questions']))
        with auth_db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM reading_attempts WHERE user_id=?', (self.uid,)).fetchone()[0], 1)
            self.assertEqual(c.execute("SELECT sum(seconds) FROM study_time WHERE user_id=? AND lane='reading'", (self.uid,)).fetchone()[0], 120)

    def test_reading_requires_every_answer(self):
        p = self.passage()
        self.post(f'/api/reading/passages/{p["id"]}/done', {'answers': [0, 1, 2], 'seconds': 30}, 409)
        self.post(f'/api/reading/passages/{p["id"]}/done', {'answers': [9, 1], 'seconds': 30}, 422)

    def test_reading_vocab_is_cloze(self):
        p = self.passage()
        self.post(f'/api/reading/passages/{p["id"]}/words', {'sentence': 'La bibliothèque est fermée lundi pour travaux.', 'word': 'bibliothèque'})
        self.assertEqual([c['mode'] for c in srs.list_cards(self.uid)], ['cloze'])

    def test_auth_and_ownership(self):
        s = self.session(); p = self.passage()
        stranger = TestClient(host.app)
        for path in ('/api/listening/gate', f'/api/listening/sessions/{s["id"]}', f'/api/listening/sessions/{s["id"]}/audio', f'/api/reading/passages/{p["id"]}'):
            self.assertEqual(stranger.get(path).status_code, 401)
        other = auth_db.register_user(f'lr_{uuid.uuid4().hex}@example.com', 'password123')
        headers = {'Authorization': 'Bearer ' + other['token']}
        for path in (f'/api/listening/sessions/{s["id"]}', f'/api/listening/sessions/{s["id"]}/audio', f'/api/reading/passages/{p["id"]}'):
            self.assertEqual(stranger.get(path, headers=headers).status_code, 404)
        self.assertEqual(self.client.get('/api/reading/passages', headers=headers).json(), [])

    def test_cookie_auth(self):
        self.client.cookies.set('fas_session', self.headers['Authorization'][7:])
        self.assertEqual(self.client.get('/api/listening/gate').status_code, 200)

    def test_gate_excludes_car_and_never_counts_practice_as_unseen(self):
        core.game.log_time(self.uid, 'car', 300, '', 0)
        self.complete(self.session()['id'])
        gate = core.gate(self.uid)
        self.assertLess(gate['hours']['value'], 1)
        self.assertEqual(gate['unseen_quiz_pct']['value'], 0)
        self.assertFalse(gate['unlocked'])

    def test_invalid_llm_questions_fall_back(self):
        self.offline.stop()
        with patch('routers.comprehension.generate', new_callable=AsyncMock, return_value={'questions': [{'q': 'Broken'}]}):
            import asyncio
            questions = asyncio.run(__import__('routers.comprehension', fromlist=['questions']).questions('Je suis libre mardi.', 'key', 2))
        self.assertEqual(len(questions), 2)
        self.assertTrue(all(q['evidence'] == 'Je suis libre mardi.' for q in questions))

    def test_gateway_and_analyzer_are_reused(self):
        self.offline.stop()
        text = 'La bibliothèque ouvre mardi. Elle ferme à dix heures.'
        questions = core.fallback_questions(text)
        with patch.object(host, '_post_chat', new_callable=AsyncMock, side_effect=[({}, json.dumps({'title': 'Ouverture', 'text': text})), ({}, json.dumps({'questions': questions}))]) as chat, patch.object(host, 'request_french_analysis', new_callable=AsyncMock, return_value=host._parse_analysis_json('{}', text)) as analyze:
            p = self.passage()
        self.assertEqual(p['source'], 'llm')
        self.assertEqual(chat.await_count, 2)
        analyze.assert_awaited_once()
        self.assertEqual(chat.call_args.args[1]['model'], host.AGY_MODEL)

    def test_audio_uses_requested_rate_and_hides_other_users(self):
        s = self.session(); self.reveal(s['id'])
        with patch.object(host, 'create_speech_files', new_callable=AsyncMock, return_value=('unused.mp3', 'unused.srt')) as speech, patch.object(host, '_output_file', return_value={'audio': True}):
            self.assertEqual(self.client.get(s['audio_url_slow'], headers=self.headers).status_code, 200)
            self.assertEqual(speech.call_args.kwargs['rate'], .75)
        self.assertEqual(self.client.get(f'/api/listening/sessions/{s["id"]}/audio?rate=0.8', headers=self.headers).status_code, 422)

    def test_enabled_weekly_plans_are_960_study_minutes(self):
        minutes = 0
        for weekday in range(7):
            day = dt.date(2026, 10, 19) + dt.timedelta(days=weekday)
            plan = cockpit.today(self.uid, now=dt.datetime.combine(day, dt.time(12), dt.timezone.utc))
            minutes += sum(b['planned_min'] for b in plan['blocks'] if b['route'] != '/wrapup')
        self.assertEqual(minutes, 960)

    def test_old_saved_plan_gains_missing_modules_without_losing_state(self):
        moment = dt.datetime(2026, 10, 19, 12, tzinfo=dt.timezone.utc)
        plan = cockpit.today(self.uid, now=moment)
        kept = plan['blocks'][0]
        cockpit.finish_block(self.uid, kept['id'], now=moment)
        with cockpit._connect() as c:
            c.execute("DELETE FROM day_blocks WHERE user_id=? AND kind='listening'", (self.uid,))
        restored = cockpit.today(self.uid, now=moment)
        again = cockpit.today(self.uid, now=moment)
        self.assertEqual(sum(b['kind'] == 'listening' for b in restored['blocks']), 1)
        self.assertEqual(restored['blocks'][0]['id'], kept['id'])
        self.assertEqual(restored['blocks'][0]['status'], 'done')
        self.assertEqual([b['id'] for b in restored['blocks']], [b['id'] for b in again['blocks']])

    def test_tts_rate_changes_cache_key_and_edge_rate(self):
        import asyncio
        class FakeSpeech:
            async def stream(self):
                yield {'type': 'audio', 'data': b'ID3'}
        text = 'Bonjour ' + uuid.uuid4().hex
        with patch.object(host.edge_tts, 'Communicate', return_value=FakeSpeech()) as speak:
            normal = asyncio.run(host.create_speech_files(text, 'fr-FR-DeniseNeural'))
            slow = asyncio.run(host.create_speech_files(text, 'fr-FR-DeniseNeural', rate=.75))
            cached = asyncio.run(host.create_speech_files(text, 'fr-FR-DeniseNeural', rate=.75))
        self.assertNotEqual(normal[0], slow[0])
        self.assertEqual(slow, cached)
        self.assertEqual(speak.call_count, 2)
        self.assertEqual(speak.call_args.kwargs['rate'], '-25%')
        self.assertTrue(host._snippet_cached(text, 'fr-FR-DeniseNeural', .75))
        for files in (normal, slow):
            for name in files:
                (host.OUTPUT_DIR / name).unlink(missing_ok=True)
