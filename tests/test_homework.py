import testenv  # noqa: F401
import datetime as dt
import io
import json
import unittest
import uuid
import wave
import zipfile
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
import auth_db
import coach
import game
import journal
import tts_service


def audio_bytes(seconds=2, sample=100):
    buf=io.BytesIO()
    with wave.open(buf,'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000)
        w.writeframes(sample.to_bytes(2,'little',signed=True)*(16000*seconds))
    return buf.getvalue()


class HomeworkTests(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(tts_service.app)
        u=auth_db.register_user(f'homework-{uuid.uuid4().hex}@example.com','password123')
        self.uid=u['user']['id'];self.auth={'Authorization':'Bearer '+u['token']}
        self.entry=journal.create(self.uid,'我住在温哥华。我正在学法语。')
        self.ref=auth_db._get_db_path().parent/(self.entry['id']+'.mp3');self.ref.write_bytes(b'mock reference audio')
        journal.prepared(self.uid,self.entry['id'],'J’habite à Vancouver. J’apprends le français.',self.ref.name)

    def upload(self,kind='first',content=None):
        return self.client.post(f'/api/homework/{self.entry["id"]}/recordings?kind={kind}',headers={**self.auth,'Content-Type':'audio/wav'},content=audio_bytes() if content is None else content)

    def test_private_entries_and_recordings(self):
        other=auth_db.register_user(f'other-{uuid.uuid4().hex}@example.com','password123')
        other_auth={'Authorization':'Bearer '+other['token']}
        self.assertEqual(self.client.get('/api/homework').status_code,401)
        self.assertEqual(self.client.get('/api/homework/'+self.entry['id'],headers=other_auth).status_code,404)
        d=self.upload().json();record=d['recordings'][0]
        self.assertEqual(self.client.get(record['url'],headers=other_auth).status_code,404)
        self.assertEqual(self.client.get(record['url'],headers=self.auth).content,audio_bytes())
        self.assertEqual(self.client.get('/api/homework/'+self.entry['id']+'/archive',headers=other_auth).status_code,404)

    def test_recording_duration_and_idempotence(self):
        r=self.upload();self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['recordings'][0]['duration'],2)
        r=self.upload();self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(len(r.json()['recordings']),1)
        with game._connect() as c:
            seconds=c.execute("SELECT sum(seconds) FROM study_time WHERE user_id=? AND lane='speaking'",(self.uid,)).fetchone()[0]
        self.assertEqual(seconds,2)

    def test_invalid_audio_does_not_create_record_or_time(self):
        for content in (b'',b'not audio'*30,audio_bytes(0),audio_bytes(181)):
            self.assertEqual(self.upload(content=content).status_code,422)
        self.assertEqual(journal.get(self.uid,self.entry['id'])['recordings'],[])

    def test_preserves_first_recording_and_prepared_text(self):
        self.upload()
        self.assertEqual(self.upload(content=audio_bytes(sample=200)).status_code,422)
        with self.assertRaises(ValueError):journal.prepared(self.uid,self.entry['id'],'New text.',self.ref.name)
        self.assertEqual(journal.get(self.uid,self.entry['id'])['french'],'J’habite à Vancouver. J’apprends le français.')

    def test_submission_requires_first_final_and_reflection(self):
        path=f'/api/homework/{self.entry["id"]}/finish'
        self.assertEqual(self.client.post(path,headers=self.auth,json={'reflection':'我想继续练习'}).status_code,422)
        self.upload('first');self.upload('final',audio_bytes(sample=200))
        r=self.client.post(path,headers=self.auth,json={'reflection':'我现在能说完整句子，明天练法语 r。','recalled':True})
        self.assertEqual(r.status_code,200,r.text);self.assertTrue(r.json()['complete'])
        self.client.post(path,headers=self.auth,json={'reflection':'再次提交同一份心得','recalled':True})
        self.assertEqual(coach.progress(self.uid)['xp'],15)
        self.assertTrue(next(q for q in coach.progress(self.uid)['quests'] if q['kind']=='speak')['done'])
        self.assertEqual(coach.dashboard(self.uid)['weekly_report']['homework']['archived'],1)

    def test_archive_contains_all_artifacts(self):
        self.upload('first');self.upload('final',audio_bytes(sample=200))
        journal.finish(self.uid,self.entry['id'],'下次练习发音。',True)
        r=self.client.get(f'/api/homework/{self.entry["id"]}/archive',headers=self.auth)
        self.assertEqual(r.status_code,200)
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            self.assertIn('model.mp3',z.namelist())
            self.assertIn('text.txt',z.namelist());self.assertIn('reflection.txt',z.namelist())
            self.assertIn('first-1.wav',z.namelist());self.assertIn('final-2.wav',z.namelist())
            self.assertIn('温哥华',z.read('text.txt').decode())
        self.assertIn('private',r.headers['cache-control'])

    def test_practice_seconds_bounded_by_wall_time_and_not_repeated(self):
        created=dt.datetime.fromisoformat(self.entry['created_at'])
        with patch('coach.now',return_value=created+dt.timedelta(seconds=20)):
            self.assertEqual(journal.practice(self.uid,self.entry['id'],'beat-one',30),20)
            self.assertEqual(journal.practice(self.uid,self.entry['id'],'beat-one',30),0)
        with patch('coach.now',return_value=created+dt.timedelta(seconds=25)):
            self.assertEqual(journal.practice(self.uid,self.entry['id'],'beat-two',30),5)
        self.assertEqual(journal.get(self.uid,self.entry['id'])['practice_seconds'],25)

    @patch('tts_service.create_speech_files',new_callable=AsyncMock)
    @patch('tts_service._post_chat',new_callable=AsyncMock)
    def test_personal_a1_generation_is_persisted(self,chat,speech):
        entry=journal.create(self.uid,'我是一名老师。我喜欢我的工作。')
        chat.return_value=({},json.dumps({'parts':[{'source':entry['native_text'],'french':'Je suis professeur. J’aime mon travail.'}]}))
        speech.return_value=(self.ref.name,'mock.srt')
        r=self.client.post(f'/api/homework/{entry["id"]}/prepare',headers=self.auth,json={})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['french'],'Je suis professeur. J’aime mon travail.')
        self.assertIn('THEIR OWN ideas',chat.call_args.args[1]['messages'][0]['content'])
        self.assertEqual(self.client.post(f'/api/homework/{entry["id"]}/prepare',headers=self.auth,json={}).status_code,200)
        self.assertEqual(chat.call_count,1)

    def test_old_page_redirects_into_study(self):
        r=self.client.get('/homework',follow_redirects=False)
        self.assertEqual(r.status_code,302)
        self.assertEqual(r.headers['location'],'/study?mode=personal')
        html=self.client.get('/study').text
        self.assertIn('id="study-personal"',html)
        self.assertNotIn('__PERSONAL_PRACTICE__',html)
        self.assertEqual(html.count('<h1'),1)

    @patch('tts_service.create_speech_files',new_callable=AsyncMock)
    @patch('tts_service._post_chat',new_callable=AsyncMock)
    def test_complete_ideas_are_preserved_in_parts_and_archive(self,chat,speech):
        native='我有两个孩子。我现在很焦虑。我在申请毕业工签。我需要照顾家人。'
        entry=journal.create(self.uid,native)
        parts=[{'source':'我有两个孩子。我现在很焦虑。','french':'J’ai deux enfants. Je suis inquiet.'},
               {'source':'我在申请毕业工签。我需要照顾家人。','french':'Je demande un permis de travail. Je m’occupe de ma famille.'}]
        chat.return_value=({},json.dumps({'parts':parts},ensure_ascii=False));speech.return_value=(self.ref.name,'mock.srt')
        r=self.client.post(f'/api/homework/{entry["id"]}/prepare',headers=self.auth,json={})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['parts'],parts)
        self.assertIn('permis',r.json()['french'])
        with zipfile.ZipFile(io.BytesIO(journal.archive(self.uid,entry['id'])[0])) as z:
            self.assertEqual(json.loads(z.read('parts.json')),parts)

    @patch('tts_service.create_speech_files',new_callable=AsyncMock)
    @patch('tts_service._post_chat',new_callable=AsyncMock)
    def test_omitted_source_is_rejected_before_speech(self,chat,speech):
        entry=journal.create(self.uid,'我有两个孩子。我正在申请毕业工签。')
        chat.return_value=({},json.dumps({'parts':[{'source':'我有两个孩子。','french':'J’ai deux enfants.'}]}))
        r=self.client.post(f'/api/homework/{entry["id"]}/prepare',headers=self.auth,json={})
        self.assertEqual(r.status_code,422,r.text);speech.assert_not_called()
        self.assertEqual(journal.get(self.uid,entry['id'])['french'],'')

    @patch('tts_service.create_speech_files',new_callable=AsyncMock)
    @patch('tts_service._post_chat',new_callable=AsyncMock)
    def test_audio_retry_keeps_generated_french(self,chat,speech):
        entry=journal.create(self.uid,'我正在申请毕业工签。')
        parts=[{'source':entry['native_text'],'french':'Je demande un permis de travail.'}]
        chat.return_value=({},json.dumps({'parts':parts}));speech.side_effect=RuntimeError('speech unavailable')
        path=f'/api/homework/{entry["id"]}/prepare'
        self.assertEqual(self.client.post(path,headers=self.auth,json={}).status_code,503)
        self.assertEqual(journal.get(self.uid,entry['id'])['parts'],parts)
        speech.side_effect=None;speech.return_value=(self.ref.name,'mock.srt')
        self.assertEqual(self.client.post(path,headers=self.auth,json={}).status_code,200)
        self.assertEqual(chat.call_count,1)

    @patch('tts_service.create_speech_files',new_callable=AsyncMock)
    @patch('tts_service._post_chat',new_callable=AsyncMock)
    def test_expand_old_summary_and_preserve_recorded_text(self,chat,speech):
        path=f'/api/homework/{self.entry["id"]}/prepare'
        part={'source':self.entry['native_text'],'french':'J’habite à Vancouver. J’apprends le français.'}
        chat.return_value=({},json.dumps({'parts':[part]}));speech.return_value=(self.ref.name,'mock.srt')
        self.assertTrue(journal.get(self.uid,self.entry['id'])['can_expand'])
        r=self.client.post(path,headers=self.auth,json={'expand':True})
        self.assertEqual(r.status_code,200,r.text);self.assertFalse(r.json()['can_expand'])
        self.upload()
        self.assertEqual(self.client.post(path,headers=self.auth,json={'expand':True}).status_code,422)
        self.assertEqual(chat.call_count,1)

    @patch('tts_service.create_speech_files',new_callable=AsyncMock)
    def test_private_part_audio_and_missing_file_repair(self,speech):
        parts=[{'source':self.entry['native_text'],'french':'J’habite à Vancouver.'}]
        journal.prepared(self.uid,self.entry['id'],parts[0]['french'],self.ref.name,parts)
        speech.return_value=(self.ref.name,'mock.srt')
        path=f'/api/homework/{self.entry["id"]}/reference?part=0'
        self.assertEqual(self.client.get(path).status_code,401)
        self.assertEqual(self.client.get(path,headers=self.auth).status_code,200)
        self.assertEqual(self.client.get(path.replace('part=0','part=1'),headers=self.auth).status_code,404)
        # Deleting the old audio triggers repair without replacing text or recordings.
        self.ref.unlink();speech.return_value=('repaired.mp3','mock.srt')
        r=self.client.post(f'/api/homework/{self.entry["id"]}/prepare',headers=self.auth,json={})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['parts'],parts)

    def test_late_audio_cannot_replace_a_changed_text(self):
        with self.assertRaises(ValueError):
            journal.attach_reference(self.uid,self.entry['id'],'late.mp3',expected_text='A different version.')
        self.assertEqual(journal.reference_path(self.uid,self.entry['id']),self.ref)
