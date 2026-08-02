-- =============================================================================
-- Kerala Flood Dashboard — Security hardening
-- Run this AFTER migrations 00001–00004, and BEFORE 00008.
-- =============================================================================
-- ⚠ DO NOT RE-RUN THIS FILE ONCE 00008 HAS BEEN APPLIED.
-- There is no migration-tracking table — files are pasted into the SQL editor
-- by hand — so re-running this would restore `GRANT UPDATE (status) TO anon`
-- and the permissive policy below, silently reopening the hole 00008 closes
-- (any anonymous visitor able to close, and reopen, a stranger's SOS).
-- If you must re-run it, run 00008 again immediately afterwards.
--
-- Also note: the `WITH CHECK (status IN ('pending','rescued'))` written below
-- is a NO-OP — sos_status contains only those two values, so it permits every
-- legal value. The column GRANT is the only real control here, and 00008 is
-- what actually restricts the public.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Restrict what the public may change on sos_requests
-- ---------------------------------------------------------------------------
-- Migration 00003 opened UPDATE to everyone so responders could mark a request
-- "rescued". But an RLS policy is row-level only: `USING (true)` also let any
-- anonymous visitor rewrite a trapped person's name, phone number and GPS
-- coordinates — i.e. silently redirect a rescue team away from them.
--
-- Column-level privileges are the missing half. RLS decides *which rows*, the
-- GRANT decides *which columns*.

REVOKE UPDATE ON sos_requests FROM anon;
GRANT  UPDATE (status) ON sos_requests TO anon;

-- Keep the row-level policy, now narrowed to the pending -> rescued transition.
DROP POLICY IF EXISTS "Anyone can update SOS requests status" ON sos_requests;

CREATE POLICY "Anyone can update SOS request status"
  ON sos_requests FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (status IN ('pending', 'rescued'));

-- REMAINING RISK (needs a product decision, not just SQL): with no auth, any
-- visitor can still mark someone else's SOS as rescued and remove them from the
-- responder queue. Closing that properly means authenticating responders and
-- restricting UPDATE to them:
--
--   REVOKE UPDATE ON sos_requests FROM anon;
--   CREATE POLICY "Responders can update SOS status"
--     ON sos_requests FOR UPDATE TO authenticated
--     USING (true) WITH CHECK (status IN ('pending', 'rescued'));

-- ---------------------------------------------------------------------------
-- 2. Constrain the public photo bucket
-- ---------------------------------------------------------------------------
-- "Anyone can upload flood photos" has no type or size ceiling, so the bucket
-- doubles as free public file hosting for arbitrary payloads.

UPDATE storage.buckets
SET
  file_size_limit    = 5242880, -- 5MB; the client compresses to ~450KB
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
WHERE id = 'flood-photos';

-- Uploads are confined to the reports/ prefix the app actually writes to.
DROP POLICY IF EXISTS "Anyone can upload flood photos" ON storage.objects;

CREATE POLICY "Anyone can upload flood photos"
  ON storage.objects FOR INSERT
  TO public
  WITH CHECK (
    bucket_id = 'flood-photos'
    AND (storage.foldername(name))[1] = 'reports'
  );

-- ---------------------------------------------------------------------------
-- 3. Remove fabricated seed advisories
-- ---------------------------------------------------------------------------
-- Migration 00002 inserted invented bulletins attributed to KSDMA and the
-- Irrigation Department. They display identically to genuine advisories in the
-- ticker, so a visitor cannot tell demo text from a real warning.

DELETE FROM advisories
WHERE title IN (
  'KSDMA RED ALERT',
  'Cheruthoni Dam Status',
  'Helpline Advisory',
  'Coastal Surge Warning'
);
