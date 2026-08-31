CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE trips
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'INR',
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
   SET token_hash = encode(digest('legacy-invite:' || id, 'sha256'), 'hex')
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
  response_status integer NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
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
