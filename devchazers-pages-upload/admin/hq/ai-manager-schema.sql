-- ============================================================================
-- DevChazers HQ — AI Website Manager schema  (ai-manager-schema.sql)
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. Ye file kuch bhi drop/replace nahi karti aur maujooda tables
-- (games, pages, media, site_settings, admin_activity, hq_*) ko chhoti bhi nahi.
-- Sab statements idempotent hain — do dafa chala dain to kuch nahi bigdata.
--
-- Kahan chalayen: Supabase → SQL Editor → New query → poora file → Run.
-- Rollback: file ke aakhir me commented DROP block hai.
--
-- Access model:
--   • Browser (anon key) → koi access nahi (revoke).
--   • Signed-in admin     → read only (RLS + public.is_admin()).
--   • Cloudflare Function → service_role, RLS bypass; wohi likhta hai.
-- ============================================================================

-- ---------------------------------------------------------------- helpers
-- is_admin() pehle se maujood hai (public.admins par based) — reuse.

-- ---------------------------------------------------------- conversations
create table if not exists public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id              bigserial primary key,
  conversation_id uuid references public.ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system','tool')),
  content         text,
  tool            text,
  steps           jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, created_at desc);

-- ------------------------------------------------------------- action log
-- Har write/read action jo AI ne kiya. "verified" sirf tab true hota hai jab
-- server ne DB se dobara parh kar confirm kiya ho.
create table if not exists public.ai_action_logs (
  id              bigserial primary key,
  conversation_id uuid,
  user_id         uuid,
  tool            text not null,
  category        text not null check (category in ('A','B','C')),
  args            jsonb,
  before          jsonb,
  after           jsonb,
  status          text not null check (status in ('executed','failed','cancelled','denied','pending')),
  verified        boolean,
  error           text,
  duration_ms     integer,
  steps           jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists ai_action_logs_created_idx on public.ai_action_logs (created_at desc);
create index if not exists ai_action_logs_tool_idx on public.ai_action_logs (tool, created_at desc);

-- -------------------------------------------------------------- approvals
create table if not exists public.ai_approvals (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid,
  user_id         uuid,
  tool            text not null,
  category        text not null check (category in ('A','B','C')),
  args            jsonb not null,
  preview         jsonb,
  status          text not null default 'pending' check (status in ('pending','approved','cancelled','expired')),
  expires_at      timestamptz not null default (now() + interval '30 minutes'),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
create index if not exists ai_approvals_status_idx on public.ai_approvals (status, created_at desc);

-- --------------------------------------------------------- project memory
create table if not exists public.ai_project_memory (
  id         bigserial primary key,
  key        text not null unique,
  value      jsonb,
  note       text,
  editable   boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------ usage stats
-- Ek row = ek AI request (aggregate read-time par hota hai). Isse per-day /
-- per-provider / per-model hisaab bina race ke banta hai.
create table if not exists public.ai_usage_stats (
  id            bigserial primary key,
  day           date not null default current_date,
  provider      text,
  model         text,
  requests      integer not null default 1,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  errors        integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_day_idx on public.ai_usage_stats (day desc);

-- ============================================================== RLS + grants
alter table public.ai_conversations  enable row level security;
alter table public.ai_messages       enable row level security;
alter table public.ai_action_logs    enable row level security;
alter table public.ai_approvals      enable row level security;
alter table public.ai_project_memory enable row level security;
alter table public.ai_usage_stats    enable row level security;

-- Browser ko bilkul na do (anon key public hai — usse ye tables nahi chahiye).
revoke all on public.ai_conversations, public.ai_messages, public.ai_action_logs,
             public.ai_approvals, public.ai_project_memory, public.ai_usage_stats
  from anon;

-- Signed-in admin: read-only (audit trail browser se chheda nahi ja sakta).
do $$
declare t text;
begin
  foreach t in array array['ai_conversations','ai_messages','ai_action_logs','ai_approvals','ai_project_memory','ai_usage_stats']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_admin_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_update', t);
  end loop;
end $$;

-- ================================================================== sanity
-- Chalane ke baad ye select chala kar tasdeeq karein:
--   select relname, n_live_tup from pg_stat_user_tables where relname like 'ai_%';
-- Expected: 6 tables.

-- ============================================================== ROLLBACK
-- Sirf tab chalayen jab AI Manager mukammal tor par hataana ho. Ye maujooda
-- site data ko touch nahi karta.
--
-- begin;
--   drop table if exists public.ai_usage_stats;
--   drop table if exists public.ai_project_memory;
--   drop table if exists public.ai_approvals;
--   drop table if exists public.ai_action_logs;
--   drop table if exists public.ai_messages;
--   drop table if exists public.ai_conversations;
-- commit;
