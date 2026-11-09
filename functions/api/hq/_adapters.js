/* ============================================================================
   Publishing adapters — one function per platform.

   Rules:
     • return { ok:true, url } only when the platform itself confirmed success;
     • otherwise return { ok:false, code, error } with a human explanation;
     • never throw raw provider payloads at the UI (they contain ids/scopes).

   Implemented against the official APIs: YouTube (Data API v3), Facebook
   (Graph Pages API), Discord (webhook). The rest return `manual_required`
   with the exact reason — HQ then offers the copy-and-post kit instead of
   pretending the post went out.
   ========================================================================== */

const clip = (s, n) => String(s || '').slice(0, n);

async function asBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download the media file (' + res.status + '). It must be a public URL.');
  const type = res.headers.get('content-type') || 'application/octet-stream';
  const buf = await res.arrayBuffer();
  return { buf, type };
}

/* -------------------------------------------------------------- YouTube ---- */
export async function youtube(env, account, post, mediaUrl) {
  const tok = account.token || {};
  if (!tok.access_token) return { ok: false, code: 'no_token', error: 'No YouTube access token stored.' };
  if (tok.expires_at && Date.now() > Number(tok.expires_at)) return { ok: false, code: 'token_expired', error: 'YouTube token expired — reconnect the account.' };
  if (!mediaUrl) return { ok: false, code: 'media_required', error: 'YouTube needs a video file. Attach a video or a public video URL.' };

  let file;
  try { file = await asBuffer(mediaUrl); } catch (e) { return { ok: false, code: 'media_fetch', error: e.message }; }

  const title = clip(post.title || post.body || 'DevChazers', 100);
  const description = clip((post.body || '') + (post.hashtags ? '\n\n' + post.hashtags : ''), 4900);
  const tags = String(post.hashtags || '').split(/[,\s]+/).map(t => t.replace(/^#/, '')).filter(Boolean).slice(0, 15);

  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + tok.access_token,
      'content-type': 'application/json; charset=utf-8',
      'x-upload-content-type': file.type,
      'x-upload-content-length': String(file.buf.byteLength)
    },
    body: JSON.stringify({
      snippet: { title, description, tags, categoryId: '20' },
      status: { privacyStatus: post.privacy === 'private' ? 'private' : 'public', selfDeclaredMadeForKids: false }
    })
  });
  if (!start.ok) {
    const body = await start.text();
    return { ok: false, code: start.status === 401 ? 'token_expired' : 'youtube_start_failed', error: 'YouTube rejected the upload start: ' + clip(body, 300) };
  }
  const location = start.headers.get('location');
  if (!location) return { ok: false, code: 'youtube_no_location', error: 'YouTube did not return an upload URL.' };

  const up = await fetch(location, { method: 'PUT', headers: { 'content-type': file.type, 'content-length': String(file.buf.byteLength) }, body: file.buf });
  const out = await up.text();
  if (!up.ok) return { ok: false, code: 'youtube_upload_failed', error: 'YouTube upload failed: ' + clip(out, 300) };
  let id = '';
  try { id = JSON.parse(out).id; } catch (e) { id = ''; }
  if (!id) return { ok: false, code: 'youtube_no_id', error: 'YouTube did not confirm a video id.' };
  return { ok: true, url: 'https://youtu.be/' + id, id };
}

/* ------------------------------------------------------------- Facebook ---- */
export async function facebook(env, account, post, mediaUrl) {
  const tok = account.token || {};
  const pageId = tok.page_id || account.page_id;
  const pageToken = tok.page_access_token || tok.access_token;
  if (!pageId || !pageToken) return { ok: false, code: 'page_token_missing', error: 'A Facebook Page id and Page access token are required — a user token alone cannot post to a Page.' };
  const isImage = /\.(png|jpe?g|webp|gif)$/i.test(mediaUrl || '') || /image/.test(post.media_type || '');
  const endpoint = isImage ? 'photos' : 'feed';
  const body = isImage
    ? { url: mediaUrl, caption: (post.body || '') + (post.hashtags ? '\n\n' + post.hashtags : ''), access_token: pageToken }
    : { message: (post.body || '') + (post.hashtags ? '\n\n' + post.hashtags : ''), link: post.url || undefined, access_token: pageToken };
  const res = await fetch('https://graph.facebook.com/v21.0/' + pageId + '/' + endpoint, { method: 'POST', body: new URLSearchParams(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) return { ok: false, code: 'facebook_failed', error: 'Facebook: ' + (data.error && data.error.message || 'request rejected') };
  const id = data.id || data.post_id || '';
  return { ok: true, id, url: id ? 'https://www.facebook.com/' + id : '' };
}

/* --------------------------------------------------------------- Discord --- */
export async function discord(env, account, post) {
  const tok = account.token || {};
  const hook = tok.webhook_url || account.webhook_url || env.DISCORD_WEBHOOK_DEFAULT;
  if (!hook) return { ok: false, code: 'no_webhook', error: 'No Discord webhook saved for this server.' };
  const res = await fetch(hook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: clip((post.title ? '**' + post.title + '**\n' : '') + (post.body || '') + (post.hashtags ? '\n' + post.hashtags : ''), 1900) })
  });
  if (!res.ok) return { ok: false, code: 'discord_failed', error: 'Discord rejected the message (' + res.status + ').' };
  return { ok: true, url: '' };
}


/* ------------------------------------------------------------------- X ----- */
export async function x(env, account, post) {
  const tok = account.token || {};
  if (!tok.access_token) return { ok: false, code: 'no_token', error: 'No X access token stored.' };
  const text = [post.body || post.title || '', post.hashtags || '', post.url || ''].filter(Boolean).join('\n\n').slice(0, 280);
  if (!text.trim()) return { ok: false, code: 'empty', error: 'X needs text (280 characters max).' };
  const res = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + tok.access_token, 'content-type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, code: res.status === 401 ? 'token_expired' : 'x_failed', error: 'X: ' + ((data.detail || data.title) || ('HTTP ' + res.status)) };
  const id = data.data && data.data.id;
  return { ok: !!id, id, url: id ? 'https://x.com/i/web/status/' + id : '' };
}

/* --------------------------------------------------------------- Threads --- */
export async function threads(env, account, post) {
  const tok = account.token || {};
  const userId = tok.page_id || account.page_id;
  if (!tok.access_token || !userId) return { ok: false, code: 'no_token', error: 'Threads needs a user id and access token — reconnect the account.' };
  const isVideo = /video/.test(post.media_type || '') || /\.(mp4|mov|webm)$/i.test(post.media_url || '');
  const create = new URLSearchParams({ media_type: isVideo ? 'VIDEO' : 'TEXT', text: (post.body || post.title || '').slice(0, 500), access_token: tok.access_token });
  if (post.media_url) create.set(isVideo ? 'video_url' : 'image_url', post.media_url);
  const c = await fetch('https://graph.threads.net/v1.0/' + userId + '/threads', { method: 'POST', body: create });
  const cj = await c.json().catch(() => ({}));
  if (!c.ok || !cj.id) return { ok: false, code: 'threads_container_failed', error: 'Threads: ' + ((cj.error && cj.error.message) || 'container rejected') };
  /* Media containers need a moment before publishing. */
  await new Promise(r => setTimeout(r, post.media_url ? 12000 : 1500));
  const pub = await fetch('https://graph.threads.net/v1.0/' + userId + '/threads_publish', {
    method: 'POST',
    body: new URLSearchParams({ creation_id: cj.id, access_token: tok.access_token })
  });
  const pj = await pub.json().catch(() => ({}));
  if (!pub.ok || !pj.id) return { ok: false, code: 'threads_publish_failed', error: 'Threads: ' + ((pj.error && pj.error.message) || 'publish rejected') };
  return { ok: true, id: pj.id, url: '' };
}

/* ------------------------------------------------------------- Instagram --- */
export async function instagram(env, account, post) {
  const tok = account.token || {};
  const igId = tok.ig_user_id || account.page_id;
  if (!tok.access_token || !igId) return { ok: false, code: 'no_token', error: 'Instagram needs a Business/Creator account id — reconnect.' };
  if (!post.media_url) return { ok: false, code: 'media_required', error: 'Instagram cannot publish text-only posts. Attach an image or video (public URL).' };
  const isVideo = /video/.test(post.media_type || '') || /\.(mp4|mov|webm)$/i.test(post.media_url);
  const cap = [post.body || post.title || '', post.hashtags || ''].filter(Boolean).join('\n\n').slice(0, 2200);
  const create = new URLSearchParams({ caption: cap, access_token: tok.access_token });
  if (isVideo) { create.set('media_type', 'REELS'); create.set('video_url', post.media_url); }
  else create.set('image_url', post.media_url);
  const c = await fetch('https://graph.facebook.com/v21.0/' + igId + '/media', { method: 'POST', body: create });
  const cj = await c.json().catch(() => ({}));
  if (!c.ok || !cj.id) return { ok: false, code: 'ig_container_failed', error: 'Instagram: ' + ((cj.error && cj.error.message) || 'container rejected') };
  await new Promise(r => setTimeout(r, isVideo ? 20000 : 5000));
  const pub = await fetch('https://graph.facebook.com/v21.0/' + igId + '/media_publish', {
    method: 'POST', body: new URLSearchParams({ creation_id: cj.id, access_token: tok.access_token })
  });
  const pj = await pub.json().catch(() => ({}));
  if (!pub.ok || !pj.id) return { ok: false, code: 'ig_publish_failed', error: 'Instagram: ' + ((pj.error && pj.error.message) || 'publish rejected') };
  return { ok: true, id: pj.id, url: 'https://www.instagram.com/p/' };
}

/* ---------------------------------------------------------------- Reddit --- */
export async function reddit(env, account, post) {
  const tok = account.token || {};
  if (!tok.access_token) return { ok: false, code: 'no_token', error: 'No Reddit token stored.' };
  const sub = String(tok.subreddit || account.subreddit || '').replace(/^r\//, '');
  if (!sub) return { ok: false, code: 'no_subreddit', error: 'Save the target subreddit on the account first.' };
  const form = new URLSearchParams({
    sr: sub,
    title: (post.title || post.body || '').slice(0, 300),
    kind: post.url ? 'link' : 'self',
    ...(post.url ? { url: post.url } : { text: [post.body || '', post.hashtags || ''].join('\n\n') }),
    api_type: 'json'
  });
  const res = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + tok.access_token, 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'DevChazersHQ/1.0' },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  const errs = data && data.json && data.json.errors;
  if (!res.ok || (errs && errs.length)) {
    const why = errs && errs.length ? errs.map(e => e.join(' ')).join('; ') : ('HTTP ' + res.status);
    return { ok: false, code: 'reddit_failed', error: 'Reddit: ' + why };
  }
  const url = data && data.json && data.json.data && data.json.data.url;
  return { ok: true, url: url || '' };
}

/* ------------------------------------------------ not implemented (honest) -- */
const notImplemented = (platform, reason) => () => Promise.resolve({ ok: false, code: 'manual_required', error: reason });

export const ADAPTERS = {
  youtube, facebook, instagram, threads, x, reddit, discord,
  tiktok: notImplemented('tiktok', 'TikTok’s Content Posting API only allows public posts after an app audit. Use the manual kit for now.'),
  linkedin: notImplemented('linkedin', 'LinkedIn company-page posting requires Marketing Developer Platform approval.'),
  pinterest: notImplemented('pinterest', 'Pinterest standard access requires an application review.')
};

export function adapterFor(platform) {
  return ADAPTERS[platform] || notImplemented(platform, 'No adapter for ' + platform + '. Use the manual publish kit.');
}
