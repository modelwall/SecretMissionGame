-- Host-configurable labels for Secret Mission cars; existing rooms remain unchanged.
-- Apply before shipping the matching frontend. No seat IDs, assignments or scores are changed.

ALTER TABLE public.trip_rooms
  ADD COLUMN IF NOT EXISTS team_names text[];

COMMENT ON COLUMN public.trip_rooms.team_names IS
  'Ordered team labels for this room; NULL for legacy rooms that use Car 1, Car 2, etc.';

ALTER TABLE public.trip_rooms
  ADD CONSTRAINT trip_rooms_team_names_count_check
  CHECK (
    team_names IS NULL OR
    (coalesce(array_ndims(team_names),0) = 1
     AND coalesce(array_length(team_names,1),0) = team_count)
  );

-- Keep old trip_create_room(...) overloads untouched for existing clients.
CREATE OR REPLACE FUNCTION public.trip_create_named_room(
  p_player_limit integer,
  p_team_count integer,
  p_missions_per_player integer,
  p_team_names text[]
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_code text;
  v_room public.trip_rooms%rowtype;
  v_attempt integer;
  v_bank_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_player_limit IS NULL OR p_team_count IS NULL OR p_missions_per_player IS NULL
     OR p_player_limit NOT BETWEEN 2 AND 24
     OR p_team_count NOT BETWEEN 1 AND 8
     OR p_team_count > p_player_limit
     OR p_missions_per_player NOT BETWEEN 1 AND 6
     OR p_player_limit * p_missions_per_player > 72 THEN
    RAISE EXCEPTION 'INVALID_ROOM_SETTINGS';
  END IF;

  IF p_team_names IS NULL
     OR coalesce(array_ndims(p_team_names),0) <> 1
     OR coalesce(array_length(p_team_names,1),0) <> p_team_count
     OR EXISTS (
       SELECT 1 FROM unnest(p_team_names) AS n(name)
       WHERE name IS NULL
          OR char_length(btrim(name)) NOT BETWEEN 1 AND 24
          OR name <> btrim(name)
     )
     OR (
       SELECT count(DISTINCT lower(n.name))
       FROM unnest(p_team_names) AS n(name)
     ) <> p_team_count THEN
    RAISE EXCEPTION 'INVALID_TEAM_NAMES';
  END IF;

  SELECT count(*) INTO v_bank_count FROM public.trip_mission_bank;
  IF p_player_limit * p_missions_per_player > v_bank_count THEN
    RAISE EXCEPTION 'NOT_ENOUGH_MISSIONS';
  END IF;

  FOR v_attempt IN 1..10 LOOP
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    BEGIN
      INSERT INTO public.trip_rooms (
        code,created_by,player_limit,team_count,missions_per_player,team_names
      )
      VALUES (
        v_code,(SELECT auth.uid()),p_player_limit,p_team_count,
        p_missions_per_player,p_team_names
      )
      RETURNING * INTO v_room;
      RETURN public.trip_room_status(v_room.code);
    EXCEPTION WHEN unique_violation THEN
      -- Retry the overwhelmingly unlikely room-code collision.
      v_room := NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'ROOM_CREATION_FAILED';
END;
$function$;

REVOKE ALL ON FUNCTION public.trip_create_named_room(integer,integer,integer,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trip_create_named_room(integer,integer,integer,text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.trip_create_named_room(integer,integer,integer,text[]) TO authenticated, service_role;

-- Compatible extension of the current status object: adds team_names only.
CREATE OR REPLACE FUNCTION public.trip_room_status(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_room public.trip_rooms%rowtype;
  v_seats jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO v_room FROM public.trip_rooms
    WHERE code=upper(trim(p_code));
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'car',p.car_number,'seat',p.seat_number
  ) ORDER BY p.car_number,p.seat_number),'[]'::jsonb)
    INTO v_seats FROM public.trip_players p WHERE p.room_id=v_room.id;

  RETURN jsonb_build_object(
    'id',v_room.id,'code',v_room.code,'seats',v_seats,
    'is_host',v_room.created_by=(SELECT auth.uid()),
    'player_limit',v_room.player_limit,'team_count',v_room.team_count,
    'missions_per_player',v_room.missions_per_player,
    'team_names',v_room.team_names
  );
END;
$function$;
