import testenv  # noqa: F401
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import auth_db
import tts_service


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('OUTPUT_DIR', str(tmp_path))
    return TestClient(tts_service.app)


def test_shared_persistent_cache_skips_llm_and_upstream_key(client, monkeypatch):
    chat = AsyncMock(return_value=({}, '<think>reasoning</think>构词：empêcher。\n记忆：被阻挡。'))
    monkeypatch.setattr(tts_service, '_post_chat', chat)
    first = client.post('/api/etymology', headers=testenv.session_headers(),
                        json={'word': 'empêché', 'lemma': ' Empêcher '})
    assert first.status_code == 200
    assert first.json() == {'text': '构词：empêcher。\n记忆：被阻挡。', 'cached': False}
    chat.assert_awaited_once()
    assert chat.call_args.args[1]['model'] == tts_service._map_upstream_model(tts_service.DEFAULT_MODEL)
    assert auth_db.get_etymology('empêcher') == first.json()['text']
    other_user = testenv.session_headers()
    monkeypatch.setattr(tts_service, 'SERVER_WEB2API_KEY', '')
    second = client.post('/api/etymology', headers=other_user,
                         json={'word': 'empêchée', 'lemma': 'EMPÊCHER'})
    assert second.status_code == 200
    assert second.json() == {**first.json(), 'cached': True}
    chat.assert_awaited_once()


@pytest.mark.parametrize('cached', [False, True])
@pytest.mark.parametrize('headers', [{}, {'Authorization': 'Bearer invalid-session'}])
def test_login_required_even_on_cache_hit(client, monkeypatch, cached, headers):
    if cached:
        auth_db.set_etymology('train', 'train', '', '词源')
    chat = AsyncMock()
    monkeypatch.setattr(tts_service, '_post_chat', chat)
    response = client.post('/api/etymology', headers=headers, json={'word': 'train'})
    assert response.status_code == 401
    chat.assert_not_awaited()


def test_word_fallback_and_blank_validation(client, monkeypatch):
    chat = AsyncMock(return_value=({}, '词源：拉丁语。'))
    monkeypatch.setattr(tts_service, '_post_chat', chat)
    headers = testenv.session_headers()
    for body in ({'word': ' Train ', 'lemma': ' '}, {'word': 'TRAIN'}):
        assert client.post('/api/etymology', headers=headers, json=body).status_code == 200
    chat.assert_awaited_once()
    assert client.post('/api/etymology', headers=headers, json={'word': ' '}).status_code == 400


@pytest.mark.parametrize('empty', [False, True])
def test_failure_is_not_cached_and_can_retry(client, monkeypatch, empty):
    chat = AsyncMock(return_value=({}, '<think>reasoning only</think>')) if empty else AsyncMock(
        side_effect=HTTPException(status_code=502, detail={'message': 'AGY unavailable'}))
    monkeypatch.setattr(tts_service, '_post_chat', chat)
    headers = testenv.session_headers()
    assert client.post('/api/etymology', headers=headers, json={'word': 'train'}).status_code == 502
    assert auth_db.get_etymology('train') is None
    chat.side_effect = None
    chat.return_value = ({}, '词源：拉丁语。')
    response = client.post('/api/etymology', headers=headers, json={'word': 'train'})
    assert response.status_code == 200
    assert response.json()['cached'] is False
