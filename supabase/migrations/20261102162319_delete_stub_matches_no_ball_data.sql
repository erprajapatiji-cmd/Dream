/*
# Delete stub matches without real ball-by-ball data

## What this does
1. Finds all matches that have ball_by_balls rows but NONE of them contain
   real cricket data (no batter, no bowler, and 0 runs on every row).
   These are "stub" matches created when a ball-by-ball CSV was imported
   without a corresponding _info.csv — the import creates a match row and
   a single dummy delivery (over 0, ball 0, all nulls) just so the foreign
   keys resolve.
2. Also finds matches where BOTH team1 and team2 are null/empty/placeholder
   ("tbd", "unknown", "n/a", etc.) — these show up as "TBD vs TBD" on the
   matches screen and have no useful data.
3. Deletes the ball_by_balls rows, innings rows, and finally the match rows
   for these matches, in that order (child → parent).

## Safety
- Only deletes matches that have NO real ball-by-ball data OR both teams
  are placeholder/null. Matches with real team names and real delivery
  data are untouched.
- This is a one-time cleanup of stubs already in the database. Going
  forward, the import logic (both client and server) skips TBD vs TBD
  rows before they are saved.

## Tables affected
- ball_by_balls (DELETE)
- innings (DELETE)
- matches (DELETE)
*/

-- Collect the match ids to remove: stub-only or both-teams-placeholder
CREATE TEMP TABLE _matches_to_remove AS
SELECT m.id
FROM matches m
WHERE
  -- Case 1: match has ball rows but none have real data (stub match)
  (
    EXISTS (SELECT 1 FROM ball_by_balls b WHERE b.match_id = m.id)
    AND NOT EXISTS (
      SELECT 1 FROM ball_by_balls b
      WHERE b.match_id = m.id
        AND (b.batter IS NOT NULL OR b.bowler IS NOT NULL OR b.runs_total > 0)
    )
  )
  OR
  -- Case 2: both teams are null/empty/placeholder values
  (
    COALESCE(lower(trim(m.team1)), '') IN ('', 'tbd', 'unknown', 'na', 'n/a', 'null', 'undefined')
    AND COALESCE(lower(trim(m.team2)), '') IN ('', 'tbd', 'unknown', 'na', 'n/a', 'null', 'undefined')
  );

-- Delete child rows first, then parent
DELETE FROM ball_by_balls
WHERE match_id IN (SELECT id FROM _matches_to_remove);

DELETE FROM innings
WHERE match_id IN (SELECT id FROM _matches_to_remove);

DELETE FROM matches
WHERE id IN (SELECT id FROM _matches_to_remove);
