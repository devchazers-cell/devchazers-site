/* ============================================================================
   GET /api/hq/health   (public, no auth required)

   Answers one question from any browser: "are the server secrets configured?"
   It returns ONLY booleans and the NAMES of missing variables — never a value,
   never a key fragment. Safe to paste into a chat or screenshot.
   ========================================================================== */
import { conf } from './_shared.js';

const NEEDED = [
  ['SUPABASE_URL', env => !!env.SUPABASE_URL],
  ['SUPABASE_ANON_KEY', env => !!env.SUPABASE_ANON_KEY],
  ['SUPABASE_SERVICE_ROLE_KEY', env => !!env.SUPABASE_SERVICE_ROLE_KEY],
  ['HQ_TOKEN_KEY', env => !!(env.HQ_TOKEN_KEY && String(env.HQ_TOKEN_KEY).length >= 16)],
  ['HQ_SITE_ORIGIN', env => !!env.HQ_SITE_ORIGIN]
];

const PROVIDERS = [
  ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'youtube'],
  ['META_CLIENT_ID', 'META_CLIENT_SECRET', 'meta (Facebook / Instagram / Threads)'],
  ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'x']
];

export async function onRequestGet({ request, env }) {
  const core = {};
  const missing = [];
  NEEDED.forEach(([name, has]) => {
    const ok = has(env);
    core[name] = ok;
    if (!ok) missing.push(name);
  });

  const providers = {};
  PROVIDERS.forEach(([idVar, secretVar, label]) => {
    const ok = !!env[idVar] && !!env[secretVar];
    providers[label] = ok;
    if (!ok) { missing.push(idVar); missing.push(secretVar); }
  });

  const c = conf(env);
  const ready = !!(c.url && c.anon && c.svc && env.HQ_TOKEN_KEY && String(env.HQ_TOKEN_KEY).length >= 16);
  const host = new URL(request.url).host;

  return new Response(JSON.stringify({
    ok: true,
    api: 'deployed',
    host,
    serverReady: ready,
    serverReadyMeans: 'Every core secret is present. Publishing/OAuth can work.',
    core,
    providers,
    missing,
    nextStep: ready
      ? 'Secrets look complete. Open HQ → Social → Accounts → Connect YouTube, and register this redirect URI with Google: https://' + host + '/api/hq/oauth/youtube/callback'
      : 'Add the variables listed in "missing" as Cloudflare secrets, then redeploy.'
  }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequest({ request, env }) {
  return onRequestGet({ request, env });
}
