-- Up Migration
-- A batch's license allotment is set by the Org Admin only. Managers ask for
-- changes (more, fewer, or returning a learner's unused months) through a
-- request the Org Admin approves or rejects.

CREATE TABLE license_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES batches(id) ON DELETE CASCADE,
  learner_id uuid REFERENCES users(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('increase_allotment', 'decrease_allotment', 'unassign_learner')),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  applied_quantity integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_license_requests_tenant ON license_requests(tenant_id, status, created_at DESC);
CREATE INDEX idx_license_requests_requester ON license_requests(requested_by, created_at DESC);

ALTER TABLE license_events DROP CONSTRAINT license_events_kind_check;
ALTER TABLE license_events ADD CONSTRAINT license_events_kind_check
  CHECK (kind IN ('purchase', 'credit', 'comp', 'assign', 'extend', 'reclaim', 'budget', 'request'));

-- Down Migration
ALTER TABLE license_events DROP CONSTRAINT license_events_kind_check;
ALTER TABLE license_events ADD CONSTRAINT license_events_kind_check
  CHECK (kind IN ('purchase', 'credit', 'comp', 'assign', 'extend', 'reclaim', 'budget'));
DROP TABLE license_requests;
