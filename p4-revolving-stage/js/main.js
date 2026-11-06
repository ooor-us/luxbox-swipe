// P4 Revolving Stage (round 4): a theatre revolve seen from a fixed seat. The turning axis stands straight upstage
// of the front box, on the camera's line of sight, so a turn carries the boxes straight across the screen with the
// finger. Four quarter sets are divided by a cross of flats; at rest the box stands in front of the 90 deg corner of
// its own two flats. One world-fixed spotlight lights the acting area: the sets turn into and out of it, the flats
// rise into the dark above it (behind the header) and the floor falls into shade downstage of it (under the title
// and the lower UI), so every UI text sits on shade on every set. Browse only: a tap is feedback, never an opening.
import * as THREE from 'three';
import { createStage } from '../../shared/js/stage.js';
import { STOPS, TINTS, tierLabel } from '../../shared/js/stops.js';
import { loadStudioBoxes } from '../../shared/js/box.js';
import { createTone } from '../../shared/box/box.js';
import { params } from '../../shared/js/proto-api.js';
import { buildRevolve, SPOT, aimSpot, poolAt, SHADE, REFL_U, CUT } from './revolve.js';

const BASE = new URL('../', import.meta.url).href;
const RM_AT_LOAD = params.get('rm') === '1' || (params.get('rm') !== '0' && matchMedia('(prefers-reduced-motion: reduce)').matches);
// Motion: the native port (NativeBoxesMotion), unchanged. Reduced motion settles faster (omega 26): the cue is short.
const MOTION = RM_AT_LOAD ? { omega: 26 } : {};
// Rendering: DPR 2 at most by default (?dpr=3 for the full ratio); MSAA samples of the tone pass (?msaa=0 drops it,
// the cheaper fallback if a phone misses 60 fps).
const MAX_DPR = +(params.get('dpr') || 2);
// round 4: on a touch device the default is 2x MSAA (the critic's phone fallback, unproven on a device either way);
// desktop keeps 4x. ?msaa=0|2|4 forces it.
const COARSE = matchMedia('(pointer: coarse)').matches;
const MSAA = params.has('msaa') ? +params.get('msaa') : COARSE ? 2 : 4;

// ---- UI inks: the stage is dark round the light, so every stop uses light ink on shade (as today's app does on
// its dark page). Ivory and Reeded keep their own accents (gold +, ivory View all; ice-blue +, white View all).
const STAGE_TINTS = [
  { ...TINTS.riviera, glassBottom: '#EBD9BD', glassShade: '#2E261E', plusA: '#C9A25A', plusB: '#C9A25A', plusInk: '#0E0E15',
    viewAllA: '#F3E6D2', viewAllB: '#C9A25A', viewAllInk: '#1E1710', figure: '#FFF1CF', nameShadow: '#C9A25A', nameShadowOpacity: 0.2, swipe: 'ivory' },
  { ...TINTS.riviera, glassBottom: '#D6E2EE', glassShade: '#14203A', plusA: '#A4CEE9', plusB: '#A4CEE9', plusInk: '#0E0E15',
    viewAllA: '#FFFFFF', viewAllB: '#E6ECF2', viewAllInk: '#101827', figure: '#EEF4FF', nameShadow: '#A4CEE9', nameShadowOpacity: 0.2, swipe: 'reeded' },
  { ...TINTS.riviera },
  { ...TINTS.desert },
];

let tapGlow = 0;
const stage = createStage({
  name: 'p4 · Revolving Stage', motion: MOTION, maxDpr: MAX_DPR, tints: STAGE_TINTS,
  onTap: () => { tapGlow = 1; },   // feedback only (never opens): the box's light lifts a touch, like a follow spot
});

// ---- UI styling owned by this page (the kit is untouched)
const css = document.createElement('style');
css.textContent = `
/* no blurred light bars: the strips behind the recent row and the cards are off on every set */
.lbx-ui .strip { display: none !important; }
/* round 4: the kit's own name/tier layers and swipe images are replaced by this page's ticker and pill layer (below):
   no node swap, no fade, no src change at a stop, so nothing blinks when the spring lands */
.lbx-ui p.t.name:not(.p4), .lbx-ui .tier:not(.p4) { display: none !important; }
.lbx-ui .swipe img:not(.p4pill) { visibility: hidden !important; }
.lbx-ui .p4.name, .lbx-ui .p4.tier { transition: none !important; }
.lbx-ui .swipe img.p4pill { transition: none !important; }
/* the lower UI stands downstage, in the shade: dark glass */
.lbx-ui .glass[style*="top: 591px"] { background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03)), rgba(10,9,8,0.42) !important; }`;
document.head.appendChild(css);
const CARD = { card: '#14110E', cardOpacity: 0.5, cardStroke: '#FFFFFF', cardStrokeOpacity: 0.14, cardShadow: '#000000', cardShadowOpacity: 0, stripOpacity: 0 };

// ---- renderer + scene
const renderer = new THREE.WebGLRenderer({ canvas: stage.canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0, 0);
const scene = new THREE.Scene();
let tone = null, camera = null;
stage.onResize((w, h, dpr) => {
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  if (tone) { const s = renderer.getDrawingBufferSize(new THREE.Vector2()); tone.setSize(s.x, s.y); }
});
const studio = await loadStudioBoxes(renderer, STOPS, { aspect: stage.width / stage.height });
camera = studio.camera;
tone = MSAA === 4 ? studio.tone : await createTone(renderer, { samples: MSAA });

// ---- the camera: fixed, pitched 14 deg down (the native ring camera: 16.8 deg; 14 keeps the front box's path
// flat, |dy| < 0.3 |dx| within 45 deg of the front), on the line through the box
// and the revolve's axis. A vertical lens shift (as the native off-axis projection does) puts the box bottom near
// the native 393 pt; 45 deg vertical FOV, 11 units from the box centre: the box is 60 % of the screen width.
const CAM = { pitch: +(params.get('pitch') || 14), dist: +(params.get('cd') || 11), fov: +(params.get('fov') || 45), cy: +(params.get('cy') || 300) };
const CAM_T = new THREE.Vector3(-0.15, 0.28, 0);
{
  const p = CAM.pitch * Math.PI / 180;
  camera.position.set(CAM_T.x + CAM.dist * Math.cos(p), CAM_T.y + CAM.dist * Math.sin(p), CAM_T.z);
  camera.up.set(0, 1, 0); camera.lookAt(CAM_T); camera.fov = CAM.fov;
  const upd = camera.updateProjectionMatrix.bind(camera);
  camera.updateProjectionMatrix = () => { upd(); camera.projectionMatrix.elements[9] = -(1 - 2 * CAM.cy / 812); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); };
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}
if (params.get('spot')) { const v = params.get('spot').split(',').map(Number); SPOT.k.set(...v); aimSpot(); }
const GEO_O = params.get('geo') ? Object.fromEntries(params.get('geo').split(',').map((kv) => kv.split(':')).map(([k, v]) => [k, +v])) : null;
const rev = await buildRevolve({ base: BASE, renderer, camera, geo: GEO_O, noLm: params.get('nolm') === '1' });
{ const s = renderer.getDrawingBufferSize(new THREE.Vector2()); tone.setSize(s.x, s.y); }
scene.add(rev.group); scene.add(rev.deck); scene.add(rev.cyc);
// per-box studio gain: the Amethyst leather is the darkest violet of the four; a little more of its studio light
// keeps it reading violet (not navy-black) against the rose sand. The model and its materials are unchanged.
const BOX_GAIN = { obsidian: 1, sapphire: 1.08, emerald: 1, amethyst: +(params.get('amg') || 1.3) };
const boxes = STOPS.map((s, k) => {
  const o = studio.boxes[s.key].object; const sp = rev.spot(k);
  o.position.copy(sp.pos); o.rotation.y = sp.rotY; rev.group.add(o);
  const mats = []; o.traverse((m) => { if (m.isMesh) mats.push([m.material, m.material.envMapIntensity * (BOX_GAIN[s.key] || 1)]); });
  return { o, mats };
});

const mod = (x, n) => ((x % n) + n) % n;
const sstep = (t) => t * t * (3 - 2 * t);

// ---- what the stage shows: the revolve angle (pages) and the light cue
// Normal: the revolve angle is the position, 1:1 with the finger. Reduced motion: the revolve does not turn under
// the finger; when the position commits to another stop (past halfway) a 220 ms blackout cue (110 ms down, swap at
// black, 110 ms up, real time) hands the stage over. Nothing travels. The UI shows only the stop on stage.
const RM_HALF = 110;
let rmShown = null, rmT0 = 0;
function showState(position, rm) {
  if (!rm) { rmShown = null; rmT0 = 0; return { angle: position, level: 1, shown: null }; }
  const target = mod(Math.round(position), 4), now = performance.now();
  if (rmShown === null) rmShown = target;
  if (target !== rmShown && rmT0 === 0) rmT0 = now;
  let level = 1;
  if (rmT0) {
    const e = now - rmT0;
    if (e < RM_HALF) level = 1 - 0.92 * (e / RM_HALF);
    else { rmShown = target; level = 0.08 + 0.92 * Math.min(1, (e - RM_HALF) / RM_HALF); if (e >= 2 * RM_HALF) rmT0 = 0; }
  }
  return { angle: rmShown, level, shown: rmShown };
}
let SHOW = { angle: 0, level: 1, shown: null };

// ---- UI (round 4). The title is a ticker that rides with the revolve: every box name sits on one track, one finger
// page (375 / 1.4 = 268 pt) apart, and moves 1:1 with the finger, clipped by the screen edge. The old name slides
// out left as the new one slides in from the right, both whole words at full opacity, so some name is always on the
// title line. The elements are created once and never replaced or faded, so nothing changes when the spring lands
// and a frozen setPosition(n) is exactly the settled state. The Swipe to open pill is four preloaded, decoded images
// stacked in the kit's slot; the nearer stop's one is shown (a one-frame swap at halfway, never a fade or a src change).
const SLIDE = 292;
const uiRoot = stage.ui.el;
const shadowOf = (t) => t.nameShadowOpacity > 0.001 ? `0 0 ${t.nameShadowBlur}px ${t.nameShadow}${Math.round(t.nameShadowOpacity * 255).toString(16).padStart(2, '0')}` : 'none';
const ticker = STOPS.map((st) => {
  const n = document.createElement('p'); n.className = 't name p4'; n.textContent = st.name; n.dataset.role = 'primary'; n.dataset.region = 'name';
  const d = document.createElement('div'); d.className = 'a tier p4';
  const dot = document.createElement('span'); dot.className = 'dot'; const tp = document.createElement('p'); tp.className = 't'; tp.textContent = tierLabel(st);
  tp.dataset.role = 'tier'; tp.dataset.region = 'name'; d.append(dot, tp);
  uiRoot.append(n, d); return { n, d, tp, x: null, vis: null };
});
const pillSlot = uiRoot.querySelector('.swipe');
const PILLS = {};
for (const t of STAGE_TINTS) if (!PILLS[t.swipe]) {
  const im = document.createElement('img'); im.className = 'p4pill'; im.alt = ''; im.draggable = false;
  im.src = new URL('../../shared/ui/img/swipe-' + t.swipe + '.png', import.meta.url).href; im.style.opacity = '0';
  pillSlot.appendChild(im); PILLS[t.swipe] = im;
}
await Promise.all(Object.values(PILLS).map((im) => im.decode().catch(() => {})));
let pillShown = null;

stage.ui.setOverride((s) => {
  // the View all tab and the + button take the nearer stop's panel and ink whole (swapped at halfway): an
  // interpolated panel between a light and a dark one passes through a mid-tone where neither ink is AA
  const near = SHOW.shown !== null ? SHOW.shown : (s.t < 0.5 ? s.lower : s.upper);
  const nearT = STAGE_TINTS[near];
  const out = { tint: { ...s.tint, ...CARD, viewAllA: nearT.viewAllA, viewAllB: nearT.viewAllB, plusA: nearT.plusA, plusB: nearT.plusB },
    viewAllInk: nearT.viewAllInk, plusInk: nearT.plusInk };
  out.nameOut = { ...s.nameOut, opacity: 0 }; out.nameIn = { ...s.nameIn, opacity: 0 };    // the kit's layers stay hidden
  out.swipe = { lower: nearT.swipe, upper: nearT.swipe, amount: 0, flip: false, useUpper: false };
  if (SHOW.shown !== null) {          // reduced motion: only the stop on stage
    const t = STAGE_TINTS[SHOW.shown];
    out.tint = { ...t, ...CARD };
    out.inks = Object.fromEntries(Object.keys(s.inks).map((r) => [r, t]));
  }
  // ticker + pill
  const ink = (out.inks || s.inks).name;
  const p = s.pages;
  for (let k = 0; k < 4; k++) {
    const e = ticker[k];
    let d = SHOW.shown !== null ? (k === SHOW.shown ? 0 : 9) : mod(k - p + 2, 4) - 2;
    const vis = Math.abs(d) < 1;               // at |d| = 1 a name is wholly off screen (centre 292 pt out, half-width < 105 pt)
    if (vis !== e.vis) { e.vis = vis; e.n.style.visibility = e.d.style.visibility = vis ? '' : 'hidden'; }
    if (!vis) continue;
    const x = (d * SLIDE).toFixed(2);
    if (x !== e.x) { e.x = x; e.n.style.transform = e.d.style.transform = `translate3d(${x}px,0,0)`; }
    e.n.style.color = ink.primary; e.n.style.textShadow = shadowOf(ink);
    e.tp.style.color = ink.secondary; e.tp.style.opacity = ink.tierOpacity.toFixed(3);
  }
  const pill = PILLS[nearT.swipe];
  if (pill !== pillShown) { if (pillShown) pillShown.style.opacity = '0'; pill.style.opacity = '1'; pillShown = pill; }
  return out;
});
// The kit calls ui.setPosition every frame; at rest nothing changes, so the DOM is only touched when the position
// (or the reduced-motion stage) changes. This keeps idle frames free of style and text writes.
const kitSet = stage.ui.setPosition.bind(stage.ui);
let uiKey = null, uiLast = null;
stage.ui.setPosition = (p) => {
  SHOW = showState(p, stage.reducedMotion);
  const key = p + '|' + SHOW.shown + '|' + (stage.reducedMotion ? 1 : 0);
  if (key === uiKey) return uiLast;
  uiKey = key; uiLast = kitSet(p); return uiLast;
};

// ---- the lens breath (round 4): the seat pulls back while the revolve turns. The camera dollies straight back
// along its own line, as a function of the revolve angle only (so it follows the finger 1:1 and is exactly home at
// every stop): at halfway the frame holds both boxes whole and the stage reads as one turntable; at rest it is the
// round-3 hero framing. sin^2 has zero slope at the stops, so the settle stays a pure spring.
const BREATH = +(params.get('breath') || 0.6);          // framing scale at halfway (1 = no breath)
const camDir = camera.position.clone().sub(CAM_T).normalize();
function placeCamera(angle) {
  const s = Math.sin(Math.PI * (angle - Math.floor(angle))); const z = 1 - (1 - BREATH) * s * s;
  camera.position.copy(CAM_T).addScaledVector(camDir, CAM.dist / z); camera.updateMatrixWorld(true);
  return z;
}

// ---- the mirror pass: the boxes rendered once more from the camera mirrored in the floor plane, into a quarter-res
// HDR target; every floor samples it (blurred, faded with distance from the box's foot): the home's soft reflection.
const FLOOR_Y = rev.geometry.zb;
const REFL_DIV = 4;
const reflRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true });
REFL_U.uRefl.value = reflRT.texture;
const vcam = new THREE.PerspectiveCamera(); vcam.layers.set(1);
function sizeRefl() { const s = renderer.getDrawingBufferSize(new THREE.Vector2()); const w = Math.max(4, Math.round(s.x / REFL_DIV)), h = Math.max(4, Math.round(s.y / REFL_DIV)); reflRT.setSize(w, h); REFL_U.uReflTexel.value.set(1 / w, 1 / h); }
sizeRefl(); stage.onResize(() => sizeRefl());
boxes.forEach(({ o }) => o.traverse((m) => { if (m.isMesh) m.layers.enable(1); }));
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Matrix4();
function renderMirror() {
  camera.updateMatrixWorld(true);
  _p.copy(camera.position); _p.y = 2 * FLOOR_Y - _p.y;
  _q.extractRotation(camera.matrixWorld);
  _t.set(0, 0, -1).applyMatrix4(_q).add(camera.position); _t.y = 2 * FLOOR_Y - _t.y;
  _u.set(0, 1, 0).applyMatrix4(_q); _u.y = -_u.y;
  vcam.position.copy(_p); vcam.up.copy(_u); vcam.lookAt(_t); vcam.updateMatrixWorld(true);
  vcam.projectionMatrix.copy(camera.projectionMatrix); vcam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  REFL_U.uReflM.value.copy(BIAS).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
  const prevT = renderer.getRenderTarget(), cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
  renderer.setRenderTarget(reflRT); renderer.setClearColor(0, 0); renderer.clear(true, true, false);
  // only the boxes in front reflect: the mirror pass has no flats, so a neighbour behind its flat must not leak in
  const hid = boxes.filter((b) => b.o.visible && Math.abs(b.rel) > 0.8); hid.forEach((b) => { b.o.visible = false; });
  renderer.render(scene, vcam);
  hid.forEach((b) => { b.o.visible = true; });
  renderer.setRenderTarget(prevT); renderer.setClearColor(cc, ca);
}

// ---- frame
const CAUS = +(params.get('caus') || 3);
// cyclorama colours per set (linear): [at the floor, up top] (only seen past a flat's end mid-turn)
const CYC = [[[0.10, 0.08, 0.06], [0.02, 0.016, 0.012]], [[0.09, 0.10, 0.12], [0.02, 0.022, 0.028]],
  [[0.02, 0.04, 0.038], [0.006, 0.012, 0.013]], [[0.10, 0.05, 0.04], [0.02, 0.016, 0.03]]];
const tmp = new THREE.Vector3();
let lastRm = null, drawKey = null, forceDraw = 0;
function setStage(angle, level, glow, time) {
  rev.group.rotation.y = -angle * Math.PI / 2;
  placeCamera(angle);
  const cue = [level, level, level, level];
  rev.update({ cue, time, caustic: CAUS });
  {
    const pp = mod(angle, 4), lo = Math.floor(pp) % 4, up = (lo + 1) % 4, m = sstep(Math.min(1, Math.max(0, (pp - Math.floor(pp) - 0.3) / 0.4)));
    const mix3 = (a, b) => a.map((v, i) => v + (b[i] - v) * m);
    rev.setCyc(mix3(CYC[lo][0], CYC[up][0]), mix3(CYC[lo][1], CYC[up][1]), level);
    rev.setDeck(mix3(SHADE[lo], SHADE[up]).map((v) => v * 0.7 * level));   // the fixed deck round the revolve takes the scene's shade colour
  }
  rev.group.updateMatrixWorld();
  const front = mod(Math.round(angle), 4);
  boxes.forEach(({ o, mats }, k) => {
    // each box turns into and out of the world-fixed spot: full studio light in the beam, easing down outside it
    const rel = mod(k - angle + 2, 4) - 2;       // quarter turns from the front, -2..2
    boxes[k].rel = rel;
    o.visible = Math.abs(rel) < 1.15;             // the set behind the corner is never seen
    if (!o.visible) return;
    o.getWorldPosition(tmp); tmp.y = 0.3;
    const g = (0.45 + 0.55 * poolAt(tmp)) * level * (1 + 0.08 * glow * (k === front ? 1 : 0));
    for (const [m, base] of mats) m.envMapIntensity = base * g;
  });
}
function draw() { renderMirror(); tone.render(scene, camera); }
stage.onFrame((f) => {
  const rm = f.reducedMotion;
  tapGlow = Math.max(0, tapGlow - f.dt * 3.5);
  // a frame is drawn only when something on stage changed: the angle, the light cue, the tap glow, the size, or the
  // Riviera caustics drifting while that set is in view. A resting stage costs no GPU or CPU beyond the rAF tick.
  const rivieraInView = Math.abs(mod(2 - SHOW.angle + 2, 4) - 2) < 1.15 && !rm && !f.frozen;
  const key = `${SHOW.angle}|${SHOW.level}|${tapGlow.toFixed(4)}|${stage.width}x${stage.height}|${rm}`;
  if (key === drawKey && !rivieraInView && forceDraw <= 0) return;
  drawKey = key; forceDraw--;
  setStage(SHOW.angle, SHOW.level, tapGlow, rm ? 0 : f.time);
  if (rm !== lastRm) { lastRm = rm; stage.setInfo({ reducedMotionActive: rm }); }
  draw();
});
stage.onResize(() => { forceDraw = 3; });

// ---- pre-warm (round 4): before the page reports ready, every set, flat and box is drawn once at each of the four
// quarter turns (and at a halfway breath), so every shader program is linked and every lightmap, albedo and box
// texture is on the GPU. The first swipe then compiles and uploads nothing (it used to stall 83-100 ms near p 0.95,
// when the box behind the corner first came into view).
renderer.compile(scene, camera); renderer.compile(scene, vcam);
for (const a of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
  setStage(a, 1, 0, 0);
  boxes.forEach(({ o }) => { o.visible = true; });
  draw();
}
renderer.getContext().finish();
setStage(0, 1, 0, 0);

// ---- a strong flick carries two stops (round 4). The native rule commits one stop; when the release is fast
// (> 1800 pt/s) and the finger already carried the revolve past 0.7 of a page, the target moves one stop further.
// The spring and its velocity bound are the native ones, so the landing is the same critically damped settle.
const FLICK2 = { speed: +(params.get('f2v') || 1800), progress: +(params.get('f2p') || 0.7) };
{
  const m = stage.motion, endDrag = m.endDrag;
  m.endDrag = (v, cancelled) => {
    const prog = m.dragProgress;
    const inc = endDrag(v, cancelled);
    if (inc && !cancelled && Math.abs(v) > FLICK2.speed && Math.abs(prog) > FLICK2.progress && Math.sign(prog) === inc) {
      m.select(mod(m.selectedIndex + inc, 4));
      return inc * 2;
    }
    return inc;
  };
}

stage.setInfo({
  boxSources: Object.fromEntries(STOPS.map((s) => [s.key, studio.boxes[s.key].source])),
  spatialModel: 'fixed camera; a revolve (turntable) with its axis straight upstage of the box; four quarter sets divided by a cross of flats; each box stands in front of the corner of its two flats; one quarter turn per stop under one world-fixed spot',
  reducedMotionNote: 'reduced motion: the revolve does not turn under the finger; when the swipe commits (past halfway) a 220 ms blackout light cue hands the stage over (no spatial motion); the UI shows only the stop on stage; the spring settles faster (omega 26)',
  maxDpr: MAX_DPR, msaa: MSAA, camera: CAM, breath: BREATH, flickTwoStops: FLICK2, reflection: { div: REFL_DIV }, bake: { samples: rev.meta.samples },
});
window.__p4 = { THREE, boxes, rev, camera, scene, SPOT, CUT, placeCamera, ticker, get show() { return SHOW; } };
stage.start();
camera.updateMatrixWorld(true);
let n = 0; stage.onFrame(() => { if (++n === 3) stage.markReady(); });
