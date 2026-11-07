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
    const old = await store.get(key); if (old && !b.fresh && old.v === 2) return json(200, { ok: true, item: old, cached: true });
    const info = b.info || {}, screens = (Array.isArray(b.screens) ? b.screens : []).slice(0, 10).map((x) => typeof x === "string" ? { name: str(x, 60), labels: [] } : { name: str(x.name, 60), labels: (x.labels || []).slice(0, 16).map((l) => str(l, 50)) });
    const L = LANGS[lang], keepUi = lang !== "en";
    const base = `You write software user manuals for vivo India's internal BI web portal and its two Android apps (Admin app for HO, State app for state BI teams) — one shared server, so data and settings stay in sync. Readers: vivo's IT developers in China and Indian field staff — be concrete and step by step, short sentences, no marketing words.
Write ALL text values in ${L}.${keepUi ? " Keep on-screen button / tab / field names exactly in English inside quotes, followed by the translation in brackets, e.g. “Publish” (发布)." : ""}
Audience: ${aud === "admin" ? "admins / developers" : aud === "user" ? "end users" : "both admins and end users (say which is which)"}. Use only INFO and SCREENS plus general good practice; never invent features. Reply with ONE valid JSON object and nothing else.`;
    const ctxt = "INFO: " + JSON.stringify({ name: str(info.name, 120), who: str(info.who, 300), what: str(info.what, 2000), steps: (info.steps || []).slice(0, 15).map((x) => str(x, 400)), example: str(info.example, 800), tips: (info.tips || []).slice(0, 8).map((x) => str(x, 300)), target: str(info.target, 80), group: str(info.group, 80) }) + "\nSCREENS (tab name + the labels visible on it): " + JSON.stringify(screens);
    const A = base + `
JSON shape: {"title":"","tagline":"one line","overview":"3-4 sentences","roles":[{"role":"","can":["4-6 items"]}],"prerequisites":["…"],
"navigation":[{"from":"screen","action":"tap … (the exact button / tab)","to":"screen"}],
"adminFlow":[{"step":"short title","detail":"one sentence: what to tap / enter and what happens"}],"userFlow":[{"step":"","detail":""}],
"settings":[{"name":"","where":"tab / button","effect":""}],"dataFlow":["4-6 lines"],"rules":["5-8 lines"],
"onePager":{"headline":"","benefits":["3 short"],"steps":["4-5 very short"],"cta":""},"glossary":[{"term":"","meaning":""}]}
5-8 steps in each flow; navigation must cover every screen in SCREENS.`;
    const B = base + `
JSON shape: {"screens":[{"name":"exact name from SCREENS","purpose":"1-2 sentences","elements":[{"label":"EXACT label from that screen's labels list","what":"what it does / when to use it","click":true or false}],"tips":["1-2"]}],
"faqs":[{"q":"","a":""}],"troubleshooting":[{"problem":"","fix":""}],"videoScript":[{"screen":"screen name","caption":"one short line"}]}
One entry per screen in SCREENS (same order), 5-8 elements each picked from its labels (most important first; click = it is tapped in the normal flow). 5-6 FAQs, 3-4 troubleshooting items, one video caption per screen.`;
    const call = (sys) => ctx.askAI(env, "Write this part of the manual.", ctxt, [], ctx.aiFetch, { system: sys, label: "MANUAL", maxTokens: 6000, json: true, raw: true });
    const [ra, rb] = await Promise.all([call(A), call(B)]);
    const da = ra.ok ? parseLoose(ra.text) : null, db = rb.ok ? parseLoose(rb.text) : null;
    if (!da && !db) return json(200, { ok: false, error: (ra.error || rb.error || "AI reply couldn't be read") + " — try again." });
    const steps = (info.steps || []).map((x) => ({ step: str(x, 120), detail: "" }));
    const d = Object.assign({ title: str(info.name, 120), tagline: str(info.who, 160), overview: str(info.what, 1200), roles: [], prerequisites: [], navigation: [], adminFlow: steps, userFlow: [], settings: [], dataFlow: [], rules: [], onePager: { headline: str(info.name, 80), benefits: [], steps: (info.steps || []).slice(0, 5).map((x) => str(x, 80)), cta: "" }, glossary: [] }, da || {},
      { screens: (db && Array.isArray(db.screens) && db.screens.length ? db.screens : screens.map((x) => ({ name: x.name, purpose: "", elements: x.labels.slice(0, 6).map((l) => ({ label: l, what: "", click: false })), tips: [] }))), faqs: (db && db.faqs) || [], troubleshooting: (db && db.troubleshooting) || [], videoScript: (db && db.videoScript) || [] });
    const item = { tool: id, lang, aud, data: d, at: t, by, v: 2, partial: !da || !db };
    if (JSON.stringify(item).length < 900000) await store.set(key, item);
    return json(200, { ok: true, item });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// JSON from an AI reply: strips code fences / extra text and, if the reply was cut off, closes it at the last complete value
export function parseLoose(t) {
  let s = String(t || "").replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (/```/.test(m) ? "" : m)).replace(/```[\s\S]*$/, "");
  const a = s.indexOf("{"); if (a < 0) return null; s = s.slice(a);
  try { return JSON.parse(s.slice(0, s.lastIndexOf("}") + 1)); } catch (e) { /* repair below */ }
  const cuts = []; let inS = false, esc = false; const stack = [];
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (inS) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inS = false; continue; }
    if (c === '"') inS = true; else if (c === "{" || c === "[") stack.push(c); else if (c === "}" || c === "]") { stack.pop(); cuts.push([i + 1, stack.slice()]); } else if (c === ",") cuts.push([i, stack.slice()]); }
  for (let k = cuts.length - 1; k >= 0 && k > cuts.length - 400; k--) { const [pos, st] = cuts[k]; const tail = st.slice().reverse().map((c) => (c === "{" ? "}" : "]")).join(""); try { return JSON.parse(s.slice(0, pos) + tail); } catch (e) { /* next */ } }
  return null;
}
