/*
# Add durable TigZig cache and request gate

1. New Tables
- `tigzig_sql_cache`
- `query_hash` (text, primary key) identifies one normalized TigZig SQL query.
- `sql_query` (text) stores the query associated with the cached response.
- `response_json` (jsonb) stores the normalized TigZig response.
- `expires_at` (timestamptz) controls the six-hour cache lifetime.
- `created_at` (timestamptz) records when the cache entry was written.
- `tigzig_request_gate`
- `id` (integer, primary key) contains one shared rate-limit gate row.
- `next_allowed_at` (timestamptz) schedules the next permitted outbound request.

2. Security
- Both tables enable RLS and have no anon or authenticated grants.
- Only the server-side `service_role` can use these tables.
- The request gate function is callable only by `service_role`.

3. Functions
- `claim_tigzig_request_slot()` atomically reserves the next outbound request slot and returns its scheduled time.

4. Important Notes
- Cache state survives Edge Function instance changes and is shared by concurrent requests.
- The gate spaces TigZig requests by at least one second across function instances.
*/

CREATE TABLE IF NOT EXISTS public.tigzig_sql_cache (
  query_hash text PRIMARY KEY,
  sql_query text NOT NULL,
  response_json jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tigzig_sql_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tigzig_sql_cache FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tigzig_sql_cache TO service_role;

CREATE TABLE IF NOT EXISTS public.tigzig_request_gate (
  id integer PRIMARY KEY,
  next_allowed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tigzig_request_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tigzig_request_gate FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tigzig_request_gate TO service_role;

INSERT INTO public.tigzig_request_gate (id, next_allowed_at)
VALUES (1, now())
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_tigzig_request_slot()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_time_value timestamptz := clock_timestamp();
  scheduled_time timestamptz;
BEGIN
  SELECT next_allowed_at
  INTO scheduled_time
  FROM public.tigzig_request_gate
  WHERE id = 1
  FOR UPDATE;

  scheduled_time := GREATEST(COALESCE(scheduled_time, current_time_value), current_time_value);
  UPDATE public.tigzig_request_gate
  SET next_allowed_at = scheduled_time + interval '1 second'
  WHERE id = 1;

  RETURN scheduled_time;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_tigzig_request_slot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tigzig_request_slot() TO service_role;