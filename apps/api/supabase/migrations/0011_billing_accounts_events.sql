create table public.billing_accounts (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('manual', 'stripe', 'mercado_pago')),
  provider_customer_id text,
  provider_subscription_id text,
  provider_subscription_item_id text,
  provider_price_id text,
  plan text not null check (plan in ('piloto', 'starter', 'pro', 'agency')),
  billing_status text not null check (billing_status in ('trial', 'active', 'past_due', 'paused', 'cancelled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index billing_accounts_workspace_id_idx
  on public.billing_accounts (workspace_id);

create unique index billing_accounts_workspace_provider_idx
  on public.billing_accounts (workspace_id, provider);

create table public.billing_provider_events (
  id text primary key default gen_random_uuid()::text,
  provider text not null check (provider in ('manual', 'stripe', 'mercado_pago')),
  provider_event_id text not null,
  workspace_id text references public.workspaces(id) on delete set null,
  type text not null,
  status text not null check (status in ('received', 'processed', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create unique index billing_provider_events_provider_event_idx
  on public.billing_provider_events (provider, provider_event_id);

create index billing_provider_events_workspace_idx
  on public.billing_provider_events (workspace_id);

alter table public.billing_accounts enable row level security;
alter table public.billing_provider_events enable row level security;

create policy billing_accounts_owner_read
  on public.billing_accounts for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = billing_accounts.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  );

create policy billing_provider_events_owner_read
  on public.billing_provider_events for select
  to authenticated
  using (
    workspace_id is not null and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = billing_provider_events.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  );
