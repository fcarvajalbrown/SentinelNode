/**
 * src/shared/types.ts
 *
 * Single source of truth for all shared types in SentinelNode.
 *
 * Rules:
 *   - No business logic here — types and interfaces only.
 *   - The IPC contract (Node <-> Rust) lives here. If you change
 *     a type here, you must update the matching Rust struct in
 *     rust-core/src/types.rs.
 *   - API response shapes live here so routes and tests stay in sync.
 */

// ── IPC — Node sends this to Rust via stdin ───────────────────────────────────

/**
 * The job types the Rust core can execute.
 * Add new job types here as features are added.
 */
export type JobType = "scan_secrets";

/**
 * Payload Node sends to Rust via stdin.
 * Rust reads this, executes the job, and writes a JobResult to stdout.
 */
export interface IgnoreList {
  directories: string[];
  extensions: string[];
  files: string[];
}

export interface JobPayload {
  /** Which job to run. */
  job: JobType;

  /** Absolute path inside the container to scan. Always /scan or a subpath. */
  path: string;

  /** Regex patterns to match against file contents. */
  patterns: string[];
  ignoreList?: IgnoreList;
}

// ── IPC — Rust sends this back to Node via stdout ─────────────────────────────

/**
 * A single secret finding from the Rust scanner.
 */
export interface Finding {
  /** Relative path from the scan root to the file containing the match. */
  file: string;

  /** Line number where the match was found (1-indexed). */
  line: number;

  /** The matched string. Truncated to 80 chars to avoid logging full secrets. */
  match: string;

  /** Which pattern triggered this finding. */
  pattern: string;
}

/**
 * The full result Rust writes to stdout after completing a job.
 */
export interface JobResult {
  /** Mirror of the job type from JobPayload — for correlation. */
  job: JobType;

  /** All findings. Empty array means no secrets found. */
  findings: Finding[];

  /** ISO timestamp of when the scan completed. */
  completedAt: string;

  /** Any error message if the job failed. Null on success. */
  error: string | null;
  totalFiles: number;
  scannedFiles: number;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * The payload encoded inside a JWT access token.
 */
export interface AccessTokenPayload {
  sub: string;   // user ID
  email: string;
  iat: number;   // issued at (Unix timestamp)
  exp: number;   // expires at (Unix timestamp)
}

/**
 * The payload encoded inside a JWT refresh token.
 * Intentionally minimal — only the user ID.
 */
export interface RefreshTokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

// ── Header audit ──────────────────────────────────────────────────────────────

/**
 * A single security header check result.
 */
export interface HeaderCheck {
  /** The header name e.g. "Strict-Transport-Security". */
  header: string;

  /** Whether the header was present in the response. */
  present: boolean;

  /** The actual value if present, null otherwise. */
  value: string | null;
}

/**
 * Full result of auditing a URL's security headers.
 */
export interface HeaderAuditResult {
  /** The URL that was audited. */
  url: string;

  /** Individual check results for each expected header. */
  checks: HeaderCheck[];

  /** Score: number of headers present out of total checked. */
  score: number;

  /** Total number of headers checked. */
  total: number;

  /** ISO timestamp of when the audit ran. */
  auditedAt: string;
}

// ── API responses ─────────────────────────────────────────────────────────────

/**
 * Generic success response wrapper.
 * All API endpoints return this shape on success.
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/**
 * Generic error response wrapper.
 * All API endpoints return this shape on failure.
 */
export interface ApiError {
  success: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ── Ignore list ───────────────────────────────────────────────────────────────

export type IgnoreType = "directory" | "extension" | "file";

export interface IgnoreEntry {
  id: number;
  pattern: string;
  type: IgnoreType;
  createdAt: string;
}

// ── Hono context variables ────────────────────────────────────────────────────

/**
 * Variables attached to Hono's context by middleware.
 * Import this type when creating a new Hono instance in a route file.
 *
 * Usage:
 *   const app = new Hono<{ Variables: HonoVariables }>();
 *   const user = c.get("user"); // typed as AccessTokenPayload
 */
export interface HonoVariables {
  user: AccessTokenPayload;
}