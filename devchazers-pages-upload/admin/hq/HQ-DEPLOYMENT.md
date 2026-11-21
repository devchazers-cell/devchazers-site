# DevChazers HQ — deployment & integration guide

Everything here is **optional**. Without it HQ runs exactly as it shipped:
drafts, scheduling, media, games, announcements, analytics snapshots and the
whole website CMS work; only *automatic* social publishing is switched off.

Follow the steps in order. Each one is independent — you can stop after step 2
and HQ will tell you honestly what is still missing.

---

## 0 · What is already live

| Works with no setup | Needs the steps below |
| --- | --- |
| Website, Classic CMS, Supabase reads, media upload | Automatic social publishing |
| HQ drafts, scheduler, calendar, publishing history | Real "Connected" account states |
| Media library, game management, announcements, blog | Cloud storage for HQ tables (posts survive a browser wipe) |
| Analytics snapshots + charts, revenue entries, research list | Pulling platform analytics automatically |
| Manual publish kit (copy → paste → record URL) | OAuth token refresh in the background |

---

## 1 · Supabase tables  (5 minutes, free)

1. Supabase dashboard → **SQL Editor** → New query.
2. Paste the whole of `admin/hq/hq-schema.sql` → **Run**.
   It is idempotent and strictly additive: only `hq_*` tables plus
   `contact_messages`. It never alters your existing tables, policies, buckets or auth users.
3. Open `admin/hq/hq-data.js` → change **one line**:

   ```js
   CLOUD_TABLES: false,   →   CLOUD_TABLES: true,
   ```

4. Upload the updated project (or commit it). HQ → **System Status** → *Re-check*
   should now list every table as READY.

> Why this matters: with `CLOUD_TABLES: true` your posts, announcements, revenue
> and research live in Postgres instead of the browser, which is what makes
> server-side publishing and multi-device use possible.

---

## 2 · Cloudflare Pages Functions  (secret storage, 10 minutes)

The `functions/api/hq/**` folder in this repo is a Cloudflare Pages Functions
app. Cloudflare picks it up automatically from the same repo as the site.

### 2a · Add the secrets

Cloudflare dashboard → your Pages project → **Settings → Environment variables
→ Add variable**, and mark each one **Secret** (Encrypt):

| Name | Where to get it | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase → Settings → API | same value as `js/config.js` |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API | same value as `js/config.js` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → *service_role* | **never** put this in any file |
| `HQ_TOKEN_KEY` | generate: 40+ random characters | encrypts stored OAuth tokens (AES-GCM) |
| `HQ_SITE_ORIGIN` | e.g. `https://devchazers.site` | used to build OAuth redirect URLs |
| `HQ_CRON_SECRET` | generate: 30+ random characters | lets a GitHub Action flush the queue |

Then add one client pair per platform **you** decide to connect:

| Platform | Variables |
| --- | --- |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` |
| Facebook / Instagram | `META_CLIENT_ID`, `META_CLIENT_SECRET` (one Meta app covers both) |
| Threads | `META_CLIENT_ID`, `META_CLIENT_SECRET` (Threads app uses the same pair) |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET` |
| (optional) Discord announcements | `DISCORD_WEBHOOK_DEFAULT` |

Nobody — not HQ, not the browser — can read these back. HQ only receives
booleans ("configured: true/false") from `/api/hq/status`.

### 2b · Deploy

The repo layout must stay:

```
wrangler.jsonc
functions/                 ← new: the API
devchazers-pages-upload/   ← assets (unchanged path, required by wrangler.jsonc)
```

Push to GitHub → Cloudflare rebuilds. The endpoint
`https://devchazers.site/api/hq/status` should answer `{"ok":false,"error":"Missing bearer token."}`
for a signed-out visitor — that proves the function is deployed.

### 2c · OAuth apps — redirect URLs to register

When you create each app in the provider's developer console, use exactly
these redirect URIs:

| Platform | Console | Redirect URI |
| --- | --- | --- |
| YouTube | console.cloud.google.com → APIs → OAuth client (Web) | `https://devchazers.site/api/hq/oauth/youtube/callback` |
| Facebook / Instagram | developers.facebook.com → App → Facebook Login | `https://devchazers.site/api/hq/oauth/facebook/callback` and `…/instagram/callback` |
| Threads | developers.facebook.com → Threads API | `https://devchazers.site/api/hq/oauth/threads/callback` |
| X | developer.x.com → App → User authentication (OAuth 2.0) | `https://devchazers.site/api/hq/oauth/x/callback` |

Enable the scopes listed in `functions/api/hq/_shared.js` (`PROVIDERS`).
Google and Meta review apps that publish publicly; until the review passes you
can still test with your own account in "testing" mode.

---

## 3 · Automatic publishing  (needs steps 1 + 2)

Where it stands per platform — checked against the official APIs:

| Platform | Publish | Needs from you |
| --- | --- | --- |
| YouTube | ✅ adapter written | Google OAuth app + app verification for public uploads |
| Facebook Page | ✅ adapter written | Meta app + `pages_manage_posts` review |
| Instagram (Business) | ✅ adapter written | Meta app + `instagram_content_publish` review, public media URL |
| Threads | ✅ adapter written | Meta app with `threads_content_publish` |
| X | ✅ adapter written | OAuth 2.0 app with write scope (free tier ≈ 500 posts/month) |
| Reddit | ✅ adapter written | Reddit app + the subreddit saved on the account |
| Discord | ✅ adapter written | A server webhook |
| TikTok | ⚠️ manual | Content Posting API audit (unaudited = private posts only) |
| LinkedIn | ⚠️ manual | Marketing Developer Platform approval |
| Pinterest | ⚠️ manual | Standard access application |

**Read this before promising yourself auto-posting:** the adapters are written
against each platform's documented API, but none of them has been executed
against a live account in this build (there were no keys to test with). The
first real publish is the proof. Every failure is returned per platform and
stored on the post — HQ never marks something published without a provider
confirmation id.

### Scheduling

HQ has no cron service and does not buy one. Two free options:

1. **On demand** — Notifications → *Publish due posts* (works any time you open HQ).
2. **Free GitHub Action** — every 10 minutes:

   ```yaml
   # .github/workflows/hq-publish.yml
   name: HQ publish queue
   on:
     schedule: [{ cron: "*/10 * * * *" }]
   jobs:
     flush:
       runs-on: ubuntu-latest
       steps:
         - run: |
             curl -sS -X POST "https://devchazers.site/api/hq/publish?due=1" \
               -H "Authorization: Bearer ${{ secrets.HQ_CRON_SECRET }}" \
               -H "Content-Type: application/json" -d '{}'
   ```

   Add `HQ_CRON_SECRET` to the repo's Actions secrets (same value as the Pages variable).

---

## 4 · Analytics & downloads  (optional, free)

1. Run `hq-schema.sql` (step 1) — this creates `hq_download_events` and `hq_site_visits`.
2. Open `js/site-controls.js` and add it to `index.html` **only if** you want
   click tracking and the maintenance/popup overlays on the public site:

   ```html
   <script src="js/site-controls.js" defer></script>
   ```

   Nothing else in the site is affected — the file is inert until included.
3. HQ → Downloads / Website Analytics → the *Download events* and *Visits*
   panels stop showing "NO SOURCE" once rows exist.
4. YouTube / platform analytics stay blank until the platform analytics APIs are
   wired (a second phase — they need the same OAuth apps plus the
   `yt-analytics.readonly` scope).

---

## 5 · Verify

| Check | Expected |
| --- | --- |
| `/admin/hq/#/social/accounts` | a green *Publish server online* note after step 2 |
| Connect YouTube | real Google consent screen, then a green **Connected** badge |
| Composer → Publish Now | allowed only if a connected account + server + schema exist |
| Publish with no keys | red toast + per-platform error in Publishing History, never "published" |
| `/api/hq/status` while signed out | `401 Missing bearer token.` (the function is deployed and locked) |
| HQ → System Status | every `hq_*` table READY after step 1 |

---

## 6 · Rollback

* Delete the `functions/` folder → HQ returns to drafts-only mode. Nothing else changes.
* Set `CLOUD_TABLES: false` → HQ returns to the browser workspace. Existing rows in
  Postgres stay there untouched.
* `hq-schema.sql` only creates `hq_*` tables; dropping them is safe for the site
  (`drop table if exists public.hq_social_tokens, public.hq_social_posts, … cascade;`)
  — but do it deliberately, it is the only place your HQ posts live once CLOUD_TABLES is on.
