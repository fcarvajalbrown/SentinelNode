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

  const { data: healthData } = useQuery({
    queryKey: ["coreHealth"],
    queryFn: async () => {
      const res = await fetch("/api/scanner/health", { credentials: "include" });
      if (!res.ok) throw new Error("offline");
      return res.json() as Promise<{ status: string }>;
    },
    refetchInterval: 30_000,
    retry: false,
  });

  const coreOnline = healthData?.status === "ok";

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
      <div className="p-4 space-y-1 text-sm bg-slate-700 rounded-xl text-slate-300">
        <p className="font-medium text-white">How it works</p>
        <p>The scanner reads the directory you set as <code className="text-blue-400">SCAN_PATH</code> in your <code className="text-blue-400">.env</code> file.</p>
        <p>Use <code className="text-blue-400">/</code> to scan the entire mounted directory, or type a subpath like <code className="text-blue-400">/SentinelNode</code> to narrow the scan.</p>
        <p className="text-xs text-slate-400">Binary files, images, and files over 1MB are skipped automatically.</p>
      </div>

      {/* Scan form */}
      <div className="p-6 bg-slate-800 rounded-xl">
        <h2 className="mb-1 text-base font-semibold text-white">Secret Scanner</h2>
        <p className="mb-4 text-xs text-slate-400">
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
            className="flex-1 px-4 py-2 font-mono text-sm text-white border rounded-lg bg-slate-700 border-slate-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => mutation.mutate(subpath)}
            disabled={mutation.isPending || !coreOnline}
            className="px-5 py-2 text-sm font-medium text-white transition-colors bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
          >
            {mutation.isPending ? "Scanning..." : "Run scan"}
          </button>
        </div>

        {!coreOnline && (
          <p className="mt-2 text-xs text-red-400">
            Scanner is offline — start Docker and wait for rust-core to come online.
          </p>
        )}
        {mutation.isError && (
          <p className="mt-3 text-sm text-red-400">
            {mutation.error instanceof Error ? mutation.error.message : "Scan failed"}
          </p>
        )}
      </div>

      {/* Results */}
      {isLoading && (
        <p className="text-sm text-slate-400">Loading last scan...</p>
      )}

      {lastScan && (
        <div className="p-6 bg-slate-800 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">
              Last scan — {lastScan.path}
            </h3>
            <span className="text-xs text-slate-500">
              {new Date(lastScan.completedAt).toLocaleString()}
            </span>
          </div>

          {/* File count */}
          <p className="mb-4 text-xs text-slate-400">
            Scanned {lastScan.scannedFiles?.toLocaleString()} of {lastScan.totalFiles?.toLocaleString()} files
            {lastScan.totalFiles > 0 && lastScan.scannedFiles < lastScan.totalFiles && (
              <span className="ml-1 text-slate-500">
                ({lastScan.totalFiles - lastScan.scannedFiles} skipped — binary or too large)
              </span>
            )}
          </p>

          {lastScan.error && (
            <p className="mb-4 text-sm text-red-400">{lastScan.error}</p>
          )}

          {lastScan.findings.length === 0 ? (
            <p className="text-sm text-green-400">No secrets found.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-amber-400">
                {lastScan.findings.length} finding{lastScan.findings.length !== 1 ? "s" : ""} detected
              </p>
              {lastScan.findings.map((f, i) => (
                <div key={i} className="p-4 border rounded-lg bg-slate-700 border-slate-600">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-blue-400">
                      {f.file}:{f.line}
                    </span>
                    <span className="text-xs text-slate-500">{f.pattern}</span>
                  </div>
                  <p className="font-mono text-xs text-red-300 break-all">{f.match}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}