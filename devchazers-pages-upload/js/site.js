const CONFIG = {
  email: 'contact@devchazers.site',
  discord: '#', trailer: '#', heroImage: '',
  news: [
    { tag: 'Studio', emoji: '🚀', title: 'DevChazers is now live!', text: 'Welcome to our new home. Our first games are on the way.' },
    { tag: 'Design', emoji: '🎨', title: 'Behind the scenes of our next game', text: 'A peek at the art and ideas shaping what we build next.' }
  ]
};
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const grads = ['linear-gradient(160deg,#7c4dff,#0a0a14)', 'linear-gradient(160deg,#00e5ff,#11111f)', 'linear-gradient(160deg,#ff3d81,#0a0a14)'];
let GAMES = [], SET = {};

$('#yr').textContent = new Date().getFullYear();
$$('.dt').forEach(e => e.textContent = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
if (CONFIG.discord && CONFIG.discord !== '#') $('#disc').href = CONFIG.discord; else $('#disc').style.display = 'none';
if (CONFIG.trailer && CONFIG.trailer !== '#') $('#trailer').href = CONFIG.trailer; else $('#trailer').style.display = 'none';
$('#ncs').innerHTML = CONFIG.news.map(n => `<div class="nc"><div class="im">${n.emoji}</div><div class="b"><span class="tag">${esc(n.tag)}</span><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p></div></div>`).join('');

const thumb = (g, i = 0) => (g.screenshots && g.screenshots[0]) ? `background-image:url('${esc(DC.img(g.screenshots[0].url))}')` : `background:${grads[i % 3]}`;
const iconHtml = (g, c = '') => g.icon_url ? `<img class="gico ${c}" src="${esc(DC.img(g.icon_url))}" alt="" loading="lazy">` : `<span class="gico ph ${c}">${esc((g.name || '?')[0])}</span>`;
const dlBtn = g => g.status === 'available' && g.apk_url ? `<a class="pill w" href="${esc(DC.apkHref(g.apk_url))}" target="_blank" rel="noopener">⬇ Download APK</a>` : `<span class="pill dis">Coming Soon</span>`;
const playBtn = g => g.play_url ? `<a class="pill" href="${esc(g.play_url)}" target="_blank" rel="noopener">Google Play</a>` : '';

function applySettings() {
  const email = SET.contact_email || CONFIG.email;
  $$('.em2').forEach(e => e.textContent = email);
  const cs = $('#c_s'); if (cs) cs.dataset.email = email;
  if (SET.about_text && $('#about_p')) $('#about_p').textContent = SET.about_text;
  if (SET.support_text && $('#sup_p')) $('#sup_p').textContent = SET.support_text;
  if (SET.footer_text) {
    const fp = document.querySelector('footer .muted');
    if (fp) fp.textContent = SET.footer_text;
  }
  if (SET.site_name) {
    $$('footer .logo b, .wm').forEach(e => { if (e) e.textContent = SET.site_name; });
  }
  if (SET.homepage_title) document.title = SET.homepage_title;
  const md = document.querySelector('meta[name="description"]');
  if (md && SET.homepage_description) md.setAttribute('content', SET.homepage_description);
  if (SET.favicon_url) {
    let link = document.querySelector('link[rel="icon"]');
    if (link) link.href = SET.favicon_url;
  }
  // section visibility
  const map = { show_about: '#about', show_games: '#games', show_news: '#news', show_support: '#support' };
  Object.entries(map).forEach(([k, sel]) => {
    const el = document.querySelector(sel);
    if (el) el.style.display = SET[k] === 'false' ? 'none' : '';
  });
  if (SET.social_discord && SET.social_discord !== '#') {
    const d = $('#disc'); if (d) { d.href = SET.social_discord; d.style.display = ''; }
  }
}

function renderGames() {
  const box = $('#ggrid');
  if (!GAMES.length) { box.innerHTML = '<div class="gempty">No games published yet. New releases are coming soon.</div>'; }
  else box.innerHTML = GAMES.map((g, i) => `<article class="gcard"><a class="gimg" href="#game/${esc(g.slug)}" style="${thumb(g, i)}" aria-label="${esc(g.name)}">
    ${g.featured ? '<span class="feat">★ Featured</span>' : ''}<span class="st ${g.status === 'available' ? 'ok' : 'soon'}">${g.status === 'available' ? 'Available' : 'Coming Soon'}</span></a>
    <div class="gb"><div class="gt">${iconHtml(g)}<div><h3>${esc(g.name)}</h3><span class="tag">${esc(g.category)}</span></div></div>
    <p>${esc(g.short_desc)}</p><div class="row"><a class="pill" href="#game/${esc(g.slug)}">View Details</a>${dlBtn(g)}</div></div></article>`).join('');
  $('#strips').innerHTML = (GAMES.length ? GAMES : [{}, {}, {}]).slice(0, 4).map((g, i) => `<div class="strip" style="${thumb(g, i)}"></div>`).join('');
  $('#fgames').innerHTML = GAMES.length ? GAMES.map(g => `<li><a href="#game/${esc(g.slug)}">${esc(g.name)}</a></li>`).join('') : '<li><a href="#games">Coming soon</a></li>';
  $('#n1').dataset.n = GAMES.filter(g => g.status === 'available').length;
  $('#ra_sel').innerHTML = GAMES.length ? GAMES.map((g, i) => `<option value="${i}">${esc(g.name)}</option>`).join('') : '<option>Our games will appear here</option>';
  raShow(); countUp();
}
function raShow() { const g = GAMES[+$('#ra_sel').value]; $('#ra_out').innerHTML = g && g.play_url ? `<a class="pill w" href="${esc(g.play_url)}" target="_blank" rel="noopener">Open ${esc(g.name)} on Google Play</a>` : '<span class="muted">Available once the game is on Google Play.</span>'; }
$('#ra_sel').onchange = raShow;

/* ---- game page + gallery ---- */
let shots = [], cur = 0;
function showShot(i) {
  if (!shots.length) return; cur = (i + shots.length) % shots.length;
  const im = $('#gmain'); if (!im) return;
  im.classList.add('fade');
  setTimeout(() => { im.src = shots[cur]; im.classList.remove('fade'); }, 120);
  $$('#gthumbs img').forEach((t, k) => t.classList.toggle('on', k === cur));
  if ($('#lb').classList.contains('open')) $('#lbimg').src = shots[cur];
}
function renderGame(slug) {
  const g = GAMES.find(x => x.slug === slug), box = $('#gpage');
  if (!g) { box.innerHTML = '<a class="back" href="#games">← All games</a><div class="gempty">This game was not found or is not published.</div>'; return; }
  shots = (g.screenshots || []).map(s => DC.img(s.url)); cur = 0;
  const meta = [g.category, 'v' + g.version, g.release_date ? new Date(g.release_date).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : ''].filter(Boolean).map(esc).join(' · ');
  box.innerHTML = `<a class="back" href="#games">← All games</a>
  <div class="ghead">${iconHtml(g, 'big')}<div><h1>${esc(g.name)}</h1><div class="muted">${meta}</div>
  <span class="st inl ${g.status === 'available' ? 'ok' : 'soon'}">${g.status === 'available' ? 'Available' : 'Coming Soon'}</span></div></div>
  ${shots.length ? `<div class="gal"><button class="nav l" id="gp" aria-label="Previous">‹</button><img id="gmain" src="${esc(shots[0])}" alt="${esc(g.name)} screenshot" tabindex="0"><button class="nav r" id="gn" aria-label="Next">›</button></div>
  <div class="thumbs" id="gthumbs">${shots.map((s, i) => `<img src="${esc(s)}" alt="" loading="lazy" class="${i ? '' : 'on'}" data-i="${i}">`).join('')}</div>` : ''}
  <h3>About this game</h3><p class="desc">${esc(g.full_desc || g.short_desc)}</p>
  <div class="row">${dlBtn(g)}${playBtn(g)}</div>
  <p class="muted" style="font-size:12px;margin-top:14px">APK files are hosted on Google Drive. Allow installs from your browser when your phone asks.</p>`;
  if (shots.length) {
    $('#gp').onclick = () => showShot(cur - 1); $('#gn').onclick = () => showShot(cur + 1);
    $('#gmain').onclick = () => { $('#lbimg').src = shots[cur]; $('#lb').classList.add('open'); };
    $('#gthumbs').onclick = e => { const t = e.target.closest('img'); if (t) showShot(+t.dataset.i); };
  }
}
$('#lbx').onclick = () => $('#lb').classList.remove('open');
$('#lbp').onclick = () => showShot(cur - 1); $('#lbn').onclick = () => showShot(cur + 1);
$('#lb').onclick = e => { if (e.target.id === 'lb') $('#lb').classList.remove('open'); };
addEventListener('keydown', e => {
  if (!$('#lb').classList.contains('open')) return;
  if (e.key === 'Escape') $('#lb').classList.remove('open'); if (e.key === 'ArrowLeft') showShot(cur - 1); if (e.key === 'ArrowRight') showShot(cur + 1);
});
let tx = 0; $('#lb').addEventListener('touchstart', e => tx = e.touches[0].clientX, { passive: true });
$('#lb').addEventListener('touchend', e => { const d = e.changedTouches[0].clientX - tx; if (Math.abs(d) > 50) showShot(cur + (d < 0 ? 1 : -1)); });

/* ---- CMS page ---- */
async function renderCmsPage(slug) {
  const box = $('#cms_page');
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const p = await DC.getPageBySlug(slug, false);
    if (!p) {
      box.innerHTML = '<a class="back" href="/">← Home</a><div class="gempty">This page is not available.</div>';
      return;
    }
    if (p.seo_title) document.title = p.seo_title;
    const md = document.querySelector('meta[name="description"]');
    if (md && p.seo_description) md.setAttribute('content', p.seo_description);
    box.innerHTML = `<a class="back" href="/">← Home</a><h1>${esc(p.title)}</h1><div class="cms-body">${p.content || ''}</div>`;
  } catch {
    box.innerHTML = '<a class="back" href="/">← Home</a><div class="gempty">Could not load this page.</div>';
  }
}

/* ---- contact ---- */
$('#c_s').onclick = () => {
  const n = $('#c_n').value.trim(), e = $('#c_e').value.trim(), m = $('#c_m').value.trim();
  if (!n || !m) return alert('Please fill in your name and message');
  location.href = 'mailto:' + $('#c_s').dataset.email + '?subject=' + encodeURIComponent('Message from ' + n) + '&body=' + encodeURIComponent(m + '\n\n' + n + ' (' + e + ')');
};

/* ---- discreet admin gate ---- */
const ak = $('#adminKey');
if (ak) ak.addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !ak.value) return;
  const pw = ak.value; ak.value = ''; ak.disabled = true;
  try {
    if (!DC.live) throw new Error('Supabase not configured');
    await DC.signIn(pw);
    if (await DC.isAdmin()) location.href = DC.root + 'admin/';
    else { await DC.signOut(); throw new Error('Not an admin'); }
  } catch (err) {
    ak.style.borderColor = '#ef6464'; ak.title = err.message;
    setTimeout(() => { ak.style.borderColor = 'transparent'; ak.title = ''; }, 1400);
  } finally { ak.disabled = false; }
});

/* ---- routing: path + hash ---- */
const BUILTIN = new Set(['', 'home', 'contact', 'privacy', 'terms', 'remove-ads', 'game']);
function currentRoute() {
  const path = (location.pathname || '/').replace(/\/+$/, '') || '/';
  const seg = path === '/' ? '' : path.slice(1).split('/')[0];
  const hash = (location.hash || '').slice(1);
  // Prefer path-based CMS slugs when not a static asset path
  if (seg && !['admin', 'js', 'css', 'logo', 'games', 'functions'].includes(seg) && !seg.includes('.')) {
    if (hash.startsWith('game/')) return { type: 'game', slug: decodeURIComponent(hash.slice(5)) };
    if (['contact', 'remove-ads'].includes(seg)) return { type: 'builtin', page: seg };
    // legacy privacy/terms redirect to CMS
    if (seg === 'privacy') return { type: 'cms', slug: 'privacy-policy' };
    return { type: 'cms', slug: seg };
  }
  if (hash.startsWith('game/')) return { type: 'game', slug: decodeURIComponent(hash.slice(5)) };
  if (['contact', 'privacy', 'terms', 'remove-ads'].includes(hash)) {
    if (hash === 'privacy') return { type: 'cms', slug: 'privacy-policy' };
    if (hash === 'terms') return { type: 'cms', slug: 'terms' };
    return { type: 'builtin', page: hash };
  }
  return { type: 'home', hash };
}

function route() {
  const r = currentRoute();
  if (r.type === 'cms') {
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-cms'));
    renderCmsPage(r.slug);
    scrollTo(0, 0);
  } else if (r.type === 'game') {
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-game'));
    renderGame(r.slug);
    scrollTo(0, 0);
  } else if (r.type === 'builtin') {
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + r.page));
    scrollTo(0, 0);
  } else {
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-home'));
    const h = r.hash || 'home';
    if (['about', 'games', 'support', 'news'].includes(h)) setTimeout(() => { const el = document.getElementById(h); if (el) el.scrollIntoView(); }, 30);
    else scrollTo(0, 0);
  }
  setTimeout(() => $$('.view.on .rv:not(.show)').forEach(e => io.observe(e)), 60);
}
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); } }), { threshold: .1 });
function countUp() { const b = $('#n1'), t = +b.dataset.n || 0; let n = 0; clearInterval(b._t); b.textContent = 0; if (!t) return; b._t = setInterval(() => { b.textContent = ++n; if (n >= t) clearInterval(b._t); }, 90); }
addEventListener('hashchange', route);
addEventListener('popstate', route);
addEventListener('scroll', () => $('#hd').classList.toggle('s', scrollY > 40));

(async function init() {
  $('#ggrid').innerHTML = '<div class="gempty">Loading games…</div>';
  try { [GAMES, SET] = await Promise.all([DC.listGames(false), DC.getSettings().catch(() => ({}))]); }
  catch (err) { $('#ggrid').innerHTML = '<div class="gempty">Could not load games right now. Please refresh in a moment.</div>'; GAMES = []; }
  applySettings();
  if (GAMES.length || ($('#ggrid').textContent || '').indexOf('Could not') < 0) renderGames();
  route();
})();
       
