# Changelog

All notable changes to SentinelNode are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.2.0] - 2026-03-27

### Added

- Real-time SSE progress streaming during scans with live spinner
- Filesystem watcher using `notify` crate for incremental rescanning
- rust-core health check indicator in dashboard navbar (polls every 30s)
- Scan button disabled automatically when rust-core is offline
- Severity levels on findings: critical, high, medium with color coding
- Shannon entropy scoring on every finding (displayed in UI)
- Named detection rules with descriptions replacing generic regex patterns
- Extended pattern coverage: GitHub PAT, GitHub OAuth, GitHub Actions tokens,
  Stripe live keys, Google API keys, Slack tokens, NPM tokens, SendGrid keys,
  Twilio SIDs, private key headers, environment variable secrets
- Global stopword filter eliminating placeholder false positives
- Per-rule stopword lists for service-specific false positive reduction
- Configurable ignore list via Settings page (directories, extensions, files)
- Settings accessible via gear icon in navbar
- Scanner ignore list persisted in SQLite, merged with built-in skip list
- Extended skip directories: .next, .nuxt, .cache, .turbo, coverage,
  storybook-static, patterns, fixtures, testdata
- Skip example and template files (.env.example, .sample, .template)
- SentinelNode logo: terminal bracket style with scan line motif
- Favicon and navbar logo across all pages
- PyPI token detection rule
- start.bat and stop.bat for Windows one-click launch

### Changed

- IPC architecture changed from stdin/stdout spawn to HTTP (rust-core now
  runs as a persistent HTTP server on port 8080, internal network only)
- Scanner rules moved from Node.js regex strings to typed Rust Rule structs
  with entropy thresholds and stopwords
- Entropy scored on secret value capture group, not key name
- Progress ring replaced with honest indeterminate spinner
- File counts (total, scanned, skipped) shown after every scan
- Incremental scan badge shown when watcher baseline exists

### Fixed

- False positives from .next/cache, reconftw patterns, README examples
- JWT secret detection failing due to entropy scored on key name not value
- rust-core crash on large directory scans (64MB stack, panic hook)
- .env.example flagged as containing real secrets
- [object Object] error display replaced with proper message extraction
- SSE auth using shared verifyToken utility instead of duplicated logic
- docker-compose restart policy corrected for rust-core service type

### Security

- SSE endpoint manually verifies JWT cookie since EventSource API cannot
  use standard auth middleware — uses shared verifyToken utility
- Scan path traversal protection via Zod (..) rejection
- Ignore list entries scoped per user_id in SQLite

---

## [0.1.0] - 2026-03-27

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

---

## [Unreleased] - v0.3.0

### Planned

- Filesystem watcher re-enabled with OS-specific inotify limit handling
- Full drive scanning support with streaming WalkDir and memory limits
- Tauri desktop wrapper for single .exe distribution
- Multi-user support with SQLite user table
- Scheduled automatic scans
- Export findings as PDF report
- Severity filter in UI
- Scan history with comparison between runs