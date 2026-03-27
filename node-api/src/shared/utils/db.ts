/**
 * src/shared/utils/db.ts
 *
 * SQLite database connection and schema initialisation.
 */

import Database from "better-sqlite3";
import { join } from "path";

let db: Database.Database | null = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS scan_results (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL,
    path          TEXT    NOT NULL,
    findings_json TEXT    NOT NULL,
    completed_at  TEXT    NOT NULL,
    error         TEXT,
    total_files   INTEGER NOT NULL DEFAULT 0,
    scanned_files INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS ignore_list (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    pattern    TEXT    NOT NULL,
    type       TEXT    NOT NULL CHECK(type IN ('directory', 'extension', 'file')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, pattern)
  );
`;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH
    ?? join(process.cwd(), "data", "sentinel.db");

  console.log(`Opening database at: ${dbPath}`);

  db = new Database(dbPath, {
    verbose: process.env.NODE_ENV === "development" ? console.log : undefined,
  });

  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  console.log("Database initialised successfully");

  return db;
}