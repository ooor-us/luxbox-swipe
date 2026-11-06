// LuxBox home carousel motion: an exact port of
// native-spike/ChronoBox/Features/Catalog/NativeBoxesMotion.swift, expressed in PAGES (one stop = 1.0).
//
// Native works in ring radians with angle = -page * step (step = 2*pi/6, six material slots).
// Here the same rules run in "ring pages" (step = 1) and the public position is pages = -angle.
// Thresholds that are absolute angles in Swift are divided by the native step so the behaviour is
// identical at any slot count:
//   settleAngle 0.0005 rad      -> 0.0005 / (2pi/6) = 4.775e-4 pages
//   settleVelocity 0.005 rad/s  -> 4.775e-3 pages/s
// Everything else (1.4 gain, 0.25 rubber band past one step, 1.08 clamp, 0.28 commit, 350 pt/s flick
// with > 0.04 step, release-velocity carry with slope 1 / 0.25 / 0, omega 18, release frequency
// max(12, |v / remaining|), 20 pages/s release cap, boundReleaseVelocity = min(|v|, 6 step/s, omega*|remaining|),
// analytic critically damped step with dt clamped to 0.1 s) is copied 1:1.
//
// Loop: the native ring is unwrapped (angles never wrap); selectedIndex wraps mod stops.
// select(index) picks the nearest equivalent target modulo `stops` (native: modulo 2pi = 6 slots).
//
// Two input paths, as in NativeBoxesCarouselInteraction.swift:
//   mode 'drag'   : NativeCarouselGestureSurface (UIPanGestureRecognizer) -> beginDrag/drag/endDrag.
//                   This is the path whose rules the task names (1.4 gain, 0.28 commit, 350 pt/s).
//   mode 'paging' : NativeCarouselPagingSurface (UIScrollView paging, one viewport = one page) ->
//                   beginSystemPaging/trackSystemPaging/releaseSystemPage. The app uses this path when the
//                   live catalogue is the full cyclic ring. UIKit's page projection is emulated by
//                   pagingTarget() below (documented approximation: UIScrollView's own rule is private).
// Default is 'drag'. Prototypes may pick either and must say which in NOTES.md.

export const NATIVE_STEP_RAD = (2 * Math.PI) / 6;

export const NATIVE = Object.freeze({
  mode: 'drag',
  stops: 4,
  gain: 1.4,            // points / width * step * 1.4
  rubber: 0.25,         // slope past one step
  clamp: 1.08,          // hard stop, in steps
  commitStep: 0.28,     // commit when |delta| > 0.28 step
  flickSpeed: 350,      // or |v| > 350 pt/s ...
  flickStep: 0.04,      // ... and |delta| > 0.04 step
  omega: 18,            // springFrequency
  releaseMinOmega: 12,  // settlingFrequency floor after a native page release
  maxReleaseSpeed: 20,  // pages/s cap in releaseSystemPage
  maxBoundSpeed: 6,     // steps/s in boundReleaseVelocity
  settleAngle: 0.0005 / NATIVE_STEP_RAD,
  settleVelocity: 0.005 / NATIVE_STEP_RAD,
  maxDt: 0.1,
  pagingFlick: 0.5,     // 'paging' emulation only: |pages/s| above which UIKit pages in the finger direction
});

const mod = (a, n) => ((a % n) + n) % n;
const smoothstep = (t) => t * t * (3 - 2 * t);

/** Native reflection weight, in pages: only the nearest box reflects, fading out before the half-step. */
export function reflectionWeight(relativePages) {
  if (!Number.isFinite(relativePages)) return 0;
  // Native wraps the ring angle with atan2; in pages a box is never more than half a ring away here.
  const t = Math.min(1, Math.max(0, Math.abs(relativePages) / 0.5));
  return 1 - smoothstep(t);
}

/**
 * createMotion(options?) -> motion object. options override NATIVE; motion.deviations() lists every
 * key that differs from the native port (prototypes must print it in NOTES.md).
 */
export function createMotion(options = {}) {
  const c = { ...NATIVE, ...options };
  const step = 1; // ring pages
  // Internal state in ring "angle" units where angle = -pages.
  let angle = 0, target = 0, velocity = 0;
  let dragging = false, systemPaging = false;
  let dragStart = 0, dragAnchor = 0, dragReturn = 0, dragWidth = 0, dragPoints = 0;
  let settlingFrequency = c.omega;
  const listeners = new Set();

  function boundReleaseVelocity() {
    const remaining = target - angle;
    if (!Number.isFinite(velocity) || !(velocity * remaining > 0)) { velocity = 0; return; }
    const speed = Math.min(Math.abs(velocity), step * c.maxBoundSpeed, c.omega * Math.abs(remaining));
    velocity = remaining < 0 ? -speed : speed;
  }

  const m = {
    config: c,
    get position() { return -angle; },
    set position(p) { angle = -p; target = angle; velocity = 0; },
    get target() { return -target; },
    get velocity() { return -velocity; }, // pages/s
    get dragging() { return dragging; },
    get systemPaging() { return systemPaging; },
    get needsFrames() {
      return systemPaging || dragging || Math.abs(angle - target) > c.settleAngle || Math.abs(velocity) > c.settleVelocity;
    },
    get acceptsTapFeedback() { return !dragging; },
    /** Live drag progress in pages relative to the committed page the drag started from. */
    get dragProgress() { return dragging || systemPaging ? -(angle - dragReturn) : 0; },

    get selectedIndex() {
      const selectionTarget = dragging ? dragReturn : target;
      const index = Math.round(-selectionTarget / step);
      return mod(index, c.stops);
    },

    select(index) {
      if (dragging || systemPaging) return;
      settlingFrequency = c.omega;
      const desired = -index * step;
      const period = c.stops * step;
      target = desired + Math.round((angle - desired) / period) * period;
      boundReleaseVelocity();
    },

    beginDrag() {
      if (dragging) return;
      dragging = true;
      settlingFrequency = c.omega;
      dragReturn = target;
      dragStart = angle;
      dragAnchor = Math.round(target / step) * step;
      target = angle;
      velocity = 0;
      dragWidth = 0; dragPoints = 0;
    },

    /** points: finger translation since touch-down (CSS px = pt), positive to the right. */
    drag(points, width) {
      if (!dragging || !Number.isFinite(width) || !(width > 0) || !Number.isFinite(points)) return;
      dragWidth = width; dragPoints = points;
      let delta = points / width * step * c.gain;
      if (Math.abs(delta) > step) {
        delta = delta < 0 ? -(step + (Math.abs(delta) - step) * c.rubber) : step + (Math.abs(delta) - step) * c.rubber;
      }
      delta = Math.min(step * c.clamp, Math.max(-step * c.clamp, delta));
      target = dragStart + delta;
      angle = target;
    },

    /** Returns the committed increment in stops: +1 forward (finger left), -1 back, 0 none. */
    endDrag(pointsPerSecond, cancelled = false) {
      if (systemPaging) { m.finishSystemPaging(); return 0; }
      if (!dragging) return 0;
      const delta = target - dragStart;
      const commits = !cancelled && (Math.abs(delta) > step * c.commitStep ||
        (Math.abs(pointsPerSecond) > c.flickSpeed && Math.abs(delta) > step * c.flickStep));
      const direction = delta >= 0 ? 1 : -1;
      target = commits ? dragAnchor + direction * step : dragReturn;
      dragging = false;
      velocity = 0;
      if (commits && dragWidth > 0 && Number.isFinite(pointsPerSecond)) {
        const rawDelta = Math.abs(dragPoints / dragWidth * step * c.gain);
        const rubberEnd = 1 + (c.clamp - 1) / c.rubber; // 1.32 for the native constants
        const slope = rawDelta >= step * rubberEnd ? 0 : rawDelta > step ? c.rubber : 1;
        velocity = pointsPerSecond / dragWidth * step * c.gain * slope;
        boundReleaseVelocity();
      }
      const inc = commits ? (direction < 0 ? 1 : -1) : 0;
      if (inc) listeners.forEach((f) => f({ type: 'commit', increment: inc, index: m.selectedIndex }));
      return inc;
    },

    // ---- UIKit paging path -------------------------------------------------------------------
    beginSystemPaging() {
      if (systemPaging) m.finishSystemPaging();
      m.beginDrag();
      systemPaging = true;
      return (dragAnchor - angle) / step; // residual pages
    },
    /** pages: content offset in pages relative to the anchor page (positive = forward). */
    trackSystemPaging(pages) {
      if (!systemPaging || !Number.isFinite(pages)) return false;
      const next = dragAnchor - pages * step;
      if (next === angle) return false;
      angle = next;
      return true;
    },
    commitSystemPage(increment) {
      if (!systemPaging) return;
      const inc = Math.min(1, Math.max(-1, increment));
      target = dragAnchor - inc * step;
      dragReturn = target;
      dragging = false;
      velocity = 0;
    },
    /** pagesPerSecond: content velocity in pages/s (positive = forward). */
    releaseSystemPage(increment, pagesPerSecond) {
      if (!systemPaging) return;
      m.commitSystemPage(increment);
      systemPaging = false;
      const speed = Number.isFinite(pagesPerSecond) ? Math.min(c.maxReleaseSpeed, Math.max(-c.maxReleaseSpeed, pagesPerSecond)) : 0;
      velocity = -speed * step;
      const remaining = target - angle;
      if (Math.abs(remaining) < 1e-8) { velocity = 0; settlingFrequency = c.releaseMinOmega; }
      else settlingFrequency = Math.max(c.releaseMinOmega, Math.abs(velocity / remaining));
      if (increment) listeners.forEach((f) => f({ type: 'commit', increment: Math.sign(increment), index: m.selectedIndex }));
    },
    finishSystemPaging() {
      if (!systemPaging) return;
      systemPaging = false; dragging = false;
      target = dragReturn; velocity = 0;
    },
    /** Emulated UIScrollView paging choice (private in UIKit): +-1 page around the anchor. */
    pagingTarget(pages, pagesPerSecond) {
      const proposed = Math.abs(pagesPerSecond) > c.pagingFlick ? Math.sign(pagesPerSecond) * Math.max(1, Math.abs(Math.round(pages))) : Math.round(pages);
      return Math.min(1, Math.max(-1, proposed));
    },

    /** Analytic critically damped spring, stable after a dropped frame. Returns true while moving. */
    advance(seconds) {
      if (dragging || systemPaging) return true;
      const dt = Math.min(Math.max(seconds, 0), c.maxDt);
      const omega = settlingFrequency;
      const offset = angle - target;
      const b = velocity + omega * offset;
      const decay = Math.exp(-omega * dt);
      angle = target + (offset + b * dt) * decay;
      velocity = (velocity - omega * b * dt) * decay;
      const moving = Math.abs(angle - target) > c.settleAngle || Math.abs(velocity) > c.settleVelocity;
      if (!moving) { angle = target; velocity = 0; settlingFrequency = c.omega; }
      return moving;
    },

    /** Jump without animation (used by setPosition / scrub). */
    jump(pages) { dragging = false; systemPaging = false; angle = -pages; target = angle; velocity = 0; settlingFrequency = c.omega; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    deviations() {
      const out = {};
      for (const k of Object.keys(NATIVE)) if (c[k] !== NATIVE[k]) out[k] = { native: NATIVE[k], here: c[k] };
      return out;
    },
  };
  return m;
}

/** Loop helpers for a position in pages over `stops` stops. */
export function blendAt(pages, stops = 4) {
  if (!Number.isFinite(pages)) return { lower: 0, upper: 0, t: 0, amount: 0 };
  let page = mod(pages, stops);
  const nearest = Math.round(page);
  if (Math.abs(page - nearest) < 1e-6) { const i = mod(nearest, stops); return { lower: i, upper: i, t: 0, amount: 0 }; }
  const lower = Math.floor(page), t = page - lower;
  return { lower: mod(lower, stops), upper: mod(lower + 1, stops), t, amount: smoothstep(t) };
}
export { smoothstep, mod };
