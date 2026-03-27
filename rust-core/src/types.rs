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

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreList {
    #[serde(default)]
    pub directories: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobPayload {
    pub job: JobType,
    pub path: String,
    #[allow(dead_code)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub ignore_list: IgnoreList,
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
    pub entropy: f64,
    pub rule_id: String,
    pub description: String,
}

// ── Severity ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
}

// ── Detection rule ────────────────────────────────────────────────────────────

/// A single detection rule combining regex, entropy threshold,
/// severity, and stopwords. Modelled after Gitleaks' rule system.
pub struct Rule {
    /// Unique identifier for this rule.
    pub id: &'static str,
    /// Human-readable description shown in the UI.
    pub description: &'static str,
    /// Regex pattern to match against each line.
    pub pattern: &'static str,
    /// Minimum Shannon entropy of the matched value.
    /// A real secret has entropy >= 3.5. Placeholders like
    /// "changeme" have entropy ~2.0.
    pub entropy_min: f64,
    /// Severity of findings from this rule.
    pub severity: Severity,
    /// If the matched string contains any of these words,
    /// the finding is discarded as a false positive.
    pub stopwords: &'static [&'static str],
}

// ── SSE progress events ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ProgressEvent {
    Progress {
        scanned: usize,
        total: usize,
        findings_so_far: usize,
    },
    Complete {
        result: JobResult,
    },
    Error {
        message: String,
    },
}

// ── Watcher state ─────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct WatcherState {
    pub changed: std::collections::HashSet<String>,
    pub has_baseline: bool,
}