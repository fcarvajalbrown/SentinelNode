import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface HeaderCheck {
  header: string;
  present: boolean;
  value: string | null;
}

interface AuditResult {
  url: string;
  checks: HeaderCheck[];
  score: number;
  total: number;
  auditedAt: string;
}

async function fetchLastAudit(): Promise<AuditResult> {
  const res = await fetch("/api/network/last", { credentials: "include" });
  if (!res.ok) throw new Error("No audit results yet");
  const data = await res.json();
  return data.data;
}

async function triggerAudit(url: string): Promise<AuditResult> {
  const res = await fetch("/api/network/audit", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Audit failed");
  return data.data;
}

function ScoreBadge({ score, total }: { score: number; total: number }) {
  const pct = score / total;
  const color =
    pct >= 0.8 ? "text-green-400 border-green-700" :
    pct >= 0.5 ? "text-amber-400 border-amber-700" :
                 "text-red-400 border-red-700";

  return (
    <span className={`text-lg font-bold border rounded-lg px-3 py-1 ${color}`}>
      {score}/{total}
    </span>
  );
}

export default function HeaderAudit() {
  const [url, setUrl] = useState("https://");
  const queryClient  = useQueryClient();

  const { data: lastAudit, isLoading } = useQuery({
    queryKey: ["lastAudit"],
    queryFn: fetchLastAudit,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: triggerAudit,
    onSuccess: (data) => {
      queryClient.setQueryData(["lastAudit"], data);
    },
  });

  return (
    <div className="space-y-6">

      {/* Audit form */}
      <div className="bg-slate-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-white mb-4">
          Header Audit
        </h2>
        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://paris.cl"
            className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2
                       border border-slate-600 focus:outline-none
                       focus:border-blue-500 text-sm font-mono"
          />
          <button
            onClick={() => mutation.mutate(url)}
            disabled={mutation.isPending}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                       text-white text-sm font-medium px-5 py-2 rounded-lg
                       transition-colors whitespace-nowrap"
          >
            {mutation.isPending ? "Auditing..." : "Run audit"}
          </button>
        </div>
        {mutation.isError && (
          <p className="text-red-400 text-sm mt-3">
            {mutation.error.message}
          </p>
        )}
      </div>

      {/* Results */}
      {isLoading && (
        <p className="text-slate-400 text-sm">Loading last audit...</p>
      )}

      {lastAudit && (
        <div className="bg-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-semibold text-white">
                {lastAudit.url}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {new Date(lastAudit.auditedAt).toLocaleString()}
              </p>
            </div>
            <ScoreBadge score={lastAudit.score} total={lastAudit.total} />
          </div>

          <div className="space-y-2">
            {lastAudit.checks.map((check) => (
              <div
                key={check.header}
                className="flex items-start justify-between
                           bg-slate-700 rounded-lg px-4 py-3"
              >
                <div>
                  <p className="text-xs font-mono text-slate-200">
                    {check.header}
                  </p>
                  {check.value && (
                    <p className="text-xs text-slate-400 mt-0.5 break-all">
                      {check.value}
                    </p>
                  )}
                </div>
                <span
                  className={`text-xs font-medium ml-4 shrink-0 ${
                    check.present ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {check.present ? "✓ present" : "✗ missing"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}