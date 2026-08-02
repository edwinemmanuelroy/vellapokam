-- =============================================================================
-- Kerala Flood Dashboard — Rescue verification + proximity push notifications
-- Run this AFTER migrations 00001–00007
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rescue verification: the public reports, an operator confirms
-- ---------------------------------------------------------------------------
-- Until now any anonymous visitor could set status directly. Migration 00005
-- intended to constrain that with `WITH CHECK (status IN ('pending','rescued'))`,
-- but sos_status contains ONLY those two values — the check permitted every
-- legal value and constrained nothing. Combined with `USING (true)`, anon could
-- close any stranger's SOS *and* reopen an already-rescued one.
--
-- The fix: anon loses the ability to write `status` at all. A public "rescued"
-- tap now only stamps `rescue_reported_at`; the request stays in the queue,
-- flagged, until an operator confirms it. A malicious click can no longer hide
-- a trapped family.
--
-- Implemented with a column rather than a new enum value deliberately:
-- `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds
-- it, and revoking the whole `status` column from anon is a stronger guarantee
-- than any WITH CHECK expression.

ALTER TABLE sos_requests ADD COLUMN IF NOT EXISTS rescue_reported_at  TIMESTAMPTZ;
ALTER TABLE sos_requests ADD COLUMN IF NOT EXISTS rescue_reported_note TEXT;

DO $$
BEGIN
  ALTER TABLE sos_requests
    ADD CONSTRAINT sos_requests_rescue_note_length
    CHECK (rescue_reported_note IS NULL OR char_length(rescue_reported_note) <= 200);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Operators triage flagged requests first; partial index keeps that cheap.
CREATE INDEX IF NOT EXISTS idx_sos_requests_rescue_reported
  ON sos_requests (rescue_reported_at DESC)
  WHERE rescue_reported_at IS NOT NULL;

-- Drop the status write from anon entirely, then grant back only the flag.
--
-- Ordering is load-bearing. A table-level REVOKE also drops the matching
-- column privileges ("When revoking privileges on a table, the corresponding
-- column privileges (if any) are automatically revoked on each column of the
-- table, as well." — Postgres REVOKE reference), which is what clears the
-- `GRANT UPDATE (status)` that migration 00005 left in pg_attribute.attacl.
-- Running the GRANT first would therefore wipe the new column grant.
--
-- Only `rescue_reported_at` is granted. `rescue_reported_note` stays
-- ungranted until the UI actually writes it: notes are world-readable
-- (SELECT is public) and broadcast over realtime, so granting it now would
-- hand every anonymous visitor a 200-character broadcast channel attached to
-- someone's emergency.
REVOKE UPDATE ON sos_requests FROM anon;
GRANT  UPDATE (rescue_reported_at) ON sos_requests TO anon;

DROP POLICY IF EXISTS "Anyone can update SOS request status" ON sos_requests;
DROP POLICY IF EXISTS "Public may flag a rescue for confirmation" ON sos_requests;

-- The flag is WRITE-ONCE for the public. `rescue_reported_at IS NULL` in
-- USING is what makes it so, and it closes two abuses that the column grant
-- alone does not:
--   * clearing someone else's flag (SET rescue_reported_at = NULL), which
--     would quietly drop a request out of the operator's confirmation queue;
--   * mass-flagging every open SOS in one unqualified UPDATE, which would
--     drown the triage signal even though no request is actually hidden.
-- Only an operator can clear the flag, and doing so legitimately re-opens the
-- row for reporting again.
--
-- WITH CHECK is redundant while the column grant holds (anon cannot move
-- `status`, so the post-image matches the pre-image) but is kept as a second,
-- independent barrier if privileges are ever changed.
CREATE POLICY "Public may flag a rescue for confirmation"
  ON sos_requests FOR UPDATE
  TO anon
  USING (status = 'pending' AND rescue_reported_at IS NULL)
  WITH CHECK (status = 'pending');

-- ---------------------------------------------------------------------------
-- 2. push_subscriptions — devices opted in to proximity alerts
-- ---------------------------------------------------------------------------
-- Locations are stored COARSE (rounded to ~1.1km by the API route before
-- insert). A 25km alert radius does not need street-level accuracy, and
-- keeping exact coordinates of everyone who enables alerts would build a
-- needless tracking database.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  endpoint     TEXT        NOT NULL UNIQUE,
  p256dh       TEXT        NOT NULL,
  auth         TEXT        NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  radius_km    INTEGER     NOT NULL DEFAULT 25,
  district     TEXT,
  wants_sos    BOOLEAN     NOT NULL DEFAULT true,
  wants_alerts BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE push_subscriptions
    ADD CONSTRAINT push_subscriptions_radius_sane
    CHECK (radius_km BETWEEN 1 AND 100);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE push_subscriptions
    ADD CONSTRAINT push_subscriptions_coords_in_kerala
    CHECK (lat BETWEEN 8.0 AND 13.0 AND lng BETWEEN 74.5 AND 77.6);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_bbox
  ON push_subscriptions (lat, lng);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_district
  ON push_subscriptions (district);

-- RLS on with NO policies for anon/authenticated: this table is reachable only
-- through the service-role key used by the /api/push/* routes. Subscriber
-- locations must never be publicly readable — unlike sos_requests, which is
-- public by design, this is a list of where private individuals are.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON push_subscriptions FROM anon, authenticated;
-- Granted explicitly rather than inherited from Supabase's default privileges.
-- BYPASSRLS lets service_role skip policies but confers no table privileges of
-- its own, so without this the /api/push/* routes would fail with "permission
-- denied" if those defaults were ever tightened.
GRANT ALL ON push_subscriptions TO service_role;

COMMENT ON TABLE push_subscriptions IS
  'Web Push endpoints opted in to proximity SOS alerts. Coarse locations only. Service-role access exclusively.';

-- ---------------------------------------------------------------------------
-- 3. pushed_alerts — dedupe for official (SACHET) alert pushes
-- ---------------------------------------------------------------------------
-- The alert sweep runs on a schedule against a feed that keeps returning the
-- same active alerts. Without this, every sweep would re-notify everyone.

CREATE TABLE IF NOT EXISTS pushed_alerts (
  alert_id   TEXT        PRIMARY KEY,
  severity   TEXT,
  pushed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pushed_alerts_pushed_at
  ON pushed_alerts (pushed_at DESC);

ALTER TABLE pushed_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pushed_alerts FROM anon, authenticated;
GRANT ALL ON pushed_alerts TO service_role;

COMMENT ON TABLE pushed_alerts IS
  'Official alert ids already pushed, so a repeating feed is not re-notified.';

-- ---------------------------------------------------------------------------
-- 4. Realtime
-- ---------------------------------------------------------------------------
-- Neither new table joins the realtime publication: nothing in the UI
-- subscribes to them, and broadcasting subscriber rows would leak locations.
