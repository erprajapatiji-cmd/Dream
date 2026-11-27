import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ApiKeyRow {
  id: string;
  key_hash: string;
  label: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type AdminClient = ReturnType<typeof createClient>;

const ALLOWED_EMAIL = "erprajapatiji@gmail.com";

async function getUserFromJwt(req: Request, supabase: AdminClient): Promise<{ id: string; email: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return { id: user.id, email: user.email ?? "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return errorResponse("Server not configured", 500);
  }

  // Client with anon key for JWT verification
  const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const user = await getUserFromJwt(req, authClient);
  if (!user) {
    return errorResponse("Authentication required", 401);
  }
  if (user.email.toLowerCase() !== ALLOWED_EMAIL) {
    return errorResponse("Access denied", 403);
  }

  // Service role client for api_keys table access
  const admin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/admin-api-keys/, "");
  const segments = path.split("/").filter(Boolean);

  try {
    // GET / — list all keys
    if (req.method === "GET" && segments.length === 0) {
      const { data, error } = await admin
        .from("api_keys")
        .select("id, key_hash, label, is_active, created_at, last_used_at")
        .order("created_at", { ascending: false });
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ keys: data as ApiKeyRow[] });
    }

    // POST / — create new key
    if (req.method === "POST" && segments.length === 0) {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.label !== "string" || !body.label.trim()) {
        return errorResponse("Label is required", 400);
      }
      if (body.label.length > 100) {
        return errorResponse("Label must be 100 characters or fewer", 400);
      }
      const rawKey = "cbb_" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const keyHash = await hashKey(rawKey);
      const { data, error } = await admin
        .from("api_keys")
        .insert({ key_hash: keyHash, label: body.label.trim() })
        .select("id, key_hash, label, is_active, created_at, last_used_at")
        .single();
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ rawKey, record: data as ApiKeyRow });
    }

    // PATCH /:id — toggle active
    if (req.method === "PATCH" && segments.length === 1) {
      const id = segments[0];
      const body = await req.json().catch(() => null);
      if (!body || typeof body.is_active !== "boolean") {
        return errorResponse("is_active boolean is required", 400);
      }
      const { error } = await admin.from("api_keys").update({ is_active: body.is_active }).eq("id", id);
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ success: true });
    }

    // DELETE /:id — delete key
    if (req.method === "DELETE" && segments.length === 1) {
      const id = segments[0];
      const { error } = await admin.from("api_keys").delete().eq("id", id);
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ success: true });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(message, 500);
  }
});
