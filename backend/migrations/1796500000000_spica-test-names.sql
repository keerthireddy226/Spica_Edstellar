-- Up Migration
-- Spica certifies levels with its own tests: no third-party exam names.
UPDATE exam_families SET name = 'Spica', publisher = 'Spica' WHERE id = 'versant';
UPDATE test_types SET name = CASE id
  WHEN 'fourSkills' THEN 'English 4 Skills Essentials'
  WHEN 'speakingListening' THEN 'English Speaking & Listening'
  WHEN 'writing' THEN 'English Writing'
  WHEN 'professional' THEN 'Professional English'
  WHEN 'placement' THEN 'English Placement'
  ELSE name END
WHERE family_id = 'versant';
-- Practice sets: "<test> — Set n".
UPDATE exams e SET name = tt.name || ' — ' || substring(e.name FROM 'Set [0-9]+$')
FROM test_types tt WHERE tt.id = e.test_type_id AND tt.family_id = 'versant' AND e.name ~ 'Set [0-9]+$';
UPDATE forms SET name = replace(replace(name, 'Versant ', ''), 'S&L', 'Speaking & Listening') WHERE name ILIKE '%Versant%';
UPDATE products SET name = replace(name, 'English 4-Skills Essentials Test', 'English 4 Skills Essentials') WHERE name LIKE '%4-Skills Essentials Test%';
UPDATE products SET name = replace(replace(replace(replace(name,
  'English Speaking and Listening Test', 'English Speaking & Listening'), 'English Writing Test', 'English Writing'),
  'Professional English Test', 'Professional English'), 'English Placement Test', 'English Placement');
UPDATE products SET description = replace(description, 'mock exam', 'mock test') WHERE description LIKE '%mock exam%';

-- Down Migration
UPDATE exam_families SET name = 'Versant', publisher = 'Pearson' WHERE id = 'versant';
UPDATE test_types SET name = CASE id
  WHEN 'fourSkills' THEN 'English 4-Skills Essentials Test'
  WHEN 'speakingListening' THEN 'English Speaking and Listening Test'
  WHEN 'writing' THEN 'English Writing Test'
  WHEN 'professional' THEN 'Professional English Test'
  WHEN 'placement' THEN 'English Placement Test'
  ELSE name END
WHERE family_id = 'versant';
