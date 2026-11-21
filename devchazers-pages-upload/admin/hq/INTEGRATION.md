# DevChazers HQ — Integration guide

HQ is a **UI expansion**. It adds `admin/hq/` next to the existing classic CMS and
changes nothing that already worked. This file explains exactly what is real
today, what is a labelled placeholder, and the one-line switches that turn each
placeholder into a live feature.

---

## 1. What HQ reuses (already live, no setup)

| Feature | How HQ reads it | Writes? |
| --- | --- | --- |
| Games | `window.DC.listGames(true)` → `games` table | Yes, same `DC.saveGame()` as the classic CMS |
| Pages (privacy policy, terms, advertising…) | `DC.listPages(true)` → `pages` table | Yes, via `DC.savePage()` (Announcements/Blog → **Publish as page**) |
| Media | `DC.listMedia()` + `DC.uploadMedia()` → `media` table & `site-media` bucket | Yes |
| Settings | `DC.getSettings()` → `site_settings` | Only **new** `hq_*` keys (Site Controls). Existing keys are never touched |
| Activity log | `DC.listActivity()` → `admin_activity` | No |
| Auth | Same Supabase session + `is_admin()` RPC as the classic CMS | – |

HQ does not create a second Supabase client for these tables and does not
duplicate any form — the classic tabs remain the canonical editors.

## 2. What HQ stores locally (no tables in your schema yet)

`announcements`, `articles`, `social posts`, `social accounts`, `translation
sets`, `SEO packs` and `analytics snapshots` are kept in a single
**localStorage workspace** (`dc_hq_v1`, scoped per browser).

* Clearly labelled in the UI ("HQ workspace", "saved locally").
* Export / import / reset from **System Status → Workspace**.
* Nothing is silently written to Supabase, so your schema and RLS stay intact.

### Moving them to Supabase (optional)

1. Open the Supabase SQL editor and run [`hq-optional-schema.sql`](./hq-optional-schema.sql).
   It only **creates** new tables prefixed `hq_` plus an optional
   `contact_messages` inbox. It never alters existing tables.
2. In `admin/hq/hq-data.js` set:

   ```js
   CLOUD_TABLES: true,
   ```

3. Reload HQ. The same views now read/write those tables; the local workspace is
   left untouched as a backup.

## 3. Social accounts — why "Connect" is honest

A platform only shows **Connected** when a real OAuth token exists
(`account.oauth.linked_at`). Until then:

| State | Meaning |
| --- | --- |
| Disconnected | No record saved |
| Authorization required | Handle saved locally, **no token** → publishing disabled |
| Connected | Token linked → publish endpoint may be called |

To make the button start a real OAuth flow, paste your authorize URL:

```js
// admin/hq/hq-data.js → HQ_CONFIG.PROVIDERS
youtube: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=…&response_type=code&scope=…' },
```

HQ never asks for client secrets and never stores tokens in the browser. Your
redirect endpoint (Cloudflare Function / Supabase Edge Function) should exchange
the code and store the refresh token server-side.

## 4. Publishing

* **Save as draft** and **Schedule** work immediately (workspace records).
* **Publish now** is disabled while `Publish endpoint` is empty *or* no account is
  connected, and says so instead of faking a success message.
* To enable:

```js
PUBLISH_ENDPOINT: 'https://your-worker.example.workers.dev/publish',
```

HQ will `POST { post, platforms }` to that URL and store the returned
`{ urls: { youtube: '…', x: '…' } }`. A non-2xx response marks the post **Failed**
with the real error text in Publishing History.

## 5. AI SEO Studio

`Generate draft` runs a deterministic, rule-based template engine in the browser
and labels the output **“Template mode draft”**. No model output is ever implied.

To use a real model, set:

```js
AI_ENDPOINT: 'https://your-worker.example.workers.dev/seo',
```

Request body: `{ topic, game, audience, country, language, keywords, category, fields[] }`
Response JSON: `{ title, description, hashtags, keywords, tags, caption, shortsTitle, instagram, facebook, tiktok }`.

## 6. Analytics that must stay at “—”

| Panel | Needs |
| --- | --- |
| Downloads over time | Real download events (`hq_download_events`) **or** manual snapshots (works now) |
| Website visitors / country / source / device | `hq_site_visits` rows, or Cloudflare/GA totals entered as snapshots |
| Social views, followers, engagement… | `hq_social_metrics` rows written by a scheduled pull job |
| Ad revenue | Server-side AdMob reporting (never a browser key) |

Until then every card shows `—` with a reason, and every chart shows an explicit
empty state. **No fabricated analytics ship in this build.**

## 7. Site Controls (Maintenance mode, Custom popup, Download counter)

New in HQ, stored as `hq_maintenance_mode`, `hq_popup_*`, `hq_download_counter`
in `site_settings`. They are persisted but **inert**, because the public pages
were deliberately left untouched.

To activate, enqueue one optional file in `index.html` (inside `<head>` or before
`</body>`, after `js/data-service.js`):

```html
<script src="js/site-controls.js" defer></script>
```

That file (included, inactive) reads the `hq_*` settings and:

* shows a maintenance overlay when `hq_maintenance_mode = true`;
* renders the announcement popup when `hq_popup_enabled = true`;
* counts download clicks into `hq_download_events` when `hq_download_counter = true`
  and that table exists (it is created by the optional SQL).

If you never add the tag, the site behaves exactly as before.

## 8. Contact & Support

The public contact form currently opens the visitor's mail app (`mailto:`), so no
submissions reach a database — HQ says exactly that.

To get a real inbox: run the optional SQL (`contact_messages`), then change
`$('#c_s').onclick` in `js/site.js` to insert into that table (a ready-made
snippet is at the bottom of `hq-optional-schema.sql`).

## 9. File map

```
admin/
  index.html        classic CMS (+ 1 link to HQ, 1 scoped style)
  admin.js          unchanged logic (+ optional ?tab= deep-link shim)
  admin.css         untouched
  hq/
    index.html            HQ shell
    hq.css               layout on top of admin.css tokens
    hq-data.js           data layer + integration switches (HQ_CONFIG)
    hq-core.js           icons, dialogs, tables, empty states, SVG charts
    hq-views-home.js     Overview, System Status
    hq-views-social.js   Accounts, Composer, AI SEO Studio, Languages
    hq-views-schedule.js Scheduler, Publishing History, Social Analytics
    hq-views-content.js  Media, Games, Announcements, Blog, Support
    hq-views-insights.js Downloads, Website Analytics, Ads, Settings
    hq-app.js            shell, sidebar, router, auth
    hq-optional-schema.sql
    INTEGRATION.md
js/
  site-controls.js   opt-in (not referenced by the site by default)
```

## 10. Theme contract

HQ loads `../admin.css` first, so it inherits `--bg #0a0a14`, `--card #161628`,
`--bd #23233d`, `--tx`, `--mut`, the cyan accent `#00e5ff`, the purple→cyan
gradient buttons, the Orbitron/Inter pairing, the 12–20 px radii and the existing
`.btn`, `.bd`, `.msg`, `.toast`, `.gate` components. `hq.css` adds only layout,
tables, charts, calendars and dialogs. No new colour system, no new font, no new
dependency (charts are hand-drawn SVG).
