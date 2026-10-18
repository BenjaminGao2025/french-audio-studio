"""Personal-expression homework with private first/final recordings and archives."""
from __future__ import annotations
import datetime
import hashlib
import io
import json
import uuid
import zipfile
from pathlib import Path

import auth_db
import coach

MAX_RECORDING_BYTES = 8 * 1024 * 1024


def root():
    p=auth_db._get_db_path().parent / 'homework'
    p.mkdir(parents=True,exist_ok=True)
    return p


def init(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS speaking_journals (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, day TEXT NOT NULL,
      native_text TEXT NOT NULL, french TEXT NOT NULL DEFAULT '', reference_file TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft', reflection TEXT NOT NULL DEFAULT '',
      practice_seconds INTEGER NOT NULL DEFAULT 0, recalled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_user_day ON speaking_journals(user_id,day);
    CREATE TABLE IF NOT EXISTS journal_recordings (
      id TEXT PRIMARY KEY, journal_id TEXT NOT NULL, kind TEXT NOT NULL, filename TEXT NOT NULL,
      duration REAL NOT NULL, sha TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(journal_id,kind,sha)
    );
    CREATE TABLE IF NOT EXISTS journal_beats (
      journal_id TEXT NOT NULL, beat_id TEXT NOT NULL, seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(journal_id,beat_id)
    );
    CREATE TABLE IF NOT EXISTS journal_scores (
      id TEXT PRIMARY KEY, journal_id TEXT NOT NULL, part INTEGER NOT NULL, sentence TEXT NOT NULL,
      score INTEGER NOT NULL, accuracy INTEGER NOT NULL, completeness INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_scores_entry ON journal_scores(journal_id, created_at);
    ''')
    columns={r[1] for r in c.execute('PRAGMA table_info(speaking_journals)')}
    if 'parts_json' not in columns:
        c.execute("ALTER TABLE speaking_journals ADD COLUMN parts_json TEXT NOT NULL DEFAULT '[]'")
    if 'analyses_json' not in columns:
        # Per-part sentence breakdowns (the same cards as the study page), cached so the LLM runs once.
        c.execute("ALTER TABLE speaking_journals ADD COLUMN analyses_json TEXT NOT NULL DEFAULT '{}'")


def create(user_id,native_text):
    if len(native_text.strip())<5:raise ValueError('请先写下你想说的内容 / Write your own idea first')
    journal_id=uuid.uuid4().hex;stamp=coach.now().isoformat()
    with auth_db.connect() as c:
        init(c)
        count=c.execute('SELECT count(*) FROM speaking_journals WHERE user_id=? AND day=?',(user_id,coach.date_for(user_id).isoformat())).fetchone()[0]
        if count>=10:raise ValueError('今天的作业已足够，请先完成已有练习 / Finish an existing entry first')
        c.execute('INSERT INTO speaking_journals(id,user_id,day,native_text,created_at,updated_at) VALUES(?,?,?,?,?,?)',(journal_id,user_id,coach.date_for(user_id).isoformat(),native_text,stamp,stamp))
    return get(user_id,journal_id)


def get(user_id,journal_id):
    with auth_db.connect() as c:
        init(c);row=c.execute('SELECT * FROM speaking_journals WHERE id=? AND user_id=?',(journal_id,user_id)).fetchone()
        if not row:raise KeyError(journal_id)
        recordings=c.execute('SELECT id,kind,duration,created_at FROM journal_recordings WHERE journal_id=? ORDER BY created_at',(journal_id,)).fetchall()
        scores=c.execute('SELECT id,part,sentence,score,accuracy,completeness,created_at FROM journal_scores WHERE journal_id=? ORDER BY created_at DESC LIMIT 400',(journal_id,)).fetchall()
    d=dict(row);d.pop('reference_file');d['recordings']=[dict(x, url=f'/api/homework/{journal_id}/recordings/{x["id"]}') for x in recordings]
    d['reference_url']=f'/api/homework/{journal_id}/reference' if row['reference_file'] else ''
    d['complete']=row['status']=='complete'
    d['parts']=json.loads(d.pop('parts_json'))
    d['analyses']=json.loads(d.pop('analyses_json') or '{}')
    d['scores']=[dict(x) for x in scores]
    d['can_expand']=not d['parts'] and bool(d['french']) and not recordings
    return d


def list_entries(user_id):
    with auth_db.connect() as c:
        init(c);ids=[x[0] for x in c.execute('SELECT id FROM speaking_journals WHERE user_id=? ORDER BY created_at DESC LIMIT 30',(user_id,))]
    entries=[]
    for i in ids:
        e=get(user_id,i)
        # The history list stays light; the full entry is fetched when it is opened.
        e['analyses']={};e['scores']=[]
        entries.append(e)
    return entries


def prepared(user_id,journal_id,french,reference_file,parts=None):
    get(user_id,journal_id)
    parts_json=json.dumps(parts or [],ensure_ascii=False)
    with auth_db.connect() as c:
        init(c);c.execute('BEGIN IMMEDIATE')
        if c.execute('SELECT 1 FROM journal_recordings WHERE journal_id=?',(journal_id,)).fetchone():
            raise ValueError('已有录音的文本会保留，请另建一份作业 / Preserve recorded text; create another entry')
        current=c.execute('SELECT french,parts_json FROM speaking_journals WHERE id=? AND user_id=?',(journal_id,user_id)).fetchone()
        changed=not current or current['french']!=french or current['parts_json']!=parts_json
        stamp=coach.now().isoformat()
        if changed:
            # New text: the cached sentence breakdowns belong to the old text.
            c.execute("UPDATE speaking_journals SET french=?, reference_file=?, parts_json=?, analyses_json='{}', status='ready',updated_at=? WHERE id=? AND user_id=?",(french,Path(reference_file).name if reference_file else '',parts_json,stamp,journal_id,user_id))
        else:
            c.execute("UPDATE speaking_journals SET french=?, reference_file=?, parts_json=?, status='ready',updated_at=? WHERE id=? AND user_id=?",(french,Path(reference_file).name if reference_file else '',parts_json,stamp,journal_id,user_id))
    return get(user_id,journal_id)


def get_analysis_chunk(entry,part,chunk):
    slot=(entry.get('analyses') or {}).get(str(part)) or {}
    chunks=slot.get('chunks') or {}
    return chunks.get(str(chunk))


def analysis_done_chunks(entry,part):
    slot=(entry.get('analyses') or {}).get(str(part)) or {}
    return sorted(int(k) for k in (slot.get('chunks') or {}) if str(k).isdigit())


def save_analysis(user_id,journal_id,part,chunk,sentences,total):
    get(user_id,journal_id)
    with auth_db.connect() as c:
        init(c);c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT analyses_json FROM speaking_journals WHERE id=? AND user_id=?',(journal_id,user_id)).fetchone()
        data=json.loads(row[0] or '{}')
        slot=data.setdefault(str(part),{'chunks':{},'total':total})
        slot['total']=total;slot['chunks'][str(chunk)]=sentences
        c.execute('UPDATE speaking_journals SET analyses_json=?,updated_at=? WHERE id=? AND user_id=?',(json.dumps(data,ensure_ascii=False),coach.now().isoformat(),journal_id,user_id))
    return get(user_id,journal_id)


def clear_analysis(user_id,journal_id,part):
    get(user_id,journal_id)
    with auth_db.connect() as c:
        init(c);c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT analyses_json FROM speaking_journals WHERE id=? AND user_id=?',(journal_id,user_id)).fetchone()
        data=json.loads(row[0] or '{}')
        if str(part) in data:
            data.pop(str(part))
            c.execute('UPDATE speaking_journals SET analyses_json=?,updated_at=? WHERE id=? AND user_id=?',(json.dumps(data,ensure_ascii=False),coach.now().isoformat(),journal_id,user_id))
    return get(user_id,journal_id)


def add_score(user_id,journal_id,part,sentence,score,accuracy,completeness):
    get(user_id,journal_id)
    stamp=coach.now().isoformat()
    with auth_db.connect() as c:
        init(c);c.execute('BEGIN IMMEDIATE')
        c.execute('INSERT INTO journal_scores VALUES(?,?,?,?,?,?,?,?)',(uuid.uuid4().hex,journal_id,int(part),sentence[:400],int(score),int(accuracy),int(completeness),stamp))
        c.execute('UPDATE speaking_journals SET updated_at=? WHERE id=?',(stamp,journal_id))
    return {'part':int(part),'sentence':sentence[:400],'score':int(score),'accuracy':int(accuracy),'completeness':int(completeness),'created_at':stamp}


def attach_reference(user_id,journal_id,reference_file,expected_text=None):
    get(user_id,journal_id)
    with auth_db.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        current=c.execute('SELECT french FROM speaking_journals WHERE id=? AND user_id=?',(journal_id,user_id)).fetchone()
        if expected_text is not None and current['french']!=expected_text:
            raise ValueError('练习已更新，请重新加载 / Practice changed; please reload')
        c.execute('UPDATE speaking_journals SET reference_file=?,updated_at=? WHERE id=? AND user_id=?',
                  (Path(reference_file).name,coach.now().isoformat(),journal_id,user_id))
    return get(user_id,journal_id)


def add_recording(user_id,journal_id,kind,audio,duration,extension):
    entry=get(user_id,journal_id)
    if not entry['french']:raise ValueError('先准备法语文本 / Prepare your French text first')
    sha=hashlib.sha256(audio).hexdigest();record_id=uuid.uuid4().hex
    filename=record_id+extension
    folder=root()/str(user_id)/journal_id;folder.mkdir(parents=True,exist_ok=True)
    file=folder/filename;stored=duration
    with auth_db.connect() as c:
        init(c);c.execute('BEGIN IMMEDIATE')
        existing=c.execute('SELECT id FROM journal_recordings WHERE journal_id=? AND kind=? AND sha=?',(journal_id,kind,sha)).fetchone()
        if existing:
            stored=0
        else:
            if kind=='first' and c.execute("SELECT 1 FROM journal_recordings WHERE journal_id=? AND kind='first'",(journal_id,)).fetchone():
                raise ValueError('第一遍录音已存档；后续请保存为最后一遍 / First recording is preserved; use Final')
            if c.execute('SELECT count(*) FROM journal_recordings WHERE journal_id=?',(journal_id,)).fetchone()[0]>=12:
                raise ValueError('这份作业的录音已足够 / Recording limit reached for this entry')
            file.write_bytes(audio)
            try:
                c.execute('INSERT INTO journal_recordings VALUES(?,?,?,?,?,?,?)',(record_id,journal_id,kind,filename,duration,sha,coach.now().isoformat()))
            except Exception:
                file.unlink(missing_ok=True);raise
            c.execute('UPDATE speaking_journals SET updated_at=? WHERE id=?',(coach.now().isoformat(),journal_id))
    return get(user_id,journal_id),stored


def practice(user_id,journal_id,beat_id,seconds):
    get(user_id,journal_id)
    stamp=coach.now();stored=0
    with auth_db.connect() as c:
        init(c);c.execute('BEGIN IMMEDIATE')
        if not c.execute('SELECT 1 FROM journal_beats WHERE journal_id=? AND beat_id=?',(journal_id,beat_id)).fetchone():
            # Bound the heartbeat by wall time since the previous beat (or entry creation).
            row=c.execute('SELECT created_at FROM journal_beats WHERE journal_id=? ORDER BY created_at DESC LIMIT 1',(journal_id,)).fetchone()
            start=datetime.datetime.fromisoformat(row[0] if row else c.execute('SELECT created_at FROM speaking_journals WHERE id=?',(journal_id,)).fetchone()[0])
            stored=max(0,min(seconds,30,int((stamp-start).total_seconds())))
            c.execute('INSERT INTO journal_beats VALUES(?,?,?,?)',(journal_id,beat_id,stored,stamp.isoformat()))
            c.execute('UPDATE speaking_journals SET practice_seconds=practice_seconds+?,updated_at=? WHERE id=?',(stored,stamp.isoformat(),journal_id))
    return stored


def finish(user_id,journal_id,reflection,recalled):
    entry=get(user_id,journal_id)
    kinds={r['kind'] for r in entry['recordings']}
    if not entry['french'] or not {'first','final'} <= kinds or not reflection.strip():
        raise ValueError('请保存首尾录音和心得后再交作业 / Save first and final recordings plus a reflection')
    with auth_db.connect() as c:
        init(c);c.execute("UPDATE speaking_journals SET reflection=?,recalled=?,status='complete',updated_at=? WHERE id=? AND user_id=?",(reflection,int(recalled),coach.now().isoformat(),journal_id,user_id))
    coach.record(user_id,'speak','homework:'+journal_id,{'source':'personal_expression','recalled_self_report':recalled},15)
    return get(user_id,journal_id)


def reference_path(user_id,journal_id):
    get(user_id,journal_id)
    with auth_db.connect() as c:
        init(c);filename=c.execute('SELECT reference_file FROM speaking_journals WHERE id=?',(journal_id,)).fetchone()[0]
    if not filename:raise KeyError(journal_id)
    return auth_db._get_db_path().parent/filename


def recording_path(user_id,journal_id,record_id):
    get(user_id,journal_id)
    with auth_db.connect() as c:
        init(c);row=c.execute('SELECT filename FROM journal_recordings WHERE journal_id=? AND id=?',(journal_id,record_id)).fetchone()
    if not row:raise KeyError(record_id)
    return root()/str(user_id)/journal_id/row[0]


def archive(user_id,journal_id):
    entry=get(user_id,journal_id);buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('text.txt',entry['native_text']+'\n\n'+entry['french'])
        z.writestr('reflection.txt',entry['reflection'])
        z.writestr('parts.json',json.dumps(entry['parts'],ensure_ascii=False,indent=2))
        z.writestr('practice.json',json.dumps({'practice_seconds':entry['practice_seconds'],'recalled_self_report':bool(entry['recalled']),'recordings':entry['recordings']},ensure_ascii=False,indent=2))
        if entry['scores']:
            z.writestr('scores.json',json.dumps(entry['scores'],ensure_ascii=False,indent=2))
        if entry['analyses']:
            z.writestr('analysis.json',json.dumps(entry['analyses'],ensure_ascii=False,indent=2))
        ref=reference_path(user_id,journal_id)
        if ref.exists():z.write(ref,'model.mp3')
        for i,r in enumerate(entry['recordings']):
            p=recording_path(user_id,journal_id,r['id']);z.write(p,f'{r["kind"]}-{i+1}'+p.suffix)
    return buf.getvalue(),entry['day']+'-'+journal_id[:8]+'.zip'
