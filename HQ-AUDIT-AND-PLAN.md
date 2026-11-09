# DevChazers HQ — Phase 1 audit & implementation report

**Date:** 9 November 2026
**Build:** HQ v1.1 (this ZIP) · audited against the ZIP you uploaded
**Scope of this round:** Phase 1 (audit) + Phase 2 (backend/database, honest data) +
Phase 3 scaffold (OAuth) + Phase 7 partial (notifications) + Phase 8 (regression).

---

## 1 · What I actually found (audit)

I re-read the delivered project file by file before touching anything.

| Area | Finding |
| --- | --- |
| Site | Static SPA-style site, 8 public routes, no framework, no bundler, no dependencies except supabase-js from a CDN |
| Backend | Supabase `pjhbydoodxfbkzqfelfz` (anon key in `js/config.js`, as before) |
| Auth | Supabase Auth + `public.is_admin()` RPC — Classic CMS and HQ share the same session |
| Existing tables | `games`, `pages`, `media`, `site_settings`, `admin_activity` (5) — plus `is_admin()` |
| Missing tables | every social/publishing/analytics table (9 tables I had guessed at were absent) |
| Storage | buckets `game-images`, `site-media` |
| Deploy | Cloudflare Pages via `wrangler.jsonc`, assets dir `./devchazers-pages-upload`, `not_found_handling: single-page-application` |
| HQ v1.0 (previous build) | 19 routes, 4 000 lines of vanilla JS, workspace in `localStorage`, all numbers honest but **no server, no OAuth, no real publishing** |
| Gaps vs your spec | channel profiles, revenue, research, cost overview, notifications, 3 extra game stages, platform capability matrix, date ranges on the dashboard |

**Nothing was rewritten.** The design system, `admin.css` tokens, the Classic CMS
and every existing page are untouched. `diff -r` against your uploaded ZIP still
shows only the earlier additive edits.

---

## 2 · What I built in this round

### Phase 2 — backend + database (new, optional-but-armed)

```
functions/api/hq/_shared.js        Supabase service-role calls, admin gate, AES-GCM token sealing, OAuth state signing, rate limit
functions/api/hq/_adapters.js      one publishing adapter per platform (official APIs)
functions/api/hq/status.js         GET  /api/hq/status        → what the server can do
functions/api/hq/accounts.js       GET/POST/DELETE /api/hq/accounts
functions/api/hq/oauth/[platform]/start.js     302 → provider consent (admin-only)
functions/api/hq/oauth/[platform]/callback.js  code → tokens (sealed) → profile → DB
functions/api/hq/publish.js        POST /api/hq/publish  (+ ?due=1 for the queue)
admin/hq/hq-schema.sql             idempotent, additive: 13 hq_* tables + contact_messages + RLS
admin/hq/hq-api.js                 browser bridge: session → server, account model, manual kit
admin/hq/HQ-DEPLOYMENT.md          env var names, OAuth redirect URLs, scheduler setup
```

Security choices, so you can check them:

* **No token ever reaches the browser.** `hq_social_tokens` has RLS on with *no
  policies* and `revoke all from anon, authenticated` — only the service role reads it.
* Tokens are sealed with AES-GCM using `HQ_TOKEN_KEY` before insert.
* Every admin endpoint verifies the caller's Supabase session **and** `is_admin()`
  (`requireAdmin`), not just a header presence.
* OAuth `state` is HMAC-signed and expires in 15 minutes; the callback therefore
  needs no bearer token but cannot be forged.
* Rate limits on account changes (30/min) and publishes (30/min).
* Errors returned to the UI are short messages — never raw provider payloads or keys.

### Phase 3 — OAuth (written, needs your keys)

Providers wired: **YouTube (Google), Facebook, Instagram, Threads, X**.
Adapters written for publishing: **YouTube, Facebook, Instagram, Threads, X, Reddit, Discord**.
Manual by design (platform approval required): **TikTok, LinkedIn, Pinterest**.

> Honest caveat: those adapters are written against the official API docs but
> have **not** been executed against a live account, because there are no keys in
> this environment. The first real publish is the proof. A failure is returned
> per platform and stored on the post; nothing is ever marked published without a
> provider confirmation id.

### New HQ screens (7 → 24 routes)

| Route | What it does |
| --- | --- |
| `#/notifications` | Real notification centre: failed posts, due-but-unsent queue, missing tokens, expiring tokens, maintenance left on, unreadable storage, missing snapshots. Dismissible, plus the activity log. |
| `#/channels` | 12 language channel profiles (name, handle, URL, country, localized description, status). A channel only becomes **Active** when you paste a URL you actually own. Export plan + brand kit. |
| `#/revenue` | Manual/imported/estimate revenue with a labelled origin, per-game split, 6-month chart, CSV. |
| `#/research` | Competitor watchlist (public info you typed, with the date you checked it) + rule-based content prompts. No scraping. |
| `#/costs` | The PKR 2 000/month plan: 10 services, free-tier facts, estimate vs recorded actual, budget guardrails, what would break the budget. |

### Upgrades to existing screens

* **Overview** — date range bar (Today / 7 / 30 / 90 / Custom) that actually filters
  the dated sources; 12 KPI cards now including *Upcoming games*, *Social followers*,
  *Video views* and *Engagement*; “—” + reason wherever a source does not exist.
* **Social Accounts** — server-backed accounts win over local records, real OAuth
  start/revoke, and a **capability matrix** that states per platform: publish,
  native scheduling, analytics, comments — and what needs review.
* **Composer** — real publish path (server → adapter per platform → stored URLs),
  partial-failure reporting, and a **manual publish kit** (copy text, open the right
  upload page, paste the live URL back) for anything not wired.
* **Game Management** — the seven stages you asked for: In Development, Testing,
  Closed Testing, Ready for Release, Published, Maintenance, Discontinued.
* **System Status** — new *Publishing backend* card (functions reachable, token key,
  service role, OAuth apps, adapters, scheduler mode) + probes for all 13 HQ tables.

---

## 3 · Feature status (your six-state system)

| Feature | Status | Notes |
| --- | --- | --- |
| Website + Classic CMS preserved | **Complete** | diff-verified byte-identical apart from the two additive edits |
| HQ shell, routing, auth gate, responsive | **Complete** | 24 routes, 0 errors at 6 widths |
| Media library (upload/folders/filters/copy/delete) | **Complete** | uses the existing `site-media` bucket |
| Game management + 7 stages + trailer/privacy/Play links | **Complete** | HQ-only fields stored as workspace metadata (no schema change) |
| Announcements / Blog (CRUD, SEO fields, publish-as-page) | **Complete** | “Publish as page” writes to the existing `pages` table |
| Scheduler, calendar, history, retry-safe cancel | **Complete** | HQ-side queue; native platform scheduling where the API allows it |
| AI SEO Studio (10 outputs, template mode) | **Complete** | template engine; real model = one endpoint away, needs your approval for cost |
| Multi-language manager (12 languages, RTL) | **Complete** | workspace + optional `hq_translation_sets` |
| Channel network (12 profiles) | **Complete** | manual, honest states |
| Revenue dashboard | **Complete** (manual) | AdMob/Play Console APIs = *Requires External Configuration* |
| Market research | **Complete** (manual) | by design: no scraping |
| Cost & budget | **Complete** | editable budget + recorded actuals |
| Notifications & activity | **Complete** | derived from real state |
| OAuth connect/disconnect/revoke | **Requires External Configuration** | code done; needs client id/secret + redirect URIs |
| Automatic publishing | **Requires External Configuration** | code done; needs step 1+2 of HQ-DEPLOYMENT.md and a first live test |
| TikTok / LinkedIn / Pinterest publishing | **Requires API Approval** | manual kit provided |
| YouTube / Meta analytics import | **In Progress** (next phase) | needs `yt-analytics.readonly` + Meta insights scopes |
| Website visitors / download tracking | **Requires External Configuration** | `hq_download_events` + `hq_site_visits` created by the schema; opt-in snippet |
| AdMob / Play Console revenue sync | **Requires External Configuration** | Google OAuth + per-app reporting access |
| Game update history, bug reports, reviews | **Not Implemented** | needs a Play Console / review source; planned Phase 6 |
| Community inbox (comments across platforms) | **Not Implemented** | not all platforms expose it; planned with the analytics phase |
| Competitor auto-tracking | **Blocked** (by policy) | automated scraping violates platform terms — manual by design |
| Paid services | **Blocked** (by you) | nothing purchased; the cost page shows what would break PKR 2 000 |

---

## 4 · Cost picture (PKR 2 000 / month)

| Item | Cost | Notes |
| --- | --- | --- |
| Cloudflare Pages + Functions | **Free** | 100 k requests/day, plenty here |
| Supabase | **Free** | 500 MB DB, 1 GB storage; upgrade only past ~400 MB media |
| GitHub | **Free** | repo + Actions minutes |
| YouTube Data API | **Free quota** | 10 000 units/day ≈ 6 uploads/day |
| Meta Graph API | **Free** | needs review, no fee |
| X API | **Free tier** | ≈ 500 posts/month. Basic tier (~USD 200) is **far** outside budget — kept off |
| AI copy | **Free** | template mode; a free-tier model can be added later |
| **Total** | **PKR 0 / month** | the 2 000 budget stays untouched; domain renewal is separate |

The **only** realistic way to exceed PKR 2 000 is paid API tiers (X Basic, ad
APIs) or storage growth. Both are visible on the new Cost & Budget page, and
HQ cannot enable either without you.

---

## 5 · Testing performed (Phase 8)

| Test | Result |
| --- | --- |
| 24 HQ routes × 6 widths (1440/1024/768/480/390/360) | 0 console/page errors, 0 horizontal overflow |
| Public pages `/`, `/privacy-policy`, `/terms`, `/sitemap.xml`, `/robots.txt`, `/ads.txt` | HTTP 200, unchanged |
| Classic CMS `/admin/` | loads, gate message unchanged, no new errors |
| Live Supabase read path | homepage renders *Multiplayer Golf*; HQ gate shown when signed out |
| Stubbed admin session (no writes) | KPIs show “—” + READ FAILED instead of a false zero |
| Channel profile save / validation | saves; refuses Active without a URL |
| Revenue / research / cost entry | saved, validated, charted, CSV exports |
| Dashboard ranges | Today / 7 / 30 / 90 / custom all re-render, custom validates from ≤ to |
| Manual publish kit | correct copy text, correct upload links, records manual URL |
| Publish with no backend | blocked with a clear reason — never a fake success |
| Draft → schedule → cancel → delete lifecycle | verified end-to-end |
| Notifications | derived items appear/disappear correctly, dismiss + restore work |

Not tested (impossible here): real OAuth consent, real platform publishing,
Supabase writes (your rules: read-only). Those are the three things to test on
day one after you add the secrets.

---

## 6 · What you must do (in order)

1. **Apply `admin/hq/hq-schema.sql`** in Supabase SQL Editor, then set
   `CLOUD_TABLES: true` in `admin/hq/hq-data.js`.
2. **Add the Cloudflare secrets** listed in `HQ-DEPLOYMENT.md` §2a
   (`SUPABASE_SERVICE_ROLE_KEY`, `HQ_TOKEN_KEY`, `HQ_SITE_ORIGIN`, plus one
   client pair per platform you want).
3. **Register the redirect URIs** in each developer console (exact URLs in
   `HQ-DEPLOYMENT.md` §2c).
4. **Push to GitHub** — Cloudflare rebuilds; `/api/hq/status` proves the functions.
5. **Connect one account** (start with YouTube) and publish one test video as
   *private* to verify the whole chain safely.
6. Optional: add the 10-minute GitHub Action so the queue flushes without you.

Until step 5 succeeds, HQ keeps showing **Authorization required** and the
manual publish kit. That is deliberate: no invented connections, no invented posts.

---

## 7 · Known limitations

* The 5 platform adapters are unproven against live APIs (no keys here).
* YouTube quota ≈ 6 uploads/day on the free tier.
* Instagram/TikTok require public media URLs — private storage links will fail.
* Native scheduling exists only for YouTube and Facebook; on the others HQ holds
  the queue, so publishing needs the scheduler action to run.
* HQ workspace (localStorage) is capped ~5 MB — the schema moves it to Postgres.
* Game update history / bug reports / reviews need a data source that does not exist yet.
* `ADMIN_EMAIL` in `js/config.js` is still empty, so the classic login hint is blank.
* Pre-existing: `games/multiplayer-golf/1.png` is missing (404), `ads.txt` is comments only.

---

## 8 · Suggested next phase (when you say go)

1. **Prove one platform end-to-end** (YouTube private upload) and fix whatever the
   live API disagrees with — that is worth more than ten new screens.
2. **Analytics import** (YouTube Analytics + Meta insights) into `hq_social_metrics`.
3. **Game release workflow** (Workflow B): one form → screenshots, trailer, description,
   announcement, blog post, social drafts, all scheduled.
4. **Play Console / AdMob revenue import** (CSV first, API later).
5. **Community & reviews** once a data source is approved.
