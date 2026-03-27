/**
 * src/modules/scanner/scanner.routes.ts
 *
 * Secret scanner routes for SentinelNode.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runJob } from "../../shared/utils/ipc.js";
import { getDb } from "../../shared/utils/db.js";
import type { HonoVariables, JobResult } from "../../shared/types.js";

const app = new Hono<{ Variables: HonoVariables }>();

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
    console.error("IPC error during scan:", message);
    return c.json({ success: false, error: `Scan failed: ${message}` }, 500);
  }

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO scan_results (user_id, path, findings_json, completed_at, error, total_files, scanned_files)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      user.sub,
      scanPath,
      JSON.stringify(result.findings),
      result.completedAt,
      result.error,
      result.totalFiles,
      result.scannedFiles
    );
  } catch (err) {
    console.error("Failed to persist scan result:", err);
  }

  return c.json({ success: true, data: result });
});

app.get("/last", (c) => {
  const user = c.get("user");

  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT path, findings_json, completed_at, error, total_files, scanned_files
         FROM scan_results
         WHERE user_id = ?
         ORDER BY rowid DESC
         LIMIT 1`
      )
      .get(user.sub) as
      | {
          path: string;
          findings_json: string;
          completed_at: string;
          error: string | null;
          total_files: number;
          scanned_files: number;
        }
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