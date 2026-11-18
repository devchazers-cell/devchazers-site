/* ============================================================================
   DevChazers HQ — AI Manager · TOOL REGISTRY                    (server only)
   ----------------------------------------------------------------------------
   Har tool ke 3 hisse hain:

     (1) run(env, args)        → asli Supabase operation (service role, server-side)
     (2) verify(env, args, res)→ dobara DB se parh kar confirm karta hai ke change
                                 waqai hua (koi fake success nahi)
     (3) preview(env, args)    → approve karne se pehle before/after dikhata hai

   Categories (spec §6):
     A = safe, AI khud kar sakta hai (reads, drafts, previews)
     B = admin confirmation zaroori (live content, banner, maintenance, links)
     C = strong confirmation (delete). args.confirm === 'DELETE' lazmi.

   Table/columns asli project se liye gaye hain (information_schema se verify):
     games(id,slug,name,category,version,short_desc,full_desc,icon_url,icon_path,
           screenshots,apk_url,play_url,status,release_date,featured,published,…)
     pages(id,title,slug,status,visibility,seo_title,seo_description,content,…)
     media(id bigint,filename,mime,url,path,size_bytes,…)
     site_settings(key,value) · admin_activity(action,detail,created_at)
     hq_site_visits · hq_download_events · hq_social_accounts · hq_social_posts
   ========================================================================== */
import { svc, conf } from './_shared.js';

/* ------------------------------------------------------------------ helpers */
const enc = v => encodeURIComponent(String(v));
const num = (v, d = 0) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length <= n ? s : s.slice(0, n); };
const TODAY = () => new Date().toISOString().slice(0, 10);
const DAYS_AGO = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function getSettings(env) {
  const rows = await svc(env, 'site_settings?select=key,value');
  const out = {};
  (rows || []).forEach(r => { out[r.key] = r.value; });
  return out;
}

async function setSettings(env, obj) {
  const rows = Object.keys(obj).map(key => ({ key, value: String(obj[key] == null ? '' : obj[key]) }));
  if (!rows.length) return;
  await svc(env, 'site_settings', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows)
  });
}

async function getGame(env, key) {
  if (!key) return null;
  const bySlug = await svc(env, 'games?select=*&slug=eq.' + enc(key));
  if (bySlug && bySlug.length) return bySlug[0];
  const byName = await svc(env, 'games?select=*&name=ilike.' + enc('%' + key + '%'));
  return (byName && byName[0]) || null;
}

async function getPage(env, slug) {
  const rows = await svc(env, 'pages?select=*&slug=eq.' + enc(slug));
  return (rows && rows[0]) || null;
}

/* Writable site_settings keys the AI may touch (whitelist — spec §6). */
const SAFE_SETTING_KEYS = [
  'site_name', 'contact_email', 'about_text', 'support_text', 'footer_text',
  'homepage_title', 'homepage_description', 'social_discord', 'favicon_url',
  'show_about', 'show_games', 'show_news', 'show_support'
];

const GAME_WRITE_FIELDS = ['name', 'category', 'version', 'short_desc', 'full_desc', 'apk_url', 'play_url', 'status', 'release_date', 'featured', 'published'];

/* ============================================================================
   TOOLS
   ========================================================================== */
export const TOOLS = {

  /* ---------------------------------------------------------------- WEBSITE */
  get_website_status: {
    category: 'A', title: 'Website status',
    describe: 'Read the live website state: games, pages, media, maintenance mode, banner, popup and the newest activity. Use this first for "website ka status" style questions.',
    args: {},
    async run(env) {
      const [games, pages, media, settings] = await Promise.all([
        svc(env, 'games?select=id,name,published,status'),
        svc(env, 'pages?select=id,title,slug,status'),
        svc(env, 'media?select=id&limit=1'),
        getSettings(env)
      ]);
      const data = {
        games_total: (games || []).length,
        games_published: (games || []).filter(g => g.published).length,
        pages_total: (pages || []).length,
        pages_published: (pages || []).filter(p => p.status === 'published').length,
        media_rows: (media || []).length,
        maintenance_mode: settings.hq_maintenance_mode === 'true',
        banner_enabled: settings.hq_banner_enabled === 'true',
        banner_text: settings.hq_banner_text || '',
        popup_enabled: settings.hq_popup_enabled === 'true',
        settings_stored: Object.keys(settings).length
      };
      return { ok: true, summary: `${data.games_published}/${data.games_total} games published · ${data.pages_published}/${data.pages_total} pages live · maintenance ${data.maintenance_mode ? 'ON' : 'off'} · banner ${data.banner_enabled ? 'ON' : 'off'}`, data };
    }
  },

  get_website_settings: {
    category: 'A', title: 'Website settings',
    describe: 'Read every stored site_settings key (site name, contact email, about/support/footer text, homepage title/description, section visibility, hq_* controls).',
    args: {},
    async run(env) {
      const s = await getSettings(env);
      return { ok: true, summary: Object.keys(s).length + ' settings key(s) stored', data: s };
    }
  },

  get_pages: {
    category: 'A', title: 'List pages',
    describe: 'List CMS pages with slug, status and visibility.',
    args: {},
    async run(env) {
      const rows = await svc(env, 'pages?select=id,title,slug,status,visibility,updated_at&order=updated_at.desc');
      return { ok: true, summary: (rows || []).length + ' page(s)', data: rows || [] };
    }
  },

  get_page_content: {
    category: 'A', title: 'Read a page',
    describe: 'Read one CMS page by slug (e.g. privacy-policy, terms) including its HTML content and SEO fields.',
    args: { slug: { type: 'string', required: true, describe: 'page slug, e.g. privacy-policy' } },
    async run(env, a) {
      const p = await getPage(env, a.slug);
      if (!p) throw new Error('No page with slug "' + a.slug + '".');
      return { ok: true, summary: 'Page "' + p.title + '" (' + p.status + ')', data: p };
    }
  },

  /* ------------------------------------------------------------------ GAMES */
  list_games: {
    category: 'A', title: 'List games',
    describe: 'List every game with publish state, download link and Play link.',
    args: {},
    async run(env) {
      const rows = await svc(env, 'games?select=id,slug,name,category,status,published,featured,apk_url,play_url,updated_at&order=created_at.desc');
      return { ok: true, summary: (rows || []).length + ' game(s)', data: rows || [] };
    }
  },

  get_game_details: {
    category: 'A', title: 'Game details',
    describe: 'Full record of one game (descriptions, screenshots, links, publish flags).',
    args: { game: { type: 'string', required: true, describe: 'game slug or name' } },
    async run(env, a) {
      const g = await getGame(env, a.game);
      if (!g) throw new Error('No game matching "' + a.game + '".');
      return { ok: true, summary: g.name + ' — ' + (g.published ? 'published' : 'unpublished'), data: g };
    }
  },

  /* ------------------------------------------------------------------ MEDIA */
  list_media: {
    category: 'A', title: 'List media',
    describe: 'List media library rows (images/videos) with public URLs.',
    args: { limit: { type: 'number', describe: 'max rows, default 50' } },
    async run(env, a) {
      const n = Math.min(Math.max(num(a.limit, 50), 1), 200);
      const rows = await svc(env, 'media?select=id,filename,mime,url,path,size_bytes,created_at&order=created_at.desc&limit=' + n);
      return { ok: true, summary: (rows || []).length + ' media row(s)', data: rows || [] };
    }
  },

  /* -------------------------------------------------------------- ANALYTICS */
  get_visitor_analytics: {
    category: 'A', title: 'Visitor analytics',
    describe: 'Visitor numbers from hq_site_visits (total, per day, top paths). Returns honest zeros when no tracker is running.',
    args: { days: { type: 'number', describe: 'window in days, default 7' } },
    async run(env, a) {
      const days = Math.min(Math.max(num(a.days, 7), 1), 90);
      const rows = await svc(env, 'hq_site_visits?select=date,path,visits&date=gte.' + DAYS_AGO(days) + '&order=date.desc&limit=2000');
      const total = (rows || []).reduce((s, r) => s + num(r.visits), 0);
      const byPath = {};
      (rows || []).forEach(r => { byPath[r.path || '/'] = (byPath[r.path || '/'] || 0) + num(r.visits); });
      return {
        ok: true,
        summary: total ? total + ' visits in the last ' + days + ' day(s)' : 'No visitor rows yet in the last ' + days + ' day(s) (tracker not installed)',
        data: { days, total, rows: (rows || []).length, top_paths: Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 8) }
      };
    }
  },

  get_download_statistics: {
    category: 'A', title: 'Download statistics',
    describe: 'Download click events (hq_download_events) for the last N days.',
    args: { days: { type: 'number', describe: 'window in days, default 30' } },
    async run(env, a) {
      const days = Math.min(Math.max(num(a.days, 30), 1), 365);
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const rows = await svc(env, 'hq_download_events?select=game_slug,source,created_at&created_at=gte.' + enc(since) + '&limit=5000');
      const byGame = {};
      (rows || []).forEach(r => { byGame[r.game_slug || 'unknown'] = (byGame[r.game_slug || 'unknown'] || 0) + 1; });
      return {
        ok: true,
        summary: (rows || []).length ? (rows || []).length + ' download clicks in ' + days + ' day(s)' : 'No download events recorded in the last ' + days + ' day(s)',
        data: { days, total: (rows || []).length, by_game: byGame }
      };
    }
  },

  /* ----------------------------------------------------------------- SOCIAL */
  get_connected_accounts: {
    category: 'A', title: 'Social accounts',
    describe: 'Which social accounts have a real OAuth token (never returns tokens).',
    args: {},
    async run(env) {
      const rows = await svc(env, 'hq_social_accounts?select=platform,name,username,status,last_sync,expires_at&order=platform.asc');
      const connected = (rows || []).filter(r => r.status === 'connected');
      return { ok: true, summary: connected.length + ' connected account(s)', data: { accounts: rows || [], connected: connected.map(r => r.platform) } };
    }
  },

  get_publish_status: {
    category: 'A', title: 'Publish queue',
    describe: 'Recent social posts and their real status (draft / scheduled / published / failed).',
    args: { limit: { type: 'number' } },
    async run(env, a) {
      const n = Math.min(Math.max(num(a.limit, 10), 1), 50);
      const rows = await svc(env, 'hq_social_posts?select=id,title,status,platforms,scheduled_at,published_at,published_urls,errors&order=created_at.desc&limit=' + n);
      return { ok: true, summary: (rows || []).length + ' post(s) in the queue', data: rows || [] };
    }
  },

  /* ----------------------------------------------------------------- SYSTEM */
  get_system_status: {
    category: 'A', title: 'System status',
    describe: 'Server readiness: Supabase config, service role, token key, AI key, table reachability and row counts.',
    args: {},
    async run(env) {
      const c = conf(env);
      const tables = ['games', 'pages', 'media', 'site_settings', 'hq_social_accounts', 'hq_social_posts', 'hq_ai_keys'];
      const reach = {};
      for (const t of tables) {
        try { await svc(env, t + '?select=*&limit=1'); reach[t] = true; } catch (e) { reach[t] = false; }
      }
      const data = {
        supabase_url: !!c.url, supabase_anon: !!c.anon, service_role: !!c.svc,
        token_key: !!(env.HQ_TOKEN_KEY && String(env.HQ_TOKEN_KEY).length >= 16),
        cron_secret: !!env.HQ_CRON_SECRET,
        tables: reach
      };
      const bad = Object.keys(reach).filter(k => !reach[k]);
      return { ok: true, summary: bad.length ? 'Missing/unreachable tables: ' + bad.join(', ') : 'All core tables reachable', data };
    }
  },

  get_recent_activity: {
    category: 'A', title: 'Recent activity',
    describe: 'Newest rows from admin_activity (what happened on the site/CMS).',
    args: { limit: { type: 'number' } },
    async run(env, a) {
      const n = Math.min(Math.max(num(a.limit, 15), 1), 100);
      const rows = await svc(env, 'admin_activity?select=action,detail,created_at&order=created_at.desc&limit=' + n);
      return { ok: true, summary: (rows || []).length + ' activity row(s)', data: rows || [] };
    }
  },

  /* ================================================== B · CONFIRM REQUIRED */

  update_homepage_banner: {
    category: 'B', title: 'Homepage banner',
    describe: 'Show or change the announcement banner at the top of the public website. Writes hq_banner_* settings which js/site-controls.js renders.',
    args: {
      enabled: { type: 'boolean', required: true, describe: 'show the banner?' },
      text: { type: 'string', describe: 'banner message (max 160 chars)' },
      link: { type: 'string', describe: 'optional URL the banner opens' },
      tone: { type: 'string', enum: ['info', 'success', 'warn'], describe: 'colour' }
    },
    async preview(env, a) {
      const s = await getSettings(env);
      return {
        title: 'Homepage banner',
        before: { enabled: s.hq_banner_enabled === 'true', text: s.hq_banner_text || '', link: s.hq_banner_link || '', tone: s.hq_banner_tone || 'info' },
        after: { enabled: !!a.enabled, text: clip(a.text || s.hq_banner_text || '', 160), link: a.link !== undefined ? String(a.link) : (s.hq_banner_link || ''), tone: a.tone || s.hq_banner_tone || 'info' },
        note: 'Visible on https://devchazers.site after the visitor reloads.'
      };
    },
    async run(env, a) {
      const patch = { hq_banner_enabled: a.enabled ? 'true' : 'false' };
      if (a.text !== undefined) patch.hq_banner_text = clip(a.text, 160);
      if (a.link !== undefined) patch.hq_banner_link = clip(a.link, 300);
      if (a.tone !== undefined) patch.hq_banner_tone = ['info', 'success', 'warn'].includes(a.tone) ? a.tone : 'info';
      if (a.enabled && !patch.hq_banner_text) {
        const s = await getSettings(env);
        if (!s.hq_banner_text) throw new Error('Banner text is required when enabling the banner.');
      }
      await setSettings(env, patch);
      return { ok: true, summary: a.enabled ? 'Banner ON — "' + (patch.hq_banner_text || '') + '"' : 'Banner OFF', data: patch };
    },
    async verify(env, a) {
      const s = await getSettings(env);
      const on = s.hq_banner_enabled === 'true';
      return { verified: on === !!a.enabled && (!a.enabled || (s.hq_banner_text || '') === clip(a.text !== undefined ? a.text : s.hq_banner_text || '', 160)), after: { enabled: on, text: s.hq_banner_text || '' } };
    }
  },

  set_maintenance_mode: {
    category: 'B', title: 'Maintenance mode',
    describe: 'Turn the public website maintenance overlay ON/OFF (js/site-controls.js). Visitors see a notice instead of the site.',
    args: { enabled: { type: 'boolean', required: true }, message: { type: 'string', describe: 'message shown to visitors (max 240)' } },
    async preview(env, a) {
      const s = await getSettings(env);
      return {
        title: 'Maintenance mode',
        before: { enabled: s.hq_maintenance_mode === 'true', message: s.hq_maintenance_message || '' },
        after: { enabled: !!a.enabled, message: clip(a.message || s.hq_maintenance_message || '', 240) },
        note: 'Admin pages (/admin, /admin/hq) are never affected.'
      };
    },
    async run(env, a) {
      const patch = { hq_maintenance_mode: a.enabled ? 'true' : 'false' };
      if (a.message !== undefined) patch.hq_maintenance_message = clip(a.message, 240);
      await setSettings(env, patch);
      return { ok: true, summary: a.enabled ? 'Maintenance mode ON' : 'Maintenance mode OFF', data: patch };
    },
    async verify(env, a) {
      const s = await getSettings(env);
      return { verified: (s.hq_maintenance_mode === 'true') === !!a.enabled, after: { enabled: s.hq_maintenance_mode === 'true' } };
    }
  },

  update_popup: {
    category: 'B', title: 'Announcement popup',
    describe: 'Show a once-per-day announcement popup on the public website.',
    args: { enabled: { type: 'boolean', required: true }, title: { type: 'string' }, body: { type: 'string' }, image: { type: 'string' } },
    async preview(env, a) {
      const s = await getSettings(env);
      return {
        title: 'Announcement popup',
        before: { enabled: s.hq_popup_enabled === 'true', title: s.hq_popup_title || '', body: s.hq_popup_body || '' },
        after: { enabled: !!a.enabled, title: clip(a.title || s.hq_popup_title || '', 90), body: clip(a.body || s.hq_popup_body || '', 400) },
        note: 'Shown once per browser per day.'
      };
    },
    async run(env, a) {
      const patch = { hq_popup_enabled: a.enabled ? 'true' : 'false' };
      if (a.title !== undefined) patch.hq_popup_title = clip(a.title, 90);
      if (a.body !== undefined) patch.hq_popup_body = clip(a.body, 400);
      if (a.image !== undefined) patch.hq_popup_image = clip(a.image, 300);
      await setSettings(env, patch);
      return { ok: true, summary: a.enabled ? 'Popup ON' : 'Popup OFF', data: patch };
    },
    async verify(env, a) {
      const s = await getSettings(env);
      return { verified: (s.hq_popup_enabled === 'true') === !!a.enabled, after: { enabled: s.hq_popup_enabled === 'true' } };
    }
  },

  update_website_setting: {
    category: 'B', title: 'Website setting',
    describe: 'Change one whitelisted site_setting: ' + SAFE_SETTING_KEYS.join(', ') + '.',
    args: { key: { type: 'string', required: true, enum: SAFE_SETTING_KEYS }, value: { type: 'string', required: true } },
    async preview(env, a) {
      const s = await getSettings(env);
      return { title: 'Setting: ' + a.key, before: { [a.key]: s[a.key] || '' }, after: { [a.key]: clip(a.value, 400) }, note: 'Rendered by js/site.js on the next page load.' };
    },
    async run(env, a) {
      if (!SAFE_SETTING_KEYS.includes(a.key)) throw new Error('Key "' + a.key + '" is not AI-writable.');
      await setSettings(env, { [a.key]: clip(a.value, 400) });
      return { ok: true, summary: a.key + ' updated', data: { [a.key]: a.value } };
    },
    async verify(env, a) {
      const s = await getSettings(env);
      return { verified: String(s[a.key] || '') === String(clip(a.value, 400)), after: { [a.key]: s[a.key] || '' } };
    }
  },

  update_page_content: {
    category: 'B', title: 'Update a page',
    describe: 'Update an existing CMS page: title, HTML content, SEO title/description, status, visibility.',
    args: {
      slug: { type: 'string', required: true },
      title: { type: 'string' }, content: { type: 'string' },
      seo_title: { type: 'string' }, seo_description: { type: 'string' },
      status: { type: 'string', enum: ['published', 'draft'] }, visibility: { type: 'string', enum: ['public', 'private'] }
    },
    async preview(env, a) {
      const p = await getPage(env, a.slug);
      if (!p) throw new Error('No page with slug "' + a.slug + '".');
      const after = {};
      ['title', 'content', 'seo_title', 'seo_description', 'status', 'visibility'].forEach(k => { if (a[k] !== undefined) after[k] = a[k]; });
      return { title: 'Page: ' + p.title, before: { title: p.title, content: clip(p.content, 400), status: p.status, visibility: p.visibility }, after: Object.assign({ title: p.title, status: p.status, visibility: p.visibility }, after), note: 'Live at /' + p.slug };
    },
    async run(env, a) {
      const p = await getPage(env, a.slug);
      if (!p) throw new Error('No page with slug "' + a.slug + '".');
      const patch = { updated_at: new Date().toISOString() };
      ['title', 'content', 'seo_title', 'seo_description', 'status', 'visibility'].forEach(k => { if (a[k] !== undefined) patch[k] = clip(a[k], 20000); });
      await svc(env, 'pages?id=eq.' + enc(p.id), { method: 'PATCH', body: JSON.stringify(patch), headers: { prefer: 'return=minimal' } });
      return { ok: true, summary: 'Page "' + (patch.title || p.title) + '" updated', data: patch };
    },
    async verify(env, a) {
      const p = await getPage(env, a.slug);
      if (!p) return { verified: false };
      const checks = ['title', 'status', 'visibility', 'seo_title', 'seo_description'].filter(k => a[k] !== undefined).map(k => String(p[k] || '') === String(a[k]));
      const contentOk = a.content === undefined || String(p.content || '') === String(clip(a.content, 20000));
      return { verified: checks.every(Boolean) && contentOk, after: { title: p.title, status: p.status, updated_at: p.updated_at } };
    }
  },

  create_page: {
    category: 'B', title: 'Create a page',
    describe: 'Create a new CMS page (slug auto-generated from the title).',
    args: {
      title: { type: 'string', required: true }, content: { type: 'string', required: true },
      slug: { type: 'string' }, status: { type: 'string', enum: ['published', 'draft'] },
      visibility: { type: 'string', enum: ['public', 'private'] }
    },
    async preview(env, a) {
      const slug = (a.slug || a.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
      const exists = await getPage(env, slug);
      if (exists) throw new Error('A page with slug "' + slug + '" already exists.');
      return { title: 'New page', before: null, after: { title: a.title, slug, status: a.status || 'published', visibility: a.visibility || 'public' }, note: 'Will be live at /' + slug };
    },
    async run(env, a) {
      const slug = (a.slug || a.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
      const row = { title: clip(a.title, 200), slug, content: clip(a.content, 20000), status: a.status || 'published', visibility: a.visibility || 'public' };
      const res = await svc(env, 'pages', { method: 'POST', body: JSON.stringify(row) });
      return { ok: true, summary: 'Page /' + slug + ' created', data: Array.isArray(res) ? res[0] : res };
    },
    async verify(env, a) {
      const slug = (a.slug || a.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
      const p = await getPage(env, slug);
      return { verified: !!p, after: p ? { title: p.title, status: p.status } : null };
    }
  },

  update_game: {
    category: 'B', title: 'Update a game',
    describe: 'Update game fields: name, category, version, short_desc, full_desc, apk_url, play_url, status, release_date, featured, published.',
    args: {
      game: { type: 'string', required: true, describe: 'slug or name' },
      name: { type: 'string' }, category: { type: 'string' }, version: { type: 'string' },
      short_desc: { type: 'string' }, full_desc: { type: 'string' },
      apk_url: { type: 'string' }, play_url: { type: 'string' },
      status: { type: 'string', enum: ['available', 'coming_soon'] },
      release_date: { type: 'string' }, featured: { type: 'boolean' }, published: { type: 'boolean' }
    },
    async preview(env, a) {
      const g = await getGame(env, a.game);
      if (!g) throw new Error('No game matching "' + a.game + '".');
      const before = {}; const after = {};
      GAME_WRITE_FIELDS.forEach(k => { if (a[k] !== undefined) { before[k] = g[k]; after[k] = a[k]; } });
      if (!Object.keys(after).length) throw new Error('No game field given to change.');
      return { title: 'Game: ' + g.name, before, after, note: 'Live on https://devchazers.site/#games' };
    },
    async run(env, a) {
      const g = await getGame(env, a.game);
      if (!g) throw new Error('No game matching "' + a.game + '".');
      const patch = { updated_at: new Date().toISOString() };
      GAME_WRITE_FIELDS.forEach(k => { if (a[k] !== undefined) patch[k] = typeof a[k] === 'string' ? clip(a[k], 4000) : a[k]; });
      await svc(env, 'games?id=eq.' + enc(g.id), { method: 'PATCH', body: JSON.stringify(patch), headers: { prefer: 'return=minimal' } });
      return { ok: true, summary: g.name + ': ' + Object.keys(patch).filter(k => k !== 'updated_at').join(', ') + ' updated', data: patch };
    },
    async verify(env, a) {
      const g = await getGame(env, a.game);
      if (!g) return { verified: false };
      const ok = GAME_WRITE_FIELDS.filter(k => a[k] !== undefined).every(k => String(g[k] == null ? '' : g[k]) === String(a[k]));
      return { verified: ok, after: { name: g.name, published: g.published, status: g.status, apk_url: g.apk_url || '' } };
    }
  },

  create_game: {
    category: 'B', title: 'Create a game',
    describe: 'Create a new game record. It stays unpublished unless published=true is explicitly given.',
    args: {
      name: { type: 'string', required: true }, category: { type: 'string' }, version: { type: 'string' },
      short_desc: { type: 'string' }, full_desc: { type: 'string' },
      apk_url: { type: 'string' }, play_url: { type: 'string' },
      status: { type: 'string', enum: ['available', 'coming_soon'] },
      published: { type: 'boolean' }
    },
    async preview(env, a) {
      const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const exists = await getGame(env, slug);
      if (exists) throw new Error('A game with slug "' + slug + '" already exists — use update_game instead.');
      return { title: 'New game', before: null, after: { name: a.name, slug, status: a.status || 'coming_soon', published: !!a.published }, note: 'Only appears publicly when published=true.' };
    },
    async run(env, a) {
      const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const row = {
        name: clip(a.name, 120), slug, category: clip(a.category || 'Game', 60), version: clip(a.version || '1.0', 20),
        short_desc: clip(a.short_desc || '', 300), full_desc: clip(a.full_desc || '', 8000),
        apk_url: clip(a.apk_url || '', 500), play_url: clip(a.play_url || '', 500),
        status: a.status || 'coming_soon', published: !!a.published, featured: false,
        screenshots: [], icon_url: '', icon_path: ''
      };
      const res = await svc(env, 'games', { method: 'POST', body: JSON.stringify(row) });
      return { ok: true, summary: 'Game "' + row.name + '" created (' + (row.published ? 'published' : 'not published') + ')', data: Array.isArray(res) ? res[0] : res };
    },
    async verify(env, a) {
      const g = await getGame(env, a.name);
      return { verified: !!g, after: g ? { name: g.name, slug: g.slug, published: g.published } : null };
    }
  },

  update_game_download_link: {
    category: 'B', title: 'Download link',
    describe: 'Change only the APK (Drive) link and/or the Google Play link of a game.',
    args: { game: { type: 'string', required: true }, apk_url: { type: 'string' }, play_url: { type: 'string' } },
    async preview(env, a) {
      const g = await getGame(env, a.game);
      if (!g) throw new Error('No game matching "' + a.game + '".');
      return { title: 'Download links: ' + g.name, before: { apk_url: g.apk_url || '', play_url: g.play_url || '' }, after: { apk_url: a.apk_url !== undefined ? a.apk_url : g.apk_url || '', play_url: a.play_url !== undefined ? a.play_url : g.play_url || '' } };
    },
    async run(env, a) {
      const g = await getGame(env, a.game);
      if (!g) throw new Error('No game matching "' + a.game + '".');
      const patch = { updated_at: new Date().toISOString() };
      if (a.apk_url !== undefined) patch.apk_url = clip(a.apk_url, 500);
      if (a.play_url !== undefined) patch.play_url = clip(a.play_url, 500);
      if (Object.keys(patch).length < 2) throw new Error('Give apk_url and/or play_url.');
      await svc(env, 'games?id=eq.' + enc(g.id), { method: 'PATCH', body: JSON.stringify(patch), headers: { prefer: 'return=minimal' } });
      return { ok: true, summary: g.name + ' download link updated', data: patch };
    },
    async verify(env, a) {
      const g = await getGame(env, a.game);
      return { verified: !!g && (a.apk_url === undefined || g.apk_url === a.apk_url) && (a.play_url === undefined || g.play_url === a.play_url), after: g ? { apk_url: g.apk_url || '', play_url: g.play_url || '' } : null };
    }
  },

  prepare_social_post: {
    category: 'A', title: 'Prepare a social draft',
    describe: 'Create a social post DRAFT in hq_social_posts (never publishes). Use for "YouTube ke liye prepare karo".',
    args: {
      title: { type: 'string', required: true }, body: { type: 'string' },
      platforms: { type: 'string', describe: 'comma separated: youtube,facebook,instagram,x' },
      hashtags: { type: 'string' }, language: { type: 'string' }
    },
    async run(env, a) {
      const platforms = String(a.platforms || 'youtube').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const row = {
        title: clip(a.title, 200), body: clip(a.body || '', 5000),
        hashtags: clip(a.hashtags || '', 300), language: clip(a.language || 'en', 8),
        platforms, status: 'draft', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      const res = await svc(env, 'hq_social_posts', { method: 'POST', body: JSON.stringify(row), headers: { prefer: 'resolution=merge-duplicates,return=representation' } });
      const saved = Array.isArray(res) ? res[0] : res;
      return { ok: true, summary: 'Draft saved for ' + platforms.join(', ') + ' (nothing published)', data: saved };
    }
  },

  /* ================================================ C · STRONG CONFIRMATION */

  delete_page: {
    category: 'C', title: 'Delete a page',
    describe: 'Permanently delete a CMS page. Requires confirm="DELETE".',
    args: { slug: { type: 'string', required: true }, confirm: { type: 'string', required: true, describe: 'must be exactly DELETE' } },
    async preview(env, a) {
      const p = await getPage(env, a.slug);
      if (!p) throw new Error('No page with slug "' + a.slug + '".');
      return { title: 'DELETE page', before: { slug: p.slug, title: p.title, status: p.status }, after: null, danger: true, note: 'This cannot be undone from HQ.' };
    },
    async run(env, a) {
      if (String(a.confirm || '').toUpperCase() !== 'DELETE') throw new Error('Deletion needs confirm="DELETE".');
      const p = await getPage(env, a.slug);
      if (!p) throw new Error('No page with slug "' + a.slug + '".');
      await svc(env, 'pages?id=eq.' + enc(p.id), { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      return { ok: true, summary: 'Page "' + p.title + '" deleted', data: { slug: p.slug } };
    },
    async verify(env, a) {
      const p = await getPage(env, a.slug);
      return { verified: !p, after: null };
    }
  },

  delete_game: {
    category: 'C', title: 'Delete a game',
    describe: 'Permanently delete a game record (not its media files). Requires confirm="DELETE".',
    args: { game: { type: 'string', required: true }, confirm: { type: 'string', required: true } },
    async preview(env, a) {
      const g = await getGame(env, a.game);
      if (!g) throw new Error('No game matching "' + a.game + '".');
      return { title: 'DELETE game', before: { name: g.name, slug: g.slug, published: g.published }, after: null, danger: true, note: 'Screenshots stay in the media library.' };
    },
    async run(env, a) {
      if (String(a.confirm || '').toUpperCase() !== 'DELETE') throw new Error('Deletion needs confirm="DELETE".');
      const g = await getGame(env, a.game);
      if (!g) throw new Error('No game matching "' + a.game + '".');
      await svc(env, 'games?id=eq.' + enc(g.id), { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      return { ok: true, summary: 'Game "' + g.name + '" deleted', data: { slug: g.slug } };
    },
    async verify(env, a) {
      const g = await getGame(env, a.game);
      return { verified: !g, after: null };
    }
  },

  delete_media: {
    category: 'C', title: 'Delete media',
    describe: 'Delete one media ROW by id (the storage object is left alone). Requires confirm="DELETE".',
    args: { id: { type: 'string', required: true }, confirm: { type: 'string', required: true } },
    async preview(env, a) {
      const rows = await svc(env, 'media?select=id,filename,url&id=eq.' + enc(a.id));
      const m = (rows || [])[0];
      if (!m) throw new Error('No media row with id ' + a.id + '.');
      return { title: 'DELETE media row', before: m, after: null, danger: true, note: 'The file itself is not removed from the bucket.' };
    },
    async run(env, a) {
      if (String(a.confirm || '').toUpperCase() !== 'DELETE') throw new Error('Deletion needs confirm="DELETE".');
      await svc(env, 'media?id=eq.' + enc(a.id), { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      return { ok: true, summary: 'Media row ' + a.id + ' deleted', data: { id: a.id } };
    },
    async verify(env, a) {
      const rows = await svc(env, 'media?select=id&id=eq.' + enc(a.id));
      return { verified: !(rows || []).length, after: null };
    }
  }
};

/* ---------------------------------------------------------------- validation */
export function validateArgs(toolName, args) {
  const tool = TOOLS[toolName];
  if (!tool) return { ok: false, error: 'Unknown tool "' + toolName + '".' };
  const a = args && typeof args === 'object' ? args : {};
  const clean = {};
  for (const [key, spec] of Object.entries(tool.args || {})) {
    const v = a[key];
    if (v === undefined || v === null || v === '') {
      if (spec.required) return { ok: false, error: 'Tool ' + toolName + ' needs "' + key + '".' };
      continue;
    }
    if (spec.type === 'boolean') { clean[key] = String(v) === 'true' || v === true; continue; }
    if (spec.type === 'number') { const n = Number(v); if (isNaN(n)) return { ok: false, error: '"' + key + '" must be a number.' }; clean[key] = n; continue; }
    if (spec.enum && !spec.enum.includes(String(v))) return { ok: false, error: '"' + key + '" must be one of: ' + spec.enum.join(', ') };
    clean[key] = String(v).slice(0, 20000);
  }
  /* unknown keys are dropped — prompt injection cannot add arguments */
  return { ok: true, args: clean, tool };
}

export function toolCatalog() {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name, category: t.category, title: t.title, describe: t.describe,
    args: Object.fromEntries(Object.entries(t.args || {}).map(([k, v]) => [k, { type: v.type, required: !!v.required, enum: v.enum, describe: v.describe }]))
  }));
}

export function callsPerCategory() {
  return { A: Object.values(TOOLS).filter(t => t.category === 'A').length, B: Object.values(TOOLS).filter(t => t.category === 'B').length, C: Object.values(TOOLS).filter(t => t.category === 'C').length };
}

export async function runTool(env, toolName, args) {
  const tool = TOOLS[toolName];
  if (!tool) throw new Error('Unknown tool "' + toolName + '".');
  return tool.run(env, args);
}

export async function verifyTool(env, toolName, args, result) {
  const tool = TOOLS[toolName];
  if (!tool || typeof tool.verify !== 'function') return { verified: null, note: 'read-only tool — no verification needed' };
  try { return await tool.verify(env, args, result); }
  catch (e) { return { verified: false, error: e.message }; }
}

export async function previewTool(env, toolName, args) {
  const tool = TOOLS[toolName];
  if (!tool || typeof tool.preview !== 'function') return null;
  return tool.preview(env, args);
}

export { getSettings, setSettings, SAFE_SETTING_KEYS, GAME_WRITE_FIELDS };
