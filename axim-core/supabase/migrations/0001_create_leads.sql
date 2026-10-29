-- AXiM Core: leads table (Phase 1). Run in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  test_id          text not null unique,
  source           text not null default 'speedreport.org',
  lead_type        text not null default 'telemetry',
  email            text,
  zip_code         text,
  isp              text,
  colo             text,
  metrics          jsonb not null default '{}'::jsonb,   -- latency, download, upload, jitter, bufferbloat
  sla_status       jsonb not null default '{}'::jsonb,
  prospect_eval    jsonb not null default '{}'::jsonb,   -- isFiberProspect, ispTier, opportunityScore, reason[]
  raw_payload      jsonb not null default '{}'::jsonb,
  opportunity_score integer,
  lead_score       numeric,                              -- reserved for Phase 2 predictive scoring
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists leads_email_idx on public.leads (email);
create index if not exists leads_zip_idx on public.leads (zip_code);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_metrics_gin on public.leads using gin (metrics);

create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

-- Only the service role (the Core API) may touch leads.
alter table public.leads enable row level security;
