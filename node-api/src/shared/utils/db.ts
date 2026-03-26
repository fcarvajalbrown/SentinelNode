/**
 * src/shared/utils/db.ts
 *
 * SQLite database connection and schema initialisation.
 *
 * Responsibilities:
 *   - Open (or create) the SQLite database file at DB_PATH
 *   - Run CREATE TABLE IF NOT EXISTS on startup
 *   - Export a getDb() singleton so all modules share one connection
 *
 * Why a singleton?
 *   better-sqlite3 connections are synchronous and not thread-safe.
 *   Opening one connection at startup and reusing it everywhere is
 *   the correct pattern — opening a new connection per request is
 *   wasteful and risks write contention.
 *
 * Schema:
 *   scan_results  — stores secret scan job results from Rust
 *   audit_results — stores HTTP header audit results from Node
 */

import Database from "better-sqlite3";
import { join } from "path";

// ── Singleton ─────────────────────────────────────────────────────────────────

/** The single shared database connection. Initialised on first call to getDb(). */
let db: Database.Database | null = null;

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * DDL statements run on startup.
 * IF NOT EXISTS means these are safe to run every time — they only
 * create the table if it doesn't already exist.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS scan_results (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL,
    path          TEXT    NOT NULL,
    findings_json TEXT    NOT NULL,
    completed_at  TEXT    NOT NULL,
    error         TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT    NOT NULL,
    url         TEXT    NOT NULL,
    checks_json TEXT    NOT NULL,
    score       INTEGER NOT NULL,
    total       INTEGER NOT NULL,
    audited_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Returns the shared SQLite database connection.
 * Opens and initialises the database on the first call.
 *
 * The DB_PATH environment variable controls where the file lives.
 * Inside Docker this is /app/data/sentinel.db — the named volume
 * directory — so data persists across container restarts.
 *
 * @returns The open Database instance
 * @throws If the database file cannot be opened or schema cannot be applied
 *
 * @example
 * const db = getDb();
 * const row = db.prepare("SELECT * FROM scan_results WHERE id = ?").get(1);
 */
export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH
    ?? join(process.cwd(), "data", "sentinel.db");

  console.log(`Opening database at: ${dbPath}`);

  // verbose: console.log logs every SQL statement executed.
  // Useful during development — remove for production.
  db = new Database(dbPath, {
    verbose: process.env.NODE_ENV === "development" ? console.log : undefined,
  });

  // Enable WAL mode — Write-Ahead Logging allows concurrent reads
  // while a write is in progress. Better performance for a web server.
  db.pragma("journal_mode = WAL");

  // Apply schema — safe to run on every startup.
  db.exec(SCHEMA);

  console.log("Database initialised successfully");

  return db;
}