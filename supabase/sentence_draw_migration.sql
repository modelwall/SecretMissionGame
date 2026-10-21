-- Secret Sentence Draw | additive migration for the existing SECRET MISSION app
-- Run this entire file once in Supabase SQL Editor after supabase/schema.sql.
-- It does not alter or delete any existing Secret Mission table or data.

create extension if not exists pgcrypto;

create table if not exists public.sentence_draw_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9A-F]{8}$'),
  host_user_id uuid not null references auth.users(id),
  host_contributes boolean not null default true,
  status text not null default 'lobby' check (status in ('lobby','started','finished')),
  player_limit smallint not null default 16 check (player_limit = 16),
  current_round smallint not null default 0 check (current_round between 0 and 16),
  generation integer not null default 1 check (generation > 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.sentence_draw_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sentence_draw_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  joined_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (session_id,user_id),
  unique (id,session_id)
);

create table if not exists public.sentence_draw_submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sentence_draw_sessions(id) on delete cascade,
  player_id uuid not null references public.sentence_draw_players(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  sentence_text text not null check (char_length(btrim(sentence_text)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id,slot),
  unique (id,session_id)
);

create table if not exists public.sentence_draw_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sentence_draw_sessions(id) on delete cascade,
  round_number smallint not null check (round_number between 1 and 16),
  created_at timestamptz not null default now(),
  unique (session_id,round_number),
  unique (id,session_id)
);

create table if not exists public.sentence_draw_round_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sentence_draw_sessions(id) on delete cascade,
  round_id uuid not null,
  submission_id uuid not null,
  display_order smallint not null check (display_order between 1 and 3),
  sentence_text text not null,
  created_at timestamptz not null default now(),
  foreign key (round_id,session_id)
    references public.sentence_draw_rounds(id,session_id) on delete cascade,
  foreign key (submission_id,session_id)
    references public.sentence_draw_submissions(id,session_id) on delete cascade,
  unique (session_id,submission_id),
  unique (round_id,display_order)
);

-- This is the only table exposed to Realtime. It contains aggregate/public state
-- only; unrevealed sentence text never enters a Realtime payload.
create table if not exists public.sentence_draw_public_state (
  session_id uuid primary key references public.sentence_draw_sessions(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby','started','finished')),
  joined_count smallint not null default 0 check (joined_count between 0 and 16),
  submitted_count smallint not null default 0 check (submitted_count between 0 and 16),
  current_round smallint not null default 0 check (current_round between 0 and 16),
  remaining_count smallint not null default 48 check (remaining_count between 0 and 48),
  event_seq bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists sentence_draw_players_session_idx
  on public.sentence_draw_players(session_id);
create index if not exists sentence_draw_submissions_session_idx
  on public.sentence_draw_submissions(session_id);
create index if not exists sentence_draw_rounds_session_idx
  on public.sentence_draw_rounds(session_id,round_number);
create index if not exists sentence_draw_round_items_session_idx
  on public.sentence_draw_round_items(session_id,round_id);

alter table public.sentence_draw_sessions enable row level security;
alter table public.sentence_draw_players enable row level security;
alter table public.sentence_draw_submissions enable row level security;
alter table public.sentence_draw_rounds enable row level security;
alter table public.sentence_draw_round_items enable row level security;
alter table public.sentence_draw_public_state enable row level security;

-- SECURITY DEFINER helper used only by the safe public-state RLS policy.
create or replace function public.sentence_draw_is_member(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sentence_draw_sessions s
    where s.id=p_session_id and s.host_user_id=(select auth.uid())
  ) or exists (
    select 1 from public.sentence_draw_players p
    where p.session_id=p_session_id and p.user_id=(select auth.uid())
  );
$$;

drop policy if exists "sentence draw member public state" on public.sentence_draw_public_state;
create policy "sentence draw member public state" on public.sentence_draw_public_state
for select to authenticated using (public.sentence_draw_is_member(session_id));

-- Direct browser access to private tables is intentionally denied. All reads and
-- writes go through the checked RPCs below. Authenticated clients may select only
-- aggregate public state, which is also the Realtime source.
revoke all on public.sentence_draw_sessions,
  public.sentence_draw_players,
  public.sentence_draw_submissions,
  public.sentence_draw_rounds,
  public.sentence_draw_round_items,
  public.sentence_draw_public_state from anon,authenticated;
grant select on public.sentence_draw_public_state to authenticated;

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
    'id',v_session.id,
    'code',v_session.code,
    'status',v_session.status,
    'generation',v_session.generation,
    'is_host',v_is_host,
    'has_player',v_player.id is not null,
    'has_submitted',v_player.submitted_at is not null,
    'joined_count',v_public.joined_count,
    'submitted_count',v_public.submitted_count,
    'current_round',v_public.current_round,
    'remaining_count',v_public.remaining_count,
    'my_sentences',v_mine,
    'current_sentences',v_current,
    'history',v_history
  );
end;
$$;

create or replace function public.sentence_draw_create_room(p_host_contributes boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sentence_draw_sessions%rowtype;
  v_code text;
  v_attempt int;
  v_joined smallint := 0;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;

  for v_attempt in 1..10 loop
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    begin
      insert into public.sentence_draw_sessions(code,host_user_id,host_contributes)
      values (v_code,auth.uid(),coalesce(p_host_contributes,true)) returning * into v_session;
      exit;
    exception when unique_violation then
      v_session := null;
    end;
  end loop;
  if v_session.id is null then raise exception 'DRAW_ROOM_CREATION_FAILED'; end if;

  if v_session.host_contributes then
    insert into public.sentence_draw_players(session_id,user_id)
    values (v_session.id,auth.uid());
    v_joined := 1;
  end if;

  insert into public.sentence_draw_public_state(session_id,joined_count)
  values (v_session.id,v_joined);

  return public.sentence_draw_room_status(v_session.code);
end;
$$;

create or replace function public.sentence_draw_join_room(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sentence_draw_sessions%rowtype;
  v_player public.sentence_draw_players%rowtype;
  v_count int;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_session from public.sentence_draw_sessions
    where code=upper(trim(p_code)) for update;
  if not found then raise exception 'DRAW_ROOM_NOT_FOUND'; end if;

  select * into v_player from public.sentence_draw_players
    where session_id=v_session.id and user_id=(select auth.uid());
  if found then return public.sentence_draw_room_status(v_session.code); end if;
  if v_session.status <> 'lobby' then raise exception 'DRAW_ROOM_STARTED'; end if;

  select count(*) into v_count from public.sentence_draw_players
    where session_id=v_session.id;
  if v_count >= v_session.player_limit then raise exception 'DRAW_ROOM_FULL'; end if;

  insert into public.sentence_draw_players(session_id,user_id)
  values (v_session.id,auth.uid());

  update public.sentence_draw_public_state set
    joined_count=v_count+1,event_seq=event_seq+1,updated_at=now()
  where session_id=v_session.id;

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

  if coalesce(array_length(p_sentences,1),0) <> 3 or exists (
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
  v_inserted int;
  v_status text;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_session from public.sentence_draw_sessions
    where code=upper(trim(p_code)) for update;
  if not found then raise exception 'DRAW_ROOM_NOT_FOUND'; end if;
  if v_session.host_user_id <> (select auth.uid()) then raise exception 'DRAW_NOT_HOST'; end if;
  if v_session.status='finished' then raise exception 'DRAW_FINISHED'; end if;
  if p_expected_round < 0 or p_expected_round > 16 then raise exception 'INVALID_ROUND'; end if;

  -- Idempotency/concurrency guard: a retry or another host tab carrying the
  -- previous round cannot consume the next round after one request wins.
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
  if v_joined <> 16 or v_submitted <> 16 or v_pool <> 48 then
    raise exception 'DRAW_NOT_READY';
  end if;

  v_next_round := v_session.current_round+1;
  insert into public.sentence_draw_rounds(session_id,round_number)
    values (v_session.id,v_next_round) returning id into v_round_id;

  with picked as (
    select s.id,s.sentence_text
    from public.sentence_draw_submissions s
    where s.session_id=v_session.id and not exists (
      select 1 from public.sentence_draw_round_items i
      where i.session_id=v_session.id and i.submission_id=s.id
    )
    order by random() limit 3
  ), numbered as (
    select id,sentence_text,row_number() over (order by random())::smallint as position
    from picked
  )
  insert into public.sentence_draw_round_items(
    session_id,round_id,submission_id,display_order,sentence_text
  ) select v_session.id,v_round_id,id,position,sentence_text from numbered;

  get diagnostics v_inserted = row_count;
  if v_inserted <> 3 then raise exception 'DRAW_POOL_INCOMPLETE'; end if;

  v_status := case when v_next_round=16 then 'finished' else 'started' end;
  update public.sentence_draw_sessions set
    status=v_status,current_round=v_next_round,
    started_at=coalesce(started_at,now()),
    finished_at=case when v_next_round=16 then now() else null end
  where id=v_session.id;
  update public.sentence_draw_public_state set
    status=v_status,current_round=v_next_round,
    remaining_count=48-(v_next_round*3),event_seq=event_seq+1,updated_at=now()
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

  -- Keep the same 16 room identities so every current device remains a member,
  -- but erase only this mode's private pool and revealed history.
  delete from public.sentence_draw_rounds where session_id=v_session.id;
  delete from public.sentence_draw_submissions where session_id=v_session.id;
  update public.sentence_draw_players set submitted_at=null
    where session_id=v_session.id;
  select count(*) into v_joined from public.sentence_draw_players
    where session_id=v_session.id;

  update public.sentence_draw_sessions set
    status='lobby',current_round=0,generation=generation+1,
    started_at=null,finished_at=null
  where id=v_session.id;
  update public.sentence_draw_public_state set
    status='lobby',joined_count=v_joined,submitted_count=0,
    current_round=0,remaining_count=48,event_seq=event_seq+1,updated_at=now()
  where session_id=v_session.id;

  return public.sentence_draw_room_status(v_session.code);
end;
$$;

revoke all on function public.sentence_draw_is_member(uuid) from public,anon;
revoke all on function public.sentence_draw_room_status(text) from public,anon;
revoke all on function public.sentence_draw_create_room(boolean) from public,anon;
revoke all on function public.sentence_draw_join_room(text) from public,anon;
revoke all on function public.sentence_draw_save_submission(text,text[]) from public,anon;
revoke all on function public.sentence_draw_draw(text,int) from public,anon;
revoke all on function public.sentence_draw_reset(text) from public,anon;

grant execute on function public.sentence_draw_is_member(uuid) to authenticated;
grant execute on function public.sentence_draw_room_status(text) to authenticated;
grant execute on function public.sentence_draw_create_room(boolean) to authenticated;
grant execute on function public.sentence_draw_join_room(text) to authenticated;
grant execute on function public.sentence_draw_save_submission(text,text[]) to authenticated;
grant execute on function public.sentence_draw_draw(text,int) to authenticated;
grant execute on function public.sentence_draw_reset(text) to authenticated;

-- Idempotently add only the aggregate table to Supabase Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='sentence_draw_public_state'
  ) then
    alter publication supabase_realtime add table public.sentence_draw_public_state;
  end if;
end $$;
