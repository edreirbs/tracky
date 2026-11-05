-- Latido diario (spec 005 FR-410, ADR-0011): evita que el plan gratuito de Supabase pause el proyecto
-- tras 7 días sin actividad. Lo llama una función programada de Netlify con la publishable key.
-- No toca datos de nadie: solo actualiza un renglón técnico.

create table public.heartbeat (
  id smallint primary key default 1 check (id = 1),
  beat_at timestamptz not null default now(),
  beats bigint not null default 0
);
alter table public.heartbeat enable row level security; -- sin políticas: nadie lo lee directo
revoke all on table public.heartbeat from anon, authenticated;

create or replace function public.tracky_heartbeat() returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare t timestamptz;
begin
  insert into public.heartbeat (id, beat_at, beats) values (1, now(), 1)
  on conflict (id) do update set beat_at = now(), beats = public.heartbeat.beats + 1
  returning beat_at into t;
  return t;
end $$;

revoke execute on function public.tracky_heartbeat() from public;
grant execute on function public.tracky_heartbeat() to anon, authenticated;
