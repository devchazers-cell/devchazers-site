/* DevChazers data layer — all backend calls live here. */
(function () {
  const C = window.DC_CONFIG || {};
  const ROOT = window.DC_ROOT || './';
  const BUCKET_GAMES = 'game-images';
  const BUCKET_MEDIA = 'site-media';
  /* ONE client for the whole site (public pages, classic CMS, HQ).
     Yahi fix hai "token expire / invalid refresh token" ka: pehle HQ apna
     doosra client banata tha, aur refresh-token rotation par dono ek doosre ka
     token cancel kar dete the. Ab sab kuch isi client se chalta hai. */
  let sb = null;
  if (C.SUPABASE_URL && C.SUPABASE_ANON_KEY && window.supabase) {
    try {
      sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    } catch (e) { sb = null; }
  }
  const live = !!sb;

  const SEED_GAMES = [{
    id: 'seed-1', slug: 'multiplayer-golf', name: 'Multiplayer Golf', category: 'Sports', version: '1.0',
    short_desc: 'A fun low-poly golf game. Play solo or challenge friends.',
    full_desc: 'Enjoy a fun low-poly golf experience!',
    icon_url: '', icon_path: '', screenshots: [{ url: 'games/multiplayer-golf/1.png', path: '' }],
    apk_url: 'https://drive.google.com/file/d/1d0_TGqsCzPlWnAcUUMnp_rsJmb3FM4f6/view?usp=sharing',
    play_url: '', status: 'available', release_date: '2026-11-01', featured: true, published: true, created_at: '2026-11-01'
  }];
  const SEED_PAGES = [
    { id: 'p1', slug: 'privacy-policy', title: 'Privacy Policy', content: '<p>Privacy content.</p>', seo_title: 'Privacy Policy', seo_description: '', status: 'published', visibility: 'public' },
    { id: 'p2', slug: 'terms', title: 'Terms of Service', content: '<p>Terms content.</p>', seo_title: 'Terms', seo_description: '', status: 'published', visibility: 'public' }
  ];
  const shared = (window.parent !== window && window.parent.__DCMEM) || (window.__DCMEM = {
    games: JSON.parse(JSON.stringify(SEED_GAMES)),
    pages: JSON.parse(JSON.stringify(SEED_PAGES)),
    media: [],
    activity: [],
    settings: {
      site_name: 'DevChazers', contact_email: 'contact@devchazers.site',
      about_text: '', support_text: '', footer_text: 'Imaginative games that go beyond the ordinary.',
      homepage_title: 'DevChazers', homepage_description: '', ads_txt: '', admob_publisher_id: '',
      robots_txt: 'User-agent: *\nAllow: /', show_about: 'true', show_games: 'true', show_news: 'true', show_support: 'true'
    }
  });
  const fail = e => { if (e) throw new Error(e.message || String(e)); };

  async function logActivity(action, detail) {
    try {
      if (!live) { shared.activity.unshift({ action, detail, created_at: new Date().toISOString() }); return; }
      await sb.from('admin_activity').insert({ action, detail });
    } catch (_) { /* non-fatal */ }
  }

  const DC = {
    live, root: ROOT,
    /* Shared client accessor — HQ session keeper aur HQ data layer isi ko use
       karte hain. Naya client kabhi na banao. */
    client: () => sb,
    img: u => !u ? '' : /^(https?:|data:|blob:)/.test(u) ? u : ROOT + u,
    apkHref(u) {
      const m = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(u || '') || /[?&]id=([\w-]+)/.exec(u || '');
      return m && /drive\.google\.com/.test(u) ? 'https://drive.google.com/uc?export=download&id=' + m[1] : (u || '');
    },

    /* ---- games ---- */
    async listGames(all) {
      if (!live) return shared.games.filter(g => all || g.published).sort((a, b) => (b.featured - a.featured));
      let q = sb.from('games').select('*').order('featured', { ascending: false }).order('created_at', { ascending: false });
      if (!all) q = q.eq('published', true);
      const { data, error } = await q; fail(error); return data || [];
    },
    async saveGame(g) {
      if (!live) {
        if (g.id) { const i = shared.games.findIndex(x => x.id === g.id); shared.games[i] = { ...shared.games[i], ...g }; await logActivity('game_update', g.name); return shared.games[i]; }
        const n = { ...g, id: 'm' + Date.now(), created_at: new Date().toISOString() }; shared.games.push(n); await logActivity('game_create', g.name); return n;
      }
      const row = { ...g }; delete row.id; delete row.created_at;
      const r = g.id ? sb.from('games').update(row).eq('id', g.id) : sb.from('games').insert(row);
      const { data, error } = await r.select().single(); fail(error);
      await logActivity(g.id ? 'game_update' : 'game_create', data.name);
      return data;
    },
    async setPublished(id, v) {
      if (!live) { const g = shared.games.find(x => x.id === id); if (g) g.published = v; return; }
      const { error } = await sb.from('games').update({ published: v }).eq('id', id); fail(error);
      await logActivity(v ? 'game_publish' : 'game_unpublish', id);
    },
    async setFeatured(id, v) {
      if (!live) { const g = shared.games.find(x => x.id === id); if (g) g.featured = v; return; }
      const { error } = await sb.from('games').update({ featured: v }).eq('id', id); fail(error);
    },
    async deleteGame(g) {
      const paths = [g.icon_path, ...(g.screenshots || []).map(s => s.path)].filter(Boolean);
      if (!live) { shared.games = shared.games.filter(x => x.id !== g.id); await logActivity('game_delete', g.name); return; }
      const { error } = await sb.from('games').delete().eq('id', g.id); fail(error);
      if (paths.length) await DC.removeStorage(BUCKET_GAMES, paths);
      await logActivity('game_delete', g.name);
    },
    async uploadGameImage(file, folder) {
      return DC._upload(BUCKET_GAMES, file, folder);
    },

    /* ---- pages ---- */
    async listPages(all) {
      if (!live) return shared.pages.filter(p => all || (p.status === 'published' && p.visibility === 'public'));
      let q = sb.from('pages').select('*').order('updated_at', { ascending: false });
      if (!all) q = q.eq('status', 'published').eq('visibility', 'public');
      const { data, error } = await q; fail(error); return data || [];
    },
    async getPageBySlug(slug, admin) {
      if (!live) {
        const p = shared.pages.find(x => x.slug === slug);
        if (!p) return null;
        if (!admin && (p.status !== 'published' || p.visibility !== 'public')) return null;
        return p;
      }
      const { data, error } = await sb.from('pages').select('*').eq('slug', slug).maybeSingle();
      if (error) fail(error);
      if (!data) return null;
      if (!admin && (data.status !== 'published' || data.visibility !== 'public')) return null;
      return data;
    },
    async savePage(p) {
      if (!live) {
        if (p.id) { const i = shared.pages.findIndex(x => x.id === p.id); shared.pages[i] = { ...shared.pages[i], ...p, updated_at: new Date().toISOString() }; await logActivity('page_update', p.title); return shared.pages[i]; }
        const n = { ...p, id: 'p' + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; shared.pages.push(n); await logActivity('page_create', p.title); return n;
      }
      const row = { ...p }; delete row.id; delete row.created_at;
      const r = p.id ? sb.from('pages').update(row).eq('id', p.id) : sb.from('pages').insert(row);
      const { data, error } = await r.select().single(); fail(error);
      await logActivity(p.id ? 'page_update' : 'page_create', data.title);
      return data;
    },
    async deletePage(p) {
      if (!live) { shared.pages = shared.pages.filter(x => x.id !== p.id); await logActivity('page_delete', p.title); return; }
      const { error } = await sb.from('pages').delete().eq('id', p.id); fail(error);
      await logActivity('page_delete', p.title);
    },

    /* ---- settings ---- */
    async getSettings() {
      if (!live) return { ...shared.settings };
      const { data, error } = await sb.from('site_settings').select('key,value'); fail(error);
      return Object.fromEntries((data || []).map(r => [r.key, r.value]));
    },
    async saveSettings(obj) {
      if (!live) { Object.assign(shared.settings, obj); await logActivity('settings_update', Object.keys(obj).join(', ')); return; }
      const rows = Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? '') }));
      const { error } = await sb.from('site_settings').upsert(rows); fail(error);
      await logActivity('settings_update', Object.keys(obj).join(', '));
    },

    /* ---- media ---- */
    async listMedia() {
      if (!live) return shared.media.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      const { data, error } = await sb.from('media').select('*').order('created_at', { ascending: false }); fail(error);
      return data || [];
    },
    async uploadMedia(file) {
      const up = await DC._upload(BUCKET_MEDIA, file, 'uploads');
      const row = { path: up.path, url: up.url, filename: file.name, size_bytes: file.size, mime: file.type };
      if (!live) {
        const m = { ...row, id: 'm' + Date.now(), created_at: new Date().toISOString() };
        shared.media.unshift(m); await logActivity('media_upload', file.name); return m;
      }
      const { data, error } = await sb.from('media').insert(row).select().single(); fail(error);
      await logActivity('media_upload', file.name);
      return data;
    },
    async deleteMedia(m) {
      if (!live) { shared.media = shared.media.filter(x => x.id !== m.id); if (m.path) await DC.removeStorage(BUCKET_MEDIA, [m.path]); return; }
      const { error } = await sb.from('media').delete().eq('id', m.id); fail(error);
      if (m.path) await DC.removeStorage(BUCKET_MEDIA, [m.path]);
      await logActivity('media_delete', m.filename);
    },

    /* ---- activity ---- */
    async listActivity(limit) {
      if (!live) return shared.activity.slice(0, limit || 20);
      const { data, error } = await sb.from('admin_activity').select('*').order('created_at', { ascending: false }).limit(limit || 20);
      fail(error); return data || [];
    },

    /* ---- storage helpers ---- */
    async _upload(bucket, file, folder) {
      if (!live) return { url: URL.createObjectURL(file), path: '' };
      const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };
      const ext = map[file.type] || 'bin';
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false }); fail(error);
      return { url: sb.storage.from(bucket).getPublicUrl(path).data.publicUrl, path };
    },
    async removeStorage(bucket, paths) {
      if (!live || !paths.length) return;
      const { error } = await sb.storage.from(bucket).remove(paths); fail(error);
    },
    async removeImages(paths) { return DC.removeStorage(BUCKET_GAMES, paths); },
    async uploadImage(file, folder) { return DC.uploadGameImage(file, folder); },

    /* ---- auth helper ----
       Kisi bhi Supabase call ko DC.guard() me lapet do: agar access token
       expire ho gaya ho to pehle session refresh hoti hai, phir call ek dafa
       dobara chalti hai. Raw "JWT expired" user ko kabhi nahi dikhta. */
    async guard(fn) {
      try { return await fn(); }
      catch (e) {
        const raw = String((e && (e.message || e.error_description)) || e || '');
        if (/jwt expired|invalid jwt|invalid claim|refresh.?token|pgrst30[13]|\b401\b/i.test(raw) && sb) {
          try {
            const { error } = await sb.auth.refreshSession();
            if (!error) return await fn();
          } catch (_) { /* fall through to the friendly error */ }
        }
        throw e;
      }
    },
    /** Short, human message for any error — never a raw token string. */
    friendly(e) {
      const raw = String((e && (e.message || e.error_description)) || e || '');
      const x = raw.toLowerCase();
      if (/jwt expired|invalid jwt|invalid claim|pgrst301/.test(x)) return 'Your session needed a refresh — try that again.';
      if (/refresh token|invalid_grant|pgrst303|already used/.test(x)) return 'Your sign-in expired. Sign in again to continue.';
      if (/failed to fetch|networkerror|load failed/.test(x)) return 'No connection to Supabase. Check your internet and retry.';
      if (/row-level security|permission denied|not authorized/.test(x)) return 'This account is not allowed to do that (admin check failed).';
      if (/payload too large|too large|exceeded the maximum/.test(x)) return 'That file is bigger than the storage limit.';
      if (/mime|content.?type/.test(x)) return 'That file type is not allowed in this bucket.';
      if (/duplicate key|already exists/.test(x)) return 'That record already exists.';
      return raw ? raw.replace(/\s+/g, ' ').slice(0, 160) : 'Something went wrong — try again.';
    },

    /* ---- auth ---- */
    async signIn(emailOrPassword, maybePassword) {
      if (!live) throw new Error('Supabase is not configured');
      let email, password;
      if (maybePassword !== undefined) { email = emailOrPassword; password = maybePassword; }
      else { email = C.ADMIN_EMAIL; password = emailOrPassword; }
      if (!email) throw new Error('Admin email is not configured');
      const { error } = await sb.auth.signInWithPassword({ email, password }); fail(error);
    },
    async signOut() { if (live) await sb.auth.signOut(); },
    async hasSession() { if (!live) return false; const { data } = await sb.auth.getSession(); return !!data.session; },
    async isAdmin() { if (!live) return false; const { data, error } = await sb.rpc('is_admin'); return !error && data === true; }
  };
  window.DC = DC;
})();
