"""First-party usage events: POST /api/events, retention and the usage report."""

import datetime
import importlib.util
import io
import json
import time
import unittest
import uuid
from contextlib import redirect_stdout
from pathlib import Path

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi.testclient import TestClient

import auth_db
import tts_service
import usage
import web_common

ROOT = Path(__file__).resolve().parent.parent
DAY_MS = 24 * 3600 * 1000


def _new_user() -> tuple[int, str, str]:
    email = f"usage_{uuid.uuid4().hex[:10]}@example.com"
    reg = auth_db.register_user(email, "password123")
    return reg["user"]["id"], reg["token"], email


def _rows(user_id: int) -> list[dict]:
    with usage._connect() as conn:
        rows = conn.execute(
            "SELECT session, name, route, props_json, ts FROM ui_events WHERE user_id = ? ORDER BY id", (user_id,)
        ).fetchall()
    return [dict(r) | {"props": json.loads(r["props_json"])} for r in rows]


def _now_ms() -> int:
    return int(time.time() * 1000)


class EventsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.user_id, self.token, _ = _new_user()
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def post(self, body, headers=None, **kw):
        return self.client.post("/api/events", json=body, headers=self.headers if headers is None else headers, **kw)

    def test_requires_sign_in(self):
        res = self.post({"events": [{"name": "screen_view", "route": "study"}]}, headers={})
        self.assertEqual(res.status_code, 401)
        res = self.post({"events": [{"name": "screen_view"}]}, headers={"Authorization": "Bearer nope"})
        self.assertEqual(res.status_code, 401)

    def test_stores_a_batch(self):
        ts = _now_ms() - 5000
        res = self.post(
            {
                "session": "abc123def456",
                "events": [
                    {"name": "screen_view", "route": "review/session", "ts": ts},
                    {"name": "check_answer", "route": "review/session", "props": {"screen": "review", "correct": True}, "ts": ts + 1},
                ],
            }
        )
        self.assertEqual(res.status_code, 204)
        rows = _rows(self.user_id)
        self.assertEqual([r["name"] for r in rows], ["screen_view", "check_answer"])
        self.assertEqual(rows[0]["session"], "abc123def456")
        self.assertEqual(rows[0]["ts"], ts)
        self.assertEqual(rows[1]["props"], {"correct": True, "screen": "review"})

    def test_session_cookie_works_for_send_beacon(self):
        self.client.cookies.set(web_common.SESSION_COOKIE, self.token)
        try:
            res = self.client.post(
                "/api/events",
                content=json.dumps({"events": [{"name": "screen_view", "route": "study"}]}),
                headers={"Content-Type": "text/plain"},
            )
        finally:
            self.client.cookies.clear()
        self.assertEqual(res.status_code, 204)
        self.assertEqual([r["name"] for r in _rows(self.user_id)], ["screen_view"])

    def test_drops_free_text_and_bad_events(self):
        res = self.post(
            {
                "session": "NOT A SESSION",
                "events": [
                    {"name": "word_tap", "route": "study", "props": {
                        "typed": "je voudrais un café s'il vous plaît",
                        "nested": False,
                        "count": 3,
                        "Bad Key": 1,
                        "obj": {"a": 1},
                        "list": [1, 2],
                        "nan": None,
                        "tab": "words",
                    }},
                    {"name": "Bad Name", "route": "study"},
                    {"name": "screen_view", "route": "study?text=bonjour tout le monde"},
                    {"name": "x" * 41, "route": "study"},
                ],
            }
        )
        self.assertEqual(res.status_code, 422)  # the over-long name fails validation for the whole batch
        res = self.post(
            {
                "session": "NOT A SESSION",
                "events": [
                    {"name": "word_tap", "route": "study", "props": {
                        "typed": "je voudrais un café",
                        "nested": False,
                        "count": 3,
                        "Bad Key": 1,
                        "obj": {"a": 1},
                        "tab": "words",
                    }},
                    {"name": "Bad Name", "route": "study"},
                    {"name": "screen_view", "route": "study?text=bonjour"},
                ],
            }
        )
        self.assertEqual(res.status_code, 204)
        rows = _rows(self.user_id)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["session"], "")
        self.assertEqual(rows[0]["props"], {"count": 3, "nested": False, "tab": "words"})

    def test_props_are_capped(self):
        props = {f"k{i}": i for i in range(20)}
        self.assertEqual(len(usage.clean_props(props)), usage.MAX_PROPS)
        self.assertEqual(usage.clean_props({"x": float("inf"), "y": 10**12, "z": 1.23456}), {"z": 1.235})
        self.assertEqual(usage.clean_props("not a dict"), {})

    def test_far_off_client_clock_uses_server_time(self):
        before = _now_ms()
        self.post({"events": [{"name": "screen_view", "route": "study", "ts": 1}]})
        self.assertGreaterEqual(_rows(self.user_id)[0]["ts"], before)

    def test_batch_and_body_size_caps(self):
        too_many = {"events": [{"name": "screen_view", "route": "study"}] * (usage.MAX_EVENTS_PER_BATCH + 1)}
        self.assertEqual(self.post(too_many).status_code, 422)
        big = {"events": [{"name": "screen_view", "route": "study"}], "pad": "x" * (usage.MAX_BODY_BYTES + 10)}
        self.assertEqual(self.post(big).status_code, 413)
        self.assertEqual(self.client.post("/api/events", content=b"{not json", headers=self.headers).status_code, 422)
        self.assertEqual(_rows(self.user_id), [])

    def test_rate_limited(self):
        capacity = int(web_common.RATE_LIMITS["events"][0])
        body = {"events": [{"name": "screen_view", "route": "study"}]}
        codes = [self.post(body).status_code for _ in range(capacity + 1)]
        self.assertEqual(codes[:capacity], [204] * capacity)
        self.assertEqual(codes[-1], 429)


class RetentionTests(unittest.TestCase):
    def test_purge_drops_events_older_than_retention(self):
        user_id, _, _ = _new_user()
        now = _now_ms()
        old = now - (usage.RETENTION_DAYS + 1) * DAY_MS
        recent = now - (usage.RETENTION_DAYS - 1) * DAY_MS
        with usage._connect() as conn:
            conn.executemany(
                "INSERT INTO ui_events (user_id, name, route, ts, received_at) VALUES (?, 'screen_view', 'study', ?, ?)",
                [(user_id, old, old), (user_id, recent, recent)],
            )
        self.assertGreaterEqual(usage.purge_old(now), 1)
        self.assertEqual([r["ts"] for r in _rows(user_id)], [recent])


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _, self.email = _new_user()
        self.day = datetime.datetime.now(usage.REPORT_TZ).date()
        t = _now_ms() - 60_000

        def ev(name, route="study", **props):
            nonlocal t
            t += 10
            return {"name": name, "route": route, "props": props, "ts": t}

        usage.record(self.user_id, "sessionaaaa1", [
            ev("screen_view"),
            ev("word_tap"),
            ev("add_review_open"),
            ev("add_review_saved", cards=2),
            ev("screen_time", seconds=120),
            ev("play", owner="study"),
            ev("error_shown", msg="audio-couldnt-play"),
        ])
        usage.record(self.user_id, "sessionbbbb2", [
            ev("word_tap"),
            ev("screen_view", "review/session"),
            ev("check_answer", "review/session", screen="review", correct=True),
            ev("check_answer", "review/session", screen="review", correct=False),
            ev("screen_time", "review/session", seconds=300),
            ev("screen_time", "study", seconds=30),
        ])

    def test_summary(self):
        r = usage.report(self.user_id, self.day - datetime.timedelta(days=1), self.day)
        self.assertEqual(r["sessions"], 2)
        self.assertEqual(r["screens"][0], {"route": "review/session", "seconds": 300, "views": 1})
        self.assertEqual(r["screens"][1], {"route": "study", "seconds": 150, "views": 1})
        self.assertEqual(dict(r["actions"])["word_tap"], 2)
        self.assertNotIn("screen_time", dict(r["actions"]))
        self.assertEqual(r["funnels"]["word tap -> add to review saved"], [2, 1, 1])
        self.assertEqual(r["funnels"]["review session -> check answer"], [1, 1])
        self.assertEqual(r["checks"]["review"], {"total": 2, "correct": 1})
        self.assertEqual(r["errors"], [{"msg": "audio-couldnt-play", "route": "study", "count": 1}])
        self.assertIn("Screens by time:", usage.format_report(r))

    def test_date_range_excludes_other_days(self):
        r = usage.report(self.user_id, self.day - datetime.timedelta(days=10), self.day - datetime.timedelta(days=5))
        self.assertEqual(r["events"], 0)

    def test_cli(self):
        spec = importlib.util.spec_from_file_location("usage_report", ROOT / "scripts" / "usage_report.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        out = io.StringIO()
        with redirect_stdout(out):
            module.main(["--email", self.email, "--days", "2"])
        self.assertIn("word tap -> add to review saved: 2 -> 1 -> 1", out.getvalue())
        out = io.StringIO()
        with redirect_stdout(out):
            module.main(["--email", self.email, "--json"])
        self.assertEqual(json.loads(out.getvalue())["sessions"], 2)
        with self.assertRaises(SystemExit):
            module.main(["--email", "nobody@example.com"])


if __name__ == "__main__":
    unittest.main()
