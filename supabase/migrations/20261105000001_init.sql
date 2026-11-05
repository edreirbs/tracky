-- Tracky: esquema inicial (spec 001, 002, 003, 004; ADR-0002, 0005, 0008).
-- Todas las tablas con RLS por user_id = auth.uid(). Las monedas solo se mueven con funciones
-- security definer; el cliente no puede escribir en coin_ledger.

-- ---------------------------------------------------------------------------------------------
-- Acceso: lista de correos permitidos (la llena la configuración inicial)
-- ---------------------------------------------------------------------------------------------
create table public.allowed_emails (
  email text primary key check (email = lower(email) and position('@' in email) > 1)
);
alter table public.allowed_emails enable row level security; -- sin políticas: solo service_role

create or replace function public.tracky_enforce_allowlist() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.allowed_emails a where a.email = lower(coalesce(new.email, ''))) then
    raise exception 'Correo no autorizado para esta instancia de Tracky' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Perfil y reglas
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  timezone text not null default 'America/Mexico_City' check (char_length(timezone) <= 64),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Valores de la spec 003 § 2 (aprobados 2026-11-05). Ajustables por usuario dentro de límites.
create table public.coin_rules (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rules jsonb not null default '{
    "base": {"XS": 5, "S": 10, "M": 20, "L": 40},
    "frog_multiplier": 2,
    "start_bonus": 5,
    "streak_step": 0.10,
    "streak_cap": 0.50,
    "chest_every": 8,
    "chest_min": 5,
    "chest_max": 15,
    "step_coins": 2,
    "max_steps": 10,
    "quick_seconds": 120,
    "daily_cap": 300,
    "undo_hours": 24
  }'::jsonb
);

-- ---------------------------------------------------------------------------------------------
-- Etiquetas, personas
-- ---------------------------------------------------------------------------------------------
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 600),
  signals text[] not null default '{}',
  is_fallback boolean not null default false,
  color smallint not null default 0 check (color between 0 and 5),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create unique index tags_one_fallback on public.tags (user_id) where is_fallback;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  color smallint not null default 0 check (color between 0 and 5),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------------------------------------
-- Notas (reuniones y notas sueltas del Archivo)
-- ---------------------------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'memo' check (kind in ('meeting', 'memo')),
  meeting_id text check (char_length(meeting_id) <= 64),
  title text not null check (char_length(title) between 1 and 200),
  tag_id uuid references public.tags (id) on delete set null,
  labels text[] not null default '{}',
  estado text not null default 'Normal' check (estado in ('Normal', 'Importante')),
  status text not null default 'saved' check (status in ('saved', 'summary_failed')),
  pinned boolean not null default false,
  body text check (char_length(body) <= 100000),
  summary_md text,
  key_points jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  next_steps text,
  transcript jsonb,
  transcript_text text,
  started_at timestamptz,
  duration_s integer,
  mode text check (mode in ('online', 'in_person')),
  template text,
  model text,
  usage jsonb,
  tag_confidence real,
  tag_alternatives text[] not null default '{}',
  search tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(summary_md, '') || ' ' || coalesce(body, '') || ' ' || coalesce(next_steps, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(transcript_text, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meeting_id),
  check ((kind = 'meeting') = (meeting_id is not null))
);
create index notes_user_created on public.notes (user_id, created_at desc);
create index notes_search on public.notes using gin (search);

-- ---------------------------------------------------------------------------------------------
-- Contactos (Archivo)
-- ---------------------------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  company text check (char_length(company) <= 120),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 160),
  person_id uuid references public.people (id) on delete set null,
  labels text[] not null default '{}',
  body text check (char_length(body) <= 5000),
  pinned boolean not null default false,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(body, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_search on public.contacts using gin (search);

-- ---------------------------------------------------------------------------------------------
-- Tareas (spec 002)
-- ---------------------------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id text check (char_length(client_id) <= 64),
  text text not null check (char_length(text) between 1 and 500),
  action text check (char_length(action) <= 500),
  notes text check (char_length(notes) <= 5000),
  person_id uuid references public.people (id) on delete set null,
  status text not null default 'inbox' check (status in ('inbox', 'now', 'next', 'waiting', 'done', 'archived')),
  prev_status text check (prev_status in ('inbox', 'now', 'next', 'waiting', 'archived')),
  due date,
  blocking boolean not null default false,
  follow_up date,
  waiting_on text check (char_length(waiting_on) <= 120),
  size text not null default 'S' check (size in ('XS', 'S', 'M', 'L')),
  energy text check (energy in ('low', 'medium', 'high')),
  estimate_min integer check (estimate_min between 1 and 1440),
  actual_min integer check (actual_min between 0 and 10000),
  tomorrow boolean not null default false,
  is_frog boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'meeting', 'assistant')),
  note_id uuid references public.notes (id) on delete set null,
  parent_id uuid references public.tasks (id) on delete cascade,
  sort double precision not null default 0,
  search tsvector generated always as (
    to_tsvector('spanish', coalesce(text, '') || ' ' || coalesce(action, '') || ' ' || coalesce(notes, '') || ' ' || coalesce(waiting_on, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  unique (user_id, client_id)
);
create index tasks_user_status on public.tasks (user_id, status, sort);
create index tasks_search on public.tasks using gin (search);

-- Terminar o reabrir solo con complete_task / uncomplete_task (las monedas dependen de ello).
create or replace function public.tracky_guard_task_status() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('tracky.via_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status = 'done' then
    raise exception 'Usa complete_task() para terminar tareas' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and ((old.status = 'done') is distinct from (new.status = 'done')) then
    raise exception 'Usa complete_task() / uncomplete_task() para cambiar el estado de terminado' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger tasks_guard before insert or update on public.tasks
  for each row execute function public.tracky_guard_task_status();

create or replace function public.tracky_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger notes_touch before update on public.notes for each row execute function public.tracky_touch();
create trigger contacts_touch before update on public.contacts for each row execute function public.tracky_touch();

-- ---------------------------------------------------------------------------------------------
-- Economía (spec 003; ADR-0008)
-- ---------------------------------------------------------------------------------------------
create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  emoji text not null default '🎁' check (char_length(emoji) <= 16),
  cost integer not null check (cost between 10 and 100000),
  minutes integer check (minutes between 1 and 1440),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null check (amount between -100000 and 100000),
  kind text not null check (kind in ('task', 'step', 'undo', 'redeem', 'adjust')),
  task_id uuid,
  reward_id uuid,
  reverses uuid references public.coin_ledger (id),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 80),
  breakdown jsonb not null default '{}'::jsonb,
  local_day date not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index coin_ledger_user_day on public.coin_ledger (user_id, local_day);
create index coin_ledger_task on public.coin_ledger (task_id);
create unique index coin_ledger_one_reversal on public.coin_ledger (reverses) where reverses is not null;

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reward_id uuid references public.rewards (id) on delete set null,
  name text not null,
  cost integer not null,
  minutes integer,
  ledger_id uuid not null references public.coin_ledger (id),
  started_at timestamptz not null default now(),
  ends_at timestamptz
);

-- ---------------------------------------------------------------------------------------------
-- Asistente (spec 004)
-- ---------------------------------------------------------------------------------------------
create table public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Conversación' check (char_length(title) <= 120),
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger threads_touch before update on public.assistant_threads for each row execute function public.tracky_touch();

-- ---------------------------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','coin_rules','tags','people','notes','contacts','tasks','rewards',
                           'coin_ledger','redemptions','assistant_threads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;
  -- CRUD completo sobre lo propio
  foreach t in array array['tags','people','notes','contacts','tasks','rewards','assistant_threads'] loop
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format($p$create policy own_rows on public.%I for all to authenticated
                     using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
  end loop;
  -- Solo lectura (se escriben con funciones)
  foreach t in array array['coin_ledger','redemptions'] loop
    execute format('grant select on table public.%I to authenticated', t);
    execute format($p$create policy own_rows_read on public.%I for select to authenticated
                     using (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;

grant select, update on table public.profiles to authenticated;
create policy own_profile on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, update on table public.coin_rules to authenticated;
create policy own_rules on public.coin_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Alta de usuario: lista de permitidos + perfil, reglas y recompensas por defecto
-- ---------------------------------------------------------------------------------------------
create or replace function public.tracky_on_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.coin_rules (user_id) values (new.id) on conflict do nothing;
  insert into public.rewards (user_id, name, emoji, cost, minutes, sort) values
    (new.id, '15 min de tiempo libre', '☕', 30, 15, 1),
    (new.id, '30 min de tiempo libre', '🌿', 55, 30, 2),
    (new.id, '1 h de tiempo libre', '🎮', 100, 60, 3);
  return new;
end $$;

create trigger tracky_allowlist before insert on auth.users
  for each row execute function public.tracky_enforce_allowlist();
create trigger tracky_new_user after insert on auth.users
  for each row execute function public.tracky_on_new_user();

-- ---------------------------------------------------------------------------------------------
-- Funciones de la economía
-- ---------------------------------------------------------------------------------------------
create or replace function public.tracky_uid() returns uuid
language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  return u;
end $$;

create or replace function public.tracky_today(p_user uuid) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone coalesce((select timezone from public.profiles where user_id = p_user), 'America/Mexico_City'))::date
$$;

create or replace function public.tracky_rules(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select rules from public.coin_rules where user_id = p_user), '{}'::jsonb)
$$;

-- Días con al menos una tarea cobrada (no revertida).
create or replace function public.tracky_active_day(p_user uuid, p_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.coin_ledger l
    where l.user_id = p_user and l.local_day = p_day and l.kind = 'task'
      and not exists (select 1 from public.coin_ledger r where r.reverses = l.id)
  )
$$;

-- Racha: días seguidos (hasta ayer, más hoy si ya hay) con 1 día de gracia por cada 7 (R4).
create or replace function public.tracky_streak(p_user uuid) returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d date := public.tracky_today(p_user) - 1;
  days integer := 0;
  since_grace integer := 7;
  i integer;
begin
  for i in 1..400 loop
    if public.tracky_active_day(p_user, d) then
      days := days + 1;
      since_grace := since_grace + 1;
    elsif since_grace >= 7 and days > 0 and public.tracky_active_day(p_user, d - 1) then
      since_grace := 0; -- día de gracia: no rompe la racha
    else
      exit;
    end if;
    d := d - 1;
  end loop;
  if public.tracky_active_day(p_user, public.tracky_today(p_user)) then
    days := days + 1;
  end if;
  return days;
end $$;

create or replace function public.tracky_level(p_lifetime integer) returns jsonb
language plpgsql immutable as $$
declare
  thresholds integer[] := array[0, 100, 300, 700, 1500, 3000];
  lvl integer := 1;
  nxt integer;
  i integer;
begin
  while thresholds[array_length(thresholds, 1)] <= p_lifetime loop
    thresholds := thresholds || (thresholds[array_length(thresholds, 1)] * 2);
  end loop;
  for i in 1..array_length(thresholds, 1) loop
    if p_lifetime >= thresholds[i] then lvl := i; end if;
  end loop;
  nxt := thresholds[lvl + 1];
  return jsonb_build_object('level', lvl, 'floor', thresholds[lvl], 'next', nxt);
end $$;

create or replace function public.my_wallet() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.tracky_uid();
  today date := public.tracky_today(u);
  bal integer;
  lifetime integer;
  earned_today integer;
begin
  select coalesce(sum(amount), 0) into bal from public.coin_ledger where user_id = u;
  select coalesce(sum(l.amount), 0) into lifetime from public.coin_ledger l
    where l.user_id = u and l.kind in ('task', 'step') and not exists (select 1 from public.coin_ledger r where r.reverses = l.id);
  select coalesce(sum(amount), 0) into earned_today from public.coin_ledger
    where user_id = u and local_day = today and kind in ('task', 'step', 'undo') and (kind <> 'undo' or task_id is not null);
  return jsonb_build_object(
    'balance', bal, 'lifetime', lifetime, 'earned_today', earned_today,
    'streak', public.tracky_streak(u), 'level', public.tracky_level(lifetime),
    'daily_cap', (public.tracky_rules(u) ->> 'daily_cap')::integer);
end $$;

create or replace function public.complete_task(p_task_id uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.tracky_uid();
  r jsonb := public.tracky_rules(u);
  today date := public.tracky_today(u);
  t public.tasks%rowtype;
  prior public.coin_ledger%rowtype;
  v_kind text := 'task';
  base integer;
  frog boolean := false;
  quick boolean := false;
  streak integer := 0;
  streak_pct numeric := 0;
  start_bonus integer := 0;
  chest integer := 0;
  total integer;
  earned_today integer;
  cap integer;
  capped boolean := false;
  already_paid boolean := false;
  lid uuid;
  breakdown jsonb;
begin
  -- Idempotencia: la misma llave devuelve el mismo resultado.
  select * into prior from public.coin_ledger where user_id = u and idempotency_key = p_key;
  if found then
    return jsonb_build_object('coins', prior.amount, 'breakdown', prior.breakdown, 'repeated', true) || jsonb_build_object('wallet', public.my_wallet());
  end if;

  select * into t from public.tasks where id = p_task_id and user_id = u for update;
  if not found then raise exception 'Tarea no encontrada' using errcode = 'P0002'; end if;
  if t.status = 'done' then
    return jsonb_build_object('coins', 0, 'breakdown', '{}'::jsonb, 'repeated', true, 'wallet', public.my_wallet());
  end if;

  -- Una tarea solo paga una vez (salvo que se haya deshecho su cobro).
  already_paid := exists (
    select 1 from public.coin_ledger l where l.user_id = u and l.task_id = t.id and l.kind in ('task', 'step')
      and not exists (select 1 from public.coin_ledger x where x.reverses = l.id));

  if t.parent_id is not null then
    v_kind := 'step';
    base := case when (select count(*) from public.tasks s where s.parent_id = t.parent_id and s.status = 'done') >= (r ->> 'max_steps')::integer
                 then 0 else (r ->> 'step_coins')::integer end;
  else
    quick := t.source <> 'meeting' and now() - t.created_at < make_interval(secs => (r ->> 'quick_seconds')::integer);
    base := (r -> 'base' ->> (case when quick then 'XS' else t.size end))::integer;
    if not quick then
      frog := t.is_frog and not exists (
        select 1 from public.coin_ledger l where l.user_id = u and l.local_day = today and (l.breakdown ->> 'frog')::boolean
          and not exists (select 1 from public.coin_ledger x where x.reverses = l.id));
      -- La bonificación cuenta los días seguidos anteriores a hoy.
      streak := public.tracky_streak(u) - (case when public.tracky_active_day(u, today) then 1 else 0 end);
      streak_pct := least((r ->> 'streak_cap')::numeric, (r ->> 'streak_step')::numeric * streak);
      if not public.tracky_active_day(u, today) then start_bonus := (r ->> 'start_bonus')::integer; end if;
      if random() < 1.0 / greatest(1, (r ->> 'chest_every')::integer) then
        chest := (r ->> 'chest_min')::integer + floor(random() * ((r ->> 'chest_max')::integer - (r ->> 'chest_min')::integer + 1))::integer;
      end if;
    end if;
  end if;

  if already_paid then
    total := 0; base := 0; frog := false; start_bonus := 0; chest := 0; streak_pct := 0;
  else
    total := round(base * (case when frog then (r ->> 'frog_multiplier')::numeric else 1 end) * (1 + streak_pct))::integer
             + start_bonus + chest;
  end if;

  select coalesce(sum(amount), 0) into earned_today from public.coin_ledger
    where user_id = u and local_day = today and (kind in ('task', 'step') or (kind = 'undo' and task_id is not null));
  cap := (r ->> 'daily_cap')::integer;
  if total > greatest(0, cap - earned_today) then
    total := greatest(0, cap - earned_today);
    capped := true;
  end if;

  breakdown := jsonb_build_object(
    'size', t.size, 'base', base, 'frog', frog, 'quick', quick, 'streak_days', streak,
    'streak_pct', streak_pct, 'start_bonus', start_bonus, 'chest', chest, 'capped', capped,
    'already_paid', already_paid, 'step', v_kind = 'step', 'parent_id', t.parent_id);

  perform set_config('tracky.via_rpc', 'on', true);
  update public.tasks set prev_status = status, status = 'done', done_at = now(), tomorrow = false where id = t.id;
  perform set_config('tracky.via_rpc', '', true);

  insert into public.coin_ledger (user_id, amount, kind, task_id, idempotency_key, breakdown, local_day)
    values (u, total, v_kind, t.id, p_key, breakdown, today) returning id into lid;

  return jsonb_build_object('coins', total, 'breakdown', breakdown, 'ledger_id', lid, 'repeated', false,
                            'wallet', public.my_wallet());
end $$;

create or replace function public.uncomplete_task(p_task_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.tracky_uid();
  r jsonb := public.tracky_rules(u);
  t public.tasks%rowtype;
  l public.coin_ledger%rowtype;
  reverted integer := 0;
begin
  select * into t from public.tasks where id = p_task_id and user_id = u for update;
  if not found then raise exception 'Tarea no encontrada' using errcode = 'P0002'; end if;
  if t.status <> 'done' then
    return jsonb_build_object('reverted', 0, 'wallet', public.my_wallet());
  end if;

  select * into l from public.coin_ledger x
    where x.user_id = u and x.task_id = t.id and x.kind in ('task', 'step')
      and not exists (select 1 from public.coin_ledger y where y.reverses = x.id)
    order by created_at desc limit 1;
  if found and l.created_at > now() - make_interval(hours => (r ->> 'undo_hours')::integer) then
    insert into public.coin_ledger (user_id, amount, kind, task_id, reverses, idempotency_key, breakdown, local_day)
      values (u, -l.amount, 'undo', t.id, l.id, 'undo:' || l.id, jsonb_build_object('reverses', l.id), l.local_day);
    reverted := l.amount;
  end if;

  perform set_config('tracky.via_rpc', 'on', true);
  update public.tasks set status = coalesce(prev_status, 'next'), prev_status = null, done_at = null where id = t.id;
  perform set_config('tracky.via_rpc', '', true);

  return jsonb_build_object('reverted', reverted, 'wallet', public.my_wallet());
end $$;

create or replace function public.redeem_reward(p_reward_id uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.tracky_uid();
  rw public.rewards%rowtype;
  bal integer;
  lid uuid;
  rid uuid;
  ends timestamptz;
begin
  if exists (select 1 from public.coin_ledger where user_id = u and idempotency_key = p_key) then
    return jsonb_build_object('repeated', true, 'wallet', public.my_wallet());
  end if;
  select * into rw from public.rewards where id = p_reward_id and user_id = u and active;
  if not found then raise exception 'Recompensa no encontrada' using errcode = 'P0002'; end if;

  perform pg_advisory_xact_lock(hashtext(u::text));
  select coalesce(sum(amount), 0) into bal from public.coin_ledger where user_id = u;
  if bal < rw.cost then
    raise exception 'Saldo insuficiente: tienes % y cuesta %', bal, rw.cost using errcode = 'P0001', hint = 'saldo_insuficiente';
  end if;

  insert into public.coin_ledger (user_id, amount, kind, reward_id, idempotency_key, breakdown, local_day)
    values (u, -rw.cost, 'redeem', rw.id, p_key, jsonb_build_object('name', rw.name), public.tracky_today(u))
    returning id into lid;
  ends := case when rw.minutes is null then null else now() + make_interval(mins => rw.minutes) end;
  insert into public.redemptions (user_id, reward_id, name, cost, minutes, ledger_id, ends_at)
    values (u, rw.id, rw.name, rw.cost, rw.minutes, lid, ends) returning id into rid;

  return jsonb_build_object('redemption_id', rid, 'ends_at', ends, 'repeated', false, 'wallet', public.my_wallet());
end $$;

-- Búsqueda unificada para Ctrl+K y el asistente (respeta RLS: security invoker).
create or replace function public.search_everything(p_query text, p_limit integer default 20)
returns table (kind text, id uuid, title text, snippet text, rank real, created_at timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  with q as (select websearch_to_tsquery('spanish', p_query) as sp, websearch_to_tsquery('simple', p_query) as si)
  select * from (
    select case when n.kind = 'meeting' then 'meeting' else 'memo' end, n.id, n.title,
           left(coalesce(n.summary_md, n.body, ''), 240), ts_rank(n.search, q.sp), n.created_at
      from public.notes n, q where n.search @@ q.sp
    union all
    select 'task', t.id, t.text, left(coalesce(t.action, t.notes, ''), 240), ts_rank(t.search, q.sp), t.created_at
      from public.tasks t, q where t.search @@ q.sp
    union all
    select 'contact', c.id, c.name, left(concat_ws(' · ', c.company, c.email, c.phone), 240), ts_rank(c.search, q.si), c.created_at
      from public.contacts c, q where c.search @@ q.si
  ) s order by 5 desc, 6 desc limit least(greatest(p_limit, 1), 50)
$$;

-- Permisos de funciones
revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_wallet() to authenticated;
grant execute on function public.complete_task(uuid, text) to authenticated;
grant execute on function public.uncomplete_task(uuid) to authenticated;
grant execute on function public.redeem_reward(uuid, text) to authenticated;
grant execute on function public.search_everything(text, integer) to authenticated;
grant execute on function public.tracky_uid() to authenticated;
