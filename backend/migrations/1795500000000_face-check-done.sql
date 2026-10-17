-- Up Migration
-- Staff can mark a person's face check as done (for testing accounts): they
-- are not asked to enroll or verify their face until it's switched back.
ALTER TABLE users ADD COLUMN face_check_done boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE users DROP COLUMN face_check_done;
