import testenv  # noqa: F401
import tts_service


def test_csp_allows_cloudflare_beacon_only_from_its_host():
    csp = tts_service.CONTENT_SECURITY_POLICY
    script = next(p for p in csp.split("; ") if p.startswith("script-src"))
    assert "https://static.cloudflareinsights.com" in script
    assert "'unsafe-inline'" not in script
    assert "connect-src 'self' https://cloudflareinsights.com" in csp


def test_header_controls_stay_on_one_row():
    css = open("static/ui.css", encoding="utf-8").read()
    assert ".topbar-actions, .site-nav { flex-wrap: nowrap; }" in css
    js = open("static/i18n.js", encoding="utf-8").read()
    assert "button.setAttribute('aria-label', button.title);" in js
