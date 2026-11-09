/* ============================================================================
   /api/hq/accounts
     GET    → list linked accounts (never returns tokens)
     POST   → save a handle manually (status stays authorization_required)
     DELETE ?platform=… → revoke: removes the stored OAuth token server-side
   ========================================================================== */
import { json, fail, requireAdmin, svc, uid, rate } from './_shared.js';

const PUBLIC_COLS = 'id,platform,name,username,profile,page_id,status,scopes,expires_at,last_sync,created_at,updated_at';

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  try {
    const rows = await svc(env, 'hq_social_accounts?select=' + PUBLIC_COLS + '&order=platform.asc');
    return json({ ok: true, accounts: rows || [] });
  } catch (e) {
    return fail('Could not read hq_social_accounts — has hq-schema.sql been applied? ' + e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!rate('acct:' + (auth.user.id || 'x'), 30, 60_000)) return fail('Too many changes — wait a minute.', 429);

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('Body must be JSON.'); }
  const platform = String(body.platform || '').trim();
  if (!/^[a-z]{2,12}$/.test(platform)) return fail('Unknown platform.');
  const name = String(body.name || '').slice(0, 120);
  const username = String(body.username || '').slice(0, 120);
  if (!name && !username) return fail('Enter the account name or username.');

  try {
    const existing = await svc(env, 'hq_social_accounts?platform=eq.' + encodeURIComponent(platform) + '&select=id,status');
    const row = {
      platform,
      name,
      username,
      profile: String(body.profile || '').slice(0, 300),
      page_id: String(body.page_id || '').slice(0, 80),
      status: 'authorization_required',
      updated_at: new Date().toISOString()
    };
    if (existing && existing.length) {
      await svc(env, 'hq_social_accounts?id=eq.' + encodeURIComponent(existing[0].id), { method: 'PATCH', body: JSON.stringify(row) });
      return json({ ok: true, id: existing[0].id, status: 'authorization_required' });
    }
    const id = uid('acc');
    await svc(env, 'hq_social_accounts', { method: 'POST', body: JSON.stringify(Object.assign({ id }, row)) });
    return json({ ok: true, id, status: 'authorization_required' });
  } catch (e) {
    return fail('Could not save: ' + e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  const platform = new URL(request.url).searchParams.get('platform') || '';
  if (!/^[a-z]{2,12}$/.test(platform)) return fail('Unknown platform.');
  try {
    /* Delete the encrypted token row, keep the handle so history stays readable.
       hq_social_tokens has RLS enabled and no policies: only the service role
       (this function) can ever touch it. */
    await svc(env, 'hq_social_tokens?platform=eq.' + encodeURIComponent(platform), { method: 'DELETE' });
    await svc(env, 'hq_social_accounts?platform=eq.' + encodeURIComponent(platform), {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disconnected', scopes: null, expires_at: null, updated_at: new Date().toISOString() })
    });
    return json({ ok: true });
  } catch (e) {
    return fail('Could not revoke: ' + e.message, 500);
  }
}

export async function onRequest({ request, env }) {
  return fail('Method not allowed.', 405);
}
