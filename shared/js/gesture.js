// Horizontal swipe input for the home carousel: Pointer Events (touch, pen and mouse) on one surface.
// - touch-action: none and overscroll-behavior: none on the surface, preventDefault on touchmove, so there is
//   no page scroll, pull-to-refresh or iOS rubber-band while swiping.
// - A pan starts after `slop` px of mostly horizontal movement (UIPan hysteresis ~10 pt); a mostly vertical
//   start is ignored like NativeCarouselPagingView.gestureRecognizerShouldBegin.
// - Translation is measured from touch-down, in CSS px (= iOS points at the 375 pt design width).
// - Release velocity is the finger velocity over the last ~80 ms, in px/s (= pt/s).
// - A tap (no pan, short press) only calls onTap: feedback, never an opening (AGENTS.md product contract).
//
// attachGesture(el, { onBegin(), onMove(dx, width, dy), onEnd(vx, cancelled), onTap({x, y, width}) }) -> detach()

export function attachGesture(el, handlers = {}, opts = {}) {
  const slop = opts.slop ?? 8;
  const windowMs = opts.velocityWindowMs ?? 80;
  const tapMaxMs = opts.tapMaxMs ?? 350;
  el.style.touchAction = 'none';
  el.style.userSelect = 'none';
  el.style.webkitUserSelect = 'none';
  el.style.overscrollBehavior = 'none';
  const root = document.documentElement;
  root.style.overscrollBehavior = 'none';

  let id = null, x0 = 0, y0 = 0, t0 = 0, panning = false, rejected = false, samples = [], off = 0;
  // The pan starts after `slop` px; reporting the full translation at that moment made the box jump ~8 px in one
  // frame. The slop is absorbed over the next `catchUp` px instead (the box moves ~1.15x the finger meanwhile), so
  // the box starts from rest and is back under the finger 1:1 after a short travel.
  const catchUp = opts.catchUp ?? 48;
  const eased = (dx) => dx - off * Math.max(0, 1 - Math.abs(dx - off) / catchUp);
  const width = () => el.getBoundingClientRect().width || window.innerWidth;

  function velocity() {
    const now = samples.length ? samples[samples.length - 1].t : 0;
    const recent = samples.filter((s) => now - s.t <= windowMs);
    if (recent.length < 2) return 0;
    const a = recent[0], b = recent[recent.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.x - a.x) / dt : 0;
  }

  function down(e) {
    if (id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = e.timeStamp;
    panning = false; rejected = false; samples = [{ x: e.clientX, t: e.timeStamp }];
    try { el.setPointerCapture(id); } catch { /* synthetic */ }
  }
  function move(e) {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    samples.push({ x: e.clientX, t: e.timeStamp });
    if (samples.length > 64) samples.splice(0, samples.length - 64);
    if (!panning && !rejected) {
      if (Math.hypot(dx, dy) < slop) return;
      if (Math.abs(dy) > Math.abs(dx)) { rejected = true; return; }
      panning = true; off = dx;
      handlers.onBegin && handlers.onBegin();
    }
    if (panning) { handlers.onMove && handlers.onMove(eased(dx), width(), dy); e.preventDefault(); }
  }
  function up(e, cancelled) {
    if (e.pointerId !== id) return;
    samples.push({ x: e.clientX, t: e.timeStamp });
    if (panning) handlers.onEnd && handlers.onEnd(cancelled ? 0 : velocity(), !!cancelled);
    else if (!rejected && !cancelled && e.timeStamp - t0 <= tapMaxMs) {
      const r = el.getBoundingClientRect();
      handlers.onTap && handlers.onTap({ x: e.clientX - r.left, y: e.clientY - r.top, width: r.width });
    }
    id = null; panning = false; samples = [];
  }
  const onDown = (e) => down(e), onMove = (e) => move(e);
  const onUp = (e) => up(e, false), onCancel = (e) => up(e, true);
  const block = (e) => { if (e.cancelable) e.preventDefault(); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('lostpointercapture', onCancel);
  el.addEventListener('touchmove', block, { passive: false });
  el.addEventListener('contextmenu', block);
  el.addEventListener('dragstart', block);
  return () => {
    el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('lostpointercapture', onCancel); el.removeEventListener('touchmove', block);
    el.removeEventListener('contextmenu', block); el.removeEventListener('dragstart', block);
  };
}

/**
 * Wire a gesture surface to a motion object, in either native input path.
 * Returns detach(). `onTapFeedback` gets the tap (left/right side zones are NOT turned into moves here:
 * prototypes decide; the native maps side taps to previous/next selection, never to an opening).
 */
export function bindMotion(el, motion, { onTap, onCommit } = {}) {
  let lastPages = 0;
  return attachGesture(el, {
    onBegin() {
      if (motion.config.mode === 'paging') motion.beginSystemPaging(); else motion.beginDrag();
    },
    onMove(dx, width) {
      if (motion.config.mode === 'paging') { lastPages = -dx / width; motion.trackSystemPaging(lastPages); }
      else motion.drag(dx, width);
    },
    onEnd(vx, cancelled) {
      // The dev speed scale slows the clock (advance(dt * scale)), never the finger velocity.
      if (motion.config.mode === 'paging') {
        const w = el.getBoundingClientRect().width || 375;
        if (cancelled) { motion.finishSystemPaging(); return; }
        const pps = -vx / w;
        const inc = motion.pagingTarget(lastPages, pps);
        motion.releaseSystemPage(inc, pps);
        onCommit && inc && onCommit(inc);
      } else {
        const inc = motion.endDrag(vx, cancelled);
        onCommit && inc && onCommit(inc);
      }
    },
    onTap(t) { onTap && onTap(t); },
  });
}
