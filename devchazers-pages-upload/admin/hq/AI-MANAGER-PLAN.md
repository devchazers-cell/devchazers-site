# DevChazers HQ — AI Website Manager · Audit & Plan
**Date:** 12 November 2026 · **Repo:** `devchazers-cell/devchazers-site` · **Target:** `https://devchazers.site/admin/hq`
**Status:** Phase 1–6 implemented and tested locally. **Nothing has been deployed to production.**

---

## 1. Audit — what I actually found (evidence, not assumptions)

### 1.1 Deployment reality (this matters more than anything else)

| Probe (12 Nov 2026) | Result | Meaning |
|---|---|---|
| `GET /api/hq/health` | **200 + real JSON** `{ok:true, api:"deployed", serverReady:true, features:{metricsSync:true, cronSecret:true, aiEndpoint:false}}` | A Cloudflare backend **is** executing `functions/api/hq/health.js` on the live host |
| `GET /api/hq/status` | 200 + `text/html` (SPA fallback) | `status.js` is **not** deployed |
| `GET /api/hq/ai-key` | 200 + `text/html` | not deployed |
| `GET /admin/hq/hq-session.js` | 200 + `text/html` | the new HQ JS is **not** uploaded |
| `GET /api/hq/nope` | 200 + `text/html` | unknown paths fall back to the SPA (expected) |

**Conclusion:** the live site is served by Cloudflare **Pages with `functions/`** (that is the only mechanism that runs the `functions/api/hq/*.js` files on the same hostname). The repository's `wrangler.jsonc` is an *assets-only Worker* config (`name: devchazers-site`, `assets.directory: ./devchazers-pages-upload`, SPA `not_found_handling`) with **no `main` and no `functions` binding** — it cannot be what serves `/api/hq/health`, and it must **not** simply get `main: functions/...` bolted on (that would break SPA routing and duplicate the deployment).

**Therefore the deployment contract for this project is:**
- `functions/api/**` → Pages Functions (root of repo, file-based routes)
- `devchazers-pages-upload/**` → the static output directory
- **Never** edit `wrangler.jsonc` for AI Manager work.
- The AI Manager endpoints follow exactly the same pattern: `functions/api/hq/ai.js` → `/api/hq/ai`.

> ⚠️ The fix pack from the previous session (`status.js`, `ai-key.js`, new `hq-session.js`, Media rewrite) is **also still not deployed** — the probes prove it. HQ will not boot correctly if only *some* of the files are uploaded, because `admin/hq/index.html` loads `hq-session.js` first. **Upload code and functions in the same deploy.**

### 1.2 Database (read-only inspection of `pjhbydoodxfbkzqfelfz` — the ref taken from `js/config.js`)

| Table | Rows / state |
|---|---|
| `games` | 1 · columns `slug,name,category,version,short_desc,full_desc,icon_url,icon_path,screenshots,apk_url,play_url,status,release_date,featured,published` |
| `pages` | 1 · `title,slug,status,visibility,seo_title,seo_description,content` |
| `media` | 1 · `id` is **bigint** |
| `site_settings` | **0 rows** — the site currently renders its built-in defaults |
| `hq_social_accounts` / `hq_social_tokens` | 1 / 1 · YouTube “DevChazers – Global” `@devchazersglobal`, status `connected`, token stored, `expires_at 2026-11-12 07:53 UTC` |
| `hq_social_metrics` | 31 rows (all YouTube, latest 2026-11-12) |
| `hq_channels` / `hq_channel_accounts` | 5 / 5 · global, hindi, arabic, spanish, portuguese — all `active` |
| `hq_social_posts`, `hq_translation_sets`, `hq_seo_sets` | 0 |
| `is_admin()` | `SECURITY DEFINER` SQL function → `exists(select 1 from public.admins where user_id = auth.uid())` |
| `hq_ai_keys` | exists, RLS on, anon revoked (verified earlier: anon insert **and** select both return `42501`) |

### 1.3 What the public site can actually be changed by (the real write surface)

`js/site.js` → `applySettings()` reads `site_settings` and renders:
`site_name`, `contact_email`, `about_text`, `support_text`, `footer_text`, `homepage_title`, `homepage_description`, `favicon_url`, `social_discord`, `show_about/games/news/support`.
CMS pages render from `pages`; the games grid renders from `games`.

**Gap found:** maintenance mode and an announcement popup were documented in `js/site-controls.js` but that file **was not referenced by `index.html`**, and there was **no banner concept at all**. Any AI action writing those keys would have changed the database and *nothing on the website* — i.e. a fake success. Fixed in this phase (see §3.4).

---

## 2. Architecture

```
Browser (admin only)
  /admin/hq  ── hq-views-ai.js ──── chat UI, live timeline, approvals, kill switch
                     │  fetch (Bearer = Supabase access token)
                     ▼
Cloudflare Pages Function  /api/hq/ai.js
  1. requireAdmin()        → Supabase /auth/v1/user + rpc/is_admin   (server side)
  2. kill switch + budget   → ai_project_memory / ai_usage_stats
  3. plan                   → _ai_agent.js → Gemini | Groq | OpenAI (JSON mode)
                              {reply, tool, args}   ← proposal only
  4. validate               → _ai_tools.js validateArgs() — whitelist, enums, required
  5. category A → execute    │  category B/C → ai_approvals row (expires 30 min)
  6. verify                 → read the row back from Postgres
  7. log                    → ai_action_logs (args, before, after, verified, ms)
  8. stream                 → SSE events: step / reply / approval / final / error
                     ▼
Supabase (service-role, server-side only)
```

**Why SSE:** the timeline must be real. Progress is emitted by the server *as each operation finishes*, not animated by the client. If the AI call fails, the failing step turns red with the provider's own error text.

**Prompt-injection barrier:** the model can only emit a tool *name* and *arguments*. Names are matched against the registry (unknown → `bad_tool`), arguments are re-built from the declared schema (unknown keys are dropped), and category B/C never executes without an approval row bound to the same admin. Website content and tool output are passed to the model as data, and the system prompt states they are data — but even if the model disobeys, the server gates hold.

---

## 3. Phases 1–10

| # | Phase | State |
|---|---|---|
| 1 | Audit (repo, deployment, DB, site write surface) | ✅ done — §1 |
| 2 | Architecture + migration plan | ✅ done — §2, SQL is additive-only |
| 3 | Additive schema (`ai_conversations`, `ai_messages`, `ai_action_logs`, `ai_approvals`, `ai_project_memory`, `ai_usage_stats`) | ✅ written — `ai-manager-schema.sql`, **not yet run** |
| 4 | Tool registry + permission tiers | ✅ 22 tools: 13×A, 6×B, 3×C |
| 5 | Agent backend (`/api/hq/ai`) with approvals, kill switch, budget, logging | ✅ implemented, 50 automated checks |
| 6 | HQ UI: AI Assistant + Live Activity + right-hand task panel | ✅ implemented, 40 automated checks |
| 7 | Real site effects (banner today; maintenance/popup switched on) | ✅ `site-controls.js` wired into `index.html`, banner added |
| 8 | Docs: README, security, testing, rollback, paid list | ✅ this pack |
| 9 | Deploy to production | ⛔ **not done — waiting for your go-ahead** |
| 10 | Post-deploy verification on the live URL | ⛔ blocked by 9 |

**Deliberately out of scope / not implemented (and not faked):** arbitrary “remote control” of the website, publishing to social platforms from the AI (drafts only — publishing still needs the existing publish adapters and a human click), deleting storage objects, uploading files through the AI, and any tool that requires a paid API.

---

## 4. Permissions

| Tier | Meaning | Examples |
|---|---|---|
| **A** | AI runs on its own; read or draft only, no live change | website status, settings, pages, games, media list, visitors, downloads, social accounts, publish queue, system status, recent activity, **prepare_social_post** (creates a *draft*, never publishes) |
| **B** | Live change — approval card with before/after, then execute | homepage banner, maintenance mode, announcement popup, any whitelisted setting, page content/create, game update/create, download links |
| **C** | Destructive — approval **plus** typing `DELETE`, 30-minute expiry | delete page, delete game, delete media row |

Server-enforced: tier is a property of the tool in `_ai_tools.js`, not something the model can choose.
