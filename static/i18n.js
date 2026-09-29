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
        button.textContent = current === 'en' ? '中文' : 'EN';
        button.title = current === 'en' ? '切换到中文界面' : 'Switch to English';
        button.addEventListener('click', () => setLang(current === 'en' ? 'zh' : 'en'));
    }

    root.FrenchI18n = { lang, setLang, pick, apply, mountToggle };
})(window);
