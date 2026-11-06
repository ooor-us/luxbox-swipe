// Phone diagnostics (classic script, loaded before any module so it also catches import failures).
// Shows a small panel at the bottom of the screen with any script error, failed load or lost WebGL context.
// Off on desktop unless ?diag=1; on by default on touch devices (?diag=0 hides it).
(function () {
  var q = new URLSearchParams(location.search);
  var touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  var on = q.get('diag') === '1' || (touch && q.get('diag') !== '0');
  var box = null, lines = [];
  function show(msg) {
    lines.push(String(msg).slice(0, 400));
    if (!on) return;
    if (!box) {
      box = document.createElement('pre');
      box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;margin:0;padding:8px 10px;' +
        'max-height:40vh;overflow:auto;background:rgba(120,0,0,.88);color:#fff;font:11px/1.35 ui-monospace,Menlo,monospace;' +
        'white-space:pre-wrap;border-radius:8px;pointer-events:auto';
      (document.body || document.documentElement).appendChild(box);
    }
    box.textContent = lines.join('\n');
  }
  window.__diag = { show: show, lines: lines };
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) show('LOAD FAILED: ' + (e.target.src || e.target.href));
    else show('ERROR: ' + (e.message || e.error) + (e.filename ? ' @ ' + e.filename.split('/').slice(-2).join('/') + ':' + e.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; show('ERROR (async): ' + (r && (r.stack || r.message) || r));
  });
  document.addEventListener('webglcontextlost', function () {
    show('WebGL context lost: the phone ran out of GPU memory. Try ?tex=512 or ?dpr=1.');
  }, true);
  // If the scene never says it is ready, say so instead of leaving a black screen.
  setTimeout(function () {
    if (!(window.__proto && window.__proto.ready)) show('Still not ready after 25 s (slow Wi-Fi or a stalled load).');
  }, 25000);
})();
