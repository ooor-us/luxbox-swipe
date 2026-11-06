// BASELINE: a faithful web replica of TODAY's native home carousel, for the critics.
// Sources (native-spike, read-only):
//   NativeBoxesRenderer.swift  ring layout (centre, radius 4.7, frontAngle, slot k at frontAngle - k*step,
//                              orientation k*step), camera orbiting the ring centre by -angle, the home projection
//                              (homeScale 0.79389*1.15*1.15, kx, 393.6 pt box-bottom anchor via frontBottomSlope),
//                              environment light turning with the camera, nearest-box-only reflection weight.
//   NativeBoxesCarouselExit.swift  far-side boxes slide out past the viewport edge between step and 95 deg.
//   NativeBoxesMotion.swift    via shared/js/motion.js (exact port).
//   NativeBoxesBackdrop.swift  smoothstep blend between the two neighbouring theme backdrops.
//   CatalogHomeBackdrop.swift, CatalogHomeTheme.swift, CatalogFigmaTheme.swift  page gradient, 2 % tint wash,
//                              foot glow, halo A, core B (the app's own glow textures), lattice at 6 % plus-lighter.
//   Resources/NativeBoxes.bundle/scene.json, env.hdr.
// Deviations (documented in baseline/NOTES.md): six ring slots kept, four stops mapped onto them dynamically;
// the round-14 studio box look (shared/box: per-part studio env maps turning with the camera, AgX MHC LUT pass) and
// the home camera of shared/box/camera.json orbiting the ring centre (?cam=native: today's off-axis projection);
// reflection = mirrored low-res pass; no feedback animations.

import * as THREE from 'three';
import { createStage } from '../../shared/js/stage.js';
import { STOPS, TINTS } from '../../shared/js/stops.js';
import { loadStudioBoxes } from '../../shared/js/box.js';
import * as BOX from '../../shared/box/box.js';
import { reflectionWeight } from '../../shared/js/motion.js';
import { params } from '../../shared/js/proto-api.js';

// ---- scene.json (NativeBoxes.bundle, designer prototype at box-scene/4a256be) -------------------------
const SPEC = {
  ringCentre: [-7.25327730178833, 0.0034338831901550293, 0.007174540311098099],
  frontPosition: [-2.551192283630371, 0.0, 0.0251357089728117],
  ringRadius: 4.7, frontAngle: 0.003819812440199236, floorY: -0.4516025483608246,
  cameraPosition: [6.327332019805908, 2.9264886379241943, -0.0004136404022574425],
  cameraRotation: [-0.10358885675668716, 0.6994779109954834, 0.10358885675668716, 0.6994779109954834], // x y z w
  verticalFOV: 0.9222967624664307, cameraAspect: 0.5625, boxScale: 1.15,
  light: { position: [0.8355708122253418, 1.9058551788330078, -8.615520477294922], intensity: 0.7957747154594768 },
};
const SLOTS = 6;                              // CatalogBoxPresentation.colourKeys.count (Release)
const STEP = 2 * Math.PI / SLOTS;
const EXIT_START = STEP, EXIT_END = 95 * Math.PI / 180;

// ---- today's themes for the four tiers ------------------------------------------------------------------
// CatalogFigmaTheme literal entries: obsidian = tier-05, amethyst = tier-04, emerald = "pine" (the app shows
// the pine appearance as "Emerald Box"). Sapphire has no shipped theme: the app's algorithmic OKLCH derivation
// from the accent is used, with the tier hex #1C2A47 as the accent (CatalogHomeTheme.init fallback).
function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function linToSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; }
function hexToOklch(h) {
  const v = parseInt(h.slice(1), 16), [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => srgbToLin(x / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
}
function oklchToHex({ L, C, h }) {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return '#' + rgb.map((x) => Math.round(Math.max(0, Math.min(1, linToSrgb(Math.max(0, x)))) * 255).toString(16).padStart(2, '0')).join('');
}
const STD = { haloOffsetY: 10, coreOffsetY: 1.5, coreOpacity: 0.4, lightOpacity: 0.15 };
const sapphireAccent = hexToOklch('#1C2A47');
const sapphireDerived = oklchToHex({ L: sapphireAccent.L, C: Math.min(sapphireAccent.C * 2, 0.17), h: sapphireAccent.h });
export const TODAY_THEMES = {
  obsidian: { tint: '#D18BFA', glowAB: '#797F8B', light: '#797F8B', wide: false, haloOffsetY: 15, coreOffsetY: 6.5, coreOpacity: 0.15, lightOpacity: 0.2, source: 'CatalogFigmaTheme tier-05 (Obsidian 599:18175)' },
  sapphire: { tint: sapphireDerived, glowAB: sapphireDerived, light: sapphireDerived, wide: true, ...STD, source: `algorithmic OKLCH derivation from accent #1C2A47 -> ${sapphireDerived} (no shipped theme)` },
  emerald: { tint: '#6FE08E', glowAB: '#6FE08E', light: '#6FE08E', wide: true, ...STD, source: 'CatalogFigmaTheme pine (shown as Emerald, 582:12892)' },
  amethyst: { tint: '#D18BFA', glowAB: '#D18BFA', light: '#D18BFA', wide: true, ...STD, source: 'CatalogFigmaTheme tier-04 (Amethyst 582:11386)' },
};

// ---- stage ---------------------------------------------------------------------------------------------
const stage = createStage({ name: 'baseline (today)', stops: STOPS, tints: STOPS.map(() => TINTS.today) });
const backdrop = document.createElement('canvas');
Object.assign(backdrop.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
stage.el.insertBefore(backdrop, stage.canvas);
const bctx = backdrop.getContext('2d');

const renderer = new THREE.WebGLRenderer({ canvas: stage.canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const reflScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
camera.matrixAutoUpdate = true;

const centre = new THREE.Vector3(...SPEC.ringCentre);
const camPos0 = new THREE.Vector3(...SPEC.cameraPosition);
const camQ0 = new THREE.Quaternion(...SPEC.cameraRotation);
// Box look: the studio rig of shared/box (BOX.md), the same for every prototype, so critics compare the swipe and
// not the lighting. ?env= scales the studio env (default 1 = compare.png); ?light= adds scene.json's point light
// (default 0: the studio env maps already carry the key and fill). ?cam=native uses today's off-axis projection.
const LIGHT = +(params.get('light') || 0), ENV = +(params.get('env') || 1);
const CAM = params.get('cam') === 'native' ? 'native' : 'home';
if (LIGHT > 0) {
  const light = new THREE.PointLight(0xffffff, SPEC.light.intensity * Math.PI * LIGHT, 0, 0);
  light.position.set(...SPEC.light.position); scene.add(light); reflScene.add(light.clone());
}
let tone = null, homeSpec = null, homeQ0 = null, homePos0 = null, envRotation = 0;

let boxes = null, bounds = null, frontBottomSlope = 0;
const slots = []; // per ring page j currently placed
let W = 375, H = 812, DPR = 1, caseY = 812 * 0.4;

// low-res mirrored pass for the nearest box (NativeBoxesMotion.reflectionWeight)
const reflRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: reflRT.texture }, amount: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false,
  premultipliedAlpha: true,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `uniform sampler2D map; uniform float amount; varying vec2 vUv;
    void main(){ vec2 px = 1.0 / vec2(textureSize(map, 0)); vec4 c = vec4(0.);
      for (int i=-2;i<=2;i++) for (int k=-2;k<=2;k++) c += texture2D(map, vUv + vec2(float(i),float(k))*px*1.2);
      c /= 25.; gl_FragColor = c * amount; }`,
});
quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));

// ---- projection (NativeBoxesRenderer.swift lines ~1340-1352, homeWeight = 1) ----------------------------
function homeProjection(aspect) {
  const homeScale = 0.79389 * SPEC.boxScale * 1.15;
  const halfHeight = Math.tan(SPEC.verticalFOV / 2) * SPEC.cameraAspect / aspect;
  const sy = homeScale / halfHeight, sx = sy / aspect;
  const kx = 0.5 - homeScale * ((0.5 - 186.0 / 375 - (-0.0032895)) / 0.79389) - 186.0 / 375;
  const shiftX = 2 * kx, shiftY = 2 * (393.6 / 375) * (W / H) - 1 + sy * frontBottomSlope;
  const near = 0.01, far = 150;
  const m = new THREE.Matrix4();
  // column-major: col0 (sx,0,0,0) col1 (0,sy,0,0) col2 (shift.x, shift.y, A, -1) col3 (0,0,B,0); GL depth
  m.set(sx, 0, shiftX, 0,
        0, sy, shiftY, 0,
        0, 0, -(far + near) / (far - near), -2 * far * near / (far - near),
        0, 0, -1, 0);
  return m;
}
function setCamera(pages) {
  const angle = -pages * STEP;                    // native motion.angle
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
  const home = CAM === 'home' && homeSpec;
  camera.position.copy(home ? homePos0 : camPos0).sub(centre).applyQuaternion(rot).add(centre);
  camera.quaternion.copy(rot).multiply(home ? homeQ0 : camQ0);
  camera.updateMatrixWorld(true);
  if (home) {
    // camera.json "three" block: plain perspective, vertical FOV fixed, the front box exactly as in compare.png
    camera.fov = homeSpec.fov_vertical_deg; camera.aspect = W / H; camera.near = homeSpec.near; camera.far = homeSpec.far;
    camera.updateProjectionMatrix();
  } else {
    camera.projectionMatrix.copy(homeProjection(W / H));
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  envRotation = -angle;                           // the studio env maps turn with the camera, like env.hdr natively
  return angle;
}
function slotMatrix(j) {
  const a = SPEC.frontAngle - j * STEP;
  const m = new THREE.Matrix4().makeRotationY(j * STEP);
  m.setPosition(centre.x + SPEC.ringRadius * Math.cos(a), 0, centre.z + SPEC.ringRadius * Math.sin(a));
  return m;
}
const corners = (b) => { const o = []; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) o.push(new THREE.Vector4(x, y, z, 1)); return o; };
// NativeBoxesCarouselExit.offset
function exitOffset(angle, boxM) {
  if (!(angle > EXIT_START && angle <= EXIT_END)) return new THREE.Vector3();
  const P = camera.projectionMatrix, view = camera.matrixWorldInverse.clone().multiply(boxM);
  const side = new THREE.Vector3().setFromMatrixPosition(view).x < 0 ? -1 : 1;
  let distance = 0;
  const PV = P.clone().multiply(view);
  for (const c of corners(bounds)) {
    const clip = c.clone().applyMatrix4(PV);
    if (!(clip.w > 0)) continue;
    distance = Math.max(distance, (1.04 * clip.w - side * clip.x) / P.elements[0]);
  }
  const t = Math.min(1, Math.max(0, (angle - EXIT_START) / (EXIT_END - EXIT_START)));
  const smooth = t * t * (3 - 2 * t);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  return right.multiplyScalar(side * distance * smooth);
}

// ---- backdrop (CatalogHomeBackdrop at 384 px wide, cross-faded like NativeBoxesBackdrop.Blend) -----------
const img = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
let glow = null, themeCanvases = [];
function tinted(image, colour) {
  const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
  const x = c.getContext('2d'); x.drawImage(image, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = colour; x.fillRect(0, 0, c.width, c.height);
  return c;
}
function renderTheme(theme) {
  const tw = Math.min(384, Math.round(W * DPR)), th = Math.round(tw * H / W), s = tw / 375;
  const c = document.createElement('canvas'); c.width = tw; c.height = th;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, th); g.addColorStop(0, '#0B0B0E'); g.addColorStop(1, '#050507');
  x.fillStyle = g; x.fillRect(0, 0, tw, th);
  x.globalAlpha = 0.02; x.fillStyle = theme.tint; x.fillRect(0, 0, tw, th); x.globalAlpha = 1;
  const put = (image, cw, ch, colour, opacity, cy) => {
    const w = cw * s, h = ch * s; x.globalAlpha = opacity;
    x.drawImage(tinted(image, colour), 188 * s - w / 2, cy - h / 2, w, h); x.globalAlpha = 1;
  };
  const caseYpx = caseY * (tw / W);
  if (theme.wide) put(glow.light190, 1022, 899, theme.light, theme.lightOpacity, th + 12.14 * s);
  else put(glow.light1885, 1018, 895, theme.light, theme.lightOpacity, th + 12.14 * s);
  put(glow.a, 892, 1047, theme.glowAB, 0.15, caseYpx + theme.haloOffsetY * s);
  put(glow.b, 440, 440, theme.glowAB, theme.coreOpacity, caseYpx + theme.coreOffsetY * s);
  return c;
}
let latticeCanvas = null;
function renderLattice() {
  const s = (W * DPR) / 375, w = 377.9 * s, h = 291.1 * s;
  const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
  const x = c.getContext('2d'); x.drawImage(glow.pattern, 0, 0, w, w);
  x.globalCompositeOperation = 'destination-in';
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  latticeCanvas = { c, x: 1.28 * s, y: -21 * s };
}
function rebuildBackdrops() {
  if (!glow) return;
  themeCanvases = STOPS.map((s) => renderTheme(TODAY_THEMES[s.key]));
  renderLattice();
}
function drawBackdrop(blend) {
  if (!themeCanvases.length) return;
  const w = backdrop.width, h = backdrop.height;
  bctx.globalCompositeOperation = 'source-over'; bctx.globalAlpha = 1;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(themeCanvases[blend.lower], 0, 0, w, h);
  if (blend.amount > 0) { bctx.globalAlpha = blend.amount; bctx.drawImage(themeCanvases[blend.upper], 0, 0, w, h); bctx.globalAlpha = 1; }
  bctx.globalCompositeOperation = 'lighter'; bctx.globalAlpha = 0.06;
  bctx.drawImage(latticeCanvas.c, latticeCanvas.x, latticeCanvas.y);
  bctx.globalAlpha = 1; bctx.globalCompositeOperation = 'source-over';
}

stage.onResize((w, h, dpr) => {
  W = w; H = h; DPR = dpr;
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  if (tone) { const s = renderer.getDrawingBufferSize(new THREE.Vector2()); tone.setSize(s.x, s.y); }
  reflRT.setSize(Math.max(16, Math.round(w * dpr / 4)), Math.max(16, Math.round(h * dpr / 4)));
  backdrop.width = Math.round(w * dpr); backdrop.height = Math.round(h * dpr);
  measureCase(); rebuildBackdrops();
});

function measureCase() {
  if (!bounds) return;
  setCamera(0);
  const c = bounds.getCenter(new THREE.Vector3()).applyMatrix4(slotMatrix(0)).project(camera);
  caseY = (1 - c.y) / 2 * H;
}

// ---- per-frame ----------------------------------------------------------------------------------------
let lastBlendKey = '';
function render(frame) {
  if (!boxes) return;
  const pages = frame.position;
  const angle = setCamera(pages);
  const cameraAngle = Math.atan2(camera.position.z - centre.z, camera.position.x - centre.x);
  const near = Math.round(pages);
  const used = new Set();
  let reflect = null, reflectW = 0;
  for (let j = near - 2; j <= near + 2; j++) {
    const stop = STOPS[((j % 4) + 4) % 4];
    const rel = SPEC.frontAngle - j * STEP - cameraAngle;
    const ang = Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel)));
    if (ang > EXIT_END || used.has(stop.key)) continue;
    used.add(stop.key);
    const obj = boxes[stop.key].object;
    const m = slotMatrix(j);
    m.premultiply(new THREE.Matrix4().makeTranslation(exitOffset(ang, m)));
    obj.matrixAutoUpdate = false; obj.matrix.copy(m); obj.visible = true;
    BOX.setEnvRotationY(obj, envRotation);
    const w = reflectionWeight(pages - j);
    if (w > reflectW) { reflectW = w; reflect = { obj, m }; }
  }
  for (const s of STOPS) if (!used.has(s.key)) boxes[s.key].object.visible = false;
  scene.updateMatrixWorld(true);

  const blend = frame.blend; const key = `${blend.lower}:${blend.upper}:${blend.amount.toFixed(4)}`;
  if (key !== lastBlendKey) { drawBackdrop(blend); lastBlendKey = key; }

  // everything goes into the tone pass's linear HDR target, then the AgX MHC LUT runs once (BOX.md)
  renderer.autoClear = false;
  tone.begin();
  if (reflect && reflectW > 0.001) {
    // mirror the nearest box about the floor plane, render it low-res, blur, composite at low opacity
    const mirror = new THREE.Matrix4().makeTranslation(0, 2 * SPEC.floorY, 0).multiply(new THREE.Matrix4().makeScale(1, -1, 1));
    const parent = reflect.obj.parent;
    reflScene.add(reflect.obj);
    reflect.obj.matrix.copy(mirror.multiply(reflect.m)); reflect.obj.updateMatrixWorld(true);
    renderer.setRenderTarget(reflRT); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(reflScene, camera);
    renderer.setRenderTarget(tone.target);
    parent.add(reflect.obj); reflect.obj.matrix.copy(reflect.m); reflect.obj.updateMatrixWorld(true);
    quadMat.uniforms.amount.value = 0.22 * reflectW;
    renderer.render(quadScene, quadCam);
  }
  renderer.render(scene, camera);
  tone.finish();
}

// ---- boot ---------------------------------------------------------------------------------------------
(async () => {
  const A = new URL('../assets/', import.meta.url).href;
  const [a, b, l190, l1885, pattern, studio] = await Promise.all([
    img(A + 'home_glow_a.png'), img(A + 'home_glow_b.png'), img(A + 'home_glow_light_190.png'), img(A + 'home_glow_light_1885.png'),
    img(A + 'home_pattern@2x.png'), loadStudioBoxes(renderer, STOPS, { aspect: W / H }),
  ]);
  glow = { a, b, light190: l190, light1885: l1885, pattern };
  boxes = studio.boxes; tone = studio.tone;
  { const s = renderer.getDrawingBufferSize(new THREE.Vector2()); tone.setSize(s.x, s.y); }
  if (ENV !== 1) for (const k in boxes) boxes[k].object.traverse((o) => { if (o.isMesh) o.material.envMapIntensity *= ENV; });
  // home camera of camera.json, placed relative to the front ring slot (the box sits at the origin there)
  homeSpec = studio.camera.userData.spec.three;
  const frontM = slotMatrix(0);
  homePos0 = new THREE.Vector3(...homeSpec.position).applyMatrix4(frontM);
  homeQ0 = studio.camera.quaternion.clone().premultiply(new THREE.Quaternion().setFromRotationMatrix(frontM));
  const ring = new THREE.Group(); scene.add(ring);
  for (const s of STOPS) ring.add(boxes[s.key].object);
  bounds = boxes.obsidian.bounds.clone();
  // frontBottomSlope: lowest front-box corner seen from the rest camera, in camera space (y / -z)
  const front = new THREE.Vector3(...SPEC.frontPosition), qInv = camQ0.clone().invert();
  frontBottomSlope = Infinity;
  for (const c of corners(bounds)) {
    const local = new THREE.Vector3(c.x, c.y, c.z).add(front).sub(camPos0).applyQuaternion(qInv);
    frontBottomSlope = Math.min(frontBottomSlope, local.y / -local.z);
  }
  measureCase(); rebuildBackdrops();
  const sources = Object.fromEntries(STOPS.map((s) => [s.key, boxes[s.key].source]));
  stage.setInfo({ name: 'baseline (today)', boxSources: sources, camera: CAM, boxLook: 'shared/box studio env per part + AgX MHC LUT', themes: Object.fromEntries(Object.entries(TODAY_THEMES).map(([k, v]) => [k, v.source])),
    renderer: (() => { const gl = renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })(),
    reducedMotionNote: 'today\'s native carousel has no reduced-motion branch (NativeBoxes*: none); the baseline does the same' });
  const note = document.getElementById('placeholder-note');
  const ph = Object.entries(sources).filter(([, v]) => v !== 'glb');
  if (note && ph.length) note.textContent = 'placeholder box: ' + ph.map(([k, v]) => `${k} (${v})`).join(', ');
  stage.onFrame(render);
  if (params.has('p')) stage.setPosition(+params.get('p'));
  stage.start();
  let n = 0; stage.onFrame(() => { if (++n === 3) stage.markReady(); });
})();
