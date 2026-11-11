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
const trimEnv = v => String(v || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');

export function conf(env) {
  return {
    url: trimEnv(env.SUPABASE_URL),
    anon: trimEnv(env.SUPABASE_ANON_KEY),
    svc: trimEnv(env.SUPABASE_SERVICE_ROLE_KEY)
  };
}

/** Non-secret description of how SUPABASE_URL was typed — helps debug 401/404s.
    Only the shape is returned; not a single character of the value. */
export function urlShape(env) {
  const raw = String(env.SUPABASE_URL || '');
  const t = raw.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  return {
    present: raw.length > 0,
    https: /^https:\/\//i.test(t),
    startsWithHttp: /^https?:\/\//i.test(t),
    looksLikeKey: /^(sb_secret_|sb_publishable_|eyJ)/.test(t),
    trailingSlash: /\/$/.test(raw.trim().replace(/["']/g, '')),
    trailingSpace: raw !== raw.trim(),
    hasQuotes: /^["']|["']$/.test(raw.trim()),
    hostLikelyValid: /\.supabase\.co$/i.test(t),
    /* The project ref is public (it is already in js/config.js) — showing it
       lets you confirm at a glance that you point at the right project. */
    projectRef: (t.match(/^https:\/\/([a-z0-9]{15,30})\.supabase\.co$/i) || [])[1] || '',
    length: t.length
  };
}

/** Same idea for the service-role key: shape only, never the value. */
export function keyShape(env) {
  const raw = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  const t = raw.trim().replace(/^["']|["']$/g, '');
  return {
    present: raw.length > 0,
    length: t.length,
    looksLikeJwt: /^eyJ/.test(t),
    looksLikeSecretKey: /^sb_secret_/.test(t),
    looksLikePublishable: /^sb_publishable_/.test(t),
    looksLikeUrl: /^https?:\/\//i.test(t)
  };
}

/** Strip anything key-shaped (and the real values) from a message before it
    leaves the server. PostgREST never echoes a key, but a thrown fetch error
    echoes the whole URL — belt and braces. */
export function redactSecrets(env, text) {
  let out = String(text == null ? '' : text);
  const vals = [env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_ANON_KEY, env.HQ_TOKEN_KEY]
    .map(v => String(v || '').trim().replace(/^["']|["']$/g, ''))
    .filter(v => v.length >= 12);
  vals.forEach(v => { out = out.split(v).join('***'); });
  out = out.replace(/sb_secret_[A-Za-z0-9_\-]{8,}/g, 'sb_secret_***');
  out = out.replace(/sb_publishable_[A-Za-z0-9_\-]{8,}/g, 'sb_publishable_***');
  out = out.replace(/eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}/g, 'eyJ***');
  return out;
}

/** Service-role REST call. NEVER use from the browser. */
export async function svc(env, path, init = {}) {
  const c = conf(env);
  if (!c.url || !c.svc) throw new Error('Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  if (!/^https?:\/\//i.test(c.url)) {
    throw new Error('SUPABASE_URL is not a URL — it does not start with https://. It looks like an API key was pasted into it. Check /api/hq/health.');
  }
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
    /* upload = publish, readonly = channel/video stats,
       yt-analytics.readonly = retention / CTR / traffic sources / geography.
       All three are requested up front so analytics never needs a re-consent. */
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly',
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

/* ------------------------------------------------------------ token refresh --
   Access tokens live ~1 hour. When a refresh token exists, exchange it for a
   new access token and hand the sealed blob back so the caller can persist it.
   Returns { token, changed }. Never throws: a failed refresh just means the
   caller reports token_expired and the user reconnects.                        */
export async function refreshIfNeeded(env, platform, token) {
  const expires = Number(token.expires_at || 0);
  if (!expires || Date.now() < expires - 60_000) return { token, changed: false, dead: false };
  const p = providerConfig(env, platform);
  if (!p || !p.clientId || !p.clientSecret) return { token, changed: false, dead: false };
  /* Expired and nothing to refresh with: the account must be reconnected. */
  if (!token.refresh_token) return { token, changed: false, dead: true };
  try {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: p.clientId,
      client_secret: p.clientSecret
    });
    const res = await fetch(p.tokenUrl, { method: 'POST', body: form });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      /* invalid_grant = refresh token revoked or expired (Google Testing mode: 7 days). */
      return { token, changed: false, dead: !!(j && (j.error === 'invalid_grant' || j.error === 'invalid_request')) };
    }
    const next = Object.assign({}, token, {
      access_token: j.access_token,
      refresh_token: j.refresh_token || token.refresh_token,
      expires_at: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : expires
    });
    return { token: next, changed: true, dead: false };
  } catch (e) {
    return { token, changed: false, dead: false };
  }
}
