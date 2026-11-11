/* ============================================================================
   /api/hq/channels        (admin session)

   GET    → { channels: [...], accounts: [...] }   (tokens NEVER returned)
   POST   → create / update a channel profile (upsert on code)
   DELETE ?code=… → remove a profile (OAuth token is revoked separately)

   Channel profile = "kis channel par kaun si language, kis tone me, kis
   audience ke liye" — AI SEO isi profile se per-channel metadata banata hai.
   OAuth account usi code se juda hota hai (hq_channel_accounts.channel_code).
   ========================================================================== */
import { json, fail, requireAdmin, svc, rate } from './_shared.js';

const COUNTRY = /^[A-Z]{2}$/;
const LANG = /^[a-z]{2}(-[A-Z]{2})?$/;

const ACCOUNT_COLS = 'id,channel_code,platform,external_id,name,username,profile,status,scopes,expires_at,last_sync,created_at,updated_at';

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  try {
    const channels = await svc(env, 'hq_channels?select=*&order=created_at.asc');
    let accounts = [];
    try { accounts = await svc(env, 'hq_channel_accounts?select=' + ACCOUNT_COLS + '&order=created_at.asc'); }
    catch (e) { accounts = []; /* table not migrated yet — channels still work */ }
    return json({ ok: true, channels: channels || [], accounts: accounts || [] });
  } catch (e) {
    return fail('Could not read hq_channels: ' + e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!rate('chan:' + (auth.user.id || 'x'), 40, 60_000)) return fail('Too many changes — wait a minute.', 429);

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('Body must be JSON.'); }

  const code = String(body.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (code.length < 2 || code.length > 32) return fail('Channel code 2-32 characters (a-z, 0-9, - _).');
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return fail('Channel ka naam do.');

  const language = String(body.language || 'en').trim();
  if (!LANG.test(language)) return fail('Language BCP-47 honi chahiye, e.g. en, ur, hi, ar, es.');
  const country = String(body.country || '').trim().toUpperCase();
  if (country && !COUNTRY.test(country)) return fail('Country 2-letter code, e.g. PK, IN, US.');

  const row = {
    code,
    name,
    handle: String(body.handle || '').slice(0, 60),
    platform: 'youtube',
    url: String(body.url || '').slice(0, 300),
    country: country || null,
    status: ['planned', 'active', 'paused'].includes(body.status) ? body.status : 'active',
    description: String(body.description || '').slice(0, 1000),
    keywords: String(body.keywords || '').slice(0, 400),
    language,
    tone: String(body.tone || '').slice(0, 160),
    audience: String(body.audience || '').slice(0, 160),
    title_suffix: String(body.title_suffix || '').slice(0, 40)
  };

  try {
    const existing = await svc(env, 'hq_channels?code=eq.' + encodeURIComponent(code) + '&select=code');
    if (existing && existing.length) {
      await svc(env, 'hq_channels?code=eq.' + encodeURIComponent(code), { method: 'PATCH', body: JSON.stringify(row) });
    } else {
      await svc(env, 'hq_channels', { method: 'POST', body: JSON.stringify(row) });
    }
    return json({ ok: true, channel: row });
  } catch (e) {
    return fail('Could not save the channel: ' + e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  const code = (new URL(request.url).searchParams.get('code') || '').trim();
  if (!code) return fail('code chahiye.');

  try {
    /* Tokens first (service role only), then detach accounts, then the profile.
       Upload history rows stay behind on purpose: they are the audit trail. */
    try {
      const accs = await svc(env, 'hq_channel_accounts?channel_code=eq.' + encodeURIComponent(code) + '&select=id');
      for (const a of (accs || [])) {
        await svc(env, 'hq_channel_tokens?account_id=eq.' + encodeURIComponent(a.id), { method: 'DELETE' });
      }
      await svc(env, 'hq_channel_accounts?channel_code=eq.' + encodeURIComponent(code), { method: 'DELETE' });
    } catch (e) { /* pre-migration database: nothing to detach */ }
    await svc(env, 'hq_channels?code=eq.' + encodeURIComponent(code), { method: 'DELETE' });
    return json({ ok: true });
  } catch (e) {
    return fail('Could not delete: ' + e.message, 500);
  }
}
