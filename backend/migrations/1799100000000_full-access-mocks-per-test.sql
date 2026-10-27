-- Up Migration
-- Full access (individual Plus): the monthly mock limit is for each test type,
-- not shared across all of them. 2 mocks a month in every test.
UPDATE plan_quotas SET extras = coalesce(extras, '{}'::jsonb) || '{"mocksPerTestType": true}'::jsonb, updated_at = now()
WHERE segment = 'individual' AND tier = 'plus';

-- Down Migration
UPDATE plan_quotas SET extras = extras - 'mocksPerTestType', updated_at = now()
WHERE segment = 'individual' AND tier = 'plus';
