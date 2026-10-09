/* 1000H French — public site: language switch, icons and the beta / partnership forms. */
(function () {
    'use strict';

    const body = document.body;
    const TEXT = {
        zh: {
            pageTitle: body.dataset.pageTitleZh,
            choose: '请选择',
            sending: '正在提交…',
            ok: '收到了。开放名额时，我们会通过你留的联系方式发邀请。',
            okInstitution: '收到了，我们会尽快联系你。',
            needContact: '请填写联系方式。',
            needOrg: '请填写机构名称。',
            tooMany: '提交太频繁了，请稍后再试。',
            failed: '提交没有成功，请稍后再试。',
        },
        en: {
            pageTitle: body.dataset.pageTitleEn,
            choose: 'Choose',
            sending: 'Sending…',
            ok: 'Got it. We will send an invitation to the contact you left when a spot opens.',
            okInstitution: 'Got it. We will be in touch soon.',
            needContact: 'Please leave a way to reach you.',
            needOrg: 'Please enter your organisation.',
            tooMany: 'Too many submissions. Please try again later.',
            failed: 'That did not go through. Please try again later.',
        },
    };

    FrenchI18n.apply(TEXT);
    FrenchI18n.mountToggle(document.getElementById('lang-toggle'));
    if (window.lucide) window.lucide.createIcons();
    const T = TEXT[FrenchI18n.lang()];

    document.querySelectorAll('.lead-form').forEach((form) => {
        const status = form.querySelector('.form-status');
        const button = form.querySelector('button[type="submit"]');
        const kind = form.dataset.kind;

        function show(message, isError) {
            status.textContent = message;
            status.classList.toggle('is-error', isError);
            status.classList.toggle('is-ok', !isError);
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(form).entries());
            if (!(data.contact || '').trim()) return show(T.needContact, true);
            if (kind === 'institution' && !(data.org || '').trim()) return show(T.needOrg, true);

            button.disabled = true;
            show(T.sending, false);
            try {
                const res = await fetch('/api/waitlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...data, kind, lang: FrenchI18n.lang() }),
                });
                if (res.status === 429) throw new Error(T.tooMany);
                if (!res.ok) throw new Error(T.failed);
                form.querySelectorAll('input, select, textarea, button').forEach((el) => { el.disabled = true; });
                show(kind === 'institution' ? T.okInstitution : T.ok, false);
            } catch (err) {
                button.disabled = false;
                show(err.message === T.tooMany ? T.tooMany : T.failed, true);
            }
        });
    });
})();
