def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def test_touch_selection_speaks_from_a_tap_not_from_selectionchange():
    js = _read("static/word-popover.js")
    # iOS only plays audio inside a user gesture: a touch selection shows a chip, the chip tap speaks
    assert "if (lastPointerType === \x27touch\x27)" in js
    assert "selectionTimer = setTimeout(showSpeakChip, 250);" in js
    assert "chip.addEventListener(\x27click\x27" in js
    assert js.count("speakSelection:") == 2  # English and Chinese


def test_step_chunks_select_on_webkit_and_tap_to_hear():
    css = _read("static/study.css")
    assert "-webkit-user-select: text;" in css.split("Steps on a phone")[1]
    js = _read("static/study.js")
    assert "const text = chunkSpeechText(chunk.textContent);" in js
    assert "function chunkSpeechText(text)" in js


def test_each_step_has_a_repeat_toggle_next_to_listen():
    js = _read("static/study.js")
    assert "window.FrenchPlayback.toggleHtml('btn-step-repeat')" in js
    css = _read("static/study.css")
    assert ".btn-repeat-toggle.btn-step-repeat > span { display: none; }" in css
