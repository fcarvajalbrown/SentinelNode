/// src/watcher.rs
///
/// Filesystem watcher thread.
/// Watches the scan path for changes and updates WatcherState.
/// Runs on a background thread — never blocks the HTTP handler.

use crate::types::WatcherState;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Spawns the filesystem watcher on a background thread.
/// Any file creation or modification under `scan_path` is recorded
/// in `state.changed` so the next scan can be incremental.
pub fn spawn(scan_path: String, state: Arc<Mutex<WatcherState>>) {
    std::thread::spawn(move || {
        if let Err(e) = run(&scan_path, state) {
            eprintln!("Watcher error: {}", e);
        }
    });
}

fn run(scan_path: &str, state: Arc<Mutex<WatcherState>>) -> notify::Result<()> {
    let (tx, rx) = crossbeam_channel::unbounded();

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            if let Ok(event) = result {
                let _ = tx.send(event);
            }
        },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    )?;

    watcher.watch(Path::new(scan_path), RecursiveMode::Recursive)?;
    println!("Watcher active on: {}", scan_path);

    for event in rx {
        match event.kind {
            // Only track writes and creates — not access or metadata changes.
            EventKind::Create(_) | EventKind::Modify(notify::event::ModifyKind::Data(_)) => {
                if let Ok(mut s) = state.lock() {
                    for path in &event.paths {
                        if let Some(p) = path.to_str() {
                            s.changed.insert(p.to_string());
                        }
                    }
                }
            }
            EventKind::Remove(_) => {
                // Remove deleted files from the changed set.
                if let Ok(mut s) = state.lock() {
                    for path in &event.paths {
                        if let Some(p) = path.to_str() {
                            s.changed.remove(p);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok(())
}