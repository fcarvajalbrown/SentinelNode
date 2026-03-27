import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type IgnoreType = "directory" | "extension" | "file";

interface IgnoreEntry {
  id: number;
  pattern: string;
  type: IgnoreType;
  createdAt: string;
}

async function fetchIgnoreList(): Promise<IgnoreEntry[]> {
  const res = await fetch("/api/settings/ignore", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch ignore list");
  const data = await res.json();
  return data.data;
}

async function addEntry(entry: { pattern: string; type: IgnoreType }): Promise<IgnoreEntry> {
  const res = await fetch("/api/settings/ignore", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to add entry");
  return data.data;
}

async function deleteEntry(id: number): Promise<void> {
  const res = await fetch(`/api/settings/ignore/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete entry");
}

const TYPE_LABELS: Record<IgnoreType, { label: string; placeholder: string; hint: string }> = {
  directory: {
    label: "Directory",
    placeholder: "e.g. node_modules, .next, vendor",
    hint: "Skips entire folders matching this name anywhere in the tree",
  },
  extension: {
    label: "Extension",
    placeholder: "e.g. log, lock, map",
    hint: "Skips all files with this extension (without the dot)",
  },
  file: {
    label: "File",
    placeholder: "e.g. .DS_Store, thumbs.db",
    hint: "Skips files matching this exact filename",
  },
};

const TYPE_COLORS: Record<IgnoreType, string> = {
  directory: "bg-purple-900 text-purple-300 border-purple-700",
  extension:  "bg-teal-900   text-teal-300   border-teal-700",
  file:       "bg-amber-900  text-amber-300  border-amber-700",
};

export default function Settings() {
  const [pattern, setPattern]   = useState("");
  const [type, setType]         = useState<IgnoreType>("directory");
  const queryClient             = useQueryClient();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["ignoreList"],
    queryFn: fetchIgnoreList,
  });

  const addMutation = useMutation({
    mutationFn: addEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ignoreList"] });
      setPattern("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ignoreList"] });
    },
  });

  function handleAdd() {
    if (!pattern.trim()) return;
    addMutation.mutate({ pattern: pattern.trim(), type });
  }

  const grouped = {
    directory: entries.filter((e) => e.type === "directory"),
    extension:  entries.filter((e) => e.type === "extension"),
    file:       entries.filter((e) => e.type === "file"),
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-white">Scanner ignore list</h2>
        <p className="mt-1 text-sm text-slate-400">
          Entries here are merged with the built-in skip list on every scan.
          Built-in entries like <code className="text-blue-400">node_modules</code> and{" "}
          <code className="text-blue-400">.git</code> always apply regardless.
        </p>
      </div>

      {/* Add form */}
      <div className="p-6 bg-slate-800 rounded-xl">
        <h3 className="mb-4 text-sm font-semibold text-white">Add entry</h3>

        {/* Type selector */}
        <div className="flex gap-2 mb-4">
          {(Object.keys(TYPE_LABELS) as IgnoreType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                type === t
                  ? TYPE_COLORS[t]
                  : "border-slate-600 text-slate-400 hover:text-white hover:border-slate-400"
              }`}
            >
              {TYPE_LABELS[t].label}
            </button>
          ))}
        </div>

        <p className="mb-3 text-xs text-slate-500">{TYPE_LABELS[type].hint}</p>

        <div className="flex gap-3">
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={TYPE_LABELS[type].placeholder}
            className="flex-1 px-4 py-2 font-mono text-sm text-white border rounded-lg bg-slate-700 border-slate-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleAdd}
            disabled={!pattern.trim() || addMutation.isPending}
            className="px-5 py-2 text-sm font-medium text-white transition-colors bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
          >
            Add
          </button>
        </div>

        {addMutation.isError && (
          <p className="mt-2 text-xs text-red-400">
            {addMutation.error instanceof Error ? addMutation.error.message : "Failed to add"}
          </p>
        )}
      </div>

      {/* Entries grouped by type */}
      {isLoading && (
        <p className="text-sm text-slate-400">Loading...</p>
      )}

      {!isLoading && entries.length === 0 && (
        <p className="text-sm text-slate-500">
          No custom entries yet. The built-in skip list still applies.
        </p>
      )}

      {(["directory", "extension", "file"] as IgnoreType[]).map((t) => {
        const group = grouped[t];
        if (group.length === 0) return null;

        return (
          <div key={t} className="p-6 bg-slate-800 rounded-xl">
            <h3 className="mb-3 text-sm font-semibold text-white capitalize">
              {TYPE_LABELS[t].label}s
            </h3>
            <div className="space-y-2">
              {group.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between bg-slate-700
                             rounded-lg px-4 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded border ${TYPE_COLORS[t]}`}>
                      {TYPE_LABELS[t].label}
                    </span>
                    <span className="font-mono text-sm text-slate-200">
                      {entry.pattern}
                    </span>
                  </div>
                  <button
                    onClick={() => deleteMutation.mutate(entry.id)}
                    disabled={deleteMutation.isPending}
                    className="text-xs transition-colors text-slate-500 hover:text-red-400 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}