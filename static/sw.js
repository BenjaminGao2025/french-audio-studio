/* 1000H French service worker (served at /sw.js, scope /).
   Caches only versioned static files (/static/...?v=<version>) so pages open fast.
   Never touches /api, /tts, /files, /episodes or auth: those always go to the network.
   HTML is network-first (the cached copy is only an offline fallback), so a deploy is
   picked up on the next load and a page never runs old JS against a new server.
   The version below changes on every deploy, which makes the browser install a new worker. */
'use strict';
const VERSION = '__ASSET_VERSION__';
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const PAGES = new Set(['/', '/study', '/review', '/listen', '/speak', '/write', '/coach', '/home', '/privacy', '/for-institutions']);

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
        for (const key of await caches.keys()) {
            if (!keep.has(key)) await caches.delete(key);
        }
        await self.clients.claim();
    })());
});

function isVersionedStatic(url) {
    return url.pathname.startsWith('/static/') && url.searchParams.get('v') === VERSION;
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (isVersionedStatic(url)) {
        event.respondWith((async () => {
            const cache = await caches.open(STATIC_CACHE);
            const hit = await cache.match(request);
            if (hit) return hit;
            const response = await fetch(request);
            if (response.ok && response.type === 'basic') cache.put(request, response.clone());
            return response;
        })());
        return;
    }

    if (request.mode === 'navigate' && PAGES.has(url.pathname)) {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok && response.type === 'basic') {
                    const cache = await caches.open(PAGE_CACHE);
                    cache.put(url.pathname, response.clone());
                }
                return response;
            } catch (err) {
                const cached = await caches.match(url.pathname, { cacheName: PAGE_CACHE });
                if (cached) return cached;
                throw err;
            }
        })());
    }
    // Everything else (API, audio, files, auth, unversioned assets): plain network, no caching
});
