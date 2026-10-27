-- Up Migration
-- Face checks for everyone again (user decision, 27 Oct 2026): no account
-- skips the face enrolment, the face check before each test and Practice
-- Module set, or the random re-checks against the enrolled face. Accounts
-- were marked done for testing on 17 Oct.
UPDATE users SET face_check_done = false WHERE face_check_done;

-- Down Migration
-- Which accounts were marked done isn't kept; nothing to undo.
