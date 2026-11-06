// P3 · Enfilade (round 4). One long gallery of four bays in a row, one theme per bay, each box centred in its own bay.
// The camera trucks sideways along the row (one bay per page). Round 3: the truck LEADS with the incoming bay
// (e = t + lead * K * sin^2(pi t), lead = +1 towards the stop you are swiping to), so half-way through a swipe the
// incoming box already owns the centre and the narrowed stone pier (0.54 wide) has passed to the side; the camera
// steps back a little mid-swipe (sin^2(pi e), zero at rest). At rest a blade of the NEXT room's light crosses the floor
// from the right doorway (baked), so the rest frame says where the next box is.
// Every room surface is a baked lightmap (bake/enfilade.py, Cycles COMBINED without glossy) drawn unlit into the shared
// HDR target, so room and box share the AgX MHC LUT. The pier stone is baked flat (light only) and its grain is a
// full-resolution detail texture (lightmap x albedo detail). A baked AO decal grounds each box. Live: Riviera's caustics,
// the pier arris highlight, one key light per bay on the box.
//
// UI (round 4): labels are never hidden. Each label group takes one whole ink and every label sits on a soft local scrim
// whose opacity is a pure function of e, solved offline on the real frames (bake/measure-ui.mjs). Inks switch in one
// frame (no crossfades). Box textures: ASTC 5x5 (bake/boxtex_astc.py) > BC1 > RGBA8. Bays are frustum-culled.
import * as THREE from 'three';
import { createStage } from '../../shared/js/stage.js';
import { STOPS, TINTS, tierLabel } from '../../shared/js/stops.js';
import { loadStudioBoxes } from '../../shared/js/box.js';
import { luminance, hexToRgb, contrast, mixHex, rgba } from '../../shared/js/ui.js';
import { params } from '../../shared/js/proto-api.js';

const ASSET = new URL('../assets/', import.meta.url).href;
const GAIN = +(params.get('gain') || 1.0);
const PULL = params.has('pull') ? +params.get('pull') : 1.6;   // mid-swipe pull-back (units), sin^2 profile
const LEAD = params.has('lead') ? +params.get('lead') : 0.24;  // incoming-bay lead of the truck (pages at t = 0.5); round 4: 0.14 -> 0.24
const KEYK = params.has('key') ? +params.get('key') : 1;
// round 5: room exposure per bay (the box is not graded). The light rooms carry dark Figma inks, so they can only go
// down to 0.8 before the rest frame loses AA; the two dark rooms go well down, to the contract's darker mood.
const EXPO = (() => { const v = (params.get('expo') || '0.8,0.8,0.6,0.6').split(',').map(Number); return [0, 1, 2, 3].map((k) => v[Math.min(k, v.length - 1)]); })();
const VIG = params.has('vig') ? +params.get('vig') : 0.4;       // round 5: room fall-off toward the frame edges
const REFL = params.has('refl') ? +params.get('refl') : 0.85;   // round 5: dark floor reflection strength

const MY_TINTS = STOPS.map((s) => ({ ...TINTS[s.ui], stripOpacity: 0 }));

let tapPulse = 0;
const stage = createStage({
  name: 'p3 · Enfilade',
  tints: MY_TINTS,
  motion: { gain: GAIN },
  maxDpr: 2,
  onTap: () => { tapPulse = 1; },   // feedback only: the box breathes once. A tap never opens anything.
});
const ui = stage.ui;
const isRM = () => stage.reducedMotion;
const mod4 = (k) => ((k % 4) + 4) % 4;
const sstep = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// ---------------------------------------------------------------- camera parameter (the truck), with lead
// e(t) in [0,1] across one seam; monotonic (slope >= 1 - pi*LEAD > 0.5). The anchor is the stop the swipe started from:
// it updates only at rest or when a stop is crossed (where sin^2 = 0), so the lead never jumps.
let anchor = 0, forceLead = null;
function leadSign(position) {
  const r = Math.round(position);
  if (Math.abs(position - r) < 1e-3) anchor = r;
  const lo = Math.floor(position);
  if (anchor !== lo && anchor !== lo + 1) anchor = lo;   // jumps / frozen scrubs: lead towards the upper stop
  return anchor === lo ? 1 : -1;
}
function camParam(position) {
  const lo = Math.floor(position), f = position - lo;
  const L = forceLead != null ? forceLead : leadSign(position);
  const s = Math.sin(Math.PI * f);
  return { lo, f, e: f + L * LEAD * s * s, L };
}

// ---------------------------------------------------------------- UI (round 4): whole inks + soft local scrims, never hidden
// Every label is always drawn at full opacity. Each label (key) takes, whole, one ink (lower / upper / opposite polarity)
// and sits on its own soft local scrim (a feathered plate in the polarity opposite to its ink) whose opacity is a pure
// function of the camera parameter e, solved offline on the real frames (bake/measure-ui.mjs): the smallest opacity that
// holds AA x margin for that ink at e. At rest the scrims are at (or near) zero. Inks switch in a single frame (no colour
// crossfade, so no mid-grey frame ever exists), at the point the solver picked to keep the scrim pop smallest.
const loadJSON = (f) => fetch(ASSET + f).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const [uiTab, uiTabRM] = await Promise.all([loadJSON('ui-table.json'), loadJSON('ui-table-rm.json')]);
const table = () => (isRM() ? uiTabRM || uiTab : uiTab);
const tintOf = (i) => MY_TINTS[i];
const lumHex = (h) => luminance(hexToRgb(h));
function bestInk(panelHex, inks) { const L = lumHex(panelHex); return inks.reduce((a, b) => (contrast(lumHex(b), L) > contrast(lumHex(a), L) ? b : a)); }
let measureInk = null;    // measure mode: 'lo' | 'up' | 'alt' (every element forced to one ink, scrims off)
let uiE = 0;              // camera parameter of the current frame
function mixTint(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    const va = a[k], vb = b[k] ?? va;
    if (typeof va === 'number') out[k] = va + (vb - va) * t;
    else if (typeof va === 'string' && va[0] === '#') out[k] = mixHex(va, vb, t);
    else if (k === 'bgLum') out[k] = Object.fromEntries(Object.keys(va).map((r) => [r, va[r] + ((vb[r] ?? va[r]) - va[r]) * t]));
    else out[k] = t < 0.5 ? va : vb;
  }
  return out;
}

// ---- name + tier: one roll at a time, never two names visible (round 4)
const SLOT = { name: { top: 431, el: 432, S: 46, F: 6, H: 46 }, tier: { top: 476, el: 476, S: 14, F: 3, H: 14 } };
const ROLL_MS = 260;
const roll = { shown: 0, anim: null, inited: false };
// round 5: the name follows the camera parameter e (the box actually centred), not the finger position p. With the
// lead, e crosses 0.5 at t 0.30 going forward (0.70 going back), so the name hands over when the incoming box takes the
// centre. pe = lo + e; a small hysteresis band (0.47-0.53) keeps a held finger from flickering the roll.
function rollTarget(pe) {
  const lo = Math.floor(pe), t = pe - lo;
  const cur = roll.anim ? roll.anim.to : roll.shown;
  if (t >= 0.53) return lo + 1;
  if (t <= 0.47) return lo;
  return cur === lo || cur === lo + 1 ? cur : Math.round(pe);
}
function rollUpdate(p, instant) {
  const now = performance.now();
  const want = instant ? Math.round(p) : rollTarget(p);
  if (!roll.inited || instant) { roll.shown = want; roll.anim = null; roll.inited = true; }
  const goal = roll.anim ? roll.anim.to : roll.shown;
  if (want !== goal) {
    if (roll.anim && (now - roll.anim.t0) / ROLL_MS < 0.5) roll.anim.to = want;      // still leaving: retarget the arrival
    else { if (roll.anim) roll.shown = roll.anim.to; roll.anim = { from: roll.shown, to: want, t0: now }; }
    if (roll.anim && roll.anim.to === roll.anim.from) { roll.shown = roll.anim.from; roll.anim = null; }
  }
  if (roll.anim && (now - roll.anim.t0) >= ROLL_MS) { roll.shown = roll.anim.to; roll.anim = null; }
  const u = roll.anim ? (now - roll.anim.t0) / ROLL_MS : 1;
  return { u, a: roll.anim ? roll.anim.from : roll.shown, b: roll.anim ? roll.anim.to : roll.shown, dir: roll.anim ? Math.sign(roll.anim.to - roll.anim.from) || 1 : 1, anim: !!roll.anim };
}
let rollState = { u: 1, a: 0, b: 0, dir: 1, anim: false };

ui.setOverride((s) => {
  const lo = tintOf(s.lower), up = tintOf(s.upper);
  { const cp = camParam(s.pages); uiE = isRM() ? cp.f : cp.e; }
  s = { ...s, tint: mixTint(lo, up, sstep(uiE)) };
  if (lo.polarity !== up.polarity && groupOf) {
    // round 5: on a polarity seam the panels (cards, View all, glass pills, + button) never interpolate: a light card
    // half-way to a dark one is the translucent grey card the critic saw. Each zone's panels take, whole, the stop whose
    // ink that zone is using, so card, ink and zone always belong together.
    const seam = mod4(s.lower);
    const cand = [tintOf(seam), tintOf((seam + 1) % 4), altTint(seam)];
    const fm = measureInk || panelForce;
    const zInk = (z) => (fm ? { lo: 0, up: 1, alt: 2 }[fm] : keyState(groupOf.indexOf(z), seam, uiE).ink);
    const top = cand[zInk(0)], bot = cand[zInk(2)];
    const t2 = { ...s.tint };
    for (const k of Object.keys(t2)) {
      if (/^(card|viewAll)/.test(k)) t2[k] = bot[k];
      else if (/^(glass|recentGlass|plus)/.test(k)) t2[k] = top[k];
    }
    s.tint = t2;
  }
  const E = uiE < 0.5 ? lo : up;
  const tint = lo.polarity !== up.polarity ? { ...s.tint } : { ...s.tint, viewAllA: E.viewAllA, viewAllB: E.viewAllB };
  const panel = mixHex(tint.viewAllA, tint.viewAllB, 0.5);
  const useUp = measureInk ? measureInk === 'up' : uiE >= 0.5;
  const inks = {}, flipped = {};
  for (const r of ['header', 'recent', 'name', 'cards', 'values', 'swipe']) { inks[r] = useUp ? up : lo; flipped[r] = false; }
  { const cp = camParam(s.pages); rollState = rollUpdate(cp.lo + (isRM() ? cp.f : cp.e), stage.frozen || measureInk != null); }
  const st = (k) => STOPS[mod4(k)];
  return { tint, inks, flipped, viewAllInk: bestInk(panel, [E.viewAllInk, '#FFFFFF', '#1E1710']),
    swipe: { lower: lo.swipe, upper: up.swipe, amount: s.amount, flip: true, useUpper: useUp },
    nameOut: { name: st(rollState.a).name, tier: tierLabel(st(rollState.a)), opacity: 1, dx: 0 },
    nameIn: { name: st(rollState.b).name, tier: tierLabel(st(rollState.b)), opacity: 1, dx: 0 } };
});

const allT = [...ui.el.querySelectorAll('p.t')];
const names = [...ui.el.querySelectorAll('p.t.name')];
const tiers = [...ui.el.querySelectorAll('.a.tier')];
const css = document.createElement('style');
css.textContent = `.lbx-ui p.t, .lbx-ui .glyph, .lbx-ui .flip, .lbx-ui .swipe img { transition: none !important; }
.lbx-ui .p3-scrim { position: absolute; pointer-events: none; opacity: 0; will-change: opacity; }
.lbx-ui.p3-noscrim .p3-scrim { display: none; }`;
document.head.appendChild(css);

function rollNames() {
  const { u, dir, anim } = rollState;
  for (const [els, sl] of [[names, SLOT.name], [tiers, SLOT.tier]]) {
    els.forEach((e, k) => {
      let dy, vis;
      if (k === 0) { dy = anim ? -dir * sstep(Math.min(1, 2 * u)) * sl.H : 0; vis = !anim || u < 0.5; }
      else { dy = anim ? dir * (1 - sstep(Math.max(0, 2 * u - 1))) * sl.H : 0; vis = anim && u > 0.5; }
      const tf = `translate3d(0,${dy.toFixed(2)}px,0)`;
      if (e._tf !== tf) { e.style.transform = tf; e._tf = tf; }
      const off = sl.top - (sl.el + dy);
      const m = `linear-gradient(180deg, transparent 0px, #000 ${sl.F}px, #000 ${sl.S - sl.F}px, transparent ${sl.S}px)`;
      if (e._m !== m) { e.style.webkitMaskImage = e.style.maskImage = m; e.style.webkitMaskSize = e.style.maskSize = `100% ${sl.S}px`; e.style.webkitMaskRepeat = e.style.maskRepeat = 'no-repeat'; e._m = m; }
      const mp = `0 ${off.toFixed(2)}px`;   // round 5 perf: write only what changed (no style recalc at rest)
      if (e._mp !== mp) { e.style.webkitMaskPosition = e.style.maskPosition = mp; e._mp = mp; }
      const vv = vis ? '' : 'hidden';
      if (e._vis !== vv) { e.style.visibility = vv; e._vis = vv; }
    });
  }
}

// ---- keys (one ink + one scrim pair per key): the two name layers share the slot key, the two tier layers too
const keyOf = allT.map((e) => (names.includes(e) ? 'name' : tiers.some((d) => d.contains(e)) ? 'tier' : null));
const KEYS_UI = [];
allT.forEach((e, i) => { const k = keyOf[i]; if (k && KEYS_UI.includes(k)) return; KEYS_UI.push(k || 'e' + i); });
const keyIdx = allT.map((e, i) => KEYS_UI.indexOf(keyOf[i] || 'e' + i));
// Round 5: the per-label chips are gone (they read as grey plates). Three soft ZONES sit UNDER the whole UI (below the
// glass, cards and pills, right above the canvas): a top grade (status, header, recent row), a soft band behind the
// name, and a bottom grade (cards, what's inside, values). Each zone is a full-bleed colour field with long feathered
// edges, so at any opacity it reads as the room's light being graded down (or hazed up), never as a plate behind a word.
// Every label in a zone shares one whole ink (the zone is the DP group), and the zone's opacity is the largest need of
// its labels at e. The solver composites the zone exactly as the browser does (it screenshots the zones at full opacity
// under the real glass), so the cards keep their own glass look on top.
const SCRIM = { dark: '#0D0A07', light: '#F3EDE3' };
const ZONES = [
  { name: 'top', x0: -8, x1: 383, y0: -8, y1: 180, fx: 0, fy0: 0, fy1: 30 },
  { name: 'name', x0: 70, x1: 305, y0: 431, y1: 493, fx: 44, fy0: 22, fy1: 18 },
  { name: 'bottom', x0: -8, x1: 383, y0: 508, y1: 694, fx: 0, fy0: 30, fy1: 26 },
];
const zoneOfRegion = (r) => (r === 'header' || r === 'recent' ? 0 : r === 'name' ? 1 : 2);
const zoneEls = ZONES.map((z) => {
  const pair = {};
  for (const pol of ['dark', 'light']) {
    const d = document.createElement('div'); d.className = 'a p3-scrim';
    const W = z.x1 - z.x0 + 2 * z.fx, H = z.y1 - z.y0 + z.fy0 + z.fy1;
    Object.assign(d.style, { left: (z.x0 - z.fx) + 'px', top: (z.y0 - z.fy0) + 'px', width: W + 'px', height: H + 'px', background: SCRIM[pol] });
    const v = `linear-gradient(180deg, transparent 0px, #000 ${z.fy0}px, #000 ${H - z.fy1}px, transparent ${H}px)`;
    const m = z.fx ? `linear-gradient(90deg, transparent 0px, #000 ${z.fx}px, #000 ${W - z.fx}px, transparent ${W}px), ${v}` : v;
    d.style.webkitMaskImage = d.style.maskImage = m;
    if (z.fx) { d.style.maskComposite = 'intersect'; d.style.webkitMaskComposite = 'source-in'; }
    pair[pol] = d;
  }
  return pair;
});
let groupOf = null;
function layoutScrims() {
  const first = ui.el.firstChild;
  zoneEls.forEach((pair) => { for (const d of Object.values(pair)) ui.el.insertBefore(d, first); });
  groupOf = KEYS_UI.map((k, j) => zoneOfRegion(allT[keyIdx.indexOf(j)].dataset.region));
}
const wiGlass = [...ui.el.querySelectorAll('.glass')].find((g) => parseFloat(g.style.top) > 580);
let scrimForce = null, panelForce = null;   // measuring: panels of one candidate ink   // measuring: 'dark' | 'light' (every zone at full opacity in that polarity)

function roleStyle(ink, role) {
  if (role === 'primary') return [ink.primary, 1];
  if (role === 'secondary') return [ink.secondary, ink.secondaryOpacity];
  if (role === 'recent') return [ink.secondary, ink.recentOpacity];
  if (role === 'tier') return [ink.secondary, ink.tierOpacity];
  if (role === 'figure') return [ink.figure, 1];
  return null;
}
const ALT = [2, 0, 0, 0];
const altTint = (seam) => tintOf(ALT[seam] === 2 ? 2 : 0);
const INF = 9;
/** Per key at e: the ink (0 lower, 1 upper, 2 opposite polarity) and its scrim opacity (conservative between samples). */
function keyState(j, seam, e) {
  const T = table();
  if (!T || !T.need) return { ink: e >= 0.5 ? 1 : 0, alpha: 0 };
  const per = T.per, q = Math.min(per, Math.max(0, e * per)), qn = Math.round(q), q0 = Math.floor(q), q1 = Math.min(per, q0 + 1);
  const ink = T.seq[seam][T.groups ? groupOf[j] : j][qn];
  const need = (qq) => { const v = T.need[seam][qq][j]; return v == null ? 0 : v[ink]; };
  let a = 0, miss = false;
  for (const qq of new Set([q0, q1, qn])) { const v = need(qq); if (v >= INF) miss = true; else a = Math.max(a, v); }
  if (miss) a += 0.12;
  return { ink, alpha: Math.min(0.92, a) };
}
// glyphs (chevrons, status icons, spark) follow the ink of the nearest label in their row
const glyphs = [...ui.el.querySelectorAll('.glyph')].filter((g) => ['primary', 'recent', 'secondary', 'primary-border', 'primary-bg'].includes(g.dataset.role));
let glyphKey = null;
function bindGlyphs() {
  const c = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
  const tr = allT.map((e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); });
  glyphKey = glyphs.map((g) => {
    const [gx, gy] = c(g.getBoundingClientRect()); let best = 0, bd = 1e9;
    tr.forEach((r, i) => { if (names.includes(allT[i]) || r.width < 1) return; const [x, y] = c(r); const d = Math.abs(x - gx) + 4 * Math.abs(y - gy); if (d < bd) { bd = d; best = i; } });
    return best;
  });
}
let lastKeyStates = [];
function applyInks(position, e) {
  if (!glyphKey) { bindGlyphs(); layoutScrims(); }
  const seam = mod4(Math.floor(position));
  const inks = [tintOf(seam), tintOf((seam + 1) % 4), altTint(seam)];
  const ks = KEYS_UI.map((k, j) => (measureInk ? { ink: { lo: 0, up: 1, alt: 2 }[measureInk], alpha: 0 } : keyState(j, seam, e)));
  lastKeyStates = ks;
  const za = ZONES.map(() => 0), zp = ZONES.map(() => 'dark');
  ks.forEach((st, j) => {
    const z = groupOf[j];
    // the name zone gets a little extra (live frames ran the 10 px tier label at 4.2-4.35 between 0.02 samples)
    const a = measureInk ? 0 : z === 1 && st.alpha > 0 ? Math.min(0.92, st.alpha * 1.1 + 0.06) : st.alpha;
    za[z] = Math.max(za[z], a);
    zp[z] = inks[st.ink].polarity === 'dark' ? 'light' : 'dark';   // a dark ink sits on a light zone and vice versa
  });
  if (inks[0].polarity !== inks[1].polarity) {
    // the What's inside pill is kit glass (one tint for all glass, which follows the top zone); it sits in the bottom
    // zone, so on a polarity seam it takes the bottom zone's stop like the cards do
    const fm = measureInk || panelForce;
    const T = inks[fm ? { lo: 0, up: 1, alt: 2 }[fm] : ks[groupOf.indexOf(2)].ink];
    const bg = `linear-gradient(180deg, ${rgba(T.glassTop, T.glassOpacity)}, ${rgba(T.glassBottom, T.glassOpacity)}), linear-gradient(180deg, ${rgba(T.glassShade, T.glassShadeOpacity)}, ${rgba(T.glassShade, 0)})`;
    wiGlass.style.background = bg; wiGlass.style.boxShadow = `inset 0 0 0 0.5px rgba(255,255,255,${T.glassStroke.toFixed(3)})`;
  }
  zoneEls.forEach((pair, z) => {
    for (const pol of ['dark', 'light']) {
      const a = scrimForce ? (pol === scrimForce ? 1 : 0) : pol === zp[z] ? za[z] : 0;
      const av = a.toFixed(3), d = pair[pol];
      if (d._a !== av) { d.style.opacity = av; d._a = av; }
    }
  });
  allT.forEach((el, i) => {
    const rs = roleStyle(inks[ks[keyIdx[i]].ink], el.dataset.role);
    if (!rs) return;
    el.style.color = rs[0];   // the kit rewrites every ink each frame, so these are written unconditionally after it
    el.style.opacity = rs[1].toFixed(3);
  });
  glyphs.forEach((g, n) => {
    const i = glyphKey[n], ink = inks[ks[keyIdx[i]].ink], col = ink.primary;
    const role = g.dataset.role, v = role === 'primary' || role === 'primary-border' || role === 'primary-bg' ? col : ink.secondary;
    if (role === 'primary-border') g.style.borderColor = v;
    else if (role === 'primary-bg') g.style.background = v;
    else g.style.color = v;
  });
}

// ---------------------------------------------------------------- text rects (kit semantics, slot-clipped names)
const slotOf = (e) => (names.includes(e) ? SLOT.name : tiers.some((d) => d.contains(e)) ? SLOT.tier : null);
function rects() {
  const out = [];
  if (ui.el.classList.contains('hide-all')) return out;
  const root = stage.el.getBoundingClientRect(), U = ui.el.getBoundingClientRect(), k = U.width / 375;
  const occ = [...ui.el.querySelectorAll('.occluder')].map((o) => ({ o, r: o.getBoundingClientRect() }));
  allT.forEach((e, i) => {
    const r = e.getBoundingClientRect();
    if (!e.textContent.trim() || r.width < 1 || r.height < 1) return;
    let op = 1, v = e, hidden = false;
    while (v && v !== stage.el) { const cs = getComputedStyle(v); if (cs.visibility === 'hidden' || cs.display === 'none') hidden = true; op *= +cs.opacity; v = v.parentElement; }
    if (hidden || op < 0.05) return;
    let x0 = Math.max(r.left, root.left), y0 = Math.max(r.top, root.top), x1 = Math.min(r.right, root.right), y1 = Math.min(r.bottom, root.bottom);
    const sl = slotOf(e);
    if (sl) { y0 = Math.max(y0, U.top + (sl.top + sl.F) * k); y1 = Math.min(y1, U.top + (sl.top + sl.S - sl.F) * k); }
    for (const { o, r: q } of occ) {
      if (o.contains(e) || q.bottom <= y0 || q.top >= y1 || q.right <= x0 || q.left >= x1) continue;
      if (e.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING) { if (q.left > x0) x1 = Math.min(x1, q.left); else x0 = Math.max(x0, q.right); }
    }
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    const cs = getComputedStyle(e);
    const fontSize = parseFloat(cs.fontSize) * k, fontWeight = +cs.fontWeight || 400;
    const range = document.createRange(); range.selectNodeContents(e); const tr = range.getBoundingClientRect();
    const gx0 = Math.max(tr.left, x0), gx1 = Math.min(tr.right, x1);
    if (gx1 - gx0 < 1) return;
    out.push({ i, key: keyIdx[i], text: e.textContent, role: e.dataset.role, region: e.dataset.region, x: gx0, y: y0, w: gx1 - gx0, h: y1 - y0,
      color: cs.color, opacity: +op.toFixed(3), fontSize: +fontSize.toFixed(2), designFontSize: parseFloat(cs.fontSize), fontWeight,
      large: parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && fontWeight >= 700) });
  });
  return out;
}
stage.proto.textRects = () => rects().map(({ i, key, ...t }) => t);

// ---------------------------------------------------------------- renderer + assets
const renderer = new THREE.WebGLRenderer({ canvas: stage.canvas, antialias: false, alpha: true, premultipliedAlpha: true });
renderer.setClearColor(0, 0);
const scene = new THREE.Scene();
let tone = null, camera = null;
const camBase = new THREE.Vector3();
const rtA = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false }), rtB = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
const rtRefl = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
let bayList = [];
stage.onResize((w, h, dpr) => {
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (tone) tone.setSize(s.x, s.y);
  rtA.setSize(s.x, s.y); rtB.setSize(s.x, s.y);
  rtRefl.setSize(Math.max(1, Math.round(s.x / 4)), Math.max(1, Math.round(s.y / 4)));
  for (const b of bayList) b.m.uniforms.uRes.value.set(s.x, s.y);
});

const [layout, meta, spots, boxtexBC, boxtexASTC] = await Promise.all(['layout.json', 'bake.json', 'spot.json', 'boxtex.json', 'boxtex-astc.json'].map((f) => fetch(ASSET + f).then((r) => (r.ok ? r.json() : null))));
const P = layout.pitch;
const texLoader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const loadTex = (f, repeat = false) => texLoader.loadAsync(ASSET + f).then((t) => {
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = Math.min(8, maxAniso); t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (!repeat && params.get('lmmip') === '0') { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
});
const [studio, ...texs] = await Promise.all([
  loadStudioBoxes(renderer, STOPS, { aspect: stage.width / stage.height }),
  loadTex('bay0.jpg'), loadTex('bay1.jpg'), loadTex('bay2.jpg'), loadTex('bay3.jpg'), loadTex('bay2-caustic.jpg'), loadTex('caustic.png', true),
  loadTex('stone-detail.jpg', true), loadTex('contact.png'),
]);
texs[7].wrapS = texs[7].wrapT = THREE.ClampToEdgeWrapping;
const boxes = studio.boxes; tone = studio.tone; camera = studio.camera;

// ---------------------------------------------------------------- box textures: GPU-compressed (round 3 phone path)
// BC1 with mips (bake/boxtex.py) where the GPU has S3TC (+sRGB): ~21 MB for all four boxes instead of ~121 MB RGBA8.
// Without S3TC (Safari on iPhone) colour is resampled to 1024 and ORM to 512 as in round 2 (the app would use ASTC).
// Round 4: ASTC 5x5 first (iPhone Safari, Apple GPUs, Android; bake/boxtex_astc.py, verified on SwiftShader's decoder:
// PSNR at or above BC1 on every texture), then BC1 (desktop GPUs), else the resampled RGBA8 fallback.
const astcOK = renderer.extensions.has('WEBGL_compressed_texture_astc');
const s3tc = renderer.extensions.has('WEBGL_compressed_texture_s3tc') && renderer.extensions.has('WEBGL_compressed_texture_s3tc_srgb');
const want = params.get('boxtex');
const useAstc = boxtexASTC && astcOK && (!want || want === 'astc');
const useBC = !useAstc && boxtexBC && s3tc && (!want || want === 'bc1');
let boxTexMode = 'rgba-resampled';
if (useAstc || useBC) {
  const boxtex = useAstc ? boxtexASTC : boxtexBC;
  const FMT = useAstc ? THREE.RGBA_ASTC_5x5_Format : THREE.RGB_S3TC_DXT1_Format;
  const cache = new Map();
  const getC = async (ent) => {
    if (cache.has(ent.file)) return cache.get(ent.file);
    const p = fetch(ASSET + ent.file).then((r) => r.arrayBuffer()).then((buf) => {
      const mips = ent.levels.map((l) => ({ data: new Uint8Array(buf, l.offset, l.bytes), width: l.size, height: l.size }));
      const t = new THREE.CompressedTexture(mips, ent.size, ent.size, FMT);
      t.colorSpace = ent.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      t.anisotropy = Math.min(8, maxAniso); t.flipY = false; t.needsUpdate = true;
      return t;
    });
    cache.set(ent.file, p); return p;
  };
  const jobs = [];
  for (const s of STOPS) boxes[s.key].object.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const m = o.material, base = `${s.key}/${m.name}/`;
    const swap = (slot, keys) => { const ent = boxtex[base + slot]; if (!ent) return; jobs.push(getC(ent).then((t) => { for (const k of keys) if (m[k]) { const old = m[k]; t.channel = old.channel; t.offset.copy(old.offset); t.repeat.copy(old.repeat); t.rotation = old.rotation; t.wrapS = old.wrapS; t.wrapT = old.wrapT; m[k] = t; } m.needsUpdate = true; })); };
    swap('map', ['map']); swap('normalMap', ['normalMap']); swap('orm', ['roughnessMap', 'metalnessMap', 'aoMap']);
  });
  await Promise.all(jobs);
  boxTexMode = useAstc ? 'astc-5x5' : 'bc1';
} else if (params.get('boxtex') !== 'full') {
  const lim = { map: 1024, metalnessMap: 512, roughnessMap: 512, aoMap: 512 };
  const done = new Map();
  for (const s of STOPS) boxes[s.key].object.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const k in lim) {
      const t = o.material[k]; if (!t || !t.image || done.has(t)) continue;
      const im = t.image, n = lim[k]; done.set(t, 1);
      if (im.width <= n) continue;
      const c = document.createElement('canvas'); c.width = c.height = n;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, n, n);
      t.image = c; t.needsUpdate = true;
    }
  });
}
camBase.copy(camera.position);
{ const s = renderer.getDrawingBufferSize(new THREE.Vector2()); tone.setSize(s.x, s.y); }

// ---------------------------------------------------------------- bays: baked lightmap atlases drawn unlit
const b2t = (p) => [p[0], p[2], -p[1]];   // Blender (x, y, z) -> three (x, z, -y)
const mirror = (g) => (g.endsWith('R') ? g.slice(0, -1) + 'L' : g.endsWith('L') ? g.slice(0, -1) + 'R' : g);
const uvOf = (p, r) => { const [a, b] = r.axes, d = r.dens || layout.density; return [(r.x + (p[a] - r.mins[0]) * d) / layout.atlas, (r.y + (p[b] - r.mins[1]) * d) / layout.atlas]; };
const blendW = (q) => (q.name === 'floorA' ? AISLE_W : q.name === 'floorT' || /^(pier|soffit|jamb)/.test(q.group) ? layout.t2 : 0);
// round 3: each room's light pool on the aisle meets the next one in a short soft edge right under the pier line (was 1.6
// wide: a broad mid-grey zone that no ink could read on)
const AISLE_W = params.has('aisle') ? +params.get('aisle') : 0.35;
const fabOf = (q) => (q.group.startsWith('pier') ? 1 : q.group.startsWith('jamb') ? 2 : q.group.startsWith('soffit') ? 3 : q.group === 'floor' && q.name === 'floor' ? 4 : 0);
function bayGeometry() {
  const pos = [], uv = [], uvR = [], uvL = [], bw = [], fab = [], idx = [];
  for (const q of layout.quads) {
    const base = pos.length / 3, W = blendW(q), rm = layout.rects[mirror(q.group)], F = fabOf(q);
    q.p.forEach((p) => {
      pos.push(...b2t(p)); bw.push(W); fab.push(F);
      uvR.push(...uvOf([p[0], -layout.half, p[2]], rm)); uvL.push(...uvOf([p[0], layout.half, p[2]], rm));
    });
    q.uv.forEach((u) => uv.push(u[0], u[1]));
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uvR', new THREE.Float32BufferAttribute(uvR, 2));
  g.setAttribute('uvL', new THREE.Float32BufferAttribute(uvL, 2));
  g.setAttribute('bw', new THREE.Float32BufferAttribute(bw, 1));
  g.setAttribute('fab', new THREE.Float32BufferAttribute(fab, 1));
  g.setIndex(idx);
  return g;
}
const geo = bayGeometry();
const C = meta.contact || { cx: 0, cy: 0, size: 4 };
const VERT = /* glsl */`
  attribute vec2 uvR; attribute vec2 uvL; attribute float bw; attribute float fab;
  varying vec2 vUv; varying vec2 vUvR; varying vec2 vUvL; varying float vBw; varying float vFab; varying vec3 vWorld; varying vec3 vLocal;
  void main() { vUv = uv; vUvR = uvR; vUvL = uvL; vBw = bw; vFab = fab; vLocal = position; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tLM; uniform float uLmax; uniform float uG;
  uniform sampler2D tCL; uniform sampler2D tPat; uniform float uCmax; uniform float uCaustic; uniform float uTime;
  uniform vec3 uSL; uniform vec3 uSF; uniform vec3 uSU; uniform vec3 uSV;
  uniform float uXP; uniform float uWI; uniform float uH; uniform float uZB;
  uniform sampler2D tNR; uniform sampler2D tNL; uniform float uLmaxR; uniform float uLmaxL;
  uniform sampler2D tDet; uniform sampler2D tCon; uniform vec3 uCon; uniform float uConK;
  uniform float uExpo; uniform float uExpoR; uniform float uExpoL; uniform float uVig; uniform vec2 uRes; uniform sampler2D tRefl; uniform float uReflK; uniform vec2 uBoxE;
  varying vec2 vUv; varying vec2 vUvR; varying vec2 vUvL; varying float vBw; varying float vFab; varying vec3 vWorld; varying vec3 vLocal;
  void main() {
    vec3 c = uLmax * pow(texture2D(tLM, vUv).rgb, vec3(uG));
    float expo = uExpo;
    if (vBw > 0.0) {
      // seam blend: the shared fabric fades toward the neighbour's light at the pier centreline (50/50 on it)
      float Y = -vLocal.z;
      float w = 0.5 * (1.0 - smoothstep(0.0, vBw, uH - abs(Y)));
      vec3 nb = Y > 0.0 ? uLmaxR * pow(texture2D(tNR, vUvR).rgb, vec3(uG)) : uLmaxL * pow(texture2D(tNL, vUvL).rgb, vec3(uG));
      c = mix(c, nb, w);
      expo = mix(uExpo, Y > 0.0 ? uExpoR : uExpoL, w);   // the grade blends across the seam with the light
    }
    if (vFab > 0.5 && vFab < 3.5) {
      // pier stone: lightmap x full-resolution travertine detail (gallery coordinates, so it runs on across the seam)
      vec2 dq = vFab < 2.5 ? vec2(vWorld.z, vWorld.y) : vec2(vWorld.x, vWorld.z);
      c *= texture2D(tDet, dq / 1.2).rgb * 2.0;
      // the pier front is dark stone (baked); its plinth and the doorway reveals are the pale honed stone of the aisle
      // (the bake carries the dark stone's light, so the pale stone is that light x the albedo ratio: 3.7 for the reveals,
      // 6 for the honed plinth, which is the lightest stone so a dark name can sit over it in the light rooms)
      float plinth = vFab < 1.5 ? 1.0 - step(uZB + 0.82, vLocal.y) : 1.0;
      c *= mix(1.0, vFab < 1.5 ? 6.0 : 3.7, plinth);
      if (vFab < 1.5) c *= 1.0 - 0.45 * (1.0 - smoothstep(0.004, 0.012, abs(vLocal.y - uZB - 0.82)));   // plinth joint
      if (vFab < 1.5) {
        // a crisp honed arris where the pier front turns into the doorway wall: a 1-2 px highlight, then a hairline shade
        float d = abs(abs(vLocal.z) - uWI);
        c *= 1.0 + 0.55 * (1.0 - smoothstep(0.004, 0.011, d)) - 0.18 * (smoothstep(0.011, 0.016, d) * (1.0 - smoothstep(0.016, 0.03, d)));
      }
    }
    if (vFab > 3.5) {
      // contact: baked AO of the box on the floor at full density (tight contact line + soft occlusion band)
      vec2 cu = vec2((vLocal.x - uCon.x) / uCon.z + 0.5, (-vLocal.z - uCon.y) / uCon.z + 0.5);
      if (cu.x > 0.0 && cu.x < 1.0 && cu.y > 0.0 && cu.y < 1.0) {
        float ao = texture2D(tCon, vec2(cu.x, 1.0 - cu.y)).r;
        c *= mix(1.0, ao * ao, uConK);
      }
    }
    if (uCaustic > 0.0) {
      // pool caustics: the baked caustic light (flat, with the box's shadow) times a moving cell network projected
      // from the spot along its own rays; aqua-white light on the teal room
      vec3 d = normalize(vWorld - uSL);
      vec2 q = vec2(dot(d, uSU), dot(d, uSV)) / max(0.05, dot(d, uSF));
      float a = texture2D(tPat, q * 2.3 + vec2(0.013, 0.007) * uTime).r;
      float b = texture2D(tPat, q * 2.3 * vec2(-1.0, 1.0) * 1.27 + vec2(-0.009, 0.011) * uTime + 0.37).r;
      float pat = min(a, b) * 2.6 + max(a, b) * 0.35;
      vec3 light = uCmax * pow(texture2D(tCL, vUv).rgb, vec3(uG));
      vec3 tint = mix(vec3(0.55, 0.92, 0.95), vec3(0.92, 1.0, 1.0), clamp(pat * 0.8, 0.0, 1.0));
      float calm = max(smoothstep(0.8, 3.2, vWorld.x) * step(vWorld.y, -0.4), smoothstep(1.1, 2.0, vWorld.y));
      c = max(vec3(0.0), c + light * (mix(pat * tint * uCaustic, vec3(0.4), calm) - 1.0));
    }
    // a brass threshold where each room's own floor meets the shared aisle
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 brass = vec3(1.0, 0.74, 0.42);
    float onFloor = 1.0 - step(0.01, abs(vLocal.y - uZB));
    float inlay = onFloor * step(abs(vLocal.z), uWI) * (1.0 - smoothstep(0.012, 0.02, abs(vLocal.x - uXP)));
    c = mix(c, brass * (lum * 1.35 + 0.003), inlay);
    vec2 sv = gl_FragCoord.xy / uRes;
    if (uReflK > 0.0 && onFloor > 0.5) {
      // round 5: the dark home reflection. The boxes are drawn mirrored in the floor plane into a quarter-resolution
      // target with this frame's camera; the floor samples it in screen space through a 13-tap blur and takes it as a
      // dark, soft mirror (floor x 0.3 + the box's own light x 0.4), fading with distance from the box footprint.
      vec2 px = 1.0 / uRes;
      vec4 r = texture2D(tRefl, sv) * 0.2;
      for (int k = 0; k < 6; k++) {
        float a = float(k) * 1.0472 + 0.3;
        vec2 o = vec2(cos(a), sin(a));
        r += texture2D(tRefl, sv + o * px * 7.0) * 0.08 + texture2D(tRefl, sv + o.yx * vec2(1.0, -1.0) * px * 15.0) * 0.053;
      }
      float d = length(max(abs(vec2(vLocal.x, vLocal.z)) - uBoxE, 0.0));
      float k = clamp(r.a, 0.0, 1.0) * uReflK * exp(-d * 1.4);
      c = mix(c, c * 0.3 + r.rgb * 0.4, k);
    }
    // round 5: the contract mood: the room is graded down (exposure) and falls off toward the edges, so the box, which
    // is not graded, is the brightest thing in frame
    c *= expo * (1.0 - uVig * smoothstep(0.32, 0.9, length((sv - vec2(0.5, 0.56)) * vec2(1.15, 0.85))));
    gl_FragColor = vec4(c, 1.0);
  }`;
const bays = [0, 1, 2, 3].map((i) => {
  const sp = spots[2] || spots['2'];
  const local = (p) => [p[0], p[1] - 2 * P, p[2]]; // spot.json is in gallery coords (bay 2 at Y = 2P)
  const L = new THREE.Vector3(...b2t(local(sp.loc))), T = new THREE.Vector3(...b2t(local(sp.target)));
  const F = T.clone().sub(L).normalize(), U = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
  const V = new THREE.Vector3().crossVectors(U, F);
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    uniforms: {
      tLM: { value: texs[i] }, uLmax: { value: meta.bays['bay' + i].lmax }, uG: { value: meta.gamma },
      tCL: { value: texs[4] }, tPat: { value: texs[5] }, uCmax: { value: meta.bays['bay2-caustic'].lmax },
      uCaustic: { value: i === 2 ? +(params.get('caustic') || 2.2) : 0 }, uTime: { value: 0 },
      uSL: { value: L }, uSF: { value: F }, uSU: { value: U }, uSV: { value: V },
      uXP: { value: layout.xp }, uWI: { value: layout.half - layout.t2 }, uH: { value: layout.half }, uZB: { value: layout.zb },
      tNR: { value: texs[(i + 1) % 4] }, tNL: { value: texs[(i + 3) % 4] },
      uLmaxR: { value: meta.bays['bay' + ((i + 1) % 4)].lmax }, uLmaxL: { value: meta.bays['bay' + ((i + 3) % 4)].lmax },
      tDet: { value: texs[6] }, tCon: { value: texs[7] }, uCon: { value: new THREE.Vector3(C.cx, C.cy, C.size) },
      uConK: { value: meta.contact ? +(params.get('contact') || 0.85) : 0 },
      uExpo: { value: EXPO[i] }, uExpoR: { value: EXPO[(i + 1) % 4] }, uExpoL: { value: EXPO[(i + 3) % 4] }, uVig: { value: VIG }, uRes: { value: new THREE.Vector2(1, 1) },
      tRefl: { value: rtRefl.texture }, uReflK: { value: REFL }, uBoxE: { value: new THREE.Vector2(1, 1) },
    },
  });
  // round 4: culled per bay (bounding sphere of the bay geometry), so only the bays in view are drawn
  const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = true;
  scene.add(mesh);
  return { mesh, m, L0: L.clone(), tex: texs[i] };
});

// ---------------------------------------------------------------- the box takes its room's light
const KEYS = [
  { from: [6.0, 9.0, 9.0], col: '#FFD5A0', I: 1500, ang: 10, pen: 0.45, aim: 1.9, env: 0.92 },  // Ivory: window sun, high right
  { from: [-7.0, 1.6, 4.2], col: '#C9DAFF', I: 750, ang: 10, env: 1.0 },   // Reeded: cool backlight from the glass wall
  { from: [9.0, 0.6, 0.25], col: '#BDF2EC', I: 480, ang: 10, env: 0.88 },  // Riviera: aqua pool light from below the front
  { from: [7.0, -10.0, 1.5], col: '#E9B8F2', I: 1050, ang: 10, pen: 0.45, aim: -1.7, env: 0.9 },  // Desert: low rose dawn from the left
];
const keyGroups = STOPS.map((s, i) => {
  const k = KEYS[i], g = new THREE.Group();
  const dir = new THREE.Vector3(...b2t(k.from)).normalize();
  const L = new THREE.SpotLight(new THREE.Color(k.col), k.I * KEYK, 0, THREE.MathUtils.degToRad(k.ang), k.pen ?? 0.7, 2);
  L.position.copy(dir.multiplyScalar(14));
  L.target.position.set(-0.2, 0.0, -(k.aim || 0));
  g.add(L, L.target);
  scene.add(g);
  boxes[s.key].object.traverse((o) => { if (o.isMesh && o.material) o.material.envMapIntensity *= k.env; });
  return g;
});
STOPS.forEach((s) => scene.add(boxes[s.key].object));
bayList = bays;
{ const s = renderer.getDrawingBufferSize(new THREE.Vector2()); bays.forEach((b) => b.m.uniforms.uRes.value.set(s.x, s.y)); }
// round 5: box footprint (bay-local half extents on the floor) for the reflection fade
{ const bb = new THREE.Box3().setFromObject(boxes[STOPS[0].key].object); const e = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  bays.forEach((b) => b.m.uniforms.uBoxE.value.set(e.x, e.z)); }
const FLOOR_Y = layout.zb;
// the mirrored boxes, drawn into the quarter-resolution reflection target with the given camera (bays hidden)
function renderRefl(cam, position) {
  if (REFL <= 0) return;
  const near = mod4(Math.round(position));
  bays.forEach((b) => { b.mesh.visible = false; });
  STOPS.forEach((s, i) => { const o = boxes[s.key].object; o.visible = i === near || i === mod4(Math.floor(position)) || i === mod4(Math.ceil(position)); o.scale.y = -o.scale.y; o.position.y = 2 * FLOOR_Y; });
  renderer.setRenderTarget(rtRefl); renderer.clear(); renderer.render(scene, cam);
  STOPS.forEach((s) => { const o = boxes[s.key].object; o.visible = true; o.scale.y = -o.scale.y; o.position.y = 0; });
  bays.forEach((b) => { b.mesh.visible = true; });
  renderer.setRenderTarget(null);
}

// place every bay (and its box and key) at the loop copy nearest to the camera, so 3 -> 0 continues the row
function place(position) {
  STOPS.forEach((s, i) => {
    const k = i + Math.round((position - i) / 4) * 4;
    const z = -k * P;
    bays[i].mesh.position.z = z;
    keyGroups[i].position.z = z;
    boxes[s.key].object.position.set(0, 0, z);
    if (i === 2) bays[i].m.uniforms.uSL.value.copy(bays[i].L0).add(new THREE.Vector3(0, 0, z));
  });
}

// ---------------------------------------------------------------- residency: everything resident, compiled at load
// Round 3: no uploads or compiles after load (they caused the round-2 long frames). All four bays and all four boxes
// stay on the GPU (BC1 boxes make that affordable), every texture is uploaded and every program compiled here.
const allTex = new Set(texs);
STOPS.forEach((s) => boxes[s.key].object.traverse((o) => { if (!o.isMesh) return; for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'sheenColorMap', 'sheenRoughnessMap']) if (o.material[k]) allTex.add(o.material[k]); }));
const texBytes = (t) => {
  if (t.isCompressedTexture) return t.mipmaps.reduce((a, m) => a + m.data.byteLength, 0);
  const im = t.image; return im ? im.width * im.height * 4 * 4 / 3 : 0;
};
function gpuMemory() {
  let env = 0, box = 0;
  for (const t of allTex) { if (texs.includes(t)) env += texBytes(t); else box += texBytes(t); }
  return { environmentMB: +(env / 1048576).toFixed(1), boxesMB: +(box / 1048576).toFixed(1), totalMB: +((env + box) / 1048576).toFixed(1), boxTextures: boxTexMode, resident: 'all four bays and all four boxes' };
}

// ---------------------------------------------------------------- frame
const mixMat = new THREE.ShaderMaterial({
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tA; uniform sampler2D tB; uniform float uW; varying vec2 vUv; void main() { gl_FragColor = mix(texture2D(tA, vUv), texture2D(tB, vUv), uW); }',
  uniforms: { tA: { value: rtA.texture }, tB: { value: rtB.texture }, uW: { value: 0 } }, depthTest: false, depthWrite: false,
});
const mixScene = new THREE.Scene(); mixScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mixMat));
const mixCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const camA = camera.clone(), camB = camera.clone();
stage.onResize(() => { camA.copy(camera); camB.copy(camera); });
const v3 = new THREE.Vector3();
let causticTime = 0;
const camAtE = (cam, lo, e, pull) => {
  const s = Math.sin(Math.PI * e);
  cam.position.copy(camBase).add(v3.set(pull * s * s, 0, -(lo + e) * P)); cam.updateMatrixWorld();
};

{ // warm-up: upload every texture and compile every program with everything visible (normal and reduced-motion paths)
  for (const t of allTex) renderer.initTexture(t);
  place(0.5); camAtE(camera, 0, 0.5, PULL);
  renderer.compile(scene, camera); renderer.compile(mixScene, mixCam);
  for (const p of [0, 1, 2, 3]) { place(p); camAtE(camera, p, 0, 0); tone.render(scene, camera); }
  tone.begin(); renderer.render(scene, camA); tone.finish(rtA); renderer.setRenderTarget(null); renderer.render(mixScene, mixCam);
}

let lastE = 0;
stage.onFrame(({ position, dt, reducedMotion: rm, blend, moving, frozen }) => {
  // reduced motion: the cross-fade settles a little faster than the truck (critic r4: 724 ms was too slow)
  // round 5: RM settles faster (there is no travel, only the cross-fade): ~330 ms
  const om = rm ? 24 : 18; if (stage.motion.config.omega !== om) { try { stage.motion.config.omega = om; } catch (e) { /* frozen */ } }
  if (!rm) causticTime += dt;
  bays[2].m.uniforms.uTime.value = causticTime;
  const cp = camParam(position);
  uiE = rm ? cp.f : cp.e; lastE = uiE;
  applyInks(position, uiE);
  rollNames();

  if (tapPulse > 0) tapPulse = Math.max(0, tapPulse - dt / 0.42);
  STOPS.forEach((s, i) => { const on = i === mod4(Math.round(position)); const k = on && tapPulse > 0 ? 1 + 0.012 * Math.sin(Math.PI * (1 - tapPulse)) : 1; boxes[s.key].object.scale.setScalar(k); });

  const t = cp.f;
  if (!rm || t < 1e-4 || t > 1 - 1e-4) {
    camAtE(camera, cp.lo, rm ? Math.round(t) : cp.e, rm ? 0 : PULL);
    place(position);
    renderRefl(camera, position);
    tone.render(scene, camera);
  } else {
    // reduced motion: no camera travel at all. The two rest views (whose boxes stand on exactly the same pixels) are
    // cross-faded, so the box stays one object whose finish changes in place while its room changes around it.
    place(cp.lo + 0.5);
    camAtE(camA, cp.lo, 0, 0); camAtE(camB, cp.lo + 1, 0, 0);
    renderRefl(camA, cp.lo); tone.begin(); renderer.render(scene, camA); tone.finish(rtA);
    renderRefl(camB, cp.lo + 1); tone.begin(); renderer.render(scene, camB); tone.finish(rtB);
    mixMat.uniforms.uW.value = sstep(t);
    renderer.setRenderTarget(null); renderer.render(mixScene, mixCam);
  }
});

// screen-space checks for the round-3 tests: how much of a box is on screen, and how wide the pier is, at a position
function frameStats(position) {
  const cp = camParam(position), cam = camera.clone();
  camAtE(cam, cp.lo, cp.e, PULL); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const boxFrac = (k) => {
    const b = new THREE.Box3().setFromObject(boxes[STOPS[mod4(k)].key].object);
    const z0 = -k * P;   // the box of stop k at its own bay
    const xs = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const v = new THREE.Vector3(x, y, z - b.getCenter(new THREE.Vector3()).z + z0).project(cam); xs.push(v.x);
    }
    const a = Math.min(...xs), c = Math.max(...xs);
    return +(Math.max(0, Math.min(1, c) - Math.max(-1, a)) / (c - a)).toFixed(3);
  };
  const seamZ = -(cp.lo + 0.5) * P, wi = layout.half - layout.t2;
  const pa = new THREE.Vector3(layout.xp, 1.0, seamZ + wi * 0 - (layout.half - wi)).project(cam).x; // not used directly
  const p0 = new THREE.Vector3(layout.xp, 0.5, seamZ - layout.t2).project(cam).x, p1 = new THREE.Vector3(layout.xp, 0.5, seamZ + layout.t2).project(cam).x;
  const pl = Math.max(-1, Math.min(p0, p1)), pr = Math.min(1, Math.max(p0, p1));
  return { e: +cp.e.toFixed(3), lead: cp.L, lowerBoxOnScreen: boxFrac(cp.lo), upperBoxOnScreen: boxFrac(cp.lo + 1), pierWidthOfScreen: +(Math.max(0, pr - pl) / 2).toFixed(3), pierCentreX: +(((p0 + p1) / 2 + 1) / 2).toFixed(3), _pa: pa };
}

stage.setInfo({
  boxSources: Object.fromEntries(STOPS.map((s) => [s.key, boxes[s.key].source])),
  bays: 'four baked lightmap atlases ' + meta.size + 'px (JPEG, gamma ' + meta.gamma + '; pier and reveals at 2.5x density), caustic light ' + meta.bays['bay2-caustic'].size + ', caustic pattern ' + meta.caustic.size + ', stone detail 512, contact AO 512',
  reducedMotionNote: 'no camera travel: the two rest views cross-fade (smoothstep) with the box on the same pixels in both, so it changes finish in place; omega 24 settle (faster than the truck: nothing travels); caustics frozen',
  gain: GAIN, pull: PULL, lead: LEAD, uiTable: !!uiTab, uiTableRM: !!uiTabRM,
  get gpu() { return gpuMemory(); },
});
// measuring hooks for bake/measure-ui.mjs
window.__p3 = {
  camera, boxes, bays, scene, THREE, gpuMemory, frameStats, camParam,
  elements: () => allT.map((e, i) => ({ i, key: keyIdx[i], text: e.textContent, region: e.dataset.region, role: e.dataset.role })),
  keys: () => KEYS_UI.slice(),
  groups: () => groupOf.slice(),
  // live-contrast hook (captures/r4/live.mjs): every frame writes its frame number into a 16-bit marker strip (bottom
  // left, outside the UI) and logs its text rects with the real inks, so a screencast frame maps to the exact state.
  live(on) {
    if (!on) { window.__liveOn = false; return; }
    window.__liveLog = {}; window.__liveOn = true;
    let m = document.getElementById('p3-live');
    if (!m) {
      m = document.createElement('div'); m.id = 'p3-live';
      m.style.cssText = 'position:fixed;left:0;bottom:0;width:128px;height:8px;z-index:99;display:flex;pointer-events:none';
      for (let i = 0; i < 16; i++) { const d = document.createElement('div'); d.style.cssText = 'width:8px;height:8px'; m.appendChild(d); }
      document.body.appendChild(m);
    }
    if (!window.__liveHooked) {
      window.__liveHooked = true; let n = 0;
      stage.onFrame(({ position }) => {
        if (!window.__liveOn) return;
        n = (n + 1) & 0xffff;
        [...m.children].forEach((d, i) => { d.style.background = (n >> i) & 1 ? '#fff' : '#000'; });
        const ht = ui.el.classList.contains('hide-text'); if (ht) ui.el.classList.remove('hide-text');
        const r = rects(); if (ht) ui.el.classList.add('hide-text');
        window.__liveLog[n] = { p: +position.toFixed(4), e: +lastE.toFixed(4),
          names: r.filter((t) => t.region === 'name' && t.role === 'primary').map((t) => t.text),
          r: r.map(({ i, key, text, x, y, w, h, color, opacity, large }) => ({ i, key, text, x, y, w, h, color, opacity, large })) };
      });
    }
  },
  scrims(on) { ui.el.classList.toggle('p3-noscrim', !on); },
  scrimAll(pol) { scrimForce = pol; ui.el.classList.remove('p3-noscrim'); applyInks(stage.position, lastE); },
  inkPols: (seam) => [tintOf(seam), tintOf((seam + 1) % 4), altTint(seam)].map((t) => (t.polarity === 'dark' ? 'light' : 'dark')),
  zones: () => ZONES.map((z) => z.name),
  forcePanels(m) { panelForce = m; ui.setPosition(stage.position); applyInks(stage.position, lastE); },
  keyStates: () => lastKeyStates,
  setLead(v) { forceLead = v; },
  rectsForced(mode) {
    ui.el.classList.add('p3-notrans');
    measureInk = mode; ui.setPosition(stage.position); applyInks(stage.position, lastE);
    const r = rects(); measureInk = null; ui.setPosition(stage.position); applyInks(stage.position, lastE);
    void ui.el.offsetWidth; ui.el.classList.remove('p3-notrans');
    return r;
  },
};
stage.start();
let n = 0; stage.onFrame(() => { if (++n === 3) stage.markReady(); });
