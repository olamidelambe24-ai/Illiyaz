-- Kobo — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Project → SQL Editor → New query → paste → Run)

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  category text not null,
  description text,
  payment text,
  amount numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  date date not null,
  amount numeric not null default 0,
  current_value numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  month text not null default to_char(now(), 'YYYY-MM'),
  budgets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: every user can only ever see or touch their own rows.
alter table expenses enable row level security;
alter table investments enable row level security;
alter table user_settings enable row level security;

create policy "Users manage their own expenses"
  on expenses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own investments"
  on investments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own settings"
  on user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Helpful indexes
create index if not exists expenses_user_date_idx on expenses (user_id, date desc);
create index if not exists investments_user_date_idx on investments (user_id, date desc);
