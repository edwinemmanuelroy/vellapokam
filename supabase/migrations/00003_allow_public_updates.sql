-- Allow public updates on sos_requests so anyone using the emergency dashboard can mark a request as 'rescued'
DROP POLICY IF EXISTS "Only authenticated users can update SOS requests" ON sos_requests;

CREATE POLICY "Anyone can update SOS requests status"
  ON sos_requests FOR UPDATE
  USING (true)
  WITH CHECK (true);
