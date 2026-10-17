/* ==========================================================================
   French Audio Studio - UI language (English / 中文)
   The choice is remembered per browser; the default follows the browser.
   In English mode, learning content also prefers English over Chinese.
   ========================================================================== */

(function (root) {
    'use strict';

    const STORAGE_KEY = 'frenchStudio.uiLang';

    function lang() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved === 'en' || saved === 'zh') return saved;
        } catch (_) {}
        return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }

    function setLang(value) {
        try { localStorage.setItem(STORAGE_KEY, value); } catch (_) {}
        root.location.reload();
    }

    // Pick the Chinese or English version of a piece of content, falling back to the other.
    function pick(zh, en) {
        return lang() === 'en' ? (en || zh || '') : (zh || en || '');
    }

    // Fill [data-i18n], [data-i18n-placeholder], [data-i18n-title] and [data-i18n-aria] from a {en, zh} dictionary.
    function apply(dictionary) {
        const texts = dictionary[lang()] || {};
        document.documentElement.lang = lang() === 'en' ? 'en' : 'zh-CN';
        const fill = (attr, setter) => {
            document.querySelectorAll(`[${attr}]`).forEach(el => {
                const value = texts[el.getAttribute(attr)];
                if (value != null) setter(el, value);
            });
        };
        fill('data-i18n', (el, v) => { el.textContent = v; });
        fill('data-i18n-placeholder', (el, v) => { el.placeholder = v; });
        fill('data-i18n-title', (el, v) => { el.title = v; });
        fill('data-i18n-aria', (el, v) => { el.setAttribute('aria-label', v); });
        if (texts.pageTitle) document.title = texts.pageTitle;
    }

    // A button that switches to the other language.
    function mountToggle(button) {
        if (!button) return;
        const current = lang();
        button.textContent = current === 'en' ? '中' : 'EN';
        button.title = current === 'en' ? '切换到中文界面' : 'Switch to English';
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', () => setLang(current === 'en' ? 'zh' : 'en'));
    }

    // Long-open tabs keep running old code after a deploy: offer a reload when the version changes
    function watchForNewVersion() {
        const meta = document.querySelector('meta[name="asset-version"]');
        const loaded = meta && meta.content;
        if (!loaded || loaded.startsWith('__')) return;
        let shown = false;
        async function check() {
            if (shown || document.hidden) return;
            try {
                const res = await fetch('/api/version', { cache: 'no-store' });
                const data = await res.json();
                if (data.version && data.version !== loaded) show();
            } catch (_) { /* offline or restarting: try again later */ }
        }
        function show() {
            shown = true;
            const bar = document.createElement('button');
            bar.type = 'button';
            bar.className = 'new-version-bar';
            bar.textContent = lang() === 'en'
                ? 'A new version of the site is live. Tap here to reload.'
                : '网站已更新，点这里刷新页面。';
            bar.addEventListener('click', () => root.location.reload());
            document.body.appendChild(bar);
        }
        document.addEventListener('visibilitychange', check);
        setInterval(check, 10 * 60 * 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watchForNewVersion);
    } else {
        watchForNewVersion();
    }

    // Forget what removed features left behind: a guest API key typed into the old
    // connection panel (a secret) and the saved model choice.
    try {
        ['frenchStudio.perplexityApiKey', 'frenchStudio.perplexityModel',
         'frenchStudio.modelDefaultMigrated', 'frenchStudio.modelDefaultMigrated2']
            .forEach((key) => localStorage.removeItem(key));
        sessionStorage.removeItem('frenchStudio.sessionApiKey');
    } catch (_) {}

    // Audio tags cannot send the bearer token. Exchange it for the HttpOnly session cookie.
    try {
        const token = localStorage.getItem('frenchStudio.userToken');
        if (token) {
            fetch('/api/auth/session', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + token },
                credentials: 'same-origin',
            }).catch(function () {});
        }
    } catch (_) {}

    root.FrenchI18n = { lang, setLang, pick, apply, mountToggle };
})(window);
