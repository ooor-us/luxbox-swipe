// The one sun and the window it shines through (round 3).
// The back wall has one tall opening. Four theme screens hang in it like a filmstrip: a mullioned window (Ivory),
// a reeded glass pane (Reeded), an open loggia onto water (Riviera) and a slatted screen before a desert dawn
// (Desert). Dragging slides the strip through the opening in the direction of travel. The same strip is the slide
// in the one live SpotLight (its .map, a 512 render target), so the light on the floor and the screen in the
// window are the same object: halfway, the floor shows the trailing half of one pattern and the leading half of
// the next, with the shadow of the pier between them. Where day turns to shade the pier is wide (a wall section
// between two openings), so the sun passes behind masonry while the room's light changes (look.js sweep).
// Budget: 512 slide target, re-rendered only when the strip moved or the caustic is in the gate; 512 shadow map,
// re-rendered only when the sun or a box moved.
import * as THREE from 'three';

// per stop: sun elevation / azimuth (deg; azimuth 0 = from the camera side, 90 = from screen right, 180 = from
// behind, through the window), aim point, slide colour (linear), gain, and the slide's zoom in the gate.
export const KEYS = [
  { name: 'window', el: 24, az: 318, tgt: [-2.4, -0.45, -1.0], col: [1.0, 0.74, 0.46], gain: 1.0, zoom: 1.0 },   // Ivory: gold morning sun through mullions
  { name: 'reeds', el: 32, az: 326, tgt: [-2.6, -0.45, -1.0], col: [0.66, 0.82, 1.0], gain: 0.95, zoom: 1.0 },   // Reeded: cool blue-hour light through reeded glass
  { name: 'caustic', el: 40, az: 332, tgt: [-2.0, -0.45, -0.6], col: [1, 1, 1], gain: 1.0, zoom: 1.0 },         // Riviera: sun off water, a caustic pool
  { name: 'slats', el: 16, az: 304, tgt: [-2.8, -0.45, -1.0], col: [1.0, 0.58, 0.60], gain: 1.0, zoom: 1.1 },    // Desert: low rose sun through slats
];
// gap between two slides on the strip (pages of strip): a pier between two screens.
export const GAPS = [0.16, 0.16, 0.16, 0.16];   // round 4: one pier width everywhere (no day/shade flips)

const STRIP = `
uniform sampler2D tWin, tReed, tSlat, tCaus;
uniform float uPos, uTime, uFeather, uDir; uniform float uGap[4];
uniform vec3 uCol[4]; uniform float uGain[4]; uniform float uZoom[4];
float gapOf(int i) { return i == 0 ? uGap[0] : i == 1 ? uGap[1] : i == 2 ? uGap[2] : uGap[3]; }
float zoomOf(int k) { return k == 0 ? uZoom[0] : k == 1 ? uZoom[1] : k == 2 ? uZoom[2] : uZoom[3]; }
float mask(int k, vec2 uv) {   // 1 = light passes
  if (k == 0) return texture2D(tWin, uv).r;
  if (k == 1) return texture2D(tReed, uv).r;
  if (k == 3) return texture2D(tSlat, uv).r;
  return 1.0;
}
// strip position: which slide covers x (0..1 across the gate) and where in it. edge = the slide's soft mount.
void stripAt(float x, out int i, out int j, out float si, out float sj, out float g) {
  float p = mod(uPos, 4.0); float fi = floor(p); float t = p - fi;
  i = int(fi); j = int(mod(fi + 1.0, 4.0)); g = gapOf(i);
  x = uDir > 0.0 ? x : 1.0 - x;
  si = x + t * (1.0 + g); sj = si - 1.0 - g;
}
float edgeOf(float s) { return smoothstep(0.0, uFeather, s) * smoothstep(1.0, 1.0 - uFeather, s); }
`;

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `precision highp float;
${STRIP}
varying vec2 vUv;
vec3 caustic(vec2 uv) {
  vec2 q = uv * 2.4;
  float a = texture2D(tCaus, q + uTime * vec2(0.021, 0.013)).r;
  float b = texture2D(tCaus, q * 1.17 + vec2(0.37, 0.11) - uTime * vec2(0.015, 0.019)).r;
  float c = clamp(sqrt(a * b) * 1.7 + 0.22 * (a + b), 0.0, 1.4);
  vec2 d = (uv - vec2(0.5, 0.42)) / vec2(0.34, 0.30);
  float pool = 1.0 - smoothstep(0.40, 1.0, length(d));
  vec3 aqua = vec3(0.55, 1.0, 0.92), gold = vec3(1.0, 0.60, 0.24);
  return (mix(gold, aqua, smoothstep(0.35, 1.0, c)) * c + vec3(0.14, 0.22, 0.20)) * pool;
}
vec3 slide(int k, float s, float y) {
  if (s <= 0.0 || s >= 1.0) return vec3(0.0);
  float e = edgeOf(s);
  vec2 uv = (vec2(s, y) - 0.5) * zoomOf(k) + 0.5;
  if (uv.y <= 0.0 || uv.y >= 1.0 || uv.x <= 0.0 || uv.x >= 1.0) return vec3(0.0);
  if (k == 2) return caustic(uv) * uGain[2] * e;
  vec3 col = k == 0 ? uCol[0] : k == 1 ? uCol[1] : uCol[3];
  float gn = k == 0 ? uGain[0] : k == 1 ? uGain[1] : uGain[3];
  return vec3(mask(k, uv)) * col * gn * e;
}
void main() {
  int i, j; float si, sj, g; stripAt(vUv.x, i, j, si, sj, g);
  gl_FragColor = vec4(slide(i, si, vUv.y) + slide(j, sj, vUv.y), 1.0);
}`;

// the window glazing: what you see through the opening. Each screen in front of its own view; the strip is the
// same one as the gate's, so the screen you see is the slide the sun is shining through.
const WIN_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WIN_FRAG = `precision highp float;
${STRIP}
uniform float uWinGain; uniform vec3 uFrame;
varying vec2 vUv;
vec3 view(int k, vec2 uv) {
  float y = uv.y;
  if (k == 0) return mix(vec3(1.00, 0.80, 0.55), vec3(0.95, 0.88, 0.74), y) * 1.45;           // warm morning sky
  if (k == 1) return mix(vec3(0.78, 0.86, 0.96), vec3(0.88, 0.92, 0.98), y) * 1.35;           // cool bright day
  if (k == 2) {                                                                                // a loggia onto water
    float hz = 0.36;
    vec3 sky = mix(vec3(0.10, 0.20, 0.21), vec3(0.035, 0.07, 0.08), smoothstep(hz, 1.0, y));
    vec2 q = vec2(uv.x * 2.6, y * 7.0);
    float a = texture2D(tCaus, q * vec2(1.0, 0.35) + uTime * vec2(0.03, 0.0)).r;
    float b = texture2D(tCaus, q * vec2(1.3, 0.45) + vec2(0.3, 0.1) - uTime * vec2(0.022, 0.0)).r;
    float glint = smoothstep(0.55, 1.0, sqrt(a * b) * 1.6) * smoothstep(0.0, hz, y);
    vec3 water = mix(vec3(0.03, 0.16, 0.16), vec3(0.08, 0.34, 0.31), y / hz) + glint * vec3(0.9, 0.85, 0.55) * 0.9;
    vec3 c = y < hz ? water : sky;
    return c + vec3(0.3, 0.34, 0.3) * exp(-abs(y - hz) * 60.0);                                // the bright water edge
  }
  float dune = 0.20 + 0.05 * sin(uv.x * 5.0 + 1.2) + 0.03 * sin(uv.x * 11.0);                  // desert dawn
  vec3 sky = mix(vec3(0.95, 0.52, 0.34), vec3(0.16, 0.10, 0.20), smoothstep(dune, 0.6, y));
  vec3 sand = mix(vec3(0.20, 0.10, 0.10), vec3(0.34, 0.18, 0.14), y / dune);
  return (y < dune ? sand : sky) * 0.85;
}
vec3 win(int k, float s, float y) {
  if (s <= 0.0 || s >= 1.0) return uFrame;
  float e = edgeOf(s);
  vec2 uv = vec2(s, y);
  vec2 mv = (uv - 0.5) * zoomOf(k) + 0.5;
  float m = (k == 2) ? 1.0 : mask(k, clamp(mv, 0.001, 0.999));
  if (k == 1) m = 0.55 + 0.45 * m;      // reeded glass: light everywhere, brighter in the flutes
  vec3 frame = uFrame * (k == 3 ? vec3(0.9, 0.62, 0.5) : vec3(1.0));
  return mix(uFrame, mix(frame, view(k, uv), m), e);
}
void main() {
  // the opening shows the inner 88 % of the slide, so at rest its soft mount edge sits behind the reveals
  int i, j; float si, sj, g; stripAt(0.06 + 0.88 * vUv.x, i, j, si, sj, g);
  vec3 c = (si < 1.0) ? win(i, si, vUv.y) : win(j, sj, vUv.y);
  gl_FragColor = vec4(c * uWinGain, 1.0);
}`;

export async function createKeyLight(renderer, scene, room, { base = './assets/', size = 512, shadow = 512 } = {}) {
  const loader = new THREE.TextureLoader();
  const load = (f) => loader.loadAsync(base + f).then((t) => { t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; return t; });
  const [tWin, tReed, tSlat, tCaus] = await Promise.all(['gobo-window.png', 'gobo-reeds.png', 'gobo-slats.png', 'gobo-caustic.png'].map(load));
  tCaus.wrapS = tCaus.wrapT = THREE.RepeatWrapping;
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, generateMipmaps: false, depthBuffer: false });
  const uniforms = { tWin: { value: tWin }, tReed: { value: tReed }, tSlat: { value: tSlat }, tCaus: { value: tCaus },
    uPos: { value: 0 }, uTime: { value: 0 }, uFeather: { value: 0.18 }, uDir: { value: -1 }, uGap: { value: GAPS.slice() },
    uCol: { value: KEYS.map((k) => new THREE.Vector3(...k.col)) }, uGain: { value: KEYS.map((k) => k.gain) }, uZoom: { value: KEYS.map((k) => k.zoom || 1) } };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, uniforms });
  const qs = new THREE.Scene(); qs.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // round 4: no glazing in view. The window is out of frame (camera left); the room sees it only as its light.
  const spot = new THREE.SpotLight(0xffffff, 1, 0, 0.21, 0.45, 0);
  spot.map = rt.texture;
  spot.castShadow = true;
  spot.shadow.mapSize.set(shadow, shadow);
  spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.02; spot.shadow.radius = 2.0;
  spot.shadow.camera.near = 14; spot.shadow.camera.far = 44;
  scene.add(spot); scene.add(spot.target);

  const TARGET = new THREE.Vector3(), TA = new THREE.Vector3(), TB = new THREE.Vector3(), DIST = 28;
  let lastPos = NaN, lastTime = NaN;
  const stats = { slideRenders: 0 };
  return {
    spot, rt, uniforms, stats,
    intensity: 6.0,
    /** pos: pages (the strip and the sun follow the finger 1:1). Returns true when the sun moved. */
    update(pos, time) {
      const n = 4, p = ((pos % n) + n) % n, i = Math.floor(p), t = p - i, j = (i + 1) % n;
      const u = t * t * (3 - 2 * t);
      const A = KEYS[i], B = KEYS[j];
      TARGET.copy(TA.fromArray(A.tgt)).lerp(TB.fromArray(B.tgt), u);
      const el = THREE.MathUtils.degToRad(A.el + (B.el - A.el) * u), az = THREE.MathUtils.degToRad(A.az + (B.az - A.az) * u);
      spot.position.set(TARGET.x + DIST * Math.cos(el) * Math.cos(az), TARGET.y + DIST * Math.sin(el), TARGET.z - DIST * Math.cos(el) * Math.sin(az));
      spot.target.position.copy(TARGET);
      spot.intensity = this.intensity;
      const moved = p !== lastPos;
      // the caustic animates: the gate and the window's water re-render every frame only while it is in view
      const inGate = i === 2 || (j === 2 && t > 0.3) || (i === 1 && t > 0.6);
      uniforms.uTime.value = time;
      if (moved || (inGate && time !== lastTime)) {
        uniforms.uPos.value = p;
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(rt); renderer.render(qs, qc); renderer.setRenderTarget(prev);
        stats.slideRenders++;
      }
      lastPos = p; lastTime = time;
      return moved;
    },
  };
}
