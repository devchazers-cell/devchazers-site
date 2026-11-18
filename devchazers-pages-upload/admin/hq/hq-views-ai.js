/* ============================================================================
   DevChazers HQ — AI Website Manager (Assistant + Live Activity)
   ----------------------------------------------------------------------------
   Do views:
     #/ai           → AI Assistant (chat + approval + right "current task" panel)
     #/ai/activity  → Live Activity (timeline, approvals, action log, budget,
                       project memory, kill switch)

   IMPORTANT (honesty rules baked into this file):
     • Timeline steps come from the server as they actually happen (SSE). Koi
       timer-based fake progress nahi. Jo step DB/API ka hai wo "API action"
       label ke saath aata hai — "clicked" kabhi nahi likha jata.
     • Result card sirf tab "Verified" dikhata hai jab server ne DB se dobara
       parh kar confirm kiya ho.
     • AI key browser me kabhi nahi aati; sab kuch /api/hq/ai se guzarta hai.
   ========================================================================== */
(function () {
  const HQ = window.HQ, ui = HQ.ui, esc = HQ.esc;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const EXAMPLES = [
    'Website ka status batao',
    'Homepage par banner laga do: "Eid Mubarak — 2 new games live!"',
    'Games ki list dikhao aur batado kaun si published hain',
    'Privacy policy page ka content update karo',
    'Akhri 7 din ke visitors kitne hain?',
    'Homepage par announcement popup on kar do',
    'Maintenance mode on kar do — 10 minute ke liye'
  ];

  const CAT_NOTE = {
    A: 'Read / prepare — no confirmation needed',
    B: 'Your approval required before it goes live',
    C: 'Strong confirmation — type DELETE'
  };

  /* ========================================================== shared state */
  const A = window.HQAI = {
    status: null, statusErr: '', steps: [], messages: [], pending: null,
    running: false, phase: 'idle', conversation_id: null, lastResult: null,
    error: null, history: null, memory: null, view: '',
    subs: new Set(), ctrl: null, timer: null
  };
  A.emit = () => { A.subs.forEach(fn => { try { fn(); } catch (e) { } }); };
  A.sub = fn => { A.subs.add(fn); return () => A.subs.delete(fn); };

  /* ============================================================== api glue */
  const getJSON = what => HQ.api('/api/hq/ai?what=' + what);
  const postJSON = body => HQ.api('/api/hq/ai', { method: 'POST', body: JSON.stringify(body) });

  async function stream(body, onEvent, ctrl) {
    const token = await HQ.accessToken();
    if (!token) throw new Error('Not signed in — the AI backend needs an admin session.');
    const res = await fetch('/api/hq/ai', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();

    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { }
      throw new Error(msg);
    }
    /* Function deploy nahi hua → Cloudflare SPA HTML deta hai. Usay JSON samajh
       kar fake success dena hi sab se bara bug tha; yahan saaf error aata hai. */
    if (ct.indexOf('event-stream') < 0) {
      const txt = await res.text();
      if (/^\s*</.test(txt)) throw new Error('The /api/hq/ai function is not deployed yet (the server returned a web page). Deploy functions/ first.');
      onEvent({ type: 'error', message: txt.slice(0, 200) });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        try { onEvent(JSON.parse(line.slice(6))); } catch (e) { }
      }
    }
  }

  /* ============================================================ run helpers */
  function pushMsg(role, text, extra) {
    A.messages.push(Object.assign({ role, text, at: new Date().toISOString() }, extra || {}));
    A.emit();
  }

  function handleEvent(ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'step') {
      const key = ev.label + '|' + ev.kind;
      const i = A.steps.findIndex(s => (s.label + '|' + s.kind) === key);
      const clean = { label: ev.label, kind: ev.kind || 'api', state: ev.state, detail: ev.detail || '', ms: ev.ms, data: ev.data };
      if (i >= 0) A.steps[i] = Object.assign(A.steps[i], clean); else A.steps.push(clean);
      A.emit(); return;
    }
    if (ev.type === 'conversation') { A.conversation_id = ev.conversation_id; A.emit(); return; }
    if (ev.type === 'reply') { pushMsg('assistant', ev.text, { model: ev.model, provider: ev.provider }); return; }
    if (ev.type === 'approval') {
      A.pending = ev; A.phase = 'awaiting';
      pushMsg('assistant', ev.reply || '', { approval: true });
      A.emit(); return;
    }
    if (ev.type === 'final') {
      A.phase = 'done'; A.pending = null;
      A.lastResult = ev;
      const r = ev.result || {};
      const text = ev.kind === 'cancelled' ? (ev.message || 'Cancelled.')
        : (r.summary || (ev.kind === 'answer' ? '' : 'Done.'));
      if (text) pushMsg('result', text, { final: ev });
      A.emit(); return;
    }
    if (ev.type === 'ai_error' || ev.type === 'error') {
      A.phase = 'error'; A.error = ev;
      pushMsg('error', ev.message || 'Something went wrong.', { code: ev.code });
      A.emit(); return;
    }
    if (ev.type === 'end') { A.emit(); return; }
  }

  async function run(body, ctrl) {
    A.running = true; A.phase = 'running'; A.steps = []; A.error = null;
    A.ctrl = ctrl;
    A.emit();
    try { await stream(body, handleEvent, ctrl); }
    catch (e) {
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) {
        A.phase = 'stopped';
        pushMsg('error', 'You stopped this task. Steps that already finished are shown above; nothing further was started.', { stopped: true });
      } else {
        A.phase = 'error'; A.error = { message: e.message };
        pushMsg('error', HQ.friendlyError ? HQ.friendlyError(e) : e.message, {});
      }
    } finally {
      A.running = false; A.ctrl = null;
      A.emit();
      A.refreshHistory();
    }
  }

  A.send = async (text) => {
    text = String(text || '').trim();
    if (!text) return;
    if (A.running) { HQ.toast('Ek task chal raha hai — pehle Stop karein.', true); return; }
    pushMsg('user', text);
    const ctrl = new AbortController();
    await run({ action: 'chat', message: text, conversation_id: A.conversation_id }, ctrl);
  };

  A.decide = async (decision, confirmWord) => {
    if (!A.pending) return;
    const id = A.pending.approval_id;
    A.pending = null; A.emit();
    const ctrl = new AbortController();
    await run({ action: 'approve', approval_id: id, decision, confirm: confirmWord || '' }, ctrl);
  };

  A.stop = () => { if (A.ctrl) { try { A.ctrl.abort(); } catch (e) { } } };

  A.loadStatus = async () => {
    try { A.status = await getJSON('status'); A.statusErr = ''; }
    catch (e) { A.status = null; A.statusErr = e.status === 404 || e.html ? 'AI backend not deployed yet — deploy functions/api/hq first.' : HQ.friendlyError(e); }
    A.emit();
  };

  A.refreshHistory = async () => {
    try { A.history = await getJSON('history'); } catch (e) { A.history = null; }
    A.emit();
  };

  A.loadMemory = async () => {
    try { const j = await getJSON('memory'); A.memory = j.memory || []; } catch (e) { A.memory = null; }
    A.emit();
  };

  A.setKill = async (enabled) => {
    const ok = await HQ.confirm(enabled
      ? 'Kill switch ON karein? Har AI action (read + write) block ho jayega.'
      : 'Kill switch OFF karein? AI dobara tools chala sakta hai (permissions waisi hi rahengi).',
      { ok: enabled ? 'Switch ON' : 'Switch OFF' });
    if (!ok) return;
    try { await postJSON({ action: 'kill', enabled }); HQ.toast(enabled ? 'AI actions blocked.' : 'AI actions allowed.'); }
    catch (e) { HQ.toast(HQ.friendlyError(e), true); }
    A.loadStatus();
  };

  A.saveMemory = async (key, value) => {
    try {
      const j = await postJSON({ action: 'memory', key, value });
      A.memory = j.memory || [];
      HQ.toast('Memory saved.');
    } catch (e) { HQ.toast(HQ.friendlyError(e), true); }
    A.emit();
  };

  /* ============================================================== rendering */
  const catBadge = c => '<span class="hq-ai-cat c' + c + '">' + c + ' · ' + esc(CAT_NOTE[c] || '') + '</span>';

  const stateIcon = s => s === 'done' ? '<span class="hq-ai-tick">✓</span>'
    : s === 'error' ? '<span class="hq-ai-tick err">!</span>'
      : '<span class="hq-ai-spin" aria-hidden="true"></span>';

  function stepRow(s) {
    const kindLabel = s.kind === 'ai' ? 'AI call' : s.kind === 'db' ? 'API action' : s.kind === 'guard' ? 'Permission check' : 'Step';
    return '<li class="hq-ai-step ' + s.state + '">' + stateIcon(s.state) +
      '<div class="grow"><b>' + esc(s.label) + '</b>' +
      (s.detail ? '<span>' + esc(s.detail) + '</span>' : '') + '</div>' +
      '<div class="meta"><span class="k">' + esc(kindLabel) + '</span>' +
      (s.ms !== undefined && s.ms !== null ? '<span class="ms">' + s.ms + ' ms</span>' : '') + '</div></li>';
  }

  function timeline(steps, emptyText) {
    if (!steps || !steps.length) return '<div class="hq-ai-idle">' + HQ.icon('clock') + '<b>No steps yet</b><span>' + esc(emptyText || 'Send a command and every real step will appear here as it runs.') + '</span></div>';
    return '<ol class="hq-ai-timeline">' + steps.map(stepRow).join('') + '</ol>';
  }

  function beforeAfter(ba) {
    if (!ba) return '';
    const cell = v => {
      if (v === null || v === undefined) return '<span class="hq-ai-na">—</span>';
      if (typeof v !== 'object') return esc(String(v));
      return Object.keys(v).map(k => '<div class="hq-ai-kv"><span>' + esc(k) + '</span><b>' + esc(String(v[k] === null ? '—' : v[k]).slice(0, 240)) + '</b></div>').join('');
    };
    return '<div class="hq-ai-diff"><div><h4>Before</h4>' + cell(ba.before) + '</div><div><h4>After</h4>' + cell(ba.after) + '</div></div>';
  }

  function threadHTML() {
    if (!A.messages.length && !A.pending) {
      return '<div class="hq-ai-hello">' +
        '<div class="ic">' + HQ.icon('sparkles') + '</div>' +
        '<b>Kya karna hai?</b>' +
        '<p>Roman Urdu, Urdu ya English me likhein. Main asli tools chalata hoon — har step aap ke saamne hota hai aur login hota hai. Aap ki permission ke bina kuch live nahi jata.</p>' +
        '<div class="hq-ai-chips">' + EXAMPLES.map(x => '<button type="button" data-ex="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div></div>';
    }
    if (!A.messages.length && A.pending) return '<div class="hq-ai-hello small">' + HQ.icon('shield') + '<b>Ek approval aap ka intezaar kar rahi hai</b></div>' + approvalHTML(A.pending);
    return A.messages.map(m => {
      if (m.role === 'user') return '<div class="hq-ai-msg me"><div class="b">' + esc(m.text) + '</div></div>';
      if (m.role === 'error') {
        const lastUser = A.messages.slice().reverse().find(x => x.role === 'user');
        const retry = (!m.stopped && lastUser && !A.running)
          ? '<button type="button" class="btn sm hq-ai-retry" data-retry="1">' + HQ.icon('refresh') + ' Dobara bhejein</button>'
          : '';
        return '<div class="hq-ai-msg err"><div class="b">' + HQ.icon('alert') + '<span>' + esc(m.text) + '</span></div>' + retry + '</div>';
      }
      if (m.role === 'result') {
        const f = m.final || {};
        const chips = [];
        if (f.tool) chips.push('<span class="hq-ai-chip">' + esc(f.tool) + '</span>');
        if (f.category) chips.push('<span class="hq-ai-chip cat c' + f.category + '">Category ' + f.category + '</span>');
        if (f.verified === true) chips.push('<span class="hq-ai-chip ok">' + HQ.icon('check') + 'Verified from database</span>');
        if (f.verified === false) chips.push('<span class="hq-ai-chip warn">' + HQ.icon('alert') + 'Could not verify</span>');
        if (f.kind === 'answer') chips.push('<span class="hq-ai-chip">Answer only — no change made</span>');
        return '<div class="hq-ai-msg out"><div class="b">' + esc(m.text) + '<div class="chips">' + chips.join('') + '</div></div></div>';
      }
      return '<div class="hq-ai-msg ai"><div class="who">' + HQ.icon('sparkles') + 'AI Manager</div><div class="b">' + esc(m.text) + '</div></div>';
    }).join('') + (A.pending ? approvalHTML(A.pending) : '');
  }

  function approvalHTML(p) {
    const n = p.preview || {};
    return '<div class="hq-ai-approve">' +
      '<div class="hd">' + HQ.icon('shield') + '<div class="grow"><b>Approval needed — ' + esc(n.title || p.tool) + '</b>' +
      '<span>' + catBadge(p.category) + (n.note ? ' · ' + esc(n.note) : '') + '</span></div></div>' +
      beforeAfter(n) +
      (p.needs_delete_word ? '<label class="hq-ai-delrow">Type <b>DELETE</b> to confirm<input type="text" id="ai-delword" placeholder="DELETE" autocomplete="off" spellcheck="false"></label>' : '') +
      '<div class="hq-ai-approve-acts">' +
      '<button type="button" class="btn pri" data-decide="approve" data-needs="' + (p.needs_delete_word ? '1' : '0') + '">' + (p.needs_delete_word ? 'Delete permanently' : 'Approve & run') + '</button>' +
      '<button type="button" class="btn" data-decide="reject">Cancel</button>' +
      '<span class="hq-tiny">Expires ' + esc(p.expires_at ? new Date(p.expires_at).toLocaleTimeString() : '') + '</span>' +
      '</div></div>';
  }

  function offlineNote() {
    if (!A.statusErr) return '';
    return ui.note({
      tone: 'w', icon: 'alert', title: 'AI backend not reachable.',
      text: esc(A.statusErr) + ' HQ stays usable — deploy <code>functions/api/hq/ai.js</code> (and the SQL) to switch the manager on.'
    });
  }

  function statusChips() {
    const s = A.status;
    if (A.statusErr) return '<span class="hq-chip r">' + HQ.icon('alert') + 'Backend offline</span>';
    if (!s) return '<span class="hq-chip">Loading…</span>';
    const out = [];
    out.push(s.kill_switch && s.kill_switch.enabled
      ? '<span class="hq-chip r">' + HQ.icon('lock') + 'Kill switch ON</span>'
      : '<span class="hq-chip g"><i class="hq-dot g"></i>AI armed</span>');
    out.push(s.ai && s.ai.configured
      ? '<span class="hq-chip">' + HQ.icon('sparkles') + esc(s.ai.providerLabel) + (s.ai.model ? ' · ' + esc(s.ai.model) : '') + '</span>'
      : '<span class="hq-chip w">' + HQ.icon('alert') + 'No AI key</span>');
    if (s.usage) out.push('<span class="hq-chip" title="Free tier only">' + s.usage.requests + ' AI calls this month · PKR ' + s.usage.cost.spent + ' spent</span>');
    if (s.pending_approvals) out.push('<span class="hq-chip w">' + s.pending_approvals + ' pending approval</span>');
    return out.join('');
  }

  function sideHTML() {
    const p = A.pending;
    const lastTool = p ? p.tool : (A.lastResult && A.lastResult.tool);
    const lastCat = p ? p.category : (A.lastResult && A.lastResult.category);
    const s = A.status || {};
    return ui.card({
      title: 'Current task',
      sub: A.running ? 'Running now' : A.phase === 'awaiting' ? 'Waiting for your approval' : 'Idle',
      body:
        '<div class="hq-ai-taskmeta">' +
        '<div><span>State</span><b class="' + (A.running ? 'w' : A.phase === 'error' ? 'r' : 'g') + '">' +
        (A.running ? 'Working…' : A.phase === 'awaiting' ? 'Your decision' : A.phase === 'error' ? 'Failed' : A.phase === 'stopped' ? 'Stopped by you' : 'Idle') + '</b></div>' +
        '<div><span>Tool</span><b>' + (lastTool ? esc(lastTool) : '—') + '</b></div>' +
        '<div><span>Permission</span><b>' + (lastCat ? 'Category ' + lastCat : '—') + '</b></div>' +
        '<div><span>Provider</span><b>' + (s.ai && s.ai.configured ? esc(s.ai.providerLabel) : 'not configured') + '</b></div>' +
        '</div>' +
        timeline(A.steps, 'Command bhejein — asli steps yahan live aayenge.') +
        (A.running ? '<button type="button" class="btn wide" data-stop>■ Stop task</button>' : '') +
        '<div class="hq-ai-links"><a href="#/ai/activity">Open Live Activity →</a>' +
        (s.ai && !s.ai.configured ? '<button type="button" class="lnk" data-ai-settings>Connect a free AI key</button>' : '') + '</div>'
    });
  }

  /* ------------------------------------------------------------ view: /ai */
  function viewAssistant(root) {
    A.subs.clear();
    root.innerHTML = ui.page(
      ui.head({
        title: 'AI Assistant',
        sub: 'Likhein — AI tool chunta hai, aap approve karte hain, phir asli change hota hai.',
        actions: '<span id="ai-status" class="hq-ai-status">' + statusChips() + '</span>' +
          '<a class="btn" href="#/ai/activity">Live Activity</a>'
      }) +
      '<div id="ai-offline">' + offlineNote() + '</div>' +
      '<div class="hq-ai-cols">' +
      '<section class="hq-card hq-ai-chat">' +
      '<div class="hq-ai-thread" id="ai-thread">' + threadHTML() + '</div>' +
      '<div class="hq-ai-composer">' +
      '<textarea id="ai-input" rows="2" placeholder="Misal: homepage par banner laga do &quot;New game live&quot; — ya: akhri hafte ke visitors batao" aria-label="AI command"></textarea>' +
      '<div class="hq-ai-compose-acts">' +
      '<button type="button" class="btn pri" id="ai-send">Send</button>' +
      '<button type="button" class="btn" id="ai-stop" ' + (A.running ? '' : 'hidden') + '>Stop</button>' +
      '<span class="hq-tiny">Ctrl + Enter se bhi bhej sakte hain · writes ke liye approval lazmi hai</span>' +
      '</div></div></section>' +
      '<aside class="hq-ai-side" id="ai-side">' + sideHTML() + '</aside>' +
      '</div>'
    );

    const input = $('#ai-input');
    const send = () => {
      const v = input ? input.value : '';
      if (!v.trim()) return;
      input.value = '';
      A.send(v);
    };

    A.sub(() => {
      const th = $('#ai-thread');
      if (th) {
        const atBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 120;
        th.innerHTML = threadHTML();
        if (atBottom) th.scrollTop = th.scrollHeight;
      }
      const side = $('#ai-side'); if (side) side.innerHTML = sideHTML();
      const st = $('#ai-status'); if (st) st.innerHTML = statusChips();
      const off = $('#ai-offline'); if (off) off.innerHTML = offlineNote();
      const stop = $('#ai-stop'); if (stop) stop.hidden = !A.running;
    });

    root.addEventListener('click', e => {
      const ex = e.target.closest('[data-ex]');
      if (ex) { if (input) { input.value = ex.dataset.ex; input.focus(); } return; }
      if (e.target.closest('#ai-send')) { send(); return; }
      if (e.target.closest('#ai-stop') || e.target.closest('[data-stop]')) { A.stop(); return; }
      const dec = e.target.closest('[data-decide]');
      if (dec) {
        const kind = dec.dataset.decide;
        if (kind === 'reject') { A.decide('reject'); return; }
        if (dec.dataset.needs === '1') {
          const w = ($('#ai-delword') || {}).value || '';
          if (String(w).toUpperCase() !== 'DELETE') { HQ.toast('Category C ke liye DELETE type karein.', true); return; }
          A.decide('approve', 'DELETE'); return;
        }
        A.decide('approve'); return;
      }
      if (e.target.closest('[data-ai-settings]')) { if (HQ.aiSetupModal) HQ.aiSetupModal(() => A.loadStatus()); return; }
      if (e.target.closest('[data-retry]')) {
        const lastUser = A.messages.slice().reverse().find(x => x.role === 'user');
        if (lastUser) A.send(lastUser.text);
        return;
      }
    });

    if (input) {
      input.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
      });
      input.focus();
    }

    A.view = '/ai';
    A.loadStatus();
    if (!A.history) A.refreshHistory();
  }

  /* --------------------------------------------------- view: /ai/activity */
  function logRow(a) {
    const bad = a.status === 'failed' ? 'r' : a.status === 'cancelled' ? 'm' : a.status === 'executed' ? 'g' : 'w';
    return '<tr data-log="' + esc(String(a.id)) + '">' +
      '<td data-l="Time">' + esc(HQ.dt(a.created_at)) + '</td>' +
      '<td data-l="Tool"><b>' + esc(a.tool) + '</b></td>' +
      '<td data-l="Category"><span class="hq-ai-cat c' + esc(a.category) + '">' + esc(a.category) + '</span></td>' +
      '<td data-l="Status"><span class="bd ' + bad + '">' + esc(a.status) + '</span></td>' +
      '<td data-l="Verified">' + (a.verified === true ? '<span class="hq-ai-chip ok">✓ DB</span>' : a.verified === false ? '<span class="hq-ai-chip warn">unverified</span>' : '—') + '</td>' +
      '<td data-l="Duration">' + (a.duration_ms ? a.duration_ms + ' ms' : '—') + '</td>' +
      '<td data-l="Detail"><button type="button" class="btn sm" data-expand="' + esc(String(a.id)) + '">' + HQ.icon('eye') + '</button></td>' +
      '</tr>' +
      '<tr class="hq-ai-logdetail" id="log-' + esc(String(a.id)) + '" hidden><td colspan="7">' +
      (a.error ? '<div class="hq-ai-errline">' + HQ.icon('alert') + esc(a.error) + '</div>' : '') +
      '<div class="hq-ai-diff"><div><h4>Arguments</h4><pre>' + esc(JSON.stringify(a.args || {}, null, 2)) + '</pre></div>' +
      '<div><h4>After (read back)</h4><pre>' + esc(JSON.stringify(a.after || a.before || {}, null, 2)) + '</pre></div></div>' +
      '</td></tr>';
  }

  function pendingHTML() {
    const list = (A.history && A.history.approvals) || [];
    if (!list.length) return '<div class="hq-ai-idle">' + HQ.icon('check') + '<b>Nothing waiting</b><span>Har change se pehle aap ki approval li jati hai — yahan queue dikhti hai.</span></div>';
    return list.map(p => '<div class="hq-ai-apprline">' +
      '<div class="grow"><b>' + esc(p.tool) + '</b> <span class="hq-ai-cat c' + esc(p.category) + '">' + esc(p.category) + '</span>' +
      '<span>' + esc((p.preview && p.preview.title) || '') + ' · ' + esc(HQ.dt(p.created_at)) + '</span></div>' +
      '<button type="button" class="btn sm" data-open-appr="' + esc(String(p.id)) + '">Review</button></div>').join('');
  }

  function usageHTML() {
    const s = A.status || {};
    const u = s.usage || {};
    const cap = u.monthly_request_cap || 1200;
    const pct = u.cap_used_pct || 0;
    return ui.card({
      title: 'AI usage & budget',
      sub: 'Free tiers only — no paid plan is ever switched on silently',
      body: '<div class="hq-ai-kpis">' +
        '<div><b>' + (u.requests || 0) + '</b><span>AI calls this month</span></div>' +
        '<div><b>' + ((u.input_tokens || 0) + (u.output_tokens || 0)) + '</b><span>tokens</span></div>' +
        '<div><b>' + (u.errors || 0) + '</b><span>errors</span></div>' +
        '<div><b>PKR 0</b><span>spent of 2,000</span></div>' +
        '</div>' +
        '<div class="hq-progress lg"><i style="width:' + pct + '%"></i></div>' +
        '<div class="hq-tiny">' + pct + '% of the ' + cap + '-call monthly guard. ' + esc((u.cost && u.cost.note) || '') + '</div>' +
        (s.ai && s.ai.configured ? '<div class="hq-tiny" style="margin-top:8px">Provider: <b>' + esc(s.ai.providerLabel) + '</b> · key source: <b>' + esc(s.ai.source) + '</b> · ' + esc(s.ai.note || '') + '</div>'
          : '<div class="hq-note w">' + HQ.icon('alert') + '<div class="grow">Koi AI key nahi. <button type="button" class="lnk" data-ai-settings>Connect a free Gemini key</button></div></div>')
    });
  }

  function memoryHTML() {
    const list = A.memory || [];
    return ui.card({
      title: 'Project memory',
      sub: 'AI yaad rakhta hai — aap kabhi bhi edit ya delete kar sakte hain',
      body: (list.length
        ? '<div class="hq-ai-mem">' + list.map(m => '<div class="row"><b>' + esc(m.key) + '</b><span>' + esc(typeof m.value === 'object' ? (m.value.text || JSON.stringify(m.value)) : String(m.value)) + '</span>' +
          '<button type="button" class="btn sm" data-mem-del="' + esc(m.key) + '">' + HQ.icon('trash') + '</button></div>').join('') + '</div>'
        : '<div class="hq-tiny">Abhi kuch nahi. AI important preferences yahan save kar sakta hai; passwords/keys kabhi nahi.</div>') +
        '<div class="hq-ai-memadd"><input type="text" id="mem-k" placeholder="key (e.g. brand_tone)"><input type="text" id="mem-v" placeholder="value"><button type="button" class="btn sm" data-mem-add>Add</button></div>'
    });
  }

  function activityBody() {
    const s = A.status || {};
    const actions = (A.history && A.history.actions) || [];
    return ui.page(
      ui.head({
        title: 'Live Activity',
        sub: 'Har AI action ka asli record — kuch bhi chhupaya nahi jata',
        actions: (s.kill_switch && s.kill_switch.enabled
          ? '<button type="button" class="btn" data-kill="0">' + HQ.icon('play') + ' Allow AI actions</button>'
          : '<button type="button" class="btn danger" data-kill="1">' + HQ.icon('lock') + ' Kill switch</button>') +
          '<button type="button" class="btn" data-refresh>' + HQ.icon('refresh') + ' Refresh</button>'
      }) +
      (s.kill_switch && s.kill_switch.enabled ? ui.note({
        tone: 'r', icon: 'lock', title: 'AI actions are OFF.',
        text: 'Kill switch on hai' + (s.kill_switch.envLocked ? ' (server env <code>HQ_AI_ACTIONS=off</code>)' : '') + '. Koi read ya write tool nahi chalega jab tak off na karein.'
      }) : '') +
      '<div class="hq-ai-cols">' +
      '<div class="hq-ai-main">' +
      ui.card({
        id: 'ai-run',
        title: 'Current / last run',
        sub: A.running ? 'Live — steps aa rahe hain' : 'Complete ho chuka',
        actions: (A.running ? '<button type="button" class="btn sm" data-stop>Stop</button>' : '<span class="hq-tiny">' + (A.steps.length ? A.steps.length + ' step(s)' : 'no run yet') + '</span>'),
        body: timeline(A.steps)
      }) +
      ui.card({ title: 'Pending approvals', sub: 'Write actions waiting for you', body: pendingHTML() }) +
      ui.card({
        title: 'Action log',
        sub: 'ai_action_logs — har write verified + timestamped',
        actions: '<button type="button" class="btn sm" data-refresh>' + HQ.icon('refresh') + '</button>',
        body: (actions.length
          ? '<div class="hq-tbl-wrap"><table class="hq-tbl"><thead><tr><th>Time</th><th>Tool</th><th>Category</th><th>Status</th><th>Verified</th><th>Duration</th><th></th></tr></thead><tbody>' +
          actions.map(logRow).join('') + '</tbody></table></div>'
          : '<div class="hq-ai-idle">' + HQ.icon('db') + '<b>No actions logged yet</b><span>Pehla command bhejein — yahan real log aayega. Agar schema missing ho to ye khali rahega (fake rows nahi).</span></div>')
      }) +
      '</div>' +
      '<aside class="hq-ai-side">' + usageHTML() + memoryHTML() +
      ui.card({
        title: 'How this works',
        body: '<div class="hq-ai-help">' +
          '<div><b>A · Automatic</b><span>Reads, previews, drafts. No approval, no live change.</span></div>' +
          '<div><b>B · Approve first</b><span>Live content, links, banner, maintenance.</span></div>' +
          '<div><b>C · Strong confirm</b><span>Deletes. You must type DELETE.</span></div>' +
          '<div><b>Stop</b><span>Aborts the run in your browser. Steps already finished stay as they are.</span></div>' +
          '</div>'
      }) + '</aside></div>'
    );
  }

  function viewActivity(root) {
    A.subs.clear();
    A.view = '/ai/activity';

    /* Poora page dobara paint hota hai jab bhi naya data/step aata hai — isi liye
       "live" activity waqai live hai. Delegated listener root par hai, is liye
       innerHTML badalne se buttons kaam karna nahi chhorte. Expanded log rows
       A.expanded me yaad rehti hain. */
    const paint = () => {
      root.innerHTML = activityBody();
      (A.expanded || []).forEach(id => {
        const tr = document.getElementById('log-' + id);
        if (tr) tr.hidden = false;
      });
    };
    A.expanded = A.expanded || [];
    paint();
    A.sub(() => { if (A.view === '/ai/activity') paint(); });

    root.addEventListener('click', e => {
      if (e.target.closest('[data-kill]')) { A.setKill(e.target.closest('[data-kill]').dataset.kill === '1'); return; }
      if (e.target.closest('[data-refresh]')) { A.loadStatus(); A.refreshHistory(); A.loadMemory(); HQ.toast('Refreshing…'); return; }
      if (e.target.closest('[data-stop]')) { A.stop(); return; }
      if (e.target.closest('[data-ai-settings]')) { if (HQ.aiSetupModal) HQ.aiSetupModal(() => A.loadStatus()); return; }

      const ex = e.target.closest('[data-expand]');
      if (ex) {
        const id = String(ex.dataset.expand);
        const tr = document.getElementById('log-' + id);
        if (!tr) return;
        tr.hidden = !tr.hidden;
        A.expanded = tr.hidden ? A.expanded.filter(x => x !== id) : A.expanded.concat([id]);
        return;
      }

      const del = e.target.closest('[data-mem-del]');
      if (del) { A.saveMemory(del.dataset.memDel, ''); return; }
      if (e.target.closest('[data-mem-add]')) {
        const k = ($('#mem-k') || {}).value || '', v = ($('#mem-v') || {}).value || '';
        if (!k.trim()) { HQ.toast('Key likhein.', true); return; }
        A.saveMemory(k.trim(), v);
        return;
      }

      const oa = e.target.closest('[data-open-appr]');
      if (oa) {
        const id = oa.dataset.openAppr;
        const found = ((A.history && A.history.approvals) || []).find(p => String(p.id) === String(id));
        if (!found) { HQ.toast('Ye approval ab maujood nahi (expire ya decide ho gayi).', true); A.refreshHistory(); return; }
        A.pending = {
          approval_id: found.id, tool: found.tool, category: found.category,
          preview: found.preview || {}, needs_delete_word: found.category === 'C',
          expires_at: found.expires_at,
          reply: (found.preview && found.preview.title) || ''
        };
        HQ.go('/ai');
        return;
      }
    });

    A.loadStatus(); A.refreshHistory(); A.loadMemory();

    /* Refresh policy: koi background timer nahi (browser/tab ki battery aur
       tests dono saaf rehte hain). Data tab refresh hota hai jab:
         • user Refresh dabata hai, • task khatam hota hai, • tab dobara focus
           me aata hai.  Steps khud SSE se live aate hain. */
    const onFocus = () => { if (A.view === '/ai/activity' && !document.hidden) A.refreshHistory(); };
    if (A.onFocus) { removeEventListener('focus', A.onFocus); document.removeEventListener('visibilitychange', A.onFocus); }
    A.onFocus = onFocus;
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
  }

  /* ---------------------------------------------------------------- mount */
  HQ.views['/ai'] = viewAssistant;
  HQ.views['/ai/activity'] = viewActivity;
})();
