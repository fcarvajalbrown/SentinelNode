/// src/scanner.rs
///
/// Secret scanner with entropy scoring and stopword filtering.
/// Architecture based on Gitleaks' rule system:
///   regex match + entropy threshold + stopword discard = near-zero false positives.

use crate::types::{Finding, JobPayload, ProgressEvent, Rule, Severity, WatcherState};
use crossbeam_channel::Sender;
use rayon::prelude::*;
use regex::Regex;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use walkdir::WalkDir;

// ── Skip lists ────────────────────────────────────────────────────────────────

const SKIP_DIRS: &[&str] = &[
    ".venv", "venv", "node_modules", "target", ".git",
    "__pycache__", "dist", "build", ".next", ".nuxt",
    ".turbo", ".cache", "coverage", "storybook-static",
    ".tox", ".mypy_cache", "site-packages", "vendor",
    "bower_components", ".yarn", ".pnp",
];

const SKIP_EXTENSIONS: &[&str] = &[
    "exe", "dll", "so", "dylib", "bin", "obj", "o",
    "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp",
    "mp4", "mp3", "wav", "avi", "mov",
    "zip", "tar", "gz", "bz2", "7z", "rar",
    "pdf", "doc", "docx", "xls", "xlsx",
    "pyc", "pyo", "class", "lock", "map",
    "woff", "woff2", "ttf", "eot",
];

// ── Global stopwords ──────────────────────────────────────────────────────────
// If a matched value contains any of these, it is discarded immediately.
// This eliminates placeholder and test credentials.

const STOPWORDS: &[&str] = &[
    "example", "test", "dummy", "placeholder", "changeme",
    "your_", "yourkey", "xxx", "yyy", "zzz", "sample",
    "fake", "mock", "todo", "fixme", "replace", "insert",
    "enter", "put_", "here", "override", "redacted",
    "xxxxxxxxxx", "0000000000", "1234567890",
    "abcdefghij", "aaaaaaaaaaaa",
];

// ── Detection rules ───────────────────────────────────────────────────────────
// Each rule combines a specific regex with an entropy minimum.
// Entropy thresholds from Gitleaks research:
//   AWS/GitHub tokens: real keys have entropy > 3.5
//   Generic secrets: require > 3.8 to filter common placeholders
//   Private keys: entropy irrelevant — format is exact

const RULES: &[Rule] = &[
    Rule {
        id: "aws-access-key",
        description: "AWS access key ID",
        pattern: r"\b((?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16})\b",
        entropy_min: 3.0,
        severity: Severity::Critical,
        stopwords: &["AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN"],
    },
    Rule {
        id: "aws-secret-key",
        description: "AWS secret access key",
        pattern: r#"(?i)aws.{0,20}['"`]([A-Za-z0-9+/]{40})['"`]"#,
        entropy_min: 4.0,
        severity: Severity::Critical,
        stopwords: &["example", "test", "sample"],
    },
    Rule {
        id: "github-pat",
        description: "GitHub personal access token",
        pattern: r"\b(ghp_[A-Za-z0-9]{36})\b",
        entropy_min: 3.5,
        severity: Severity::Critical,
        stopwords: &[],
    },
    Rule {
        id: "github-oauth",
        description: "GitHub OAuth token",
        pattern: r"\b(gho_[A-Za-z0-9]{36})\b",
        entropy_min: 3.5,
        severity: Severity::Critical,
        stopwords: &[],
    },
    Rule {
        id: "github-actions",
        description: "GitHub Actions token",
        pattern: r"\b(ghs_[A-Za-z0-9]{36})\b",
        entropy_min: 3.5,
        severity: Severity::High,
        stopwords: &[],
    },
    Rule {
        id: "stripe-secret",
        description: "Stripe secret key",
        pattern: r"\b(sk_live_[A-Za-z0-9]{24,})\b",
        entropy_min: 3.5,
        severity: Severity::Critical,
        stopwords: &["example", "test"],
    },
    Rule {
        id: "stripe-publishable",
        description: "Stripe publishable key",
        pattern: r"\b(pk_live_[A-Za-z0-9]{24,})\b",
        entropy_min: 3.5,
        severity: Severity::High,
        stopwords: &["example", "test"],
    },
    Rule {
        id: "google-api-key",
        description: "Google API key",
        pattern: r"\b(AIza[0-9A-Za-z_-]{35})\b",
        entropy_min: 3.5,
        severity: Severity::High,
        stopwords: &["example", "test", "AIzaSyD"],
    },
    Rule {
        id: "slack-token",
        description: "Slack API token",
        pattern: r"\b(xox[pboas]-[0-9]{10,13}-[0-9]{10,13}-[0-9]{10,13}-[a-z0-9]{32})\b",
        entropy_min: 3.5,
        severity: Severity::High,
        stopwords: &[],
    },
    Rule {
        id: "npm-token",
        description: "NPM access token",
        pattern: r"\b(npm_[A-Za-z0-9]{36})\b",
        entropy_min: 3.5,
        severity: Severity::High,
        stopwords: &[],
    },
    Rule {
        id: "sendgrid-key",
        description: "SendGrid API key",
        pattern: r"\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b",
        entropy_min: 3.8,
        severity: Severity::High,
        stopwords: &[],
    },
    Rule {
        id: "twilio-sid",
        description: "Twilio account SID",
        pattern: r"\b(AC[a-z0-9]{32})\b",
        entropy_min: 3.5,
        severity: Severity::High,
        stopwords: &["ACtest", "ACexample"],
    },
    Rule {
        id: "private-key",
        description: "Private key header",
        pattern: r"-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----",
        entropy_min: 0.0,
        severity: Severity::Critical,
        stopwords: &[],
    },
    Rule {
        id: "env-secret",
        description: "Secret in environment variable",
        // Matches .env format: SECRET_KEY=<value> where value has high entropy
        // Uses ^ anchor — only matches at line start to avoid code assignments
        pattern: r"(?i)^(JWT_SECRET|JWT_REFRESH_SECRET|SECRET_KEY|API_SECRET|APP_SECRET|AUTH_SECRET|ENCRYPTION_KEY|SIGNING_KEY)=([A-Za-z0-9+/=_\-]{20,})",
        entropy_min: 3.5,
        severity: Severity::Critical,
        stopwords: &["changeme", "replace", "your_", "example", "test"],
    },
    Rule {
        id: "generic-api-key",
        description: "Generic API key in code",
        // Requires quotes — prevents matching variable assignments
        // Requires 32+ chars and high entropy — eliminates most false positives
        pattern: r#"(?i)(?:api_key|apikey|api_secret)\s*[:=]\s*['"`]([A-Za-z0-9+/=_\-]{32,})['"`]"#,
        entropy_min: 3.8,
        severity: Severity::Medium,
        stopwords: &["example", "test", "dummy", "sample", "placeholder", "your"],
    },
];

// ── Shannon entropy ───────────────────────────────────────────────────────────

/// Computes Shannon entropy of a string.
/// Real secrets score > 3.5. Placeholder values like "changeme" score ~2.0.
/// Maximum possible entropy for base64 charset is ~6.0.
pub fn shannon_entropy(s: &str) -> f64 {
    if s.is_empty() {
        return 0.0;
    }

    let mut freq = [0u32; 256];
    for b in s.bytes() {
        freq[b as usize] += 1;
    }

    let len = s.len() as f64;
    freq.iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = c as f64 / len;
            -p * p.log2()
        })
        .sum()
}

// ── Path filtering ────────────────────────────────────────────────────────────

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

// ── Rule application ──────────────────────────────────────────────────────────

struct CompiledRule {
    rule: &'static Rule,
    regex: Regex,
}

fn compile_rules() -> Vec<CompiledRule> {
    RULES.iter()
        .filter_map(|rule| {
            Regex::new(rule.pattern)
                .map(|regex| CompiledRule { rule, regex })
                .map_err(|e| eprintln!("Invalid rule pattern '{}': {}", rule.id, e))
                .ok()
        })
        .collect()
}

/// Applies a single rule to a matched string.
/// Returns None if the match fails entropy or stopword checks.
fn apply_rule(
    rule: &Rule,
    matched: &str,
    file: &str,
    line_number: usize,
) -> Option<Finding> {
    let value = matched.trim();

    // Stopword check — discard known placeholders immediately.
    let lower = value.to_lowercase();
    if STOPWORDS.iter().any(|sw| lower.contains(sw)) {
        return None;
    }
    if rule.stopwords.iter().any(|sw| lower.contains(&sw.to_lowercase())) {
        return None;
    }

    // Entropy check — discard low-entropy strings.
    let entropy = shannon_entropy(value);
    if entropy < rule.entropy_min {
        return None;
    }

    Some(Finding {
        file: file.to_string(),
        line: line_number + 1,
        match_text: value.chars().take(80).collect(),
        pattern: rule.id.to_string(),
        severity: rule.severity.clone(),
        entropy: (entropy * 100.0).round() / 100.0,
        rule_id: rule.id.to_string(),
        description: rule.description.to_string(),
    })
}

// ── File scanning ─────────────────────────────────────────────────────────────

fn scan_file(
    path: &Path,
    root: &str,
    rules: &[CompiledRule],
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
        // Skip lines that are themselves regex patterns or test data.
        if line.contains("(?i)") || line.contains("\\s*") || line.contains("[A-Z0-9]{16}") {
            continue;
        }

        for compiled in rules {
            if let Some(m) = compiled.regex.captures(line) {
                // Use capture group 1 if present (the secret value),
                // otherwise use the full match.
                let matched = m.get(1)
                    .or_else(|| m.get(0))
                    .map(|m| m.as_str())
                    .unwrap_or("");

                if let Some(finding) = apply_rule(compiled.rule, matched, &relative, line_number) {
                    findings.push(finding);
                }
            }
        }
    }

    (findings, true)
}

// ── Public scan functions ─────────────────────────────────────────────────────

pub fn scan_full(
    payload: &JobPayload,
    progress_tx: Sender<ProgressEvent>,
    watcher_state: Arc<Mutex<WatcherState>>,
) -> (Vec<Finding>, usize, usize) {
    let rules = compile_rules();

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

    for chunk in files.chunks(100) {
        let chunk_results: Vec<(Vec<Finding>, bool)> = chunk
            .par_iter()
            .map(|entry| scan_file(entry.path(), &payload.path, &rules))
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

    if let Ok(mut state) = watcher_state.lock() {
        state.has_baseline = true;
        state.changed.clear();
    }

    (all_findings, total, scanned)
}

pub fn scan_incremental(
    payload: &JobPayload,
    changed_files: HashSet<String>,
    progress_tx: Sender<ProgressEvent>,
) -> (Vec<Finding>, usize, usize) {
    let rules = compile_rules();

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
        .map(|path| scan_file(path, &payload.path, &rules))
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