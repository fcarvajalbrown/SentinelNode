import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface Finding {
  file: string;
  line: number;
  match: string;
  pattern: string;
  severity: "critical" | "high" | "medium";
  entropy: number;
  ruleId: string;
  description: string;
}

interface ScanResult {
  path: string;
  findings: Finding[];
  completedAt: string;
  error: string | null;
  totalFiles: number;
  scannedFiles: number;
  wasIncremental?: boolean;
}

interface Progress {
  scanned: number;
  total: number;
  findingsSoFar: number;
}

async function fetchLastScan(): Promise<ScanResult> {
  const res = await fetch("/api/scanner/last", { credentials: "include" });
  if (!res.ok) throw new Error("No scan results yet");
  const data = await res.json();
  return data.data;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-400 border-red-800 bg-red-950",
  high:     "text-amber-400 border-amber-800 bg-amber-950",
  medium:   "text-blue-400 border-blue-800 bg-blue-950",
};

const EXAMPLE_PATHS = [
  { label: "Entire directory", value: "/" },
  { label: "SentinelNode", value: "/SentinelNode" },
  { label: "Documents",     value: "/Documents" },
  { label: "Projects",      value: "/Projects" },
];

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ progress }: { progress: Progress | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6">
      <svg className="w-10 h-10 text-blue-500 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
        <path className="opacity-90" fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      <div className="space-y-1 text-center">
        <p className="text-sm text-slate-300">Scanning...</p>
        {progress && progress.total > 0 && (
          <p className="text-xs text-slate-400">
            {progress.scanned.toLocaleString()} of {progress.total.toLocaleString()} files
            {progress.findingsSoFar > 0 && (
              <span className="ml-2 text-amber-400">
                · {progress.findingsSoFar} finding{progress.findingsSoFar !== 1 ? "s" : ""} so far
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ScanResults() {
  const [subpath, setSubpath]     = useState("/");
  const [scanning, setScanning]   = useState(false);
  const [progress, setProgress]   = useState<Progress | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const eventSourceRef            = useRef<EventSource | null>(null);
  const queryClient               = useQueryClient();

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

  // Clean up SSE connection on unmount.
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  function startScan() {
    if (scanning || !coreOnline) return;

    setScanError(null);
    setProgress({ scanned: 0, total: 0, findingsSoFar: 0 });
    setScanning(true);

    // Close any existing connection.
    eventSourceRef.current?.close();

    const params = new URLSearchParams({ subpath, extraPatterns: "" });
    const es = new EventSource(`/api/scanner/scan/stream?${params}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        if (event.type === "progress") {
          setProgress({
            scanned: event.scanned,
            total: event.total,
            findingsSoFar: event.findingsSoFar,
          });
        }

        if (event.type === "complete") {
          queryClient.setQueryData(["lastScan"], {
            path: event.result.path ?? subpath,
            findings: event.result.findings,
            completedAt: event.result.completedAt,
            error: event.result.error,
            totalFiles: event.result.totalFiles,
            scannedFiles: event.result.scannedFiles,
            wasIncremental: event.result.wasIncremental,
          });
          setScanning(false);
          setProgress(null);
          es.close();
        }

        if (event.type === "error") {
          setScanError(event.message);
          setScanning(false);
          setProgress(null);
          es.close();
        }
      } catch {
        // Ignore malformed events.
      }
    };

    es.onerror = () => {
      setScanError("Connection to scanner lost.");
      setScanning(false);
      setProgress(null);
      es.close();
    };
  }

  return (
    <div className="space-y-6">

      {/* Instructions */}
      <div className="p-4 space-y-1 text-sm bg-slate-700 rounded-xl text-slate-300">
        <p className="font-medium text-white">How it works</p>
        <p>
          The scanner reads the directory you set as{" "}
          <code className="text-blue-400">SCAN_PATH</code> in your{" "}
          <code className="text-blue-400">.env</code> file.
        </p>
        <p>
          Use <code className="text-blue-400">/</code> to scan the entire
          mounted directory, or pick a subpath below.
        </p>
        <p className="text-xs text-slate-400">
          Binary files, images, and files over 1 MB are skipped automatically.
        </p>
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
              disabled={scanning}
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
            disabled={scanning}
            placeholder="/ or /subpath"
            className="flex-1 px-4 py-2 font-mono text-sm text-white border rounded-lg bg-slate-700 border-slate-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            onClick={startScan}
            disabled={scanning || !coreOnline}
            className="px-5 py-2 text-sm font-medium text-white transition-colors bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
          >
            {scanning ? "Scanning..." : "Run scan"}
          </button>
        </div>

        {!coreOnline && (
          <p className="mt-2 text-xs text-red-400">
            Scanner is offline — wait for rust-core to come online.
          </p>
        )}
        {scanError && (
          <p className="mt-3 text-sm text-red-400">{scanError}</p>
        )}
      </div>

      {/* Real progress ring — shown during scan */}
      {scanning && <Spinner progress={progress} />}

      {/* Results */}
      {!scanning && isLoading && (
        <p className="text-sm text-slate-400">Loading last scan...</p>
      )}

      {!scanning && lastScan && (
        <div className="p-6 bg-slate-800 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Last scan — {lastScan.path}
              </h3>
              {lastScan.wasIncremental && (
                <span className="text-xs text-blue-400">Incremental scan</span>
              )}
            </div>
            <span className="text-xs text-slate-500">
              {new Date(lastScan.completedAt).toLocaleString()}
            </span>
          </div>

          <p className="mb-4 text-xs text-slate-400">
            Scanned {lastScan.scannedFiles?.toLocaleString()} of{" "}
            {lastScan.totalFiles?.toLocaleString()} files
            {lastScan.totalFiles > 0 &&
              lastScan.scannedFiles < lastScan.totalFiles && (
                <span className="ml-1 text-slate-500">
                  ({(lastScan.totalFiles - lastScan.scannedFiles).toLocaleString()} skipped)
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
                {lastScan.findings.length} finding
                {lastScan.findings.length !== 1 ? "s" : ""} detected
              </p>
              {lastScan.findings.map((f, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-4 border ${
                    SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS.medium
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs">
                      {f.file}:{f.line}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium capitalize">
                        {f.severity}
                      </span>
                    </div>
                  </div>
                  <p className="font-mono text-xs break-all opacity-80">
                    {f.match}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs opacity-60">{f.description}</p>
                    <p className="text-xs opacity-40">entropy {f.entropy}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}