/* GET /api/hq/connect/callback      (Google redirects the browser here)

   No Authorization header exists on a browser redirect — authorisation is the
   signed 15-minute state issued by start.js to a verified admin.

   Stores:
     hq_channel_accounts  one row per CONNECTED channel (platform + external_id)
     hq_channel_tokens    AES-GCM sealed token, keyed by account_id, no RLS
                          policies at all → service role only
   ========================================================================== */
import { providerConfig, originOf, readState, seal, svc, uid } from '../_shared.js';

const back = (env, request, qs) => new Response(null, {
  status: 302,
  headers: { location: originOf(request, env) + '/admin/hq/' + (qs || ''), 'cache-control': 'no-store' }
});

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('error')) return back(env, request, '#/social/studio?connect=denied');

  const code = url.searchParams.get('code') || '';
  let state;
  try { state = await readState(env, url.searchParams.get('state')); }
  catch (e) { return back(env, request, '#/social/studio?connect=badstate'); }

  const channelCode = String(state.ch || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(channelCode)) return back(env, request, '#/social/studio?connect=nochannel');

  const p = providerConfig(env, 'youtube');
  if (!p || !p.clientId || !p.clientSecret) return back(env, request, '#/social/studio?connect=not_configured');

  /* --- 1 · code → tokens ------------------------------------------------- */
  let tok = {};
  try {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: originOf(request, env) + '/api/hq/connect/callback',
      client_id: p.clientId,
      client_secret: p.clientSecret
    });
    const res = await fetch(p.tokenUrl, { method: 'POST', body: form });
    tok = await res.json().catch(() => ({}));
    if (!res.ok || !tok.access_token) return back(env, request, '#/social/studio?connect=token_failed&ch=' + encodeURIComponent(channelCode));
  } catch (e) {
    return back(env, request, '#/social/studio?connect=token_unreachable&ch=' + encodeURIComponent(channelCode));
  }

  /* --- 2 · which channel did the human pick? ----------------------------- */
  let prof = {};
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
      headers: { authorization: 'Bearer ' + tok.access_token }
    });
    const d = await r.json();
    const ch = d.items && d.items[0];
    if (ch) {
      const handle = '@' + String(ch.snippet.customUrl || ch.snippet.title.replace(/\s+/g, '').toLowerCase()).replace(/^@+/, '');
      prof = {
        external_id: ch.id,
        name: ch.snippet.title,
        username: handle,
        profile: 'https://www.youtube.com/' + ch.id,
        subscribers: Number((ch.statistics || {}).subscriberCount || 0)
      };
    }
  } catch (e) { /* profile best-effort; token storage still proceeds */ }

  if (!prof.external_id) return back(env, request, '#/social/studio?connect=no_channel&ch=' + encodeURIComponent(channelCode));

  const now = new Date().toISOString();
  const expires = tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString() : null;

  /* --- 3 · store the account (one row per platform+channel) -------------- */
  let accountId = '';
  try {
    const rows = await svc(env, 'hq_channel_accounts?on_conflict=platform,external_id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{
        id: uid('acc'),
        channel_code: channelCode,
        platform: 'youtube',
        external_id: prof.external_id,
        name: prof.name || '',
        username: prof.username || '',
        profile: prof.profile || '',
        status: 'connected',
        scopes: p.scope,
        expires_at: expires,
        last_sync: now,
        updated_at: now
      }])
    });
    accountId = (rows && rows[0] && rows[0].id) || '';
  } catch (e) {
    return back(env, request, '#/social/studio?connect=store_failed&ch=' + encodeURIComponent(channelCode));
  }

  /* --- 4 · seal the token ------------------------------------------------ */
  try {
    const sealed = await seal(env, {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || '',
      expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
      scope: tok.scope || p.scope,
      token_type: tok.token_type || 'Bearer'
    });
    await svc(env, 'hq_channel_tokens?on_conflict=account_id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ account_id: accountId, oauth_enc: sealed, updated_at: now }])
    });
  } catch (e) {
    return back(env, request, '#/social/studio?connect=seal_failed&ch=' + encodeURIComponent(channelCode));
  }

  /* --- 5 · mirror the public handle onto the channel profile ------------- */
  try {
    await svc(env, 'hq_channels?code=eq.' + encodeURIComponent(channelCode), {
      method: 'PATCH',
      body: JSON.stringify({
        handle: prof.username || null,
        url: prof.profile || null,
        status: 'active',
        account_ref: accountId,
        updated_at: now
      })
    });
  } catch (e) { /* profile mirror is cosmetic; the account is already usable */ }

  return back(env, request, '#/social/studio?connect=ok&ch=' + encodeURIComponent(channelCode));
}
