import { useState, useEffect, useCallback } from "react";
import { Key, Plus, Trash2, Copy, Check, AlertCircle, Loader2, ArrowLeft, Power } from "lucide-react";
import { listApiKeys, generateApiKey, toggleApiKey, deleteApiKey } from "@/lib/apiKeys";
import type { ApiKey } from "@/lib/types";

interface SettingsPageProps {
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

export default function SettingsPage({ onNavigate }: SettingsPageProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listApiKeys();
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { rawKey } = await generateApiKey(newLabel.trim());
      setNewKey(rawKey);
      setNewLabel("");
      setShowCreate(false);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    }
    setCreating(false);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      await toggleApiKey(id, !isActive);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update API key");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteApiKey(id);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete API key");
    }
  };

  const copyKey = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ball-by-ball-api`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <button
          onClick={() => onNavigate("matches")}
          className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft size={16} /> Back to Matches
        </button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
            <p className="mt-1 text-sm text-slate-400">Manage keys for accessing ball-by-ball data via API</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            <Plus size={16} />
            New Key
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <AlertCircle className="mt-0.5 shrink-0 text-red-400" size={20} />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* New key reveal */}
        {newKey && (
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <div className="flex items-center gap-2">
              <Check className="text-emerald-400" size={20} />
              <h2 className="font-semibold text-emerald-300">API Key Created</h2>
            </div>
            <p className="mt-2 text-sm text-emerald-200/80">
              Copy this key now — it won't be shown again.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-emerald-500/20 bg-slate-900/80 px-3 py-2 text-xs text-emerald-200">
                {newKey}
              </code>
              <button
                onClick={copyKey}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              onClick={() => setNewKey(null)}
              className="mt-3 text-sm text-emerald-300/70 hover:text-emerald-300"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="font-semibold">Create New API Key</h2>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="Label (e.g. 'Mobile App', 'Analytics')"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleCreate}
                disabled={!newLabel.trim() || creating}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 className="animate-spin" size={16} /> : "Create"}
              </button>
            </div>
          </div>
        )}

        {/* API usage info */}
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Key size={18} className="text-blue-400" />
            API Usage
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Your key is checked on every request. Send it from your server, mobile app, or approved integration using either header style:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-6 text-slate-300">
{`curl "${apiUrl}/matches" \\
  -H "X-API-Key: cbb_your_key"

# Or use the standard Bearer format:
curl "${apiUrl}/matches/123/balls" \\
  -H "Authorization: Bearer cbb_your_key"

# Available endpoints:
GET ${apiUrl}/matches
GET ${apiUrl}/matches/:matchId/innings
GET ${apiUrl}/matches/:matchId/innings/:inningsNo/balls
GET ${apiUrl}/matches/:matchId/balls
GET ${apiUrl}/players/:playerName/matches
GET ${apiUrl}/players/:playerName/stats
GET ${apiUrl}/players/:playerName/matches/:matchId/balls`}
          </pre>
          <p className="mt-3 text-xs text-amber-300/80">Keep the key on a server or secure app configuration. Do not put it in a public website URL or expose it in browser code.</p>
        </div>

        {/* Keys list */}
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-400">Your API Keys</h2>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-slate-500" size={24} />
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">
              No API keys yet. Create one to start accessing data.
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-200">{key.label}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        key.is_active
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-slate-700 text-slate-400"
                      }`}>
                        {key.is_active ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Created {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at && ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-600">
                      {key.key_hash.slice(0, 12)}...
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggle(key.id, key.is_active)}
                      className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                      title={key.is_active ? "Disable" : "Enable"}
                    >
                      <Power size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="rounded-lg border border-slate-700 p-2 text-red-400 hover:bg-red-500/10 hover:border-red-500/30 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
