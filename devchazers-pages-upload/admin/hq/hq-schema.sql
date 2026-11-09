-- ============================================================================
-- DevChazers HQ — schema v1.1  (idempotent, strictly additive)
-- ----------------------------------------------------------------------------
-- Run this in Supabase → SQL Editor when you want HQ data stored in the cloud
-- and server-side publishing enabled. It is safe to run more than once.
--
-- It NEVER touches an existing table, column, policy, bucket, auth user or
-- setting. Everything it creates is prefixed hq_ (plus the optional
-- contact_messages inbox that the Contact page already needs).
--
-- Before running:  Supabase → Authentication → Users must contain your admin
-- account, and public.is_admin() must already exist (the Classic CMS uses it).
-- ============================================================================

-- ------------------------------------------------------------- social accounts
-- Public-safe metadata only. OAuth tokens NEVER live in this table.
create table if not exists public.hq_social_accounts (
  id          text primary key,
  platform    text not null unique,
  name        text,
  username    text,
  profile     text,
  page_id     text,
  webhook_url text,
  status      text default 'authorization_required',  -- connected | authorization_required | disconnected | expired
  scopes      text,
  expires_at  timestamptz,
  last_sync   timestamptz,
  note        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Encrypted OAuth tokens (AES-GCM, key = HQ_TOKEN_KEY on the server).
-- RLS is enabled with NO policies: the anon/authenticated roles cannot read or
-- write this table at all. Only the service role (Pages Functions) can.
create table if not exists public.hq_social_tokens (
  platform   text primary key,
  oauth_enc  text not null,
  updated_at timestamptz default now()
);

-- ------------------------------------------------------------------ publishing
create table if not exists public.hq_social_posts (
  id             text primary key,
  title          text,
  body           text,
  hashtags       text,
  url            text,
  language       text default 'en',
  platforms      jsonb default '[]'::jsonb,
  media          jsonb default '[]'::jsonb,
  media_url      text,
  media_type     text,
  privacy        text default 'public',
  status         text default 'draft',   -- draft|scheduled|publishing|published|failed|cancelled
  scheduled_at   timestamptz,
  published_at   timestamptz,
  published_urls jsonb default '{}'::jsonb,
  errors         jsonb default '[]'::jsonb,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists hq_social_posts_status_idx on public.hq_social_posts (status, scheduled_at);

-- ------------------------------------------------------- channel network (i18n)
create table if not exists public.hq_channels (
  code        text primary key,
  name        text,
  handle      text,
  platform    text default 'youtube',
  url         text,
  country     text,
  status      text default 'planned',    -- planned | active | paused
  description text,
  keywords    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ---------------------------------------------------- revenue & research (HQ)
create table if not exists public.hq_revenue (
  id          text primary key,
  date        date not null,
  source      text,                      -- admob | play_console | sponsor | merch
  game_id     text,
  amount      numeric default 0,
  currency    text default 'PKR',
  kind        text default 'manual',     -- manual | imported | estimated
  note        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists public.hq_competitors (
  id          text primary key,
  name        text not null,
  type        text default 'channel',    -- channel | game
  platform    text,
  url         text,
  count       text,                      -- "48.2K subscribers" as typed by you
  category    text,
  checked_at  date,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- -------------------------------------------------------------- content & i18n
create table if not exists public.hq_announcements (
  id           text primary key,
  title        text not null,
  description  text,
  image        text,
  publish_at   timestamptz,
  expires_at   timestamptz,
  is_public    boolean default true,
  featured     boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists public.hq_articles (
  id               text primary key,
  title            text not null,
  slug             text,
  category         text,
  tags             jsonb default '[]'::jsonb,
  image            text,
  content          text,
  seo_title        text,
  seo_description  text,
  keywords         text,
  status           text default 'draft',
  publish_at       date,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table if not exists public.hq_translation_sets (
  id             text primary key,
  title          text not null,
  key            text,
  base_language  text default 'en',
  items          jsonb default '{}'::jsonb,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create table if not exists public.hq_seo_sets (
  id          text primary key,
  topic       text,
  game        text,
  audience    text,
  country     text,
  language    text,
  keywords    text,
  category    text,
  outputs     jsonb default '{}'::jsonb,
  engine      text default 'template',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ------------------------------------------------------------------ analytics
-- One row per download click. Written by js/site-controls.js when enabled.
create table if not exists public.hq_download_events (
  id          bigserial primary key,
  game_slug   text,
  game_id     text,
  source      text,
  created_at  timestamptz default now()
);

-- One row per visit (or per aggregated day). Populated by your tracker.
create table if not exists public.hq_site_visits (
  id          bigserial primary key,
  date        date default current_date,
  path        text,
  country     text,
  source      text,
  device      text,
  visits      integer default 1,
  created_at  timestamptz default now()
);

create table if not exists public.hq_metric_snapshots (
  id          text primary key,
  kind        text not null,   -- downloads | visitors | followers | views | engagement
  date        date not null,
  game_id     text,
  value       numeric default 0,
  created_at  timestamptz default now()
);

create table if not exists public.hq_social_metrics (
  id          bigserial primary key,
  platform    text not null,
  date        date not null,
  views       bigint default 0,
  followers   bigint default 0,
  engagement  bigint default 0,
  likes       bigint default 0,
  comments    bigint default 0,
  shares      bigint default 0,
  reach       bigint default 0,
  created_at  timestamptz default now(),
  unique (platform, date)
);

-- ---------------------------------------------------------- contact & support
create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  email       text,
  subject     text,
  message     text,
  kind        text default 'contact',    -- contact | support | feedback
  status      text default 'unread',     -- unread | read | replied | archived
  created_at  timestamptz default now()
);

-- ================================ row level security ========================
-- Same shape as your existing tables: admins read/write, everyone else nothing.
do $$
declare t text;
begin
  foreach t in array array[
    'hq_social_accounts','hq_social_posts','hq_channels','hq_revenue','hq_competitors',
    'hq_announcements','hq_articles','hq_translation_sets','hq_seo_sets',
    'hq_metric_snapshots','hq_social_metrics','contact_messages'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_admin_all on public.%I', t, t);
    execute format('create policy %I_admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

-- download / visit events: anonymous inserts (a visitor clicked), admin-only reads
alter table public.hq_download_events enable row level security;
alter table public.hq_site_visits     enable row level security;
drop policy if exists hq_download_events_insert on public.hq_download_events;
create policy hq_download_events_insert on public.hq_download_events for insert to anon, authenticated with check (true);
drop policy if exists hq_download_events_read on public.hq_download_events;
create policy hq_download_events_read on public.hq_download_events for select to authenticated using (public.is_admin());
drop policy if exists hq_site_visits_insert on public.hq_site_visits;
create policy hq_site_visits_insert on public.hq_site_visits for insert to anon, authenticated with check (true);
drop policy if exists hq_site_visits_read on public.hq_site_visits;
create policy hq_site_visits_read on public.hq_site_visits for select to authenticated using (public.is_admin());

-- tokens: RLS on, and deliberately NO policies. Service role only.
alter table public.hq_social_tokens enable row level security;
revoke all on public.hq_social_tokens from anon, authenticated;

-- --------------------------------------------------------------- housekeeping
create or replace function public.hq_touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'hq_social_accounts','hq_social_posts','hq_channels','hq_revenue','hq_competitors',
    'hq_announcements','hq_articles','hq_translation_sets','hq_seo_sets'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.hq_touch_updated_at()', t, t);
  end loop;
end $$;

-- ============================================================================
-- Done. Next steps:
--   1. admin/hq/hq-data.js  →  CLOUD_TABLES: true   (stops using the browser store)
--   2. Cloudflare Pages     →  add the server secrets listed in HQ-DEPLOYMENT.md
--   3. HQ → System Status   →  "Re-check" should now show every table as READY
-- ============================================================================
