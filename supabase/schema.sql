-- Road Trip Secret Mission | Supabase SQL setup
-- Paste ALL of this file into Supabase > SQL Editor > New query > Run.
-- Safe to run once on a fresh Supabase project. Mission data is kept secret
-- until the owner completes the mission.

create extension if not exists pgcrypto;

create table if not exists public.trip_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9A-F]{8}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.trip_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.trip_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  car_number smallint not null check (car_number between 1 and 4),
  seat_number smallint not null check (seat_number between 1 and 4),
  nickname text not null check (char_length(nickname) between 2 and 24),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id),
  unique (room_id, car_number, seat_number)
);

create table if not exists public.trip_mission_bank (
  id bigint generated always as identity primary key,
  description text not null unique
);

create table if not exists public.trip_assignments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.trip_rooms(id) on delete cascade,
  player_id uuid not null references public.trip_players(id) on delete cascade,
  mission_id bigint not null references public.trip_mission_bank(id),
  card_number smallint not null check (card_number between 1 and 3),
  mission_text text not null,
  completed_at timestamptz,
  unique (player_id, card_number),
  unique (room_id, mission_id)
);

create index if not exists trip_players_room_idx on public.trip_players (room_id);
create index if not exists trip_assignments_room_idx on public.trip_assignments (room_id);
create index if not exists trip_assignments_player_idx on public.trip_assignments (player_id);

-- >= 48 distinct family-friendly, passenger-only missions for 16 x 3 cards.
insert into public.trip_mission_bank (description) values
('ทำให้เพื่อนพูดคำว่า “หมูกระทะ” โดยไม่บอกว่ากำลังเล่นเกม'),
('ชวนเพื่อนอย่างน้อยหนึ่งคนร้องท่อนฮุกเพลงออกมาจริง ๆ'),
('ทำให้เพื่อนเล่าเรื่องขายหน้าสมัยเรียนด้วยความสมัครใจ'),
('ทำให้เพื่อนพูดว่า “อะไรของแกเนี่ย”'),
('ทำให้เพื่อนพูดคำว่า “สับปะรด”'),
('ชวนคนในรถถกกันว่าใส่สับปะรดบนพิซซ่าดีหรือไม่'),
('ทำให้เพื่อนพูดชื่อจังหวัดอย่างน้อยสามจังหวัดติดกัน'),
('ทำให้เพื่อนชมว่าคุณเก่งเรื่องอะไรสักอย่าง'),
('ทำให้เพื่อนพูดว่า “ไม่เชื่อ!”'),
('ทำให้เพื่อนเล่าเรื่องเดตหรือความรักแบบขำ ๆ'),
('ทำให้เพื่อนหนึ่งคนตั้งชื่อเล่นใหม่ให้คุณ'),
('ทำให้เพื่อนพูดว่า “จริงดิ” อย่างเป็นธรรมชาติ'),
('ทำให้เพื่อนเล่าเรื่องน่าอายของตัวเองที่ทุกคนขำได้'),
('ทำให้เพื่อนบอกชื่อเพลงโปรดของตัวเอง'),
('ทำให้เพื่อนพูดชื่อผลไม้สามชนิด'),
('ทำให้เพื่อนบอกเมนูที่อยากกินเมื่อถึงที่พัก'),
('ทำให้เพื่อนพูดชื่อการ์ตูนสมัยเด็ก'),
('ทำให้เพื่อนพูดคำว่า “จักรวาล”'),
('ทำให้เพื่อนเล่าเรื่องท่องเที่ยวพัง ๆ ที่ผ่านมา'),
('ทำให้เพื่อนนึกชื่อดาราสามคนภายใน 15 วินาที'),
('ทำให้เพื่อนเสนอเพลงที่จะเปิดต่อไป'),
('ทำให้เพื่อนพูดชื่อร้านสะดวกซื้อสองร้าน'),
('ทำให้เพื่อนแนะนำภาพยนตร์หนึ่งเรื่องให้ทั้งคัน'),
('ทำให้เพื่อนหัวเราะกับมุกแป้กของคุณ'),
('ทำให้เพื่อนพูดคำว่า “เอาจริงเหรอ”'),
('ทำให้เพื่อนเลือกว่าจะเที่ยวทะเลหรือภูเขาแล้วบอกเหตุผล'),
('ทำให้เพื่อนตั้งชื่อวงดนตรีให้คนในรถ'),
('ทำให้เพื่อนพูดชื่อสัตว์ทะเลสามชนิด'),
('ทำให้เพื่อนเล่าความสามารถลับหนึ่งอย่างของตัวเอง'),
('ทำให้เพื่อนทายว่าคุณชอบอาหารประเภทไหน'),
('ทำให้เพื่อนบอกชื่อเครื่องดื่มที่ชอบที่สุด'),
('ทำให้เพื่อนใช้คำว่า “ตำนาน” ในประโยค'),
('ทำให้เพื่อนเล่าว่าเคยไปคอนเสิร์ตของใคร'),
('ทำให้เพื่อนฮัมเพลงโดยไม่เปิดเสียงเพลงช่วย'),
('ทำให้เพื่อนพูดชื่อประเทศที่อยากไปเที่ยว'),
('ทำให้เพื่อนแนะนำขนมในร้านสะดวกซื้อ'),
('ทำให้เพื่อนพูดชื่อสีอย่างน้อยห้าสีติดกัน'),
('ทำให้เพื่อนเล่าเรื่องเผลอทำของหายแบบขำ ๆ'),
('ทำให้เพื่อนเสนอชื่อกลุ่มแชตใหม่สำหรับทริป'),
('ทำให้เพื่อนพูดคำว่า “สุดจัด”'),
('ทำให้เพื่อนเล่าว่าอยากมีพลังวิเศษอะไร'),
('ทำให้เพื่อนบอกเมนูที่ไม่ยอมกินเด็ดขาด'),
('ทำให้เพื่อนเลือกว่าจะอยู่ในหนังผีหรือหนังซอมบี้'),
('ทำให้เพื่อนบอกชื่อของหวานอย่างน้อยสี่อย่าง'),
('ทำให้เพื่อนพูดประโยค “ฉันไม่ได้เป็นคนแบบนั้น”'),
('ทำให้เพื่อนแนะนำเกมที่เคยติดงอมแงม'),
('ทำให้เพื่อนบอกอาชีพในฝันตอนเด็ก'),
('ทำให้เพื่อนเล่าเรื่องที่เคยเข้าใจผิดแบบฮา ๆ'),
('ทำให้เพื่อนพูดชื่อเพลงยุค 2000 อย่างน้อยสองเพลง'),
('ทำให้เพื่อนเลือกว่าจะเป็นแมวหรือหมาแล้วบอกเหตุผล'),
('ทำให้เพื่อนเล่าของสะสมแปลก ๆ ที่เคยมี'),
('ทำให้เพื่อนพูดว่า “เดี๋ยวนะ”'),
('ทำให้เพื่อนบอกชื่ออาหารอีสานสามเมนู'),
('ทำให้เพื่อนเล่าคำพูดติดปากของตัวเอง'),
('ทำให้เพื่อนแนะนำสถานที่เที่ยวที่ประทับใจ'),
('ทำให้เพื่อนเลือกว่าถูกหวยหรือหยุดงานได้หนึ่งเดือน'),
('ทำให้เพื่อนพูดว่า “งงมาก”'),
('ทำให้เพื่อนเล่าว่าเคยเก็บความลับเรื่องเซอร์ไพรส์อะไร'),
('ทำให้เพื่อนตั้งฉายาฮา ๆ ให้รถคันนี้'),
('ทำให้เพื่อนบอกชื่อสิ่งของสามอย่างที่มีสีชมพู'),
('ทำให้เพื่อนพูดคำว่า “ปลาวาฬ”'),
('ทำให้เพื่อนบอกชื่อซีรีส์ที่อยากแนะนำ'),
('ทำให้เพื่อนนึกชื่อแบรนด์รองเท้าสามแบรนด์'),
('ทำให้เพื่อนตั้งชื่อร้านอาหารในฝันของตัวเอง'),
('ทำให้เพื่อนทายว่าในทริปนี้ใครจะตื่นเช้าที่สุด'),
('ทำให้เพื่อนพูดชื่อของกินที่ขึ้นต้นด้วยตัว ก'),
('ทำให้เพื่อนเล่าว่าถ้าได้เงินฟรีจะซื้ออะไรเป็นอย่างแรก'),
('ทำให้เพื่อนพูดคำว่า “มะพร้าว”'),
('ทำให้เพื่อนบอกชื่อกิจกรรมที่อยากทำระหว่างทริป'),
('ทำให้เพื่อนเลือกเพลงที่เหมาะกับบรรยากาศตอนนี้'),
('ทำให้เพื่อนพูดชื่อเกมโชว์ทางทีวี'),
('ทำให้เพื่อนพูดว่า “ชนะแล้ว!” โดยไม่บอกใบ้ตรง ๆ')
on conflict (description) do nothing;

-- No direct writes. All mutations happen inside checked security-definer RPCs.
alter table public.trip_rooms enable row level security;
alter table public.trip_players enable row level security;
alter table public.trip_mission_bank enable row level security;
alter table public.trip_assignments enable row level security;

-- These helpers run with table-owner privileges to avoid recursive RLS policies.
create or replace function public.trip_is_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_players p
    where p.room_id = p_room_id and p.user_id = (select auth.uid())
  );
$$;

create or replace function public.trip_owns_player(p_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_players p
    where p.id = p_player_id and p.user_id = (select auth.uid())
  );
$$;

-- A room member sees participant names, their OWN unrevealed missions,
-- and EVERYONE'S completed missions. Nobody else sees unrevealed mission text.
drop policy if exists "trip room members" on public.trip_rooms;
create policy "trip room members" on public.trip_rooms
for select to authenticated using (public.trip_is_member(id));

drop policy if exists "trip participants" on public.trip_players;
create policy "trip participants" on public.trip_players
for select to authenticated using (public.trip_is_member(room_id));

drop policy if exists "trip own secret or revealed" on public.trip_assignments;
create policy "trip own secret or revealed" on public.trip_assignments
for select to authenticated using (
  public.trip_is_member(room_id)
  and (public.trip_owns_player(player_id) or completed_at is not null)
);

-- Public RPC functions available only to signed-in users (including Supabase
-- anonymous authenticated users). SECURITY DEFINER functions verify auth.uid().
create or replace function public.trip_create_room()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_room public.trip_rooms%rowtype;
  v_attempt int;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  for v_attempt in 1..10 loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.trip_rooms (code, created_by)
      values (v_code, auth.uid()) returning * into v_room;
      return jsonb_build_object('id', v_room.id, 'code', v_room.code);
    exception when unique_violation then
      -- Extremely unlikely: retry with a fresh random room code.
    end;
  end loop;
  raise exception 'ROOM_CREATION_FAILED';
end;
$$;

create or replace function public.trip_room_status(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.trip_rooms%rowtype;
  v_seats jsonb;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_room from public.trip_rooms
  where code = upper(trim(p_code));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'car', p.car_number, 'seat', p.seat_number
  ) order by p.car_number, p.seat_number), '[]'::jsonb)
    into v_seats from public.trip_players p where p.room_id = v_room.id;
  return jsonb_build_object('id',v_room.id,'code',v_room.code,'seats',v_seats);
end;
$$;

create or replace function public.trip_join_seat(
  p_code text, p_car int, p_seat int, p_nickname text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.trip_rooms%rowtype;
  v_player public.trip_players%rowtype;
  v_name text := trim(coalesce(p_nickname, ''));
  v_count int;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_car not between 1 and 4 or p_seat not between 1 and 4 then
    raise exception 'INVALID_SEAT';
  end if;
  if char_length(v_name) not between 2 and 24 then
    raise exception 'INVALID_NICKNAME';
  end if;

  -- One lock per room serializes joins so 3 tasks/player stay unique in that room.
  select * into v_room from public.trip_rooms
    where code = upper(trim(p_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  select * into v_player from public.trip_players
    where room_id = v_room.id and user_id = auth.uid();
  if found then
    return jsonb_build_object('room_id',v_room.id,'player_id',v_player.id,
      'car',v_player.car_number,'seat',v_player.seat_number);
  end if;

  if exists (select 1 from public.trip_players where room_id=v_room.id
    and car_number=p_car and seat_number=p_seat) then
    raise exception 'SEAT_TAKEN';
  end if;

  select count(*) into v_count from public.trip_mission_bank m
    where not exists (select 1 from public.trip_assignments a
      where a.room_id=v_room.id and a.mission_id=m.id);
  if v_count < 3 then raise exception 'NOT_ENOUGH_MISSIONS'; end if;

  insert into public.trip_players (room_id,user_id,car_number,seat_number,nickname)
    values (v_room.id,auth.uid(),p_car,p_seat,v_name) returning * into v_player;

  with picked as (
    select m.id, m.description
    from public.trip_mission_bank m
    where not exists (select 1 from public.trip_assignments a
      where a.room_id=v_room.id and a.mission_id=m.id)
    order by random() limit 3
  ), numbered as (
    select id, description, row_number() over (order by id) as card_no from picked
  )
  insert into public.trip_assignments
    (room_id,player_id,mission_id,card_number,mission_text)
    select v_room.id,v_player.id,id,card_no,description from numbered;

  return jsonb_build_object('room_id',v_room.id,'player_id',v_player.id,
    'car',v_player.car_number,'seat',v_player.seat_number);
end;
$$;

create or replace function public.trip_complete_mission(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.trip_assignments%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Can only complete own assigned mission. Completion is permanent.
  update public.trip_assignments a set completed_at=now()
  from public.trip_players p
  where a.id=p_assignment_id and a.player_id=p.id
    and p.user_id=auth.uid() and a.completed_at is null
  returning a.* into v_assignment;

  if not found then
    select a.* into v_assignment from public.trip_assignments a
      join public.trip_players p on p.id=a.player_id
      where a.id=p_assignment_id and p.user_id=auth.uid();
    if not found then raise exception 'NOT_YOUR_MISSION'; end if;
  end if;
  return jsonb_build_object('id',v_assignment.id,'completed_at',v_assignment.completed_at);
end;
$$;

-- Restrict direct table access. RLS is the second line of defense.
revoke all on public.trip_rooms, public.trip_players,
  public.trip_assignments, public.trip_mission_bank from anon;
revoke all on public.trip_rooms, public.trip_players,
  public.trip_assignments, public.trip_mission_bank from authenticated;
grant select on public.trip_rooms, public.trip_players, public.trip_assignments to authenticated;

-- PostgreSQL gives PUBLIC access to new functions unless revoked.
revoke all on function public.trip_is_member(uuid) from public, anon;
revoke all on function public.trip_owns_player(uuid) from public, anon;
revoke all on function public.trip_create_room() from public, anon;
revoke all on function public.trip_room_status(text) from public, anon;
revoke all on function public.trip_join_seat(text,int,int,text) from public, anon;
revoke all on function public.trip_complete_mission(uuid) from public, anon;
grant execute on function public.trip_is_member(uuid) to authenticated;
grant execute on function public.trip_owns_player(uuid) to authenticated;
grant execute on function public.trip_create_room() to authenticated;
grant execute on function public.trip_room_status(text) to authenticated;
grant execute on function public.trip_join_seat(text,int,int,text) to authenticated;
grant execute on function public.trip_complete_mission(uuid) to authenticated;

-- Enable postgres-change streams for near-instant progress updates.
-- Clients also refresh periodically if a phone temporarily loses signal.
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='trip_players') then
    alter publication supabase_realtime add table public.trip_players;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='trip_assignments') then
    alter publication supabase_realtime add table public.trip_assignments;
  end if;
end $$;
