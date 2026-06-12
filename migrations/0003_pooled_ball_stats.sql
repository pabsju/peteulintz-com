-- Per-ball stats now treat every ball ever played as one independent pool:
-- /api/turn ranks this ball's score against ALL turns in the mode, and the
-- cumulative-score-at-ball-N stat is gone. The turn_no-partitioned indexes
-- served only the old queries.
DROP INDEX idx_turns_mode_turnno_cum;
DROP INDEX idx_turns_mode_turnno_score;
CREATE INDEX idx_turns_mode_score ON turns (mode, turn_score);
