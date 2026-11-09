/* ============================================================================
   POST /api/hq/publish
     body { post_id }            → publish one post to its target platforms
     body {}  + ?due=1           → flush every scheduled post whose time has come
     (due mode also accepts the HQ_CRON_SECRET as a bearer token so a free
      GitHub Action can trigger it without an admin session)

   A post is only marked `published` when a platform CONFIRMED it. Partial
   success keeps the row `failed` with per-platform detail, so nothing is lost.
   ========================================================================== */
import { json, fail, requireAdmin, svc, unseal, rate } from './_shared.js';
import { adapterFor } from './_adapters.js';

const nowISO = () => new Date().toISOString();

async function account(env, platform) {
  const rows = await svc(env, 'hq_social_accounts?platform=eq.' + encodeURIComponent(platform) + '&select=*');
  const row = rows && rows[0];
  if (!row) return { ok: false, code: 'no_account', error: 'No ' + platform + ' account is linked. Connect it in Social → Accounts.' };
  if (row.status !== 'connected') return { ok: false, code: 'not_connected', error: platform + ' is ' + row.status + ' — reconnect it first.' };
  const trows = await svc(env, 'hq_social_tokens?platform=eq.' + encodeURIComponent(platform) + '&select=oauth_enc');
  const trow = trows && trows[0];
  if (!trow) return { ok: false, code: 'no_token', error: 'No OAuth token is stored for ' + platform + '.' };
  let token = {};
  try { token = await unseal(env, trow.oauth_enc); }
  catch (e) { return { ok: false, code: 'no_token', error: e.message }; }
  return { ok: true, token, page_id: row.page_id, webhook_url: row.webhook_url || token.webhook_url };
}

async function publishPost(env, post) {
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];
  if (!platforms.length) return { ok: false, code: 'no_platforms', error: 'This post has no target platform.' };
  const mediaUrl = (post.media && post.media[0] && post.media[0].url) || post.media_url || '';
  const results = {};

  await svc(env, 'hq_social_posts?id=eq.' + encodeURIComponent(post.id), { method: 'PATCH', body: JSON.stringify({ status: 'publishing', updated_at: nowISO() }) });

  for (const platform of platforms) {
    const acc = await account(env, platform);
    if (!acc.ok) { results[platform] = acc; continue; }
    try {
      const adapter = adapterFor(platform);
      results[platform] = await adapter(env, acc, post, mediaUrl);
    } catch (e) {
      results[platform] = { ok: false, code: 'adapter_error', error: String(e.message || e).slice(0, 300) };
    }
  }

  const okAll = platforms.every(p => results[p] && results[p].ok);
  const okAny = platforms.some(p => results[p] && results[p].ok);
  const urls = {};
  const errors = [];
  Object.entries(results).forEach(([p, r]) => {
    if (r.ok) urls[p] = r.url || '';
    else errors.push({ platform: p, code: r.code || 'failed', error: r.error || 'Rejected' });
  });

  const patch = {
    status: okAll ? 'published' : 'failed',
    published_at: okAll ? nowISO() : null,
    published_urls: urls,
    errors,
    updated_at: nowISO()
  };
  await svc(env, 'hq_social_posts?id=eq.' + encodeURIComponent(post.id), { method: 'PATCH', body: JSON.stringify(patch) });
  return { ok: okAll || okAny, partial: okAny && !okAll, results, errors };
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const due = url.searchParams.get('due') === '1';
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

  let actor = 'admin';
  if (env.HQ_CRON_SECRET && bearer && bearer === env.HQ_CRON_SECRET) {
    actor = 'cron';
  } else {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return fail(auth.error, auth.status);
    if (!rate('publish:' + (auth.user.id || 'x'), 30, 60_000)) return fail('Too many publish attempts — wait a minute.', 429);
  }

  try {
    if (due) {
      const rows = await svc(env, 'hq_social_posts?status=eq.scheduled&scheduled_at=lte.' + encodeURIComponent(nowISO()) + '&select=*&order=scheduled_at.asc&limit=10');
      const out = [];
      for (const post of rows || []) out.push({ id: post.id, ...(await publishPost(env, post)) });
      return json({ ok: true, actor, flushed: out.length, results: out });
    }

    let body = {};
    try { body = await request.json(); } catch (e) { return fail('Body must be JSON with post_id.'); }
    const id = String(body.post_id || '');
    if (!id) return fail('post_id is required.');
    const rows = await svc(env, 'hq_social_posts?id=eq.' + encodeURIComponent(id) + '&select=*');
    const post = rows && rows[0];
    if (!post) return fail('Post not found in hq_social_posts. Publish needs CLOUD_TABLES enabled and the schema applied.', 404);
    const res = await publishPost(env, post);
    return json(Object.assign({ ok: res.ok, actor, post_id: id, partial: !!res.partial }, res), res.ok ? 200 : 502);
  } catch (e) {
    return fail('Publish failed: ' + e.message, 500);
  }
}

export async function onRequest({ request, env }) {
  return fail('Method not allowed. POST to publish.', 405);
}
