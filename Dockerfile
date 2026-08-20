FROM rust:1.89-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --locked --release -p genetic-assembly-server

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates nodejs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/genetic-assembly-server /usr/local/bin/genetic-assembly-server
ENV GA_BIND=0.0.0.0:3001
ENV GA_ARTIFACT_ROOT=/var/lib/genetic-assembly/artifacts
EXPOSE 3001
CMD ["genetic-assembly-server"]
