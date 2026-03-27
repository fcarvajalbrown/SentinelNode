/// src/main.rs
///
/// sentinel-core HTTP server. Listens on 0.0.0.0:8080.
/// Node.js POSTs a JobPayload to /scan and gets a JobResult back.

mod scanner;
mod types;

use chrono::Utc;
use tiny_http::{Server, Method, Response, Header};
use types::{JobPayload, JobResult, JobType};

fn main() {
    let addr = "0.0.0.0:8080";
    let server = Server::http(addr).expect("Failed to start HTTP server");
    println!("sentinel-core listening on {}", addr);

    for mut request in server.incoming_requests() {
        // Only accept POST /scan
        if request.method() != &Method::Post || request.url() != "/scan" {
            let _ = request.respond(Response::from_string("Not found").with_status_code(404));
            continue;
        }

        // Read request body
        let mut body = String::new();
        if request.as_reader().read_to_string(&mut body).is_err() {
            let _ = request.respond(Response::from_string("Bad request").with_status_code(400));
            continue;
        }

        // Parse JobPayload
        let payload: JobPayload = match serde_json::from_str(&body) {
            Ok(p) => p,
            Err(e) => {
                let result = error_result(&e.to_string());
                let _ = request.respond(json_response(result, 400));
                continue;
            }
        };

        // Dispatch job
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

        let _ = request.respond(json_response(result, 200));
    }
}

fn error_result(detail: &str) -> JobResult {
    JobResult {
        job: "unknown".to_string(),
        findings: vec![],
        completed_at: Utc::now().to_rfc3339(),
        error: Some(detail.to_string()),
    }
}

fn json_response(result: JobResult, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let json = serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string());
    let content_type = Header::from_bytes("Content-Type", "application/json").unwrap();
    Response::from_string(json)
        .with_status_code(status)
        .with_header(content_type)
}