# node-api/Dockerfile
#
# Three stages:
#   Stage 1 (frontend-builder) — builds the React app into frontend/dist/
#   Stage 2 (api-builder)      — compiles TypeScript into dist/
#   Stage 3 (runtime)          — runs the app with only what is needed

# ── Stage 1: frontend ─────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ── Stage 2: API builder ──────────────────────────────────────────────────────
FROM node:20-alpine AS api-builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# Copy compiled API from stage 2
COPY --from=api-builder /app/dist ./dist

# Copy compiled React app from stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]