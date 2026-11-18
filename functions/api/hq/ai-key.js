/* ============================================================================
   /api/hq/ai-key        (admin session)                       NEW · 2026-11-12

   Poora AI setup website se — Cloudflare dashboard kholne ki zaroorat nahi.

     GET                  → key hai ya nahi, kahan se aa rahi hai (env / database)
     POST {api_key}       → key ko chala kar dekhta hai (models endpoint), phir
                            AES-GCM se encrypt karke hq_ai_keys me save karta hai
     POST {api_key, test_only:true} → sirf check, save nahi
     DELETE               → database wali key hata do (env key ko chhoota nahi)

   Key kabhi browser ko wapas nahi jati: sirf hint (AIza…1f2e) aur provider.
   ========================================================================== */
import { json, fail, requireAdmin, rate, svc, conf } from './_shared.js';
import { aiKeyState, resolveProvider, probeProvider, saveDbKey, clearDbKey, cleanKey, hintOf, PROVIDER_LABEL, DEFAULT_MODELS } from './_ai.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);

  const state = await aiKeyState(env);
  const c = conf(env);
  let table = !!c.svc;
  if (table && state.source === 'none') {
    /* Tell the user *why* it is off: no key yet, or the table cannot be reached. */
    try { await svc(env, 'hq_ai_keys?id=eq.ai&select=id&limit=1'); }
    catch (e) { table = false; }
  }
  return json({
    ok: true,
    configured: !!state.key,
    provider: state.provider,
    providerLabel: PROVIDER_LABEL[state.provider] || state.provider,
    source: state.source,
    hint: state.hint,
    model: state.model || DEFAULT_MODELS[state.provider][0],
    table,
    updated_at: state.updated_at || '',
    note: state.key
      ? 'AI connected — the key is encrypted on the server.'
      : !c.svc
        ? 'SUPABASE_SERVICE_ROLE_KEY is missing on the server, so a key cannot be stored. Ask for help with the Cloudflare variables.'
        : table
          ? 'No key yet. Paste a free Gemini key in AI SEO Studio → Connect AI and it works immediately.'
          : 'The hq_ai_keys table is missing or unreachable — run admin/hq/hq-fix-20261112.sql.'
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!rate('aikey:' + (auth.user.id || 'x'), 12, 60_000)) return fail('Bohat zyada koshishein — 1 minute ruk kar try karo.', 429);

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('Body JSON honi chahiye.'); }

  const key = cleanKey(body.api_key || body.key || '');
  if (!key) return fail('Key khaali hai — pehle AI key paste karo.');
  if (key.length < 20) return fail('Ye key chhoti lag rahi hai. Poori key copy karo (usually 30+ characters).');

  const provider = resolveProvider(env, key);
  const probe = await probeProvider(provider, key);

  if (!probe.ok) {
    const map = {
      bad_key: 'Key galat ya expire ho gayi (' + provider + '). Naye key banao aur dobara paste karo.',
      rate: 'Provider ne rate limit laga di hai — 1 minute baad try karo.',
      timeout: 'Provider tak pahunch nahi sake (timeout). Internet check karke dobara try karo.',
      unreachable: 'Provider tak pahunch nahi sake. Key sahi hai to dobara try karo.'
    };
    return json({
      ok: false, saved: false, provider, providerLabel: PROVIDER_LABEL[provider],
      code: probe.code, error: map[probe.code] || ('Key check fail: ' + (probe.error || probe.code))
    }, 400);
  }

  if (body.test_only) {
    return json({ ok: true, saved: false, provider, providerLabel: PROVIDER_LABEL[provider], model: probe.model, models: probe.models, hint: hintOf(key), note: 'Key chal rahi hai. Save karo to AI Studio chalu ho jayega.' });
  }

  try {
    const saved = await saveDbKey(env, provider, key, probe.model);
    return json({ ok: true, saved: true, provider, providerLabel: PROVIDER_LABEL[provider], model: probe.model, hint: saved.hint, source: 'db', note: 'AI connected — key encrypted save ho gayi.' });
  } catch (e) {
    return fail('Key check pass hui lekin save nahi ho saki: ' + e.message + ' (hq_ai_keys table / HQ_TOKEN_KEY check karo).', 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  try {
    await clearDbKey(env);
    const state = await aiKeyState(env);
    return json({ ok: true, configured: !!state.key, source: state.source, note: state.key ? 'Database key hata di — dashboard wali key ab bhi chal rahi hai.' : 'AI key hata di.' });
  } catch (e) {
    return fail('Hatayi nahi ja saki: ' + e.message, 500);
  }
}

export async function onRequest({ request, env }) {
  return fail('Method not allowed.', 405);
}
