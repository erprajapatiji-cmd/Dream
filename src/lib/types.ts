export interface Match {
  id: string;
  match_id: string;
  season: string | null;
  city: string | null;
  date: string | null;
  team1: string | null;
  team2: string | null;
  toss_winner: string | null;
  toss_decision: string | null;
  result: string | null;
  result_margin: string | null;
  player_of_match: string | null;
  venue: string | null;
  umpire1: string | null;
  umpire2: string | null;
  created_at: string;
}

export interface Innings {
  id: string;
  match_id: string;
  innings_no: number;
  batting_team: string | null;
  bowling_team: string | null;
  total_runs: number;
  total_wickets: number;
  total_overs: number;
  created_at: string;
}

export interface BallByBall {
  id: string;
  innings_id: string;
  match_id: string;
  over: number;
  ball: number;
  batter: string | null;
  bowler: string | null;
  non_striker: string | null;
  runs_batter: number;
  runs_extra: number;
  runs_total: number;
  extras_type: string | null;
  is_wicket: boolean;
  wicket_type: string | null;
  player_out: string | null;
  fielder: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  key_hash: string;
  label: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}
