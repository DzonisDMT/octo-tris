-- OCTO-TRIS player identity migration. Run in Supabase SQL Editor before using the updated game.
create extension if not exists pgcrypto;
create table if not exists public.octotris_players (
 id uuid primary key default gen_random_uuid(),
 octavio_id text not null unique,
 nickname text not null check(char_length(nickname) between 1 and 16),
 created_at timestamptz not null default now()
);
alter table public.octotris_scores add column if not exists player_id uuid references public.octotris_players(id);
create index if not exists octotris_scores_player_id_idx on public.octotris_scores(player_id);
alter table public.octotris_players enable row level security;
revoke all on public.octotris_players from anon, authenticated;
create or replace function public.octotris_register_player(p_nickname text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare new_id uuid:=gen_random_uuid(); new_code text; clean_name text;
begin
 clean_name:=left(regexp_replace(trim(p_nickname),'[^a-zA-Z0-9 _-]','','g'),16);
 if char_length(clean_name)<1 then raise exception 'Please enter a valid nickname.'; end if;
 loop
  new_code:='OCTO-'||upper(substr(encode(gen_random_bytes(8),'hex'),1,5))||'-'||upper(substr(encode(gen_random_bytes(8),'hex'),1,4))||'-'||upper(substr(encode(gen_random_bytes(8),'hex'),1,4));
  exit when not exists(select 1 from public.octotris_players where octavio_id=new_code);
 end loop;
 insert into public.octotris_players(id,octavio_id,nickname) values(new_id,new_code,clean_name);
 return jsonb_build_object('player_id',new_id,'octavio_id',new_code,'nickname',clean_name);
end $$;
create or replace function public.octotris_update_nickname(p_player_id uuid,p_octavio_id text,p_nickname text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare clean_name text;
begin
 clean_name:=left(regexp_replace(trim(p_nickname),'[^a-zA-Z0-9 _-]','','g'),16);
 if char_length(clean_name)<1 then raise exception 'Please enter a valid nickname.'; end if;
 update public.octotris_players set nickname=clean_name where id=p_player_id and octavio_id=p_octavio_id;
 if not found then raise exception 'Player profile not found.'; end if;
 return jsonb_build_object('ok',true,'nickname',clean_name);
end $$;
grant execute on function public.octotris_register_player(text) to anon;
grant execute on function public.octotris_update_nickname(uuid,text,text) to anon;
create or replace view public.octotris_public_scores as
select s.id,p.nickname,s.score,s.lines,s.level,s.created_at,
 left(p.octavio_id,9)||'…'||right(p.octavio_id,4) as masked_octavio_id
from public.octotris_scores s join public.octotris_players p on p.id=s.player_id;
revoke all on public.octotris_scores from anon;
grant insert on public.octotris_scores to anon;
grant select on public.octotris_public_scores to anon;
drop policy if exists "Public can read OCTO-TRIS scores" on public.octotris_scores;
drop policy if exists "Public can submit OCTO-TRIS scores" on public.octotris_scores;
create policy "Public can submit OCTO-TRIS scores" on public.octotris_scores for insert to anon
with check(player_id is not null and score between 1 and 100000000 and lines between 0 and 100000 and level between 1 and 1000);
