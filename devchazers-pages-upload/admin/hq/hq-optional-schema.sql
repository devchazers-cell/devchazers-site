-- ============================================================================
-- DevChazers HQ — OPTIONAL schema
-- ----------------------------------------------------------------------------
-- This file is NOT required for HQ to run and it is NOT applied automatically.
-- HQ works today with the existing tables (games, pages, media, site_settings,
-- admin_activity) + a local workspace in the browser.
--
-- Run this only when you want the new HQ features stored in Supabase.
-- It is strictly additive:
--   • creates new tables prefixed hq_  (plus an optional contact_messages inbox)
--   • never drops, renames or alters an existing table, column or policy
--   • never touches auth, storage buckets or existing RLS rules
--
-- After running it, set CLOUD_TABLES: true in admin/hq/hq-data.js.
-- ============================================================================

-- ---------------------------------------------------------------- social ----
create table if not exists public.hq_social_accounts (
  id          text primary key,
  platform    text not null,
  name        text,
  username    text,
  profile     text,
  note        text,
  oauth       jsonb default '{}'::jsonb,   -- { linked_at, scope }  token lives server-side only
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists public.hq_social_posts (
  id             text primary key,
  title          text,
  body           text,
  hashtags       text,
  url            text,
  language       text default 'en',
  platforms      jsonb default '[]'::jsonb,
  media          jsonb default '[]'::jsonb,
  status         text default 'draft',     -- draft | scheduled | publishing | published | failed | cancelled
  scheduled_at   timestamptz,
  published_at   timestamptz,
  published_urls jsonb default '{}'::jsonb,
  errors         jsonb default '[]'::jsonb,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
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

-- ------------------------------------------------------- content & i18n ----
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
  items          jsonb default '{}'::jsonb,  -- { en:{title,description,hashtags}, ur:{…}, … }
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

-- ------------------------------------------------------------ analytics ----
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
  source      text,          -- direct | search | social | referral
  device      text,          -- mobile | desktop | tablet
  visits      integer default 1,
  created_at  timestamptz default now()
);

create table if not exists public.hq_metric_snapshots (
  id          text primary key,
  kind        text not null,  -- downloads | visitors | social
  date        date not null,
  game_id     text,
  value       numeric default 0,
  created_at  timestamptz default now()
);

-- --------------------------------------------------- contact & support ----
create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  email       text,
  subject     text,
  message     text,
  kind        text default 'contact',   -- contact | support | feedback
  status      text default 'unread',    -- unread | read | replied | archived
  created_at  timestamptz default now()
);

-- ============================ row level security ============================
-- HQ is rendered only for authenticated admins, but the browser uses the anon
-- key, so every new table gets the same shape as your existing tables:
--   read  -> admins (public data such as metrics can be opened up if you prefer)
--   write -> admins only
-- Adjust the helper name below if your project already exposes a different
-- admin check (the site uses the RPC public.is_admin()).

alter table public.hq_social_accounts    enable row level security;
alter table public.hq_social_posts       enable row level security;
alter table public.hq_social_metrics     enable row level security;
alter table public.hq_announcements      enable row level security;
alter table public.hq_articles           enable row level security;
alter table public.hq_translation_sets   enable row level security;
alter table public.hq_seo_sets           enable row level security;
alter table public.hq_download_events    enable row level security;
alter table public.hq_site_visits        enable row level security;
alter table public.hq_metric_snapshots   enable row level security;
alter table public.contact_messages      enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'hq_social_accounts','hq_social_posts','hq_social_metrics','hq_announcements',
    'hq_articles','hq_translation_sets','hq_seo_sets','hq_metric_snapshots','contact_messages']
  loop
    execute format('drop policy if exists %I_admin_all on public.%I', t, t);
    execute format('create policy %I_admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

-- download events: anyone may INSERT (the click comes from an anonymous visitor),
-- only admins may read.
drop policy if exists hq_download_events_insert on public.hq_download_events;
create policy hq_download_events_insert on public.hq_download_events for insert to anon, authenticated with check (true);
drop policy if exists hq_download_events_read on public.hq_download_events;
create policy hq_download_events_read on public.hq_download_events for select to authenticated using (public.is_admin());

-- site visits: same idea
drop policy if exists hq_site_visits_insert on public.hq_site_visits;
create policy hq_site_visits_insert on public.hq_site_visits for insert to anon, authenticated with check (true);
drop policy if exists hq_site_visits_read on public.hq_site_visits;
create policy hq_site_visits_read on public.hq_site_visits for select to authenticated using (public.is_admin());

-- public contact form submissions (anonymous insert, admin read)
drop policy if exists contact_messages_insert on public.contact_messages;
create policy contact_messages_insert on public.contact_messages for insert to anon, authenticated with check (true);
drop policy if exists contact_messages_admin on public.contact_messages;
create policy contact_messages_admin on public.contact_messages for select to authenticated using (public.is_admin());
drop policy if exists contact_messages_update on public.contact_messages;
create policy contact_messages_update on public.contact_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- indexes used by the HQ dashboards
create index if not exists hq_social_posts_status_idx on public.hq_social_posts (status, scheduled_at);
create index if not exists hq_social_metrics_date_idx  on public.hq_social_metrics (date);
create index if not exists hq_download_events_date_idx on public.hq_download_events (created_at);
create index if not exists hq_site_visits_date_idx     on public.hq_site_visits (date);

-- ============================================================================
-- OPTIONAL: wire the website contact form to the inbox
-- ----------------------------------------------------------------------------
-- In js/site.js replace the mailto handler with a Supabase insert, e.g.:
--
--   const sb = window.supabase.createClient(DC_CONFIG.SUPABASE_URL, DC_CONFIG.SUPABASE_ANON_KEY);
--   await sb.from('contact_messages').insert({ name:n, email:e, message:m, kind:'contact' });
--
-- That is the only change needed for HQ → Contact & Support to show real
-- submissions; the inbox UI itself needs nothing.
-- ============================================================================
