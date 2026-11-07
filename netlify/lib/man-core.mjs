// Tool manuals: AI writes a detailed, structured manual for one tool / dashboard section (in the chosen language) from
// the user-guide entry and the screens captured on the page. The page turns it into an editable PPT, a PDF, a one-pager
// creative or a walkthrough video. Cached per tool × language × audience so everyone can export it again.
//   man:<tool>:<lang>:<aud>  { tool, lang, aud, data, at, by }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const LANGS = { en: "English", hi: "Hindi (हिन्दी)", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi", gu: "Gujarati", kn: "Kannada", ml: "Malayalam", pa: "Punjabi", or: "Odia", zh: "Simplified Chinese (简体中文)" };

export async function manAction(b, ctx) {
  const { store, t, app, rec, env } = ctx, by = rec.fullName || rec.username || "";
  if (app !== "admin") return json(403, { ok: false, error: "Tool manuals are for HO admins." });
  const id = str(b.tool, 60).replace(/[^a-z0-9:_-]/gi, ""), lang = LANGS[b.lang] ? b.lang : "en", aud = ["both", "admin", "user"].includes(b.aud) ? b.aud : "both", key = `man:${id}:${lang}:${aud}`;
  if (b.action === "man-get") { const x = await store.get(key); return json(200, { ok: true, item: x || null }); }
  if (b.action === "man-list") { const L = await store.list("man:"); return json(200, { ok: true, keys: L.slice(0, 500) }); }
  if (b.action === "man-gen") {
    if (!id) return json(400, { ok: false, error: "Pick a tool." });
    const old = await store.get(key); if (old && !b.fresh) return json(200, { ok: true, item: old, cached: true });
    const info = b.info || {}, screens = (Array.isArray(b.screens) ? b.screens : []).slice(0, 10).map((s) => str(s, 60));
    const L = LANGS[lang], keepUi = lang !== "en";
    const sys = `You write software user manuals for vivo India's internal BI web portal and its two Android apps (Admin app for HO, State app for state BI teams) — they share one server, so data and settings stay in sync. The readers include vivo's IT developers in China and Indian field staff, so be concrete, visual and step by step; short sentences; no marketing language.
Write ALL text in ${L}.${keepUi ? " Keep on-screen button / tab / field names exactly as they appear in English, in quotes, followed by the translation in brackets the first time, e.g. “Publish” (发布)." : ""}
Reply with ONE JSON object only:
{"title":"","tagline":"one line","overview":"3-4 sentences: what problem it solves, who uses it, where it lives (web + both apps)",
"roles":[{"role":"HO admin|State user|Master admin|Retailer (link)|Partner (link)","can":["what this role can do"]}],
"prerequisites":["data / settings needed first"],
"navigation":[{"from":"screen or tab","action":"tap / choose …","to":"screen or tab"}],
"screens":[{"name":"one of SCREENS (tab names) or a key screen","purpose":"","elements":[{"label":"on-screen label","what":"what it does"}],"tips":[""]}],
"adminFlow":[{"step":"","detail":""}],"userFlow":[{"step":"","detail":""}],
"settings":[{"name":"","where":"","effect":""}],
"dataFlow":["how data moves: uploads → server → other tools / apps; which other tools it links to"],
"rules":["important business rules, limits, permissions, validations"],
"faqs":[{"q":"","a":""}],"troubleshooting":[{"problem":"","fix":""}],
"glossary":[{"term":"","meaning":""}],
"onePager":{"headline":"","benefits":["3 short"],"steps":["4-5 very short"],"cta":""},
"videoScript":[{"screen":"screen name","caption":"one short line for a walkthrough video"}]}
Audience: ${aud === "admin" ? "admins / developers only" : aud === "user" ? "end users only" : "both admins and end users (label which is which)"}. Use only the INFO and SCREENS given plus general good practice; do not invent features. 5-12 items per list where the INFO supports it.`;
    const q = "Write the manual.";
    const context = "INFO: " + JSON.stringify({ name: str(info.name, 120), who: str(info.who, 300), what: str(info.what, 2000), steps: (info.steps || []).slice(0, 15).map((x) => str(x, 400)), example: str(info.example, 800), tips: (info.tips || []).slice(0, 8).map((x) => str(x, 300)), target: str(info.target, 80), group: str(info.group, 80) }) + "\nSCREENS: " + JSON.stringify(screens);
    const r = await ctx.askAI(env, q, context, [], ctx.aiFetch, { system: sys, label: "MANUAL" });
    if (!r.ok) return json(200, { ok: false, error: r.error });
    let d = null; try { const m = /\{[\s\S]*\}/.exec(r.text || ""); d = m ? JSON.parse(m[0]) : null; } catch (e) { d = null; }
    if (!d || !d.title) d = { title: str(info.name, 120), tagline: "", overview: str(r.text, 3000), roles: [], prerequisites: [], navigation: [], screens: screens.map((s) => ({ name: s, purpose: "", elements: [], tips: [] })), adminFlow: [], userFlow: (info.steps || []).map((x) => ({ step: str(x, 200), detail: "" })), settings: [], dataFlow: [], rules: [], faqs: [], troubleshooting: [], glossary: [], onePager: { headline: str(info.name, 80), benefits: [], steps: (info.steps || []).slice(0, 5), cta: "" }, videoScript: [] };
    const item = { tool: id, lang, aud, data: d, at: t, by };
    if (JSON.stringify(item).length < 900000) await store.set(key, item);
    return json(200, { ok: true, item });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
