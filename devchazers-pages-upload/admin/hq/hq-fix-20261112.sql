-- ============================================================================
-- DevChazers HQ — 12 Nov 2026 fix pack (idempotent, additive, safe to re-run)
--
-- Ye file sirf 3 kaam karti hai:
--   1. hq_ai_keys  — AI key ko server-side encrypted rakhne ke liye (service role only)
--   2. storage bucket limits ko UI ke saath match karna (warna upload 403 deta hai)
--   3. HQ-only columns ke liye kuch nahi — purani tables bilkul chhui nahi jati
--
-- NOTE: ye already tumhare project (pjhbydoodxfbkzqfelfz) par apply ho chuki hai.
-- Dobara chalao to bhi kuch nahi bigrega.
-- ============================================================================

-- 1 · AI key store ------------------------------------------------------------
create table if not exists public.hq_ai_keys (
  id          text primary key default 'ai',
  provider    text not null default 'gemini',
  model       text,
  key_enc     text not null,          -- AES-GCM sealed blob (HQ_TOKEN_KEY)
  key_hint    text,                   -- "AIza…1f2e" — sirf pehchanne ke liye
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.hq_ai_keys enable row level security;
-- koi policy nahi = anon/authenticated ke liye poora band
revoke all on public.hq_ai_keys from anon, authenticated;

-- 2 · Buckets ko HQ ki real limits ke saath match karo ------------------------
--    game-images: 3 MB → 5 MB (classic CMS aur HQ dono 5 MB tak allow karte hain)
update storage.buckets set file_size_limit = 5242880 where id = 'game-images';

--    site-media: ico / ogg bhi allow (HQ UI in ko accept karta hai),
--    limit 50 MB (HQ ka video limit bhi ab 50 MB hai, pehle 64 MB dikha raha tha)
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array[
         'image/png','image/jpeg','image/webp','image/gif','image/svg+xml',
         'image/x-icon','image/vnd.microsoft.icon',
         'video/mp4','video/webm','video/quicktime','video/ogg'
       ]
 where id = 'site-media';

-- 3 · Sanity check ------------------------------------------------------------
select 'hq_ai_keys'               as object, count(*)::text as value from public.hq_ai_keys
union all
select 'site-media limit',        coalesce(file_size_limit::text, '') from storage.buckets where id = 'site-media'
union all
select 'game-images limit',       coalesce(file_size_limit::text, '') from storage.buckets where id = 'game-images';
