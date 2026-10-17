"""Generate UI fixture JSON in a temporary test database, never the real account DB."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import testenv  # noqa: F401
import json
import auth_db
import coach
import writing
from test_coach import profile
u=auth_db.register_user('ui@example.com','password123')['user']['id']
p=profile();p['study_days']=list(range(7));coach.save_profile(u,p)
print(json.dumps({'dashboard':coach.dashboard(u),'writing':{'tasks':writing.TASKS,'subjects':writing.SUBJECTS,'practice_default':'P0','recommended_level':'A1','attempts':[]},'check':coach.start_check(u,theme='cafe')},ensure_ascii=False))
