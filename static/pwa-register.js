/* Installable app: register the service worker (see /sw.js). Updates roll out on their own. */
(function () {
    'use strict';
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    });
})();
