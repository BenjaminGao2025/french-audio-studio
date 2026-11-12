/* Blocking, same-origin bootstrap: runs under script-src 'self' before first paint. */
(function () {
  var preference = 'system';
  try { preference = localStorage.getItem('theme') || 'system'; } catch (_) {}
  var dark = preference === 'dark' || (preference !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
