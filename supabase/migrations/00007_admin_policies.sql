-- =============================================================================
-- Kerala Flood Dashboard — Operator (admin portal) policies
-- Run this AFTER migrations 00001–00006
-- =============================================================================
-- The /admin portal signs operators in through Supabase Auth, so their requests
-- run as the `authenticated` role. This migration grants that role the writes
-- the war room needs.
--
-- IMPORTANT operator setup (Supabase Dashboard):
--   1. Authentication → Users → "Add user" — create each operator by email.
--   2. Authentication → Sign In / Up → disable public sign-ups. The app has no
--      sign-up UI, but leaving sign-ups open would let ANYONE mint an
--      `authenticated` session and use every policy below.

-- ---------------------------------------------------------------------------
-- 1. sos_requests: operators can update requests
-- ---------------------------------------------------------------------------
-- Policy history left `authenticated` with NO update policy: 00001 created one,
-- 00003 dropped it in favour of a public policy, and 00005 narrowed that public
-- policy to `anon` only. Under RLS's default-deny, operators therefore could
-- not mark a request rescued at all. Full-row update is intentional here —
-- operators must be able to correct a mistyped phone number or coordinates.

DROP POLICY IF EXISTS "Operators can update SOS requests" ON sos_requests;
CREATE POLICY "Operators can update SOS requests"
  ON sos_requests FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. advisories: operators can edit and unpublish
-- ---------------------------------------------------------------------------
-- 00002 granted INSERT only; an advisory that turns out to be wrong could not
-- be corrected or withdrawn without the service key. Being able to retract a
-- bad advisory quickly matters as much as publishing it.

DROP POLICY IF EXISTS "Operators can update advisories" ON advisories;
CREATE POLICY "Operators can update advisories"
  ON advisories FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Operators can delete advisories" ON advisories;
CREATE POLICY "Operators can delete advisories"
  ON advisories FOR DELETE
  TO authenticated
  USING (true);

-- Note: flood_reports verification needs no change — the authenticated UPDATE
-- policy from 00001 ("Only authenticated users can update flood reports") is
-- still in place.
