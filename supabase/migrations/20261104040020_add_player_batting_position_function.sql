/*
# Add batting position lookup for a player

1. New Function
- `player_batting_positions(p_name)` returns one number per innings the player batted in.
- The number is the player's batting position in that innings: 1 for the first batter to come in, 2 for the next, and so on.
- A batter is counted when they first appear as the striker or as the non-striker in that innings.

2. Security
- Runs with the caller's permissions (no elevated rights).
- EXECUTE is revoked from PUBLIC, anon and authenticated; only the service role can call it, which is what the ball-by-ball API uses.
*/

CREATE OR REPLACE FUNCTION public.player_batting_positions(p_name text)
RETURNS TABLE(batting_position int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH player_innings AS (
    SELECT DISTINCT innings_id
    FROM ball_by_balls
    WHERE lower(batter) = lower(p_name) OR lower(non_striker) = lower(p_name)
  ),
  appearances AS (
    SELECT b.innings_id, lower(b.batter) AS lname, (b.over * 100000 + b.ball) * 2 AS seq
    FROM ball_by_balls b
    JOIN player_innings p ON p.innings_id = b.innings_id
    WHERE b.batter IS NOT NULL
    UNION ALL
    SELECT b.innings_id, lower(b.non_striker), (b.over * 100000 + b.ball) * 2 + 1
    FROM ball_by_balls b
    JOIN player_innings p ON p.innings_id = b.innings_id
    WHERE b.non_striker IS NOT NULL
  ),
  first_seen AS (
    SELECT innings_id, lname, min(seq) AS first_seq
    FROM appearances
    GROUP BY innings_id, lname
  ),
  ranked AS (
    SELECT innings_id, lname,
      row_number() OVER (PARTITION BY innings_id ORDER BY first_seq)::int AS pos
    FROM first_seen
  )
  SELECT pos AS batting_position
  FROM ranked
  WHERE lname = lower(p_name);
$$;

REVOKE EXECUTE ON FUNCTION public.player_batting_positions(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.player_batting_positions(text) TO service_role;
