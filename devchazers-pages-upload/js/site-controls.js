/* ============================================================================
   DevChazers — optional site controls (NOT referenced by index.html by default)
   ----------------------------------------------------------------------------
   This file is inert until you add ONE script tag to index.html:

       <script src="js/site-controls.js" defer></script>   (after data-service.js)

   It reads the hq_* settings created in DevChazers HQ → Website Settings →
   Site Controls and applies them on the public site:

       hq_banner_enabled     'true' → thin announcement bar at the very top
       hq_banner_text / hq_banner_link / hq_banner_tone ('info'|'success'|'warn')
       hq_maintenance_mode   'true' → full-screen maintenance notice
       hq_maintenance_message        → text shown on that notice
       hq_popup_enabled      'true' → announcement popup (once per 24h / browser)
       hq_popup_title / hq_popup_body / hq_popup_image
       hq_download_counter   'true' → records download clicks in hq_download_events

   Every branch is guarded: if Supabase or the tables are missing, the site
   renders exactly as it does today.
   ========================================================================== */
(function () {
  'use strict';
  var CFG = window.DC_CONFIG || {};
  var DC = window.DC;
  if (!DC || !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) return;
  // never interfere with the admin panels
  if (/\/admin(\/|$)/.test(location.pathname)) return;

  /* IMPORTANT: reuse the single shared client from js/data-service.js.
     Doosra client banane se Supabase ka refresh-token rotation toot jata tha
     ("Invalid Refresh Token" / "JWT expired"), is liye yahan naya client
     sirf fallback ke tor par banta hai. */
  function client() {
    try { if (DC && DC.client) { var c = DC.client(); if (c) return c; } } catch (e) { }
    return window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
  }
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  DC.getSettings().then(function (s) {
    s = s || {};
    if (s.hq_maintenance_mode === 'true') return maintenance(s);
    if (s.hq_banner_enabled === 'true' && s.hq_banner_text) banner(s);
    if (s.hq_popup_enabled === 'true') popup(s);
    if (s.hq_download_counter === 'true') countDownloads();
  }).catch(function () { /* stay silent: the site must never break */ });

  /* -------------------------------------------------------------- banner --
     HQ → AI Manager "homepage par banner laga do" command isi ko likhta hai.
     Ye bar fixed header ke oopar chipakti hai aur page ko utna neeche shift
     karti hai, taa ke kuch bhi dhak na jaye. 'X' se band (session ke liye). */
  function banner(s) {
    if (document.getElementById('dc-banner')) return;
    try { if (sessionStorage.getItem('dc_banner_x') === (s.hq_banner_text || '')) return; } catch (e) { }
    var tone = s.hq_banner_tone === 'success' ? 'success' : s.hq_banner_tone === 'warn' ? 'warn' : 'info';
    var pal = {
      info: 'linear-gradient(90deg,rgba(0,229,255,.16),rgba(124,77,255,.16))',
      success: 'linear-gradient(90deg,rgba(52,211,153,.18),rgba(0,229,255,.12))',
      warn: 'linear-gradient(90deg,rgba(251,191,36,.2),rgba(251,146,60,.14))'
    }[tone];
    var bar = document.createElement('div');
    bar.id = 'dc-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:30;display:flex;align-items:center;gap:10px;' +
      'padding:8px 14px;font:500 12.5px/1.4 Inter,system-ui,sans-serif;color:#eaf6ff;background:' + pal +
      ';border-bottom:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px)';
    var txt = esc(s.hq_banner_text);
    var msg = s.hq_banner_link
      ? '<a href="' + esc(s.hq_banner_link) + '" style="color:inherit;text-decoration:underline;text-underline-offset:2px">' + txt + '</a>'
      : txt;
    bar.innerHTML = '<span style="flex:1;min-width:0">' + msg + '</span>' +
      '<button type="button" aria-label="Dismiss" style="background:transparent;border:0;color:#cfe9ff;cursor:pointer;' +
      'font:16px Inter;line-height:1;padding:4px 6px;min-height:28px">×</button>';
    var shift = function () {
      var h = bar.offsetHeight || 0;
      document.documentElement.style.setProperty('--dc-banner-h', h + 'px');
      var hd = document.getElementById('hd');
      if (hd) hd.style.top = h + 'px';
      document.body.style.paddingTop = h + 'px';
    };
    bar.querySelector('button').addEventListener('click', function () {
      try { sessionStorage.setItem('dc_banner_x', s.hq_banner_text || ''); } catch (e) { }
      bar.remove();
      var hd = document.getElementById('hd');
      if (hd) hd.style.top = '';
      document.body.style.paddingTop = '';
    });
    (document.body || document.documentElement).insertBefore(bar, document.body.firstChild);
    shift();
    addEventListener('resize', shift, { passive: true });
  }

  function maintenance(s) {
    if (document.getElementById('dc-maint')) return;
    var el = document.createElement('div');
    el.id = 'dc-maint';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-label', 'Maintenance');
    el.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;' +
      'padding:24px;text-align:center;background:radial-gradient(700px 400px at 50% 0,rgba(124,77,255,.22),transparent 60%),#0a0a14;' +
      'color:#e8e8f5;font:15px/1.6 Inter,system-ui,sans-serif';
    el.innerHTML = '<div style="max-width:560px">' +
      '<img src="logo/logo-icon.svg" width="64" height="64" alt="" style="margin-bottom:18px">' +
      '<h1 style="font:700 clamp(22px,5vw,34px)/1.2 Orbitron,sans-serif;margin:0 0 12px">We\'ll be right back</h1>' +
      '<p style="color:#9a9ab8;margin:0">' + esc(s.hq_maintenance_message || 'DevChazers is doing a quick update. Please check back in a few minutes.') + '</p>' +
      '</div>';
    (document.body || document.documentElement).appendChild(el);
    document.documentElement.style.overflow = 'hidden';
  }

  function popup(s) {
    var KEY = 'dc_popup_seen_' + (s.hq_popup_title || '').slice(0, 24);
    try { var seen = +localStorage.getItem(KEY) || 0; if (Date.now() - seen < 864e5) return; } catch (e) { }
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99997;display:flex;align-items:center;justify-content:center;padding:18px;' +
      'background:#000b;backdrop-filter:blur(4px)';
    wrap.innerHTML =
      '<div role="dialog" aria-modal="true" style="position:relative;max-width:420px;width:100%;background:#161628;border:1px solid #23233d;' +
      'border-radius:20px;overflow:hidden;box-shadow:0 30px 80px -20px #000;color:#e8e8f5;font:14px/1.6 Inter,system-ui,sans-serif">' +
      (s.hq_popup_image ? '<img src="' + esc(s.hq_popup_image) + '" alt="" style="width:100%;max-height:200px;object-fit:cover;display:block">' : '') +
      '<div style="padding:20px">' +
      '<h2 style="font:700 18px/1.3 Orbitron,sans-serif;margin:0 0 8px">' + esc(s.hq_popup_title || 'News from DevChazers') + '</h2>' +
      '<p style="color:#9a9ab8;margin:0 0 16px;white-space:pre-wrap">' + esc(s.hq_popup_body || '') + '</p>' +
      '<button type="button" data-x style="background:linear-gradient(135deg,#7c4dff,#00e5ff);color:#fff;border:0;border-radius:8px;' +
      'padding:11px 22px;font:600 13px Inter,sans-serif;cursor:pointer;min-height:44px">Got it</button>' +
      '</div></div>';
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.closest('[data-x]')) {
        wrap.remove();
        try { localStorage.setItem(KEY, String(Date.now())); } catch (err) { }
      }
    });
    document.body.appendChild(wrap);
  }

  function countDownloads() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      var h = a.getAttribute('href') || '';
      if (!/drive\.google\.com|play\.google\.com/.test(h)) return;
      var m = /#game\/([\w-]+)/.exec(location.hash || '');
      var sb = client();
      if (!sb) return;
      sb.from('hq_download_events').insert({ game_slug: m ? m[1] : null, source: /play\.google\.com/.test(h) ? 'play' : 'drive' })
        .then(function () { }).catch(function () { });
    }, true);
  }
})();
