# Changelog

All notable changes to SentinelNode are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.1.0] - 2026-03-27

Initial release of SentinelNode.

### Added

- Secret scanner powered by Rust and Rayon for parallel file processing
- HTTP security header auditor with 6-point scoring system
- JWT authentication with HTTP-only cookies and access/refresh token pair
- React dashboard with dark theme, tabbed interface, and real-time results
- SQLite persistence for scan and audit history
- File count reporting showing total files, scanned files, and skipped files
- Quick path selector for common scan targets
- Docker Compose deployment with two services (node-api, rust-core)
- IPC over HTTP between Node.js and Rust (port 8080, internal network)
- Path traversal protection on scanner input
- Automatic skip of binary files, large files (over 1 MB), and dependency directories
- Pattern-line filtering to prevent false positives from tool source code
- Start and stop batch scripts for Windows users

### Security

- HTTP-only, SameSite=Strict cookies prevent XSS and CSRF token theft
- Two separate JWT secrets so a leaked access token cannot forge a refresh token
- Scan path mounted read-only inside Docker containers
- Generic error messages on authentication failure to prevent field enumeration

### Architecture

- Node.js (Hono + TypeScript) handles routing, auth, header auditing, and serving React
- Rust (tiny_http + Rayon) handles CPU-bound parallel file scanning
- SQLite stores results via better-sqlite3 with WAL mode enabled
- Three-stage Docker build separates frontend compilation, API compilation, and runtime

---

## [Unreleased] - v0.2.0

### Planned

- Health check indicator for rust-core status in dashboard header
- Filesystem watcher for incremental rescanning of changed files only
- Severity classification of findings (critical, high, medium)
- Extended secret patterns (GitHub tokens, Stripe keys, Google API keys)
- Entropy-based detection for unrecognised secret formats
- Configurable ignore list via dashboard UI