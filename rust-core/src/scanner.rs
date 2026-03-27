/// src/scanner.rs
///
/// Recursive secret scanner using Rayon for parallelism.

use crate::types::{Finding, JobPayload};
use rayon::prelude::*;
use regex::Regex;
use std::fs;
use walkdir::WalkDir;

/// Scans the directory in payload.path for all patterns in payload.patterns.
/// Returns a flat list of findings across all files.
pub fn scan(payload: &JobPayload) -> Vec<Finding> {
    // Compile all regex patterns upfront — fail fast on invalid patterns.
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

    // Collect all readable files from the directory tree.
    let files: Vec<_> = WalkDir::new(&payload.path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .collect();

    // Scan files in parallel using Rayon.
    files
        .par_iter()
        .flat_map(|entry| scan_file(entry.path(), &payload.path, &regexes))
        .collect()
}

/// Scans a single file and returns all findings.
fn scan_file(
    path: &std::path::Path,
    root: &str,
    regexes: &[(String, Regex)],
) -> Vec<Finding> {
    // Skip files that can't be read as UTF-8 — binaries, images, etc.
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    // Skip large files — anything over 1MB is unlikely to be a config file.
    if content.len() > 1_000_000 {
        return vec![];
    }

    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();

    let mut findings = vec![];

    for (line_number, line) in content.lines().enumerate() {
        for (pattern, regex) in regexes {
            if let Some(m) = regex.find(line) {
                // Truncate match to 80 chars to avoid logging full secrets.
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

    findings
}