-- Up Migration
-- Assessment builder: tests built by Edstellar staff from questions already
-- in the bank (modules, practice and mock sets, placement, AI-written). A
-- question can be in any number of forms; nothing is moved or copied.

CREATE TABLE forms (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_type_id     text NOT NULL REFERENCES test_types(id),
  -- The set whose layout (parts, labels) the form follows.
  template_exam_id uuid NOT NULL REFERENCES exams(id),
  purpose          text NOT NULL CHECK (purpose IN ('practice', 'mock')),
  name             text NOT NULL,
  -- Short code shown as the Test ID, e.g. "LB-F003".
  code             text NOT NULL UNIQUE,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 300),
  -- A duration other than the published one: a mock short form shows the
  -- CEFR level but no estimated exam score range.
  short_form       boolean NOT NULL DEFAULT false,
  level_min        text CHECK (level_min IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  level_max        text CHECK (level_max IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  domain           text NOT NULL DEFAULT 'general',
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_forms_live ON forms(test_type_id, purpose) WHERE status = 'published';

CREATE TABLE form_items (
  form_id       uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items(id),
  -- The section (the template's part sort_order) and the order within it.
  sort_order    integer NOT NULL,
  position      integer NOT NULL,
  -- This test's time limit for the question, when it differs from the type's.
  timer_seconds integer,
  PRIMARY KEY (form_id, item_id)
);
CREATE INDEX idx_form_items_item ON form_items(item_id);

-- Down Migration
DROP TABLE IF EXISTS form_items;
DROP TABLE IF EXISTS forms;
