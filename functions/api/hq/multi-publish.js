/* ============================================================================
   /api/hq/multi-publish        (admin session)

   Ek video  →  har selected channel par upload, har channel ke apne SEO pack
   aur apne OAuth token ke saath.

   POST body:
     {
       video_url: "https://…/clip.mp4",           // public URL (Media Library)
       privacy:   "public" | "unlisted" | "private",
       category_id: "20",                          // 20 = Gaming
       channels: [
         { code: "global", title: "…", description: "…", tags: ["…"],
           hashtags: ["#…"], language: "en" }
       ]
     }

   Response: { ok, results: { CODE: { ok, id, url } | { ok:false, code, error } } }

   Honest rules:
     • Har channel ka result alag — ek fail ho to baaki chalti rehti hain.
     • Koi "published" claim nahi jab tak platform ID na de.
     • YouTube quota: 1 upload ≈ 1600 units; default 10,000/day per project
       → din me ~6 uploads. Isliye response me quotaHint bhejte hain.
   ========================================================================== */
import { json, fail, requireAdmin, svc, unseal, seal, refreshIfNeeded, rate, uid } from './_shared.js';

const MAX_BYTES = 128 * 1024 * 1024;   /* Workers memory ceiling ke andar */
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length <= n ? s : s.slice(0, n); };
const nowISO = () => new Date().toISOString();

/** Flip an account to status=expired so the Studio can show "Reconnect" honestly. */
async function markExpired(env, accountId) {
  if (!accountId) return;
  try {
    await svc(env, 'hq_channel_accounts?id=eq.' + encodeURIComponent(accountId), {
      method: 'PATCH', body: JSON.stringify({ status: 'expired', updated_at: nowISO() })
    });
  } catch (e) { /* never let bookkeeping break a publish run */ }
}

/* ---------------------------------------------------------------- helpers -- */
async function loadChannel(env, code) {
  const rows = await svc(env, 'hq_channels?code=eq.' + encodeURIComponent(code) + '&select=*');
  const ch = rows && rows[0];
  if (!ch) return { ok: false, code: 'no_channel', error: 'Channel "' + code + '" hq_channels me nahi hai.' };

  let accs = [];
  try { accs = await svc(env, 'hq_channel_accounts?channel_code=eq.' + encodeURIComponent(code) + "&platform=eq.youtube&select=*"); }
  catch (e) { return { ok: false, code: 'no_account_table', error: 'hq_channel_accounts table missing — migration chalao.' }; }
  const acc = accs && accs[0];
  if (!acc) return { ok: false, code: 'not_connected', error: 'Is channel ka YouTube account connected nahi hai. Studio me Connect dabao.' };
  if (acc.status === 'expired') {
    return { ok: false, code: 'reconnect_needed', error: 'YouTube token expire ho gaya (Google Testing mode me refresh token 7 din me khatam hota hai). Studio me Reconnect dabao.' };
  }
  if (acc.status !== 'connected') {
    return { ok: false, code: 'not_connected', error: 'Is channel ka YouTube account connected nahi hai (status: ' + clip(acc.status || '-', 20) + '). Studio me Connect dabao.' };
  }

  let trows = [];
  try { trows = await svc(env, 'hq_channel_tokens?account_id=eq.' + encodeURIComponent(acc.id) + '&select=oauth_enc'); }
  catch (e) { return { ok: false, code: 'no_token', error: 'Token read failed: ' + e.message }; }
  const trow = trows && trows[0];
  if (!trow) return { ok: false, code: 'no_token', error: 'This channel has no stored token — reconnect it.' };

  let token = {};
  try { token = await unseal(env, trow.oauth_enc); }
  catch (e) { return { ok: false, code: 'no_token', error: e.message }; }

  const r = await refreshIfNeeded(env, 'youtube', token);
  if (r.dead) {
    await markExpired(env, acc.id);
    return { ok: false, code: 'reconnect_needed', error: 'YouTube token expire ho gaya (Google Testing mode me refresh token 7 din baad khatam hota hai). Studio me Reconnect dabao.' };
  }
  if (r.changed) {
    token = r.token;
    try {
      await svc(env, 'hq_channel_tokens?account_id=eq.' + encodeURIComponent(acc.id), {
        method: 'PATCH', body: JSON.stringify({ oauth_enc: await seal(env, token), updated_at: nowISO() })
      });
    } catch (e) { /* token still valid for this run */ }
  }
  if (token.expires_at && Date.now() > Number(token.expires_at)) {
    return { ok: false, code: 'token_expired', error: 'Token expired — Studio me dobara Connect karo.' };
  }
  return { ok: true, channel: ch, account: acc, token };
}

async function fetchVideo(url) {
  let res;
  try { res = await fetch(url); }
  catch (e) { return { ok: false, code: 'media_unreachable', error: 'Video download nahi hui: ' + clip(e.message, 160) }; }
  if (!res.ok) return { ok: false, code: 'media_http_' + res.status, error: 'Video URL ne HTTP ' + res.status + ' diya.' };
  const type = res.headers.get('content-type') || 'video/mp4';
  if (!/^video\/|octet-stream/.test(type)) return { ok: false, code: 'media_not_video', error: 'Ye video file nahi lagti (' + type + ').' };
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > MAX_BYTES) return { ok: false, code: 'media_too_large', error: 'Video ' + Math.round(len / 1048576) + ' MB hai — limit 128 MB (Workers). Chhota clip use karo ya YouTube Studio se upload karo.' };
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return { ok: false, code: 'media_too_large', error: 'Video 128 MB se bada hai.' };
  return { ok: true, buf, type: type.split(';')[0] };
}

async function uploadOne(env, loaded, pack, video, opts) {
  const tok = loaded.token;
  const title = clip(pack.title || pack.topic || 'DevChazers', 100) || 'DevChazers';
  const description = clip(pack.description || '', 4900);
  const tags = (Array.isArray(pack.tags) ? pack.tags : String(pack.tags || '').split(','))
    .map(t => clip(String(t).replace(/^#/, '').trim(), 30)).filter(Boolean).slice(0, 15);
  const hashtags = (Array.isArray(pack.hashtags) ? pack.hashtags : []).map(String).filter(Boolean).slice(0, 8);

  const snippet = {
    title,
    description: description + (hashtags.length ? '\n\n' + hashtags.join(' ') : ''),
    tags,
    categoryId: String(opts.category_id || '20')
  };
  const lang = clip(pack.language || loaded.channel.language || '', 12);
  if (lang) { snippet.defaultLanguage = lang; snippet.defaultAudioLanguage = lang; }

  const startRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + tok.access_token,
      'content-type': 'application/json; charset=utf-8',
      'x-upload-content-type': video.type,
      'x-upload-content-length': String(video.buf.byteLength)
    },
    body: JSON.stringify({
      snippet,
      status: {
        privacyStatus: ['public', 'unlisted', 'private'].includes(opts.privacy) ? opts.privacy : 'public',
        selfDeclaredMadeForKids: false,
        madeForKids: false
      }
    })
  });
  if (!startRes.ok) {
    const body = await startRes.text();
    if (startRes.status === 401) await markExpired(env, acc.id);
    return { ok: false, code: startRes.status === 401 ? 'reconnect_needed' : startRes.status === 403 ? 'quota_or_scope' : 'youtube_start_failed', error: (startRes.status === 401 ? 'Token reject ho gaya — Studio me Reconnect dabao. ' : 'YouTube ne upload start reject kiya: ') + clip(body, 300) };
  }
  const location = startRes.headers.get('location');
  if (!location) return { ok: false, code: 'youtube_no_location', error: 'YouTube ne upload URL nahi diya.' };

  const upRes = await fetch(location, {
    method: 'PUT',
    headers: { 'content-type': video.type, 'content-length': String(video.buf.byteLength) },
    body: video.buf
  });
  const out = await upRes.text();
  if (!upRes.ok) return { ok: false, code: 'youtube_upload_failed', error: 'Upload fail: ' + clip(out, 300) };
  let id = '';
  try { id = JSON.parse(out).id || ''; } catch (e) { id = ''; }
  if (!id) return { ok: false, code: 'youtube_no_id', error: 'YouTube ne video id confirm nahi ki.' };
  return { ok: true, id, url: 'https://youtu.be/' + id, title, language: lang };
}

async function record(env, chCode, loaded, pack, result, mediaUrl) {
  try {
    await svc(env, 'hq_channel_uploads', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify([{
        id: uid('up'),
        channel_code: chCode,
        platform: 'youtube',
        account_id: loaded.account ? loaded.account.id : null,
        media_url: clip(mediaUrl, 500),
        title: clip(pack.title || '', 200),
        description: clip(pack.description || '', 5000),
        tags: Array.isArray(pack.tags) ? pack.tags.join(', ') : String(pack.tags || ''),
        language: clip(pack.language || '', 12),
        remote_id: result.id || null,
        remote_url: result.url || null,
        status: result.ok ? 'published' : 'failed',
        error: result.ok ? null : clip(result.error || '', 500),
        created_at: nowISO(), updated_at: nowISO()
      }])
    });
    if (result.ok) {
      await svc(env, 'hq_channel_accounts?id=eq.' + encodeURIComponent(loaded.account.id), {
        method: 'PATCH', body: JSON.stringify({ last_sync: nowISO() })
      });
    }
  } catch (e) { /* audit row is best-effort; the platform truth is in the response */ }
}

/* ------------------------------------------------------------------ entry -- */
export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!rate('mpub:' + (auth.user.id || 'x'), 6, 10 * 60_000)) return fail('Bahut zyada publish attempts — 10 minute ruk kar try karo.', 429);

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('Body must be JSON.'); }

  const videoUrl = String(body.video_url || '').trim();
  if (!/^https?:\/\//i.test(videoUrl)) return fail('video_url (public video URL) chahiye.');

  const list = (Array.isArray(body.channels) ? body.channels : []).slice(0, 5)
    .map(c => ({
      code: String(c.code || '').trim().toLowerCase(),
      title: clip(c.title || '', 100),
      description: clip(c.description || '', 4900),
      tags: Array.isArray(c.tags) ? c.tags : String(c.tags || '').split(',').map(s => s.trim()).filter(Boolean),
      hashtags: Array.isArray(c.hashtags) ? c.hashtags : [],
      language: clip(c.language || '', 12)
    }))
    .filter(c => /^[a-z0-9_-]{2,32}$/.test(c.code));
  if (!list.length) return fail('Kam se kam ek channel (with code) do.');
  if (list.some(c => !c.title)) return fail('Har channel ka title chahiye — pehle AI pack generate karo.');

  /* Video ek hi baar download hoti hai, sab channels share karte hain. */
  const video = await fetchVideo(videoUrl);
  if (!video.ok) return json({ ok: false, results: {}, error: video.error }, 400);

  const opts = { privacy: body.privacy || 'public', category_id: body.category_id || '20' };
  const results = {};

  for (const pack of list) {
    const loaded = await loadChannel(env, pack.code);
    if (!loaded.ok) { results[pack.code] = loaded; continue; }
    try {
      const r = await uploadOne(env, loaded, pack, video, opts);
      results[pack.code] = r;
      await record(env, pack.code, loaded, pack, r, videoUrl);
    } catch (e) {
      results[pack.code] = { ok: false, code: 'upload_error', error: clip(e.message || String(e), 240) };
    }
  }

  const anyOk = Object.values(results).some(r => r.ok);
  return json({
    ok: anyOk,
    at: nowISO(),
    results,
    videoBytes: video.buf.byteLength,
    quotaHint: 'YouTube: 1 upload ≈ 1600 units. ' + list.length + ' upload(s) ≈ ' + (list.length * 1600) + ' units (default limit 10,000/day per project).'
  }, anyOk ? 200 : 502);
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  try {
    const rows = await svc(env, 'hq_channel_uploads?select=*&order=created_at.desc&limit=50');
    return json({ ok: true, uploads: rows || [] });
  } catch (e) {
    return fail('Could not read hq_channel_uploads: ' + e.message, 500);
  }
}
