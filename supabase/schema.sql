-- WordDrop Supabase schema
-- Run this in the Supabase SQL Editor (Database → SQL Editor → New query).
-- IMPORTANT: Disable "Email Confirmations" in Auth → Settings before first use.

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── users ─────────────────────────────────────────────────────────────────────
-- One row per registered player.
-- Feeds the email marketing list (email column).
-- Display name uniqueness is enforced here; scores denormalise it.

CREATE TABLE IF NOT EXISTS public.users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id      UUID        UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT        UNIQUE NOT NULL,
  display_name TEXT        NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Case-insensitive uniqueness so "BraveEagle" blocks "braveeagle"
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_ci
  ON public.users (LOWER(display_name));

-- ── sessions ──────────────────────────────────────────────────────────────────
-- Stores one grid per shareable session. Expires 3 hours after creation.

CREATE TABLE IF NOT EXISTS public.sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   TEXT        UNIQUE NOT NULL,
  grid         JSONB       NOT NULL,          -- 6×6 char array
  hidden_words JSONB       NOT NULL,          -- seeded word metadata
  category     TEXT        NOT NULL,
  difficulty   TEXT        NOT NULL,
  seed         BIGINT      NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '3 hours')
);

CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON public.sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires     ON public.sessions (expires_at);

-- ── scores ────────────────────────────────────────────────────────────────────
-- One row per player attempt on a session.
-- display_name is denormalised so leaderboard reads are single-table.

CREATE TABLE IF NOT EXISTS public.scores (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   TEXT    NOT NULL REFERENCES public.sessions(session_id) ON DELETE CASCADE,
  user_id      UUID    REFERENCES public.users(id) ON DELETE SET NULL,
  display_name TEXT    NOT NULL,
  score        INTEGER NOT NULL DEFAULT 0,
  words_found  INTEGER NOT NULL DEFAULT 0,
  time_taken   INTEGER NOT NULL,             -- seconds the timer ran for
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scores_session_score
  ON public.scores (session_id, score DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores    ENABLE ROW LEVEL SECURITY;

-- users: anyone can read; only the owning auth user can insert/update their row
CREATE POLICY "users_select_all"   ON public.users FOR SELECT USING (true);
CREATE POLICY "users_insert_own"   ON public.users FOR INSERT WITH CHECK (auth.uid() = auth_id);
CREATE POLICY "users_update_own"   ON public.users FOR UPDATE USING (auth.uid() = auth_id);

-- sessions: public read; any authenticated user (or anon) can insert (for guest creation)
CREATE POLICY "sessions_select_all"    ON public.sessions FOR SELECT USING (true);
CREATE POLICY "sessions_insert_anon"   ON public.sessions FOR INSERT WITH CHECK (true);

-- scores: public read; only authenticated users can insert
CREATE POLICY "scores_select_all"      ON public.scores FOR SELECT USING (true);
CREATE POLICY "scores_insert_authed"   ON public.scores FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ── Streak + high score (added for daily-streak feature) ────────────────────
-- Run the migration block below in the Supabase SQL Editor if these columns
-- don't exist yet (safe to run twice — IF NOT EXISTS guards all statements).

-- ALTER TABLE public.users
--   ADD COLUMN IF NOT EXISTS high_score       INTEGER NOT NULL DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS current_streak   INTEGER NOT NULL DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS longest_streak   INTEGER NOT NULL DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS last_played_date DATE;

-- ── TTL cleanup (optional: run via pg_cron or Supabase Edge Function on schedule) ──

-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('expire-sessions', '*/10 * * * *',
--   $$ DELETE FROM public.sessions WHERE expires_at < NOW() $$
-- );

-- Manual one-shot:
-- DELETE FROM public.sessions WHERE expires_at < NOW();
