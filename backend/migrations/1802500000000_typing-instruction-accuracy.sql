-- Up Migration
-- The Typing task is scored on accuracy only (words right against the
-- passage), but its instruction asked for speed (owner decision 20 Nov 2026:
-- make the instruction match the scoring, defect 4 of the scoring review).
UPDATE item_types
SET instruction_text = 'This section lets you get used to the keyboard and checks how accurately you type. You have 60 seconds to type the passage. Type every word correctly; missing or wrong words lower your score. Check your work before the time is up.'
WHERE id = 'typing';

-- Down Migration
UPDATE item_types
SET instruction_text = 'This section allows you to get used to the keyboard and also measures your typing speed. You will have 60 seconds to type as much as you can. Type quickly and accurately. Keep typing until your time is up.'
WHERE id = 'typing';
