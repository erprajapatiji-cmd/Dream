-- Add indexes on player columns for fast player-based queries
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_batter ON ball_by_balls(batter);
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_bowler ON ball_by_balls(bowler);
CREATE INDEX IF NOT EXISTS idx_ball_by_balls_player_out ON ball_by_balls(player_out);
