drop table if exists public.ai_evaluations cascade;
drop table if exists public.metric_definitions cascade;
drop table if exists public.post_metric_snapshots cascade;
drop table if exists public.performance_summaries cascade;
drop table if exists public.weekly_reports cascade;
drop table if exists public.pricing_rules cascade;
drop table if exists public.usage_meters cascade;
drop table if exists public.cost_ledger cascade;
drop table if exists public.billing_accounts cascade;
drop table if exists public.billing_provider_events cascade;
drop table if exists public.worker_heartbeats cascade;
drop table if exists public.outbox_events cascade;
drop table if exists public.audit_logs cascade;

alter table if exists public.businesses
  drop column if exists autonomy_settings;

alter table if exists public.workspaces
  drop column if exists plan,
  drop column if exists billing_status,
  drop column if exists entitlements;

alter table if exists public.batches
  drop column if exists estimated_cost_usd,
  drop column if exists estimated_provider_cost_usd,
  drop column if exists confirmed_cost_usd,
  drop column if exists confirmed_price_version,
  drop column if exists confirmed_cost_breakdown;
