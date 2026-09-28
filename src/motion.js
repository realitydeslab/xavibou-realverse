// Scripted motion on the CPU: the wandering target the flock chases, and
// the falcon that cuts through it (or follows the cursor).

import * as THREE from 'three/webgpu';

// Smooth, non-repeating wander confined to the camera's field of view.
export function targetAt(t, out) {
  return out.set(
    46 * Math.sin(t * 0.11) + 12 * Math.sin(t * 0.29 + 1.0),
    6 * Math.sin(t * 0.17 + 2.0) + 3 * Math.sin(t * 0.41),
    22 * Math.sin(t * 0.13 + 4.0) + 6 * Math.sin(t * 0.37 + 0.5),
  );
}

export function createFalcon(camera, domElement) {
  const pointer = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const position = new THREE.Vector3(0, 0, 400);
  const goal = new THREE.Vector3();
  let pointerActive = false;

  domElement.addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    pointerActive = true;
  });
  domElement.addEventListener('pointerleave', () => { pointerActive = false; });

  const falcon = {
    mode: 'auto',
    position,
    update(t, target) {
      if (falcon.mode === 'cursor' && pointerActive) {
        camera.getWorldDirection(normal);
        plane.setFromNormalAndCoplanarPoint(normal, target);
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(plane, hit)) goal.copy(hit);
      } else {
        // Circles the flock and dives through it every ~20 s.
        const r = 26 + 24 * Math.sin(t * 0.31);
        goal.set(
          target.x + Math.cos(t * 0.53) * r,
          target.y + Math.sin(t * 0.71) * 5,
          target.z + Math.sin(t * 0.53) * r * 0.6,
        );
      }
      position.lerp(goal, 0.1);
      return position;
    },
  };
  return falcon;
}
