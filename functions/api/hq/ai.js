/* ============================================================================
   DevChazers HQ — AI Manager API                       /api/hq/ai
   ----------------------------------------------------------------------------
   POST /api/hq/ai   (SSE stream — asli steps jaise hi hote hain)
     { action:"chat",    message, conversation_id? }
     { action:"approve", approval_id, decision:"approve"|"reject", confirm? }
   POST /api/hq/ai   (plain JSON)
     { action:"cancel",  approval_id }
     { action:"kill",    enabled:true|false }
     { action:"memory",  key, value|null, note? }
   GET  /api/hq/ai?what=status|history|memory|test|tools

   Security boundary (har request):
     requireAdmin()  → Supabase session + public.is_admin()  (server side)
     AI  sirf tool naam + args propose karta hai; execute yahan hota hai
     Args whitelist se validate hote hain (unknown keys drop)
     Category B → approval row; Category C → approval + type DELETE
     Har write ai_action_logs me (arg/result/before/after/verified)
   ========================================================================== */
import { json, fail, svc, requireAdmin, rate, redactSecrets, conf } from './_shared.js';
import { TOOLS, toolCatalog, validateArgs, previewTool, runTool, verifyTool, callsPerCategory } from './_ai_tools.js';
import { plan, quickTest } from './_ai_agent.js';
import { aiKeyState } from './_ai.js';

const VERSION = 'ai-manager/1.0';
const enc = new TextEncoder();

/* ------------------------------------------------------------------ config */
function cfg(env) {
  return {
    envOff: String(env.HQ_AI_ACTIONS || '').toLowerCase() === 'off',
    monthlyRequestCap: Math.max(50, parseInt(env.HQ_AI_MONTHLY_REQUESTS || '1200', 10) || 1200),
    approvalMinutes: Math.max(5, parseInt(env.HQ_AI_APPROVAL_MINUTES || '30', 10) || 30),
    provider: String(env.AI_PROVIDER || '').toLowerCase() || 'auto'
  };
}

/* -------------------------------------------------- safe table helpers ---- */
/* In tables ke bina bhi HQ chalna chahiye; error message seedha batata hai
   ke kaunsi SQL file run karni hai. */
const SQL_HINT = 'AI Manager tables missing — run admin/hq/ai-manager-schema.sql in Supabase.';

async function safeSelect(env, path, fallback) {
  try { return await svc(env, path); } catch (e) { return arguments.length > 2 ? fallback : []; }
}
async function safeInsert(env, table, row) {
  try {
    const r = await svc(env, table, { method: 'POST', body: JSON.stringify(row) });
    return { ok: true, row: Array.isArray(r) ? r[0] : r };
  } catch (e) { return { ok: false, error: e.message }; }
}
async function safePatch(env, path, row) {
  try { await svc(env, path, { method: 'PATCH', body: JSON.stringify(row), headers: { prefer: 'return=minimal' } }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

/* ------------------------------------------------------------ kill switch */
async function killState(env) {
  const c = cfg(env);
  const rows = await safeSelect(env, 'ai_project_memory?select=key,value,note,editable,updated_at&key=eq.ai_kill_switch');
  const row = (rows || [])[0];
  const dbOn = !!(row && row.value && row.value.enabled);
  return { enabled: c.envOff || dbOn, envLocked: c.envOff, dbEnabled: dbOn, at: row && row.value ? row.value.at : null, by: row && row.value ? row.value.by : null };
}

async function setKill(env, enabled, who) {
  const body = { key: 'ai_kill_switch', value: { enabled: !!enabled, at: new Date().toISOString(), by: who || '' }, note: 'Master kill switch — AI actions blocked when enabled', editable: true, updated_at: new Date().toISOString() };
  try {
    await svc(env, 'ai_project_memory?on_conflict=key', { method: 'POST', body: JSON.stringify(body), headers: { prefer: 'resolution=merge-duplicates,return=minimal' } });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ---------------------------------------------------------------- memory */
const SECRET_RE = /(key|token|secret|password|passwd|credential|oauth|service_role|anon)/i;
async function loadMemory(env) {
  const rows = await safeSelect(env, 'ai_project_memory?select=key,value,note,editable&order=updated_at.desc&limit=30');
  return (rows || []).filter(r => r.key !== 'ai_kill_switch' && !SECRET_RE.test(r.key));
}

async function saveMemory(env, key, value, note) {
  const k = String(key || '').trim().slice(0, 60);
  if (!k) throw new Error('Memory key required.');
  if (SECRET_RE.test(k)) throw new Error('Passwords, keys, tokens ya OAuth credentials memory me store nahi ho sakte.');
  if (value === null || value === undefined || value === '') {
    await svc(env, 'ai_project_memory?key=eq.' + encodeURIComponent(k), { method: 'DELETE', headers: { prefer: 'return=minimal' } });
    return { deleted: true, key: k };
  }
  await svc(env, 'ai_project_memory?on_conflict=key', {
    method: 'POST',
    body: JSON.stringify({ key: k, value: { text: String(value).slice(0, 1000) }, note: String(note || '').slice(0, 200), editable: true, updated_at: new Date().toISOString() }),
    headers: { prefer: 'resolution=merge-duplicates,return=representation' }
  });
  return { saved: true, key: k };
}

/* --------------------------------------------------------------- usage --- */
async function recordUsage(env, p, ok) {
  const row = {
    day: new Date().toISOString().slice(0, 10),
    provider: (p && p.provider) || 'none',
    model: (p && p.model) || '',
    requests: 1,
    input_tokens: (p && p.usage && p.usage.in) || 0,
    output_tokens: (p && p.usage && p.usage.out) || 0,
    errors: ok ? 0 : 1
  };
  await safeInsert(env, 'ai_usage_stats', row);
}

async function usageSummary(env) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const start = monthStart.toISOString().slice(0, 10);
  const rows = await safeSelect(env, 'ai_usage_stats?select=day,provider,model,requests,input_tokens,output_tokens,errors&day=gte.' + start + '&limit=5000');
  const t = { requests: 0, input_tokens: 0, output_tokens: 0, errors: 0 };
  const byProvider = {};
  (rows || []).forEach(r => {
    t.requests += r.requests || 0; t.input_tokens += r.input_tokens || 0; t.output_tokens += r.output_tokens || 0; t.errors += r.errors || 0;
    const k = r.provider || 'unknown';
    byProvider[k] = byProvider[k] || { requests: 0, input_tokens: 0, output_tokens: 0 };
    byProvider[k].requests += r.requests || 0; byProvider[k].input_tokens += r.input_tokens || 0; byProvider[k].output_tokens += r.output_tokens || 0;
  });
  const c = cfg(env);
  return {
    month: start.slice(0, 7),
    ...t,
    by_provider: byProvider,
    monthly_request_cap: c.monthlyRequestCap,
    cap_used_pct: Math.min(100, Math.round((t.requests / c.monthlyRequestCap) * 100)),
    cost: { currency: 'PKR', spent: 0, budget: 2000, note: 'Free tiers only (Gemini / Groq). PKR 0 spent; paid providers are never enabled silently.' }
  };
}

/* ------------------------------------------------------------------- SSE */
function sse(run) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  let closed = false;
  const send = obj => {
    if (closed) return;
    try { writer.write(enc.encode('data: ' + JSON.stringify(obj) + '\n\n')); }
    catch (e) { closed = true; }
  };
  (async () => {
    try { await run(send); }
    catch (e) { send({ type: 'error', message: redactSecrets({}, e.message || 'Unknown error') }); }
    finally { send({ type: 'end', at: Date.now() }); closed = true; try { await writer.close(); } catch (e) { } }
  })();
  return new Response(readable, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'connection': 'keep-alive'
    }
  });
}

/* -------------------------------------------------------- pipeline steps */
function stepLog(send) {
  const t0 = Date.now();
  const marks = {};
  return {
    start(label, kind, detail) {
      marks[label] = Date.now();
      send({ type: 'step', label, kind: kind || 'api', state: 'running', detail: detail || '', at: new Date().toISOString() });
    },
    done(label, detail, extra) {
      const ms = Date.now() - (marks[label] || Date.now());
      send(Object.assign({ type: 'step', label, kind: (extra && extra.kind) || 'api', state: 'done', detail: detail || '', ms }, extra || {}));
      return ms;
    },
    fail(label, detail, extra) {
      const ms = Date.now() - (marks[label] || Date.now());
      send(Object.assign({ type: 'step', label, kind: (extra && extra.kind) || 'api', state: 'error', detail: detail || '', ms }, extra || {}));
      return ms;
    },
    total() { return Date.now() - t0; }
  };
}

async function ensureConversation(env, user, id, firstMessage) {
  if (id) {
    const rows = await safeSelect(env, 'ai_conversations?select=id,title&id=eq.' + encodeURIComponent(id));
    if (rows && rows[0]) return rows[0];
  }
  const title = String(firstMessage || 'New task').slice(0, 80);
  const r = await safeInsert(env, 'ai_conversations', { user_id: user.id, title, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return r.ok ? r.row : { id: null, title };
}

async function logMessage(env, conversation_id, role, content, extra) {
  if (!conversation_id) return;
  await safeInsert(env, 'ai_messages', Object.assign({ conversation_id, role, content: String(content || '').slice(0, 8000), created_at: new Date().toISOString() }, extra || {}));
  await safePatch(env, 'ai_conversations?id=eq.' + encodeURIComponent(conversation_id), { updated_at: new Date().toISOString() });
}

async function logAction(env, row) {
  const r = await safeInsert(env, 'ai_action_logs', Object.assign({ created_at: new Date().toISOString() }, row));
  return r.ok ? r.row : null;
}

/* ------------------------------------------------------------ chat stream */
async function runChat({ env, user, body, send }) {
  const S = stepLog(send);
  const c = cfg(env);
  const message = String(body.message || '').trim();

  S.start('Kill switch check', 'guard');
  const kill = await killState(env);
  if (kill.enabled) {
    S.fail('Kill switch check', kill.envLocked ? 'Locked by server env HQ_AI_ACTIONS=off' : 'AI actions are switched OFF in HQ');
    send({ type: 'error', code: 'kill_switch', message: 'AI Manager abhi OFF hai. Live Activity → Kill switch on karein.' });
    return;
  }
  S.done('Kill switch check', 'AI actions allowed');

  /* ---- monthly guard: free tier bhi infinite nahi hai. Cap par ruk jate hain
     taake bill ya quota ka surprise na ho (spec: max PKR 2,000 / month). */
  S.start('Budget check', 'guard');
  const usage = await usageSummary(env);
  if (usage.requests >= usage.monthly_request_cap) {
    S.fail('Budget check', 'Monthly cap reached (' + usage.requests + '/' + usage.monthly_request_cap + ')');
    send({ type: 'error', code: 'budget_cap', message: 'Is mahine ki AI calls limit (' + usage.monthly_request_cap + ') poori ho gayi. Live Activity → Budget dekh lein. Koi paid plan khud-ba-khud on nahi hoga.' });
    return;
  }
  S.done('Budget check', usage.requests + '/' + usage.monthly_request_cap + ' calls used this month', { kind: 'guard' });

  if (!message) { send({ type: 'error', code: 'empty', message: 'Message khali hai.' }); return; }
  if (!rate('ai:' + user.id, 20, 60_000)) {
    send({ type: 'error', code: 'rate', message: 'Bohat zyada requests — 1 minute ruk kar koshish karein.' });
    return;
  }

  const conv = await ensureConversation(env, user, body.conversation_id, message);
  send({ type: 'conversation', conversation_id: conv.id, title: conv.title });
  await logMessage(env, conv.id, 'user', message);
  S.done('Conversation', conv.id ? 'Saved to ai_conversations' : 'Not saved (schema missing)', { kind: 'db' });

  /* ---- 1. real project facts (read tool, real API call) */
  S.start('Reading website state', 'db');
  let facts = {};
  try {
    const st = await TOOLS.get_website_status.run(env, {});
    facts = st.data;
    S.done('Reading website state', st.summary, { kind: 'db' });
  } catch (e) {
    S.fail('Reading website state', redactSecrets(env, e.message), { kind: 'db' });
    facts = { error: 'could not read' };
  }

  const memory = await loadMemory(env).catch(() => []);
  const lastActions = await safeSelect(env, 'ai_action_logs?select=tool,status,created_at&order=created_at.desc&limit=5').catch(() => []);

  /* ---- 2. AI plan */
  S.start('AI planning', 'ai');
  const p = await plan(env, { message, memory, facts, lastActions });
  await recordUsage(env, p, p.ok);
  if (!p.ok) {
    S.fail('AI planning', p.error, { kind: 'ai' });
    await logMessage(env, conv.id, 'assistant', p.error, { steps: p.attempts || [] });
    send({ type: 'ai_error', code: p.code, message: p.error, attempts: p.attempts || [], provider: p.provider });
    return;
  }
  S.done('AI planning', `${p.providerLabel} · ${p.model} · ${(p.usage && p.usage.in) || 0}/${(p.usage && p.usage.out) || 0} tokens`, {
    kind: 'ai', provider: p.provider, model: p.model, usage: p.usage, attempts: p.attempts
  });
  send({ type: 'reply', text: p.reply, provider: p.provider, model: p.model });

  /* ---- 3. no tool → pure answer */
  if (!p.tool) {
    await logMessage(env, conv.id, 'assistant', p.reply);
    send({ type: 'final', kind: 'answer', reply: p.reply, conversation_id: conv.id });
    return;
  }

  /* ---- 4. validate tool + args (injection barrier) */
  S.start('Tool validation', 'guard');
  const v = validateArgs(p.tool, p.args);
  if (!v.ok) {
    S.fail('Tool validation', v.error);
    await logMessage(env, conv.id, 'assistant', p.reply + ' — ' + v.error);
    send({ type: 'error', code: 'bad_tool', message: v.error });
    return;
  }
  const tool = v.tool;
  const args = v.args;
  S.done('Tool validation', `${p.tool} · category ${tool.category} · args checked`, { kind: 'guard', tool: p.tool, category: tool.category });

  /* ---- 5. category A → execute now */
  if (tool.category === 'A') {
    S.start('Executing ' + p.tool, 'db', 'API action');
    const t1 = Date.now();
    let result;
    try { result = await runTool(env, p.tool, args); }
    catch (e) {
      const msg = redactSecrets(env, e.message);
      S.fail('Executing ' + p.tool, msg, { kind: 'db' });
      await logAction(env, { conversation_id: conv.id, user_id: user.id, tool: p.tool, category: tool.category, args, status: 'failed', error: msg, duration_ms: Date.now() - t1 });
      send({ type: 'error', code: 'tool_failed', message: msg });
      return;
    }
    S.done('Executing ' + p.tool, result.summary, { kind: 'db', ms: Date.now() - t1, data: result.data });

    const logRow = await logAction(env, {
      conversation_id: conv.id, user_id: user.id, tool: p.tool, category: tool.category,
      args, before: null, after: result.data || null, status: 'executed', verified: true,
      duration_ms: Date.now() - t1, steps: { kind: 'read' }
    });
    await logMessage(env, conv.id, 'assistant', p.reply, { tool: p.tool, steps: [{ tool: p.tool, status: 'executed' }] });
    send({ type: 'final', kind: 'executed', tool: p.tool, category: tool.category, reply: p.reply, result: { summary: result.summary, data: result.data }, log_id: logRow && logRow.id, conversation_id: conv.id });
    return;
  }

  /* ---- 6. category B/C → approval */
  S.start('Preparing approval', 'guard', 'change preview');
  let preview = null;
  try { preview = await previewTool(env, p.tool, args); }
  catch (e) {
    const msg = redactSecrets(env, e.message);
    S.fail('Preparing approval', msg);
    send({ type: 'error', code: 'preview_failed', message: msg });
    return;
  }
  const expires = new Date(Date.now() + c.approvalMinutes * 60000).toISOString();
  const appr = await safeInsert(env, 'ai_approvals', {
    conversation_id: conv.id, user_id: user.id, tool: p.tool, category: tool.category,
    args, preview, status: 'pending', expires_at: expires, created_at: new Date().toISOString()
  });
  if (!appr.ok) {
    S.fail('Preparing approval', SQL_HINT);
    send({ type: 'error', code: 'schema', message: SQL_HINT + ' (' + appr.error + ')' });
    return;
  }
  S.done('Preparing approval', (tool.category === 'C' ? 'Strong confirmation required (type DELETE)' : 'Waiting for admin approval'), { kind: 'guard' });
  await logMessage(env, conv.id, 'assistant', p.reply + ' [pending approval]', { tool: p.tool, steps: [{ tool: p.tool, status: 'pending' }] });
  send({
    type: 'approval', approval_id: appr.row && appr.row.id, tool: p.tool, category: tool.category,
    title: tool.title, args, preview, expires_at: expires,
    needs_delete_word: tool.category === 'C', reply: p.reply, conversation_id: conv.id
  });
}

/* ------------------------------------------------------ approve / execute */
async function runApprove({ env, user, body, send }) {
  const S = stepLog(send);
  const kill = await killState(env);
  S.start('Kill switch check', 'guard');
  if (kill.enabled) { S.fail('Kill switch check', 'AI actions OFF'); send({ type: 'error', code: 'kill_switch', message: 'AI Manager OFF hai.' }); return; }
  S.done('Kill switch check', 'allowed');

  const id = String(body.approval_id || '');
  S.start('Loading approval', 'db');
  const rows = await safeSelect(env, 'ai_approvals?select=*&id=eq.' + encodeURIComponent(id));
  const ap = rows && rows[0];
  if (!ap) { S.fail('Loading approval', 'Approval not found'); send({ type: 'error', code: 'missing', message: 'Approval record nahi mila (ya schema missing).' }); return; }
  if (ap.status !== 'pending') { S.fail('Loading approval', 'Already ' + ap.status); send({ type: 'error', code: 'used', message: 'Ye approval pehle hi ' + ap.status + ' ho chuki hai.' }); return; }
  if (ap.user_id && user.id && ap.user_id !== user.id) { S.fail('Loading approval', 'Different admin'); send({ type: 'error', code: 'forbidden', message: 'Ye task kisi doosre admin ka hai.' }); return; }
  if (ap.expires_at && new Date(ap.expires_at).getTime() < Date.now()) {
    S.fail('Loading approval', 'Expired');
    await safePatch(env, 'ai_approvals?id=eq.' + encodeURIComponent(id), { status: 'expired', decided_at: new Date().toISOString() });
    send({ type: 'error', code: 'expired', message: 'Approval expire ho gayi — dobara bhejein.' });
    return;
  }
  S.done('Loading approval', ap.tool + ' · category ' + ap.category + ' · pending', { kind: 'db' });

  if (String(body.decision || 'approve') !== 'approve') {
    await safePatch(env, 'ai_approvals?id=eq.' + encodeURIComponent(id), { status: 'cancelled', decided_at: new Date().toISOString() });
    await logAction(env, { conversation_id: ap.conversation_id, user_id: user.id, tool: ap.tool, category: ap.category, args: ap.args, status: 'cancelled' });
    S.done('Approval', 'Cancelled by admin', { kind: 'guard' });
    send({ type: 'final', kind: 'cancelled', tool: ap.tool, message: 'Cancelled — kuch bhi change nahi hua.' });
    return;
  }

  /* re-validate: approval ke baad args tamper nahi ho sakte */
  const v = validateArgs(ap.tool, ap.args);
  if (!v.ok) { S.fail('Re-validation', v.error); send({ type: 'error', code: 'bad_args', message: v.error }); return; }
  S.done('Re-validation', 'Arguments still valid', { kind: 'guard' });

  if (ap.category === 'C' && String(body.confirm || '').toUpperCase() !== 'DELETE') {
    S.fail('Strong confirmation', 'Type DELETE required');
    send({ type: 'error', code: 'need_delete', message: 'Category C: confirm me DELETE type karna zaroori hai.' });
    return;
  }

  S.start('Executing ' + ap.tool, 'db', 'API action');
  const t1 = Date.now();
  let result;
  try { result = await runTool(env, ap.tool, v.args); }
  catch (e) {
    const msg = redactSecrets(env, e.message);
    S.fail('Executing ' + ap.tool, msg, { kind: 'db' });
    await safePatch(env, 'ai_approvals?id=eq.' + encodeURIComponent(id), { status: 'approved', decided_at: new Date().toISOString() });
    await logAction(env, { conversation_id: ap.conversation_id, user_id: user.id, tool: ap.tool, category: ap.category, args: v.args, status: 'failed', error: msg, duration_ms: Date.now() - t1 });
    send({ type: 'error', code: 'tool_failed', message: msg });
    return;
  }
  S.done('Executing ' + ap.tool, result.summary, { kind: 'db', ms: Date.now() - t1 });

  S.start('Verifying from database', 'db');
  const ver = await verifyTool(env, ap.tool, v.args, result);
  if (ver.verified === false) S.fail('Verifying from database', ver.error || 'Change DB me confirm nahi hua');
  else S.done('Verifying from database', ver.verified ? 'Confirmed in the database' : 'Read back: ' + JSON.stringify(ver.after || {}).slice(0, 160), { kind: 'db', verified: ver.verified });

  const logRow = await logAction(env, {
    conversation_id: ap.conversation_id, user_id: user.id, tool: ap.tool, category: ap.category,
    args: v.args, before: ap.preview ? ap.preview.before : null, after: (ver && ver.after) || result.data || null,
    status: 'executed', verified: ver.verified !== false, duration_ms: Date.now() - t1, steps: { approval_id: id }
  });
  await safePatch(env, 'ai_approvals?id=eq.' + encodeURIComponent(id), { status: 'approved', decided_at: new Date().toISOString() });
  await logMessage(env, ap.conversation_id, 'assistant', result.summary, { tool: ap.tool, steps: [{ tool: ap.tool, status: 'executed' }] });

  send({
    type: 'final', kind: 'executed', tool: ap.tool, category: ap.category,
    result: { summary: result.summary, data: result.data },
    before: ap.preview ? ap.preview.before : null, after: (ver && ver.after) || result.data || null,
    verified: ver.verified, log_id: logRow && logRow.id, conversation_id: ap.conversation_id
  });
}

/* ------------------------------------------------------------------- GET -- */
export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  const url = new URL(request.url);
  const what = (url.searchParams.get('what') || 'status').toLowerCase();

  if (what === 'tools') return json({ ok: true, version: VERSION, tools: toolCatalog(), counts: callsPerCategory() });

  if (what === 'status') {
    const [state, kill, usage, pending, logs, counts] = await Promise.all([
      aiKeyState(env).catch(() => ({ key: '', provider: 'none', source: 'none', hint: '', model: '' })),
      killState(env),
      usageSummary(env),
      safeSelect(env, 'ai_approvals?select=id&status=eq.pending'),
      safeSelect(env, 'ai_action_logs?select=id,status&order=created_at.desc&limit=100'),
      Promise.resolve(callsPerCategory())
    ]);
    const c = conf(env);
    return json({
      ok: true, version: VERSION,
      ai: {
        configured: !!state.key,
        provider: state.provider,
        providerLabel: state.provider === 'gemini' ? 'Google Gemini' : state.provider === 'groq' ? 'Groq' : state.provider === 'openai' ? 'OpenAI' : 'not configured',
        source: state.source, hint: state.hint, model: state.model || '',
        note: state.key ? 'Key server-side hai (browser ko kabhi nahi bheji jati).' : 'AI key set nahi hai — Settings → Connect AI (free Gemini key).'
      },
      kill_switch: kill,
      tools: counts,
      usage,
      table_ready: Array.isArray(logs),
      pending_approvals: (pending || []).length,
      recent: { executed: (logs || []).filter(l => l.status === 'executed').length, failed: (logs || []).filter(l => l.status === 'failed').length },
      server: { supabase: !!c.url, service_role: !!c.svc, token_key: !!env.HQ_TOKEN_KEY, caps: cfg(env) }
    });
  }

  if (what === 'history') {
    const n = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 1), 100);
    const [logs, approvals] = await Promise.all([
      safeSelect(env, 'ai_action_logs?select=*&order=created_at.desc&limit=' + n),
      safeSelect(env, 'ai_approvals?select=id,tool,category,args,preview,status,expires_at,created_at&status=eq.pending&order=created_at.desc&limit=10')
    ]);
    return json({ ok: true, actions: logs || [], approvals: approvals || [] });
  }

  if (what === 'memory') {
    return json({ ok: true, memory: await loadMemory(env) });
  }

  if (what === 'test') {
    const r = await quickTest(env);
    await recordUsage(env, r, r.ok);
    if (!r.ok) return json({ ok: false, code: r.code, error: r.error, attempts: r.attempts || [] }, 200);
    return json({ ok: true, provider: r.provider, providerLabel: r.providerLabel, model: r.model, reply: r.reply, tool: r.tool, usage: r.usage });
  }

  return fail('Unknown ?what=' + what, 404);
}

/* ------------------------------------------------------------------ POST -- */
export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('Body must be JSON.', 400); }
  const action = String(body.action || '').toLowerCase();

  /* --- non-streaming --- */
  if (action === 'cancel') {
    const id = String(body.approval_id || '');
    await safePatch(env, 'ai_approvals?id=eq.' + encodeURIComponent(id), { status: 'cancelled', decided_at: new Date().toISOString() });
    return json({ ok: true, cancelled: id });
  }

  if (action === 'kill') {
    const r = await setKill(env, !!body.enabled, auth.user && auth.user.email);
    if (!r.ok) return fail(r.error + ' — ' + SQL_HINT, 500);
    return json({ ok: true, kill_switch: await killState(env) });
  }

  if (action === 'memory') {
    try {
      const r = await saveMemory(env, body.key, body.value, body.note);
      return json({ ok: true, ...r, memory: await loadMemory(env) });
    } catch (e) { return fail(e.message, 400); }
  }

  if (action === 'chat') {
    if (!rate('ai:' + (auth.user && auth.user.id), 20, 60_000)) return fail('Bohat zyada requests — 1 minute baad koshish karein.', 429);
    return sse(send => runChat({ env, user: auth.user, body, send }));
  }

  if (action === 'approve') {
    return sse(send => runApprove({ env, user: auth.user, body, send }));
  }

  return fail('Unknown action "' + action + '". Use chat | approve | cancel | kill | memory.', 400);
}
