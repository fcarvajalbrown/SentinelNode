/// src/main.rs
///
/// Entry point for sentinel-core. Reads a JobPayload from stdin,
/// dispatches to the correct handler, writes a JobResult to stdout.

mod scanner;
mod types;

use chrono::Utc;
use std::io::{self, Read};
use types::{JobPayload, JobResult, JobType};

fn main() {
    // Read the entire stdin into a string — Node closes stdin after writing.
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        write_error("failed to read stdin", &e.to_string());
        std::process::exit(1);
    }

    // Parse the JobPayload from JSON.
    let payload: JobPayload = match serde_json::from_str(&input) {
        Ok(p) => p,
        Err(e) => {
            write_error("invalid JSON payload", &e.to_string());
            std::process::exit(1);
        }
    };

    // Dispatch to the correct job handler.
    let result = match payload.job {
        JobType::ScanSecrets => {
            let findings = scanner::scan(&payload);
            JobResult {
                job: "scan_secrets".to_string(),
                findings,
                completed_at: Utc::now().to_rfc3339(),
                error: None,
            }
        }
    };

    // Write the JobResult as JSON to stdout — Node reads this.
    match serde_json::to_string(&result) {
        Ok(json) => println!("{}", json),
        Err(e) => {
            write_error("failed to serialise result", &e.to_string());
            std::process::exit(1);
        }
    }
}

/// Writes a minimal error JobResult to stdout so Node always gets valid JSON.
fn write_error(context: &str, detail: &str) {
    eprintln!("sentinel-core error: {} — {}", context, detail);
    let error_result = serde_json::json!({
        "job": "unknown",
        "findings": [],
        "completedAt": Utc::now().to_rfc3339(),
        "error": format!("{}: {}", context, detail)
    });
    println!("{}", error_result);
}