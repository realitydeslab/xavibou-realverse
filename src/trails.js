// Chronophotographic trails.
//
// Each bird is drawn as one instanced ribbon with K cross-sections. A
// cross-section runs wingtip to wingtip at one past sample, tilted by the
// wing angle recorded at that moment, so the ribbon is a real 3D surface
// you can orbit.
//
// Shading follows how Xavi Bou builds his plates: frames are combined with
// a Darken blend, so overlapping birds do not accumulate — tone comes from
// coverage. We use the GPU's MIN blend (MAX for light-on-dark skies). Each
// ribbon draws an opaque, anti-aliased body line plus a faint wing "barb"
// at every recorded frame, the fishbone texture visible in his prints.

import * as THREE from 'three/webgpu';
import {
  storage, instanceIndex, positionGeometry, uniform, varying, cameraPosition,
  float, uint, vec3,
  hash, normalize, cross, length, sin, cos, abs, fract, fwidth,
  min, max, mix, select, step, smoothstep,
} from 'three/tsl';

export function createTrails(flock) {
  const { count: N, samples: K } = flock;

  // Geometry: position.x = sample index (0 = newest), position.y = side (-1 | +1).
  const verts = new Float32Array(K * 2 * 3);
  for (let i = 0; i < K; i++) {
    verts.set([i, -1, 0, i, 1, 0], i * 6);
  }
  const index = [];
  for (let i = 0; i < K - 1; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geometry.setIndex(index);
  geometry.instanceCount = N;

  // Read-only view of the same GPU buffer the compute pass writes.
  const history = storage(flock.history.value, 'vec4', N * K).toReadOnly();

  const u = {
    head: flock.uniforms.head,
    filled: uniform(0),       // samples recorded so far (<= K)
    length: uniform(40),      // visible exposure length in samples
    span: uniform(0.16),      // half wingspan
    strength: uniform(0.85),  // darkness of one stroke (Darken blend never exceeds it)
    wing: uniform(0.15),      // wing-barb strength relative to the body line
    body: uniform(0.28),      // body-line half width, as a fraction of the wingspan
    focus: uniform(100),      // camera distance to the flock, for depth fading
    ink: uniform(new THREE.Color('#16181b')),
    lighten: uniform(0),      // 0: dark ink on light sky (MIN), 1: light on dark (MAX)
  };

  const slot = (s) => {
    const x = u.head.sub(s).add(K);
    return uint(select(x.greaterThanEqual(K), x.sub(K), x).add(0.5));
  };

  // --- Vertex: place the cross-section of sample s ------------------------
  const sample = positionGeometry.x;
  const side = positionGeometry.y;
  const last = min(u.filled, u.length).sub(1);
  // Unrecorded / hidden samples collapse onto the oldest visible one.
  const s = max(min(sample, last), 0);
  const base = instanceIndex.mul(uint(K));

  const now = history.element(base.add(slot(s)));
  const newer = history.element(base.add(slot(max(s.sub(1), 0))));
  const older = history.element(base.add(slot(min(s.add(1), K - 1))));

  const angle = now.w;
  const fwd = normalize(newer.xyz.sub(older.xyz).add(vec3(0, 0, 1e-4)));
  const wingAxis = normalize(cross(fwd, vec3(0, 1, 0)).add(vec3(1e-4, 0, 0)));
  const lift = cross(wingAxis, fwd);
  const individual = hash(float(instanceIndex).add(0.5));
  const size = u.span.mul(individual.mul(0.5).add(0.75));
  const tip = wingAxis.mul(cos(angle).mul(side)).add(lift.mul(sin(angle)));
  const world = now.xyz.add(tip.mul(size));

  const age = s.div(max(u.length, 1));
  // A photographic stack weighs every frame equally; only the last ~8% of
  // the window tapers so samples leaving the ring buffer do not pop.
  const fade = smoothstep(0.92, 1.0, age).oneMinus().mul(step(0.5, u.filled));
  // Atmospheric perspective: far birds print lighter, as in a telephoto plate.
  const depth = length(world.sub(cameraPosition)).sub(u.focus);
  const aerial = mix(float(1), float(0.65), smoothstep(-30, 60, depth));
  const vStroke = varying(fade.mul(aerial).mul(individual.mul(0.3).add(0.85)));

  // --- Fragment: body line + per-frame wing barbs -------------------------
  const across = abs(positionGeometry.y);                 // 0 at the body, 1 at the wingtips
  const aa = max(fwidth(across), 1e-4);
  const halfWidth = max(u.body, aa.mul(0.6));             // never thinner than ~1 px
  // A bird narrower than a pixel only partly darkens it: near birds print
  // solid, far ones faint. This is where the depth in a Darken stack comes from.
  const subpixel = min(u.body.div(aa.mul(0.6)), 1);
  const bodyLine = smoothstep(halfWidth.sub(aa), halfWidth.add(aa), across).oneMinus().mul(subpixel);
  const frame = abs(fract(positionGeometry.x.add(0.5)).sub(0.5));  // 0 on each recorded frame
  const fa = max(fwidth(positionGeometry.x), 1e-4);
  const barb = smoothstep(0.0, fa.mul(1.2).add(0.06), frame).oneMinus().mul(u.wing);
  const cover = min(max(bodyLine, barb).mul(vStroke).mul(u.strength), 1);

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
  });
  material.positionNode = world;
  // MIN: paper white lerped toward ink by coverage. MAX: black lerped toward ink.
  material.colorNode = mix(mix(vec3(1), u.ink, cover), u.ink.mul(cover), u.lighten);
  material.opacityNode = float(1);
  material.blendSrc = material.blendDst = THREE.OneFactor;
  material.blendSrcAlpha = material.blendDstAlpha = THREE.OneFactor;

  const setTheme = (theme) => {
    const eq = theme.additive ? THREE.MaxEquation : THREE.MinEquation;
    material.blendEquation = eq;
    material.blendEquationAlpha = eq;
    u.lighten.value = theme.additive ? 1 : 0;
    u.ink.value.set(theme.ink);
    u.strength.value = theme.strength;
    material.needsUpdate = true;
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return { mesh, uniforms: u, setTheme };
}
