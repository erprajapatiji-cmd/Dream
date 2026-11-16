/*
# Add match format metadata and query indexes

1. New columns
- `matches.match_format` stores the normalized competition format for a match.
- It is non-null and defaults to `Unknown`, so all existing and future records remain valid when no reliable format is available.

2. Allowed values
- `T20`, `ODI`, `Test`, `T10`, `First Class`, `List A`, or `Unknown`.
- Existing rows are not deleted or guessed; the default preserves their current meaning as unknown.

3. Performance
- Add indexes for match format, season, teams, date, player participation, and player dismissal filters used by the API.

4. Security
- No RLS policy is loosened or removed.
- Existing single-tenant access rules remain unchanged.

5. Compatibility
- This is additive only. Existing match inserts and reads continue to work because the new column has a default.
*/

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_format text NOT NULL DEFAULT 'Unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_match_format_allowed'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_match_format_allowed
      CHECK (match_format IN ('T20', 'ODI', 'Test', 'T10', 'First Class', 'List A', 'Unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matches_match_format ON public.matches(match_format);
CREATE INDEX IF NOT EXISTS idx_matches_season ON public.matches(season);
CREATE INDEX IF NOT EXISTS idx_matches_date ON public.matches(date);
CREATE INDEX IF NOT EXISTS idx_matches_team1 ON public.matches(team1);
CREATE INDEX IF NOT EXISTS idx_matches_team2 ON public.matches(team2);
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_non_striker ON public.ball_by_balls(non_striker);
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_fielder ON public.ball_by_balls(fielder);
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_player_out ON public.ball_by_balls(player_out);
