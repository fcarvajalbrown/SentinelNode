/// src/types.rs
///
/// IPC contract types — must mirror src/shared/types.ts exactly.

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub job: String,
    pub findings: Vec<Finding>,
    pub completed_at: String,
    pub error: Option<String>,
    pub total_files: usize,
    pub scanned_files: usize,
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