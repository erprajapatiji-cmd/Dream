/*
# Add unique index on innings(match_id, innings_no)

1. Purpose
- The CSV import edge function currently does a SELECT-then-INSERT dance to avoid
  duplicate innings rows. With a unique index it can use a single `upsert` call
  per batch instead, which is far faster and eliminates a full round-trip.

2. Changes
- `CREATE UNIQUE INDEX IF NOT EXISTS uq_innings_match_innings ON innings(match_id, innings_no)`

3. Security
- No RLS or policy changes.

4. Notes
- Idempotent (IF NOT EXISTS). Safe to re-run.
*/

CREATE UNIQUE INDEX IF NOT EXISTS uq_innings_match_innings
  ON public.innings (match_id, innings_no);