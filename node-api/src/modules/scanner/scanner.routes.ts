/**
 * src/modules/scanner/scanner.routes.ts
 *
 * Secret scanner routes for SentinelNode.
 *
 * Endpoints:
 *   POST /api/scanner/scan         — legacy non-streaming scan
 *   GET  /api/scanner/scan/stream  — SSE streaming scan with real progress
 *   GET  /api/scanner/last         — retrieve last scan result from SQLite
 *   GET  /api/scanner/health       — proxy health check to rust-core
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { stream } from "hono/streaming";
import { getTokenFromContext, verifyToken } from "../../shared/middleware/auth.js";
import { runJob } from "../../shared/utils/ipc.js";
import { getDb } from "../../shared/utils/db.js";
import type { HonoVariables, JobResult } from "../../shared/types.js";

const app = new Hono<{ Variables: HonoVariables }>();

const RUST_CORE_URL = process.env.RUST_CORE_URL ?? "http://rust-core:8080";

const DEFAULT_PATTERNS = [
  "AKIA[0-9A-Z]{16}",
  "xox[pboas]-[0-9]{12}-[0-9]{12}-[0-9]{12}-[a-z0-9]{32}",
  "(?i)^(JWT_SECRET|JWT_REFRESH_SECRET|API_KEY|SECRET_KEY|PASSWORD|TOKEN|PRIVATE_KEY)=([A-Za-z0-9+/=_-]{20,})",
  "(?i)(secret|password|token|api_key)\\s*[:=]\\s*['\"][A-Za-z0-9+/=_-]{32,}['\"]",
  "-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----",
  "[0-9a-f]{64}",
];

const scanSchema = z.object({
  subpath: z
    .string()
    .startsWith("/")
    .refine((p) => !p.includes(".."), { message: "Path traversal not allowed" })
    .default("/"),
  extraPatterns: z.array(z.string()).default([]),
});

// ── Health proxy ──────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${RUST_CORE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) return c.json({ status: "ok" });
    return c.json({ status: "error" }, 503);
  } catch {
    return c.json({ status: "offline" }, 503);
  }
});

// ── SSE streaming scan ────────────────────────────────────────────────────────

/**
 * GET /api/scanner/scan/stream
 *
 * Opens an SSE connection to rust-core and forwards progress events
 * to the browser in real time. The browser receives:
 *   data: {"type":"progress","scanned":100,"total":96254,"findingsSoFar":2}
 *   data: {"type":"complete","result":{...}}
 */
app.get("/scan/stream", async (c) => {
  // Manual auth — EventSource API does not support custom headers or
  // credentials mode, so authMiddleware cannot run for SSE connections.
  // We verify the cookie here directly using the shared verifyToken utility.
  const token = getTokenFromContext(c);
  if (!token) return c.json({ success: false, error: "Unauthorized" }, 401);

  const user = verifyToken(token);
  if (!user) return c.json({ success: false, error: "Unauthorized" }, 401);

  const subpath = c.req.query("subpath") ?? "/";
  const extraPatterns: string[] = [];
  const scanPath = `/scan${subpath === "/" ? "" : subpath}`;
  const patterns = [...DEFAULT_PATTERNS, ...extraPatterns];

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return stream(c, async (s) => {
    s.onAbort(() => {
      console.log("SSE client disconnected");
    });

    try {
      const response = await fetch(`${RUST_CORE_URL}/scan/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: "scan_secrets", path: scanPath, patterns }),
      });

      if (!response.body) {
        await s.write(`data: ${JSON.stringify({ type: "error", message: "No response body" })}\n\n`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const json = trimmed.slice(5).trim();
          await s.write(`data: ${json}\n\n`);

          // Persist result when complete.
          try {
            const event = JSON.parse(json);
            if (event.type === "complete" && event.result) {
              const result: JobResult = event.result;
              const db = getDb();
              db.prepare(
                `INSERT INTO scan_results
                 (user_id, path, findings_json, completed_at, error, total_files, scanned_files)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
              ).run(
                user.sub, scanPath,
                JSON.stringify(result.findings),
                result.completedAt, result.error,
                result.totalFiles, result.scannedFiles
              );
            }
          } catch (e) {
            console.error("Failed to persist scan result:", e);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await s.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    }
  });
});

// ── Legacy non-streaming scan ─────────────────────────────────────────────────

app.post("/scan", zValidator("json", scanSchema), async (c) => {
  const { subpath, extraPatterns } = c.req.valid("json");
  const user = c.get("user");
  const scanPath = `/scan${subpath === "/" ? "" : subpath}`;
  const patterns = [...DEFAULT_PATTERNS, ...extraPatterns];

  let result: JobResult;
  try {
    result = await runJob({ job: "scan_secrets", path: scanPath, patterns });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown IPC error";
    return c.json({ success: false, error: `Scan failed: ${message}` }, 500);
  }

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO scan_results
       (user_id, path, findings_json, completed_at, error, total_files, scanned_files)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      user.sub, scanPath,
      JSON.stringify(result.findings),
      result.completedAt, result.error,
      result.totalFiles, result.scannedFiles
    );
  } catch (err) {
    console.error("Failed to persist scan result:", err);
  }

  return c.json({ success: true, data: result });
});

// ── Last scan ─────────────────────────────────────────────────────────────────

app.get("/last", (c) => {
  const user = c.get("user");
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT path, findings_json, completed_at, error, total_files, scanned_files
       FROM scan_results WHERE user_id = ? ORDER BY rowid DESC LIMIT 1`
    ).get(user.sub) as {
      path: string; findings_json: string; completed_at: string;
      error: string | null; total_files: number; scanned_files: number;
    } | undefined;

    if (!row) return c.json({ success: false, error: "No scan results found" }, 404);

    return c.json({
      success: true,
      data: {
        path: row.path,
        findings: JSON.parse(row.findings_json),
        completedAt: row.completed_at,
        error: row.error,
        totalFiles: row.total_files,
        scannedFiles: row.scanned_files,
      },
    });
  } catch (err) {
    console.error("Failed to retrieve last scan result:", err);
    return c.json({ success: false, error: "Database error" }, 500);
  }
});

export { app as scannerRoutes };