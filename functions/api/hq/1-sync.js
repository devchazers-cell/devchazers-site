/* ============================================================================
   GET|POST /api/hq/sync        (admin session OR HQ_CRON_SECRET)

   Pulls real numbers from the platforms and stores them. Nothing is invented:
   a metric that the platform does not return stays NULL and the UI shows "—".

   YouTube (Data API v3 + Analytics API v2), ~7 quota units per run:
     channels.list          → subscribers, lifetime views, video count
     playlistItems.list     → the latest 10 uploads
     videos.list            → views / likes / comments per video
     reports (day)          → daily views, watch time, retention %, likes…
     insightTrafficSourceType → where the views came from
     country                → top countries
     videoThumbnail…        → CTR (only if the channel unlocks it)

   Writes:
     hq_social_metrics  (platform, date)  one row per day — charts read this
     hq_social_insights (platform, kind, date)  JSON payload — the extras

   Other platforms return `not_supported` with the reason. HQ never guesses.
   ========================================================================== */
import { json, fail, requireAdmin, svc, unseal, seal, refreshIfNeeded, rate, uid } from './_shared.js';

const YT = 'https://www.googleapis.com/youtube/v3';
const YTA = 'https://youtubeanalytics.googleapis.com/v2/reports';
const today = () => new Date().toISOString().slice(0, 10);
const dayBefore = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/* A cron run has no admin session — it carries HQ_CRON_SECRET instead. */
async function authorize(request, env) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cron = String(env.HQ_CRON_SECRET || '');
  if (cron && bearer && bearer === cron) return { ok: true, user: { id: 'cron' } };
  const a = await requireAdmin(request, env);
  if (!a.ok) return a;
  return a;
}

/* ------------------------------------------------------------- token ------ */
async function tokenFor(env, platform) {
  const rows = await svc(env, 'hq_social_accounts?platform=eq.' + encodeURIComponent(platform) + '&select=platform,status,page_id');
  const row = rows && rows[0];
  if (!row) return { ok: false, code: 'no_account', error: 'No ' + platform + ' account is linked.' };
  if (row.status !== 'connected') return { ok: false, code: 'not_connected', error: platform + ' is ' + row.status + '.' };
  const trows = await svc(env, 'hq_social_tokens?platform=eq.' + encodeURIComponent(platform) + '&select=oauth_enc');
  const trow = trows && trows[0];
  if (!trow) return { ok: false, code: 'no_token', error: 'No OAuth token is stored for ' + platform + '.' };
  let token = {};
  try { token = await unseal(env, trow.oauth_enc); } catch (e) { return { ok: false, code: 'no_token', error: e.message }; }

  const r = await refreshIfNeeded(env, platform, token);
  if (r.changed) {
    token = r.token;
    try {
      await svc(env, 'hq_social_tokens?platform=eq.' + encodeURIComponent(platform), {
        method: 'PATCH', body: JSON.stringify({ oauth_enc: await seal(env, token), updated_at: new Date().toISOString() })
      });
      await svc(env, 'hq_social_accounts?platform=eq.' + encodeURIComponent(platform), {
        method: 'PATCH',
        body: JSON.stringify({ expires_at: token.expires_at ? new Date(token.expires_at).toISOString() : null, last_sync: new Date().toISOString() })
      });
    } catch (e) { /* token still valid for this run */ }
  }
  return { ok: true, token, account: row };
}

async function getJson(url, token) {
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text.slice(0, 300) }; }
  if (!r.ok) {
    const msg = (body && body.error && (body.error.message || body.error)) || ('HTTP ' + r.status);
    return { ok: false, status: r.status, code: r.status === 401 ? 'token_expired' : r.status === 403 ? 'forbidden' : 'http_' + r.status, error: String(msg).slice(0, 240) };
  }
  return { ok: true, body: body || {} };
}

/* ------------------------------------------------------------- YouTube ---- */
async function syncYouTube(env, days) {
  const t = await tokenFor(env, 'youtube');
  if (!t.ok) return t;
  const token = t.token.access_token;
  const out = { platform: 'youtube', ok: true, notes: [], counts: {} };

  /* 1 — channel totals (1 unit) */
  const ch = await getJson(YT + '/channels?part=snippet,statistics,contentDetails&mine=true', token);
  if (!ch.ok) return Object.assign({ platform: 'youtube' }, ch);
  const c = (ch.body.items || [])[0];
  if (!c) return { platform: 'youtube', ok: false, code: 'no_channel', error: 'This Google account has no YouTube channel.' };
  const stats = c.statistics || {};
  out.channel = {
    id: c.id,
    title: (c.snippet || {}).title || '',
    handle: '@' + String((c.snippet || {}).customUrl || '').replace(/^@+/, ''),
    subscribers: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount || 0),
    views: Number(stats.viewCount || 0),
    videos: Number(stats.videoCount || 0)
  };
  if (stats.hiddenSubscriberCount) out.notes.push('Subscriber count is hidden by the channel owner — left empty rather than guessed.');

  /* 2 — daily series (1 unit) */
  const start = dayBefore(days);
  const end = today();
  const daily = await getJson(YTA + '/?ids=channel==MINE&startDate=' + start + '&endDate=' + end +
    '&dimensions=day&sort=day&metrics=views,likes,comments,shares,subscribersGained,subscribersLost,estimatedMinutesWatched,averageViewDuration,averageViewPercentage', token);
  let series = [];
  if (daily.ok) {
    const h = (daily.body.columnHeaders || []).map(x => x.name);
    series = (daily.body.rows || []).map(r => {
      const o = {};
      h.forEach((k, i) => { o[k] = r[i]; });
      return o;
    });
  } else if (daily.code === 'forbidden' || daily.status === 403) {
    out.notes.push('YouTube Analytics API refused the request (' + daily.error + '). Enable "YouTube Analytics API" for this project and reconnect so the yt-analytics scope is granted.');
  } else {
    out.notes.push('Daily analytics unavailable: ' + daily.error);
  }

  /* 3 — traffic sources + countries (2 units, aggregate for the period) */
  const traffic = await getJson(YTA + '/?ids=channel==MINE&startDate=' + start + '&endDate=' + end +
    '&dimensions=insightTrafficSourceType&metrics=views&sort=-views', token);
  const countries = await getJson(YTA + '/?ids=channel==MINE&startDate=' + start + '&endDate=' + end +
    '&dimensions=country&metrics=views&sort=-views&maxResults=10', token);

  /* 4 — CTR (optional; not every channel has thumbnail impressions exposed) */
  const ctr = await getJson(YTA + '/?ids=channel==MINE&startDate=' + start + '&endDate=' + end +
    '&dimensions=day&metrics=videoThumbnailImpressions,videoThumbnailImpressionsClickRate', token);
  let ctrRows = [];
  if (ctr.ok) {
    const h = (ctr.body.columnHeaders || []).map(x => x.name);
    ctrRows = (ctr.body.rows || []).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; });
  } else {
    out.notes.push('CTR not returned for this channel: ' + ctr.error);
  }

  /* 5 — recent uploads + per-video stats (2 units) */
  let videos = [];
  const uploads = c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads;
  if (uploads) {
    const pl = await getJson(YT + '/playlistItems?part=contentDetails&playlistId=' + uploads + '&maxResults=10', token);
    const ids = ((pl.body.items) || []).map(x => x.contentDetails && x.contentDetails.videoId).filter(Boolean);
    if (ids.length) {
      const vs = await getJson(YT + '/videos?part=snippet,statistics&id=' + ids.join(','), token);
      videos = ((vs.body.items) || []).map(v => ({
        id: v.id,
        title: (v.snippet || {}).title || '',
        published: (v.snippet || {}).publishedAt || '',
        privacy: (v.status || {}).privacyStatus || '',
        views: Number((v.statistics || {}).viewCount || 0),
        likes: Number((v.statistics || {}).likeCount || 0),
        comments: Number((v.statistics || {}).commentCount || 0),
        url: 'https://youtu.be/' + v.id
      }));
    }
  }

  /* ---------------------------------------------------------- persistence -- */
  const now = new Date().toISOString();
  const metricRows = series.map(d => ({
    platform: 'youtube',
    date: d.day,
    views: Math.round(d.views || 0),
    followers: null,
    likes: Math.round(d.likes || 0),
    comments: Math.round(d.comments || 0),
    shares: Math.round(d.shares || 0),
    engagement: Math.round((d.likes || 0) + (d.comments || 0) + (d.shares || 0)),
    reach: null
  }));
  if (metricRows.length) {
    await svc(env, 'hq_social_metrics?on_conflict=platform,date', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(metricRows)
    });
    out.counts.metricDays = metricRows.length;
  }

  /* subscriber total belongs to "today", not to a historical day */
  if (out.channel.subscribers != null) {
    await svc(env, 'hq_social_metrics?on_conflict=platform,date', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ platform: 'youtube', date: end, followers: out.channel.subscribers }])
    });
  }

  const totalViews = metricRows.reduce((a, r) => a + r.views, 0);
  const totalWatch = series.reduce((a, r) => a + Number(r.estimatedMinutesWatched || 0), 0);
  const avgPct = series.length ? series.reduce((a, r) => a + Number(r.averageViewPercentage || 0), 0) / series.length : null;
  const avgDur = series.length ? series.reduce((a, r) => a + Number(r.averageViewDuration || 0), 0) / series.length : null;
  const impressions = ctrRows.reduce((a, r) => a + Number(r.videoThumbnailImpressions || 0), 0);
  /* Click-through rate already arrives as a percentage (5.2 = 5.2%), so the
     impression-weighted average needs no extra ×100. */
  const ctrPct = impressions > 0 ? (ctrRows.reduce((a, r) => a + Number(r.videoThumbnailImpressionsClickRate || 0) * Number(r.videoThumbnailImpressions || 0), 0) / impressions) : null;

  const payload = {
    range: { start, end },
    channel: out.channel,
    totals: {
      views: totalViews,
      watchMinutes: Math.round(totalWatch),
      retentionPct: avgPct == null ? null : Math.round(avgPct * 10) / 10,
      avgViewSeconds: avgDur == null ? null : Math.round(avgDur),
      impressions: impressions || null,
      ctrPct: ctrPct == null ? null : Math.round(ctrPct * 100) / 100
    },
    traffic: ((traffic.body && traffic.body.rows) || []).map(r => ({ source: r[0], views: Number(r[1] || 0) })).slice(0, 12),
    countries: ((countries.body && countries.body.rows) || []).map(r => ({ code: r[0], views: Number(r[1] || 0) })).slice(0, 10),
    videos,
    notes: out.notes
  };

  await svc(env, 'hq_social_insights?on_conflict=platform,kind,date', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      id: uid('ins'), platform: 'youtube', kind: 'youtube_summary', date: end,
      payload, created_at: now, updated_at: now
    }])
  });

  /* keep the account row visibly fresh */
  await svc(env, 'hq_social_accounts?platform=eq.youtube', {
    method: 'PATCH',
    body: JSON.stringify({ last_sync: now, name: out.channel.title || undefined, updated_at: now })
  });

  out.totals = payload.totals;
  return out;
}

/* ---------------------------------------------------------------- entry --- */
export async function onRequestGet({ request, env }) {
  const auth = await authorize(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!rate('sync:' + (auth.user.id || 'x'), 12, 60_000)) return fail('Sync is already running — wait a minute.', 429);

  const url = new URL(request.url);
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days') || 28)));
  const only = (url.searchParams.get('platform') || '').trim();

  const results = {};
  const wanted = only ? [only] : ['youtube'];
  for (const p of wanted) {
    if (p !== 'youtube') {
      results[p] = { ok: false, code: 'not_supported', error: 'Automatic metrics for ' + p + ' are not implemented. YouTube is the only platform with a live pull in this build.' };
      continue;
    }
    try { results[p] = await syncYouTube(env, days); }
    catch (e) { results[p] = { ok: false, code: 'sync_error', error: String(e.message || e).slice(0, 240) }; }
  }

  const anyOk = Object.values(results).some(r => r.ok);
  return json({ ok: anyOk, days, at: new Date().toISOString(), results });
}

export async function onRequestPost({ request, env }) {
  return onRequestGet({ request, env });
}
