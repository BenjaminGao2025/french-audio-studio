/* Synchronous head script: resolve the theme before styles/content paint. */
(function () {
    'use strict';
    const key = 'frenchStudio.theme';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const valid = value => ['system', 'light', 'dark'].includes(value);
    let preference = 'system';
    let control;
    try {
        const saved = localStorage.getItem(key);
        if (valid(saved)) preference = saved;
    } catch (_) { /* Theme still works when storage is unavailable. */ }

    function apply() {
        const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        if (control) control.value = preference;
    }
    apply();
    media.addEventListener('change', apply);
    window.addEventListener('storage', event => {
        if (event.key !== key && event.key !== null) return;
        preference = valid(event.newValue) ? event.newValue : 'system';
        apply();
    });

    document.addEventListener('DOMContentLoaded', () => {
        const host = document.querySelector('.topbar-actions, .site-nav');
        if (!host) return;
        const zh = window.FrenchI18n ? window.FrenchI18n.lang() === 'zh'
            : (navigator.language || '').toLowerCase().startsWith('zh');
        control = document.createElement('select');
        control.id = 'theme-select';
        control.className = 'theme-select';
        control.setAttribute('aria-label', zh ? '页面外观' : 'Appearance');
        control.title = zh ? '页面外观：跟随系统、夜间或日间' : 'Appearance: system, dark or light';
        for (const [value, label] of [
            ['system', zh ? '跟随系统' : 'System'],
            ['dark', zh ? '夜间模式' : 'Dark'],
            ['light', zh ? '日间模式' : 'Light'],
        ]) control.add(new Option(label, value));
        control.addEventListener('change', () => {
            preference = control.value;
            try { localStorage.setItem(key, preference); } catch (_) {}
            apply();
        });
        host.prepend(control);
        apply();
    });
})();
