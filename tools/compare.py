"""Measure ornithography plates and our renders with the same metrics.

For each image the sky is estimated as a smooth quadratic surface fitted
only to bright pixels (robust to large dark flocks), and ink is the
relative darkening against it. Metrics, all on a 480-px-wide copy:

  coverage   fraction of the frame with visible ink (ink > 0.08)
  dense      fraction of the frame with heavy ink  (ink > 0.45)
  extent     area of the box holding the central 95% of ink mass
  ink_mean   mean ink over covered pixels (how dark the trace reads)
  coherence  structure-tensor coherence over covered pixels
             (1 = parallel hatching, 0 = isotropic noise)
  stroke_px  mean stroke width, 2 * area / perimeter of the ink > 0.25 mask

Usage:
    python3 tools/compare.py --group murmuration reference/frames/plate_murm_*.jpg \
        --group ours reference/renders/*.png --out reference/compare/sheet.jpg
"""

from __future__ import annotations

import argparse
import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

WIDTH = 480


@dataclass(frozen=True)
class Metrics:
    coverage: float
    dense: float
    extent: float
    ink_mean: float
    coherence: float
    stroke_px: float


def load_gray(path: Path) -> np.ndarray:
    im = Image.open(path).convert("L")
    h = round(im.height * WIDTH / im.width)
    return np.asarray(im.resize((WIDTH, h), Image.LANCZOS), dtype=np.float32) / 255.0


def fit_sky(gray: np.ndarray, iterations: int = 6) -> np.ndarray:
    """Quadratic surface fitted to pixels at or above the current estimate."""
    h, w = gray.shape
    yy, xx = np.mgrid[0:h, 0:w]
    x = (xx / w - 0.5).ravel()
    y = (yy / h - 0.5).ravel()
    basis = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=1)
    values = gray.ravel()
    mask = values >= np.percentile(values, 40)
    for _ in range(iterations):
        coef, *_ = np.linalg.lstsq(basis[mask], values[mask], rcond=None)
        sky = basis @ coef
        mask = values >= sky - 0.02
    return (basis @ coef).reshape(h, w)


def ink_map(gray: np.ndarray) -> np.ndarray:
    sky = fit_sky(gray)
    return np.clip((sky - gray) / np.maximum(sky, 0.05), 0.0, 1.0)


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur for float arrays (PIL only blurs 8-bit)."""
    r = max(1, int(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    a = np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode="edge"), k, "valid"), 1, a)
    return np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode="edge"), k, "valid"), 0, a)


def coherence(ink: np.ndarray, mask: np.ndarray) -> float:
    gy, gx = np.gradient(blur(ink, 0.8))
    jxx, jyy, jxy = blur(gx * gx, 3), blur(gy * gy, 3), blur(gx * gy, 3)
    trace = jxx + jyy
    diff = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2)
    c = diff / np.maximum(trace, 1e-6)
    weight = trace * mask
    return float((c * weight).sum() / max(weight.sum(), 1e-6))


def stroke_width(mask: np.ndarray) -> float:
    area = mask.sum()
    if area < 20:
        return 0.0
    edge = mask & ~(
        np.roll(mask, 1, 0) & np.roll(mask, -1, 0) & np.roll(mask, 1, 1) & np.roll(mask, -1, 1)
    )
    return float(2 * area / max(edge.sum(), 1))


def extent(ink: np.ndarray) -> float:
    total = ink.sum()
    if total < 1e-3:
        return 0.0
    h, w = ink.shape

    def span(profile: np.ndarray) -> float:
        cdf = np.cumsum(profile) / total
        return float(np.searchsorted(cdf, 0.975) - np.searchsorted(cdf, 0.025)) / len(profile)

    return span(ink.sum(axis=0)) * span(ink.sum(axis=1))


def measure(path: Path) -> tuple[Metrics, np.ndarray]:
    ink = ink_map(load_gray(path))
    covered = ink > 0.08
    metrics = Metrics(
        coverage=float(covered.mean()),
        dense=float((ink > 0.45).mean()),
        extent=extent(ink * covered),
        ink_mean=float(ink[covered].mean()) if covered.any() else 0.0,
        coherence=coherence(ink, covered),
        stroke_px=stroke_width(ink > 0.25),
    )
    return metrics, ink


def summarize(rows: list[Metrics]) -> dict[str, tuple[float, float]]:
    fields = asdict(rows[0]).keys()
    return {f: (float(np.median([getattr(r, f) for r in rows])),
                float(np.std([getattr(r, f) for r in rows]))) for f in fields}


def contact_sheet(groups: dict[str, list[tuple[Path, Metrics, np.ndarray]]], out: Path) -> None:
    tw, th, pad, label = 240, 135, 4, 30
    cols = 6
    rows = sum((len(items) + cols - 1) // cols for items in groups.values()) + len(groups)
    sheet = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + label + pad) + pad), "white")
    draw = ImageDraw.Draw(sheet)
    y = pad
    for name, items in groups.items():
        draw.text((pad, y + 4), f"[{name}]", fill=(180, 60, 40))
        y += 18
        for i, (path, m, ink) in enumerate(items):
            if i and i % cols == 0:
                y += th + label + pad
            x = pad + (i % cols) * (tw + pad)
            plate = Image.fromarray(((1 - ink) * 255).astype(np.uint8)).resize((tw, th))
            sheet.paste(plate.convert("RGB"), (x, y))
            draw.text((x, y + th + 1), path.stem[:34], fill="black")
            draw.text((x, y + th + 13),
                      f"cov {m.coverage:.2f} ext {m.extent:.2f} ink {m.ink_mean:.2f} "
                      f"coh {m.coherence:.2f} w {m.stroke_px:.1f}", fill=(90, 90, 90))
        y += th + label + pad
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.crop((0, 0, sheet.width, y)).save(out, quality=88)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--group", nargs="+", action="append", required=True,
                        metavar=("NAME", "IMAGE"), help="group name followed by image paths")
    parser.add_argument("--out", type=Path, default=Path("reference/compare/sheet.jpg"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    groups: dict[str, list[tuple[Path, Metrics, np.ndarray]]] = {}
    report: dict[str, dict] = {}
    for name, *paths in args.group:
        items = []
        for p in sorted(Path(x) for x in paths):
            m, ink = measure(p)
            items.append((p, m, ink))
        groups[name] = items
        report[name] = {"n": len(items), "median_std": summarize([m for _, m, _ in items]),
                        "items": {p.stem: asdict(m) for p, m, _ in items}}
        med = report[name]["median_std"]
        logger.info("%-12s n=%-2d " + " ".join(f"{k}={v[0]:.3f}±{v[1]:.3f}" for k, v in med.items()),
                    name, len(items))

    contact_sheet(groups, args.out)
    args.out.with_suffix(".json").write_text(json.dumps(report, indent=2))
    logger.info("sheet -> %s", args.out)


if __name__ == "__main__":
    main()
