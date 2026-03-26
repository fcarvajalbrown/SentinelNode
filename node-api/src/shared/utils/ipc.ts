/**
 * src/shared/utils/ipc.ts
 *
 * IPC bridge between Node.js and the Rust sentinel-core binary.
 *
 * Responsibilities:
 *   - Spawn the Rust binary as a child process
 *   - Send a JobPayload to Rust via stdin as JSON
 *   - Read the JobResult from stdout as JSON
 *   - Handle timeouts, spawn errors, and malformed output
 *
 * This is the ONLY file in the project that calls child_process.spawn.
 * Scanner routes never touch the process directly — they call runJob()
 * and get a typed promise back.
 *
 * IPC flow:
 *   Node                          Rust
 *   ────                          ────
 *   spawn sentinel-core
 *   write JobPayload → stdin  →   read stdin
 *                                 execute scan
 *                    stdout   ←   write JobResult
 *   read stdout
 *   parse JobResult
 *   resolve promise
 */

import { spawn } from "child_process";
import type { JobPayload, JobResult } from "../types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * How long to wait for the Rust binary to complete before killing it.
 * Large directories can take a while — 5 minutes is generous for MVP.
 */
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Spawns the Rust sentinel-core binary, sends a job, and returns the result.
 *
 * @param payload - The job to execute, typed as JobPayload from types.ts
 * @returns A promise that resolves with JobResult or rejects on error/timeout
 *
 * @example
 * const result = await runJob({
 *   job: "scan_secrets",
 *   path: "/scan",
 *   patterns: ["AKIA[0-9A-Z]{16}"],
 * });
 */
export async function runJob(payload: JobPayload): Promise<JobResult> {
  const binaryPath = process.env.RUST_CORE_BIN ?? "sentinel-core";

  return new Promise((resolve, reject) => {
    // Spawn the Rust binary. stdio configuration:
    //   stdin  — we write the JSON payload here
    //   stdout — we read the JSON result from here
    //   stderr — inherited so Rust's log output appears in docker logs
    const child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    let stdoutBuffer = "";
    let timedOut = false;

    // ── Timeout ─────────────────────────────────────────────────────────────
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error(`sentinel-core timed out after ${JOB_TIMEOUT_MS}ms`));
    }, JOB_TIMEOUT_MS);

    // ── Write payload to stdin ───────────────────────────────────────────────
    // Serialize the payload to JSON and write it to the child's stdin.
    // End the stdin stream so Rust knows the full input has arrived.
    const input = JSON.stringify(payload);
    child.stdin.write(input, "utf-8", (err) => {
      if (err) {
        clearTimeout(timer);
        reject(new Error(`Failed to write to sentinel-core stdin: ${err.message}`));
        return;
      }
      child.stdin.end();
    });

    // ── Read stdout ──────────────────────────────────────────────────────────
    // Accumulate all stdout chunks into a single string.
    // Rust writes one complete JSON object then exits.
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf-8");
    });

    // ── Process exit ─────────────────────────────────────────────────────────
    child.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) return; // already rejected above

      if (code !== 0) {
        reject(
          new Error(`sentinel-core exited with code ${code}. stdout: ${stdoutBuffer}`)
        );
        return;
      }

      // Parse the JSON result from stdout.
      // If Rust wrote malformed JSON, this throws and we reject the promise.
      try {
        const result = JSON.parse(stdoutBuffer) as JobResult;
        resolve(result);
      } catch {
        reject(
          new Error(`sentinel-core returned invalid JSON: ${stdoutBuffer}`)
        );
      }
    });

    // ── Spawn error ───────────────────────────────────────────────────────────
    // Fires if the binary doesn't exist or can't be executed.
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(`Failed to spawn sentinel-core at "${binaryPath}": ${err.message}`)
      );
    });
  });
}