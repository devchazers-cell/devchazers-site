/* ============================================================================
   HQ views — Company modules
     /channels   International channel network (12 languages)
     /revenue    Revenue & monetization (manual / imported / estimated, labelled)
     /research   Competitor & market research (manual, public info only)
     /costs      Cost & budget overview (PKR 2,000/month plan)
   Plus HQ.capabilityTable(): the per-platform API truth table reused by Social
   Accounts. Nothing here pretends an integration exists.
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData, ui = HQ.ui;

  /* ======================================================= platform capability
     Editorially maintained, checked against each platform's developer docs.
     Re-verify before promising a client feature: API access changes often. */
  const CAPS = [
    {
      id: 'youtube', publish: 'yes', schedule: 'yes', analytics: 'yes', comments: 'yes',
      note: 'Data API v3 upload = 1,600 of 10,000 daily quota units (≈6 uploads/day). Public uploads need OAuth app verification. Native scheduled publish via publishAt.'
    },
    {
      id: 'facebook', publish: 'yes', schedule: 'yes', analytics: 'yes', comments: 'yes',
      note: 'Pages API. pages_manage_posts + pages_read_engagement need App Review. Native scheduling via scheduled_publish_time.'
    },
    {
      id: 'instagram', publish: 'yes', schedule: 'no', analytics: 'yes', comments: 'yes',
      note: 'Content Publishing API needs a Business/Creator account and instagram_content_publish review. No native scheduling — HQ must hold the queue and post at the time.'
    },
    {
      id: 'tiktok', publish: 'review', schedule: 'no', analytics: 'no', comments: 'no',
      note: 'Content Posting API: direct post requires an app audit; unaudited apps can only post private videos. No public creator-analytics or comment API.'
    },
    {
      id: 'x', publish: 'yes', schedule: 'no', analytics: 'no', comments: 'yes',
      note: 'Free API tier allows roughly 500 posts/month and very limited reads. Post metrics need a paid tier, so HQ shows — for X analytics.'
    },
    {
      id: 'threads', publish: 'yes', schedule: 'no', analytics: 'yes', comments: 'yes',
      note: 'Threads API (Meta). Publishing and own-post insights are available after app setup; scheduling is HQ-side only.'
    },
    {
      id: 'linkedin', publish: 'review', schedule: 'no', analytics: 'review', comments: 'no',
      note: 'Personal posting works after app review. Company-page posting needs Marketing Developer Platform access — apply before promising it.'
    },
    {
      id: 'pinterest', publish: 'review', schedule: 'no', analytics: 'review', comments: 'no',
      note: 'Standard access requires review; trial access is limited to your own account and sandbox data.'
    },
    {
      id: 'reddit', publish: 'yes', schedule: 'no', analytics: 'no', comments: 'yes',
      note: 'Submit and reply via OAuth. Free for non-commercial use with rate limits; commercial use requires a data-access agreement.'
    },
    {
      id: 'discord', publish: 'yes', schedule: 'no', analytics: 'no', comments: 'yes',
      note: 'Webhook or bot inside your own server. No public analytics; message history is your own data.'
    }
  ];
  HQ.CAPS = CAPS;

  const capBadge = v => v === 'yes' ? '<span class="bd g">Supported</span>'
    : v === 'review' ? '<span class="bd w">App review</span>'
      : '<span class="bd m">Not supported</span>';

  HQ.capabilityTable = () => ui.card({
    id: 'caps',
    title: 'What each platform can actually do',
    sub: 'Checked against the official APIs — not a promise, a map of what needs approval',
    tight: true,
    body: '<div class="hq-tbl-wrap"><table class="hq-tbl"><thead><tr>' +
      '<th>Platform</th><th>Publish</th><th>Native schedule</th><th>Analytics</th><th>Comments / replies</th></tr></thead><tbody>' +
      CAPS.map(c => {
        const p = D.PLATFORMS.find(x => x.id === c.id) || { name: c.id };
        return '<tr><td data-l="Platform"><span class="hq-inline" style="gap:7px">' + HQ.platIcon(c.id) + ' ' + HQ.esc(p.name) + '</span>' +
          '<div class="hq-hint" style="margin:4px 0 0;max-width:420px">' + HQ.esc(c.note) + '</div></td>' +
          '<td data-l="Publish">' + capBadge(c.publish) + '</td>' +
          '<td data-l="Native schedule">' + capBadge(c.schedule) + '</td>' +
          '<td data-l="Analytics">' + capBadge(c.analytics) + '</td>' +
          '<td data-l="Comments">' + capBadge(c.comments) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="hq-hint" style="padding:10px 14px">“Native schedule” = the platform itself stores the time. Everywhere else HQ keeps the queue and your scheduled function posts at that minute — that requires the scheduler endpoint described in <code>INTEGRATION.md</code>.</div>'
  });

  /* ================================================================ channels */
  const CH_STATUS = [
    { id: 'planned', name: 'Planned', tone: 'm' },
    { id: 'active', name: 'Active', tone: 'g' },
    { id: 'paused', name: 'Paused', tone: 'w' }
  ];
  const chStatusName = id => (CH_STATUS.find(s => s.id === id) || CH_STATUS[0]).name;

  function channelRows() {
    const stored = D.Store.load().channels || [];
    return D.LANGUAGES.map(l => {
      const s = stored.find(x => x.code === l.code) || {};
      return Object.assign({
        code: l.code, native: l.native, rtl: l.rtl,
        name: 'DevChazers ' + l.native, handle: '', platform: 'youtube',
        url: '', country: '', status: 'planned', description: '', keywords: ''
      }, s);
    });
  }
  function saveChannel(code, patch) {
    const d = D.Store.load();
    if (!Array.isArray(d.channels)) d.channels = [];
    const i = d.channels.findIndex(x => x.code === code);
    const row = Object.assign({ code: code, updated_at: D.nowISO() }, i < 0 ? {} : d.channels[i], patch);
    if (i < 0) d.channels.push(row); else d.channels[i] = row;
    D.Store.save();
  }

  function channelModal(row, done) {
    const lang = D.LANGUAGES.find(l => l.code === row.code) || {};
    const m = HQ.modal({
      title: 'Channel profile — ' + (lang.name || row.code),
      sub: 'Record a channel you actually own. HQ never creates or claims one for you.',
      size: 'lg',
      body: '<div class="hq-form">' +
        ui.field({ label: 'Channel name *', input: '<input name="name" required value="' + HQ.esc(row.name) + '">' }) +
        ui.field({ label: 'Handle / @username', input: '<input name="handle" value="' + HQ.esc(row.handle) + '" placeholder="@devchazers">' }) +
        ui.field({ label: 'Primary platform', input: ui.select('platform', D.PLATFORMS.map(p => ({ value: p.id, label: p.name })), row.platform) }) +
        ui.field({ label: 'Status', input: ui.select('status', CH_STATUS.map(s => ({ value: s.id, label: s.name })), row.status) }) +
        ui.field({ label: 'Channel URL', input: '<input name="url" type="url" value="' + HQ.esc(row.url) + '" placeholder="https://www.youtube.com/@DevChazersUrdu">' }) +
        ui.field({ label: 'Primary country', input: '<input name="country" value="' + HQ.esc(row.country) + '" placeholder="Pakistan">' }) +
        ui.field({ full: true, label: 'Localized channel description', input: '<textarea name="description" rows="3" dir="' + (lang.rtl ? 'rtl' : 'ltr') + '">' + HQ.esc(row.description) + '</textarea>' }) +
        ui.field({ full: true, label: 'Localized keywords (comma separated)', input: '<input name="keywords" value="' + HQ.esc(row.keywords) + '">' }) +
        '</div>' +
        '<div class="hq-note"><span class="grow">A profile is only marked <b>Active</b> once you paste the live channel URL — that is the honest proof it exists.</span></div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-save>Save profile</button>',
      onMount(api) {
        api.q('[data-save]').onclick = async () => {
          const f = HQ.formData(api.body);
          if (!String(f.name || '').trim()) return HQ.toast('Channel name is required.', true);
          if (f.url && !/^https?:\/\/\S+$/i.test(String(f.url).trim())) return HQ.toast('Channel URL must start with http:// or https://', true);
          if (f.status === 'active' && !String(f.url || '').trim()) return HQ.toast('An Active channel needs its live URL.', true);
          saveChannel(row.code, {
            name: String(f.name).trim(), handle: String(f.handle || '').trim(), platform: f.platform,
            status: f.status, url: String(f.url || '').trim(), country: String(f.country || '').trim(),
            description: String(f.description || ''), keywords: String(f.keywords || '')
          });
          D.log('channel_saved', (lang.name || row.code) + ' → ' + f.status);
          api.close(); HQ.toast('Channel profile saved.'); done();
        };
      }
    });
    return m;
  }

  async function viewChannels(root) {
    root.innerHTML = ui.page(ui.loading(3));
    const rows = channelRows();
    const active = rows.filter(r => r.status === 'active');
    const withUrl = rows.filter(r => r.url);
    const missing = rows.length - withUrl.length;

    root.innerHTML = ui.page(
      ui.head({
        title: 'Channel Network',
        sub: 'One DevChazers brand, twelve language profiles. You create and verify every channel — HQ only keeps the plan, the copy and the links.',
        actions: '<button type="button" class="btn" data-a="csv">' + HQ.icon('download') + ' Export plan</button>' +
          '<button type="button" class="btn pri" data-a="kit">' + HQ.icon('bookmark') + ' Brand kit</button>'
      }) +
      ui.note({
        tone: 'a', icon: 'info', title: 'Account creation stays with you.',
        text: 'Nothing here creates, claims or verifies a channel. Paste the URL of a channel you already own and its status can become <b>Active</b>; until then it stays <b>Planned</b>.'
      }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Language profiles', value: rows.length, icon: 'globe', tone: 'p', foot: 'EN · UR · HI · ES · AR · PT · FR · DE · TR · ID · JA · KO' }) +
      ui.stat({ label: 'Active channels', value: active.length + ' / ' + rows.length, icon: 'check', tone: 'g', na: !active.length, foot: active.length ? 'URL recorded' : 'None verified yet' }) +
      ui.stat({ label: 'Awaiting a URL', value: missing, icon: 'link', tone: 'w', na: !missing, foot: missing ? 'Planned profiles' : 'All recorded' }) +
      ui.stat({ label: 'RTL languages', value: rows.filter(r => r.rtl).length, icon: 'lang', tone: 'b', foot: 'Urdu + Arabic previews' }) +
      '</div>' +

      '<div class="hq-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">' +
      rows.map(r => {
        const lang = D.LANGUAGES.find(l => l.code === r.code) || {};
        const st = CH_STATUS.find(s => s.id === r.status) || CH_STATUS[0];
        return '<section class="hq-card"><div class="hq-card-b">' +
          '<div class="hq-inline" style="justify-content:space-between;gap:8px;margin-bottom:6px">' +
          '<span class="hq-inline" style="gap:8px">' + D.flag(r.code) + '<b style="font-size:13.5px">' + HQ.esc(r.name) + '</b></span>' +
          '<span class="bd ' + st.tone + '">' + HQ.esc(st.name) + '</span></div>' +
          '<div class="hq-hint" style="margin:0 0 8px">' + HQ.esc(lang.native || '') + (r.handle ? ' · ' + HQ.esc(r.handle) : ' · handle not set') + ' · ' + HQ.esc((D.PLATFORMS.find(p => p.id === r.platform) || {}).name || r.platform) + '</div>' +
          (r.description ? '<div style="font-size:12.5px;color:var(--mut);line-height:1.55;' + (lang.rtl ? 'direction:rtl;text-align:right;' : '') + '">' + HQ.esc(HQ.clamp(r.description, 110)) + '</div>'
            : '<div class="hq-hint" style="margin:0">No localized description yet.</div>') +
          '<div class="hq-toolbar" style="margin-top:10px">' +
          '<button type="button" class="btn sm" data-edit="' + r.code + '">' + HQ.icon('edit') + ' Edit</button>' +
          (r.url ? '<a class="btn sm" href="' + HQ.esc(HQ.safeUrl(r.url)) + '" target="_blank" rel="noopener">' + HQ.icon('ext') + ' Open</a>' : '') +
          '</div></div></section>';
      }).join('') +
      '</div>' +

      ui.card({
        title: 'Brand consistency rules',
        sub: 'Applied to every language so the network still reads as one studio',
        body: '<div class="hq-list">' +
          [
            ['globe', 'Name pattern', '“DevChazers” stays Latin script in every channel name; the language word follows it (DevChazers اردو, DevChazers 日本語).'],
            ['bookmark', 'Tagline', 'One English tagline everywhere in the banner, plus one translated line in the description’s first sentence.'],
            ['image', 'Visual identity', 'Same logo, same avatar, same banner layout — only the language line changes.'],
            ['link', 'Cross-linking', 'Every localized channel links back to devchazers.site and to the English channel.'],
            ['lang', 'Handle pattern', 'devchazers / devchazers_ur / devchazers_es … — reserved before launch so nobody squats the name.']
          ].map(([ic, t, x]) => '<div class="hq-li"><div class="ic">' + HQ.icon(ic) + '</div><div class="bd2"><b>' + HQ.esc(t) + '</b><span>' + HQ.esc(x) + '</span></div></div>').join('') +
          '</div>'
      })
    );

    HQ.on(root, 'click', '[data-edit]', (e, b) => channelModal(channelRows().find(r => r.code === b.dataset.edit), () => root._reload()));
    root.querySelector('[data-a="csv"]').onclick = () => {
      HQ.csv('devchazers-channel-plan.csv',
        [['Language', 'Code', 'Channel name', 'Handle', 'Platform', 'Status', 'URL', 'Country', 'Description']].concat(
          channelRows().map(r => [(D.LANGUAGES.find(l => l.code === r.code) || {}).name, r.code, r.name, r.handle, r.platform, chStatusName(r.status), r.url, r.country, r.description])));
    };
    root.querySelector('[data-a="kit"]').onclick = () => HQ.modal({
      title: 'Brand kit for language channels', size: 'lg',
      sub: 'Copy-paste text so every channel launches consistent',
      body: '<div class="hq-form">' +
        ui.field({ full: true, label: 'English boilerplate', input: '<textarea rows="3" readonly>DevChazers is an indie game studio building small, polished mobile games. New games, updates and devlogs — play free on Google Play.</textarea>' }) +
        ui.field({ full: true, label: 'Hashtag set', input: '<input readonly value="#DevChazers #IndieGame #MobileGame #GameDev #Gaming">' }) +
        ui.field({ full: true, label: 'Localized descriptions', input: '<textarea rows="5" readonly>' + HQ.esc(D.LANGUAGES.slice(0, 4).map(l => l.name + ': add the approved translation here before launch').join('\n')) + '</textarea>' }) +
        '</div>' +
        '<div class="hq-note"><span class="grow">Write the translation once in <b>Social → Languages</b>; HQ reuses it for channel descriptions, posts and SEO.</span></div>',
      footer: '<button type="button" class="btn" data-close>Close</button>'
    });
  }

  /* ================================================================= revenue */
  const REV_SOURCES = [
    { value: 'admob', label: 'AdMob' },
    { value: 'play_console', label: 'Play Console' },
    { value: 'sponsor', label: 'Sponsorship' },
    { value: 'merch', label: 'Merch / other' }
  ];
  const REV_KINDS = [
    { value: 'manual', label: 'Manual entry', tone: 'b' },
    { value: 'imported', label: 'Imported / exported report', tone: 'p' },
    { value: 'estimated', label: 'Estimate', tone: 'w' }
  ];
  const kindOf = k => REV_KINDS.find(x => x.value === k) || REV_KINDS[0];
  const srcName = s => (REV_SOURCES.find(x => x.value === s) || { label: s || '—' }).label;
  const money = n => 'PKR ' + HQ.nf(Math.round(Number(n) || 0));

  async function viewRevenue(root) {
    root.innerHTML = ui.page(ui.loading(4));
    const [rows, games] = await Promise.all([D.list('revenue'), HQ.ensureGames()]);
    const today = new Date();
    const monthKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    const d30 = new Date(); d30.setDate(d30.getDate() - 29);
    const inMonth = rows.filter(r => String(r.date || '').slice(0, 7) === monthKey);
    const in30 = rows.filter(r => r.date && new Date(r.date) >= new Date(d30.toDateString()));
    const sum = a => a.reduce((x, r) => x + (Number(r.amount) || 0), 0);

    const months = Array.from({ length: 6 }).map((_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return d; });
    const mKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const series = months.map(m => rows.filter(r => String(r.date || '').slice(0, 7) === mKey(m)).reduce((x, r) => x + (Number(r.amount) || 0), 0));

    root.innerHTML = ui.page(
      ui.head({
        title: 'Revenue',
        sub: 'Ad revenue, sponsorships and anything else the studio earns — entered by you, labelled by origin.',
        actions: '<button type="button" class="btn" data-a="csv">' + HQ.icon('download') + ' CSV</button>'
      }) +
      ui.note({
        tone: 'w', icon: 'lock', title: 'No monetization API is connected.',
        text: 'AdMob and Play Console both expose reporting APIs, but they need your own Google OAuth client and per-app approval. Until you add that server-side <b>HQ_CONFIG.REVENUE_ENDPOINT</b>, every figure here is a <b>manual entry</b> — never presented as live revenue.'
      }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'This month', value: inMonth.length ? money(sum(inMonth)) : '—', na: !inMonth.length, icon: 'chart', tone: 'g', foot: inMonth.length ? inMonth.length + ' entries' : 'Nothing entered yet' }) +
      ui.stat({ label: 'Last 30 days', value: in30.length ? money(sum(in30)) : '—', na: !in30.length, icon: 'calendar', tone: 'b' }) +
      ui.stat({ label: 'All recorded', value: rows.length ? money(sum(rows)) : '—', na: !rows.length, icon: 'db', tone: 'p', foot: rows.length + ' entries' }) +
      ui.stat({ label: 'Average / month', value: series.some(v => v) ? money(sum(rows) / Math.max(1, series.filter(v => v).length)) : '—', na: !series.some(v => v), icon: 'activity', tone: 'k' }) +
      '</div>' +

      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Monthly revenue', sub: 'Last 6 months · PKR',
        body: HQ.charts.bars({ values: series, labels: months.map(m => m.toLocaleDateString(undefined, { month: 'short' })), color: '#00e5ff', height: 200, empty: 'Enter one revenue figure and this chart starts drawing real history.' })
      }) +
      ui.card({
        title: 'Revenue history', tight: true,
        actions: '<span class="hq-tiny">' + rows.length + ' entries</span>',
        body: ui.table({
          rows: rows,
          emptyTitle: 'No revenue recorded',
          emptyText: 'Add your first AdMob or Play Console payout above. Keep one entry per month per source so trends stay readable.',
          empty: ui.empty({ icon: 'chart', title: 'No revenue recorded', text: 'Add your first AdMob or Play Console payout. One entry per month per source keeps trends readable.', action: '<button type="button" class="btn pri sm" data-a="focus">Add entry</button>' }),
          cols: [
            { t: 'Date', cell: r => HQ.esc(r.date || '—') },
            { t: 'Source', cell: r => HQ.esc(srcName(r.source)) },
            { t: 'Game', cell: r => r.game_id ? HQ.esc((games.find(g => g.id === r.game_id) || {}).name || r.game_id) : '<span class="hq-tiny">studio-wide</span>' },
            { t: 'Origin', cell: r => '<span class="bd ' + kindOf(r.kind).tone + '">' + HQ.esc(kindOf(r.kind).label) + '</span>' },
            { t: 'Amount', cls: 'num', cell: r => money(r.amount) },
            { t: '', cls: 'num', cell: r => '<button type="button" class="btn sm" data-del="' + r.id + '">' + HQ.icon('trash') + '</button>' }
          ]
        })
      }) +
      '</div><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Add revenue entry',
        body: '<div class="hq-form" id="rev-form">' +
          ui.field({ label: 'Date *', input: '<input type="date" name="date" value="' + new Date().toISOString().slice(0, 10) + '">' }) +
          ui.field({ label: 'Source', input: ui.select('source', REV_SOURCES, 'admob') }) +
          ui.field({ label: 'Game', input: ui.select('game_id', [{ value: '', label: 'Studio-wide / not game specific' }].concat(games.map(g => ({ value: g.id, label: g.name }))), '') }) +
          ui.field({ label: 'Amount (PKR) *', input: '<input type="number" name="amount" min="0" step="1" placeholder="0">' }) +
          ui.field({ label: 'Where did this number come from?', input: ui.select('kind', REV_KINDS.map(k => ({ value: k.value, label: k.label })), 'manual') }) +
          ui.field({ label: 'Note', input: '<input name="note" placeholder="e.g. June AdMob payout">' }) +
          '<button type="button" class="btn pri" data-a="add">' + HQ.icon('plus') + ' Save entry</button>' +
          '</div>' +
          '<div class="hq-hint">HQ never converts currencies and never invents a figure. Add one row per source per period so the chart stays honest.</div>'
      }) +
      ui.card({
        title: 'Why these are labelled',
        tight: true,
        body: '<div class="hq-list">' +
          [
            ['edit', 'Manual', 'You typed it from a payout screen or an invoice.'],
            ['upload', 'Imported', 'You exported a CSV/report and copied the totals.'],
            ['chart', 'Estimate', 'Projected or averaged — never shown as banked money.']
          ].map(([ic, t, x]) => '<div class="hq-li"><div class="ic">' + HQ.icon(ic) + '</div><div class="bd2"><b>' + HQ.esc(t) + '</b><span>' + HQ.esc(x) + '</span></div></div>').join('') +
          '</div>'
      }) +
      '</div></div>'
    );

    const form = root.querySelector('#rev-form');
    root.querySelector('[data-a="add"]').onclick = async () => {
      const f = HQ.formData(form);
      if (!f.date) return HQ.toast('Pick a date.', true);
      if (f.amount === '' || isNaN(Number(f.amount))) return HQ.toast('Amount must be a number.', true);
      if (Number(f.amount) < 0) return HQ.toast('Amount cannot be negative.', true);
      await D.create('revenue', { date: f.date, source: f.source, game_id: f.game_id, amount: Number(f.amount), kind: f.kind, note: f.note });
      D.log('revenue_added', money(f.amount) + ' · ' + srcName(f.source));
      HQ.toast('Revenue entry saved.'); root._reload();
    };
    HQ.on(root, 'click', '[data-del]', async (e, b) => {
      if (!await HQ.confirm('Delete this revenue entry?', { detail: 'The row is removed from this workspace only. Nothing in Supabase is touched.', ok: 'Delete', danger: true })) return;
      await D.remove('revenue', b.dataset.del); D.log('revenue_removed', b.dataset.del); HQ.toast('Entry deleted.'); root._reload();
    });
    const focus = root.querySelector('[data-a="focus"]');
    if (focus) focus.onclick = () => form.querySelector('[name=amount]').focus();
    root.querySelector('[data-a="csv"]').onclick = () => HQ.csv('devchazers-revenue.csv',
      [['Date', 'Source', 'Game', 'Origin', 'Amount PKR', 'Note']].concat(rows.map(r => [r.date, srcName(r.source), r.game_id || 'studio-wide', kindOf(r.kind).label, r.amount, r.note || ''])));
  }

  /* ================================================================ research */
  async function viewResearch(root) {
    root.innerHTML = ui.page(ui.loading(4));
    const rows = await D.list('competitors');
    const games = await HQ.ensureGames();
    const thisMonth = new Date().toISOString().slice(0, 7);
    const checked = rows.filter(r => String(r.checked_at || '').slice(0, 7) === thisMonth);

    const cats = {};
    rows.forEach(r => { const c = r.category || 'Uncategorised'; cats[c] = (cats[c] || 0) + 1; });

    root.innerHTML = ui.page(
      ui.head({
        title: 'Market Research',
        sub: 'Studios and games you watch — numbers you looked up yourself, with the date you checked them.',
        actions: '<button type="button" class="btn" data-a="csv">' + HQ.icon('download') + ' CSV</button>'
      }) +
      ui.note({
        tone: 'a', icon: 'shield', title: 'Manual by design.',
        text: 'HQ does not scrape YouTube, TikTok or any store. You enter public numbers you can see on the page; each row stores the date you checked it, so nothing here can be mistaken for a live feed.'
      }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Tracked entries', value: rows.length, icon: 'eye', tone: 'p', na: !rows.length, foot: rows.length ? 'All manually entered' : 'Nothing tracked yet' }) +
      ui.stat({ label: 'Checked this month', value: checked.length, icon: 'check', tone: 'g', na: !checked.length, foot: 'Last 30 days' }) +
      ui.stat({ label: 'Channels', value: rows.filter(r => r.type === 'channel').length, icon: 'youtube', tone: 'k', na: !rows.filter(r => r.type === 'channel').length }) +
      ui.stat({ label: 'Games', value: rows.filter(r => r.type === 'game').length, icon: 'gamepad', tone: 'b', na: !rows.filter(r => r.type === 'game').length }) +
      '</div>' +

      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Watchlist', tight: true,
        body: ui.table({
          rows: rows,
          empty: ui.empty({
            icon: 'eye', title: 'No competitor tracked yet',
            text: 'Add three studios in your genre. Public subscriber counts and upload cadence are enough to spot gaps worth filling.'
          }),
          cols: [
            { t: 'Name', cell: r => '<b>' + HQ.esc(r.name) + '</b>' + (r.url ? ' <a class="hq-link" href="' + HQ.esc(HQ.safeUrl(r.url)) + '" target="_blank" rel="noopener">open ↗</a>' : '') },
            { t: 'Type', cell: r => '<span class="bd m">' + HQ.esc(r.type === 'game' ? 'Game' : 'Channel') + '</span>' },
            { t: 'Platform', cell: r => HQ.esc((D.PLATFORMS.find(p => p.id === r.platform) || {}).name || r.platform || '—') },
            { t: 'Public count', cell: r => r.count ? HQ.esc(r.count) : '<span class="hq-tiny">not checked</span>' },
            { t: 'Category', cell: r => HQ.esc(r.category || '—') },
            { t: 'Checked', cell: r => HQ.esc(r.checked_at || '—') },
            { t: '', cls: 'num', cell: r => '<button type="button" class="btn sm" data-del="' + r.id + '">' + HQ.icon('trash') + '</button>' }
          ]
        })
      }) +
      ui.card({
        title: 'Content ideas from your watchlist',
        sub: 'Rule-based prompts — not scraped trends',
        body: rows.length ? '<div class="hq-list">' + rows.slice(0, 6).map(r => {
          const gap = r.type === 'game' ? 'Record a first-look gameplay video and compare it to their store screenshots.' : 'Match their upload cadence with one Short per gameplay clip you already have.';
          return '<div class="hq-li"><div class="ic">' + HQ.icon('sparkles') + '</div><div class="bd2"><b>' + HQ.esc(r.name) + '</b><span>' + HQ.esc(gap) + '</span></div></div>';
        }).join('') + '</div>' +
          '<div class="hq-hint">These prompts come from the categories you typed, not from an API. Verify before acting.</div>'
          : ui.empty({ icon: 'sparkles', title: 'Add a competitor first', text: 'HQ builds prompts from your own entries — there is nothing to derive yet.', cls: 'sm' })
      }) +
      '</div><div class="hq-grid" style="gap:14px">' +
      ui.card({
        title: 'Add to watchlist',
        body: '<div class="hq-form" id="res-form">' +
          ui.field({ label: 'Name *', input: '<input name="name" placeholder="Studio or game name">' }) +
          ui.field({ label: 'Type', input: ui.select('type', [{ value: 'channel', label: 'Channel' }, { value: 'game', label: 'Game' }], 'channel') }) +
          ui.field({ label: 'Platform', input: ui.select('platform', D.PLATFORMS.map(p => ({ value: p.id, label: p.name })).concat([{ value: 'play', label: 'Google Play' }]), 'youtube') }) +
          ui.field({ label: 'Link', input: '<input name="url" type="url" placeholder="https://…">' }) +
          ui.field({ label: 'Public count you saw', input: '<input name="count" placeholder="e.g. 48.2K subscribers">' }) +
          ui.field({ label: 'Category', input: '<input name="category" placeholder="e.g. Hyper-casual" list="res-cats"><datalist id="res-cats">' + Object.keys(cats).map(c => '<option value="' + HQ.esc(c) + '">').join('') + '</datalist>' }) +
          ui.field({ label: 'Checked on', input: '<input type="date" name="checked_at" value="' + new Date().toISOString().slice(0, 10) + '">' }) +
          ui.field({ full: true, label: 'Note', input: '<textarea name="notes" rows="2" placeholder="What do they do well? What is missing?"></textarea>' }) +
          '<button type="button" class="btn pri" data-a="add">' + HQ.icon('plus') + ' Save entry</button>' +
          '</div>'
      }) +
      ui.card({
        title: 'Reference', sub: 'Public sources only',
        tight: true,
        body: '<div class="hq-list">' + [
          ['youtube', 'YouTube', 'Channel page shows subscribers, video count and view counts publicly.'],
          ['play', 'Google Play', 'Listing shows installs band, rating and review count.'],
          ['tiktok', 'TikTok', 'Profile shows followers and likes; individual video views are public.'],
          ['tag', 'Rules', 'Public pages only. No scraping behind logins, no private data, no terms violations.']
        ].map(([ic, t, x]) => '<div class="hq-li"><div class="ic">' + HQ.icon(ic === 'play' ? 'gamepad' : ic) + '</div><div class="bd2"><b>' + HQ.esc(t) + '</b><span>' + HQ.esc(x) + '</span></div></div>').join('') + '</div>'
      }) +
      '</div></div>'
    );

    const form = root.querySelector('#res-form');
    root.querySelector('[data-a="add"]').onclick = async () => {
      const f = HQ.formData(form);
      if (!String(f.name || '').trim()) return HQ.toast('Name is required.', true);
      if (f.url && !/^https?:\/\/\S+$/i.test(f.url)) return HQ.toast('Link must start with http:// or https://', true);
      await D.create('competitors', { name: f.name.trim(), type: f.type, platform: f.platform, url: f.url, count: f.count, category: f.category, checked_at: f.checked_at, notes: f.notes });
      D.log('research_added', f.name);
      HQ.toast('Added to watchlist.'); root._reload();
    };
    HQ.on(root, 'click', '[data-del]', async (e, b) => {
      if (!await HQ.confirm('Remove from watchlist?', { ok: 'Remove', danger: true })) return;
      await D.remove('competitors', b.dataset.del); HQ.toast('Removed.'); root._reload();
    });
    root.querySelector('[data-a="csv"]').onclick = () => HQ.csv('devchazers-research.csv',
      [['Name', 'Type', 'Platform', 'Count', 'Category', 'Checked', 'Link', 'Notes']].concat(rows.map(r => [r.name, r.type, r.platform, r.count, r.category, r.checked_at, r.url, r.notes])));
  }

  /* =================================================================== costs */
  const SERVICES = [
    { id: 'pages', name: 'Cloudflare Pages', plan: 'Free', est: 0, note: 'Hosting + unlimited requests. 500 builds/month is far above your cadence.' },
    { id: 'functions', name: 'Cloudflare Workers / Pages Functions', plan: 'Free', est: 0, note: 'Needed for OAuth token exchange and scheduled publishing. 100k requests/day free.' },
    { id: 'supabase', name: 'Supabase', plan: 'Free', est: 0, note: 'Postgres 500 MB, 1 GB storage, 50k MAU. Upgrade only when storage fills.' },
    { id: 'github', name: 'GitHub', plan: 'Free', est: 0, note: 'Repo + Actions minutes are enough for a static deploy.' },
    { id: 'youtube', name: 'YouTube Data API', plan: 'Free quota', est: 0, note: '10,000 units/day. One upload costs 1,600 units, so ~6 uploads/day.' },
    { id: 'meta', name: 'Meta Graph (FB + Instagram)', plan: 'Free', est: 0, note: 'No API fee. Requires App Review; a business verification is also free.' },
    { id: 'tiktok', name: 'TikTok Content Posting API', plan: 'Free', est: 0, note: 'Free after app audit. Unaided apps can only post privately.' },
    { id: 'x', name: 'X API', plan: 'Free tier', est: 0, note: 'About 500 posts/month. The paid Basic tier (~USD 200/mo) is far above your budget — do not enable it.' },
    { id: 'ai', name: 'AI copy engine (optional)', plan: 'Template mode', est: 0, note: 'HQ ships free deterministic templates. A free-tier model can be wired in later; paid usage needs your approval.' },
    { id: 'domain', name: 'devchazers.site domain', plan: 'Already paid by you', est: 0, note: 'Renews yearly outside this plan — check your registrar.' }
  ];

  function costOverrides() {
    const s = D.Store.load().settings || {};
    return s.costs || {};
  }

  async function viewCosts(root) {
    root.innerHTML = ui.page(ui.loading(3));
    const s = D.Store.load().settings || {};
    const budget = Number(s.budget_pkr || 2000);
    const over = costOverrides();
    const rows = SERVICES.map(x => Object.assign({}, x, { actual: over[x.id] && over[x.id].actual !== undefined ? over[x.id].actual : '', note2: (over[x.id] || {}).note || '' }));
    const estTotal = rows.reduce((a, r) => a + (Number(r.est) || 0), 0);
    const actualKnown = rows.filter(r => r.actual !== '' && r.actual !== null && r.actual !== undefined);
    const actualTotal = actualKnown.reduce((a, r) => a + (Number(r.actual) || 0), 0);
    const pct = budget ? Math.min(100, Math.round((actualKnown.length ? actualTotal : estTotal) / budget * 100)) : 0;
    const storage = await D.probe('media');

    root.innerHTML = ui.page(
      ui.head({
        title: 'Cost & Budget',
        sub: 'What this stack costs you each month, and what would break the PKR 2,000 plan.',
        actions: '<button type="button" class="btn" data-a="budget">' + HQ.icon('edit') + ' Change budget</button>' +
          '<button type="button" class="btn" data-a="csv">' + HQ.icon('download') + ' Export</button>'
      }) +
      ui.note({
        tone: 'a', icon: 'shield', title: 'Nothing here was purchased or upgraded.',
        text: 'Every row is the free tier the project already uses. HQ cannot and does not buy anything; a paid plan only appears if <b>you</b> change it in the provider’s dashboard.'
      }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Budget / month', value: money(budget), icon: 'tag', tone: 'p', foot: 'Set by you' }) +
      ui.stat({ label: 'Estimated spend', value: money(estTotal), icon: 'chart', tone: estTotal ? 'w' : 'g', na: !estTotal, foot: estTotal ? 'Check paid rows' : 'All free tiers' }) +
      ui.stat({ label: 'Actual (recorded)', value: actualKnown.length ? money(actualTotal) : '—', na: !actualKnown.length, icon: 'db', tone: 'b', foot: actualKnown.length ? actualKnown.length + ' of ' + rows.length + ' services' : 'No invoices recorded' }) +
      ui.stat({ label: 'Budget used', value: pct + '%', icon: 'activity', tone: pct > 80 ? 'w' : 'g', foot: (actualKnown.length ? money(actualTotal) : money(estTotal)) + ' of ' + money(budget) }) +
      '</div>' +

      ui.card({
        title: 'Monthly services', tight: true,
        sub: 'Edit “Actual” when a real invoice arrives',
        body: '<div class="hq-tbl-wrap"><table class="hq-tbl"><thead><tr><th>Service</th><th>Plan</th><th class="num">Estimate</th><th class="num">Actual</th><th>Notes</th><th></th></tr></thead><tbody>' +
          rows.map(r => '<tr><td data-l="Service"><b>' + HQ.esc(r.name) + '</b></td>' +
            '<td data-l="Plan"><span class="bd ' + (/free|template|already/i.test(r.plan) ? 'g' : 'w') + '">' + HQ.esc(r.plan) + '</span></td>' +
            '<td data-l="Estimate" class="num">' + (r.est ? money(r.est) : '<span class="bd g">Free</span>') + '</td>' +
            '<td data-l="Actual" class="num">' + (r.actual === '' ? '<span class="hq-tiny">not recorded</span>' : money(r.actual)) + '</td>' +
            '<td data-l="Notes"><span class="hq-tiny">' + HQ.esc(r.note) + (r.note2 ? ' · ' + HQ.esc(r.note2) : '') + '</span></td>' +
            '<td class="num"><button type="button" class="btn sm" data-set="' + r.id + '">' + HQ.icon('edit') + '</button></td></tr>').join('') +
          '</tbody></table></div>'
      }) +

      '<div class="hq-2">' +
      ui.card({
        title: 'Budget guardrails',
        sub: 'What keeps you inside PKR 2,000',
        body: '<div class="hq-list">' + [
          ['check', 'Publish from HQ, not from paid schedulers', 'No Buffer / Hootsuite subscription — your own scheduler runs on the free Workers tier.'],
          ['check', 'Download media instead of re-uploading', 'Reuse the same assets across platforms to keep storage inside the free 1 GB.'],
          ['check', 'Template SEO by default', 'The SEO Studio is free until you choose to connect a model.'],
          ['alert', 'The one thing that would break the budget', 'X API Basic (~USD 200/mo) or any Meta ads API. Both stay off unless you approve them.'],
          ['alert', 'Storage', storage.ok ? 'Storage reachable — currently ' + storage.count + ' media rows.' : 'Storage probe failed; check System Status before uploading large videos.']
        ].map(([ic, t, x]) => '<div class="hq-li"><div class="ic">' + HQ.icon(ic) + '</div><div class="bd2"><b>' + HQ.esc(t) + '</b><span>' + HQ.esc(x) + '</span></div></div>').join('') + '</div>'
      }) +
      ui.card({
        title: 'If you need more later',
        body: '<div class="hq-kv" style="margin:0">' +
          '<dt>First upgrade</dt><dd>Supabase Pro only when storage passes ~400 MB</dd>' +
          '<dt>Never worth it yet</dt><dd>Social schedulers, ad managers, analytics SaaS</dd>' +
          '<dt>Free “upgrades” first</dt><dd>Cloudflare cache rules, image resizing, Pages Functions cron</dd>' +
          '<dt>Ask before enabling</dt><dd>Any paid API or model. HQ shows a warning row when one is configured.</dd>' +
          '</div>'
      }) +
      '</div>'
    );

    HQ.on(root, 'click', '[data-set]', (e, b) => {
      const r = rows.find(x => x.id === b.dataset.set);
      const m = HQ.modal({
        title: 'Record actual cost — ' + r.name, size: 'sm',
        body: '<div class="hq-form">' +
          ui.field({ label: 'Actual monthly cost (PKR)', input: '<input type="number" name="actual" min="0" value="' + (r.actual === '' ? '' : r.actual) + '" placeholder="0">' }) +
          ui.field({ label: 'Note', input: '<input name="note" value="' + HQ.esc(r.note2) + '" placeholder="invoice, plan change…">' }) +
          '</div><div class="hq-hint">Leave the amount empty to go back to “not recorded”.</div>',
        footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-save>Save</button>',
        onMount(api) {
          api.q('[data-save]').onclick = () => {
            const f = HQ.formData(api.body);
            const d = D.Store.load();
            d.settings = d.settings || {}; d.settings.costs = d.settings.costs || {};
            d.settings.costs[r.id] = { actual: f.actual === '' ? '' : Number(f.actual), note: f.note || '' };
            D.Store.save(); api.close(); HQ.toast('Cost updated.'); root._reload();
          };
        }
      });
      return m;
    });
    root.querySelector('[data-a="budget"]').onclick = () => {
      const m = HQ.modal({
        title: 'Monthly budget', size: 'sm',
        body: '<div class="hq-form">' + ui.field({ label: 'Budget in PKR', input: '<input type="number" name="budget" min="0" value="' + budget + '">' }) + '</div>' +
          '<div class="hq-hint">Shown on this page and in System Status. HQ never changes a provider’s plan.</div>',
        footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-save>Save</button>',
        onMount(api) {
          api.q('[data-save]').onclick = () => {
            const f = HQ.formData(api.body);
            const d = D.Store.load(); d.settings = d.settings || {};
            d.settings.budget_pkr = Math.max(0, Number(f.budget) || 0); D.Store.save();
            api.close(); HQ.toast('Budget saved.'); root._reload();
          };
        }
      });
      return m;
    };
    root.querySelector('[data-a="csv"]').onclick = () => HQ.csv('devchazers-costs.csv',
      [['Service', 'Plan', 'Estimate PKR', 'Actual PKR', 'Notes']].concat(rows.map(r => [r.name, r.plan, r.est, r.actual, r.note])));
  }

  /* ---------------------------------------------------------------- register */
  HQ.views['/channels'] = viewChannels;
  HQ.views['/revenue'] = viewRevenue;
  HQ.views['/research'] = viewResearch;
  HQ.views['/costs'] = viewCosts;
})();
