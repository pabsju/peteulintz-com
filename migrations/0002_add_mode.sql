-- Difficulty modes: 'laptop' (slower ball) vs 'desktop'. Scores aren't
-- comparable across modes, so every aggregate query filters by mode —
-- the new indexes mirror that. Pre-existing rows were all played at
-- desktop speed, hence the DEFAULT backfill.
ALTER TABLE turns ADD COLUMN mode TEXT NOT NULL DEFAULT 'desktop';
ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'desktop';

DROP INDEX idx_turns_turnno_cum;
DROP INDEX idx_turns_turnno_score;
DROP INDEX idx_games_final_score;
CREATE INDEX idx_turns_mode_turnno_cum ON turns (mode, turn_no, cumulative_score);
CREATE INDEX idx_turns_mode_turnno_score ON turns (mode, turn_no, turn_score);
CREATE INDEX idx_games_mode_final_score ON games (mode, final_score);
