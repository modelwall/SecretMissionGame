-- Applied to Supabase project wozskitxakyoqizskyzx on 2026-10-22.
-- Additive, backwards-compatible change.
ALTER TABLE public.trip_assignments ADD COLUMN IF NOT EXISTS rerolled_at timestamptz;
COMMENT ON COLUMN public.trip_assignments.rerolled_at IS 'Non-null if this card has used its one allowed reroll.';

CREATE OR REPLACE FUNCTION public.trip_reroll_mission(p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_room_id uuid;
  v_assignment public.trip_assignments%ROWTYPE;
  v_new_mission_id bigint;
  v_new_mission_text text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT a.room_id INTO v_room_id FROM public.trip_assignments a
  JOIN public.trip_players p ON p.id = a.player_id
  WHERE a.id = p_assignment_id AND p.user_id = (SELECT auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_YOUR_MISSION'; END IF;

  -- Same lock order as trip_join_seat, preventing parallel duplicate allocation.
  PERFORM 1 FROM public.trip_rooms r WHERE r.id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  SELECT a.* INTO v_assignment FROM public.trip_assignments a
  JOIN public.trip_players p ON p.id = a.player_id
  WHERE a.id = p_assignment_id AND p.user_id = (SELECT auth.uid()) FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_YOUR_MISSION'; END IF;
  IF v_assignment.completed_at IS NOT NULL THEN RAISE EXCEPTION 'MISSION_ALREADY_COMPLETED'; END IF;
  IF v_assignment.rerolled_at IS NOT NULL THEN RAISE EXCEPTION 'REROLL_ALREADY_USED'; END IF;

  SELECT m.id,m.description INTO v_new_mission_id,v_new_mission_text
  FROM public.trip_mission_bank m
  WHERE m.id <> v_assignment.mission_id AND NOT EXISTS (
    SELECT 1 FROM public.trip_assignments assigned
    WHERE assigned.room_id=v_room_id AND assigned.mission_id=m.id)
  ORDER BY random() LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_AVAILABLE_MISSIONS'; END IF;

  UPDATE public.trip_assignments a
  SET mission_id=v_new_mission_id,mission_text=v_new_mission_text,rerolled_at=now()
  WHERE a.id=p_assignment_id AND a.rerolled_at IS NULL AND a.completed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'REROLL_CONFLICT'; END IF;
  RETURN jsonb_build_object(
    'id',p_assignment_id,'card_number',v_assignment.card_number,
    'mission_text',v_new_mission_text,'rerolled_at',
    (SELECT a.rerolled_at FROM public.trip_assignments a WHERE a.id=p_assignment_id));
END;
$function$;

REVOKE ALL ON FUNCTION public.trip_reroll_mission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trip_reroll_mission(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.trip_reroll_mission(uuid) TO authenticated,service_role;
