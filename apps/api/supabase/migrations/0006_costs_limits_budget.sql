create table if not exists public.pricing_rules (
  id text primary key,
  provider text not null,
  model text not null,
  operation text not null,
  unit_type text not null,
  unit_size double precision not null,
  dimensions jsonb,
  currency text not null default 'USD',
  unit_cost_usd double precision not null,
  customer_unit_price_usd double precision not null,
  price_version text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists pricing_rules_lookup_idx
  on public.pricing_rules (provider, model, operation, active, effective_from);

insert into public.pricing_rules (
  id,
  provider,
  model,
  operation,
  unit_type,
  unit_size,
  dimensions,
  unit_cost_usd,
  customer_unit_price_usd,
  price_version,
  effective_from,
  active
)
values (
  'price-local-generated-variant-v1',
  'local',
  'mock-image-caption-v1',
  'generated_variant',
  'image',
  1,
  '{"size":"1:1","quality":"mock","includesCaption":true}'::jsonb,
  0.002,
  0.01,
  'local-2026-05-01',
  '2026-05-01T00:00:00.000Z',
  true
)
on conflict (id) do nothing;

create table if not exists public.usage_meters (
  id text primary key,
  workspace_id text not null,
  metric text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  limit_value double precision,
  reserved_value double precision not null default 0,
  used_value double precision not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists usage_meters_workspace_metric_period_idx
  on public.usage_meters (workspace_id, metric, period_start);

create table if not exists public.cost_ledger (
  id text primary key,
  workspace_id text not null,
  business_id text,
  batch_id text,
  job_id text,
  variant_id text,
  operation text not null,
  operation_key text,
  entry_type text not null,
  usage_metric text,
  quantity double precision not null,
  price_version text not null,
  customer_cost_usd double precision not null,
  provider_cost_usd double precision not null,
  status text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists cost_ledger_operation_entry_idx
  on public.cost_ledger (operation_key, entry_type)
  where operation_key is not null;

alter table public.batches
  add column if not exists estimated_cost_usd double precision,
  add column if not exists estimated_provider_cost_usd double precision,
  add column if not exists confirmed_cost_usd double precision,
  add column if not exists confirmed_price_version text,
  add column if not exists confirmed_cost_breakdown jsonb,
  add column if not exists variants_per_photo integer;

alter table public.pricing_rules enable row level security;
alter table public.usage_meters enable row level security;
alter table public.cost_ledger enable row level security;

drop policy if exists pricing_rules_read_authenticated on public.pricing_rules;
create policy pricing_rules_read_authenticated on public.pricing_rules
  for select using (auth.uid() is not null);

drop policy if exists usage_meters_workspace_members on public.usage_meters;
create policy usage_meters_workspace_members on public.usage_meters
  for all using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = usage_meters.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );

drop policy if exists cost_ledger_workspace_members on public.cost_ledger;
create policy cost_ledger_workspace_members on public.cost_ledger
  for all using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = cost_ledger.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );
