/* GET /api/hq/status — what the backend can do right now.
   Admin-only. Returns booleans and non-secret metadata only. */
import { json, fail, requireAdmin, PROVIDERS, isConfigured, conf } from './_shared.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);

  const c = conf(env);
  const providers = {};
  for (const id of Object.keys(PROVIDERS)) {
    providers[id] = { name: PROVIDERS[id].name, configured: isConfigured(env, id) };
  }
  return json({
    ok: true,
    version: '1.0.0',
    supabase: { url: !!c.url, anon: !!c.anon, service: !!c.svc },
    tokenKey: !!(env.HQ_TOKEN_KEY && env.HQ_TOKEN_KEY.length >= 16),
    cronSecret: !!env.HQ_CRON_SECRET,
    origin: env.HQ_SITE_ORIGIN || null,
    providers,
    scheduler: {
      kind: 'manual-or-github-action',
      note: 'No cron service is used. HQ can flush due posts on demand, or a free GitHub Action can call /api/hq/publish?due=1 every 10 minutes with HQ_CRON_SECRET.'
    },
    adapters: {
      implemented: ['youtube', 'facebook', 'instagram', 'threads', 'x', 'reddit', 'discord'],
      manual: ['tiktok', 'linkedin', 'pinterest'],
      untested: 'Adapters are written against the official API docs but have not been run against a live account yet. The first real publish is the proof; failures are returned per platform and never shown as success.'
    }
  });
}

export async function onRequestPost({ request, env }) {
  return fail('Use GET for status.', 405);
}
