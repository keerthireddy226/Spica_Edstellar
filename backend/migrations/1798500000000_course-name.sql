-- Up Migration
-- The course is "English 4 Skills Essentials" (no "Spica" in front) on certificates already issued.
UPDATE certificates SET course_name = 'English 4 Skills Essentials' WHERE course_name IN ('Spica English 4 Skills Essentials', 'Versant English 4 Skills preparation');

-- Down Migration
SELECT 1;
