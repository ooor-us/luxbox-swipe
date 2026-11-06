// The common page harness: stage element (phone-sized on desktop, full screen on a phone), WebGL canvas slot,
// UI overlay, native motion + gesture, clock with speed scale and freeze, dev panel and window.__proto.
//
//   const stage = createStage({ name, stops, tints, motion: {...overrides}, onTap });
//   stage.canvas, stage.width, stage.height (CSS px), stage.dpr, stage.ui, stage.motion
//   stage.onResize(fn(w, h, dpr)), stage.onFrame(fn(frame)) where
//     frame = { position, dt (scaled, 0 when frozen), time (scaled clock), frozen, reducedMotion, moving, blend }
//   stage.start()            begin the rAF loop
//   stage.markReady()        call once the first full frame is drawn (sets __proto.ready)
//   stage.setInfo(obj)       extra info for __proto.info()
//
// Product contract: a tap calls onTap (feedback only). Nothing here opens a box.

import { createMotion, blendAt } from './motion.js';
import { bindMotion } from './gesture.js';
import { createUI } from './ui.js';
import { STOPS } from './stops.js';
import { createDevPanel } from './devpanel.js';
import { installProto, params, onReducedMotion } from './proto-api.js';

export function createStage(opts = {}) {
  const stops = opts.stops || STOPS;
  const full = params.get('full') === '1' || window.innerWidth <= 520 || window.matchMedia('(pointer: coarse)').matches;
  document.documentElement.style.background = '#000';
  Object.assign(document.body.style, { margin: '0', background: opts.pageBackground || '#000', overflow: 'hidden', height: '100%' });
  const stageEl = document.createElement('div');
  stageEl.className = 'lbx-stage';
  Object.assign(stageEl.style, { position: 'fixed', overflow: 'hidden', background: '#000', touchAction: 'none' });
  document.body.appendChild(stageEl);
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', zIndex: '2' });
  stageEl.appendChild(canvas);
  const ui = createUI(stageEl, { stops, tints: opts.tints });

  const motion = createMotion({ stops: stops.length, ...(opts.motion || {}) });
  let width = 375, height = 812, dpr = 1;
  const resizeFns = [], frameFns = [];
  function layout() {
    if (full) {
      width = window.innerWidth; height = window.innerHeight;
      Object.assign(stageEl.style, { left: '0', top: '0', width: width + 'px', height: height + 'px', transform: '', borderRadius: '0' });
    } else {
      width = 375; height = 812;
      const k = Math.min(1, (window.innerHeight - 24) / 812, (window.innerWidth - 24) / 375);
      Object.assign(stageEl.style, { left: '50%', top: '50%', width: '375px', height: '812px', borderRadius: '28px',
        transform: `translate(-50%,-50%) scale(${k})`, boxShadow: '0 0 0 1px rgba(255,255,255,.08)' });
    }
    // Phones: DPR 2 at most unless the page asks for more (the HDR MSAA target at DPR 3 alone is ~100 MB on an iPhone).
    dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || ((('ontouchstart' in window) || navigator.maxTouchPoints > 0) ? 2 : 3));
    ui.setScale(width / 375);
    resizeFns.forEach((f) => f(width, height, dpr));
  }

  let timeScale = 1, frozen = false, rm = false, time = 0, last = 0, fps = 0, fpsAcc = 0, fpsN = 0, fpsT = 0;

  const stage = {
    el: stageEl, canvas, ui, motion, stops,
    get width() { return width; }, get height() { return height; }, get dpr() { return dpr; },
    get timeScale() { return timeScale; }, set timeScale(v) { timeScale = Math.max(0.05, Math.min(1, v)); },
    get frozen() { return frozen; }, set frozen(v) { frozen = !!v; },
    get position() { return motion.position; },
    get fps() { return fps; },
    get reducedMotion() { return rm; },
    onResize(fn) { resizeFns.push(fn); fn(width, height, dpr); },
    onFrame(fn) { frameFns.push(fn); },
    setPosition(p) { motion.jump(p); frozen = true; ui.setPosition(p); },
    resume() { frozen = false; },
    hideUI(mode) { ui.hide(mode); },
    markReady() { stage.proto.markReady(); },
    setInfo(o) { info = { ...info, ...o }; },
    start() { requestAnimationFrame(tick); },
  };
  let info = { name: opts.name || document.title };

  bindMotion(stageEl, motion, {
    onTap: (t) => { opts.onTap && opts.onTap(t, stage); },
  });
  // Any finger on the stage resumes a frozen clock, so a scrubbed page can still be swiped.
  stageEl.addEventListener('pointerdown', () => { if (frozen && !params.has('freeze')) frozen = false; });

  function tick(now) {
    const raw = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    fpsAcc += raw; fpsN++; if (now - fpsT > 500) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; fpsT = now; }
    const dt = frozen ? 0 : raw * timeScale;
    time += dt;
    const moving = frozen ? false : motion.advance(dt);
    const position = motion.position;
    const frame = { position, dt, time, frozen, reducedMotion: rm, moving, blend: blendAt(position, stops.length) };
    ui.setPosition(position);
    for (const f of frameFns) f(frame);
    dev && dev.update();
    requestAnimationFrame(tick);
  }

  stage.proto = installProto({
    stops,
    setPosition: (p) => stage.setPosition(p),
    getPosition: () => motion.position,
    hideUI: (m) => stage.hideUI(m),
    freeze: (b) => { if (b) frozen = true; else stage.resume(); },
    textRects: () => ui.textRects(),
    info: () => ({ ...info, inputMode: motion.config.mode, motionDeviations: motion.deviations(), reducedMotion: rm,
      size: { width, height, dpr }, full }),
    // internals for tools (check.mjs settle test)
    _motion: motion,
    get _fps() { return fps; },
  });
  onReducedMotion((v) => { rm = v; stage.proto.reducedMotion = v; });
  window.addEventListener('resize', layout);
  layout();
  const dev = createDevPanel(stage);
  return stage;
}
