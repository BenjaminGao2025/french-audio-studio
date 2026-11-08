/* ==========================================================================
   French Audio Studio - the daily new-card limit ("New / day")
   Any whole number from 0 to 200, saved per account on the server (PUT /api/srs/settings) so every
   device shares it, and kept in localStorage as the fallback when logged out or offline. The first
   time a signed-in browser meets an account with no saved limit, its existing localStorage value is
   uploaded (migration), so nobody's setting resets.
   ========================================================================== */

(function (root) {
    'use strict';

    const KEY = 'frenchStudio.srs.newLimit';
    const TOKEN_KEY = 'frenchStudio.userToken';
    const DEFAULT = 10;
    const MAX = 200;

    const clamp = (value) => {
        if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
        const n = Math.round(Number(value));
        return Number.isFinite(n) ? Math.min(MAX, Math.max(0, n)) : null;
    };
    const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } };
    const storeLocal = (n) => { try { localStorage.setItem(KEY, String(n)); } catch (_) { /* private mode */ } };

    // The limit this browser remembers, or null when it never had one
    function local() {
        try {
            const raw = localStorage.getItem(KEY);
            return raw === null || raw === '' ? null : clamp(parseInt(raw, 10));
        } catch (_) { return null; }
    }

    async function call(method, body) {
        const res = await fetch('/api/srs/settings', {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    // The limit to use now. Signed in: the server's (kept in localStorage too); with none saved there,
    // this browser's own is uploaded. Logged out or offline: this browser's, else the default.
    async function sync() {
        const own = local();
        if (!token()) return own === null ? DEFAULT : own;
        try {
            const saved = (await call('GET')).new_limit;
            if (typeof saved === 'number') { storeLocal(saved); return saved; }
            if (own !== null) {
                await call('PUT', { new_limit: own });
                return own;
            }
            return DEFAULT;
        } catch (_) {
            return own === null ? DEFAULT : own;
        }
    }

    let first = null;
    // One sync per page load, for pages that only need the value migrated
    const syncOnce = () => { if (!first) first = sync(); return first; };

    // Save a new limit: returns the clamped number; {saved} says whether the server has it
    async function save(value) {
        const n = clamp(value);
        if (n === null) return { value: null, saved: false };
        storeLocal(n);
        if (!token()) return { value: n, saved: false };
        try {
            await call('PUT', { new_limit: n });
            return { value: n, saved: true };
        } catch (_) {
            return { value: n, saved: false };
        }
    }

    const api = { DEFAULT, MAX, clamp, local, sync, syncOnce, save };
    root.FrenchNewLimit = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
