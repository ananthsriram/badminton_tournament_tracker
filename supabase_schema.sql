-- ==============================================================================
-- Badminton Tournament: Normalized Database Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
-- ==============================================================================

-- 1. Create PLAYERS table
CREATE TABLE IF NOT EXISTS players (
  name TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create MATCHES table
CREATE TABLE IF NOT EXISTS matches (
  id INT PRIMARY KEY,
  team1 TEXT NOT NULL,
  team2 TEXT NOT NULL,
  team1_wins INT DEFAULT 0 NOT NULL,
  team2_wins INT DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'Not started' NOT NULL,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create GAMES table (Child of matches with auto-date tracking)
CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  match_id INT REFERENCES matches(id) ON DELETE CASCADE,
  game_num INT NOT NULL,
  winner TEXT DEFAULT '',
  t1_score INT,
  t2_score INT,
  played_date DATE,
  played_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_match_game UNIQUE (match_id, game_num)
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

-- 5. Policies: Public read/write with anon key
CREATE POLICY "Public Read Players" ON players FOR SELECT USING (true);
CREATE POLICY "Public Insert Players" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update Players" ON players FOR UPDATE USING (true);

CREATE POLICY "Public Read Matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Public Insert Matches" ON matches FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update Matches" ON matches FOR UPDATE USING (true);

CREATE POLICY "Public Read Games" ON games FOR SELECT USING (true);
CREATE POLICY "Public Insert Games" ON games FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update Games" ON games FOR UPDATE USING (true);

-- 6. Enable Realtime broadcasting on all 3 tables
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE games;

