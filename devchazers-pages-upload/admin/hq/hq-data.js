/* ============================================================================
   DevChazers HQ — data layer
   ----------------------------------------------------------------------------
   Rules this file follows:
   • It never edits js/data-service.js or the Supabase project. It only *reads*
     the same public config and *reuses* window.DC for the existing tables
     (games / pages / media / site_settings / admin_activity).
   • New HQ-only entities (social accounts, posts, announcements, articles,
     messages, language sets, snapshots) have no tables in the current schema,
     so they live in a clearly-labelled LOCAL workspace (localStorage).
     To move them to Supabase later: run admin/hq/hq-optional-schema.sql, set
     HQ_CONFIG.CLOUD_TABLES = true and reload. Every method below is async so
     the switch needs no view changes.
   • Nothing here invents analytics, connections or publish results.
   ========================================================================== */
(function () {
  window.HQ = window.HQ || {};
  const C = window.DC_CONFIG || {};

  const HQ_CONFIG = window.HQ_CONFIG = {
    VERSION: '1.0.0',
    STORE_KEY: 'dc_hq_v1',
    /* Flip to true only after hq-optional-schema.sql has been applied. */
    CLOUD_TABLES: true,
    /* Optional AI endpoint for SEO Studio: POST JSON of the form inputs,
       expect JSON with keys title, description, hashtags, keywords, tags,
       caption, shorts_title, instagram, facebook, tiktok. Empty = template mode. */
    AI_ENDPOINT: '',
    /* Optional publish endpoint for the composer. Empty = publishing disabled. */
    PUBLISH_ENDPOINT: '',
    /* OAuth providers: paste a real authorize URL to switch Connect from
       "not configured" to a live redirect. Example:
       youtube: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?...' } */
    PROVIDERS: {
      youtube: { authUrl: '' }, facebook: { authUrl: '' }, instagram: { authUrl: '' },
      tiktok: { authUrl: '' }, x: { authUrl: '' }, linkedin: { authUrl: '' },
      pinterest: { authUrl: '' }, reddit: { authUrl: '' }, threads: { authUrl: '' }
    },
    MEDIA_MAX_IMAGE: 5 << 20,      // matches the classic CMS limit
    MEDIA_MAX_VIDEO: 64 << 20,
    IMAGE_TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'],
    VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']
  };

  /* ---------------------------------------------------------------- platforms */
  const PLATFORMS = [
    { id: 'youtube', name: 'YouTube', handle: '@yourchannel', kind: 'video', cls: 'pb-youtube', titleMax: 100, textMax: 5000, tagMax: 15 },
    { id: 'facebook', name: 'Facebook', handle: 'Page name', kind: 'post', cls: 'pb-facebook', titleMax: 200, textMax: 63206, tagMax: 30 },
    { id: 'instagram', name: 'Instagram', handle: '@yourhandle', kind: 'image', cls: 'pb-instagram', titleMax: 0, textMax: 2200, tagMax: 30 },
    { id: 'tiktok', name: 'TikTok', handle: '@yourhandle', kind: 'video', cls: 'pb-tiktok', titleMax: 0, textMax: 2200, tagMax: 20 },
    { id: 'x', name: 'X (Twitter)', handle: '@yourhandle', kind: 'post', cls: 'pb-x', titleMax: 0, textMax: 280, tagMax: 5 },
    { id: 'linkedin', name: 'LinkedIn', handle: 'Company page', kind: 'post', cls: 'pb-linkedin', titleMax: 200, textMax: 3000, tagMax: 10 },
    { id: 'pinterest', name: 'Pinterest', handle: '@yourprofile', kind: 'image', cls: 'pb-pinterest', titleMax: 100, textMax: 500, tagMax: 20 },
    { id: 'reddit', name: 'Reddit', handle: 'u/username', kind: 'post', cls: 'pb-reddit', titleMax: 300, textMax: 40000, tagMax: 10 },
    { id: 'threads', name: 'Threads', handle: '@yourhandle', kind: 'post', cls: 'pb-threads', titleMax: 0, textMax: 500, tagMax: 10 }
  ];

  const LANGUAGES = [
    { code: 'en', name: 'English', native: 'English', flag: '🇬🇧', rtl: false },
    { code: 'ur', name: 'Urdu', native: 'اردو', flag: '🇵🇰', rtl: true },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳', rtl: false },
    { code: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸', rtl: false },
    { code: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦', rtl: true },
    { code: 'pt', name: 'Portuguese', native: 'Português', flag: '🇧🇷', rtl: false },
    { code: 'fr', name: 'French', native: 'Français', flag: '🇫🇷', rtl: false },
    { code: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪', rtl: false },
    { code: 'tr', name: 'Turkish', native: 'Türkçe', flag: '🇹🇷', rtl: false },
    { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', flag: '🇮🇩', rtl: false },
    { code: 'ja', name: 'Japanese', native: '日本語', flag: '🇯🇵', rtl: false },
    { code: 'ko', name: 'Korean', native: '한국어', flag: '🇰🇷', rtl: false }
  ];


  /* compact 20x14 SVG flags (emoji flags do not render on Windows/older Linux,
     so HQ ships its own vector chips instead of relying on the font) */
  const FLAGS = {
    en: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="14" fill="#012169"/><path d="M0 0l20 14M20 0L0 14" stroke="#fff" stroke-width="2.6"/><path d="M0 0l20 14M20 0L0 14" stroke="#C8102E" stroke-width="1.1"/><path d="M10 0v14M0 7h20" stroke="#fff" stroke-width="4.4"/><path d="M10 0v14M0 7h20" stroke="#C8102E" stroke-width="2.4"/></svg>',
    ur: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="14" fill="#01411C"/><rect x="0" width="4.6" height="14" fill="#fff"/><circle cx="12" cy="7" r="3.4" fill="#fff"/><circle cx="13.3" cy="5.7" r="3.0" fill="#01411C"/><path d="M15.1 4.1l.5 1.4 1.4.2-1.1.9.3 1.4-1.1-.8-1.2.8.3-1.4-1-.9 1.4-.2z" fill="#fff"/></svg>',
    hi: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="4.67" fill="#FF9933"/><rect y="4.67" width="20" height="4.66" fill="#fff"/><rect y="9.33" width="20" height="4.67" fill="#138808"/><circle cx="10" cy="7" r="1.7" fill="none" stroke="#000080" stroke-width=".8"/></svg>',
    es: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="14" fill="#AA151B"/><rect y="3.5" width="20" height="7" fill="#F1BF00"/></svg>',
    ar: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="14" fill="#006C35"/><path d="M4.4 9.6c1.4.9 3.3 1 4.7.2" stroke="#fff" stroke-width=".9" fill="none" stroke-linecap="round"/><path d="M11 9.6c1.3.8 3 .9 4.3.2" stroke="#fff" stroke-width=".9" fill="none" stroke-linecap="round"/><path d="M13.6 4.4l.9 1.5" stroke="#fff" stroke-width=".8" stroke-linecap="round"/></svg>',
    pt: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="14" fill="#009C3B"/><path d="M10 2.1l8 4.9-8 4.9-8-4.9z" fill="#FFDF00"/><circle cx="10" cy="7" r="2.9" fill="#002776"/></svg>',
    fr: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="6.67" height="14" fill="#0055A4"/><rect x="6.67" width="6.66" height="14" fill="#fff"/><rect x="13.33" width="6.67" height="14" fill="#EF4135"/></svg>',
    de: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="4.67" fill="#111"/><rect y="4.67" width="20" height="4.66" fill="#DD0000"/><rect y="9.33" width="20" height="4.67" fill="#FFCE00"/></svg>',
    tr: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="14" fill="#E30A17"/><circle cx="8" cy="7" r="3.1" fill="#fff"/><circle cx="9.3" cy="7" r="2.5" fill="#E30A17"/><path d="M12.6 7l2.1-.7-1.3 1.8z" fill="#fff"/></svg>',
    id: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="7" fill="#CE1126"/><rect y="7" width="20" height="7" fill="#fff"/></svg>',
    ja: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="14" fill="#fff"/><circle cx="10" cy="7" r="4" fill="#BC002D"/></svg>',
    ko: '<svg viewBox="0 0 20 14" class="hq-flag"><rect width="20" height="14" fill="#fff"/><circle cx="10" cy="7" r="3.2" fill="#CD2E3A"/><path d="M6.8 7a3.2 3.2 0 006.4 0 1.6 1.6 0 01-3.2 0 1.6 1.6 0 00-3.2 0z" fill="#0047A0"/></svg>'
  };
  const flag = code => FLAGS[code] || FLAGS.en;

  const POST_STATUS = ['draft', 'scheduled', 'publishing', 'published', 'failed'];
  /* The seven release stages the studio asked for. `id` values are stable —
     existing saved games keep 'released' / 'testing' and simply gain the new
     stages they can move to. */
  const GAME_STATUS = [
    { id: 'development', name: 'In Development', tone: 'b' },
    { id: 'testing', name: 'Testing', tone: 'w' },
    { id: 'closed_testing', name: 'Closed Testing', tone: 'w' },
    { id: 'ready', name: 'Ready for Release', tone: 'o' },
    { id: 'released', name: 'Published', tone: 'g' },
    { id: 'maintenance', name: 'Maintenance', tone: 'o' },
    { id: 'discontinued', name: 'Discontinued', tone: 'm' }
  ];

  /* ------------------------------------------------------------------- utils */
  const uid = (p) => (p || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const nowISO = () => new Date().toISOString();
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ------------------------------------------------------------------- store */
  function blank() {
    return {
      v: 1,
      accounts: [], posts: [], seoSets: [], translationSets: [],
      announcements: [], articles: [], messages: [],
      mediaFolders: {}, gameMeta: {}, snapshots: [], settings: {}, activity: [],
      meta: { created_at: nowISO(), updated_at: nowISO() }
    };
  }
  const Store = {
    _cache: null,
    _available() { try { const k = '__hq_t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } },
    available: null,
    load() {
      if (this._cache) return this._cache;
      this.available = this._available();
      let data = null;
      if (this.available) {
        try { const raw = localStorage.getItem(HQ_CONFIG.STORE_KEY); if (raw) data = JSON.parse(raw); } catch (e) { data = null; }
      }
      this._cache = Object.assign(blank(), data || {});
      this._cache.meta = Object.assign({ created_at: nowISO(), updated_at: nowISO() }, this._cache.meta || {});
      return this._cache;
    },
    save() {
      const d = this.load();
      d.meta.updated_at = nowISO();
      if (this.available) {
        try { localStorage.setItem(HQ_CONFIG.STORE_KEY, JSON.stringify(d)); }
        catch (e) { if (window.HQ.toast) HQ.toast('Local workspace is full — remove some media/posts.', true); }
      }
      return d;
    },
    reset() { if (this.available) localStorage.removeItem(HQ_CONFIG.STORE_KEY); this._cache = null; return this.load(); },
    exportJSON() { return JSON.stringify(this.load(), null, 2); }
  };

  /* -------------------------------------------------- optional Supabase client */
  let sb = null;
  function client() {
    if (sb) return sb;
    if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY || !window.supabase) return null;
    try { sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY); } catch (e) { sb = null; }
    return sb;
  }

  /* cloud mode (opt-in) — same shape as the local collections */
  const CLOUD_MAP = {
    accounts: 'hq_social_accounts', posts: 'hq_social_posts', announcements: 'hq_announcements',
    articles: 'hq_articles', messages: 'contact_messages', translationSets: 'hq_translation_sets',
    seoSets: 'hq_seo_sets', snapshots: 'hq_metric_snapshots',
    revenue: 'hq_revenue', competitors: 'hq_competitors', channels: 'hq_channels'
  };
  const useCloud = (key) => !!(HQ_CONFIG.CLOUD_TABLES && client() && CLOUD_MAP[key]);

  /* ------------------------------------------------------------------ probes */
  const probeCache = {};
  async function probe(table) {
    if (probeCache[table]) return probeCache[table];
    if (!window.DC || !DC.live) return (probeCache[table] = { ok: false, reason: 'offline', message: 'Supabase is not reachable in this session.' });
    const c = client(); if (!c) return (probeCache[table] = { ok: false, reason: 'offline', message: 'supabase-js is not loaded.' });
    try {
      const { count, error } = await c.from(table).select('*', { count: 'exact', head: true });
      if (error) return (probeCache[table] = { ok: false, reason: 'error', message: error.message, code: error.code });
      return (probeCache[table] = { ok: true, count: count || 0 });
    } catch (e) {
      return (probeCache[table] = { ok: false, reason: 'error', message: e.message });
    }
  }
  const resetProbes = () => { Object.keys(probeCache).forEach(k => delete probeCache[k]); };

  /* ------------------------------------------------------------------ uploads */
  const extOf = (mime, name) => {
    const map = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
      'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'video/mp4': 'mp4', 'video/webm': 'webm',
      'video/quicktime': 'mov', 'video/ogg': 'ogv'
    };
    if (map[mime]) return map[mime];
    const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : 'bin';
  };
  const isImage = (mime, name) => HQ_CONFIG.IMAGE_TYPES.includes(mime) || /\.(png|jpe?g|webp|gif|svg|ico)$/i.test(name || '');
  const isVideo = (mime, name) => HQ_CONFIG.VIDEO_TYPES.includes(mime) || /\.(mp4|webm|mov|ogv)$/i.test(name || '');

  async function upload(file, folder) {
    const kind = isVideo(file.type, file.name) ? 'video' : isImage(file.type, file.name) ? 'image' : null;
    if (!kind) throw new Error('Unsupported file type: ' + (file.type || 'unknown'));
    const max = kind === 'video' ? HQ_CONFIG.MEDIA_MAX_VIDEO : HQ_CONFIG.MEDIA_MAX_IMAGE;
    if (file.size > max) throw new Error('"' + file.name + '" is larger than ' + Math.round(max / 1048576) + ' MB.');
    if (!window.DC || !DC.live) return { url: URL.createObjectURL(file), path: '', local: true, kind };
    const c = client(); if (!c) throw new Error('supabase-js is not loaded.');
    const path = (folder || 'hq') + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + extOf(file.type, file.name);
    const res = await c.storage.from('site-media').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (res.error) throw new Error(res.error.message);
    const url = c.storage.from('site-media').getPublicUrl(path).data.publicUrl;
    return { url, path, kind };
  }

  /* --------------------------------------------------------------- collections */
  function coll(key) {
    const d = Store.load();
    if (!Array.isArray(d[key])) d[key] = [];
    return d[key];
  }
  async function list(key) {
    if (useCloud(key)) {
      const c = client();
      const { data, error } = await c.from(CLOUD_MAP[key]).select('*').order('created_at', { ascending: false });
      if (!error) return data || [];
    }
    return clone(coll(key)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }
  async function create(key, row) {
    const item = Object.assign({ id: uid(key.slice(0, 3)), created_at: nowISO(), updated_at: nowISO() }, row);
    if (useCloud(key)) {
      const c = client();
      const { data, error } = await c.from(CLOUD_MAP[key]).insert(item).select().single();
      if (!error && data) return data;
      if (error) throw new Error(error.message);
    }
    coll(key).unshift(item); Store.save(); return clone(item);
  }
  async function update(key, id, patch) {
    if (useCloud(key)) {
      const c = client();
      const { data, error } = await c.from(CLOUD_MAP[key]).update(Object.assign({}, patch, { updated_at: nowISO() })).eq('id', id).select().single();
      if (!error && data) return data;
      if (error) throw new Error(error.message);
    }
    const arr = coll(key); const i = arr.findIndex(x => x.id === id);
    if (i < 0) throw new Error('Record not found');
    arr[i] = Object.assign({}, arr[i], patch, { updated_at: nowISO() });
    Store.save(); return clone(arr[i]);
  }
  async function remove(key, id) {
    if (useCloud(key)) {
      const c = client();
      const { error } = await c.from(CLOUD_MAP[key]).delete().eq('id', id);
      if (error) throw new Error(error.message);
    }
    const arr = coll(key); const i = arr.findIndex(x => x.id === id);
    if (i >= 0) { arr.splice(i, 1); Store.save(); }
    return true;
  }

  /* --------------------------------------------------------------- activity */
  function log(action, detail) {
    const d = Store.load();
    d.activity.unshift({ id: uid('a'), action, detail, at: nowISO() });
    d.activity = d.activity.slice(0, 200);
    Store.save();
  }

  /* ------------------------------------------------------------- HQ settings */
  async function getSettings() {
    let remote = {};
    try { if (window.DC) remote = await DC.getSettings(); } catch (e) { remote = {}; }
    return remote || {};
  }
  /* Writes only hq_* keys — never touches existing keys or the schema. */
  async function saveHQSettings(obj) {
    const d = Store.load();
    d.settings = Object.assign({}, d.settings, obj);
    Store.save();
    if (window.DC && DC.live) {
      const payload = {};
      Object.entries(obj).forEach(([k, v]) => { payload['hq_' + k] = String(v ?? ''); });
      await DC.saveSettings(payload);
    }
    return d.settings;
  }

  /* --------------------------------------------------------------- accounts */
  function accounts() {
    const saved = Store.load().accounts || [];
    return PLATFORMS.map(p => {
      const rec = saved.find(a => a.platform === p.id) || null;
      const status = !rec ? 'disconnected'
        : (rec.oauth && rec.oauth.linked_at) ? 'connected'
          : 'authorization_required';
      return { platform: p, record: rec, status };
    });
  }
  async function saveAccount(platformId, patch) {
    const d = Store.load();
    const i = d.accounts.findIndex(a => a.platform === platformId);
    const base = i >= 0 ? d.accounts[i] : { id: uid('acc'), platform: platformId, created_at: nowISO() };
    const rec = Object.assign({}, base, patch, { platform: platformId, updated_at: nowISO() });
    if (i >= 0) d.accounts[i] = rec; else d.accounts.push(rec);
    Store.save();
    return rec;
  }
  async function disconnectAccount(platformId) {
    const d = Store.load();
    d.accounts = d.accounts.filter(a => a.platform !== platformId);
    Store.save();
    return true;
  }

  /* ------------------------------------------------------------- media folders */
  const FOLDERS = ['Game Trailers', 'Gameplay', 'Shorts', 'Thumbnails', 'Screenshots', 'Company Branding', 'Marketing Materials'];
  function folderOf(mediaId) { return (Store.load().mediaFolders || {})[mediaId] || ''; }
  function setFolder(mediaId, folder) {
    const d = Store.load(); d.mediaFolders = d.mediaFolders || {};
    if (folder) d.mediaFolders[mediaId] = folder; else delete d.mediaFolders[mediaId];
    Store.save();
  }

  /* -------------------------------------------------------------- game extras */
  /* trailer / privacy URL / finer release status are HQ-side metadata because the
     live `games` table has no such columns. Nothing is written to Supabase. */
  function gameMeta(gameId) { return (Store.load().gameMeta || {})[gameId] || {}; }
  function setGameMeta(gameId, patch) {
    const d = Store.load(); d.gameMeta = d.gameMeta || {};
    d.gameMeta[gameId] = Object.assign({}, d.gameMeta[gameId] || {}, patch, { updated_at: nowISO() });
    Store.save();
  }
  function hqStatus(game) {
    const meta = gameMeta(game.id);
    if (meta.hq_status) return meta.hq_status;
    if (!game.published) return 'development';
    return game.status === 'available' ? 'released' : 'testing';
  }

  /* ---------------------------------------------------------------- snapshots */
  async function snapshots(kind) {
    const rows = (Store.load().snapshots || []).filter(s => !kind || s.kind === kind);
    return rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  function addSnapshot(row) {
    const d = Store.load();
    const item = Object.assign({ id: uid('snap'), created_at: nowISO() }, row);
    d.snapshots = (d.snapshots || []).filter(s => !(s.kind === item.kind && s.date === item.date && (s.game_id || '') === (item.game_id || '')));
    d.snapshots.push(item); Store.save(); return item;
  }
  function removeSnapshot(id) {
    const d = Store.load(); d.snapshots = (d.snapshots || []).filter(s => s.id !== id); Store.save();
  }

  /* ------------------------------------------------------------------- export */
  window.HQData = {
    PLATFORMS, LANGUAGES, POST_STATUS, GAME_STATUS, FOLDERS, FLAGS, flag,
    uid, nowISO, clone,
    Store, client, probe, resetProbes, useCloud, CLOUD_MAP,
    upload, isImage, isVideo, extOf,
    list, create, update, remove, log,
    getSettings, saveHQSettings,
    accounts, saveAccount, disconnectAccount,
    folderOf, setFolder, gameMeta, setGameMeta, hqStatus,
    snapshots, addSnapshot, removeSnapshot
  };
})();
