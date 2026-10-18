-- Up Migration
-- Versant only for now (2026-10-18): LanguageCert is hidden from learners,
-- organizations and staff screens. Its questions, recordings and past results
-- stay; switch it back on by setting active = true.
UPDATE exam_families SET active = false WHERE id = 'languagecert';

-- Down Migration
UPDATE exam_families SET active = true WHERE id = 'languagecert';
