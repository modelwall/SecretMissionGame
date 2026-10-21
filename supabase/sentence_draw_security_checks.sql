-- Secret Sentence Draw | read-only security and data-integrity audit
-- Run in Supabase SQL Editor after sentence_draw_migration.sql.

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
select session_id,submission_id,count(*) as draw_count
from public.sentence_draw_round_items
group by session_id,submission_id
having count(*) > 1;

select session_id,round_id,count(*) as item_count
from public.sentence_draw_round_items
group by session_id,round_id
having count(*) <> 3;

select s.id as session_id,s.status,s.current_round,
  count(distinct r.id) as round_count,
  count(i.id) as revealed_count,
  48-count(i.id) as calculated_remaining,
  ps.remaining_count as stored_remaining
from public.sentence_draw_sessions s
join public.sentence_draw_public_state ps on ps.session_id=s.id
left join public.sentence_draw_rounds r on r.session_id=s.id
left join public.sentence_draw_round_items i on i.round_id=r.id
group by s.id,s.status,s.current_round,ps.remaining_count
having count(distinct r.id) <> s.current_round
  or count(i.id) <> s.current_round*3
  or 48-count(i.id) <> ps.remaining_count;

select 'Secret Sentence Draw security and integrity checks passed' as result;
