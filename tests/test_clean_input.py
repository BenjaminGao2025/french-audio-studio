from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import testenv  # noqa: F401  (sets up the isolated env before tts_service is imported)
import tts_service as host

BEN_SAMPLE = (
    "两点你都说对了。**一个动词的写法由「人称」和「时态」共同决定。**\n"
    "mangeais 是未完成过去时，mangerai 是简单将来时。\n\n"
    "## 一个动词的全貌（以 parler 为例）\n"
    "| je | parle | parlais | parlerai |\n"
    "|---|---|---|---|\n"
    "| tu | parles | parlais | parleras |\n"
    "Je mangeais quand il est arrivé.\n"
)

PURE_FRENCH = (
    "Je mangeais quand il est arrivé.\n"
    "Demain, je mangerai une pomme.\n"
    "Elle parle français tous les jours."
)


def post(path, body, headers):
    return TestClient(host.app).post(path, json=body, headers=headers)


def non_empty_lines(text):
    return len([line for line in text.splitlines() if line.strip()])


def test_heuristic_flags_mixed_chinese_markdown():
    assert host.needs_input_cleaning(BEN_SAMPLE) is True


def test_heuristic_accepts_clean_french():
    assert host.needs_input_cleaning(PURE_FRENCH) is False


def test_post_process_drops_markdown_cjk_and_duplicates():
    raw = (
        "**Je mangeais quand il est arrivé.**\n"
        "中文解释：未完成过去时\n"
        "---\n"
        "1. je parle\n"
        "je parle\n"
        "| tu | parles |\n"
    )
    assert host.clean_extracted_lines(raw) == [
        "Je mangeais quand il est arrivé.",
        "je parle",
        "tu parles",
    ]


def test_endpoint_returns_cleaned_lines():
    headers = testenv.session_headers()
    reply = "Je parle.\nJe mangeais quand il est arrivé.\n| tu | parles |\n"
    with patch.object(host, "_post_chat", new_callable=AsyncMock, return_value=({}, reply)) as chat:
        r = post("/api/clean-input", {"text": BEN_SAMPLE}, headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["changed"] is True
    assert data["count"] == 3
    assert data["cleaned"].splitlines() == [
        "Je parle.",
        "Je mangeais quand il est arrivé.",
        "tu parles",
    ]
    payload = chat.await_args.args[1]
    assert payload["model"] == host.AGY_MODEL
    assert payload["temperature"] <= 0.2


def test_endpoint_falls_back_when_upstream_fails():
    headers = testenv.session_headers()
    with patch.object(
        host, "_post_chat", new_callable=AsyncMock, side_effect=host.HTTPException(504, "timeout")
    ):
        r = post("/api/clean-input", {"text": BEN_SAMPLE}, headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"cleaned": BEN_SAMPLE, "count": non_empty_lines(BEN_SAMPLE), "changed": False}


def test_endpoint_falls_back_when_model_returns_nothing():
    headers = testenv.session_headers()
    with patch.object(host, "_post_chat", new_callable=AsyncMock, return_value=({}, "  \n  ")):
        r = post("/api/clean-input", {"text": BEN_SAMPLE}, headers)
    assert r.status_code == 200, r.text
    assert r.json()["changed"] is False


def test_pure_french_never_calls_the_model():
    headers = testenv.session_headers()
    with patch.object(host, "_post_chat", new_callable=AsyncMock) as chat:
        r = post("/api/clean-input", {"text": PURE_FRENCH}, headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"cleaned": PURE_FRENCH, "count": non_empty_lines(PURE_FRENCH), "changed": False}
    chat.assert_not_awaited()


def test_requires_login():
    r = post("/api/clean-input", {"text": BEN_SAMPLE}, {})
    assert r.status_code == 401


def test_study_js_cleans_input_and_retries_parts():
    js = open("static/study.js", encoding="utf-8").read()
    assert "fetch('/api/clean-input'" in js
    assert "cleanInputForAnalysis(text, token, signal)" in js
    assert "await analyzePart(parts[index], token, model, signal)" in js  # the retrying one
    assert "const ANALYZE_RETRY_DELAYS = [1500, 4000];" in js
    # Progress is reported after every part, failed or skipped
    assert "done += 1;" in js and "showProgress();" in js
    assert js.count("cleanedInput:") == 2  # English and Chinese
