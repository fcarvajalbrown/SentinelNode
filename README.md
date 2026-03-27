# SentinelNode

[![Version](https://img.shields.io/github/v/release/fcarvajalbrown/SentinelNode)](https://github.com/fcarvajalbrown/SentinelNode/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Node](https://img.shields.io/badge/node-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Rust](https://img.shields.io/badge/rust-1.82-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A self-hosted security auditing dashboard for developers and IT administrators.
Scans local directories for leaked secrets and audits HTTP security headers,
packaged as a single Docker Compose application.

---

## Features

- **Secret scanner** — recursively scans a mounted directory for leaked API keys,
  tokens, passwords, and private keys using parallel Rust processing
- **Header auditor** — sends HEAD requests to any URL and scores its HTTP security
  headers against industry best practices
- **JWT authentication** — HTTP-only cookie based auth with access and refresh tokens
- **Persistent results** — scan and audit history stored in SQLite
- **Dark dashboard** — React frontend with real-time results

---

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / Mac / Linux)
- Git

No Node.js, Rust, or Python installation required on the host machine.

---

## Quick Start

**1. Clone the repository**

```bash
git clone https://github.com/fcarvajalbrown/sentinelnode.git
cd sentinelnode
```

**2. Create your environment file**

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```env
# Generate each secret with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your_64_char_hex_string
JWT_REFRESH_SECRET=your_different_64_char_hex_string

# Absolute path to the directory you want to scan
# Windows example: SCAN_PATH=C:\Users\YourName\Desktop
# Linux / Mac:     SCAN_PATH=/home/yourname/projects
SCAN_PATH=C:\Users\YourName\Desktop

# Default admin credentials — change these
ADMIN_EMAIL=admin@sentinel.local
ADMIN_PASSWORD=changeme

NODE_ENV=production
```

**3. Start SentinelNode**

Double-click `start.bat` on Windows, or run:

```bash
docker compose up -d
```

**4. Open the dashboard**

Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

**5. Stop SentinelNode**

Double-click `stop.bat`, or run:

```bash
docker compose down
```

---

## Configuration

All configuration is done through the `.env` file. Never commit `.env` to Git —
it is already listed in `.gitignore`.

| Variable              | Required | Description                                      |
|-----------------------|----------|--------------------------------------------------|
| `JWT_SECRET`          | Yes      | Secret for signing access tokens (64-char hex)   |
| `JWT_REFRESH_SECRET`  | Yes      | Secret for signing refresh tokens (64-char hex)  |
| `SCAN_PATH`           | Yes      | Absolute path to the directory to scan           |
| `ADMIN_EMAIL`         | No       | Login email (default: admin@sentinel.local)      |
| `ADMIN_PASSWORD`      | No       | Login password (default: changeme)               |
| `NODE_ENV`            | No       | Set to `production` for deployment               |

---

## How the Scanner Works

The secret scanner mounts your `SCAN_PATH` directory as a read-only volume
at `/scan` inside the container. It scans for:

- AWS access keys (`AKIA...`)
- Slack tokens (`xox...`)
- Environment variable secrets (`JWT_SECRET=...`, `API_KEY=...`)
- Credentials in code (`password = "..."`)
- Private key headers (`-----BEGIN RSA PRIVATE KEY-----`)
- High-entropy 64-character hex strings

The following are automatically skipped:

- Binary files and images
- Files over 1 MB
- Dependency directories (`node_modules`, `.venv`, `target`, `.git`)
- Test and pattern files

---

## How the Header Auditor Works

Enter any URL and the auditor sends a HEAD request to check for these
security headers:

| Header                      | Purpose                              |
|-----------------------------|--------------------------------------|
| `strict-transport-security` | Forces HTTPS connections             |
| `content-security-policy`   | Prevents XSS attacks                 |
| `x-frame-options`           | Prevents clickjacking                |
| `x-content-type-options`    | Prevents MIME sniffing               |
| `referrer-policy`           | Controls referrer information        |
| `permissions-policy`        | Restricts browser feature access     |

Results are scored from 0 to 6 and color-coded green, amber, or red.

---

## Architecture

```
sentinelnode/
├── node-api/          Node.js + Hono API + React frontend
│   └── frontend/      Vite + React + Tailwind CSS
└── rust-core/         Rust HTTP server for parallel file scanning
```

Two Docker services communicate over an internal network:

- `node-api` — serves the dashboard on port 3000, handles auth, header auditing,
  and SQLite persistence
- `rust-core` — lightweight HTTP server on port 8080 (internal only), runs the
  parallel secret scanner using Rayon

---

## Rebuilding After Changes

**Code changes only (TypeScript or React):**
```bash
docker compose build node-api
docker compose up -d
```

**Rust changes:**
```bash
docker compose build rust-core
docker compose up -d
```

**Full rebuild:**
```bash
docker compose build --no-cache
docker compose up -d
```

**Schema changes (resets the database):**
```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

---

## Development

To run the frontend with hot reload during development:

```bash
# Terminal 1 — start the API and Rust services
docker compose up node-api rust-core

# Terminal 2 — start the Vite dev server
cd node-api/frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) for hot-reload development.
API calls are proxied to the Docker service automatically.

---

## Roadmap

### v0.2.0
- Health check indicator showing rust-core status in the dashboard header
- Filesystem watcher for incremental rescanning (only changed files)
- Severity levels for findings (critical, high, medium)
- Extended pattern coverage (GitHub tokens, Stripe keys, Google API keys)
- Entropy-based detection for custom secrets
- Ignore list configuration via UI

### v1.0.0
- Tauri desktop wrapper for single `.exe` distribution
- Multi-user support with SQLite user table
- Scheduled automatic scans
- Export findings as PDF report

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Author

Felipe Carvajal Brown
Chile
