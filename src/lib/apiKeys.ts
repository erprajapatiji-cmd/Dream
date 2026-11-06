import { supabase } from "./supabase";
import type { ApiKey } from "./types";

export async function generateApiKey(label: string): Promise<{ rawKey: string; record: ApiKey }> {
  const rawKey = "cbb_" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawKey)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  const { data, error } = await supabase
    .from("api_keys")
    .insert({ key_hash: keyHash, label })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { rawKey, record: data };
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function toggleApiKey(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("api_keys")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteApiKey(id: string): Promise<void> {
  const { error } = await supabase.from("api_keys").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
