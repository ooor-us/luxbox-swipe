// LuxBox home UI overlay in HTML/CSS over the WebGL canvas.
// Layout measured from Dima's template "Noble velvet — 3D studio" (Figma 1270:1519) and the round-13 hero
// screens (13.2 1278:1164, 13.3 1278:2739, 13.4 1278:4314, 13.7 1278:9039); design units are 375 x 812 pt.
// Watch thumbnails, the avatar crystal and the static "Swipe to open" control are exports from those screens
// (shared/ui/img); icons are the template's SVGs (shared/ui/icons), recoloured with CSS masks.
//
// createUI(root, { stops, tints, scale }) -> ui
//   ui.setPosition(pages)            interpolate tint + swap name/tier for a carousel position (loops over stops)
//   ui.setTints(arrayOrFn)           per-stop tint objects (stops.js TINTS shape) or fn(stopIndex) -> tint
//   ui.setBackgroundLuminance(fn)    fn(region, pages) -> relative luminance 0..1 behind that region, or null
//                                    to use the tints' bgLum. Regions: header, recent, name, cards, values, swipe.
//   ui.setOverride(fn)               fn(state) -> partial state, applied last each frame (per-state overrides)
//   ui.hide(mode)                    false | true (all UI) | 'text' (glyphs only, keeps glass/cards: contrast checks)
//   ui.textRects()                   visible UI texts: { text, role, region, x, y, w, h, color, opacity, fontSize,
//                                    fontWeight, large } in page CSS px
//   ui.setScale(s)                   CSS scale of the 375 pt layout (stage width / 375)
//   ui.el                            root element
//
// AA guarantee mid-transition: if the two stops share a polarity, inks interpolate. If polarity flips
// (Reeded -> Riviera, Desert -> Ivory), each region takes whole-ink from the stop whose ink has the higher WCAG
// contrast against the interpolated background luminance of that region, with a 140 ms local colour
// crossfade when it flips. Text is never shown in an interpolated mid-grey. Prototypes with other
// backdrops pass measured luminance with setBackgroundLuminance and can override any state field.

import { STOPS, TINTS, tierLabel } from './stops.js';
import { smoothstep, mod } from './motion.js';

const BASE = new URL('../ui/', import.meta.url).href;

// ---- colour helpers -----------------------------------------------------------------------------
export function hexToRgb(h) {
  const s = h.replace('#', '');
  const v = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const toHex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
export const mixHex = (a, b, t) => { const A = hexToRgb(a), B = hexToRgb(b); return toHex(A.map((x, i) => x + (B[i] - x) * t)); };
export const rgba = (h, a) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${+a.toFixed(4)})`; };
export function luminance(rgb) {
  const f = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
export const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

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

// ---- data (template content) ------------------------------------------------------------------------
const RECENT = [
  { x: -6, img: 'watch-chrono.png', t: '20m ago', p: '$917' },
  { x: 99, img: 'watch-lacoste.png', t: '18m ago', p: '$68' },
  { x: 203, img: 'watch-swatch.png', t: '15m ago', p: '$1,250' },
  { x: 311, img: 'watch-nautilus.png', t: '12m ago', p: '$1,580' },
];
const CARDS = [
  { x: -80, img: 'watch-seiko.png', n: 'Richard Mille RM 67-02', p: '$982' },
  { x: 53, img: 'watch-seiko.png', n: 'Richard Mille RM 67-02', p: '$982' },
  { x: 186, img: 'watch-pink.png', n: 'Omega Speedmaster t...', p: '$1,350' },
  { x: 319, img: 'watch-pink.png', n: 'Omega Speedmaster...', p: '$1,350' },
];
const GIFT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M3 7.2h14V10H3zM3.8 11.2h12.4V17H3.8z"/><path d="M9.8 7.2 6 4.2v3zM10.2 7.2 14 4.2v3z"/></svg>`;
const SPARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M4 0 4.9 3.1 8 4 4.9 4.9 4 8 3.1 4.9 0 4 3.1 3.1z"/></svg>`;
const svgUrl = (s) => `url("data:image/svg+xml;utf8,${encodeURIComponent(s)}")`;

function el(tag, cls, style = {}, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.assign(e.style, style);
  if (parent) parent.appendChild(e);
  return e;
}
const px = (v) => `${v}px`;
function box(cls, x, y, w, h, parent, extra = {}) {
  return el('div', cls, { left: px(x), top: px(y), width: px(w), height: px(h), ...extra }, parent);
}
function text(str, x, y, h, size, parent, { role = 'secondary', region = 'header', align = 'left', w, cls = '' } = {}) {
  const e = el('p', `t ${cls}`.trim(), { left: px(x), top: px(y), height: px(h), lineHeight: px(h), fontSize: px(size), textAlign: align }, parent);
  if (w != null) e.style.width = px(w);
  e.textContent = str; e.dataset.role = role; e.dataset.region = region;
  return e;
}
function icon(url, x, y, w, h, parent, role = 'primary', region = 'header') {
  const e = box('icon glyph', x, y, w, h, parent, { WebkitMaskImage: url, maskImage: url });
  e.dataset.role = role; e.dataset.region = region;
  return e;
}

export function createUI(root, opts = {}) {
  const stops = opts.stops || STOPS;
  let tintFor = (i) => TINTS[stops[i].ui];
  if (opts.tints) setTints(opts.tints);
  let bgFn = null, overrideFn = null, lastPolarityPick = {}, position = 0;

  if (!document.querySelector('link[data-lbx-ui]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = BASE + 'ui.css'; l.dataset.lbxUi = '1';
    document.head.appendChild(l);
  }
  const ui = el('div', 'lbx-ui', {}, root);
  const glass = [];

  // status bar
  text('9:41', 29, 16, 22, 17, ui, { role: 'primary', region: 'header', align: 'center', w: 40 }).style.fontWeight = '600';
  icon(`url(${BASE}icons/cellular.svg)`, 267.9, 23.5, 19.2, 12.2, ui);
  icon(`url(${BASE}icons/wifi.svg)`, 294.6, 23.6, 17.1, 12.3, ui);
  const batt = box('a glyph', 318.9, 23, 25, 13, ui, { borderRadius: '4.3px', border: '1px solid', opacity: '0.35' }); batt.dataset.role = 'primary-border';
  const cap = box('a glyph', 320.9, 25, 21, 9, ui, { borderRadius: '2.5px' }); cap.dataset.role = 'primary-bg';
  const nub = box('a glyph', 344.6, 27.5, 1.3, 4, ui, { borderRadius: '0 1px 1px 0', opacity: '0.4' }); nub.dataset.role = 'primary-bg';

  // header
  glass.push(box('a glass', 12, 60, 32, 32, ui), box('a glass', 54, 60, 32, 32, ui), box('a glass', 331, 60, 32, 32, ui), box('a glass', 226, 60, 95, 32, ui));
  icon(`url(${BASE}icons/menu.svg)`, 21, 71.4, 14, 9.2, ui);
  icon(svgUrl(GIFT), 60, 66, 20, 20, ui);
  text('$20,500', 240, 67, 16, 12, ui, { role: 'primary', region: 'header' });
  const plus = box('a', 293, 64, 24, 24, ui, { borderRadius: '47px' });
  const plusIcon = icon(`url(${BASE}icons/plus.svg)`, 299, 70, 12, 12, ui, 'plusInk');
  box('a', 339.4, 68, 16, 16, ui, { borderRadius: '50%', background: '#7537EF', opacity: '0.8', filter: 'blur(5px)' });
  el('img', 'wimg', { left: px(341.6), top: px(68.2), width: px(10.8), height: px(15.6) }, ui).src = BASE + 'img/avatar-crystal.png';

  // recently acquired
  text('Recently acquired', 12, 114, 16, 12, ui, { role: 'recent', region: 'recent' });
  icon(`url(${BASE}icons/chevron.svg)`, 116, 120, 8, 4, ui, 'recent', 'recent');
  const strip1 = box('a strip', 0, 141, 375, 84, ui);
  const recentCircles = [];
  for (const r of RECENT) {
    recentCircles.push(box('a glass', r.x, 141, 41, 41, ui));
    el('img', 'wimg', { left: px(r.x + 11), top: px(147), width: px(19), height: px(29) }, ui).src = BASE + 'img/' + r.img;
    text(r.t, r.x + 49, 147, 9, 8, ui, { role: 'secondary', region: 'recent' });
    text(r.p, r.x + 49, 159, 16, 12, ui, { role: 'primary', region: 'recent' });
  }

  // box name + tier (two layers each, for the hand-over)
  const names = [0, 1].map(() => el('p', 't name', {}, ui));
  const tiers = [0, 1].map(() => { const d = el('div', 'a tier', {}, ui); el('span', 'dot', {}, d); const s = el('p', 't', {}, d); return { d, s }; });
  names.forEach((n) => { n.dataset.role = 'primary'; n.dataset.region = 'name'; });
  tiers.forEach((t) => { t.s.dataset.role = 'tier'; t.s.dataset.region = 'name'; });

  // watch cards
  const strip2 = box('a strip', 0, 501, 375, 84, ui);
  const cards = [];
  for (const c of CARDS) {
    cards.push(box('a card', c.x, 514, 125, 57, ui));
    el('img', 'wimg', { left: px(c.x + 10), top: px(528), width: px(29), height: px(29) }, ui).src = BASE + 'img/' + c.img;
    const n = text(c.n, c.x + 47, 525, 18, 8, ui, { role: 'secondary', region: 'cards', cls: 'cname' }); n.style.lineHeight = '1.1';
    text(c.p, c.x + 47, 543, 16, 12, ui, { role: 'primary', region: 'cards' });
  }
  const viewAll = box('a occluder', 348, 514, 28, 57, ui, { borderRadius: '10px 0 0 10px' });
  const va = text('View all', 334, 534.5, 16, 12, ui, { role: 'viewAllInk', region: 'cards', align: 'center', w: 56 });
  va.style.transform = 'rotate(-90deg)';

  // what's inside
  glass.push(box('a glass', 133, 591, 110, 23, ui));
  text('What’s inside', 145, 594, 16, 12, ui, { role: 'primary', region: 'cards' });
  icon(`url(${BASE}icons/chevron.svg)`, 223, 600.5, 8, 4, ui, 'primary', 'cards');

  // values
  text('Min value', 28, 646, 14, 10, ui, { role: 'secondary', region: 'values', align: 'center', w: 44 });
  text('$20', 28, 661, 19, 14, ui, { role: 'primary', region: 'values', align: 'center', w: 44 });
  text('Max value', 131, 634, 16, 12, ui, { role: 'secondary', region: 'values', align: 'center', w: 114 });
  text('$121,500', 113, 645, 41, 30, ui, { role: 'figure', region: 'values', align: 'center', w: 150 });
  text('Styling', 292, 646, 14, 10, ui, { role: 'secondary', region: 'values', align: 'center', w: 60 });
  text('Balanced', 292, 661, 19, 14, ui, { role: 'primary', region: 'values', align: 'center', w: 60 });
  icon(svgUrl(SPARK), 351, 667.5, 8, 8, ui, 'primary', 'values');

  // swipe to open: a static image per tint, cross-faded. It does nothing (AGENTS.md: only the real control commits).
  const swipe = box('a swipe', 12, 706, 351, 60, ui);
  const swipeImgs = [0, 1].map(() => el('img', '', {}, swipe));
  swipeImgs.forEach((i) => { i.alt = ''; i.draggable = false; });
  const home = box('a home', 118, 799, 139, 5, ui);

  const all = [...ui.querySelectorAll('[data-role]')];

  function setTints(t) { tintFor = Array.isArray(t) ? (i) => t[i] : typeof t === 'function' ? t : (i) => t; }

  function inkFor(region, lowT, upT, amount, pages) {
    if (lowT.polarity === upT.polarity || amount <= 0 || amount >= 1) return mixTint(lowT, upT, amount);
    let L = bgFn ? bgFn(region, pages) : null;
    if (L == null) L = lowT.bgLum[region] + (upT.bgLum[region] - lowT.bgLum[region]) * amount;
    const lumOf = (h) => luminance(hexToRgb(h));
    const cl = contrast(lumOf(lowT.primary), L), cu = contrast(lumOf(upT.primary), L);
    return cu > cl ? upT : lowT;
  }

  function apply(state) {
    const { tint, inks, nameOut, nameIn } = state;
    ui.style.setProperty('--x', '0');
    const g = (gl) => {
      gl.style.background = `linear-gradient(180deg, ${rgba(tint.glassTop, tint.glassOpacity)}, ${rgba(tint.glassBottom, tint.glassOpacity)}), linear-gradient(180deg, ${rgba(tint.glassShade, tint.glassShadeOpacity)}, ${rgba(tint.glassShade, 0)})`;
      gl.style.boxShadow = `inset 0 0 0 0.5px rgba(255,255,255,${tint.glassStroke.toFixed(3)})`;
    };
    glass.forEach(g);
    for (const c of recentCircles) {
      c.style.background = `linear-gradient(180deg, ${rgba(tint.recentGlassTop, tint.recentGlassOpacity)}, ${rgba(tint.recentGlassBottom, tint.recentGlassOpacity)}), linear-gradient(180deg, ${rgba(tint.recentGlassShade, tint.recentGlassShadeOpacity)}, ${rgba(tint.recentGlassShade, 0)})`;
      c.style.boxShadow = `inset 0 0 0 0.5px rgba(255,255,255,0.16)`;
    }
    const sg = `linear-gradient(90deg, ${rgba(tint.strip, 0)} 0%, ${rgba(tint.strip, tint.stripOpacity)} 10%, ${rgba(tint.strip, tint.stripOpacity)} 90%, ${rgba(tint.strip, 0)} 100%)`;
    strip1.style.background = sg; strip2.style.background = sg;
    for (const c of cards) {
      c.style.background = rgba(tint.card, tint.cardOpacity);
      c.style.borderColor = rgba(tint.cardStroke, tint.cardStrokeOpacity);
      c.style.boxShadow = `0 3px 10px ${rgba(tint.cardShadow, tint.cardShadowOpacity)}`;
    }
    viewAll.style.background = `linear-gradient(180deg, ${tint.viewAllA}, ${tint.viewAllB})`;
    plus.style.background = `linear-gradient(180deg, ${tint.plusA}, ${tint.plusB})`;
    home.style.background = inks.swipe.homeIndicator;

    for (const e of all) {
      const ink = inks[e.dataset.region] || tint;
      const role = e.dataset.role;
      let col, op = 1;
      if (role === 'primary') col = ink.primary;
      else if (role === 'secondary') { col = ink.secondary; op = ink.secondaryOpacity; }
      else if (role === 'recent') { col = ink.secondary; op = ink.recentOpacity; }
      else if (role === 'tier') { col = ink.secondary; op = ink.tierOpacity; }
      else if (role === 'figure') col = ink.figure;
      else if (role === 'viewAllInk') col = state.viewAllInk;
      else if (role === 'plusInk') col = state.plusInk;
      else if (role === 'primary-border') { e.style.borderColor = ink.primary; continue; }
      else if (role === 'primary-bg') { e.style.background = ink.primary; continue; }
      const key = col + op.toFixed(3);
      if (e._ink !== undefined && e._ink !== key && state.flipped && state.flipped[e.dataset.region]) {
        e.classList.add('flip'); clearTimeout(e._ft); e._ft = setTimeout(() => e.classList.remove('flip'), 220);
      }
      e._ink = key;
      e.style.color = col;
      if (e.classList.contains('t')) e.style.opacity = op.toFixed(3);
      else e.style.opacity = (op).toFixed(3);
    }
    // name + tier hand-over
    const nameInk = inks.name;
    const shadow = (t) => t.nameShadowOpacity > 0.001 ? `0 0 ${t.nameShadowBlur}px ${rgba(t.nameShadow, t.nameShadowOpacity)}` : 'none';
    [[names[0], tiers[0], nameOut], [names[1], tiers[1], nameIn]].forEach(([n, tr, s]) => {
      n.textContent = s.name; tr.s.textContent = s.tier;
      n.style.opacity = s.opacity.toFixed(3); tr.d.style.opacity = s.opacity.toFixed(3);
      n.style.transform = tr.d.style.transform = `translate3d(${s.dx.toFixed(2)}px,0,0)`;
      n.style.visibility = tr.d.style.visibility = s.opacity > 0.001 ? '' : 'hidden';
      n.style.textShadow = shadow(nameInk);
      n.style.color = nameInk.primary;
      tr.s.style.color = nameInk.secondary; tr.s.style.opacity = nameInk.tierOpacity.toFixed(3);
    });
    // swipe images
    const [a, b] = swipeImgs;
    const srcA = BASE + 'img/swipe-' + state.swipe.lower + '.png', srcB = BASE + 'img/swipe-' + state.swipe.upper + '.png';
    if (a.dataset.src !== srcA) { a.src = srcA; a.dataset.src = srcA; }
    if (b.dataset.src !== srcB) { b.src = srcB; b.dataset.src = srcB; }
    // Same polarity: cross-fade. Polarity flip: the images carry their own text, so never show both half-way;
    // swap at the point where the swipe region's ink flips, with the 140 ms local crossfade.
    if (state.swipe.flip) { b.style.transition = 'opacity 140ms linear'; b.style.opacity = state.swipe.useUpper ? '1' : '0'; }
    else { b.style.transition = ''; b.style.opacity = state.swipe.amount.toFixed(3); }
  }

  function computeState(pages) {
    const n = stops.length;
    const p = mod(pages, n);
    const lower = Math.floor(p) % n, upper = (lower + 1) % n, t = p - Math.floor(p);
    const amount = smoothstep(t);
    const lowT = tintFor(lower), upT = tintFor(upper);
    const tint = mixTint(lowT, upT, amount);
    const inks = {}, flipped = {};
    for (const r of ['header', 'recent', 'name', 'cards', 'values', 'swipe']) {
      inks[r] = inkFor(r, lowT, upT, amount, pages);
      flipped[r] = lowT.polarity !== upT.polarity;
    }
    // Name/tier: old slides out with the finger and is gone by t = 0.5; new arrives after 0.5.
    const dir = 36;
    const out = { name: stops[lower].name, tier: tierLabel(stops[lower]), opacity: 1 - smoothstep(Math.min(1, Math.max(0, (t - 0.3) / 0.2))), dx: -t * dir };
    const inn = { name: stops[upper].name, tier: tierLabel(stops[upper]), opacity: smoothstep(Math.min(1, Math.max(0, (t - 0.5) / 0.2))), dx: (1 - t) * dir };
    // Inks on our own panels (View all tab, + button): never interpolate them to mid-grey either; take the
    // endpoint ink with the higher contrast against the panel's current (interpolated) colour.
    const panelInk = (inkKey, aKey, bKey) => {
      const panel = luminance(hexToRgb(mixHex(tint[aKey], tint[bKey], 0.5)));
      const ca = contrast(luminance(hexToRgb(lowT[inkKey])), panel), cb = contrast(luminance(hexToRgb(upT[inkKey])), panel);
      return lowT[inkKey] === upT[inkKey] ? lowT[inkKey] : cb > ca ? upT[inkKey] : lowT[inkKey];
    };
    return { pages, lower, upper, t, amount, tint, inks, flipped, nameOut: out, nameIn: inn,
      viewAllInk: panelInk('viewAllInk', 'viewAllA', 'viewAllB'), plusInk: panelInk('plusInk', 'plusA', 'plusB'),
      swipe: { lower: lowT.swipe, upper: upT.swipe, amount, flip: lowT.polarity !== upT.polarity, useUpper: inks.swipe === upT } };
  }

  const api = {
    el: ui,
    get position() { return position; },
    setPosition(pages) {
      position = pages;
      let s = computeState(pages);
      if (overrideFn) s = { ...s, ...(overrideFn(s) || {}) };
      apply(s);
      return s;
    },
    setTints(t) { setTints(t); api.setPosition(position); },
    setBackgroundLuminance(fn) { bgFn = fn; },
    setOverride(fn) { overrideFn = fn; },
    hide(mode) {
      ui.classList.toggle('hide-all', mode === true);
      ui.classList.toggle('hide-text', mode === 'text');
    },
    setScale(s) { ui.style.transform = `scale(${s})`; },
    textRects() {
      const out = [];
      if (ui.classList.contains('hide-all')) return out;
      const rootRect = root.getBoundingClientRect();
      // Opaque UI panels marked .occluder hide the text under them (the View all tab over the last card).
      const occ = [...ui.querySelectorAll('.occluder')].map((o) => ({ o, r: o.getBoundingClientRect() }));
      for (const e of ui.querySelectorAll('p.t')) {
        const r = e.getBoundingClientRect();
        if (!e.textContent.trim() || r.width < 1 || r.height < 1) continue;
        let op = 1, v = e, hidden = false;
        while (v && v !== root) { const cs = getComputedStyle(v); if (cs.visibility === 'hidden' || cs.display === 'none') hidden = true; op *= +cs.opacity; v = v.parentElement; }
        if (hidden || op < 0.05) continue;
        let x0 = Math.max(r.left, rootRect.left), y0 = Math.max(r.top, rootRect.top);
        let x1 = Math.min(r.right, rootRect.right), y1 = Math.min(r.bottom, rootRect.bottom);
        for (const { o, r: q } of occ) {
          if (o.contains(e) || q.bottom <= y0 || q.top >= y1 || q.right <= x0 || q.left >= x1) continue;
          if (e.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING) { // occluder painted above
            if (q.left > x0) x1 = Math.min(x1, q.left); else x0 = Math.max(x0, q.right);
          }
        }
        if (x1 - x0 < 2 || y1 - y0 < 2) continue;
        const cs = getComputedStyle(e);
        const scale = r.height / e.offsetHeight || 1;
        const fontSize = parseFloat(cs.fontSize) * (e.getBoundingClientRect().width / (e.offsetWidth || 1) || scale);
        const fontWeight = +cs.fontWeight || 400;
        // shrink to the glyph box: measure the text run
        const range = document.createRange(); range.selectNodeContents(e); const tr = range.getBoundingClientRect();
        const gx0 = Math.max(tr.left, x0), gx1 = Math.min(tr.right, x1);
        out.push({ text: e.textContent, role: e.dataset.role, region: e.dataset.region,
          x: gx0, y: y0, w: Math.max(1, gx1 - gx0), h: y1 - y0, color: cs.color, opacity: +op.toFixed(3),
          fontSize: +fontSize.toFixed(2), designFontSize: parseFloat(cs.fontSize), fontWeight,
          large: parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && fontWeight >= 700) });
      }
      return out;
    },
  };
  api.setPosition(0);
  return api;
}
