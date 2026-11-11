/* ============================================================================
   DevChazers HQ — shell, navigation, router, auth
   Reuses the classic CMS Supabase session + is_admin() check. Adds a demo mode
   that is always visibly labelled when Supabase is unreachable.
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData, ui = HQ.ui;
  const $ = s => document.querySelector(s);
  const cache = { games: null, media: null, activity: null, settings: null };

  HQ.state = { session: false, user: '', live: false, gamesOk: true, mediaOk: true };

  /* ------------------------------------------------------------------ caches */
  HQ.ensureGames = async (force) => {
    if (!cache.games || force) {
      try { cache.games = await DC.listGames(true); HQ.state.gamesOk = true; }
      catch (e) { cache.games = []; HQ.state.gamesOk = false; if (force) HQ.toast('Games: ' + e.message, true); }
    }
    return cache.games;
  };
  HQ.ensureMedia = async (force) => {
    if (!cache.media || force) {
      try { cache.media = await DC.listMedia(); HQ.state.mediaOk = true; }
      catch (e) { cache.media = []; HQ.state.mediaOk = false; if (force) HQ.toast('Media: ' + e.message, true); }
    }
    return cache.media;
  };
  HQ.ensureActivity = async (force) => {
    if (!cache.activity || force) {
      try { cache.activity = await DC.listActivity(25); } catch (e) { cache.activity = []; }
    }
    return cache.activity;
  };
  HQ.ensureSettings = async (force) => {
    if (!cache.settings || force) {
      try { cache.settings = await DC.getSettings(); } catch (e) { cache.settings = {}; }
    }
    return cache.settings || {};
  };
  HQ.reload = (force) => {
    if (force) { cache.games = cache.media = cache.activity = cache.settings = null; D.resetProbes(); }
    render();
  };

  /* -------------------------------------------------------------------- nav */
  const CLASSIC = [
    ['dash', 'Dashboard'], ['games', 'Games'], ['pages', 'Pages'], ['media', 'Media'], ['ads', 'Ads'], ['seo', 'SEO'], ['settings', 'Settings']
  ];
  function navModel() {
    const posts = (D.Store.load().posts || []);
    const media = (cache.media || []).length;
    const games = (cache.games || []).length;
    const anns = (D.Store.load().announcements || []).length;
    const arts = (D.Store.load().articles || []).length;
    const scheduled = posts.filter(p => p.status === 'scheduled').length;
    const notif = Number(localStorage.getItem('dc_hq_notif') || 0);
    return [
      { path: '/overview', label: 'Overview', icon: 'grid' },
      { path: '/notifications', label: 'Notifications', icon: 'bell', count: notif },
      {
        group: 'Social Media', icon: 'share', id: 'social', items: [
          { path: '/social/accounts', label: 'Accounts', icon: 'users' },
          { path: '/social/composer', label: 'Post Composer', icon: 'pen' },
          { path: '/social/seo', label: 'AI SEO Studio', icon: 'sparkles' },
          { path: '/social/studio', label: 'Multi-Channel Studio', icon: 'video' },
          { path: '/social/languages', label: 'Languages', icon: 'lang' },
          { path: '/channels', label: 'Channel Network', icon: 'globe', count: (D.Store.load().channels || []).filter(c => c.status === 'active').length || 0 },
          { path: '/social/scheduler', label: 'Scheduler', icon: 'calendar', count: scheduled },
          { path: '/social/history', label: 'Publishing History', icon: 'clock' },
          { path: '/social/analytics', label: 'Analytics', icon: 'chart' }
        ]
      },
      { path: '/media', label: 'Media Library', icon: 'image', count: media },
      { path: '/games', label: 'Game Management', icon: 'gamepad', count: games },
      { path: '/downloads', label: 'Downloads', icon: 'download' },
      { path: '/analytics', label: 'Website Analytics', icon: 'chart' },
      {
        group: 'Company', icon: 'tag', id: 'company', items: [
          { path: '/revenue', label: 'Revenue', icon: 'chart' },
          { path: '/research', label: 'Market Research', icon: 'eye' },
          { path: '/costs', label: 'Cost & Budget', icon: 'tag' }
        ]
      },
      { path: '/announcements', label: 'Announcements', icon: 'megaphone', count: anns },
      { path: '/blog', label: 'Blog Manager', icon: 'pen', count: arts },
      { path: '/support', label: 'Contact & Support', icon: 'life' },
      { path: '/ads', label: 'Advertisement Manager', icon: 'tag' },
      { path: '/settings', label: 'Website Settings', icon: 'gear' },
      { path: '/system', label: 'System Status', icon: 'server' },
      {
        group: 'Classic CMS', icon: 'layers', id: 'classic', items: CLASSIC.map(([t, l]) => ({ href: '../?tab=' + t, label: l, external: true }))
      }
    ];
  }

  const TITLES = {
    '/overview': 'Overview', '/social/accounts': 'Social Accounts', '/social/composer': 'Post Composer',
    '/social/seo': 'AI SEO Studio', '/social/studio': 'Multi-Channel Studio', '/social/languages': 'Multi-Language Manager', '/social/scheduler': 'Publishing Scheduler',
    '/social/history': 'Publishing History', '/social/analytics': 'Social Analytics', '/media': 'Media Library',
    '/games': 'Game Management', '/downloads': 'Downloads', '/analytics': 'Website Analytics',
    '/announcements': 'Announcements', '/blog': 'Blog Manager', '/support': 'Contact & Support',
    '/ads': 'Advertisement Manager', '/settings': 'Website Settings', '/system': 'System Status',
    '/channels': 'Channel Network', '/revenue': 'Revenue', '/research': 'Market Research', '/costs': 'Cost & Budget',
    '/notifications': 'Notifications'
  };

  /* ------------------------------------------------------------------ router */
  function parseHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    const str = raw || '/overview';
    const i = str.indexOf('?');
    return { path: (i < 0 ? str : str.slice(0, i)) || '/overview', query: new URLSearchParams(i < 0 ? '' : str.slice(i + 1)) };
  }
  HQ.go = (path) => {
    const target = '#' + path;
    if (location.hash === target) render(); else location.hash = target;
  };

  function renderNav(path) {
    const nav = $('#hq-nav');
    const cols = localStorage.getItem('dc_hq_collapsed') === '1';
    const openGroups = JSON.parse(localStorage.getItem('dc_hq_groups') || '{"social":true,"classic":false}');
    const isIn = g => g.items.some(i => i.path && (path === i.path));
    nav.innerHTML = navModel().map(item => {
      if (item.items) {
        const open = openGroups[item.id] || isIn(item);
        return '<div class="grp' + (open ? ' open' : '') + '" data-group="' + item.id + '">' +
          '<button type="button" class="hq-navb">' + HQ.icon(item.icon) + '<span class="lbl">' + HQ.esc(item.group) + '</span>' +
          HQ.icon('chevron', 'chev') + '</button>' +
          '<div class="sub">' + item.items.map(i => {
            const on = i.path && path === i.path;
            return '<a href="' + (i.external ? i.href : '#' + i.path) + '"' + (on ? ' class="on"' : '') + '>' +
              (i.icon ? HQ.icon(i.icon) : '') + '<span class="lbl">' + HQ.esc(i.label) + '</span>' +
              (i.count ? '<span class="cnt">' + i.count + '</span>' : '') +
              (i.external ? '<span class="hq-tiny">↗</span>' : '') + '</a>';
          }).join('') + '</div></div>';
      }
      const on = path === item.path;
      return '<a href="#' + item.path + '"' + (on ? ' class="on"' : '') + '>' + HQ.icon(item.icon) +
        '<span class="lbl">' + HQ.esc(item.label) + '</span>' + (item.count ? '<span class="cnt">' + item.count + '</span>' : '') + '</a>';
    }).join('');

    nav.querySelectorAll('.grp > .hq-navb').forEach(b => {
      b.onclick = () => {
        const grp = b.parentElement;
        const id = grp.dataset.group;
        const open = grp.classList.toggle('open');
        const g = JSON.parse(localStorage.getItem('dc_hq_groups') || '{"social":true,"classic":false}');
        g[id] = open; localStorage.setItem('dc_hq_groups', JSON.stringify(g));
      };
    });
    $('#hq-shell').classList.toggle('col', cols);
  }

  let lastPath = null;
  async function render() {
    const { path, query } = parseHash();
    const view = HQ.views[path] || HQ.views['/overview'];
    const title = TITLES[path] || 'Overview';
    document.title = title + ' · DevChazers HQ';
    $('#crumb').innerHTML = '<b>' + HQ.esc(title) + '</b>';
    renderNav(path);
    /* A fresh mounted node every render: listeners attached by the previous view
       are garbage-collected instead of stacking up, while HQ's own view state
       (_days, _langSet, …) survives re-renders of the same route. */
    const holder = $('#view');
    const root = document.createElement('div');
    root.id = 'view';
    if (path === lastPath) Object.keys(holder).forEach(k => { if (k.charAt(0) === '_') root[k] = holder[k]; });
    holder.replaceWith(root);
    lastPath = path;
    HQ.closeAllModals();
    root._reload = () => render();
    try {
      await view(root, { query, path });
    } catch (e) {
      console.error(e);
      root.innerHTML = ui.page(ui.head({ title: title }) + ui.note({ tone: 'r', icon: 'alert', title: 'This view failed to render.', text: HQ.esc(e.message) }) +
        ui.card({ body: '<button type="button" class="btn" onclick="HQ.reload(true)">Reload</button>' }));
    }
    if (HQ.notificationCount && path !== '/notifications') {
      HQ.notificationCount().then(n => {
        try { localStorage.setItem('dc_hq_notif', String(n)); } catch (e) { }
        const badge = $('#notif-count');
        if (badge) { badge.textContent = n; badge.hidden = !n; }
      }).catch(() => { });
    }
    $('#hq-side').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /* -------------------------------------------------------------------- auth */
  async function boot() {
    HQ.state.live = !!DC.live;
    $('#hq-mode').innerHTML = DC.live
      ? '<span class="hq-chip g"><i class="hq-dot g"></i> Live</span>'
      : '<span class="hq-chip w"><i class="hq-dot w"></i> Demo</span>';

    if (!DC.live) {
      showModeBar();
      return start(false);
    }
    let ok = false, email = '';
    try {
      const c = D.client();
      if (c) { const { data } = await c.auth.getSession(); ok = !!(data && data.session); email = (data && data.session && data.session.user && data.session.user.email) || ''; }
      if (ok) ok = await DC.isAdmin();
    } catch (e) { ok = false; }
    if (ok) {
      HQ.state.session = true; HQ.state.user = email;
      await HQ.ensureServer(true);
      return start(true);
    }
    showGate();
  }

  function syncBarHeight() {
    const bar = $('#modebar');
    const h = bar && !bar.hidden ? bar.offsetHeight : 0;
    document.documentElement.style.setProperty('--hq-bar-h', h + 'px');
  }

  function showModeBar() {
    const bar = $('#modebar');
    bar.hidden = false;
    bar.className = 'hq-modebar';
    bar.innerHTML = HQ.icon('alert') + '<div class="grow"><b>Demo / offline mode.</b> supabase-js could not load in this preview, so no live Supabase data is read and nothing is uploaded. ' +
      'HQ drafts live in this browser only; game and page records shown are the site\'s own built-in fallback. Every live-only panel is labelled.</div>' +
      '<span class="hq-chip w">Read the banner, not as live data</span>';
    syncBarHeight();
    addEventListener('resize', syncBarHeight);
  }

  function showGate() {
    $('#gate').hidden = false;
    $('#app').hidden = true;
    const hint = (window.DC_CONFIG && window.DC_CONFIG.ADMIN_EMAIL) || '';
    if (hint) $('#gem').value = hint;
    $('#gbtn').disabled = false;
  }

  async function login() {
    const email = ($('#gem').value || '').trim(), pw = $('#gpw').value;
    $('#gpw').value = '';
    if (!email || !pw) { $('#gmsg').textContent = 'Enter email and password.'; return; }
    $('#gbtn').disabled = true; $('#gmsg').textContent = '';
    try {
      await DC.signIn(email, pw);
      if (await DC.isAdmin()) { HQ.state.session = true; HQ.state.user = email; $('#gate').hidden = true; return start(true); }
      await DC.signOut();
      $('#gmsg').textContent = 'This account is not an admin.';
    } catch (e) { $('#gmsg').textContent = 'Invalid email or password.'; }
    $('#gbtn').disabled = false;
  }

  async function start(live) {
    $('#gate').hidden = true;
    $('#app').hidden = false;
    const chip = $('#hq-mode');
    if (live && HQ.server.online) {
      chip.innerHTML = '<span class="hq-chip g"><i class="hq-dot g"></i> Live</span>' +
        '<span class="hq-chip g" title="Publish API reachable">' + HQ.icon('server') + ' Server</span>';
    }
    $('#user-chip').textContent = HQ.state.user || (live ? 'admin' : 'demo workspace');
    await Promise.all([HQ.ensureGames(), HQ.ensureMedia()]);
    if (!location.hash) location.hash = '#/overview';
    render();
    if (HQ.notificationCount) {
      HQ.notificationCount().then(n => {
        try { localStorage.setItem('dc_hq_notif', String(n)); } catch (e) { }
        const b = $('#notif-count'); if (b) { b.textContent = n; b.hidden = !n; }
      }).catch(() => { });
    }
  }

  /* ------------------------------------------------------------------- wiring */
  document.addEventListener('DOMContentLoaded', () => {
    $('#gbtn').onclick = login;
    $('#gpw').onkeydown = e => { if (e.key === 'Enter') login(); };
    $('#gem').onkeydown = e => { if (e.key === 'Enter') $('#gpw').focus(); };

    $('#menuBtn').onclick = () => $('#hq-side').classList.toggle('open');
    $('#collapseBtn').onclick = () => {
      const shell = $('#hq-shell');
      const next = !shell.classList.contains('col');
      shell.classList.toggle('col', next);
      localStorage.setItem('dc_hq_collapsed', next ? '1' : '0');
    };
    $('#tipsBtn').onclick = () => HQ.modal({
      title: 'How DevChazers HQ works',
      sub: 'Read this once — it explains every blank number you will see',
      size: 'lg',
      body: '<div class="hq-note a">' + HQ.icon('info') + '<div class="grow">HQ is a UI expansion. It reuses the existing Supabase tables (<code>games</code>, <code>pages</code>, <code>media</code>, <code>site_settings</code>, <code>admin_activity</code>) through the same <code>js/data-service.js</code> and adds a workspace for the new social/announcement/blog features.</div></div>' +
        '<div class="hq-list">' +
        [['share', 'Social accounts', 'Connect Account only shows a real connection when an OAuth token exists. Without a token the account stays <b>Authorization required</b> and publishing is disabled.'],
        ['send', 'Publishing', 'Drafts and schedules are saved immediately. Publish Now stays disabled until a platform token + publish endpoint exist — HQ never fakes a publish.'],
        ['chart', 'Analytics', 'Downloads, visitors and social metrics show dashes until a real source exists. You can still log real snapshot numbers (Downloads → Add snapshot).'],
        ['db', 'Where new data lives', 'Announcements, articles, posts, languages and snapshots are stored in this browser workspace. <code>hq-optional-schema.sql</code> + <code>CLOUD_TABLES</code> moves them to Supabase later.'],
        ['layers', 'Classic CMS', 'Everything that existed before is untouched — use the "Classic CMS" group for Ads, Pages, SEO and the original forms.']]
          .map(([ic, t, d]) => '<div class="hq-li"><div class="ic">' + HQ.icon(ic) + '</div><div class="bd2"><b>' + t + '</b><span style="line-height:1.55">' + d + '</span></div></div>').join('') +
        '</div>',
      footer: '<button type="button" class="btn" data-close>Got it</button><a class="btn pri" href="hq/INTEGRATION.md" target="_blank" rel="noopener">Integration guide ↗</a>'
    });

    $('#logoutBtn').onclick = async () => {
      const ok = await HQ.confirm('Sign out of DevChazers HQ?', { ok: 'Sign out' });
      if (!ok) return;
      await DC.signOut();
      location.reload();
    };
    addEventListener('scroll', () => { /* banner scrolls away; drawer stays below the header */ }, { passive: true });
    document.addEventListener('click', e => {
      if (window.innerWidth > 900) return;
      if (!$('#hq-side').classList.contains('open')) return;
      if (!e.target.closest('#hq-side') && !e.target.closest('#menuBtn')) $('#hq-side').classList.remove('open');
    });
    addEventListener('hashchange', render);
    if (localStorage.getItem('dc_hq_collapsed') === '1') $('#hq-shell').classList.add('col');
    boot();
  });

  HQ.boot = boot;
})();
