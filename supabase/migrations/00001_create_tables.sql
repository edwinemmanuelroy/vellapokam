-- =============================================================================
-- Kerala Flood Emergency Dashboard — Initial Schema
-- =============================================================================
-- Run this migration against your Supabase project:
--   1. Go to the SQL Editor in your Supabase dashboard
--   2. Paste this entire file and click "Run"
--
-- Alternatively, use the Supabase CLI:
--   supabase db push
-- =============================================================================

-- Enable UUID generation (safe to call multiple times)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Custom ENUM types
-- ---------------------------------------------------------------------------

CREATE TYPE water_level AS ENUM ('ankle', 'knee', 'waist', 'roof');
CREATE TYPE sos_status  AS ENUM ('pending', 'rescued');

-- ---------------------------------------------------------------------------
-- flood_reports — crowd-sourced flood sightings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS flood_reports (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  TIMESTAMPTZ NOT NULL    DEFAULT now(),
  latitude    FLOAT       NOT NULL,
  longitude   FLOAT       NOT NULL,
  water_level water_level NOT NULL    DEFAULT 'ankle',
  description TEXT        NOT NULL    DEFAULT '',
  image_url   TEXT,
  verified    BOOLEAN     NOT NULL    DEFAULT false
);

-- Index for geospatial-ish queries (sorting by lat/lng)
CREATE INDEX IF NOT EXISTS idx_flood_reports_location
  ON flood_reports (latitude, longitude);

-- Index for chronological feed
CREATE INDEX IF NOT EXISTS idx_flood_reports_created
  ON flood_reports (created_at DESC);

COMMENT ON TABLE flood_reports IS
  'Crowd-sourced flood water-level reports with optional photo evidence.';

-- ---------------------------------------------------------------------------
-- sos_requests — emergency rescue requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sos_requests (
  id           UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL   DEFAULT now(),
  name         TEXT       NOT NULL,
  phone        TEXT       NOT NULL,
  latitude     FLOAT      NOT NULL,
  longitude    FLOAT      NOT NULL,
  people_count INTEGER    NOT NULL    DEFAULT 1,
  needs        TEXT[]     NOT NULL    DEFAULT '{}',
  status       sos_status NOT NULL    DEFAULT 'pending'
);

-- Fast lookup for pending rescues
CREATE INDEX IF NOT EXISTS idx_sos_requests_status
  ON sos_requests (status) WHERE status = 'pending';

-- Chronological ordering
CREATE INDEX IF NOT EXISTS idx_sos_requests_created
  ON sos_requests (created_at DESC);

COMMENT ON TABLE sos_requests IS
  'SOS rescue requests from people trapped by floodwater.';

-- ---------------------------------------------------------------------------
-- Row-Level Security (RLS)
-- ---------------------------------------------------------------------------
-- Enable RLS on both tables. The policies below allow:
--   • Anyone (anon) can INSERT new reports/requests.
--   • Anyone can SELECT (read) all rows.
--   • Only authenticated/service-role users can UPDATE or DELETE.
-- Adjust to your security requirements.

ALTER TABLE flood_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE sos_requests  ENABLE ROW LEVEL SECURITY;

-- flood_reports policies
CREATE POLICY "Anyone can read flood reports"
  ON flood_reports FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create flood reports"
  ON flood_reports FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Only authenticated users can update flood reports"
  ON flood_reports FOR UPDATE
  USING (auth.role() = 'authenticated');

-- sos_requests policies
CREATE POLICY "Anyone can read SOS requests"
  ON sos_requests FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create SOS requests"
  ON sos_requests FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Only authenticated users can update SOS requests"
  ON sos_requests FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Enable Realtime
-- ---------------------------------------------------------------------------
-- Uncomment the lines below if you want Supabase Realtime broadcasts
-- for these tables (requires Realtime to be enabled in your project).

-- ALTER PUBLICATION supabase_realtime ADD TABLE flood_reports;
-- ALTER PUBLICATION supabase_realtime ADD TABLE sos_requests;

-- ---------------------------------------------------------------------------
-- Storage Setup
-- ---------------------------------------------------------------------------
-- Creates the 'flood-photos' bucket and defines public read/write access policies.

INSERT INTO storage.buckets (id, name, public)
VALUES ('flood-photos', 'flood-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Allows anyone to upload images to the flood-photos bucket
CREATE POLICY "Anyone can upload flood photos"
  ON storage.objects FOR INSERT
  TO public
  WITH CHECK (bucket_id = 'flood-photos');

-- Allows anyone to view images in the flood-photos bucket
CREATE POLICY "Anyone can read flood photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'flood-photos');

