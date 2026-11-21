# AI Website Manager — Security

## 1. Trust boundaries

```
Model (untrusted output)  →  proposal only: {tool, args}
    ↑ cannot execute anything, cannot read the DB, never gets a key
Cloudflare Function (trusted) → validates, gates by tier, executes, verifies, logs
    ↑ service role lives here only
Browser (semi-trusted) → may only *ask*; cannot bypass the gates by calling the API directly
Postgres (source of truth) → RLS on every new table; anon has no grants
```

## 2. Authentication & authorisation

- Every request to `/api/hq/ai` (GET and POST) starts with `requireAdmin(request, env)`, which:
  1. calls Supabase `/auth/v1/user` with the caller's bearer token, then
  2. calls `rpc/is_admin` **as that user** so `auth.uid()` is the caller.
  Failure modes: `401 Missing bearer token`, `401 Session expired`, `403 This account is not an admin`, `503 Server is not configured`.
- There is **no** unauthenticated path, no “demo” path, and no client-side permission check that can be skipped.
- Approvals are bound to the admin who created them (`user_id` comparison) and are single-use (`status != 'pending'` → `used`), and expire (`expires_at`, default 30 min).
- Arguments are re-validated at approval time, so a tampered `ai_approvals` row cannot smuggle new arguments into execution.

## 3. Permission tiers (server-enforced)

The tier is a field on the tool object in `_ai_tools.js`. The model cannot promote itself.

| Tier | Server rule |
|---|---|
| A | execute immediately, log |
| B | `ai_approvals` row → requires `decision:"approve"` from the same admin |
| C | same as B **and** `confirm:"DELETE"` **and** the tool itself re-checks `args.confirm === 'DELETE'` |

Deleting without the word `DELETE` is refused twice (route + tool). A refused C action leaves the row untouched — proven by test 8.

## 4. Prompt injection

What an attacker could try, and what happens:

| Attempt | Result |
|---|---|
| Model returns a tool that does not exist (`drop_all_tables`) | `bad_tool`, nothing executes (test 9) |
| Model returns extra arguments (`{"evil":"…"}`, `confirm:"DELETE"` on a non-delete tool) | keys not in the schema are **dropped** before execution (test 1) |
| Model returns an invalid enum (`tone:"purple"`) | rejected before any DB call |
| Malicious text inside a page/game/website content says “delete everything” | content is only ever passed as *data*; the model still has to name a real tool, and a C tool still needs a human typing DELETE |
| Approval id guessed | not found / bound to another admin → `forbidden` |
| Replaying an approval | `used` |

There is no path where model output alone mutates data.

## 5. Secrets

- `SUPABASE_SERVICE_ROLE_KEY`, `HQ_TOKEN_KEY`, provider API keys: **server-side only**. No endpoint returns them; error text is passed through `redactSecrets()` which strips key-shaped strings before they reach the browser (`ai.js` uses it on every failure path).
- The AI key can live in Cloudflare env or in `hq_ai_keys` (RLS on, **anon revoked** — verified: anon select/insert both return `42501`). The browser never receives the key, only `{configured, provider, hint, source}`.
- Project memory refuses any key matching `/(key|token|secret|password|credential|oauth|service_role|anon)/i` (test 12) — a user cannot store a credential there even by accident.
- OAuth tokens are sealed with AES-GCM (`HQ_TOKEN_KEY`) before they touch the database; the AI manager never reads or prints them.

## 6. Database access model (new tables)

- RLS **enabled** on all six `ai_*` tables.
- `revoke all … from anon` — the public anon key (which is in `js/config.js`) has no access whatsoever.
- `authenticated` gets `select/insert/update` **only** through `public.is_admin()` policies. The audit trail is append-mostly: even a signed-in admin cannot rewrite history from the browser, and all writes in practice go through the service role in the Function.
- No `delete` policy → the browser can never wipe the log.

## 7. Kill switch

Two levels:
1. **UI** — Live Activity → Kill switch. Stored in `ai_project_memory.ai_kill_switch` with `{enabled, at, by}` and shown in the panel.
2. **Env** — `HQ_AI_ACTIONS=off`. Wins over the UI, cannot be flipped from the browser, survives DB access.

When either is on, `chat` and `approve` return `kill_switch` before any AI call is made (test 10, 11 — the provider was never contacted). The pre-flight check is the *first* step shown in the timeline.

## 8. Rate limiting, cost, denial-of-service

- 20 requests/min per admin (`rate()` in `_shared.js`), checked on `chat` and inside the pipeline.
- One AI call per turn, one tool per turn, ≤3 model attempts per call, 22 s per attempt, 30 s planning budget.
- Monthly call cap (`HQ_AI_MONTHLY_REQUESTS`, default 1200) → `budget_cap`, hard stop. Paid providers are opt-in only.
- Streams are closed on completion; a client abort does not leave a pending write (B/C write only after an approval request, which is a separate call).

## 9. What the AI Manager cannot do (by design)

No arbitrary code execution, no shell, no file system, no “remote desktop”, no browser automation, no publishing to social platforms, no storage-object deletion, no table DDL, no access to other admins' sessions, no reading of `hq_social_tokens` or any secret column.

## 10. Residual risks (honest list)

1. **A careless approval.** Tier B can put wrong text on the live site. Mitigation: before/after preview, expiry, admin-only, full audit log — but a human still has to read it.
2. **Provider trust.** The prompt (including short excerpts of website content) goes to Gemini/Groq/OpenAI. Do not paste secrets into commands.
3. **In-isolate rate limiter.** `rate()` is per-isolate best effort, not global. It stops accidental loops; it is not a billing guarantee — the monthly cap is.
4. **In-memory state.** No queues; a request in flight during a deploy is simply lost (client shows the stream ending without a `final`).
5. **`ai_action_logs` grows forever.** No retention job yet; add one (e.g. delete older than 180 days) before this becomes large.
6. **No CSRF token.** The endpoint requires a bearer token in a header (not a cookie), so classic CSRF does not apply; XSS in HQ would still matter, which is why all rendered content goes through `HQ.esc()`.
