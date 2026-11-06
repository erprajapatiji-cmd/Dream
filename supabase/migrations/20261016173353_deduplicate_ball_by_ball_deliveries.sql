/*
# Deduplicate ball-by-ball deliveries and prevent future duplicates

1. Data cleanup
- For each delivery identified by `match_id`, `innings_id`, `over`, and `ball`, keep the oldest row by `created_at` and `id`.
- Remove only additional copies of the same delivery; match rows and the retained delivery rows are unchanged.

2. Integrity protection
- Add a unique index on `ball_by_balls (match_id, innings_id, over, ball)`.
- This prevents the same delivery from being inserted more than once during repeated CSV imports.

3. Security
- No RLS policies or permissions are changed.

4. Important notes
- This cleanup is intentionally limited to exact delivery-key duplicates.
- The retained row is deterministic: earliest `created_at`, then earliest `id`.
*/

WITH ranked_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY match_id, innings_id, over, ball
      ORDER BY created_at ASC NULLS FIRST, id ASC
    ) AS row_number
  FROM public.ball_by_balls
)
DELETE FROM public.ball_by_balls AS balls
USING ranked_duplicates AS duplicates
WHERE balls.id = duplicates.id
  AND duplicates.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ball_by_balls_delivery
  ON public.ball_by_balls (match_id, innings_id, over, ball);
