/**
 * src/modules/settings/settings.routes.ts
 *
 * Settings routes — manages the user's ignore list.
 *
 * Endpoints:
 *   GET    /api/settings/ignore       — list all ignore entries
 *   POST   /api/settings/ignore       — add a new entry
 *   DELETE /api/settings/ignore/:id   — remove an entry
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "../../shared/utils/db.js";
import type { HonoVariables, IgnoreEntry } from "../../shared/types.js";

const app = new Hono<{ Variables: HonoVariables }>();

const addSchema = z.object({
  pattern: z.string().min(1).max(200),
  type: z.enum(["directory", "extension", "file"]),
});

// ── GET /api/settings/ignore ──────────────────────────────────────────────────

app.get("/ignore", (c) => {
  const user = c.get("user");

  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, pattern, type, created_at
       FROM ignore_list WHERE user_id = ?
       ORDER BY type, pattern ASC`
    ).all(user.sub) as {
      id: number;
      pattern: string;
      type: string;
      created_at: string;
    }[];

    const entries: IgnoreEntry[] = rows.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      type: r.type as IgnoreEntry["type"],
      createdAt: r.created_at,
    }));

    return c.json({ success: true, data: entries });
  } catch (err) {
    console.error("Failed to fetch ignore list:", err);
    return c.json({ success: false, error: "Database error" }, 500);
  }
});

// ── POST /api/settings/ignore ─────────────────────────────────────────────────

app.post("/ignore", zValidator("json", addSchema), (c) => {
  const user = c.get("user");
  const { pattern, type } = c.req.valid("json");

  try {
    const db = getDb();
    const result = db.prepare(
      `INSERT OR IGNORE INTO ignore_list (user_id, pattern, type)
       VALUES (?, ?, ?)`
    ).run(user.sub, pattern, type);

    if (result.changes === 0) {
      return c.json({ success: false, error: "Pattern already exists" }, 409);
    }

    const entry = db.prepare(
      `SELECT id, pattern, type, created_at
       FROM ignore_list WHERE rowid = ?`
    ).get(result.lastInsertRowid) as {
      id: number;
      pattern: string;
      type: string;
      created_at: string;
    };

    return c.json({
      success: true,
      data: {
        id: entry.id,
        pattern: entry.pattern,
        type: entry.type as IgnoreEntry["type"],
        createdAt: entry.created_at,
      },
    }, 201);
  } catch (err) {
    console.error("Failed to add ignore entry:", err);
    return c.json({ success: false, error: "Database error" }, 500);
  }
});

// ── DELETE /api/settings/ignore/:id ──────────────────────────────────────────

app.delete("/ignore/:id", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));

  if (isNaN(id)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  try {
    const db = getDb();
    const result = db.prepare(
      `DELETE FROM ignore_list WHERE id = ? AND user_id = ?`
    ).run(id, user.sub);

    if (result.changes === 0) {
      return c.json({ success: false, error: "Entry not found" }, 404);
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    console.error("Failed to delete ignore entry:", err);
    return c.json({ success: false, error: "Database error" }, 500);
  }
});

export { app as settingsRoutes };