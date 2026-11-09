const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OK = ['image/png', 'image/jpeg', 'image/webp'], ICON_MAX = 1 << 20, SHOT_MAX = 3 << 20, MEDIA_MAX = 5 << 20, MAX_SHOTS = 10;
let games = [], pages = [], media = [], editingGame = null, editingPage = null;
let icon = null, shots = [], removedPaths = [];

function toast(m, err) {
  const t = $('#toast'); t.textContent = m; t.className = 'toast on' + (err ? ' err' : '');
  clearTimeout(t._t); t._t = setTimeout(() => t.className = 'toast', 3200);
}
function confirmBox(msg) {
  return new Promise(r => {
    $('#confmsg').textContent = msg; $('#conf').hidden = false;
    $('#cyes').onclick = () => { $('#conf').hidden = true; r(true); };
    $('#cno').onclick = () => { $('#conf').hidden = true; r(false); };
  });
}
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const httpUrl = (u, host) => { try { const x = new URL(u); return x.protocol === 'https:' && (!host || host.test(x.hostname)); } catch { return false; } };
const siteOrigin = () => location.origin.replace(/\/admin\/?$/, '') || '';

/* ---- auth ---- */
async function boot() {
  if (!DC.live) {
    $('#gmsg').textContent = 'Supabase is not configured. Fill in js/config.js.';
    $('#gem').disabled = $('#gpw').disabled = $('#gbtn').disabled = true;
    return;
  }
  if (await DC.hasSession() && await DC.isAdmin()) return start();
  const hint = (window.DC_CONFIG && window.DC_CONFIG.ADMIN_EMAIL) || '';
  if (hint) $('#gem').value = hint;
  $('#gate').hidden = false;
}
async function login() {
  const email = ($('#gem').value || '').trim(), pw = $('#gpw').value;
  $('#gpw').value = '';
  if (!email || !pw) return $('#gmsg').textContent = 'Enter email and password.';
  $('#gbtn').disabled = true; $('#gmsg').textContent = '';
  try {
    await DC.signIn(email, pw);
    if (await DC.isAdmin()) return start();
    await DC.signOut();
    $('#gmsg').textContent = 'This account is not an admin.';
  } catch { $('#gmsg').textContent = 'Invalid email or password.'; }
  $('#gbtn').disabled = false;
}
$('#gbtn').onclick = login;
$('#gpw').onkeydown = e => { if (e.key === 'Enter') login(); };
$('#gem').onkeydown = e => { if (e.key === 'Enter') $('#gpw').focus(); };
$('#logout').onclick = async () => { await DC.signOut(); location.href = '../'; };

async function start() {
  $('#gate').hidden = true; $('#app').hidden = false;
  await Promise.all([reloadGames(), reloadPages(), reloadMedia(), reloadDash(), loadSettingsForms()]);
}

/* ---- nav ---- */
function tab(t) {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $$('.tab').forEach(s => s.classList.toggle('on', s.id === 't-' + t));
  $('#side').classList.remove('open');
  if (t === 'games') { $('#geditor').hidden = true; renderGames(); }
  if (t === 'pages') { $('#peditor').hidden = true; renderPages(); }
}
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) tab(b.dataset.t); };
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');
document.addEventListener('click', e => {
  if (window.innerWidth > 760) return;
  if (!$('#side').classList.contains('open')) return;
  if (!e.target.closest('#side') && !e.target.closest('#menuBtn')) $('#side').classList.remove('open');
});
$$('[data-go]').forEach(b => b.addEventListener('click', () => {
  tab(b.dataset.go);
  if (b.dataset.action === 'new-game') openGameEditor(null);
  if (b.dataset.action === 'new-page') openPageEditor(null);
}));

/* ---- dashboard ---- */
async function reloadDash() {
  try {
    const [g, p, act] = await Promise.all([
      DC.listGames(true),
      DC.listPages(true),
      DC.listActivity(12)
    ]);
    games = g; pages = p;
    const n = (arr, f) => arr.filter(f).length;
    $('#stats').innerHTML = [
      ['Total games', g.length],
      ['Published games', n(g, x => x.published)],
      ['Draft games', n(g, x => !x.published)],
      ['Total pages', p.length],
      ['Published pages', n(p, x => x.status === 'published')],
      ['Draft pages', n(p, x => x.status === 'draft')]
    ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    $('#activity').innerHTML = act.length
      ? act.map(a => `<div class="act"><b>${esc(a.action)}</b> — ${esc(a.detail)}<time>${esc(a.created_at ? new Date(a.created_at).toLocaleString() : '')}</time></div>`).join('')
      : '<div class="empty">No activity yet.</div>';
  } catch (e) { toast(e.message, true); }
}

/* ---- games ---- */
async function reloadGames() {
  try { games = await DC.listGames(true); renderGames(); } catch (e) { toast(e.message, true); }
}
function filteredGames() {
  const q = ($('#gsearch').value || '').trim().toLowerCase();
  if (!q) return games;
  return games.filter(g => [g.name, g.slug, g.category].join(' ').toLowerCase().includes(q));
}
function renderGames() {
  const list = filteredGames();
  $('#glist').innerHTML = list.length ? list.map(g => `
    <div class="ci" data-id="${esc(g.id)}">
      ${g.icon_url ? `<img src="${esc(DC.img(g.icon_url))}" alt="">` : `<div class="ph">${esc((g.name || '?')[0])}</div>`}
      <div class="inf"><b>${esc(g.name)}</b><span>${esc(g.category)} · v${esc(g.version)} · ${esc(g.slug)}</span>
        <div><span class="bd ${g.published ? 'g' : 'm'}">${g.published ? 'Published' : 'Draft'}</span>
        <span class="bd ${g.status === 'available' ? 'g' : 'o'}">${g.status === 'available' ? 'Available' : 'Soon'}</span>
        ${g.featured ? '<span class="bd o">Featured</span>' : ''}</div></div>
      <div class="acts">
        <button type="button" class="btn sm" data-a="edit">Edit</button>
        <button type="button" class="btn sm" data-a="pub">${g.published ? 'Unpublish' : 'Publish'}</button>
        <button type="button" class="btn sm" data-a="feat">${g.featured ? 'Unfeature' : 'Feature'}</button>
        <button type="button" class="btn sm dng" data-a="del">Delete</button>
      </div>
    </div>`).join('') : '<div class="empty">No games found.</div>';
}
$('#gsearch').oninput = renderGames;
$('#glist').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const g = games.find(x => x.id === b.closest('.ci').dataset.id); if (!g) return;
  try {
    if (b.dataset.a === 'edit') openGameEditor(g);
    if (b.dataset.a === 'pub') { await DC.setPublished(g.id, !g.published); toast(g.published ? 'Unpublished' : 'Published'); await reloadGames(); await reloadDash(); }
    if (b.dataset.a === 'feat') { await DC.setFeatured(g.id, !g.featured); toast('Updated'); await reloadGames(); }
    if (b.dataset.a === 'del' && await confirmBox(`Delete “${g.name}” and its images permanently?`)) {
      await DC.deleteGame(g); toast('Deleted'); if (editingGame && editingGame.id === g.id) closeGameEditor();
      await reloadGames(); await reloadDash();
    }
  } catch (err) { toast(err.message, true); }
};
$('#btnNewGame').onclick = () => openGameEditor(null);

const F = id => $('#f_' + id);
function closeGameEditor() { $('#geditor').hidden = true; editingGame = null; }
function openGameEditor(g) {
  editingGame = g; icon = null; shots = []; removedPaths = [];
  $('#gf').reset(); F('pub').checked = true; F('slug').readOnly = !!g;
  $('#gtitle').textContent = g ? 'Edit: ' + g.name : 'Add Game';
  $('#ferr').textContent = ''; $('#sc').textContent = '0/160';
  if (g) {
    F('name').value = g.name; F('slug').value = g.slug; F('cat').value = g.category; F('ver').value = g.version;
    F('status').value = g.status; F('date').value = g.release_date || '';
    F('short').value = g.short_desc; F('full').value = g.full_desc || '';
    F('apk').value = g.apk_url || ''; F('play').value = g.play_url || '';
    F('feat').checked = g.featured; F('pub').checked = g.published;
    $('#sc').textContent = (g.short_desc || '').length + '/160';
    icon = g.icon_url ? { url: g.icon_url, path: g.icon_path } : null;
    shots = (g.screenshots || []).map(s => ({ ...s }));
    $('#gpreview').href = '../#game/' + encodeURIComponent(g.slug);
  } else {
    $('#gpreview').href = '../#games';
  }
  drawGamePrev();
  $('#geditor').hidden = false;
  $('#geditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function drawGamePrev() {
  $('#iconPrev').innerHTML = icon ? `<div class="pv ic"><img src="${esc(DC.img(icon.url))}" alt=""><button type="button" data-k="icon">×</button></div>` : '';
  $('#shotPrev').innerHTML = shots.map((s, i) => `<div class="pv"><img src="${esc(DC.img(s.url))}" alt=""><button type="button" data-k="${i}">×</button></div>`).join('');
}
$('#iconPrev').onclick = e => { if (e.target.dataset.k && icon) { if (icon.path && !icon.file) removedPaths.push(icon.path); icon = null; drawGamePrev(); } };
$('#shotPrev').onclick = e => { const k = e.target.dataset.k; if (k === undefined) return; const s = shots.splice(+k, 1)[0]; if (s.path && !s.file) removedPaths.push(s.path); drawGamePrev(); };
F('short').oninput = () => $('#sc').textContent = F('short').value.length + '/160';
F('name').oninput = () => { if (!editingGame && !F('slug').dataset.touched) F('slug').value = slugify(F('name').value); };
F('slug').oninput = () => { F('slug').dataset.touched = '1'; };
function checkFile(f, max) {
  if (![...OK, 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(f.type) && !OK.includes(f.type)) {
    if (!OK.includes(f.type)) return `“${f.name}” type not allowed.`;
  }
  if (OK.includes(f.type) === false && f.type.startsWith('image/')) { /* media allows more */ }
  if (f.size > max) return `“${f.name}” is larger than ${Math.round(max / 1048576)} MB.`;
  return '';
}
F('icon').onchange = e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!OK.includes(f.type)) return toast('Icon must be PNG, JPG or WebP.', true);
  if (f.size > ICON_MAX) return toast('Icon max 1 MB.', true);
  if (icon && icon.path && !icon.file) removedPaths.push(icon.path);
  icon = { url: URL.createObjectURL(f), path: '', file: f }; drawGamePrev();
};
F('shots').onchange = e => {
  const fs = [...e.target.files]; e.target.value = '';
  for (const f of fs) {
    if (!OK.includes(f.type)) { toast(`${f.name}: use PNG/JPG/WebP`, true); continue; }
    if (f.size > SHOT_MAX) { toast(`${f.name}: max 3 MB`, true); continue; }
    if (shots.length >= MAX_SHOTS) { toast('Max 10 screenshots', true); break; }
    shots.push({ url: URL.createObjectURL(f), path: '', file: f });
  }
  drawGamePrev();
};
$('#fcancel').onclick = closeGameEditor;
$('#gf').onsubmit = async e => {
  e.preventDefault(); const err = $('#ferr'); err.textContent = '';
  const v = {
    name: F('name').value.trim(), category: F('cat').value.trim(), version: F('ver').value.trim(),
    short_desc: F('short').value.trim(), full_desc: F('full').value.trim(),
    apk_url: F('apk').value.trim(), play_url: F('play').value.trim()
  };
  let slug = (F('slug').value || '').trim().toLowerCase();
  if (!v.name || !v.category || !v.version || !v.short_desc) return err.textContent = 'Fill required fields.';
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return err.textContent = 'Invalid Game ID.';
  if (v.apk_url && !httpUrl(v.apk_url, /(^|\.)drive\.google\.com$/)) return err.textContent = 'APK must be a Drive link.';
  if (v.play_url && !httpUrl(v.play_url, /(^|\.)play\.google\.com$/)) return err.textContent = 'Play URL invalid.';
  if (F('status').value === 'available' && !v.apk_url && !v.play_url) return err.textContent = 'Available games need APK or Play link.';
  if (!editingGame && games.some(g => g.slug === slug)) return err.textContent = 'Game ID already used.';
  const btn = $('#fsave'); btn.disabled = true; btn.textContent = 'Saving…';
  const uploaded = [];
  try {
    const up = async o => { if (!o.file) return { url: o.url, path: o.path }; const r = await DC.uploadGameImage(o.file, slug); if (r.path) uploaded.push(r.path); return r; };
    const ic = icon ? await up(icon) : { url: '', path: '' };
    const sh = []; for (const s of shots) sh.push(await up(s));
    const row = {
      ...v, slug, icon_url: ic.url, icon_path: ic.path, screenshots: sh,
      status: F('status').value, release_date: F('date').value || null,
      featured: F('feat').checked, published: F('pub').checked
    };
    if (editingGame) row.id = editingGame.id;
    await DC.saveGame(row);
    if (removedPaths.length) await DC.removeImages(removedPaths).catch(() => {});
    toast(editingGame ? 'Game updated' : 'Game saved');
    closeGameEditor(); await reloadGames(); await reloadDash();
  } catch (ex) {
    if (uploaded.length) await DC.removeImages(uploaded).catch(() => {});
    err.textContent = 'Save failed: ' + ex.message;
  }
  btn.disabled = false; btn.textContent = 'Save';
};

/* ---- pages ---- */
async function reloadPages() {
  try { pages = await DC.listPages(true); renderPages(); } catch (e) { toast(e.message, true); }
}
function filteredPages() {
  const q = ($('#psearch').value || '').trim().toLowerCase();
  if (!q) return pages;
  return pages.filter(p => [p.title, p.slug].join(' ').toLowerCase().includes(q));
}
function renderPages() {
  const list = filteredPages();
  $('#plist').innerHTML = list.length ? list.map(p => `
    <div class="ci" data-id="${esc(p.id)}">
      <div class="ph">P</div>
      <div class="inf"><b>${esc(p.title)}</b><span>/${esc(p.slug)}</span>
        <div><span class="bd ${p.status === 'published' ? 'g' : 'm'}">${p.status}</span>
        <span class="bd ${p.visibility === 'public' ? 'g' : 'r'}">${p.visibility}</span></div></div>
      <div class="acts">
        <button type="button" class="btn sm" data-a="edit">Edit</button>
        <button type="button" class="btn sm" data-a="toggle">${p.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        <button type="button" class="btn sm" data-a="copy">Copy link</button>
        <button type="button" class="btn sm dng" data-a="del">Delete</button>
      </div>
    </div>`).join('') : '<div class="empty">No pages yet.</div>';
}
$('#psearch').oninput = renderPages;
$('#plist').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const p = pages.find(x => x.id === b.closest('.ci').dataset.id); if (!p) return;
  try {
    if (b.dataset.a === 'edit') openPageEditor(p);
    if (b.dataset.a === 'toggle') {
      await DC.savePage({ ...p, status: p.status === 'published' ? 'draft' : 'published' });
      toast(p.status === 'published' ? 'Unpublished' : 'Published');
      await reloadPages(); await reloadDash();
    }
    if (b.dataset.a === 'copy') {
      const url = `${location.origin.replace(/\/admin\/?$/, '')}/${p.slug}`;
      await navigator.clipboard.writeText(url); toast('Copied: ' + url);
    }
    if (b.dataset.a === 'del' && await confirmBox(`Delete page “${p.title}”?`)) {
      await DC.deletePage(p); toast('Deleted'); if (editingPage && editingPage.id === p.id) closePageEditor();
      await reloadPages(); await reloadDash();
    }
  } catch (err) { toast(err.message, true); }
};
$('#btnNewPage').onclick = () => openPageEditor(null);

function closePageEditor() { $('#peditor').hidden = true; editingPage = null; }
function openPageEditor(p) {
  editingPage = p;
  $('#pf').reset();
  $('#p_content').innerHTML = '';
  $('#p_slug').readOnly = false;
  $('#ptitle').textContent = p ? 'Edit: ' + p.title : 'New Page';
  $('#perr').textContent = '';
  if (p) {
    $('#p_title').value = p.title;
    $('#p_slug').value = p.slug;
    $('#p_slug').readOnly = ['privacy-policy', 'terms'].includes(p.slug);
    $('#p_status').value = p.status;
    $('#p_vis').value = p.visibility;
    $('#p_seo_title').value = p.seo_title || '';
    $('#p_seo_desc').value = p.seo_description || '';
    $('#p_content').innerHTML = p.content || '';
    $('#ppreview').href = '../' + p.slug;
  } else {
    $('#ppreview').href = '../';
  }
  $('#peditor').hidden = false;
  $('#peditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#p_title').oninput = () => { if (!editingPage && !$('#p_slug').dataset.touched) $('#p_slug').value = slugify($('#p_title').value); };
$('#p_slug').oninput = () => { $('#p_slug').dataset.touched = '1'; };
$('#pcancel').onclick = closePageEditor;
$('#pcopy').onclick = async () => {
  const slug = ($('#p_slug').value || '').trim();
  if (!slug) return toast('Set a slug first', true);
  const url = `${location.origin.replace(/\/admin\/?$/, '')}/${slug}`;
  try { await navigator.clipboard.writeText(url); toast('Copied: ' + url); } catch { toast(url); }
};
/* toolbar */
$('.toolbar').onclick = e => {
  const b = e.target.closest('button'); if (!b || !b.dataset.cmd) return;
  e.preventDefault();
  const cmd = b.dataset.cmd;
  if (cmd === 'createLink') {
    const url = prompt('Link URL', 'https://');
    if (url) document.execCommand('createLink', false, url);
  } else if (cmd === 'formatBlock') {
    document.execCommand('formatBlock', false, b.dataset.val || 'p');
  } else document.execCommand(cmd, false, null);
  $('#p_content').focus();
};
$('#pInsertImg').onclick = async () => {
  const url = prompt('Image URL (upload in Media Library first, then paste URL)');
  if (!url) return;
  document.execCommand('insertImage', false, url);
};
$('#pf').onsubmit = async e => {
  e.preventDefault(); const err = $('#perr'); err.textContent = '';
  const title = $('#p_title').value.trim();
  let slug = ($('#p_slug').value || '').trim().toLowerCase();
  if (!title) return err.textContent = 'Title required.';
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return err.textContent = 'Invalid slug.';
  if (!editingPage && pages.some(p => p.slug === slug)) return err.textContent = 'Slug already used.';
  const row = {
    title, slug,
    content: $('#p_content').innerHTML,
    seo_title: $('#p_seo_title').value.trim(),
    seo_description: $('#p_seo_desc').value.trim(),
    status: $('#p_status').value,
    visibility: $('#p_vis').value
  };
  if (editingPage) row.id = editingPage.id;
  try {
    await DC.savePage(row);
    toast('Page saved');
    closePageEditor(); await reloadPages(); await reloadDash();
  } catch (ex) { err.textContent = 'Save failed: ' + ex.message; }
};

/* ---- media ---- */
async function reloadMedia() {
  try { media = await DC.listMedia(); renderMedia(); } catch (e) { toast(e.message, true); }
}
function renderMedia() {
  $('#mgrid').innerHTML = media.length ? media.map(m => `
    <div class="mc" data-id="${esc(m.id)}">
      <img src="${esc(m.url)}" alt="" loading="lazy">
      <div class="mb"><b title="${esc(m.filename)}">${esc(m.filename)}</b>
        <span>${Math.round((m.size_bytes || 0) / 1024)} KB</span>
        <div class="row">
          <button type="button" class="btn sm" data-a="copy">Copy URL</button>
          <button type="button" class="btn sm dng" data-a="del">Delete</button>
        </div>
      </div>
    </div>`).join('') : '<div class="empty">No media uploaded yet.</div>';
}
$('#mupload').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) {
    if (f.size > MEDIA_MAX) { toast(`${f.name}: max 5 MB`, true); continue; }
    try { await DC.uploadMedia(f); toast('Uploaded ' + f.name); } catch (err) { toast(err.message, true); }
  }
  await reloadMedia();
};
$('#mgrid').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const m = media.find(x => x.id === b.closest('.mc').dataset.id); if (!m) return;
  if (b.dataset.a === 'copy') {
    try { await navigator.clipboard.writeText(m.url); toast('URL copied'); } catch { toast(m.url); }
  }
  if (b.dataset.a === 'del' && await confirmBox(`Delete “${m.filename}”?`)) {
    try { await DC.deleteMedia(m); toast('Deleted'); await reloadMedia(); } catch (err) { toast(err.message, true); }
  }
};

/* ---- ads / seo / settings forms ---- */
async function loadSettingsForms() {
  try {
    const s = await DC.getSettings();
    $('#a_pub').value = s.admob_publisher_id || '';
    $('#a_txt').value = s.ads_txt || '';
    updateAdsStatus(s.ads_txt || '');
    $('#seo_title').value = s.homepage_title || '';
    $('#seo_desc').value = s.homepage_description || '';
    $('#seo_og').value = s.og_image_url || '';
    $('#seo_robots').value = s.robots_txt || '';
    $('#s_name').value = s.site_name || '';
    $('#s_mail').value = s.contact_email || '';
    $('#s_htitle').value = s.homepage_title || '';
    $('#s_hdesc').value = s.homepage_description || '';
    $('#s_about').value = s.about_text || '';
    $('#s_sup').value = s.support_text || '';
    $('#s_footer').value = s.footer_text || '';
    $('#s_discord').value = s.social_discord || '';
    $('#s_youtube').value = s.social_youtube || '';
    $('#s_twitter').value = s.social_twitter || '';
    $('#s_logo').value = s.logo_url || '';
    $('#s_fav').value = s.favicon_url || '';
    $('#s_show_about').checked = s.show_about !== 'false';
    $('#s_show_games').checked = s.show_games !== 'false';
    $('#s_show_news').checked = s.show_news !== 'false';
    $('#s_show_support').checked = s.show_support !== 'false';
  } catch (e) { toast(e.message, true); }
}
function updateAdsStatus(txt) {
  const lines = (txt || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const ok = lines.length > 0;
  $('#a_status').textContent = ok
    ? `Status: ${lines.length} rule(s) configured.\nAfter deploy, verify https://yoursite/ads.txt returns this text.`
    : 'Status: empty — ads.txt will be blank until you save content.';
}
$('#af').onsubmit = async e => {
  e.preventDefault(); $('#aerr').textContent = '';
  try {
    const txt = $('#a_txt').value;
    await DC.saveSettings({ admob_publisher_id: $('#a_pub').value.trim(), ads_txt: txt });
    updateAdsStatus(txt);
    toast('Ads settings saved — download ads.txt and upload to site root on next deploy');
    // Offer download so Direct Upload deploys can update root ads.txt without Functions
    const blob = new Blob([txt || ''], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ads.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (ex) { $('#aerr').textContent = ex.message; }
};
$('#seof').onsubmit = async e => {
  e.preventDefault(); $('#seoerr').textContent = '';
  try {
    await DC.saveSettings({
      homepage_title: $('#seo_title').value.trim(),
      homepage_description: $('#seo_desc').value.trim(),
      og_image_url: $('#seo_og').value.trim(),
      robots_txt: $('#seo_robots').value
    });
    toast('SEO settings saved');
  } catch (ex) { $('#seoerr').textContent = ex.message; }
};
$('#sf').onsubmit = async e => {
  e.preventDefault(); $('#serr').textContent = '';
  const m = $('#s_mail').value.trim();
  if (m && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) return $('#serr').textContent = 'Invalid email.';
  try {
    await DC.saveSettings({
      site_name: $('#s_name').value.trim(),
      contact_email: m,
      homepage_title: $('#s_htitle').value.trim(),
      homepage_description: $('#s_hdesc').value.trim(),
      about_text: $('#s_about').value.trim(),
      support_text: $('#s_sup').value.trim(),
      footer_text: $('#s_footer').value.trim(),
      social_discord: $('#s_discord').value.trim(),
      social_youtube: $('#s_youtube').value.trim(),
      social_twitter: $('#s_twitter').value.trim(),
      logo_url: $('#s_logo').value.trim(),
      favicon_url: $('#s_fav').value.trim(),
      show_about: String($('#s_show_about').checked),
      show_games: String($('#s_show_games').checked),
      show_news: String($('#s_show_news').checked),
      show_support: String($('#s_show_support').checked)
    });
    toast('Settings saved');
  } catch (ex) { $('#serr').textContent = ex.message; }
};

boot();

/* ---------------------------------------------------------------------------
   ADDED FOR DEVCHAZERS HQ (additive, no behaviour change otherwise)
   Lets HQ deep-link straight to a classic tab: /admin/?tab=games
--------------------------------------------------------------------------- */
(function () {
  try {
    var t = new URLSearchParams(location.search).get('tab');
    if (!t) return;
    var safe = String(t).replace(/[^a-z0-9_-]/gi, '');
    var btn = document.querySelector('#tabs button[data-t="' + safe + '"]');
    if (btn) setTimeout(function () { btn.click(); }, 0);
  } catch (e) { /* ignore */ }
})();
