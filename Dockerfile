FROM rust:1.97.1-bookworm AS build

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        build-essential cmake m4 perl pkg-config python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/zig \
    && /opt/zig/bin/pip install --no-cache-dir ziglang==0.16.0
ENV PATH="/opt/zig/bin:${PATH}"
RUN rustup target add x86_64-unknown-linux-musl \
    && cargo install cargo-zigbuild --version 0.23.4 --locked

WORKDIR /src
COPY . .
RUN env -u CMAKE_PREFIX_PATH \
        -u HDF5_DIR \
        -u NETCDF_DIR \
        -u PKG_CONFIG_PATH \
        -u CPATH \
        -u LD_LIBRARY_PATH \
        -u CC \
        -u CXX \
    cargo zigbuild \
        --locked \
        --release \
        --target x86_64-unknown-linux-musl \
        --features netcdf/static

FROM alpine:3.22

RUN apk add --no-cache ca-certificates openssh-client \
    && addgroup -S -g 10001 ncx \
    && adduser -S -D -u 10001 -h /home/ncx -G ncx ncx \
    && install -d -o 10001 -g 10001 -m 0700 /home/ncx/.ssh
COPY --from=build --chown=10001:10001 \
    /src/target/x86_64-unknown-linux-musl/release/ncx /usr/local/bin/ncx

USER 10001:10001
WORKDIR /home/ncx
ENTRYPOINT ["/usr/local/bin/ncx"]
CMD ["--help"]
