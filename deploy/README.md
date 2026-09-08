# Deployment

One runtime-only container runs ncx hub.
The binary and embedded UI come from the latest published musl release.

## Configure

For a new installation:

```bash
cp .env.example .env
chmod 600 .env
```

Edit the local settings:

| Setting | Meaning |
| --- | --- |
| NCX_BIND_ADDRESS | Host IPv4 interface; use 0.0.0.0 for all interfaces |
| NCX_PORT | Published port |
| NCX_DNS_NDOTS | DNS search threshold; defaults to 1 for short hostnames |
| NCX_DATA_ROOT | Absolute host directory containing NetCDF files |

.env is ignored by Git and excluded from image builds. Do not put SSH passwords
in it. deploy/compose.sh passes it to Docker Compose; NCX_ENV_FILE can select a
different settings file. Container UID 10001 must be able to read the data.

The container inherits DNS search suffixes. Keep NCX_DNS_NDOTS at 1 for
single-label SSH hostnames. With 0, the musl resolver skips search suffixes,
even when they appear in resolv.conf. Recreate the container after changing DNS
settings; a restart does not apply them.

## Start

```bash
sh deploy/compose.sh build
sh deploy/compose.sh up -d --remove-orphans --wait
```

Open http://HOST:PORT/ncx/ using the host address and configured port. Allow that
port through the host firewall for the intended clients.

## Update and stop

```bash
sh deploy/compose.sh exec ncx update.sh
sh deploy/compose.sh restart ncx
sh deploy/compose.sh down
```

The updater verifies the checksum and executable before replacement. A failed
update leaves the binary unchanged. The ncx-binary volume persists across
container replacement. Restart immediately after an update so the hub and
child viewers use the same version. Do not use down -v unless you intend to
delete that volume.

## Access policy

Files are mounted read-only at /data. The hub allows 10 sessions and expires
an idle session after 90 seconds. Successful addresses are saved automatically
in the browser; passwords are not saved.

Browser connections are not encrypted. SSH passwords entered in the page are
sent to the hub in plain text over the network. SSH encrypts the onward
connection, but the hub deliberately skips host-key verification. Use this
configuration only on a network where these risks are accepted.

Exit status 255 can also mean a wrong password, a network error, or an SSH
policy failure. Check the logs before changing settings.

## Build and install locally

After tests pass, use the existing release script. It embeds the WOFF2 subsets
and checks every font in viewer and hub modes. Full font sources and separate
font files are not release assets. See ../res/README.md for the licence scope.

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

The stream creates the file as the service user. This avoids copied host
ownership; UID 0 cannot bypass ownership checks after capabilities are dropped.
Do not run update.sh at the same time as a local install.

## Checks

```bash
sh deploy/compose.sh ps -a
sh deploy/compose.sh logs --tail=80 ncx
sh tests/hosting-smoke.sh
```

The smoke test uses separate settings and a temporary Docker project. It checks
configuration locally and exercises connectivity, relay, update, and shutdown when
Docker Compose is available.
