/**
 * src/modules/network/network.routes.ts
 *
 * HTTP security header auditing routes for SentinelNode.
 *
 * Endpoints:
 *   POST /api/network/audit   — audit security headers of a target URL
 *   GET  /api/network/last    — retrieve the last audit result from SQLite
 *
 * Flow:
 *   1. Client POSTs a target URL
 *   2. Route sends a HEAD request to the target
 *   3. Response headers are checked against the expected security headers
 *   4. A score and per-header breakdown is stored and returned
 *
 * All routes here are protected by authMiddleware mounted in index.ts.
 * Pure Node.js — no Rust involved. This is the "learn Node" feature.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "../../shared/utils/db.js";
import type {
  HonoVariables,
  HeaderCheck,
  HeaderAuditResult,
} from "../../shared/types.js";

// ── Router ────────────────────────────────────────────────────────────────────

const app = new Hono<{ Variables: HonoVariables }>();

// ── Security headers to check ─────────────────────────────────────────────────

/**
 * The set of HTTP response headers we consider security-relevant.
 * Each entry is the exact header name as it appears in an HTTP response.
 *
 * To add a new check, add a string here — nothing else needs to change.
 */
const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
] as const;

// ── Validation schema ─────────────────────────────────────────────────────────

const auditSchema = z.object({
  /**
   * The URL to audit. Must be a valid http or https URL.
   * We reject non-HTTP schemes (ftp, file, etc.) explicitly.
   */
  url: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith("http://") || u.startsWith("https://"),
      { message: "Only http and https URLs are supported" }
    ),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sends a HEAD request to the target URL and returns the response headers.
 * Uses the native fetch available in Node 20+.
 *
 * HEAD requests fetch only headers — no response body is downloaded.
 * This is faster and avoids transferring large page content just to
 * inspect security headers.
 *
 * @param url - The target URL to audit
 * @returns The response Headers object
 * @throws If the network request fails or times out
 */
async function fetchHeaders(url: string): Promise<Headers> {
  const controller = new AbortController();

  // Abort the request if it takes longer than 10 seconds.
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      // Follow redirects so we audit the final destination headers.
      redirect: "follow",
    });
    return response.headers;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks the response headers against the expected security headers list.
 *
 * @param headers - The response Headers object from fetchHeaders()
 * @returns Array of HeaderCheck results and the computed score
 */
function auditHeaders(headers: Headers): {
  checks: HeaderCheck[];
  score: number;
} {
  const checks: HeaderCheck[] = SECURITY_HEADERS.map((header) => {
    const value = headers.get(header);
    return {
      header,
      present: value !== null,
      value,
    };
  });

  const score = checks.filter((c) => c.present).length;

  return { checks, score };
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/network/audit
 *
 * Sends a HEAD request to the target URL, checks security headers,
 * persists the result, and returns a scored breakdown.
 */
app.post("/audit", zValidator("json", auditSchema), async (c) => {
  const { url } = c.req.valid("json");
  const user = c.get("user");

  let responseHeaders: Headers;

  try {
    responseHeaders = await fetchHeaders(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";

    // Distinguish between a timeout and other network failures.
    if (err instanceof Error && err.name === "AbortError") {
      return c.json(
        { success: false, error: `Request to ${url} timed out after 10s` },
        504
      );
    }

    return c.json(
      { success: false, error: `Failed to reach ${url}: ${message}` },
      502
    );
  }

  const { checks, score } = auditHeaders(responseHeaders);

  const result: HeaderAuditResult = {
    url,
    checks,
    score,
    total: SECURITY_HEADERS.length,
    auditedAt: new Date().toISOString(),
  };

  // Persist result to SQLite.
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO audit_results (user_id, url, checks_json, score, total, audited_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      user.sub,
      url,
      JSON.stringify(checks),
      score,
      SECURITY_HEADERS.length,
      result.auditedAt
    );
  } catch (err) {
    // Non-fatal — log but still return the result.
    console.error("Failed to persist audit result:", err);
  }

  return c.json({ success: true, data: result });
});

/**
 * GET /api/network/last
 *
 * Returns the most recent header audit result for the current user.
 * Returns 404 if no audits have been run yet.
 */
app.get("/last", (c) => {
  const user = c.get("user");

  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT url, checks_json, score, total, audited_at
         FROM audit_results
         WHERE user_id = ?
         ORDER BY rowid DESC
         LIMIT 1`
      )
      .get(user.sub) as
      | {
          url: string;
          checks_json: string;
          score: number;
          total: number;
          audited_at: string;
        }
      | undefined;

    if (!row) {
      return c.json({ success: false, error: "No audit results found" }, 404);
    }

    return c.json({
      success: true,
      data: {
        url: row.url,
        checks: JSON.parse(row.checks_json),
        score: row.score,
        total: row.total,
        auditedAt: row.audited_at,
      },
    });
  } catch (err) {
    console.error("Failed to retrieve last audit result:", err);
    return c.json({ success: false, error: "Database error" }, 500);
  }
});

export { app as networkRoutes };