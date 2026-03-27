import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Finding {
  file: string;
  line: number;
  match: string;
  pattern: string;
}

interface ScanResult {
  path: string;
  findings: Finding[];
  completedAt: string;
  error: string | null;
  totalFiles: number;
  scannedFiles: number;
}

async function fetchLastScan(): Promise<ScanResult> {
  const res = await fetch("/api/scanner/last", { credentials: "include" });
  if (!res.ok) throw new Error("No scan results yet");
  const data = await res.json();
  return data.data;
}

async function triggerScan(subpath: string): Promise<ScanResult> {
  const res = await fetch("/api/scanner/scan", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subpath, extraPatterns: [] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Scan failed");
  return data.data;
}

const EXAMPLE_PATHS = [
  { label: "Entire mounted directory", value: "/" },
  { label: "SentinelNode project", value: "/SentinelNode" },
  { label: "Desktop", value: "/" },
  { label: "Documents", value: "/Documents" },
  { label: "Custom subpath", value: "" },
];

export default function ScanResults() {
  const [subpath, setSubpath] = useState("/");
  const queryClient = useQueryClient();

  const { data: lastScan, isLoading } = useQuery({
    queryKey: ["lastScan"],
    queryFn: fetchLastScan,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: triggerScan,
    onSuccess: (data) => {
      queryClient.setQueryData(["lastScan"], data);
    },
  });

  return (
    <div className="space-y-6">

      {/* Instructions */}
      <div className="bg-slate-700 rounded-xl p-4 text-sm text-slate-300 space-y-1">
        <p className="font-medium text-white">How it works</p>
        <p>The scanner reads the directory you set as <code className="text-blue-400">SCAN_PATH</code> in your <code className="text-blue-400">.env</code> file.</p>
        <p>Use <code className="text-blue-400">/</code> to scan the entire mounted directory, or type a subpath like <code className="text-blue-400">/SentinelNode</code> to narrow the scan.</p>
        <p className="text-slate-400 text-xs">Binary files, images, and files over 1MB are skipped automatically.</p>
      </div>

      {/* Scan form */}
      <div className="bg-slate-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-white mb-1">Secret Scanner</h2>
        <p className="text-xs text-slate-400 mb-4">
          Scans for leaked API keys, tokens, and credentials.
        </p>

        {/* Quick path selector */}
        <div className="flex flex-wrap gap-2 mb-3">
          {EXAMPLE_PATHS.map((p) => (
            <button
              key={p.label}
              onClick={() => setSubpath(p.value)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                subpath === p.value
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "border-slate-600 text-slate-400 hover:text-white hover:border-slate-400"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={subpath}
            onChange={(e) => setSubpath(e.target.value)}
            placeholder="/ or /subpath"
            className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2
                       border border-slate-600 focus:outline-none
                       focus:border-blue-500 text-sm font-mono"
          />
          <button
            onClick={() => mutation.mutate(subpath)}
            disabled={mutation.isPending}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                       text-white text-sm font-medium px-5 py-2 rounded-lg
                       transition-colors whitespace-nowrap"
          >
            {mutation.isPending ? "Scanning..." : "Run scan"}
          </button>
        </div>

        {mutation.isError && (
          <p className="text-red-400 text-sm mt-3">
            {mutation.error instanceof Error ? mutation.error.message : "Scan failed"}
          </p>
        )}
      </div>

      {/* Results */}
      {isLoading && (
        <p className="text-slate-400 text-sm">Loading last scan...</p>
      )}

      {lastScan && (
        <div className="bg-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">
              Last scan — {lastScan.path}
            </h3>
            <span className="text-xs text-slate-500">
              {new Date(lastScan.completedAt).toLocaleString()}
            </span>
          </div>

          {/* File count */}
          <p className="text-xs text-slate-400 mb-4">
            Scanned {lastScan.scannedFiles?.toLocaleString()} of {lastScan.totalFiles?.toLocaleString()} files
            {lastScan.totalFiles > 0 && lastScan.scannedFiles < lastScan.totalFiles && (
              <span className="ml-1 text-slate-500">
                ({lastScan.totalFiles - lastScan.scannedFiles} skipped — binary or too large)
              </span>
            )}
          </p>

          {lastScan.error && (
            <p className="text-red-400 text-sm mb-4">{lastScan.error}</p>
          )}

          {lastScan.findings.length === 0 ? (
            <p className="text-green-400 text-sm">No secrets found.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-amber-400 text-sm font-medium">
                {lastScan.findings.length} finding{lastScan.findings.length !== 1 ? "s" : ""} detected
              </p>
              {lastScan.findings.map((f, i) => (
                <div key={i} className="bg-slate-700 rounded-lg p-4 border border-slate-600">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-blue-400">
                      {f.file}:{f.line}
                    </span>
                    <span className="text-xs text-slate-500">{f.pattern}</span>
                  </div>
                  <p className="text-xs font-mono text-red-300 break-all">{f.match}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}