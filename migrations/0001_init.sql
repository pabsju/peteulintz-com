-- One row per ball played, inserted live as each ball ends. Abandoned games
-- still contribute their turns to the distributions.
CREATE TABLE turns (
  game_id TEXT NOT NULL,
  turn_no INTEGER NOT NULL,            -- 1-based ball number within the game
  turn_score INTEGER NOT NULL,         -- points scored during this ball
  cumulative_score INTEGER NOT NULL,   -- total score after this ball
  bricks INTEGER NOT NULL,             -- bricks broken during this ball
  max_combo INTEGER NOT NULL,          -- highest multiplier reached (1-10)
  duration_s REAL NOT NULL,            -- launch-to-loss wall time
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, turn_no)
) WITHOUT ROWID;

-- One row per *completed* game (over or won), inserted at game end.
-- No FK from turns: turns arrive while the game is still in flight.
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  final_score INTEGER NOT NULL,
  turns INTEGER NOT NULL,              -- balls used
  outcome TEXT NOT NULL CHECK (outcome IN ('over', 'won')),
  max_combo INTEGER NOT NULL,
  duration_s REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The two hot percentile queries, answerable from the index alone:
-- "cumulative score at ball N vs others"  and  "final score vs others".
CREATE INDEX idx_turns_turnno_cum ON turns (turn_no, cumulative_score);
CREATE INDEX idx_turns_turnno_score ON turns (turn_no, turn_score);
CREATE INDEX idx_games_final_score ON games (final_score);
