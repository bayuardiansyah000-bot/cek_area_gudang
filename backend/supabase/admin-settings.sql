create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;
