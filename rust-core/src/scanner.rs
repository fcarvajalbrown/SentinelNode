/// src/scanner.rs
///
/// Recursive secret scanner using Rayon for parallelism.
/// Returns findings plus file counts for progress reporting.

use crate::types::{Finding, JobPayload};
use rayon::prelude::*;
use regex::Regex;
use std::fs;
use walkdir::WalkDir;

/// Scans the directory in payload.path for all patterns.
/// Returns (findings, total_files, scanned_files).
/// total_files  = every file found in the tree
/// scanned_files = files actually read (skips binaries and large files)
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
        .collect();

    let total_files = files.len();

    // Track how many files were actually read (not skipped).
    let results: Vec<(Vec<Finding>, bool)> = files
        .par_iter()
        .map(|entry| {
            let (findings, was_scanned) = scan_file(entry.path(), &payload.path, &regexes);
            (findings, was_scanned)
        })
        .collect();

    let scanned_files = results.iter().filter(|(_, scanned)| *scanned).count();
    let findings = results.into_iter().flat_map(|(f, _)| f).collect();

    (findings, total_files, scanned_files)
}

/// Scans a single file. Returns (findings, was_scanned).
/// was_scanned is false if the file was skipped (binary or too large).
fn scan_file(
    path: &std::path::Path,
    root: &str,
    regexes: &[(String, Regex)],
) -> (Vec<Finding>, bool) {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return (vec![], false), // binary or unreadable — skip
    };

    if content.len() > 1_000_000 {
        return (vec![], false); // too large — skip
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