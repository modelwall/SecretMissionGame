-- Sentence Draw | stable browser membership recovery
-- Run after sentence_draw_migration.sql and flexible_room_settings_migration.sql.
-- The browser keeps the raw 256-bit token. Only its SHA-256 hash is stored here.

alter table public.sentence_draw_players
  add column if not exists member_token_hash text;

alter table public.sentence_draw_players
  drop constraint if exists sentence_draw_players_member_token_hash_check;
alter table public.sentence_draw_players
  add constraint sentence_draw_players_member_token_hash_check
    check (member_token_hash is null or member_token_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists sentence_draw_players_session_member_token_idx
  on public.sentence_draw_players(session_id,member_token_hash)
  where member_token_hash is not null;

comment on column public.sentence_draw_players.member_token_hash is
  'SHA-256 browser membership token; permits a player row to survive a replaced anonymous auth session.';

-- This overload preserves the original one-argument RPC for older clients.
-- It first identifies the current auth user, then attempts recovery through the
-- high-entropy browser token, and only then allocates a new player slot.
create or replace function public.sentence_draw_join_room(
  p_code text,p_member_token text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sentence_draw_sessions%rowtype;
  v_player public.sentence_draw_players%rowtype;
  v_count int;
  v_token_hash text;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_member_token is null or p_member_token !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_MEMBER_TOKEN';
  end if;
  v_token_hash := encode(extensions.digest(p_member_token,'sha256'),'hex');

  -- Serialize all membership changes for a room.
  select * into v_session from public.sentence_draw_sessions
    where code=upper(trim(p_code)) for update;
  if not found then raise exception 'DRAW_ROOM_NOT_FOUND'; end if;

  -- Normal reload: the Supabase anonymous auth session is still the same.
  select * into v_player from public.sentence_draw_players
    where session_id=v_session.id and user_id=(select auth.uid());
  if found then
    if v_player.member_token_hash is null and not exists (
      select 1 from public.sentence_draw_players
      where session_id=v_session.id and member_token_hash=v_token_hash
    ) then
      update public.sentence_draw_players set member_token_hash=v_token_hash
        where id=v_player.id;
    end if;
    return public.sentence_draw_room_status(v_session.code);
  end if;

  -- Recovery path: local browser storage survived but anonymous auth changed.
  select * into v_player from public.sentence_draw_players
    where session_id=v_session.id and member_token_hash=v_token_hash;
  if found then
    if v_session.host_user_id=v_player.user_id then
      update public.sentence_draw_sessions set host_user_id=(select auth.uid())
        where id=v_session.id;
    end if;
    update public.sentence_draw_players set user_id=(select auth.uid())
      where id=v_player.id;
    select count(*) into v_count from public.sentence_draw_players
      where session_id=v_session.id;
    update public.sentence_draw_public_state set
      joined_count=v_count,updated_at=now()
      where session_id=v_session.id;
    return public.sentence_draw_room_status(v_session.code);
  end if;

  if v_session.status <> 'lobby' then raise exception 'DRAW_ROOM_STARTED'; end if;
  select count(*) into v_count from public.sentence_draw_players
    where session_id=v_session.id;
  if v_count >= v_session.player_limit then raise exception 'DRAW_ROOM_FULL'; end if;

  insert into public.sentence_draw_players(session_id,user_id,member_token_hash)
    values(v_session.id,(select auth.uid()),v_token_hash);
  v_count := v_count+1;
  update public.sentence_draw_public_state set
    joined_count=v_count,event_seq=event_seq+1,updated_at=now()
    where session_id=v_session.id;
  return public.sentence_draw_room_status(v_session.code);
end;
$$;

revoke all on function public.sentence_draw_join_room(text,text) from public,anon;
grant execute on function public.sentence_draw_join_room(text,text) to authenticated;
