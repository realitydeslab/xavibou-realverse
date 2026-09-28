# Ornithographic Study — WebGPU murmuration

**Live:** https://realitydeslab.github.io/xavibou-realverse/ (needs a WebGPU browser)

A starling murmuration simulated on the GPU (Three.js `WebGPURenderer` + TSL
compute shaders) and drawn as frame-stacked flight traces, after Xavi Bou's
*Ornithographies*.

## Run

No build step. Serve the folder over HTTP and open it in a WebGPU browser
(Chrome/Edge 113+, Safari 26+):

```bash
python3 -m http.server 5173
# open http://localhost:5173/
```

URL parameters: `?n=65536` birds (256–65536, default 32768), `?k=128` trail
samples (8–160, default 96, sampled at 25 Hz).

## Controls

| Input | Action |
| --- | --- |
| drag / wheel | orbit / zoom |
| Space, **Shutter** | freeze the flock; the trace stays and can be orbited |
| **Exposure** slider | visible trail length (samples at 25 Hz) |
| T, **Sky** | Overcast → Dusk → Night |
| F, **Falcon** | predator flies its own path, or follows the cursor |
| S, **Save plate** | download the current frame as PNG |
| R | re-scatter the flock |
| H / G | hide UI / open tuning panel |

## How it works

- `src/grid.js` — uniform spatial grid; atomic per-cell insert, 27-cell query.
- `src/flock.js` — boids (separation, alignment, cohesion, edge tension),
  a wandering target the flock chases, level-flight damping and a falcon
  that triggers the ripple waves typical of murmurations. Each bird writes
  its position and wing angle into a K-sample ring buffer at 25 Hz. A
  256-lane reduction gives the flock centroid for the camera and falcon.
- `src/trails.js` — one instanced ribbon per bird, wingtip to wingtip at
  each past sample. Drawn with a MIN blend (Bou's Darken stacking): a thin
  body line whose darkness follows the bird's projected width, plus a wing
  barb at every recorded frame.
- `src/motion.js` — target path and falcon. `src/main.js` — renderer, sky, UI.

## Comparing against Bou's plates

```bash
python3 tools/capture_server.py &          # sink for canvas captures (port 5174)
# in the page console:
#   eval(await (await fetch('/tools/capture_snippet.js')).text())
#   await __series('v10', [8, 14, 20, 26], [50, 96])
tools/run_compare.sh v9 v10                # metrics + sheet in reference/compare/
python3 tools/refstack.py reference/raw/tedx_murmuration.mp4 --start 4.4 --tag B
```

Reference footage under `reference/` is third-party material kept for local
study only (git-ignored). Findings and the metric history are in `plan/notes.md`.
