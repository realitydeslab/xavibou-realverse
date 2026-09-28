"""Tiny local sink for canvas captures.

The page POSTs a PNG to http://127.0.0.1:5174/<name>.png and this server
writes it to reference/renders/<name>.png. Localhost only; used by the
comparison workflow (see tools/compare.py).

Usage:
    python3 tools/capture_server.py
"""

from __future__ import annotations

import logging
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).resolve().parent.parent / "reference" / "renders"
NAME_RE = re.compile(r"^/([A-Za-z0-9_.-]{1,80})\.png$")
MAX_BYTES = 64 * 1024 * 1024


class CaptureHandler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "http://localhost:5173")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:  # noqa: N802 (http.server API)
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        match = NAME_RE.match(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        if not match or not 0 < length <= MAX_BYTES:
            self.send_response(400)
            self._cors()
            self.end_headers()
            return
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        path = OUT_DIR / f"{match.group(1)}.png"
        path.write_bytes(self.rfile.read(length))
        logger.info("saved %s (%d bytes)", path, length)
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(str(path).encode())


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    server = ThreadingHTTPServer(("127.0.0.1", 5174), CaptureHandler)
    logger.info("capture sink on http://127.0.0.1:5174 -> %s", OUT_DIR)
    server.serve_forever()


if __name__ == "__main__":
    main()
