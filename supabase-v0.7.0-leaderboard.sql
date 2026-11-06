-- OCTO-TRIS v0.7.0 leaderboard RPC.
-- Apply in Supabase SQL Editor before deploying the matching index.html.
-- Keeps anonymous users away from the base score table and returns only masked public fields.

create or replace function public.octotris_leaderboard(
  p_period text default 'all',
  p_limit integer default 20
)
returns table (
  rank integer,
  nickname text,
  score bigint,
  created_at timestamptz,
  masked_octavio_id text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := null;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  if p_period not in ('daily', 'weekly', 'all') then
    raise exception 'Invalid leaderboard period.';
  end if;

  if p_period = 'daily' then
    v_since := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  elsif p_period = 'weekly' then
    v_since := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  end if;

  return query
  with period_scores as (
    select
      s.player_id,
      p.nickname,
      s.score::bigint as score,
      s.created_at,
      left(p.octavio_id, 9) || '…' || right(p.octavio_id, 4) as masked_id,
      row_number() over (
        partition by s.player_id
        order by s.score desc, s.created_at asc, s.id asc
      ) as player_best_rank
    from public.octotris_scores s
    join public.octotris_players p on p.id = s.player_id
    where s.player_id is not null
      and (v_since is null or s.created_at >= v_since)
  ),
  best_per_player as (
    select *
    from period_scores
    where player_best_rank = 1
  )
  select
    (row_number() over (order by b.score desc, b.created_at asc, b.player_id))::integer,
    b.nickname,
    b.score,
    b.created_at,
    b.masked_id
  from best_per_player b
  order by b.score desc, b.created_at asc, b.player_id
  limit v_limit;
end;
$$;

revoke all on function public.octotris_leaderboard(text, integer) from public;
grant execute on function public.octotris_leaderboard(text, integer) to anon, authenticated;
