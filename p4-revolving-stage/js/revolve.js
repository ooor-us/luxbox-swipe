// P4 Revolving Stage: the revolve geometry and its baked, unlit materials (three r170, Y up).
// Same parametrisation as bake/bake_revolve.py (Blender, Z up): Blender (x, y, z) = three (x, z, -y). The revolve
// group sits at the turning axis C = (Ax, Ay) (Blender), upstage-left of the front box; everything that turns is a
// child of it. Set k is set 0 turned by k*90 deg about C; position p turns the revolve by -p*90 deg (rotation.y).
//   floor wedge k: lightmap uv = ((ly + Yh) / 2Yh, lx / Rf), (lx, ly) measured from C along set k's centre line A0+k*90
//   flat faces: lightmap uv = ((s - T/2) / (Lw - bevel - T/2), (z - zb) / H), s along the flat from C
// Lightmaps: 8-bit sRGB of (linear / scale) (bake.json), decoded by the GPU (SRGBColorSpace), multiplied by scale.
import * as THREE from 'three';

const DEG = Math.PI / 180;

const VERT = /* glsl */`
  varying vec2 vLm; varying vec2 vDet; varying vec2 vWall; varying vec3 vWorld;
  attribute vec2 uvDet; attribute vec2 uvWall;
  void main() { vLm = uv; vDet = uvDet; vWall = uvWall; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
// The stage light (round 3): one spotlight fixed in world space, hung high in front of the revolve and aimed at the
// acting spot. Its soft elliptical beam lights the box and the corner of flats behind it; above the beam the flats
// rise into the dark of the flies (behind the header) and downstage of it the floor falls into shade (under the title
// and the lower UI). It never turns, so each set turns into and out of it.
const POOL = /* glsl */`
  uniform vec3 uSpotPos; uniform mat3 uSpotM; uniform vec4 uSpotK;   // beam half-widths: tan horizontal, tan up, tan down, softness
  uniform vec2 uCut;                                                  // the border: light fades out between these heights
  float pool(vec3 w) {
    vec3 v = uSpotM * (w - uSpotPos);                 // x right, y up, z along the beam
    float h = v.x / (max(v.z, 0.01) * uSpotK.x), u = v.y / max(v.z, 0.01);
    float e = length(vec2(h, u > 0.0 ? u / uSpotK.y : u / uSpotK.z));
    // the top of the beam is cut by the border (a masking curtain at the top of the proscenium): nothing above
    // box-lid height is in the light, however close a flat swings to the seat
    return (1.0 - smoothstep(1.0 - uSpotK.w, 1.0 + uSpotK.w, e)) * (1.0 - smoothstep(uCut.x, mix(uCut.y, 1.45, smoothstep(0.8, 2.0, abs(w.z))), w.y));
  }`;
const FRAG_SRC = () => /* glsl */`
  precision highp float;
  uniform sampler2D uLm; uniform sampler2D uAlb; uniform sampler2D uMask; uniform sampler2D uCaus;
  uniform float uScale; uniform float uCue; uniform float uKind; uniform float uTime; uniform float uCaustic;
  uniform vec3 uFlat; uniform vec3 uCausCol; uniform float uDetail; uniform vec3 uShade;
  varying vec2 vLm; varying vec2 vDet; varying vec2 vWall; varying vec3 vWorld;
  ${POOL}
  float sm(float a, float b, float x) { return smoothstep(a, b, x); }
#ifdef FLOOR
  // round 4: the join between two floor wedges. Near the join each wedge blends towards the mean of its own floor and
  // the neighbour's floor at the mirror point across the join (the same world point at the join itself), so both
  // sides meet the same colour: no luminance step. Light, albedo and shade of both neighbours are sampled here.
  uniform sampler2D uLmN0; uniform sampler2D uLmN1; uniform sampler2D uAlbN0; uniform sampler2D uAlbN1;
  uniform vec2 uScaleN; uniform vec3 uFlatN0; uniform vec3 uFlatN1; uniform vec3 uShadeN0; uniform vec3 uShadeN1;
  uniform vec4 uDetN0; uniform vec4 uDetN1;   // neighbour detail uv: 1/tile, off.x, off.y, detail amount
  uniform vec3 uGeo;                          // Rf, Yh, Lw
  // the soft floor reflection of the boxes (the home's blurred dark reflection), from a quarter-res mirror pass
  uniform sampler2D uRefl; uniform mat4 uReflM; uniform vec2 uReflTexel; uniform float uReflK; uniform vec4 uBoxF;   // box footprint: centre lx, half x, half y, fade
  vec3 nbLit(sampler2D lm, sampler2D alb, float scale, vec3 flatc, vec4 dt, vec2 l) {
    vec2 uvN = vec2((-l.y + uGeo.y) / (2.0 * uGeo.y), l.x / uGeo.x);
    vec3 d = texture2D(alb, vec2(-l.y, l.x) * dt.x + dt.yz).rgb;
    return mix(flatc, d, dt.w) * texture2D(lm, uvN).rgb * scale;
  }
#endif
  void main() {
    vec3 c; vec3 joinShade = uShade; float joinW = 0.0;
    vec3 det = texture2D(uAlb, vDet).rgb;
    vec3 grain = det / max(uFlat, vec3(0.05));          // the material's own grain, kept in the shade
    if (uKind < 0.5) {                                 // baked: albedo detail x lightmap
      vec3 lm = texture2D(uLm, vLm).rgb * uScale;
      vec3 alb = mix(uFlat, det, uDetail);
      c = alb * lm;
      if (uCaustic > 0.0) {                            // Riviera: the baked reach of the sun through the water x a live caustic tile
        float m = texture2D(uMask, vLm).r;
        vec2 q = vDet * 1.9;
        float a = texture2D(uCaus, q + uTime * vec2(0.011, 0.006)).r;
        float b = texture2D(uCaus, q * 1.21 + vec2(0.31, 0.57) - uTime * vec2(0.007, 0.012)).r;
        float p = min(a, b) * 2.2 + 0.18 * (a + b);
        c += alb * uCausCol * (uCaustic * m * p);
      }
#ifdef FLOOR
      {
        vec2 l = vec2(vLm.y * uGeo.x, vLm.x * 2.0 * uGeo.y - uGeo.y);       // wedge-local: from the axis, across
        float de = (l.x - abs(l.y)) * 0.70710678;                             // distance to the nearer join
        float along = (l.x + abs(l.y)) * 0.70710678;
        float wj = (1.0 - sm(0.0, 0.42, de)) * sm(uGeo.z - 0.1, uGeo.z + 0.35, along) * 0.5;
        if (wj > 0.001) {
          vec3 nb = l.y > 0.0 ? nbLit(uLmN1, uAlbN1, uScaleN.y, uFlatN1, uDetN1, l) : nbLit(uLmN0, uAlbN0, uScaleN.x, uFlatN0, uDetN0, l);
          vec3 nshade = l.y > 0.0 ? uShadeN1 : uShadeN0;
          c = mix(c, nb, wj);
          joinShade = mix(uShade, nshade, wj); joinW = wj;
        }
      }
#endif
    } else if (uKind < 1.5) {                          // Reeded glass flat (backlit): each reed is a small lens
      float s = vWall.x, z = vWall.y;
      vec3 col = mix(vec3(0.86, 0.9, 0.97), vec3(0.95, 0.97, 1.0), sm(0.4, 3.2, z));
      float st = (1.0 - 0.45 * sm(0.2, 4.5, z)) * (0.75 + 0.25 * sm(0.3, 2.6, s)) * 1.15;
      float q = s / 0.13, u = fract(q) - 0.5;
      float amp = 1.0 - sm(0.25, 0.7, fwidth(q));       // reeds fade to their average where they get sub-pixel
      // refraction: a reed shows a mirrored, magnified slice of the studio window behind it (soft panes, thin
      // dark mullions every 1.45, a transom at 2.7), so the mullions break into offset streaks reed by reed
      float sb = (floor(q) + 0.5) * 0.13 - u * 0.13 * 3.2, zb2 = z + u * 0.05;
      float m1 = abs(fract(sb / 1.45 + 0.5) - 0.5) * 1.45, m2 = abs(zb2 - 2.7);
      float behind = (0.86 + 0.14 * cos(6.2831853 * sb / 1.45)) * (1.0 - 0.42 * (1.0 - sm(0.015, 0.06, m1))) * (1.0 - 0.3 * (1.0 - sm(0.02, 0.08, m2)));
      float body = 0.93 + 0.07 * (1.0 - 4.0 * u * u);
      float groove = sm(0.40, 0.5, abs(u));                        // the dark joint between reeds
      float hi = pow(max(0.0, cos((u - 0.17) * 6.2831853 * 1.1)), 24.0);   // the bright core of each reed
      float detail = behind * body * (1.0 - 0.32 * groove) + 0.32 * hi;
      c = col * st * mix(0.93, detail, amp);
    } else {                                           // Desert sky flat: a painted backcloth of the dunes at first light
      float s = vWall.x, z = vWall.y;
      vec3 sky = mix(vec3(1.0, 0.52, 0.34), vec3(0.30, 0.27, 0.55), sm(0.0, 3.6, z));
      float skyI = 0.18 + 0.42 * (1.0 - sm(0.0, 2.8, z));
      float hz = 0.95 + 0.22 * sin(s * 1.35 + 0.6) + 0.1 * sin(s * 3.3 + 1.7);    // far dune ridge
      float hz2 = 0.55 + 0.16 * sin(s * 2.1 + 2.4) + 0.06 * sin(s * 5.2);         // nearer ridge
      float haze = 0.035 * sin(z * 7.0 + 1.3 * sin(s * 1.7)) * sm(1.4, 2.6, z) * (1.0 - sm(3.0, 4.5, z));
      vec3 cs = sky * (skyI + haze);
      vec3 far = vec3(0.78, 0.42, 0.36) * 0.36, near = vec3(0.62, 0.30, 0.27) * 0.3;
      float fw = fwidth(z) * 1.5 + 0.01;
      cs = mix(cs, far, 1.0 - sm(hz - fw, hz + fw, z));
      cs = mix(cs, near, 1.0 - sm(hz2 - fw, hz2 + fw, z));
      c = cs;
    }
    // downstage of the stage light each set keeps its own colour: a dark, tinted shade with the floor's grain
    float pl = pool(vWorld);
    vec3 shade = joinShade * mix(vec3(1.0), mix(grain, vec3(1.0), joinW * 2.0), 0.6);
    vec3 outc = mix(shade, c, pl);
#ifdef FLOOR
    if (uReflK > 0.0) {
      vec2 l = vec2(vLm.y * uGeo.x, vLm.x * 2.0 * uGeo.y - uGeo.y);
      vec2 q = max(abs(l - vec2(uBoxF.x, 0.0)) - uBoxF.yz, 0.0);
      float fade = 1.0 - sm(0.0, uBoxF.w, length(q) + 0.35 * max(0.0, uBoxF.x - l.x));   // strongest at the box's foot
      if (fade > 0.001) {
        vec4 rc = uReflM * vec4(vWorld, 1.0); vec2 ru = rc.xy / rc.w;
        vec4 r = texture2D(uRefl, ru) * 0.4 + (texture2D(uRefl, ru + uReflTexel * vec2(1.5, 0.5)) + texture2D(uRefl, ru - uReflTexel * vec2(1.5, 0.5))
               + texture2D(uRefl, ru + uReflTexel * vec2(-0.5, 1.5)) + texture2D(uRefl, ru - uReflTexel * vec2(-0.5, 1.5))) * 0.15;
        float k = uReflK * fade * r.a;
        outc = mix(outc, r.rgb / max(r.a, 0.001), k);
      }
    }
#endif
    gl_FragColor = vec4(outc * uCue, 1.0);
  }`;

const PLAIN_FRAG_SRC = () => /* glsl */`
  precision highp float; uniform vec3 uColor; uniform float uCue; uniform float uGrad; uniform vec3 uShade; varying vec3 vWorld;
  ${POOL}
  void main() {
    float g = mix(1.0, 0.7 + 0.45 * smoothstep(-0.45, 3.2, vWorld.y), uGrad);
    gl_FragColor = vec4(mix(uShade, uColor * g, pool(vWorld)) * uCue, 1.0); }`;
const PLAIN_VERT = /* glsl */`varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const FRAG = FRAG_SRC(), FLOOR_FRAG = '#define FLOOR\n' + FRAG_SRC(), PLAIN_FRAG = PLAIN_FRAG_SRC();
const SETS = ['ivory', 'reeded', 'riviera', 'desert'];
const TILE = { ivory: 4.0, reeded: 3.2, riviera: 3.4, desert: 2.2 };   // world units per detail tile

// The ends of the flats: bevelled lacquered wood (two 45 deg chamfers and the end face), shaded LIVE by the fixed
// stage key, so the chamfers catch a thin line of light and the end face shows a terminator as the flat turns through
// the light. A foot occlusion grounds it on the floor (the floor's own contact shadow of the flat is baked).
const CAP_VERT = /* glsl */`varying vec3 vWorld; varying vec3 vN; varying float vH;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vH = position.y; gl_Position = projectionMatrix * viewMatrix * w; }`;
const CAP_FRAG = /* glsl */`precision highp float;
  uniform vec3 uSpill; uniform vec3 uShade; uniform vec3 uKey; uniform vec3 uCamPos; uniform float uZb;
  varying vec3 vWorld; varying vec3 vN; varying float vH;
  ${POOL}
  void main() {
    vec3 n = normalize(vN), v = normalize(uCamPos - vWorld), l = normalize(uKey);
    if (dot(n, v) < 0.0) n = -n;
    float h = vH - uZb;
    vec3 wood = vec3(0.085, 0.052, 0.030) * (0.92 + 0.08 * sin(vWorld.y * 23.0 + sin(vWorld.y * 3.1) * 2.0));
    float lam = max(dot(n, l), 0.0);
    float foot = mix(0.35, 1.0, smoothstep(0.0, 0.7, h));
    vec3 col = wood * (uSpill * 1.6 + vec3(1.0, 0.86, 0.66) * 3.2 * lam) * foot;
    float fr = pow(1.0 - max(dot(n, v), 0.0), 4.0);                     // lacquer sheen at grazing angles
    float sp = pow(max(dot(reflect(-l, n), v), 0.0), 40.0);              // the key's highlight on the chamfers
    col += (0.04 * fr + 0.5 * sp) * vec3(1.0, 0.88, 0.7) * foot;
    float pl = pool(vWorld);
    gl_FragColor = vec4(mix(uShade * foot * (0.6 + 0.6 * lam), col, pl), 1.0);
  }`;

// per-set downstage shade (linear, before the AgX pass): warm umber, cool slate, green-black, rose-brown
export const SHADE = [[0.075, 0.046, 0.026], [0.040, 0.052, 0.074], [0.022, 0.050, 0.040], [0.074, 0.036, 0.042]];   // round 3: lighter, so each set's floor reads in the shade
export const KEY = new THREE.Vector3(1.0, 1.25, -0.55);   // the fixed stage key on the flat ends: from above the camera, front right
// the spot: position, aim, beam (tan half-angles: horizontal, up, down; softness). ?spot=ah,au,ad,soft tunes it
export const SPOT = { pos: new THREE.Vector3(13.0, 8.2, 0), aim: new THREE.Vector3(-0.6, 0.15, 0), k: new THREE.Vector4(0.30, 0.10, 0.095, 0.18) };
export const CUT = new THREE.Vector2(1.0, 2.2);    // round 4: raised and softer over the acting area (was a hard 0.95..1.4 cut at lid height); towards the sides it comes down to 1.45, where the Ivory flat stands behind the $917 chip
export const SPOT_U = { uSpotPos: { value: SPOT.pos }, uSpotM: { value: new THREE.Matrix3() }, uSpotK: { value: SPOT.k }, uCut: { value: CUT } };
// the mirror pass (main.js renders the boxes into it; every floor samples it)
export const REFL_U = { uRefl: { value: null }, uReflM: { value: new THREE.Matrix4() }, uReflTexel: { value: new THREE.Vector2(1 / 188, 1 / 406) } };
export function aimSpot() {
  const z = SPOT.aim.clone().sub(SPOT.pos).normalize(), x = new THREE.Vector3(0, 1, 0).cross(z).normalize().negate(), y = z.clone().cross(x).negate();
  if (y.y < 0) y.negate();
  SPOT_U.uSpotM.value.set(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
}
aimSpot();
export function poolAt(w) {
  const m = SPOT_U.uSpotM.value.elements, d = w.clone().sub(SPOT.pos);   // Matrix3.set is row-major; elements are column-major
  const v = [m[0] * d.x + m[3] * d.y + m[6] * d.z, m[1] * d.x + m[4] * d.y + m[7] * d.z, m[2] * d.x + m[5] * d.y + m[8] * d.z];
  const k = SPOT.k, z = Math.max(v[2], 0.01), h = v[0] / (z * k.x), u = v[1] / z;
  const e = Math.hypot(h, u > 0 ? u / k.y : u / k.z); const t = Math.min(1, Math.max(0, (e - (1 - k.w)) / (2 * k.w))); const az = Math.min(1, Math.max(0, (Math.abs(w.z) - 0.8) / 1.2)), top = CUT.y + (1.45 - CUT.y) * az * az * (3 - 2 * az); const c = Math.min(1, Math.max(0, (w.y - CUT.x) / (top - CUT.x))); return (1 - t * t * (3 - 2 * t)) * (1 - c * c * (3 - 2 * c));
}

export async function buildRevolve({ base, renderer, camera, geo = null, noLm = false }) {
  const meta = await (await fetch(base + 'assets/bake.json', { cache: 'no-cache' })).json();
  const G = geo ? { ...meta.geometry, ...geo } : meta.geometry; const { Ax, Ay, Rf, Lw, T, H, zb } = G; const plinth = G.plinth, bev = G.bevel;
  const A0 = Math.atan2(-Ay, -Ax);
  const Yh = Rf * Math.SQRT1_2;
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (file, { srgb = true, repeat = false, aniso = 8 } = {}) => new Promise((res, rej) => loader.load(base + 'assets/' + file, (t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.flipY = false;
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.anisotropy = Math.min(aniso, maxAniso); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    res(t);
  }, undefined, rej));

  // Blender (relative to C) -> three (relative to the group at C)
  const tb = (bx, by, bz) => [bx, bz, -by];
  const rot = (a, x, y) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

  function geom(pos, lm, det, wall, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(lm, 2));
    g.setAttribute('uvDet', new THREE.Float32BufferAttribute(det, 2));
    g.setAttribute('uvWall', new THREE.Float32BufferAttribute(wall, 2));
    g.setIndex(idx); return g;
  }
  function floorWedge(k) {
    const a = A0 + k * 90 * DEG, NA = 24, NR = 32, pos = [], lm = [], det = [], wall = [], idx = [];
    const tile = TILE[SETS[k]], off = [0.37 * k, 0.61 * k];
    const push = (r, ph) => {
      const lx = r * Math.cos(ph), ly = r * Math.sin(ph); const [bx, by] = rot(a, lx, ly);
      pos.push(...tb(bx, by, zb)); lm.push((ly + Yh) / (2 * Yh), lx / Rf); det.push(ly / tile + off[0], lx / tile + off[1]); wall.push(0, 0);
    };
    push(0, 0);
    for (let i = 1; i <= NR; i++) for (let j = 0; j <= NA; j++) push(Rf * i / NR, (-45 + 90 * j / NA) * DEG);
    const id = (i, j) => 1 + (i - 1) * (NA + 1) + j;
    for (let j = 0; j < NA; j++) idx.push(0, id(1, j), id(1, j + 1));
    for (let i = 1; i < NR; i++) for (let j = 0; j < NA; j++) idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
    return geom(pos, lm, det, wall, idx);
  }
  const wdir = (j) => { const w = A0 + (90 * j + 45) * DEG; return [[Math.cos(w), Math.sin(w)], [Math.sin(w), -Math.cos(w)]]; };
  function wallFace(j, side) {          // wall j between set j and set j+1; 'R' = set j's face, 'L' = set j+1's face
    const [d, nA] = wdir(j);
    const n = side === 'R' ? nA : [-nA[0], -nA[1]]; const s0 = T / 2, s1 = Lw - bev;
    const k = side === 'R' ? j : (j + 1) % 4, tile = TILE[SETS[k]];
    const pos = [], lm = [], det = [], wall = [], idx = [], NS = 8, NZ = 4;
    for (let a = 0; a <= NS; a++) for (let b = 0; b <= NZ; b++) {
      const s = s0 + (s1 - s0) * a / NS, z = H * b / NZ;
      pos.push(...tb(d[0] * s + n[0] * T / 2, d[1] * s + n[1] * T / 2, zb + z));
      lm.push((s - s0) / (s1 - s0), z / H); det.push(s / tile + 0.21 * k, z / tile); wall.push(s, z);
    }
    for (let a = 0; a < NS; a++) for (let b = 0; b < NZ; b++) { const i = a * (NZ + 1) + b; idx.push(i, i + NZ + 1, i + NZ + 2, i, i + NZ + 2, i + 1); }
    return { g: geom(pos, lm, det, wall, idx), k };
  }
  function wallCap(j) {                  // chamfer, end face, chamfer: flat-shaded quads with their own normals
    const [d, nA] = wdir(j);
    const P = (s, o) => [d[0] * s + nA[0] * o, d[1] * s + nA[1] * o];
    const pts = [P(Lw - bev, T / 2), P(Lw, T / 2 - bev), P(Lw, -(T / 2 - bev)), P(Lw - bev, -T / 2)];
    const pos = [], nrm = [], idx = [];
    for (let f = 0; f < 3; f++) {
      const a = pts[f], b = pts[f + 1]; const e = [b[0] - a[0], b[1] - a[1]]; let nn = [e[1], -e[0]];
      const L = Math.hypot(nn[0], nn[1]); nn = [nn[0] / L, nn[1] / L]; if (nn[0] * d[0] + nn[1] * d[1] < 0) nn = [-nn[0], -nn[1]];
      const base = pos.length / 3;
      for (const [q, z] of [[a, zb], [b, zb], [b, zb + H], [a, zb + H]]) { pos.push(...tb(q[0], q[1], z)); nrm.push(...tb(nn[0], nn[1], 0)); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx);
    return g;
  }
  function quad(pts) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return g;
  }
  function seam(j) {                    // the joint between two floor wedges, from the flat's end to the rim
    const [d, nA] = wdir(j), hw = 0.014;
    const P = (s, sg) => tb(d[0] * s + sg * nA[0] * hw, d[1] * s + sg * nA[1] * hw, zb + 0.003);
    return quad([P(Lw, 1), P(Rf, 1), P(Rf, -1), P(Lw, -1)]);
  }
  function ring(r0, r1, y0, y1, n = 192) {   // annulus (y0 = y1) or cylinder band (r0 = r1), in group space
    const pos = [], idx = [];
    for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); pos.push(r0 * c, y0, r0 * s, r1 * c, y1, r1 * s); }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
  }

  const [alb, caus] = await Promise.all([Promise.all(SETS.map((s) => tex(`tex-${s}.jpg`, { repeat: true }))), tex('caustic.png', { srgb: false, repeat: true })]);
  const S = meta.surfaces;
  const lms = {};
  if (noLm) {   // geometry study before a re-bake: a flat grey light instead of the lightmaps
    const w = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1); w.needsUpdate = true;
    for (const k of Object.keys(S)) { lms[k] = w; S[k] = { ...S[k], scale: 0.9 }; }
  } else await Promise.all(Object.entries(S).map(async ([k, s]) => { lms[k] = await tex(s.jpg, { aniso: 8 }); }));
  const flatAlb = (k) => new THREE.Vector3(...(meta.albedo ? meta.albedo[SETS[k]] : [0.7, 0.7, 0.7]));
  const shadeV = (k) => new THREE.Vector3(...SHADE[k]);

  const group = new THREE.Group(); group.name = 'Revolve'; group.position.set(...tb(Ax, Ay, 0));
  const mats = [];                       // { mat, set } for the per-set light cue
  const mk = (set, kind, lmKey, extra = {}, frag = FRAG) => {
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, side: THREE.DoubleSide,
      uniforms: { uLm: { value: lms[lmKey] || null }, uAlb: { value: alb[set] }, uMask: { value: null }, uCaus: { value: caus },
        uScale: { value: S[lmKey] ? S[lmKey].scale : 1 }, uCue: { value: 1 }, uKind: { value: kind }, uTime: { value: 0 }, uCaustic: { value: 0 },
        ...SPOT_U, uFlat: { value: flatAlb(set) }, uCausCol: { value: new THREE.Vector3(1.0, 0.82, 0.52) }, uDetail: { value: 1 }, uShade: { value: shadeV(set) }, ...extra } });
    mats.push({ mat: m, set }); return m;
  };
  // round 4: each floor knows its two neighbours (join blend) and reads the shared mirror pass (reflection)
  const detN = (k) => new THREE.Vector4(1 / TILE[SETS[k]], 0.37 * k, 0.61 * k, 1);
  const REFL_K = [0.2, 0.3, 0.16, 0.06];   // travertine, pale polished stone, limestone, sand
  for (let k = 0; k < 4; k++) {
    const a = (k + 3) % 4, b = (k + 1) % 4;
    const m = mk(k, 0, `floor${k}`, {
      uLmN0: { value: lms[`floor${a}`] }, uLmN1: { value: lms[`floor${b}`] }, uAlbN0: { value: alb[a] }, uAlbN1: { value: alb[b] },
      uScaleN: { value: new THREE.Vector2(S[`floor${a}`].scale, S[`floor${b}`].scale) }, uFlatN0: { value: flatAlb(a) }, uFlatN1: { value: flatAlb(b) },
      uShadeN0: { value: shadeV(a) }, uShadeN1: { value: shadeV(b) }, uDetN0: { value: detN(a) }, uDetN1: { value: detN(b) },
      uGeo: { value: new THREE.Vector3(Rf, Yh, Lw) }, ...REFL_U, uReflK: { value: REFL_K[k] },
      uBoxF: { value: new THREE.Vector4(-Ax - 0.15, 1.35, 1.08, 2.6) } }, FLOOR_FRAG);
    if (k === 2) { m.uniforms.uMask.value = lms.mask2; m.uniforms.uCaustic.value = 1; }
    const o = new THREE.Mesh(floorWedge(k), m); o.name = `floor${k}`; group.add(o);
  }
  for (let j = 0; j < 4; j++) for (const side of ['R', 'L']) {
    const { g, k } = wallFace(j, side);
    const kind = k === 1 ? 1 : k === 3 ? 2 : 0;
    const m = mk(k, kind, `wall${side}${k}`);
    if (k === 2) { m.uniforms.uMask.value = lms[`mask${side}2`]; m.uniforms.uCaustic.value = 1; }
    const o = new THREE.Mesh(g, m); o.name = `wall${side}${k}`; group.add(o);
  }
  // flat ends (live: the fixed stage key), joints between the floor wedges
  const capMats = [];
  const camPos = camera ? camera.position : new THREE.Vector3(11, 4.75, 0);
  for (let j = 0; j < 4; j++) {
    const m = new THREE.ShaderMaterial({ vertexShader: CAP_VERT, fragmentShader: CAP_FRAG, side: THREE.DoubleSide,
      uniforms: { uSpill: { value: new THREE.Vector3() }, uShade: { value: new THREE.Vector3() }, uKey: { value: KEY }, uCamPos: { value: camPos }, uZb: { value: zb }, ...SPOT_U } });
    capMats.push({ mat: m, a: j, b: (j + 1) % 4 });
    const o = new THREE.Mesh(wallCap(j), m); o.name = `cap${j}`; group.add(o);
    // round 4: no dark seam strip over the floor joins any more (the floors blend across the join)
  }
  // the revolve's edge: a dark lacquered skirt with a thin brass lip, and the fixed stage deck around it
  const plain = (c, sh, side) => new THREE.ShaderMaterial({ vertexShader: PLAIN_VERT, fragmentShader: PLAIN_FRAG, side: side || THREE.FrontSide, uniforms: { uColor: { value: new THREE.Vector3(...c) }, uCue: { value: 1 }, ...SPOT_U, uGrad: { value: 0 }, uShade: { value: new THREE.Vector3(...sh) } } });
  const lipMat = plain([0.55, 0.38, 0.17], [0.10, 0.068, 0.03], THREE.DoubleSide);
  const skirtMat = plain([0.018, 0.015, 0.012], [0.006, 0.005, 0.004], THREE.DoubleSide);
  // round 4: the fixed stage deck round the revolve (seen whole when the seat pulls back at halfway): black-painted
  // boards in the set's shade colour, a little lighter at the revolve's edge where the stage light spills, falling
  // off into the dark towards the house. Procedural, no texture.
  const DECK_FRAG = /* glsl */`precision highp float; uniform vec3 uShade; uniform vec3 uC; uniform float uRf; varying vec3 vWorld;
    float h(float n) { return fract(sin(n * 91.7) * 43758.5453); }
    void main() {
      vec2 q = vWorld.xz - uC.xz; float r = length(q);
      float board = floor(vWorld.z / 0.62); float u = fract(vWorld.z / 0.62);
      float var = 0.86 + 0.22 * h(board) + 0.05 * sin(vWorld.x * 2.1 + h(board) * 40.0);
      float joint = mix(0.55, 1.0, smoothstep(0.0, 0.035, u) * smoothstep(1.0, 0.965, u));
      float spill = 0.55 + 0.75 * exp(-(r - uRf) / 1.6);
      float house = 1.0 - 0.55 * smoothstep(2.0, 9.0, vWorld.x - uC.x - uRf * 0.6);
      gl_FragColor = vec4(uShade * var * joint * spill * house, 1.0);
    }`;
  const deckMat = new THREE.ShaderMaterial({ vertexShader: PLAIN_VERT, fragmentShader: DECK_FRAG, side: THREE.DoubleSide,
    uniforms: { uShade: { value: new THREE.Vector3() }, uC: { value: new THREE.Vector3(...tb(Ax, Ay, 0)) }, uRf: { value: Rf } } });
  const lip = new THREE.Mesh(ring(Rf - 0.03, Rf, zb + 0.002, zb + 0.002), lipMat); lip.name = 'lip'; group.add(lip);
  const skirt = new THREE.Mesh(ring(Rf, Rf, zb - plinth, zb), skirtMat); skirt.name = 'skirt'; group.add(skirt);
  const deck = new THREE.Mesh(ring(Rf + 0.002, 60, zb - plinth, zb - plinth), deckMat); deck.name = 'deck'; deck.position.copy(group.position);

  // the cyclorama: a world-fixed backcloth round the revolve (it never turns). The lighting board colours it for the
  // set that is on stage, so whatever shows past a flat's free end and above the sets belongs to that scene.
  const CYC_VERT = /* glsl */`varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const CYC_FRAG = /* glsl */`precision highp float; uniform vec3 uLo; uniform vec3 uHi; uniform float uZb; uniform float uCue; varying vec3 vWorld;
    void main() { float h = vWorld.y - uZb; vec3 c = mix(uLo, uHi, smoothstep(0.2, 7.5, h)); gl_FragColor = vec4(c * uCue, 1.0); }`;
  const cycMat = new THREE.ShaderMaterial({ vertexShader: CYC_VERT, fragmentShader: CYC_FRAG, side: THREE.BackSide, depthWrite: true,
    uniforms: { uLo: { value: new THREE.Vector3() }, uHi: { value: new THREE.Vector3() }, uZb: { value: zb }, uCue: { value: 1 } } });
  const cycG = new THREE.CylinderGeometry(Rf + 1.2, Rf + 1.2, 18, 96, 1, true); cycG.translate(0, zb - plinth + 9, 0);
  const cyc = new THREE.Mesh(cycG, cycMat); cyc.name = 'cyc'; cyc.position.copy(group.position);

  // where each set's box stands (group space) and its rest yaw
  const spot = (k) => { const a = k * 90 * DEG; const [bx, by] = rot(a, -Ax, -Ay); return { pos: new THREE.Vector3(...tb(bx, by, 0)), rotY: a }; };
  const wallMean = SETS.map((s, k) => {
    const r = S[`wallR${k}`], l = S[`wallL${k}`];
    if (k === 1) return [0.9, 0.93, 0.98];     // glass
    if (k === 3) return [0.42, 0.24, 0.2];     // sky at the sand
    const a = flatAlb(k); const m = r && l ? r.mean.map((v, i) => (v + l.mean[i]) / 2) : [0.5, 0.5, 0.5];
    return [a.x * m[0], a.y * m[1], a.z * m[2]];
  });

  return {
    group, deck, cyc, meta, spot, A0, geometry: G,
    /** cyclorama colour for the scene on stage: lo/hi = linear colour at the floor and up top */
    setDeck(c) { deckMat.uniforms.uShade.value.set(...c); skirtMat.uniforms.uShade.value.set(...c.map((v) => v * 0.5)); },
    setCyc(lo, hi, cue = 1) { cycMat.uniforms.uLo.value.set(...lo); cycMat.uniforms.uHi.value.set(...hi); cycMat.uniforms.uCue.value = cue; },
    /** cue[k] = light level of set k (1 = its full baked light); time drives the caustics */
    update({ cue, time, caustic = 1 }) {
      for (const { mat, set } of mats) { mat.uniforms.uCue.value = cue[set]; mat.uniforms.uTime.value = time; if (set === 2) mat.uniforms.uCaustic.value = caustic; }
      for (const { mat, a, b } of capMats) {
        const ca = wallMean[a], cb = wallMean[b];
        mat.uniforms.uSpill.value.set(...ca.map((v, i) => 0.25 * (v * cue[a] + cb[i] * cue[b]) * 0.5));
        mat.uniforms.uShade.value.set(...SHADE[a].map((v, i) => 0.5 * (v + SHADE[b][i])));
      }
      lipMat.uniforms.uCue.value = 0.5 + 0.5 * Math.max(...cue);
    },
  };
}
