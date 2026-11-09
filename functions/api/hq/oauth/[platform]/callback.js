/* GET /api/hq/oauth/:platform/callback
   Exchanges the authorization code for tokens, reads the account profile and
   stores everything encrypted (AES-GCM, key = HQ_TOKEN_KEY) in
   hq_social_accounts.oauth_enc. The browser never sees a token. */
import { providerConfig, redirectUri, readState, originOf, seal, svc, uid } from '../../_shared.js';

const back = (env, request, qs) => new Response(null, {
  status: 302,
  headers: { location: originOf(request, env) + '/admin/hq/' + (qs || '') , 'cache-control': 'no-store' }
});

async function profile(platform, token) {
  try {
    if (platform === 'youtube') {
      const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: 'Bearer ' + token } });
      const d = await r.json();
      const ch = d.items && d.items[0];
      return ch ? { name: ch.snippet.title, username: '@' + (ch.snippet.customUrl || ch.snippet.title.replace(/\s+/g, '').toLowerCase()), profile: 'https://www.youtube.com/channel/' + ch.id, id: ch.id } : {};
    }
    if (platform === 'facebook') {
      const r = await fetch('https://graph.facebook.com/v21.0/me/accounts?access_token=' + encodeURIComponent(token));
      const d = await r.json();
      const page = d.data && d.data[0];
      return page ? { name: page.name, username: page.id, profile: 'https://facebook.com/' + page.id, page_id: page.id, page_token: page.access_token } : {};
    }
    if (platform === 'instagram') {
      const r = await fetch('https://graph.facebook.com/v21.0/me/accounts?fields=name,instagram_business_account{username}&access_token=' + encodeURIComponent(token));
      const d = await r.json();
      const page = (d.data || []).find(p => p.instagram_business_account);
      const ig = page && page.instagram_business_account;
      return ig ? { name: ig.username, username: '@' + ig.username, page_id: page.id, page_token: page.access_token, id: ig.id } : {};
    }
    if (platform === 'threads') {
      const r = await fetch('https://graph.threads.net/v1.0/me?fields=username&access_token=' + encodeURIComponent(token));
      const d = await r.json();
      return d && d.username ? { name: d.username, username: '@' + d.username, id: d.id } : {};
    }
    if (platform === 'x') {
      const r = await fetch('https://api.twitter.com/2/users/me', { headers: { authorization: 'Bearer ' + token } });
      const d = await r.json();
      return d && d.data ? { name: d.data.name, username: '@' + d.data.username, profile: 'https://x.com/' + d.data.username, id: d.data.id } : {};
    }
  } catch (e) { /* profile is best-effort; token storage still succeeds */ }
  return {};
}

export async function onRequestGet({ request, env, params }) {
  const platform = String(params.platform || '');
  const url = new URL(request.url);
  const err = url.searchParams.get('error');
  if (err) return back(env, request, '#/social/accounts?oauth=denied&platform=' + encodeURIComponent(platform));

  /* The provider redirects the *browser* here, so there is no Authorization
     header. Authorisation is the signed, 15-minute state value that start.js
     only ever issued to a verified admin. */
  const code = url.searchParams.get('code') || '';
  let state;
  try { state = await readState(env, url.searchParams.get('state')); }
  catch (e) { return back(env, request, '#/social/accounts?oauth=badstate'); }
  if (state.platform !== platform) return back(env, request, '#/social/accounts?oauth=platform_mismatch');

  const p = providerConfig(env, platform);
  if (!p || !p.clientId) return back(env, request, '#/social/accounts?oauth=not_configured');

  try {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(request, env, platform),
      client_id: p.clientId,
      client_secret: p.clientSecret
    });
    if (state.verifier) form.set('code_verifier', state.verifier);

    const tokRes = await fetch(p.tokenUrl, { method: 'POST', body: form });
    const tok = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tok.access_token) {
      return back(env, request, '#/social/accounts?oauth=token_failed&platform=' + encodeURIComponent(platform));
    }
    const prof = await profile(platform, tok.access_token);
    const expires = tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null;

    const oauth = await seal(env, {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || '',
      page_access_token: prof.page_token || '',
      page_id: prof.page_id || '',
      expires_at: expires,
      scope: tok.scope || p.scope
    });

    const row = {
      platform,
      name: prof.name || p.name,
      username: prof.username || '',
      profile: prof.profile || '',
      page_id: prof.page_id || '',
      status: 'connected',
      scopes: tok.scope || p.scope,
      expires_at: expires ? new Date(expires).toISOString() : null,
      last_sync: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    /* 1) encrypted token → hq_social_tokens (service-role only) */
    const trow = { platform, oauth_enc: oauth, updated_at: new Date().toISOString() };
    const existingTok = await svc(env, 'hq_social_tokens?platform=eq.' + encodeURIComponent(platform) + '&select=platform');
    if (existingTok && existingTok.length) {
      await svc(env, 'hq_social_tokens?platform=eq.' + encodeURIComponent(platform), { method: 'PATCH', body: JSON.stringify(trow) });
    } else {
      await svc(env, 'hq_social_tokens', { method: 'POST', body: JSON.stringify(trow) });
    }

    /* 2) public-safe account metadata → hq_social_accounts */
    const existing = await svc(env, 'hq_social_accounts?platform=eq.' + encodeURIComponent(platform) + '&select=id');
    if (existing && existing.length) {
      await svc(env, 'hq_social_accounts?id=eq.' + encodeURIComponent(existing[0].id), { method: 'PATCH', body: JSON.stringify(row) });
    } else {
      await svc(env, 'hq_social_accounts', { method: 'POST', body: JSON.stringify(Object.assign({ id: uid('acc') }, row)) });
    }
    return back(env, request, '#/social/accounts?oauth=ok&platform=' + encodeURIComponent(platform));
  } catch (e) {
    return back(env, request, '#/social/accounts?oauth=server_error&msg=' + encodeURIComponent(String(e.message).slice(0, 120)));
  }
}
