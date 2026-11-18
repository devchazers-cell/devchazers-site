# START HERE — kya upload karna hai (Roman Urdu)

Ye file sirf aap ke liye hai. Upload ke baad chahein to delete kar dein.

---

## 1. Is ZIP me kya hai

**Poora repo** — purani saari files, nayi files, aur wo files jo pichli baar upload nahi hui thin. Sab kuch ek saath. Aap ko kuch chunna nahi hai.

```
wrangler.jsonc                    ← waise hi hai, isay chhedna nahi
.github/workflows/hq-cron.yml     ← waise hi hai
functions/api/hq/                 ← backend (Cloudflare Pages Functions)
    ai.js            (naya)       → /api/hq/ai
    _ai_tools.js     (naya)       → 22 asli tools
    _ai_agent.js     (naya)       → Gemini/Groq/OpenAI
    _ai.js, ai-key.js, status.js, ai-seo.js, accounts.js, …  (pichli baar wale)
devchazers-pages-upload/          ← poori website + admin + HQ
    admin/hq/hq-views-ai.js (naya)   → AI Assistant + Live Activity
    admin/hq/ai-manager-schema.sql   → (main pehle hi chala chuka hoon)
    admin/hq/AI-MANAGER-*.md         → plan, README, security, test report
    admin/hq/hq-session.js (pichli baar wala, abhi tak upload nahi hua tha)
    js/site-controls.js              → banner + maintenance + popup (ab index.html me laga hua)
```

## 2. Upload kaise karein

**GitHub Desktop (aasan aur safe):**
1. GitHub Desktop → apna repo → **Fetch origin** (purana kaam bacha rahe).
2. ZIP extract karein.
3. Andar ki `devchazers-pages-upload/`, `functions/`, `.github/` folders ko repo folder me **copy → Replace** karein.
4. Commit message: `AI Website Manager` → **Commit to main** → **Push origin**.
5. Cloudflare Pages khud deploy karega (~1–2 minute).

**Ya** GitHub website par: repo → Add file → Upload files → folders drag → Commit.

⚠️ Sirf aadhi files upload na karein. `admin/hq/index.html` sabse pehle `hq-session.js` maangta hai — agar wo file upload nahi hui to HQ ka safha khula hi nahi khulega.

## 3. Database ka kaam — HO GAYA ✅

Main ne khud Supabase par chala diya (`ai_website_manager_tables` migration):

| Table | RLS | Policies |
|---|---|---|
| `ai_conversations` | ✅ on | 3 |
| `ai_messages` | ✅ on | 3 |
| `ai_action_logs` | ✅ on | 3 |
| `ai_approvals` | ✅ on | 3 |
| `ai_project_memory` | ✅ on | 3 |
| `ai_usage_stats` | ✅ on | 3 |

Aur live check bhi kiya: public anon key se in tables par **SELECT → 401** aur **INSERT → 401** (yani bahar se koi nahi parh/likh sakta). Aap ko SQL Editor me kuch nahi chalana.

## 4. Ab aap ke paas sirf ye 5 kaam hain

1. **Upload** (upar wala step 2).
2. **Deploy check:** `https://devchazers.site/api/hq/status` kholen → **JSON** aana chahiye. HTML aaye to functions deploy nahi hue (dobara upload karein).
3. **AI key:** HQ → AI Assistant → *"Connect a free AI key"* → Google AI Studio se free Gemini key paste karein. (Jab tak key nahi, AI "no_ai_key" ka saaf message dega — koi jhoota jawab nahi.)
4. **Cache clear:** `Ctrl + Shift + R`.
5. **Test:**
   - `Website ka status batao` → steps chalte nazar aayenge, phir "Verified" result.
   - `Homepage par banner laga do: "Hello from HQ"` → Approve → site refresh → oopar bar nazar aayegi.
   - Galat kuch ho jaye to: Live Activity → **Kill switch**.

## 5. Optional (baad me kar sakte hain)

Cloudflare → Pages → Settings → Environment variables:
- `HQ_AI_ACTIONS=off` → hard kill switch (UI se bhi band ho jata hai, ye server se)
- `HQ_AI_MONTHLY_REQUESTS=1200` → mahine ki AI-call limit (default 1200)
- `HQ_AI_APPROVAL_MINUTES=30` → approval kitni der zinda rahe

## 6. Yaad rahe

- `wrangler.jsonc` me `main:` add **na** karein — site Pages par chalti hai.
- `functions/` folder `devchazers-pages-upload/` ke andar **na** rakhein.
- Koi table drop na karein.
- Meta/X ke credentials abhi bhi missing hain (health endpoint kehta hai) — AI wahan sirf **draft** bana sakta hai, publish nahi.

Poori tafseel: `devchazers-pages-upload/admin/hq/AI-MANAGER-DEPLOY-URDU.md`
