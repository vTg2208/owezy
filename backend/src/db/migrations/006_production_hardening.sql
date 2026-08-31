CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

ALTER TABLE trips
  ADD COLUMN currency char(3);

DO $$
DECLARE
  mixed_trip_id text;
BEGIN
  SELECT currencies.trip_id
    INTO mixed_trip_id
    FROM (
      SELECT trip_id, count(DISTINCT currency) AS currency_count
        FROM (
          SELECT trip_id, currency FROM expenses
          UNION ALL
          SELECT trip_id, currency FROM payments
        ) financial_currencies
       GROUP BY trip_id
    ) currencies
   WHERE currencies.currency_count > 1
   ORDER BY currencies.trip_id
   LIMIT 1;

  IF mixed_trip_id IS NOT NULL THEN
    RAISE EXCEPTION 'trip_currency_mismatch: trip % has mixed financial currencies', mixed_trip_id;
  END IF;
END;
$$;

UPDATE trips t
   SET currency = COALESCE((
     SELECT min(financial_currencies.currency)
       FROM (
         SELECT currency FROM expenses WHERE trip_id = t.id
         UNION ALL
         SELECT currency FROM payments WHERE trip_id = t.id
       ) financial_currencies
   ), 'INR');

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

ALTER TABLE trips
  ALTER COLUMN currency SET DEFAULT 'INR',
  ALTER COLUMN currency SET NOT NULL,
  ADD CONSTRAINT trips_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT trips_id_currency_key UNIQUE (id, currency);

CREATE OR REPLACE FUNCTION prevent_trip_currency_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'trip currency is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trips_prevent_currency_change
BEFORE UPDATE OF currency ON trips
FOR EACH ROW EXECUTE FUNCTION prevent_trip_currency_change();

ALTER TABLE expenses
  ADD COLUMN expense_key text,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN voided_at timestamptz,
  ADD CONSTRAINT expenses_version_check CHECK (version > 0),
  ADD CONSTRAINT expenses_status_check CHECK (status IN ('active', 'voided')),
  ADD CONSTRAINT expenses_voided_lifecycle_check CHECK (
    (status = 'active' AND voided_at IS NULL)
    OR (status = 'voided' AND voided_at IS NOT NULL)
  );

UPDATE expenses
   SET expense_key = id
 WHERE expense_key IS NULL;

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

ALTER TABLE expenses
  ALTER COLUMN expense_key SET NOT NULL,
  ADD CONSTRAINT expenses_expense_key_check CHECK (btrim(expense_key) <> ''),
  ADD CONSTRAINT expenses_trip_currency_fkey
    FOREIGN KEY (trip_id, currency)
    REFERENCES trips (id, currency)
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX expenses_trip_expense_key_version_idx
  ON expenses (trip_id, expense_key, version);

CREATE UNIQUE INDEX expenses_one_active_version_per_key_idx
  ON expenses (trip_id, expense_key)
  WHERE status = 'active';

ALTER TABLE payments
  DROP CONSTRAINT payments_status_check,
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN confirmed_by_membership_id text,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN rejected_by_membership_id text,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by_membership_id text;

UPDATE payments
   SET confirmed_at = paid_at,
       confirmed_by_membership_id = payee_membership_id
 WHERE status = 'confirmed';

UPDATE payments
   SET cancelled_at = paid_at,
       cancelled_by_membership_id = payer_membership_id
 WHERE status = 'cancelled';

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

ALTER TABLE payments
  ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
  ADD CONSTRAINT payments_lifecycle_check
    CHECK (
      (status = 'pending'
        AND confirmed_at IS NULL AND confirmed_by_membership_id IS NULL
        AND rejected_at IS NULL AND rejected_by_membership_id IS NULL
        AND cancelled_at IS NULL AND cancelled_by_membership_id IS NULL)
      OR
      (status = 'confirmed'
        AND confirmed_at IS NOT NULL AND confirmed_by_membership_id IS NOT NULL
        AND rejected_at IS NULL AND rejected_by_membership_id IS NULL
        AND cancelled_at IS NULL AND cancelled_by_membership_id IS NULL)
      OR
      (status = 'rejected'
        AND confirmed_at IS NULL AND confirmed_by_membership_id IS NULL
        AND rejected_at IS NOT NULL AND rejected_by_membership_id IS NOT NULL
        AND cancelled_at IS NULL AND cancelled_by_membership_id IS NULL)
      OR
      (status = 'cancelled'
        AND confirmed_at IS NULL AND confirmed_by_membership_id IS NULL
        AND rejected_at IS NULL AND rejected_by_membership_id IS NULL
        AND cancelled_at IS NOT NULL AND cancelled_by_membership_id IS NOT NULL)
    ),
  ADD CONSTRAINT payments_trip_currency_fkey
    FOREIGN KEY (trip_id, currency)
    REFERENCES trips (id, currency)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT payments_confirmed_by_membership_fkey
    FOREIGN KEY (trip_id, confirmed_by_membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT payments_rejected_by_membership_fkey
    FOREIGN KEY (trip_id, rejected_by_membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT payments_cancelled_by_membership_fkey
    FOREIGN KEY (trip_id, cancelled_by_membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX payments_trip_status_created_at_idx
  ON payments (trip_id, status, created_at DESC);

ALTER TABLE trip_invites
  ADD COLUMN token_hash text;

UPDATE trip_invites
   SET token_hash = encode(public.digest('legacy-invite:' || id, 'sha256'), 'hex')
 WHERE token_hash IS NULL;

ALTER TABLE trip_invites
  ALTER COLUMN token_hash SET NOT NULL,
  ADD CONSTRAINT trip_invites_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX trip_invites_token_hash_idx
  ON trip_invites (token_hash);

CREATE INDEX trip_invites_pending_expiry_idx
  ON trip_invites (expires_at)
  WHERE status = 'pending';

CREATE TABLE idempotency_records (
  id text PRIMARY KEY,
  actor_membership_id text NOT NULL,
  operation text NOT NULL CHECK (btrim(operation) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  response_body jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_records_completion_check CHECK (
    (completed_at IS NULL AND response_status IS NULL AND response_body IS NULL)
    OR (completed_at IS NOT NULL AND response_status IS NOT NULL AND response_body IS NOT NULL)
  ),
  FOREIGN KEY (actor_membership_id)
    REFERENCES trip_memberships (id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX idempotency_records_actor_operation_key_idx
  ON idempotency_records (actor_membership_id, operation, idempotency_key);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  actor_membership_id text NOT NULL,
  action text NOT NULL CHECK (btrim(action) <> ''),
  entity_type text NOT NULL CHECK (btrim(entity_type) <> ''),
  entity_id text NOT NULL CHECK (btrim(entity_id) <> ''),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (actor_membership_id)
    REFERENCES trip_memberships (id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX audit_events_entity_created_at_idx
  ON audit_events (entity_type, entity_id, created_at DESC);

CREATE INDEX audit_events_actor_created_at_idx
  ON audit_events (actor_membership_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_expense_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expenses are append-only';
  END IF;

  IF OLD.status = 'active'
     AND NEW.status = 'voided'
     AND NEW.voided_at IS NOT NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.trip_id IS NOT DISTINCT FROM OLD.trip_id
     AND NEW.paid_by_membership_id IS NOT DISTINCT FROM OLD.paid_by_membership_id
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.total_minor IS NOT DISTINCT FROM OLD.total_minor
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.split_type IS NOT DISTINCT FROM OLD.split_type
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.expense_key IS NOT DISTINCT FROM OLD.expense_key
     AND NEW.version IS NOT DISTINCT FROM OLD.version
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'expenses are append-only';
END;
$$;

CREATE TRIGGER expenses_enforce_append_only
BEFORE UPDATE OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION enforce_expense_append_only();

CREATE OR REPLACE FUNCTION prevent_expense_split_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'expense splits are append-only';
END;
$$;

CREATE TRIGGER expense_splits_enforce_append_only
BEFORE UPDATE OR DELETE ON expense_splits
FOR EACH ROW EXECUTE FUNCTION prevent_expense_split_rewrite();

CREATE OR REPLACE FUNCTION enforce_payment_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments are append-only';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
     OR NEW.payer_membership_id IS DISTINCT FROM OLD.payer_membership_id
     OR NEW.payee_membership_id IS DISTINCT FROM OLD.payee_membership_id
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'payments may only transition from pending once';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'payment state is terminal';
  END IF;

  IF NEW.status NOT IN ('confirmed', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'payments may only transition from pending once';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_enforce_transition
BEFORE UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION enforce_payment_transition();

CREATE OR REPLACE FUNCTION prevent_audit_event_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are immutable';
END;
$$;

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_rewrite();

CREATE OR REPLACE FUNCTION enforce_idempotency_record_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'idempotency records cannot be deleted';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.actor_membership_id IS DISTINCT FROM OLD.actor_membership_id
     OR NEW.operation IS DISTINCT FROM OLD.operation
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'idempotency responses are immutable';
  END IF;

  IF OLD.completed_at IS NULL
     AND NEW.completed_at IS NOT NULL
     AND NEW.response_status IS NOT NULL
     AND NEW.response_body IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'idempotency responses are immutable';
END;
$$;

CREATE TRIGGER idempotency_records_enforce_lifecycle
BEFORE UPDATE OR DELETE ON idempotency_records
FOR EACH ROW EXECUTE FUNCTION enforce_idempotency_record_lifecycle();
