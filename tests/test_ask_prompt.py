import testenv  # must run before the app is imported

import routers.tutor


def _payload(**overrides) -> dict:
    fields = {"sentence": "J'aime l'histoire.", "question": "Is it singular?"}
    return routers.tutor._ask_payload(routers.tutor.AskRequest(**{**fields, **overrides}))


def _system() -> str:
    return _payload()["messages"][0]["content"]


def test_answer_is_grounded_in_the_learner_sentence():
    s = _system()
    assert "J'aime l'histoire." in s
    assert "Answer the user's actual question first and directly" in s
    assert "Ground your answer in their French sentence only if it helps answer their actual question" in s
    assert "Grounding is secondary" in s
    assert "point to the actual clue in that sentence" in s
    assert "not a generic rule" in s
    assert "l' = la before a vowel sound" not in s
    assert "les would be plural" not in s


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
    assert "define that English first" in s
    assert "1–3 short French examples" not in s


def test_kept_rules_are_still_there():
    s = _system()
    assert "If their message answers a question you asked earlier" in s
    assert "At most 90 words" in s
    assert "Plain text only" in s
    assert routers.tutor.TUTOR_ENGLISH_STYLE not in s


def test_history_turns_are_mapped_to_messages():
    messages = _payload(
        history=[
            {"role": "learner", "content": "Why l' here?"},
            {"role": "tutor", "content": "l' = la before a vowel sound."},
        ]
    )["messages"]
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


def test_english_gloss_question_keeps_raw_question_and_structured_context():
    question = "啥意思？ to set forth 呢？"
    payload = _payload(
        sentence="Les représentants ont décidé d'exposer le plan.",
        translation_en="The representatives decided to set forth the plan.",
        word="d'exposer", question=question, language="zh",
    )
    system = payload["messages"][0]["content"]
    assert "English translation: The representatives decided to set forth the plan." in system
    assert "The word card is open on: d'exposer\n" in system
    assert "If it names something else (another word, an English phrase" in system
    assert "'to set forth' means to formally state or present" in system
    assert "Only then link it to the French word or sentence if it helps" in system
    assert payload["messages"][-1] == {"role": "user", "content": question}
    assert "About “d'exposer”:" not in system


def test_question_language_takes_priority_over_both_fallback_languages():
    for language, label in [("en", "English (en)"), ("zh", "Chinese (zh)")]:
        for question in ["这是什么意思？", "What does this mean?", "啥意思？ to set forth 呢？"]:
            messages = _payload(language=language, question=question)["messages"]
            system = messages[0]["content"]
            assert f"For mixed or ambiguous question language, use {label}" in system
            assert "clearly Chinese questions get Chinese answers" in system
            assert "clearly English questions get English answers" in system
            assert messages[-1]["content"] == question


def test_answer_style_is_conditional_on_answer_language():
    for language in ["en", "zh"]:
        system = _payload(language=language)["messages"][0]["content"]
        assert "Only for English answers: use simple English, roughly B1" in system
        assert "short, plain sentences" in system
        assert "For Chinese answers, write in Chinese" in system
        assert routers.tutor.TUTOR_ENGLISH_STYLE not in system


def test_context_is_optional_for_existing_sentence_ask_clients():
    system = _system()
    assert "The word card is open on: (none)" in system
    assert "English translation: (none)" in system
    assert "it is about the open word" not in system


def test_a_bare_question_from_a_word_card_is_about_that_word():
    system = _payload(sentence="Nul homme ne peut être accusé, arrêté ni détenu.", word="détenu", question="啥意思")["messages"][0]["content"]
    assert "it is about the open word détenu: say what détenu means and does in this sentence" in system
    assert "Do not translate or explain the whole sentence" in system


def test_explanation_language_rejects_unsupported_values():
    from pydantic import ValidationError
    try:
        routers.tutor.AskRequest(sentence="Bonjour.", question="Why?", language="fr")
    except ValidationError:
        pass
    else:
        raise AssertionError("Unsupported explanation language was accepted")


load_tests = testenv.function_tests(globals())
