"""Reproduce Xavi Bou's frame stacking on raw footage.

Given a clip of dark birds against a bright sky, estimate the empty sky as
the per-pixel median, turn each frame into an "ink" map (how much darker
than the sky it is), and keep the per-pixel maximum ink over an exposure
window. This is the "Darken" blend Bou describes, computed exactly.

Usage:
    python3 tools/refstack.py reference/raw/tedx_murmuration.mp4 \
        --start 4.4 --windows 0.5 1 2 4 8 --out reference/stacks
"""

from __future__ import annotations

import argparse
import logging
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)


def read_frames(path: Path, start: float, duration: float, width: int) -> tuple[np.ndarray, float]:
    """Decode frames as float32 luminance in [0, 1], shape (T, H, W)."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
         "stream=width,height,r_frame_rate", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip().split(",")
    src_w, src_h = int(probe[0]), int(probe[1])
    num, den = probe[2].split("/")
    fps = float(num) / float(den)
    height = round(src_h * width / src_w / 2) * 2

    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-ss", str(start), "-t", str(duration), "-i", str(path),
         "-vf", f"scale={width}:{height}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        check=True, capture_output=True,
    ).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width)
    return frames.astype(np.float32) / 255.0, fps


def ink_maps(frames: np.ndarray) -> np.ndarray:
    """Per-frame darkening relative to the median sky, in [0, 1]."""
    sky = np.median(frames, axis=0)
    ink = (sky[None] - frames) / np.maximum(sky[None], 1e-3)
    return np.clip(ink, 0.0, 1.0)


def stack(ink: np.ndarray, frames: int) -> np.ndarray:
    """Max-ink over the first `frames` frames (Darken blend)."""
    return ink[:frames].max(axis=0)


def to_plate(ink: np.ndarray) -> Image.Image:
    """Render ink on white paper for side-by-side viewing."""
    return Image.fromarray(((1.0 - ink) * 255).astype(np.uint8), mode="L")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("clip", type=Path)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--windows", type=float, nargs="+", default=[0.5, 1, 2, 4])
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--out", type=Path, default=Path("reference/stacks"))
    parser.add_argument("--tag", default="", help="suffix to keep runs on different shots apart")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    frames, fps = read_frames(args.clip, args.start, max(args.windows) + 0.1, args.width)
    logger.info("decoded %d frames at %.2f fps, %dx%d", len(frames), fps, frames.shape[2], frames.shape[1])
    ink = ink_maps(frames)

    args.out.mkdir(parents=True, exist_ok=True)
    stem = args.clip.stem + (f"_{args.tag}" if args.tag else "")
    to_plate(ink[0]).save(args.out / f"{stem}_single.png")
    for seconds in args.windows:
        n = min(len(ink), max(1, round(seconds * fps)))
        path = args.out / f"{stem}_{seconds:g}s.png"
        to_plate(stack(ink, n)).save(path)
        logger.info("%s  (%d frames)", path, n)


if __name__ == "__main__":
    main()
