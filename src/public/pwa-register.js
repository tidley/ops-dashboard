(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/public/sw.js').catch(function (err) {
      console.warn('PWA service worker registration failed:', err);
    });
  });
})();
