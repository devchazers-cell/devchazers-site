# AI Manager — Upload karne ki guide (Roman Urdu)

Ye file sirf aap ke liye hai. Sab kuch step-by-step, isi tarteeb me karein.

---

## A. ZIP me kya hai

`devchazers-ai-manager-20261115.zip` = **poora repo** (92 files), jaisa GitHub par hona chahiye:

```
wrangler.jsonc                  ← ISKO HAATH NA LAGAYEN (badalne se site toot sakti hai)
.github/workflows/hq-cron.yml   ← pehle se maujood, waise hi hai
functions/api/hq/…              ← backend (Cloudflare Pages Functions)
devchazers-pages-upload/…       ← poori website
```

Naye files:

| File | Kaam |
|---|---|
| `functions/api/hq/ai.js` | AI ka backend `/api/hq/ai` |
| `functions/api/hq/_ai_tools.js` | 22 asli tools (A/B/C categories) |
| `functions/api/hq/_ai_agent.js` | Gemini / Groq / OpenAI provider |
| `admin/hq/hq-views-ai.js` | AI Assistant + Live Activity ke 2 safhe |
| `admin/hq/ai-manager-schema.sql` | 6 nayi `ai_*` tables |
| `admin/hq/AI-MANAGER-*.md` | Plan / README / Security / Test report |

Purane files jo **replace** honge (billkul normal hai):
`admin/hq/index.html`, `admin/hq/hq-app.js`, `admin/hq/hq.css`, `js/site-controls.js`,
`devchazers-pages-upload/index.html`, aur pichli baar wale bache hue fix-pack files
(`hq-session.js`, `status.js`, `ai-key.js`, `_ai.js`, `data-service.js`, `hq-data.js`,
`hq-api.js`, `admin/admin.js`, `hq-views-*.js`, `ai-seo.js`, `hq-fix-20261112.sql`).

> **Yaad rakhein:** pichla fix-pack abhi tak live nahi hua tha. Usay **isi ZIP ke saath** upload karna zaroori hai — warna `admin/hq/index.html` wo file maangega jo server par nahi hogi aur HQ ka safha khali/kharaab dikhega.

---

## B. GitHub par kaise daalein (aasan tareeqa)

**GitHub Desktop (sab se safe):**
1. GitHub Desktop kholen → apna `devchazers-site` repo → **Fetch origin** (taake aap ka purana kaam na ure).
2. ZIP ko extract karein.
3. Extract ki hui `devchazers-pages-upload/`, `functions/`, `.github/` folders ko **repo folder me copy** karein → "Replace files in destination" par haan kahein.
4. GitHub Desktop me changes ki list dekhein → commit message: `AI Website Manager` → **Commit to main** → **Push origin**.
5. `wrangler.jsonc` ko touch na karein (agar wo ZIP se replace ho bhi jaye to bilkul waisa hi hai).

**Bina Git (website se):** repo → **Add file → Upload files** → ZIP ki folders drag karein → Commit. (Ye 92 files ke liye thoda slow hai, magar chalta hai.)

Push karne ke baad Cloudflare Pages khud deploy karta hai (~1–2 minute).

---

## C. Ye kaam files ke ilawa karna hoga

Ye cheezein ZIP ke andar nahi ho sakti — aap ko karni hongi:

| # | Kaam | Kahan | Zaroori? |
|---|---|---|---|
| 1 | ~~SQL chalana~~ — **HO GAYA** ✅ main ne khud Supabase par `ai_website_manager_tables` migration chala di. 6 tables, RLS on, 3 policies each; anon key se SELECT/INSERT dono **401**. Aap ko kuch nahi karna. | — | ✅ done |
| 2 | **Deploy ka intezaar + check** — `https://devchazers.site/api/hq/status` kholen. **JSON** aana chahiye. Agar HTML aaye to functions deploy nahi hue. | Browser | **Haan** |
| 3 | **AI key** — free Gemini key (Google AI Studio se) HQ → AI Assistant → "Connect a free AI key" me paste karein. (Ya Cloudflare me `AI_API_KEY` + `AI_PROVIDER=gemini`.) | HQ UI ya Cloudflare | **Haan, warna AI kaam nahi karega** |
| 4 | **Environment variables** — naye lazmi koi nahi. Sirf ye optional hain: `HQ_AI_ACTIONS=off` (hard kill switch), `HQ_AI_MONTHLY_REQUESTS=1200` (mahine ki limit), `HQ_AI_APPROVAL_MINUTES=30`. | Cloudflare → Pages → Settings → Environment variables | Nahi, magar behtar hai |
| 5 | **Cache / hard reload** — `Ctrl + Shift + R` (mobile par browser cache clear). | Browser | Haan, agar purana HQ dikhe |
| 6 | **Pehla test** — HQ → AI Assistant → likhein: `Website ka status batao`. Steps chalte hue nazar aayenge, phir result "Verified" ke saath. | HQ | Haan |
| 7 | **Doosra test (asli change)** — `Homepage par banner laga do: "Hello from HQ"` → Approve → phir `devchazers.site` refresh karen; oopar bar nazar aayegi. | HQ + website | Haan |
| 8 | **GitHub Actions secret** (pehle se chal raha hai to ignore) — repo → Settings → Secrets → `HQ_CRON_SECRET` | GitHub | Sirf agar cron band hai |

---

## D. Kya nahi karna

- `wrangler.jsonc` me `main:` add **na** karein — site Pages par chal rahi hai, Worker par nahi.
- `functions/` folder ko `devchazers-pages-upload/` ke **andar** na rakhein — wo repo ke root me rehta hai.
- Sirf kuch files upload kar ke chhor na dein — code aur functions ek saath jayen.
- Database me koi table **drop** na karein; AI ka SQL sirf nayi tables banata hai.

---

## E. Kuch galat ho jaye to (rollback)

1. **Foran band:** HQ → Live Activity → **Kill switch**. (Ya Cloudflare me `HQ_AI_ACTIONS=off`.)
2. **Purana HQ wapas:** GitHub par pichla commit → **Revert** → push. Naye files additive hain, is liye revert se kuch nahi tootta.
3. **Banner/maintenance band:** root `index.html` se `<script src="js/site-controls.js" defer></script>` line hata dein. `js/site.js` ko chhua hi nahi gaya.
4. **Tables hataani hon (history samet):** `ai-manager-schema.sql` ke aakhir me commented `drop table` block hai.

---

## F. Sach baat (kya test hua, kya nahi)

- ✅ Backend ke **50** automated test pass (approval gate, DELETE gate, prompt-injection, kill switch, budget, verification).
- ✅ UI ke **40** test pass (live steps, before/after, gates).
- ✅ HQ ke **27 safhe** bina error mount hote hain.
- ❌ Asli Gemini call, asli browser, aur SQL ka asli execution **test nahi hua** — kyunki mere paas key/production access nahi tha.
- ⚠️ YouTube toota nahi, magar Meta/X ke credentials abhi bhi missing hain (`/api/hq/health` kehta hai) — AI un par kuch publish nahi kar sakta, sirf draft banata hai.
