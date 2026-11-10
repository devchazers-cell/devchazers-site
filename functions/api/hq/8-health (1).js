/* ============================================================================
   GET /api/hq/health   (public, no auth required)

   Answers one question from any browser: "are the server secrets configured?"
   It returns ONLY booleans and the NAMES of missing variables — never a value,
   never a key fragment. Safe to paste into a chat or screenshot.
   ========================================================================== */
import { conf, urlShape } from './_shared.js';

/* Tables that must exist for OAuth + publishing to work. */
const TABLES = ['hq_social_accounts', 'hq_social_tokens', 'hq_social_posts'];

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
  const coreReady = !!(c.url && c.anon && c.svc && env.HQ_TOKEN_KEY && String(env.HQ_TOKEN_KEY).length >= 16);
  const host = new URL(request.url).host;

  /* Probe the tables with the service role — tells you before you click Connect
     whether the schema is really applied. Only booleans + error text come back;
     PostgREST error messages never contain the key. */
  const tables = {};
  const tableErrors = {};
  if (c.url && c.svc) {
    for (const t of TABLES) {
      try {
        /* select=* works for every table (hq_social_tokens has no `id` column). */
        const r = await fetch(c.url + '/rest/v1/' + t + '?select=*&limit=1', {
          headers: { apikey: c.svc, authorization: 'Bearer ' + c.svc }
        });
        if (r.ok) { tables[t] = true; }
        else {
          const j = await r.json().catch(() => ({}));
          tables[t] = false;
          tableErrors[t] = 'HTTP ' + r.status + ' · ' + (j.code || '') + ' ' + (j.message || '').slice(0, 140);
          if (j && (j.code === '42P01' || /does not exist/i.test(j.message || ''))) missing.push('TABLE ' + t + ' (run hq-schema.sql)');
        }
      } catch (e) { tables[t] = false; tableErrors[t] = String(e.message || e).slice(0, 140); }
    }
  }
  const tablesReady = Object.keys(tables).length > 0 && Object.values(tables).every(Boolean);
  const ready = coreReady && tablesReady;

  return new Response(JSON.stringify({
    ok: true,
    api: 'deployed',
    host,
    serverReady: ready,
    serverReadyMeans: 'Every core secret is present and the HQ tables exist. OAuth/publishing can work.',
    coreReady,
    urlShape: urlShape(env),
    tables,
    tablesReady,
    tableErrors,
    providers,
    missing,
    nextStep: ready
      ? 'Everything is ready. Open HQ → Social → Accounts → Connect YouTube. Register this redirect URI with Google first: https://' + host + '/api/hq/oauth/youtube/callback'
      : (coreReady ? 'Secrets are fine, but an HQ table is missing — run admin/hq/hq-schema.sql in Supabase.' : 'Add the variables listed in "missing" as Cloudflare secrets, then redeploy.')
  }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequest({ request, env }) {
  return onRequestGet({ request, env });
}
