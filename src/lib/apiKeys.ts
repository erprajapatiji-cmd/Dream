import { supabase } from "./supabase";
import type { ApiKey } from "./types";

const ADMIN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api-keys`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Authentication required. Please sign in.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

interface AdminKeyResponse {
  rawKey: string;
  record: ApiKey;
}

export async function generateApiKey(label: string): Promise<{ rawKey: string; record: ApiKey }> {
  const headers = await getAuthHeaders();
  const res = await fetch(ADMIN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = (await res.json()) as AdminKeyResponse;
  return { rawKey: data.rawKey, record: data.record };
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(ADMIN_URL, { method: "GET", headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = (await res.json()) as { keys: ApiKey[] };
  return data.keys;
}

export async function toggleApiKey(id: string, isActive: boolean): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${ADMIN_URL}/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
}

export async function deleteApiKey(id: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${ADMIN_URL}/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
}
