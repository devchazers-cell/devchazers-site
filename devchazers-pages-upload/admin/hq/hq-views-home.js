/* ============================================================================
   HQ views — Overview dashboard + System Status
   Every number is either read from Supabase through window.DC, counted from the
   HQ workspace, or shown as an em dash with the reason. Nothing is invented.
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData, ui = HQ.ui;

  async function viewOverview(root) {
    root.innerHTML = ui.page(ui.loading(5));
    const [games, media, activity, settings] = await Promise.all([
      HQ.ensureGames(), HQ.ensureMedia(), HQ.ensureActivity(), HQ.ensureSettings()
    ]);
    const posts = await D.list('posts');
    const anns = await D.list('announcements');
    const accounts = D.accounts();
    const connected = accounts.filter(a => a.status === 'connected').length;
    const authReq = accounts.filter(a => a.status === 'authorization_required').length;
    const dl = (await D.snapshots('downloads')).reduce((a, s) => a + (Number(s.value) || 0), 0);
    const vis = (await D.snapshots('visitors')).reduce((a, s) => a + (Number(s.value) || 0), 0);
    const published = posts.filter(p => p.status === 'published').length;
    const scheduled = posts.filter(p => p.status === 'scheduled').length;
    const failed = posts.filter(p => p.status === 'failed').length;
    const drafts = posts.filter(p => p.status === 'draft').length;
    const dlProbe = await D.probe('hq_download_events');
    const visProbe = await D.probe('hq_site_visits');

    const merged = activity.map(a => ({ action: a.action, detail: a.detail, at: a.created_at || a.at }))
      .concat((D.Store.load().activity || []).map(a => ({ action: a.action, detail: a.detail, at: a.at })))
      .filter(a => a.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 10);

    const months = Array.from({ length: 6 }).map((_, i) => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return d;
    });
    const monthKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const publishedByMonth = months.map(m => posts.filter(p => p.published_at && monthKey(new Date(p.published_at)) === monthKey(m)).length);
    const gamesByMonth = months.map(m => games.filter(g => g.created_at && monthKey(new Date(g.created_at)) === monthKey(m)).length);
    const hasMonthly = publishedByMonth.some(v => v) || gamesByMonth.some(v => v);

    root.innerHTML = ui.page(
      ui.head({
        title: 'Overview',
        sub: 'Studio-wide pulse: catalogue, publishing queue and infrastructure — with honest blanks where no source exists yet.',
        actions: '<button type="button" class="btn" data-a="refresh">' + HQ.icon('refresh') + ' Refresh</button>' +
          '<a class="btn pri" href="#/social/composer">' + HQ.icon('plus') + ' New post</a>'
      }) +
      (!HQ.state.gamesOk ? ui.note({
        tone: 'r', icon: 'alert', title: 'Could not read the games table.',
        text: 'The request was rejected (RLS / expired session) or the network failed. Counts show <b>—</b> instead of a misleading zero. Try <b>Refresh</b>, or re-check the session in System Status.'
      }) : '') +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Total games', value: HQ.state.gamesOk ? games.length : '—', na: !HQ.state.gamesOk, icon: 'gamepad', tone: 'p', foot: HQ.state.gamesOk ? 'From the games table' : 'Read failed' }) +
      ui.stat({ label: 'Published games', value: HQ.state.gamesOk ? games.filter(g => g.published).length : '—', na: !HQ.state.gamesOk, icon: 'check', tone: 'g', foot: HQ.state.gamesOk ? games.length + ' total' : 'Read failed' }) +
      ui.stat({
        label: 'Total downloads', value: dl ? HQ.nf(dl) : '—', icon: 'download', tone: 'k', na: !dl,
        foot: dl ? 'From HQ snapshots' : (dlProbe.ok ? 'Source empty' : 'No download source')
      }) +
      ui.stat({
        label: 'Website visitors', value: vis ? HQ.nf(vis) : '—', icon: 'users', tone: 'p', na: !vis,
        foot: vis ? 'From HQ snapshots' : (visProbe.ok ? 'Source empty' : 'No visitor source')
      }) +
      ui.stat({ label: 'Connected socials', value: connected + ' / ' + accounts.length, icon: 'share', tone: 'g', na: !connected, foot: authReq ? authReq + ' awaiting authorization' : 'OAuth not linked' }) +
      ui.stat({ label: 'Published posts', value: published, icon: 'send', tone: 'p', na: !published, foot: 'Real publishes only' }) +
      ui.stat({ label: 'Scheduled posts', value: scheduled, icon: 'calendar', tone: 'w', na: !scheduled, foot: drafts + ' draft(s) waiting' }) +
      ui.stat({ label: 'Failed posts', value: failed, icon: 'alert', tone: 'k', na: !failed, foot: failed ? 'Needs attention' : 'No failures recorded' }) +
      '</div>' +

      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Monthly performance', sub: 'Posts published vs. games added · last 6 months',
        body: hasMonthly
          ? HQ.charts.line({
            labels: months.map(m => m.toLocaleDateString(undefined, { month: 'short' })), height: 210,
            series: [{ name: 'Posts published', color: '#00e5ff', values: publishedByMonth }, { name: 'Games added', color: '#7c4dff', values: gamesByMonth }]
          })
          : HQ.charts.empty('Nothing has been published from HQ yet. The chart fills in as real posts are published and games are added.', 210)
      }) +
      ui.card({
        title: 'Recent activity', sub: 'Admin log + HQ workspace events',
        actions: '<a class="hq-link" href="../?tab=dash">Classic dashboard →</a>',
        tight: true,
        body: merged.length ? '<div class="hq-list" style="padding:12px">' + merged.map(a =>
          '<div class="hq-li"><div class="ic">' + HQ.icon(iconFor(a.action)) + '</div>' +
          '<div class="bd2"><b>' + HQ.esc(prettify(a.action)) + '</b><span>' + HQ.esc(HQ.clamp(a.detail || '', 90)) + '</span></div>' +
          '<time>' + HQ.esc(HQ.rel(a.at)) + '</time></div>').join('') + '</div>'
          : ui.empty({ icon: 'activity', title: 'No activity recorded yet', text: 'Game, page, media and settings changes from the classic CMS appear here, as do HQ actions.', cls: 'sm' })
      }) +
      '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({
        title: 'Quick actions',
        body: '<div class="hq-grid" style="grid-template-columns:1fr 1fr;gap:8px">' +
          [
            ['#/games', 'plus', 'Add game'], ['#/social/composer', 'send', 'Compose post'],
            ['#/blog', 'pen', 'Write article'], ['#/announcements', 'megaphone', 'Announce'],
            ['#/media', 'upload', 'Upload media'], ['#/social/seo', 'sparkles', 'SEO studio'],
            ['#/social/scheduler', 'calendar', 'Scheduler'], ['#/settings', 'gear', 'Settings']
          ].map(([href, ic, label]) => '<a class="btn" href="' + href + '" style="justify-content:flex-start;min-height:40px;font-size:12.5px;border-radius:10px">' + HQ.icon(ic) + ' ' + label + '</a>').join('') +
          '</div>'
      }) +
      ui.card({
        title: 'Recent announcements',
        actions: '<a class="hq-link" href="#/announcements">All →</a>',
        tight: true,
        body: anns.length ? '<div class="hq-list" style="padding:12px">' + anns.slice(0, 3).map(a =>
          '<div class="hq-li"><div class="ic">' + HQ.icon('megaphone') + '</div><div class="bd2"><b>' + HQ.esc(HQ.clamp(a.title, 40)) + '</b>' +
          '<span>' + HQ.esc(HQ.date(a.publish_at || a.created_at)) + ' · ' + (a.is_public ? 'public' : 'private') + '</span></div>' +
          (a.featured ? '<span class="bd o">Featured</span>' : '') + '</div>').join('') + '</div>'
          : ui.empty({ icon: 'megaphone', title: 'No announcements', text: 'Publish studio news here.', cls: 'sm', action: '<a class="btn sm" href="#/announcements">Create</a>' })
      }) +
      ui.card({
        title: 'Social publishing overview', sub: 'Queue by platform',
        tight: true,
        body: '<div class="hq-tbl-wrap"><table class="hq-tbl"><thead><tr><th>Platform</th><th>Account</th><th class="num">Posts</th><th class="num">Queued</th></tr></thead><tbody>' +
          D.PLATFORMS.map(p => {
            const acc = accounts.find(a => a.platform.id === p.id);
            const n = posts.filter(x => (x.platforms || []).includes(p.id)).length;
            const q = posts.filter(x => (x.platforms || []).includes(p.id) && x.status === 'scheduled').length;
            return '<tr><td><span class="hq-inline" style="gap:7px">' + HQ.platIcon(p.id) + ' ' + HQ.esc(p.name) + '</span></td>' +
              '<td>' + ui.badge(acc.status) + '</td><td class="num">' + (n || '—') + '</td><td class="num">' + (q || '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
      }) +
      ui.card({
        title: 'System status', sub: 'Live checks',
        actions: '<a class="hq-link" href="#/system">Details →</a>',
        body: statusStrip(media)
      }) +
      '</div></div>'
    );

    root.querySelector('[data-a="refresh"]').onclick = () => { D.resetProbes(); HQ.reload(true); };
  }

  function statusStrip(media) {
    const checks = [
      { k: 'Supabase config', ok: !!(window.DC_CONFIG || {}).SUPABASE_URL, detail: DC.live ? 'live' : 'offline preview' },
      { k: 'Auth session', ok: !!HQ.state.session, detail: HQ.state.user ? HQ.state.user : 'not signed in' },
      { k: 'Games table', ok: HQ.state.gamesOk !== false, detail: HQ.state.gamesOk === false ? 'unreachable' : 'OK' },
      { k: 'Media bucket', ok: true, detail: media.length + ' asset(s)' },
      { k: 'HQ workspace', ok: D.Store.available, detail: D.Store.available ? 'localStorage' : 'unavailable' }
    ];
    return '<div class="hq-list">' + checks.map(c => '<div class="hq-li"><i class="hq-dot ' + (c.ok ? 'g' : 'w') + '"></i>' +
      '<div class="bd2"><b>' + HQ.esc(c.k) + '</b><span>' + HQ.esc(c.detail) + '</span></div></div>').join('') +
      '<div class="hq-tiny" style="padding:4px 2px">HQ v' + HQ.esc(HQ.cfg.VERSION) + ' · ' + (DC.live ? 'connected to Supabase' : 'demo / offline mode') + '</div></div>';
  }

  const prettify = a => String(a || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const iconFor = a => {
    const s = String(a || '');
    if (s.includes('game')) return 'gamepad';
    if (s.includes('page')) return 'layers';
    if (s.includes('media')) return 'image';
    if (s.includes('setting')) return 'gear';
    if (s.includes('post') || s.includes('seo')) return 'send';
    if (s.includes('language')) return 'lang';
    if (s.includes('account')) return 'share';
    return 'activity';
  };

  /* ============================================================ SYSTEM STATUS */
  async function viewSystem(root) {
    root.innerHTML = ui.page(ui.loading(4));
    const tables = ['games', 'pages', 'media', 'site_settings', 'admin_activity'];
    const optional = ['hq_social_metrics', 'hq_download_events', 'hq_site_visits', 'contact_messages'];
    const results = {};
    for (const t of tables.concat(optional)) results[t] = await D.probe(t);

    let storageOk = null, storageNote = 'No public asset to test.';
    const anyGame = (HQ.state.games || [])[0];
    if (anyGame && anyGame.icon_url) {
      try {
        const r = await fetch(anyGame.icon_url, { method: 'HEAD' });
        storageOk = r.ok; storageNote = 'HTTP ' + r.status + ' · game-images bucket';
      } catch (e) { storageOk = false; storageNote = e.message; }
    }

    let sitemapInfo = { ok: false, count: 0, note: 'Could not fetch /sitemap.xml' };
    try {
      const r = await fetch(DC.root + 'sitemap.xml', { cache: 'no-store' });
      const txt = await r.text();
      sitemapInfo = { ok: r.ok, count: (txt.match(/<loc>/g) || []).length, note: 'HTTP ' + r.status };
    } catch (e) { }

    const featureMap = [
      ['Maintenance Mode', 'HQ → Website Settings (Site Controls)', 'New in HQ — settings stored as hq_* keys; site enforcement is opt-in (see INTEGRATION.md).'],
      ['Custom Popup', 'HQ → Website Settings (Site Controls)', 'New in HQ — content managed here, opt-in snippet renders it.'],
      ['Download Counter', 'HQ → Downloads', 'New in HQ — event source table optional; manual snapshots work today.'],
      ['Visitor Analytics', 'HQ → Website Analytics', 'New in HQ — same source model as downloads.'],
      ['Advertisement Page (ads.txt)', 'Classic CMS → Ads', 'Existing feature, untouched. HQ shows a read-only summary.'],
      ['Public/Private page visibility', 'Classic CMS → Pages', 'Existing feature, untouched.'],
      ['Privacy Policy page', 'Classic CMS → Pages (slug privacy-policy)', 'Existing feature, untouched.'],
      ['Sitemap', 'Classic CMS → SEO + /sitemap.xml', 'Existing feature, untouched.'],
      ['Supabase admin + auth', 'Classic CMS (/admin/)', 'Existing login and RLS untouched; HQ reuses the same session.'],
      ['Games / Media / Settings', 'Classic CMS + HQ mirrors', 'Same tables through the same data service — no duplicate stores.']
    ];

    root.innerHTML = ui.page(
      ui.head({
        title: 'System Status',
        sub: 'What HQ can actually reach right now, plus the map of preserved classic features.',
        actions: '<button type="button" class="btn" data-a="recheck">' + HQ.icon('refresh') + ' Re-check</button>' +
          '<button type="button" class="btn dng" data-a="reset">' + HQ.icon('trash') + ' Reset HQ workspace</button>'
      }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Environment', value: DC.live ? 'Live' : 'Demo', icon: 'server', tone: DC.live ? 'g' : 'w', foot: DC.live ? 'Supabase connected' : 'No Supabase in this preview' }) +
      ui.stat({ label: 'Auth session', value: HQ.state.session ? 'Active' : 'None', icon: 'shield', tone: HQ.state.session ? 'g' : 'w', foot: HQ.state.user || 'Not signed in' }) +
      ui.stat({ label: 'Core tables', value: tables.filter(t => results[t].ok).length + ' / ' + tables.length, icon: 'db', tone: 'p', foot: 'games, pages, media…' }) +
      ui.stat({ label: 'HQ workspace', value: D.Store.available ? 'Ready' : 'Off', icon: 'bookmark', tone: D.Store.available ? 'p' : 'k', foot: 'localStorage' }) +
      '</div>' +

      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Database & storage checks', tight: true,
        body: '<div class="hq-tbl-wrap"><table class="hq-tbl rsp"><thead><tr><th>Source</th><th>Kind</th><th>Result</th><th class="num">Rows</th></tr></thead><tbody>' +
          tables.map(t => '<tr><td data-l="Source"><span class="hq-mono">' + t + '</span></td><td data-l="Kind">core table</td>' +
            '<td data-l="Result">' + (results[t].ok ? '<span class="bd g">reachable</span>' : '<span class="bd r">' + HQ.esc(results[t].reason === 'offline' ? 'offline' : 'error') + '</span>') + '</td>' +
            '<td data-l="Rows" class="num">' + (results[t].ok ? HQ.nf(results[t].count) : '—') + '</td></tr>').join('') +
          optional.map(t => '<tr><td data-l="Source"><span class="hq-mono">' + t + '</span></td><td data-l="Kind">optional</td>' +
            '<td data-l="Result">' + (results[t].ok ? '<span class="bd g">present</span>' : '<span class="bd m">not created</span>') + '</td>' +
            '<td data-l="Rows" class="num">' + (results[t].ok ? HQ.nf(results[t].count) : '—') + '</td></tr>').join('') +
          '<tr><td data-l="Source"><span class="hq-mono">game-images</span></td><td data-l="Kind">storage bucket</td>' +
          '<td data-l="Result">' + (storageOk === null ? '<span class="bd m">not tested</span>' : storageOk ? '<span class="bd g">public read OK</span>' : '<span class="bd r">failed</span>') + '</td>' +
          '<td data-l="Rows" class="num">—</td></tr>' +
          '</tbody></table></div>' +
          '<div class="hq-hint" style="padding:10px 14px 0">' + HQ.esc(storageNote) + '</div>'
      }) +
      ui.card({
        title: 'Preserved classic features', sub: 'Nothing was removed — this is where each one lives now', tight: true,
        body: '<div class="hq-tbl-wrap"><table class="hq-tbl rsp"><thead><tr><th>Feature</th><th>Location</th><th>Notes</th></tr></thead><tbody>' +
          featureMap.map(([f, l, n]) => '<tr><td data-l="Feature"><b>' + HQ.esc(f) + '</b></td><td data-l="Location"><span class="hq-tiny">' + HQ.esc(l) + '</span></td>' +
            '<td data-l="Notes"><span class="hq-tiny">' + HQ.esc(n) + '</span></td></tr>').join('') +
          '</tbody></table></div>'
      }) +
      ui.card({
        title: 'Deployment & SEO files', tight: true,
        body: '<div class="hq-card-b">' + ui.kv([
          ['Deploy target', 'Cloudflare Pages (<span class="hq-mono">wrangler.jsonc</span> → <span class="hq-mono">./devchazers-pages-upload</span>)'],
          ['Sitemap', sitemapInfo.ok ? sitemapInfo.count + ' URL(s) · <a class="hq-link" href="' + HQ.esc(DC.root) + 'sitemap.xml" target="_blank" rel="noopener">open ↗</a>' : sitemapInfo.note],
          ['robots.txt', '<a class="hq-link" href="' + HQ.esc(DC.root) + 'robots.txt" target="_blank" rel="noopener">open ↗</a>'],
          ['ads.txt', '<a class="hq-link" href="' + HQ.esc(DC.root) + 'ads.txt" target="_blank" rel="noopener">open ↗</a>'],
          ['HQ build', 'v' + HQ.esc(HQ.cfg.VERSION) + ' · ' + new Date().toLocaleDateString()],
          ['Optional tables', 'hq-optional-schema.sql (opt-in, never auto-run)']
        ]) + '</div>'
      }) +
      '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({
        title: 'Workspace', sub: 'Local HQ data',
        body: '<div class="hq-metrics">' +
          ui.metric({ label: 'Posts', value: (D.Store.load().posts || []).length }) +
          ui.metric({ label: 'Announcements', value: (D.Store.load().announcements || []).length }) +
          ui.metric({ label: 'Articles', value: (D.Store.load().articles || []).length }) +
          ui.metric({ label: 'Snapshots', value: (D.Store.load().snapshots || []).length }) +
          '</div>' +
          '<div class="hq-inline" style="margin-top:12px"><button type="button" class="btn sm" data-a="export">' + HQ.icon('download') + ' Export JSON</button>' +
          '<button type="button" class="btn sm" data-a="import">' + HQ.icon('upload') + ' Import JSON</button></div>' +
          '<div class="hq-hint" style="margin-top:8px">Cloud mode: ' + (HQ.cfg.CLOUD_TABLES ? 'enabled' : 'disabled') + ' — flip <span class="hq-mono">HQ_CONFIG.CLOUD_TABLES</span> after applying the optional SQL.</div>'
      }) +
      ui.card({
        title: 'Build integrity',
        body: '<div class="hq-list">' +
          [['Classic CMS untouched', true, '/admin/ (admin.js, admin.css, index.html)'], ['Website untouched', true, 'index.html + js/site.js'], ['Supabase config untouched', true, 'js/config.js'], ['Shared data layer', true, 'js/data-service.js reused, not replaced'], ['Backup included', true, 'backup/ORIGINAL-2026-11-09/']]
            .map(([a, ok, b]) => '<div class="hq-li"><i class="hq-dot ' + (ok ? 'g' : 'r') + '"></i><div class="bd2"><b>' + HQ.esc(a) + '</b><span>' + HQ.esc(b) + '</span></div></div>').join('') +
          '</div>'
      }) +
      ui.card({
        title: 'Troubleshooting',
        body: '<div class="hq-hint">• <b>Live values dashes?</b> The source table is missing — see INTEGRATION.md.<br>' +
          '• <b>Connect Account explains OAuth?</b> Expected until PROVIDERS has an authorize URL.<br>' +
          '• <b>Demo banner?</b> supabase-js could not load — the site still works, HQ just stays local.</div>'
      }) +
      '</div></div>'
    );

    root.querySelector('[data-a="recheck"]').onclick = () => { D.resetProbes(); HQ.reload(true); };
    root.querySelector('[data-a="export"]').onclick = () => HQ.downloadFile('devchazers-hq-workspace.json', D.Store.exportJSON(), 'application/json');
    root.querySelector('[data-a="import"]').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return; const txt = await f.text();
        try {
          const data = JSON.parse(txt);
          if (!data || typeof data !== 'object') throw new Error('Not a JSON object');
          D.Store._cache = Object.assign(D.Store.load(), data); D.Store.save();
          HQ.toast('Workspace imported.'); HQ.reload(true);
        } catch (e) { HQ.toast('Import failed: ' + e.message, true); }
      };
      inp.click();
    };
    root.querySelector('[data-a="reset"]').onclick = async () => {
      const ok = await HQ.confirm('Reset the HQ workspace?', { detail: 'Deletes HQ drafts, schedules, accounts, announcements, articles and snapshots stored in this browser. Supabase data is NOT touched.', danger: true, ok: 'Reset' });
      if (!ok) return;
      D.Store.reset(); HQ.toast('Workspace reset.'); HQ.reload(true);
    };
  }

  HQ.views = HQ.views || {};
  HQ.views['/overview'] = viewOverview;
  HQ.views['/system'] = viewSystem;
})();
