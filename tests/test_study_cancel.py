def test_study_analysis_can_be_cancelled():
    js = open("static/study.js", encoding="utf-8").read()
    assert "new AbortController()" in js
    assert "analyzePart(parts[index], token, model, signal)" in js
    assert "while (next < parts.length && !signal.aborted)" in js
    assert "e.key === \x27Escape\x27 && analysisController" in js
    assert js.count("cancelAnalysis:") == 2  # English and Chinese
    # A cancelled run must not render or save a partial result
    cancel_branch = js.split("analysisController.signal.aborted")[1].split("} else {")[0]
    assert "saveHistoryItem" not in cancel_branch and "renderStudyDeck" not in cancel_branch
