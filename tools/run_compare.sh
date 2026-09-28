#!/usr/bin/env bash
# Compare render series against Bou references.
#   tools/run_compare.sh v2 [v1 ...]   -> reference/compare/<last>.jpg + .json
set -euo pipefail
cd "$(dirname "$0")/.."
F=reference/frames
args=(
  --group bou_murmuration $F/plate_birdnote_murm.jpg $F/plate_dw_murm_tree.jpg $F/plate_gallery_blue.jpg
          $F/plate_gallery_grey.jpg $F/plate_murm_dusk.jpg $F/plate_murm_fur.jpg $F/plate_murm_tree.jpg
          $F/plate_murm_smoke1.jpg $F/plate_murm_smoke2.jpg
  --group bou_flight $F/plate_jp_*.jpg $F/plate_ribbon_dusk.jpg $F/plate_loop.jpg $F/plate_flock_combed.jpg
          $F/plate_sparse_sky.jpg
)
for tag in "$@"; do args+=(--group "render_$tag" reference/renders/${tag}_*.png); done
python3 tools/compare.py "${args[@]}" --out "reference/compare/${!#}.jpg"
