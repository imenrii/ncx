# Hub Deployment

A self-contained Docker Compose service running `ncx hub` as an isolated runtime container.

The binary and embedded web interface are fetched automatically from the latest musl release asset on startup.

---

## 1. Quick Setup

Create your environment configuration:

```bash
cp .env.example .env
chmod 600 .env
```

### Configuration Options

| Setting | Description | Default / Example |
| :--- | :--- | :--- |
| `NCX_BIND_ADDRESS` | Host IPv4 interface (`0.0.0.0` for all interfaces) | `127.0.0.1` |
| `NCX_PORT` | Published host port | `8765` |
| `NCX_DATA_ROOT` | Absolute path on host containing NetCDF files | `/path/to/data` |
| `NCX_KNOWN_HOSTS` | Readable host SSH known-hosts file, mounted read-only | `/path/to/known_hosts` |
| `NCX_DNS_NDOTS` | DNS search threshold (set to `1` for single-label SSH hostnames) | `1` |

> **Permissions & Secrets**:
> - `.env` is ignored by Git and excluded from container builds. Never store SSH passwords in `.env`.
> - NetCDF files at `NCX_DATA_ROOT` must be readable by container UID `10001` (mounted read-only at `/data`).
> - Keep `NCX_DNS_NDOTS=1` so musl resolves short local network SSH hostnames.

---

## 2. Container Lifecycle

```bash
# Build and start in background
sh deploy/compose.sh build
sh deploy/compose.sh up -d --remove-orphans --wait

# Access the Hub
# Navigate to http://HOST:PORT/ncx/ in your browser

# Update binary to latest release
sh deploy/compose.sh exec ncx update.sh
sh deploy/compose.sh restart ncx

# Stop service
sh deploy/compose.sh down
```

> **Update note**: The updater verifies executable integrity and checksums prior to replacement. The `ncx-binary` volume persists across container teardowns. Avoid `compose down -v` unless you explicitly want to purge the cached binary.

---

## 3. Access Policy & Security Model

- **Read-Only Data Mount**: Datasets in `NCX_DATA_ROOT` are mounted read-only at `/data`.
- **Session Lifecycle**: The hub limits concurrency to 10 simultaneous sessions and reaps idle sessions after 90 seconds.
- **Credential Handling**: Successful cluster addresses are remembered locally in the browser; passwords are never persisted.
- **Compose mode**: This configuration explicitly selects `HTTP` and password authentication. Browser passwords travel in plaintext. Use it only on a trusted network. SSH host-key checking remains strict; provision verified host keys in `NCX_KNOWN_HOSTS` before connecting.
- **Default mode**: `ncx hub` uses `local`, listens on loopback, and accepts only configured local files. Remote hub sessions require `--mode HTTP` or `--mode HTTPS`. Key authentication is the default; HTTP password entry requires `--ssh-auth password`.
- **Host keys**: `--known-hosts FILE` selects the file. `--host-key-policy accept-new` is an explicit first-contact policy and rejects changed keys. `insecure` is an explicit HTTP override. HTTPS rejects both non-strict policies.

### HTTPS behind an authentication proxy

Run the backend with a private listener reachable only by the proxy:

```bash
ncx hub --mode HTTPS --listen 127.0.0.1:8765 \
  --trusted-proxy 127.0.0.1 --public-origin https://viewer.example \
  --known-hosts /path/to/known_hosts --local-root /path/to/data
```

Configure the external proxy to terminate TLS and authenticate every request.
Remove incoming forwarding headers, then set `X-Forwarded-Proto: https`,
`X-Ncx-Authenticated: 1`, and `Host: viewer.example`. Preserve the browser's
`Origin`; mutations must match the configured public origin exactly. Proxy the
whole `/ncx/` subtree, including worker assets, API responses, and heartbeats.
Only the configured socket peer can attest authentication; client-supplied
`X-Forwarded-For` is not trusted. Restrict local access on a shared proxy host.

HTTPS requires key/agent/certificate authentication and strict known hosts.
Configure those through OpenSSH for the hub process. No browser password UI is
available. ncx supplies no TLS endpoint or user account service. For containers,
replace the Compose HTTP command with these HTTPS options, use the proxy's
actual backend IPv4 address, mount the key/agent resources, and isolate the
backend network. `/healthz` stays available for the local container probe.

See [hub contracts](../docs/hub.md) for ownership and failure rules. Existing
HTTP installations must set the mode and authentication options explicitly;
insecure host-key defaults are not retained.

---

## 4. Local Binary Testing & Smoke Checks

Install a locally packaged binary into the running container without rebuilding:

```bash
sh deploy/package-release.sh
sh deploy/compose.sh exec -T ncx sh -eu -c '
  file=$(mktemp /opt/ncx/.install.XXXXXX)
  cleanup() { rm -f "$file"; }
  trap cleanup EXIT
  cat > "$file"
  chmod 755 "$file"
  "$file" --help >/dev/null
  mv -f "$file" /opt/ncx/ncx
' < target/release-assets/ncx-x86_64-unknown-linux-musl
sh deploy/compose.sh restart ncx
```

### Operational Checks

```bash
# Check status and logs
sh deploy/compose.sh ps -a
sh deploy/compose.sh logs --tail=80 ncx

# Execute comprehensive hosting smoke tests
sh tests/hosting-smoke.sh
```

