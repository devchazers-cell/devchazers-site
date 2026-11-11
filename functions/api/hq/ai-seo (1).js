/* ============================================================================
   /api/hq/ai-seo        (admin session)

   Ek brief  →  har channel ka apna, uski language me, uske tone me SEO pack.

   POST body:
     {
       topic, game, keywords, category, audience, duration_seconds, transcript,
       channels: [{ code, name, language, tone, audience, keywords,
                    title_suffix, platform, country }]
     }

   Response:
     { ok, provider, model, results: { CODE: { ok, pack | error } } }

   Providers (sab ke free tier hain; sirf key Cloudflare secret me rehti hai):
     AI_PROVIDER = gemini | groq | openai        (default: gemini)
     AI_API_KEY  = key                            (ya GEMINI_API_KEY / GROQ_API_KEY)
     AI_MODEL    = optional override

   Rules jo model ko diye jate hain (aur backend bhi enforce karta hai):
     • Jo brief me nahi hai wo invent mat karo — koi jhoota link, jhoota number,
       jhooti feature nahi.
     • Title/description us channel ki language me, native script me.
     • YouTube: title ≤ 100 chars, description ≤ 4900, tags ≤ 15.
   ========================================================================== */
import { json, fail, requireAdmin, rate } from './_shared.js';

const LIMITS = { title: 100, description: 4900, tags: 15, tagLen: 30 };

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

function stripFences(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return t;
}

/** fetch with a hard timeout — a hanging provider must not turn into a CF error page. */
function fetchT(url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 25000);
  return fetch(url, Object.assign({}, init, { signal: ctrl.signal })).finally(() => clearTimeout(t));
}

/* Google retires model IDs (gemini-2.0-flash is gone, 3.8-flash is current).
   Try the newest first and fall back when the API says the model is gone. */
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash-lite'];
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const OPENAI_MODELS = ['gpt-4o-mini'];

function modelList(env, provider) {
  const want = String(env.AI_MODEL || '').trim();
  const base = provider === 'gemini' ? GEMINI_MODELS : provider === 'groq' ? GROQ_MODELS : provider === 'openai' ? OPENAI_MODELS : [];
  return want ? [want].concat(base.filter(m => m !== want)) : base.slice();
}

/** Compact JSON only — no long "thinking", which is what blew past the timeout. */
function geminiGen(model) {
  const g = { maxOutputTokens: 1500, responseMimeType: 'application/json' };
  if (/^gemini-2\.5/.test(model)) g.thinkingConfig = { thinkingBudget: 0 };
  return g;
}

const modelGone = r => r && (r.code === 'ai_http_404' || /no longer available|not found|is not supported|deprecated|does not exist/i.test(String(r.error || '')));

async function aiCallOnce(env, provider, key, model, user) {
  let url, init;
  if (provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      /* 3.8-flash dropped temperature / topP / topK — sending them can 400. */
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: geminiGen(model)
      })
    };
  } else if (provider === 'groq' || provider === 'openai') {
    url = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    init = {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.75,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]
      })
    };
  } else {
    return { ok: false, code: 'bad_provider', error: 'Unknown AI_PROVIDER "' + provider + '". Use gemini, groq or openai.' };
  }

  let res, text;
  try {
    res = await fetchT(url, init, 30000);
    text = await res.text();
  } catch (e) {
    return { ok: false, code: 'ai_unreachable', error: 'Could not reach the AI provider: ' + clip(e.message, 160), model };
  }
  if (!res.ok) {
    const hint = res.status === 400 || res.status === 401 || res.status === 403
      ? ' (check the key, billing and model name)'
      : res.status === 429 ? ' (free-tier rate limit — thodi der baad try karo)' : '';
    return { ok: false, code: 'ai_http_' + res.status, error: 'AI provider returned HTTP ' + res.status + hint + ': ' + clip(text, 240), model };
  }

  let raw = '';
  try {
    const body = JSON.parse(text);
    raw = provider === 'gemini'
      ? (((body.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('') || ''
      : (((body.choices || [])[0] || {}).message || {}).content || '';
  } catch (e) {
    return { ok: false, code: 'ai_bad_json', error: 'AI response was not JSON: ' + clip(text, 200), model };
  }
  if (!raw) return { ok: false, code: 'ai_empty', error: 'The model returned no text (safety block or quota).', model };

  let pack;
  try { pack = JSON.parse(stripFences(raw)); }
  catch (e) { return { ok: false, code: 'ai_unparsable', error: 'The model did not return usable JSON: ' + clip(raw, 200), model }; }

  return { ok: true, provider, model, pack };
}

async function callAI(env, user) {
  const provider = String(env.AI_PROVIDER || 'gemini').toLowerCase();
  const key = env.AI_API_KEY || env.GEMINI_API_KEY || env.GROQ_API_KEY || env.OPENAI_API_KEY || '';
  if (!key) {
    return { ok: false, code: 'no_ai_key', error: 'No AI key configured. Cloudflare → Settings → Environment variables → add AI_API_KEY (Gemini or Groq free tier) and AI_PROVIDER.' };
  }
  const models = modelList(env, provider);
  if (!models.length) return { ok: false, code: 'bad_provider', error: 'Unknown AI_PROVIDER "' + provider + '". Use gemini, groq or openai.' };

  let last = null;
  const started = Date.now();
  for (const model of models) {
    if (Date.now() - started > 75000) break;         /* stay inside Cloudflare's request budget */
    const r = await aiCallOnce(env, provider, key, model, user);
    if (r.ok) return r;
    last = r;
    /* A model that hangs or 404s is worth replacing; a bad key is not. */
    const retryable = modelGone(r) || r.code === 'ai_unreachable';
    if (!retryable) return r;
  }
  if (last) last.error = String(last.error || '') + ' (tried: ' + models.join(', ') + ')';
  return last || { ok: false, code: 'ai_failed', error: 'All models failed.' };
}

/** List the models this key can call — used by the Studio's Test AI button only. */
async function listModels(env, provider, key) {
  try {
    if (provider === 'gemini') {
      const res = await fetchT('https://generativelanguage.googleapis.com/v1beta/models?pageSize=50', { headers: { 'x-goog-api-key': key } }, 15000);
      const j = await res.json();
      return ((j && j.models) || []).map(m => String(m.name || '').replace(/^models\//, ''))
        .filter(n => /flash|pro/i.test(n) && !/embed|image|tts|veo|live|audio/i.test(n)).slice(0, 15);
    }
    if (provider === 'groq') {
      const res = await fetchT('https://api.groq.com/openai/v1/models', { headers: { authorization: 'Bearer ' + key } }, 15000);
      const j = await res.json();
      return ((j && j.data) || []).map(m => m.id).filter(Boolean).slice(0, 15);
    }
  } catch (e) { return null; }
  return null;
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
  const provider = String(env.AI_PROVIDER || 'gemini').toLowerCase();
  const key = env.AI_API_KEY || env.GEMINI_API_KEY || env.GROQ_API_KEY || env.OPENAI_API_KEY || '';

  /* ?test=1 — do a real, tiny AI call and report everything the UI needs to debug. */
  let isTest = false;
  try { isTest = new URL(request.url).searchParams.get('test') === '1'; } catch (e) { isTest = false; }
  if (isTest) {
    const started = Date.now();
    const probe = 'Reply with JSON only, no prose: {"title":"Nova Racer gameplay","description":"one short line","tags":["nova racer"],"hashtags":["#gaming"],"pinned_comment":"which track?","thumbnail_text":"NOVA","language":"en"}';
    let r;
    try { r = await callAI(env, probe); }
    catch (e) { r = { ok: false, code: 'threw', error: String((e && e.message) || e) }; }
    return json({
      ok: !!(r && r.ok),
      provider,
      model: (r && r.model) || env.AI_MODEL || modelList(env, provider)[0] || '',
      modelsTried: modelList(env, provider),
      availableModels: (r && r.ok) ? null : await listModels(env, provider, key),
      keySet: !!key,
      keyLength: key ? key.length : 0,
      keyLooksLike: key ? (key.slice(0, 4) + '…' + key.slice(-2)) : '',
      ms: Date.now() - started,
      code: (r && r.code) || null,
      error: (r && r.error) || null,
      sample: r && r.ok ? r.pack : null
    });
  }

  return json({
    ok: true,
    configured: !!key,
    provider,
    model: env.AI_MODEL || modelList(env, provider)[0] || '',
    models: modelList(env, provider),
    note: key ? 'AI endpoint ready. Keys never leave the server.' : 'No key yet — set AI_API_KEY (Gemini or Groq free tier) in Cloudflare secrets.'
  });
}

export async function onRequestPost({ request, env }) {
  try {
    return await handlePost({ request, env });
  } catch (e) {
    return json({ ok: false, error: 'Server crash: ' + clip((e && e.message) || String(e), 300), results: {} }, 500);
  }
}

async function handlePost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!rate('aiseo:' + (auth.user.id || 'x'), 20, 5 * 60_000)) return fail('Too many generations — 1 minute ruk kar try karo.', 429);

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('Body must be JSON.'); }

  const brief = {
    topic: clip(body.topic || '', 200),
    game: clip(body.game || '', 80),
    keywords: clip(body.keywords || '', 200),
    category: clip(body.category || '', 60),
    audience: clip(body.audience || '', 120),
    duration_seconds: Number(body.duration_seconds || 0) || '',
    transcript: clip(body.transcript || '', 4000)
  };
  if (!brief.topic && !brief.game) return fail('Kam se kam topic ya game naam do.');

  const channels = (Array.isArray(body.channels) ? body.channels : []).slice(0, 8)
    .map(c => ({
      code: clip(c.code || '', 40), name: clip(c.name || '', 80), platform: clip(c.platform || 'youtube', 20),
      language: clip(c.language || 'en', 12), tone: clip(c.tone || '', 120), audience: clip(c.audience || '', 120),
      keywords: clip(c.keywords || '', 200), title_suffix: clip(c.title_suffix || '', 40), country: clip(c.country || '', 40)
    }))
    .filter(c => c.code);
  if (!channels.length) return fail('Kam se kam ek channel chuno.');

  /* 3 channels in parallel: 5 sequential 25s calls would pass Cloudflare's request
     limit and come back as an HTML error page instead of JSON. */
  const results = {};
  const queue = channels.slice();
  const worker = async () => {
    while (queue.length) {
      const ch = queue.shift();
      try {
        const r = await callAI(env, userPrompt(ch, brief));
        results[ch.code] = r.ok
          ? { ok: true, pack: normalise(r.pack), provider: r.provider, model: r.model }
          : { ok: false, code: r.code, error: r.error };
      } catch (e) {
        results[ch.code] = { ok: false, code: 'ai_error', error: clip(e.message || String(e), 200) };
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const anyOk = Object.values(results).some(r => r.ok);
  return json({ ok: anyOk, at: new Date().toISOString(), brief, results }, anyOk ? 200 : 502);
}
