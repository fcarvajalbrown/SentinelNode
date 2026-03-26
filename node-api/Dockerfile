# node-api/Dockerfile
#
# Multi-stage build:
#   Stage 1 (builder) — installs ALL dependencies and compiles TypeScript
#   Stage 2 (runtime) — copies only the compiled output and production deps
#
# This keeps the final image small — no TypeScript compiler, no dev tools.

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first — Docker caches this layer.
# If package.json hasn't changed, npm ci is skipped on rebuild.
COPY package*.json ./

# Install ALL dependencies (including devDependencies like typescript)
RUN npm ci

# Copy source and compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy package files and install ONLY production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

# Create the data directory for the SQLite volume mount point
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]