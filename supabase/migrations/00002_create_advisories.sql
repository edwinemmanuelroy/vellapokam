-- =============================================================================
-- Kerala Flood Emergency Dashboard — advisories table
-- =============================================================================

CREATE TYPE advisory_type AS ENUM ('critical', 'warning', 'info');

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
  USING (auth.role() = 'authenticated');

-- Populate seed data for advisories
INSERT INTO advisories (title, message, type)
VALUES
  ('KSDMA RED ALERT', 'Red Alert issued for Wayanad & Idukki. Heavy to extremely heavy rainfall expected over the next 24 hours.', 'critical'),
  ('Cheruthoni Dam Status', 'Idukki Cheruthoni Dam shutters raised by 50cm. Residents near Periyar banks advised to shift to relief camps.', 'critical'),
  ('Helpline Advisory', 'District helpline 1077 and State control room are active 24/7. Dial 112 for police dispatch.', 'info'),
  ('Coastal Surge Warning', 'High tidal waves alert for Alappuzha & Kollam coastlines. Fishermen advised not to venture into sea.', 'warning');
