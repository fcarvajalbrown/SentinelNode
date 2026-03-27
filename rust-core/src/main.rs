/// src/main.rs
///
/// sentinel-core HTTP server. Listens on 0.0.0.0:8080.
/// Supports full scans, incremental scans, SSE progress streaming,
/// and filesystem watching via a background thread.

mod scanner;
mod types;
mod watcher;

use chrono::Utc;
use crossbeam_channel::unbounded;
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Response, Server};
use types::{JobPayload, JobResult, JobType, ProgressEvent, WatcherState};

fn main() {
    let addr = "0.0.0.0:8080";
    let server = Server::http(addr).expect("Failed to start HTTP server");

    // Shared watcher state — lives for the entire process lifetime.
    let watcher_state: Arc<Mutex<WatcherState>> = Arc::new(Mutex::new(WatcherState::default()));

    // Start the filesystem watcher on a background thread.
    let scan_path = std::env::var("SCAN_PATH").unwrap_or_else(|_| "/scan".to_string());
    watcher::spawn(scan_path, Arc::clone(&watcher_state));

    println!("sentinel-core listening on {}", addr);

    for mut request in server.incoming_requests() {
        // ── Health check ──────────────────────────────────────────────────────
        if request.method() == &Method::Get && request.url() == "/health" {
            let _ = request.respond(json_str_response(r#"{"status":"ok"}"#, 200));
            continue;
        }

        // ── SSE streaming scan ────────────────────────────────────────────────
        if request.method() == &Method::Post && request.url() == "/scan/stream" {
            let mut body = String::new();
            if request.as_reader().read_to_string(&mut body).is_err() {
                let _ = request.respond(json_str_response(r#"{"error":"bad request"}"#, 400));
                continue;
            }

            let payload: JobPayload = match serde_json::from_str(&body) {
                Ok(p) => p,
                Err(e) => {
                    let msg = format!("{{\"error\":\"{}\"}}", e);
                    let _ = request.respond(json_str_response(&msg, 400));
                    continue;
                }
            };

            let state_clone = Arc::clone(&watcher_state);
            let (progress_tx, progress_rx) = unbounded::<ProgressEvent>();

            // Check if we can do an incremental scan.
            let (changed_files, is_incremental) = {
                let state = state_clone.lock().unwrap();
                if state.has_baseline && !state.changed.is_empty() {
                    (state.changed.clone(), true)
                } else {
                    (std::collections::HashSet::new(), false)
                }
            };

            // Run the scan on a separate thread so HTTP isn't blocked.
            let progress_tx_clone = progress_tx.clone();
            let state_for_scan = Arc::clone(&watcher_state);
            let state_for_clear = Arc::clone(&watcher_state);
            std::thread::spawn(move || {
                let (findings, total_files, scanned_files) = if is_incremental {
                    scanner::scan_incremental(&payload, changed_files, progress_tx_clone)
                } else {
                    scanner::scan_full(&payload, progress_tx_clone, state_for_scan)
                };

                // Clear changed set after incremental scan.
                if is_incremental {
                    if let Ok(mut s) = state_for_clear.lock() {
                        s.changed.clear();
                    }
                }

                let result = JobResult {
                    job: "scan_secrets".to_string(),
                    findings,
                    completed_at: Utc::now().to_rfc3339(),
                    error: None,
                    total_files,
                    scanned_files,
                    was_incremental: is_incremental,
                    changed_files: if is_incremental { scanned_files } else { 0 },
                };

                let _ = progress_tx.send(ProgressEvent::Complete { result });
            });

            // Stream SSE events back to Node as they arrive.
            let mut sse_body = String::new();
            for event in progress_rx {
                if let Ok(json) = serde_json::to_string(&event) {
                    sse_body.push_str(&format!("data: {}\n\n", json));
                }
                if matches!(event, ProgressEvent::Complete { .. } | ProgressEvent::Error { .. }) {
                    break;
                }
            }

            let content_type = Header::from_bytes("Content-Type", "text/event-stream").unwrap();
            let _ = request.respond(
                Response::from_string(sse_body)
                    .with_status_code(200)
                    .with_header(content_type),
            );
            continue;
        }

        // ── Legacy non-streaming scan ─────────────────────────────────────────
        if request.method() == &Method::Post && request.url() == "/scan" {
            let mut body = String::new();
            if request.as_reader().read_to_string(&mut body).is_err() {
                let _ = request.respond(json_str_response(r#"{"error":"bad request"}"#, 400));
                continue;
            }

            let payload: JobPayload = match serde_json::from_str(&body) {
                Ok(p) => p,
                Err(e) => {
                    let result = error_result(&e.to_string());
                    let _ = request.respond(json_response(result, 400));
                    continue;
                }
            };

            let (progress_tx, _progress_rx) = unbounded::<ProgressEvent>();
            let state_clone = Arc::clone(&watcher_state);

            let (findings, total_files, scanned_files) = match payload.job {
                JobType::ScanSecrets => {
                    scanner::scan_full(&payload, progress_tx, state_clone)
                }
            };

            println!(
                "Scan complete: {} findings in {}/{} files",
                findings.len(), scanned_files, total_files
            );

            let result = JobResult {
                job: "scan_secrets".to_string(),
                findings,
                completed_at: Utc::now().to_rfc3339(),
                error: None,
                total_files,
                scanned_files,
                was_incremental: false,
                changed_files: 0,
            };

            let _ = request.respond(json_response(result, 200));
            continue;
        }

        let _ = request.respond(json_str_response(r#"{"error":"not found"}"#, 404));
    }
}

fn error_result(detail: &str) -> JobResult {
    JobResult {
        job: "unknown".to_string(),
        findings: vec![],
        completed_at: Utc::now().to_rfc3339(),
        error: Some(detail.to_string()),
        total_files: 0,
        scanned_files: 0,
        was_incremental: false,
        changed_files: 0,
    }
}

fn json_response(result: JobResult, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let json = serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string());
    json_str_response(&json, status)
}

fn json_str_response(json: &str, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let content_type = Header::from_bytes("Content-Type", "application/json").unwrap();
    Response::from_string(json)
        .with_status_code(status)
        .with_header(content_type)
}