/*
# Refresh innings summaries from imported deliveries

1. Purpose
- Keeps the `innings` summary values synchronized with the ball-by-ball rows written by the CSV import service.
- Recalculates score, wickets, and overs for only the innings touched by an import request.

2. Database objects
- Creates or replaces `public.refresh_innings_totals(uuid[])`.
- The function does not create tables or columns.
- It updates `public.innings.total_runs`, `total_wickets`, and `total_overs` from `public.ball_by_balls`.

3. Security
- The function uses `SECURITY DEFINER` so the server-side import service can refresh summaries consistently.
- The search path is fixed to `public`.
- Direct execution is revoked from PUBLIC, anon, and authenticated.
- Execution is granted only to `service_role`, which is used by the server-side CSV import function.

4. Important notes
- The function only updates innings IDs passed by the trusted import service.
- If an innings has no deliveries, its values are reset to zero.
- Overs are represented as completed overs plus the remaining legal balls divided by ten.
*/

CREATE OR REPLACE FUNCTION public.refresh_innings_totals(p_innings_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH summary AS (
    SELECT
      innings_id,
      COALESCE(SUM(runs_total), 0)::integer AS total_runs,
      COUNT(*) FILTER (WHERE is_wicket)::integer AS total_wickets,
      COUNT(*) FILTER (
        WHERE extras_type IS NULL
          OR (
            LOWER(REPLACE(REPLACE(REPLACE(extras_type, ' ', ''), '_', ''), '-', ''))
            NOT IN ('wide', 'noball')
          )
      )::integer AS legal_balls
    FROM public.ball_by_balls
    WHERE innings_id = ANY(p_innings_ids)
    GROUP BY innings_id
  )
  UPDATE public.innings AS i
  SET
    total_runs = COALESCE(s.total_runs, 0),
    total_wickets = COALESCE(s.total_wickets, 0),
    total_overs = COALESCE(FLOOR(s.legal_balls / 6)::numeric + MOD(s.legal_balls, 6)::numeric / 10, 0)
  FROM summary AS s
  WHERE i.id = s.innings_id;

  UPDATE public.innings AS i
  SET total_runs = 0, total_wickets = 0, total_overs = 0
  WHERE i.id = ANY(p_innings_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.ball_by_balls AS b WHERE b.innings_id = i.id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_innings_totals(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_innings_totals(uuid[]) TO service_role;