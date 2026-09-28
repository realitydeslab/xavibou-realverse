# Notes — matching Xavi Bou's plates (2026-09-28)

## Reference set (local only, see .gitignore)
- 10 YouTube videos in `reference/videos/` (~315 MB): BirdNote, TEDxKonstanz,
  Punto de Vista, VICE Creators, DW Euromaxx, Galeria Senda, Jolly Persons, etc.
- Bou's own films on xavibou.com are Vimeo embeds with domain privacy (HTTP 401) — not downloaded.
- Own-channel YouTube uploads (Murmurations, FLUCTUS, Emergence) report "not available".
- 26 frames in `reference/frames/`: 9 murmuration plates, 12 close-up flight plates, 5-step stacking sequence.
- Raw murmuration footage: TEDx 673.2–687.7 s (`reference/raw/tedx_murmuration.mp4`, cut at 4.32 s).

## What stacking his raw footage shows (tools/refstack.py)
- Darken blend (per-pixel max ink vs median sky) reproduces his smoky murmuration look.
- Overlaps do not accumulate: tone = coverage + size of the nearest bird, not stroke count.
- Birds are ~1:500 wingspan-to-flock; each bird is a 1–3 px line with small per-frame wing barbs.

## Metric trajectory (medians; tools/compare.py, 8 renders each)
| version | change | coverage | dense | extent | ink | coherence | stroke px |
|---|---|---|---|---|---|---|---|
| Bou murmuration (9) | target | 0.70 | 0.36 | 0.74 | 0.45 | 0.69 | 12.1 |
| v1 | original (box bounds, 4k, alpha blend) | 0.05 | 0.03 | 0.04 | 0.67 | 0.93 | 30.3 |
| v2 | grid + wandering target, 16k | 0.19 | 0.11 | 0.17 | 0.52 | 0.76 | 28.6 |
| v3 | telephoto 24°, 32k, thin wings | 0.61 | 0.37 | 0.54 | 0.53 | 0.71 | 32.1 |
| v5 | MIN (Darken) blend, first try | 0.03 | 0.00 | 0.13 | 0.09 | 0.58 | 0.0 |
| v6 | equal-weight frames, darker body | 0.52 | 0.00 | 0.52 | 0.22 | 0.60 | 7.2 |
| v7 | darkness by projected width | 0.42 | 0.09 | 0.47 | 0.32 | 0.56 | 6.5 |
| v8 | camera/falcon follow GPU centroid | 0.55 | 0.13 | 0.61 | 0.32 | 0.52 | 5.9 |
| v9 | alignment 5, jitter 0.6, body 0.28 | 0.61 | 0.26 | 0.66 | 0.41 | 0.57 | 10.0 |

## Remaining gaps (v9)
- Coherence 0.57 vs 0.69: fibres cross more than his; lower flock edge is "curly".
- Shapes are rounded cigars; his plates have folds, twists, tapered tails, sharp silhouettes.
- No landscape horizon; his plates often anchor the flock over a tree line / sea.
- Wing barbs barely visible at murmuration scale (they are in his close-ups).
