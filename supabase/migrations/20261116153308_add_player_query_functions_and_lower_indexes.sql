/*
# Player query functions with match filters

1. New Functions (service role only)
- `player_in_fielders(list, name)`: true when `name` is one of the comma-separated fielder names in `list` (case-insensitive, whole-name match).
- `player_filtered_match_ids(match_id, format, season, team, date_from, date_to)`: returns match UUIDs that satisfy every supplied filter (AND). NULL means "no filter".
- `player_career_stats(...)`: database-side aggregates for batting, bowling and participation for one player under the same filters. Returns one JSON object.
- `player_matches(...)`: matches (same filters) in which the player appears as batter, bowler, non-striker, player out or fielder. Newest first.
- `player_match_balls(player, match_id, limit, offset)`: every ball of one exact match involving the player in any role, ordered by innings, over and ball.

2. New Indexes
- Expression indexes on lower(batter), lower(bowler), lower(non_striker), lower(player_out) so case-insensitive player lookups can use an index.

3. Security
- All functions run with the caller's permissions and EXECUTE is revoked from PUBLIC, anon and authenticated. Only the service role (used by the ball-by-ball API edge function) can call them.
- No table, row or policy is changed. No data is deleted or rewritten.

4. Notes
- Batting dismissals exclude "retired hurt" and "retired not out". Bowling wickets exclude run out, obstructing the field, retired hurt and retired not out.
- Runs conceded exclude byes and leg-byes. Wides and no-balls are not counted as legal bowling balls.
- Batter balls faced exclude wides.
*/

CREATE OR REPLACE FUNCTION public.player_in_fielders(p_list text, p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_list IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(string_to_array(lower(p_list), ',')) AS n
    WHERE btrim(n) = lower(btrim(p_name))
  );
$$;

CREATE OR REPLACE FUNCTION public.player_filtered_match_ids(
  p_match_id text,
  p_format text,
  p_season text,
  p_team text,
  p_date_from date,
  p_date_to date
)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.id
  FROM matches m
  WHERE (p_match_id IS NULL OR m.match_id = p_match_id)
    AND (p_format IS NULL OR m.match_format = p_format)
    AND (p_season IS NULL OR m.season = p_season)
    AND (p_team IS NULL OR lower(m.team1) = lower(p_team) OR lower(m.team2) = lower(p_team))
    AND (p_date_from IS NULL OR m.date >= p_date_from)
    AND (p_date_to IS NULL OR m.date <= p_date_to);
$$;

CREATE OR REPLACE FUNCTION public.player_career_stats(
  p_name text,
  p_match_id text DEFAULT NULL,
  p_format text DEFAULT NULL,
  p_season text DEFAULT NULL,
  p_team text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH fm AS (
    SELECT f.id FROM player_filtered_match_ids(p_match_id, p_format, p_season, p_team, p_date_from, p_date_to) f
  ),
  pb AS (
    SELECT b.*
    FROM ball_by_balls b
    JOIN fm ON fm.id = b.match_id
    WHERE lower(b.batter) = lower(p_name)
       OR lower(b.bowler) = lower(p_name)
       OR lower(b.non_striker) = lower(p_name)
       OR lower(b.player_out) = lower(p_name)
       OR player_in_fielders(b.fielder, p_name)
  ),
  agg AS (
    SELECT
      count(DISTINCT pb.match_id) AS matches,
      coalesce(sum(pb.runs_batter) FILTER (WHERE lower(pb.batter) = lower(p_name)), 0) AS runs,
      count(*) FILTER (WHERE lower(pb.batter) = lower(p_name)
        AND lower(regexp_replace(coalesce(pb.extras_type, ''), '[^a-z]', '', 'g')) NOT IN ('wide', 'wides')) AS balls_faced,
      count(*) FILTER (WHERE lower(pb.player_out) = lower(p_name)
        AND pb.is_wicket IS TRUE
        AND lower(coalesce(pb.wicket_type, '')) NOT IN ('retired hurt', 'retired not out')) AS outs,
      count(*) FILTER (WHERE lower(pb.batter) = lower(p_name) AND pb.runs_batter = 6) AS sixes,
      count(*) FILTER (WHERE lower(pb.bowler) = lower(p_name)
        AND lower(regexp_replace(coalesce(pb.extras_type, ''), '[^a-z]', '', 'g')) NOT IN ('wide', 'wides', 'noball', 'noballs')) AS bowling_balls,
      coalesce(sum(pb.runs_total) FILTER (WHERE lower(pb.bowler) = lower(p_name)
        AND lower(regexp_replace(coalesce(pb.extras_type, ''), '[^a-z]', '', 'g')) NOT IN ('bye', 'byes', 'legbye', 'legbyes')), 0) AS runs_conceded,
      count(*) FILTER (WHERE lower(pb.bowler) = lower(p_name)
        AND pb.is_wicket IS TRUE
        AND lower(coalesce(pb.wicket_type, '')) NOT IN ('run out', 'retired hurt', 'retired not out', 'obstructing the field')) AS wickets
    FROM pb
  ),
  inn AS (
    SELECT DISTINCT pb.innings_id
    FROM pb
    WHERE lower(pb.batter) = lower(p_name) OR lower(pb.non_striker) = lower(p_name)
  ),
  appearances AS (
    SELECT b.innings_id, lower(b.batter) AS lname, (b.over * 100000 + b.ball) * 2 AS seq
    FROM ball_by_balls b
    JOIN inn ON inn.innings_id = b.innings_id
    WHERE b.batter IS NOT NULL
    UNION ALL
    SELECT b.innings_id, lower(b.non_striker), (b.over * 100000 + b.ball) * 2 + 1
    FROM ball_by_balls b
    JOIN inn ON inn.innings_id = b.innings_id
    WHERE b.non_striker IS NOT NULL
  ),
  first_seen AS (
    SELECT innings_id, lname, min(seq) AS first_seq
    FROM appearances
    GROUP BY innings_id, lname
  ),
  ranked AS (
    SELECT innings_id, lname, row_number() OVER (PARTITION BY innings_id ORDER BY first_seq)::int AS pos
    FROM first_seen
  ),
  bat_pos AS (
    SELECT round(avg(pos)::numeric, 2) AS avg_pos
    FROM ranked
    WHERE lname = lower(p_name)
  )
  SELECT jsonb_build_object(
    'player', p_name,
    'matches', a.matches,
    'batting', jsonb_build_object(
      'runs', a.runs,
      'balls', a.balls_faced,
      'outs', a.outs,
      'six_count', a.sixes,
      'batting_position', (SELECT avg_pos FROM bat_pos),
      'average', CASE WHEN a.outs > 0 THEN round(a.runs::numeric / a.outs, 2) END,
      'strike_rate', CASE WHEN a.balls_faced > 0 THEN round(a.runs::numeric * 100 / a.balls_faced, 2) END
    ),
    'bowling', jsonb_build_object(
      'runs_conceded', a.runs_conceded,
      'balls', a.bowling_balls,
      'wickets', a.wickets,
      'economy', CASE WHEN a.bowling_balls > 0 THEN round(a.runs_conceded::numeric * 6 / a.bowling_balls, 2) END,
      'average', CASE WHEN a.wickets > 0 THEN round(a.runs_conceded::numeric / a.wickets, 2) END
    )
  )
  FROM agg a;
$$;

CREATE OR REPLACE FUNCTION public.player_matches(
  p_name text,
  p_match_id text DEFAULT NULL,
  p_format text DEFAULT NULL,
  p_season text DEFAULT NULL,
  p_team text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS SETOF public.matches
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.*
  FROM matches m
  WHERE m.id IN (
    SELECT f.id FROM player_filtered_match_ids(p_match_id, p_format, p_season, p_team, p_date_from, p_date_to) f
  )
  AND EXISTS (
    SELECT 1
    FROM ball_by_balls b
    WHERE b.match_id = m.id
      AND (lower(b.batter) = lower(p_name)
        OR lower(b.bowler) = lower(p_name)
        OR lower(b.non_striker) = lower(p_name)
        OR lower(b.player_out) = lower(p_name)
        OR player_in_fielders(b.fielder, p_name))
  )
  ORDER BY m.date DESC NULLS LAST, m.match_id;
$$;

CREATE OR REPLACE FUNCTION public.player_match_balls(
  p_name text,
  p_match_id text,
  p_limit int DEFAULT 500,
  p_offset int DEFAULT 0
)
RETURNS SETOF public.ball_by_balls
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT b.*
  FROM ball_by_balls b
  JOIN matches m ON m.id = b.match_id
  JOIN innings i ON i.id = b.innings_id
  WHERE m.match_id = p_match_id
    AND (lower(b.batter) = lower(p_name)
      OR lower(b.bowler) = lower(p_name)
      OR lower(b.non_striker) = lower(p_name)
      OR lower(b.player_out) = lower(p_name)
      OR player_in_fielders(b.fielder, p_name))
  ORDER BY i.innings_no, b.over, b.ball, b.id
  LIMIT p_limit OFFSET p_offset;
$$;

CREATE INDEX IF NOT EXISTS idx_ball_by_balls_batter_lower ON public.ball_by_balls (lower(batter));
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_bowler_lower ON public.ball_by_balls (lower(bowler));
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_non_striker_lower ON public.ball_by_balls (lower(non_striker));
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_player_out_lower ON public.ball_by_balls (lower(player_out));

REVOKE EXECUTE ON FUNCTION public.player_in_fielders(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.player_filtered_match_ids(text, text, text, text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.player_career_stats(text, text, text, text, text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.player_matches(text, text, text, text, text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.player_match_balls(text, text, int, int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.player_in_fielders(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.player_filtered_match_ids(text, text, text, text, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.player_career_stats(text, text, text, text, text, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.player_matches(text, text, text, text, text, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.player_match_balls(text, text, int, int) TO service_role;
