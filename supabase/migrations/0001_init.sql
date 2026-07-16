-- TabBurrow cloud schema: profiles, collections, links.
-- Source of truth for the shared logical schema is docs/specs/2026-07-15-tabburrow-design.md §5.
-- created_at/updated_at on collections/links are epoch-ms bigints (client-generated,
-- matching packages/core's local Dexie schema); deleted_at is a tombstone (null = live).

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro')),
  stripe_customer_id text,
  stripe_subscription_id text,
  ai_uses_period_start date not null default date_trunc('month', now())::date,
  ai_uses_count int not null default 0,
  created_at timestamptz not null default now()
);

create table public.collections (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  accent text,
  position text not null,
  is_shared boolean not null default false,
  share_slug text unique,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create table public.links (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid not null,
  url text not null,
  title text not null,
  favicon_url text,
  note text,
  tags text[] not null default '{}',
  position text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create index on public.collections (user_id, updated_at);
create index on public.links (user_id, updated_at);

-- Share pages resolve by share_slug (read via the share-resolve Edge Function using the
-- service role, not this index's RLS); partial index keeps it small since most rows are
-- never shared.
create index on public.collections (share_slug) where share_slug is not null;

alter table public.profiles enable row level security;
alter table public.collections enable row level security;
alter table public.links enable row level security;

-- Select-only by design: profiles are never written to directly by users. plan,
-- stripe_*, and ai_uses_* are only ever mutated by service-role Edge Functions
-- (stripe-webhook, ai-organize), so there is no insert/update/delete policy here.
create policy "own profile read" on public.profiles for select using (auth.uid() = user_id);

create policy "own rows" on public.collections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No anon read policies: share pages read via service role in the web app only.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (user_id) values (new.id); return new; end; $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();
