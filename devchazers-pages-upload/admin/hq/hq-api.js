/* ============================================================================
   HQ ⇄ server bridge (Cloudflare Pages Functions in /functions/api/hq)
   Everything here is optional: if the functions are not deployed the calls fail
   quietly and HQ keeps working exactly as before (drafts, manual publish kit).
   No token ever reaches this file — it only forwards the Supabase session that
   supabase-js already holds in this browser.
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData;

  HQ.server = {
    checked: false, online: false, error: '', raw: null,
    providers: {}, adapters: { implemented: [], manual: [] }, scheduler: null,
    supabase: {}, tokenKey: false
  };

  async function accessToken() {
    try {
      if (!window.DC || !DC.live) return '';
      const c = D.client();
      if (!c) return '';
      const { data } = await c.auth.getSession();
      return (data && data.session && data.session.access_token) || '';
    } catch (e) { return ''; }
  }
  HQ.accessToken = accessToken;

  HQ.api = async (path, opts) => {
    opts = opts || {};
    const t = await accessToken();
    if (!t) throw new Error('Not signed in — server calls need an admin session.');
    const headers = Object.assign({ authorization: 'Bearer ' + t }, opts.headers || {});
    if (opts.body) headers['content-type'] = 'application/json';
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    const ct = res.headers.get('content-type') || '';
    let body = null;
    if (ct.indexOf('json') >= 0) body = await res.json().catch(() => ({}));
    else body = await res.text().catch(() => '');
    if (!res.ok) {
      const msg = (body && body.error) || (typeof body === 'string' && body.slice(0, 160)) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  };

  /** Detect the backend once per session. */
  HQ.ensureServer = async (force) => {
    if (HQ.server.checked && !force) return HQ.server;
    HQ.server.checked = true;
    try {
      const j = await HQ.api('/api/hq/status');
      HQ.server.raw = { status: 200, ct: 'json', body: JSON.stringify(j).slice(0, 300) };
      HQ.server.online = true;
      HQ.server.error = '';
      HQ.server.providers = (j && j.providers) || {};
      HQ.server.adapters = (j && j.adapters) || { implemented: [], manual: [] };
      HQ.server.scheduler = j && j.scheduler;
      HQ.server.supabase = (j && j.supabase) || {};
      HQ.server.tokenKey = !!(j && j.tokenKey);
    } catch (e) {
      HQ.server.online = false;
      HQ.server.raw = { status: e.status || 0, ct: '', body: String(e.message || '').slice(0, 300) };
      /* 404 = functions not deployed; anything else is a real message worth keeping */
      HQ.server.error = (e.status === 404 || e.status === 405)
        ? 'No /api/hq backend deployed — /api/hq/status returned ' + e.status + '.'
        : (e.message || 'Backend unreachable.');
    }
    return HQ.server;
  };

  HQ.providerReady = id => !!(HQ.server.online && HQ.server.providers[id] && HQ.server.providers[id].configured);

  /** Server-linked accounts, or null when the backend is unreachable. */
  HQ.remoteAccounts = async () => {
    if (!HQ.server.online) return null;
    try {
      const j = await HQ.api('/api/hq/accounts');
      return (j && j.accounts) || [];
    } catch (e) { return null; }
  };

  /** Copy the server's account truth into the local store so that every view
      (list, Manage modal, composer) reads one state. Only the fact that a token
      exists plus public handle fields are mirrored — never the token itself. */
  HQ.syncAccountsFromServer = async (remote) => {
    const rows = remote || await HQ.remoteAccounts();
    if (!rows) return false;
    const d = D.Store.load();
    let touched = false;
    rows.forEach(r => {
      if (!r || !r.platform) return;
      const i = d.accounts.findIndex(a => a.platform === r.platform);
      const local = i >= 0 ? d.accounts[i] : { id: r.id, platform: r.platform, created_at: r.created_at || D.nowISO() };
      const linked = r.status === 'connected';
      const next = Object.assign({}, local, {
        id: r.id || local.id,
        platform: r.platform,
        name: r.name || local.name || '',
        username: r.username || local.username || '',
        profile: r.profile || local.profile || '',
        page_id: r.page_id || local.page_id || '',
        note: local.note || '',
        source: 'server',
        updated_at: r.updated_at || local.updated_at,
        created_at: local.created_at || r.created_at,
        oauth: linked
          ? { linked_at: r.last_sync || r.updated_at || D.nowISO(), scopes: r.scopes || '' }
          : null
      });
      if (JSON.stringify(next) !== JSON.stringify(local)) {
        touched = true;
        if (i >= 0) d.accounts[i] = next; else d.accounts.push(next);
      }
    });
    /* A local "token linked" flag with no matching server row means the token is
       gone (revoked on the server). Never keep showing it as connected. */
    d.accounts.forEach(a => {
      if (!a) return;
      const alive = rows.some(r => r && r.platform === a.platform && r.status === 'connected');
      if (!alive && a.oauth && a.oauth.linked_at) { a.oauth = null; a.source = 'local'; touched = true; }
    });
    if (touched) D.Store.save();
    return touched;
  };

  /** Unified account model: server rows win, local records fill the gaps. */
  HQ.accountsModel = async () => {
    const remote = await HQ.remoteAccounts();
    if (remote) await HQ.syncAccountsFromServer(remote);
    const local = D.accounts();
    if (!remote) return local;
    return local.map(row => {
      const r = remote.find(x => x.platform === row.platform.id);
      if (!r) return row;
      const status = r.status === 'connected' ? 'connected'
        : r.status === 'expired' ? 'authorization_required'
          : r.status === 'disconnected' ? 'disconnected' : 'authorization_required';
      return {
        platform: row.platform,
        status,
        record: Object.assign({}, row.record || {}, r, {
          source: 'server',
          oauth: r.status === 'connected' ? { linked_at: r.last_sync || r.updated_at } : null,
          updated_at: r.updated_at, created_at: r.created_at
        })
      };
    });
  };

  /** Real OAuth: ask the server for the signed authorize URL, then navigate. */
  HQ.startOAuth = async id => {
    if (!HQ.providerReady(id)) return false;
    try {
      const j = await HQ.api('/api/hq/oauth/' + encodeURIComponent(id) + '/start?json=1');
      if (!j || !j.url) throw new Error('The server did not return an authorize URL.');
      location.href = j.url;
      return true;
    } catch (e) {
      HQ.toast('Could not start OAuth: ' + e.message, true);
      return false;
    }
  };

  HQ.revokeRemote = async id => {
    if (!HQ.server.online) return false;
    try { await HQ.api('/api/hq/accounts?platform=' + encodeURIComponent(id), { method: 'DELETE' }); return true; }
    catch (e) { HQ.toast('Server revoke failed: ' + e.message, true); return false; }
  };

  /** Publish a post that lives in hq_social_posts. */
  HQ.publishRemote = async postId => {
    const j = await HQ.api('/api/hq/publish', { method: 'POST', body: JSON.stringify({ post_id: postId }) });
    return j || {};
  };

  HQ.flushDue = async () => {
    const j = await HQ.api('/api/hq/publish?due=1', { method: 'POST', body: '{}' });
    return j || {};
  };

  /* ------------------------------------------------------- manual publish kit
     For platforms with no adapter (or no approval yet) HQ gives you everything
     you need to post by hand in 30 seconds — and records the URL you paste back
     so the history stays truthful. */
  const UPLOAD_PAGES = {
    youtube: 'https://studio.youtube.com/channel/UC/videos/upload',
    facebook: 'https://www.facebook.com/',
    instagram: 'https://www.instagram.com/',
    tiktok: 'https://www.tiktok.com/upload',
    x: 'https://x.com/compose/post',
    threads: 'https://www.threads.net/',
    linkedin: 'https://www.linkedin.com/feed/',
    pinterest: 'https://www.pinterest.com/pin-builder/',
    reddit: 'https://www.reddit.com/submit',
    discord: 'https://discord.com/channels/@me'
  };
  HQ.uploadPageFor = id => UPLOAD_PAGES[id] || '';

  HQ.manualKit = (draft, platformIds) => {
    const tags = HQ.hashtagsFrom(draft.hashtags || '').join(' ');
    const text = [draft.title, draft.body, tags, draft.url].filter(Boolean).join('\n\n');
    const m = HQ.modal({
      title: 'Manual publish kit',
      sub: 'Copy → paste → post. HQ records the URL you paste back.',
      size: 'lg',
      body:
        '<div class="hq-note a">' + HQ.icon('info') + '<div class="grow">HQ cannot post to these platforms yet, so it will not claim it did. Use this kit: the copy below is already formatted, then paste the live URL so Publishing History stays accurate.</div></div>' +
        '<div class="hq-form">' +
        HQ.ui.field({ full: true, label: 'Text to paste', input: '<textarea name="kit" rows="7" readonly>' + HQ.esc(text) + '</textarea>' }) +
        (draft.url ? HQ.ui.field({ full: true, label: 'Link', input: '<input name="link" value="' + HQ.esc(draft.url) + '" readonly>' }) : '') +
        '</div>' +
        '<div class="hq-toolbar" style="margin:10px 0">' +
        '<button type="button" class="btn" data-copy>' + HQ.icon('copy') + ' Copy text</button>' +
        (platformIds || []).map(id => HQ.uploadPageFor(id)
          ? '<a class="btn" href="' + HQ.esc(HQ.uploadPageFor(id)) + '" target="_blank" rel="noopener">' + HQ.platIcon(id) + ' Open ' + HQ.esc((D.PLATFORMS.find(p => p.id === id) || {}).name || id) + ' ↗</a>'
          : '').join('') +
        '</div>' +
        '<div class="hq-form"><label class="hq-field full"><span>Live post URL(s) once published</span>' +
        '<input name="manual_urls" placeholder="one URL per line, e.g. https://youtu.be/xxxx"></label></div>' +
        '<div class="hq-hint">Saving records the post as <b>Published (manual)</b> with the URLs you paste. That is your statement, not a platform confirmation — History labels it that way.</div>',
      footer: '<button type="button" class="btn" data-close>Close</button><button type="button" class="btn pri" data-save>Save as published (manual)</button>',
      onMount(api) {
        api.q('[data-copy]').onclick = () => HQ.copy(text);
        api.q('[data-save]').onclick = async () => {
          const urls = String((api.q('[name=manual_urls]') || {}).value || '').split(/\s+/).filter(Boolean);
          if (!urls.length) return HQ.toast('Paste at least one live URL.', true);
          api.close();
          const byPlatform = {};
          (platformIds || []).forEach(id => { byPlatform[id] = urls[0]; });
          const row = await D.create('posts', Object.assign({}, draft, {
            status: 'published', published_at: new Date().toISOString(),
            published_urls: byPlatform, manual: true, manual_urls: urls
          }));
          D.log('post_published_manual', row.title || row.id);
          HQ.toast('Recorded as published (manual).');
          HQ.reload();
        };
      }
    });
    return m;
  };
})();
