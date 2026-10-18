"""Phase A listening and intensive reading: private material, state and attempts."""
from __future__ import annotations

import datetime as dt
import json
import re
import uuid

import auth_db
import cockpit
import curriculum
import episodes
import game
import journal
import srs

RATES = (0.75, 0.9, 1.0)
FIXTURES = {
    'notice': ('La bibliothèque', 'La bibliothèque est fermée lundi pour travaux. Elle ouvre mardi à neuf heures. Vous pouvez rendre vos livres mardi.'),
    'email': ('Un café samedi', 'Bonjour Marie ! Je suis libre samedi matin. Nous pouvons prendre un café à dix heures. Rendez-vous devant la gare. À bientôt, Paul.'),
    'ad': ('Un vélo à vendre', 'Je vends mon vélo rouge pour cinquante euros. Il est en bon état. Vous pouvez le voir samedi matin devant la gare. Contactez Paul par email.'),
    'article': ('Un nouveau jardin', 'Un nouveau jardin ouvre samedi dans notre ville. Les familles peuvent venir à dix heures. L’entrée est gratuite. Les enfants peuvent jouer et les parents peuvent prendre un café.'),
}


def now():
    return dt.datetime.now(dt.timezone.utc)


def init_db():
    game.init_db()
    with auth_db.connect() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS listening_sessions (
          id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, block_id TEXT,
          material_key TEXT NOT NULL, rate_stage TEXT NOT NULL, blind_self INTEGER,
          revealed INTEGER NOT NULL DEFAULT 0, relistens INTEGER NOT NULL DEFAULT 0,
          check_correct INTEGER, new_words_json TEXT NOT NULL DEFAULT '[]',
          payload_json TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_listening_user ON listening_sessions(user_id,created_at);
        CREATE TABLE IF NOT EXISTS listening_progress (
          user_id INTEGER PRIMARY KEY, ladder INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS reading_passages (
          id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL,
          text TEXT NOT NULL, text_type TEXT NOT NULL, level TEXT NOT NULL,
          source TEXT NOT NULL, license TEXT NOT NULL, payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reading_user ON reading_passages(user_id,created_at);
        CREATE TABLE IF NOT EXISTS reading_attempts (
          id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, passage_id TEXT NOT NULL,
          answers_json TEXT NOT NULL, correct INTEGER NOT NULL, seconds INTEGER NOT NULL,
          created_at TEXT NOT NULL, UNIQUE(user_id,passage_id)
        );
        ''')


def get(c, table, user_id, item_id):
    row = c.execute(f'SELECT * FROM {table} WHERE id=? AND user_id=?', (item_id, user_id)).fetchone()
    if not row:
        raise KeyError(item_id)
    return row


def public_question(q, answered=False):
    return {k: v for k, v in q.items() if answered or k not in ('answer_index', 'explanation', 'evidence', 'a')}


def fallback_questions(text, count=2):
    spans = [x.strip() for x in re.split(r'(?<=[.!?])\s+', text) if x.strip()]
    result = []
    for i, span in enumerate(spans[:count]):
        options = ['Le texte ne donne aucune information.', 'Tout est annulé pour toujours.', 'Il faut partir dans un autre pays.']
        answer = (i + 1) % 4
        options.insert(answer, span)
        result.append(dict(kind='detail', q=f'Quelle information figure dans la phrase {i+1} ?', prompt=f'Quelle information figure dans la phrase {i+1} ?', options=options, answer_index=answer, evidence=span, explanation=f'Le texte dit : « {span} ». Les autres propositions ne figurent pas dans ce passage.'))
    if len(result) == 1 and count > 1:
        q = dict(result[0], q='Quelle phrase résume le texte ?', kind='main_idea')
        result.append(q)
    return result


def validate_questions(questions, text, count):
    if not isinstance(questions, list) or not 1 <= len(questions) <= 3:
        raise ValueError('Invalid questions')
    result = []
    for q in questions[:count]:
        if not isinstance(q, dict):
            raise ValueError('Invalid question')
        options = q.get('options')
        answer = q.get('answer_index')
        if (not isinstance(options, list) or len(options) != 4 or
                not all(isinstance(x, str) and x.strip() for x in options) or len(set(options)) != 4 or
                type(answer) is not int or answer not in range(4) or
                not isinstance(q.get('evidence'), str) or not q['evidence'] or q['evidence'] not in text or
                not isinstance(q.get('explanation'), str) or not q['explanation'].strip() or not isinstance(q.get('q') or q.get('prompt'), str)):
            raise ValueError('Invalid question or citation')
        result.append(dict(q, q=q.get('q') or q['prompt'], prompt=q.get('prompt') or q['q'], kind=q.get('kind', 'detail')))
    if len(result) < count:
        raise ValueError('Too few questions')
    return result


def material_pool(user_id):
    pool = [dict(x, source='srs' if x['in_deck'] else 'history') for x in episodes.learning_material(user_id)]
    for entry in journal.list_entries(user_id):
        if entry['french'].strip():
            pool.append(dict(key='journal:' + entry['id'], sentence=entry['french'], en='', words=[], source='journal'))
    # Notes without translations are still learned material.
    with auth_db.connect() as c:
        notes = c.execute('SELECT sentence,translation_en FROM srs_notes WHERE user_id=?', (user_id,)).fetchall()
    keys = {x['key'] for x in pool}
    for sentence, en in notes:
        key = srs.sentence_key(sentence)
        if key not in keys:
            pool.append(dict(key=key, sentence=sentence, en=en, words=[], source='srs'))
    # Reuse reviewed curriculum translations where the user's learned sentence matches.
    translations = {fr: en for lesson in curriculum.LESSONS for fr, _, en in lesson['lines']}
    for item in pool:
        item['en'] = item.get('en') or translations.get(item['sentence'], '')
    return [x for x in pool if len(x['sentence']) <= 2000]


def known_story(story, material):
    known = set(re.findall(r"[\wÀ-ÿ’']+", ' '.join(x['sentence'] for x in material).lower()))
    words = set(re.findall(r"[\wÀ-ÿ’']+", story.lower()))
    return bool(words) and words <= known


def create_listening(user_id, material, question, block_id=None):
    init_db()
    if block_id:
        with cockpit._connect() as c:
            block = cockpit._own_block(c, user_id, block_id)
            if block['kind'] != 'listening':
                raise ValueError('Choose a listening block')
    with auth_db.connect() as c:
        ladder = c.execute('SELECT ladder FROM listening_progress WHERE user_id=?', (user_id,)).fetchone()
        rate = RATES[min(ladder[0], 2)] if ladder else RATES[0]
        item_id = uuid.uuid4().hex
        payload = dict(material=dict(text=material['sentence'], translation_en=material.get('en', ''), source=material['source'], words=[], question=question),
                       rate=rate, rate_stage='normal' if rate == 1 else ('slow30' if rate == .75 else 'slow20'), analysis=None,
                       blind_plays=0, relisten_stages=[], index=1, total=1)
        c.execute('INSERT INTO listening_sessions(id,user_id,block_id,material_key,rate_stage,payload_json,created_at) VALUES(?,?,?,?,?,?,?)',
                  (item_id, user_id, block_id, material['key'], payload['rate_stage'], json.dumps(payload), now().isoformat()))
    return listening(user_id, item_id)


def listening(user_id, item_id):
    init_db()
    with auth_db.connect() as c:
        row = get(c, 'listening_sessions', user_id, item_id)
    p = json.loads(row['payload_json'])
    answered = row['check_correct'] is not None
    p['material']['question'] = public_question(p['material']['question'], answered)
    if row['relistens'] < 3:
        p['material']['question'] = dict(prompt='', options=[])
    if not row['revealed']:
        p['material'].update(text='', translation_en='', words=[])
        p['analysis'] = None
    p.update(id=item_id, revealed=bool(row['revealed']), blind_self=row['blind_self'],
             audio_url_normal=f'/api/listening/sessions/{item_id}/audio?rate=1',
             audio_url_slow=f'/api/listening/sessions/{item_id}/audio?rate={min(.9, p["rate"])}')
    if answered:
        p['result'] = dict(correct=bool(row['check_correct']))
    return p


def _log(c, user_id, lane, seconds, created_at, tz_offset):
    # Completion records use the same auto study_time ledger as game.record_time. Keep the
    # attempt and its time atomic so retries/concurrent submissions cannot double count.
    elapsed = max(0, int((now() - dt.datetime.fromisoformat(created_at)).total_seconds()))
    day = game.local_day(now(), tz_offset).isoformat()
    used = c.execute("SELECT coalesce(sum(seconds),0) FROM study_time WHERE user_id=? AND day=? AND lane=? AND source='auto'", (user_id, day, lane)).fetchone()[0]
    seconds = min(seconds, elapsed, 240 if lane == 'listening' else 1200, max(0, game.MAX_AUTO_SECONDS_PER_LANE_DAY - used))
    if seconds:
        c.execute("INSERT INTO study_time(user_id,day,lane,source,seconds,created_at) VALUES(?,?,?,'auto',?,?)",
                  (user_id, day, lane, seconds, now().isoformat()))
    return seconds


def update_listening(user_id, item_id, action, data, analysis=None):
    init_db()
    with auth_db.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        row = get(c, 'listening_sessions', user_id, item_id)
        p = json.loads(row['payload_json'])
        if row['check_correct'] is not None:
            c.rollback()
            return listening(user_id, item_id)
        if action == 'blind':
            if row['revealed']:
                raise ValueError('Blind assessment is already recorded')
            p['blind_plays'] = data['plays']
            c.execute('UPDATE listening_sessions SET blind_self=? WHERE id=?', (data['self'], item_id))
        elif action == 'reveal':
            if row['blind_self'] is None:
                raise ValueError('Listen and assess before revealing')
            if not row['revealed']:
                p['analysis'] = analysis
                p['material']['words'] = [dict(w=w.get('fr') or w.get('token', ''), ipa=w.get('ipa', ''), en=w.get('meaning_en') or w.get('meaning', ''), note=w.get('why', '')) for sentence in analysis['sentences'] for w in sentence.get('words', [])]
                p['material']['breakdown'] = '\n'.join(x.get('translation_en', '') for x in analysis['sentences'])
                c.execute('UPDATE listening_sessions SET revealed=1 WHERE id=?', (item_id,))
        elif action == 'relisten':
            if not row['revealed']:
                raise ValueError('Reveal before relistening')
            stages = p['relisten_stages']
            index = data['index']
            if index > len(stages) or data['stage'] != ('slow20' if index == 0 else 'normal'):
                raise ValueError('Listen once slow, then twice normal')
            if index == len(stages):
                stages.append(data['stage'])
            c.execute('UPDATE listening_sessions SET relistens=? WHERE id=?', (len(stages), item_id))
        elif action == 'check':
            if row['relistens'] != 3:
                raise ValueError('Complete all three relistens first')
            correct = data['answer_index'] == p['material']['question']['answer_index']
            p['answer_index'] = data['answer_index']
            c.execute('UPDATE listening_sessions SET check_correct=? WHERE id=?', (int(correct), item_id))
            if correct:
                c.execute('INSERT INTO listening_progress(user_id,ladder) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET ladder=min(2,ladder+1)', (user_id,))
            _log(c, user_id, 'listening', data['seconds'], row['created_at'], data['tz_offset'])
        c.execute('UPDATE listening_sessions SET payload_json=? WHERE id=?', (json.dumps(p), item_id))
    return listening(user_id, item_id)


def gate(user_id):
    init_db()
    with auth_db.connect() as c:
        hours = cockpit._counted_hours(c, user_id)
        rows = c.execute("SELECT blind_self FROM listening_sessions WHERE user_id=? AND check_correct IS NOT NULL ORDER BY created_at DESC LIMIT 10", (user_id,)).fetchall()
    # Every blind pass uses normal speed, including sessions on the slow relisten ladder.
    understood = round(sum(x[0] == 2 for x in rows) / 10 * 100)
    # Phase A has no unseen validation quiz; practice answers never unlock this gate.
    return dict(hours=dict(value=round(hours, 1), target=200), understood_pct=dict(value=understood, target=80),
                unseen_quiz_pct=dict(value=0, target=60), unlocked=False, reason='An unseen CO quiz is required; available in a later phase.')


def save_reading(user_id, title, text, text_type, level, source, analysis, questions):
    init_db()
    item_id = uuid.uuid4().hex
    payload = dict(analysis=analysis, questions=questions)
    with auth_db.connect() as c:
        c.execute('INSERT INTO reading_passages VALUES(?,?,?,?,?,?,?,?,?,?)', (item_id, user_id, title, text, text_type, level, source, 'own' if source == 'user' else 'generated', json.dumps(payload), now().isoformat()))
    return reading(user_id, item_id)


def reading(user_id, item_id):
    init_db()
    with auth_db.connect() as c:
        row = get(c, 'reading_passages', user_id, item_id)
        attempt = c.execute('SELECT * FROM reading_attempts WHERE user_id=? AND passage_id=?', (user_id, item_id)).fetchone()
    p = dict(row)
    p.pop('user_id')
    p.update(json.loads(p.pop('payload_json')))
    p['questions'] = [public_question(q, bool(attempt)) for q in p['questions']]
    if attempt:
        p['result'] = dict(correct=attempt['correct'], answers=json.loads(attempt['answers_json']), seconds=attempt['seconds'])
    return p


def finish_reading(user_id, item_id, answers, seconds, tz_offset):
    init_db()
    with auth_db.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        row = get(c, 'reading_passages', user_id, item_id)
        questions = json.loads(row['payload_json'])['questions']
        if len(answers) != len(questions):
            raise ValueError('Answer every question')
        if not c.execute('SELECT 1 FROM reading_attempts WHERE user_id=? AND passage_id=?', (user_id, item_id)).fetchone():
            correct = sum(a == q['answer_index'] for a, q in zip(answers, questions))
            logged = _log(c, user_id, 'reading', seconds, row['created_at'], tz_offset)
            c.execute('INSERT INTO reading_attempts VALUES(?,?,?,?,?,?,?)', (uuid.uuid4().hex, user_id, item_id, json.dumps(answers), correct, logged, now().isoformat()))
    return reading(user_id, item_id)


def add_word(user_id, table, item_id, sentence, word, meaning=''):
    init_db()
    with auth_db.connect() as c:
        row = get(c, table, user_id, item_id)
    text = json.loads(row['payload_json'])['material']['text'] if table == 'listening_sessions' else row['text']
    if table == 'listening_sessions' and not row['revealed']:
        raise ValueError('Reveal the text first')
    if sentence not in text or not srs.target_in_sentence(sentence, word):
        raise ValueError('Choose a word from this text')
    result = srs.add_note(user_id, sentence, targets=[dict(text=word, mode='cloze', meta=dict(meaning_en=meaning))])
    if table == 'listening_sessions':
        with auth_db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row = get(c, table, user_id, item_id)
            words = json.loads(row['new_words_json'])
            if word not in words:
                words.append(word)
            c.execute('UPDATE listening_sessions SET new_words_json=? WHERE id=?', (json.dumps(words), item_id))
    return result
