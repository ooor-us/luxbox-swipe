// LuxBox chest for the swipe prototypes: load a stop's GLB, give every part the studio environment it receives in the
// approved Cycles rig, set up the home camera and Blender's AgX "Medium High Contrast" tone (3D LUT). three.js r170.
//
//   import * as BOX from '../shared/box/box.js';
//   const envs = await BOX.loadEnvs(renderer);                 // 4 PMREM maps (leather, lock, wordmark, base)
//   const box  = await BOX.loadBox('emerald', envs);           // THREE.Group, Y up, box root at the origin, faces +X
//   const cam  = await BOX.homeCamera(375 / 812);              // camera.json, the theme renders' home framing
//   const tone = await BOX.createTone(renderer);               // HDR target + AgX MHC LUT pass, exposure -0.35
//   tone.render(scene, cam);                                   // instead of renderer.render(scene, cam)
//
// All paths are relative to this file, so it works from any prototype folder on the same server.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const HERE = new URL('./', import.meta.url);
const url = (p) => new URL(p, HERE).href;
export const STOPS = ['obsidian', 'sapphire', 'emerald', 'amethyst'];
export const ENV_GROUPS = ['leather', 'lock', 'wordmark', 'base'];
export const EXPOSURE = Math.pow(2, -0.35);   // the studio's AgX exposure -0.35, applied before the LUT

/** The studio rig as four prefiltered environment maps, one per light-linking group of the Cycles scene. */
export async function loadEnvs(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const out = {};
  await Promise.all(ENV_GROUPS.map(async (g) => {
    const hdr = await new RGBELoader().loadAsync(url(`env/studio-${g}.hdr`));
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    out[g] = pmrem.fromEquirectangular(hdr).texture; hdr.dispose();
  }));
  pmrem.dispose();
  return out;
}

// Texture cap. Phones get 1024 px box textures (about a quarter of the GPU memory of the 2048 bakes): four boxes at
// 2048 exceed what iOS Safari gives a page, and it then drops the WebGL canvas silently. ?tex=2048 restores them.
const QS = new URLSearchParams(location.search);
const TOUCH = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
export const MAX_TEX = +(QS.get('tex') || (TOUCH ? 1024 : 4096));
const capped = new WeakSet();
function capTexture(t) {
  if (!t || capped.has(t)) return; capped.add(t);
  const img = t.image, w = img && (img.width || img.videoWidth), h = img && (img.height || img.videoHeight);
  if (!w || !h || Math.max(w, h) <= MAX_TEX) return;
  const k = MAX_TEX / Math.max(w, h), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close();
  t.image = c; t.needsUpdate = true;
}
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'sheenColorMap', 'sheenRoughnessMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap'];
function capScene(root) { root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) for (const s of TEX_SLOTS) capTexture(m[s]); }); }

const gltfCache = new Map();
// Per-part environment gain, calibrated against the Cycles references (tools/calibrate.py): the env map carries the
// light, but not the shadows and occlusion Cycles adds on small parts (stitches in the pad crease, the base wordmark
// under the lid overhang), so those parts are scaled here. Keys are Blender object names without .NNN (all four caps = Corner_Cap), or a prefix ending in '_' (LOCK_).
export const PART_GAIN = {
  all: { Corner_Cap: 0.85, Stitch: 3.0, LOCK_: 1.08, Logo_lid: 1.12, MASTER_Logo_lid: 1.12, MASTER_Logo_base: 0.42 },
  lacquer: { Logo_lid: 1.16, MASTER_Logo_lid: 1.16, MASTER_Logo_base: 0.55 },
};
export const FINISH = { obsidian: 'leather', sapphire: 'leather', emerald: 'lacquer', amethyst: 'leather' };
const gainsFor = (key) => ({ ...PART_GAIN.all, ...(PART_GAIN[FINISH[key]] || {}) });
/** Blender object name without its .NNN suffix (GLTFLoader drops the dot: 'Logo_lid.008' arrives as 'Logo_lid008'). */
export const baseName = (n) => n.replace(/\.?\d{3}$/, '');
/** Which part a mesh belongs to: the nearest named glTF node that carries extras.lb_env. */
function partOf(o) { let p = o; while (p) { if (p.userData && p.userData.lb_env) return p; p = p.parent; } return null; }
/** One stop's box. Every mesh gets its own material clone with the env map of its light group (userData.lb_env). */
export async function loadBox(key, envs, { envIntensity = 1, partGain = {} } = {}) {
  partGain = { ...gainsFor(key), ...partGain };
  if (!gltfCache.has(key)) gltfCache.set(key, new GLTFLoader().loadAsync(url(`${key}.glb`)).then((g) => { capScene(g.scene); return g; }));
  const gltf = await gltfCache.get(key);
  const root = gltf.scene.clone(true);
  root.name = `LuxBox_${key}`;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const node = partOf(o), grp = (node && node.userData.lb_env) || 'base', name = node ? node.name : o.name;
    let gain = 1;
    for (const [k, v] of Object.entries(partGain)) if (name === k || baseName(name) === k || (k.endsWith('_') && name.startsWith(k))) gain = v;
    const m = o.material.clone();
    m.envMap = envs[grp]; m.envMapIntensity = envIntensity * gain;
    o.material = m; o.userData.lb_env = grp; o.userData.part = baseName(name);
  });
  return root;
}

/** Turn every part's studio env map about Y (radians), e.g. with a camera that orbits a ring, so the light stays
 *  where it is relative to the camera (the native renderer turns its environment with the camera the same way). */
export function setEnvRotationY(root, y) {
  root.traverse((o) => { if (o.isMesh && o.material && o.material.envMapRotation) o.material.envMapRotation.set(0, y, 0); });
}

/** The home camera of the theme renders (camera.json). Vertical FOV is fixed (Blender sensor fit VERTICAL). */
export async function homeCamera(aspect = 375 / 812) {
  const spec = await (await fetch(url('camera.json'))).json();
  const t = spec.three;
  const cam = new THREE.PerspectiveCamera(t.fov_vertical_deg, aspect, t.near, t.far);
  cam.position.fromArray(t.position); cam.up.fromArray(t.up); cam.lookAt(new THREE.Vector3().fromArray(t.target));
  cam.userData.spec = spec;
  return cam;
}

/** Blender AgX + Medium High Contrast as a 3D LUT (env/agx_mhc_lut.bin, same layout as the native prototype's LUT). */
export async function loadLut(name = 'agx_mhc_lut') {
  const [bin, info] = await Promise.all([fetch(url(`env/${name}.bin`)).then((r) => r.arrayBuffer()),
    fetch(url(`env/${name}.json`)).then((r) => r.json())]);
  const lut = new THREE.Data3DTexture(new Uint8Array(bin), info.N, info.N, info.N);
  lut.format = THREE.RGBAFormat; lut.type = THREE.UnsignedByteType;
  lut.minFilter = lut.magFilter = THREE.LinearFilter;
  lut.wrapS = lut.wrapT = lut.wrapR = THREE.ClampToEdgeWrapping;
  lut.unpackAlignment = 1; lut.needsUpdate = true;
  return { lut, info };
}

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
  precision highp float; precision highp sampler3D;
  uniform sampler2D tScene; uniform sampler3D tLut; uniform float uExposure, uMinEV, uMaxEV, uN;
  uniform vec3 uBg; uniform float uBgOn; varying vec2 vUv;
  void main() {
    vec4 s = texture2D(tScene, vUv);
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);                // un-premultiply the MSAA edge
    c = max(c * uExposure, vec3(0.0));
    vec3 l = clamp((log2(max(c, vec3(1e-12))) - uMinEV) / (uMaxEV - uMinEV), 0.0, 1.0);
    vec3 o = texture(tLut, l * ((uN - 1.0) / uN) + 0.5 / uN).rgb;  // display-encoded sRGB
    gl_FragColor = uBgOn > 0.5 ? vec4(mix(uBg, o, s.a), 1.0) : vec4(o * s.a, s.a);
  }`;

/** HDR render target + LUT pass. bg: null (transparent canvas, premultiplied) or an sRGB hex drawn behind the box. */
export async function createTone(renderer, { bg = null, samples = 4, lutName = 'agx_mhc_lut' } = {}) {
  const { lut, info } = await loadLut(lutName);
  renderer.toneMapping = THREE.NoToneMapping;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples, colorSpace: THREE.LinearSRGBColorSpace });
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, transparent: false,
    uniforms: { tScene: { value: rt.texture }, tLut: { value: lut }, uExposure: { value: EXPOSURE },
      uMinEV: { value: info.minEV }, uMaxEV: { value: info.maxEV }, uN: { value: info.N },
      uBg: { value: new THREE.Vector3(...new THREE.Color(bg || 0).convertLinearToSRGB().toArray()) }, uBgOn: { value: bg ? 1 : 0 } } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); const qs = new THREE.Scene(); qs.add(quad);
  const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const begin = () => { renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); };
  const finish = (out = null) => { renderer.setRenderTarget(out); renderer.render(qs, qc); };
  return {
    uniforms: mat.uniforms, target: rt,
    setSize(w, h) { rt.setSize(w, h); },
    /** Bind and clear the HDR target. Draw any number of linear-HDR passes into it (premultiplied), then finish(). */
    begin,
    /** Apply exposure + AgX MHC LUT from the HDR target to the canvas (or to `out`, a render target). */
    finish,
    render(scene, camera) {
      const prevBg = scene.background; scene.background = null;
      begin(); renderer.render(scene, camera); scene.background = prevBg;
      finish();
    },
  };
}
