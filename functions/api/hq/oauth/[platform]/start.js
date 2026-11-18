/* GET /api/hq/oauth/:platform/start
   Admin-only. Builds the provider consent URL and redirects. The state value is
   signed with HQ_TOKEN_KEY so the callback cannot be forged. */
import { requireAdmin, providerConfig, redirectUri, makeState } from '../../_shared.js';

export async function onRequestGet({ request, env, params }) {
  const platform = String(params.platform || '');
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return new Response(auth.error, { status: auth.status });

  const p = providerConfig(env, platform);
  if (!p) return new Response('Unknown platform: ' + platform, { status: 404 });
  if (!p.clientId || !p.clientSecret) {
    return new Response('OAuth for ' + p.name + ' is not configured on the server. Add ' + platform.toUpperCase() + '_CLIENT_ID / _CLIENT_SECRET.', { status: 501 });
  }

  const state = await makeState(env, { platform, uid: auth.user.id, nonce: crypto.randomUUID() });
  const url = new URL(p.authUrl);
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', redirectUri(request, env, platform));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', p.scope);
  url.searchParams.set('state', state);
  if (p.kind === 'pkce') {
    /* X requires PKCE; store the verifier inside the signed state. */
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => ('0' + b.toString(16)).slice(-2)).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    const signed = await makeState(env, { platform, uid: auth.user.id, verifier });
    url.searchParams.set('state', signed);
  }
  if (p.extra) Object.entries(p.extra).forEach(([k, v]) => url.searchParams.set(k, v));

  /* ?json=1 → hand the URL to the HQ page (it holds the admin session).
     Default → plain redirect, useful when you open the endpoint by hand. */
  if (new URL(request.url).searchParams.get('json') === '1') {
    return new Response(JSON.stringify({ ok: true, url: url.toString() }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  return new Response(null, { status: 302, headers: { location: url.toString(), 'cache-control': 'no-store' } });
}
