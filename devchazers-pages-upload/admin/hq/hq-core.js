/* ============================================================================
   DevChazers HQ — core UI kit
   Icons, formatting, dialogs, tables, empty states and hand-drawn SVG charts.
   No third-party libraries: the classic CMS ships none and HQ adds none.
   ========================================================================== */
(function () {
  const HQ = window.HQ = window.HQ || {};
  const D = window.HQData;

  /* ------------------------------------------------------------------ format */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d === undefined ? 0 : d });
  const bytes = n => {
    if (!n && n !== 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };
  const dtf = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  const date = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : dtf.format(d); };
  const dt = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const time = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
  const rel = v => {
    if (!v) return '';
    const t = new Date(v).getTime(); if (isNaN(t)) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return date(v);
  };
  const isoDay = d => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const clamp = (s, n) => { s = String(s || ''); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; };
  const slugify = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };

  /* ------------------------------------------------------------------- icons */
  const P = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15.5l-5-5L5 21"/>',
    gamepad: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M7 12h3M8.5 10.5v3M15.5 11.5h.01M18 13.5h.01"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    megaphone: '<path d="M3 11v2a1 1 0 001 1h2l4 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M14 8a4 4 0 010 8"/><path d="M17 5a8 8 0 010 14"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    life: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.6"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
    tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7-7A2 2 0 013 12.2V4a1 1 0 011-1h8.2a2 2 0 011.4.6l7 7a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    server: '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6.5h.01M6 17.5h.01"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    ext: '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6M10 14L21 3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    edit: '<path d="M11 4H4a1 1 0 00-1 1v15a1 1 0 001 1h15a1 1 0 001-1v-7"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z"/>',
    eye: '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18a2 2 0 001.7 3h16.6A2 2 0 0022 18L13.7 3.9a2 2 0 00-3.4 0z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    refresh: '<path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/>',
    link: '<path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M17 5.2a3.5 3.5 0 010 5.6M18.5 20a6.6 6.6 0 00-2-4.7"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.6 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3z"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 16l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>',
    lang: '<path d="M4 5h9M8.5 5c0 5-2 8-5 10"/><path d="M6.5 11c1.6 3 3.9 4.4 6 5"/><path d="M13 20l4-11 4 11M14.4 16.6h5.2"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    db: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    layers: '<path d="M12 2l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/>',
    send: '<path d="M21 3L3 10.5l7 3 3 7z"/><path d="M21 3l-8 15-3-4"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    bookmark: '<path d="M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z"/>',
    activity: '<path d="M22 12h-4l-3 8-4-16-3 8H2"/>',
    bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10.5 21a2 2 0 003 0"/>',
    shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a2 2 0 002 2h10a2 2 0 002-2V9M10 13h4"/>',
    reply: '<path d="M9 17l-5-5 5-5"/><path d="M4 12h11a5 5 0 015 5v2"/>'
  };
  /* platform glyphs — simple monochrome marks that inherit currentColor */
  const PLAT = {
    youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10.5 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none"/>',
    facebook: '<circle cx="12" cy="12" r="9.2"/><path d="M14.8 8.6h-1.6c-.9 0-1.3.5-1.3 1.4v1.3h2.7l-.4 2.5h-2.3V20"/><path d="M10 11.3h1.9"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/>',
    tiktok: '<path d="M14.5 3v9.6a3.1 3.1 0 11-3.1-3.1"/><path d="M14.5 5.6c.7 2 2.1 3.2 4.2 3.4"/>',
    x: '<path d="M4 4l16 16M20 4L4 20"/>',
    linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.5 10.5V17M7.5 7.6v.1M11.5 17v-3.6c0-1.4.8-2.3 2-2.3s2 .9 2 2.3V17"/>',
    pinterest: '<circle cx="12" cy="12" r="9.2"/><path d="M9.6 20l2.3-7.6"/><path d="M8.8 10.7c0-2.4 1.9-4.3 4.4-4.3 2.2 0 3.8 1.4 3.8 3.6 0 2.7-1.4 4.6-3.4 4.6-1 0-1.7-.7-1.5-1.6"/>',
    reddit: '<circle cx="12" cy="13" r="7.4"/><path d="M14.2 5.2l1.6 3.4"/><circle cx="15.9" cy="4.6" r="1.3"/><circle cx="9.6" cy="12.4" r="1"/><circle cx="14.4" cy="12.4" r="1"/><path d="M9.6 16c1.4 1.1 3.4 1.1 4.8 0"/>',
    threads: '<path d="M12.3 21c-4.6 0-7.6-2.9-7.6-9s3-9 7.6-9c3.3 0 5.6 1.4 6.6 3.9"/><path d="M9.2 14.4c0-2 1.7-3.4 4-3.4 2.6 0 4.1 1.5 4.1 4 0 2.6-1.7 4.3-4.2 4.3-1.7 0-3-.8-3.6-2"/><path d="M20.1 12.6c0 4.6-2.2 7-5.3 8"/>'
  };
  const icon = (n, cls) => '<svg class="hq-ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || P.info) + '</svg>';
  const platIcon = (id, cls) => '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PLAT[id] || PLAT.x) + '</svg>';

  /* -------------------------------------------------------------------- toast */
  let toastTimer = null;
  function toast(msg, isErr) {
    let t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast on' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, isErr ? 4600 : 3200);
  }

  /* ------------------------------------------------------------------- modals */
  const modalStack = [];
  function modal(opts) {
    const host = document.getElementById('modalHost');
    const wrap = document.createElement('div');
    wrap.className = 'hq-modal';
    const size = opts.size === 'lg' ? ' lg' : opts.size === 'sm' ? ' sm' : '';
    wrap.innerHTML = '<div class="hq-modal-box' + size + '" role="dialog" aria-modal="true">' +
      '<div class="hq-modal-h"><div><h3>' + esc(opts.title || '') + '</h3>' +
      (opts.sub ? '<div class="sub">' + esc(opts.sub) + '</div>' : '') + '</div>' +
      '<button type="button" class="x" data-close aria-label="Close">✕</button></div>' +
      '<div class="hq-modal-b">' + (opts.body || '') + '</div>' +
      (opts.footer === null ? '' : '<div class="hq-modal-f">' + (opts.footer || '<button type="button" class="btn" data-close>Close</button>') + '</div>') +
      '</div>';
    host.appendChild(wrap);
    const api = {
      el: wrap,
      close() {
        const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
        wrap.remove(); if (opts.onClose) opts.onClose();
      },
      q: s => wrap.querySelector(s),
      qa: s => [...wrap.querySelectorAll(s)]
    };
    modalStack.push(api);
    requestAnimationFrame(() => wrap.classList.add('open'));
    wrap.addEventListener('click', e => {
      if (e.target === wrap || e.target.closest('[data-close]')) { if (!opts.sticky) api.close(); }
    });
    if (opts.onMount) opts.onMount(api);
    return api;
  }
  function closeAllModals() { [...modalStack].forEach(m => m.close()); }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalStack.length) { e.stopPropagation(); modalStack[modalStack.length - 1].close(); }
  }, true);

  /* ------------------------------------------------------------------ confirm */
  function confirmBox(msg, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      /* one-shot: closing the dialog (Escape / backdrop / ✕) must not be able to
         win the race against an explicit Confirm click */
      let settled = false;
      const finish = v => { if (settled) return; settled = true; resolve(v); };
      const m = modal({
        title: opts.title || 'Please confirm',
        size: 'sm',
        body: '<p style="margin:0;font-size:13.5px;line-height:1.6;color:var(--tx)">' + esc(msg) + '</p>' +
          (opts.detail ? '<p class="hq-hint" style="margin:0">' + esc(opts.detail) + '</p>' : ''),
        footer: '<button type="button" class="btn" data-no>Cancel</button>' +
          '<button type="button" class="btn ' + (opts.danger ? 'dng' : 'pri') + '" data-yes>' + esc(opts.ok || 'Confirm') + '</button>',
        onClose: () => finish(false)
      });
      m.q('[data-no]').onclick = () => { finish(false); m.close(); };
      m.q('[data-yes]').onclick = () => { finish(true); m.close(); };
    });
  }

  /* ---------------------------------------------------------------- clipboard */
  async function copy(text, label) {
    const val = String(text ?? '');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(val);
      else {
        const ta = document.createElement('textarea'); ta.value = val; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      toast((label || 'Copied') + (val.length < 70 ? ': ' + val : ''));
      return true;
    } catch (e) { toast('Copy failed — select the text manually.', true); return false; }
  }
  const downloadFile = (name, content, mime) => {
    const blob = new Blob([content], { type: mime || 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };
  const csv = rows => rows.map(r => r.map(c => {
    const s = c === null || c === undefined ? '' : String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');

  /* --------------------------------------------------------------- ui helpers */
  const ui = {};

  ui.badge = (status) => {
    const map = {
      draft: ['m', 'Draft'], scheduled: ['b', 'Scheduled'], publishing: ['w', 'Publishing'], published: ['g', 'Published'],
      failed: ['r', 'Failed'], cancelled: ['m', 'Cancelled'],
      connected: ['g', 'Connected'], disconnected: ['m', 'Disconnected'], authorization_required: ['w', 'Authorization required'],
      released: ['g', 'Released'], development: ['b', 'Development'], testing: ['w', 'Testing'], maintenance: ['o', 'Maintenance'],
      available: ['g', 'Available'], coming_soon: ['o', 'Coming Soon'],
      public: ['g', 'Public'], private: ['r', 'Private'], archived: ['m', 'Archived'], unread: ['a', 'Unread'], read: ['m', 'Read'],
      expired: ['m', 'Expired'], live: ['g', 'Live'], ok: ['g', 'OK'], warn: ['w', 'Warning'], bad: ['r', 'Error']
    };
    const x = map[status] || ['m', String(status || '—')];
    return '<span class="bd ' + x[0] + '">' + esc(x[1]) + '</span>';
  };

  ui.stat = (o) => '<div class="hq-kpi">' +
    '<div class="top"><div class="ico ' + (o.tone || '') + '">' + icon(o.icon || 'activity') + '</div>' +
    (o.chip ? o.chip : '') + '</div>' +
    '<div class="v' + (o.na ? ' na' : '') + '">' + (o.value === null || o.value === undefined ? '—' : esc(o.value)) + '</div>' +
    '<div class="k">' + esc(o.label) + (o.note ? ' ' + o.note : '') + '</div>' +
    (o.foot ? '<div class="tagline">' + o.foot + '</div>' : '') +
    '</div>';

  ui.card = (o) => '<section class="hq-card' + (o.cls ? ' ' + o.cls : '') + '"' + (o.id ? ' id="' + o.id + '"' : '') + '>' +
    ((o.title || o.actions) ? '<div class="hq-card-h"><div><h2>' + esc(o.title || '') + '</h2>' +
      (o.sub ? '<div class="hint">' + esc(o.sub) + '</div>' : '') + '</div>' +
      (o.actions ? '<div class="hq-toolbar">' + o.actions + '</div>' : '') + '</div>' : '') +
    '<div class="hq-card-b' + (o.tight ? ' tight' : '') + '">' + (o.body || '') + '</div>' +
    (o.footer ? '<div class="hq-card-f">' + o.footer + '</div>' : '') +
    '</section>';

  ui.empty = (o) => '<div class="hq-empty' + (o.cls ? ' ' + o.cls : '') + '">' +
    '<div class="ic">' + icon(o.icon || 'info') + '</div>' +
    '<b>' + esc(o.title || 'Nothing here yet') + '</b>' +
    (o.text ? '<p>' + o.text + '</p>' : '') +
    (o.action || '') + '</div>';

  ui.note = (o) => '<div class="hq-note ' + (o.tone || '') + '">' + icon(o.icon || (o.tone === 'r' || o.tone === 'w' ? 'alert' : 'info')) +
    '<div class="grow">' + (o.title ? '<b>' + esc(o.title) + '</b> ' : '') + (o.text || '') + '</div>' +
    (o.action ? '<div>' + o.action + '</div>' : '') + '</div>';

  ui.tabs = (o) => '<div class="hq-tabs" data-tabs="' + esc(o.id || '') + '">' + o.items.map(it =>
    '<button type="button" data-tab="' + esc(it.id) + '"' + (it.id === o.active ? ' class="on"' : '') + '>' +
    (it.icon ? icon(it.icon) : '') + esc(it.label) +
    (it.count !== undefined && it.count !== null ? ' <span class="hq-tiny">' + it.count + '</span>' : '') + '</button>').join('') + '</div>';

  /* cols: [{t, cls, cell:(row,i)=>html}] */
  ui.table = (o) => {
    const rows = o.rows || [];
    if (!rows.length) return o.empty || ui.empty({ icon: o.icon || 'db', title: o.emptyTitle || 'No records', text: o.emptyText || '' });
    return '<div class="hq-tbl-wrap"><table class="hq-tbl' + (o.cls ? ' ' + o.cls : '') + '"><thead><tr>' +
      o.cols.map(c => '<th' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + esc(c.t) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map((r, i) => '<tr' + (o.rowAttr ? ' ' + o.rowAttr(r, i) : '') + '>' +
        o.cols.map(c => '<td data-l="' + esc(c.t) + '"' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + c.cell(r, i) + '</td>').join('') +
        '</tr>').join('') + '</tbody></table></div>';
  };

  ui.kv = (rows) => '<dl class="hq-kv">' + rows.map(([k, v, na]) =>
    '<dt>' + esc(k) + '</dt><dd class="' + (na ? 'na' : '') + '">' + (v === null || v === undefined || v === '' ? '—' : v) + '</dd>').join('') + '</dl>';

  ui.list = (items) => '<div class="hq-list">' + items.map(i => '<div class="hq-li">' +
    '<div class="ic">' + icon(i.icon || 'activity') + '</div>' +
    '<div class="bd2"><b>' + esc(i.title) + '</b>' + (i.text ? '<span>' + esc(i.text) + '</span>' : '') + '</div>' +
    (i.time ? '<time>' + esc(i.time) + '</time>' : '') + '</div>').join('') + '</div>';

  ui.chip = (label, tone, extra) => '<span class="hq-chip ' + (tone || '') + '">' + (extra || '') + esc(label) + '</span>';

  ui.metric = (o) => '<div class="hq-metric"><b class="' + (o.na ? 'na' : '') + '">' + esc(o.value ?? '—') + '</b><span>' + esc(o.label) + '</span>' +
    (o.progress !== undefined ? '<div class="hq-progress"><i style="width:' + Math.max(0, Math.min(100, o.progress)) + '%"></i></div>' : '') + '</div>';

  ui.field = (o) => '<label class="hq-field' + (o.full ? ' full' : '') + '">' +
    '<span>' + esc(o.label) + (o.req ? ' <span class="hq-req">*</span>' : '') + '</span>' + o.input +
    (o.hint ? '<small>' + esc(o.hint) + '</small>' : '') + '</label>';

  /* options accept: 'text' | {value,label} | ['value','Label'] */
  const optPair = o => {
    if (Array.isArray(o)) return { v: o[0], l: o.length > 1 ? o[1] : o[0] };
    if (o && typeof o === 'object') return { v: o.value, l: o.label === undefined ? o.value : o.label };
    return { v: o, l: o };
  };
  ui.select = (name, options, value, attrs) => '<select name="' + name + '"' + (attrs || '') + '>' +
    (options || []).map(o => {
      const p = optPair(o);
      return '<option value="' + esc(p.v) + '"' + (String(p.v) === String(value) ? ' selected' : '') + '>' + esc(p.l) + '</option>';
    }).join('') + '</select>';

  ui.dropzone = (o) => '<label class="hq-drop" id="' + esc(o.id) + '" data-drop="' + esc(o.id) + '">' + icon('upload') +
    '<b>' + esc(o.title || 'Drag & drop or click to upload') + '</b>' +
    '<span>' + (o.hint || '') + '</span>' +
    '<input type="file" ' + (o.multiple ? 'multiple ' : '') + 'accept="' + esc(o.accept || 'image/*') + '" data-input="' + esc(o.id) + '"></label>';

  ui.loading = (rows) => '<div class="hq-loading">' + Array.from({ length: rows || 3 }).map((_, i) =>
    '<div class="hq-skel" style="width:' + (92 - i * 12) + '%;height:' + (i === 0 ? 22 : 14) + 'px"></div>').join('') + '</div>';

  ui.page = (o) => '<div class="hq-page">' + o + '</div>';

  ui.head = (o) => '<div class="hq-head"><div><h1>' + esc(o.title) + '</h1>' +
    (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '</div>' +
    (o.actions ? '<div class="acts">' + o.actions + '</div>' : '') + '</div>';

  /* source state banner used by analytics views (never fake numbers) */
  ui.sourceState = (p, what) => {
    if (p.ok) return ui.note({ tone: 'g', icon: 'check', title: 'Source connected.', text: esc(what) + ' The table responded with ' + nf(p.count) + ' row(s).' });
    const msg = p.reason === 'offline'
      ? 'Supabase is not reachable in this session, so live numbers cannot be read.'
      : 'The source table is not part of the current database schema.';
    return ui.note({
      tone: 'w', icon: 'alert', title: 'No data source connected.',
      text: esc(msg) + ' HQ deliberately shows dashes and empty charts instead of invented statistics. ' +
        'See <b>admin/hq/INTEGRATION.md</b> for the exact table + snippet needed to switch this panel on.'
    });
  };

  /* ------------------------------------------------------------------- charts */
  const chartEmpty = (msg, h) => '<div class="hq-chart-empty" style="min-height:' + (h || 150) + 'px">' + icon('chart') +
    '<b>No data yet</b><span>' + esc(msg || 'This chart appears once a real data source is connected.') + '</span></div>';

  const tickFmt = (v, max) => {
    if (max >= 100) return nf(Math.round(v));
    if (max >= 10) return nf(Math.round(v * 10) / 10);
    if (max >= 2) return nf(Math.round(v * 10) / 10);
    return nf(v, 2);
  };
  const niceMax = (v) => {
    if (!v || v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  };

  function line(o) {
    const series = (o.series || []).filter(s => s.values && s.values.some(v => v !== null && v !== undefined));
    if (!series.length) return chartEmpty(o.empty, o.height);
    const W = 640, H = o.height || 180, padL = 38, padR = 10, padT = 12, padB = 24;
    const iw = W - padL - padR, ih = H - padT - padB;
    const all = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
    const max = niceMax(Math.max.apply(null, all));
    const n = Math.max(1, (series[0].values || []).length - 1);
    const x = i => padL + (iw * i) / n;
    const y = v => padT + ih - (ih * (v || 0)) / max;
    const gridN = 4;
    let g = '';
    for (let i = 0; i <= gridN; i++) {
      const gy = padT + (ih * i) / gridN;
      const val = max - (max * i) / gridN;
      g += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>' +
        '<text class="axis" x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end">' + tickFmt(val, max) + '</text>';
    }
    const defs = '<defs>' + series.map((s, si) =>
      '<linearGradient id="lg' + si + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s.color + '" stop-opacity=".28"/>' +
      '<stop offset="1" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient>').join('') + '</defs>';
    const paths = series.map((s, si) => {
      const pts = s.values.map((v, i) => x(i) + ',' + y(v)).join(' ');
      const area = 'M' + x(0) + ',' + (padT + ih) + ' L' + pts.split(' ').join(' L') + ' L' + x(s.values.length - 1) + ',' + (padT + ih) + ' Z';
      return '<polygon points="" fill="none"/><path d="' + area + '" fill="url(#lg' + si + ')"/>' +
        '<polyline points="' + pts + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
        s.values.map((v, i) => v === null ? '' : '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="2.6" fill="#0a0a14" stroke="' + s.color + '" stroke-width="1.8"/>').join('');
    }).join('');
    const labels = (o.labels || []).map((l, i) => (o.labels.length > 8 && i % Math.ceil(o.labels.length / 6) !== 0) ? '' :
      '<text class="lbl" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(l) + '</text>').join('');
    const legend = series.length > 1 ? '<div class="hq-legend" style="margin-top:8px">' + series.map(s =>
      '<span><i class="hq-dot" style="background:' + s.color + ';box-shadow:none"></i>' + esc(s.name || '') + '</span>').join('') + '</div>' : '';
    return '<div class="hq-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">' + defs +
      '<g class="grid">' + g + '</g>' + paths + labels + '</svg>' + legend + '</div>';
  }

  function bars(o) {
    const vals = (o.values || []).filter(v => v !== null && v !== undefined);
    if (!vals.length) return chartEmpty(o.empty, o.height);
    const W = 640, H = o.height || 180, padL = 38, padR = 10, padT = 12, padB = 26;
    const iw = W - padL - padR, ih = H - padT - padB;
    const max = niceMax(Math.max.apply(null, vals));
    const n = o.values.length, slot = iw / n, bw = Math.min(46, slot * 0.56);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const gy = padT + (ih * i) / 4, val = max - (max * i) / 4;
      g += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>' +
        '<text class="axis" x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end">' + tickFmt(val, max) + '</text>';
    }
    const bs = o.values.map((v, i) => {
      if (v === null || v === undefined) return '';
      const bx = padL + slot * i + (slot - bw) / 2;
      const h = Math.max(2, (ih * v) / max), by = padT + ih - h;
      return '<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + h + '" rx="5" fill="' + (o.color || '#00e5ff') + '" opacity=".85"/>';
    }).join('');
    const labels = (o.labels || []).map((l, i) => '<text class="lbl" x="' + (padL + slot * i + slot / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(l) + '</text>').join('');
    return '<div class="hq-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">' +
      '<g class="grid">' + g + '</g>' + bs + labels + '</svg></div>';
  }

  function donut(o) {
    const items = (o.items || []).filter(i => i.value > 0);
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!total) return chartEmpty(o.empty, o.height || 150);
    const size = o.size || 150, r = size / 2 - 12, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
    let off = 0;
    const segs = items.map(i => {
      const len = (i.value / total) * C;
      const s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + i.color + '" stroke-width="16" ' +
        'stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')" stroke-linecap="butt"/>';
      off += len; return s;
    }).join('');
    return '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '" style="width:' + size + 'px;height:' + size + 'px;flex:none">' + segs + '</svg>' +
      '<div class="hq-list" style="flex:1;min-width:120px">' + items.map(i =>
        '<div style="display:flex;align-items:center;gap:8px;font-size:12px"><i class="hq-dot" style="background:' + i.color + ';box-shadow:none"></i>' +
        '<span class="hq-muted" style="flex:1">' + esc(i.label) + '</span><b>' + nf(i.value) + '</b></div>').join('') + '</div></div>';
  }

  function sparkline(values, o) {
    o = o || {};
    const vals = (values || []).filter(v => v !== null && v !== undefined);
    if (vals.length < 2) return '<span class="hq-tiny">no trend yet</span>';
    const W = o.w || 120, H = o.h || 30, max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    const span = max - min || 1;
    const pts = vals.map((v, i) => (W * i) / (vals.length - 1) + ',' + (H - 2 - ((H - 4) * (v - min)) / span)).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:' + W + 'px;height:' + H + 'px" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="' + (o.color || '#00e5ff') + '" stroke-width="1.8" stroke-linecap="round"/></svg>';
  }

  /* horizontal bars (platform comparison etc.) — returns html, shows "—" when empty */
  function hbars(items, o) {
    o = o || {};
    if (!items.length) return chartEmpty(o.empty, o.height || 140);
    const max = Math.max.apply(null, items.map(i => i.value || 0)) || 1;
    return '<div class="hq-bars">' + items.map(i => {
      const v = i.value;
      const pct = v === null || v === undefined ? 0 : Math.max(1.5, (v / max) * 100);
      return '<div class="hq-bar-row' + (v === null || v === undefined ? ' mut' : '') + '">' +
        '<span class="nm">' + (i.platform ? platIcon(i.platform) : '') + esc(i.label) + '</span>' +
        '<span class="hq-bar-track"><i class="hq-bar-fill" style="width:' + pct + '%;' + (i.color ? 'background:' + i.color : '') + '"></i></span>' +
        '<span class="v">' + (v === null || v === undefined ? '—' : nf(v)) + '</span></div>';
    }).join('') + '</div>';
  }

  /* ---------------------------------------------------------------- utilities */
  function debounce(fn, ms) { let t; return function () { clearTimeout(t); const a = arguments, c = this; t = setTimeout(() => fn.apply(c, a), ms || 220); }; }
  function on(root, evt, sel, fn) {
    root.addEventListener(evt, e => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });
  }
  const formData = (form) => {
    const out = {};
    if (!form) return out;
    const els = form.elements ? [...form.elements] : [...form.querySelectorAll('input,select,textarea')];
    els.forEach(el => {
      if (el.disabled) return;
      if (!el.name) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  };
  const tagsFrom = s => String(s || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);
  const hashtagsFrom = s => tagsFrom(s).map(t => t.startsWith('#') ? t : '#' + t.replace(/[^A-Za-z0-9_]/g, ''));
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

  /* --------------------------------------------------------------- public API */
  Object.assign(HQ, {
    cfg: window.HQ_CONFIG,
    esc, nf, bytes, date, dt, time, rel, isoDay, monthName, clamp, slugify, safeUrl,
    icon, platIcon, PLAT,
    toast, modal, confirm: confirmBox, closeAllModals, copy, downloadFile, csv,
    ui, charts: { line, bars, donut, sparkline, empty: chartEmpty, hbars, niceMax },
    debounce, on, formData, tagsFrom, hashtagsFrom, hostOf
  });
  HQ.data = D;
})();
