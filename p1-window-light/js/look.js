// Per-frame look, round 4.
// Spatial model: four boxes travel on one brass ring track in one room. The window is in the left wall near the
// camera, out of frame: the room sees it only as its light. Each box has its own hour, coloured to match it
// (warm dark stone for Obsidian, blue hour for Sapphire, sea shade for Emerald, violet dusk for Amethyst).
// Tracking: the ring angle is solved per position so the hero's clasp moves exactly with the finger (1:1 in screen
// space, the small dolly included); the drag gain comes from the same geometry.
// Light: the strip of four screens slides through the one window with the finger (light.js), so the sun pattern on
// the floor and wall travels with the box; the room's hour follows the finger continuously (all four hours are the
// same polarity, so the UI inks interpolate and nothing is timed).
// Budget: the cast shadow is re-rendered only at rest and fades out while the boxes travel (contact decals carry
// the grounding in motion); boxes are opaque except the one fading at the back of the ring.
import * as THREE from 'three';
import { STOPS, TINTS as KIT_TINTS } from '../../shared/js/stops.js';

// UI tints: every hour is a dark room now, so every stop takes a light-on-dark tint. Emerald and Amethyst keep their
// own round-13 tints (Riviera, Desert). Obsidian takes Riviera's warm-brown glass (gold, warm stone); Sapphire takes
// Desert's navy glass with a blue View all and plus.
export const TINTS = {
  obsidian: { ...KIT_TINTS.riviera, card: '#2A2119', cardOpacity: 0.42, figure: '#FFE9C2' },
  sapphire: { ...KIT_TINTS.desert, glassBottom: '#C7D8EE', glassShade: '#0E1A33', card: '#0F1A30', cardOpacity: 0.45,
    viewAllA: '#B9D5EE', viewAllB: '#8FB3DA', viewAllInk: '#0E1626', plusA: '#A4CEE9', plusB: '#A4CEE9', plusInk: '#0E0E15',
    nameShadow: '#668CF2', swipe: 'today' },
  emerald: { ...KIT_TINTS.riviera },
  amethyst: { ...KIT_TINTS.desert },
};
export const PAGE_TINTS = STOPS.map((s) => TINTS[s.key]);

// Room hour per stop (linear): fill multiplies the baked lightmap, alb shifts the surfaces, top tints the upper
// walls, key is the sun's intensity. Hues follow the boxes (critic r3: room hue within 30 deg of the box hue).
export const FILL = [
  { fill: [0.150, 0.112, 0.078], alb: [1.00, 0.93, 0.84], top: [0.80, 0.70, 0.58], key: 13.0, keyRoom: 0.14 },  // Ivory Morning / Obsidian: warm dark stone, gold sun
  { fill: [0.070, 0.098, 0.185], alb: [0.86, 0.92, 1.04], top: [0.70, 0.80, 1.00], key: 9.0, keyRoom: 0.28 },   // Reeded Glass / Sapphire: blue hour
  { fill: [0.056, 0.118, 0.114], alb: [0.88, 0.98, 0.96], top: [0.50, 0.78, 0.74], key: 7.0, keyRoom: 0.36 },   // Riviera Caustics / Emerald: sea shade
  { fill: [0.098, 0.072, 0.168], alb: [0.92, 0.86, 1.04], top: [0.60, 0.54, 0.96], key: 9.5, keyRoom: 0.26 },   // Desert Dawn / Amethyst: violet dusk
];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mod = (x, n) => ((x % n) + n) % n;
const HYST = 0.02;
const DEG = Math.PI / 180;
const SHADOW_OUT = 0.12, SHADOW_IN = 0.35;   // s: cast shadow fades out when the boxes start moving, in at rest

export function createLook({ stage, room, key, renderer, scene, camera, tone, boxes, Q }) {
  const n = 4, W = stage.width, H = stage.height;
  const R = room.cfg.ring.r, CX = room.cfg.ring.cx, CZ = room.cfg.ring.cz;
  const MID = +(Q.get('mid') || 1.0), YF = +(Q.get('yaw') || 0.06);
  const P0 = new THREE.Vector3(...(Q.get('cam') ? Q.get('cam').split(',').map(Number) : [9.6, 2.0, 0]));
  const T0 = new THREE.Vector3(...(Q.get('tgt') ? Q.get('tgt').split(',').map(Number) : [0.6, -0.5, 0]));
  const DIR = P0.clone().sub(T0), D0 = DIR.length(); DIR.normalize();
  const dollyOf = (u) => 1 - (1 - MID) * Math.pow(Math.sin(Math.PI * u), 2);
  function setCamera(s) { camera.position.copy(T0).addScaledVector(DIR, D0 / s); camera.lookAt(T0); camera.updateMatrixWorld(); }

  // ---- the 1:1 solve -------------------------------------------------------------------------------------------
  const CLASP = new THREE.Vector3(1.197, 0.30, 0), tmp = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const placeOf = (a, out) => out.set(CX + R * Math.cos(a), 0, CZ - R * Math.sin(a));
  function claspX(a, s) {
    setCamera(s);
    placeOf(a, tmp); const c = CLASP.clone().applyAxisAngle(Y, a * YF).add(tmp).project(camera);
    return (c.x + 1) / 2 * W;
  }
  const S_PAGE = W / 2 - claspX(-90 * DEG, 1);   // pt per page
  const LUT_N = 200, LUT = new Float32Array(LUT_N + 1);
  for (let k = 0; k <= LUT_N; k++) {
    const u = k / LUT_N, s = dollyOf(u), want = W / 2 - S_PAGE * u;
    let lo = 0, hi = 90 * DEG;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (claspX(-m, s) > want) lo = m; else hi = m; }
    LUT[k] = Math.max((lo + hi) / 2, k ? LUT[k - 1] : 0);
  }
  LUT[0] = 0; LUT[LUT_N] = Math.PI / 2;
  const theta = (u) => { const x = u * LUT_N, k = Math.min(LUT_N - 1, Math.floor(x)), f = x - k; return LUT[k] + (LUT[k + 1] - LUT[k]) * f; };
  const angleOf = (rel) => { const a = Math.abs(rel), fl = Math.floor(a); return Math.sign(rel) * (fl * Math.PI / 2 + theta(a - fl)); };
  const GAIN = W / S_PAGE;

  // ---- boxes: opaque unless fading at the back of the ring; contact decals ---------------------------------------
  const decals = boxes.map(() => { const d = room.contactDecal(); scene.add(d); return d; });
  const boxMats = boxes.map((o) => { const a = []; o.traverse((m) => { if (m.isMesh) for (const mt of [].concat(m.material)) { mt.transparent = true; mt.depthWrite = true; a.push([mt, mt.envMapIntensity, m]); } }); return a; });
  const boxState = boxes.map(() => ({ a: 0, fade: 1 }));

  const S = { pos: 0, i: 0, t: 0, lower: 0, side: 0, pairKey: null, rm: { shown: null, target: null, dis: -1 },
    shadowI: 0, shadowPos: NaN };

  function step(f) {
    const pos = f.position, lower = Math.floor(pos), t = pos - lower;
    S.pos = pos; S.t = t; S.lower = lower; S.i = mod(lower, n);
    if (f.frozen || S.pairKey !== lower) { S.side = t >= 0.5 ? 1 : 0; S.pairKey = lower; }
    else S.side = S.side === 0 ? (t > 0.5 + HYST ? 1 : 0) : (t < 0.5 - HYST ? 0 : 1);
  }

  // ---- scene ---------------------------------------------------------------------------------------------------
  const U = room.U;
  const set3 = (v, a) => v.value.set(a[0], a[1], a[2]);
  let tapT = 1;
  function roomState(A, B, mix) {
    set3(U.uFillA, A.fill); set3(U.uFillB, B.fill); U.uFillA.value.multiplyScalar(room.lmScale); U.uFillB.value.multiplyScalar(room.lmScale);
    set3(U.uAlbA, A.alb); set3(U.uAlbB, B.alb); set3(U.uTopA, A.top); set3(U.uTopB, B.top);
    U.uMix.value = mix; U.uSweepOn.value = 0;
    U.uKeyRoom.value = A.keyRoom + (B.keyRoom - A.keyRoom) * mix;   // the sun's share on the room (the box keeps its own)
  }

  function placeBoxes(pos, dolly, forceHero = null, heroFade = null) {
    setCamera(dolly);
    boxes.forEach((o, k) => {
      let a, fade;
      if (forceHero !== null) { a = 0; fade = heroFade[k]; }
      else { const rel = mod(k - pos + 2, n) - 2; a = angleOf(rel); fade = 1 - smooth(91 * DEG, 112 * DEG, Math.abs(a)); }
      placeOf(a, o.position); o.rotation.y = a * YF;
      const vis = fade > 0.002;
      o.visible = vis;
      const env = 0.82 + 0.18 * Math.max(0, Math.cos(a));
      const sk = fade.toFixed(3) + '|' + env.toFixed(2);   // quantised: material writes only on visible steps
      if (boxState[k].key !== sk) {   // material writes only when they change
        boxState[k].key = sk;
        const tr = fade < 0.999;   // opaque (early-z, no blending) unless fading
        for (const [m, b, mesh] of boxMats[k]) { m.opacity = tr ? fade : 1; m.transparent = tr; m.envMapIntensity = b * env; mesh.castShadow = fade > 0.5; }
      }
      const d = decals[k]; d.visible = vis; d.position.x = o.position.x; d.position.z = o.position.z; d.rotation.y = o.rotation.y;
      d.material.uniforms.uOpacity.value = fade;
      boxState[k].a = a; boxState[k].fade = fade;
    });
  }

  // cast shadow: frozen while anything moves (faded out), re-rendered once at rest and faded in
  function shadows(f, still) {
    if (still) {
      if (S.shadowPos !== f.position) { renderer.shadowMap.needsUpdate = true; S.shadowPos = f.position; if (f.frozen) S.shadowI = 1; }
      S.shadowI = Math.min(1, S.shadowI + f.dt / SHADOW_IN);
    } else S.shadowI = Math.max(0, S.shadowI - f.dt / SHADOW_OUT);
    key.spot.shadow.intensity = smooth(0, 1, S.shadowI);
  }

  function applyScene(f) {
    const pos = f.position, p = mod(pos, n), i = Math.floor(p), t = p - i, j = (i + 1) % n;
    placeBoxes(pos, dollyOf(t));
    const w = smooth(0, 1, t);
    roomState(FILL[i], FILL[j], w);
    key.intensity = (FILL[i].key + (FILL[j].key - FILL[i].key) * w) * (1 + 0.16 * Math.sin(Math.PI * Math.min(1, tapT)));
    key.update(pos, f.time);
    shadows(f, !f.moving);
  }

  // ---- UI: derived from S in the same frame -------------------------------------------------------------------
  // The name stays centred and is handed over whole at the midpoint (critic r3: no off-centre drift).
  const liveOverride = (st) => {
    const near = PAGE_TINTS[S.side ? mod(st.upper, n) : mod(st.lower, n)];
    return {
      nameOut: { ...st.nameOut, opacity: S.side ? 0 : 1, dx: 0 },
      nameIn: { ...st.nameIn, opacity: S.side ? 1 : 0, dx: 0 },
      tint: { ...st.tint, viewAllA: near.viewAllA, viewAllB: near.viewAllB }, viewAllInk: near.viewAllInk,
    };
  };
  stage.ui.setOverride(liveOverride);

  // ---- reduced motion ------------------------------------------------------------------------------------------
  // Nothing travels: no dolly, no ring. On a commit the box dissolves in place into the next one (0.5 s) while the
  // room's hour changes over 0.8 s and the next screen slides slowly into the window. The name changes at the middle.
  const RM_DIS = 0.5, RM_HOUR = 0.8;
  function frameRM(f) {
    const target = mod(Math.round(f.position), n), rm = S.rm;
    if (rm.shown === null || f.frozen) { rm.shown = target; rm.target = target; rm.dis = -1; rm.from = target; rm.h = 1; }
    else if (target !== rm.target) { rm.from = rm.shown; rm.target = target; rm.dis = 0; rm.h = 0; }
    const fades = boxes.map(() => 0);
    if (rm.dis >= 0) {
      rm.dis += f.dt; const x = smooth(0, RM_DIS, rm.dis);
      fades[rm.from] = 1 - x; fades[rm.target] = Math.max(fades[rm.target], x);
      if (rm.dis >= RM_DIS / 2) rm.shown = rm.target;
      if (rm.dis >= RM_DIS) rm.dis = -1;
    } else fades[rm.shown] = 1;
    placeBoxes(0, 1, 0, fades);
    rm.h = Math.min(1, rm.h + f.dt / RM_HOUR);
    const w = smooth(0, 1, rm.h);
    roomState(FILL[rm.from], FILL[rm.target], w);
    key.intensity = FILL[rm.from].key + (FILL[rm.target].key - FILL[rm.from].key) * w;
    // the strip moves the short way from the old screen to the new one
    let d = rm.target - rm.from; if (d > 2) d -= 4; if (d < -2) d += 4;
    key.update(rm.from + d * w, f.time * 0.25);
    shadows(f, rm.dis < 0 && rm.h >= 1);
    tone.render(scene, camera);
    stage.ui.setPosition(rm.shown);
  }
  const rmOverride = (st) => {
    const tint = PAGE_TINTS[S.rm.shown];
    return { tint: { ...tint }, inks: Object.fromEntries(Object.keys(st.inks).map((r) => [r, tint])), flipped: {},
      viewAllInk: tint.viewAllInk, plusInk: tint.plusInk, swipe: { lower: tint.swipe, upper: tint.swipe, amount: 0, flip: false, useUpper: false } };
  };

  // dev probe: mean scene luminance of each drawn frame
  let probeBuf = null;
  function probeFrame(f) {
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (!probeBuf || probeBuf.length !== w * h * 4) probeBuf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, probeBuf);
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    let s = 0, c = 0;
    for (let k = 0; k < probeBuf.length; k += 4 * 37) { s += 0.2126 * lin(probeBuf[k]) + 0.7152 * lin(probeBuf[k + 1]) + 0.0722 * lin(probeBuf[k + 2]); c++; }
    look.samples.push({ time: f.time, pos: f.position, lum: s / c });
  }
  let rmWas = null;
  const look = {
    S, GAIN, S_PAGE, LUT, boxState, angleOf, dollyOf,
    tap() { tapT = 0; },
    screenBoxes() {
      const lo = [-1.499, -0.452, -1.078], hi = [1.197, 1.053, 1.088];
      return boxes.map((o, k) => {
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (let c = 0; c < 8; c++) {
          const v = new THREE.Vector3(c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]).applyAxisAngle(Y, o.rotation.y).add(o.position).project(camera);
          const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        const vw = boxState[k].fade > 0.002 ? Math.max(0, Math.min(W, x1) - Math.max(0, x0)) : 0;
        return { k, x0, x1, y0, y1, fade: boxState[k].fade, visibleW: vw, visibleFrac: vw / (x1 - x0), hero: Math.abs(boxState[k].a) < 1e-3 };
      });
    },
    clasps() { return boxes.map((o) => { const c = CLASP.clone().applyAxisAngle(Y, o.rotation.y).add(o.position).project(camera); return +((c.x + 1) / 2 * W).toFixed(1); }); },
    frame(f) {
      if (tapT < 1) tapT += f.dt / 0.32;
      if (f.reducedMotion) {
        if (rmWas !== true) { rmWas = true; S.rm.shown = null; stage.ui.setOverride(rmOverride); }
        frameRM(f); return;
      }
      if (rmWas === true) { rmWas = false; S.pairKey = null; stage.ui.setOverride(liveOverride); }
      step(f);
      applyScene(f);
      tone.render(scene, camera);
      if (this.probe) probeFrame(f);
      stage.ui.setPosition(f.position);
    },
  };
  look.samples = [];
  return look;
}
