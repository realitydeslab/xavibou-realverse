// Uniform spatial grid for neighbour search on the GPU.
//
// Each cell holds up to CAPACITY bird indices. Insertion uses one atomic
// counter per cell, so no prefix sum or sort is needed; birds beyond the
// capacity of an over-full cell are simply not listed (separation keeps
// real densities well below it). Birds outside the grid clamp to the border.

import {
  Fn, If, Loop, instancedArray, storage, instanceIndex, uniform,
  uint, ivec3, floor, clamp, min, atomicAdd,
} from 'three/tsl';
import { Vector3 } from 'three/webgpu';

export function createGrid({ positions, count, cellSize, dims = [96, 40, 96], capacity = 24 }) {
  const [gx, gy, gz] = dims;
  const cells = gx * gy * gz;

  const countsAtomic = instancedArray(cells, 'uint').toAtomic();
  const countsWrite = storage(countsAtomic.value, 'uint', cells);
  const countsRead = storage(countsAtomic.value, 'uint', cells).toReadOnly();
  const members = instancedArray(cells * capacity, 'uint');

  const size = new Vector3(gx, gy, gz).multiplyScalar(cellSize);
  const origin = uniform(size.clone().multiplyScalar(-0.5));
  const inv = 1 / cellSize;
  const maxCell = ivec3(gx - 1, gy - 1, gz - 1);

  const cellOf = (p) => clamp(ivec3(floor(p.sub(origin).mul(inv))), ivec3(0), maxCell);
  const flat = (c) => c.x.add(c.y.mul(gx)).add(c.z.mul(gx * gy));

  const clear = Fn(() => {
    countsWrite.element(instanceIndex).assign(uint(0));
  })().compute(cells);

  const insert = Fn(() => {
    const c = flat(cellOf(positions.element(instanceIndex))).toVar();
    const slot = atomicAdd(countsAtomic.element(c), uint(1)).toVar();
    If(slot.lessThan(uint(capacity)), () => {
      members.element(uint(c).mul(uint(capacity)).add(slot)).assign(instanceIndex);
    });
  })().compute(count);

  // Calls visit(otherIndex) for every listed bird in the 27 cells around p.
  const forEachNeighbour = (p, visit) => {
    const home = cellOf(p).toVar();
    Loop(3, 3, 3, ({ i, j, k }) => {
      const c = home.add(ivec3(i.sub(1), j.sub(1), k.sub(1))).toVar();
      const inside = c.x.greaterThanEqual(0).and(c.x.lessThan(gx))
        .and(c.y.greaterThanEqual(0)).and(c.y.lessThan(gy))
        .and(c.z.greaterThanEqual(0)).and(c.z.lessThan(gz));
      If(inside, () => {
        const id = flat(c).toVar();
        const n = min(countsRead.element(id), uint(capacity)).toVar();
        const base = uint(id).mul(uint(capacity)).toVar();
        Loop({ start: uint(0), end: n, type: 'uint', condition: '<', name: 'm' }, ({ m }) => {
          visit(members.element(base.add(m)).toVar());
        });
      });
    });
  };

  return { clear, insert, forEachNeighbour, origin, size, cells, capacity };
}
