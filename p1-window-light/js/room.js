// The one room (round 4: closed back wall, no corner hairline; was round 3): a limestone floor and two lime-plaster walls meeting in a corner, with a shadow-gap
// skirting, one tall floor-level opening in the back wall (the window: the theme screens slide through it and the
// one sun shines through it), and a brass ring track inlaid in the floor that the four boxes travel on.
// All numbers come from bake/room.json, the same file the Blender bake reads.
// Each surface: its albedo (limestone / plaster) x a fine grain detail map, lit by the live key and by its baked
// Blender lightmap (fill light + AO), tinted per stop. The tint can sweep across the room (uSweep*): fragments on
// one side of a moving front take room state A, the other side state B, so a change of hour passes across the room
// as light in the direction of travel instead of fading.
import * as THREE from 'three';

export async function createRoom(scene, { base = './' } = {}) {
  const cfg = await fetch(base + 'bake/room.json').then((r) => r.json());
  const lmInfo = await fetch(base + 'assets/lm.json').then((r) => r.json()).catch(() => ({ divisor: 12 }));
  const lmScale = lmInfo.divisor / 12;
  const tl = new THREE.TextureLoader();
  const tex = async (f, srgb, repeat) => {
    try {
      const t = await tl.loadAsync(base + f);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
      t.anisotropy = 8;
      return t;
    } catch { return null; }
  };
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  const U = {
    uFillA: { value: new THREE.Vector3(1, 1, 1) }, uFillB: { value: new THREE.Vector3(1, 1, 1) },
    uAlbA: { value: new THREE.Vector3(1, 1, 1) }, uAlbB: { value: new THREE.Vector3(1, 1, 1) },
    uTopA: { value: new THREE.Vector3(1, 1, 1) }, uTopB: { value: new THREE.Vector3(1, 1, 1) },
    uMix: { value: 0 },            // global A->B mix (same-hour neighbours follow the finger)
    uSweepOn: { value: 0 },        // 1 while a change of hour sweeps across the room
    uSweepZ: { value: 0 },         // the front (world z); B lies on the side of uSweepDir
    uSweepDir: { value: -1 },
    uSweepW: { value: 2.6 },       // soft width of the front (m)
    uKeyClip: { value: new THREE.Vector4(3.4, 1.8, 3.8, 2.6) }, uKeyRoom: { value: 0.4 },  // round 4: the window's sill/head bound the sun patch (floor x fade from..to, wall y fade from..to)
    tGrain: { value: null },
  };
  const grain = await tex('assets/grain-256.png', false, [1, 1]);
  U.tGrain.value = grain || white;
  let baked = true;

  const COMMON = `uniform vec3 uFillA, uFillB, uAlbA, uAlbB, uTopA, uTopB; uniform float uMix, uSweepOn, uSweepZ, uSweepDir, uSweepW, uKeyRoom; uniform vec4 uKeyClip;
uniform sampler2D tGrain; varying vec3 vWp;
float roomMix() { float s = smoothstep(-uSweepW, uSweepW, (vWp.z - uSweepZ) * uSweepDir); return mix(uMix, s, uSweepOn); }
float keyClip() { return uKeyRoom * smoothstep(uKeyClip.x, uKeyClip.y, vWp.x) * smoothstep(uKeyClip.z, uKeyClip.w, vWp.y); }
float grainAt(vec2 q) { return texture2D(tGrain, q * 0.9).r * 0.65 + texture2D(tGrain, q * 3.1 + 0.37).r * 0.35; }
`;
  function material(albedo, lm, kind, axis = 'xz') {
    const m = new THREE.MeshLambertMaterial({ map: albedo, lightMap: lm || white, lightMapIntensity: Math.PI });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = COMMON + sh.fragmentShader
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;', 'directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color; directLight.color *= keyClip();'))
        .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps
          .replace('lightMapTexel.rgb * lightMapIntensity', 'lightMapTexel.rgb * lightMapIntensity * mix(uFillA, uFillB, roomMix())'))
        .replace('#include <map_fragment>', `#include <map_fragment>
 float rm = roomMix();
 diffuseColor.rgb *= mix(uAlbA, uAlbB, rm) * (0.80 + 0.40 * grainAt(vWp.${axis}));` +
          (kind === 'wall' ? '\n diffuseColor.rgb *= mix(vec3(1.0), mix(uTopA, uTopB, rm), smoothstep(0.4, 6.5, vWp.y));' : ''));
    };
    m.customProgramCacheKey = () => 'p1room4' + kind + axis;
    return m;
  }
  // flat (unbaked) parts: reveals, skirting, track. Lit by the key and by the room fill x a fixed occlusion.
  function flat(color, occl, kind = 'flat') {
    const m = new THREE.MeshLambertMaterial({ color });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U); sh.uniforms.uOccl = { value: occl };
      sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = COMMON + 'uniform float uOccl;\n' + sh.fragmentShader
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;', 'directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color; directLight.color *= keyClip();'))
        .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n irradiance += mix(uFillA, uFillB, roomMix()) * uOccl * PI * ' + (lmScale * 0.5).toFixed(4) + ';');
    };
    m.customProgramCacheKey = () => 'p1flat4' + kind + occl;
    return m;
  }

  const meshes = {};
  const fy = cfg.floorY;
  function planeGeo(faces, o, u, v) {
    // faces: list of [s0, s1, t0, t1] rectangles in the plane's (s, t) unit coordinates
    const P = [], UV = [], I = [];
    for (const [s0, s1, t0, t1] of faces) {
      const k = P.length / 3;
      for (const [s, t] of [[s0, t0], [s1, t0], [s1, t1], [s0, t1]]) {
        const q = o.clone().addScaledVector(u, s).addScaledVector(v, t); P.push(q.x, q.y, q.z); UV.push(s, t);
      }
      I.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setIndex(I); g.computeVertexNormals(); return g;
  }
  for (const p of cfg.planes) {
    const o = new THREE.Vector3(...p.origin), u = new THREE.Vector3(...p.u), v = new THREE.Vector3(...p.v);
    const faces = [[0, 1, 0, 1]];   // round 4: the back wall is closed (the window is out of frame, camera left)
    const g = planeGeo(faces, o, u, v);
    const isWall = p.mat === 'plaster';
    const rep = [u.length() / p.texScale, v.length() / p.texScale];
    const [alb, lm] = await Promise.all([tex(isWall ? 'assets/plaster-1024.jpg' : 'assets/limestone-1024.jpg', true, rep), tex(`assets/lm-${p.name}.png`, true)]);
    if (!lm) baked = false;
    if (lm) lm.channel = 0;
    const m = new THREE.Mesh(g, material(alb, lm, isWall ? 'wall' : 'floor', p.name === 'back' ? 'zy' : p.name === 'left' ? 'xy' : 'xz'));
    m.receiveShadow = true; m.name = 'room-' + p.name;
    scene.add(m); meshes[p.name] = m;
  }

  // ---- crisp architecture: shadow-gap skirting, the corner line, the window reveals ---------------------------
  const plasterCol = new THREE.Color(0.66, 0.62, 0.56);
  const add = (geo, mat, pos, rotY = 0) => { const me = new THREE.Mesh(geo, mat); me.position.copy(pos); me.rotation.y = rotY; me.receiveShadow = true; scene.add(me); return me; };
  // shadow gap: a 2.2 cm dark recess at the foot of each wall, then a flush plaster skirting face 12 cm tall
  const gapMat = flat(new THREE.Color(0.05, 0.045, 0.04), 0.25, 'gap');
  const skirtMat = flat(plasterCol.clone().multiplyScalar(1.08), 0.62, 'skirt');
  const back = cfg.planes.find((p) => p.name === 'back'), left = cfg.planes.find((p) => p.name === 'left');
  const bx = back.origin[0], lz = left.origin[2];
  { const L = Math.abs(back.u[2]), zc = back.origin[2] + back.u[2] / 2;
    add(new THREE.BoxGeometry(0.03, 0.022, L), gapMat, new THREE.Vector3(bx + 0.002, fy + 0.011, zc));
    add(new THREE.BoxGeometry(0.03, 0.12, L), skirtMat, new THREE.Vector3(bx + 0.012, fy + 0.022 + 0.06, zc)); }
  { const L = Math.abs(left.u[0]), xc = left.origin[0] + left.u[0] / 2;
    add(new THREE.BoxGeometry(L, 0.022, 0.03), gapMat, new THREE.Vector3(xc, fy + 0.011, lz - 0.002));
    add(new THREE.BoxGeometry(L, 0.12, 0.03), skirtMat, new THREE.Vector3(xc, fy + 0.022 + 0.06, lz - 0.012)); }
  // round 4: no hairline up the corner (it crossed the UI as a dark line); the walls simply meet.

  // ---- the ring track: a static brass inlay in the floor (dark joint, brass hairline) ------------------------
  const R = cfg.ring.r, track = new THREE.Group();
  track.position.set(cfg.ring.cx, fy + 0.0015, cfg.ring.cz);
  const ring = (r0, r1, mat) => { const g = new THREE.RingGeometry(r0, r1, 256); g.rotateX(-Math.PI / 2);
    mat.polygonOffset = true; mat.polygonOffsetFactor = -4; mat.polygonOffsetUnits = -4;
    const me = new THREE.Mesh(g, mat); me.receiveShadow = true; track.add(me); return me; };
  ring(R - 0.05, R + 0.05, flat(new THREE.Color(0.06, 0.05, 0.04), 0.3, 'tj'));
  const brass = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.46, 0.22), metalness: 1, roughness: 0.32 });
  ring(R - 0.016, R + 0.016, brass);
  scene.add(track);

  // ---- contact shadows: one baked AO patch (bake/contact), multiplied under each box; it travels with the box --
  const ao = await tex('assets/contact-256.png', false);
  const contactMat = (opacity) => new THREE.ShaderMaterial({
    uniforms: { tAO: { value: ao || white }, uOpacity: { value: opacity } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D tAO; uniform float uOpacity; varying vec2 vUv; void main(){ float a = texture2D(tAO, vUv).r; gl_FragColor = vec4(vec3(mix(1.0, a, uOpacity)), 1.0); }',
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, depthWrite: false, transparent: true,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
  const CS = cfg.contact.size;
  function contactDecal() {
    // uv as in the bake: s along -z, t along -x, centred on the box footprint (x offset -0.15)
    const g = new THREE.PlaneGeometry(CS, CS); g.rotateX(-Math.PI / 2);
    const a = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < a.count; k++) uv.setXY(k, 0.5 - a.getZ(k) / CS, 0.5 - a.getX(k) / CS);
    g.translate(-0.15, 0, 0);
    const me = new THREE.Mesh(g, contactMat(1)); me.renderOrder = 1; me.position.y = fy + 0.003;
    return me;
  }
  if (!ao) baked = false;

  return { cfg, meshes, U, baked, lmScale, track, contactDecal };
}
