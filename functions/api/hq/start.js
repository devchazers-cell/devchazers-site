/* GET /api/hq/connect/start?channel=CODE[&json=1]      (admin session)

   Per-channel YouTube connect. Redirect URI is ONE fixed callback
   (/api/hq/connect/callback) for every channel — which channel this is travels
   inside the HMAC-signed state, so you register that URI only once in Google
   Cloud Console.

   Google consent screen par agar tumhare Google account ke multiple brand
   channels hain, wahan se channel choose hota hai; hum yahin `mine=true` se
   asli channel id nikal kar usi code ke saath store karte hain.
   ========================================================================== */
import { requireAdmin, providerConfig, originOf, makeState, json } from '../_shared.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return new Response(auth.error, { status: auth.status });

  const url = new URL(request.url);
  const code = String(url.searchParams.get('channel') || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(code)) return new Response('channel code chahiye (a-z0-9-_ , 2-32 chars).', { status: 400 });

  const p = providerConfig(env, 'youtube');
  if (!p || !p.clientId || !p.clientSecret) {
    return new Response('YouTube OAuth server par configured nahi hai. Cloudflare me YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET add karo.', { status: 501 });
  }

  const state = await makeState(env, { ch: code, uid: auth.user.id, nonce: crypto.randomUUID() });
  const authUrl = new URL(p.authUrl);
  authUrl.searchParams.set('client_id', p.clientId);
  authUrl.searchParams.set('redirect_uri', originOf(request, env) + '/api/hq/connect/callback');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', p.scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');

  if (url.searchParams.get('json') === '1') return json({ ok: true, url: authUrl.toString(), channel: code });
  return new Response(null, { status: 302, headers: { location: authUrl.toString(), 'cache-control': 'no-store' } });
}
