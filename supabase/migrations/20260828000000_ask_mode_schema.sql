-- SwasthTrack Ask Mode Schema Migration
-- Creates ask_sessions, ask_messages, and ask_query_events tables with RLS policies and RPC functions

create table if not exists ask_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  patient_id uuid references patients(id),
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table if not exists ask_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references ask_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  message_text text not null,
  created_at timestamptz not null default now()
);

create table if not exists ask_query_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references ask_sessions(id) on delete cascade,
  intent text not null,
  patient_id uuid references patients(id),
  date_range jsonb,
  operation text not null,
  status text not null check (status in ('success','no_data','unauthorized','ambiguous','failed','unsupported')),
  data_points_used int,
  understanding_confidence numeric(3,2),
  data_confidence text check (data_confidence in ('high','medium','low')),
  latency_ms int,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_query_events_patient_date on ask_query_events (patient_id, created_at desc);
create index if not exists idx_ask_sessions_user_active on ask_sessions (user_id, last_active_at desc);
create index if not exists idx_ask_messages_session on ask_messages (session_id, created_at asc);

-- RLS Policies
alter table ask_sessions enable row level security;
alter table ask_messages enable row level security;
alter table ask_query_events enable row level security;

create policy "Users can access own ask sessions"
  on ask_sessions for all
  using (user_id = auth.uid());

create policy "Users can access messages from own ask sessions"
  on ask_messages for all
  using (
    session_id in (select id from ask_sessions where user_id = auth.uid())
  );

create policy "Users can access own ask query events"
  on ask_query_events for all
  using (
    session_id in (select id from ask_sessions where user_id = auth.uid())
  );

-- Parameterized Security Invoker RPC for Blood Pressure on Date
create or replace function get_bp_on_date(p_patient_id uuid, p_date date)
returns table(
  reading_type text,
  systolic int,
  diastolic int,
  pulse int,
  measured_at timestamptz,
  notes text
)
language sql security invoker as $$
  select
    reading_type,
    systolic,
    diastolic,
    pulse,
    measured_at,
    notes
  from bp_logs
  where patient_id = p_patient_id
    and measured_at::date = p_date
  order by measured_at asc;
$$;
