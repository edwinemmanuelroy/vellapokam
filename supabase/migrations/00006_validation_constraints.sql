-- =============================================================================
-- Kerala Flood Dashboard — Server-side validation constraints
-- Run this AFTER migrations 00001–00005
-- =============================================================================
-- The UI validates these bounds, but the anon key allows direct PostgREST
-- inserts that skip the UI entirely. Without database-level checks, anyone can
-- insert reports at Null Island, a 2GB description, or an SOS for a million
-- people. Each constraint below mirrors (or bounds) what the client enforces.
--
-- All ADD CONSTRAINT statements are guarded so the migration is re-runnable.

-- ---------------------------------------------------------------------------
-- flood_reports
-- ---------------------------------------------------------------------------

-- Kerala bounding box with margin. Reports outside the state are not
-- actionable by Kerala responders and are almost certainly junk or hostile.
DO $$
BEGIN
  ALTER TABLE flood_reports
    ADD CONSTRAINT flood_reports_lat_in_kerala
    CHECK (latitude BETWEEN 8.0 AND 13.0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE flood_reports
    ADD CONSTRAINT flood_reports_lng_in_kerala
    CHECK (longitude BETWEEN 74.5 AND 77.6);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE flood_reports
    ADD CONSTRAINT flood_reports_description_length
    CHECK (char_length(description) <= 500);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- sos_requests
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ALTER TABLE sos_requests
    ADD CONSTRAINT sos_requests_lat_in_kerala
    CHECK (latitude BETWEEN 8.0 AND 13.0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE sos_requests
    ADD CONSTRAINT sos_requests_lng_in_kerala
    CHECK (longitude BETWEEN 74.5 AND 77.6);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE sos_requests
    ADD CONSTRAINT sos_requests_people_count_sane
    CHECK (people_count BETWEEN 1 AND 500);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE sos_requests
    ADD CONSTRAINT sos_requests_name_length
    CHECK (char_length(name) BETWEEN 1 AND 80);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Loose telephone shape: optional +, then digits with spaces/dashes/parens,
-- 7–20 chars total. The UI enforces the stricter Indian-mobile pattern; this
-- guard only blocks garbage, not international formats.
DO $$
BEGIN
  ALTER TABLE sos_requests
    ADD CONSTRAINT sos_requests_phone_shape
    CHECK (phone ~ '^\+?[0-9][0-9 ()\-]{5,18}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE sos_requests
    ADD CONSTRAINT sos_requests_needs_count
    CHECK (cardinality(needs) <= 10);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- advisories
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ALTER TABLE advisories
    ADD CONSTRAINT advisories_title_length
    CHECK (char_length(title) BETWEEN 1 AND 120);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE advisories
    ADD CONSTRAINT advisories_message_length
    CHECK (char_length(message) BETWEEN 1 AND 1000);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
