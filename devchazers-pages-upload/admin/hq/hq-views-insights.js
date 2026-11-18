/* ============================================================================
   HQ views — Downloads, Website Analytics, Advertisement Manager, Settings
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData, ui = HQ.ui;
  const RANGES = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months'], [0, 'All time']];
  const inRange = (d, days) => !days || new Date(d).getTime() >= Date.now() - days * 864e5;

  /* ----------------------------------------------------------- snapshot helper */
  function snapshotCard(kind, games, list, onChange) {
    const label = kind === 'downloads' ? 'download count' : 'visitor count';
    return ui.card({
      title: 'Recorded snapshots', sub: 'Manually logged figures — the only analytics HQ will chart without an API',
      actions: kind === 'downloads'
        ? '<button type="button" class="btn sm pri" data-snap-new>' + HQ.icon('plus') + ' Add snapshot</button>'
        : '<button type="button" class="btn sm pri" data-snap-new>' + HQ.icon('plus') + ' Add snapshot</button>',
      tight: true,
      body: list.length ? '<div class="hq-tbl-wrap"><table class="hq-tbl rsp"><thead><tr><th>Date</th>' + (kind === 'downloads' ? '<th>Game</th>' : '') + '<th class="num">Value</th><th></th></tr></thead><tbody>' +
        list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(s =>
          '<tr><td data-l="Date">' + HQ.esc(HQ.date(s.date)) + '</td>' +
          (kind === 'downloads' ? '<td data-l="Game">' + HQ.esc((games.find(g => g.id === s.game_id) || {}).name || 'All games') + '</td>' : '') +
          '<td data-l="Value" class="num">' + HQ.nf(s.value) + '</td>' +
          '<td class="acts"><button type="button" class="btn sm dng" data-snap-del="' + s.id + '">Delete</button></td></tr>').join('') +
        '</tbody></table></div>'
        : ui.empty({
          icon: 'download', cls: 'sm', title: 'No snapshots recorded',
          text: 'Log the figure you already have (Play Console, Cloudflare) to get honest totals and trends. Nothing is estimated.',
          action: '<button type="button" class="btn sm" data-snap-new>Add the first snapshot</button>'
        })
    });
  }

  function openSnapshotModal(kind, games, done) {
    const m = HQ.modal({
      title: 'Add ' + kind + ' snapshot',
      sub: 'Enter a real number you already have',
      body: '<div class="hq-form-grid">' +
        ui.field({ label: 'Date', input: '<input type="date" name="date" value="' + HQ.isoDay(new Date()) + '">' }) +
        ui.field({ label: 'Value', input: '<input type="number" name="value" min="0" step="1" placeholder="0">' }) +
        (kind === 'downloads' ? ui.field({ label: 'Game', full: true, input: '<select name="game_id"><option value="">All games (total)</option>' + games.map(g => '<option value="' + HQ.esc(g.id) + '">' + HQ.esc(g.name) + '</option>').join('') + '</select>' }) : '') +
        '</div><div class="hq-hint">Cumulative or per-day both work — pick one convention and stay with it. Snapshots with the same date (and game) are replaced.</div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-ok>Save snapshot</button>',
      onMount(api) {
        api.q('[data-ok]').onclick = () => {
          const v = HQ.formData(api.q('.hq-form-grid'));
          if (v.value === '' || isNaN(Number(v.value))) return HQ.toast('Enter a number.', true);
          D.addSnapshot({ kind, date: v.date, value: Number(v.value), game_id: v.game_id || '' });
          D.log(kind + '_snapshot', v.date + ' → ' + v.value);
          HQ.toast('Snapshot saved.'); m.close(); done();
        };
      }
    });
  }

  /* ================================================================ DOWNLOADS */
  async function viewDownloads(root) {
    const days = root._days !== undefined ? root._days : 30;
    const from = root._from || '', to = root._to || '';
    const custom = !!(from || to);
    const games = await HQ.ensureGames();
    const all = await D.snapshots('downloads');
    const list = all.filter(s => custom
      ? (!from || s.date >= from) && (!to || s.date <= to)
      : inRange(s.date, days));
    const sum = arr => arr.reduce((a, s) => a + (Number(s.value) || 0), 0);
    const total = sum(list);
    const dates = [...new Set(list.map(s => s.date))].sort();
    const perDate = dates.map(d => list.filter(s => s.date === d).reduce((a, s) => a + (Number(s.value) || 0), 0));
    const daySpan = days || Math.max(1, dates.length);
    const daily = dates.length ? Math.round(total / Math.max(1, days ? Math.min(days, Math.max(1, Math.floor((Date.now() - new Date(dates[0]).getTime()) / 864e5) + 1)) : dates.length)) : 0;
    const week = sum(list.filter(s => inRange(s.date, 7)));
    const month = sum(list.filter(s => inRange(s.date, 30)));
    const byGame = games.map(g => ({ g, v: sum(list.filter(s => s.game_id === g.id)) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const eventsProbe = await D.probe('hq_download_events');
    const visitsProbe = await D.probe('hq_site_visits');

    root.innerHTML = ui.page(
      ui.head({
        title: 'Downloads',
        sub: 'Download performance per game. The public site has no click-tracking yet, so HQ reports logged snapshots and clearly marks everything else as unconnected.',
        actions: '<button type="button" class="btn" data-a="export">' + HQ.icon('download') + ' Export CSV</button>' +
          '<button type="button" class="btn pri" data-a="add">' + HQ.icon('plus') + ' Add snapshot</button>'
      }) +
      '<div class="hq-toolbar">' +
      '<select id="dl-range">' + RANGES.map(([v, l]) => '<option value="' + v + '"' + (!custom && days === v ? ' selected' : '') + '>' + l + '</option>').join('') +
      '<option value="custom"' + (custom ? ' selected' : '') + '>Custom range…</option></select>' +
      '<input type="date" id="dl-from" value="' + HQ.esc(from) + '" aria-label="From date"><span class="hq-tiny">→</span>' +
      '<input type="date" id="dl-to" value="' + HQ.esc(to) + '" aria-label="To date">' +
      (custom ? '<button type="button" class="btn sm" data-a="clear-range">' + HQ.icon('x') + ' Clear</button>' : '') +
      '<span class="hq-tiny">' + list.length + ' snapshot day(s) in range</span>' +
      '</div>' +
      (eventsProbe.ok
        ? ui.note({ tone: 'g', icon: 'check', title: 'Event source connected.', text: '<code>hq_download_events</code> has ' + HQ.nf(eventsProbe.count) + ' row(s). Event-level charts activate automatically once that table is populated.' })
        : ui.note({
          tone: 'w', icon: 'info', title: 'No automatic download tracking.',
          text: 'The website currently links straight to Google Drive, so clicks are not recorded anywhere. Snapshots below are real figures you enter; the optional <code>hq_download_events</code> table + <code>site-controls.js</code> snippet switches on automatic counting.'
        })) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Total downloads', value: total ? HQ.nf(total) : '—', icon: 'download', tone: 'p', na: !total, foot: days ? 'Selected range' : 'All time' }) +
      ui.stat({ label: 'Daily average', value: daily || '—', icon: 'activity', tone: 'g', na: !daily, foot: 'Per day in range' }) +
      ui.stat({ label: 'This week', value: week || '—', icon: 'calendar', tone: 'w', na: !week, foot: 'Last 7 days' }) +
      ui.stat({ label: 'This month', value: month || '—', icon: 'calendar', tone: 'k', na: !month, foot: 'Last 30 days' }) +
      '</div>' +
      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Downloads over time', sub: dates.length ? dates.length + ' snapshot day(s)' : 'No data',
        body: dates.length ? HQ.charts.line({ labels: dates.map(d => d.slice(5)), series: [{ name: 'Downloads', color: '#00e5ff', values: perDate }], height: 220 })
          : HQ.charts.empty('Add a snapshot (Play Console totals) to draw this line.', 220)
      }) +
      ui.card({
        title: 'Most popular games', sub: 'By recorded downloads',
        tight: true,
        body: games.length ? ui.table({
          cls: 'rsp',
          cols: [
            { t: 'Game', cell: g => '<div class="hq-cell">' + (g.icon_url ? '<img src="' + HQ.esc(DC.img(g.icon_url)) + '" alt="">' : '<span class="ph">' + HQ.esc((g.name || '?')[0]) + '</span>') +
              '<div class="tx"><b>' + HQ.esc(g.name) + '</b><span>' + HQ.esc(g.category || '') + ' · v' + HQ.esc(g.version || '') + '</span></div></div>' },
            { t: 'Downloads', cls: 'num', cell: g => { const v = sum(list.filter(s => s.game_id === g.id)); return v ? HQ.nf(v) : '<span class="hq-muted">—</span>'; } },
            { t: 'Share', cell: g => { const v = sum(list.filter(s => s.game_id === g.id)); const pct = total ? Math.round(v / total * 100) : 0; return '<span class="hq-bar-track" style="display:block;width:110px"><i class="hq-bar-fill" style="width:' + pct + '%"></i></span>'; } },
            { t: '', cls: 'acts', cell: g => '<button type="button" class="btn sm" data-snap-game="' + HQ.esc(g.id) + '">Log</button>' }
          ],
          rows: games
        }) : ui.empty({ icon: 'gamepad', title: 'No games yet', text: 'Add a game first, then log download snapshots per title.', cls: 'sm' })
      }) +
      snapshotCard('downloads', games, all, () => root._reload()) +
      '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({
        title: 'Country-wise visitors', sub: 'Requires a visitor source',
        body: visitsProbe.ok
          ? await countryPanel()
          : HQ.charts.empty('No geo data. hq_site_visits is not available in this project yet.', 150)
      }) +
      ui.card({
        title: 'Traffic sources', sub: 'Direct · Search · Social · Referral',
        body: visitsProbe.ok ? await sourcePanel() : HQ.charts.empty('No traffic-source data yet.', 150)
      }) +
      ui.card({
        title: 'Device statistics', sub: 'Mobile · Desktop · Tablet',
        body: visitsProbe.ok ? await devicePanel() : HQ.charts.empty('No device data yet.', 150)
      }) +
      '</div></div>'
    );

    root.querySelector('#dl-range').onchange = e => {
      if (e.target.value === 'custom') { root._custom = true; root._reload(); return; }
      root._custom = false; root._from = ''; root._to = ''; root._days = +e.target.value; root._reload();
    };
    root.querySelector('#dl-from').onchange = e => { root._from = e.target.value; root._custom = true; root._reload(); };
    root.querySelector('#dl-to').onchange = e => { root._to = e.target.value; root._custom = true; root._reload(); };
    const cr = root.querySelector('[data-a="clear-range"]');
    if (cr) cr.onclick = () => { root._from = ''; root._to = ''; root._custom = false; root._reload(); };
    root.querySelector('[data-a="add"]').onclick = () => openSnapshotModal('downloads', games, () => root._reload());
    HQ.on(root, 'click', '[data-snap-new]', () => openSnapshotModal('downloads', games, () => root._reload()));
    HQ.on(root, 'click', '[data-snap-del]', async (e, b) => {
      if (!await HQ.confirm('Delete this snapshot?', { danger: true, ok: 'Delete' })) return;
      D.removeSnapshot(b.dataset.snapDel); root._reload();
    });
    HQ.on(root, 'click', '[data-snap-game]', (e, b) => {
      const m = HQ.modal({
        title: 'Log downloads', size: 'sm',
        body: '<div class="hq-form-grid">' + ui.field({ label: 'Date', full: true, input: '<input type="date" name="date" value="' + HQ.isoDay(new Date()) + '">' }) +
          ui.field({ label: 'Downloads', full: true, input: '<input type="number" name="value" min="0">' }) + '</div>',
        footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-ok>Save</button>',
        onMount(api) {
          api.q('[data-ok]').onclick = () => {
            const v = HQ.formData(api.q('.hq-form-grid'));
            if (!v.value) return HQ.toast('Enter a number.', true);
            D.addSnapshot({ kind: 'downloads', date: v.date, value: Number(v.value), game_id: b.dataset.snapGame });
            m.close(); HQ.toast('Saved.'); root._reload();
          };
        }
      });
    });
    root.querySelector('[data-a="export"]').onclick = () => {
      const rows = [['date', 'game', 'value']].concat(list.map(s => [s.date, (games.find(g => g.id === s.game_id) || {}).name || 'All', s.value]));
      HQ.downloadFile('devchazers-downloads.csv', HQ.csv(rows), 'text/csv');
    };
  }

  async function visitsRows() {
    const p = await D.probe('hq_site_visits');
    if (!p.ok) return [];
    const c = D.client();
    const res = await c.from('hq_site_visits').select('*').limit(5000);
    return res.error ? [] : (res.data || []);
  }
  const tally = (rows, key) => {
    const m = {};
    rows.forEach(r => { const k = r[key] || 'Unknown'; m[k] = (m[k] || 0) + (Number(r.visits) || Number(r.visitors) || 1); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  };
  async function countryPanel() {
    const rows = await visitsRows();
    return rows.length ? HQ.charts.hbars(tally(rows, 'country'), { color: '#00e5ff' }) : HQ.charts.empty('Table exists but has no rows yet.', 150);
  }
  async function sourcePanel() {
    const rows = await visitsRows();
    return rows.length ? HQ.charts.hbars(tally(rows, 'source'), { color: '#7c4dff' }) : HQ.charts.empty('Table exists but has no rows yet.', 150);
  }
  async function devicePanel() {
    const rows = await visitsRows();
    return rows.length ? HQ.charts.donut({
      items: tally(rows, 'device').map((x, i) => Object.assign(x, { color: ['#00e5ff', '#7c4dff', '#ff3d81', '#3ddc97'][i % 4] })), size: 150
    }) : HQ.charts.empty('Table exists but has no rows yet.', 150);
  }

  /* ========================================================= WEBSITE ANALYTICS */
  async function viewWebAnalytics(root) {
    const days = root._days !== undefined ? root._days : 30;
    const from = root._from || '', to = root._to || '';
    const custom = !!(from || to);
    const all = await D.snapshots('visitors');
    const list = all.filter(s => custom ? (!from || s.date >= from) && (!to || s.date <= to) : inRange(s.date, days));
    const sum = arr => arr.reduce((a, s) => a + (Number(s.value) || 0), 0);
    const total = sum(list);
    const today = sum(all.filter(s => s.date === HQ.isoDay(new Date())));
    const week = sum(all.filter(s => inRange(s.date, 7)));
    const month = sum(all.filter(s => inRange(s.date, 30)));
    const dates = [...new Set(list.map(s => s.date))].sort();
    const perDate = dates.map(d => list.filter(s => s.date === d).reduce((a, s) => a + (Number(s.value) || 0), 0));
    const growth = perDate.length > 1 ? Math.round(((perDate[perDate.length - 1] - perDate[0]) / Math.max(1, perDate[0])) * 100) : null;
    const probe = await D.probe('hq_site_visits');

    root.innerHTML = ui.page(
      ui.head({
        title: 'Website Analytics',
        sub: 'Traffic, geography and devices. No tracker is installed on the site today, so HQ shows a real empty state instead of a pretty lie.',
        actions: '<button type="button" class="btn" data-a="export">' + HQ.icon('download') + ' Export</button>' +
          '<button type="button" class="btn pri" data-a="add">' + HQ.icon('plus') + ' Add snapshot</button>'
      }) +
      '<div class="hq-toolbar"><select id="va-range">' + RANGES.map(([v, l]) => '<option value="' + v + '"' + (!custom && days === v ? ' selected' : '') + '>' + l + '</option>').join('') +
      '<option value="custom"' + (custom ? ' selected' : '') + '>Custom range…</option></select>' +
      '<input type="date" id="va-from" value="' + HQ.esc(from) + '" aria-label="From date"><span class="hq-tiny">→</span><input type="date" id="va-to" value="' + HQ.esc(to) + '" aria-label="To date">' +
      '<span class="hq-tiny">' + (probe.ok ? 'hq_site_visits reachable' : 'hq_site_visits not created') + '</span></div>' +
      ui.sourceState(probe, 'Visitor rows from <code>hq_site_visits</code>.') +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Total visitors', value: total ? HQ.nf(total) : '—', icon: 'users', tone: 'p', na: !total, foot: days ? 'Range' : 'All time' }) +
      ui.stat({ label: 'Today', value: today || '—', icon: 'clock', tone: 'g', na: !today }) +
      ui.stat({ label: 'Last 7 days', value: week || '—', icon: 'calendar', tone: 'w', na: !week }) +
      ui.stat({ label: 'Last 30 days', value: month || '—', icon: 'calendar', tone: 'k', na: !month }) +
      '</div>' +
      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Visitor growth', sub: growth === null ? 'No trend yet' : (growth >= 0 ? '+' : '') + growth + '% across range',
        body: perDate.length ? HQ.charts.line({ labels: dates.map(d => d.slice(5)), series: [{ name: 'Visitors', color: '#7c4dff', values: perDate }], height: 220 })
          : HQ.charts.empty('Log visitor snapshots (Cloudflare or GA totals) to plot growth.', 220)
      }) +
      '<div class="hq-grid hq-3" style="gap:14px">' +
      ui.card({ title: 'Country-wise visitors', body: probe.ok ? await countryPanel() : HQ.charts.empty('Geo breakdown needs a visitor source.', 140) }) +
      ui.card({ title: 'Traffic sources', body: probe.ok ? await sourcePanel() : HQ.charts.empty('Channel breakdown needs a visitor source.', 140) }) +
      ui.card({ title: 'Device statistics', body: probe.ok ? await devicePanel() : HQ.charts.empty('Device split needs a visitor source.', 140) }) +
      '</div>' +
      snapshotCard('visitors', [], all, () => root._reload()) +
      '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({
        title: 'How to get real tracking',
        body: '<div class="hq-list">' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('globe') + '</div><div class="bd2"><b>Cloudflare Web Analytics</b><span>Zero-cookie, free on Pages. Add the beacon to <code>index.html</code> and read totals from the dashboard.</span></div></div>' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('chart') + '</div><div class="bd2"><b>Google Analytics 4</b><span>Store the measurement id in HQ Site Controls, then add the gtag snippet once.</span></div></div>' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('db') + '</div><div class="bd2"><b>First-party counter</b><span>Create <code>hq_site_visits</code> and POST one row per pageview from a tiny edge function.</span></div></div>' +
          '</div>'
      }) +
      ui.card({
        title: 'Filters',
        body: '<div class="hq-hint">The date range above filters the snapshot series. Country / source / device filters turn on automatically once <code>hq_site_visits</code> has matching columns.</div>' +
          '<div class="hq-kv" style="margin-top:10px"><dt>Active range</dt><dd>' +
          (custom ? HQ.esc((from || 'start') + ' → ' + (to || 'today')) : HQ.esc((RANGES.find(r => r[0] === days) || [0, 'Last 30 days'])[1])) + '</dd>' +
          '<dt>Snapshot days</dt><dd>' + list.length + '</dd><dt>Visitor source</dt><dd>' + (probe.ok ? 'connected' : 'not connected') + '</dd></div>'
      }) +
      ui.card({ title: 'Tracked pages', body: HQ.charts.empty('Page-level reporting needs per-visit rows.', 130) }) +
      '</div></div>'
    );

    root.querySelector('#va-range').onchange = e => {
      if (e.target.value === 'custom') { root._reload(); return; }
      root._from = ''; root._to = ''; root._days = +e.target.value; root._reload();
    };
    root.querySelector('#va-from').onchange = e => { root._from = e.target.value; root._reload(); };
    root.querySelector('#va-to').onchange = e => { root._to = e.target.value; root._reload(); };
    root.querySelector('[data-a="add"]').onclick = () => openSnapshotModal('visitors', [], () => root._reload());
    HQ.on(root, 'click', '[data-snap-new]', () => openSnapshotModal('visitors', [], () => root._reload()));
    HQ.on(root, 'click', '[data-snap-del]', async (e, b) => {
      if (!await HQ.confirm('Delete this snapshot?', { danger: true, ok: 'Delete' })) return;
      D.removeSnapshot(b.dataset.snapDel); root._reload();
    });
    root.querySelector('[data-a="export"]').onclick = () => {
      const rows = [['date', 'visitors']].concat(list.map(s => [s.date, s.value]));
      HQ.downloadFile('devchazers-visitors.csv', HQ.csv(rows), 'text/csv');
    };
  }

  /* ======================================================= ADVERTISEMENT MANAGER */
  async function viewAds(root) {
    const s = await HQ.ensureSettings();
    const adsTxt = s.ads_txt || '';
    const lines = adsTxt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const pub = s.admob_publisher_id || '';
    const pages = await DC.listPages(true).catch(() => []);
    const adPages = pages.filter(p => /advert/i.test(p.slug) || /advert/i.test(p.title || ''));
    const revProbe = await D.probe('hq_ad_revenue');

    root.innerHTML = ui.page(
      ui.head({
        title: 'Advertisement Manager',
        sub: 'A management view over the ads settings that already exist. Saving still happens in Classic CMS → Ads so there is exactly one source of truth.',
        actions: '<a class="btn pri" href="../?tab=ads">' + HQ.icon('edit') + ' Edit ads settings</a>'
      }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'ads.txt rules', value: lines.length, icon: 'tag', tone: 'p', na: !lines.length, foot: lines.length ? 'Configured' : 'Empty file' }) +
      ui.stat({ label: 'Publisher ID', value: pub || '—', icon: 'shield', tone: 'g', na: !pub, foot: pub ? 'AdMob' : 'Not set' }) +
      ui.stat({ label: 'Ad info pages', value: adPages.length, icon: 'layers', tone: 'w', na: !adPages.length, foot: 'CMS pages' }) +
      ui.stat({ label: 'Revenue data', value: revProbe.ok ? 'Ready' : '—', icon: 'chart', tone: 'k', na: !revProbe.ok, foot: revProbe.ok ? 'Source present' : 'No ad revenue source' }) +
      '</div>' +
      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'ads.txt', sub: 'Served from the site root',
        actions: '<button type="button" class="btn sm" data-a="copy">' + HQ.icon('copy') + ' Copy</button>' +
          '<button type="button" class="btn sm" data-a="download">' + HQ.icon('download') + ' Download</button>' +
          '<a class="btn sm" href="' + HQ.esc(DC.root) + 'ads.txt" target="_blank" rel="noopener">Open ↗</a>',
        body: lines.length
          ? '<div class="status-box" style="background:#0d0d1a;border:1px solid var(--bd);border-radius:12px;padding:12px;font-size:12px;white-space:pre-wrap;font-family:ui-monospace,monospace">' + HQ.esc(adsTxt) + '</div>'
          : ui.empty({ icon: 'tag', title: 'ads.txt is empty', text: 'Paste your AdMob/network lines in Classic CMS → Ads, save, then download and redeploy the file.', cls: 'sm', action: '<a class="btn sm" href="../?tab=ads">Open Ads settings</a>' })
      }) +
      ui.card({
        title: 'Advertising information page', sub: 'Human-readable page for visitors',
        tight: true,
        body: adPages.length ? '<div class="hq-list" style="padding:12px">' + adPages.map(p =>
          '<div class="hq-li"><div class="ic">' + HQ.icon('layers') + '</div><div class="bd2"><b>' + HQ.esc(p.title) + '</b><span>/' + HQ.esc(p.slug) + ' · ' + HQ.esc(p.status || '') + '</span></div>' +
          '<a class="btn sm" href="' + HQ.esc(DC.root + p.slug) + '" target="_blank" rel="noopener">View ↗</a></div>').join('') + '</div>'
          : ui.empty({
            icon: 'layers', cls: 'sm', title: 'No advertising page yet',
            text: 'Create a CMS page explaining ads and data use — required by several ad networks.',
            action: '<button type="button" class="btn sm pri" data-a="mkpage">Create advertising page</button>'
          })
      }) +
      ui.card({
        title: 'Ad revenue', sub: 'Not connected',
        body: revProbe.ok ? HQ.charts.empty('Revenue table found but empty.', 140) : ui.note({
          tone: 'w', icon: 'chart',
          text: '<b>No revenue API connected.</b> AdMob reporting needs a server-side key (never in the browser). HQ shows no estimated earnings.'
        })
      }) +
      '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({
        title: 'Existing behaviour', sub: 'Preserved from the classic CMS',
        body: '<div class="hq-list">' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('check') + '</div><div class="bd2"><b>Auto-download on save</b><span>Classic CMS downloads a fresh ads.txt when you save.</span></div></div>' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('info') + '</div><div class="bd2"><b>Redeploy needed</b><span>Direct Upload does not run Functions — upload ads.txt to the project root.</span></div></div>' +
          '</div>'
      }) +
      ui.card({
        title: 'Publisher details',
        body: ui.kv([['AdMob publisher', pub ? '<span class="hq-mono">' + HQ.esc(pub) + '</span>' : null, !pub], ['ads.txt lines', lines.length || null, !lines.length]])
      }) +
      '</div></div>'
    );

    root.querySelector('[data-a="copy"]').onclick = () => HQ.copy(adsTxt, 'ads.txt copied');
    root.querySelector('[data-a="download"]').onclick = () => HQ.downloadFile('ads.txt', adsTxt || '', 'text/plain');
    const mk = root.querySelector('[data-a="mkpage"]');
    if (mk) mk.onclick = () => HQ.publishAsPage({
      kind: 'advertising page', title: 'Advertising', slug: 'advertising',
      body: '<p>DevChazers games are free to play and supported by advertising. We work with Google AdMob to show ads inside our games.</p><p>Ads may use advertising identifiers and cookies to personalise content. You can reset your advertising ID or opt out of personalised ads in your device settings.</p><p>We do not sell personal data. For questions about advertising on our properties, contact our team through the contact page.</p>',
      seo_title: 'Advertising – DevChazers', seo_description: 'How advertising works in DevChazers games and which partners we use.'
    });
  }

  /* =============================================================== SETTINGS */
  const HQ_CONTROLS = [
    { k: 'maintenance_mode', label: 'Maintenance mode', type: 'select', options: [['false', 'Off'], ['true', 'On']], help: 'Shows a maintenance screen when the site-side snippet is installed.' },
    { k: 'maintenance_message', label: 'Maintenance message', type: 'text', help: 'Shown to visitors while maintenance mode is on.' },
    { k: 'popup_enabled', label: 'Custom popup', type: 'select', options: [['false', 'Off'], ['true', 'On']], help: 'Announcement popup rendered by the optional snippet.' },
    { k: 'popup_title', label: 'Popup title', type: 'text' },
    { k: 'popup_body', label: 'Popup body', type: 'textarea' },
    { k: 'popup_image', label: 'Popup image URL', type: 'text' },
    { k: 'download_counter', label: 'Download counter', type: 'select', options: [['false', 'Off'], ['true', 'On']], help: 'Records download clicks (needs hq_download_events).' },
    { k: 'ga_measurement_id', label: 'Google Analytics ID', type: 'text', help: 'G-XXXXXXX — pasted into the optional analytics snippet.' }
  ];

  async function viewSettings(root) {
    const s = await HQ.ensureSettings();
    const local = D.Store.load().settings || {};
    const val = k => (local[k] !== undefined ? local[k] : s['hq_' + k] !== undefined ? s['hq_' + k] : '');
    let sitemap = { count: 0, ok: false };
    try { const r = await fetch(DC.root + 'sitemap.xml', { cache: 'no-store' }); const t = await r.text(); sitemap = { ok: r.ok, count: (t.match(/<loc>/g) || []).length }; } catch (e) { }
    const robots = s.robots_txt || '';
    const show = v => v === undefined || v === null || v === '' ? '<span class="hq-muted">Not set</span>' : HQ.esc(v);
    const yes = v => v === 'false' ? '<span class="bd m">Hidden</span>' : '<span class="bd g">Shown</span>';

    root.innerHTML = ui.page(
      ui.head({
        title: 'Website Settings',
        sub: 'Everything the site already stores, shown read-only. HQ never overwrites these values — editing stays in Classic CMS where the validation lives.',
        actions: '<a class="btn" href="../?tab=seo">' + HQ.icon('search') + ' SEO tab</a>' +
          '<a class="btn pri" href="../?tab=settings">' + HQ.icon('edit') + ' Edit settings</a>'
      }) +
      ui.note({
        tone: 'a', icon: 'shield',
        title: 'Read-only mirror.',
        text: 'Values below come straight from <code>site_settings</code>. Saving happens in the classic CMS, so nothing can drift between the two panels.'
      }) +
      '<div class="hq-grid hq-2" style="gap:14px">' +
      ui.card({
        title: 'General', sub: 'Identity & contact',
        body: ui.kv([
          ['Website title', show(s.site_name)],
          ['Website description', show(s.footer_text)],
          ['Homepage title', show(s.homepage_title)],
          ['Homepage description', show(s.homepage_description)],
          ['Contact email', s.contact_email ? '<a class="hq-link" href="mailto:' + HQ.esc(s.contact_email) + '">' + HQ.esc(s.contact_email) + '</a>' : null, !s.contact_email],
          ['About text', show(HQ.clamp(s.about_text || '', 140))],
          ['Support text', show(HQ.clamp(s.support_text || '', 140))]
        ])
      }) +
      ui.card({
        title: 'Logo & favicon', sub: 'Brand assets',
        body: ui.kv([
          ['Logo URL', s.logo_url ? '<a class="hq-link" href="' + HQ.esc(HQ.safeUrl(s.logo_url) || '#') + '" target="_blank" rel="noopener">' + HQ.esc(HQ.clamp(s.logo_url, 60)) + '</a>' : null, !s.logo_url],
          ['Favicon URL', s.favicon_url ? '<a class="hq-link" href="' + HQ.esc(HQ.safeUrl(s.favicon_url) || '#') + '" target="_blank" rel="noopener">' + HQ.esc(HQ.clamp(s.favicon_url, 60)) + '</a>' : null, !s.favicon_url],
          ['Bundled logo set', '<span class="hq-mono">logo/logo-icon.svg · logo-full-dark-bg.svg</span>']
        ]) +
          (s.logo_url ? '<div style="margin-top:12px;background:#0d0d1a;border:1px solid var(--bd);border-radius:12px;padding:14px;display:grid;place-items:center"><img src="' + HQ.esc(s.logo_url) + '" alt="Current logo" style="max-height:70px;max-width:100%"></div>' : '')
      }) +
      ui.card({
        title: 'Social media links', sub: 'Used by the header and footer',
        body: ui.kv([
          ['Discord', s.social_discord ? '<a class="hq-link" href="' + HQ.esc(HQ.safeUrl(s.social_discord) || '#') + '" target="_blank" rel="noopener">' + HQ.esc(HQ.clamp(s.social_discord, 60)) + '</a>' : null, !s.social_discord],
          ['YouTube', s.social_youtube ? '<a class="hq-link" href="' + HQ.esc(HQ.safeUrl(s.social_youtube) || '#') + '" target="_blank" rel="noopener">' + HQ.esc(HQ.clamp(s.social_youtube, 60)) + '</a>' : null, !s.social_youtube],
          ['X / Twitter', s.social_twitter ? '<a class="hq-link" href="' + HQ.esc(HQ.safeUrl(s.social_twitter) || '#') + '" target="_blank" rel="noopener">' + HQ.esc(HQ.clamp(s.social_twitter, 60)) + '</a>' : null, !s.social_twitter]
        ]) +
          '<div class="hq-hint" style="margin-top:10px">The nine social accounts HQ can publish to are managed in <a class="hq-link" href="#/social/accounts">Social → Accounts</a>; these three links are the public site buttons.</div>'
      }) +
      ui.card({
        title: 'SEO', sub: 'Titles, description, robots & verification',
        body: ui.kv([
          ['Homepage title', show(s.homepage_title)],
          ['Homepage description', show(s.homepage_description)],
          ['Open Graph image', s.og_image_url ? '<a class="hq-link" href="' + HQ.esc(HQ.safeUrl(s.og_image_url) || '#') + '" target="_blank" rel="noopener">' + HQ.esc(HQ.clamp(s.og_image_url, 60)) + '</a>' : null, !s.og_image_url],
          ['Google verification', s.google_site_verification ? '<span class="hq-mono">' + HQ.esc(s.google_site_verification) + '</span>' : null, !s.google_site_verification],
          ['Sitemap', sitemap.ok ? sitemap.count + ' URL(s) · <a class="hq-link" href="' + HQ.esc(DC.root) + 'sitemap.xml" target="_blank" rel="noopener">open ↗</a>' : 'unavailable'],
          ['robots.txt', robots ? '<span class="hq-mono">' + HQ.esc(HQ.clamp(robots, 120)) + '</span>' : 'Default (Allow all)']
        ])
      }) +
      ui.card({
        title: 'Homepage sections', sub: 'Visibility toggles',
        body: '<div class="hq-list">' + [['About', 'show_about'], ['Games', 'show_games'], ['News', 'show_news'], ['Support', 'show_support']].map(([l, k]) =>
          '<div class="hq-li"><div class="ic">' + HQ.icon('layers') + '</div><div class="bd2"><b>' + l + '</b><span>' + (s[k] === 'false' ? 'Hidden on the homepage' : 'Visible on the homepage') + '</span></div>' + yes(s[k]) + '</div>').join('') + '</div>'
      }) +
      '</div>' +

      ui.card({
        title: 'Site Controls (HQ)', sub: 'New in HQ — stored as hq_* keys, enforced by the optional site snippet',
        actions: '<button type="button" class="btn sm pri" data-a="save-hq">' + HQ.icon('check') + ' Save controls</button>',
        body: ui.note({
          tone: 'w', icon: 'alert', title: 'Not enforced by the website yet.',
          text: 'The public pages were left byte-for-byte untouched, so these switches are stored but inert. Drop <code>js/site-controls.js</code> + one script tag into the site (see <b>admin/hq/INTEGRATION.md</b>) to activate maintenance mode, the popup and download counting.'
        }) +
          '<div class="hq-form-grid" id="hq-controls" style="margin-top:12px">' + HQ_CONTROLS.map(c => {
            const v = val(c.k);
            const input = c.type === 'select'
              ? ui.select(c.k, c.options, v || 'false')
              : c.type === 'textarea'
                ? '<textarea name="' + c.k + '" class="hq-ta" style="min-height:70px">' + HQ.esc(v) + '</textarea>'
                : '<input name="' + c.k + '" value="' + HQ.esc(v) + '">';
            return ui.field({ label: c.label, input, hint: c.help, full: c.type === 'textarea' });
          }).join('') + '</div>' +
          '<div class="hq-inline" style="margin-top:12px"><button type="button" class="btn" data-a="export-controls">' + HQ.icon('download') + ' Export controls JSON</button>' +
          '<span class="hq-tiny">Saved to site_settings with the hq_ prefix' + (DC.live ? '' : ' (local only in this session)') + '.</span></div>'
      }) +

      ui.card({
        title: 'robots.txt & sitemap source', sub: 'Read-only',
        body: '<div class="hq-grid hq-2" style="gap:12px">' +
          '<div><div class="hq-tiny" style="margin-bottom:6px">robots.txt (from settings, falls back to the file)</div>' +
          '<div class="status-box" style="background:#0d0d1a;border:1px solid var(--bd);border-radius:12px;padding:12px;font-size:12px;white-space:pre-wrap;font-family:ui-monospace,monospace">' +
          HQ.esc(robots || 'User-agent: *\nAllow: /\n\nSitemap: ' + location.origin + '/sitemap.xml') + '</div></div>' +
          '<div><div class="hq-tiny" style="margin-bottom:6px">Sitemap</div><div class="hq-note">' + HQ.icon('info') +
          '<div class="grow">Published public CMS pages are listed in <code>/sitemap.xml</code>. Currently ' + sitemap.count + ' URL(s) · drafts and private pages are excluded.</div></div>' +
          '<div class="hq-inline" style="margin-top:10px"><a class="btn sm" href="' + HQ.esc(DC.root) + 'sitemap.xml" target="_blank" rel="noopener">Open sitemap ↗</a>' +
          '<a class="btn sm" href="' + HQ.esc(DC.root) + 'robots.txt" target="_blank" rel="noopener">Open robots.txt ↗</a></div></div>' +
          '</div>'
      })
    );

    root.querySelector('[data-a="save-hq"]').onclick = async () => {
      const v = HQ.formData(root.querySelector('#hq-controls'));
      try { await D.saveHQSettings(v); D.log('hq_settings_saved', Object.keys(v).join(', ')); HQ.toast('Site controls saved.'); root._reload(); }
      catch (e) { HQ.toast('Save failed: ' + e.message, true); }
    };
    root.querySelector('[data-a="export-controls"]').onclick = () => HQ.downloadFile('devchazers-hq-controls.json', JSON.stringify(val('') === '' ? HQ.formData(root.querySelector('#hq-controls')) : HQ.formData(root.querySelector('#hq-controls')), null, 2), 'application/json');
  }

  HQ.views = HQ.views || {};
  HQ.views['/downloads'] = viewDownloads;
  HQ.views['/analytics'] = viewWebAnalytics;
  HQ.views['/ads'] = viewAds;
  HQ.views['/settings'] = viewSettings;
})();
