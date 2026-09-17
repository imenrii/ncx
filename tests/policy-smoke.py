"""Exercise HTTPS mode through a temporary TLS/auth proxy. No external service."""
import base64
import http.client
import http.server
import json
import os
from pathlib import Path
import re
import select
import ssl
import subprocess
import tempfile
import threading
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ.get("NCX_BINARY", ROOT / "target/debug/ncx"))
AUTH = "Basic " + base64.b64encode(b"fixture:fixture").decode()


def request(url, method="GET", data=None, headers=None, context=None):
    body = None if data is None else json.dumps(data).encode()
    query = urllib.request.Request(url, data=body, method=method,
                                   headers={"Content-Type": "application/json", **(headers or {})})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                        urllib.request.HTTPSHandler(context=context))
    try:
        with opener.open(query, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


with tempfile.TemporaryDirectory(prefix="ncx-policy-") as directory:
    work = Path(directory)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1",
                    "-keyout", str(work / "key.pem"), "-out", str(work / "cert.pem")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    upstream = None

    class Proxy(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def forward(self):
            if self.headers.get("Authorization") != AUTH:
                self.send_response(401)
                self.end_headers()
                return
            connection = http.client.HTTPConnection(*upstream, source_address=("127.0.0.2", 0), timeout=10)
            try:
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                headers = {name: self.headers[name] for name in ("Content-Type", "Origin", "X-Ncx-Session") if name in self.headers}
                headers.update({"Host": f"127.0.0.1:{proxy.server_port}",
                                "X-Forwarded-Proto": "https", "X-Ncx-Authenticated": "1"})
                connection.request(self.command, self.path, body=body, headers=headers)
                response = connection.getresponse()
                content = response.read()
                self.send_response(response.status)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            finally:
                connection.close()

        do_GET = do_POST = do_DELETE = forward

    proxy = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(work / "cert.pem", work / "key.pem")
    proxy.socket = tls.wrap_socket(proxy.socket, server_side=True)
    origin = f"https://127.0.0.1:{proxy.server_port}"
    child = subprocess.Popen([str(BINARY), "hub", "--mode", "HTTPS", "--listen", "127.0.0.1:0",
                              "--trusted-proxy", "127.0.0.2", "--public-origin", origin,
                              "--local-root", str(ROOT / "tests/data")], stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
    thread = None
    try:
        assert select.select([child.stdout], [], [], 10)[0], "hub readiness timeout"
        line = child.stdout.readline()
        match = re.search(r"NCX_READY=127\.0\.0\.1:(\d+)", line)
        assert match, (line, child.poll())
        upstream = ("127.0.0.1", int(match[1]))
        thread = threading.Thread(target=proxy.serve_forever, daemon=True)
        thread.start()
        context = ssl.create_default_context(cafile=str(work / "cert.pem"))
        url = origin + "/ncx/api/session"
        assert request(url, context=context)[0] == 401
        headers = {"Authorization": AUTH, "Origin": origin}
        status, body = request(url, headers=headers, context=context)
        assert status == 200 and json.loads(body)["mode"] == "https"
        assert json.loads(body)["password"] is False
        forged = {"Host": f"127.0.0.1:{proxy.server_port}", "X-Forwarded-Proto": "https",
                  "X-Ncx-Authenticated": "1", "X-Forwarded-For": "127.0.0.2"}
        assert request(f"http://127.0.0.1:{upstream[1]}/ncx/api/session", headers=forged)[0] == 403
        target = {"address": str(ROOT / "tests/data/classic.nc")}
        assert request(url, "POST", target, {**headers, "Origin": "https://other.example"}, context)[0] == 403
        assert request(url, "POST", {"address": "host:/data.nc", "password": "fixture"}, headers, context)[0] == 400
        status, body = request(url, "POST", target, headers, context)
        assert status == 201, body
        session = json.loads(body)["session"]
        headers["X-Ncx-Session"] = session
        assert request(origin + "/ncx/api/meta", headers=headers, context=context)[0] == 200
        assert request(url, "DELETE", headers=headers, context=context)[0] == 204
        del headers["X-Ncx-Session"]
        sessions = []
        for _ in range(10):
            status, body = request(url, "POST", target, headers, context)
            assert status == 201, body
            session_headers = {**headers, "X-Ncx-Session": json.loads(body)["session"]}
            sessions.append(session_headers)
            assert request(origin + "/ncx/api/meta", headers=session_headers, context=context)[0] == 200
        assert request(url, "POST", target, headers, context)[0] == 429
        # Linux fixture budget includes all ten viewer children and the hub.
        if Path(f"/proc/{child.pid}/task").exists():
            pids = {child.pid}
            for children in Path(f"/proc/{child.pid}/task").glob("*/children"):
                pids.update(map(int, children.read_text().split()))
            assert len(pids) == 11, pids
            peak_kib = sum(int(re.search(r"VmHWM:\s+(\d+)", Path(f"/proc/{pid}/status").read_text())[1]) for pid in pids)
            assert peak_kib < 512 * 1024, f"ten-session fixture memory: {peak_kib} KiB"
            print(f"Ten-session fixture sum of process peak RSS: {peak_kib} KiB")
        for session_headers in sessions:
            assert request(url, "DELETE", headers=session_headers, context=context)[0] == 204
    finally:
        if thread:
            proxy.shutdown()
            thread.join()
        proxy.server_close()
        child.terminate()
        try:
            child.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.communicate()

print("PASS: TLS/auth proxy, transport peer, origin, password policy, and local session lifecycle")
