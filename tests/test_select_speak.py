def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def test_select_to_speak_hear_chip_is_gone():
    js = _read("static/word-popover.js")
    for name in ("lastPointerType", "selectedFrench", "showSpeakChip", "hideChip", "chipPhrase",
                 "selection-speak-chip", "speakSelection"):
        assert name not in js, name
    # a selection is read once the handles settle (or on mouseup), as before the chip
    assert "document.addEventListener('selectionchange', () => { if (!mouseHeld) scheduleSelection(600); });" in js
    assert "selection-speak-chip" not in _read("static/word-popover.css")
    assert "selection-speak-chip" not in _read("static/study.css")


def test_gloss_words_and_step_chunks_open_the_title_word_popover():
    js = _read("static/study.js")
    selector = "'.gloss-fr, .buildup-steps-list:not(.is-blind-mode) .buildup-new-token'"
    assert f"const GLOSS_TAP_SELECTOR = {selector};" in js
    # in the popover's wordSelector, so a mousedown on them does not close the popover first
    assert "wordSelector: `.interactive-word, .diff-word, .token-word, ${GLOSS_TAP_SELECTOR}`," in js
    # the card click delegation (same one as the title words) opens the popover with the sentence
    delegation = js.split("const glossWord = e.target.closest(GLOSS_TAP_SELECTOR);")[1].split("card.addEventListener('keydown'")[0]
    assert "chunkSpeechText(glossWord.textContent)" in delegation
    assert "showPopoverForElement(word, glossWord, {" in delegation
    assert "sentence: targetSentence," in delegation and "sentence_cn: transCn" in delegation
    # the old chunk handler that only played audio is replaced
    assert "if (text) playFrenchSpeech(text, null, { once: true });" not in js
    assert "function chunkSpeechText(text)" in js
    # blind mode keeps its reveal toggle
    assert "token.classList.toggle('revealed');" in js


def test_gloss_words_and_step_chunks_look_tappable():
    css = _read("static/study.css")
    gloss = css.split("\n.gloss-fr {")[1].split("}")[0]
    assert "cursor: pointer;" in gloss
    assert ".gloss-fr:hover," in css
    phone = css.split("Steps on a phone")[1]
    # WebKit needs the prefix for the French line and chunks to select
    assert "-webkit-user-select: text;" in phone
    assert ".buildup-steps-list:not(.is-blind-mode) .buildup-new-token:hover," in phone


def test_each_step_has_a_repeat_toggle_next_to_listen():
    js = _read("static/study.js")
    assert "window.FrenchPlayback.toggleHtml('btn-step-repeat')" in js
    css = _read("static/study.css")
    assert ".btn-repeat-toggle.btn-step-repeat > span { display: none; }" in css
