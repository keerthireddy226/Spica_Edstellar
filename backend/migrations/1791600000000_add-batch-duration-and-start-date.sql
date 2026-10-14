-- Up Migration
-- New batch form asks a couple more questions: how long the batch needs the
-- platform for, and when it starts.

ALTER TABLE batches ADD COLUMN duration_months integer;
ALTER TABLE batches ADD COLUMN start_date date;

-- Down Migration
ALTER TABLE batches DROP COLUMN duration_months;
ALTER TABLE batches DROP COLUMN start_date;
