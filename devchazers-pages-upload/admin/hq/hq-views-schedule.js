/* ============================================================================
   HQ views — Publishing Scheduler, Publishing History, Social Analytics
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData, ui = HQ.ui;
  const P = D.PLATFORMS;
  const platName = id => (P.find(p => p.id === id) || {}).name || id;

  /* ================================================================ SCHEDULER */
  const sched = { mode: 'month', cursor: new Date(), selected: null };

  async function viewScheduler(root) {
    const posts = (await D.list('posts')).filter(p => p.status === 'scheduled');
    const pub = (await D.list('posts')).filter(p => p.status === 'published');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayKey = d => HQ.isoDay(d);
    const byDay = {};
    posts.forEach(p => { if (!p.scheduled_at) return; const k = HQ.isoDay(p.scheduled_at); (byDay[k] = byDay[k] || []).push(p); });
    Object.values(byDay).forEach(a => a.sort((x, y) => new Date(x.scheduled_at) - new Date(y.scheduled_at)));

    const evHtml = (p, cls) => '<div class="hq-cal-ev ' + (cls || '') + '" data-post="' + p.id + '" title="' + HQ.esc(p.title || p.body || 'Post') + '">' +
      HQ.time(p.scheduled_at) + ' ' + HQ.esc(HQ.clamp(p.title || p.body || 'Untitled', 18)) + '</div>';

    let bodyHtml = '';
    const cur = sched.cursor;
    if (sched.mode === 'month') {
      const y = cur.getFullYear(), m = cur.getMonth();
      const first = new Date(y, m, 1);
      const start = new Date(first); start.setDate(1 - first.getDay());
      const cells = [];
      for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d); }
      bodyHtml = '<div class="hq-cal-grid">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => '<div class="hq-cal-dow">' + d + '</div>').join('') +
        cells.map(d => {
          const k = dayKey(d), list = byDay[k] || [];
          const cls = ['hq-cal-day'];
          if (d.getMonth() !== m) cls.push('out');
          if (d.getTime() === today.getTime()) cls.push('today');
          if (sched.selected === k) cls.push('sel');
          return '<div class="' + cls.join(' ') + '" data-day="' + k + '"><div class="d">' + d.getDate() +
            (list.length ? ' <span class="hq-tiny">· ' + list.length + '</span>' : '') + '</div>' +
            list.slice(0, 3).map(p => evHtml(p)).join('') +
            (list.length > 3 ? '<div class="hq-cal-more">+' + (list.length - 3) + ' more</div>' : '') + '</div>';
        }).join('') + '</div>';
    } else if (sched.mode === 'week') {
      const start = new Date(cur); start.setDate(cur.getDate() - cur.getDay()); start.setHours(0, 0, 0, 0);
      bodyHtml = '<div class="hq-week">' + Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const list = byDay[dayKey(d)] || [];
        return '<div class="col"><h4' + (d.getTime() === today.getTime() ? ' class="today"' : '') + '>' +
          d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) + '<span>' + list.length + '</span></h4>' +
          (list.length ? list.map(p => '<div class="ev" data-post="' + p.id + '"><time>' + HQ.time(p.scheduled_at) + '</time>' +
            HQ.esc(HQ.clamp(p.title || p.body || 'Post', 26)) + '<span class="hq-tiny">' + (p.platforms || []).map(platName).join(', ') + '</span></div>').join('')
            : '<div class="hq-tiny" style="padding:4px 2px">—</div>') + '</div>';
      }).join('') + '</div>';
    } else if (sched.mode === 'day') {
      const k = dayKey(cur), list = byDay[k] || [];
      bodyHtml = list.length ? '<div class="hq-list">' + list.map(p =>
        '<div class="hq-li" data-post="' + p.id + '"><div class="ic">' + HQ.icon('clock') + '</div>' +
        '<div class="bd2"><b>' + HQ.esc(p.title || HQ.clamp(p.body || 'Untitled', 60)) + '</b>' +
        '<span>' + HQ.time(p.scheduled_at) + ' · ' + (p.platforms || []).map(platName).join(', ') + ' · ' + (p.language || 'en') + '</span></div>' +
        '<div class="hq-inline"><button type="button" class="btn sm" data-edit="' + p.id + '">Edit</button>' +
        '<button type="button" class="btn sm dng" data-cancel="' + p.id + '">Cancel</button></div></div>').join('') + '</div>'
        : ui.empty({ icon: 'calendar', title: 'Nothing on this day', text: 'Use the composer to schedule a post for ' + HQ.date(cur) + '.', cls: 'sm',
          action: '<a class="btn pri" href="#/social/composer">' + HQ.icon('plus') + ' Create post</a>' });
    } else {
      bodyHtml = posts.length ? ui.table({
        cls: 'rsp',
        cols: [
          { t: 'Post', cell: p => '<div class="hq-cell"><div class="ph">' + HQ.esc((p.title || 'P')[0]) + '</div><div class="tx"><b>' + HQ.esc(p.title || HQ.clamp(p.body, 50)) + '</b><span>' + HQ.esc((p.platforms || []).map(platName).join(', ')) + '</span></div></div>' },
          { t: 'Scheduled for', cell: p => '<span class="nowrap">' + HQ.esc(HQ.dt(p.scheduled_at)) + '</span><div class="hq-tiny">' + HQ.esc(HQ.rel(p.scheduled_at)) + '</div>' },
          { t: 'Language', cell: p => HQ.esc(D.flag(p.language || 'en')) + ' ' + HQ.esc((D.LANGUAGES.find(l => l.code === p.language) || {}).name || p.language || '—') },
          { t: 'Status', cell: p => ui.badge(p.status) },
          { t: '', cls: 'acts', cell: p => '<button type="button" class="btn sm" data-edit="' + p.id + '">Edit</button><button type="button" class="btn sm dng" data-cancel="' + p.id + '">Cancel</button>' }
        ],
        rows: posts
      }) : ui.empty({ icon: 'calendar', title: 'Nothing scheduled', text: 'Scheduled posts appear here. Publishing stays queued until a platform connection exists.', action: '<a class="btn pri" href="#/social/composer">' + HQ.icon('plus') + ' Schedule a post</a>' });
    }

    const selList = sched.selected ? (byDay[sched.selected] || []) : [];

    root.innerHTML = ui.page(
      ui.head({
        title: 'Publishing Scheduler',
        sub: 'Month, week, day and list views over the same queue. Cancel or reschedule without losing the draft.',
        actions: '<a class="btn pri" href="#/social/composer">' + HQ.icon('plus') + ' New post</a>'
      }) +
      (!posts.length ? ui.note({
        tone: 'w', icon: 'calendar', title: 'Queue is empty.',
        text: 'Schedules are real HQ workspace records, but <b>nothing can be auto-published yet</b> — no social account has an OAuth token. They stay in <b>Scheduled</b> until a connection exists.'
      }) : '') +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Scheduled', value: posts.length, icon: 'calendar', tone: 'p', na: !posts.length, foot: 'Waiting in queue' }) +
      ui.stat({ label: 'Published', value: pub.length, icon: 'check', tone: 'g', na: !pub.length, foot: 'Real publishes only' }) +
      ui.stat({ label: 'Next 7 days', value: posts.filter(p => { const t = new Date(p.scheduled_at); return t >= new Date() && t <= new Date(Date.now() + 7 * 864e5); }).length, icon: 'clock', tone: 'w', na: true, foot: 'Coming up' }) +
      ui.stat({ label: 'Cancelled', value: (await D.list('posts')).filter(p => p.status === 'cancelled').length, icon: 'x', tone: 'k', na: true, foot: 'Kept for audit' }) +
      '</div>' +
      ui.card({
        title: 'Schedule',
        actions: '<select class="hq-mini" id="sched-month">' + monthOptions() + '</select>' +
          ui.tabs({ id: 'sched-mode', active: sched.mode, items: [
          { id: 'month', label: 'Month', icon: 'calendar' }, { id: 'week', label: 'Week', icon: 'layers' },
          { id: 'day', label: 'Day', icon: 'clock' }, { id: 'list', label: 'List', icon: 'menu' }
        ] }),
        body: '<div class="hq-cal-head"><div class="hq-inline">' +
          '<button type="button" class="hq-iconbtn" data-nav="-1" aria-label="Previous">‹</button>' +
          '<button type="button" class="hq-iconbtn" data-nav="0" aria-label="Today" title="Today">•</button>' +
          '<button type="button" class="hq-iconbtn" data-nav="1" aria-label="Next">›</button>' +
          '<span class="hq-cal-title">' + escTitle() + '</span></div>' +
          '<div class="hq-hint">Times shown in your local timezone (' + HQ.esc(Intl.DateTimeFormat().resolvedOptions().timeZone || 'local') + ')</div></div>' +
          bodyHtml
      }) +
      (sched.selected ? ui.card({
        title: 'Selected day — ' + HQ.date(sched.selected),
        sub: selList.length + ' scheduled',
        body: selList.length ? '<div class="hq-list">' + selList.map(p =>
          '<div class="hq-li"><div class="ic">' + HQ.icon('clock') + '</div><div class="bd2"><b>' + HQ.esc(p.title || HQ.clamp(p.body || 'Untitled', 60)) + '</b>' +
          '<span>' + HQ.time(p.scheduled_at) + ' · ' + HQ.esc((p.platforms || []).map(platName).join(', ')) + '</span></div>' +
          '<div class="hq-inline"><button type="button" class="btn sm" data-edit="' + p.id + '">Edit</button>' +
          '<button type="button" class="btn sm dng" data-cancel="' + p.id + '">Cancel</button></div></div>').join('') + '</div>'
          : ui.empty({ title: 'No posts this day', cls: 'sm', icon: 'calendar' })
      }) : '')
    );

    function monthOptions() {
      const out = [];
      const d = new Date(); d.setDate(1);
      for (let i = -12; i <= 12; i++) {
        const x = new Date(d.getFullYear(), d.getMonth() + i, 1);
        out.push({ value: x.getFullYear() + '-' + x.getMonth(), label: HQ.monthName(x.getFullYear(), x.getMonth()) + (i === 0 ? ' (current)' : '') });
      }
      return ui.select('month', out, sched.cursor.getFullYear() + '-' + sched.cursor.getMonth(), 'placeholder=""');
    }
    root.querySelector('#sched-month').onchange = e => {
      const [y, m] = e.target.value.split('-').map(Number);
      sched.cursor = new Date(y, m, 1); root._reload();
    };

    function escTitle() {
      const c = sched.cursor;
      if (sched.mode === 'month') return HQ.monthName(c.getFullYear(), c.getMonth());
      if (sched.mode === 'week') {
        const s = new Date(c); s.setDate(c.getDate() - c.getDay());
        const e = new Date(s); e.setDate(s.getDate() + 6);
        return HQ.date(s).replace(/ \d{4}$/, '') + ' – ' + HQ.date(e);
      }
      if (sched.mode === 'day') return c.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return 'All scheduled posts';
    }

    HQ.on(root, 'click', '[data-tab]', (e, b) => { sched.mode = b.dataset.tab; root._reload(); });
    HQ.on(root, 'click', '[data-nav]', (e, b) => {
      const dir = +b.dataset.nav;
      if (dir === 0) { sched.cursor = new Date(); sched.selected = HQ.isoDay(new Date()); }
      else if (sched.mode === 'month') sched.cursor = new Date(sched.cursor.getFullYear(), sched.cursor.getMonth() + dir, 1);
      else if (sched.mode === 'week') sched.cursor = new Date(sched.cursor.getTime() + dir * 7 * 864e5);
      else if (sched.mode === 'day') sched.cursor = new Date(sched.cursor.getTime() + dir * 864e5);
      root._reload();
    });
    HQ.on(root, 'click', '[data-day]', (e, b) => { sched.selected = b.dataset.day; root._reload(); });
    HQ.on(root, 'click', '[data-edit]', (e, b) => HQ.go('/social/composer?id=' + b.dataset.edit));
    HQ.on(root, 'click', '[data-post]', (e, b) => { if (e.target.closest('[data-edit],[data-cancel]')) return; openPost(b.dataset.post); });
    HQ.on(root, 'click', '[data-cancel]', async (e, b) => {
      const ok = await HQ.confirm('Cancel this scheduled post?', { detail: 'The draft is kept with status "cancelled" so the history stays accurate.', ok: 'Cancel post', danger: true });
      if (!ok) return;
      await D.update('posts', b.dataset.cancel, { status: 'cancelled' });
      D.log('post_cancelled', b.dataset.cancel);
      HQ.toast('Post cancelled.');
      root._reload();
    });

    async function openPost(id) {
      const p = (await D.list('posts')).find(x => x.id === id); if (!p) return;
      HQ.modal({
        title: p.title || 'Scheduled post',
        sub: (p.platforms || []).map(platName).join(' · '),
        body: '<div class="hq-kv"><dt>Status</dt><dd>' + ui.badge(p.status) + '</dd>' +
          '<dt>Scheduled</dt><dd>' + HQ.esc(HQ.dt(p.scheduled_at)) + '</dd>' +
          '<dt>Language</dt><dd>' + HQ.esc(p.language || 'en') + '</dd>' +
          '<dt>Caption</dt><dd>' + HQ.esc(HQ.clamp(p.body || '—', 400)) + '</dd>' +
          '<dt>Hashtags</dt><dd>' + HQ.esc(p.hashtags || '—') + '</dd>' +
          '<dt>URL</dt><dd>' + HQ.esc(p.url || '—') + '</dd></div>',
        footer: '<button type="button" class="btn left" data-edit>Edit post</button><button type="button" class="btn dng" data-cancel>Cancel post</button><button type="button" class="btn" data-close>Close</button>',
        onMount(api) {
          api.q('[data-edit]').onclick = () => { api.close(); HQ.go('/social/composer?id=' + id); };
          api.q('[data-cancel]').onclick = async () => {
            api.close();
            const ok = await HQ.confirm('Cancel this scheduled post?', { detail: 'The draft is kept with status "cancelled" so the history stays accurate.', ok: 'Cancel post', danger: true });
            if (!ok) return;
            await D.update('posts', id, { status: 'cancelled' });
            D.log('post_cancelled', id);
            HQ.toast('Post cancelled.');
            root._reload();
          };
        }
      });
    }
  }

  /* ======================================================= PUBLISHING HISTORY */
  const histFilter = { status: 'all', q: '' };

  async function viewHistory(root) {
    const posts = await D.list('posts');
    const counts = { all: posts.length };
    D.POST_STATUS.forEach(s => counts[s] = posts.filter(p => p.status === s).length);
    const list = posts.filter(p => (histFilter.status === 'all' || p.status === histFilter.status) &&
      (!histFilter.q || (p.title + ' ' + p.body + ' ' + (p.platforms || []).join(' ')).toLowerCase().includes(histFilter.q.toLowerCase())));

    root.innerHTML = ui.page(
      ui.head({
        title: 'Publishing History',
        sub: 'Every draft, schedule and publish attempt in one audit trail. Failed and published rows only exist when a real publish happened.',
        actions: '<a class="btn pri" href="#/social/composer">' + HQ.icon('plus') + ' New post</a>' +
          '<button type="button" class="btn" data-a="export">' + HQ.icon('download') + ' Export CSV</button>'
      }) +
      '<div class="hq-stats">' + D.POST_STATUS.map(s => ui.stat({
        label: s.charAt(0).toUpperCase() + s.slice(1), value: counts[s] || 0, icon: s === 'published' ? 'check' : s === 'failed' ? 'alert' : s === 'scheduled' ? 'calendar' : s === 'publishing' ? 'refresh' : 'bookmark',
        tone: s === 'published' ? 'g' : s === 'failed' ? 'k' : s === 'scheduled' ? 'p' : 'w', na: !counts[s]
      })).join('') + '</div>' +
      ui.card({
        title: 'Posts',
        sub: list.length + ' record(s)',
        actions: '<input type="search" id="hist-q" placeholder="Search title, caption, platform…" value="' + HQ.esc(histFilter.q) + '" style="min-height:36px;padding:7px 11px;font-size:12.5px;width:220px">' +
          '<select id="hist-status" style="min-height:36px;padding:7px 11px;font-size:12.5px;max-width:150px">' +
          ['all'].concat(D.POST_STATUS).map(s => '<option value="' + s + '"' + (histFilter.status === s ? ' selected' : '') + '>' + (s === 'all' ? 'All statuses' : s) + '</option>').join('') + '</select>',
        tight: true,
        body: ui.table({
          cls: 'rsp',
          cols: [
            { t: 'Post', cell: p => '<div class="hq-cell">' + thumb(p) + '<div class="tx"><b>' + HQ.esc(p.title || HQ.clamp(p.body || 'Untitled', 60)) + '</b>' +
              '<span>' + HQ.esc((p.platforms || []).map(platName).join(', ') || '—') + '</span></div></div>' },
            { t: 'Platforms', cell: p => '<div class="hq-inline" style="gap:5px">' + (p.platforms || []).map(id => '<span class="hq-chip" title="' + HQ.esc(platName(id)) + '">' + HQ.platIcon(id) + '</span>').join('') || '—' + '</div>' },
            { t: 'Date', cls: 'nowrap', cell: p => '<span>' + HQ.esc(HQ.dt(p.published_at || p.scheduled_at || p.created_at)) + '</span><div class="hq-tiny">' + HQ.esc(HQ.rel(p.published_at || p.scheduled_at || p.created_at)) + '</div>' },
            { t: 'Status', cell: p => ui.badge(p.status) },
            { t: 'Published URL', cell: p => {
              const urls = p.published_urls || {};
              const first = Object.values(urls)[0];
              return first ? '<a class="hq-link" href="' + HQ.esc(HQ.safeUrl(first) || '#') + '" target="_blank" rel="noopener">Open ↗</a>' : '<span class="hq-muted">—</span>';
            } },
            { t: 'Error', cell: p => {
              const err = (p.errors || [])[0];
              return err ? '<span class="hq-chip r" title="' + HQ.esc(err) + '">' + HQ.esc(HQ.clamp(err, 40)) + '</span>' : '<span class="hq-muted">—</span>';
            } },
            { t: '', cls: 'acts', cell: p => '<button type="button" class="btn sm" data-view="' + p.id + '">View</button>' +
              (['draft', 'scheduled', 'failed', 'cancelled'].includes(p.status) ? '<button type="button" class="btn sm" data-edit="' + p.id + '">Edit</button>' : '') +
              '<button type="button" class="btn sm dng" data-del="' + p.id + '">Delete</button>' }
          ],
          rows: list,
          icon: 'send',
          emptyTitle: 'No posts yet',
          emptyText: 'Drafts you save in the composer and posts you schedule both land here. Published / failed rows can only appear after a real publish attempt.',
          empty: ui.empty({ icon: 'send', title: 'No matching posts', text: 'Save a draft or schedule a post to start the history.', action: '<a class="btn pri" href="#/social/composer">' + HQ.icon('plus') + ' Open composer</a>' })
        })
      })
    );

    function thumb(p) {
      const m = (p.media || [])[0];
      if (m && m.url && !m.kind) return '<img src="' + HQ.esc(m.url) + '" alt="">';
      if (m && m.url && m.kind === 'image') return '<img src="' + HQ.esc(m.url) + '" alt="">';
      if (m && m.kind === 'video') return '<span class="ph" style="background:#000">' + HQ.icon('play') + '</span>';
      return '<span class="ph">' + HQ.esc(((p.title || p.body || 'P')[0] || 'P').toUpperCase()) + '</span>';
    }

    root.querySelector('#hist-q').oninput = HQ.debounce(e => { histFilter.q = e.target.value; root._reload(); }, 260);
    root.querySelector('#hist-status').onchange = e => { histFilter.status = e.target.value; root._reload(); };
    HQ.on(root, 'click', '[data-edit]', (e, b) => HQ.go('/social/composer?id=' + b.dataset.edit));
    HQ.on(root, 'click', '[data-del]', async (e, b) => {
      if (!await HQ.confirm('Delete this post record?', { detail: 'Drafts and schedules can be deleted; published history should usually be kept.', ok: 'Delete', danger: true })) return;
      await D.remove('posts', b.dataset.del); HQ.toast('Deleted.'); root._reload();
    });
    HQ.on(root, 'click', '[data-view]', async (e, b) => {
      const p = (await D.list('posts')).find(x => x.id === b.dataset.view); if (!p) return;
      HQ.modal({
        title: p.title || 'Post', sub: (p.platforms || []).map(platName).join(' · '),
        body: '<div class="hq-kv"><dt>Status</dt><dd>' + ui.badge(p.status) + '</dd><dt>Created</dt><dd>' + HQ.esc(HQ.dt(p.created_at)) + '</dd>' +
          '<dt>Scheduled</dt><dd>' + HQ.esc(p.scheduled_at ? HQ.dt(p.scheduled_at) : '—') + '</dd>' +
          '<dt>Published</dt><dd>' + HQ.esc(p.published_at ? HQ.dt(p.published_at) : '—') + '</dd>' +
          '<dt>Caption</dt><dd>' + HQ.esc(p.body || '—') + '</dd><dt>Hashtags</dt><dd>' + HQ.esc(p.hashtags || '—') + '</dd>' +
          '<dt>URL</dt><dd>' + HQ.esc(p.url || '—') + '</dd><dt>Errors</dt><dd>' + HQ.esc((p.errors || []).join('; ') || '—') + '</dd></div>'
      });
    });
    root.querySelector('[data-a="export"]').onclick = () => {
      const rows = [['title', 'platforms', 'status', 'created', 'scheduled', 'published', 'url', 'error']].concat(posts.map(p => [
        p.title || '', (p.platforms || []).join('|'), p.status, p.created_at || '', p.scheduled_at || '', p.published_at || '', Object.values(p.published_urls || {})[0] || '', (p.errors || []).join('; ')
      ]));
      HQ.downloadFile('devchazers-publishing-history.csv', HQ.csv(rows), 'text/csv');
    };
  }

  /* ========================================================= SOCIAL ANALYTICS */
  const SOCIAL_METRICS = [
    { k: 'views', label: 'Total views', icon: 'eye' },
    { k: 'followers', label: 'Total followers', icon: 'users' },
    { k: 'engagement', label: 'Engagement', icon: 'activity' },
    { k: 'likes', label: 'Likes', icon: 'check' },
    { k: 'comments', label: 'Comments', icon: 'reply' },
    { k: 'shares', label: 'Shares', icon: 'share' },
    { k: 'reach', label: 'Reach', icon: 'globe' }
  ];

  async function viewSocialAnalytics(root, ctx) {
    const range = +((root._range) || 30);
    const table = 'hq_social_metrics';
    const p = await D.probe(table);
    let rows = [];
    if (p.ok) {
      const c = D.client();
      const since = new Date(Date.now() - range * 864e5).toISOString().slice(0, 10);
      const res = await c.from(table).select('*').gte('date', since).order('date');
      if (!res.error) rows = res.data || [];
    }
    const sum = k => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const has = rows.length > 0;
    const byPlat = P.map(pl => ({ platform: pl.id, label: pl.name, value: rows.filter(r => r.platform === pl.id).reduce((a, r) => a + (Number(r.views) || 0), 0) }));
    const dates = [...new Set(rows.map(r => r.date))].sort();

    /* --- rich YouTube extras (CTR, retention, traffic, geography, videos) --- */
    let insight = null;
    try {
      const c = D.client();
      if (c) {
        const res = await c.from('hq_social_insights')
          .select('*').eq('platform', 'youtube').eq('kind', 'youtube_summary')
          .order('date', { ascending: false }).limit(1);
        if (!res.error && res.data && res.data[0]) insight = res.data[0];
      }
    } catch (e) { insight = null; }
    const pl = (insight && insight.payload) || null;
    const T = (pl && pl.totals) || {};
    const fmtDur = s2 => {
      if (s2 == null) return '—';
      const m = Math.floor(s2 / 60), sec = Math.round(s2 % 60);
      return m ? m + 'm ' + sec + 's' : sec + 's';
    };
    const trafficMax = pl && pl.traffic && pl.traffic.length ? pl.traffic[0].views || 1 : 1;
    const trafficHtml = (pl && pl.traffic && pl.traffic.length)
      ? '<div class="hq-bars">' + pl.traffic.map(t => '<div class="hq-bar-row"><span class="nm">' + HQ.esc(String(t.source).replace(/_/g, ' ').toLowerCase()) + '</span>' +
        '<span class="hq-bar-track"><i class="hq-bar-fill" style="width:' + Math.round((t.views / trafficMax) * 100) + '%"></i></span><span class="v">' + HQ.nf(t.views) + '</span></div>').join('') + '</div>'
      : '<div class="hq-tiny">No traffic-source rows yet — run Sync.</div>';
    const countryHtml = (pl && pl.countries && pl.countries.length)
      ? '<div class="hq-bars">' + pl.countries.map(t => '<div class="hq-bar-row"><span class="nm">' + HQ.esc(t.code) + '</span>' +
        '<span class="hq-bar-track"><i class="hq-bar-fill" style="width:' + Math.round((t.views / (pl.countries[0].views || 1)) * 100) + '%"></i></span><span class="v">' + HQ.nf(t.views) + '</span></div>').join('') + '</div>'
      : '<div class="hq-tiny">No country rows yet — run Sync.</div>';
    const videosHtml = (pl && pl.videos && pl.videos.length)
      ? '<div class="hq-tbl-wrap"><table class="hq-tbl rsp"><thead><tr><th>Video</th><th class="num">Views</th><th class="num">Likes</th><th class="num">Comments</th></tr></thead><tbody>' +
        pl.videos.map(v => '<tr><td data-l="Video"><a class="hq-link" href="' + HQ.esc(v.url) + '" target="_blank" rel="noopener">' + HQ.esc(HQ.clamp(v.title, 46)) + '</a></td>' +
          '<td data-l="Views" class="num">' + HQ.nf(v.views) + '</td><td data-l="Likes" class="num">' + HQ.nf(v.likes) + '</td><td data-l="Comments" class="num">' + HQ.nf(v.comments) + '</td></tr>').join('') +
        '</tbody></table></div>'
      : '<div class="hq-tiny">No uploads returned yet.</div>';
    const syncedAt = insight ? HQ.rel(insight.updated_at || insight.created_at) : '';
    const realCards = pl
      ? '<div class="hq-stats">' +
          ui.stat({ label: 'Click-through rate', value: T.ctrPct == null ? '—' : T.ctrPct + '%', icon: 'target', tone: 'p', na: T.ctrPct == null, foot: 'Impressions → clicks' }) +
          ui.stat({ label: 'Avg view retention', value: T.retentionPct == null ? '—' : T.retentionPct + '%', icon: 'activity', tone: 'g', na: T.retentionPct == null, foot: 'Watched vs. video length' }) +
          ui.stat({ label: 'Avg view duration', value: fmtDur(T.avgViewSeconds), icon: 'clock', tone: 'w', na: T.avgViewSeconds == null, foot: 'Per view, last ' + range + ' days' }) +
          ui.stat({ label: 'Watch time', value: T.watchMinutes == null ? '—' : HQ.nf(T.watchMinutes) + ' min', icon: 'video', tone: 'p', na: T.watchMinutes == null, foot: 'Estimated minutes' }) +
        '</div>' +
        '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
          ui.card({ title: 'Traffic sources', sub: 'Where the views came from', body: trafficHtml }) +
          ui.card({ title: 'Top countries', sub: 'Views by geography', body: countryHtml }) +
        '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
          ui.card({ title: 'Recent uploads', sub: 'Straight from YouTube — nothing typed by hand', body: videosHtml, tight: true }) +
          ui.card({ title: 'Sync detail', body: '<div class="hq-list">' +
            '<div class="hq-li"><div class="ic">' + HQ.icon('refresh') + '</div><div class="bd2"><b>Last sync</b><span>' + HQ.esc(syncedAt) + ' · range ' + HQ.esc((pl.range || {}).start || '') + ' → ' + HQ.esc((pl.range || {}).end || '') + '</span></div></div>' +
            '<div class="hq-li"><div class="ic">' + HQ.icon('share') + '</div><div class="bd2"><b>Channel</b><span>' + HQ.esc((pl.channel || {}).title || '') + (pl.channel && pl.channel.subscribers != null ? ' · ' + HQ.nf(pl.channel.subscribers) + ' subscribers' : '') + '</span></div></div>' +
            ((pl.notes || []).length ? '<div class="hq-note" style="margin-top:8px">' + HQ.icon('alert') + '<div class="grow">' + pl.notes.map(n => HQ.esc(n)).join('<br>') + '</div></div>' : '') +
            '</div>' }) +
        '</div></div>'
      : '';
    const series = [{ name: 'Views', color: '#00e5ff', values: dates.map(d => rows.filter(r => r.date === d).reduce((a, r) => a + (Number(r.views) || 0), 0)) }];

    root.innerHTML = ui.page(
      ui.head({
        title: 'Social Analytics',
        sub: 'A single place for cross-platform numbers. HQ will not draw a chart it cannot source.',
        actions: '<select id="sa-range" style="min-height:38px;padding:8px 12px;font-size:13px;max-width:170px">' +
          [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([v, l]) => '<option value="' + v + '"' + (range === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
          '<button type="button" class="btn" data-a="sync">' + HQ.icon('refresh') + ' Sync now</button>' +
          '<a class="btn" href="#/social/accounts">' + HQ.icon('share') + ' Accounts</a>'
      }) +
      ui.sourceState(p, 'Social metric rows from <code>' + table + '</code>.') +
      '<div class="hq-stats">' + SOCIAL_METRICS.map(m => ui.stat({
        label: m.label, value: has ? HQ.nf(sum(m.k)) : '—', icon: m.icon, na: !has,
        tone: m.k === 'views' ? 'p' : m.k === 'followers' ? 'g' : 'w',
        foot: has ? 'Last ' + range + ' days' : 'Not connected'
      })).join('') + '</div>' +
      realCards +
      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Monthly growth', sub: 'Views across all platforms',
        body: has ? HQ.charts.line({ labels: dates, series, height: 220 }) :
          HQ.charts.empty('No metric rows in the selected range. Growth appears after a metrics source is connected.')
      }) +
      ui.card({
        title: 'Platform comparison', sub: 'Total views per platform',
        body: has ? HQ.charts.hbars(byPlat.filter(b => b.value > 0)) :
          '<div class="hq-bars">' + byPlat.map(b => '<div class="hq-bar-row mut"><span class="nm">' + HQ.platIcon(b.platform) + HQ.esc(b.label) + '</span>' +
            '<span class="hq-bar-track"><i class="hq-bar-fill" style="width:0%"></i></span><span class="v">—</span></div>').join('') + '</div>' +
            '<div class="hq-tiny" style="margin-top:10px">All nine platforms are wired to the comparison — values stay blank until data arrives.</div>'
      }) +
      '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({
        title: 'How the numbers get here',
        body: '<div class="hq-list">' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('db') + '</div><div class="bd2"><b>1 · Daily rows</b><span><span class="hq-mono">/api/hq/sync</span> writes one row per platform per day into <span class="hq-mono">hq_social_metrics</span>, plus extras (CTR, retention, traffic, geography) into <span class="hq-mono">hq_social_insights</span>.</span></div></div>' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('refresh') + '</div><div class="bd2"><b>2 · Free schedule</b><span>GitHub Action <span class="hq-mono">.github/workflows/hq-cron.yml</span> calls it every 6 hours — no Cloudflare cron needed on Pages.</span></div></div>' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('shield') + '</div><div class="bd2"><b>3 · Tokens stay server-side</b><span>The browser only ever reads rows. Secrets never leave Cloudflare.</span></div></div>' +
          '</div>' +
          '<div class="hq-note" style="margin-top:10px">' + HQ.icon('alert') + '<div class="grow">A metric the platform does not return stays <b>—</b>. Fabricated analytics are worse than none.</div></div>'
      }) +
      ui.card({
        title: 'Platform coverage',
        tight: true,
        body: '<div class="hq-tbl-wrap"><table class="hq-tbl"><thead><tr><th>Platform</th><th>Account</th><th class="num">Rows</th></tr></thead><tbody>' +
          P.map(pl => {
            const acc = D.accounts().find(a => a.platform.id === pl.id);
            const n = rows.filter(r => r.platform === pl.id).length;
            return '<tr><td><span class="hq-inline" style="gap:7px">' + HQ.platIcon(pl.id) + ' ' + HQ.esc(pl.name) + '</span></td>' +
              '<td>' + ui.badge(acc.status) + '</td><td class="num">' + (n || '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
      }) +
      '</div></div>'
    );

    root.querySelector('#sa-range').onchange = e => { root._range = e.target.value; root._reload(); };
    const syncBtn = root.querySelector('[data-a="sync"]');
    if (syncBtn) syncBtn.onclick = async () => {
      const old = syncBtn.innerHTML;
      syncBtn.disabled = true;
      syncBtn.innerHTML = 'Syncing…';
      try {
        const out = await HQ.api('/api/hq/sync?days=' + range, { method: 'POST', body: '{}' });
        const yt = (out.results || {}).youtube || {};
        if (yt.ok) HQ.toast('Synced: ' + ((yt.counts || {}).metricDays || 0) + ' day(s) of YouTube data.');
        else HQ.toast('Sync failed: ' + (yt.error || 'see console'), true);
        if ((yt.notes || []).length) console.warn('sync notes', yt.notes);
      } catch (e) {
        HQ.toast('Sync failed: ' + e.message, true);
      }
      syncBtn.disabled = false;
      syncBtn.innerHTML = old;
      root._reload();
    };
  }

  HQ.views = HQ.views || {};
  HQ.views['/social/scheduler'] = viewScheduler;
  HQ.views['/social/history'] = viewHistory;
  HQ.views['/social/analytics'] = viewSocialAnalytics;
})();
