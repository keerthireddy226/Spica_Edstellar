-- Up Migration
-- Admin permissions are enforced from now on. Admins created before that
-- had none recorded but could do everything, so they keep full access; the
-- Super Admin can narrow it per Admin.
UPDATE users
SET permissions = '{"manageOrganizations": true, "inviteLearners": true, "viewLearnerInfo": true, "contentReview": true, "scoreReview": true, "viewReports": true}'::jsonb
WHERE role = 'admin' AND (permissions IS NULL OR permissions = '{}'::jsonb);

-- Down Migration
SELECT 1;
