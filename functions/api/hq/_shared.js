/* ============================================================================
   DevChazers HQ — server helpers (Cloudflare Pages Functions)
   Runs on the Workers runtime. Secrets live here and are never sent to the
   browser: service-role key, OAuth client secrets, token encryption key.

   Required environment variables (Cloudflare → Settings → Environment variables
   → add as *Secret*):
     SUPABASE_URL                 same value as js/config.js
     SUPABASE_ANON_KEY            same value as js/config.js (public, but keep it here)
     SUPABASE_SERVICE_ROLE_KEY    never expose — used only in this file tree
     HQ_TOKEN_KEY                 long random string; encrypts stored OAuth tokens
   Optional:
     HQ_CRON_SECRET               protects the due-queue endpoint
     YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET
     META_CLIENT_ID / META_CLIENT_SECRET          (Facebook + Instagram + Threads)
     X_CLIENT_ID / X_CLIENT_SECRET
     DISCORD_WEBHOOK_DEFAULT      optional default webhook for announcements
     HQ_SITE_ORIGIN               e.g. https://devchazers.site (redirect base)
   ========================================================================== */

export const JSON_H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
export const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: Object.assign({}, JSON_H, extra) });
export const fail = (error, status = 400, extra = {}) => json(Object.assign({ ok: false, error }, extra), status);

const enc = new TextEncoder();

/* --------------------------------------------------------------- supabase -- */
export function conf(env) {
  return {
    url: env.SUPABASE_URL || '',
    anon: env.SUPABASE_ANON_KEY || '',
    svc: env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
}

/** Service-role REST call. NEVER use from the browser. */
export async function svc(env, path, init = {}) {
  const c = conf(env);
  if (!c.url || !c.svc) throw new Error('Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  const headers = Object.assign({
    apikey: c.svc,
    authorization: 'Bearer ' + c.svc,
    'content-type': 'application/json',
    prefer: 'return=representation'
  }, init.headers || {});
  const res = await fetch(c.url + '/rest/v1/' + path, Object.assign({}, init, { headers }));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.hint || data.details)) || ('Supabase responded ' + res.status);
    throw new Error(msg);
  }
  return data;
}

/** Verify the caller's Supabase session *and* that they are an admin. */
export async function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401, error: 'Missing bearer token.' };
  const c = conf(env);
  if (!c.url || !c.anon) return { ok: false, status: 503, error: 'Server is not configured.' };
  try {
    const u = await fetch(c.url + '/auth/v1/user', { headers: { apikey: c.anon, authorization: 'Bearer ' + token } });
    if (!u.ok) return { ok: false, status: 401, error: 'Session expired — sign in again.' };
    const user = await u.json();
    const r = await fetch(c.url + '/rest/v1/rpc/is_admin', {
      method: 'POST',
      headers: { apikey: c.anon, authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: '{}'
    });
    const isAdmin = r.ok ? await r.json() : false;
    if (isAdmin !== true) return { ok: false, status: 403, error: 'This account is not an admin.' };
    return { ok: true, user, token };
  } catch (e) {
    return { ok: false, status: 502, error: 'Could not reach Supabase: ' + e.message };
  }
}

/* ------------------------------------------------------------------ crypto -- */
async function aesKey(env) {
  const raw = env.HQ_TOKEN_KEY || '';
  if (raw.length < 16) throw new Error('HQ_TOKEN_KEY is missing or too short (use 32+ random characters).');
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(raw));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64e = bytes => { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const b64d = s => { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };

/** Encrypt a JSON object (OAuth tokens) before it ever touches the database. */
export async function seal(env, obj) {
  const key = await aesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return 'v1.' + b64e(iv) + '.' + b64e(new Uint8Array(ct));
}
export async function unseal(env, str) {
  if (!str || String(str).slice(0, 3) !== 'v1.') throw new Error('No server-side token stored for this account.');
  const [, ivs, cts] = String(str).split('.');
  const key = await aesKey(env);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(ivs) }, key, b64d(cts));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ------------------------------------------------------------- oauth state -- */
async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.HQ_TOKEN_KEY || 'devchazers'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64e(await crypto.subtle.sign('HMAC', key, enc.encode(msg))).replace(/[+/=]/g, '');
}
export async function makeState(env, payload) {
  const body = b64e(enc.encode(JSON.stringify(Object.assign({ t: Date.now() }, payload)))).replace(/=+$/, '');
  return body + '.' + await hmac(env, body);
}
export async function readState(env, state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) throw new Error('Bad OAuth state.');
  if (await hmac(env, body) !== sig) throw new Error('OAuth state signature mismatch.');
  const pad = body + '==='.slice((body.length + 3) % 4);
  const data = JSON.parse(new TextDecoder().decode(b64d(pad)));
  if (!data.t || Date.now() - data.t > 15 * 60 * 1000) throw new Error('OAuth state expired — start again.');
  return data;
}

/* --------------------------------------------------------------- providers -- */
export const PROVIDERS = {
  youtube: {
    name: 'YouTube',
    kind: 'google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }
  },
  facebook: {
    name: 'Facebook',
    kind: 'meta',
    authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,read_insights'
  },
  instagram: {
    name: 'Instagram',
    kind: 'meta',
    authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement'
  },
  threads: {
    name: 'Threads',
    kind: 'meta',
    authUrl: 'https://threads.net/oauth/authorize',
    tokenUrl: 'https://graph.threads.net/oauth/access_token',
    scope: 'threads_basic,threads_content_publish'
  },
  x: {
    name: 'X (Twitter)',
    kind: 'pkce',
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    scope: 'tweet.read tweet.write users.read offline.access'
  }
};

export function providerConfig(env, id) {
  const p = PROVIDERS[id];
  if (!p) return null;
  const key = p.kind === 'google' ? 'YOUTUBE' : p.kind === 'meta' ? 'META' : id.toUpperCase();
  return Object.assign({}, p, { id, clientId: env[key + '_CLIENT_ID'] || '', clientSecret: env[key + '_CLIENT_SECRET'] || '' });
}

export function isConfigured(env, id) {
  const p = providerConfig(env, id);
  return !!(p && p.clientId && p.clientSecret);
}

export function originOf(request, env) {
  if (env.HQ_SITE_ORIGIN) return String(env.HQ_SITE_ORIGIN).replace(/\/$/, '');
  const u = new URL(request.url);
  return u.origin;
}

export function redirectUri(request, env, platform) {
  return originOf(request, env) + '/api/hq/oauth/' + platform + '/callback';
}

/* ------------------------------------------------------------ rate limiting -- */
const hits = new Map();
/** Best-effort in-isolate limiter. Good enough to stop accidental loops. */
export function rate(key, limit, windowMs) {
  const now = Date.now();
  const b = hits.get(key) || [];
  const fresh = b.filter(t => now - t < windowMs);
  fresh.push(now);
  hits.set(key, fresh);
  if (hits.size > 500) hits.clear();
  return fresh.length <= limit;
}

export const uid = p => (p || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
