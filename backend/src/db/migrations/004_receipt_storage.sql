ALTER TABLE receipts
  ALTER COLUMN expense_id DROP NOT NULL,
  ADD COLUMN byte_size bigint,
  ADD COLUMN checksum_sha256 text,
  ADD COLUMN status text NOT NULL DEFAULT 'attached',
  ADD COLUMN pending_expires_at timestamptz,
  ADD COLUMN attached_at timestamptz;

UPDATE receipts
   SET attached_at = created_at
 WHERE expense_id IS NOT NULL;

ALTER TABLE receipts
  ADD CONSTRAINT receipts_content_type_check
    CHECK (content_type IS NULL OR content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT receipts_byte_size_check
    CHECK (byte_size IS NULL OR byte_size > 0),
  ADD CONSTRAINT receipts_checksum_sha256_check
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT receipts_status_check
    CHECK (status IN ('pending', 'attached')),
  ADD CONSTRAINT receipts_lifecycle_check
    CHECK (
      (
        status = 'pending'
        AND expense_id IS NULL
        AND content_type IS NOT NULL
        AND byte_size IS NOT NULL
        AND checksum_sha256 IS NOT NULL
        AND pending_expires_at IS NOT NULL
        AND attached_at IS NULL
      )
      OR
      (
        status = 'attached'
        AND expense_id IS NOT NULL
        AND pending_expires_at IS NULL
        AND attached_at IS NOT NULL
      )
    );

CREATE INDEX receipts_pending_cleanup_idx
  ON receipts (pending_expires_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX receipts_one_per_expense_idx
  ON receipts (expense_id)
  WHERE expense_id IS NOT NULL;

CREATE TABLE legacy_id_mappings (
  entity_type text NOT NULL CHECK (btrim(entity_type) <> ''),
  legacy_id text NOT NULL CHECK (btrim(legacy_id) <> ''),
  postgres_id text NOT NULL CHECK (btrim(postgres_id) <> ''),
  migrated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, legacy_id),
  UNIQUE (entity_type, postgres_id)
);
