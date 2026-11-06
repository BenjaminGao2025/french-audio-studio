/* 1000H French — membership page: current plan of the signed-in account; payment is not open yet. */
(function () {
    'use strict';

    const body = document.body;
    const TEXT = {
        zh: {
            pageTitle: body.dataset.pageTitleZh,
            loading: '正在读取…',
            anonymous: '登录后可以查看试用剩余天数和会员状态。',
            pro: '会员 · 长期有效',
            trial: (n) => `免费试用中 · 还剩 ${n} 天`,
            expired: '免费试用已结束。收款通道开放后可以开通会员。',
            failed: '暂时读取不到账号状态，请稍后刷新。',
        },
        en: {
            pageTitle: body.dataset.pageTitleEn,
            loading: 'Loading…',
            anonymous: 'Log in to see your trial days left and membership status.',
            pro: 'Member · No expiry',
            trial: (n) => `Free trial · ${n} days left`,
            expired: 'Your free trial has ended. You can become a member once payment opens.',
            failed: 'Could not load your account right now. Please refresh later.',
        },
    };

    FrenchI18n.apply(TEXT);
    FrenchI18n.mountToggle(document.getElementById('lang-toggle'));
    if (window.lucide) window.lucide.createIcons();
    const T = TEXT[FrenchI18n.lang()];

    const statusEl = document.getElementById('plan-status');
    const emailEl = document.getElementById('plan-email');
    const loginEl = document.getElementById('plan-login');

    function showAnonymous() {
        statusEl.textContent = T.anonymous;
        loginEl.hidden = false;
    }

    async function load() {
        let token = '';
        try { token = localStorage.getItem('frenchStudio.userToken') || ''; } catch (_) {}
        if (!token) return showAnonymous();
        try {
            const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
            if (res.status === 401 || res.status === 404) return showAnonymous();
            if (!res.ok) throw new Error(String(res.status));
            const user = await res.json();
            emailEl.textContent = user.email;
            emailEl.hidden = false;
            if (user.plan === 'pro') statusEl.textContent = T.pro;
            else if (user.is_valid) statusEl.textContent = T.trial(user.days_left);
            else statusEl.textContent = T.expired;
        } catch (_) {
            statusEl.textContent = T.failed;
        }
    }

    load();
})();
