-- Skimmer Co-Pilot Tables
-- Run this in your Supabase SQL Editor

create table if not exists public.project_insights (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null unique references public.jobs(id) on delete cascade,
    health_score integer default 0,
    success_probability float default 0,
    delay_risk float default 0,
    team_efficiency float default 0,
    change_value integer default 0,
    last_updated timestamptz default now(),
    created_at timestamptz default now()
);

create table if not exists public.project_tasks (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references public.jobs(id) on delete cascade,
    role text,
    title text not null,
    description text,
    status text default 'pending',
    assigned_to uuid references public.profiles(user_id),
    expected_days integer default 1,
    weight integer default 1,
    version integer default 1,
    is_active boolean default true,
    created_at timestamptz default now()
);

create table if not exists public.project_health_history (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references public.jobs(id) on delete cascade,
    health_score integer default 0,
    change_value integer default 0,
    created_at timestamptz default now()
);

create table if not exists public.project_activity_log (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references public.jobs(id) on delete cascade,
    type text,
    priority text default 'normal',
    message text,
    created_at timestamptz default now()
);
