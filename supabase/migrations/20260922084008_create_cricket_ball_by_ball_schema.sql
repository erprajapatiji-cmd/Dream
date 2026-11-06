/*
# Cricket Ball-by-Ball Data Schema

## Overview
Creates the complete database schema for storing cricket ball-by-ball data sourced from Kaggle CSV files.
The system allows uploading CSV data, storing it in a structured relational schema, and accessing it
via an API-key protected edge function.

## New Tables

### 1. `matches`
Stores match-level metadata for each cricket match.
- `id` (uuid, primary key)
- `match_id` (text, unique) — original match identifier from the Kaggle dataset (e.g. "335982")
- `season` (text) — e.g. "2007/08"
- `city` (text) — match venue city
- `date` (date) — match date
- `team1` (text) — first team
- `team2` (text) — second team
- `toss_winner` (text) — team that won the toss
- `toss_decision` (text) — "bat" or "field"
- `result` (text) — match result description
- `result_margin` (text) — margin of victory
- `player_of_match` (text) — player of the match
- `venue` (text) — stadium name
- `umpire1` (text)
- `umpire2` (text
- `created_at` (timestamptz)

### 2. `innings`
Stores innings-level data for each match (typically 2 innings per match).
- `id` (uuid, primary key)
- `match_id` (uuid, foreign key → matches.id ON DELETE CASCADE)
- `innings_no` (int) — 1 or 2
- `batting_team` (text)
- `bowling_team` (text)
- `total_runs` (int, default 0)
- `total_wickets` (int, default 0)
- `total_overs` (numeric, default 0)
- `created_at` (timestamptz)

### 3. `ball_by_balls`
Stores every ball record — the core ball-by-ball data.
- `id` (uuid, primary key)
- `innings_id` (uuid, foreign key → innings.id ON DELETE CASCADE)
- `match_id` (uuid, foreign key → matches.id ON DELETE CASCADE)
- `over` (int) — over number (0-indexed)
- `ball` (int) — ball number within the over (1-6+)
- `batter` (text)
- `bowler` (text)
- `non_striker` (text)
- `runs_batter` (int, default 0) — runs scored off the bat
- `runs_extra` (int, default 0) — extra runs
- `runs_total` (int, default 0) — total runs on this ball
- `extras_type` (text) — "wide", "noball", "bye", "legbye", etc.
- `is_wicket` (boolean, default false)
- `wicket_type` (text) — "bowled", "caught", "run out", etc.
- `player_out` (text) — dismissed player name
- `fielder` (text) — fielder involved in dismissal
- `created_at` (timestamptz)

### 4. `api_keys`
Stores API keys for authenticated access to the ball-by-ball data via edge function.
- `id` (uuid, primary key)
- `key_hash` (text, unique) — SHA-256 hash of the API key (never store raw key)
- `label` (text) — human-readable label for the key
- `is_active` (boolean, default true)
- `created_at` (timestamptz)
- `last_used_at` (timestamptz)

## Security
- RLS enabled on all tables.
- This is a single-tenant app (no sign-in screen) — policies use `TO anon, authenticated`
  so the anon-key frontend can read and write data.
- All CRUD operations allowed for anon + authenticated roles since data is intentionally shared.

## Indexes
- `ball_by_balls` indexed on `innings_id` and `match_id` for fast lookups.
- `innings` indexed on `match_id`.
- `matches` indexed on `match_id` (the Kaggle text ID).
*/

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id text UNIQUE NOT NULL,
  season text,
  city text,
  date date,
  team1 text,
  team2 text,
  toss_winner text,
  toss_decision text,
  result text,
  result_margin text,
  player_of_match text,
  venue text,
  umpire1 text,
  umpire2 text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_matches" ON matches;
CREATE POLICY "anon_select_matches" ON matches FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_matches" ON matches;
CREATE POLICY "anon_insert_matches" ON matches FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_matches" ON matches;
CREATE POLICY "anon_update_matches" ON matches FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_matches" ON matches;
CREATE POLICY "anon_delete_matches" ON matches FOR DELETE
  TO anon, authenticated USING (true);

-- Innings table
CREATE TABLE IF NOT EXISTS innings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings_no int NOT NULL,
  batting_team text,
  bowling_team text,
  total_runs int NOT NULL DEFAULT 0,
  total_wickets int NOT NULL DEFAULT 0,
  total_overs numeric(5,1) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE innings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_innings" ON innings;
CREATE POLICY "anon_select_innings" ON innings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_innings" ON innings;
CREATE POLICY "anon_insert_innings" ON innings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_innings" ON innings;
CREATE POLICY "anon_update_innings" ON innings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_innings" ON innings;
CREATE POLICY "anon_delete_innings" ON innings FOR DELETE
  TO anon, authenticated USING (true);

-- Ball-by-ball table
CREATE TABLE IF NOT EXISTS ball_by_balls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  innings_id uuid NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  over int NOT NULL,
  ball int NOT NULL,
  batter text,
  bowler text,
  non_striker text,
  runs_batter int NOT NULL DEFAULT 0,
  runs_extra int NOT NULL DEFAULT 0,
  runs_total int NOT NULL DEFAULT 0,
  extras_type text,
  is_wicket boolean NOT NULL DEFAULT false,
  wicket_type text,
  player_out text,
  fielder text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ball_by_balls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ball_by_balls" ON ball_by_balls;
CREATE POLICY "anon_select_ball_by_balls" ON ball_by_balls FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_ball_by_balls" ON ball_by_balls;
CREATE POLICY "anon_insert_ball_by_balls" ON ball_by_balls FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_ball_by_balls" ON ball_by_balls;
CREATE POLICY "anon_update_ball_by_balls" ON ball_by_balls FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_ball_by_balls" ON ball_by_balls;
CREATE POLICY "anon_delete_ball_by_balls" ON ball_by_balls FOR DELETE
  TO anon, authenticated USING (true);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text UNIQUE NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_api_keys" ON api_keys;
CREATE POLICY "anon_select_api_keys" ON api_keys FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_api_keys" ON api_keys;
CREATE POLICY "anon_insert_api_keys" ON api_keys FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_api_keys" ON api_keys;
CREATE POLICY "anon_update_api_keys" ON api_keys FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_api_keys" ON api_keys;
CREATE POLICY "anon_delete_api_keys" ON api_keys FOR DELETE
  TO anon, authenticated USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_innings_match_id ON innings(match_id);
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_innings_id ON ball_by_balls(innings_id);
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_match_id ON ball_by_balls(match_id);
CREATE INDEX IF NOT EXISTS idx_matches_match_id ON matches(match_id);