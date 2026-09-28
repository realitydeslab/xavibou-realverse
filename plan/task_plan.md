# Task plan — WebGPU murmuration after Xavi Bou

Goal: Three.js (WebGPURenderer + TSL compute) boids flock whose flight is
rendered as chronophotographic trails, matched against Xavi Bou's plates.

## Decisions
- No build step: static `index.html` + ES modules + importmap (three@0.180.0 from jsDelivr).
- Neighbour search: uniform grid, fixed capacity per cell, atomic insert (no prefix sum).
  32k birds: 2.9 ms sim + 7.7 ms render at 1080p on M1 Max.
- Flock chases a wandering target; camera and falcon follow the GPU-measured centroid.
- Trails: MIN (Darken) blend like Bou's stacking; stroke darkness scales with projected width.
- Verification: `tools/refstack.py` (stack raw footage), `tools/compare.py` (metrics),
  `tools/capture_server.py` + `tools/capture_snippet.js` (deterministic captures).

## Steps
- [x] P0 First version (O(N²) boids, ribbons, gallery UI)
- [x] P0 Collect reference videos, extract plates, stack raw murmuration footage
- [x] P0 Metrics + comparison sheets; iterate v1 → v9 (see notes.md)
- [ ] P1 Raise fibre coherence (0.57 → ~0.69) and add fold/twist shapes (turn waves, predator dives)
- [ ] P1 "Close-up" preset: 10–40 birds, large wingspan, visible wing barbs (Bou's ribbon plates)
- [ ] P2 Optional horizon silhouette; HoloKit / WebXR stereo view
