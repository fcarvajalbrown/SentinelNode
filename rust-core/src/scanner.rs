/// src/scanner.rs
///
/// Recursive secret scanner using Rayon for parallelism.
/// Returns findings plus file counts for progress reporting.

use crate::types::{Finding, JobPayload};
use rayon::prelude::*;
use regex::Regex;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

/// Directories to always skip — test data, deps, build artifacts, venvs.
const SKIP_DIRS: &[&str] = &[
    ".venv", ".env", "venv", "node_modules", "target", ".git",
    "__pycache__", "dist", "build", "patterns", "tests", "test",
    ".tox", ".mypy_cache", "site-packages",
];

/// File extensions to always skip — binaries, media, archives.
const SKIP_EXTENSIONS: &[&str] = &[
    "exe", "dll", "so", "dylib", "bin", "obj", "o",
    "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp",
    "mp4", "mp3", "wav", "avi", "mov",
    "zip", "tar", "gz", "bz2", "7z", "rar",
    "pdf", "doc", "docx", "xls", "xlsx",
    "pyc", "pyo", "class",
    "lock",
];

/// Returns true if any component of the path matches a skip directory.
fn should_skip_path(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        SKIP_DIRS.contains(&s.as_ref())
    })
}

/// Returns true if the file extension should be skipped.
fn should_skip_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SKIP_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Scans the directory in payload.path for all patterns.
/// Returns (findings, total_files, scanned_files).
pub fn scan(payload: &JobPayload) -> (Vec<Finding>, usize, usize) {
    let regexes: Vec<(String, Regex)> = payload
        .patterns
        .iter()
        .filter_map(|p| {
            Regex::new(p)
                .map(|r| (p.clone(), r))
                .map_err(|e| eprintln!("Invalid pattern '{}': {}", p, e))
                .ok()
        })
        .collect();

    let files: Vec<_> = WalkDir::new(&payload.path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| !should_skip_path(e.path()))
        .filter(|e| !should_skip_extension(e.path()))
        .collect();

    let total_files = files.len();

    let results: Vec<(Vec<Finding>, bool)> = files
        .par_iter()
        .map(|entry| {
            let (findings, was_scanned) = scan_file(entry.path(), &payload.path, &regexes);
            (findings, was_scanned)
        })
        .collect();

    let scanned_files = results.iter().filter(|(_, s)| *s).count();
    let findings = results.into_iter().flat_map(|(f, _)| f).collect();

    (findings, total_files, scanned_files)
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
        // Skip lines that look like regex patterns or test data themselves.
        if line.contains("AKIA[0-9A-Z]") || line.contains("(?i)") || line.contains("\\s*") {
            continue;
        }

        for (pattern, regex) in regexes {
            if let Some(m) = regex.find(line) {
                let match_text = m.as_str().chars().take(80).collect();
                findings.push(Finding {
                    file: relative.clone(),
                    line: line_number + 1,
                    match_text,
                    pattern: pattern.clone(),
                });
            }
        }
    }

    (findings, true)
}