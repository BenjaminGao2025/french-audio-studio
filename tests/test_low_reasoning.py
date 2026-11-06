"""Every AGY call asks for low reasoning effort, and the default timeout stays short."""

import asyncio
from unittest.mock import AsyncMock, Mock, patch

import testenv  # sets up the isolated env before tts_service is imported

import services.ai


def _client() -> AsyncMock:
    response = Mock(status_code=200)
    response.json.return_value = {"choices": [{"message": {"content": "Bonjour."}}]}
    client = AsyncMock()
    client.post.return_value = response
    return client


def _sent_payload(client: AsyncMock) -> dict:
    return client.post.await_args.kwargs["json"]


def test_post_chat_sends_low_reasoning_effort_by_default():
    client = _client()

    asyncio.run(services.ai.post_chat(client, {"messages": []}, {}))

    assert _sent_payload(client)["reasoning_effort"] == "low"


def test_explicit_payload_reasoning_effort_is_not_overwritten():
    client = _client()

    asyncio.run(services.ai.post_chat(client, {"messages": [], "reasoning_effort": "high"}, {}))

    assert _sent_payload(client)["reasoning_effort"] == "high"


def test_caller_payload_is_not_mutated():
    payload = {"messages": []}

    asyncio.run(services.ai.post_chat(_client(), payload, {}))

    assert payload == {"messages": []}


def test_reasoning_effort_omitted_when_off():
    client = _client()

    with patch.object(services.ai, "AGY_REASONING_EFFORT", "off"):
        asyncio.run(services.ai.post_chat(client, {"messages": []}, {}))

    assert "reasoning_effort" not in _sent_payload(client)


def test_reasoning_effort_omitted_when_none():
    client = _client()

    with patch.object(services.ai, "AGY_REASONING_EFFORT", "none"):
        asyncio.run(services.ai.post_chat(client, {"messages": []}, {}))

    assert "reasoning_effort" not in _sent_payload(client)


def test_reasoning_effort_omitted_when_empty():
    client = _client()

    with patch.object(services.ai, "AGY_REASONING_EFFORT", ""):
        asyncio.run(services.ai.post_chat(client, {"messages": []}, {}))

    assert "reasoning_effort" not in _sent_payload(client)


def test_default_upstream_timeout_is_90():
    assert services.ai.UPSTREAM_TIMEOUT_SECONDS == 90


load_tests = testenv.function_tests(globals())
