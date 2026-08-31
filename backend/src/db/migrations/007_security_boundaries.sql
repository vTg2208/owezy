-- Remove invitee PII that older releases placed in audit data visible to all trip members.
ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable;
UPDATE audit_events
   SET metadata = metadata - 'email'
 WHERE action = 'invite.created'
   AND metadata ? 'email';
ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable;

-- NOT VALID preserves legacy rows while enforcing the limits on every new write.
ALTER TABLE users
  ADD CONSTRAINT users_email_length_check CHECK (char_length(email) <= 320) NOT VALID,
  ADD CONSTRAINT users_name_length_check CHECK (char_length(name) <= 100) NOT VALID;

ALTER TABLE trips
  ADD CONSTRAINT trips_name_length_check CHECK (char_length(name) <= 100) NOT VALID,
  ADD CONSTRAINT trips_room_code_length_check
    CHECK (char_length(room_code) BETWEEN 6 AND 10) NOT VALID;

ALTER TABLE trip_memberships
  ADD CONSTRAINT trip_memberships_display_name_length_check
    CHECK (char_length(display_name) <= 100) NOT VALID;

ALTER TABLE trip_invites
  ADD CONSTRAINT trip_invites_email_length_check CHECK (char_length(email) <= 320) NOT VALID;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_description_length_check
    CHECK (char_length(description) <= 500) NOT VALID;

ALTER TABLE payments
  ADD CONSTRAINT payments_note_length_check
    CHECK (note IS NULL OR char_length(note) <= 500) NOT VALID;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_message_length_check
    CHECK (char_length(message) <= 500) NOT VALID;

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_operation_length_check
    CHECK (char_length(operation) <= 64) NOT VALID,
  ADD CONSTRAINT idempotency_records_key_length_check
    CHECK (char_length(idempotency_key) <= 128) NOT VALID;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_action_length_check
    CHECK (char_length(action) <= 64) NOT VALID,
  ADD CONSTRAINT audit_events_entity_type_length_check
    CHECK (char_length(entity_type) <= 64) NOT VALID,
  ADD CONSTRAINT audit_events_entity_id_length_check
    CHECK (char_length(entity_id) <= 128) NOT VALID;
