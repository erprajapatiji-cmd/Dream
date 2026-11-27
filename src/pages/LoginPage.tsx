import { useState, useEffect } from "react";
import { Trophy, Mail, Lock, Loader2, AlertCircle, LogIn } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface LoginPageProps {
  onAuthSuccess: () => void;
}

const ALLOWED_EMAIL = "erprajapatiji@gmail.com";

export default function LoginPage({ onAuthSuccess }: LoginPageProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email === ALLOWED_EMAIL) onAuthSuccess();
    });
  }, [onAuthSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (email.trim().toLowerCase() !== ALLOWED_EMAIL) {
      setError("This app is private. Only the authorized account can sign in.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        if (data.user) {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) throw signInError;
          onAuthSuccess();
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        onAuthSuccess();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      if (msg.toLowerCase().includes("invalid login")) {
        setError("Incorrect email or password. Please try again.");
      } else {
        setError(msg);
      }
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500">
            <Trophy className="text-white" size={28} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">CrickData</h1>
          <p className="mt-1 text-sm text-slate-500">Ball-by-Ball Records</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-center text-lg font-semibold">
            {mode === "signin" ? "Sign In" : "Create Account"}
          </h2>
          <p className="mt-1 text-center text-xs text-slate-500">
            {mode === "signin" ? "Access your cricket data dashboard" : "Register with the authorized email"}
          </p>

          {error && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="mt-0.5 shrink-0 text-red-400" size={18} />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <>
                  <LogIn size={18} />
                  {mode === "signin" ? "Sign In" : "Create Account"}
                </>
              )}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Private access only. Unauthorized accounts are blocked.
        </p>
      </div>
    </div>
  );
}
