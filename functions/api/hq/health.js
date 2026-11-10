/* ============================================================================
   GET /api/hq/health   (public, no auth required)

   Answers one question from any browser: "is the server wired up correctly?"

   Returns ONLY booleans, counts and the NAMES of missing variables. Never a
   key, never a key fragment, never the secret URL value — so a screenshot of
   this response is safe to share. Error text is passed through redactSecrets()
   because a thrown fetch() error can quote the whole URL.
   ========================================================================== */
import { conf, urlShape, keyShape, redactSecrets } from './_shared.js';

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
  const uShape = urlShape(env);
  const kShape = keyShape(env);
  const host = new URL(request.url).host;

  /* Is the *shape* of the config usable? A key pasted into SUPABASE_URL is a
     config error, not a missing table — check it before probing anything. */
  const urlUsable = uShape.present && uShape.startsWithHttp && uShape.hostLikelyValid;
  const keyUsable = kShape.present && !kShape.looksLikeUrl;
  const configReady = urlUsable && keyUsable && core.SUPABASE_ANON_KEY &&
    core.HQ_TOKEN_KEY && core.HQ_SITE_ORIGIN;
  const coreReady = configReady;

  /* Probe the tables with the service role — tells you before you click Connect
     whether the schema is really applied. Only booleans + redacted error text. */
  const tables = {};
  const tableErrors = {};
  if (configReady) {
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
          tableErrors[t] = redactSecrets(env,
            'HTTP ' + r.status + ' · ' + (j.code || '') + ' ' + (j.message || '')).slice(0, 160);
          if (j && (j.code === '42P01' || /does not exist/i.test(j.message || ''))) {
            missing.push('TABLE ' + t + ' (run admin/hq/hq-schema.sql)');
          }
        }
      } catch (e) {
        tables[t] = false;
        tableErrors[t] = redactSecrets(env, String((e && e.message) || e)).slice(0, 160);
      }
    }
  }
  const tablesReady = Object.keys(tables).length > 0 && Object.values(tables).every(Boolean);
  const ready = configReady && tablesReady;

  /* One plain sentence that says exactly what to do next. Order matters:
     config shape → table existence → done. */
  let nextStep;
  if (!uShape.present) {
    nextStep = 'SUPABASE_URL is empty. Add it as a Cloudflare secret: https://<project-ref>.supabase.co';
  } else if (uShape.looksLikeKey) {
    nextStep = 'SUPABASE_URL contains an API key instead of the project URL (looks like a key, has no https://). Set SUPABASE_URL to https://<project-ref>.supabase.co — the key belongs in SUPABASE_SERVICE_ROLE_KEY.';
  } else if (!uShape.startsWithHttp) {
    nextStep = 'SUPABASE_URL has no https:// in front. Set it to https://<project-ref>.supabase.co (no trailing slash).';
  } else if (!uShape.hostLikelyValid) {
    nextStep = 'SUPABASE_URL is not a *.supabase.co address. Copy "Project URL" from Supabase → Project Settings → API and set it again.';
  } else if (kShape.looksLikeUrl) {
    nextStep = 'SUPABASE_SERVICE_ROLE_KEY contains a URL. Paste the secret key (sb_secret_… or the service_role JWT) into it.';
  } else if (kShape.looksLikePublishable) {
    nextStep = 'SUPABASE_SERVICE_ROLE_KEY looks like the publishable/anon key. Use the secret / service_role key — the anon key cannot write to hq_social_tokens.';
  } else if (!core.HQ_TOKEN_KEY) {
    nextStep = 'HQ_TOKEN_KEY is missing or shorter than 16 characters. Generate one: openssl rand -hex 32';
  } else if (!core.HQ_SITE_ORIGIN) {
    nextStep = 'HQ_SITE_ORIGIN is missing. Set it to https://devchazers.site';
  } else if (!core.SUPABASE_ANON_KEY) {
    nextStep = 'SUPABASE_ANON_KEY is missing. Copy the anon / publishable key from Supabase → Project Settings → API.';
  } else if (!tablesReady) {
    nextStep = 'Config looks right but a table probe failed. Read "tableErrors" below — 401/403 means the key is wrong, 404 means the URL, 42P01 means the SQL was never run.';
  } else {
    nextStep = 'Everything is ready. Open HQ → Social → Accounts → Connect YouTube. Register this redirect URI with Google first: https://' + host + '/api/hq/oauth/youtube/callback';
  }

  return new Response(JSON.stringify({
    ok: true,
    api: 'deployed',
    host,
    serverReady: ready,
    serverReadyMeans: 'Every core secret is present, shaped correctly, and the HQ tables answer.',
    coreReady,
    configReady,
    urlShape: uShape,
    keyShape: kShape,
    tables,
    tablesReady,
    tableErrors,
    providers,
    missing,
    nextStep
  }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequest({ request, env }) {
  return onRequestGet({ request, env });
}
