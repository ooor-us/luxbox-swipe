// P2 Rotunda, round 4 (see NOTES.md for what each round changed). One round room, twelve bays (the four stops three times round), one box per bay on a ring,
// facing the centre. Each bay is a lit display niche under a slim cornice, with the bay's own hue in the shadowed
// drum above. The home camera (pitched 15 degrees like the native ring, lens-shifted so the box bottom sits at
// 393 pt) is carried round the room's vertical axis: one stop = 30 degrees of yaw about the room centre, which
// lies 3 units in front of the lens, so the camera pans and dollies at once.
//
// Per frame: (1) a half-resolution mirror pass (room walls + the visible boxes, reflected in the floor plane) for the
// honed floor; (2) the baked room, unlit, with the reflection, a honed-stone detail tile, contact-shadow blobs and
// Riviera's live caustics; (3) the boxes in the kit's HDR tone target (studio env + their own bay's light), then
// the AgX MHC LUT composited over the room. All geometry and the rig come from the bake (assets/bake.json).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../../shared/js/stage.js';
import { STOPS, TINTS, tierLabel } from '../../shared/js/stops.js';
import { loadStudioBoxes } from '../../shared/js/box.js';
import * as BOX from '../../shared/box/box.js';
import { params } from '../../shared/js/proto-api.js';
import { smoothstep } from '../../shared/js/motion.js';

const ASSETS = new URL('../assets/', import.meta.url).href;
const RIG = await (await fetch(ASSETS + 'bake.json', { cache: 'no-cache' })).json();
const R = RIG.room, C = RIG.camera;
const STEP = (R.STEP_deg * Math.PI) / 180;
const RB = +(params.get('rb') ?? R.RB), ZF = R.ZF, RI = R.RI;
const PITCH = (C.pitch_deg * Math.PI) / 180;
const CAM0 = new THREE.Vector3(RB - C.dist, C.height, 0);                       // bay-0 camera, three.js frame
const LOOK0 = CAM0.clone().add(new THREE.Vector3(Math.cos(PITCH), -Math.sin(PITCH), 0));
// Round 3: the lens pulls back 3 % (?zoom=) so each neighbour shows an 18-24 pt sliver at rest; the lens shift is
// re-solved so the box bottom still lands on 393 pt.
const ZOOM = +(params.get('zoom') ?? 0.97);
const YT = 1 - 2 * C.box_bottom_pt / 812;
const SHIFT = YT - (YT - C.shift_ndc) * ZOOM;
const FOV = (2 * Math.atan(Math.tan((C.fov_deg * Math.PI) / 360) / ZOOM) * 180) / Math.PI;

// View all tabs are light metal on every stop (dark ink), so the tab never interpolates through a mid tone.
// ---------------- UI tints: light ink on every stop (see NOTES: the drum is dark in every bay) ----------------
const L = TINTS.riviera;
const TINT = {
  ivory: { ...L, figure: '#FFF1CF', glassBottom: '#EBD9BD', glassShade: '#2E261E', glassShadeOpacity: 0.45, card: '#2A2119', cardOpacity: 0.45,
    viewAllA: '#DEBF80', viewAllB: '#C29C58', viewAllInk: '#1E1710', nameShadow: '#C9A25A', nameShadowOpacity: 0.3, swipe: 'riviera' },
  reeded: { ...L, figure: '#E8F1FA', glassBottom: '#CFE0EE', glassShade: '#1C2A47', glassShadeOpacity: 0.5, card: '#18212E', cardOpacity: 0.5,
    viewAllA: '#BFDBEF', viewAllB: '#98BAD4', viewAllInk: '#0E1622', plusA: '#A4CEE9', plusB: '#A4CEE9', nameShadow: '#668CF2', nameShadowOpacity: 0.25, swipe: 'today' },
  riviera: { ...L, card: '#14282A', cardOpacity: 0.45, viewAllA: '#BDE4E0', viewAllB: '#8CC4C0', viewAllInk: '#0E1F22', nameShadow: '#46C6D8', nameShadowOpacity: 0.2 },
  desert: { ...TINTS.desert },
};
const tints = STOPS.map((s) => ({ ...TINT[s.ui], polarity: 'light' }));

const stage = createStage({
  name: 'p2 · Rotunda',
  tints,
  maxDpr: 2,                                  // the canvas renders at most 2x (a 3x phone upscales the canvas only; UI text stays native)
  // round 3: native motion (gain 1.4, commit 0.28); ?gain= / ?commit= only for experiments
  motion: { ...(params.has('gain') ? { gain: +params.get('gain') } : {}), ...(params.has('commit') ? { commitStep: +params.get('commit') } : {}) },
  onTap: (t, s) => { s.el.animate([{ filter: 'brightness(1.05)' }, { filter: 'none' }], 240); }, // feedback only, never opens
});

const renderer = new THREE.WebGLRenderer({ canvas: stage.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
renderer.setClearColor(0x0d0b0a, 1);
const camera = new THREE.PerspectiveCamera(FOV, stage.width / stage.height, 0.1, 200);

function updateProjection() {
  camera.aspect = stage.width / stage.height; camera.updateProjectionMatrix();
  camera.projectionMatrix.elements[9] -= SHIFT;                 // lens shift: ndc.y += SHIFT
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

// ---------------- room (baked) ----------------
const texLoader = new THREE.TextureLoader();
const tex = (name, { repeat = false, aniso = 4 } = {}) => new Promise((res) => texLoader.load(ASSETS + name, (t) => {
  t.colorSpace = THREE.NoColorSpace;  // display-referred bytes, passed straight through
  t.anisotropy = Math.min(aniso, renderer.capabilities.getMaxAnisotropy());
  t.flipY = false;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  res(t);
}));

const ROOM_VERT = `varying vec2 vUv; varying vec3 vW;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const ROOM_FRAG = `precision highp float;
  uniform sampler2D tMap, tReach, tCaustic, tRefl, tDetail;
  uniform float uTime, uCaustic, uIsWall, uRefl, uRI, uMirror; uniform vec2 uRes; varying vec2 vUv; varying vec3 vW;
  uniform vec3 uGain[4]; uniform float uSat[4]; uniform vec3 uSpill[4]; uniform float uSpillW, uDrum, uDrumTop, uGradeOn, uCorner, uPilLift, uFoot, uUSign, uFloorBlend, uStrip;
  uniform vec3 uDrumLo[4], uDrumHi[4];
  // round 3: each bay's colour grade (matched to its box) and the light it throws across the pilaster onto the
  // neighbouring 15 % of wall. Bay k is centred on angle k * STEP; boundaries sit at half-integers of b.
  vec3 grade(vec3 c, int i) { float y = dot(c, vec3(0.2126, 0.7152, 0.0722)); return mix(vec3(y), c, uSat[i]) * uGain[i]; }
  void main() {
    vec3 c = texture2D(tMap, vUv).rgb;
    float r = length(vW.xz);
    if (uGradeOn > 0.5) {
      float b = atan(vW.z, vW.x) / ${STEP.toFixed(6)};
      float kc = floor(b + 0.5), e = b - kc;
      int i = int(mod(kc, 4.0)), j = int(mod(kc + (e >= 0.0 ? 1.0 : -1.0), 4.0));
      float w = 0.5 * (1.0 - smoothstep(0.0, uSpillW, 0.5 - abs(e)));   // 0.5 on the boundary, 0 a spill-width in
      if (uIsWall < 0.5) {
        // round 4: the floor band changes stone at every bay boundary. Blend the baked floor with its mirror image
        // across the nearest boundary (same sample on the boundary itself), so the inlay change is a soft joint
        // instead of a straight step. u runs across one 4-bay period of the polar atlas.
        // Both samples are pushed out past the baked brass joint strip (uStrip, in bays), so the strip itself is
        // replaced by the blend: no straight line remains at the boundary.
        float wf = 0.5 * (1.0 - smoothstep(0.0, uFloorBlend, 0.5 - abs(e)));
        float se = e >= 0.0 ? 1.0 : -1.0, dist = max(0.5 - abs(e), uStrip);
        float dOwn = se * (0.5 - dist) - e, dMir = se * (0.5 + dist) - e;
        vec3 cOwn = texture2D(tMap, vUv + vec2(uUSign * dOwn * 0.25, 0.0)).rgb;
        vec3 cMir = texture2D(tMap, vUv + vec2(uUSign * dMir * 0.25, 0.0)).rgb;
        c = mix(cOwn, cMir, wf);
      }
      float reach = uIsWall > 0.5 ? 1.0 : smoothstep(2.0, uRI, r) * 0.7 + 0.3 * smoothstep(uRI - 0.4, uRI + 0.2, r);
      vec3 g = mix(grade(c, i), grade(c, j), w);
      float sw = (2.0 * w) * (2.0 * w);
      // the neighbour's light falling across; on the boundary itself both bays' spill meet half and half, so the
      // term is identical from either side (round 3 added only the far bay's spill: a step at every boundary)
      g += c * sw * mix(uSpill[j], 0.5 * (uSpill[i] + uSpill[j]), sw);
      c = mix(c, g, reach);
      float ae = abs(e);
      if (uIsWall > 0.5) {                                                // the drum above the cornice stays in shadow
        float h = vW.y - (${ZF.toFixed(4)});
        bool pil = r < ${(R.RW - 0.03).toFixed(3)};                        // pilaster faces stand proud of the wall
        if (h < ${R.ZC.toFixed(3)} && !pil) c *= mix(1.0, uCorner, smoothstep(0.24, 0.47, ae));   // the niche light falls off into its jambs
        if (pil) c *= uPilLift;                                         // the pilaster: one even tone between the two bays' light
      } else {
        // the pilaster shades the floor band at its foot (round 4: radially soft, no ring edge)
        c *= mix(1.0, uFoot, smoothstep(0.18, 0.5, ae) * smoothstep(uRI - 0.6, uRI - 0.1, r));
      }
      if (uIsWall > 0.5) {
        float h = vW.y - (${ZF.toFixed(4)});
        float d = smoothstep(${(R.ZC - 0.05).toFixed(3)}, ${(R.ZC + 0.9).toFixed(3)}, h);
        // round 4: the drum is a soft bay-tinted falloff (a warm glow off the niche fading up into a deep tint of
        // the bay's colour) instead of the baked stone darkened to brown-black. The baked luminance survives as a
        // gentle modulation, so the cornice and the stone still read.
        float t2 = smoothstep(${(R.ZC + 0.2).toFixed(3)}, ${(R.ZC + 5.0).toFixed(3)}, h);
        vec3 lo = mix(uDrumLo[i], uDrumLo[j], w), hi = mix(uDrumHi[i], uDrumHi[j], w);
        float yb = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 tint = mix(lo, hi, t2) * (0.8 + 0.5 * clamp(yb / 0.45, 0.0, 1.0));
        c = mix(c, tint, d * uDrum);
      }
    }
    if (uIsWall < 0.5 && r < uRI && uMirror < 0.5) {
      // honed stone: a fine detail tile on top of the baked light, and the blurred floor reflection
      float d = texture2D(tDetail, vW.xz * 0.45).r - 0.5;
      c *= 1.0 + d * 0.22;
      vec2 s = gl_FragCoord.xy / uRes;
      vec2 o = vec2(1.5, 2.5) / uRes * 2.0;
      vec3 rf = texture2D(tRefl, s + vec2(o.x, 0.0)).rgb + texture2D(tRefl, s - vec2(o.x, 0.0)).rgb
              + texture2D(tRefl, s + vec2(0.0, o.y)).rgb + texture2D(tRefl, s - vec2(0.0, o.y)).rgb;
      rf *= 0.25;
      float edge = smoothstep(uRI, uRI - 0.35, r);                   // the threshold ring is not polished
      c += rf * uRefl * edge;
    }
    if (uCaustic > 0.0) {
      vec2 p = uIsWall > 0.5 ? vec2(atan(vW.z, vW.x) * 10.0, vW.y) : vW.xz;
      vec2 q = p * 0.22;
      float a = texture2D(tCaustic, q + vec2(uTime * 0.021, uTime * 0.013)).r;
      float b = texture2D(tCaustic, q * 1.37 + vec2(-uTime * 0.017, uTime * 0.024) + 0.31).r;
      float k = min(a * b * 2.2, 0.55) + (a + b) * 0.08;
      float reach = texture2D(tReach, vUv).r; reach = reach * reach * smoothstep(0.0, 0.5, reach);
      if (uIsWall > 0.5) reach *= 1.0 - smoothstep(${(R.ZC - 0.25).toFixed(3)}, ${(R.ZC + 0.05).toFixed(3)}, vW.y - (${ZF.toFixed(4)}));  // caustics stay in the niche
      c += vec3(0.80, 1.0, 0.95) * k * reach * uCaustic;
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

// per-bay grade (display-referred gain + saturation), matched to the box: Obsidian keeps its warm honey, Sapphire
// goes deep navy, Emerald a green-black world, Amethyst a rose-plum dawn. uSpill = the neighbour's light colour.
const G = (k, d) => (params.get(k) ?? d).split(',').map(Number);
const GRADE = [
  { gain: G('g0', '0.92,0.80,0.62'), sat: 1.05, spill: G('s0', '0.10,0.06,0.02') },
  { gain: G('g1', '0.42,0.55,0.86'), sat: 0.75, spill: G('s1', '0.00,0.03,0.10') },
  { gain: G('g2', '0.28,0.52,0.45'), sat: 0.80, spill: G('s2', '0.00,0.06,0.05') },
  { gain: G('g3', '0.50,0.40,0.74'), sat: 0.80, spill: G('s3', '0.08,0.03,0.06') },
];
const GRADE_U = {
  uGain: { value: GRADE.map((g) => new THREE.Vector3(...g.gain)) }, uSat: { value: GRADE.map((g) => g.sat) },
  uSpill: { value: GRADE.map((g) => new THREE.Vector3(...g.spill)) }, uSpillW: { value: +(params.get('spillw') ?? 0.15) },
  uDrum: { value: +(params.get('drum') ?? 1) }, uDrumTop: { value: +(params.get('drumtop') ?? 0.6) },
  uGradeOn: { value: params.get('grade') === '0' ? 0 : 1 },
  uUSign: { value: +(params.get('usign') ?? 1) }, uFloorBlend: { value: +(params.get("floorblend") ?? 0.3) }, uStrip: { value: +(params.get("strip") ?? 0.035) },
  // drum tints, display-referred 0..1: just above the cornice (lo) and at the top of the frame (hi)
  uDrumLo: { value: [[0.20, 0.135, 0.07], [0.075, 0.11, 0.20], [0.05, 0.13, 0.11], [0.17, 0.10, 0.17]].map((v) => new THREE.Vector3(...v)) },
  uDrumHi: { value: [[0.075, 0.05, 0.03], [0.03, 0.045, 0.085], [0.02, 0.05, 0.045], [0.07, 0.04, 0.07]].map((v) => new THREE.Vector3(...v)) },
  uCorner: { value: +(params.get('corner') ?? 0.2) }, uPilLift: { value: +(params.get('pil') ?? 0.5) }, uFoot: { value: +(params.get("foot") ?? 0.6) },
};
const roomScene = new THREE.Scene();
const boxScene = new THREE.Scene();
const roomU = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uMirror: { value: 0 }, tRefl: { value: null } };
const floors = [], blobs = [];

async function loadRoom() {
  const [gltf, wall, floor, wallR, floorR, caustic, detail, blob] = await Promise.all([
    new GLTFLoader().loadAsync(ASSETS + 'room.glb'), tex('wall.jpg', { aniso: 8 }), tex('floor.jpg', { aniso: 8 }),
    tex('wall-caustic.png'), tex('floor-caustic.png'), tex('caustic-tile.png', { repeat: true }), tex('detail.png', { repeat: true }), tex('blob.png')]);
  blob.wrapS = blob.wrapT = THREE.ClampToEdgeWrapping;
  const mat = (map, reach, isWall) => new THREE.ShaderMaterial({ vertexShader: ROOM_VERT, fragmentShader: ROOM_FRAG,
    uniforms: { tMap: { value: map }, tReach: { value: reach }, tCaustic: { value: caustic }, tDetail: { value: detail },
      tRefl: roomU.tRefl, uTime: roomU.uTime, uRes: roomU.uRes, uMirror: roomU.uMirror, uRI: { value: RI },
      uRefl: { value: params.get('mirror') === '0' ? 0 : +(params.get('refl') ?? 0.3) },
      uCaustic: { value: params.get('caustic') !== '0' ? 0.38 : 0 }, uIsWall: { value: isWall ? 1 : 0 }, ...GRADE_U }, side: THREE.DoubleSide });
  const meshesOf = (n) => { const out = []; gltf.scene.getObjectByName(n).traverse((o) => { if (o.isMesh) out.push(o); }); return out; };
  const wallM = mat(wall, wallR, true), floorM = mat(floor, floorR, false);
  for (const [name, m, list] of [['Wall_P0', wallM, null], ['Floor_P0', floorM, floors]]) {
    for (const mesh of meshesOf(name)) {
      for (let c = 0; c < 3; c++) {
        const o = new THREE.Mesh(mesh.geometry, m); o.rotation.y = -c * (2 * Math.PI / 3); roomScene.add(o);
        if (list) list.push(o);
      }
    }
  }
  // contact-shadow blobs under every box (multiply), tuned so the floor at the box edge sits 4-8 % darker
  const bm = new THREE.ShaderMaterial({ vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tBlob; uniform float uK; varying vec2 vUv; void main() { float a = texture2D(tBlob, vUv).r; gl_FragColor = vec4(vec3(1.0 - uK * a), 1.0); }`,
    uniforms: { tBlob: { value: blob }, uK: { value: +(params.get('blob') ?? 0.55) } }, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const bg = new THREE.PlaneGeometry(3.6, 3.2); bg.rotateX(-Math.PI / 2);
  for (let k = 0; k < 12; k++) {
    const th = -k * STEP, o = new THREE.Mesh(bg, bm);
    o.position.set((RB - 0.15) * Math.cos(th), ZF + 0.002, -(RB - 0.15) * Math.sin(th)); o.rotation.y = th; o.renderOrder = 2;
    roomScene.add(o); blobs.push(o);
  }
}

// ---------------- boxes: the four GLBs, three of each round the ring, each lit a little by its own bay ----------------
// direction towards the bay's light in the bay frame (a = out towards the wall, b = screen right, y = up), colour
// of that light on the box and a bounce from the floor (linear, added to the diffuse term only: metal parts such as
// the clasp are untouched, so the clasp stays the brightest thing on screen).
const BAY_LIGHT = [
  { dir: [0.45, -0.75, 0.45], key: [0.40, 0.29, 0.18], fill: [0.05, 0.035, 0.022], lift: G('lift0', '1.6,1.1,0.6') },     // Ivory: warm sun from the left, behind
  { dir: [0.9, 0.0, 0.35], key: [0.16, 0.22, 0.30], fill: [0.025, 0.032, 0.045], lift: G('lift1', '0.25,0.35,0.55') },     // Reeded: cool glass behind
  { dir: [0.85, 0.0, -0.25], key: [0.06, 0.26, 0.28], fill: [0.012, 0.04, 0.045], lift: G('lift2', '0.1,0.3,0.3') },      // Riviera: aqua from the water, low
  { dir: [0.35, 0.9, 0.12], key: [0.42, 0.19, 0.10], fill: [0.035, 0.022, 0.03], lift: G('lift3', '0.45,0.25,0.25') },     // Desert: apricot rake from the right
];
const boxes = [];
function bayLight(object, k) {
  const th = -k * STEP, s = BAY_LIGHT[k % 4];
  const out = new THREE.Vector3(Math.cos(th), 0, -Math.sin(th)), right = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
  const dir = out.multiplyScalar(s.dir[0]).add(right.multiplyScalar(s.dir[1])).add(new THREE.Vector3(0, s.dir[2], 0)).normalize();
  const gain = +(params.get('bay') ?? 1);
  const U = { uBayDir: { value: dir }, uBayKey: { value: new THREE.Vector3(...s.key).multiplyScalar(gain) }, uBayFill: { value: new THREE.Vector3(...s.fill).multiplyScalar(gain) },
    uBayLift: { value: new THREE.Vector3(...s.lift).multiplyScalar(gain) }, uBayIn: { value: new THREE.Vector3(-Math.cos(th), 0, Math.sin(th)) } };
  object.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'varying float vBayY;\n' + sh.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n vBayY = (modelMatrix * vec4(transformed, 1.0)).y;');
      // round 4: a warm bounce off the lit floor on the lower part of the faces turned to the room (lift), so the
      // dark leather separates from the floor; diffuse only, so the clasp and wordmarks are untouched
      sh.fragmentShader = 'uniform vec3 uBayDir, uBayKey, uBayFill, uBayLift, uBayIn; varying float vBayY;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        { vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float wrap = max(dot(nW, uBayDir) * 0.7 + 0.3, 0.0);
          float low = 1.0 - smoothstep(${(ZF + 0.05).toFixed(3)}, ${(ZF + 1.1).toFixed(3)}, vBayY);
          float face = max(dot(nW, uBayIn) * 0.8 + 0.2, 0.0) * (1.0 - max(nW.y, 0.0));
          reflectedLight.indirectDiffuse += diffuseColor.rgb * (uBayKey * wrap * wrap + uBayFill * (0.5 - 0.5 * nW.y) + uBayLift * low * face); }`);
    };
    m.customProgramCacheKey = () => 'p2bay';
    m.needsUpdate = true;
  });
}
// The Emerald lacquer is a near-mirror. Seen from this ring camera (15 degrees pitch rather than the home camera's
// 29) its lid and sides reflected the dark gaps between the studio softboxes as hard black stripes. Round 3 turns
// its environment a little (?lacqenv=, radians) and gives the clear coat a minimum roughness (?lacqrough=), so the
// lacquer shows broad soft highlights; the clasp and wordmarks are untouched.
const LACQ_ENV = +(params.get('lacqenv') ?? 0);
const LACQ_ROUGH = +(params.get('lacqrough') ?? 0.3), LACQ_BLUR = +(params.get('lacqblur') ?? 18);
// round 4: one blurred copy per source map, shared by every ring copy (round 3 made one per copy, and the copies
// that warm-up never drew uploaded their 2048 map mid-swipe: the 83-95 ms stalls at positions 2.02 and 4.65)
const _blurred = new Map();
function lacquerSoften(object) {
  object.traverse((o) => {
    if (!o.isMesh || !/^LB_(Box|Lid)$/.test(o.material.name)) return;
    // The stripes are not live reflections (turning the env does not move them, and the Cycles reference in
    // shared/box/compare.png has them too): the export baked the studio softbox reflections into the lacquer's
    // base colour. Here that map is replaced by a blurred copy (?lacqblur= px at the map's size), so the bands
    // become broad soft gradients; the clear coat also gets a minimum roughness. Nothing in shared/ is changed.
    const m = o.material;
    m.clearcoatRoughness = Math.max(m.clearcoatRoughness || 0, LACQ_ROUGH);
    if (m.map && m.map.image && LACQ_BLUR > 0 && _blurred.has(m.map)) { m.map = _blurred.get(m.map); }
    else if (m.map && m.map.image && LACQ_BLUR > 0) {
      const src = m.map, img = m.map.image, w = img.width, h = img.height, cv = document.createElement('canvas');
      cv.width = w; cv.height = h; const x = cv.getContext('2d');
      x.filter = `blur(${LACQ_BLUR * w / 2048}px)`; x.drawImage(img, 0, 0);
      const t = new THREE.CanvasTexture(cv); t.flipY = m.map.flipY; t.colorSpace = m.map.colorSpace; t.channel = m.map.channel;
      t.wrapS = m.map.wrapS; t.wrapT = m.map.wrapT; t.anisotropy = m.map.anisotropy;
      m.map = t; _blurred.set(src, t);
    }
    m.needsUpdate = true;
  });
}
async function loadRing() {
  const studio = await loadStudioBoxes(renderer, STOPS, { aspect: stage.width / stage.height });
  for (let k = 0; k < 12; k++) {
    const s = STOPS[k % 4];
    const object = k < 4 ? studio.boxes[s.key].object : await BOX.loadBox(s.key, studio.envs);
    const th = -k * STEP;
    object.position.set(RB * Math.cos(th), 0, -RB * Math.sin(th));
    object.rotation.y = th + Math.PI;
    bayLight(object, k);
    const lacquer = s.key === 'emerald';
    if (lacquer) lacquerSoften(object);
    boxScene.add(object); boxes.push({ object, k, lacquer });
  }
  return studio;
}

// LUT composite of an HDR target over what is already drawn (the kit's shader, premultiplied "over" instead of a copy)
const COMP_FRAG = `
  precision highp float; precision highp sampler3D;
  uniform sampler2D tScene; uniform sampler3D tLut; uniform float uExposure, uMinEV, uMaxEV, uN, uGain; varying vec2 vUv;
  void main() {
    vec4 s = texture2D(tScene, vUv);
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    c = max(c * uExposure, vec3(0.0));
    vec3 l = clamp((log2(max(c, vec3(1e-12))) - uMinEV) / (uMaxEV - uMinEV), 0.0, 1.0);
    vec3 o = texture(tLut, l * ((uN - 1.0) / uN) + 0.5 / uN).rgb;
    gl_FragColor = vec4(o * s.a * uGain, s.a * uGain);
  }`;
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const QUAD_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
function makeComposite(uniforms, gain = 1) {
  const m = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: COMP_FRAG, uniforms: { ...uniforms, uGain: { value: gain } },
    depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
  const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m)); return { scene: s, mat: m };
}

// ---------------- camera rig ----------------
// Round 3: the yaw front-loads the arrival. Measured from the stop the swipe started at (the anchor), the camera
// travel is u = f(t) = 1 - (1 - t)^K (1 + (K - 1) t). f'(0) = 1, so a drag starts exactly 1:1 and nothing jumps at
// rest; the camera then runs ahead of the finger (peak 2.8x at t 0.14 for K 6) and eases into the next bay with
// f'(1) = 0, so the last of the settle is a soft landing. f(0.25) = 0.60, f(0.5) = 0.945: at half a swipe the next
// box already stands in the centre and the room keeps turning only slightly. Monotonic for every K >= 1.
// ?ease=0 restores the linear yaw (?ease=0.5 half way), ?easek= sets K.
// Round 4 (critic: the K 6 curve ran 2.8x ahead and then stood still): a mild lead on the first page of travel only,
// f(t) = t + A t (1 - t)^2 with A 0.3. f'(0) = 1.3 (the peak gain), f' never drops below 0.9, f'(1) = 1, and past the
// first page the yaw is linear, so the curve is C1 everywhere and strictly monotonic: f(0.25) 0.29, f(0.5) 0.54,
// f(0.75) 0.76. Every finger movement moves the camera. ?ease=0 is linear, ?ease=A sets the lead.
const EASE = +(params.get('ease') ?? 0.3);
const easeT = (t) => t >= 1 ? t : t + EASE * t * (1 - t) * (1 - t);
let anchor = 0, anchorPages = 0;
function visual(pages) {
  const near = Math.round(pages);
  // re-anchor only at rest on a stop; the visual stays continuous (no 4-stop jump), the room and ring repeat every 4
  if (Math.abs(pages - near) < 1e-3 && !stage.motion.dragging && Math.abs(stage.motion.velocity) < 0.02) { anchor = near; }
  const rel = pages - anchor;
  return anchor + Math.sign(rel) * easeT(Math.abs(rel));
}
const _ax = new THREE.Vector3(0, 1, 0), _l = new THREE.Vector3(), _p = new THREE.Vector3();
const ENV_OFF = params.has('envoff') ? +params.get('envoff') : Math.PI;
function placeCamera(pages) {
  const th = -pages * STEP;
  camera.position.copy(CAM0).applyAxisAngle(_ax, th); _l.copy(LOOK0).applyAxisAngle(_ax, th);
  camera.up.set(0, 1, 0); camera.lookAt(_l); camera.updateMatrixWorld();
  const envY = th + ENV_OFF;
  for (const b of boxes) {
    const ey = envY + (b.lacquer ? LACQ_ENV : 0);
    const d = ((b.k - pages) % 12 + 18) % 12 - 6;               // offset in stops, -6..6
    b.object.visible = Math.abs(d) < 1.45;
    blobs[b.k].visible = Math.abs(d) < 1.6;
    if (b.object.visible && b.envY !== ey) { BOX.setEnvRotationY(b.object, ey); b.envY = ey; }
  }
}
/** screen x (design pt, 0..375) of box k's centre for the current camera */
function boxScreenX(k) {
  const th = -k * STEP;
  _p.set((RB - 0.15) * Math.cos(th), 0.3, -(RB - 0.15) * Math.sin(th)).project(camera);
  return (_p.x + 1) / 2 * 375;
}

// ---------------- passes ----------------
let tone = null, comp = null, reflComp = null, reflRT = null, reflHDR = null;
// Phone budget (round 3): on iOS (or ?mobile=1) the box target uses 2x MSAA and the floor reflection renders at
// quarter resolution; desktop keeps 4x and half. ?msaa= and ?reflres= override either.
const PHONE = params.get('mobile') === '1' || /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MSAA = +(params.get('msaa') ?? (PHONE ? 2 : 4));
const REFL_SCALE = +(params.get('reflres') ?? (PHONE ? 0.25 : 0.5));
function mirror(scene, on) {
  scene.scale.y = on ? -1 : 1; scene.position.y = on ? 2 * ZF : 0; scene.updateMatrixWorld(true);
}
function drawReflection() {
  for (const f of floors) f.visible = false; for (const b of blobs) b._v = b.visible, b.visible = false;
  roomU.uMirror.value = 1;
  renderer.setRenderTarget(reflRT); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, true);
  mirror(roomScene, true); renderer.render(roomScene, camera); mirror(roomScene, false);
  renderer.setRenderTarget(reflHDR); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, true);
  mirror(boxScene, true); renderer.render(boxScene, camera); mirror(boxScene, false);
  renderer.setRenderTarget(reflRT); renderer.render(reflComp.scene, quadCam);
  for (const f of floors) f.visible = true; for (const b of blobs) b.visible = b._v;
  roomU.uMirror.value = 0;
}
const BOX_ONLY = params.has('boxonly'), NO_BOXES = params.has('noboxes');   // measurement aids                          // measurement aid: the boxes on black, no room
// ?mirror=0: the mirror-free variant (round 4) - no reflection pass, the floor keeps its baked light, detail tile
// and contact shadows only. This is the variant recommended for the native app until a device soak exists.
const MIRROR = params.get('mirror') !== '0';
function drawFrame(target) {
  if (!BOX_ONLY && MIRROR) drawReflection();
  renderer.setRenderTarget(target); renderer.setClearColor(BOX_ONLY ? 0 : 0x0d0b0a, 1); renderer.clear(true, true, true);
  if (!BOX_ONLY) renderer.render(roomScene, camera);
  tone.begin(); if (!NO_BOXES) renderer.render(boxScene, camera);
  renderer.setRenderTarget(target); renderer.render(comp.scene, quadCam);
}

// reduced motion: no camera travel; the view dissolves to the new bay (300 ms)
let rtA = null, rtB = null, shownStop = null, fadeT = 1;
const blit = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT,
  fragmentShader: `uniform sampler2D tA; uniform float uA; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tA, vUv).rgb, uA); }`,
  uniforms: { tA: { value: null }, uA: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false });
const blitScene = new THREE.Scene(); blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blit));

function sizeTargets() {
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  roomU.uRes.value.set(s.x, s.y);
  if (tone) tone.setSize(s.x, s.y);
  const rw = Math.max(2, Math.round(s.x * REFL_SCALE)), rh = Math.max(2, Math.round(s.y * REFL_SCALE));
  if (!reflRT) {
    reflRT = new THREE.WebGLRenderTarget(rw, rh, { depthBuffer: true });
    reflHDR = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, depthBuffer: true });
    roomU.tRefl.value = reflRT.texture;
  } else { reflRT.setSize(rw, rh); reflHDR.setSize(rw, rh); }
  // the floor shader samples the reflection at full-res fragment coords: uRes must be the drawing buffer size
  if (rtA) { rtA.setSize(s.x, s.y); rtB.setSize(s.x, s.y); }
}
stage.onResize((w, h, dpr) => {
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  updateProjection(); sizeTargets();
});

const [studio] = await Promise.all([loadRing(), loadRoom()]);
tone = MSAA === 4 ? studio.tone : await BOX.createTone(renderer, { samples: MSAA }); sizeTargets();
comp = makeComposite(tone.uniforms);
reflComp = makeComposite({ ...tone.uniforms, tScene: { value: reflHDR.texture } });

// ---------------- UI: the name and tier ride with their own box (a caption under each box) ----------------
const NAME_TRACK = params.get('nametrack') !== '0';
// Round 3: the two captions never overlap. Each rides under its own box, but when they would collide the incoming
// one is held off to the right (first half) and then pushes the outgoing one out to the left (second half), with
// a 22 pt gap between the glyphs. Both stay fully opaque, so nothing ever shows at a fractional opacity.
const _mc = document.createElement('canvas').getContext('2d'), _w = new Map();
// widths are measured once, after the fonts are ready (no style reads inside the frame loop)
document.fonts.ready.then(() => {
  const nameEl = stage.ui.el.querySelector('p.t.name'), tierEl = stage.ui.el.querySelector('.tier p.t');
  const nf = getComputedStyle(nameEl).font, tf = getComputedStyle(tierEl).font;
  for (const s of STOPS) {
    _mc.font = nf; _w.set('n' + s.name, _mc.measureText(s.name).width);
    const t = tierLabel(s); _mc.font = tf; _w.set('t' + t, _mc.measureText(t.toUpperCase()).width + 11);
  }
});
function capWidth(text, kind) { return _w.get(kind + text) ?? 260; }
const capW = (s) => Math.max(capWidth(s.name, 'n'), capWidth(s.tier, 't'));
const CAP_GAP = 22;
stage.ui.setOverride((st) => {
  if (!NAME_TRACK || stage.reducedMotion) return null;
  const v = visual(st.pages); placeCamera(v);                   // the captions use this frame's camera
  // the ring slot of the outgoing stop nearest the camera (the visual yaw can sit a whole period away from pages)
  const k0 = st.lower + 4 * Math.round((v - st.lower - 0.5) / 4), k1 = k0 + 1;
  const bo = boxScreenX(k0) - 187.5, bi = boxScreenX(k1) - 187.5;
  // Round 4: one caption at a time. Each rides under its own box but is held fully on screen (12 pt margin); the
  // hand-off goes to whichever box is nearer the centre (10 pt hysteresis) and fades over 90 ms, so no glyph
  // fragment ever sits at the screen edge and the two names never meet.
  const clampX = (x, n) => { const m = 187.5 - capW(n) / 2 - 12; return Math.max(-m, Math.min(m, x)); };
  const xo = clampX(bo, st.nameOut), xi = clampX(bi, st.nameIn);
  if (st.nameOut.name === st.nameIn.name) {                        // at rest both slots carry the same stop
    _hand.name = st.nameOut.name; _cap.set(st.nameOut.name, { a: 1, t: performance.now() });
    return { nameOut: { ...st.nameOut, opacity: 1, dx: xo }, nameIn: { ...st.nameIn, opacity: 0, dx: xi } };
  }
  const inWins = _hand.name === st.nameIn.name ? Math.abs(bi) < Math.abs(bo) + 10 : Math.abs(bi) + 10 < Math.abs(bo);
  _hand.name = inWins ? st.nameIn.name : st.nameOut.name;
  return { nameOut: { ...st.nameOut, opacity: capAlpha(st.nameOut, !inWins), dx: xo },
           nameIn: { ...st.nameIn, opacity: capAlpha(st.nameIn, inWins), dx: xi } };
});
const _hand = { name: null };
const _cap = new Map();
function capAlpha(n, show) {
  const want = show ? 1 : 0, now = performance.now();
  let c = _cap.get(n.name);
  if (!c) { c = { a: want, t: now }; _cap.set(n.name, c); }
  const step = Math.min(1, (now - c.t) / 90); c.t = now;
  c.a = want > c.a ? Math.min(want, c.a + step) : Math.max(want, c.a - step);
  if (stage.frozen) c.a = want;                                     // frozen scrubs show the settled state
  return c.a;
}

let rmApplied = null;
stage.onFrame(({ position, time, dt, reducedMotion }) => {
  roomU.uTime.value = reducedMotion ? 0 : time;
  if (reducedMotion !== rmApplied) { stage.motion.config.omega = reducedMotion ? 26 : 18; rmApplied = reducedMotion; }
  if (!reducedMotion) { placeCamera(visual(position)); drawFrame(null); soak && soak.tick(); return; }
  if (!rtA) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    rtA = new THREE.WebGLRenderTarget(s.x, s.y); rtB = new THREE.WebGLRenderTarget(s.x, s.y);
  }
  const stop = Math.round(position);
  if (shownStop === null) shownStop = stop;
  if (stop !== shownStop) { [rtA, rtB] = [rtB, rtA]; shownStop = stop; fadeT = 0; }
  fadeT = Math.min(1, fadeT + (stage.frozen ? 1 : dt / 0.3));
  placeCamera(shownStop); drawFrame(rtA);
  renderer.setRenderTarget(null); renderer.clear();
  blit.uniforms.tA.value = rtA.texture; blit.uniforms.uA.value = 1; renderer.render(blitScene, quadCam);
  if (fadeT < 1) { const e = 1 - smoothstep(fadeT); blit.uniforms.tA.value = rtB.texture; blit.uniforms.uA.value = e; renderer.render(blitScene, quadCam); }
});

// ---------------- ?soak=30: a self-driven swipe loop with a frame-time readout, for running on a real phone ----------------
const soak = params.has('soak') ? (() => {
  const secs = +params.get('soak') || 30, el = document.createElement('div'), times = []; let t0 = null, last = 0, i = 0, nextAt = 0;
  Object.assign(el.style, { position: 'fixed', left: '8px', bottom: '8px', zIndex: 99, font: '12px/1.3 ui-monospace, monospace', color: '#fff', background: 'rgba(0,0,0,.6)', padding: '6px 8px', borderRadius: '6px', whiteSpace: 'pre' });
  document.body.appendChild(el);
  return { tick() {
    const now = performance.now(); if (t0 === null) { t0 = now; last = now; nextAt = now + 400; return; }
    const el_ = now - t0; times.push(now - last); last = now;
    if (now > nextAt && el_ < secs * 1000) { stage.motion.select(((++i) % 4)); nextAt = now + 1100; }
    if (times.length % 30 === 0 || el_ >= secs * 1000) {
      const s = [...times].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
      el.textContent = `soak ${Math.min(secs, el_ / 1000).toFixed(0)}/${secs}s  dpr ${stage.dpr}\nfps ${(1000 / q(0.5)).toFixed(1)} median\nframe p95 ${q(0.95).toFixed(1)} ms  max ${s[s.length - 1].toFixed(1)} ms`;
    }
  } };
})() : null;

stage.setInfo({
  boxSources: Object.fromEntries(STOPS.map((s) => [s.key, studio.boxes[s.key].source])),
  spatialModel: 'rotunda r4: 12 bays x 30 deg (4 stops x 3), lit niches under a cornice, boxes on a ring r 6.6 facing the centre, camera pitched 15 deg yawed about the room centre',
  reducedMotionNote: 'no camera travel: the view dissolves to the new bay over 300 ms, caustics stop, settle spring omega 26, names use the kit fade in place',
  renderScale: { maxDpr: 2, reflection: MIRROR ? REFL_SCALE : 0, msaa: MSAA, phone: PHONE }, ease: EASE, ringRadius: RB,
});
// warm-up: compile every program and upload every texture (incl. the blurred lacquer map) before the first frame,
// so no stop pays a first-visit compile or upload mid-swipe
for (const b of boxes) b.object.visible = true;
renderer.compile(boxScene, camera); renderer.compile(roomScene, camera);
for (const p of [0, 1, 2, 3, 0.5, 1.5, 2.5, 3.5]) { placeCamera(p); drawFrame(null); }
// round 4: every ring copy drawn once (round 3's warm-up only drew the copies near stops 0-3)
for (let p = 0; p < 12; p += 0.5) { placeCamera(p); drawFrame(null); }
placeCamera(0);
window.__p2 = { THREE, camera, boxes, visual, boxScreenX, RB, STEP };
stage.start();
let n = 0; stage.onFrame(() => { if (++n === 3) stage.markReady(); });
