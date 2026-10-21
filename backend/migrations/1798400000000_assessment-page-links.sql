-- Up Migration
-- "My tests" is now "Assessment" at /assessment: notifications already sent point there.
UPDATE notifications SET link = replace(link, '/my-tests', '/assessment') WHERE link LIKE '/my-tests%';

-- Down Migration
UPDATE notifications SET link = replace(link, '/assessment', '/my-tests') WHERE link LIKE '/assessment%';
