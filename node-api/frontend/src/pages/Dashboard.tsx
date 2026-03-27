import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ScanResults from "../components/ScanResults.js";
import HeaderAudit from "../components/HeaderAudit.js";

interface Props {
  onLogout: () => void;
}

type Tab = "scanner" | "network";

async function fetchCoreHealth(): Promise<{ status: string }> {
  const res = await fetch("/api/scanner/health", { credentials: "include" });
  if (!res.ok) throw new Error("offline");
  return res.json();
}

function CoreStatusDot() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["coreHealth"],
    queryFn: fetchCoreHealth,
    refetchInterval: 30_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-400">
        <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
        Checking scanner...
      </span>
    );
  }

  if (isError || data?.status !== "ok") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-400">
        <span className="w-2 h-2 bg-red-500 rounded-full" />
        Scanner offline
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-green-400">
      <span className="w-2 h-2 bg-green-500 rounded-full" />
      Scanner online
    </span>
  );
}

export default function Dashboard({ onLogout }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("scanner");

  async function handleLogout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    onLogout();
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">

      {/* Navbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white">
            SentinelNode
          </h1>
          <p className="text-xs text-slate-500">Security auditing dashboard</p>
        </div>
        <div className="flex items-center gap-6">
          <CoreStatusDot />
          <button
            onClick={handleLogout}
            className="text-sm transition-colors text-slate-400 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex gap-6 px-6 border-b border-slate-700">
        {(["scanner", "network"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {tab === "scanner" ? "Secret Scanner" : "Header Audit"}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="max-w-4xl px-6 py-8 mx-auto">
        {activeTab === "scanner" ? <ScanResults /> : <HeaderAudit />}
      </main>
    </div>
  );
}