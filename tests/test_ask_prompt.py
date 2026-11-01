import testenv  # noqa: F401  (must run before the app is imported)

import tts_service


def _payload(**overrides) -> dict:
    fields = {"sentence": "J'aime l'histoire.", "question": "Is it singular?"}
    return tts_service._ask_payload(tts_service.AskRequest(**{**fields, **overrides}))


def _system() -> str:
    return _payload()["messages"][0]["content"]


def test_answer_is_grounded_in_the_learner_sentence():
    s = _system()
    assert "J'aime l'histoire." in s
    assert "Ground your answer in their sentence first" in s
    assert "point to the actual clue in that sentence" in s
    assert "not a generic rule" in s
    assert "l' = la before a vowel sound" in s
    assert "les would be plural" in s


def test_follow_ups_continue_and_never_repeat_examples():
    s = _system()
    assert "continue from your previous answer" in s
    assert "As above, ..." in s
    assert "connect to earlier turns" in s
    assert "Never repeat an example already given in the conversation" in s


def test_examples_are_optional_and_rigid_bullets_are_gone():
    s = _system()
    assert "Give examples only when they really help: 0–2 short French examples" in s
    assert "with its English meaning" in s
    assert "Answer the exact question first" not in s
    assert "1–3 short French examples" not in s


def test_kept_rules_are_still_there():
    s = _system()
    assert "If their message answers a question you asked earlier" in s
    assert "At most 90 words" in s
    assert "Plain text only" in s
    assert tts_service.TUTOR_ENGLISH_STYLE in s


def test_history_turns_are_mapped_to_messages():
    messages = _payload(history=[
        {"role": "learner", "content": "Why l' here?"},
        {"role": "tutor", "content": "l' = la before a vowel sound."},
    ])["messages"]
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]
    assert messages[1]["content"] == "Why l' here?"
    assert messages[2]["content"] == "l' = la before a vowel sound."
    assert messages[3]["content"] == "Is it singular?"


def test_only_the_last_twelve_history_turns_are_sent():
    history = [{"role": "learner", "content": f"turn {i}"} for i in range(20)]
    messages = _payload(history=history)["messages"]
    assert len(messages) == 14  # system + 12 turns + question
    assert messages[1]["content"] == "turn 8"


def test_return_shape_is_unchanged():
    payload = _payload()
    assert set(payload) == {"model", "messages", "stream", "temperature"}
    assert payload["stream"] is False
    assert payload["temperature"] == 0.3
