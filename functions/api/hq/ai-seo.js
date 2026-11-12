/* ============================================================================
   /api/hq/ai-seo        (admin session)                              v3 (bulletproof)

   Ek brief → har channel ka apna SEO pack, uski language me.

   Ye file har known failure ko KHUD handle karti hai — tumhein kuch nahi karna:

     1. Key missing ................ saaf message, koi crash nahi
     2. Key me space / quotes ...... khud saaf kar deta hai
     3. Provider ka naam ghalat .... key ke prefix se khud pehchan leta hai
                                     (AIza…/AQ.… = gemini, gsk_… = groq, sk-… = openai)
     4. Model retire ho gaya (404) . available models ki list se agla chun leta hai
     5. AI_MODEL purana/ghalat ..... usay chhod kar apna behtar model le leta hai
     6. High demand (500/502/503/504) usi model par 2 retry (0.7s, 1.5s), phir agla model
     7. Rate limit (429) ........... wahi retry policy
     8. Network hang / timeout ..... 25s par abort, phir agla model
     9. Safety block ............... agla model try karta hai
    10. JSON adhoora / MAX_TOKENS .. limit barha kar dobara mangta hai
    11. Markdown fences/garbage .... saaf karke parse karta hai
    12. Sab models fail ............ saaf, honest error ke saath (fake success nahi)

   Env (sab optional except ek key):
     AI_PROVIDER = gemini | groq | openai      (khaali ho to key se detect)
     AI_API_KEY  = key                         (GEMINI_API_KEY / GROQ_API_KEY bhi chalte hain)
     AI_MODEL    = optional, agar available ho to pehle try hoga

   POST → { ok, at, brief, provider, model, results: { CODE: {ok, pack} | {ok:false, code, error} } }
   GET  → config status;  GET ?test=1 → asli chhoti AI call + full diagnostics
   ========================================================================== */
import { json, fail, requireAdmin, rate, svc } from './_shared.js';

const LIMITS = { title: 100, description: 4900, tags: 15, tagLen: 30 };
const BUDGET_MS = 40000;     /* total; Cloudflare ke request limit se andar */
const PER_CALL_MS = 12000;   /* ek AI call */
const CONCURRENCY = 3;       /* channels ek saath */

const SYSTEM = [
  'You are a senior YouTube SEO strategist for an indie mobile-game studio.',
  'You write metadata that a human editor could publish as-is.',
  'Never invent facts: no fake links, no made-up numbers, features, dates, prices or partnerships.',
  'If the brief lacks something (e.g. timestamps), leave it out instead of guessing.',
  'Write every field in the target language of the channel, in that language\'s native script.',
  'Reply with a single JSON object and nothing else.'
].join(' ');

function userPrompt(ch, brief) {
  const langLine = ch.language && ch.language !== 'en'
    ? 'The channel language is "' + ch.language + '" — write title, description, tags, hashtags and pinned comment fully in that language (native script). Keep the game name exactly as given.'
    : 'The channel language is English.';
  const parts = [
    'CHANNEL PROFILE',
    '- name: ' + (ch.name || ch.code),
    '- platform: ' + (ch.platform || 'youtube'),
    '- language: ' + (ch.language || 'en'),
    '- tone: ' + (ch.tone || 'friendly, energetic, gamer-to-gamer'),
    '- audience: ' + (ch.audience || brief.audience || 'casual mobile players'),
    '- channel keywords: ' + (ch.keywords || brief.keywords || '—'),
    '- title suffix: ' + (ch.title_suffix || '—'),
    '',
    'VIDEO BRIEF',
    '- topic: ' + (brief.topic || '—'),
    '- game: ' + (brief.game || '—'),
    '- category: ' + (brief.category || 'Gameplay'),
    '- primary keywords: ' + (brief.keywords || '—'),
    '- duration (seconds): ' + (brief.duration_seconds || '—'),
    brief.transcript ? '- transcript excerpt: ' + String(brief.transcript).slice(0, 1500) : '',
    '',
    langLine,
    '',
    'Return JSON exactly in this shape:',
    '{',
    '  "title": string (<= 100 chars, ' + (ch.title_suffix ? 'ends with "' + ch.title_suffix + '"' : 'no clickbait, one emoji max') + '),',
    '  "description": string (first 2 lines hook + keywords, then 3-6 short paragraphs, ' +
      'then a "Chapters" block ONLY if timestamps were given, then a short hashtags line),',
    '  "tags": string[] (<= 15 items, 1-3 words each, no # prefix),',
    '  "hashtags": string[] (<= 8 items, each starting with #),',
    '  "pinned_comment": string (1-2 sentences, invites a specific reply),',
    '  "thumbnail_text": string (max 4 words, upper case friendly),',
    '  "language": string (BCP-47 of the text you produced)',
    '}'
  ];
  return parts.filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ helpers */
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length <= n ? s : s.slice(0, n); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function stripFences(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return t;
}

/** Last-ditch clean-up for slightly broken model JSON. */
function looseJson(t) {
  return String(t || '')
    .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/}\s*{/g, '},{');
}

function tryParse(text) {
  const t = stripFences(text);
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  try { return JSON.parse(looseJson(t)); } catch (e) { /* fall through */ }
  return null;
}

/** fetch with a hard timeout — a hanging provider must never become a CF error page. */
function fetchT(url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || PER_CALL_MS);
  return fetch(url, Object.assign({}, init, { signal: ctrl.signal })).finally(() => clearTimeout(t));
}

/* ------------------------------------------------------- provider + models */
const DEFAULT_MODELS = {
  gemini: ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini']
};

function keyFrom(env) {
  const raw = env.AI_API_KEY || env.GEMINI_API_KEY || env.GROQ_API_KEY || env.OPENAI_API_KEY || env.AI_KEY || '';
  return String(raw).trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
}

/** Provider: env se, warna key ke prefix se (galat env value bhi theek ho jati hai). */
function resolveProvider(env, key) {
  let p = String(env.AI_PROVIDER || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (['google', 'gemini', 'googleai', 'googleaistudio', 'googlegemini'].includes(p)) p = 'gemini';
  else if (['groq', 'groqai', 'groqcloud'].includes(p)) p = 'groq';
  else if (['openai', 'chatgpt', 'gpt', 'openaiapi'].includes(p)) p = 'openai';
  else if (!p) {
    if (/^gsk_/.test(key)) p = 'groq';
    else if (/^sk-/.test(key)) p = 'openai';
    else p = 'gemini';                     /* AIza… / AQ.… */
  }
  if (!DEFAULT_MODELS[p]) p = 'gemini';
  return p;
}

/* Gemini model list ek dafa fetch karke yaad rakhte hain (per isolate). */
const modelCache = {};

const modelScore = n => {
  let s = 0;
  if (/embed|image|tts|veo|live|audio|nano|banana|omni|robot|computer|aqa|deep-research/i.test(n)) return -1000;
  if (n === 'gemini-2.5-flash') s += 100;
  if (/flash/.test(n)) s += 25; else s -= 8;
  if (/lite/.test(n)) s -= 12;
  if (/preview|exp|experimental/.test(n)) s -= 10;
  if (/pro/.test(n)) s -= 6;
  if (/latest/.test(n)) s += 6;
  return s;
};

async function listModels(provider, key) {
  try {
    if (provider === 'gemini') {
      const res = await fetchT('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': key } }, 15000);
      const j = await res.json();
      const names = (((j && j.models) || []).map(m => String(m.name || '').replace(/^models\//, ''))
        .filter(n => /flash|pro/i.test(n) && modelScore(n) > -500));
      return names.sort((a, b) => modelScore(b) - modelScore(a));
    }
    if (provider === 'groq') {
      const res = await fetchT('https://api.groq.com/openai/v1/models', { headers: { authorization: 'Bearer ' + key } }, 15000);
      const j = await res.json();
      return ((j && j.data) || []).map(m => m.id).filter(Boolean);
    }
    if (provider === 'openai') {
      const res = await fetchT('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer ' + key } }, 15000);
      const j = await res.json();
      return ((j && j.data) || []).map(m => m.id).filter(n => /gpt|o\d/.test(n));
    }
  } catch (e) { /* discovery is a bonus, never fatal */ }
  return [];
}

/** Which model worked last time? (one tiny row; failures are ignored) */
async function remembered(env, provider) {
  try {
    const rows = await svc(env, 'hq_ai_state?id=eq.ai&select=provider,model,updated_at');
    const row = rows && rows[0];
    if (!row || !row.model) return '';
    if (row.provider && row.provider !== provider) return '';
    if (row.updated_at && Date.now() - Date.parse(row.updated_at) > 14 * 86400_000) return '';
    return row.model;
  } catch (e) { return ''; }
}

async function remember(env, provider, model) {
  try {
    await svc(env, 'hq_ai_state', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ id: 'ai', provider, model, updated_at: new Date().toISOString() }])
    });
  } catch (e) { /* never let bookkeeping break a generation */ }
}

/** Ordered plan: remembered → env override (agar available ho) → discovered → defaults. */
async function modelPlan(env, provider, key, forceDiscover) {
  const cached = modelCache[provider + ':' + key.slice(-6)];
  let available = [];
  if (forceDiscover || !cached || Date.now() - cached.at > 30 * 60_000) {
    available = await listModels(provider, key);
    modelCache[provider + ':' + key.slice(-6)] = { at: Date.now(), list: available };
  } else {
    available = cached.list;
  }
  const want = String(env.AI_MODEL || '').trim();
  const out = [];
  const push = m => { if (m && !out.includes(m)) out.push(m); };
  push(await remembered(env, provider));      /* jo pichhli dafa chala, wohi pehle */
  /* env ka model sirf tab try karo jab wo waqai available ho (warna 1 call zaya). */
  if (want && (provider !== 'gemini' || !available.length || available.includes(want))) push(want);
  available.forEach(push);
  DEFAULT_MODELS[provider].forEach(push);
  return out.slice(0, 6);
}

/* ------------------------------------------------------------- one AI call */
const kindOf = (status, msg) => {
  const m = String(msg || '');
  if (status === 400 && /api[\s_-]?key|api key not valid|invalid api key|unauthenticated|credential/i.test(m)) return 'bad_key';
  if (status === 401 || status === 403) return 'bad_key';
  if (status === 404) return 'model_gone';
  if (status === 429) return 'rate';
  if (status >= 500) return 'transient';
  if (status === 408) return 'transient';
  if (status === 400 && /model|not found|not supported|no longer available|deprecated|does not exist/i.test(m)) return 'model_gone';
  if (status === 400) return 'bad_request';
  return 'transient';
};

async function aiCallOnce(provider, key, model, prompt, maxTokens) {
  let url, init, pick;
  if (provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    const gen = { maxOutputTokens: maxTokens, responseMimeType: 'application/json' };
    if (/^gemini-2\.5/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };   /* thinking = slow = timeouts */
    init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: gen
      })
    };
    pick = b => ((((b.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || '').join('');
  } else {
    const base = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    url = base;
    init = {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.6, max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }]
      })
    };
    pick = b => ((((b.choices || [])[0] || {}).message || {}).content) || '';
  }

  let res, text;
  try {
    res = await fetchT(url, init, PER_CALL_MS);
    text = await res.text();
  } catch (e) {
    const aborted = /abort/i.test(String(e && e.message));
    return { ok: false, kind: aborted ? 'timeout' : 'transient', code: aborted ? 'timeout' : 'unreachable', detail: clip((e && e.message) || e, 160), model };
  }
  if (!res.ok) {
    let detail = text;
    try { const b = JSON.parse(text); detail = ((b.error || {}).message) || text; } catch (e) { /* html or plain text */ }
    const kind = kindOf(res.status, detail);
    return { ok: false, kind, code: kind === 'bad_key' ? 'bad_key' : kind === 'model_gone' ? 'model_gone' : 'http_' + res.status, detail: clip((res.status + ' ' + detail), 240), model, status: res.status };
  }

  let body;
  try { body = JSON.parse(text); }
  catch (e) { return { ok: false, kind: 'bad_json', code: 'bad_json', detail: clip(text, 160), model }; }

  /* safety / empty answers */
  const block = (body.promptFeedback || {}).blockReason;
  const fin = (((body.candidates || [])[0] || {})).finishReason;
  const raw = pick(body).trim();
  if (block) return { ok: false, kind: 'blocked', code: 'blocked', detail: 'prompt blocked: ' + clip(block, 60), model };
  if (!raw && /SAFETY|RECITATION|PROHIBITED/.test(String(fin))) return { ok: false, kind: 'blocked', code: 'blocked', detail: 'answer filtered: ' + fin, model };
  if (!raw) return { ok: false, kind: 'empty', code: 'empty', detail: fin ? 'finish: ' + fin : 'empty answer', model, escalate: fin === 'MAX_TOKENS' };

  return { ok: true, text: raw, model };
}

/* ------------------------------------------------------------- one channel */
async function makePack(env, key, provider, models, prompt) {
  const trace = [];
  const started = Date.now();
  let maxTokens = 1600;
  let lastErr = null;
  let escalated = false;

  for (const model of models) {
    if (Date.now() - started > BUDGET_MS) { trace.push(model + ':skipped(budget)'); break; }

    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() - started > BUDGET_MS) { trace.push(model + ':skipped(budget)'); break; }
      const r = await aiCallOnce(provider, key, model, prompt, maxTokens);

      if (r.ok) {
        const pack = tryParse(r.text);
        if (pack && typeof pack === 'object') {
          if (env && env.SUPABASE_SERVICE_ROLE_KEY) remember(env, provider, r.model);
          return { ok: true, pack, model: r.model, provider, trace };
        }
        /* model answered but not valid JSON → one bigger retry on the same model */
        trace.push(model + ':bad_json');
        if (!escalated) { escalated = true; maxTokens = Math.min(4000, maxTokens * 2); continue; }
        lastErr = { code: 'ai_unparsable', error: 'Model ne theek JSON nahi diya: ' + clip(r.text, 160) };
        break;
      }

      lastErr = { code: r.code, error: r.detail || r.code };
      trace.push(model + ':' + r.code);

      if (r.kind === 'bad_key') return { ok: false, code: 'ai_bad_key', error: 'AI key galat ya expire ho gayi (' + r.detail + '). AI Studio se nayi key banake Cloudflare me AI_API_KEY update karo.', trace };
      if (r.kind === 'bad_request') return { ok: false, code: 'ai_bad_request', error: 'Request reject hui: ' + r.detail, trace };

      /* 429/5xx: same model par dobara. Timeout: ye model slow hai → agle par jao. */
      if (r.kind === 'rate' || r.kind === 'transient') { await sleep(600 * (attempt + 1)); continue; }
      if (r.kind === 'timeout') break;
      if (r.kind === 'empty' && r.escalate && !escalated) { escalated = true; maxTokens = Math.min(4000, maxTokens * 2); continue; }
      break;   /* model_gone / blocked / empty → next model */
    }
  }

  const codes = [...new Set(trace.map(t => String(t).split(':')[1]))].join(', ');
  return {
    ok: false,
    code: (lastErr && lastErr.code) || 'ai_failed',
    error: ((lastErr && lastErr.error) || 'AI ne jawab nahi diya') + ' · tried: ' + models.slice(0, 4).join(' > ') + (codes ? ' · [' + codes + ']' : ''),
    trace
  };
}

/* Backend enforces the platform limits even if the model ignores them. */
function normalise(pack) {
  const out = {};
  out.title = clip(pack.title || '', LIMITS.title).trim();
  out.description = clip(pack.description || '', LIMITS.description).trim();
  out.tags = (Array.isArray(pack.tags) ? pack.tags : String(pack.tags || '').split(','))
    .map(t => clip(String(t).replace(/^#/, '').trim(), LIMITS.tagLen)).filter(Boolean).slice(0, LIMITS.tags);
  out.hashtags = (Array.isArray(pack.hashtags) ? pack.hashtags : String(pack.hashtags || '').split(/\s+/))
    .map(t => { t = String(t).trim(); if (!t) return ''; return t.startsWith('#') ? t : '#' + t.replace(/[^\p{L}\p{N}_]/gu, ''); })
    .filter(Boolean).slice(0, 8);
  out.pinned_comment = clip(pack.pinned_comment || '', 400).trim();
  out.thumbnail_text = clip(pack.thumbnail_text || '', 40).trim();
  out.language = clip(pack.language || '', 12).trim();
  return out;
}

/* -------------------------------------------------------------------- entry */
export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);

  const key = keyFrom(env);
  const provider = resolveProvider(env, key);

  let isTest = false;
  try { isTest = new URL(request.url).searchParams.get('test') === '1'; } catch (e) { isTest = false; }

  if (!isTest) {
    return json({
      ok: true, configured: !!key, provider, keySet: !!key,
      model: String(env.AI_MODEL || '').trim() || DEFAULT_MODELS[provider][0],
      models: await modelPlan(env, provider, key, false),
      note: key ? 'AI ready. Key sirf server par rehti hai.' : 'Key nahi mili — Cloudflare → Settings → Variables me AI_API_KEY add karo (free Gemini ya Groq key).'
    });
  }

  /* ---- real, tiny call + full diagnostics (Studio ka "Test AI" button) ---- */
  const started = Date.now();
  const probe = 'Reply with JSON only, no prose: {"title":"Nova Racer gameplay","description":"one short line","tags":["nova racer"],"hashtags":["#gaming"],"pinned_comment":"which track?","thumbnail_text":"NOVA","language":"en"}';
  let r;
  try {
    const models = await modelPlan(env, provider, key, true);
    r = key ? await makePack(env, key, provider, models, probe) : { ok: false, code: 'no_ai_key', error: 'AI_API_KEY Cloudflare me set nahi hai.', trace: [] };
    return json({
      ok: !!(r && r.ok),
      provider,
      model: (r && r.model) || '',
      modelsTried: r && r.trace ? r.trace : [],
      availableModels: (modelCache[provider + ':' + key.slice(-6)] || {}).list || null,
      keySet: !!key,
      keyLength: key ? key.length : 0,
      keyLooksLike: key ? key.slice(0, 4) + '…' + key.slice(-2) : '',
      ms: Date.now() - started,
      code: (r && r.code) || null,
      error: (r && r.error) || null,
      sample: (r && r.ok) ? normalise(r.pack) : null
    });
  } catch (e) {
    return json({ ok: false, provider, code: 'crash', error: clip((e && e.message) || e, 300), ms: Date.now() - started }, 200);
  }
}

export async function onRequestPost({ request, env }) {
  try { return await handlePost({ request, env }); }
  catch (e) { return json({ ok: false, error: 'Server error: ' + clip((e && e.message) || e, 300), results: {} }, 500); }
}

async function handlePost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!rate('aiseo:' + (auth.user.id || 'x'), 20, 5 * 60_000)) return fail('Bohat zyada generations — 1 minute ruk kar try karo.', 429);

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('Body JSON honi chahiye.'); }

  const brief = {
    topic: clip(body.topic || '', 200),
    game: clip(body.game || '', 80),
    keywords: clip(body.keywords || '', 200),
    category: clip(body.category || '', 60),
    audience: clip(body.audience || '', 120),
    duration_seconds: Number(body.duration_seconds || 0) || '',
    transcript: clip(body.transcript || '', 4000)
  };
  if (!brief.topic && !brief.game) return fail('Kam se kam topic ya game ka naam do.');

  const channels = (Array.isArray(body.channels) ? body.channels : []).slice(0, 8)
    .map(c => ({
      code: clip(c.code || '', 40), name: clip(c.name || '', 80), platform: clip(c.platform || 'youtube', 20),
      language: clip(c.language || 'en', 12), tone: clip(c.tone || '', 120), audience: clip(c.audience || '', 120),
      keywords: clip(c.keywords || '', 200), title_suffix: clip(c.title_suffix || '', 40), country: clip(c.country || '', 40)
    }))
    .filter(c => c.code);
  if (!channels.length) return fail('Kam se kam ek channel chuno.');

  const key = keyFrom(env);
  const provider = resolveProvider(env, key);
  if (!key) {
    const results = {};
    channels.forEach(c => { results[c.code] = { ok: false, code: 'no_ai_key', error: 'Cloudflare me AI_API_KEY set nahi hai (free Gemini key).' }; });
    return json({ ok: false, at: new Date().toISOString(), provider, results }, 502);
  }

  const models = await modelPlan(env, provider, key, false);
  const results = {};
  const queue = channels.slice();
  let usedModel = '';

  const worker = async () => {
    while (queue.length) {
      const ch = queue.shift();
      try {
        const r = await makePack(env, key, provider, models, userPrompt(ch, brief));
        if (r.ok) {
          usedModel = r.model || usedModel;
          results[ch.code] = { ok: true, pack: normalise(r.pack), provider, model: r.model, trace: r.trace };
        } else {
          results[ch.code] = { ok: false, code: r.code, error: r.error, trace: r.trace };
        }
      } catch (e) {
        results[ch.code] = { ok: false, code: 'ai_error', error: clip((e && e.message) || e, 200) };
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const anyOk = Object.values(results).some(r => r.ok);
  return json({ ok: anyOk, at: new Date().toISOString(), brief, provider, model: usedModel, results }, anyOk ? 200 : 502);
}
