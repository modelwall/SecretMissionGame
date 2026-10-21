-- Multiplayer games | read-only security and data-integrity audit
-- Run after sentence_draw_migration.sql, flexible_room_settings_migration.sql,
-- and sentence_draw_session_fix_migration.sql.

-- Private tables must not be directly readable by browser roles.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'sentence_draw_sessions','sentence_draw_players','sentence_draw_submissions',
    'sentence_draw_rounds','sentence_draw_round_items'
  ] loop
    if has_table_privilege('authenticated','public.' || v_table,'select')
      or has_table_privilege('anon','public.' || v_table,'select') then
      raise exception 'Private table % has an unsafe browser SELECT grant',v_table;
    end if;
  end loop;
end $$;

-- Flexible write RPCs are authenticated-only.
do $$
begin
  if not has_function_privilege(
    'authenticated','public.trip_create_room(integer,integer,integer)','execute'
  ) or not has_function_privilege(
    'authenticated','public.sentence_draw_create_room(boolean,integer,integer)','execute'
  ) or not has_function_privilege(
    'authenticated','public.sentence_draw_join_room(text,text)','execute'
  ) then raise exception 'Flexible room RPC grant is missing'; end if;

  if has_function_privilege(
    'anon','public.trip_create_room(integer,integer,integer)','execute'
  ) or has_function_privilege(
    'anon','public.sentence_draw_create_room(boolean,integer,integer)','execute'
  ) or has_function_privilege(
    'anon','public.sentence_draw_join_room(text,text)','execute'
  ) then raise exception 'Flexible room RPC is exposed to anon'; end if;
end $$;

-- Recovery tokens are hashed, scoped to one room, and unique inside that room.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sentence_draw_players'
      and column_name='member_token_hash'
  ) then raise exception 'Sentence Draw member-token column is missing'; end if;

  if to_regclass('public.sentence_draw_players_session_member_token_idx') is null then
    raise exception 'Sentence Draw member-token unique index is missing';
  end if;

  if exists (
    select 1 from public.sentence_draw_players
    where member_token_hash is not null
      and member_token_hash !~ '^[0-9a-f]{64}$'
  ) then raise exception 'Invalid Sentence Draw member-token hash found'; end if;
end $$;

-- Only aggregate public state from this mode may be in the Realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='sentence_draw_public_state'
  ) then raise exception 'sentence_draw_public_state is missing from Realtime'; end if;

  if exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename in ('sentence_draw_submissions','sentence_draw_round_items')
  ) then raise exception 'A private sentence table is exposed to Realtime'; end if;
end $$;

-- These result sets must stay empty. They can also audit rooms after live tests.
select r.id as room_id,count(p.id) as joined_count,r.player_limit
from public.trip_rooms r
left join public.trip_players p on p.room_id=r.id
group by r.id,r.player_limit
having count(p.id) > r.player_limit;

select p.room_id,p.id as player_id,count(a.id) as assignment_count,
  r.missions_per_player
from public.trip_players p
join public.trip_rooms r on r.id=p.room_id
left join public.trip_assignments a on a.player_id=p.id
group by p.room_id,p.id,r.missions_per_player
having count(a.id) <> r.missions_per_player;

select p.room_id,p.id as player_id,p.car_number,p.seat_number
from public.trip_players p
join public.trip_rooms r on r.id=p.room_id
where p.car_number > r.team_count
  or p.seat_number > (r.player_limit/r.team_count) +
    case when p.car_number <= mod(r.player_limit,r.team_count) then 1 else 0 end;

select session_id,submission_id,count(*) as draw_count
from public.sentence_draw_round_items
group by session_id,submission_id
having count(*) > 1;

select i.session_id,i.round_id,count(*) as item_count,
  least(s.draw_size,
    (select count(*) from public.sentence_draw_submissions x where x.session_id=s.id)
      -((r.round_number-1)*s.draw_size)
  ) as expected_item_count
from public.sentence_draw_round_items i
join public.sentence_draw_rounds r on r.id=i.round_id
join public.sentence_draw_sessions s on s.id=i.session_id
group by i.session_id,i.round_id,s.id,s.draw_size,s.player_limit,
  s.sentences_per_player,r.round_number
having count(*) <> least(s.draw_size,
  (select count(*) from public.sentence_draw_submissions x where x.session_id=s.id)
    -((r.round_number-1)*s.draw_size));

select s.id as session_id,s.status,s.current_round,
  count(distinct r.id) as round_count,
  count(i.id) as revealed_count,
  case when s.status='lobby' then s.player_limit*s.sentences_per_player
    else (select count(*) from public.sentence_draw_submissions x where x.session_id=s.id)
  end-count(i.id) as calculated_remaining,
  ps.remaining_count as stored_remaining
from public.sentence_draw_sessions s
join public.sentence_draw_public_state ps on ps.session_id=s.id
left join public.sentence_draw_rounds r on r.session_id=s.id
left join public.sentence_draw_round_items i on i.round_id=r.id
group by s.id,s.status,s.current_round,ps.remaining_count
having count(distinct r.id) <> s.current_round
  or (case when s.status='lobby' then s.player_limit*s.sentences_per_player
    else (select count(*) from public.sentence_draw_submissions x where x.session_id=s.id)
  end)-count(i.id) <> ps.remaining_count;

select 'Secret Sentence Draw security and integrity checks passed' as result;
