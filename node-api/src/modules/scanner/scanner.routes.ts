/**
 * src/modules/scanner/scanner.routes.ts
 *
 * Secret scanner routes for SentinelNode.
 *
 * Endpoints:
 *   POST /api/scanner/scan   — start a secret scan job on the mounted path
 *   GET  /api/scanner/last   — retrieve the last scan result from SQLite
 *
 * Flow:
 *   1. Client POSTs to /scan with an optional subpath and pattern set
 *   2. Route validates the request with Zod
 *   3. Route calls runJob() from ipc.ts — spawns Rust, waits for result
 *   4. Result is stored in SQLite and returned to the client
 *
 * All routes here are protected by authMiddleware mounted in index.ts.
 * No auth logic belongs in this file.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runJob } from "../../shared/utils/ipc.js";
import { getDb } from "../../shared/utils/db.js";
import type { HonoVariables, JobResult } from "../../shared/types.js";

// ── Router ────────────────────────────────────────────────────────────────────

const app = new Hono<{ Variables: HonoVariables }>();

// ── Default patterns ──────────────────────────────────────────────────────────

/**
 * Built-in regex patterns for common secret types.
 * Clients can override or extend these by passing custom patterns in the body.
 */
const DEFAULT_PATTERNS = [
  // AWS access keys
  "AKIA[0-9A-Z]{16}",
  // Slack tokens
  "xox[p|b|o|a]-[0-9]{12}-[0-9]{12}-[0-9]{12}-[a-z0-9]{32}",
  // Generic high-entropy strings prefixed with common secret names
  "(?i)(secret|password|passwd|pwd|token|api_key)\\s*[:=]\\s*['\"]?[A-Za-z0-9+/]{20,}",
  // Private key headers
  "-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----",
];

// ── Validation schemas ────────────────────────────────────────────────────────

const scanSchema = z.object({
  /**
   * Optional subpath within /scan to narrow the scan.
   * Defaults to "/" which scans the entire bind-mounted directory.
   * Must start with "/" and not contain ".." to prevent path traversal.
   */
  subpath: z
    .string()
    .startsWith("/")
    .refine((p) => !p.includes(".."), {
      message: "Path traversal not allowed",
    })
    .default("/"),

  /**
   * Optional additional patterns to scan for, merged with defaults.
   */
  extraPatterns: z.array(z.string()).default([]),
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/scanner/scan
 *
 * Starts a secret scan job. Spawns the Rust binary via IPC,
 * waits for results, stores them, and returns them.
 *
 * This is a synchronous wait — the HTTP request stays open until
 * Rust finishes. For large directories this could take a while.
 * A job queue with polling would be the next architectural step.
 */
app.post("/scan", zValidator("json", scanSchema), async (c) => {
  const { subpath, extraPatterns } = c.req.valid("json");
  const user = c.get("user");

  const scanPath = `/scan${subpath === "/" ? "" : subpath}`;
  const patterns = [...DEFAULT_PATTERNS, ...extraPatterns];

  let result: JobResult;

  try {
    result = await runJob({
      job: "scan_secrets",
      path: scanPath,
      patterns,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown IPC error";
    console.error("IPC error during scan:", message);
    return c.json({ success: false, error: `Scan failed: ${message}` }, 500);
  }

  // Persist result to SQLite so /last can retrieve it.
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO scan_results (user_id, path, findings_json, completed_at, error)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      user.sub,
      scanPath,
      JSON.stringify(result.findings),
      result.completedAt,
      result.error
    );
  } catch (err) {
    // Non-fatal — log the DB error but still return the result to the client.
    console.error("Failed to persist scan result:", err);
  }

  return c.json({ success: true, data: result });
});

/**
 * GET /api/scanner/last
 *
 * Returns the most recent scan result for the current user.
 * Returns 404 if no scans have been run yet.
 */
app.get("/last", (c) => {
  const user = c.get("user");

  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT path, findings_json, completed_at, error
         FROM scan_results
         WHERE user_id = ?
         ORDER BY rowid DESC
         LIMIT 1`
      )
      .get(user.sub) as
      | { path: string; findings_json: string; completed_at: string; error: string | null }
      | undefined;

    if (!row) {
      return c.json({ success: false, error: "No scan results found" }, 404);
    }

    return c.json({
      success: true,
      data: {
        path: row.path,
        findings: JSON.parse(row.findings_json),
        completedAt: row.completed_at,
        error: row.error,
      },
    });
  } catch (err) {
    console.error("Failed to retrieve last scan result:", err);
    return c.json({ success: false, error: "Database error" }, 500);
  }
});

export { app as scannerRoutes };