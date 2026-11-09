/* ============================================================================
   HQ views — Social Media (Accounts, Post Composer, AI SEO Studio, Languages)
   Publishing is never simulated: a post only becomes "published" when a real
   platform connection + endpoint exist. Until then drafts/schedules are stored
   in the HQ workspace and clearly labelled.
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData, ui = HQ.ui;
  const P = D.PLATFORMS;

  const STATUS_COPY = {
    disconnected: 'No account saved for this platform.',
    authorization_required: 'Account saved locally — no OAuth token, so publishing is disabled.',
    connected: 'OAuth token linked — publishing available.'
  };

  /* ========================================================  SOCIAL ACCOUNTS */
  async function viewAccounts(root) {
    root.innerHTML = ui.page(ui.loading(4));
    await HQ.ensureServer();
    const rows = await HQ.accountsModel();
    const counts = { connected: 0, authorization_required: 0, disconnected: 0 };
    rows.forEach(r => counts[r.status]++);
    const anyProvider = Object.values(HQ.cfg.PROVIDERS).some(p => p && p.authUrl);

    const cards = rows.map(({ platform: p, record: rec, status }) => {
      const cls = status === 'connected' ? ' on' : status === 'authorization_required' ? ' req' : '';
      return '<article class="hq-plat' + cls + '" data-platform="' + p.id + '">' +
        '<div class="hq-plat-h">' +
        '<div class="hq-plat-ic ' + p.cls + '">' + HQ.platIcon(p.id) + '</div>' +
        '<div class="hq-plat-n"><b>' + HQ.esc(p.name) + '</b><span>' +
        (rec ? HQ.esc(rec.name || p.name) + (rec.username ? ' · ' + HQ.esc(rec.username) : '') : 'Not connected') + '</span></div>' +
        ui.badge(status) + '</div>' +
        '<div class="hq-plat-meta">' +
        (rec ? '<span>' + HQ.icon('clock') + ' Saved ' + HQ.esc(HQ.rel(rec.updated_at || rec.created_at)) + '</span>' : '<span>Username: —</span>') +
        (rec && rec.profile ? '<a class="hq-link" href="' + HQ.esc(HQ.safeUrl(rec.profile) || '#') + '" target="_blank" rel="noopener">Profile ↗</a>' : '') +
        '</div>' +
        '<div class="acts">' +
        (status === 'disconnected'
          ? '<button type="button" class="btn pri" data-a="connect">Connect Account</button>' +
            '<button type="button" class="btn" data-a="manage">Manage</button>'
          : status === 'authorization_required'
            ? '<button type="button" class="btn pri" data-a="connect">Connect Account</button>' +
              '<button type="button" class="btn" data-a="manage">Manage</button>' +
              '<button type="button" class="btn dng" data-a="disconnect">Disconnect</button>'
            : '<button type="button" class="btn" data-a="manage">Manage Account</button>' +
              '<button type="button" class="btn dng" data-a="disconnect">Disconnect</button>') +
        '</div></article>';
    }).join('');

    root.innerHTML = ui.page(
      ui.head({
        title: 'Social Accounts',
        sub: 'Nine platforms, one workspace. HQ reads account state honestly: nothing is shown as connected until an OAuth token is actually linked.',
        actions: '<button type="button" class="btn" data-a="refresh">' + HQ.icon('refresh') + ' Refresh</button>' +
          '<a class="btn" href="../?tab=settings">' + HQ.icon('gear') + ' Branding / links</a>'
      }) +
      (HQ.server.online
        ? ui.note({
          tone: 'g', icon: 'check', title: 'Publish server online.',
          text: 'Accounts listed here come from <code>hq_social_accounts</code>. Tokens are encrypted on the server (<code>hq_social_tokens</code>) and never sent to this browser. ' +
            (Object.keys(HQ.server.providers || {}).filter(id => HQ.providerReady(id)).length
              ? 'Configured OAuth apps: <b>' + Object.keys(HQ.server.providers).filter(id => HQ.providerReady(id)).map(id => HQ.server.providers[id].name).join(', ') + '</b>.'
              : '<b>No OAuth app is configured yet</b> — add client id/secret pairs as Cloudflare secrets to turn Connect into a real consent screen.')
        })
        : anyProvider
        ? ui.note({ tone: 'a', title: 'OAuth provider configured.', text: 'At least one platform has an authorize URL in <code>HQ_CONFIG.PROVIDERS</code>. Connect will open the real provider consent screen.' })
        : ui.note({
          tone: 'w', icon: 'lock', title: 'OAuth apps are not configured yet.',
          text: 'Connect Account explains what is missing instead of pretending. Paste an authorize URL into <code>HQ_CONFIG.PROVIDERS</code> (admin/hq/hq-data.js) to make the button start a real OAuth flow. Saved handles stay in <b>Authorization required</b> until then.'
        })) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Connected accounts', value: counts.connected, icon: 'share', tone: 'g', na: !counts.connected, foot: 'Verified OAuth tokens' }) +
      ui.stat({ label: 'Authorization required', value: counts.authorization_required, icon: 'lock', tone: 'w', na: !counts.authorization_required, foot: 'Handles saved, no token' }) +
      ui.stat({ label: 'Disconnected', value: counts.disconnected, icon: 'x', tone: 'p', foot: 'No account saved' }) +
      ui.stat({ label: 'Platforms available', value: P.length, icon: 'layers', tone: 'p', foot: 'Support matrix ready' }) +
      '</div>' +
      ui.note({
        text: '<b>States</b> — <span class="bd m">Disconnected</span> no record · ' +
          '<span class="bd w">Authorization required</span> account details saved, token missing · ' +
          '<span class="bd g">Connected</span> token linked. HQ can only show the third state when a real token exists.'
      }) +
      '<div class="hq-plat-grid">' + cards + '</div>' +
      ui.card({
        title: 'Provider setup (integration point)',
        sub: 'Nothing here is secret — authorize URLs are public endpoints.',
        tight: true,
        body: '<div class="hq-tbl-wrap"><table class="hq-tbl rsp"><thead><tr><th>Platform</th><th>Authorize URL</th><th>Env key expected by the backend</th><th class="num">Status</th></tr></thead><tbody>' +
          P.map(p => {
            const url = (HQ.cfg.PROVIDERS[p.id] || {}).authUrl || '';
            return '<tr><td data-l="Platform"><span class="hq-cell"><span class="ph" style="background:#ffffff10;color:' + 'var(--mut)' + '">' + HQ.platIcon(p.id) + '</span><b>' + HQ.esc(p.name) + '</b></span></td>' +
              '<td data-l="Authorize URL">' + (url ? '<a class="hq-link" href="' + HQ.esc(url) + '" target="_blank" rel="noopener">Configured ↗</a>' : '<span class="hq-muted">Not configured</span>') + '</td>' +
              '<td data-l="Env key"><span class="hq-mono">' + HQ.esc(p.id.toUpperCase()) + '_CLIENT_ID</span></td>' +
              '<td data-l="Status" class="num">' + (url ? '<span class="bd g">Ready</span>' : '<span class="bd m">Missing</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
      }) +
      (HQ.capabilityTable ? HQ.capabilityTable() : '')
    );

    HQ.on(root, 'click', '[data-a="refresh"]', () => { D.resetProbes(); HQ.reload(); });
    HQ.on(root, 'click', '[data-platform] [data-a]', async (e, btn) => {
      const id = btn.closest('[data-platform]').dataset.platform;
      const a = btn.dataset.a;
      if (a === 'connect') {
        if (HQ.providerReady(id)) {
          const started = await HQ.startOAuth(id);
          if (started) return;
        }
        openConnect(id);
      }
      if (a === 'manage') openManage(id);
      if (a === 'disconnect') disconnect(id);
    });
  }

  function openConnect(id) {
    const p = P.find(x => x.id === id);
    const prov = HQ.cfg.PROVIDERS[id] || {};
    const rec = D.accounts().find(a => a.platform.id === id).record || {};
    const body = prov.authUrl
      ? '<p style="margin:0;font-size:13px;color:var(--tx)">This opens the real ' + HQ.esc(p.name) + ' consent screen. HQ stores the returned token through your backend (no token is created in the browser).</p>' +
        '<div class="hq-note a">' + HQ.icon('info') + '<div class="grow">Authorize URL: <code>' + HQ.esc(prov.authUrl) + '</code></div></div>'
      : '<div class="hq-note w">' + HQ.icon('alert') + '<div class="grow"><b>OAuth app not configured.</b> A real connection needs a ' + HQ.esc(p.name) +
        ' app (client id + secret) and a redirect endpoint that stores the refresh token. HQ has no backend for that yet, so it will not fake a connection.</div></div>' +
        '<div class="hq-form-grid">' +
        ui.field({ label: 'Account / channel name', input: '<input name="name" value="' + HQ.esc(rec.name || '') + '" placeholder="DevChazers" maxlength="80">' }) +
        ui.field({ label: 'Username / handle', input: '<input name="username" value="' + HQ.esc(rec.username || '') + '" placeholder="' + HQ.esc(p.handle) + '" maxlength="60">' }) +
        ui.field({ label: 'Profile URL', full: true, input: '<input name="profile" type="url" value="' + HQ.esc(rec.profile || '') + '" placeholder="https://…">' }) +
        ui.field({ label: 'Internal note', full: true, input: '<input name="note" value="' + HQ.esc(rec.note || '') + '" placeholder="Who owns this account?" maxlength="120">' }) +
        '</div>' +
        '<div class="hq-hint">Saving these details records the account as <b>Authorization required</b> — enough for planning and scheduling, never enough to publish.</div>';

    const m = HQ.modal({
      title: 'Connect ' + p.name,
      sub: prov.authUrl ? 'Live OAuth flow' : 'Account details only — no token',
      body: body,
      footer: prov.authUrl
        ? '<button type="button" class="btn" data-close>Cancel</button><a class="btn pri" href="' + HQ.esc(prov.authUrl) + '" target="_blank" rel="noopener">Continue to ' + HQ.esc(p.name) + '</a>'
        : '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-save>Save account details</button>',
      onMount(api) {
        const save = api.q('[data-save]');
        if (!save) return;
        save.onclick = async () => {
          const f = api.q('.hq-form-grid');
          const data = {};
          [...f.querySelectorAll('input')].forEach(i => { data[i.name] = i.value.trim(); });
          if (!data.name && !data.username) return HQ.toast('Add an account name or username first.', true);
          await D.saveAccount(id, data);
          D.log('social_account_saved', p.name + ' → authorization required');
          HQ.toast(p.name + ' saved — marked "Authorization required" (no token yet).');
          m.close(); HQ.reload();
        };
      }
    });
  }

  function openManage(id) {
    const p = P.find(x => x.id === id);
    const cur = D.accounts().find(a => a.platform.id === id);
    const rec = cur.record || {};
    const body = '<div class="hq-list"><div class="hq-li"><div class="ic ' + p.cls + '">' + HQ.platIcon(p.id) + '</div>' +
      '<div class="bd2"><b>' + HQ.esc(p.name) + '</b><span>' + HQ.esc(STATUS_COPY[cur.status]) + '</span></div>' + ui.badge(cur.status) + '</div></div>' +
      '<div class="hq-form-grid">' +
      ui.field({ label: 'Account / channel name', input: '<input name="name" value="' + HQ.esc(rec.name || '') + '" maxlength="80" placeholder="DevChazers">' }) +
      ui.field({ label: 'Username / handle', input: '<input name="username" value="' + HQ.esc(rec.username || '') + '" maxlength="60" placeholder="' + HQ.esc(p.handle) + '">' }) +
      ui.field({ label: 'Profile URL', full: true, input: '<input name="profile" type="url" value="' + HQ.esc(rec.profile || '') + '" placeholder="https://…">' }) +
      ui.field({ label: 'Internal note', full: true, input: '<input name="note" value="' + HQ.esc(rec.note || '') + '" maxlength="120">' }) +
      '</div>' +
      '<div class="hq-note">' + HQ.icon('shield') + '<div class="grow">Token: ' +
      (rec.oauth && rec.oauth.linked_at ? '<b>linked ' + HQ.esc(HQ.date(rec.oauth.linked_at)) + '</b>' : '<b>none</b> — publishing stays disabled') +
      '. Content limits for this platform: ' + (p.titleMax ? p.titleMax + ' char title, ' : '') + p.textMax + ' char text, ' + p.tagMax + ' hashtags.</div></div>';
    const m = HQ.modal({
      title: 'Manage ' + p.name,
      sub: rec.name || 'Not connected',
      body: body,
      footer: (cur.status === 'disconnected' ? '' : '<button type="button" class="btn dng left" data-disc>Disconnect</button>') +
        '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-save>Save changes</button>',
      onMount(api) {
        api.q('[data-save]').onclick = async () => {
          const data = {};
          [...api.qa('input')].forEach(i => { data[i.name] = i.value.trim(); });
          await D.saveAccount(id, data);
          D.log('social_account_update', p.name);
          HQ.toast('Account details saved.');
          m.close(); HQ.reload();
        };
        const d = api.q('[data-disc]');
        if (d) d.onclick = () => { m.close(); disconnect(id); };
      }
    });
  }

  async function disconnect(id) {
    const p = P.find(x => x.id === id);
    const ok = await HQ.confirm('Disconnect ' + p.name + '?', {
      detail: 'The saved handle and any HQ draft targets stay, but the account returns to the Disconnected state.', ok: 'Disconnect', danger: true
    });
    if (!ok) return;
    if (HQ.server.online) await HQ.revokeRemote(id);
    await D.disconnectAccount(id);
    D.log('social_account_disconnected', p.name);
    HQ.toast(p.name + ' disconnected.');
    HQ.reload();
  }

  /* ========================================================= POST COMPOSER */
  const composerState = { media: [], files: [], previewPlatform: null };

  function emptyDraft() {
    return {
      title: '', body: '', hashtags: '', url: '', platforms: [], language: 'en',
      media: []
    };
  }

  async function viewComposer(root, ctx) {
    const id = ctx.query.get('id');
    const editing = id ? (await D.list('posts')).find(p => p.id === id) : null;
    const d = editing ? Object.assign(emptyDraft(), editing) : Object.assign(emptyDraft(), HQ.handoff || {});
    HQ.handoff = null;
    composerState.media = (d.media || []).slice();
    composerState.previewPlatform = (d.platforms && d.platforms[0]) || 'youtube';
    const accounts = await HQ.accountsModel();
    const connected = accounts.filter(a => a.status === 'connected');
    const serverPublish = HQ.server.online && D.useCloud('posts') && connected.some(a => (HQ.server.adapters.implemented || []).indexOf(a.platform.id) >= 0);
    const canPublish = connected.length > 0;

    const langOpts = D.LANGUAGES.map(l => ({ value: l.code, label: l.name + ' — ' + l.native }));

    root.innerHTML = ui.page(
      ui.head({
        title: editing ? 'Edit Post' : 'Universal Post Composer',
        sub: 'One draft for every platform. HQ adapts the copy to each network\'s limits and shows a platform-specific preview before anything leaves the studio.',
        actions: (editing ? '<a class="btn" href="#/social/history">' + HQ.icon('clock') + ' History</a>' : '') +
          '<button type="button" class="btn" data-a="preview-modal">' + HQ.icon('eye') + ' Preview</button>'
      }) +
      (canPublish
        ? ui.note({ tone: 'g', icon: 'check', text: '<b>' + connected.length + ' connected account(s).</b> ' +
            (serverPublish ? 'Publish now is live: the server function posts to ' + connected.map(a => a.platform.name).filter(n => (HQ.server.adapters.implemented || []).indexOf((D.PLATFORMS.find(p => p.name === n) || {}).id) >= 0).join(', ') + ' and stores the returned URL.'
              : 'Publish now stays blocked until the backend function is deployed or a platform adapter exists — use the manual publish kit meanwhile.') })
        : ui.note({
          tone: 'w', icon: 'lock', title: 'No connected social accounts.',
          text: 'Drafts and schedules are saved to the HQ workspace, but <b>Publish now stays disabled</b> so nothing is falsely reported as published. Connect an account in Social → Accounts first.'
        })) +
      '<div class="hq-split">' +
      /* ---------------- left: form ---------------- */
      '<div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Content',
        body: '<form id="composer-form" class="hq-form-grid" novalidate>' +
          ui.field({ label: 'Post title', full: true, input: '<input name="title" maxlength="200" value="' + HQ.esc(d.title) + '" placeholder="Multiplayer Golf – Daily Quest update">', hint: 'Titles are used by YouTube, Facebook, Pinterest and Reddit. Instagram/TikTok/X publish the text only.' }) +
          ui.field({ label: 'Description / caption', full: true, input: '<textarea name="body" class="hq-ta" rows="6" maxlength="5000" placeholder="What is this post about?">' + HQ.esc(d.body) + '</textarea>' }) +
          '<div class="full hq-inline" style="justify-content:space-between"><span class="hq-hint" id="limit-hint">Platform limit shown on the preview.</span><span class="hq-counter" id="body-count">0</span></div>' +
          ui.field({ label: 'Hashtags', full: true, input: '<input name="hashtags" value="' + HQ.esc(d.hashtags) + '" placeholder="#DevChazers #MobileGame #IndieGame">', hint: 'Space or comma separated — HQ de-duplicates and counts them per platform.' }) +
          ui.field({ label: 'Website URL', full: true, input: '<input name="url" type="url" value="' + HQ.esc(d.url) + '" placeholder="https://devchazers.site/">' }) +
          ui.field({ label: 'Publishing language', input: ui.select('language', langOpts, d.language || 'en') }) +
          '<div class="hq-field"><span>Media</span><div class="hq-hint">' + (HQ.cfg.IMAGE_TYPES.length ? 'PNG, JPG, WebP, GIF, SVG up to 5 MB · MP4/WebM up to 64 MB' : '') + '</div></div>' +
          '</form>' +
          ui.dropzone({ id: 'composer-media', title: 'Drag & drop video or images', hint: 'or click to browse — files upload to the existing site-media bucket on save', multiple: true, accept: 'image/*,video/*' }) +
          '<div class="hq-thumbs" id="composer-thumbs"></div>'
      }) +
      ui.card({
        title: 'Platforms',
        sub: 'Pick where this post is meant to go.',
        body: '<div class="hq-taglist" id="plat-picker">' + P.map(p => {
          const on = (d.platforms || []).includes(p.id);
          const acc = accounts.find(a => a.platform.id === p.id);
          return '<button type="button" class="hq-chip ' + (on ? 'a' : '') + '" data-pick="' + p.id + '" title="' + HQ.esc(STATUS_COPY[acc.status]) + '">' +
            HQ.platIcon(p.id) + ' ' + HQ.esc(p.name) + (acc.status === 'connected' ? ' •' : '') + '</button>';
        }).join('') + '</div>' +
          '<div class="hq-hint" style="margin-top:8px">A dot marks platforms with a connected account. Selection drives the preview tabs and the character-limit checks.</div>'
      }) +
      ui.card({
        title: 'Publishing',
        sub: 'Nothing is sent until a real connection exists.',
        body: '<div class="hq-toolbar">' +
          '<button type="button" class="btn pri" data-a="publish" ' + (canPublish ? '' : 'disabled title="No connected account"') + '>' + HQ.icon('send') + ' Publish Now</button>' +
          '<button type="button" class="btn" data-a="schedule">' + HQ.icon('calendar') + ' Schedule Post</button>' +
          '<button type="button" class="btn" data-a="draft">' + HQ.icon('bookmark') + ' Save as draft</button>' +
          (editing ? '<button type="button" class="btn dng" data-a="delete">' + HQ.icon('trash') + ' Delete</button>' : '') +
          '</div>' +
          '<div class="hq-hint" style="margin-top:10px">Drafts and schedules live in the HQ workspace (localStorage) and can be promoted to Supabase with <code>hq-optional-schema.sql</code>.</div>' +
          '<p class="msg" id="composer-msg"></p>'
      }) +
      '</div>' +
      /* ---------------- right: preview ---------------- */
      '<div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({
        title: 'Platform preview',
        actions: '<span class="hq-chip" id="pv-count">0 platforms</span>',
        body: '<div class="hq-tabs" id="pv-tabs"></div><div class="hq-preview-stage" id="pv-stage" style="margin-top:10px"></div>' +
          '<div class="pv-note" id="pv-note"></div>'
      }) +
      ui.card({
        title: 'Composer checklist',
        body: '<div class="hq-list" id="composer-checks"></div>'
      }) +
      '</div></div>'
    );

    /* -------- wiring -------- */
    const form = root.querySelector('#composer-form');
    const readForm = () => {
      const v = HQ.formData(form);
      return {
        title: (v.title || '').trim(), body: (v.body || '').trim(),
        hashtags: (v.hashtags || '').trim(), url: (v.url || '').trim(), language: v.language || 'en',
        platforms: [...root.querySelectorAll('[data-pick].a')].map(b => b.dataset.pick),
        media: composerState.media
      };
    };

    const refresh = () => {
      const cur = readForm();
      if (!cur.platforms.includes(composerState.previewPlatform)) composerState.previewPlatform = cur.platforms[0] || null;
      root.querySelector('#pv-count').textContent = cur.platforms.length + ' platform' + (cur.platforms.length === 1 ? '' : 's');
      const tabs = root.querySelector('#pv-tabs');
      tabs.innerHTML = cur.platforms.length
        ? cur.platforms.map(id => { const p = P.find(x => x.id === id); return '<button type="button" data-pv="' + id + '"' + (id === composerState.previewPlatform ? ' class="on"' : '') + '>' + HQ.platIcon(id) + HQ.esc(p.name) + '</button>'; }).join('')
        : '<span class="hq-hint" style="padding:7px 10px">Select at least one platform</span>';
      root.querySelector('#pv-stage').innerHTML = composerState.previewPlatform
        ? previewFor(composerState.previewPlatform, cur)
        : ui.empty({ icon: 'share', title: 'No platform selected', text: 'Pick platforms on the left to see how the post will look on each network.', cls: 'sm' });
      const p = P.find(x => x.id === composerState.previewPlatform);
      root.querySelector('#pv-note').textContent = p ? 'Preview is generated locally from your draft — no network request is made.' : '';
      const bodyLen = cur.body.length, tags = HQ.hashtagsFrom(cur.hashtags);
      const limit = p ? p.textMax : 2200;
      const bc = root.querySelector('#body-count');
      bc.textContent = bodyLen + ' / ' + limit + ' chars';
      bc.className = 'hq-counter' + (bodyLen > limit ? ' over' : '');
      root.querySelector('#limit-hint').textContent = p ? p.name + ': ' + limit + ' char caption limit · ' + p.tagMax + ' hashtags · title max ' + (p.titleMax || 'n/a') : 'Platform limit shown on the preview.';
      root.querySelector('#composer-checks').innerHTML = [
        { icon: 'pen', ok: !!(cur.title || cur.body), t: 'Title or caption written' },
        { icon: 'share', ok: cur.platforms.length > 0, t: 'At least one platform selected' },
        { icon: 'image', ok: cur.media.length > 0, t: 'Media attached (required by TikTok / Instagram)' },
        { icon: 'bookmark', ok: (cur.hashtags || '').length > 0, t: 'Hashtags added' },
        { icon: 'link', ok: !!cur.url, t: 'Website URL added' },
        { icon: 'clock', ok: cur.language !== '', t: 'Language selected' }
      ].map(c => '<div class="hq-li"><div class="ic" style="color:' + (c.ok ? 'var(--good)' : '#5f6080') + '">' + HQ.icon(c.ok ? 'check' : c.icon) + '</div>' +
        '<div class="bd2"><span style="color:' + (c.ok ? 'var(--tx)' : 'var(--mut)') + '">' + c.t + '</span></div></div>').join('');
      drawThumbs(root);
    };

    const drawThumbs = (r) => {
      const box = r.querySelector('#composer-thumbs');
      box.innerHTML = composerState.media.map((m, i) =>
        '<div class="hq-thumb">' + (m.kind === 'video' || /\.(mp4|webm|mov|ogv)$/i.test(m.name || '')
          ? '<video src="' + HQ.esc(m.url) + '" muted playsinline></video><span class="k">VIDEO</span>'
          : '<img src="' + HQ.esc(m.url) + '" alt="">') +
        '<button type="button" class="x" data-rm="' + i + '" aria-label="Remove">×</button></div>').join('');
    };

    root.querySelector('#composer-media').addEventListener('change', async e => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        const kind = D.isVideo(f.type, f.name) ? 'video' : D.isImage(f.type, f.name) ? 'image' : null;
        if (!kind) { HQ.toast(f.name + ': unsupported type', true); continue; }
        composerState.media.push({ id: D.uid('m'), name: f.name, type: f.type, size: f.size, kind, url: URL.createObjectURL(f), _file: f });
      }
      refresh();
    });
    root.querySelector('#composer-form').addEventListener('input', refresh);
    root.addEventListener('change', refresh);
    root.querySelector('#composer-thumbs').addEventListener('click', e => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      composerState.media.splice(+b.dataset.rm, 1); refresh();
    });
    root.querySelector('#plat-picker').addEventListener('click', e => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      b.classList.toggle('a'); refresh();
    });
    root.querySelector('#pv-tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-pv]'); if (!b) return;
      composerState.previewPlatform = b.dataset.pv; refresh();
    });
    refresh();

    const uploadMedia = async () => {
      const out = [];
      for (const m of composerState.media) {
        if (m._file) {
          const up = await D.upload(m._file, 'social');
          out.push({ id: m.id, name: m.name, type: m.type, size: m.size, kind: m.kind, url: up.url, path: up.path || '' });
        } else out.push({ id: m.id, name: m.name, type: m.type, size: m.size, kind: m.kind, url: m.url, path: m.path || '' });
      }
      return out;
    };

    const save = async (status, extra) => {
      const msg = root.querySelector('#composer-msg'); msg.textContent = '';
      const cur = readForm();
      if (!cur.title && !cur.body) { msg.textContent = 'Add a title or caption before saving.'; return; }
      if (!cur.platforms.length) { msg.textContent = 'Select at least one platform.'; return; }
      try {
        const media = await uploadMedia();
        const row = Object.assign({}, cur, { media, status }, extra || {});
        if (editing) { await D.update('posts', editing.id, row); }
        else await D.create('posts', row);
        D.log(status === 'scheduled' ? 'post_scheduled' : status === 'draft' ? 'post_draft' : 'post_' + status,
          (cur.title || HQ.clamp(cur.body, 40)) + ' → ' + cur.platforms.join(', '));
        HQ.toast(status === 'draft' ? 'Draft saved to the HQ workspace.'
          : status === 'scheduled' ? 'Scheduled. It stays queued until a platform connection can publish it.'
            : 'Saved.');
        HQ.reload();
      } catch (e) { msg.textContent = 'Save failed: ' + e.message; HQ.toast('Save failed: ' + e.message, true); }
    };

    root.querySelector('[data-a="draft"]').onclick = () => save('draft');
    root.querySelector('[data-a="preview-modal"]').onclick = () => {
      const cur = readForm();
      HQ.modal({
        title: 'Preview', sub: (cur.platforms.length || 0) + ' platform(s)', size: 'lg',
        body: cur.platforms.length ? cur.platforms.map(id => { const p = P.find(x => x.id === id); return '<div style="margin-bottom:14px"><div class="hq-chip" style="margin-bottom:8px">' + HQ.platIcon(id) + ' ' + HQ.esc(p.name) + '</div>' + previewFor(id, cur) + '</div>'; }).join('')
          : ui.empty({ title: 'No platforms selected', text: 'Select at least one platform to preview.', cls: 'sm' })
      });
    };
    root.querySelector('[data-a="schedule"]').onclick = () => openSchedule();
    root.querySelector('[data-a="publish"]').onclick = () => openPublish();
    const del = root.querySelector('[data-a="delete"]');
    if (del) del.onclick = async () => {
      if (!await HQ.confirm('Delete this post?', { danger: true, ok: 'Delete' })) return;
      await D.remove('posts', editing.id); HQ.toast('Post deleted.'); HQ.go('/social/history');
    };

    function openSchedule() {
      const d0 = new Date(Date.now() + 3600e3);
      const val = new Date(d0.getTime() - d0.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const m = HQ.modal({
        title: 'Schedule post', sub: 'Queued in the HQ scheduler',
        body: '<div class="hq-form-grid">' + ui.field({ label: 'Publish at', full: true, input: '<input type="datetime-local" name="when" value="' + val + '">' }) + '</div>' +
          '<div class="hq-note w">' + HQ.icon('alert') + '<div class="grow">No platform is connected, so this will sit in <b>Scheduled</b> and will not be sent automatically. You can edit or cancel it any time from the Scheduler.</div></div>',
        footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-ok>Schedule</button>'
      });
      m.q('[data-ok]').onclick = () => {
        const when = m.q('[name=when]').value;
        if (!when) return HQ.toast('Pick a date and time.', true);
        const ts = new Date(when);
        if (isNaN(ts) || ts.getTime() < Date.now() - 60000) return HQ.toast('Pick a future date/time.', true);
        m.close();
        save('scheduled', { scheduled_at: ts.toISOString() });
      };
    }

    async function openPublish() {
      const rows = await HQ.accountsModel();
      const connected = rows.filter(a => a.status === 'connected');
      if (!connected.length) {
        return HQ.modal({
          title: 'Publishing is not available', sub: 'No connected accounts', size: 'sm',
          body: '<div class="hq-note w">' + HQ.icon('lock') + '<div class="grow"><b>Nothing will be sent.</b> HQ refuses to show a fake "published" state. Connect a platform in Social → Accounts first.</div></div>',
          footer: '<button type="button" class="btn" data-close>Close</button><button type="button" class="btn pri" data-draft>Save as draft instead</button>',
          onMount(api) { api.q('[data-draft]').onclick = () => { api.close(); save('draft'); }; }
        });
      }
      if (!serverPublish) {
        return HQ.modal({
          title: 'Automatic publishing is not armed', sub: 'Backend or adapter missing', size: 'sm',
          body: '<div class="hq-note w">' + HQ.icon('alert') + '<div class="grow">' +
            (HQ.server.online
              ? '<b>' + connected.length + ' account(s) connected.</b> The server is reachable, but either the post table is not in Supabase yet (<code>hq-schema.sql</code> + <code>CLOUD_TABLES: true</code>) or this platform has no adapter. HQ will not mark it published.'
              : '<b>The publish function is not deployed.</b> Add the <code>functions/</code> folder to the repo and the Cloudflare secrets, or use the manual kit — HQ tells the truth either way.') +
            '</div></div>',
          footer: '<button type="button" class="btn" data-close>Close</button>' +
            '<button type="button" class="btn" data-manual>' + HQ.icon('copy') + ' Manual publish kit</button>' +
            '<button type="button" class="btn pri" data-draft>Save as draft</button>',
          onMount(api) {
            api.q('[data-draft]').onclick = () => { api.close(); save('draft'); };
            api.q('[data-manual]').onclick = () => { const cur = readForm(); api.close(); HQ.manualKit(cur, cur.platforms); };
          }
        });
      }
      const ok = await HQ.confirm('Publish to ' + connected.map(a => a.platform.name).join(', ') + ' now?', {
        detail: 'The server function posts through the official API of each platform and stores the URL it gets back. Nothing is reported as published without that confirmation.',
        ok: 'Publish now'
      });
      if (!ok) return;

      const cur = readForm();
      const media = await uploadMedia();
      const row = Object.assign({}, cur, { media, status: 'publishing', media_url: (media[0] && media[0].url) || '', media_type: (media[0] && media[0].type) || '' });
      const rec = editing ? await D.update('posts', editing.id, row) : await D.create('posts', row);
      try {
        const out = await HQ.publishRemote(rec.id);
        const results = out.results || {};
        const urls = {};
        Object.keys(results).forEach(p => { if (results[p] && results[p].ok && results[p].url) urls[p] = results[p].url; });
        const errs = (out.errors || []).map(e => e.platform + ': ' + e.error);
        await D.update('posts', rec.id, {
          status: out.ok ? 'published' : 'failed',
          published_at: out.ok ? new Date().toISOString() : null,
          published_urls: urls, errors: errs
        });
        D.log('post_publish_' + (out.ok ? 'ok' : 'failed'), cur.title || rec.id);
        if (out.ok && !out.partial) HQ.toast('Published and confirmed by the platform.');
        else if (out.ok && out.partial) HQ.toast('Published on some platforms — check History for the failures.', true);
        else HQ.toast('Publish failed: ' + (errs[0] || 'see History'), true);
      } catch (e) {
        await D.update('posts', rec.id, { status: 'failed', errors: [String(e.message || e)] });
        HQ.toast('Publish failed: ' + e.message, true);
      }
      HQ.reload();
    }
  }

  /* -------- platform preview renderer -------- */
  function previewFor(id, d) {
    const p = P.find(x => x.id === id) || P[0];
    const tags = HQ.hashtagsFrom(d.hashtags).slice(0, p.tagMax);
    const media = (d.media || [])[0];
    const mediaHtml = (media
      ? (media.kind === 'video' || /\.(mp4|webm|mov|ogv)$/i.test(media.name || '')
        ? '<video src="' + HQ.esc(media.url) + '" muted playsinline controls></video>'
        : '<img src="' + HQ.esc(media.url) + '" alt="">')
      : HQ.icon('image'));
    const channel = (D.accounts().find(a => a.platform.id === id).record || {});
    const chName = channel.name || 'DevChazers';
    const chUser = channel.username || p.handle;
    const title = d.title || 'Untitled post';
    const body = d.body || 'Your caption will appear here.';
    const url = d.url ? '<div class="url">' + HQ.esc(d.url) + '</div>' : '';

    if (id === 'youtube') {
      return '<div class="pv-card"><div class="pv-yt-thumb">' + (media ? mediaHtml.replace('<img', '<img style="width:100%;height:100%;object-fit:cover"') : HQ.icon('play')) +
        '<span class="dur">Shorts / Video</span></div>' +
        '<div class="pv-b"><div class="ttl">' + HQ.esc(HQ.clamp(title, 100)) + '</div>' +
        '<div class="pv-h" style="padding:2px 0"><div class="pv-av">' + HQ.icon('users') + '</div><div class="n"><b>' + HQ.esc(chName) + '</b><span>' + HQ.esc(chUser) + ' · now</span></div></div>' +
        '<div class="txt">' + HQ.esc(HQ.clamp(body, 260)) + '</div>' + (tags.length ? '<div class="tags">' + HQ.esc(tags.join(' ')) + '</div>' : '') + url + '</div></div>';
    }
    if (id === 'x') {
      return '<div class="pv-x"><div class="row1"><div class="pv-av">' + HQ.icon('users') + '</div>' +
        '<div style="flex:1;min-width:0"><div style="font-size:12.5px"><b>' + HQ.esc(chName) + '</b> <span class="hq-muted">' + HQ.esc(chUser) + ' · now</span></div>' +
        '<div class="txt" style="margin-top:6px;font-size:13px;white-space:pre-wrap">' + HQ.esc(HQ.clamp(body + (tags.length ? ' ' + tags.join(' ') : ''), 280)) + '</div>' +
        (media ? '<div class="media">' + mediaHtml + '</div>' : '') + (d.url ? '<div class="url" style="margin-top:8px">' + HQ.esc(d.url) + '</div>' : '') +
        '<div class="pv-f" style="padding:9px 0 0;border:0">' + ['💬 0', '↻ 0', '♡ 0', '↗'].map(x => '<i>' + x + '</i>').join('') + '</div></div></div></div>';
    }
    if (id === 'instagram') {
      return '<div class="pv-card"><div class="pv-h"><div class="pv-av">' + HQ.icon('users') + '</div><div class="n"><b>' + HQ.esc(chUser) + '</b><span>Instagram</span></div><span class="hq-tiny">···</span></div>' +
        '<div class="pv-media sq">' + mediaHtml + '</div><div class="pv-b"><div class="txt">' + HQ.esc(body) + (tags.length ? '\n\n' + tags.join(' ') : '') + '</div>' + url + '</div>' +
        '<div class="pv-f"><i>♡ Like</i><i>💬 Comment</i><i>↗ Share</i></div></div>';
    }
    if (id === 'tiktok') {
      return '<div class="pv-tiktok">' + (media ? mediaHtml.replace('<video', '<video style="width:100%;height:100%;object-fit:cover"') : '<div style="width:100%;height:100%;display:grid;place-items:center;color:#3d3d5c">' + HQ.icon('play') + '</div>') +
        '<div class="ov"><b>' + HQ.esc(chUser) + '</b>' + HQ.esc(HQ.clamp(body + (tags.length ? ' ' + tags.join(' ') : ''), 150)) + '</div></div>';
    }
    if (id === 'facebook' || id === 'linkedin') {
      return '<div class="pv-card"><div class="pv-h"><div class="pv-av">' + HQ.icon('users') + '</div><div class="n"><b>' + HQ.esc(chName) + '</b><span>' + (id === 'facebook' ? 'Facebook' : 'LinkedIn') + ' · Just now</span></div></div>' +
        '<div class="pv-b"><div class="txt">' + HQ.esc(HQ.clamp(body, 320)) + (tags.length ? '\n' + tags.join(' ') : '') + '</div></div>' +
        '<div class="pv-media">' + mediaHtml + '</div>' + '<div class="pv-b">' + (title ? '<div class="ttl">' + HQ.esc(title) + '</div>' : '') + url + '</div>' +
        '<div class="pv-f"><i>👍 Like</i><i>💬 Comment</i><i>↗ Share</i></div></div>';
    }
    if (id === 'pinterest') {
      return '<div class="pv-pin"><div class="im">' + mediaHtml + '</div><div style="flex:1;min-width:150px"><div class="ttl" style="font-size:13px;margin-bottom:6px">' + HQ.esc(HQ.clamp(title, 100)) + '</div>' +
        '<div class="txt" style="font-size:12px;color:var(--mut)">' + HQ.esc(HQ.clamp(body, 200)) + '</div>' +
        (tags.slice(0, 4).length ? '<div class="tags" style="margin-top:6px">' + HQ.esc(tags.slice(0, 4).join(' ')) + '</div>' : '') + url + '</div></div>';
    }
    if (id === 'reddit') {
      return '<div class="pv-card"><div class="pv-b"><div class="hq-tiny">r/' + HQ.esc((chName || 'DevChazers').replace(/[^A-Za-z0-9]/g, '')) + ' · posted by ' + HQ.esc(chUser) + ' just now</div>' +
        '<div class="ttl">' + HQ.esc(HQ.clamp(title, 300)) + '</div><div class="txt">' + HQ.esc(HQ.clamp(body, 400)) + '</div></div>' +
        (media ? '<div class="pv-media">' + mediaHtml + '</div>' : '') + '<div class="pv-f"><i>▲ Vote</i><i>💬 0 comments</i><i>↗ Share</i></div></div>';
    }
    /* threads */
    return '<div class="pv-x"><div class="row1"><div class="pv-av">' + HQ.icon('users') + '</div><div style="flex:1;min-width:0">' +
      '<div style="font-size:12.5px"><b>' + HQ.esc(chUser) + '</b> <span class="hq-muted">now</span></div>' +
      '<div class="txt" style="margin-top:6px">' + HQ.esc(HQ.clamp(body + (tags.length ? ' ' + tags.join(' ') : ''), 500)) + '</div>' +
      (media ? '<div class="media">' + mediaHtml + '</div>' : '') + '</div></div></div>';
  }

  /* ============================================================ AI SEO STUDIO */
  const SEO_TYPES = [
    { k: 'title', label: 'SEO title', max: 60 },
    { k: 'description', label: 'SEO description', max: 158 },
    { k: 'hashtags', label: 'Hashtags', max: 300 },
    { k: 'keywords', label: 'Keywords', max: 300 },
    { k: 'tags', label: 'Video tags', max: 500 },
    { k: 'caption', label: 'Short caption', max: 150 },
    { k: 'shortsTitle', label: 'YouTube Shorts title', max: 70 },
    { k: 'instagram', label: 'Instagram caption', max: 2200 },
    { k: 'facebook', label: 'Facebook description', max: 500 },
    { k: 'tiktok', label: 'TikTok caption', max: 150 }
  ];

  async function viewSeo(root) {
    const games = await HQ.ensureGames();
    const sets = await D.list('seoSets');
    const cats = ['Gameplay', 'Trailer', 'Update', 'Guide / Tutorial', 'Behind the scenes', 'Launch announcement', 'Community'];
    root.innerHTML = ui.page(
      ui.head({
        title: 'AI SEO Studio',
        sub: 'Feed it a topic, get a full metadata pack. Generation runs locally with transparent templates until an AI endpoint is configured — nothing is presented as model output when it is not.',
        actions: '<span class="hq-chip w">' + HQ.icon('sparkles') + (HQ.cfg.AI_ENDPOINT ? ' AI endpoint configured' : ' Template mode (offline)') + '</span>'
      }) +
      ui.note({
        tone: HQ.cfg.AI_ENDPOINT ? 'g' : 'w', icon: HQ.cfg.AI_ENDPOINT ? 'check' : 'sparkles',
        title: HQ.cfg.AI_ENDPOINT ? 'AI endpoint connected.' : 'No AI service connected.',
        text: HQ.cfg.AI_ENDPOINT
          ? 'Generate posts your inputs to <code>' + HQ.esc(HQ.cfg.AI_ENDPOINT) + '</code>.'
          : 'Generate produces a deterministic draft from your inputs using HQ\'s rule-based templates (clearly labelled). Set <code>HQ_CONFIG.AI_ENDPOINT</code> to switch to real model output later.'
      }) +
      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Brief',
        body: '<form id="seo-form" class="hq-form-grid">' +
          ui.field({ label: 'Main video topic', full: true, req: true, input: '<input name="topic" maxlength="140" placeholder="Multiplayer Golf – Daily Quests update">' }) +
          ui.field({ label: 'Game name', input: '<input name="game" maxlength="80" list="hq-games" placeholder="Multiplayer Golf"><datalist id="hq-games">' + games.map(g => '<option>' + HQ.esc(g.name) + '</option>').join('') + '</datalist>' }) +
          ui.field({ label: 'Content category', input: ui.select('category', cats, 'Gameplay') }) +
          ui.field({ label: 'Target audience', input: '<input name="audience" maxlength="80" placeholder="Mobile golfers, casual players">' }) +
          ui.field({ label: 'Target country', input: '<input name="country" maxlength="60" placeholder="Pakistan">' }) +
          ui.field({ label: 'Target language', input: ui.select('language', D.LANGUAGES.map(l => ({ value: l.code, label: l.name })), 'en') }) +
          ui.field({ label: 'Primary keywords', input: '<input name="keywords" placeholder="golf game, daily quests, low poly golf">' }) +
          ui.field({ label: 'Generate', full: true, input: '<div class="hq-taglist" id="seo-opts">' + SEO_TYPES.map(t => '<button type="button" class="hq-chip a" data-opt="' + t.k + '">' + HQ.esc(t.label) + '</button>').join('') + '</div>' }) +
          '</form>',
        footer: '<button type="button" class="btn pri" data-a="generate">' + HQ.icon('sparkles') + ' Generate draft</button>' +
          '<button type="button" class="btn" data-a="save">' + HQ.icon('bookmark') + ' Save set</button>' +
          '<span class="hq-tiny" style="margin-left:auto">Copy any field, then edit inline.</span>'
      }) +
      ui.card({
        title: 'Generated pack',
        sub: 'Edit anything before it leaves the studio.',
        actions: '<button type="button" class="btn sm" data-a="copy-all">' + HQ.icon('copy') + ' Copy all</button>' +
          '<button type="button" class="btn sm" data-a="to-composer">' + HQ.icon('send') + ' Send to composer</button>',
        body: '<div id="seo-out">' + ui.empty({ icon: 'sparkles', title: 'No pack generated yet', text: 'Fill the brief and press Generate draft. Output appears here with a copy button per field.', cls: 'sm' }) + '</div>'
      }) +
      '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({ title: 'How it works', body: '<div class="hq-list">' +
        '<div class="hq-li"><div class="ic">' + HQ.icon('sparkles') + '</div><div class="bd2"><b>Template mode</b><span>Deterministic rules build title/description/hashtags from your brief. Always labelled as a draft, never as AI output.</span></div></div>' +
        '<div class="hq-li"><div class="ic">' + HQ.icon('globe') + '</div><div class="bd2"><b>Language</b><span>Templates are English. Use Social → Languages for per-language fields and RTL previews.</span></div></div>' +
        '<div class="hq-li"><div class="ic">' + HQ.icon('shield') + '</div><div class="bd2"><b>No auto-publish</b><span>Generated text only moves where you send it.</span></div></div>' +
        '</div>' }) +
      ui.card({
        title: 'Saved packs', sub: sets.length + ' saved', tight: true,
        body: sets.length ? '<div class="hq-list" style="padding:12px">' + sets.slice(0, 12).map(s =>
          '<div class="hq-li" data-set="' + s.id + '"><div class="ic">' + HQ.icon('bookmark') + '</div><div class="bd2"><b>' + HQ.esc(HQ.clamp(s.topic || 'Untitled', 42)) + '</b>' +
          '<span>' + HQ.esc((s.game || '—') + ' · ' + HQ.date(s.created_at)) + '</span></div>' +
          '<div class="hq-inline"><button type="button" class="btn sm" data-load="' + s.id + '">Load</button>' +
          '<button type="button" class="btn sm dng" data-del="' + s.id + '">Del</button></div></div>').join('') + '</div>'
          : ui.empty({ icon: 'bookmark', title: 'No saved packs', text: 'Generate a pack and press Save set to keep it.', cls: 'sm' })
      }) +
      '</div></div>'
    );

    const form = root.querySelector('#seo-form');
    let current = null;
    const optOn = k => { const b = root.querySelector('[data-opt="' + k + '"]'); return b && b.classList.contains('a'); };

    root.querySelector('#seo-opts').addEventListener('click', e => {
      const b = e.target.closest('[data-opt]'); if (b) b.classList.toggle('a');
    });

    root.querySelector('[data-a="generate"]').onclick = async () => {
      const inp = HQ.formData(form);
      if (!inp.topic) return HQ.toast('Add the main video topic first.', true);
      const btn = root.querySelector('[data-a="generate"]');
      btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<span class="hq-spin"></span> Generating…';
      try {
        current = await generatePack(inp, SEO_TYPES.filter(t => optOn(t.k)).map(t => t.k));
        renderPack(root, current, inp);
      } catch (e) { HQ.toast('Generation failed: ' + e.message, true); }
      btn.disabled = false; btn.innerHTML = old;
    };

    root.querySelector('[data-a="save"]').onclick = async () => {
      if (!current) return HQ.toast('Generate a pack first.', true);
      const inp = HQ.formData(form);
      await D.create('seoSets', { topic: inp.topic, game: inp.game, audience: inp.audience, country: inp.country, language: inp.language, keywords: inp.keywords, category: inp.category, outputs: current, engine: HQ.cfg.AI_ENDPOINT ? 'endpoint' : 'template' });
      D.log('seo_pack_saved', inp.topic);
      HQ.toast('Pack saved.'); HQ.reload();
    };

    root.querySelector('[data-a="copy-all"]').onclick = () => {
      if (!current) return HQ.toast('Nothing to copy yet.', true);
      HQ.copy(SEO_TYPES.filter(t => current[t.k]).map(t => t.label + ':\n' + current[t.k]).join('\n\n'), 'Full pack copied');
    };
    root.querySelector('[data-a="to-composer"]').onclick = () => {
      if (!current) return HQ.toast('Generate a pack first.', true);
      HQ.handoff = {
        title: current.title || '', body: current.description || current.caption || '',
        hashtags: (current.hashtags || '').replace(/,/g, ' '), url: '', platforms: ['youtube', 'facebook', 'instagram'], language: HQ.formData(form).language || 'en', media: []
      };
      HQ.toast('Pack loaded into the composer.');
      HQ.go('/social/composer');
    };

    root.addEventListener('click', async e => {
      const cp = e.target.closest('[data-copy-k]');
      if (cp) { const k = cp.dataset.copyK; const ta = root.querySelector('[data-v="' + k + '"]'); HQ.copy(ta ? ta.value : (current || {})[k] || ''); return; }
      const load = e.target.closest('[data-load]');
      if (load) {
        const set = (await D.list('seoSets')).find(s => s.id === load.dataset.load); if (!set) return;
        current = set.outputs || {}; renderPack(root, current, set); HQ.toast('Pack loaded.');
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!await HQ.confirm('Delete this saved pack?', { danger: true, ok: 'Delete' })) return;
        await D.remove('seoSets', del.dataset.del); HQ.reload();
      }
    });
  }

  function renderPack(root, pack, inputs) {
    const box = root.querySelector('#seo-out');
    const shown = SEO_TYPES.filter(t => pack[t.k] !== undefined && pack[t.k] !== '');
    if (!shown.length) { box.innerHTML = ui.empty({ title: 'Nothing selected', text: 'Enable at least one generation option.', cls: 'sm' }); return; }
    box.innerHTML = '<div class="hq-note p" style="margin-bottom:10px">' + HQ.icon('sparkles') + '<div class="grow"><b>' +
      (HQ.cfg.AI_ENDPOINT ? 'Generated by configured AI endpoint.' : 'Template mode draft.') + '</b> ' +
      (HQ.cfg.AI_ENDPOINT ? '' : 'Built from your brief with deterministic rules — review before publishing.') +
      (inputs && inputs.language && inputs.language !== 'en' ? ' Output is English; translate in Social → Languages.' : '') + '</div></div>' +
      shown.map(t => {
        const v = String(pack[t.k]);
        return '<div class="hq-card" style="margin-bottom:10px"><div class="hq-card-h"><div><h3>' + HQ.esc(t.label) + '</h3>' +
          '<div class="hint"><span class="' + (v.length > t.max ? 'hq-taglist' : '') + '" style="' + (v.length > t.max ? 'color:var(--r)' : '') + '">' + v.length + ' / ' + t.max + ' chars</span></div></div>' +
          '<div class="hq-toolbar"><button type="button" class="btn sm" data-copy-k="' + t.k + '">' + HQ.icon('copy') + ' Copy</button></div></div>' +
          '<div class="hq-card-b" style="padding:10px 12px"><textarea class="hq-ta" data-v="' + t.k + '" style="min-height:' + (v.length > 160 ? 110 : 64) + 'px">' + HQ.esc(v) + '</textarea></div></div>';
      }).join('');
  }

  async function generatePack(inp, keys) {
    if (HQ.cfg.AI_ENDPOINT) {
      const res = await fetch(HQ.cfg.AI_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: inp.topic, game: inp.game, audience: inp.audience, country: inp.country, language: inp.language, keywords: inp.keywords, category: inp.category, fields: keys })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      return json;
    }
    const kw = HQ.tagsFrom(inp.keywords);
    const game = inp.game || 'our new game';
    const cat = inp.category || 'Gameplay';
    const aud = inp.audience || 'mobile players';
    const ctry = inp.country ? ' in ' + inp.country : '';
    const tags = uniq([...kw, game, cat, 'DevChazers', 'gameplay', 'mobile game']);
    const hash = uniq([...kw, game, cat, 'DevChazers', 'mobilegame', 'indiegame', 'gamedev'])
      .map(t => '#' + t.replace(/[^A-Za-z0-9]/g, '')).filter(t => t.length > 1);
    const title = HQ.clamp(inp.topic + ' | ' + game + ' ' + cat, 60);
    const out = {};
    out.title = title;
    out.description = HQ.clamp('Watch ' + inp.topic + ' in ' + game + ' — ' + cat.toLowerCase() + ' made for ' + aud + ctry +
      '. ' + (kw.length ? 'Covers ' + kw.slice(0, 4).join(', ') + '. ' : '') + 'Subscribe to DevChazers for more mobile game content.', 158);
    out.hashtags = hash.slice(0, 12).join(' ');
    out.keywords = uniq([...kw, game, cat.toLowerCase(), 'devchazers', 'mobile gameplay']).slice(0, 12).join(', ');
    out.tags = uniq([...tags, 'walkthrough', 'update', 'shorts']).slice(0, 16).join(', ');
    out.caption = HQ.clamp(inp.topic + ' — ' + game + ' ' + cat.toLowerCase() + ' for ' + aud + '.', 150);
    out.shortsTitle = HQ.clamp(inp.topic + ' #Shorts', 70);
    out.instagram = inp.topic + '\n\n' + game + ' · ' + cat + '\nMade for ' + aud + ctry + '.\n\n' + hash.slice(0, 10).join(' ');
    out.facebook = HQ.clamp(inp.topic + ' is here! ' + game + ' brings ' + cat.toLowerCase() + ' to ' + aud + ctry + '. ' +
      (kw.length ? 'Expect ' + kw.slice(0, 3).join(', ') + ' and more. ' : '') + 'Tell us what you think in the comments.', 500);
    out.tiktok = HQ.clamp(inp.topic + ' 🎮 ' + hash.slice(0, 5).join(' '), 150);
    const res = {};
    keys.forEach(k => { if (out[k] !== undefined) res[k] = out[k]; });
    return res;
  }
  const uniq = a => [...new Set(a.filter(Boolean))];

  /* ======================================================= MULTI-LANGUAGE */
  async function viewLanguages(root) {
    const sets = await D.list('translationSets');
    const activeId = root._langSet || (sets[0] && sets[0].id) || null;
    const set = sets.find(s => s.id === activeId) || null;
    const activeLang = root._lang || 'en';
    const lang = D.LANGUAGES.find(l => l.code === activeLang) || D.LANGUAGES[0];

    const coverage = (s) => {
      const items = (s && s.items) || {};
      let filled = 0, total = D.LANGUAGES.length * 3;
      D.LANGUAGES.forEach(l => {
        const it = items[l.code] || {};
        ['title', 'description', 'hashtags'].forEach(f => { if (it[f] && String(it[f]).trim()) filled++; });
      });
      return { filled, total, pct: Math.round((filled / total) * 100) };
    };

    const it = (set && set.items && set.items[activeLang]) || {};

    root.innerHTML = ui.page(
      ui.head({
        title: 'Multi-Language Manager',
        sub: 'Twelve languages, one source of truth. English is the base copy; every other locale gets its own title, description and hashtags with an RTL-aware preview.',
        actions: '<button type="button" class="btn pri" data-a="new-set">' + HQ.icon('plus') + ' New content set</button>'
      }) +
      ui.note({ text: 'Translation is manual on purpose — HQ has no machine-translation key configured, so it never invents a translation. Fields you leave empty stay visibly empty in the coverage meter.' }) +
      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Content sets',
        sub: sets.length + ' set(s)',
        tight: true,
        body: sets.length ? '<div class="hq-tbl-wrap"><table class="hq-tbl rsp"><thead><tr><th>Content</th><th>Base language</th><th>Coverage</th><th class="num">Updated</th><th></th></tr></thead><tbody>' +
          sets.map(s => {
            const c = coverage(s);
            return '<tr><td data-l="Content"><b>' + HQ.esc(HQ.clamp(s.title, 46)) + '</b><div class="hq-tiny">' + HQ.esc(s.key || '') + '</div></td>' +
              '<td data-l="Base">' + HQ.esc((D.LANGUAGES.find(l => l.code === s.base_language) || {}).name || 'English') + '</td>' +
              '<td data-l="Coverage"><div class="hq-inline" style="gap:7px"><span class="hq-progress" style="width:78px"><i style="width:' + c.pct + '%"></i></span><span class="hq-tiny">' + c.pct + '%</span></div></td>' +
              '<td data-l="Updated" class="num">' + HQ.esc(HQ.date(s.updated_at || s.created_at)) + '</td>' +
              '<td class="acts"><button type="button" class="btn sm" data-open="' + s.id + '">Open</button><button type="button" class="btn sm dng" data-del="' + s.id + '">Del</button></td></tr>';
          }).join('') + '</tbody></table></div>'
          : ui.empty({ icon: 'lang', title: 'No content set yet', text: 'Create a set (for example a new game launch) and add localized copy for each language.', cls: 'sm' })
      }) +
      (set ? ui.card({
        title: 'Localized content — ' + lang.name + (lang.rtl ? ' (RTL)' : ''),
        sub: 'Editing: ' + (set.title || 'Untitled'),
        actions: '<select id="lang-pick" class="hq-mini" aria-label="Language">' +
          D.LANGUAGES.map(l => '<option value="' + l.code + '"' + (l.code === activeLang ? ' selected' : '') + '>' + l.name + ' — ' + l.native + (l.rtl ? ' (RTL)' : '') + '</option>').join('') + '</select>',
        body: '<form id="lang-form" class="hq-form-grid" dir="' + (lang.rtl ? 'rtl' : 'ltr') + '">' +
          ui.field({ label: 'Title (' + lang.name + ')', full: true, input: '<input name="title" value="' + HQ.esc(it.title || '') + '" maxlength="160" placeholder="Localized title">' }) +
          ui.field({ label: 'Description', full: true, input: '<textarea name="description" class="hq-ta" maxlength="1200" placeholder="Localized description">' + HQ.esc(it.description || '') + '</textarea>' }) +
          ui.field({ label: 'Hashtags', full: true, input: '<input name="hashtags" value="' + HQ.esc(it.hashtags || '') + '" placeholder="#local #hashtags">' }) +
          '</form>' +
          '<div class="hq-toolbar" style="margin-top:10px"><button type="button" class="btn pri" data-a="save-lang">' + HQ.icon('check') + ' Save ' + lang.name + '</button>' +
          '<button type="button" class="btn" data-a="copy-en">' + HQ.icon('copy') + ' Copy from ' + (D.LANGUAGES.find(l => l.code === (set.base_language || 'en')) || {}).name + '</button>' +
          '<button type="button" class="btn dng" data-a="clear-lang">' + HQ.icon('trash') + ' Clear fields</button></div>'
      }) : '') +
      '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({
        title: 'Translation preview',
        sub: 'Feed preview for the selected language',
        body: '<div class="hq-preview-stage hq-solid"><div class="pv-card" dir="' + (lang.rtl ? 'rtl' : 'ltr') + '">' +
          '<div class="pv-h"><div class="pv-av">' + HQ.icon('users') + '</div><div class="n"><b>DevChazers</b><span>' + D.flag(lang.code) + ' ' + lang.name + ' · now</span></div></div>' +
          '<div class="pv-b"><div class="ttl">' + HQ.esc(it.title || '— ' + (lang.rtl ? 'عنوان' : 'title') + ' —') + '</div>' +
          '<div class="txt">' + HQ.esc(it.description || '—') + '</div>' +
          '<div class="tags">' + HQ.esc(it.hashtags || '') + '</div></div></div></div>' +
          '<div class="hq-tiny" style="margin-top:8px">' + (lang.rtl ? 'RTL direction applied automatically for ' + lang.name + '.' : 'LTR direction.') + '</div>'
      }) +
      ui.card({
        title: 'Coverage',
        sub: 'Fields filled across all 12 languages',
        tight: true,
        body: sets.length ? '<div style="padding:12px">' + D.LANGUAGES.map(l => {
          const c = coverage(set); const i2 = (set.items || {})[l.code] || {};
          const f = ['title', 'description', 'hashtags'].filter(k => i2[k] && String(i2[k]).trim()).length;
          return '<div class="hq-bar-row" style="margin-bottom:7px"><span class="nm">' + D.flag(l.code) + ' ' + HQ.esc(l.name) + (l.rtl ? ' <span class="hq-tiny">RTL</span>' : '') + '</span>' +
            '<span class="hq-bar-track"><i class="hq-bar-fill" style="width:' + (f / 3 * 100) + '%"></i></span><span class="v">' + f + '/3</span></div>';
        }).join('') + '</div>' : ui.empty({ icon: 'lang', title: 'No set selected', cls: 'sm' })
      }) +
      '</div></div>'
    );

    root.querySelector('[data-a="new-set"]').onclick = () => {
      const m = HQ.modal({
        title: 'New content set', sub: 'One set = one piece of content to localize',
        body: '<div class="hq-form-grid">' +
          ui.field({ label: 'Content title', full: true, req: true, input: '<input name="title" maxlength="120" placeholder="Multiplayer Golf – Daily Quests update">' }) +
          ui.field({ label: 'Reference key', full: true, input: '<input name="key" maxlength="80" placeholder="multiplayer-golf-daily-quests">', hint: 'Optional: game slug or campaign id.' }) +
          ui.field({ label: 'Base language', input: ui.select('base_language', D.LANGUAGES.map(l => ({ value: l.code, label: l.name })), 'en') }) +
          '</div>',
        footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-ok>Create set</button>',
        onMount(api) {
          api.q('[data-ok]').onclick = async () => {
            const v = HQ.formData(api.q('.hq-form-grid'));
            if (!v.title) return HQ.toast('Title required', true);
            const rec = await D.create('translationSets', { title: v.title, key: v.key, base_language: v.base_language, items: {} });
            root._langSet = rec.id; m.close(); HQ.reload();
          };
        }
      });
    };

    if (!set) return;

    root.querySelector('#lang-pick').onchange = e => { root._lang = e.target.value; root._reload(); };
    const f = root.querySelector('#lang-form');
    root.querySelector('[data-a="save-lang"]').onclick = async () => {
      const v = HQ.formData(f);
      const series = await D.list('translationSets');
      const cur = series.find(s => s.id === set.id);
      cur.items = cur.items || {};
      cur.items[activeLang] = { title: v.title, description: v.description, hashtags: v.hashtags };
      await D.update('translationSets', set.id, { items: cur.items });
      D.log('language_saved', lang.name);
      HQ.toast(lang.name + ' content saved.'); root._reload();
    };
    root.querySelector('[data-a="copy-en"]').onclick = () => {
      const base = (set.items || {})[set.base_language || 'en'] || {};
      if (!base.title && !base.description) return HQ.toast('Base language is still empty.', true);
      f.querySelector('[name=title]').value = base.title || '';
      f.querySelector('[name=description]').value = base.description || '';
      f.querySelector('[name=hashtags]').value = base.hashtags || '';
      HQ.toast('Copied base copy — translate it before saving.');
    };
    root.querySelector('[data-a="clear-lang"]').onclick = () => {
      ['title', 'description', 'hashtags'].forEach(k => { f.querySelector('[name=' + k + ']').value = ''; });
    };
    HQ.on(root, 'click', '[data-open]', async (e, b) => { root._langSet = b.dataset.open; HQ.reload(); });
    HQ.on(root, 'click', '[data-del]', async (e, b) => {
      if (!await HQ.confirm('Delete this content set and all its translations?', { danger: true, ok: 'Delete' })) return;
      await D.remove('translationSets', b.dataset.del);
      if (root._langSet === b.dataset.del) root._langSet = null;
      HQ.reload();
    });
  }

  HQ.views = HQ.views || {};
  HQ.views['/social/accounts'] = viewAccounts;
  HQ.views['/social/composer'] = viewComposer;
  HQ.views['/social/seo'] = viewSeo;
  HQ.views['/social/languages'] = viewLanguages;
  HQ.previewFor = previewFor;
})();
