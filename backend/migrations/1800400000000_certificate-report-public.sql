-- Up Migration
-- A result certificate's check page can link to the full score report
-- (launch plan, product gap 10.28). The learner can turn the link off.
ALTER TABLE certificates ADD COLUMN report_public boolean NOT NULL DEFAULT true;

-- Down Migration
ALTER TABLE certificates DROP COLUMN report_public;
