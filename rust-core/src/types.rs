/// src/types.rs
///
/// IPC contract types — must mirror src/shared/types.ts exactly.
/// If you change JobPayload or JobResult here, update types.ts too.

use serde::{Deserialize, Serialize};

// ── Inbound ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub enum JobType {
    #[serde(rename = "scan_secrets")]
    ScanSecrets,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobPayload {
    pub job: JobType,
    pub path: String,
    pub patterns: Vec<String>,
}

// ── Outbound — final result ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub job: String,
    pub findings: Vec<Finding>,
    pub completed_at: String,
    pub error: Option<String>,
    pub total_files: usize,
    pub scanned_files: usize,
    pub was_incremental: bool,
    pub changed_files: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub file: String,
    pub line: usize,
    #[serde(rename = "match")]
    pub match_text: String,
    pub pattern: String,
    pub severity: Severity,
}

// ── Severity ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
}

// ── SSE progress events ───────────────────────────────────────────────────────

/// Sent from Rust to Node over the SSE stream during a scan.
#[derive(Debug, Serialize, Clone)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ProgressEvent {
    /// Emitted periodically during file walking.
    Progress {
        scanned: usize,
        total: usize,
        findings_so_far: usize,
    },
    /// Emitted once when the scan completes.
    Complete {
        result: JobResult,
    },
    /// Emitted if the scan fails.
    Error {
        message: String,
    },
}

// ── Watcher state ─────────────────────────────────────────────────────────────

/// Tracks which files have changed since the last full scan.
/// Shared between the watcher thread and the HTTP handler via Arc<Mutex<>>.
#[derive(Debug, Default)]
pub struct WatcherState {
    /// Files that have been created or modified since last scan.
    pub changed: std::collections::HashSet<String>,
    /// Whether a full scan has ever been completed.
    pub has_baseline: bool,
}