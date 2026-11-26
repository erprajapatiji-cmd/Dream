/*
# Lock down api_keys and enforce service_role-only access

1. Security Changes
- Remove ALL anon/authenticated policies (SELECT, INSERT, UPDATE, DELETE) from api_keys.
- Revoke ALL privileges from anon and authenticated on api_keys.
- Grant SELECT, INSERT, UPDATE only to service_role (used by edge functions with SUPABASE_SERVICE_ROLE_KEY).
- api_keys remains RLS-enabled; with no anon/authenticated policies, the browser cannot read, create, modify, or delete API keys.

2. Rationale
- API key hashes are server-side secrets. The browser was able to read, create, and delete keys directly through the anon key.
- API key management is now moved to an authenticated admin edge function (admin-api-keys) that uses the service role key server-side.

3. Important Notes
- This is a security tightening: existing service_role edge functions continue to work.
- The frontend apiKeys.ts will be updated to call the admin-api-keys edge function instead of direct table access.
- No data is lost; existing key rows remain.
*/

-- Remove all anon/authenticated policies from api_keys
DROP POLICY IF EXISTS "anon_select_api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "anon_insert_api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "anon_update_api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "anon_delete_api_keys" ON public.api_keys;

-- Revoke all privileges from browser-facing roles
REVOKE ALL ON public.api_keys FROM anon, authenticated;

-- Grant only to service_role (server-side edge functions)
GRANT SELECT, INSERT, UPDATE ON public.api_keys TO service_role;