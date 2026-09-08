#!/usr/bin/env python3
"""Check that a public executable does not serve commercial font data."""
import pathlib
import select
import subprocess
import sys
import urllib.error
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
binary = pathlib.Path(sys.argv[1]).resolve()
process = subprocess.Popen(
    [str(binary), "serve", str(root / "tests/data/rectilinear.nc"), "--exit-on-stdin-eof"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
)
try:
    if not select.select([process.stdout], [], [], 10)[0]:
        raise RuntimeError("Viewer did not start within 10 seconds")
    line = process.stdout.readline().strip()
    if not line.startswith("NCX_READY=127.0.0.1:"):
        raise RuntimeError(f"Unexpected viewer address: {line}")
    base = "http://" + line.removeprefix("NCX_READY=")
    for face in ("gorton-400", "gorton-600"):
        try:
            response = urllib.request.urlopen(f"{base}/fonts/{face}.woff2", timeout=5)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        else:
            with response:
                if response.read():
                    raise RuntimeError(f"Public release contains {face}")
    with urllib.request.urlopen(f"{base}/fonts/commit-400.woff2", timeout=5) as response:
        if not response.read():
            raise RuntimeError("Open-licence font is missing")
finally:
    process.stdin.close()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise
if process.returncode != 0:
    raise RuntimeError(f"Viewer exited with {process.returncode}")
print("PASS: public release excludes commercial fonts and serves open-licence fonts.")
