/* ============================================================================
   GET /api/hq/status        (admin session)                    RESTORED 2026-11-12

   Ye endpoint 11 Nov ko delete ho gaya tha, jabke HQ ka browser bridge
   (admin/hq/hq-api.js) isi ko call karta hai. Us ke bina:
     • /api/hq/status Cloudflare ki SPA fallback HTML (200) wapas karta tha,
     • HQ us HTML ko \"JSON\" samajh kar server ko online keh deta tha,
     • providers khaali rehte the → Connect buttons aur Publish dead,
     • System Status me jhoota \"Online\" likha aata tha.

   Ab ye JSON hi deta hai, kabhi HTML nahi.
   ========================================================================== */
import { json, fail, requireAdmin, conf, isConfigured, PROVIDERS } from './_shared.js';
import { ADAPTERS } from './_adapters.js';
import { aiKeyState, PROVIDER_LABEL } from './_ai.js';

const IMPLEMENTED = ['youtube', 'facebook', 'instagram', 'threads', 'x', 'reddit', 'discord'];
const MANUAL = ['tiktok', 'linkedin', 'pinterest'];

const TABLES = ['hq_social_accounts', 'hq_social_posts', 'hq_social_metrics', 'hq_social_insights', 'hq_channels', 'hq_seo_sets', 'hq_ai_keys'];

async function tableOk(env, table) {
  const c = conf(env);
  if (!c.url || !c.svc) return false;
  try {
    const r = await fetch(c.url + '/rest/v1/' + table + '?select=*&limit=1', { headers: { apikey: c.svc, authorization: 'Bearer ' + c.svc } });
    return r.ok;
  } catch (e) { return false; }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);

  const providers = {};
  Object.keys(PROVIDERS).forEach(id => {
    providers[id] = {
      configured: isConfigured(env, id),
      name: PROVIDERS[id].name,
      adapter: IMPLEMENTED.indexOf(id) >= 0
    };
  });

  const tables = {};
  for (const t of TABLES) tables[t] = await tableOk(env, t);

  let ai = { configured: false, provider: 'gemini', source: 'none' };
  try {
    const s = await aiKeyState(env);
    ai = { configured: !!s.key, provider: s.provider, providerLabel: PROVIDER_LABEL[s.provider] || s.provider, source: s.source, hint: s.hint || '' };
  } catch (e) { /* AI status is a bonus, never fatal */ }

  const c = conf(env);
  const adaptersImpl = IMPLEMENTED.filter(id => typeof ADAPTERS[id] === 'function');

  return json({
    ok: true,
    version: '2026-11-12',
    at: new Date().toISOString(),
    providers,
    adapters: { implemented: adaptersImpl, manual: MANUAL },
    scheduler: {
      mode: env.HQ_CRON_SECRET ? 'github-action' : 'manual',
      cronSecret: !!env.HQ_CRON_SECRET,
      note: env.HQ_CRON_SECRET
        ? 'GitHub Action /api/hq/publish?due=1 ko 6 ghante me ek dafa chalata hai.'
        : 'Sirf manual: Notifications → Publish due posts.'
    },
    supabase: {
      url: !!c.url,
      anon: !!c.anon,
      serviceRole: !!c.svc,
      tables
    },
    tokenKey: !!(env.HQ_TOKEN_KEY && String(env.HQ_TOKEN_KEY).length >= 16),
    ai,
    metricsSync: !!env.HQ_CRON_SECRET,
    cronSecret: !!env.HQ_CRON_SECRET
  });
}

export async function onRequest({ request, env }) {
  return fail('Method not allowed.', 405);
}
