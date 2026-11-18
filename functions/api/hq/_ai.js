/* ============================================================================
   DevChazers HQ — AI helpers (server only)

   Ek hi jagah se AI key resolve hoti hai:

     1. Cloudflare env   AI_API_KEY / GEMINI_API_KEY / GROQ_API_KEY / OPENAI_API_KEY
     2. Database         hq_ai_keys (HQ → AI SEO Studio se save ki hui key,
                         AES-GCM se bandhi hui — browser ko kabhi nahi milti)

   Iska matlab: aap key Cloudflare dashboard me add karne ke bajaye seedha
   website se paste kar sakte ho. Dono jagah key ho to env jeetti hai.

   hq_ai_keys par RLS on hai aur koi policy nahi — sirf service-role (yahan)
   parh sakta hai, anon/authenticated bilkul nahi.
   ========================================================================== */
import { svc, seal, unseal } from './_shared.js';

export const AI_ROW_ID = 'ai';

export const DEFAULT_MODELS = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-flash-latest'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini']
};

export const PROVIDER_LABEL = { gemini: 'Google Gemini', groq: 'Groq', openai: 'OpenAI' };

export const cleanKey = v => String(v || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');

/** Key env se (agar aap ne Cloudflare me rakhi hai). */
export function keyFromEnv(env) {
  const raw = env.AI_API_KEY || env.GEMINI_API_KEY || env.GROQ_API_KEY || env.OPENAI_API_KEY || env.AI_KEY || '';
  return cleanKey(raw);
}

/** Provider: env se, warna key ke prefix se pehchan lo (AIza… = Gemini, gsk_ = Groq, sk- = OpenAI). */
export function resolveProvider(env, key) {
  let p = String(env.AI_PROVIDER || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (['google', 'gemini', 'googleai', 'googleaistudio', 'googlegemini'].includes(p)) p = 'gemini';
  else if (['groq', 'groqai', 'groqcloud'].includes(p)) p = 'groq';
  else if (['openai', 'chatgpt', 'gpt', 'openaiapi'].includes(p)) p = 'openai';
  else if (!p) {
    if (/^gsk_/.test(key)) p = 'groq';
    else if (/^sk-/.test(key)) p = 'openai';
    else p = 'gemini';
  }
  if (!DEFAULT_MODELS[p]) p = 'gemini';
  return p;
}

/** Key ka pehchanne wala hissa — poori key kabhi wapas nahi jati. */
export function hintOf(key) {
  const k = String(key || '');
  if (k.length < 10) return '••••';
  return k.slice(0, 4) + '…' + k.slice(-4);
}

/* ------------------------------------------------------------------ store -- */
export async function readDbKey(env) {
  try {
    const rows = await svc(env, 'hq_ai_keys?id=eq.' + AI_ROW_ID + '&select=provider,model,key_enc,key_hint,updated_at');
    const row = rows && rows[0];
    if (!row || !row.key_enc) return null;
    const obj = await unseal(env, row.key_enc);
    const key = cleanKey(obj.key || obj.api_key || '');
    if (!key) return null;
    return {
      key,
      provider: String(row.provider || resolveProvider(env, key)),
      model: String(row.model || ''),
      hint: String(row.key_hint || hintOf(key)),
      updated_at: row.updated_at || ''
    };
  } catch (e) {
    /* Table missing ya HQ_TOKEN_KEY kamzor — AI bas env se chalega. Kabhi crash nahi. */
    return null;
  }
}

export async function saveDbKey(env, provider, key, model) {
  const row = {
    id: AI_ROW_ID,
    provider,
    model: model || null,
    key_enc: await seal(env, { key }),
    key_hint: hintOf(key),
    updated_at: new Date().toISOString()
  };
  await svc(env, 'hq_ai_keys', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([row])
  });
  return { provider, model: model || '', hint: row.key_hint };
}

export async function clearDbKey(env) {
  await svc(env, 'hq_ai_keys?id=eq.' + AI_ROW_ID, { method: 'DELETE' });
}

/** Ek hi call: env → DB → none. */
export async function aiKeyState(env) {
  const envKey = keyFromEnv(env);
  if (envKey) {
    return { key: envKey, provider: resolveProvider(env, envKey), source: 'env', hint: hintOf(envKey), model: '', from_dashboard: true };
  }
  const db = await readDbKey(env);
  if (db && db.key) {
    return {
      key: db.key,
      provider: resolveProvider(Object.assign({}, env, { AI_PROVIDER: db.provider }), db.key),
      source: 'db', hint: db.hint, model: db.model, updated_at: db.updated_at, from_dashboard: false
    };
  }
  return { key: '', provider: resolveProvider(env, ''), source: 'none', hint: '', model: '', from_dashboard: false };
}

/* ------------------------------------------------------------------- probe -- */
function fetchT(url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 12000);
  return fetch(url, Object.assign({}, init, { signal: ctrl.signal })).finally(() => clearTimeout(t));
}

const score = n => {
  let s = 0;
  if (/embed|image|tts|veo|live|audio|nano|banana|omni|computer|aqa|deep-research/i.test(n)) return -1000;
  if (n === 'gemini-2.5-flash') s += 100;
  if (/flash/.test(n)) s += 25; else s -= 8;
  if (/lite/.test(n)) s -= 12;
  if (/preview|exp|experimental/.test(n)) s -= 10;
  if (/pro/.test(n)) s -= 6;
  if (/latest/.test(n)) s += 6;
  return s;
};

/** Key sach me chalti hai ya nahi — models endpoint se check (koi token kharch nahi). */
export async function probeProvider(provider, key) {
  const p = DEFAULT_MODELS[provider] ? provider : 'gemini';
  const url = p === 'gemini'
    ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100'
    : p === 'groq' ? 'https://api.groq.com/openai/v1/models' : 'https://api.openai.com/v1/models';
  const headers = p === 'gemini' ? { 'x-goog-api-key': key } : { authorization: 'Bearer ' + key };
  try {
    const res = await fetchT(url, { headers }, 12000);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = ((body && body.error && (body.error.message || body.error)) || ('HTTP ' + res.status));
      const code = (res.status === 401 || res.status === 403) ? 'bad_key'
        : (res.status === 400 && /api[\s_-]?key|api key not valid|invalid.?key|unauthenticated|credential/i.test(String(msg))) ? 'bad_key'
        : res.status === 429 ? 'rate'
        : res.status === 404 ? 'bad_url' : 'http_' + res.status;
      return { ok: false, code, status: res.status, error: String(msg).slice(0, 220) };
    }
    const models = p === 'gemini'
      ? ((body.models || []).map(m => String(m.name || '').replace(/^models\//, '')).filter(n => /flash|pro/i.test(n) && score(n) > -500))
      : ((body.data || []).map(m => m.id).filter(Boolean));
    const sorted = models.sort((a, b) => score(b) - score(a));
    const best = sorted.find(m => DEFAULT_MODELS[p].includes(m)) || sorted[0] || DEFAULT_MODELS[p][0];
    return { ok: true, provider: p, model: best, models: sorted.slice(0, 12) };
  } catch (e) {
    const aborted = /abort/i.test(String(e && e.message));
    return { ok: false, code: aborted ? 'timeout' : 'unreachable', error: aborted ? 'Provider ne 12s me jawab nahi diya.' : String((e && e.message) || e).slice(0, 200) };
  }
}
