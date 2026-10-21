-- Up Migration
-- Course certificates without asking: individuals' are issued automatically
-- once eligible; an organization's wait for an Org Admin unless it turns this on.
ALTER TABLE tenants ADD COLUMN certificates_auto boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE tenants DROP COLUMN IF EXISTS certificates_auto;
