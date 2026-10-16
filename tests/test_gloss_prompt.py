import testenv  # noqa: F401  (must run before the app is imported)

import json

import tts_service


def _prompt() -> str:
    payload = tts_service._analyze_payload(tts_service.AnalyzeRequest(text="Ce qu'on appelle un Beipiao."))
    return json.dumps(payload, ensure_ascii=False)


def test_alignment_glosses_are_contextual_not_literal():
    p = _prompt()
    assert "what it means IN THIS SENTENCE" in p
    assert "never 'one'" in p  # on = people / we / they
    assert "ce qu'on appelle = so-called / what people call" in p
    assert "ne … que = only, not a negation" in p
    assert "not 'that which'" in p
