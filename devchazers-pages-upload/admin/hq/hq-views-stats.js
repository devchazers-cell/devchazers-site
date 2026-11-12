/* ============================================================================
   HQ view — Simple Analytics  (route /social/analytics)

   Upar: sab platforms ke total (views / subscribers / videos / likes).
   Neeche: chhote tabs — All + har account. Jis tab par click karo, usi account
   ke asli numbers aur uske videos ka table.

   Rules:
     • Sirf wahi numbers jo platform ne diye — jo nahi mila wo "—" (jhoota 0 nahi).
     • Data /api/hq/stats se aata hai (15 min cache, Refresh se taza).
     • Koi third-party library nahi.
   ========================================================================== */
(function () {
  const HQ = window.HQ;
  const ui = HQ.ui;
  const V = HQ.views = HQ.views || {};

  const st = { tab: 'all', data: null, err: null, at: 0 };
  const nf = v => (v === null || v === undefined ? '—' : HQ.nf(v));
  const has = v => (v === null || v === undefined ? '' : 'has');

  async function fetchStats(force) {
    return HQ.api('/api/hq/stats' + (force ? '?force=1' : ''));
  }

  function tabList(chans, active) {
    const items = [{ id: 'all', label: 'All platforms', icon: 'globe', count: chans.length }].concat(
      chans.map(c => ({ id: c.code, label: c.name || c.code, icon: c.platform === 'youtube' ? 'youtube' : 'share' }))
    );
    return ui.tabs({ id: 'stats', active: active, items: items });
  }

  function kpis(t) {
    return '<div class="hq-stats">' +
      ui.stat({ label: 'Total views', value: nf(t.views), icon: 'eye', na: t.views === null, foot: 'sab connected accounts' }) +
      ui.stat({ label: 'Subscribers / followers', value: nf(t.subscribers), icon: 'users', na: t.subscribers === null }) +
      ui.stat({ label: 'Videos live', value: nf(t.videos), icon: 'video', na: t.videos === null }) +
      ui.stat({ label: 'Likes (latest uploads)', value: nf(t.likes), icon: 'activity', na: t.likes === null }) +
      ui.stat({ label: 'Accounts', value: (t.connected || 0) + ' / ' + (t.channels || 0), icon: 'share', foot: 'connected' }) +
      '</div>';
  }

  function allPanel(chans) {
    if (!chans.length) {
      return ui.empty({
        icon: 'share', title: 'Koi channel nahi',
        text: 'Pehle Multi-Channel Studio me channels add karo aur har ek ko YouTube se connect karo.'
      });
    }
    const rows = chans.map(c => Object.assign({}, c));
    return ui.card({
      title: 'Har account ka khulasa',
      sub: 'Tab par click karke ek account ki tafseel dekho',
      tight: true,
      body: ui.table({
        cls: 'rsp',
        cols: [
          { t: 'Account', cell: c => '<b>' + HQ.esc(c.name || c.code) + '</b><div class="hq-tiny">' + HQ.esc((c.language || '').toUpperCase()) + ' · ' + HQ.esc(c.code) + '</div>' },
          { t: 'Subs', cell: c => '<span class="' + has(c.subs) + '">' + nf(c.subs) + '</span>' },
          { t: 'Views', cell: c => '<span class="' + has(c.views) + '">' + nf(c.views) + '</span>' },
          { t: 'Videos', cell: c => '<span class="' + has(c.videoCount) + '">' + nf(c.videoCount) + '</span>' },
          { t: 'Status', cell: c => c.connected ? '<span class="bd g">connected</span>' : '<span class="bd w">' + HQ.esc(c.error || 'not connected') + '</span>' }
        ],
        rows: rows
      })
    });
  }

  function channelPanel(c) {
    if (!c) return ui.empty({ icon: 'alert', title: 'Ye account nahi mila', text: 'Refresh dabao.' });
    const head = '<div class="hq-card">' +
      '<div class="hq-card-h"><div style="display:flex;gap:12px;align-items:center">' +
      (c.avatar ? '<img src="' + HQ.esc(c.avatar) + '" alt="" width="40" height="40" style="border-radius:50%">' : '<div class="ic">' + HQ.icon('youtube') + '</div>') +
      '<div><h2>' + HQ.esc(c.name || c.code) + '</h2><div class="hint">' + HQ.esc((c.language || '').toUpperCase()) + ' · ' + HQ.esc(c.code) + ' · ' + HQ.esc(c.platform) + '</div></div>' +
      '</div><div class="hq-toolbar">' + (c.connected ? '<span class="bd g">connected</span>' : '<span class="bd w">not connected</span>') +
      (c.fetched_at ? '<span class="hq-tiny">' + HQ.esc(HQ.rel(c.fetched_at)) + '</span>' : '') + '</div></div></div>';

    const err = c.error ? ui.note({
      tone: c.connected ? 'w' : 'r', icon: 'alert',
      title: c.connected ? 'Kuch numbers nahi aaye' : 'Account connected nahi',
      text: HQ.esc(c.error) + (c.code_needed === 'reconnect_needed' ? ' — Studio me <b>Reconnect</b> dabao.' : '')
    }) : '';

    const mini = '<div class="hq-stats">' +
      ui.stat({ label: 'Subscribers', value: nf(c.subs), icon: 'users', na: !has(c.subs) }) +
      ui.stat({ label: 'Total views', value: nf(c.views), icon: 'eye', na: !has(c.views) }) +
      ui.stat({ label: 'Videos', value: nf(c.videoCount), icon: 'video', na: !has(c.videoCount) }) +
      ui.stat({ label: 'Likes (latest 10)', value: nf(c.likes), icon: 'activity', na: !has(c.likes) }) +
      '</div>';

    const vids = (c.videos || []);
    const vcard = ui.card({
      title: 'Latest videos', sub: vids.length ? vids.length + ' videos — YouTube se seedha' : 'YouTube ne koi video nahi bheji',
      tight: true,
      body: ui.table({
        cls: 'rsp',
        cols: [
          { t: 'Video', cell: v => '<b>' + HQ.esc(HQ.clamp(v.title || v.id, 46)) + '</b><div class="hq-tiny">' + HQ.esc(v.published ? HQ.date(v.published) : '') + '</div>' },
          { t: 'Views', cell: v => '<span class="' + has(v.views) + '">' + nf(v.views) + '</span>' },
          { t: 'Likes', cell: v => '<span class="' + has(v.likes) + '">' + nf(v.likes) + '</span>' },
          { t: 'Comments', cell: v => '<span class="' + has(v.comments) + '">' + nf(v.comments) + '</span>' },
          { t: 'Privacy', cell: v => v.privacy ? '<span class="bd ' + (v.privacy === 'public' ? 'g' : v.privacy === 'unlisted' ? 'w' : 'm') + '">' + HQ.esc(v.privacy) + '</span>' : '<span class="hq-muted">—</span>' },
          { t: '', cell: v => '<a class="hq-link" href="' + HQ.esc(v.url) + '" target="_blank" rel="noopener">open ↗</a>' }
        ],
        rows: vids
      }),
      footer: '<span class="hq-tiny">Views/likes YouTube Data API se — YouTube Analytics API ki zaroorat nahi.</span>'
    });

    return head + err + mini + vcard;
  }

  async function load(force) {
    st.loading = true;
    try { st.data = await fetchStats(force); st.err = null; }
    catch (e) { st.err = e.message || 'request failed'; }
    finally { st.loading = false; }
  }

  function paint(root) {
    const d = st.data, err = st.err;

    const head = ui.head({
      title: 'Analytics',
      sub: 'Sab platforms ek jagah — upar total, neeche har account ka apna tab.',
      actions: '<button type="button" class="btn" data-a="refresh"' + (st.loading ? ' disabled' : '') + '>' + HQ.icon('refresh') + ' ' + (st.loading ? 'Loading…' : 'Refresh') + '</button>'
    });

    let body;
    if (err && !d) {
      body = ui.note({
        tone: 'r', icon: 'alert', title: 'Stats load nahi huye', text: HQ.esc(err) +
          '<br><span class="hq-tiny">Check: <code>/api/hq/stats</code> — file <code>functions/api/hq/stats.js</code> deploy hui hai? Phir Refresh dabao.</span>'
      });
    } else if (!d) {
      body = ui.empty({ icon: 'activity', title: 'Load ho raha hai…', text: 'YouTube se numbers aa rahe hain.' });
    } else {
      const chans = d.channels || [];
      const tot = d.totals || {};
      const ch = chans.find(c => c.code === st.tab);

      body = ui.note({
        tone: 'a', icon: 'activity',
        title: 'Aakhri update ' + HQ.rel(d.fetchedAt),
        text: '15 minute tak cache se — <b>Refresh</b> dabao to YouTube se taza (1–2 sec, ~3 quota units per channel).' +
          (d.notes && d.notes.length ? '<br><span class="hq-tiny">' + HQ.esc(d.notes.join(' · ')) + '</span>' : '')
      }) +
        kpis(tot) +
        '<div style="margin:14px 0">' + tabList(chans, st.tab) + '</div>' +
        (st.tab === 'all' ? allPanel(chans) : channelPanel(ch));
    }

    root.innerHTML = ui.page(head + '<div class="hq-grid" style="gap:14px">' + body + '</div>');

    const btn = root.querySelector('[data-a="refresh"]');
    if (btn) btn.onclick = () => { paint(root); load(true).then(() => paint(root)); };
    const tabs = root.querySelector('[data-tabs="stats"]');
    if (tabs) tabs.addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (!b || b.dataset.tab === st.tab) return;
      st.tab = b.dataset.tab;
      paint(root);
    });
  }

  async function viewStats(root) {
    if (!st.data && !st.err && !st.loading) {
      paint(root);            /* loading state turant */
      await load(false);
    }
    paint(root);
  }

  V['/social/analytics'] = viewStats;
  V['/social/stats'] = viewStats;
})();
