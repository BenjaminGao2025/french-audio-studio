"""Persisted learning plans, evidence and short listening checks.

CEFR is self-reported, and XP is motivation only. LLM suggestions cannot increase
availability or award language qualifications. Every reward is tied to a unique event.
"""
from __future__ import annotations
import datetime as dt
import json
import math
import uuid
from contextlib import contextmanager
from zoneinfo import ZoneInfo

import auth_db
import curriculum

KINDS = ('listen', 'write', 'speak', 'review', 'read')
LINKS = {'listen': '/listen#mini-listening', 'write': '/write', 'speak': '/study?mode=personal', 'review': '/review', 'read': '/study'}
LABELS = {'listen': ('听懂一小段', 'Understand a short clip'), 'write': ('写一段并订正', 'Write and revise'), 'speak': ('练自己想说的话并存档', 'Practise your own words and save recordings'), 'review': ('复习到期卡片', 'Review due cards'), 'read': ('拆解一个短句', 'Study a short sentence')}
# Hours per week of the 16 h plan (game.LANE_WEEK_TARGETS: 210/120/300/90/240 min), so a stored coach plan splits
# its own weekly minutes in the same proportions. The AI coach may adjust them within 1..5.
DEFAULT_WEIGHTS = {'listen': 3.5, 'write': 2, 'speak': 5, 'review': 1.5, 'read': 4}

@contextmanager
def db():
    with auth_db.connect() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS coach_profiles (user_id INTEGER PRIMARY KEY, profile_json TEXT NOT NULL, plan_json TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS learning_events (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, day TEXT NOT NULL, xp INTEGER NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id,kind,source));
        CREATE INDEX IF NOT EXISTS idx_learning_day ON learning_events(user_id,day);
        CREATE TABLE IF NOT EXISTS listening_checks (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, lesson_id TEXT NOT NULL, level TEXT NOT NULL, challenge INTEGER NOT NULL, week TEXT NOT NULL, assisted INTEGER NOT NULL DEFAULT 0, result_json TEXT, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS coach_reviews (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, review_json TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS coach_days (user_id INTEGER NOT NULL, day TEXT NOT NULL, tasks_json TEXT NOT NULL, PRIMARY KEY(user_id,day));
        ''')
        yield c


def now():
    return dt.datetime.now(dt.timezone.utc)


def get_profile(user_id):
    with db() as c:
        row = c.execute('SELECT * FROM coach_profiles WHERE user_id=?', (user_id,)).fetchone()
    return {'profile': json.loads(row['profile_json']), 'plan': json.loads(row['plan_json'])} if row else None


def local_date(profile=None, at=None):
    return ((at or now()).astimezone(ZoneInfo((profile or {}).get('timezone', 'America/Vancouver'))) - dt.timedelta(hours=4)).date()


def date_for(user_id, at=None):
    stored = get_profile(user_id)
    return local_date(stored['profile'] if stored else None, at)


def budget(profile, day):
    if day.weekday() not in profile['study_days']:
        return 0
    return profile['weekend_minutes'] if day.weekday() >= 5 else profile['weekday_minutes']


def base_plan(profile, at=None):
    today = local_date(profile, at)
    deadline = dt.date.fromisoformat(profile['deadline'])
    days = max(0, (deadline-today).days)
    weekly = sum(budget(profile, today + dt.timedelta(days=i)) for i in range(7))
    hours = sum(budget(profile, today+dt.timedelta(days=i)) for i in range(days+1)) / 60
    # Milestone dates are planning checkpoints, never automatic promotions.
    checkpoints = [dict(date=(today+dt.timedelta(days=round(days*f))).isoformat(), focus=focus)
                   for f, focus in [(0.2, '基础表达与短句理解 / Basic sentences'), (0.45, '生活情境与独立表达 / Everyday independence'), (0.7, '长段理解与叙述 / Connected speech'), (0.85, 'TCF 四项诊断与首考准备 / Four-skill check'), (1, '目标成绩截止 / Results deadline')]]
    return dict(source='rules', summary='先按可用时间开始。完成练习后每周复盘，等级由实际表现检查。 / Start within your available time; review evidence each week.',
                weekly_minutes=weekly, available_hours=round(hours, 1), days_left=days,
                task_weights=DEFAULT_WEIGHTS.copy(), checkpoints=checkpoints, questions=[],
                caution='从 A1 到四项 NCLC 7 是有挑战的目标。可用小时不能保证成绩；阶段检查后决定是否需要更多时间、教师辅导或调整日期。 / Available hours do not guarantee a test result.',
                exam_window=(deadline-dt.timedelta(days=45)).isoformat())


def save_profile(user_id, profile, at=None):
    plan = base_plan(profile, at)
    with db() as c:
        c.execute('INSERT INTO coach_profiles VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json, plan_json=excluded.plan_json, updated_at=excluded.updated_at',
                  (user_id, json.dumps(profile, ensure_ascii=False), json.dumps(plan, ensure_ascii=False), now().isoformat()))
        c.execute('DELETE FROM coach_days WHERE user_id=? AND day>=?', (user_id, local_date(profile, at).isoformat()))
    return {'profile': profile, 'plan': plan}


def save_ai_plan(user_id, raw, expected_updated=None, note=""):
    stored = get_profile(user_id)
    if not stored:
        raise ValueError('请先填写目标 / Set a goal first')
    plan = base_plan(stored['profile'])
    parsed = json.loads(raw.strip().removeprefix('```json').removeprefix('```').removesuffix('```').strip())
    if not isinstance(parsed, dict) or not isinstance(parsed.get('summary'), str):
        raise ValueError('教练返回格式不完整 / Incomplete coach response')
    plan['summary'] = parsed['summary'][:2500]
    plan['questions'] = [str(q)[:400] for q in parsed.get('questions', [])[:3]] if isinstance(parsed.get('questions'), list) else []
    weights = parsed.get('task_weights', {})
    if isinstance(weights, dict):
        for k in KINDS:
            value = weights.get(k)
            if isinstance(value, (int, float)) and math.isfinite(value):
                plan['task_weights'][k] = max(1, min(5, value))
    plan['interview_notes'] = (stored['plan'].get('interview_notes', '') + '\n' + note).strip()[-6000:]
    plan['source'] = 'llm'
    plan['generated_at'] = now().isoformat()
    with db() as c:
        row = c.execute('SELECT profile_json FROM coach_profiles WHERE user_id=?', (user_id,)).fetchone()
        if expected_updated is not None and json.loads(row['profile_json']) != expected_updated:
            raise ValueError('目标已修改，请重新生成 / Goal changed; generate again')
        c.execute('UPDATE coach_profiles SET plan_json=?,updated_at=? WHERE user_id=?', (json.dumps(plan, ensure_ascii=False), now().isoformat(), user_id))
        c.execute('DELETE FROM coach_days WHERE user_id=? AND day>=?', (user_id, local_date(stored['profile']).isoformat()))
    return plan


def record(user_id, kind, source, data=None, xp=10):
    if kind not in (*KINDS, 'revision', 'challenge', 'self'):
        raise ValueError('Unknown evidence type')
    day = date_for(user_id).isoformat()
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        if c.execute('SELECT 1 FROM learning_events WHERE user_id=? AND kind=? AND source=?', (user_id,kind,source)).fetchone():
            return 0
        count = c.execute('SELECT count(*) FROM learning_events WHERE user_id=? AND day=? AND kind=? AND xp>0', (user_id,day,kind)).fetchone()[0]
        earned = max(0, min(20, xp)) if count < 3 else 0
        c.execute('INSERT INTO learning_events(user_id,kind,source,day,xp,data_json,created_at) VALUES(?,?,?,?,?,?,?)',
                  (user_id,kind,source,day,earned,json.dumps(data or {},ensure_ascii=False),now().isoformat()))
    return earned


def progress(user_id, day=None):
    day = day or date_for(user_id)
    with db() as c:
        rows = c.execute('SELECT kind,day,xp,data_json FROM learning_events WHERE user_id=?', (user_id,)).fetchall()
    today = [r for r in rows if r['day']==day.isoformat()]
    recent = [r for r in rows if (day-dt.timedelta(days=6)).isoformat() <= r['day'] <= day.isoformat()]
    counts = {k: sum(r['kind']==k for r in recent) for k in (*KINDS,'revision','challenge')}
    completed = {r['kind'] for r in today}
    clean = [r for r in recent if r['kind']=='listen' and (d:=json.loads(r['data_json'])).get('score')==3 and not d.get('assisted')]
    distinct = len({json.loads(r['data_json']).get('lesson_id') for r in clean})
    quests = [dict(kind=k, done=k in completed, href=LINKS[k], zh=LABELS[k][0], en=LABELS[k][1]) for k in ('listen','write','speak')]
    all_days = {r['day'] for r in rows}
    quest_days = [d for d in all_days if {'listen','write','speak'} <= {r['kind'] for r in rows if r['day']==d}]
    return dict(xp=sum(r['xp'] for r in rows), today_xp=sum(r['xp'] for r in today), quests=quests, weekly=counts,
                independent_listens=distinct, suggest_a1=distinct>=3,
                activity_days=len(all_days), completed_days=quest_days, evidence_note='完成记录与练习表现，不是考试分数 / Practice evidence, not exam scores')


def writing_evidence(user_id, attempt):
    fb1, fb2 = attempt.get('feedback_1') or {}, attempt.get('feedback_2') or {}
    if fb1 and len(attempt.get('text_1','').split()) >= 3:
        record(user_id,'write',attempt['id'],dict(task=attempt['task'], level=attempt['level']),10)
    if (fb2 and attempt.get('text_2','').strip() != attempt.get('text_1','').strip()
        and any(x.get('fixed') is True for x in fb2.get('fixed_errors',[]))):
        record(user_id,'revision',attempt['id'],dict(task=attempt['task']),15)


def speaking_evidence(user_id, attempt):
    if attempt.get('feedback_1') and len(attempt.get('transcript_1','').split()) >= 3:
        record(user_id,'speak',attempt['id'],dict(task=attempt['task'],level=attempt['level']),10)


def daily_tasks(user_id, stored, day):
    with db() as c:
        row = c.execute('SELECT tasks_json FROM coach_days WHERE user_id=? AND day=?',(user_id,day.isoformat())).fetchone()
        if row:
            return json.loads(row[0])
    p, plan = stored['profile'], stored['plan']
    minutes = budget(p,day)
    theme = curriculum.LESSONS[day.toordinal()%len(curriculum.LESSONS)]['id']
    # Short days rotate skills; longer days cover all five. No negative or overflow budgets.
    count = min(5, max(1, minutes//10)) if minutes else 0
    ordered = list(KINDS)
    shift = day.toordinal()%3
    ordered[:3] = ordered[shift:3]+ordered[:shift]
    chosen = ordered[:count]
    weights = plan.get('task_weights', DEFAULT_WEIGHTS)
    total = sum(weights.get(k,1) for k in chosen) or 1
    allocations = [int(minutes*weights.get(k,1)/total) for k in chosen]
    for i in range(minutes-sum(allocations)):
        allocations[i%len(allocations)] += 1
    time = p['weekend_start'] if day.weekday()>=5 else p['weekday_start']
    hh,mm = map(int,time.split(':')); cursor=hh*60+mm
    tasks=[]
    for k, duration in zip(chosen,allocations):
        level=p['levels'].get(k,'A1')
        if p['exam'] != 'TCF Canada' and level in ('B1', 'B2'): level = 'A2'
        task='P0' if level in ('A0','A1') else 'P2' if level=='A2' else 'T1' if level=='B1' else 'T3'
        link = LINKS[k]
        if k=='write': link=f'/write?task={task}&theme={theme}'
        if k=='listen': link=f'/listen?theme={theme}#mini-listening'
        if k=='read':
            from urllib.parse import quote
            link='/study?text='+quote(curriculum.BY_ID[theme]['lines'][0][0])
        tasks.append(dict(kind=k, minutes=duration, start=f'{cursor//60:02}:{cursor%60:02}', end=f'{(cursor+duration)//60:02}:{(cursor+duration)%60:02}', zh=LABELS[k][0], en=LABELS[k][1], href=link, theme=theme))
        cursor+=duration
    with db() as c:
        c.execute('INSERT OR IGNORE INTO coach_days VALUES(?,?,?)',(user_id,day.isoformat(),json.dumps(tasks,ensure_ascii=False)))
    return tasks


def dashboard(user_id):
    stored=get_profile(user_id);day=date_for(user_id)
    evidence=progress(user_id,day)
    schedule=[dict(day=(day+dt.timedelta(days=i)).isoformat(), tasks=daily_tasks(user_id,stored,day+dt.timedelta(days=i))) for i in range(7)] if stored else []
    tasks=schedule[0]["tasks"] if schedule else []
    with db() as c:
        today={r['kind'] for r in c.execute('SELECT kind FROM learning_events WHERE user_id=? AND day=?',(user_id,day.isoformat()))}
        self_sources={r['source'] for r in c.execute("SELECT source FROM learning_events WHERE user_id=? AND day=? AND kind='self'",(user_id,day.isoformat()))}
        review=c.execute('SELECT review_json,created_at FROM coach_reviews WHERE user_id=? ORDER BY created_at DESC LIMIT 1',(user_id,)).fetchone()
        snapshots=c.execute('SELECT day,tasks_json FROM coach_days WHERE user_id=? AND day>=? AND day<=?',(user_id,(day-dt.timedelta(days=6)).isoformat(),day.isoformat())).fetchall()
        records=c.execute('SELECT kind,day,source FROM learning_events WHERE user_id=? AND day>=? AND day<=?',(user_id,(day-dt.timedelta(days=6)).isoformat(),day.isoformat())).fetchall()
    for task in tasks:
        task['verified']=task['kind'] in today
        task['self_reported']=f'{day}:{task["kind"]}' in self_sources
        task['done']=task['verified'] or task['self_reported']
    planned=sum(len(json.loads(r['tasks_json'])) for r in snapshots)
    actual=sum(any(e['day']==r['day'] and e['kind']==t['kind'] for e in records) for r in snapshots for t in json.loads(r['tasks_json']))
    homework_evidence={'archived':0,'recordings':0,'practice_minutes':0}
    with db() as c:
        if c.execute("SELECT 1 FROM sqlite_master WHERE name='speaking_journals'").fetchone():
            start=(day-dt.timedelta(days=6)).isoformat()
            j=c.execute("SELECT count(*),sum(practice_seconds) FROM speaking_journals WHERE user_id=? AND day BETWEEN ? AND ? AND status='complete'",(user_id,start,day.isoformat())).fetchone()
            r=c.execute('SELECT count(*) FROM journal_recordings r JOIN speaking_journals j ON r.journal_id=j.id WHERE j.user_id=? AND j.day BETWEEN ? AND ?',(user_id,start,day.isoformat())).fetchone()
            homework_evidence={'archived':j[0],'recordings':r[0],'practice_minutes':round((j[1] or 0)/60,1)}
    report=dict(homework=homework_evidence,planned_tasks=planned, verified_tasks=actual, planned_days=len(snapshots), self_reports=sum(r['kind']=='self' for r in records), weekly=evidence['weekly'])
    result=dict(day=day.isoformat(), setup=bool(stored), tasks=tasks, schedule=schedule, progress=evidence, weekly_report=report,
                last_review=json.loads(review['review_json']) if review else None,
                review_due=not review or (now()-dt.datetime.fromisoformat(review['created_at'])).days>=7)
    if stored:
        result.update(stored)
        result['capacity']=base_plan(stored['profile'])
    return result


def save_review(user_id, note, ai_text=''):
    report=dashboard(user_id)['weekly_report']
    result=dict(id=uuid.uuid4().hex, date=date_for(user_id).isoformat(), evidence=report, learner_note=note,
                advice=ai_text or '先检查哪些任务太难或时段不合适。完成较少时缩小每天任务；连续独立完成后再加难度。 / Review difficulty and timing before increasing workload.', source='llm' if ai_text else 'rules')
    with db() as c:
        c.execute('INSERT INTO coach_reviews VALUES(?,?,?,?)',(result['id'],user_id,json.dumps(result,ensure_ascii=False),now().isoformat()))
    return result


def start_check(user_id, level='starter', theme=None, challenge=False):
    day=date_for(user_id);week=(day-dt.timedelta(days=day.weekday())).isoformat()
    lesson=curriculum.CHALLENGES[(day.toordinal()//7)%len(curriculum.CHALLENGES)] if challenge else curriculum.BY_ID.get(theme or '') or curriculum.LESSONS[day.toordinal()%len(curriculum.LESSONS)]
    if not challenge and lesson in curriculum.CHALLENGES:
        raise ValueError('请选择日常练习 / Choose a practice lesson')
    with db() as c:
        # Reloads and double submissions reuse the same check, so answers cannot be farmed.
        row=c.execute('SELECT * FROM listening_checks WHERE user_id=? AND lesson_id=? AND level=? AND challenge=? AND week=? ORDER BY created_at DESC LIMIT 1', (user_id,lesson['id'],level,int(challenge),week if challenge else day.isoformat())).fetchone()
        if not row:
            check_id=uuid.uuid4().hex
            c.execute('INSERT INTO listening_checks(id,user_id,lesson_id,level,challenge,week,created_at) VALUES(?,?,?,?,?,?,?)',(check_id,user_id,lesson['id'],level,int(challenge),week if challenge else day.isoformat(),now().isoformat()))
        else: check_id=row['id']
    return get_check(user_id,check_id)


def get_check(user_id,check_id):
    with db() as c:
        row=c.execute('SELECT * FROM listening_checks WHERE id=? AND user_id=?',(check_id,user_id)).fetchone()
    if not row: raise KeyError(check_id)
    return dict(id=row['id'],lesson=curriculum.public_lesson(row['lesson_id']), level=row['level'], challenge=bool(row['challenge']), assisted=bool(row['assisted']), result=json.loads(row['result_json']) if row['result_json'] else None)


def transcript(user_id,check_id):
    check=get_check(user_id,check_id)
    if check['challenge'] and not check['result']:
        raise ValueError('挑战提交后可查看原文 / Submit the check before viewing the transcript')
    with db() as c:
        c.execute('UPDATE listening_checks SET assisted=1 WHERE id=? AND result_json IS NULL',(check_id,))
    return curriculum.BY_ID[check['lesson']['id']]['lines']


def answer_check(user_id,check_id,answers):
    check=get_check(user_id,check_id)
    if check['result']:
        result = check['result']
        record(user_id,'challenge' if check['challenge'] else 'listen',check_id,result,20 if result['score']==result['total'] else 5)
        return result
    lesson=curriculum.BY_ID[check['lesson']['id']]
    if len(answers)!=len(lesson['questions']): raise ValueError('请回答每道题 / Answer all questions')
    correct=[q[3] for q in lesson['questions']]
    score=sum(a==b for a,b in zip(answers,correct))
    result=dict(score=score,total=len(correct),correct=correct,assisted=check['assisted'],lesson_id=lesson['id'],level=check['level'])
    # Store first answer transactionally; retries return the original result.
    with db() as c:
        updated=c.execute('UPDATE listening_checks SET result_json=? WHERE id=? AND user_id=? AND result_json IS NULL',(json.dumps(result),check_id,user_id)).rowcount
    if not updated: return get_check(user_id,check_id)['result']
    record(user_id,'challenge' if check['challenge'] else 'listen',check_id,result,20 if score==len(correct) else 5)
    return result


def timezone_offset(user_id):
    stored=get_profile(user_id)
    zone=ZoneInfo((stored or {}).get('profile',{}).get('timezone','America/Vancouver'))
    return -int(now().astimezone(zone).utcoffset().total_seconds()/60)
