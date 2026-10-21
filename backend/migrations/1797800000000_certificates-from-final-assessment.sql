-- Up Migration
-- Certificates now come only from the final assessment. Course (completion)
-- certificate requests still waiting are closed; certificates already issued
-- stay valid.
UPDATE certificate_requests SET status = 'declined', decided_at = now(),
  decision_note = 'Certificates now come from your final assessment: a real test with a certificate, in My tests.'
WHERE status = 'pending';

-- A level test checks one level; it gives no certificate now.
UPDATE products SET name = 'Level test (A1–C2)', description = 'One test at the chosen level, to check where you are. No certificate.' WHERE id = 'level_test';

-- Down Migration
UPDATE products SET name = 'Level certificate test (A1–C2)' WHERE id = 'level_test';
