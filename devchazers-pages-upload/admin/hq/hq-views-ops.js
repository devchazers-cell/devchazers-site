/* ============================================================================
   HQ views — Notifications & activity centre
   Everything here is DERIVED from real state (posts, accounts, probes, settings).
   No notification is invented; if nothing is wrong the list says so.
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData, ui = HQ.ui;

  const DISMISS_KEY = 'dc_hq_dismissed';

  function dismissed() {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); } catch (e) { return []; }
  }
  function dismiss(id) {
    const list = dismissed(); if (list.indexOf(id) < 0) list.push(id);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(list.slice(-200))); } catch (e) { }
  }
  function restoreAll() { try { localStorage.removeItem(DISMISS_KEY); } catch (e) { } }

  /* --------------------------------------------------------------- builders */
  async function collect() {
    const out = [];
    const now = Date.now();
    const posts = await D.list('posts');
    const accounts = await HQ.accountsModel();
    const settings = await HQ.ensureSettings();
    const snapshots = await D.snapshots();

    posts.filter(p => p.status === 'failed').forEach(p => out.push({
      id: 'failed:' + p.id, tone: 'r', icon: 'alert', kind: 'Publishing failed',
      title: p.title || 'Untitled post',
      text: (p.errors && p.errors[0]) ? (typeof p.errors[0] === 'string' ? p.errors[0] : (p.errors[0].error || p.errors[0].platform)) : 'The platform rejected this post.',
      at: p.updated_at || p.created_at, href: '#/social/history'
    }));

    posts.filter(p => p.status === 'scheduled').forEach(p => {
      const t = p.scheduled_at ? new Date(p.scheduled_at) : null;
      if (!t || isNaN(t)) { out.push({ id: 'nosched:' + p.id, tone: 'w', icon: 'calendar', kind: 'Scheduled without a time', title: p.title || 'Untitled post', text: 'This post is marked scheduled but has no valid date — open it and pick a time.', at: p.updated_at, href: '#/social/scheduler' }); return; }
      const diff = t.getTime() - now;
      if (diff < 0) out.push({
        id: 'due:' + p.id, tone: 'w', icon: 'clock', kind: 'Due now', title: p.title || 'Untitled post',
        text: 'Scheduled for ' + HQ.dt(p.scheduled_at) + ' and still queued. Open the scheduler to publish or reschedule.',
        at: p.scheduled_at, href: '#/social/scheduler'
      });
      else if (diff < 864e5) out.push({
        id: 'soon:' + p.id, tone: 'b', icon: 'calendar', kind: 'Publishing soon', title: p.title || 'Untitled post',
        text: 'Goes out ' + HQ.dt(p.scheduled_at) + ' · ' + (p.platforms || []).join(', '),
        at: p.scheduled_at, href: '#/social/scheduler'
      });
    });

    accounts.filter(a => a.status === 'authorization_required').forEach(a => out.push({
      id: 'auth:' + a.platform.id, tone: 'w', icon: 'lock', kind: 'Authorization required',
      title: a.platform.name + ' needs a token',
      text: (a.record && a.record.name ? a.record.name + ' is saved, ' : '') + 'but no OAuth token is stored, so nothing can publish there.',
      at: a.record && (a.record.updated_at || a.record.created_at), href: '#/social/accounts'
    }));

    accounts.filter(a => a.status === 'connected' && a.record && a.record.expires_at && new Date(a.record.expires_at).getTime() - now < 7 * 864e5).forEach(a => out.push({
      id: 'exp:' + a.platform.id, tone: 'r', icon: 'shield', kind: 'Token expiring',
      title: a.platform.name + ' token expires ' + HQ.date(a.record.expires_at),
      text: 'Reconnect before it lapses or scheduled posts will fail.',
      at: a.record.expires_at, href: '#/social/accounts'
    }));

    if (settings && settings.maintenance_mode === true) out.push({
      id: 'maint', tone: 'w', icon: 'lock', kind: 'Site state',
      title: 'Maintenance mode is ON', text: 'The public site shows the maintenance message to every visitor.', at: null, href: '#/settings'
    });

    const media = await HQ.ensureMedia();
    if (!HQ.state.mediaOk) out.push({
      id: 'mediafail', tone: 'r', icon: 'alert', kind: 'Storage',
      title: 'Media storage could not be read', text: 'Uploads and the library may be unavailable. Check System Status.', at: null, href: '#/system'
    });

    const postsAll = posts.length;
    if (postsAll > 200) out.push({
      id: 'storage', tone: 'w', icon: 'db', kind: 'Workspace size',
      title: postsAll + ' posts in this workspace',
      text: 'The browser store has a ~5 MB limit. Move to Supabase before it fills up.', at: null, href: '#/system'
    });

    const lastSnap = snapshots.map(s => s.created_at).filter(Boolean).sort().pop();
    if (!lastSnap) out.push({
      id: 'nosnap', tone: 'b', icon: 'chart', kind: 'Analytics',
      title: 'No analytics snapshot yet', text: 'Downloads and visitor numbers stay blank until you record a snapshot (Downloads → Add snapshot).', at: null, href: '#/downloads'
    });

    const dis = dismissed();
    return out.filter(n => dis.indexOf(n.id) < 0)
      .sort((a, b) => (b.tone === 'r') - (a.tone === 'r') || String(b.at || '').localeCompare(String(a.at || '')));
  }

  async function viewNotifications(root) {
    root.innerHTML = ui.page(ui.loading(4));
    await HQ.ensureServer();
    const items = await collect();
    const activity = (D.Store.load().activity || []).slice(0, 40);
    const red = items.filter(i => i.tone === 'r').length;

    root.innerHTML = ui.page(
      ui.head({
        title: 'Notifications',
        sub: 'Derived from your real queue and connections — not a feed of invented alerts.',
        actions: '<button type="button" class="btn" data-a="refresh">' + HQ.icon('refresh') + ' Re-check</button>' +
          (HQ.server.online ? '<button type="button" class="btn" data-a="flush">' + HQ.icon('send') + ' Publish due posts</button>' : '') +
          '<button type="button" class="btn" data-a="restore">' + HQ.icon('refresh') + ' Restore dismissed</button>'
      }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Open items', value: items.length, icon: 'bell', tone: 'p', foot: items.length ? 'Tap one to jump to it' : 'Nothing needs you' }) +
      ui.stat({ label: 'Errors', value: red, icon: 'alert', tone: 'k', foot: red ? 'Failed publishes / tokens' : 'No errors recorded' }) +
      ui.stat({ label: 'Activity entries', value: activity.length, icon: 'activity', tone: 'b', foot: 'Last 40 admin actions' }) +
      ui.stat({ label: 'Backend', value: HQ.server.online ? 'Online' : 'Static', icon: 'server', tone: HQ.server.online ? 'g' : 'w', foot: HQ.server.online ? 'Publish API reachable' : 'Drafts only' }) +
      '</div>' +

      ui.card({
        title: 'Needs attention', tight: true,
        body: items.length ? '<div class="hq-list" style="padding:12px">' + items.map(n =>
          '<div class="hq-li"><div class="ic">' + HQ.icon(n.icon) + '</div>' +
          '<div class="bd2"><b><span class="bd ' + n.tone + '" style="margin-right:6px">' + HQ.esc(n.kind) + '</span>' + HQ.esc(n.title) + '</b>' +
          '<span>' + HQ.esc(HQ.clamp(n.text, 150)) + '</span></div>' +
          (n.at ? '<time>' + HQ.esc(HQ.rel(n.at)) + '</time>' : '') +
          '<span class="hq-inline" style="gap:4px;margin-left:8px">' +
          (n.href ? '<a class="btn sm" href="' + n.href + '">Open</a>' : '') +
          '<button type="button" class="btn sm" data-dismiss="' + HQ.esc(n.id) + '" title="Dismiss">' + HQ.icon('x') + '</button></span></div>').join('') + '</div>'
          : ui.empty({ icon: 'check', title: 'Nothing needs attention', text: 'No failed posts, no expiring tokens, no due queue. This list fills itself from real state only.' })
      }) +

      '<div class="hq-2">' +
      ui.card({
        title: 'Activity log', sub: 'Every HQ action, newest first', tight: true,
        body: activity.length ? '<div class="hq-list" style="padding:8px 0">' + activity.map(a =>
          '<div class="hq-li"><div class="ic">' + HQ.icon('activity') + '</div><div class="bd2"><b>' + HQ.esc(String(a.action || '').replace(/_/g, ' ')) + '</b>' +
          '<span>' + HQ.esc(HQ.clamp(a.detail || '', 90)) + '</span></div><time>' + HQ.esc(HQ.rel(a.at)) + '</time></div>').join('') + '</div>'
          : ui.empty({ icon: 'activity', title: 'No actions yet', text: 'Create, schedule or delete something and it will appear here.', cls: 'sm' })
      }) +
      ui.card({
        title: 'What HQ notifies you about',
        tight: true,
        body: '<div class="hq-list">' + [
          ['send', 'Publishing', 'Failed posts and due-but-unsent scheduled posts.'],
          ['lock', 'Connections', 'Accounts without a token, or tokens expiring within 7 days.'],
          ['chart', 'Analytics', 'Missing snapshots that keep dashboards blank.'],
          ['db', 'Storage', 'Workspace size and unreadable media storage.'],
          ['bell', 'Site state', 'Maintenance mode left on.']
        ].map(([ic, t, x]) => '<div class="hq-li"><div class="ic">' + HQ.icon(ic) + '</div><div class="bd2"><b>' + HQ.esc(t) + '</b><span>' + HQ.esc(x) + '</span></div></div>').join('') + '</div>'
      }) +
      '</div>'
    );

    root.querySelector('[data-a="refresh"]').onclick = async () => { D.resetProbes(); await HQ.ensureServer(true); root._reload(); };
    root.querySelector('[data-a="restore"]').onclick = () => { restoreAll(); HQ.toast('Dismissed items restored.'); root._reload(); };
    const flush = root.querySelector('[data-a="flush"]');
    if (flush) flush.onclick = async () => {
      const ok = await HQ.confirm('Publish every scheduled post whose time has passed?', {
        detail: 'The server posts to each platform through its official API and records the result. Posts with no adapter stay queued and are reported back here.',
        ok: 'Publish due now'
      });
      if (!ok) return;
      try {
        const j = await HQ.flushDue();
        HQ.toast((j.flushed || 0) + ' post(s) processed.');
        D.log('publish_due_run', String(j.flushed || 0) + ' posts');
      } catch (e) { HQ.toast('Flush failed: ' + e.message, true); }
      root._reload();
    };
    HQ.on(root, 'click', '[data-dismiss]', (e, b) => { dismiss(b.dataset.dismiss); root._reload(); });
  }

  HQ.views['/notifications'] = viewNotifications;
  HQ.notificationCount = async () => (await collect()).length;
})();
