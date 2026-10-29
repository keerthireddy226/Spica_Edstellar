-- Up Migration
-- Office (employee) ID cards as their own ID type.
ALTER TABLE identity_verifications DROP CONSTRAINT IF EXISTS identity_verifications_document_type_check;
ALTER TABLE identity_verifications
  ADD CONSTRAINT identity_verifications_document_type_check CHECK (document_type IN ('office_id', 'passport', 'national_id', 'driving_licence', 'other'));

-- Down Migration
UPDATE identity_verifications SET document_type = 'other' WHERE document_type = 'office_id';
ALTER TABLE identity_verifications DROP CONSTRAINT IF EXISTS identity_verifications_document_type_check;
ALTER TABLE identity_verifications
  ADD CONSTRAINT identity_verifications_document_type_check CHECK (document_type IN ('passport', 'national_id', 'driving_licence', 'other'));
