// window.__proto: the prototype API from PLAN.md, used by capture.mjs, check.mjs and the critics.
//   setPosition(pages)  show the exact state at that carousel position and freeze it (1.5 = halfway 1 -> 2)
//   getPosition()       current position in pages (unwrapped; stop = mod(round(p), 4))
//   hideUI(mode)        true hides the whole overlay, 'text' hides only glyphs (glass stays), false shows
//   freeze(bool)        stop / resume the clock (input still tracks while frozen? no: frozen ignores time only)
//   textRects()         every visible UI text: frame box in page CSS px, colour, opacity, font size and weight
//   stops               the four stops (stops.js)
//   ready               true once the first frame with all assets is on screen (also: whenReady promise)
//   reducedMotion       true when prefers-reduced-motion or ?rm=1
//   info()              { name, motion: deviations from the native port, renderer, notes }
//
// installProto(impl) merges impl over safe defaults and returns the object.

export const params = new URLSearchParams(location.search);

export function reducedMotion() {
  if (params.get('rm') === '1') return true;
  if (params.get('rm') === '0') return false;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Calls fn(bool) now and whenever the media query changes (?rm overrides and never changes). */
export function onReducedMotion(fn) {
  fn(reducedMotion());
  if (params.has('rm')) return () => {};
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => fn(reducedMotion());
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  } catch { return () => {}; }
}

export function installProto(impl) {
  let resolveReady;
  const whenReady = new Promise((r) => { resolveReady = r; });
  const api = {
    setPosition() {}, getPosition: () => 0, hideUI() {}, freeze() {}, textRects: () => [], stops: [],
    ready: false, reducedMotion: reducedMotion(), info: () => ({}),
    ...impl,
    whenReady,
    markReady() { if (!api.ready) { api.ready = true; resolveReady(true); document.documentElement.dataset.protoReady = '1'; } },
  };
  window.__proto = api;
  return api;
}
