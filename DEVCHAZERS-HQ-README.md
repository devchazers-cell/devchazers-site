# DevChazers HQ — update notes

**What this is:** your existing DevChazers site + a new **DevChazers HQ** dashboard at
`/admin/hq/`. Nothing that existed before was removed, renamed, re-themed or
re-pointed. Everything is additive.

---

## Open it

| Where | URL |
| --- | --- |
| New HQ dashboard | `https://devchazers.site/admin/hq/` |
| Classic CMS (unchanged) | `https://devchazers.site/admin/` |
| Link between them | bottom of the classic sidebar → **◈ DevChazers HQ**, and HQ header → **CMS** |
| Deep link into a classic tab | `/admin/?tab=games` (new, optional) |

Sign in with the **same admin account** — HQ reuses the existing Supabase session
and `is_admin()` check.

---

## Files added (nothing else was touched)

```
admin/hq/index.html                  HQ shell
admin/hq/hq.css                      layout layer on top of the existing admin.css tokens
admin/hq/hq-data.js                  data layer + HQ_CONFIG integration switches
admin/hq/hq-core.js                  icons, dialogs, tables, empty states, SVG charts
admin/hq/hq-views-home.js            Overview · System Status
admin/hq/hq-views-social.js          Accounts · Composer · AI SEO Studio · Languages
admin/hq/hq-views-schedule.js        Scheduler · Publishing History · Social Analytics
admin/hq/hq-views-content.js         Media · Games · Announcements · Blog · Support
admin/hq/hq-views-insights.js        Downloads · Website Analytics · Ads · Settings
admin/hq/hq-app.js                   shell, sidebar, router, auth
admin/hq/hq-optional-schema.sql      OPTIONAL new tables (not applied)
admin/hq/INTEGRATION.md              how to switch each placeholder live
js/site-controls.js                  OPTIONAL maintenance/popup/download-counter (not referenced)
backup/ORIGINAL-2026-11-09/          untouched copy of the project as uploaded
```

## Files modified (2, both additive)

| File | Change |
| --- | --- |
| `admin/index.html` | + one sidebar link to HQ, + one scoped `<style>` rule for that link. Classic tabs, forms and scripts untouched. |
| `admin/admin.js` | + one isolated IIFE at the very bottom that reads `?tab=` and clicks the matching classic tab. No existing line changed. |

## Files deliberately untouched (byte-identical)

`index.html` · `js/config.js` · `js/site.js` · `js/data-service.js` · `js/theme.js` ·
`js/intro.js` · `css/theme.css` · `css/site.css` · `css/intro.css` ·
`admin/admin.css` · `robots.txt` · `sitemap.xml` · `ads.txt` · `wrangler.jsonc` ·
`logo/*` · `games/README.txt`

No new dependency was added — charts and icons are hand-written SVG, exactly like
the original site which ships no JS libraries beyond Supabase.

---

## Feature map

| Section | Status |
| --- | --- |
| Overview (8 KPI cards, activity, quick actions, announcements, publishing overview, monthly performance, system status) | **Live** from `games/pages/media/admin_activity` + HQ workspace; analytics KPIs show `—` until a source exists |
| Social Accounts (9 platforms, 3 honest states, Connect/Manage/Disconnect) | **UI live**, connection requires OAuth config |
| Post Composer (media upload + drag-drop, title, caption, hashtags, URL, platforms, language, draft, preview, publish, schedule) | **Draft + schedule work**; Publish is disabled and explains why |
| AI SEO Studio (brief → 10 metadata outputs, copy + edit, saved packs, send to composer) | **Live** in clearly-labelled template mode; AI endpoint switchable |
| Multi-Language Manager (12 languages, localized fields, RTL preview, coverage) | **Live** (workspace) |
| Publishing Scheduler (month/week/day/list, edit, cancel) | **Live** |
| Publishing History (statuses, thumbnail, platform, dates, URL, error, CSV export) | **Live** |
| Social Analytics (7 KPI + platform comparison + monthly growth) | **Honest empty state** until `hq_social_metrics` is fed |
| Media Library (upload images/video/thumbnails, search, filters, folders, preview, size/date, copy URL, delete confirm) | **Live** — same `media` table + `site-media` bucket as the classic CMS |
| Game Management (cards + full form incl. trailer, privacy URL, release stage) | **Live** — writes the existing `games` table; HQ-only fields stored as metadata |
| Downloads (total/daily/weekly/monthly, most popular, country/source/device, growth, date filters) | Snapshots **live**; automatic tracking is opt-in |
| Website Analytics (visitors, growth, geo/source/device, filters) | Snapshots **live**; geo/source/device need a tracker |
| Announcements (CRUD, image, dates, public/private, featured, publish as real page) | **Live** (workspace + Pages bridge) |
| Blog Manager (rich editor, SEO, tags, category, status, publish as real page) | **Live** (workspace + Pages bridge) |
| Contact & Support (inbox/support/feedback/archived, read, reply, archive) | **Live UI**, empty until a submission store exists |
| Advertisement Manager (ads.txt, publisher id, ad page, revenue) | **Read-through** of the existing Ads settings — one source of truth |
| Website Settings (all existing values, read-only + HQ site controls) | **Live**, read-only mirror + new `hq_*` controls |
| System Status (table storage checks, preserved-feature map, workspace tools) | **Live** |
| Classic features (Maintenance, Popup, Download counter, Ads page, page visibility, Privacy Policy, Sitemap, Supabase admin) | **Preserved**; new HQ controls for the first three are stored but inert until the optional snippet is added |

Full detail on every switch: **`devchazers-pages-upload/admin/hq/INTEGRATION.md`**.

---

## Honesty rules this build follows

* No account is shown as connected without a real token.
* No post is reported as published without a real publish response.
* No analytics number is invented — dashes + reasons instead.
* No AI output is claimed when the template engine produced the text.
* A failed Supabase **read** is shown as a failure, never as an empty list
  (an empty catalogue and a blocked query look different in HQ).

---

## Deploy

The ZIP keeps the original structure, so the existing Cloudflare Pages setup
works unchanged:

* build output / assets directory: `devchazers-pages-upload`
* `wrangler.jsonc` unchanged (`not_found_handling: single-page-application`),
  so `#/social/...` hash routes are unaffected.
* Upload by dragging the `devchazers-pages-upload` folder, or commit the
  repository as you normally do. No build step, no new secrets.

## Verification performed

* 18 HQ routes × 6 viewports (1440/1024/820/768/480/390/360 px) — no console or
  page errors, no horizontal overflow.
* Classic pages re-tested in the same run: `/`, `/admin/`, `/privacy-policy`,
  `/terms`, `/sitemap.xml`, `/robots.txt`, `/ads.txt` — unchanged behaviour.
* Live Supabase read path verified against your project (games list renders on
  the public homepage and inside HQ).
* Logged-in HQ path exercised with a stubbed session (read-only) to confirm the
  shell, routing and permission handling; **no write was performed against your
  production data.**
* All CRUD flows in the HQ workspace exercised: draft → schedule → cancel →
  delete, announcement/blog create + delete, language set, SEO pack, snapshots,
  workspace reset.
* `diff -r` against the uploaded ZIP: only the 2 additive edits + the new files.

## Note about this ZIP size

The layout is a small static site (≈500 KB), so the archive stays tiny even with
the full `backup/ORIGINAL-2026-11-09/` copy inside. Keep or delete that folder —
it is only there as your requested pre-edit backup.
