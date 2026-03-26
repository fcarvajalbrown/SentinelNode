/// src/types.rs
///
/// IPC contract types — must mirror src/shared/types.ts exactly.
/// If you change JobPayload or JobResult here, update types.ts too.

use serde::{Deserialize, Serialize};

// ── Inbound — Node sends this to Rust via stdin ───────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobPayload {
    pub job: JobType,
    pub path: String,
    pub patterns: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobType {
    ScanSecrets,
}

// ── Outbound — Rust sends this to Node via stdout ─────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub job: String,
    pub findings: Vec<Finding>,
    pub completed_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub file: String,
    pub line: usize,
    #[serde(rename = "match")]
    pub match_text: String,
    pub pattern: String,
}