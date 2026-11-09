/* ============================================================================
   HQ views — Media Library, Game Management, Announcements, Blog, Support
   Game + media writes go through the SAME window.DC layer the classic CMS uses,
   so both panels always show the same Supabase data. HQ-only extras (trailer,
   privacy URL, finer release status, folders) are stored as HQ metadata and
   labelled as such.
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData, ui = HQ.ui;

  /* ============================================================ MEDIA LIBRARY */
  const mediaState = { q: '', type: 'all', folder: 'all', game: 'all', sort: 'new' };

  async function viewMedia(root) {
    const [media, games] = await Promise.all([HQ.ensureMedia(true), HQ.ensureGames()]);
    const withMeta = media.map(m => {
      const kind = D.isVideo(m.mime, m.filename) ? 'video' : 'image';
      const folder = D.folderOf(m.id) || '';
      // legacy uploads live under the "uploads/" storage prefix
      return Object.assign({}, m, { _kind: kind, _folder: folder, _path: m.path || '' });
    });
    const folders = D.FOLDERS;
    const filtered = withMeta.filter(m => {
      if (mediaState.type !== 'all' && m._kind !== mediaState.type) return false;
      if (mediaState.folder === 'unfiled' ? !!m._folder : (mediaState.folder !== 'all' && m._folder !== mediaState.folder)) return false;
      if (mediaState.q && !((m.filename || '') + ' ' + (m._folder || '')).toLowerCase().includes(mediaState.q.toLowerCase())) return false;
      if (mediaState.game !== 'all') {
        const g = games.find(x => x.id === mediaState.game);
        const hay = ((m.filename || '') + ' ' + (m._folder || '') + ' ' + (m.path || '')).toLowerCase();
        if (!g || !(hay.includes(String(g.slug || '').toLowerCase()) || hay.includes(String(g.name || '').toLowerCase()))) return false;
      }
      return true;
    }).sort((a, b) => mediaState.sort === 'size' ? (b.size_bytes || 0) - (a.size_bytes || 0)
      : mediaState.sort === 'name' ? String(a.filename).localeCompare(String(b.filename))
        : String(b.created_at || '').localeCompare(String(a.created_at || '')));

    const totalBytes = withMeta.reduce((a, m) => a + (m.size_bytes || 0), 0);

    root.innerHTML = ui.page(
      ui.head({
        title: 'Media Library',
        sub: 'Every asset HQ and the website can reference. Uploads land in the same <b>site-media</b> Supabase Storage bucket the classic CMS uses.',
        actions: '<button type="button" class="btn" data-a="download-index">' + HQ.icon('download') + ' Export index</button>' +
          '<label class="btn pri filebtn">' + HQ.icon('upload') + ' Upload<input type="file" id="media-up" accept="image/*,video/*" multiple hidden></label>'
      }) +
      ui.dropzone({ id: 'media-drop', title: 'Drag & drop images, videos or thumbnails', hint: 'Images ≤ 5 MB · video ≤ 64 MB · stored in site-media', multiple: true, accept: 'image/*,video/*' }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Assets', value: withMeta.length, icon: 'image', tone: 'p', na: !withMeta.length }) +
      ui.stat({ label: 'Images', value: withMeta.filter(m => m._kind === 'image').length, icon: 'image', tone: 'g', na: !withMeta.filter(m => m._kind === 'image').length }) +
      ui.stat({ label: 'Videos', value: withMeta.filter(m => m._kind === 'video').length, icon: 'play', tone: 'k', na: !withMeta.filter(m => m._kind === 'video').length }) +
      ui.stat({ label: 'Storage used', value: HQ.bytes(totalBytes), icon: 'db', tone: 'w', na: !totalBytes }) +
      '</div>' +
      '<div class="hq-toolbar">' +
      '<input type="search" id="m-q" placeholder="Search media…" value="' + HQ.esc(mediaState.q) + '">' +
      '<select id="m-type">' + [['all', 'All types'], ['image', 'Images'], ['video', 'Videos']].map(([v, l]) => '<option value="' + v + '"' + (mediaState.type === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<select id="m-game" title="Filter by game (matches the folder or file name)"><option value="all">All games</option>' +
      games.map(g => '<option value="' + HQ.esc(g.id) + '"' + (mediaState.game === g.id ? ' selected' : '') + '>' + HQ.esc(g.name) + '</option>').join('') + '</select>' +
      '<select id="m-folder"><option value="all">All folders</option>' + folders.map(f => '<option value="' + HQ.esc(f) + '"' + (mediaState.folder === f ? ' selected' : '') + '>' + HQ.esc(f) + '</option>').join('') +
      '<option value="unfiled"' + (mediaState.folder === 'unfiled' ? ' selected' : '') + '>Unfiled</option></select>' +
      '<select id="m-sort">' + [['new', 'Newest first'], ['size', 'Largest first'], ['name', 'Name A–Z']].map(([v, l]) => '<option value="' + v + '"' + (mediaState.sort === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<span class="hq-tiny" id="m-count">' + filtered.length + ' of ' + withMeta.length + '</span>' +
      '</div>' +
      (mediaState.game !== 'all' ? '<div class="hq-hint">Filtering by game: matches assets whose folder, file name or storage path contains the game name or slug. Assign folders in an asset\'s preview to make this exact.</div>' : '') +
      '<div class="hq-grid" style="grid-template-columns:220px minmax(0,1fr);gap:14px" id="media-cols">' +
      ui.card({
        title: 'Folders', sub: 'HQ organisation', tight: true,
        body: '<div class="hq-list" style="padding:10px">' +
          '<button type="button" class="hq-li" data-folder="all" style="cursor:pointer;text-align:left;width:100%;background:' + (mediaState.folder === 'all' ? '#00e5ff14' : '#0d0d1a') + '"><div class="ic">' + HQ.icon('layers') + '</div><div class="bd2"><b>All media</b><span>' + withMeta.length + ' assets</span></div></button>' +
          folders.map(f => {
            const n = withMeta.filter(m => m._folder === f).length;
            return '<button type="button" class="hq-li" data-folder="' + HQ.esc(f) + '" style="cursor:pointer;text-align:left;width:100%;background:' + (mediaState.folder === f ? '#00e5ff14' : '#0d0d1a') + '"><div class="ic">' + HQ.icon('folder') + '</div><div class="bd2"><b>' + HQ.esc(f) + '</b><span>' + n + ' asset' + (n === 1 ? '' : 's') + '</span></div></button>';
          }).join('') +
          '<button type="button" class="hq-li" data-folder="unfiled" style="cursor:pointer;text-align:left;width:100%;background:' + (mediaState.folder === 'unfiled' ? '#00e5ff14' : '#0d0d1a') + '"><div class="ic">' + HQ.icon('more') + '</div><div class="bd2"><b>Unfiled</b><span>' + withMeta.filter(m => !m._folder).length + ' assets</span></div></button>' +
          '</div>' +
          '<div class="hq-hint" style="padding:0 12px 12px">Folders are HQ labels mapped to media ids — no bucket paths are rewritten, so the website keeps working.</div>'
      }) +
      '<div>' + (filtered.length ? '<div class="hq-grid" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px">' +
        filtered.map(m => '<article class="hq-card" data-media="' + m.id + '">' +
          '<div style="aspect-ratio:4/3;background:#05050c;display:grid;place-items:center;overflow:hidden;position:relative">' +
          (m._kind === 'video'
            ? '<video src="' + HQ.esc(m.url) + '" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover"></video>'
            : '<img src="' + HQ.esc(m.url) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">') +
          '<span class="hq-chip" style="position:absolute;top:7px;left:7px;background:#000b">' + m._kind + '</span>' +
          (m._folder ? '<span class="hq-chip p" style="position:absolute;top:7px;right:7px;background:#000b">' + HQ.esc(HQ.clamp(m._folder, 14)) + '</span>' : '') +
          '</div>' +
          '<div class="hq-card-b" style="padding:9px 11px;display:flex;flex-direction:column;gap:5px">' +
          '<b style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + HQ.esc(m.filename) + '">' + HQ.esc(m.filename || 'asset') + '</b>' +
          '<div class="hq-tiny">' + HQ.bytes(m.size_bytes) + ' · ' + HQ.esc(HQ.date(m.created_at)) + '</div>' +
          '<div class="hq-inline" style="gap:5px;margin-top:2px">' +
          '<button type="button" class="btn sm" data-a="preview">Preview</button>' +
          '<button type="button" class="btn sm" data-a="copy">URL</button>' +
          '<button type="button" class="btn sm dng" data-a="del">Delete</button>' +
          '</div></div></article>').join('') + '</div>'
        : ui.empty({
          icon: 'image', title: mediaState.q || mediaState.type !== 'all' || mediaState.folder !== 'all' ? 'No media matches these filters' : 'Media library is empty',
          text: withMeta.length ? 'Try clearing the search or folder filter.' : 'Upload screenshots, trailers and thumbnails here — they become available to the website immediately.',
          action: '<button type="button" class="btn pri" data-a="pick">' + HQ.icon('upload') + ' Upload media</button>'
        })) + '</div></div>'
    );

    const picker = root.querySelector('#media-up');
    const handle = async (files) => {
      for (const f of files) {
        try {
          const isVid = D.isVideo(f.type, f.name);
          const isImg = D.isImage(f.type, f.name);
          if (!isVid && !isImg) { HQ.toast(f.name + ': unsupported file type', true); continue; }
          if (isImg && f.size > HQ.cfg.MEDIA_MAX_IMAGE) { HQ.toast(f.name + ': images max 5 MB', true); continue; }
          if (isVid && f.size > HQ.cfg.MEDIA_MAX_VIDEO) { HQ.toast(f.name + ': videos max 64 MB', true); continue; }
          if (DC.live) {
            if (isImg) { await DC.uploadMedia(f); }
            else {
              const up = await D.upload(f, 'media');
              const c = D.client();
              const { error } = await c.from('media').insert({ path: up.path, url: up.url, filename: f.name, size_bytes: f.size, mime: f.type });
              if (error) throw new Error(error.message);
            }
            HQ.toast('Uploaded ' + f.name);
          } else {
            HQ.toast(f.name + ' ready locally — Supabase is not reachable, nothing was uploaded.', true);
          }
        } catch (e) { HQ.toast(f.name + ': ' + e.message, true); }
      }
      HQ.reload();
    };
    picker.addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; handle(fs); });
    const drop = root.querySelector('#media-drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hot'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('hot'); }));
    drop.addEventListener('drop', e => { const fs = [...(e.dataTransfer.files || [])]; if (fs.length) handle(fs); });

    root.querySelector('#m-q').oninput = HQ.debounce(e => { mediaState.q = e.target.value; root._reload(); }, 250);
    root.querySelector('#m-type').onchange = e => { mediaState.type = e.target.value; root._reload(); };
    root.querySelector('#m-folder').onchange = e => { mediaState.folder = e.target.value; root._reload(); };
    root.querySelector('#m-sort').onchange = e => { mediaState.sort = e.target.value; root._reload(); };
    root.querySelector('#m-game').onchange = e => { mediaState.game = e.target.value; root._reload(); };
    HQ.on(root, 'click', '[data-folder]', (e, b) => { mediaState.folder = b.dataset.folder; root._reload(); });
    const pick = root.querySelector('[data-a="pick"]');
    if (pick) pick.onclick = () => picker.click();
    root.querySelector('[data-a="download-index"]').onclick = () => {
      const rows = [['filename', 'type', 'folder', 'size_bytes', 'uploaded', 'url']].concat(withMeta.map(m => [m.filename, m._kind, m._folder, m.size_bytes || 0, m.created_at || '', m.url]));
      HQ.downloadFile('devchazers-media-index.csv', HQ.csv(rows), 'text/csv');
    };

    root.addEventListener('click', async e => {
      const card = e.target.closest('[data-media]'); const btn = e.target.closest('[data-a]');
      if (!card || !btn) return;
      const m = withMeta.find(x => x.id === card.dataset.media); if (!m) return;
      if (btn.dataset.a === 'copy') HQ.copy(m.url, 'Media URL copied');
      if (btn.dataset.a === 'del') {
        if (!await HQ.confirm('Delete "' + (m.filename || 'file') + '"?', { detail: 'Removes the database row and the stored object. Used in a page or game it will break that image.', danger: true, ok: 'Delete' })) return;
        try { await DC.deleteMedia(m); D.log('media_delete', m.filename || ''); HQ.toast('Deleted.'); HQ.reload(); }
        catch (err) { HQ.toast(err.message, true); }
      }
      if (btn.dataset.a === 'preview') {
        const mm = HQ.modal({
          title: m.filename || 'Asset', sub: m._kind + ' · ' + HQ.bytes(m.size_bytes), size: 'lg',
          body: '<div style="background:#05050c;border:1px solid var(--bd);border-radius:12px;overflow:hidden;display:grid;place-items:center;max-height:52vh">' +
            (m._kind === 'video' ? '<video src="' + HQ.esc(m.url) + '" controls style="max-width:100%;max-height:52vh"></video>'
              : '<img src="' + HQ.esc(m.url) + '" alt="" style="max-width:100%;max-height:52vh;object-fit:contain">') + '</div>' +
            '<div class="hq-form-grid">' +
            ui.field({ label: 'Folder', full: true, input: '<select name="folder"><option value="">Unfiled</option>' + D.FOLDERS.map(f => '<option' + (m._folder === f ? ' selected' : '') + '>' + HQ.esc(f) + '</option>').join('') + '</select>' }) +
            '</div>' +
            '<div class="hq-kv"><dt>Uploaded</dt><dd>' + HQ.esc(HQ.dt(m.created_at)) + '</dd><dt>Storage path</dt><dd class="hq-mono">' + HQ.esc(m.path || '—') + '</dd>' +
            '<dt>MIME</dt><dd>' + HQ.esc(m.mime || '—') + '</dd><dt>Public URL</dt><dd class="hq-mono" style="word-break:break-all">' + HQ.esc(m.url) + '</dd></div>',
          footer: '<button type="button" class="btn left" data-copy>' + HQ.icon('copy') + ' Copy URL</button>' +
            '<button type="button" class="btn dng" data-del>Delete</button>' +
            '<button type="button" class="btn pri" data-save>Save folder</button>',
          onMount(api) {
            api.q('[data-copy]').onclick = () => HQ.copy(m.url, 'Media URL copied');
            api.q('[data-del]').onclick = () => { api.close(); btn.dataset.a = 'del'; };
            api.q('[data-save]').onclick = () => { D.setFolder(m.id, api.q('[name=folder]').value); HQ.toast('Folder updated.'); api.close(); root._reload(); };
          }
        });
        return mm;
      }
    });
  }

  /* ========================================================== GAME MANAGEMENT */
  const gameState = { q: '', status: 'all', editing: null, icon: null, shots: [], removed: [] };

  async function viewGames(root) {
    const games = await HQ.ensureGames(true);
    const filtered = games.filter(g => {
      if (gameState.q && ![g.name, g.slug, g.category].join(' ').toLowerCase().includes(gameState.q.toLowerCase())) return false;
      if (gameState.status !== 'all' && D.hqStatus(g) !== gameState.status) return false;
      return true;
    });
    const snaps = await D.snapshots('downloads');
    const dlFor = id => snaps.filter(s => s.game_id === id).reduce((a, s) => a + (Number(s.value) || 0), 0);

    root.innerHTML = ui.page(
      ui.head({
        title: 'Game Management',
        sub: 'Games are stored in the existing <b>games</b> table — edits here appear on the public website instantly. HQ adds trailer/privacy fields and a finer release status on top.',
        actions: '<a class="btn" href="../?tab=games">' + HQ.icon('layers') + ' Classic game form</a>' +
          '<button type="button" class="btn pri" data-a="new">' + HQ.icon('plus') + ' Add New Game</button>'
      }) +
      (!HQ.state.gamesOk ? ui.note({ tone: 'r', icon: 'alert', title: 'Games table did not respond.', text: 'HQ will not present a failed read as an empty catalogue. Refresh, then check the session in System Status.' }) : '') +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Total games', value: HQ.state.gamesOk ? games.length : '—', icon: 'gamepad', tone: 'p', na: !HQ.state.gamesOk || !games.length }) +
      ui.stat({ label: 'Published', value: games.filter(g => g.published).length, icon: 'check', tone: 'g', na: !games.filter(g => g.published).length }) +
      ui.stat({ label: 'Released', value: games.filter(g => D.hqStatus(g) === 'released').length, icon: 'download', tone: 'p', na: !games.filter(g => D.hqStatus(g) === 'released').length }) +
      ui.stat({ label: 'In development', value: games.filter(g => ['development', 'testing'].includes(D.hqStatus(g))).length, icon: 'pen', tone: 'w', na: !games.filter(g => ['development', 'testing'].includes(D.hqStatus(g))).length }) +
      '</div>' +
      '<div class="hq-toolbar"><input type="search" id="g-q" placeholder="Search games…" value="' + HQ.esc(gameState.q) + '">' +
      '<select id="g-status"><option value="all">All release states</option>' + D.GAME_STATUS.map(s => '<option value="' + s.id + '"' + (gameState.status === s.id ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select>' +
      '<span class="hq-tiny">' + filtered.length + ' of ' + games.length + '</span></div>' +
      '<div id="game-editor"></div>' +
      (filtered.length ? '<div class="hq-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">' +
        filtered.map(g => {
          const st = D.hqStatus(g);
          const meta = D.gameMeta(g.id);
          return '<article class="hq-card" data-game="' + g.id + '">' +
            '<div class="hq-card-b" style="display:flex;gap:12px;align-items:flex-start">' +
            (g.icon_url ? '<img src="' + HQ.esc(DC.img(g.icon_url)) + '" alt="" style="width:56px;height:56px;border-radius:13px;object-fit:cover;flex:none;border:1px solid var(--bd)">'
              : '<span style="width:56px;height:56px;border-radius:13px;background:var(--grad);display:grid;place-items:center;font:700 20px Orbitron;flex:none">' + HQ.esc((g.name || '?')[0]) + '</span>') +
            '<div style="flex:1;min-width:0">' +
            '<b style="display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + HQ.esc(g.name) + '</b>' +
            '<div class="hq-tiny" style="margin-top:2px">' + HQ.esc(g.category || '—') + ' · v' + HQ.esc(g.version || '—') + '</div>' +
            '<div class="hq-inline" style="gap:5px;margin-top:7px">' + ui.badge(st) + ui.badge(g.published ? 'available' : 'draft') + (g.featured ? '<span class="bd o">Featured</span>' : '') + '</div>' +
            '</div></div>' +
            '<div class="hq-card-b" style="padding:10px 14px;border-top:1px solid var(--bd)">' +
            '<div class="hq-metrics" style="gap:8px">' +
            '<div class="hq-metric"><b class="' + (dlFor(g.id) ? '' : 'na') + '">' + (dlFor(g.id) ? HQ.nf(dlFor(g.id)) : '—') + '</b><span>Downloads</span></div>' +
            '<div class="hq-metric"><b style="font-size:13px">' + HQ.esc(g.release_date ? HQ.date(g.release_date) : '—') + '</b><span>Release date</span></div>' +
            '</div>' +
            '<div class="hq-inline" style="margin-top:10px;gap:6px">' +
            '<button type="button" class="btn sm pri" data-a="edit">Edit</button>' +
            '<button type="button" class="btn sm" data-a="pub">' + (g.published ? 'Unpublish' : 'Publish') + '</button>' +
            '<a class="btn sm" href="' + HQ.esc(DC.root + '#game/' + encodeURIComponent(g.slug)) + '" target="_blank" rel="noopener">View ↗</a>' +
            '<button type="button" class="btn sm dng" data-a="del">Delete</button>' +
            '</div></div></article>';
        }).join('') + '</div>'
        : (HQ.state.gamesOk ? '' : ui.empty({ icon: 'alert', title: 'Games could not be loaded', text: 'The read failed — this is not an empty catalogue. Check the session / RLS and try Refresh.', action: '<button type="button" class="btn" onclick="HQ.reload(true)">Refresh</button>' })) +
        (HQ.state.gamesOk ? ui.empty({ icon: 'gamepad', title: games.length ? 'No games match these filters' : 'No games yet', text: games.length ? 'Clear the search or status filter.' : 'Add your first game — it appears on the website as soon as it is published.', action: '<button type="button" class="btn pri" data-a="new">' + HQ.icon('plus') + ' Add New Game</button>' }) : ''))
    );

    const flash = root.querySelector('[data-game="' + gameState.justSaved + '"]');
    if (flash) {
      flash.style.borderColor = 'var(--a)';
      flash.scrollIntoView({ behavior: 'smooth', block: 'center' });
      gameState.justSaved = null;
    }
    root.querySelector('#g-q').oninput = HQ.debounce(e => { gameState.q = e.target.value; root._reload(); }, 250);
    root.querySelector('#g-status').onchange = e => { gameState.status = e.target.value; root._reload(); };
    HQ.on(root, 'click', '[data-a="new"]', () => openEditor(root, null));
    root.addEventListener('click', async e => {
      const card = e.target.closest('[data-game]'); const btn = e.target.closest('[data-a]');
      if (!card || !btn) return;
      const g = games.find(x => x.id === card.dataset.game); if (!g) return;
      if (btn.dataset.a === 'edit') openEditor(root, g);
      if (btn.dataset.a === 'pub') {
        try { await DC.setPublished(g.id, !g.published); HQ.toast(g.published ? 'Unpublished' : 'Published'); D.log('game_publish', g.name); root._reload(); }
        catch (err) { HQ.toast(err.message, true); }
      }
      if (btn.dataset.a === 'del') {
        if (!await HQ.confirm('Delete "' + g.name + '"?', { detail: 'Removes the game row and its uploaded images from Supabase. This cannot be undone.', danger: true, ok: 'Delete' })) return;
        try { await DC.deleteGame(g); HQ.toast('Deleted.'); root._reload(); } catch (err) { HQ.toast(err.message, true); }
      }
    });
  }

  function openEditor(root, g) {
    gameState.editing = g; gameState.icon = g && g.icon_url ? { url: g.icon_url, path: g.icon_path } : null;
    gameState.shots = g && g.screenshots ? g.screenshots.map(s => Object.assign({}, s)) : [];
    gameState.removed = [];
    const meta = g ? D.gameMeta(g.id) : {};
    const box = root.querySelector('#game-editor');
    box.innerHTML = ui.card({
      title: g ? 'Edit game — ' + g.name : 'Add New Game',
      sub: 'Core fields write to the live games table. Trailer, privacy policy and release stage are stored as HQ metadata.',
      body: '<form id="game-form" class="hq-form-grid" novalidate>' +
        ui.field({ label: 'Game name', req: true, input: '<input name="name" maxlength="80" value="' + HQ.esc(g ? g.name : '') + '" required>' }) +
        ui.field({ label: 'Game ID (slug)', req: true, input: '<input name="slug" maxlength="60" value="' + HQ.esc(g ? g.slug : '') + '"' + (g ? ' readonly' : '') + ' required>', hint: g ? 'Locked after creation (used in URLs).' : 'Used in URLs: /#game/your-slug' }) +
        ui.field({ label: 'Category', req: true, input: '<input name="category" maxlength="40" list="hq-cats" value="' + HQ.esc(g ? g.category : '') + '"><datalist id="hq-cats">' + ['Action', 'Adventure', 'Arcade', 'Casual', 'Multiplayer', 'Puzzle', 'Racing', 'Sports'].map(c => '<option>' + c + '</option>').join('') + '</datalist>' }) +
        ui.field({ label: 'Version', req: true, input: '<input name="version" maxlength="20" value="' + HQ.esc(g ? g.version : '1.0') + '">' }) +
        ui.field({ label: 'Public status (existing field)', input: '<select name="status"><option value="available"' + (g && g.status === 'available' ? ' selected' : '') + '>Available</option><option value="coming_soon"' + (g && g.status === 'coming_soon' ? ' selected' : '') + '>Coming Soon</option></select>' }) +
        ui.field({ label: 'Release stage (HQ)', input: '<select name="hq_status">' + D.GAME_STATUS.map(s => '<option value="' + s.id + '"' + ((meta.hq_status || D.hqStatus(g || {})) === s.id ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select>' }) +
        ui.field({ label: 'Release date', input: '<input type="date" name="release_date" value="' + HQ.esc(g && g.release_date ? String(g.release_date).slice(0, 10) : '') + '">' }) +
        ui.field({ label: 'Google Play Store URL', input: '<input name="play_url" type="url" value="' + HQ.esc(g ? g.play_url || '' : '') + '" placeholder="https://play.google.com/…">' }) +
        ui.field({ label: 'Short description', req: true, full: true, input: '<textarea name="short_desc" class="hq-ta" maxlength="160" style="min-height:64px">' + HQ.esc(g ? g.short_desc : '') + '</textarea>' }) +
        ui.field({ label: 'Game description', full: true, input: '<textarea name="full_desc" class="hq-ta" maxlength="5000">' + HQ.esc(g ? g.full_desc || '' : '') + '</textarea>' }) +
        ui.field({ label: 'APK Drive link', input: '<input name="apk_url" type="url" value="' + HQ.esc(g ? g.apk_url || '' : '') + '" placeholder="https://drive.google.com/…">' }) +
        ui.field({ label: 'Privacy Policy URL', input: '<input name="privacy_url" type="url" value="' + HQ.esc(meta.privacy_url || '') + '" placeholder="https://devchazers.site/privacy-policy">' }) +
        ui.field({ label: 'Trailer URL (HQ metadata)', full: true, input: '<input name="trailer_url" type="url" value="' + HQ.esc(meta.trailer_url || '') + '" placeholder="https://youtube.com/watch?v=…">', hint: 'Stored for future site support — the current public game page does not render trailers yet.' }) +
        '<div class="full"><span class="hq-field" style="margin-bottom:4px"><span>Game icon (PNG/JPG/WebP ≤ 1 MB)</span></span><div class="hq-thumbs" id="icon-prev"></div>' +
        '<input type="file" name="icon" accept="image/png,image/jpeg,image/webp" style="margin-top:8px"></div>' +
        '<div class="full"><span class="hq-field" style="margin-bottom:4px"><span>Screenshots (max 10, 3 MB each)</span></span><div class="hq-thumbs" id="shot-prev"></div>' +
        '<input type="file" name="shots" accept="image/png,image/jpeg,image/webp" multiple style="margin-top:8px"></div>' +
        '<div class="full hq-inline" style="gap:18px">' +
        '<label class="hq-check"><input type="checkbox" name="published"' + (!g || g.published ? ' checked' : '') + '> Published</label>' +
        '<label class="hq-check"><input type="checkbox" name="featured"' + (g && g.featured ? ' checked' : '') + '> Featured</label>' +
        '</div><p class="msg full" id="game-msg"></p>' +
        '</form>',
      footer: '<button type="button" class="btn" data-a="cancel">Cancel</button>' +
        '<button type="button" class="btn pri" data-a="save">' + HQ.icon('check') + ' Save game</button>'
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const form = box.querySelector('#game-form');
    const drawPrev = () => {
      box.querySelector('#icon-prev').innerHTML = gameState.icon
        ? '<div class="hq-thumb"><img src="' + HQ.esc(DC.img(gameState.icon.url)) + '" alt=""><button type="button" class="x" data-rmicon>×</button></div>' : '<span class="hq-tiny">No icon yet</span>';
      box.querySelector('#shot-prev').innerHTML = gameState.shots.length
        ? gameState.shots.map((s, i) => '<div class="hq-thumb"><img src="' + HQ.esc(DC.img(s.url)) + '" alt=""><button type="button" class="x" data-rmshot="' + i + '">×</button></div>').join('')
        : '<span class="hq-tiny">No screenshots yet</span>';
    };
    drawPrev();
    form.elements.icon.onchange = e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return HQ.toast('Icon must be PNG, JPG or WebP.', true);
      if (f.size > 1 << 20) return HQ.toast('Icon max 1 MB.', true);
      if (gameState.icon && gameState.icon.path) gameState.removed.push(gameState.icon.path);
      gameState.icon = { url: URL.createObjectURL(f), path: '', file: f }; drawPrev();
    };
    form.elements.shots.onchange = e => {
      const fs = [...e.target.files]; e.target.value = '';
      for (const f of fs) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { HQ.toast(f.name + ': PNG/JPG/WebP only', true); continue; }
        if (f.size > 3 << 20) { HQ.toast(f.name + ': max 3 MB', true); continue; }
        if (gameState.shots.length >= 10) { HQ.toast('Max 10 screenshots', true); break; }
        gameState.shots.push({ url: URL.createObjectURL(f), path: '', file: f });
      }
      drawPrev();
    };
    box.addEventListener('click', e => {
      if (e.target.closest('[data-rmicon]')) { if (gameState.icon && gameState.icon.path) gameState.removed.push(gameState.icon.path); gameState.icon = null; drawPrev(); }
      const rm = e.target.closest('[data-rmshot]');
      if (rm) { const s = gameState.shots.splice(+rm.dataset.rmshot, 1)[0]; if (s && s.path) gameState.removed.push(s.path); drawPrev(); }
      if (e.target.closest('[data-a="cancel"]')) { box.innerHTML = ''; gameState.editing = null; }
      if (e.target.closest('[data-a="save"]')) save();
    });
    form.elements.name.oninput = () => {
      if (!gameState.editing && !form.elements.slug.dataset.t) form.elements.slug.value = HQ.slugify(form.elements.name.value);
    };

    async function save() {
      const msg = box.querySelector('#game-msg'); msg.textContent = '';
      const v = HQ.formData(form);
      const slug = String(v.slug || '').trim().toLowerCase();
      if (!v.name || !v.category || !v.version || !v.short_desc) { msg.textContent = 'Name, category, version and short description are required.'; return; }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) { msg.textContent = 'Game ID must be lowercase letters, numbers and dashes.'; return; }
      if (v.apk_url && !/^https:\/\/([a-z0-9-]+\.)*drive\.google\.com\//i.test(v.apk_url)) { msg.textContent = 'APK must be a Google Drive link.'; return; }
      if (v.play_url && !/^https:\/\/play\.google\.com\//i.test(v.play_url)) { msg.textContent = 'Play Store URL must start with https://play.google.com/.'; return; }
      if (v.status === 'available' && !v.apk_url && !v.play_url) { msg.textContent = 'Available games need an APK or Play Store link.'; return; }
      const btn = box.querySelector('[data-a="save"]'); btn.disabled = true; btn.innerHTML = '<span class="hq-spin"></span> Saving…';
      const uploaded = [];
      try {
        const put = async (o) => {
          if (!o.file) return { url: o.url, path: o.path || '' };
          const r = await DC.uploadGameImage(o.file, slug); if (r.path) uploaded.push(r.path); return r;
        };
        const ic = gameState.icon ? await put(gameState.icon) : { url: '', path: '' };
        const shots = []; for (const s of gameState.shots) shots.push(await put(s));
        const row = {
          name: v.name.trim(), slug, category: v.category.trim(), version: v.version.trim(),
          short_desc: v.short_desc.trim(), full_desc: (v.full_desc || '').trim(),
          apk_url: (v.apk_url || '').trim(), play_url: (v.play_url || '').trim(),
          icon_url: ic.url || '', icon_path: ic.path || '', screenshots: shots,
          status: v.status, release_date: v.release_date || null,
          featured: !!v.featured, published: !!v.published
        };
        if (gameState.editing) row.id = gameState.editing.id;
        const saved = await DC.saveGame(row);
        D.setGameMeta(gameState.editing ? gameState.editing.id : saved.id, {
          hq_status: v.hq_status, trailer_url: v.trailer_url || '', privacy_url: v.privacy_url || ''
        });
        if (gameState.removed.length) await DC.removeImages(gameState.removed).catch(() => { });
        D.log('game_save', row.name);
        HQ.toast(gameState.editing ? 'Game updated.' : 'Game created.');
        box.innerHTML = '';
        const savedId = gameState.editing && gameState.editing.id;
        gameState.editing = null;
        await HQ.ensureGames(true);            /* refresh the cache…            */
        gameState.justSaved = savedId || null; /* …and re-render in place so the
                                                  page does not jump to the top */
        root._reload();
      } catch (e) {
        if (uploaded.length) await DC.removeImages(uploaded).catch(() => { });
        msg.textContent = 'Save failed: ' + e.message;
        HQ.toast('Save failed: ' + e.message, true);
      }
      btn.disabled = false; btn.innerHTML = HQ.icon('check') + ' Save game';
    }
  }

  /* ========================================================== ANNOUNCEMENTS */
  const annState = { filter: 'all' };

  const annStatus = a => {
    const now = Date.now();
    if (a.expires_at && new Date(a.expires_at).getTime() < now) return 'expired';
    if (a.publish_at && new Date(a.publish_at).getTime() > now) return 'scheduled';
    return a.is_public ? 'live' : 'private';
  };

  async function viewAnnouncements(root) {
    const all = await D.list('announcements');
    const list = all.filter(a => annState.filter === 'all' || annStatus(a) === annState.filter);

    root.innerHTML = ui.page(
      ui.head({
        title: 'Company Announcements',
        sub: 'Studio news, release notes and notices. Announcements live in the HQ workspace until you optionally publish one as a website page.',
        actions: '<a class="btn" href="../?tab=pages">' + HQ.icon('layers') + ' Website pages</a>' +
          '<button type="button" class="btn pri" data-a="new">' + HQ.icon('plus') + ' Create announcement</button>'
      }) +
      ui.note({
        text: 'Announcements have no table in the current schema, so they are saved in this browser (HQ workspace). ' +
          '<b>Publish as page</b> pushes the text into the existing Pages system, which the website already renders.'
      }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Announcements', value: all.length, icon: 'megaphone', tone: 'p', na: !all.length }) +
      ui.stat({ label: 'Live', value: all.filter(a => annStatus(a) === 'live').length, icon: 'check', tone: 'g', na: !all.filter(a => annStatus(a) === 'live').length }) +
      ui.stat({ label: 'Scheduled', value: all.filter(a => annStatus(a) === 'scheduled').length, icon: 'clock', tone: 'w', na: !all.filter(a => annStatus(a) === 'scheduled').length }) +
      ui.stat({ label: 'Featured', value: all.filter(a => a.featured).length, icon: 'bookmark', tone: 'k', na: !all.filter(a => a.featured).length }) +
      '</div>' +
      '<div class="hq-toolbar"><select id="ann-filter">' + [['all', 'All'], ['live', 'Live'], ['scheduled', 'Scheduled'], ['private', 'Private'], ['expired', 'Expired']].map(([v, l]) => '<option value="' + v + '"' + (annState.filter === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<span class="hq-tiny">' + list.length + ' shown</span></div>' +
      ui.card({
        tight: true,
        body: ui.table({
          cls: 'rsp',
          cols: [
            { t: 'Announcement', cell: a => '<div class="hq-cell">' + (a.image ? '<img src="' + HQ.esc(a.image) + '" alt="">' : '<span class="ph">' + HQ.icon('megaphone') + '</span>') +
              '<div class="tx"><b>' + HQ.esc(a.title || 'Untitled') + '</b><span>' + HQ.esc(HQ.clamp(a.description || '', 60)) + '</span></div></div>' },
            { t: 'Publish date', cls: 'nowrap', cell: a => a.publish_at ? HQ.esc(HQ.dt(a.publish_at)) : '<span class="hq-muted">Immediately</span>' },
            { t: 'Expiry', cls: 'nowrap', cell: a => a.expires_at ? HQ.esc(HQ.date(a.expires_at)) : '<span class="hq-muted">—</span>' },
            { t: 'Visibility', cell: a => ui.badge(a.is_public ? 'public' : 'private') + (a.featured ? ' <span class="bd o">Featured</span>' : '') },
            { t: 'Status', cell: a => ui.badge(annStatus(a)) },
            { t: '', cls: 'acts', cell: a => '<button type="button" class="btn sm" data-edit="' + a.id + '">Edit</button>' +
              '<button type="button" class="btn sm" data-page="' + a.id + '">Publish as page</button>' +
              '<button type="button" class="btn sm dng" data-del="' + a.id + '">Delete</button>' }
          ],
          rows: list,
          empty: ui.empty({ icon: 'megaphone', title: all.length ? 'Nothing matches this filter' : 'No announcements yet', text: all.length ? 'Try another status filter.' : 'Create your first studio announcement. Keep it short — players skim.', action: '<button type="button" class="btn pri" data-a="new">' + HQ.icon('plus') + ' Create announcement</button>' })
        })
      })
    );

    root.querySelector('#ann-filter').onchange = e => { annState.filter = e.target.value; root._reload(); };
    HQ.on(root, 'click', '[data-a="new"]', () => editor());
    HQ.on(root, 'click', '[data-edit]', async (e, b) => { const a = (await D.list('announcements')).find(x => x.id === b.dataset.edit); editor(a); });
    HQ.on(root, 'click', '[data-del]', async (e, b) => {
      if (!await HQ.confirm('Delete this announcement?', { danger: true, ok: 'Delete' })) return;
      await D.remove('announcements', b.dataset.del); HQ.toast('Deleted.'); root._reload();
    });
    HQ.on(root, 'click', '[data-page]', async (e, b) => {
      const a = (await D.list('announcements')).find(x => x.id === b.dataset.page); if (!a) return;
      await publishAsPage({ title: a.title, body: a.description, image: a.image, kind: 'announcement' });
    });

    function editor(a) {
      const m = HQ.modal({
        title: a ? 'Edit announcement' : 'Create announcement',
        sub: 'Saved to the HQ workspace',
        size: 'lg',
        body: '<div class="hq-form-grid">' +
          ui.field({ label: 'Title', full: true, req: true, input: '<input name="title" maxlength="120" value="' + HQ.esc(a ? a.title : '') + '">' }) +
          ui.field({ label: 'Description', full: true, input: '<textarea name="description" class="hq-ta" maxlength="2000">' + HQ.esc(a ? a.description || '' : '') + '</textarea>' }) +
          ui.field({ label: 'Image URL', full: true, input: '<input name="image" type="url" value="' + HQ.esc(a && a.image ? a.image : '') + '" placeholder="https://… or upload below">' }) +
          '<div class="full hq-inline"><input type="file" name="imagefile" accept="image/*"><span class="hq-tiny">or upload to site-media</span></div>' +
          ui.field({ label: 'Publish date', input: '<input type="datetime-local" name="publish_at" value="' + (a && a.publish_at ? new Date(a.publish_at).toISOString().slice(0, 16) : '') + '">' }) +
          ui.field({ label: 'Expiry date', input: '<input type="date" name="expires_at" value="' + HQ.esc(a && a.expires_at ? String(a.expires_at).slice(0, 10) : '') + '">' }) +
          '<div class="full hq-inline" style="gap:18px">' +
          '<label class="hq-check"><input type="checkbox" name="is_public"' + (!a || a.is_public ? ' checked' : '') + '> Public</label>' +
          '<label class="hq-check"><input type="checkbox" name="featured"' + (a && a.featured ? ' checked' : '') + '> Featured</label>' +
          '</div></div>',
        footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-save>Save</button>',
        onMount(api) {
          api.q('[data-save]').onclick = async () => {
            const v = HQ.formData(api.q('.hq-form-grid'));
            if (!v.title) return HQ.toast('Title is required.', true);
            let image = v.image || '';
            const f = api.q('[name=imagefile]').files[0];
            try {
              if (f) { const up = await D.upload(f, 'announcements'); image = up.url; }
              const row = {
                title: v.title, description: v.description, image,
                publish_at: v.publish_at ? new Date(v.publish_at).toISOString() : null,
                expires_at: v.expires_at || null, is_public: !!v.is_public, featured: !!v.featured
              };
              if (a) await D.update('announcements', a.id, row); else await D.create('announcements', row);
              D.log('announcement_save', v.title);
              HQ.toast('Announcement saved.'); m.close(); root._reload();
            } catch (e) { HQ.toast(e.message, true); }
          };
        }
      });
    }
  }

  /* =================================================================== BLOG */
  async function viewBlog(root) {
    const all = await D.list('articles');
    const counts = { all: all.length, draft: all.filter(a => a.status === 'draft').length, published: all.filter(a => a.status === 'published').length };

    root.innerHTML = ui.page(
      ui.head({
        title: 'Blog Manager',
        sub: 'Long-form articles with SEO fields and the same rich-text editor the Pages system uses. Publish straight into the existing Pages table when you are ready.',
        actions: '<button type="button" class="btn pri" data-a="new">' + HQ.icon('plus') + ' Create article</button>'
      }) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Articles', value: counts.all, icon: 'pen', tone: 'p', na: !counts.all }) +
      ui.stat({ label: 'Published', value: counts.published, icon: 'check', tone: 'g', na: !counts.published }) +
      ui.stat({ label: 'Drafts', value: counts.draft, icon: 'bookmark', tone: 'w', na: !counts.draft }) +
      ui.stat({ label: 'Categories', value: new Set(all.map(a => a.category).filter(Boolean)).size, icon: 'layers', tone: 'k', na: !all.length }) +
      '</div>' +
      ui.note({
        text: 'Articles are stored in the HQ workspace. <b>Publish as page</b> hands the article to the existing Pages CMS, which already serves clean URLs like <code>/your-article-slug</code>.'
      }) +
      ui.card({
        tight: true,
        body: ui.table({
          cls: 'rsp',
          cols: [
            { t: 'Article', cell: a => '<div class="hq-cell">' + (a.image ? '<img src="' + HQ.esc(a.image) + '" alt="">' : '<span class="ph">' + HQ.icon('pen') + '</span>') +
              '<div class="tx"><b>' + HQ.esc(a.title || 'Untitled') + '</b><span>' + HQ.esc('/' + (a.slug || HQ.slugify(a.title || ''))) + '</span></div></div>' },
            { t: 'Category', cell: a => HQ.esc(a.category || '—') },
            { t: 'Tags', cell: a => (a.tags || []).length ? '<span class="hq-tiny">' + HQ.esc((a.tags || []).slice(0, 3).join(', ')) + '</span>' : '—' },
            { t: 'Publish date', cls: 'nowrap', cell: a => HQ.esc(a.publish_at ? HQ.date(a.publish_at) : HQ.date(a.created_at)) },
            { t: 'Status', cell: a => ui.badge(a.status || 'draft') },
            { t: '', cls: 'acts', cell: a => '<button type="button" class="btn sm" data-edit="' + a.id + '">Edit</button>' +
              '<button type="button" class="btn sm" data-page="' + a.id + '">Publish as page</button>' +
              '<button type="button" class="btn sm dng" data-del="' + a.id + '">Delete</button>' }
          ],
          rows: all,
          empty: ui.empty({ icon: 'pen', title: 'No articles yet', text: 'Write behind-the-scenes posts, patch notes or guides. Everything can be previewed before publishing.', action: '<button type="button" class="btn pri" data-a="new">' + HQ.icon('plus') + ' Create article</button>' })
        })
      })
    );

    HQ.on(root, 'click', '[data-a="new"]', () => editor(null));
    HQ.on(root, 'click', '[data-edit]', async (e, b) => { const a = (await D.list('articles')).find(x => x.id === b.dataset.edit); editor(a); });
    HQ.on(root, 'click', '[data-del]', async (e, b) => {
      if (!await HQ.confirm('Delete this article?', { danger: true, ok: 'Delete' })) return;
      await D.remove('articles', b.dataset.del); HQ.toast('Deleted.'); root._reload();
    });
    HQ.on(root, 'click', '[data-page]', async (e, b) => {
      const a = (await D.list('articles')).find(x => x.id === b.dataset.page); if (!a) return;
      await publishAsPage({ title: a.title, body: a.content, image: a.image, slug: a.slug, seo_title: a.seo_title, seo_description: a.seo_description, kind: 'article' });
    });

    function editor(a) {
      const m = HQ.modal({
        title: a ? 'Edit article' : 'Create article', size: 'lg', sub: 'Rich text · SEO · category & tags',
        body: '<div class="hq-form-grid">' +
          ui.field({ label: 'Article title', full: true, req: true, input: '<input name="title" maxlength="160" value="' + HQ.esc(a ? a.title : '') + '">' }) +
          ui.field({ label: 'URL slug', input: '<input name="slug" maxlength="80" value="' + HQ.esc(a ? a.slug || '' : '') + '" placeholder="auto-from-title">' }) +
          ui.field({ label: 'Category', input: '<input name="category" maxlength="40" list="hq-cat" value="' + HQ.esc(a ? a.category || '' : '') + '"><datalist id="hq-cat">' + ['Studio', 'Update', 'Guide', 'Design', 'Community', 'Release'].map(c => '<option>' + c + '</option>').join('') + '</datalist>' }) +
          ui.field({ label: 'Featured image URL', full: true, input: '<input name="image" type="url" value="' + HQ.esc(a && a.image ? a.image : '') + '" placeholder="https://…">' }) +
          '<div class="full hq-inline"><input type="file" name="imagefile" accept="image/*"><span class="hq-tiny">or upload to site-media</span></div>' +
          '<div class="full"><span class="hq-field"><span>Article content</span></span>' +
          '<div class="toolbar" data-rt-toolbar>' +
          ['bold:B', 'italic:I', 'insertUnorderedList:• List', 'formatBlock:h2', 'formatBlock:h3', 'createLink:Link'].map(x => {
            const [cmd, label] = x.split(':');
            const attr = cmd === 'formatBlock' ? ' data-val="' + label + '"' : '';
            return '<button type="button" data-cmd="' + cmd + '"' + attr + '>' + (cmd === 'formatBlock' ? label.toUpperCase() : label) + '</button>';
          }).join('') + '</div>' +
          '<div class="richedit" id="rt" contenteditable="true" style="min-height:180px">' + (a ? a.content || '' : '') + '</div></div>' +
          ui.field({ label: 'Tags (comma separated)', full: true, input: '<input name="tags" value="' + HQ.esc(a ? (a.tags || []).join(', ') : '') + '" placeholder="golf, update, mobile">' }) +
          ui.field({ label: 'SEO title', full: true, input: '<input name="seo_title" maxlength="70" value="' + HQ.esc(a ? a.seo_title || '' : '') + '">' }) +
          ui.field({ label: 'SEO description', full: true, input: '<textarea name="seo_description" class="hq-ta" style="min-height:64px" maxlength="160">' + HQ.esc(a ? a.seo_description || '' : '') + '</textarea>' }) +
          ui.field({ label: 'Keywords', full: true, input: '<input name="keywords" value="' + HQ.esc(a ? a.keywords || '' : '') + '">' }) +
          ui.field({ label: 'Status', input: '<select name="status"><option value="draft"' + (a && a.status === 'draft' ? ' selected' : '') + '>Draft</option><option value="published"' + (a && a.status === 'published' ? ' selected' : '') + '>Published</option></select>' }) +
          ui.field({ label: 'Publish date', input: '<input type="date" name="publish_at" value="' + HQ.esc(a && a.publish_at ? String(a.publish_at).slice(0, 10) : HQ.isoDay(new Date())) + '">' }) +
          '</div>',
        footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-save>Save article</button>',
        onMount(api) {
          const rt = api.q('#rt');
          api.q('[data-rt-toolbar]').addEventListener('click', e => {
            const b = e.target.closest('button'); if (!b) return;
            e.preventDefault();
            if (b.dataset.cmd === 'createLink') { const u = prompt('Link URL', 'https://'); if (u) document.execCommand('createLink', false, u); }
            else if (b.dataset.cmd === 'formatBlock') document.execCommand('formatBlock', false, b.dataset.val);
            else document.execCommand(b.dataset.cmd, false, null);
            rt.focus();
          });
          api.q('[data-save]').onclick = async () => {
            const v = HQ.formData(api.q('.hq-form-grid'));
            if (!v.title) return HQ.toast('Title is required.', true);
            let image = v.image || '';
            const f = api.q('[name=imagefile]').files[0];
            try {
              if (f) { const up = await D.upload(f, 'blog'); image = up.url; }
              const row = {
                title: v.title, slug: v.slug || HQ.slugify(v.title), category: v.category, image,
                content: rt.innerHTML, tags: HQ.tagsFrom(v.tags), seo_title: v.seo_title, seo_description: v.seo_description,
                keywords: v.keywords, status: v.status, publish_at: v.publish_at || null
              };
              if (a) await D.update('articles', a.id, row); else await D.create('articles', row);
              D.log('article_save', v.title);
              HQ.toast('Article saved.'); m.close(); root._reload();
            } catch (e) { HQ.toast(e.message, true); }
          };
        }
      });
    }
  }

  /* shared: push HQ content into the real Pages table */
  async function publishAsPage(o) {
    const ok = await HQ.confirm('Publish "' + (o.title || 'Untitled') + '" as a website page?', {
      detail: 'This creates a real row in the pages table using the existing Pages system, so the article becomes reachable at /slug on the live site.',
      ok: 'Publish page'
    });
    if (!ok) return;
    try {
      const pages = await DC.listPages(true);
      let slug = o.slug || HQ.slugify(o.title || 'page');
      if (pages.some(p => p.slug === slug)) slug = slug + '-' + Date.now().toString(36).slice(-4);
      const html = (o.image ? '<p><img src="' + HQ.esc(o.image) + '" alt=""></p>' : '') +
        (String(o.body || '').trim().startsWith('<') ? o.body : '<p>' + HQ.esc(o.body || '').replace(/\n/g, '</p><p>') + '</p>');
      await DC.savePage({
        title: o.title, slug, content: html,
        seo_title: o.seo_title || HQ.clamp(o.title, 60),
        seo_description: o.seo_description || HQ.clamp(String(o.body || '').replace(/<[^>]+>/g, ' '), 155),
        status: 'published', visibility: 'public'
      });
      D.log('page_published', o.title);
      HQ.modal({
        title: 'Page published', size: 'sm',
        body: '<div class="hq-note g">' + HQ.icon('check') + '<div class="grow">The ' + o.kind + ' is live at <b>/' + HQ.esc(slug) + '</b>.</div></div>' +
          '<div class="hq-inline"><a class="btn pri" href="' + HQ.esc(DC.root + slug) + '" target="_blank" rel="noopener">Open page ↗</a>' +
          '<button type="button" class="btn" data-copy>Copy URL</button></div>',
        onMount(api) { api.q('[data-copy]').onclick = () => HQ.copy(location.origin.replace(/\/admin\/.*$/, '') + '/' + slug, 'Page URL copied'); }
      });
    } catch (e) { HQ.toast('Could not publish page: ' + e.message, true); }
  }

  /* ================================================================= SUPPORT */
  const supState = { tab: 'inbox' };

  async function viewSupport(root) {
    const probe = await D.probe('contact_messages');
    let cloud = [];
    if (probe.ok) {
      const c = D.client();
      const res = await c.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(200);
      if (!res.error) cloud = (res.data || []).map(m => Object.assign({ _src: 'cloud' }, m));
    }
    const local = (await D.list('messages')).map(m => Object.assign({ _src: 'local' }, m));
    const all = cloud.concat(local);
    const tabs = [
      { id: 'inbox', label: 'Contact form', icon: 'bell', rows: all.filter(m => (m.kind || 'contact') === 'contact' && m.status !== 'archived') },
      { id: 'support', label: 'Support requests', icon: 'life', rows: all.filter(m => m.kind === 'support' && m.status !== 'archived') },
      { id: 'feedback', label: 'User feedback', icon: 'activity', rows: all.filter(m => m.kind === 'feedback' && m.status !== 'archived') },
      { id: 'archived', label: 'Archived', icon: 'archive', rows: all.filter(m => m.status === 'archived') }
    ];
    const active = tabs.find(t => t.id === supState.tab) || tabs[0];

    root.innerHTML = ui.page(
      ui.head({
        title: 'Contact & Support',
        sub: 'Everything that reaches the studio from the website, with read / reply / archive states.',
        actions: '<a class="btn" href="' + HQ.esc(DC.root) + '#contact" target="_blank" rel="noopener">' + HQ.icon('ext') + ' Website contact page</a>'
      }) +
      (probe.ok ? ui.note({ tone: 'g', icon: 'check', title: 'Message store connected.', text: '<code>contact_messages</code> responded with ' + HQ.nf(probe.count) + ' row(s).' })
        : ui.note({
          tone: 'w', icon: 'info', title: 'No submission store yet.',
          text: 'The public contact form currently opens the visitor\'s mail app with <code>mailto:</code> (see <code>js/site.js</code>), so submissions never reach a database. ' +
            'Create the <code>contact_messages</code> table from <b>hq-optional-schema.sql</b> and point the form at it — this inbox lights up with zero UI changes.'
        })) +
      '<div class="hq-stats">' +
      ui.stat({ label: 'Open messages', value: all.filter(m => m.status !== 'archived').length, icon: 'bell', tone: 'p', na: !all.length }) +
      ui.stat({ label: 'Unread', value: all.filter(m => m.status === 'unread' || !m.status).length, icon: 'alert', tone: 'w', na: !all.length }) +
      ui.stat({ label: 'Support', value: all.filter(m => m.kind === 'support').length, icon: 'life', tone: 'k', na: !all.length }) +
      ui.stat({ label: 'Archived', value: all.filter(m => m.status === 'archived').length, icon: 'archive', tone: 'g', na: !all.length }) +
      '</div>' +
      ui.tabs({ id: 'sup', active: active.id, items: tabs.map(t => ({ id: t.id, label: t.label, icon: t.icon, count: t.rows.length })) }) +
      ui.card({
        tight: true,
        body: ui.table({
          cls: 'rsp',
          cols: [
            { t: 'From', cell: m => '<div class="hq-cell"><span class="ph">' + HQ.esc(((m.name || m.email || '?')[0] || '?').toUpperCase()) + '</span>' +
              '<div class="tx"><b>' + HQ.esc(m.name || m.email || 'Unknown') + '</b><span>' + HQ.esc(m.email || '—') + '</span></div></div>' },
            { t: 'Subject', cell: m => '<b>' + HQ.esc(m.subject || '(no subject)') + '</b><div class="hq-tiny">' + HQ.esc(HQ.clamp(m.message || m.body || '', 70)) + '</div>' },
            { t: 'Received', cls: 'nowrap', cell: m => HQ.esc(HQ.dt(m.created_at)) },
            { t: 'Status', cell: m => ui.badge(m.status || 'unread') },
            { t: '', cls: 'acts', cell: m => '<button type="button" class="btn sm" data-open-msg="' + HQ.esc(m.id) + '">Open</button>' +
              (m.status === 'archived'
                ? '<button type="button" class="btn sm" data-unarchive="' + HQ.esc(m.id) + '">Restore</button>'
                : '<button type="button" class="btn sm" data-read="' + HQ.esc(m.id) + '">' + (m.status === 'unread' || !m.status ? 'Mark read' : 'Unread') + '</button>' +
                  '<button type="button" class="btn sm" data-archive="' + HQ.esc(m.id) + '">Archive</button>') }
          ],
          rows: active.rows,
          empty: ui.empty({
            icon: 'bell', title: 'No messages in this view',
            text: probe.ok ? 'Nothing matches this tab yet.' : 'Nothing can arrive until the site posts to a store. Add <code>contact_messages</code> and wire the form — the UI is already built.',
            action: '<a class="btn" href="../?tab=pages">' + HQ.icon('layers') + ' Contact page settings</a>'
          })
        })
      }) +
      ui.card({
        title: 'Reply behaviour',
        body: '<div class="hq-list">' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('reply') + '</div><div class="bd2"><b>Reply by email</b><span>Replies open your mail client with the recipient, subject and a quoted thread pre-filled — no SMTP key needed.</span></div></div>' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('shield') + '</div><div class="bd2"><b>Nothing invented</b><span>HQ never shows a message that was not actually submitted.</span></div></div>' +
          '</div>'
      })
    );

    const msgList = () => all;
    const setStatus = async (id, patch) => {
      const m = msgList().find(x => String(x.id) === String(id)); if (!m) return;
      if (m._src === 'cloud') {
        const c = D.client();
        const { error } = await c.from('contact_messages').update(patch).eq('id', id);
        if (error) throw new Error(error.message);
      } else {
        await D.update('messages', id, patch);
      }
      HQ.toast('Message updated.');
      root._reload();
    };

    HQ.on(root, 'click', '[data-tab]', (e, b) => { supState.tab = b.dataset.tab; root._reload(); });
    HQ.on(root, 'click', '[data-read]', async (e, b) => {
      const m = msgList().find(x => String(x.id) === b.dataset.read);
      const next = (m.status === 'unread' || !m.status) ? 'read' : 'unread';
      try { await setStatus(b.dataset.read, { status: next }); } catch (err) { HQ.toast(err.message, true); }
    });
    HQ.on(root, 'click', '[data-archive]', async (e, b) => {
      try { await setStatus(b.dataset.archive, { status: 'archived' }); } catch (err) { HQ.toast(err.message, true); }
    });
    HQ.on(root, 'click', '[data-unarchive]', async (e, b) => {
      try { await setStatus(b.dataset.unarchive, { status: 'read' }); } catch (err) { HQ.toast(err.message, true); }
    });
    HQ.on(root, 'click', '[data-open-msg]', (e, b) => {
      const m = msgList().find(x => String(x.id) === b.dataset.openMsg); if (!m) return;
      const subject = 'Re: ' + (m.subject || 'your message');
      const body = '\n\n---\n' + (m.message || '');
      const mail = 'mailto:' + encodeURIComponent(m.email || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      const modal = HQ.modal({
        title: m.subject || 'Message', sub: (m.name || 'Unknown') + ' · ' + (m.email || '—'),
        size: 'lg',
        body: '<div class="hq-kv"><dt>Received</dt><dd>' + HQ.esc(HQ.dt(m.created_at)) + '</dd><dt>Type</dt><dd>' + HQ.esc(m.kind || 'contact') + '</dd><dt>Status</dt><dd>' + ui.badge(m.status || 'unread') + '</dd></div>' +
          '<div class="hq-card"><div class="hq-card-b" style="font-size:13px;line-height:1.6;white-space:pre-wrap">' + HQ.esc(m.message || m.body || '(empty)') + '</div></div>' +
          '<div class="hq-form-grid">' + ui.field({ label: 'Your reply', full: true, input: '<textarea name="reply" class="hq-ta" placeholder="Thanks for reaching out…"></textarea>' }) + '</div>',
        footer: '<button type="button" class="btn left" data-archive2>Archive</button><button type="button" class="btn" data-copy>Copy reply</button>' +
          '<a class="btn pri" href="' + HQ.esc(mail) + '" data-send>Open mail client ↗</a>',
        onMount(api) {
          api.q('[data-copy]').onclick = () => HQ.copy(api.q('[name=reply]').value || '', 'Reply copied');
          api.q('[data-archive2]').onclick = async () => { try { await setStatus(m.id, { status: 'archived' }); modal.close(); } catch (err) { HQ.toast(err.message, true); } };
          api.q('[data-send]').addEventListener('click', () => { try { setStatus(m.id, { status: 'replied' }); } catch (e) { } });
        }
      });
    });
  }

  HQ.views = HQ.views || {};
  HQ.views['/media'] = viewMedia;
  HQ.views['/games'] = viewGames;
  HQ.views['/announcements'] = viewAnnouncements;
  HQ.views['/blog'] = viewBlog;
  HQ.views['/support'] = viewSupport;
  HQ.publishAsPage = publishAsPage;
})();
