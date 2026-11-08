// Run with: node tests/test_new_limit.cjs
// static/new-limit.js: any 0-200, saved per account on the server, this browser's localStorage as the
// fallback when logged out or offline, and an existing localStorage value migrated to the account once.
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

function page(token) {
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
    const { window } = dom;
    if (token) window.localStorage.setItem('frenchStudio.userToken', token);
    const server = { limit: null, calls: [], offline: false };
    window.fetch = async (url, init = {}) => {
        server.calls.push(`${init.method || 'GET'} ${url}`);
        if (server.offline) throw new TypeError('offline');
        if (init.method === 'PUT') { server.limit = JSON.parse(init.body).new_limit; return { ok: true, json: async () => ({ new_limit: server.limit }) }; }
        return { ok: true, json: async () => ({ new_limit: server.limit, default_new_limit: 10 }) };
    };
    window.eval(fs.readFileSync(path.join(__dirname, '../static/new-limit.js'), 'utf8'));
    return { window, server, N: window.FrenchNewLimit, store: window.localStorage };
}

(async () => {
    // clamp: whole numbers 0-200; blanks and junk are not numbers
    const { N } = page('');
    assert.equal(N.clamp('0'), 0);
    assert.equal(N.clamp('37'), 37);
    assert.equal(N.clamp(200), 200);
    assert.equal(N.clamp('999'), 200);
    assert.equal(N.clamp(-4), 0);
    assert.equal(N.clamp('12.6'), 13);
    assert.equal(N.clamp(''), null);
    assert.equal(N.clamp('abc'), null);
    assert.equal(N.clamp(null), null);

    // Logged out: localStorage only, the default when nothing is stored, no request at all
    let p = page('');
    assert.equal(await p.N.sync(), 10);
    assert.equal(JSON.stringify(await p.N.save('42')), JSON.stringify({ value: 42, saved: false }));
    assert.equal(await p.N.sync(), 42);
    assert.equal(p.store.getItem('frenchStudio.srs.newLimit'), '42');
    assert.equal(p.server.calls.length, 0);

    // Signed in, the account has none yet: this browser's existing value migrates up
    p = page('tok');
    p.store.setItem('frenchStudio.srs.newLimit', '20');
    assert.equal(await p.N.sync(), 20);
    assert.equal(p.server.limit, 20);

    // Signed in, nothing anywhere: the default, and nothing is uploaded
    p = page('tok');
    assert.equal(await p.N.sync(), 10);
    assert.equal(p.server.limit, null);

    // The account's value wins over this browser's, and is mirrored into localStorage
    p = page('tok');
    p.server.limit = 65;
    p.store.setItem('frenchStudio.srs.newLimit', '5');
    assert.equal(await p.N.sync(), 65);
    assert.equal(p.store.getItem('frenchStudio.srs.newLimit'), '65');

    // Saving reaches the server; a second device then reads it
    const first = page('tok');
    assert.equal(JSON.stringify(await first.N.save(150)), JSON.stringify({ value: 150, saved: true }));
    const second = page('tok');
    second.server.limit = first.server.limit;
    assert.equal(await second.N.sync(), 150);

    // Offline: the saved number still applies on this device
    p = page('tok');
    p.server.offline = true;
    assert.equal(JSON.stringify(await p.N.save(33)), JSON.stringify({ value: 33, saved: false }));
    assert.equal(await p.N.sync(), 33);

    // syncOnce asks once per page load
    p = page('tok');
    await p.N.syncOnce();
    await p.N.syncOnce();
    assert.equal(p.server.calls.filter(c => c.startsWith('GET')).length, 1);

    console.log('PASS: new-limit (0-200, server sync, localStorage fallback, migration).');
})().catch(err => { console.error(err); process.exit(1); });
