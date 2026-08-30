ALTER TABLE trip_memberships
  DROP CONSTRAINT IF EXISTS trip_memberships_trip_id_fkey;

ALTER TABLE trip_memberships
  ADD CONSTRAINT trip_memberships_trip_id_fkey
  FOREIGN KEY (trip_id)
  REFERENCES trips(id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION prevent_trip_membership_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trip memberships are historical records and cannot be deleted';
  RETURN OLD;
END;
$$;
