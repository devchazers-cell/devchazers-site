/* ============================================================================
   DevChazers HQ — session keeper                       NEW · 2026-11-12

   Ye file "token expire" wali har shikayat ka jawab hai.

   Masla pehle kya tha:
     • js/data-service.js apna Supabase client banata tha aur hq-data.js
       DOOSRA client (usi localStorage key par). Refresh token rotation on hai,
       is liye dono clients ek doosre ka refresh token "already used" kar dete
       the → "Invalid Refresh Token" / "JWT expired" errors.
     • Token 1 ghante me expire hota tha aur koi proactive refresh nahi tha.
     • Raw error text (JWT expired, PGRST301…) seedha toast me aata tha.

   Ab kya hota hai:
     • Sirf EK client (DC ka) — hq-data.js bhi wahi use karta hai.
     • Har 5 minute (aur tab wapas focus par) session silently refresh hoti hai.
     • Koi bhi DB/storage call auth error de to: refresh → ek retry.
     • Phir bhi fail ho to ek hi dafa "Session expired — password" modal aata
       hai; daba kar continue karo, page wapas load ho jata hai.
     • User ko kabhi raw token text nahi dikhta — sirf saaf message.
   ========================================================================== */
(function () {
  const HQ = window.HQ = window.HQ || {};
  const LS_EMAIL = 'dc_hq_email';
  const KEEPALIVE_MS = 5 * 60 * 1000;
  const REFRESH_WHEN_LEFT_MS = 20 * 60 * 1000;

  const S = HQ.session = {
    ready: false,
    email: '',
    dead: false,
    lastRefresh: 0,
    expiresAt: 0,
    _timer: null,
    _prompting: false,
    _listeners: []
  };

  /* --------------------------------------------------------------- helpers */
  const client = () => {
    try { return (window.DC && typeof DC.client === 'function') ? DC.client() : null; } catch (e) { return null; }
  };
  S.client = client;
  S.online = () => !!(window.DC && DC.live && client());

  const AUTH_RE = /jwt expired|invalid jwt|jwt malformed|invalid claim|token has expired|refresh.?token|pgrst30[13]|not signed in|no session|session.*(missing|expired|not found)|invalid_grant|\b401\b|authorization.*required/i;
  S.isAuthError = err => {
    const msg = [err && err.message, err && err.error_description, err && err.error, err && err.code, err && err.status, err && err.details]
      .filter(Boolean).join(' ');
    return AUTH_RE.test(msg);
  };

  /** Short, human message. Raw provider text never reaches the screen. */
  S.friendly = (err, fallback) => {
    const raw = String((err && (err.message || err.error_description || err.error)) || err || '');
    const e = raw.toLowerCase();
    if (/jwt expired|invalid jwt|invalid claim|pgrst301/.test(e)) return 'Your session needed a refresh — trying again.';
    if (/refresh token|invalid_grant|pgrst303|already used/.test(e)) return 'Your sign-in ended. Enter your password to continue.';
    if (/failed to fetch|networkerror|load failed|network request failed/.test(e)) return 'No connection to Supabase. Check your internet and retry.';
    if (/row-level security|rls|permission denied|not authorized/.test(e)) return 'This account is not allowed to do that — sign in again and retry.';
    if (/payload too large|entity too large|exceeded the maximum|too large/.test(e)) return 'That file is bigger than the storage limit.';
    if (/mime|content.?type|not supported/.test(e)) return 'That file type is not allowed in the media bucket.';
    if (/duplicate key|already exists/.test(e)) return 'That record already exists.';
    if (/timeout|timed out|aborted/.test(e)) return 'The request timed out. Try again.';
    if (/relation .* does not exist|does not exist/.test(e)) return 'A database table is missing — open System Status and run the SQL file.';
    return raw ? raw.replace(/\s+/g, ' ').slice(0, 180) : (fallback || 'Something went wrong — try again.');
  };
  HQ.friendlyError = S.friendly;

  /* --------------------------------------------------------------- events */
  S.on = fn => { if (typeof fn === 'function') S._listeners.push(fn); return () => { S._listeners = S._listeners.filter(f => f !== fn); }; };
  const emit = (type, extra) => { S._listeners.forEach(f => { try { f(type, extra); } catch (e) { } }); };

  /* ------------------------------------------------------------- refreshing */
  S.refresh = async (force) => {
    const c = client();
    if (!c) return { ok: false, reason: 'offline' };
    if (S._refreshing) return S._refreshing;
    S._refreshing = (async () => {
      try {
        const { data, error } = await c.auth.refreshSession();
        if (error) return { ok: false, reason: 'error', error };
        const session = data && data.session;
        if (!session) return { ok: false, reason: 'no-session' };
        S.lastRefresh = Date.now();
        S.expiresAt = (session.expires_at || 0) * 1000;
        S.dead = false;
        emit('refreshed');
        return { ok: true, session };
      } catch (e) {
        return { ok: false, reason: 'error', error: e };
      } finally { S._refreshing = null; }
    })();
    return S._refreshing;
  };

  /** Session lo; agar expire hone wali hai to pehle refresh kar lo. */
  S.ensure = async () => {
    const c = client();
    if (!c) return null;
    let { data } = await c.auth.getSession();
    let session = data && data.session;
    if (!session) return null;
    S.expiresAt = (session.expires_at || 0) * 1000;
    const left = S.expiresAt - Date.now();
    if (left < 10 * 60 * 1000) {
      const r = await S.refresh();
      if (r.ok) session = r.session;
    }
    return session;
  };

  S.token = async () => {
    const s = await S.ensure();
    return (s && s.access_token) || '';
  };

  /** Quiet background tick: keep the refresh token fresh while the tab is open. */
  S.keepAlive = async () => {
    if (!S.online() || document.hidden) return;
    const c = client();
    if (!c) return;
    const { data } = await c.auth.getSession().catch(() => ({ data: null }));
    const session = data && data.session;
    if (!session) return;
    const expires = (session.expires_at || 0) * 1000;
    const stale = Date.now() - S.lastRefresh > REFRESH_WHEN_LEFT_MS;
    if (stale || expires - Date.now() < REFRESH_WHEN_LEFT_MS) {
      const r = await S.refresh();
      if (r.ok) emit('kept-alive');
    }
  };

  /* ------------------------------------------------------------ auth retry */
  /**
   * withAuth(fn) — kisi bhi Supabase call ko is me lapet do.
   * Auth error aayi to: refresh → ek dafa dobara. Phir bhi nahi chala to
   * ek hi dafa password maang kar continue karta hai.
   */
  S.withAuth = async (fn) => {
    const session = await S.ensure();
    try {
      return await fn(session);
    } catch (e) {
      if (!S.isAuthError(e)) throw e;
      const r = await S.refresh(true);
      if (r.ok) {
        try { return await fn(r.session); }
        catch (e2) {
          if (!S.isAuthError(e2)) throw e2;
          S.expired();
          throw new Error('Your sign-in ended. Enter your password to continue.');
        }
      }
      S.expired();
      throw new Error('Your sign-in ended. Enter your password to continue.');
    }
  };
  S.guard = S.withAuth;   /* alias */

  /* ------------------------------------------------------- expired → login */
  S.signInAgain = async (email, password) => {
    const c = client();
    if (!c) throw new Error('Supabase is not reachable.');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'That password did not match.' : S.friendly(error, 'Sign-in failed.'));
    const ok = await DC.isAdmin().catch(() => false);
    if (!ok) { await c.auth.signOut().catch(() => { }); throw new Error('This account is not an admin.'); }
    S.email = email;
    S.dead = false;
    S.lastRefresh = Date.now();
    S.expiresAt = ((data && data.session && data.session.expires_at) || 0) * 1000;
    try { localStorage.setItem(LS_EMAIL, email); } catch (e) { }
    emit('signed-in');
    return true;
  };

  S.expired = () => {
    S.dead = true;
    emit('expired');
    if (S._prompting) return;
    S._prompting = true;

    const email = S.email || (function () { try { return localStorage.getItem(LS_EMAIL) || ''; } catch (e) { return ''; } })();
    const after = () => {
      S._prompting = false;
      if (HQ.reload) HQ.reload(true); else location.reload();
    };

    /* Modal agar UI kit load hai, warna simple prompt. */
    if (!HQ.modal) {
      const pw = window.prompt('Session expired — enter your password to continue (' + (email || 'admin') + ')');
      if (pw) S.signInAgain(email, pw).then(after).catch(e => HQ.toast && HQ.toast(e.message, true));
      return;
    }

    const m = HQ.modal({
      title: 'Session expired',
      sub: 'Your sign-in timed out. Enter your password to continue — nothing you saved is lost.',
      size: 'sm',
      body: '<div class="hq-note a">' + HQ.icon('lock') + '<div class="grow">HQ keeps your session fresh automatically; this only appears after a long time away or a password change.</div></div>' +
        '<div class="hq-form"><label class="hq-field full"><span>Email</span>' +
        '<input name="email" type="email" value="' + HQ.esc(email) + '" autocomplete="username"></label>' +
        '<label class="hq-field full"><span>Password</span>' +
        '<input name="password" type="password" autocomplete="current-password"></label></div>' +
        '<p class="hq-tiny" id="sess-msg" style="min-height:16px"></p>',
      footer: '<button type="button" class="btn" data-signout>Sign out</button>' +
        '<button type="button" class="btn pri" data-continue>Continue</button>',
      onMount(api) {
        const go = async () => {
          const em = (api.q('[name=email]').value || '').trim();
          const pw = api.q('[name=password]').value;
          if (!em || !pw) { api.q('#sess-msg').textContent = 'Email and password are required.'; return; }
          api.q('[data-continue]').disabled = true;
          api.q('#sess-msg').textContent = 'Signing in…';
          try { await S.signInAgain(em, pw); api.close(); after(); }
          catch (e) { api.q('#sess-msg').textContent = e.message; api.q('[data-continue]').disabled = false; }
        };
        api.q('[data-continue]').onclick = go;
        api.q('[name=password]').onkeydown = e => { if (e.key === 'Enter') go(); };
        api.q('[data-signout]').onclick = async () => { try { await DC.signOut(); } catch (e) { } location.reload(); };
        setTimeout(() => { try { api.q('[name=password]').focus(); } catch (e) { } }, 60);
      }
    });
    return m;
  };

  /* ----------------------------------------------------------------- boot */
  S.start = (email) => {
    S.ready = true;
    S.email = email || S.email || '';
    if (S.email) { try { localStorage.setItem(LS_EMAIL, S.email); } catch (e) { } }
    S.lastRefresh = Date.now();
    if (S._timer) clearInterval(S._timer);
    S._timer = setInterval(() => { S.keepAlive(); }, KEEPALIVE_MS);

    const c = client();
    if (c && c.auth && typeof c.auth.onAuthStateChange === 'function' && !S._watching) {
      S._watching = true;
      c.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED' && session) {
          S.lastRefresh = Date.now();
          S.expiresAt = (session.expires_at || 0) * 1000;
          S.dead = false;
          emit('refreshed');
        }
        if (event === 'SIGNED_OUT' && S.ready) {
          /* Sign-out kisi aur tab me hua — yahan bhi gate dikhao. */
          emit('expired');
        }
      });
    }

    if (!S._listening) {
      S._listening = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) S.keepAlive(); });
      window.addEventListener('online', () => { S.keepAlive(); });
      window.addEventListener('focus', () => { S.keepAlive(); });
    }
  };

  S.status = () => ({
    ready: S.ready, dead: S.dead, email: S.email,
    expiresAt: S.expiresAt, minutesLeft: S.expiresAt ? Math.round((S.expiresAt - Date.now()) / 60000) : 0
  });
})();
