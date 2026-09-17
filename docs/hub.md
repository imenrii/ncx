# Hub contract

`src/policy.rs` owns deployment validation and proxy trust. `src/hub.rs` owns
local capabilities, SSH children, session lifecycle, and relay. `src/cli.rs`
constructs the policy. `web/src/hub/` consumes the advertised mode and password
capability; it does not infer policy from the page URL.

| Mode | Listener | Remote sessions |
| --- | --- | --- |
| `local` (default) | IPv4 loopback | Disabled; configured local roots only |
| `HTTP` | Explicit IPv4 interface | Key authentication by default; password only with `--ssh-auth password` |
| `HTTPS` | Backend behind the configured TLS/auth proxy | Key authentication and strict host keys required |

`open`, `serve`, and child viewers remain on loopback. HTTP has a persistent
mode tag; its existing password dialog is enabled only by policy. HTTPS does
not implement TLS or user accounts inside ncx.

## Proxy contract

HTTPS requires `--trusted-proxy IPv4` and `--public-origin https://host[:port]`.
The socket peer must be that proxy. The proxy authenticates every user, removes
client forwarding headers, then sets `X-Forwarded-Proto: https`,
`X-Ncx-Authenticated: 1`, and the public `Host`. Mutations require an exact
public `Origin`. Forwarded client-address headers cannot replace the socket
peer check. Only `/healthz` bypasses these checks.

The operator isolates the backend from clients and limits who can run on the
trusted proxy host. A mode flag cannot prove that a separately managed proxy
has correct TLS/auth configuration. [Deployment](../deploy/README.md) supplies
the setup rules; `tests/policy-smoke.py` exercises a real local TLS/auth relay.

## SSH and local capability

Host keys are strict by default. `--known-hosts` selects a readable file.
`--host-key-policy accept-new` explicitly permits first contact but rejects a
changed key. `insecure` disables verification only when explicitly selected;
HTTPS rejects it. Key mode uses OpenSSH configuration for keys, agent, and
certificates without browser password entry. Password mode uses the existing
one-use askpass pipe, clears secrets, and keeps them out of arguments, URLs,
logs, and persistent environment.

Local requests are confined to configured roots and must open a regular file
with a NetCDF signature. Validation uses bounded blocking admission. On Linux,
nonblocking open prevents a FIFO from waiting before the regular-file check.
Ordinary viewer routes take dataset IDs, never arbitrary local paths.

## Session owner

The manager counts starting sessions toward the session limit and reaps idle
sessions. The browser sends heartbeats and closes explicitly; page unload does
not close a resumable session. Stored state contains only ID, destination, and
address. A path-only remote change reuses its authenticated control connection.
A new SSH identity must authenticate successfully before replacing the old
session. Failed replacement leaves the old viewer available.

Relays stream child responses and preserve cancellation/backpressure. No
server-side comparison, data writes, or provider integration belongs here.
