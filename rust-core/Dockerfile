# Stage 1: build
FROM rust:1.82-slim AS builder

WORKDIR /app

# Cache dependencies before copying source.
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release
RUN rm -rf src

# Build the real source.
COPY src/ ./src/
RUN touch src/main.rs && cargo build --release

# Stage 2: minimal runtime image
FROM debian:bookworm-slim

# Install CA certificates so Rust can make HTTPS requests if needed.
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/sentinel-core /usr/local/bin/

CMD ["sentinel-core"]