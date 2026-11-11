/* ============================================================================
   HQ view — Multi-Channel Studio  (/social/studio)

   Ek video + ek title  →  har channel ka apna SEO pack (apni language me)
   →  sab channels par upload.

   Server endpoints:
     GET  /api/hq/channels           channel profiles + connected accounts
     POST /api/hq/channels           create/update a profile
     GET  /api/hq/connect/start?channel=CODE&json=1   → Google consent URL
     GET  /api/hq/ai-seo             is AI configured?
     POST /api/hq/ai-seo             per-channel SEO packs
     POST /api/hq/multi-publish      fan-out upload
     GET  /api/hq/multi-publish      upload history

   Nothing here ever claims a publish happened without a platform video id.
   ========================================================================== */
(function () {
  const HQ = window.HQ, D = window.HQData, ui = HQ.ui;

  const LANGS = [
    { value: 'en', label: 'English' }, { value: 'ur', label: 'Urdu (اردو)' }, { value: 'hi', label: 'Hindi (हिन्दी)' },
    { value: 'ar', label: 'Arabic (العربية)' }, { value: 'es', label: 'Spanish' }, { value: 'pt', label: 'Portuguese' },
    { value: 'id', label: 'Indonesian' }, { value: 'tr', label: 'Turkish' }, { value: 'bn', label: 'Bengali' },
    { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }, { value: 'ja', label: 'Japanese' }
  ];
  const CATS = ['Gameplay', 'Trailer', 'Update', 'Guide / Tutorial', 'Behind the scenes', 'Launch announcement', 'Community'];

  const langName = c => (LANGS.find(l => l.value === c) || {}).label || c || '—';

  async function apiGet(path) { return HQ.api(path); }
  async function apiPost(path, body) { return HQ.api(path, { method: 'POST', body: JSON.stringify(body || {}) }); }

  async function loadAll() {
    const out = { channels: [], accounts: [], online: false, error: '', ai: null };
    try {
      const j = await apiGet('/api/hq/channels');
      out.online = true;
      out.channels = (j && j.channels) || [];
      out.accounts = (j && j.accounts) || [];
    } catch (e) { out.error = e.message || String(e); }
    try { out.ai = await apiGet('/api/hq/ai-seo'); } catch (e) { out.ai = { configured: false, note: e.message }; }
    return out;
  }

  const accountFor = (accs, code) => accs.find(a => a.channel_code === code && a.platform === 'youtube') || null;

  /* ------------------------------------------------------------- channel form */
  function openChannelModal(ch, done) {
    ch = ch || {};
    const m = HQ.modal({
      title: ch.code ? 'Edit channel' : 'Add channel',
      sub: 'Har channel ki apni language, tone aur audience — AI isi se metadata banata hai.',
      size: 'lg',
      body: '<div class="hq-form-grid">' +
        ui.field({ label: 'Code (short id)', input: '<input name="code" value="' + HQ.esc(ch.code || '') + '" placeholder="urdu" ' + (ch.code ? 'readonly' : '') + '>' }) +
        ui.field({ label: 'Channel name', input: '<input name="name" value="' + HQ.esc(ch.name || '') + '" placeholder="DevChazers Urdu">' }) +
        ui.field({ label: 'Language', input: ui.select('language', LANGS, ch.language || 'en') }) +
        ui.field({ label: 'Country', input: '<input name="country" value="' + HQ.esc(ch.country || '') + '" placeholder="PK" maxlength="2">' }) +
        ui.field({ label: 'Tone', full: true, input: '<input name="tone" value="' + HQ.esc(ch.tone || '') + '" placeholder="friendly, energetic, gamer-to-gamer">' }) +
        ui.field({ label: 'Audience', full: true, input: '<input name="audience" value="' + HQ.esc(ch.audience || '') + '" placeholder="8-16 saal ke casual mobile players">' }) +
        ui.field({ label: 'Channel keywords', full: true, hint: 'comma separated — AI inhe title/description me natural tareeqe se use karega', input: '<input name="keywords" value="' + HQ.esc(ch.keywords || '') + '" placeholder="mobile game, urdu gameplay, free games">' }) +
        ui.field({ label: 'Title suffix (optional)', full: true, input: '<input name="title_suffix" value="' + HQ.esc(ch.title_suffix || '') + '" placeholder="| DevChazers">' }) +
        '</div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-ok>Save channel</button>',
      onMount(api) {
        api.q('[data-ok]').onclick = async () => {
          const v = HQ.formData(api.q('.hq-form-grid'));
          if (!v.code || !v.name) return HQ.toast('Code aur naam zaroori hain.', true);
          try {
            await apiPost('/api/hq/channels', v);
            HQ.toast('Channel saved.');
            m.close(); done();
          } catch (e) { HQ.toast('Save failed: ' + e.message, true); }
        };
      }
    });
  }

  /* -------------------------------------------------------------------- view */
  async function viewStudio(root) {
    const st = root._studio || (root._studio = { packs: null, gen: null, pub: null, sel: [], brief: {} });
    const data = await loadAll();
    const channels = data.channels;

    /* AI + server status banner */
    let banners = '';
    if (!data.online) {
      banners += ui.note({
        tone: 'r', icon: 'alert', title: 'Backend se baat nahi ho rahi.',
        text: HQ.esc(data.error) + ' Ye view <code>/api/hq/channels</code> par depend karta hai. Deploy check karo: <code>/api/hq/health</code>.'
      });
    }
    if (!data.ai || !data.ai.configured) {
      banners += ui.note({
        tone: 'w', icon: 'sparkles', title: 'AI key set nahi hai.',
        text: 'Cloudflare → Settings → Environment variables me <code>AI_API_KEY</code> (Gemini ya Groq — dono ka free tier hai) aur <code>AI_PROVIDER=gemini</code> add karo. Uske baad ye studio per-channel title/description/tags generate karega. ' +
          (data.ai && data.ai.note ? '<br><span class="hq-tiny">' + HQ.esc(data.ai.note) + '</span>' : '')
      });
    }
    const expiredCodes = channels.filter(ch => {
      const a = accountFor(data.accounts, ch.code);
      return a && a.status === 'expired';
    }).map(ch => ch.code);
    if (expiredCodes.length) {
      banners += ui.note({
        tone: 'w', icon: 'alert', title: expiredCodes.length + ' channel ka YouTube token expire ho gaya.',
        text: expiredCodes.join(', ') + ' — har ek par Reconnect dabao. (Google Testing mode me refresh token 7 din baad khatam ho jata hai; app ko production me daalne se ye chakkar khatam hota hai.)'
      });
    }
    if (!channels.length) {
      banners += ui.note({
        tone: 'a', icon: 'info', title: 'Abhi koi channel profile nahi hai.',
        text: 'Pehle apne 5 channels add karo (Global / Urdu / …) — naam, language, tone. Phir har channel ko YouTube se connect karke ek hi video sab par bhej sakte ho.'
      });
    }

    /* AI self-test result */
    const aiTestNote = st.aiTest ? ui.note({
      tone: st.aiTest.ok ? 'a' : 'r',
      icon: st.aiTest.ok ? 'sparkles' : 'alert',
      title: st.aiTest.ok ? 'AI test kamyab · ' + st.aiTest.ms + ' ms · ' + (st.aiTest.model || '') : 'AI test fail · ' + (st.aiTest.code || 'error'),
      text: '<pre class="hq-tiny" style="white-space:pre-wrap;margin:0">' + HQ.esc(JSON.stringify(st.aiTest, null, 1)) + '</pre>'
    }) : '';

    /* channel cards */
    const cards = channels.map(ch => {
      const acc = accountFor(data.accounts, ch.code);
      const connected = !!(acc && acc.status === 'connected');
      const expired = !!(acc && acc.status === 'expired');
      const badge = connected ? '<span class="bd g">Connected</span>'
        : expired ? '<span class="bd r">Reconnect needed</span>'
          : '<span class="bd w">Not connected</span>';
      return '<div class="hq-card" style="margin:0">' +
        '<div class="hq-card-h"><div><h2>' + HQ.esc(ch.name || ch.code) + '</h2>' +
        '<div class="hint">' + HQ.esc(langName(ch.language)) + ' · ' + HQ.esc(ch.code) + (ch.handle ? ' · ' + HQ.esc(ch.handle) : '') + '</div></div>' +
        '<div class="hq-toolbar">' + badge + '</div></div>' +
        '<div class="hq-card-b">' +
        '<div class="hq-kv" style="margin:0"><dt>Tone</dt><dd class="' + (ch.tone ? '' : 'na') + '">' + HQ.esc(ch.tone || '—') + '</dd>' +
        '<dt>Audience</dt><dd class="' + (ch.audience ? '' : 'na') + '">' + HQ.esc(ch.audience || '—') + '</dd>' +
        '<dt>Keywords</dt><dd class="' + (ch.keywords ? '' : 'na') + '">' + HQ.esc(HQ.clamp(ch.keywords || '', 48) || '—') + '</dd>' +
        '<dt>Channel</dt><dd class="' + (acc && acc.name ? '' : 'na') + '">' + HQ.esc((acc && (acc.name + ' · ' + (acc.username || ''))) || '—') + '</dd></div>' +
        '</div>' +
        '<div class="hq-card-f"><button type="button" class="btn sm pri" data-connect="' + HQ.esc(ch.code) + '">' + HQ.icon('link') + (connected || expired ? ' Reconnect' : ' Connect YouTube') + '</button>' +
        '<button type="button" class="btn sm" data-edit="' + HQ.esc(ch.code) + '">' + HQ.icon('edit') + ' Edit</button>' +
        '<button type="button" class="btn sm dng" data-del="' + HQ.esc(ch.code) + '">' + HQ.icon('trash') + '</button></div></div>';
    }).join('');

    /* brief */
    let media = [];
    try { media = (await D.list('media')).filter(m => D.isVideo(m.mime, m.filename)); } catch (e) { media = []; }
    const brief = st.brief || {};
    const selected = new Set(st.sel && st.sel.length ? st.sel : channels.map(c => c.code));

    const briefCard = ui.card({
      title: 'Video & brief',
      sub: 'Title + topic ek baar bharo — baaki har channel ke liye AI karega.',
      body: (media.some(mm => (Number(mm.size_bytes || mm.size) || 0) > 48 * 1048576)
        ? ui.note({ tone: 'w', icon: 'alert', title: 'Kuch videos 48 MB se badi hain.', text: media.filter(mm => (Number(mm.size_bytes || mm.size) || 0) > 48 * 1048576).map(mm => mm.filename || mm.url).slice(0, 3).join(', ') + ' — YouTube upload inhe reject kar dega (Workers 128 MB tak lekin bucket 50 MB). Compress karke dobara upload karo.' })
        : '') +
        '<div class="hq-form-grid" id="st-brief">' +
        ui.field({
          full: true, label: 'Video (Media Library)', hint: media.length ? 'Sirf video files. Upload Media Library se karo.' : 'Library me koi video nahi — pehle Media me upload karo, ya niche URL paste karo.',
          input: '<select name="media"><option value="">— select video —</option>' + media.map(mm => '<option value="' + HQ.esc(mm.url) + '"' + (brief.media === mm.url ? ' selected' : '') + '>' + HQ.esc(HQ.clamp(mm.filename || mm.url, 60)) + (mm.size ? ' · ' + HQ.bytes(mm.size) : '') + '</option>').join('') + '</select>'
        }) +
        ui.field({ full: true, label: 'ya video URL', input: '<input name="video_url" value="' + HQ.esc(brief.video_url || '') + '" placeholder="https://…/clip.mp4">' }) +
        ui.field({ label: 'Working title', req: true, input: '<input name="title" value="' + HQ.esc(brief.title || '') + '" placeholder="Nova Racer — first gameplay">' }) +
        ui.field({ label: 'Game', input: '<input name="game" value="' + HQ.esc(brief.game || '') + '" placeholder="Nova Racer">' }) +
        ui.field({ label: 'Category', input: ui.select('category', CATS.map(c => ({ value: c, label: c })), brief.category || 'Gameplay') }) +
        ui.field({ label: 'Privacy', input: ui.select('privacy', [{ value: 'public', label: 'Public' }, { value: 'unlisted', label: 'Unlisted' }, { value: 'private', label: 'Private (draft)' }], brief.privacy || 'public') }) +
        ui.field({ label: 'Primary keywords', full: true, input: '<input name="keywords" value="' + HQ.esc(brief.keywords || '') + '" placeholder="space racing, low poly, free mobile game">' }) +
        ui.field({ full: true, label: 'Channels', input: '<div class="hq-taglist" id="st-chans">' + (channels.length ? channels.map(c => {
          const acc = accountFor(data.accounts, c.code);
          const ok = acc && acc.status === 'connected';
          return '<button type="button" class="hq-chip' + (selected.has(c.code) ? ' a' : '') + '" data-ch="' + HQ.esc(c.code) + '"' + (ok ? '' : ' title="YouTube connected nahi — connect karo"') + '>' +
            HQ.platIcon('youtube') + ' ' + HQ.esc(c.name || c.code) + ' <span class="hq-tiny">' + HQ.esc((c.language || 'en').toUpperCase()) + (ok ? '' : ' ⚠') + '</span></button>';
        }).join('') : '<span class="hq-tiny">Pehle channel add karo.</span>') + '</div>' }) +
        '</div>',
      footer: '<button type="button" class="btn pri" data-a="generate"' + (data.online ? '' : ' disabled') + '>' + HQ.icon('sparkles') + ' Generate per-channel SEO</button>' +
        '<button type="button" class="btn sm" data-a="aitest"' + (data.online ? '' : ' disabled') + ' title="AI key aur provider ko asli chhoti call se test karo">' + HQ.icon('alert') + ' Test AI</button>' +
        '<span class="hq-tiny" style="margin-left:auto">AI har channel ki language me title/description/tags banata hai — edit kar sakte ho.</span>'
    });

    /* generated packs */
    const packs = st.packs || {};
    const packCards = Object.keys(packs).map(code => {
      const ch = channels.find(c => c.code === code) || { code, name: code, language: 'en' };
      const pk = packs[code] || {};
      if (pk.ok === false) {
        return ui.card({
          title: (ch.name || code) + ' — not generated',
          body: '<div class="hq-note r">' + HQ.icon('alert') + '<div class="grow"><b>' + HQ.esc(pk.code || 'error') + '</b> ' + HQ.esc(pk.error || '') + '</div></div>'
        });
      }
      const p = pk.pack || {};
      return ui.card({
        title: (ch.name || code) + ' · ' + langName(p.language || ch.language),
        sub: (pk.model ? pk.model + ' · ' : '') + 'edit karke publish karo',
        actions: '<button type="button" class="btn sm" data-copy="' + HQ.esc(code) + '">' + HQ.icon('copy') + ' Copy</button>',
        body: '<div class="hq-form-grid" data-pack="' + HQ.esc(code) + '">' +
          ui.field({ full: true, label: 'Title (' + (p.title || '').length + '/100)', input: '<input name="title" maxlength="100" value="' + HQ.esc(p.title || '') + '">' }) +
          ui.field({ full: true, label: 'Description', input: '<textarea name="description" rows="7">' + HQ.esc(p.description || '') + '</textarea>' }) +
          ui.field({ full: true, label: 'Tags (comma separated, max 15)', input: '<input name="tags" value="' + HQ.esc((p.tags || []).join(', ')) + '">' }) +
          ui.field({ full: true, label: 'Hashtags', input: '<input name="hashtags" value="' + HQ.esc((p.hashtags || []).join(' ')) + '">' }) +
          ui.field({ label: 'Thumbnail text', input: '<input name="thumbnail_text" value="' + HQ.esc(p.thumbnail_text || '') + '">' }) +
          ui.field({ label: 'Pinned comment', input: '<input name="pinned_comment" value="' + HQ.esc(p.pinned_comment || '') + '">' }) +
          '</div>'
      });
    }).join('');

    const genNotes = (st.gen && st.gen.error) ? ui.note({ tone: 'r', icon: 'alert', title: 'Generation failed', text: HQ.esc(st.gen.error) }) : '';

    /* publish results */
    const pub = st.pub;
    const pubCard = pub ? ui.card({
      title: 'Publish result',
      sub: HQ.esc(pub.quotaHint || ''),
      body: (pub.error ? ui.note({ tone: 'r', icon: 'alert', title: 'Publish nahi hua', text: HQ.esc(pub.error) }) : '') +
        '<div class="hq-list">' + Object.keys(pub.results || {}).map(code => {
          const r = pub.results[code] || {};
          const ch = channels.find(c => c.code === code) || { name: code };
          return '<div class="hq-li"><div class="ic">' + HQ.platIcon('youtube') + '</div><div class="bd2"><b>' + HQ.esc(ch.name || code) + ' ' +
            (r.ok ? '<span class="bd g">Uploaded</span>' : '<span class="bd r">' + HQ.esc(r.code || 'failed') + '</span>') + '</b>' +
            '<span>' + (r.ok ? '<a class="hq-link" href="' + HQ.esc(r.url) + '" target="_blank" rel="noopener">' + HQ.esc(r.url) + '</a>' : HQ.esc(r.error || '')) + '</span></div></div>';
        }).join('') + '</div>'
    }) : '';

    /* history */
    let history = [];
    if (data.online) { try { const h = await apiGet('/api/hq/multi-publish'); history = (h && h.uploads) || []; } catch (e) { history = []; } }
    const historyCard = ui.card({
      title: 'Upload history', sub: 'hq_channel_uploads — platform ne jo confirm kiya', tight: true,
      body: history.length ? ui.table({
        cls: 'rsp',
        cols: [
          { t: 'When', cell: r => HQ.esc(HQ.rel(r.created_at)) },
          { t: 'Channel', cell: r => HQ.esc(r.channel_code || '—') },
          { t: 'Title', cell: r => HQ.esc(HQ.clamp(r.title || '—', 44)) },
          { t: 'Status', cell: r => r.status === 'published' ? '<span class="bd g">published</span>' : '<span class="bd r">failed</span>' },
          { t: 'Video', cell: r => r.remote_url ? '<a class="hq-link" href="' + HQ.esc(r.remote_url) + '" target="_blank" rel="noopener">open ↗</a>' : '<span class="hq-muted">—</span>' }
        ],
        rows: history
      }) : ui.empty({ icon: 'upload', cls: 'sm', title: 'Koi upload nahi hua', text: 'Publish karne par har channel ka result yahan record hoga.' })
    });

    root.innerHTML = ui.page(
      ui.head({
        title: 'Multi-Channel Studio',
        sub: 'Ek video, ek title — har channel ka apna SEO (apni language me) aur sab par ek saath upload.',
        actions: '<button type="button" class="btn" data-a="refresh">' + HQ.icon('refresh') + ' Refresh</button>' +
          '<button type="button" class="btn pri" data-a="add">' + HQ.icon('plus') + ' Add channel</button>'
      }) +
      banners + aiTestNote +
      '<div class="hq-split"><div class="hq-grid" style="gap:14px">' +
      briefCard +
      genNotes +
      (packCards ? ui.card({
        title: 'Publish', sub: 'Sab green channels par ek saath bhejo',
        body: '<div class="hq-hint">Har channel ka pack upar edit ho chuka hai. Publish dabane par HQ sirf un channels par bhejega jinke liye title maujood hai.</div>',
        footer: '<button type="button" class="btn pri" data-a="publish">' + HQ.icon('upload') + ' Publish to selected channels</button>'
      }) + packCards : '') +
      pubCard +
      '</div><div class="hq-grid hq-sticky" style="gap:14px">' +
      ui.card({ title: 'Channels', sub: channels.length + ' profile(s) · ' + data.accounts.filter(a => a.status === 'connected').length + ' connected', tight: true, body: '<div class="hq-grid" style="gap:12px;padding:12px">' + (cards || ui.empty({ icon: 'share', cls: 'sm', title: 'Koi channel nahi', text: 'Add channel se pehla profile banao.' })) + '</div>' }) +
      historyCard +
      ui.card({
        title: 'Quota & limits',
        body: '<div class="hq-list">' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('alert') + '</div><div class="bd2"><b>YouTube quota</b><span>1 upload ≈ 1600 units; default 10,000/day per project → din me ~6 uploads. 5 channels par same video = 5 uploads.</span></div></div>' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('shield') + '</div><div class="bd2"><b>Tokens</b><span>Per-channel token AES-GCM se encrypted, sirf Cloudflare ke andar. Browser ko kabhi nahi.</span></div></div>' +
          '<div class="hq-li"><div class="ic">' + HQ.icon('video') + '</div><div class="bd2"><b>Video size</b><span>Cloudflare Workers limit ki wajah se ~128 MB tak. Bade video YouTube Studio se upload karo, phir yahan metadata copy karo.</span></div></div>' +
          '</div>'
      }) +
      '</div></div>'
    );

    /* ---- wiring ---- */
    root.querySelector('[data-a="refresh"]').onclick = () => { D.resetProbes(); root._studio = null; root._reload(); };
    root.querySelector('[data-a="add"]').onclick = () => openChannelModal(null, () => { root._studio = null; root._reload(); });

    HQ.on(root, 'click', '[data-edit]', (e, b) => {
      const ch = channels.find(c => c.code === b.dataset.edit);
      openChannelModal(ch, () => { root._studio = null; root._reload(); });
    });

    HQ.on(root, 'click', '[data-del]', async (e, b) => {
      if (!await HQ.confirm('Channel "' + b.dataset.del + '" delete karein?', { detail: 'Token bhi revoke hoga. Upload history reh jayegi.', ok: 'Delete', danger: true })) return;
      try {
        await HQ.api('/api/hq/channels?code=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
        HQ.toast('Channel deleted.');
        root._studio = null; root._reload();
      } catch (err) { HQ.toast('Delete failed: ' + err.message, true); }
    });

    HQ.on(root, 'click', '[data-connect]', async (e, b) => {
      b.disabled = true;
      try {
        const j = await apiGet('/api/hq/connect/start?channel=' + encodeURIComponent(b.dataset.connect) + '&json=1');
        if (!j || !j.url) throw new Error('Server ne authorize URL nahi diya.');
        location.href = j.url;
      } catch (err) {
        b.disabled = false;
        HQ.toast('Connect start nahi hua: ' + err.message, true);
      }
    });

    /* AI self-test */
    const aiTestBtn = root.querySelector('[data-a="aitest"]');
    if (aiTestBtn) aiTestBtn.onclick = async () => {
      const old = aiTestBtn.innerHTML;
      aiTestBtn.disabled = true; aiTestBtn.innerHTML = 'Testing…';
      try {
        const j = await apiGet('/api/hq/ai-seo?test=1');
        st.aiTest = j || { ok: false, code: 'empty' };
        HQ.toast(j && j.ok ? 'AI chal raha hai (' + j.ms + ' ms)' : 'AI test fail: ' + ((j && (j.code || j.error)) || 'unknown'), !(j && j.ok));
      } catch (e) {
        st.aiTest = { ok: false, code: 'request_failed', error: String((e && e.message) || e).slice(0, 500) };
        HQ.toast('Test request fail — neeche note dekho.', true);
      }
      aiTestBtn.disabled = false; aiTestBtn.innerHTML = old;
      root._reload();
    };

    /* channel multi-select */
    const chans = root.querySelector('#st-chans');
    if (chans) chans.addEventListener('click', e => {
      const b = e.target.closest('[data-ch]');
      if (!b) return;
      b.classList.toggle('a');
      st.sel = [...chans.querySelectorAll('.hq-chip.a')].map(x => x.dataset.ch);
    });

    /* generate */
    const genBtn = root.querySelector('[data-a="generate"]');
    if (genBtn) genBtn.onclick = async () => {
      const v = HQ.formData(root.querySelector('#st-brief'));
      st.brief = v;
      if (!v.title) return HQ.toast('Working title likho.', true);
      const chosen = [...root.querySelectorAll('#st-chans .hq-chip.a')].map(x => x.dataset.ch);
      st.sel = chosen;
      if (!chosen.length) return HQ.toast('Kam se kam ek channel chuno.', true);
      const payload = {
        topic: v.title, game: v.game, keywords: v.keywords, category: v.category,
        audience: '', duration_seconds: 0,
        channels: channels.filter(c => chosen.includes(c.code)).map(c => ({
          code: c.code, name: c.name, language: c.language || 'en', tone: c.tone, audience: c.audience,
          keywords: c.keywords, title_suffix: c.title_suffix, platform: 'youtube', country: c.country
        }))
      };
      const old = genBtn.innerHTML;
      genBtn.disabled = true; genBtn.innerHTML = 'Generating… (per channel)';
      try {
        const out = await apiPost('/api/hq/ai-seo', payload);
        st.packs = out.results || null;
        st.gen = { at: new Date().toISOString(), error: out.ok ? '' : 'Sab channels fail hue — neeche wajah dekho.' };
        const okCount = Object.values(st.packs || {}).filter(r => r.ok).length;
        HQ.toast(okCount ? okCount + ' channel pack(s) ready — review karo.' : 'Generation fail — AI key / provider check karo.', !okCount);
      } catch (err) {
        st.gen = { at: new Date().toISOString(), error: err.message };
        HQ.toast('Generate failed: ' + err.message, true);
      }
      genBtn.disabled = false; genBtn.innerHTML = old;
      root._reload();
    };

    /* copy a pack as plain text */
    HQ.on(root, 'click', '[data-copy]', async (e, b) => {
      const box = root.querySelector('[data-pack="' + b.dataset.copy + '"]');
      if (!box) return;
      const v = HQ.formData(box);
      HQ.copy('TITLE\n' + v.title + '\n\nDESCRIPTION\n' + v.description + '\n\nTAGS\n' + v.tags + '\n\nHASHTAGS\n' + v.hashtags, 'Pack copied');
    });

    /* publish */
    const pubBtn = root.querySelector('[data-a="publish"]');
    if (pubBtn) pubBtn.onclick = async () => {
      const v = HQ.formData(root.querySelector('#st-brief'));
      const videoUrl = (v.media || v.video_url || '').trim();
      if (!/^https?:\/\//i.test(videoUrl)) return HQ.toast('Video chuno ya public URL do.', true);

      const boxes = [...root.querySelectorAll('[data-pack]')];
      const targets = boxes.map(b => {
        const f = HQ.formData(b);
        return {
          code: b.dataset.pack, title: (f.title || '').trim(), description: f.description || '',
          tags: String(f.tags || '').split(',').map(s => s.trim()).filter(Boolean),
          hashtags: String(f.hashtags || '').split(/\s+/).filter(Boolean),
          language: (channels.find(c => c.code === b.dataset.pack) || {}).language || ''
        };
      }).filter(t => t.title);
      if (!targets.length) return HQ.toast('Koi pack ready nahi — pehle Generate dabao.', true);

      const okConn = targets.filter(t => {
        const a = accountFor(data.accounts, t.code);
        return a && a.status === 'connected';
      });
      if (!okConn.length) return HQ.toast('Koi bhi selected channel connected nahi hai.', true);

      if (!await HQ.confirm(okConn.length + ' channel(s) par upload karein?', {
        detail: 'Privacy: ' + (v.privacy || 'public') + '. YouTube quota ≈ ' + (okConn.length * 1600) + ' units lagega.',
        ok: 'Upload now'
      })) return;

      const old = pubBtn.innerHTML;
      pubBtn.disabled = true; pubBtn.innerHTML = 'Uploading…';
      try {
        const out = await apiPost('/api/hq/multi-publish', {
          video_url: videoUrl, privacy: v.privacy || 'public', category_id: '20', channels: okConn
        });
        st.pub = out;
        const good = Object.values(out.results || {}).filter(r => r.ok).length;
        HQ.toast(good ? good + ' video(s) upload ho gayi.' : 'Upload fail — neeche wajah dekho.', !good);
      } catch (err) {
        st.pub = { results: {}, error: err.message };
        HQ.toast('Publish failed: ' + err.message, true);
      }
      pubBtn.disabled = false; pubBtn.innerHTML = old;
      root._reload();
    };
  }

  HQ.views = HQ.views || {};
  HQ.views['/social/studio'] = viewStudio;
})();
