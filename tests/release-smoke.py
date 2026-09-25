#!/usr/bin/env python3
"""Check embedded fonts and asset encodings in viewer and hub modes."""
import gzip
import pathlib
import select
import subprocess
import sys
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
binary = pathlib.Path(sys.argv[1]).resolve()
fonts = (
    "gorton-400", "gorton-600", "commit-400", "commit-700", "cmmath",
    "commit-web-400", "commit-web-450", "commit-web-600",
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
                if response.headers.get_content_type() != "font/woff2":
                    raise RuntimeError(f"Wrong font Content-Type in {mode}: {face}")
                data = response.read()
            if not data.startswith(b"wOF2") or len(data) < 48:
                raise RuntimeError(f"{mode} release font is missing or invalid: {face}")
        assets = root / "web/dist/assets"
        for asset in sorted(path for path in assets.rglob("*") if path.is_file()):
            url = f"{base}/assets/{asset.relative_to(assets).as_posix()}"
            expected = asset.read_bytes()
            for encoding in ("gzip", "identity"):
                request = urllib.request.Request(url, headers={"Accept-Encoding": encoding})
                with opener.open(request, timeout=10) as response:
                    assert response.headers["Vary"] == "Accept-Encoding", url
                    data = response.read()
                    compressed = response.headers.get("Content-Encoding") == "gzip"
                    if encoding == "identity" or asset.suffix in (".whl", ".zip"):
                        assert not compressed, url
                    if encoding == "gzip" and asset.name in ("app.js", "app.css", "pyodide.asm.wasm"):
                        assert compressed, url
                    if asset.suffix == ".wasm":
                        assert response.headers.get_content_type() == "application/wasm", url
                    if compressed:
                        data = gzip.decompress(data)
                    assert data == expected, f"{mode}: {url} differs with {encoding}"
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
    print(f"PASS: {len(fonts)} fonts and all embedded assets with gzip/identity in {mode} mode.")
