# AI Website Manager — Test Report

**Date:** 12 November 2026 · **Node:** v20.20.2 · **Mode:** offline sandbox (no network, no Chromium available)
**Rule followed:** only tests that were *actually executed* are listed. Everything not run is listed at the end.
**Last run:** 12 Nov 2026, after the model-discovery fix · backend 57/57 · UI 40/40 · 27 views clean.

```
smoke/ai-agent.mjs   57 passed, 0 failed     ← real backend code, mocked DB + mocked provider
smoke/ai-ui.mjs      40 passed, 0 failed     ← real HQ scripts in jsdom, mocked HTTP
smoke/routes.mjs     27 views, 0 errors      ← every HQ view (25 existing + 2 new) mounts clean
smoke/media.mjs      ERRORS: none            ← media tab regression
smoke/upload.mjs     ERRORS: none            ← upload + RLS + size-limit regression
node --check         ai.js, _ai_tools.js, _ai_agent.js, hq-views-ai.js, hq-app.js, js/site-controls.js — all clean
```

---

## 0. Live bug found after the first deploy (12 Nov, 18:0x) and fixed

The first real command on production returned:

```
AI ne jawab nahi diya (gemini-3.8-flash:http_503, gemini-2.5-flash:model_gone, gemini-2.5-flash-lite:model_gone)
```

Two separate causes, both fixed:
1. **Hard-coded model names age out.** Google had retired `gemini-2.5-flash` / `2.5-flash-lite` (`404`), while the model saved in the dashboard (`gemini-3.8-flash`) was momentarily overloaded (`503`).
   Fix: `_ai_agent.js` now asks the provider for `GET /v1beta/models`, keeps the `generateContent` models, ranks them (newer version, `flash` over `pro`, `-latest` bonus, `lite` penalty) and caches the list for 10 minutes. Hard-coded names remain only as a last-resort fallback.
2. **A 503 was treated as final.** Fix: a busy/rate-limited model is retried once after 700 ms before moving on; if *every* model is only busy, the error is now `busy` with “30–60 second baad dobara bhejein — key theek hai”, and if every model is gone it is `no_model` with “naya free Gemini key connect karein”. No invented answer in either case.

Also fixed: `hq.css` had no `?v=` query, so the browser kept the old stylesheet — that is why the “Current task” timeline looked unstyled and appeared under the chat. It is now `hq.css?v=20261115`. A **Dobara bhejein** button was added to error bubbles.

New automated checks for exactly these cases: 17 (retired + busy → recovers on a live model, and the timeline names the model actually used), 18 (all busy → `busy`), 19 (all retired → `no_model`).

---

## 1. Backend suite — `smoke/ai-agent.mjs` (57 checks)

Not a mock of the feature: it imports the **real** `ai.js`, `_ai_tools.js`, `_ai_agent.js`, `_ai.js`, `_shared.js` and drives `onRequestGet` / `onRequestPost` with real `Request` objects. Only Supabase REST (in-memory PostgREST) and the AI provider (scripted JSON) are stubs, so tool execution, validation, approval flow, verification and SSE frames are the production code paths.

| # | Area | Checks |
|---|---|---|
| 1 | Registry integrity | A/B/C counts (13/6/3), `delete_page` is C, missing `confirm` rejected, bad enum rejected, **unknown args dropped** |
| 2 | `GET ?what=status` | 200/ok, key detected from env, kill switch off, tool counts, `PKR 0` budget shape |
| 3 | Auth | request without bearer → **401** |
| 4 | Chat → read tool | SSE content-type, 11 live steps, no “click” steps, execution step `done`, **real data returned** (`games_total:1`), row written to `ai_action_logs`, token usage recorded |
| 5 | Chat → write tool | `approval` event, category B, `needs_delete_word:false`, before/after preview, **nothing written before approval**, pending row stored |
| 6 | Approve | executed, **verified:true**, `site_settings` really updated (`hq_banner_enabled=true`, text written), approval marked `approved`, action logged with `verified:true` |
| 7 | Replay | second approve on the same id → `used` |
| 8 | Category C | approval flagged C, approve without `DELETE` → `need_delete` (page still exists), with `DELETE` → page gone + deletion verified |
| 9 | Prompt injection | `drop_all_tables` → `bad_tool`, nothing destroyed |
| 10 | Kill switch (UI) | ON stored, chat blocked, **provider never called**, OFF restores |
| 11 | Kill switch (env) | `HQ_AI_ACTIONS=off` blocks actions |
| 12 | Memory guard | `supabase_service_key` refused (400), `brand_tone` accepted |
| 13 | Provider failure | Gemini 400 “API key not valid” → `code:'bad_key'`, failed step visible with the provider's own message |
| 14 | History | `?what=history` returns the logged actions with tool + category |
| 15 | No key | `configured:false`; chat → `no_ai_key` (no invented answer) |
| 16 | Budget | with the monthly cap reached → `budget_cap`, provider never called |
| 17 | Model churn | retired model skipped, busy model retried and then succeeds, timeline names the real model |
| 18 | Everything busy | `busy` (retry advice), never a fake answer |
| 19 | Everything retired | `no_model` (reconnect the key), never a fake answer |

## 2. UI suite — `smoke/ai-ui.mjs` (40 checks, jsdom)

Loads the real `admin/hq/index.html` and every real HQ script (config excluded, CDN stripped), then mounts the real views with a stubbed `fetch`.

| # | Area | Checks |
|---|---|---|
| 1 | Registration | `/ai` and `/ai/activity` registered, `HQAI` state exists |
| 2 | Offline | assistant renders, **honest “backend not reachable” note**, no fabricated budget numbers, composer, 7 example chips, timeline empty state |
| 3 | Streamed run | user message, steps recorded from the stream, timeline in the right panel, **steps labelled “API action”**, the word “clicked” never appears, approval card, before/after diff, after-value, approve button |
| 4 | Approve | `POST {action:"approve"}` sent with the correct `approval_id` |
| 5 | Category C gate | DELETE input rendered, “Delete permanently” wording, **empty DELETE word does not execute** |
| 6 | Live Activity | page renders, budget card, `PKR 0 spent`, free-tier note, current-run card, pending approvals from server, action log row from server, verified marker, project memory, kill switch button |
| 7 | Kill switch | confirmation modal first, then the POST is sent |
| 8 | Log detail | row expands, arguments visible |
| 9 | Errors | **zero script errors** during every mount and run |

## 3. Regression

- `routes.mjs`: all 27 views mount; `/ai` 3.3 kB, `/ai/activity` 5.1 kB of HTML; `ERRORS: none`.
- `media.mjs`: media table read, error banner + Retry, no thrown errors (the original “Media tab” blocker stays fixed).
- `upload.mjs`: correct row payload, RLS error → “session expired” message, 6 MB image → size message.

## 4. Manually re-checked audit facts (same run)

- `wrangler.jsonc` has no `main`/`functions` binding → cannot serve `/api/hq/health`.
- Live `GET /api/hq/health` → real JSON; `/api/hq/status`, `/api/hq/ai-key`, `/admin/hq/hq-session.js` → SPA HTML.
- Supabase: `site_settings` is empty; `is_admin()` definition read; `games`/`pages`/`media`/`hq_*` columns read from `information_schema`.

---

## 5. NOT tested (and why)

| Not run | Reason / risk |
|---|---|
| A real Gemini/Groq request | No API key in the sandbox. The adapter is written against the documented JSON-mode API and its error mapping is covered by mocked responses. **First live call must be `Website ka status batao`.** |
| A real Supabase write from the agent | Would modify production data; you asked for no production changes before the plan is approved. Verified instead against an in-memory PostgREST with the real column names. |
| `ai-manager-schema.sql` execution | No Postgres in the sandbox. Syntax was reviewed (idempotent `create table if not exists`, `FOREACH … IN ARRAY` loop for policies) but not executed. It creates only `ai_*` tables; if any statement errors, nothing else in your database is affected. |
| Real browser rendering (Chrome/Safari layout, streaming in a real fetch) | No Chromium in the sandbox. jsdom proves the logic and DOM, not pixels. **Check the layout on the deployed URL.** |
| Mobile layout | CSS has breakpoints (1180 px / 640 px) but has not been seen on a phone. |
| Anything on `https://devchazers.site` | Nothing is deployed. All prod probes were read-only (`curl` GETs). |
| Load / concurrent approvals | Two admins approving simultaneously is handled by status checks but was not load-tested. |
