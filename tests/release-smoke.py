#!/usr/bin/env python3
"""Check that the release serves every embedded font in viewer and hub modes."""
import pathlib
import select
import subprocess
import sys
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
binary = pathlib.Path(sys.argv[1]).resolve()
fonts = (
    "gorton-400", "gorton-600", "commit-400", "commit-700", "cmmath",
    "hershey-light", "hershey-medium", "hershey-heavy", "nationalpark",
)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

for mode, arguments in (
    ("viewer", ["serve", str(root / "tests/data/rectilinear.nc"), "--exit-on-stdin-eof"]),
    ("hub", ["hub", "--listen", "127.0.0.1:0", "--local-root", str(root / "tests/data")]),
):
    process = subprocess.Popen(
        [str(binary), *arguments], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
    )
    try:
        if not select.select([process.stdout], [], [], 10)[0]:
            raise RuntimeError(f"{mode} did not start within 10 seconds")
        line = process.stdout.readline().strip()
        if not line.startswith("NCX_READY=127.0.0.1:"):
            raise RuntimeError(f"Unexpected {mode} address: {line}")
        base = "http://" + line.removeprefix("NCX_READY=").rstrip("/")
        for face in fonts:
            with opener.open(f"{base}/fonts/{face}.woff2", timeout=5) as response:
                data = response.read()
            if not data.startswith(b"wOF2") or len(data) < 48:
                raise RuntimeError(f"{mode} release font is missing or invalid: {face}")
    finally:
        process.stdin.close()
        if mode == "hub":
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise
    if process.returncode != 0:
        raise RuntimeError(f"{mode} exited with {process.returncode}")
    print(f"PASS: all {len(fonts)} embedded WOFF2 fonts are available in {mode} mode.")
