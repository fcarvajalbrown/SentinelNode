import { useState } from "react";
import ScanResults from "../components/ScanResults.js";
import HeaderAudit from "../components/HeaderAudit.js";

interface Props {
  onLogout: () => void;
}

type Tab = "scanner" | "network";

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
      <header className="border-b border-slate-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">
            SentinelNode
          </h1>
          <p className="text-xs text-slate-500">Security auditing dashboard</p>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </header>

      {/* Tabs */}
      <nav className="border-b border-slate-700 px-6 flex gap-6">
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
      <main className="max-w-4xl mx-auto px-6 py-8">
        {activeTab === "scanner" ? <ScanResults /> : <HeaderAudit />}
      </main>
    </div>
  );
}