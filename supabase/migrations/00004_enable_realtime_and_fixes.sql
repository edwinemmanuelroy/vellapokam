-- =============================================================================
-- Kerala Flood Dashboard — Enable Realtime + Fix Policies
-- Run this AFTER migrations 00001, 00002, 00003
-- =============================================================================

-- Enable Supabase Realtime publications for live updates.
-- Guarded: re-adding a table that is already in the publication raises
-- duplicate_object and would abort the whole migration.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE flood_reports;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sos_requests;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE advisories;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
