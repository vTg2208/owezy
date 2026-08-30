ALTER TABLE users
  ADD COLUMN account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN anonymized_at timestamptz,
  ADD COLUMN firebase_deleted_at timestamptz,
  ADD CONSTRAINT users_account_status_check
    CHECK (account_status IN ('active', 'deleting', 'deleted')),
  ADD CONSTRAINT users_account_deletion_state_check
    CHECK (
      (account_status = 'active' AND anonymized_at IS NULL AND firebase_deleted_at IS NULL)
      OR (account_status = 'deleting' AND anonymized_at IS NOT NULL AND firebase_deleted_at IS NULL)
      OR (account_status = 'deleted' AND anonymized_at IS NOT NULL AND firebase_deleted_at IS NOT NULL)
    );

DROP INDEX trip_memberships_unique_name_per_trip;

CREATE UNIQUE INDEX trip_memberships_unique_active_name_per_trip
  ON trip_memberships (trip_id, lower(display_name))
  WHERE status = 'active';

ALTER TABLE payments
  ADD COLUMN status text NOT NULL DEFAULT 'confirmed',
  ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled'));

CREATE INDEX payments_trip_status_paid_at_idx
  ON payments (trip_id, status, paid_at DESC);

CREATE INDEX chat_messages_trip_cursor_idx
  ON chat_messages (trip_id, created_at DESC, id DESC);
