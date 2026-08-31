ALTER TABLE trips
  ADD COLUMN archived_at timestamptz;

DO $$
DECLARE
  invalid_owner record;
  successor_id text;
BEGIN
  FOR invalid_owner IN
    SELECT t.id AS trip_id, owner.id AS owner_membership_id
      FROM trips t
      JOIN trip_memberships owner ON owner.id = t.owner_membership_id AND owner.trip_id = t.id
     WHERE owner.status <> 'active' OR owner.user_id IS NULL
     ORDER BY t.id
     FOR UPDATE OF t, owner
  LOOP
    SELECT candidate.id
      INTO successor_id
      FROM trip_memberships candidate
     WHERE candidate.trip_id = invalid_owner.trip_id
       AND candidate.id <> invalid_owner.owner_membership_id
       AND candidate.status = 'active'
       AND candidate.user_id IS NOT NULL
     ORDER BY candidate.created_at, candidate.id
     LIMIT 1
     FOR UPDATE;

    IF successor_id IS NULL THEN
      UPDATE trips
         SET is_locked = true,
             archived_at = COALESCE(archived_at, now()),
             updated_at = now()
       WHERE id = invalid_owner.trip_id;
    ELSE
      UPDATE trip_memberships
         SET role = 'member'
       WHERE id = invalid_owner.owner_membership_id;
      UPDATE trip_memberships
         SET role = 'owner'
       WHERE id = successor_id;
      UPDATE trips
         SET owner_membership_id = successor_id,
             updated_at = now()
       WHERE id = invalid_owner.trip_id;
    END IF;
    successor_id := NULL;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION leave_trip_membership(
  p_membership_id text,
  p_archive_if_owner_alone boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  target trip_memberships%ROWTYPE;
  successor_id text;
BEGIN
  SELECT *
    INTO target
    FROM trip_memberships
   WHERE id = p_membership_id
   FOR UPDATE;

  IF NOT FOUND OR target.status <> 'active' THEN
    RETURN 'not-found';
  END IF;

  PERFORM 1 FROM trips WHERE id = target.trip_id FOR UPDATE;

  IF target.role = 'owner' THEN
    SELECT candidate.id
      INTO successor_id
      FROM trip_memberships candidate
     WHERE candidate.trip_id = target.trip_id
       AND candidate.id <> target.id
       AND candidate.status = 'active'
       AND candidate.user_id IS NOT NULL
     ORDER BY candidate.created_at, candidate.id
     LIMIT 1
     FOR UPDATE;

    IF successor_id IS NULL THEN
      IF NOT p_archive_if_owner_alone THEN
        RETURN 'owner-required';
      END IF;
      UPDATE trips
         SET is_locked = true,
             archived_at = COALESCE(archived_at, now()),
             updated_at = now()
       WHERE id = target.trip_id;
    ELSE
      UPDATE trip_memberships SET role = 'member' WHERE id = target.id;
      UPDATE trip_memberships SET role = 'owner' WHERE id = successor_id;
      UPDATE trips
         SET owner_membership_id = successor_id,
             updated_at = now()
       WHERE id = target.trip_id AND owner_membership_id = target.id;
    END IF;
  END IF;

  UPDATE trip_memberships
     SET status = 'left', left_at = now()
   WHERE id = target.id AND status = 'active';

  RETURN CASE WHEN target.role = 'owner' AND successor_id IS NULL THEN 'archived' ELSE 'left' END;
END;
$$;

CREATE OR REPLACE FUNCTION assert_trip_has_exactly_one_owner(p_trip_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  owner_count integer;
  owner_is_linked boolean;
  owner_is_reachable boolean;
  trip_is_archived boolean;
BEGIN
  SELECT count(m.id)::integer,
         bool_or(m.id = t.owner_membership_id AND m.role = 'owner'),
         bool_or(
           m.id = t.owner_membership_id
           AND m.role = 'owner'
           AND m.status = 'active'
           AND m.user_id IS NOT NULL
         ),
         t.archived_at IS NOT NULL
    INTO owner_count, owner_is_linked, owner_is_reachable, trip_is_archived
    FROM trips t
    LEFT JOIN trip_memberships m ON m.trip_id = t.id AND m.role = 'owner'
   WHERE t.id = p_trip_id
   GROUP BY t.id, t.owner_membership_id, t.archived_at;

  IF owner_count <> 1 OR owner_is_linked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'trip % must have exactly one linked owner membership', p_trip_id;
  END IF;
  IF NOT trip_is_archived AND owner_is_reachable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'active trip % must have a connected active owner membership', p_trip_id;
  END IF;
END;
$$;
