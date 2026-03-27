/**
 * src/shared/utils/ipc.ts
 *
 * IPC bridge — Node.js talks to rust-core over HTTP.
 * rust-core listens on port 8080 inside the Docker network.
 */

import type { JobPayload, JobResult } from "../types.js";

const RUST_CORE_URL = process.env.RUST_CORE_URL ?? "http://rust-core:8080";

/**
 * Sends a job to rust-core and returns the result.
 */
export async function runJob(payload: JobPayload): Promise<JobResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);

  try {
    const response = await fetch(`${RUST_CORE_URL}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`rust-core returned HTTP ${response.status}`);
    }

    return await response.json() as JobResult;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("rust-core timed out after 5 minutes");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}