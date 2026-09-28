import * as THREE from 'three/webgpu';
import { Fn, uniform, mix, screenUV, screenCoordinate, hash, length, smoothstep, vec4 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

import { createFlock, DEFAULT_PARAMS } from './flock.js';
import { createTrails } from './trails.js';
import { targetAt, createFalcon } from './motion.js';

const params = new URLSearchParams(location.search);
const BIRDS = THREE.MathUtils.clamp(parseInt(params.get('n') ?? '32768', 10) || 32768, 256, 65536);
const SAMPLES = THREE.MathUtils.clamp(parseInt(params.get('k') ?? '96', 10) || 96, 8, 160);
const SAMPLE_RATE = 25; // Hz — matches the 25 fps footage Bou stacks
const STEP = 1 / 60;    // fixed simulation step

const THEMES = {
  overcast: { name: 'Overcast', top: '#eceae4', bottom: '#c6cacb', ink: '#15171a', additive: false, strength: 0.95 },
  dusk: { name: 'Dusk', top: '#243247', bottom: '#8c6d66', ink: '#0b0d12', additive: false, strength: 0.9 },
  night: { name: 'Night', top: '#05070b', bottom: '#172030', ink: '#b9c8e0', additive: true, strength: 0.55 },
};

const $ = (id) => document.getElementById(id);

async function main() {
  if (!navigator.gpu) {
    document.body.classList.add('no-webgpu');
    return;
  }

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  $('stage').appendChild(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, 0.5, 1200); // telephoto, like Bou's long lens
  camera.position.set(-12, -22, 97);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;
  controls.minDistance = 30;
  controls.maxDistance = 420;

  // Sky: vertical gradient, soft vignette, static film grain.
  const sky = { top: uniform(new THREE.Color()), bottom: uniform(new THREE.Color()) };
  scene.backgroundNode = Fn(() => {
    const g = mix(sky.top, sky.bottom, smoothstep(0.0, 1.0, screenUV.y));
    const vignette = smoothstep(0.25, 1.05, length(screenUV.sub(0.5)).mul(1.3)).oneMinus().mul(0.18).add(0.82);
    const grain = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096))).sub(0.5).mul(0.035);
    return vec4(g.mul(vignette).add(grain), 1);
  })();

  const flock = createFlock(BIRDS, SAMPLES);
  const trails = createTrails(flock);
  scene.add(trails.mesh);
  targetAt(0, flock.uniforms.target.value);
  renderer.compute(flock.init);

  const state = {
    theme: 'overcast',
    frozen: false,
    accumulator: 0,
    head: 0,
    filled: 0,
    sinceSample: 0,
    time: 0,
    frame: 0,
    capture: false,
  };

  const applyTheme = (key) => {
    const t = THEMES[key];
    state.theme = key;
    sky.top.value.set(t.top);
    sky.bottom.value.set(t.bottom);
    trails.setTheme(t);
    document.documentElement.dataset.theme = key;
    $('theme').textContent = t.name;
  };
  applyTheme('overcast');

  const falcon = createFalcon(camera, renderer.domElement);
  const target = flock.uniforms.target.value;

  // The camera trails the flock like a photographer panning a telephoto:
  // the orbit pivot eases toward the target and the camera moves with it.
  const flockCenter = target.clone();   // measured on the GPU, refreshed a few times per second
  const centroidTmp = new THREE.Vector3();
  let centroidPending = null;
  const refreshCentroid = () => {
    centroidPending ??= flock.centroid(renderer, centroidTmp).then((c) => {
      flockCenter.copy(c);
      centroidPending = null;
    });
    return centroidPending;
  };
  const focus = target.clone();
  const focusStep = new THREE.Vector3();
  controls.target.copy(target);
  camera.position.add(target);
  const follow = (dt) => {
    focusStep.copy(flockCenter).sub(focus).multiplyScalar(1 - Math.exp(-dt * 1.6));
    focus.add(focusStep);
    controls.target.add(focusStep);
    camera.position.add(focusStep);
  };

  // One fixed simulation step; records a trail sample at SAMPLE_RATE.
  const simulate = (dt) => {
    state.time += dt;
    state.frame++;
    targetAt(state.time, target);
    flock.uniforms.predator.value.copy(falcon.update(state.time, flockCenter));

    state.sinceSample += dt;
    const record = state.sinceSample >= 1 / SAMPLE_RATE;
    if (record) {
      state.sinceSample -= 1 / SAMPLE_RATE;
      state.head = (state.head + 1) % SAMPLES;
      state.filled = Math.min(state.filled + 1, SAMPLES);
    }

    const u = flock.uniforms;
    u.dt.value = dt;
    u.time.value = state.time;
    u.seed.value = (state.frame * 7919) % 1000003;
    u.head.value = state.head;
    u.record.value = record ? 1 : 0;
    flock.step(renderer);
    trails.uniforms.filled.value = state.filled;
    follow(dt);
    trails.uniforms.focus.value = camera.position.distanceTo(controls.target);
  };

  // --- Controls ----------------------------------------------------------
  const exposure = $('exposure');
  exposure.max = String(SAMPLES);
  exposure.value = String(Math.min(2 * SAMPLE_RATE, SAMPLES));
  const syncExposure = () => {
    const n = Number(exposure.value);
    trails.uniforms.length.value = n;
    $('exposure-value').textContent = `${(n / SAMPLE_RATE).toFixed(1)} s`;
    $('meta-exposure').textContent = `${(n / SAMPLE_RATE).toFixed(1)} s`;
  };
  exposure.addEventListener('input', syncExposure);
  syncExposure();

  const setFrozen = (v) => {
    state.frozen = v;
    $('shutter').classList.toggle('is-on', v);
    $('shutter').setAttribute('aria-pressed', String(v));
    $('shutter-label').textContent = v ? 'Released' : 'Shutter';
    document.body.classList.toggle('frozen', v);
  };
  const cycleTheme = () => {
    const keys = Object.keys(THEMES);
    applyTheme(keys[(keys.indexOf(state.theme) + 1) % keys.length]);
  };
  const toggleFalcon = () => {
    falcon.mode = falcon.mode === 'auto' ? 'cursor' : 'auto';
    $('falcon').textContent = falcon.mode === 'auto' ? 'Wild' : 'Cursor';
  };
  const reset = () => {
    targetAt(state.time, target);
    flockCenter.copy(target);
    focusStep.copy(target).sub(focus);
    focus.copy(target);
    controls.target.add(focusStep);
    camera.position.add(focusStep);
    renderer.compute(flock.init);
    state.head = 0;
    state.filled = 0;
    state.sinceSample = 0;
  };

  $('shutter').addEventListener('click', () => setFrozen(!state.frozen));
  $('theme-btn').addEventListener('click', cycleTheme);
  $('falcon-btn').addEventListener('click', toggleFalcon);
  $('save').addEventListener('click', () => { state.capture = true; });

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); setFrozen(!state.frozen); }
    else if (e.key === 't') cycleTheme();
    else if (e.key === 'f') toggleFalcon();
    else if (e.key === 'r') reset();
    else if (e.key === 's') state.capture = true;
    else if (e.key === 'h') document.body.classList.toggle('hide-ui');
    else if (e.key === 'g') gui.show(gui._hidden); // lil-gui: toggles visibility
  });

  // Tuning panel (hidden by default; press G).
  const gui = new GUI({ title: 'Flock' });
  gui.hide();
  const tune = { ...DEFAULT_PARAMS };
  for (const key of Object.keys(DEFAULT_PARAMS)) {
    const v = DEFAULT_PARAMS[key];
    // The grid cell equals the default radius; a larger radius would miss neighbours.
    const hi = key === 'radius' ? v : v * 3;
    gui.add(tune, key, 0, hi, v / 100).onChange((x) => { flock.uniforms[key].value = x; });
  }
  gui.add(trails.uniforms.strength, 'value', 0.05, 1, 0.01).name('ink strength');
  gui.add(trails.uniforms.wing, 'value', 0, 1, 0.01).name('wing barbs');
  gui.add(trails.uniforms.body, 'value', 0.02, 0.6, 0.01).name('body width');
  gui.add(trails.uniforms.span, 'value', 0.05, 1.5, 0.01).name('half wingspan');
  gui.add(controls, 'autoRotate');

  $('meta-count').textContent = BIRDS.toLocaleString('en-US').replace(',', ' ');
  $('meta-frames').textContent = `${SAMPLE_RATE} / s`;

  // --- Loop --------------------------------------------------------------
  const clock = new THREE.Clock();
  let fpsFrames = 0;
  let fpsTime = 0;

  const saveImage = () => {
    renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ornithography-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  };

  renderer.setAnimationLoop(() => {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 1 / 30);

    if (!state.frozen) {
      state.accumulator = Math.min(state.accumulator + dt, 4 * STEP);
      while (state.accumulator >= STEP) {
        simulate(STEP);
        state.accumulator -= STEP;
      }
      if (state.frame % 6 === 0) refreshCentroid();
    }

    controls.update(dt);
    renderer.render(scene, camera);

    if (state.capture) {
      state.capture = false;
      saveImage();
    }

    fpsFrames++;
    fpsTime += rawDt;
    if (fpsTime > 0.5) {
      $('meta-fps').textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // Debug / capture hook: advance the simulation deterministically, then draw.
  const advance = async (seconds) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      simulate(STEP);
      if (state.frame % 6 === 0) await refreshCentroid();
    }
    renderer.render(scene, camera);
  };
  window.__study = { renderer, scene, camera, controls, flock, trails, state, advance, reset, applyTheme };
  document.body.classList.add('ready');
}

main().catch((err) => {
  console.error(err);
  document.body.classList.add('no-webgpu');
});
