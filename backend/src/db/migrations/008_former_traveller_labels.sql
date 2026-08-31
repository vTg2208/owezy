UPDATE trip_memberships
   SET display_name = 'Former traveller'
 WHERE status = 'anonymized'
   AND display_name LIKE 'Former member %';

CREATE OR REPLACE FUNCTION anonymize_disconnected_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL AND NEW.status <> 'anonymized' THEN
    NEW.status := 'anonymized';
    NEW.anonymized_at := COALESCE(NEW.anonymized_at, now());
    NEW.display_name := 'Former traveller';
    NEW.left_at := NULL;
  END IF;
  RETURN NEW;
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
         display_name = 'Former traveller'
   WHERE id = p_membership_id;
END;
$$;
