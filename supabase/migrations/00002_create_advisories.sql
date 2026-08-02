-- =============================================================================
-- Kerala Flood Emergency Dashboard — advisories table
-- =============================================================================

-- Guarded so the migration can be re-run without erroring on an existing type
DO $$
BEGIN
  CREATE TYPE advisory_type AS ENUM ('critical', 'warning', 'info');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS advisories (
  id         UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ   NOT NULL    DEFAULT now(),
  title      TEXT          NOT NULL,
  message    TEXT          NOT NULL,
  type       advisory_type NOT NULL    DEFAULT 'info',
  link       TEXT
);

-- Index for chronological order
CREATE INDEX IF NOT EXISTS idx_advisories_created
  ON advisories (created_at DESC);

-- Enable RLS
ALTER TABLE advisories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read advisories"
  ON advisories FOR SELECT
  USING (true);

CREATE POLICY "Only authenticated users can insert advisories"
  ON advisories FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- No seed data.
-- ---------------------------------------------------------------------------
-- This table previously seeded invented bulletins ("Red Alert issued for
-- Wayanad & Idukki", "Cheruthoni Dam shutters raised by 50cm") attributed to
-- KSDMA and the Irrigation Department. They render in the ticker exactly like
-- genuine advisories, so demo data here is indistinguishable from a real
-- warning. Populate this table only with advisories actually issued by the
-- relevant authority. Migration 00005 removes the previously seeded rows.
