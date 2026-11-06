// Box loader for the four stops. Reads shared/box/<key>.glb (written by the BOX agent, see shared/box/BOX.md).
// The GLBs are in the native box frame: Y up, floor at y = -0.4516 (scene.json floorY), clasp toward +X,
// unit = the native ring units (ringRadius 4.7).
//
// loadBoxes(THREE, GLTFLoader, keys, { tierHex }) -> { [key]: { object, source, bounds } }
//   source 'glb'              the stop's own GLB
//   source 'tinted:obsidian'  PLACEHOLDER: obsidian.glb with the shell (LB_Box, LB_Lid, LB_Lid_Pad) tinted toward
//                             the tier hex. Used until the BOX agent exports that key. Say so in captures.
//   source 'placeholder'      PLACEHOLDER: a plain rounded block in the tier hex (no GLB at all)
// Never edits the box: wordmarks, clasp and stitches keep their materials.
//
// Studio look (use this): loadStudioBoxes(renderer, stops) -> { boxes, envs, tone, camera }
//   boxes as above, but every real GLB comes through shared/box/box.js loadBox(): each part gets the studio env map of
//   its Cycles light-linking group and the calibrated per-part gains (BOX.md). tone = createTone(renderer) (AgX
//   "Medium High Contrast" LUT, exposure -0.35): call tone.render(scene, cam) instead of renderer.render, and
//   tone.setSize(drawingBufferW, drawingBufferH) on resize. camera = the home camera from shared/box/camera.json.
//   Without envs (old loadBoxes call) the GLBs load raw and need scene.environment: they will NOT match compare.png.
import * as BOX from '../box/box.js';

const BOX_BASE = new URL('../box/', import.meta.url).href;
const SHELL = /^LB_(Box|Lid|Lid_Pad)$/;

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function hexLinear(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => srgbToLinear(x / 255)); }

async function tryLoad(loader, url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) return null;
    return await loader.loadAsync(url);
  } catch { return null; }
}

async function exists(url) { try { return (await fetch(url, { method: 'HEAD' })).ok; } catch { return false; } }

export async function loadStudioBoxes(renderer, stops, { aspect = 375 / 812 } = {}) {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const envs = await BOX.loadEnvs(renderer);
  const [boxes, tone, camera] = await Promise.all([loadBoxes(THREE, GLTFLoader, stops, { envs }), BOX.createTone(renderer), BOX.homeCamera(aspect)]);
  return { boxes, envs, tone, camera };
}

export async function loadBoxes(THREE, GLTFLoader, stops, { base = BOX_BASE, reference = 'obsidian', envs = null } = {}) {
  const loader = new GLTFLoader();
  const out = {};
  const studio = envs && base === BOX_BASE;
  const ref = studio ? ((await exists(base + reference + '.glb')) ? { scene: await BOX.loadBox(reference, envs) } : null)
    : await tryLoad(loader, base + reference + '.glb');
  const refHex = (stops.find((s) => s.key === reference) || {}).tierHex || '#1A1A1C';
  for (const s of stops) {
    let gltf = s.key === reference ? ref
      : studio ? ((await exists(base + s.key + '.glb')) ? { scene: await BOX.loadBox(s.key, envs) } : null)
      : await tryLoad(loader, base + s.key + '.glb');
    let source = 'glb', object;
    if (gltf) object = gltf.scene;
    else if (ref) {
      source = 'tinted:' + reference;
      object = ref.scene.clone(true);
      const a = hexLinear(refHex), b = hexLinear(s.tierHex);
      const ratio = b.map((x, i) => Math.min(8, x / Math.max(1e-4, a[i])));
      object.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const tinted = mats.map((m) => {
          if (!SHELL.test(m.name)) return m;
          const c = m.clone();
          c.color.setRGB(c.color.r * ratio[0], c.color.g * ratio[1], c.color.b * ratio[2], THREE.LinearSRGBColorSpace);
          return c;
        });
        o.material = Array.isArray(o.material) ? tinted : tinted[0];
      });
    } else {
      source = 'placeholder';
      const g = new THREE.BoxGeometry(2.57, 0.84, 2.16);
      g.translate(-0.21, -0.4516 + 0.42, 0);
      object = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color(s.tierHex), roughness: 0.55 }));
    }
    const bounds = new THREE.Box3().setFromObject(object);
    out[s.key] = { object, source, bounds };
  }
  return out;
}
