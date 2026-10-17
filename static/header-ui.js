/* Shared navigation: daily work first, specialist tools and preferences on demand. */
(() => {
    'use strict';
    document.addEventListener('DOMContentLoaded', () => {
        const header = document.querySelector('.topbar');
        const nav = header?.querySelector('.nav-tabs');
        const actions = header?.querySelector('.topbar-actions');
        if (!nav || !actions) return;
        const en = window.FrenchI18n.lang() === 'en';
        const label = (zh, english) => en ? english : zh;
        header.classList.add('header-organized');

        function disclosure(className, title) {
            const details = document.createElement('details');
            details.className = `header-disclosure ${className}`;
            const summary = document.createElement('summary');
            summary.textContent = title;
            const body = document.createElement('div');
            body.className = 'header-menu';
            details.append(summary, body);
            return {details, summary, body};
        }
        const practice = disclosure('practice-menu', label('专项练习', 'Practice'));
        for (const href of ['/write', '/speak', '/listen', '/']) {
            const link = nav.querySelector(`a[href="${href}"]`);
            if (link) practice.body.append(link);
        }
        if (practice.body.querySelector('[aria-current="page"], .active')) {
            practice.summary.classList.add('active');
            practice.summary.setAttribute('aria-label', `${practice.summary.textContent}: ${practice.body.querySelector('.active')?.textContent.trim() || ''}`);
        }
        nav.append(practice.details);

        // Keep the existing button and badge IDs so the live due count still updates.
        const deck = actions.querySelector('#open-deck-btn');
        const review = nav.querySelector('a[href="/review"]');
        if (deck && review) {
            deck.className = review.className;
            if (review.hasAttribute('aria-current')) deck.setAttribute('aria-current', 'page');
            review.replaceWith(deck);
        }
        const settings = disclosure('preferences-menu', label('设置', 'Settings'));
        settings.summary.setAttribute('aria-label', label('设置与账号', 'Settings and account'));
        actions.append(settings.details);
        function row(text, control) {
            if (!control) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'preference-row';
            const name = document.createElement('span');
            name.textContent = text;
            wrapper.append(name, control);
            settings.body.append(wrapper);
        }
        row(label('账号', 'Account'), actions.querySelector('#user-auth-btn'));
        row(label('外观', 'Appearance'), actions.querySelector('#theme-select'));
        row(label('界面语言', 'Language'), actions.querySelector('#lang-toggle'));
        row(label('练习音效', 'Practice sounds'), document.querySelector('.hud-mute'));
        const connection = actions.querySelector('.connection-settings');
        if (connection) settings.body.append(connection);
        // Page-specific actions belong alongside the page title, not global navigation.
        const pageTools = [...actions.children].filter(el => el !== settings.details);
        if (pageTools.length) {
            const host = document.createElement('div');
            host.className = 'page-intro-actions';
            host.append(...pageTools);
            (document.querySelector('.page-intro') || actions).append(host);
        }
        const disclosures = [practice.details, settings.details];
        disclosures.forEach(details => details.addEventListener('toggle', () => {
            if (details.open) disclosures.forEach(other => { if (other !== details) other.open = false; });
        }));
        document.addEventListener('click', e => {
            disclosures.forEach(details => { if (!details.contains(e.target)) details.open = false; });
        });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            const open = disclosures.find(details => details.open);
            if (open) { open.open = false; open.querySelector('summary').focus(); }
        });
    });
})();
