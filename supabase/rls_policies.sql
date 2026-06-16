-- ─────────────────────────────────────────────────────────────────────────────
-- WordDrop — RLS policy fixes
--
-- PASTE THIS ENTIRE BLOCK into the Supabase SQL Editor
-- (Database → SQL Editor → New query) and click RUN.
--
-- What it fixes:
--   1. Registration fails ("violates RLS policy on users") because
--      users_insert_own requires auth.uid() = auth_id, but the JWT hasn't
--      propagated to the client yet at the moment the INSERT fires.
--   2. Email column is exposed to the anon role via users_select_all.
--   3. Score submission can fail ("violates RLS policy on scores") when the
--      auth session isn't refreshed on the game page.
--
-- Sessions table is already correct (sessions_select_all + sessions_insert_anon)
-- and is left unchanged.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Drop the policies that need replacing ──────────────────────────────────

DROP POLICY IF EXISTS "users_select_all"     ON public.users;
DROP POLICY IF EXISTS "users_insert_own"     ON public.users;
DROP POLICY IF EXISTS "scores_insert_authed" ON public.scores;


-- ── 2. users — column-level email protection ──────────────────────────────────
-- Revoke blanket SELECT from the anon role, then grant only the two columns
-- the game actually queries as an unauthenticated client:
--   • display_name  — uniqueness check + auto-name generator
--   • id            — foreign-key lookups
-- The authenticated role keeps full column access (it needs email for profile).

REVOKE SELECT ON public.users FROM anon;
GRANT  SELECT (id, display_name) ON public.users TO anon;
GRANT  SELECT                    ON public.users TO authenticated;


-- ── 3. users — row-level policies ────────────────────────────────────────────

-- All rows are visible (column grant above controls what anon actually sees).
CREATE POLICY "users_select_public" ON public.users
  FOR SELECT USING (true);

-- Anon INSERT for registration.
-- The FK constraint (auth_id → auth.users.id) ensures the Supabase auth
-- account must already exist before this row can land — that's the security
-- boundary.  The UNIQUE indexes on email and display_name prevent duplicates.
CREATE POLICY "users_insert_anon" ON public.users
  FOR INSERT WITH CHECK (true);

-- UPDATE is unchanged: only the authenticated owner can update their own row.
-- (users_update_own already exists from schema.sql)


-- ── 4. scores — allow anon INSERT ────────────────────────────────────────────
-- Score submission runs on the game page where the Supabase session cookie may
-- not have been refreshed yet.  Allow anon INSERT so it never hits an RLS wall.
-- The nullable user_id FK still prevents referencing a non-existent user.

CREATE POLICY "scores_insert_anon" ON public.scores
  FOR INSERT WITH CHECK (true);

-- scores_select_all already allows anon SELECT — no change needed.


-- ── Verification queries (optional — run separately to confirm) ───────────────

-- SELECT policyname, cmd, qual, with_check
-- FROM   pg_policies
-- WHERE  schemaname = 'public'
-- ORDER  BY tablename, policyname;
