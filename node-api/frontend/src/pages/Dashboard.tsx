import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ScanResults from "../components/ScanResults.js";
import HeaderAudit from "../components/HeaderAudit.js";
import Settings from "./Settings.js";

interface Props {
  onLogout: () => void;
}

type Tab = "scanner" | "network" | "settings";

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
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    onLogout();
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">

      {/* Navbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white">SentinelNode</h1>
          <p className="text-xs text-slate-500">Security auditing dashboard</p>
        </div>
        <div className="flex items-center gap-6">
          <CoreStatusDot />

          {/* Gear icon — Settings */}
          <button
            onClick={() => setActiveTab(activeTab === "settings" ? "scanner" : "settings")}
            className={`transition-colors ${
              activeTab === "settings" ? "text-white" : "text-slate-400 hover:text-white"
            }`}
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
                       a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
                       A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83
                       l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
                       A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83
                       l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
                       a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83
                       l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
                       a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          <button
            onClick={handleLogout}
            className="text-sm transition-colors text-slate-400 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Tabs — hidden when Settings is active */}
      {activeTab !== "settings" && (
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
      )}

      {/* Settings header */}
      {activeTab === "settings" && (
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-700">
          <button
            onClick={() => setActiveTab("scanner")}
            className="text-sm transition-colors text-slate-400 hover:text-white"
          >
            ← Back
          </button>
          <span className="text-slate-600">|</span>
          <span className="text-sm text-slate-300">Settings</span>
        </div>
      )}

      {/* Content */}
      <main className="max-w-4xl px-6 py-8 mx-auto">
        {activeTab === "scanner" && <ScanResults />}
        {activeTab === "network" && <HeaderAudit />}
        {activeTab === "settings" && <Settings />}
      </main>
    </div>
  );
}