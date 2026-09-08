# Deployment

One runtime-only container runs ncx hub.
The binary and embedded UI come from the latest published musl release.

## Configure

For a new installation:

```bash
cp .env.example .env
chmod 600 .env
```

Edit the three local settings:

| Setting | Meaning |
| --- | --- |
| NCX_BIND_ADDRESS | Host IPv4 interface; use 0.0.0.0 for all interfaces |
| NCX_PORT | Published port |
| NCX_DATA_ROOT | Absolute host directory containing NetCDF files |

.env is ignored by Git and excluded from image builds. Do not put SSH passwords
in it. deploy/compose.sh passes it to Docker Compose; NCX_ENV_FILE can select a
different settings file. Container UID 10001 must be able to read the data.

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

## Locally licensed build

Public releases omit Gorton Perfected. A local build can embed an installed,
licensed copy; see ../res/README.md. Do not publish that binary. After tests pass:

```bash
cd web && npm run build && cd ..
env -u NCX_PUBLIC_RELEASE -u CMAKE_PREFIX_PATH -u HDF5_DIR -u NETCDF_DIR \
  -u PKG_CONFIG_PATH -u CPATH -u LD_LIBRARY_PATH -u CC -u CXX \
  cargo zigbuild --locked --release --target x86_64-unknown-linux-musl \
  --features netcdf/static
sh deploy/compose.sh cp target/x86_64-unknown-linux-musl/release/ncx ncx:/opt/ncx/ncx.next
sh deploy/compose.sh exec -u 0 ncx chmod 755 /opt/ncx/ncx.next
sh deploy/compose.sh exec ncx mv -f /opt/ncx/ncx.next /opt/ncx/ncx
sh deploy/compose.sh restart ncx
```

A later update.sh run restores the public release and its system-font fallback.

## Checks

```bash
sh deploy/compose.sh ps -a
sh deploy/compose.sh logs --tail=80 ncx
sh tests/hosting-smoke.sh
```

The smoke test uses separate settings and a temporary Docker project. It checks
configuration locally and exercises connectivity, relay, update, and shutdown when
Docker Compose is available.
