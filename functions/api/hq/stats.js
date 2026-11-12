/* ============================================================================
   /api/hq/stats        (admin session)                 simple analytics feed

   GET → har connected channel ka asli data, ek hi JSON me:

     {
       ok, fetchedAt, cached,
       totals:   { views, subscribers, videos, likes, comments, channels },
       channels: [ { code, name, language, platform, connected, error,
                     subs, views, videoCount, likes, comments, avatar,
                     videos: [ {id,title,views,likes,comments,privacy,published,url} ] } ]
     }

   Rules:
     • Sirf woh numbers jo YouTube ne diye — jo nahi mila wo null rehta hai
       (UI "—" dikhata hai, jhoota 0 nahi).
     • Cache: hq_channel_stats, 15 minute. ?force=1 se taza.
     • Quota ~3 units per channel (channels.list + playlistItems + videos.list).

   Sab platforms ek hi shakl me aate hain — aaj YouTube, kal Meta/TikTok
   isi array me add ho jayenge, UI ko badalna nahi padega.
   ========================================================================== */
import { json, fail, requireAdmin, svc, unseal, seal, refreshIfNeeded, rate, uid } from './_shared.js';

const YT = 'https://www.googleapis.com/youtube/v3';
const TTL_MS = 15 * 60_000;
const nowISO = () => new Date().toISOString();
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length <= n ? s : s.slice(0, n); };
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

async function ytGet(path, token) {
  const res = await fetch(YT + path, { headers: { authorization: 'Bearer ' + token.access_token } });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch (e) { body = {}; }
  if (!res.ok) {
    const msg = ((body.error || {}).message) || ('HTTP ' + res.status);
    return { ok: false, status: res.status, error: msg };
  }
  return { ok: true, body };
}

/** Token for one channel account (refreshes and re-seals when needed). */
async function tokenFor(env, accountId) {
  const rows = await svc(env, 'hq_channel_tokens?account_id=eq.' + encodeURIComponent(accountId) + '&select=oauth_enc');
  const row = rows && rows[0];
  if (!row) return { ok: false, code: 'no_token', error: 'Token nahi mila — dobara Connect karo.' };
  let token;
  try { token = await unseal(env, row.oauth_enc); }
  catch (e) { return { ok: false, code: 'no_token', error: e.message }; }

  const r = await refreshIfNeeded(env, 'youtube', token);
  if (r.dead || (token.expires_at && Date.now() > Number(token.expires_at))) {
    /* account ko honest 'expired' mark karo taake Studio me Reconnect dikhe */
    try {
      await svc(env, 'hq_channel_accounts?id=eq.' + encodeURIComponent(accountId),
        { method: 'PATCH', body: JSON.stringify({ status: 'expired', updated_at: nowISO() }) });
    } catch (e) { /* ignore */ }
    return { ok: false, code: 'reconnect_needed', error: 'Token expire — Studio me Reconnect dabao.' };
  }
  if (r.changed) {
    token = r.token;
    try {
      await svc(env, 'hq_channel_tokens?account_id=eq.' + encodeURIComponent(accountId), {
        method: 'PATCH', body: JSON.stringify({ oauth_enc: await seal(env, token), updated_at: nowISO() })
      });
    } catch (e) { /* token still usable for this run */ }
  }
  return { ok: true, token };
}

/* ------------------------------------------------------------- one channel */
async function channelStats(env, acc, ch) {
  const base = {
    code: ch.code, name: ch.name || ch.code, language: ch.language || 'en',
    platform: acc.platform || 'youtube', connected: acc.status === 'connected',
    subs: null, views: null, videoCount: null, likes: null, comments: null,
    avatar: '', videos: [], error: null
  };
  if (!base.connected) {
    base.error = acc.status === 'expired' ? 'Token expire — Reconnect dabao.' : 'YouTube connect nahi hai.';
    return base;
  }

  const t = await tokenFor(env, acc.id);
  if (!t.ok) { base.error = t.error; base.code_needed = t.code; return base; }

  /* 1 unit — channel totals */
  const c = await ytGet('/channels?part=snippet,statistics,contentDetails&mine=true', t.token);
  if (!c.ok) { base.error = c.status === 401 ? 'Token reject — Reconnect dabao.' : c.error; return base; }

  const item = (c.body.items || [])[0];
  if (!item) { base.error = 'Is Google account par koi YouTube channel nahi.'; return base; }

  const st = item.statistics || {};
  base.name = (item.snippet || {}).title || base.name;
  base.avatar = (((item.snippet || {}).thumbnails || {}).default || {}).url || '';
  base.subs = num(st.subscriberCount);
  base.views = num(st.viewCount);
  base.videoCount = num(st.videoCount);

  /* 1 unit — latest uploads */
  const uploads = (((item.contentDetails || {}).relatedPlaylists) || {}).uploads;
  if (!uploads) return base;
  const pl = await ytGet('/playlistItems?part=contentDetails&maxResults=10&playlistId=' + encodeURIComponent(uploads), t.token);
  if (!pl.ok) { base.error = pl.error; return base; }
  const ids = (pl.body.items || []).map(i => ((i.contentDetails || {}).videoId)).filter(Boolean);
  if (!ids.length) return base;

  /* 1 unit — per-video stats */
  const vs = await ytGet('/videos?part=snippet,statistics,status&id=' + ids.join(','), t.token);
  if (!vs.ok) { base.error = vs.error; return base; }

  let likes = 0, comments = 0, likesKnown = true, commentsKnown = true;
  base.videos = (vs.body.items || []).map(v => {
    const s = v.statistics || {};
    if (s.likeCount === undefined) likesKnown = false;
    if (s.commentCount === undefined) commentsKnown = false;
    likes += Number(s.likeCount || 0);
    comments += Number(s.commentCount || 0);
    return {
      id: v.id,
      title: clip(((v.snippet || {}).title) || '', 120),
      views: num(s.viewCount),
      likes: num(s.likeCount),
      comments: num(s.commentCount),
      privacy: (((v.status || {}).privacyStatus)) || '',
      published: ((v.snippet || {}).publishedAt) || '',
      url: 'https://youtu.be/' + v.id
    };
  });
  base.likes = likesKnown ? likes : null;
  base.comments = commentsKnown ? comments : null;
  return base;
}

/* -------------------------------------------------------------------- entry */
export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!rate('stats:' + (auth.user.id || 'x'), 30, 60_000)) return fail('Thoda ruk kar dobara try karo.', 429);

  let force = false;
  try { force = new URL(request.url).searchParams.get('force') === '1'; } catch (e) { force = false; }

  /* channels + their accounts */
  let channels = [], accounts = [];
  try {
    channels = (await svc(env, 'hq_channels?select=*&order=name.asc')) || [];
    accounts = (await svc(env, 'hq_channel_accounts?select=*')) || [];
  } catch (e) {
    return fail('Channels read nahi ho paye: ' + e.message, 500);
  }
  const accountFor = code => accounts.find(a => a.channel_code === code && a.platform === 'youtube') || null;

  /* cache */
  let cache = {};
  try {
    const rows = (await svc(env, 'hq_channel_stats?select=*')) || [];
    rows.forEach(r => { cache[r.channel_code] = r; });
  } catch (e) { cache = {}; }

  const notes = [];
  let servedCache = 0;
  const out = [];

  for (const ch of channels) {
    const acc = accountFor(ch.code);
    if (!acc) {
      out.push({
        code: ch.code, name: ch.name || ch.code, language: ch.language || 'en', platform: 'youtube',
        connected: false, subs: null, views: null, videoCount: null, likes: null, comments: null,
        avatar: '', videos: [], error: 'Connect nahi hai — Studio me Connect YouTube dabao.'
      });
      continue;
    }

    const row = cache[ch.code];
    const fresh = row && row.payload && (Date.now() - Date.parse(row.fetched_at) < TTL_MS);
    if (fresh && !force) { servedCache++; out.push(Object.assign({}, row.payload, { cached: true, fetched_at: row.fetched_at })); continue; }

    const stats = await channelStats(env, acc, ch);
    stats.cached = false;
    stats.fetched_at = nowISO();
    out.push(stats);

    try {
      await svc(env, 'hq_channel_stats?on_conflict=channel_code', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ channel_code: ch.code, platform: 'youtube', payload: stats, fetched_at: nowISO() }])
      });
    } catch (e) { notes.push(ch.code + ': cache save nahi hui'); }
  }

  /* totals — sirf un numbers ka jod jo mila hai; kuch bhi mila na ho to null */
  const sum = (key) => {
    const vals = out.map(c => c[key]).filter(v => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const connected = out.filter(c => c.connected).length;
  const totals = {
    views: sum('views'), subscribers: sum('subs'), videos: sum('videoCount'),
    likes: sum('likes'), comments: sum('comments'),
    channels: out.length, connected
  };

  if (servedCache) notes.push(servedCache + ' channel cache se aaye (15 min tak fresh rehte hain)');

  return json({
    ok: true,
    fetchedAt: nowISO(),
    totals,
    channels: out,
    notes
  });
}
