/// src/scanner.rs
///
/// Recursive secret scanner with SSE progress reporting.
/// Supports full scans and incremental scans via the watcher state.

use crate::types::{Finding, JobPayload, ProgressEvent, Severity, WatcherState};
use crossbeam_channel::Sender;
use rayon::prelude::*;
use regex::Regex;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use walkdir::WalkDir;

/// Directories to always skip.
const SKIP_DIRS: &[&str] = &[
    ".venv", ".env", "venv", "node_modules", "target", ".git",
    "__pycache__", "dist", "build", "patterns", "tests", "test",
    ".tox", ".mypy_cache", "site-packages",
];

/// File extensions to always skip.
const SKIP_EXTENSIONS: &[&str] = &[
    "exe", "dll", "so", "dylib", "bin", "obj", "o",
    "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp",
    "mp4", "mp3", "wav", "avi", "mov",
    "zip", "tar", "gz", "bz2", "7z", "rar",
    "pdf", "doc", "docx", "xls", "xlsx",
    "pyc", "pyo", "class", "lock",
];

fn should_skip_path(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        SKIP_DIRS.contains(&s.as_ref())
    })
}

fn should_skip_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SKIP_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Assigns severity based on which pattern matched.
fn severity_for_pattern(pattern: &str) -> Severity {
    if pattern.contains("AKIA") || pattern.contains("PRIVATE KEY") {
        Severity::Critical
    } else if pattern.contains("JWT") || pattern.contains("SECRET") || pattern.contains("xox") {
        Severity::High
    } else {
        Severity::Medium
    }
}

/// Compiles patterns into (pattern_string, Regex) pairs.
fn compile_patterns(patterns: &[String]) -> Vec<(String, Regex)> {
    patterns
        .iter()
        .filter_map(|p| {
            Regex::new(p)
                .map(|r| (p.clone(), r))
                .map_err(|e| eprintln!("Invalid pattern '{}': {}", p, e))
                .ok()
        })
        .collect()
}

/// Full scan — walks every file under payload.path.
/// Sends progress events through the SSE sender every 100 files.
pub fn scan_full(
    payload: &JobPayload,
    progress_tx: Sender<ProgressEvent>,
    watcher_state: Arc<Mutex<WatcherState>>,
) -> (Vec<Finding>, usize, usize) {
    let regexes = compile_patterns(&payload.patterns);

    let files: Vec<_> = WalkDir::new(&payload.path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| !should_skip_path(e.path()))
        .filter(|e| !should_skip_extension(e.path()))
        .collect();

    let total = files.len();
    let mut all_findings: Vec<Finding> = vec![];
    let mut scanned = 0;

    // Process in chunks so we can send progress events.
    // Rayon parallelises within each chunk.
    for chunk in files.chunks(100) {
        let chunk_results: Vec<(Vec<Finding>, bool)> = chunk
            .par_iter()
            .map(|entry| scan_file(entry.path(), &payload.path, &regexes))
            .collect();

        for (findings, was_scanned) in chunk_results {
            if was_scanned { scanned += 1; }
            all_findings.extend(findings);
        }

        let _ = progress_tx.send(ProgressEvent::Progress {
            scanned,
            total,
            findings_so_far: all_findings.len(),
        });
    }

    // Mark baseline as complete and clear changed set.
    if let Ok(mut state) = watcher_state.lock() {
        state.has_baseline = true;
        state.changed.clear();
    }

    (all_findings, total, scanned)
}

/// Incremental scan — only scans files in the changed set.
pub fn scan_incremental(
    payload: &JobPayload,
    changed_files: HashSet<String>,
    progress_tx: Sender<ProgressEvent>,
) -> (Vec<Finding>, usize, usize) {
    let regexes = compile_patterns(&payload.patterns);

    let files: Vec<_> = changed_files
        .iter()
        .map(|p| Path::new(p).to_path_buf())
        .filter(|p| p.is_file())
        .filter(|p| !should_skip_path(p))
        .filter(|p| !should_skip_extension(p))
        .collect();

    let total = files.len();

    let results: Vec<(Vec<Finding>, bool)> = files
        .par_iter()
        .map(|path| scan_file(path, &payload.path, &regexes))
        .collect();

    let scanned = results.iter().filter(|(_, s)| *s).count();
    let findings: Vec<Finding> = results.into_iter().flat_map(|(f, _)| f).collect();

    let _ = progress_tx.send(ProgressEvent::Progress {
        scanned,
        total,
        findings_so_far: findings.len(),
    });

    (findings, total, scanned)
}

/// Scans a single file. Returns (findings, was_scanned).
fn scan_file(
    path: &Path,
    root: &str,
    regexes: &[(String, Regex)],
) -> (Vec<Finding>, bool) {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return (vec![], false),
    };

    if content.len() > 1_000_000 {
        return (vec![], false);
    }

    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();

    let mut findings = vec![];

    for (line_number, line) in content.lines().enumerate() {
        if line.contains("AKIA[0-9A-Z]") || line.contains("(?i)") || line.contains("\\s*") {
            continue;
        }

        for (pattern, regex) in regexes {
            if let Some(m) = regex.find(line) {
                let match_text = m.as_str().chars().take(80).collect();
                let severity = severity_for_pattern(pattern);
                findings.push(Finding {
                    file: relative.clone(),
                    line: line_number + 1,
                    match_text,
                    pattern: pattern.clone(),
                    severity,
                });
            }
        }
    }

    (findings, true)
}