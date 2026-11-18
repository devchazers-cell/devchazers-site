# AI Website Manager — README

AI Website Manager turns the existing DevChazers HQ into an operator: you write a command (Roman Urdu / Urdu / English), it picks a real tool, you approve live changes, and every step is visible while it happens and logged afterwards.

It is **not** a chatbot. Nothing is simulated: if a step says “API action”, a Cloudflare Function really called Supabase; if a result says “Verified from database”, the row was read back after the write.

---

## 1. What is new (additive only)

| File | What it does |
|---|---|
| `functions/api/hq/ai.js` | The endpoint `/api/hq/ai` (SSE). Auth, kill switch, budget, approvals, execution, verification, logging |
| `functions/api/hq/_ai_tools.js` | Tool registry — 22 tools with real Supabase operations, previews and verify functions |
| `functions/api/hq/_ai_agent.js` | Provider adapter (Gemini / Groq / OpenAI), JSON contract, model fallback, honest error codes |
| `admin/hq/hq-views-ai.js` | Two new HQ views: **AI Assistant** (`#/ai`) and **Live Activity** (`#/ai/activity`) |
| `admin/hq/ai-manager-schema.sql` | 6 new tables, RLS + policies, rollback block at the bottom |
| `admin/hq/hq.css` | Appended block only (`.hq-ai*`) — nothing above was edited |
| `admin/hq/hq-app.js` | 2 nav entries + 2 titles |
| `admin/hq/index.html` | 1 `<script>` tag |
| `js/site-controls.js` | Banner renderer + reuses the single shared Supabase client |
| `devchazers-pages-upload/index.html` | 1 `<script>` tag that switches `site-controls.js` on |
| `admin/hq/AI-MANAGER-{PLAN,SECURITY,TEST-REPORT}.md` | Documentation |

Untouched: `js/site.js`, `js/data-service.js` (beyond the previous session’s guard work), `css/*`, `admin/admin.js`, all existing tables, all existing views.

---

## 2. Deploy (order matters)

Nothing here has been deployed yet. Upload **code + functions together** — `admin/hq/index.html` loads `hq-session.js` first, so a partial upload breaks HQ.

1. **Run the SQL** — Supabase → SQL Editor → paste `admin/hq/ai-manager-schema.sql` → Run. It is idempotent (safe twice) and only creates `ai_*` tables.
2. **Upload the files** (GitHub → your Pages project, or drag into the Pages deployment):
   - `functions/api/hq/ai.js`, `functions/api/hq/_ai_tools.js`, `functions/api/hq/_ai_agent.js`
   - `admin/hq/hq-views-ai.js`, `admin/hq/ai-manager-schema.sql`, `admin/hq/hq-app.js`, `admin/hq/index.html`, `admin/hq/hq.css`
   - plus the still-undeployed previous fix pack: `functions/api/hq/{_ai.js,ai-key.js,status.js,ai-seo.js,accounts.js,...}`, `admin/hq/*`, `js/data-service.js`
   - `js/site-controls.js` and the root `index.html` (banner + maintenance + popup become live)
3. **Check the backend**: open `https://devchazers.site/api/hq/status` → must be **JSON**. If you get HTML, the Functions did not deploy.
4. **Sign in** at `https://devchazers.site/admin/hq` → **AI Assistant**.
5. **Connect a free AI key**: AI Assistant → “Connect a free AI key” (opens the existing AI setup modal) *or* set the env vars below. A free Google AI Studio key is enough.
6. **Test**: type `Website ka status batao` → steps should appear one by one, then a result with **Verified**.
7. **Test a write**: type `Homepage par banner laga do: "Hello from HQ"` → approval card → Approve → then reload `https://devchazers.site` and the bar is there.

`wrangler.jsonc` must **not** be changed. `functions/` is deployed by Pages.

---

## 3. Environment variables (Cloudflare Pages → Settings → Environment variables)

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | yes (already set — health says `serverReady:true`) | DB + `requireAdmin()` |
| `HQ_TOKEN_KEY` | yes (already set) | AES seal/unseal of OAuth tokens |
| `HQ_ADMIN_EMAILS` | recommended | extra allow-list |
| `AI_API_KEY` + `AI_PROVIDER` | optional | key in env instead of DB (`gemini` \| `groq` \| `openai`); DB key wins only if env is empty |
| `AI_MODEL` | optional | pin a model |
| **`HQ_AI_ACTIONS`** | optional | `off` = **hard kill switch** (overrides the UI toggle) |
| `HQ_AI_MONTHLY_REQUESTS` | optional | monthly AI-call cap, default **1200**, min 50 |
| `HQ_AI_APPROVAL_MINUTES` | optional | approval lifetime, default 30 |
| `HQ_CRON_SECRET`, `META_*`, `X_*` | unchanged | not needed by the AI Manager |

No new secret is required: the manager reuses the existing service role (server-side only).

---

## 4. Tools

**Read / prepare (A — runs immediately):**
`get_website_status`, `get_website_settings`, `get_pages`, `get_page_content`, `list_games`, `get_game_details`, `list_media`, `get_visitor_analytics`, `get_download_statistics`, `get_connected_accounts`, `get_publish_status`, `get_system_status`, `get_recent_activity`, `prepare_social_post` (draft only).

**Needs your approval (B):**
`update_homepage_banner`, `set_maintenance_mode`, `update_popup`, `update_website_setting` (whitelist: `site_name, contact_email, about_text, support_text, footer_text, homepage_title, homepage_description, social_discord, favicon_url, show_*`), `update_page_content`, `create_page`, `update_game`, `create_game`, `update_game_download_link`.

**Strong confirmation, type `DELETE` (C):**
`delete_page`, `delete_game`, `delete_media` (row only — the stored file is left alone).

Every B/C action also shows **Before → After** before you approve, and is verified by re-reading the row afterwards.

---

## 5. Example commands

- `Website ka status batao`
- `Homepage par banner laga do: "Eid Mubarak — 2 new games live!"`
- `Banner hata do`
- `Maintenance mode on kar do — 10 minute ke liye, message: "Back with new games"`
- `Privacy policy page ka content update karo: …`
- `Ludo Classic ka Play Store link update karo: https://…`
- `Games ki list dikhao aur batado kaun si published hain`
- `Akhri 30 din me kitne download clicks aaye?`
- `YouTube ke liye ek draft post prepare karo: …` (draft only — publishing still needs the existing adapters + a human click)

---

## 6. Budget & limits

- **Free-first:** Gemini free tier (default) or Groq free tier. A paid provider is **never** selected automatically — `AI_PROVIDER` is explicit, and OpenAI is only used if you set it.
- **PKR 0 spent** by design; the Live Activity panel shows provider, model, requests, tokens and errors per month.
- **Hard guard:** when the monthly call cap is reached, chat returns `budget_cap` and stops — it cannot silently overflow into a paid tier.
- Also enforced: 20 requests/minute per admin, one AI call per turn, one tool per turn, approval expiry 30 min, approval bound to the admin who created it.

---

## 7. Notes & limits you should know

- **Browser-generated “progress” is not used.** Steps come from the server. If a step is slow, you see it spinning — because it really is running.
- **Stop** aborts the HTTP stream. A category-B/C action is not even started until you approve, so Stop is always safe there. A read (A) may have already completed on the server — the log will show it.
- **Approvals are single-use and expire.** Re-using one returns `used`/`expired`.
- **Media deletion removes the DB row only.** Storage objects are untouched (deliberate — no silent file deletion).
- **Visitor analytics will honestly show zero** unless a visitor tracker writes to `hq_site_visits`; the AI reports “tracker not installed” rather than inventing numbers.
- **The AI never sees your keys.** Keys stay in Cloudflare env or the `hq_ai_keys` table (RLS, anon revoked) and are read server-side.

---

## 8. Rollback

1. **Disable instantly (no deploy):** HQ → Live Activity → **Kill switch**, or set `HQ_AI_ACTIONS=off` in Cloudflare. AI tools stop; the rest of HQ and the website are unaffected.
2. **Revert code:** redeploy the previous commit. The new files are additive; deleting `hq-views-ai.js` + the two `index.html` script lines + the 2 nav lines restores the old shell exactly.
3. **Revert the website switches:** remove `<script src="js/site-controls.js" defer></script>` from the root `index.html`. The banner/maintenance/popup stop rendering; `site.js` is untouched either way.
4. **Drop the tables** (only if you want the history gone): the commented `begin; … drop table …; commit;` block at the bottom of `ai-manager-schema.sql`.
