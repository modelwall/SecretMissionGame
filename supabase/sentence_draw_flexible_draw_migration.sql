-- Sentence Draw | host-selected draw size and early start
-- Run after sentence_draw_migration.sql, flexible_room_settings_migration.sql
-- and sentence_draw_session_fix_migration.sql.
-- Existing rooms keep draw_size=3. New rooms may reveal 1..(players x sentences)
-- sentences per round, and the host may start as soon as one player has
-- submitted. Players who have not submitted at the first draw are left out of
-- the pool, and submissions lock exactly as before.

alter table public.sentence_draw_sessions
  drop constraint if exists sentence_draw_sessions_draw_size_check;
alter table public.sentence_draw_sessions
  add constraint sentence_draw_sessions_draw_size_check check (draw_size between 1 and 144);

alter table public.sentence_draw_round_items
  drop constraint if exists sentence_draw_round_items_display_order_check;
alter table public.sentence_draw_round_items
  add constraint sentence_draw_round_items_display_order_check check (display_order between 1 and 144);

create or replace function public.sentence_draw_create_room(
  p_host_contributes boolean,p_player_limit int,p_sentences_per_player int,p_draw_size int
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sentence_draw_sessions%rowtype;
  v_code text;
  v_attempt int;
  v_joined smallint := 0;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_player_limit is null or p_sentences_per_player is null or p_draw_size is null
    or p_player_limit not between 2 and 24
    or p_sentences_per_player not between 1 and 6
    or p_draw_size not between 1 and p_player_limit*p_sentences_per_player then
    raise exception 'INVALID_DRAW_SETTINGS';
  end if;

  for v_attempt in 1..10 loop
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    begin
      insert into public.sentence_draw_sessions(
        code,host_user_id,host_contributes,player_limit,sentences_per_player,draw_size
      ) values (
        v_code,(select auth.uid()),coalesce(p_host_contributes,true),
        p_player_limit,p_sentences_per_player,p_draw_size
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

-- Older clients keep calling the three-argument overload and get the original
-- three sentences per round (or fewer when the whole room holds fewer).
create or replace function public.sentence_draw_create_room(
  p_host_contributes boolean,p_player_limit int,p_sentences_per_player int
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.sentence_draw_create_room(
    p_host_contributes,p_player_limit,p_sentences_per_player,
    least(3,p_player_limit*p_sentences_per_player)
  );
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
  -- The host may start before everyone submits. Each submitted player owns a
  -- complete set of sentences_per_player rows; nobody else has any rows.
  if v_submitted < 1 or v_joined > v_session.player_limit
    or v_pool <> v_submitted*v_session.sentences_per_player then
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

revoke all on function public.sentence_draw_create_room(boolean,int,int,int) from public,anon;
grant execute on function public.sentence_draw_create_room(boolean,int,int,int) to authenticated;
revoke all on function public.sentence_draw_create_room(boolean,int,int) from public,anon;
grant execute on function public.sentence_draw_create_room(boolean,int,int) to authenticated;
