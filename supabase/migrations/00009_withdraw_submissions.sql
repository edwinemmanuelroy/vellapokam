-- =============================================================================
-- Kerala Flood Dashboard — Let people withdraw their own submissions
-- Run this AFTER migrations 00001–00008
-- =============================================================================
-- Anyone can post an SOS (name, phone, GPS) or a flood report (photo, GPS) with
-- no account, and until now nothing could ever be taken down: before this file
-- the only FOR DELETE policy in the whole schema was on `advisories`. Someone
-- who posted their phone number by mistake had no route at all.
--
-- This grants that route WITHOUT introducing auth for the public, using a
-- capability token: the posting device keeps a 256-bit secret, the row keeps
-- only its SHA-256. Presenting the token is what proves authorship.
--
-- ⚠ NOTE FOR FUTURE EDITORS: this migration deliberately adds **no DELETE
-- policy for anon**. Migration 00008 removed the public's ability to hide an
-- SOS on purpose ("a malicious click can no longer hide a trapped family"), and
-- that stays true here — removal happens only inside the SECURITY DEFINER
-- function below, which checks the token first. Do not "helpfully" add
-- `CREATE POLICY ... FOR DELETE TO anon`; it would reopen exactly that hole.

-- ---------------------------------------------------------------------------
-- 1. The ownership secret
-- ---------------------------------------------------------------------------
-- Only the HASH is stored. SELECT on both tables is `USING (true)` and both are
-- in the supabase_realtime publication, so every column of every row is
-- world-readable and broadcast to every connected client. A plaintext token
-- here would let any visitor withdraw anything; a SHA-256 over 256 bits of
-- entropy leaks only "this row has a token".
--
-- Do NOT `REVOKE SELECT` on these columns to hide them. The dashboard and the
-- ops console both call `.select("*")`, which expands to every column — a
-- column-level revoke would break every read with "permission denied".

ALTER TABLE sos_requests  ADD COLUMN IF NOT EXISTS delete_token_hash TEXT;
ALTER TABLE flood_reports ADD COLUMN IF NOT EXISTS delete_token_hash TEXT;

DO $$
BEGIN
  ALTER TABLE sos_requests
    ADD CONSTRAINT sos_requests_delete_token_hash_shape
    CHECK (delete_token_hash IS NULL OR char_length(delete_token_hash) = 64);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE flood_reports
    ADD CONSTRAINT flood_reports_delete_token_hash_shape
    CHECK (delete_token_hash IS NULL OR char_length(delete_token_hash) = 64);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- The hash is written in the same INSERT as the row, so ownership is atomic
-- with creation — there is no window in which a row exists unclaimed.
--
-- These are column GRANTs on INSERT only. Note the hazard 00008 documents: a
-- table-level `REVOKE ... ON sos_requests FROM anon` also clears column
-- privileges, so re-running an earlier migration after this one would silently
-- drop these grants and every new submission would arrive unclaimable.
GRANT INSERT (delete_token_hash) ON sos_requests  TO anon;
GRANT INSERT (delete_token_hash) ON flood_reports TO anon;

-- ---------------------------------------------------------------------------
-- 2. The archive
-- ---------------------------------------------------------------------------
-- "Withdraw" keeps the record for operators but really removes the row from the
-- public tables. That is not just a privacy preference — it is what makes
-- withdrawal PROPAGATE.
--
-- The obvious soft delete (a `withdrawn_at` flag plus a narrowed SELECT policy)
-- does not work here. Supabase Realtime evaluates RLS against the NEW record on
-- an UPDATE, so the moment a row is hidden from anon the change stops being
-- delivered — every other open dashboard would keep rendering that SOS card,
-- and would not self-correct, because the fallback poll only runs while
-- realtime is DOWN and the client's merge keeps local-only rows. A responder
-- could be dispatched to a request the person already withdrew.
--
-- A real DELETE fires a realtime DELETE event that every dashboard already
-- handles, so the card disappears everywhere within a second.

CREATE TABLE IF NOT EXISTS withdrawn_submissions (
  id           UUID        PRIMARY KEY,   -- the original row's id
  kind         TEXT        NOT NULL CHECK (kind IN ('sos', 'flood')),
  withdrawn_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_by TEXT        NOT NULL CHECK (withdrawn_by IN ('author', 'operator')),
  payload      JSONB       NOT NULL       -- the whole original row, hash stripped
);

CREATE INDEX IF NOT EXISTS idx_withdrawn_submissions_at
  ON withdrawn_submissions (withdrawn_at DESC);

ALTER TABLE withdrawn_submissions ENABLE ROW LEVEL SECURITY;

-- RLS on with no anon policy — the same posture as push_subscriptions. This
-- table holds the names, phone numbers and coordinates of people who asked to
-- be taken off a public page; it must never become publicly readable, and it
-- deliberately does NOT join the realtime publication.
DROP POLICY IF EXISTS "Operators can read withdrawn submissions" ON withdrawn_submissions;
CREATE POLICY "Operators can read withdrawn submissions"
  ON withdrawn_submissions FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON withdrawn_submissions FROM anon;
GRANT  ALL ON withdrawn_submissions TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The withdrawal function
-- ---------------------------------------------------------------------------
-- One function, two callers:
--   * the author, proving it with the token their device holds;
--   * an operator, proving it with a Supabase Auth session.
--
-- The operator path is the safety valve for the failure mode this design cannot
-- avoid: with no accounts, clearing site data loses the token forever, and
-- without a human fallback there would be no way to take a phone number down.
--
-- SECURITY DEFINER is what lets anon delete a row it has no DELETE policy for.
-- `SET search_path` is mandatory hardening — without it a caller could shadow
-- the table names with objects in a schema they control.
--
-- sha256() is core in Postgres 11+, so pgcrypto is not needed (only uuid-ossp
-- is enabled).

CREATE OR REPLACE FUNCTION public.withdraw_submission(
  p_kind  TEXT,
  p_id    UUID,
  p_token TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorised BOOLEAN := false;
  v_by         TEXT;
  v_stored     TEXT;
  v_row        JSONB;
BEGIN
  IF p_kind NOT IN ('sos', 'flood') THEN
    RETURN false;
  END IF;

  IF auth.role() = 'authenticated' THEN
    v_authorised := true;
    v_by := 'operator';
  ELSIF p_token IS NOT NULL AND char_length(p_token) BETWEEN 16 AND 200 THEN
    IF p_kind = 'sos' THEN
      SELECT delete_token_hash INTO v_stored FROM sos_requests  WHERE id = p_id;
    ELSE
      SELECT delete_token_hash INTO v_stored FROM flood_reports WHERE id = p_id;
    END IF;

    -- A row with no hash (posted before this migration) can never be withdrawn
    -- by token — only by an operator.
    IF v_stored IS NOT NULL
       AND v_stored = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    THEN
      v_authorised := true;
      v_by := 'author';
    END IF;
  END IF;

  -- Deliberately indistinguishable from "no such row": the caller learns
  -- nothing about which ids exist or which hold a token.
  IF NOT v_authorised THEN
    RETURN false;
  END IF;

  IF p_kind = 'sos' THEN
    DELETE FROM sos_requests  WHERE id = p_id RETURNING to_jsonb(sos_requests)  INTO v_row;
  ELSE
    DELETE FROM flood_reports WHERE id = p_id RETURNING to_jsonb(flood_reports) INTO v_row;
  END IF;

  IF v_row IS NULL THEN
    RETURN false;   -- already gone
  END IF;

  -- The hash is stripped: it is spent, and archiving it would keep a live
  -- credential for a row that no longer exists.
  INSERT INTO withdrawn_submissions (id, kind, withdrawn_by, payload)
  VALUES (p_id, p_kind, v_by, v_row - 'delete_token_hash')
  ON CONFLICT (id) DO NOTHING;

  RETURN true;
END
$$;

-- EXECUTE defaults to PUBLIC on new functions; revoke first, then grant the
-- two roles that should actually have it.
REVOKE EXECUTE ON FUNCTION public.withdraw_submission(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.withdraw_submission(TEXT, UUID, TEXT) TO anon, authenticated;
