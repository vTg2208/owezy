CREATE TABLE users (
  id uuid PRIMARY KEY,
  firebase_uid text NOT NULL UNIQUE CHECK (btrim(firebase_uid) <> ''),
  email text NOT NULL UNIQUE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trips (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  room_code text NOT NULL UNIQUE,
  owner_membership_id text NOT NULL,
  is_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trip_memberships (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'anonymized')),
  left_at timestamptz,
  anonymized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, id),
  UNIQUE (trip_id, user_id),
  CHECK ((status = 'left') = (left_at IS NOT NULL)),
  CHECK (
    (status = 'anonymized' AND anonymized_at IS NOT NULL AND user_id IS NULL)
    OR (status <> 'anonymized' AND anonymized_at IS NULL)
  )
);

CREATE OR REPLACE FUNCTION anonymize_disconnected_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL AND NEW.status <> 'anonymized' THEN
    NEW.status := 'anonymized';
    NEW.anonymized_at := COALESCE(NEW.anonymized_at, now());
    NEW.display_name := 'Former member ' || OLD.id;
    NEW.left_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_anonymize_disconnected_identity
BEFORE UPDATE OF user_id ON trip_memberships
FOR EACH ROW EXECUTE FUNCTION anonymize_disconnected_membership();

CREATE OR REPLACE FUNCTION leave_trip_membership(p_membership_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE trip_memberships
     SET status = 'left', left_at = now()
   WHERE id = p_membership_id AND status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION anonymize_trip_membership(p_membership_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE trip_memberships
     SET user_id = NULL,
         status = 'anonymized',
         left_at = NULL,
         anonymized_at = now(),
         display_name = 'Former member ' || id
   WHERE id = p_membership_id;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_trip_membership_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'trip memberships are historical records and cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER memberships_preserve_history
BEFORE DELETE ON trip_memberships
FOR EACH ROW EXECUTE FUNCTION prevent_trip_membership_deletion();

CREATE UNIQUE INDEX trip_memberships_one_owner_per_trip
  ON trip_memberships (trip_id)
  WHERE role = 'owner';

CREATE UNIQUE INDEX trip_memberships_unique_name_per_trip
  ON trip_memberships (trip_id, lower(display_name));

ALTER TABLE trips
  ADD CONSTRAINT trips_owner_membership_same_trip_fkey
  FOREIGN KEY (id, owner_membership_id)
  REFERENCES trip_memberships (trip_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION assert_trip_has_exactly_one_owner(p_trip_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  owner_count integer;
  owner_is_linked boolean;
BEGIN
  SELECT count(m.id)::integer,
         bool_or(m.id = t.owner_membership_id AND m.role = 'owner')
    INTO owner_count, owner_is_linked
    FROM trips t
    LEFT JOIN trip_memberships m ON m.trip_id = t.id AND m.role = 'owner'
   WHERE t.id = p_trip_id
   GROUP BY t.id, t.owner_membership_id;

  IF owner_count <> 1 OR owner_is_linked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'trip % must have exactly one linked owner membership', p_trip_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_trip_owner_from_trip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM assert_trip_has_exactly_one_owner(COALESCE(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_trip_owner_from_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM assert_trip_has_exactly_one_owner(COALESCE(NEW.trip_id, OLD.trip_id));
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trips_require_one_owner
AFTER INSERT OR UPDATE OR DELETE ON trips
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_trip_owner_from_trip();

CREATE CONSTRAINT TRIGGER memberships_require_one_owner
AFTER INSERT OR UPDATE OR DELETE ON trip_memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_trip_owner_from_membership();

CREATE TABLE trip_invites (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_by_membership_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (trip_id, email),
  FOREIGN KEY (trip_id, invited_by_membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE expenses (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  paid_by_membership_id text NOT NULL,
  description text NOT NULL CHECK (btrim(description) <> ''),
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = upper(currency)),
  split_type text NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'custom', 'percentage')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, trip_id),
  FOREIGN KEY (trip_id, paid_by_membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE expense_splits (
  expense_id text NOT NULL,
  trip_id text NOT NULL,
  membership_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (expense_id, membership_id),
  FOREIGN KEY (expense_id, trip_id)
    REFERENCES expenses (id, trip_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (trip_id, membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE OR REPLACE FUNCTION assert_expense_split_total(p_expense_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  expected_total bigint;
  actual_total bigint;
BEGIN
  SELECT total_minor INTO expected_total FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(amount_minor), 0) INTO actual_total
    FROM expense_splits
   WHERE expense_id = p_expense_id;

  IF actual_total <> expected_total THEN
    RAISE EXCEPTION 'expense % splits total % does not equal expense total %',
      p_expense_id, actual_total, expected_total;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_expense_total_from_expense()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM assert_expense_split_total(COALESCE(NEW.id, OLD.id));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_expense_total_from_split()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_expense_split_total(OLD.expense_id);
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.expense_id IS DISTINCT FROM NEW.expense_id THEN
      PERFORM assert_expense_split_total(OLD.expense_id);
    END IF;
    PERFORM assert_expense_split_total(NEW.expense_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER expenses_require_exact_split_total
AFTER INSERT OR UPDATE OR DELETE ON expenses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_expense_total_from_expense();

CREATE CONSTRAINT TRIGGER expense_splits_require_exact_total
AFTER INSERT OR UPDATE OR DELETE ON expense_splits
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_expense_total_from_split();

CREATE TABLE receipts (
  id text PRIMARY KEY,
  expense_id text NOT NULL,
  trip_id text NOT NULL,
  uploaded_by_membership_id text NOT NULL,
  storage_key text NOT NULL UNIQUE CHECK (btrim(storage_key) <> ''),
  content_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (expense_id, trip_id)
    REFERENCES expenses (id, trip_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (trip_id, uploaded_by_membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE payments (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  payer_membership_id text NOT NULL,
  payee_membership_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = upper(currency)),
  note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payer_membership_id <> payee_membership_id),
  FOREIGN KEY (trip_id, payer_membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (trip_id, payee_membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE chat_messages (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  membership_id text NOT NULL,
  message text NOT NULL CHECK (btrim(message) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, membership_id)
    REFERENCES trip_memberships (trip_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX trip_memberships_trip_id_idx ON trip_memberships (trip_id);
CREATE INDEX trip_invites_trip_id_idx ON trip_invites (trip_id);
CREATE INDEX expenses_trip_created_at_idx ON expenses (trip_id, created_at DESC);
CREATE INDEX expense_splits_membership_id_idx ON expense_splits (membership_id);
CREATE INDEX receipts_expense_id_idx ON receipts (expense_id);
CREATE INDEX payments_trip_paid_at_idx ON payments (trip_id, paid_at DESC);
CREATE INDEX chat_messages_trip_created_at_idx ON chat_messages (trip_id, created_at DESC);
