-- Flexible room settings for every game mode.
-- Run after schema.sql and sentence_draw_migration.sql.
-- Existing rooms keep their original defaults (16 players, 4 cars, 3 items).

-- ---------------------------------------------------------------------------
-- Secret Mission
-- ---------------------------------------------------------------------------

alter table public.trip_rooms
  add column if not exists player_limit smallint not null default 16,
  add column if not exists team_count smallint not null default 4,
  add column if not exists missions_per_player smallint not null default 3;

alter table public.trip_rooms
  drop constraint if exists trip_rooms_player_limit_check,
  drop constraint if exists trip_rooms_team_count_check,
  drop constraint if exists trip_rooms_missions_per_player_check,
  drop constraint if exists trip_rooms_team_limit_check;
alter table public.trip_rooms
  add constraint trip_rooms_player_limit_check check (player_limit between 2 and 24),
  add constraint trip_rooms_team_count_check check (team_count between 1 and 8),
  add constraint trip_rooms_missions_per_player_check check (missions_per_player between 1 and 6),
  add constraint trip_rooms_team_limit_check check (team_count <= player_limit);

alter table public.trip_players
  drop constraint if exists trip_players_car_number_check,
  drop constraint if exists trip_players_seat_number_check;
alter table public.trip_players
  add constraint trip_players_car_number_check check (car_number between 1 and 8),
  add constraint trip_players_seat_number_check check (seat_number between 1 and 24);

alter table public.trip_assignments
  drop constraint if exists trip_assignments_card_number_check;
alter table public.trip_assignments
  add constraint trip_assignments_card_number_check check (card_number between 1 and 6);

create or replace function public.trip_room_status(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.trip_rooms%rowtype;
  v_seats jsonb;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_room from public.trip_rooms
    where code=upper(trim(p_code));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'car',p.car_number,'seat',p.seat_number
  ) order by p.car_number,p.seat_number),'[]'::jsonb)
    into v_seats from public.trip_players p where p.room_id=v_room.id;

  return jsonb_build_object(
    'id',v_room.id,'code',v_room.code,'seats',v_seats,
    'is_host',v_room.created_by=(select auth.uid()),
    'player_limit',v_room.player_limit,'team_count',v_room.team_count,
    'missions_per_player',v_room.missions_per_player
  );
end;
$$;

-- Keep the original no-argument function for older clients. New clients call
-- this overload so every setting is validated and frozen when the room is made.
create or replace function public.trip_create_room(
  p_player_limit int,p_team_count int,p_missions_per_player int
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_room public.trip_rooms%rowtype;
  v_attempt int;
  v_bank_count int;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_player_limit not between 2 and 24
    or p_team_count not between 1 and 8
    or p_team_count > p_player_limit
    or p_missions_per_player not between 1 and 6 then
    raise exception 'INVALID_ROOM_SETTINGS';
  end if;

  select count(*) into v_bank_count from public.trip_mission_bank;
  if p_player_limit*p_missions_per_player > v_bank_count then
    raise exception 'NOT_ENOUGH_MISSIONS';
  end if;

  for v_attempt in 1..10 loop
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    begin
      insert into public.trip_rooms(
        code,created_by,player_limit,team_count,missions_per_player
      ) values (
        v_code,(select auth.uid()),p_player_limit,p_team_count,p_missions_per_player
      ) returning * into v_room;
      return public.trip_room_status(v_room.code);
    exception when unique_violation then
      v_room := null;
    end;
  end loop;
  raise exception 'ROOM_CREATION_FAILED';
end;
$$;

create or replace function public.trip_join_seat(
  p_code text,p_car int,p_seat int,p_nickname text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.trip_rooms%rowtype;
  v_player public.trip_players%rowtype;
  v_name text := trim(coalesce(p_nickname,''));
  v_count int;
  v_capacity int;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_name) not between 2 and 24 then raise exception 'INVALID_NICKNAME'; end if;

  -- The room lock serializes joins and mission allocation for this room.
  select * into v_room from public.trip_rooms
    where code=upper(trim(p_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  select * into v_player from public.trip_players
    where room_id=v_room.id and user_id=(select auth.uid());
  if found then
    return jsonb_build_object('room_id',v_room.id,'player_id',v_player.id,
      'car',v_player.car_number,'seat',v_player.seat_number);
  end if;

  v_capacity := (v_room.player_limit / v_room.team_count) +
    case when p_car <= mod(v_room.player_limit,v_room.team_count) then 1 else 0 end;
  if p_car not between 1 and v_room.team_count
    or p_seat not between 1 and v_capacity then
    raise exception 'INVALID_SEAT';
  end if;

  select count(*) into v_count from public.trip_players where room_id=v_room.id;
  if v_count >= v_room.player_limit then raise exception 'ROOM_FULL'; end if;
  if exists (select 1 from public.trip_players where room_id=v_room.id
    and car_number=p_car and seat_number=p_seat) then raise exception 'SEAT_TAKEN'; end if;

  select count(*) into v_count from public.trip_mission_bank m
    where not exists (select 1 from public.trip_assignments a
      where a.room_id=v_room.id and a.mission_id=m.id);
  if v_count < v_room.missions_per_player then raise exception 'NOT_ENOUGH_MISSIONS'; end if;

  insert into public.trip_players(room_id,user_id,car_number,seat_number,nickname)
    values(v_room.id,(select auth.uid()),p_car,p_seat,v_name) returning * into v_player;

  with picked as (
    select m.id,m.description from public.trip_mission_bank m
    where not exists (select 1 from public.trip_assignments a
      where a.room_id=v_room.id and a.mission_id=m.id)
    order by random() limit v_room.missions_per_player
  ), numbered as (
    select id,description,row_number() over(order by id) as card_no from picked
  )
  insert into public.trip_assignments(room_id,player_id,mission_id,card_number,mission_text)
    select v_room.id,v_player.id,id,card_no,description from numbered;

  return jsonb_build_object('room_id',v_room.id,'player_id',v_player.id,
    'car',v_player.car_number,'seat',v_player.seat_number);
end;
$$;

revoke all on function public.trip_create_room(int,int,int) from public,anon;
grant execute on function public.trip_create_room(int,int,int) to authenticated;

-- ---------------------------------------------------------------------------
-- Secret Sentence Draw
-- ---------------------------------------------------------------------------

alter table public.sentence_draw_sessions
  add column if not exists sentences_per_player smallint not null default 3,
  add column if not exists draw_size smallint not null default 3;

alter table public.sentence_draw_sessions
  drop constraint if exists sentence_draw_sessions_player_limit_check,
  drop constraint if exists sentence_draw_sessions_current_round_check,
  drop constraint if exists sentence_draw_sessions_sentences_per_player_check,
  drop constraint if exists sentence_draw_sessions_draw_size_check;
alter table public.sentence_draw_sessions
  add constraint sentence_draw_sessions_player_limit_check check (player_limit between 2 and 24),
  add constraint sentence_draw_sessions_current_round_check check (current_round between 0 and 144),
  add constraint sentence_draw_sessions_sentences_per_player_check check (sentences_per_player between 1 and 6),
  add constraint sentence_draw_sessions_draw_size_check check (draw_size between 1 and 3);

alter table public.sentence_draw_submissions
  drop constraint if exists sentence_draw_submissions_slot_check;
alter table public.sentence_draw_submissions
  add constraint sentence_draw_submissions_slot_check check (slot between 1 and 6);

alter table public.sentence_draw_rounds
  drop constraint if exists sentence_draw_rounds_round_number_check;
alter table public.sentence_draw_rounds
  add constraint sentence_draw_rounds_round_number_check check (round_number between 1 and 144);

alter table public.sentence_draw_public_state
  drop constraint if exists sentence_draw_public_state_joined_count_check,
  drop constraint if exists sentence_draw_public_state_submitted_count_check,
  drop constraint if exists sentence_draw_public_state_current_round_check,
  drop constraint if exists sentence_draw_public_state_remaining_count_check;
alter table public.sentence_draw_public_state
  add constraint sentence_draw_public_state_joined_count_check check (joined_count between 0 and 24),
  add constraint sentence_draw_public_state_submitted_count_check check (submitted_count between 0 and 24),
  add constraint sentence_draw_public_state_current_round_check check (current_round between 0 and 144),
  add constraint sentence_draw_public_state_remaining_count_check check (remaining_count between 0 and 144);

create or replace function public.sentence_draw_room_status(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sentence_draw_sessions%rowtype;
  v_player public.sentence_draw_players%rowtype;
  v_public public.sentence_draw_public_state%rowtype;
  v_is_host boolean;
  v_mine jsonb := '[]'::jsonb;
  v_current jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_total int;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_session from public.sentence_draw_sessions
    where code=upper(trim(p_code));
  if not found then raise exception 'DRAW_ROOM_NOT_FOUND'; end if;

  v_is_host := v_session.host_user_id=(select auth.uid());
  select * into v_player from public.sentence_draw_players
    where session_id=v_session.id and user_id=(select auth.uid());
  if not v_is_host and not found then raise exception 'DRAW_NOT_MEMBER'; end if;
  select * into v_public from public.sentence_draw_public_state
    where session_id=v_session.id;
  if v_session.status='lobby' then
    v_total := v_session.player_limit*v_session.sentences_per_player;
  else
    select count(*) into v_total from public.sentence_draw_submissions
      where session_id=v_session.id;
  end if;

  if v_player.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'slot',x.slot,'text',x.sentence_text
    ) order by x.slot),'[]'::jsonb) into v_mine
    from public.sentence_draw_submissions x where x.player_id=v_player.id;
  end if;

  if v_session.current_round > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.submission_id,'position',i.display_order,'text',i.sentence_text
    ) order by i.display_order),'[]'::jsonb) into v_current
    from public.sentence_draw_round_items i
    join public.sentence_draw_rounds r on r.id=i.round_id
    where i.session_id=v_session.id and r.round_number=v_session.current_round;
  end if;

  if v_is_host then
    select coalesce(jsonb_agg(jsonb_build_object(
      'round',h.round_number,'sentences',h.sentences,'created_at',h.created_at
    ) order by h.round_number desc),'[]'::jsonb) into v_history
    from (
      select r.round_number,r.created_at,jsonb_agg(jsonb_build_object(
        'id',i.submission_id,'position',i.display_order,'text',i.sentence_text
      ) order by i.display_order) as sentences
      from public.sentence_draw_rounds r
      join public.sentence_draw_round_items i on i.round_id=r.id
      where r.session_id=v_session.id
      group by r.id,r.round_number,r.created_at
    ) h;
  end if;

  return jsonb_build_object(
    'id',v_session.id,'code',v_session.code,'status',v_session.status,
    'generation',v_session.generation,'is_host',v_is_host,
    'has_player',v_player.id is not null,'has_submitted',v_player.submitted_at is not null,
    'player_limit',v_session.player_limit,
    'sentences_per_player',v_session.sentences_per_player,'draw_size',v_session.draw_size,
    'total_count',v_total,
    'joined_count',v_public.joined_count,'submitted_count',v_public.submitted_count,
    'current_round',v_public.current_round,'remaining_count',v_public.remaining_count,
    'my_sentences',v_mine,'current_sentences',v_current,'history',v_history
  );
end;
$$;

create or replace function public.sentence_draw_create_room(
  p_host_contributes boolean,p_player_limit int,p_sentences_per_player int
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sentence_draw_sessions%rowtype;
  v_code text;
  v_attempt int;
  v_joined smallint := 0;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_player_limit not between 2 and 24
    or p_sentences_per_player not between 1 and 6 then
    raise exception 'INVALID_DRAW_SETTINGS';
  end if;

  for v_attempt in 1..10 loop
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    begin
      insert into public.sentence_draw_sessions(
        code,host_user_id,host_contributes,player_limit,sentences_per_player,draw_size
      ) values (
        v_code,(select auth.uid()),coalesce(p_host_contributes,true),
        p_player_limit,p_sentences_per_player,3
      ) returning * into v_session;
      exit;
    exception when unique_violation then
      v_session := null;
    end;
  end loop;
  if v_session.id is null then raise exception 'DRAW_ROOM_CREATION_FAILED'; end if;

  if v_session.host_contributes then
    insert into public.sentence_draw_players(session_id,user_id)
      values(v_session.id,(select auth.uid()));
    v_joined := 1;
  end if;
  insert into public.sentence_draw_public_state(session_id,joined_count,remaining_count)
    values(v_session.id,v_joined,p_player_limit*p_sentences_per_player);
  return public.sentence_draw_room_status(v_session.code);
end;
$$;

create or replace function public.sentence_draw_save_submission(
  p_code text,p_sentences text[]
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sentence_draw_sessions%rowtype;
  v_player public.sentence_draw_players%rowtype;
  v_submitted int;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_session from public.sentence_draw_sessions
    where code=upper(trim(p_code)) for update;
  if not found then raise exception 'DRAW_ROOM_NOT_FOUND'; end if;
  if v_session.status <> 'lobby' then raise exception 'DRAW_SUBMISSIONS_LOCKED'; end if;

  select * into v_player from public.sentence_draw_players
    where session_id=v_session.id and user_id=(select auth.uid());
  if not found then raise exception 'DRAW_NOT_PLAYER'; end if;
  if coalesce(array_length(p_sentences,1),0) <> v_session.sentences_per_player or exists (
    select 1 from unnest(p_sentences) x
      where char_length(btrim(coalesce(x,''))) not between 1 and 200
  ) then raise exception 'INVALID_SENTENCES'; end if;

  delete from public.sentence_draw_submissions where player_id=v_player.id;
  insert into public.sentence_draw_submissions(session_id,player_id,slot,sentence_text)
    select v_session.id,v_player.id,x.ordinality::smallint,btrim(x.sentence)
    from unnest(p_sentences) with ordinality as x(sentence,ordinality);
  update public.sentence_draw_players set submitted_at=now() where id=v_player.id;
  select count(*) into v_submitted from public.sentence_draw_players
    where session_id=v_session.id and submitted_at is not null;
  update public.sentence_draw_public_state set
    submitted_count=v_submitted,event_seq=event_seq+1,updated_at=now()
    where session_id=v_session.id;
  return public.sentence_draw_room_status(v_session.code);
end;
$$;

create or replace function public.sentence_draw_draw(p_code text,p_expected_round int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sentence_draw_sessions%rowtype;
  v_round_id uuid;
  v_next_round smallint;
  v_joined int;
  v_submitted int;
  v_pool int;
  v_revealed int;
  v_total int;
  v_pick_count int;
  v_inserted int;
  v_remaining int;
  v_status text;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_session from public.sentence_draw_sessions
    where code=upper(trim(p_code)) for update;
  if not found then raise exception 'DRAW_ROOM_NOT_FOUND'; end if;
  if v_session.host_user_id <> (select auth.uid()) then raise exception 'DRAW_NOT_HOST'; end if;
  if v_session.status='finished' then raise exception 'DRAW_FINISHED'; end if;
  if p_expected_round < 0 or p_expected_round > 144 then raise exception 'INVALID_ROUND'; end if;
  if p_expected_round < v_session.current_round then
    return public.sentence_draw_room_status(v_session.code);
  end if;
  if p_expected_round <> v_session.current_round then raise exception 'STALE_DRAW'; end if;

  select count(*) into v_joined from public.sentence_draw_players
    where session_id=v_session.id;
  select count(*) into v_submitted from public.sentence_draw_players
    where session_id=v_session.id and submitted_at is not null;
  select count(*) into v_pool from public.sentence_draw_submissions
    where session_id=v_session.id;
  v_total := v_pool;
  if v_joined < 2 or v_joined > v_session.player_limit
    or v_submitted <> v_joined
    or v_pool <> v_joined*v_session.sentences_per_player then
    raise exception 'DRAW_NOT_READY';
  end if;

  select count(*) into v_revealed from public.sentence_draw_round_items
    where session_id=v_session.id;
  v_remaining := v_total-v_revealed;
  if v_remaining <= 0 then raise exception 'DRAW_FINISHED'; end if;
  v_pick_count := least(v_session.draw_size,v_remaining);
  v_next_round := v_session.current_round+1;
  insert into public.sentence_draw_rounds(session_id,round_number)
    values(v_session.id,v_next_round) returning id into v_round_id;

  with picked as (
    select s.id,s.sentence_text from public.sentence_draw_submissions s
    where s.session_id=v_session.id and not exists (
      select 1 from public.sentence_draw_round_items i
        where i.session_id=v_session.id and i.submission_id=s.id
    ) order by random() limit v_pick_count
  ), numbered as (
    select id,sentence_text,row_number() over(order by random())::smallint as position
      from picked
  )
  insert into public.sentence_draw_round_items(
    session_id,round_id,submission_id,display_order,sentence_text
  ) select v_session.id,v_round_id,id,position,sentence_text from numbered;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_pick_count then raise exception 'DRAW_POOL_INCOMPLETE'; end if;
  v_remaining := v_remaining-v_inserted;
  v_status := case when v_remaining=0 then 'finished' else 'started' end;
  update public.sentence_draw_sessions set
    status=v_status,current_round=v_next_round,started_at=coalesce(started_at,now()),
    finished_at=case when v_remaining=0 then now() else null end
    where id=v_session.id;
  update public.sentence_draw_public_state set
    status=v_status,current_round=v_next_round,remaining_count=v_remaining,
    event_seq=event_seq+1,updated_at=now()
    where session_id=v_session.id;
  return public.sentence_draw_room_status(v_session.code);
end;
$$;

create or replace function public.sentence_draw_reset(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sentence_draw_sessions%rowtype;
  v_joined int;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_session from public.sentence_draw_sessions
    where code=upper(trim(p_code)) for update;
  if not found then raise exception 'DRAW_ROOM_NOT_FOUND'; end if;
  if v_session.host_user_id <> (select auth.uid()) then raise exception 'DRAW_NOT_HOST'; end if;

  delete from public.sentence_draw_rounds where session_id=v_session.id;
  delete from public.sentence_draw_submissions where session_id=v_session.id;
  update public.sentence_draw_players set submitted_at=null where session_id=v_session.id;
  select count(*) into v_joined from public.sentence_draw_players where session_id=v_session.id;
  update public.sentence_draw_sessions set
    status='lobby',current_round=0,generation=generation+1,
    started_at=null,finished_at=null where id=v_session.id;
  update public.sentence_draw_public_state set
    status='lobby',joined_count=v_joined,submitted_count=0,current_round=0,
    remaining_count=v_session.player_limit*v_session.sentences_per_player,
    event_seq=event_seq+1,updated_at=now() where session_id=v_session.id;
  return public.sentence_draw_room_status(v_session.code);
end;
$$;

revoke all on function public.sentence_draw_create_room(boolean,int,int) from public,anon;
grant execute on function public.sentence_draw_create_room(boolean,int,int) to authenticated;
