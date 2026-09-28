// Murmuration simulation — boids on the GPU via TSL compute shaders.
//
// Neighbours come from a uniform grid (grid.js), so the cost per bird is
// bounded and 16k–64k birds stay interactive. The flock chases a wandering
// target instead of living in a fixed box: like a real murmuration it stays
// one compact body that travels and folds, which is what makes the stacked
// exposure sweep out a volume instead of piling up in place.
//
// Each bird also owns a ring buffer of K past samples (position + wing
// angle) that trails.js turns into a chronophotographic ribbon.

import {
  Fn, If, Loop, instancedArray, instanceIndex, uniform,
  float, uint, vec3, vec4,
  hash, dot, sqrt, length, normalize, max, min, clamp, fract, sin, smoothstep,
} from 'three/tsl';
import { Vector3 } from 'three/webgpu';

import { createGrid } from './grid.js';

const TAU = Math.PI * 2;

export const DEFAULT_PARAMS = {
  radius: 3.0,        // neighbourhood radius (also the grid cell size)
  sepRadius: 1.5,     // personal space
  separation: 10.0,
  alignment: 5.0,
  cohesion: 0.8,
  edgeTension: 3.0,   // extra cohesion for birds with few neighbours -> crisp flock edge
  attraction: 4.0,    // pull toward the wandering target, only beyond the nominal spread
  levelFlight: 0.9,   // damps vertical velocity -> sheet-like flocks
  minSpeed: 9.0,
  maxSpeed: 15.0,
  predRadius: 14.0,
  flee: 160.0,
  jitter: 0.6,
  flapFreq: 3.0,      // Hz — slow enough to survive 25 Hz sampling as visible scallops
};

export function createFlock(count, samples) {
  const N = count;
  const K = samples;

  const positions = instancedArray(N, 'vec3');
  const velocities = instancedArray(N, 'vec3');
  const phases = instancedArray(N, 'float');
  const history = instancedArray(N * K, 'vec4');

  const grid = createGrid({ positions, count: N, cellSize: DEFAULT_PARAMS.radius });

  const u = {
    dt: uniform(1 / 60),
    time: uniform(0),
    seed: uniform(0),
    head: uniform(0),
    record: uniform(0),
    target: uniform(new Vector3()),
    spread: uniform(new Vector3(42, 11, 26)),  // flock size the target pull aims for
    predator: uniform(new Vector3(0, 0, 400)),
  };
  for (const [key, value] of Object.entries(DEFAULT_PARAMS)) u[key] = uniform(value);

  const rand = (id, salt) => hash(id.mul(7.0).add(salt));

  const init = Fn(() => {
    const id = float(instanceIndex);
    // Uniform-ish points in an ellipsoid around the target.
    const dir = normalize(vec3(rand(id, 1), rand(id, 2), rand(id, 3)).sub(0.5).add(1e-4));
    const r = rand(id, 4).pow(1 / 3);
    const p = u.target.add(dir.mul(r).mul(u.spread)).toVar();
    const v = vec3(
      rand(id, 5).sub(0.5).mul(3).add(11),
      rand(id, 6).sub(0.5).mul(1),
      rand(id, 7).sub(0.5).mul(3).add(2),
    );
    positions.element(instanceIndex).assign(p);
    velocities.element(instanceIndex).assign(v);
    phases.element(instanceIndex).assign(rand(id, 8));

    const base = instanceIndex.mul(uint(K));
    Loop(K, ({ i }) => {
      history.element(base.add(uint(i))).assign(vec4(p, 0.1));
    });
  })().compute(N);

  const update = Fn(() => {
    const id = instanceIndex;
    const idf = float(id);

    const pos = positions.element(id).toVar();
    const vel = velocities.element(id).toVar();

    const sep = vec3(0).toVar();
    const aliSum = vec3(0).toVar();
    const cohSum = vec3(0).toVar();
    const weight = float(0).toVar();
    const R2 = u.radius.mul(u.radius);

    grid.forEachNeighbour(pos, (other) => {
      If(other.notEqual(id), () => {
        const d = positions.element(other).sub(pos).toVar();
        const d2 = dot(d, d).toVar();
        If(d2.lessThan(R2), () => {
          const dist = max(sqrt(d2), 1e-4);
          const w = float(1).sub(dist.div(u.radius));
          aliSum.addAssign(velocities.element(other).mul(w));
          cohSum.addAssign(d.mul(w));
          weight.addAssign(w);
          If(dist.lessThan(u.sepRadius), () => {
            sep.subAssign(d.div(d2.add(0.05)));
          });
        });
      });
    });

    const acc = sep.mul(u.separation).toVar();
    If(weight.greaterThan(1e-3), () => {
      acc.addAssign(aliSum.div(weight).sub(vel).mul(u.alignment));
      // Sparse neighbourhoods (the flock's edge) pull inward harder.
      const edge = float(1).sub(clamp(weight.div(6), 0, 1));
      acc.addAssign(cohSum.div(weight).mul(u.cohesion.add(edge.mul(u.edgeTension))));
    });

    // Pull toward the wandering target, only once a bird is outside the
    // nominal spread — inside it, local rules alone shape the flock.
    const toTarget = u.target.sub(pos).toVar();
    const excess = max(length(toTarget.div(u.spread)).sub(0.7), 0).toVar();
    acc.addAssign(normalize(toTarget.add(1e-4)).mul(u.attraction).mul(min(excess.mul(excess).mul(4), 8)));

    // Starlings fly mostly level; this flattens the flock into sheets.
    acc.subAssign(vec3(0, vel.y.mul(u.levelFlight), 0));

    // Falcon: a sharp, local panic that ripples through the flock.
    const away = pos.sub(u.predator).toVar();
    const dp = length(away).toVar();
    If(dp.lessThan(u.predRadius), () => {
      const k = float(1).sub(dp.div(u.predRadius));
      acc.addAssign(away.div(max(dp, 0.01)).mul(k.mul(k).mul(u.flee)));
    });

    const s = idf.mul(3.0).add(u.seed);
    acc.addAssign(vec3(hash(s), hash(s.add(1)), hash(s.add(2))).sub(0.5).mul(u.jitter));

    vel.addAssign(acc.mul(u.dt));
    const speed = max(length(vel), 1e-4);
    vel.assign(vel.div(speed).mul(clamp(speed, u.minSpeed, u.maxSpeed)));
    pos.addAssign(vel.mul(u.dt));

    positions.element(id).assign(pos);
    velocities.element(id).assign(vel);

    // Wingbeat: each bird alternates flapping bursts and glides.
    const individual = hash(idf.add(0.5));
    const phase = phases.element(id);
    phase.assign(fract(phase.add(u.dt.mul(u.flapFreq).mul(individual.mul(0.5).add(0.75)))));
    const flapping = smoothstep(-0.3, 0.3, sin(u.time.mul(0.6).add(individual.mul(40))));
    const angle = sin(phase.mul(TAU)).mul(flapping.mul(0.85).add(0.1)).add(0.12);

    If(u.record.greaterThan(0.5), () => {
      history.element(id.mul(uint(K)).add(uint(u.head))).assign(vec4(pos, angle));
    });
  })().compute(N);

  // Centroid: 256 threads each sum a strided slice; the CPU adds 256 partials
  // (4 KB readback) instead of reading every bird.
  const LANES = 256;
  const partial = instancedArray(LANES, 'vec4');
  const reduce = Fn(() => {
    const sum = vec3(0).toVar();
    Loop({ start: instanceIndex, end: uint(N), type: 'uint', condition: '<', update: LANES }, ({ i }) => {
      sum.addAssign(positions.element(i));
    });
    partial.element(instanceIndex).assign(vec4(sum, 0));
  })().compute(LANES);

  const centroid = async (renderer, out) => {
    renderer.compute(reduce);
    const data = new Float32Array(await renderer.getArrayBufferAsync(partial.value));
    out.set(0, 0, 0);
    for (let i = 0; i < LANES; i++) out.x += data[i * 4], out.y += data[i * 4 + 1], out.z += data[i * 4 + 2];
    return out.multiplyScalar(1 / N);
  };

  // One simulation step: rebuild the grid, then move every bird.
  const step = (renderer) => {
    renderer.compute(grid.clear);
    renderer.compute(grid.insert);
    renderer.compute(update);
  };

  return { count: N, samples: K, positions, velocities, history, uniforms: u, init, step, centroid, grid };
}
