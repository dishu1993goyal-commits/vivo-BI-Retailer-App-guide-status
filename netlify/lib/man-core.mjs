// Tool manuals: AI writes a detailed, structured manual for one tool / dashboard section (in the chosen language) from
// the user-guide entry and the screens captured on the page. The page turns it into an editable PPT, a PDF, a one-pager
// creative or a walkthrough video. Cached per tool × language × audience so everyone can export it again.
//   man:<tool>:<lang>:<aud>  { tool, lang, aud, data, at, by }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const LANGS = { en: "English", hi: "Hindi (हिन्दी)", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi", gu: "Gujarati", kn: "Kannada", ml: "Malayalam", pa: "Punjabi", or: "Odia", zh: "Simplified Chinese (简体中文)" };

export async function manAction(b, ctx) {
  const { store, t, app, rec, env } = ctx, by = rec.fullName || rec.username || "";
  const id = str(b.tool, 60).replace(/[^a-z0-9:_-]/gi, ""), lang = LANGS[b.lang] ? b.lang : "en", aud = ["both", "admin", "user"].includes(b.aud) ? b.aud : "both", key = `man:${id}:${lang}:${aud}`;
  // read-only for everyone (the Monthly one-pager shows tool details); writing manuals is for HO admins
  if (b.action === "man-get") { let x = await store.get(key); if (!x && b.any) { const L = (await store.list(`man:${id}:`)).sort((a, c) => (a.indexOf(":en:") >= 0 ? -1 : 1) - (c.indexOf(":en:") >= 0 ? -1 : 1)); if (L[0]) x = await store.get(L[0]); } return json(200, { ok: true, item: x || null }); }
  if (b.action === "man-shots-get") { const x = await store.get(`manshot:${id}`); return json(200, { ok: true, shots: (x && x.shots) || [], at: x ? x.at : 0 }); }
  if (b.action === "man-have") { const L = await store.list("manshot:"), M = await store.list("man:"); return json(200, { ok: true, shots: L.map((k) => k.slice(8)), manuals: [...new Set(M.map((k) => k.split(":").slice(1, -2).join(":")))] }); }
  if (app !== "admin") return json(403, { ok: false, error: "Tool manuals are for HO admins." });
  if (b.action === "man-shots-save") {   // the captured app screens (compressed), so other tools can show the real screens
    const shots = (Array.isArray(b.shots) ? b.shots : []).slice(0, 10).map((x) => ({ label: str(x.label, 60), src: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(x.src || "")) ? String(x.src) : "", w: Number(x.w) || 390, h: Number(x.h) || 844, marks: (x.marks || []).slice(0, 24).map((m) => ({ t: str(m.t, 60), x: +m.x || 0, y: +m.y || 0, w: +m.w || 0, h: +m.h || 0, inp: m.inp ? 1 : 0, ex: str(m.ex, 60) })), click: x.click ? { t: str(x.click.t, 60), x: +x.click.x || 0, y: +x.click.y || 0, w: +x.click.w || 0, h: +x.click.h || 0 } : null })).filter((x) => x.src);
    if (b.clear === true && !shots.length) { await store.delete(`manshot:${id}`).catch(() => store.set(`manshot:${id}`, { shots: [], at: t, by })); return json(200, { ok: true, n: 0 }); }
    if (!shots.length) return json(400, { ok: false, error: "No screens to save." });
    if (JSON.stringify(shots).length > 3800000) return json(413, { ok: false, error: "Screens are too large." });
    await store.set(`manshot:${id}`, { shots, at: t, by }); return json(200, { ok: true, n: shots.length });
  }
  if (b.action === "man-script-save") {   // the narration the video speaks (edited by HO)
    const x = await store.get(key); if (!x) return json(400, { ok: false, error: "Write the manual first." });
    const lines = {}; Object.keys(b.lines || {}).slice(0, 200).forEach((k) => { const v = String(b.lines[k] || "").replace(/\s+/g, " ").trim().slice(0, 700); if (v) lines[str(k, 40)] = v; });
    x.script = { lines, at: t, by, ai: !!(x.script && x.script.ai) && !b.edited, tone: (x.script && x.script.tone) || "" }; await store.set(key, x); return json(200, { ok: true, script: x.script });
  }
  if (b.action === "man-script") {   // ✨ AI writes a spoken script per scene — explains why and how, not a reading of the slide
    const x = await store.get(key); if (!x) return json(400, { ok: false, error: "Write the manual first." });
    const sc = (Array.isArray(b.scenes) ? b.scenes : []).slice(0, 160).map((q) => ({ id: str(q.id, 40), kind: str(q.kind, 10), title: str(q.title, 120), context: str(q.ctx, 500) })).filter((q) => q.id);
    if (!sc.length) return json(400, { ok: false, error: "No scenes." });
    const L = LANGS[lang], tone = str(b.tone, 40) || "friendly trainer", info = x.data || {};
    const sys = `You write the spoken voice-over for a walkthrough video of an internal vivo India BI tool (web portal + Admin and State Android apps, one shared server). A presenter character speaks it while pointing at the part of the screen in each scene.
Write in ${L}${lang !== "en" ? " (keep on-screen button names in English inside quotes)" : ""}, as a ${tone}, to ${aud === "admin" ? "admins" : aud === "user" ? "end users" : "both admins and end users"}. Natural spoken sentences, second person ("you"), no emojis, no markdown, no reading of lists or labels word for word.
Explain WHY each thing matters and WHEN to use it, give a quick practical tip or example where useful, and link scenes so it flows like a guided tour ("Now tap…", "Once that's done…").
Length: title/closing 1-2 sentences; slide scenes 2-3 sentences; a screen intro 1-2 sentences; each numbered step 1-2 short sentences (it plays while the presenter points at that element).
Reply with ONE JSON object: {"lines":{"<scene id>":"spoken text", ...}} with an entry for EVERY scene id given.`;
    const ctxt = "TOOL: " + JSON.stringify({ name: str(info.title, 120), tagline: str(info.tagline, 200), overview: str(info.overview, 800) }) + "\nSCENES (in order): " + JSON.stringify(sc);
    const r = await ctx.askAI(env, "Write the voice-over script.", ctxt, [], ctx.aiFetch, { system: sys, label: "MANUAL", maxTokens: 7000, json: true, raw: true });
    const d = r.ok ? parseLoose(r.text) : null, got = d && (d.lines || d);
    if (!got || typeof got !== "object") return json(200, { ok: false, error: (r.error || "The AI reply couldn't be read") + " — try again." });
    const lines = {}; sc.forEach((q) => { const v = got[q.id]; if (v) lines[q.id] = String(v).replace(/\s+/g, " ").trim().slice(0, 700); });
    x.script = { lines, at: t, by, ai: true, tone }; await store.set(key, x); return json(200, { ok: true, script: x.script, missing: sc.length - Object.keys(lines).length });
  }
  if (b.action === "man-list") { const L = await store.list("man:"); return json(200, { ok: true, keys: L.slice(0, 500) }); }
  if (b.action === "man-tts") return manTts(b, ctx, lang);
  if (b.action === "man-voice") {   // which voice engines are connected; HO can save a Sarvam AI key (write-only, like the other AI keys)
    const c = (await store.get("config:aikeys")) || {};
    if (b.sarvam) { const k = str(b.sarvam, 200).replace(/\s+/g, ""); if (k.length < 16) return json(400, { ok: false, error: "That doesn't look like a Sarvam API subscription key." }); c.sarvam = k; c.by = by; c.at = t; await store.set("config:aikeys", c); }
    if (b.clear === "sarvam") { delete c.sarvam; await store.set("config:aikeys", c); }
    return json(200, { ok: true, sarvam: !!(env.SARVAM_API_KEY || c.sarvam), gemini: !!env.GEMINI_API_KEY, groq: !!(env.GROQ_API_KEY || c.groq) });
  }
  if (b.action === "man-gen") {
    if (!id) return json(400, { ok: false, error: "Pick a tool." });
    const old = await store.get(key), onlyC = !!(old && old.v === 2 && !b.fresh);
    if (onlyC && (old.c || b.noc)) return json(200, { ok: true, item: old, cached: true });
    const info = b.info || {}, screens = (Array.isArray(b.screens) ? b.screens : []).slice(0, 10).map((x) => typeof x === "string" ? { name: str(x, 60), labels: [] } : { name: str(x.name, 60), labels: (x.labels || []).slice(0, 16).map((l) => str(l, 50)) });
    const results = (Array.isArray(b.results) ? b.results : []).slice(0, 6).map((x) => ({ name: str(x && x.name, 60), labels: ((x && x.labels) || []).slice(0, 16).map((l) => str(l, 60)) }));
    const fields = [...new Set((Array.isArray(b.fields) ? b.fields : []).map((x) => str(x, 50)).filter(Boolean))].slice(0, 30);
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
    const Cp = base + `
Now give worked EXAMPLES with dummy data, so readers see what to type and what the finished result looks like.
JSON shape: {"examples":[{"field":"EXACT label from FIELDS","value":"a realistic dummy value a user would enter there"}],
"mock":{"title":"title of the result screen the user sees after finishing the main task","subtitle":"one line","badge":"one status word","kpis":[{"label":"","value":"","what":"how to read this number"}],"table":{"title":"","columns":["3-4 short headers"],"rows":[["one cell per column"]]},"lines":[{"label":"","value":"","what":""}],"total":{"label":"","value":"","what":""},"actions":[{"label":"button on the result screen","what":"what it does"}],"note":"one line"},
"resultScreens":[{"name":"exact name from RESULT SCREENS","purpose":"1-2 sentences: what the user sees here","elements":[{"label":"EXACT label from its labels list","what":"how to read it / what to do next"}]}],
"narration":{"intro":"2 spoken sentences: welcome + what this tool does","journey":"1-2 spoken sentences: how to move through the screens","result":"1-2 spoken sentences: the end result the user gets","outro":"1 short closing sentence"}}
Use believable Indian vivo retail dummy data (e.g. retailer “Mobile Zone”, Prayagraj, Uttar Pradesh; models Y39, Y29, V60; amounts like ₹4,312 in Indian format; dates in 2026). Never real personal data.
One example per FIELD (max 25). mock: 4-6 kpis, a 3-5 row table, 3-5 lines, 1-2 actions. resultScreens: one per RESULT SCREEN, 4-7 elements each (empty array if there are none). Narration is read aloud by a voice — plain sentences, no emojis or symbols.
FIELDS: ${JSON.stringify(fields)}
RESULT SCREENS: ${JSON.stringify(results)}`;
    const call = (sys, mt) => ctx.askAI(env, "Write this part of the manual.", ctxt, [], ctx.aiFetch, { system: sys, label: "MANUAL", maxTokens: mt || 6000, json: true, raw: true });
    const [ra, rb, rc] = await Promise.all([onlyC ? null : call(A), onlyC ? null : call(B), call(Cp, 4500)]);
    const dc = rc && rc.ok ? parseLoose(rc.text) : null;
    const C = dc ? { examples: Array.isArray(dc.examples) ? dc.examples.slice(0, 30) : [], mock: dc.mock && typeof dc.mock === "object" ? dc.mock : null, resultScreens: Array.isArray(dc.resultScreens) ? dc.resultScreens.slice(0, 6) : [], narration: dc.narration && typeof dc.narration === "object" ? dc.narration : {} } : {};
    if (onlyC) {
      const item = Object.assign({}, old, { data: Object.assign({}, old.data, C), c: !!dc });
      if (dc && JSON.stringify(item).length < 900000) await store.set(key, item);
      return json(200, { ok: true, item });
    }
    const da = ra.ok ? parseLoose(ra.text) : null, db = rb.ok ? parseLoose(rb.text) : null;
    if (!da && !db) return json(200, { ok: false, error: (ra.error || rb.error || "AI reply couldn't be read") + " — try again." });
    const steps = (info.steps || []).map((x) => ({ step: str(x, 120), detail: "" }));
    const d = Object.assign({ title: str(info.name, 120), tagline: str(info.who, 160), overview: str(info.what, 1200), roles: [], prerequisites: [], navigation: [], adminFlow: steps, userFlow: [], settings: [], dataFlow: [], rules: [], onePager: { headline: str(info.name, 80), benefits: [], steps: (info.steps || []).slice(0, 5).map((x) => str(x, 80)), cta: "" }, glossary: [] }, da || {},
      { screens: (db && Array.isArray(db.screens) && db.screens.length ? db.screens : screens.map((x) => ({ name: x.name, purpose: "", elements: x.labels.slice(0, 6).map((l) => ({ label: l, what: "", click: false })), tips: [] }))), faqs: (db && db.faqs) || [], troubleshooting: (db && db.troubleshooting) || [], videoScript: (db && db.videoScript) || [] }, C);
    const item = { tool: id, lang, aud, data: d, at: t, by, v: 2, c: !!dc, partial: !da || !db, script: old && old.script ? old.script : undefined };   // a rewrite keeps the edited video script
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

// ---------- 🎙️ voice-over for the walkthrough video: Gemini TTS (all manual languages), Groq Orpheus for English ----------
// Returns a WAV clip (base64). Each clip is cached, so exporting the same video again costs nothing.
const TTS_LANG = { en: "en-IN", hi: "hi-IN", ta: "ta-IN", te: "te-IN", bn: "bn-IN", mr: "mr-IN", gu: "gu-IN", kn: "kn-IN", ml: "ml-IN", pa: "pa-IN", or: "or-IN", zh: "cmn-CN" };
function wav(pcm, rate) {
  const h = Buffer.alloc(44); h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]);
}
function wavPcm(buf) {   // PCM + sample rate from a WAV file (mono 16-bit)
  let p = 12, rate = 24000; while (p + 8 <= buf.length) { const id = buf.toString("ascii", p, p + 4), n = buf.readUInt32LE(p + 4); if (id === "fmt ") rate = buf.readUInt32LE(p + 12); if (id === "data") return { pcm: buf.subarray(p + 8, Math.min(buf.length, p + 8 + n)), rate }; p += 8 + n + (n % 2); }
  return null;
}
async function ttsGemini(env, text, lang, voice, f) {
  const models = [env.GEMINI_TTS_MODEL, "gemini-2.5-flash-preview-tts", "gemini-2.5-flash-tts", "gemini-2.5-flash-lite-preview-tts", "gemini-2.5-pro-preview-tts"].filter(Boolean);
  let last = "";
  for (const m of models) {
    const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Read this aloud like a friendly, clear software trainer (" + TTS_LANG[lang] + "), at a calm pace:\n" + text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice === "m" ? "Charon" : "Kore" } } } } }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { const part = ((((j.candidates || [])[0] || {}).content || {}).parts || []).find((p) => p.inlineData && p.inlineData.data); if (part) { const rate = +((/rate=(\d+)/.exec(part.inlineData.mimeType || "") || [])[1]) || 24000; return { ok: true, buf: wav(Buffer.from(part.inlineData.data, "base64"), rate), src: "gemini" }; } last = "no audio in reply"; continue; }
    const msg = (j.error && j.error.message) || "";
    if (r.status === 429) { const d = (((j.error || {}).details || []).find((x) => x.retryDelay) || {}).retryDelay; return { ok: false, retry: Math.min(90, parseInt(d, 10) || 30), error: "voice quota busy" }; }
    last = r.status + (msg ? ": " + msg.slice(0, 120) : "");
    if (r.status === 401 || r.status === 403) break;
  }
  return { ok: false, error: "Gemini voice " + last };
}
function chunks(text, max) {   // ≤ max characters, cut at sentence / comma boundaries
  const out = []; let cur = "";
  String(text).split(/(?<=[.!?।。,;:])\s+/).forEach((piece) => { while (piece.length > max) { const cut = piece.lastIndexOf(" ", max) > 40 ? piece.lastIndexOf(" ", max) : max; if (cur) { out.push(cur); cur = ""; } out.push(piece.slice(0, cut)); piece = piece.slice(cut).trim(); } if ((cur + " " + piece).trim().length > max) { if (cur) out.push(cur); cur = piece; } else cur = (cur + " " + piece).trim(); });
  if (cur) out.push(cur); return out.filter(Boolean);
}
async function ttsGroq(key, text, voice, f) {
  const plans = [["canopylabs/orpheus-v1-english", voice === "m" ? "daniel" : "hannah"], ["playai-tts", voice === "m" ? "Fritz-PlayAI" : "Arista-PlayAI"]];
  let last = "";
  for (const [model, vname] of plans) {
    const parts = []; let rate = 0, bad = false;
    for (const c of chunks(text, model.startsWith("canopylabs") ? 190 : 900)) {
      const r = await f("https://api.groq.com/openai/v1/audio/speech", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify({ model, voice: vname, input: c, response_format: "wav" }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); if (r.status === 429) return { ok: false, retry: 30, error: "voice quota busy" }; last = r.status + (j.error && j.error.message ? ": " + j.error.message.slice(0, 140) : ""); bad = true; break; }
      const w = wavPcm(Buffer.from(await r.arrayBuffer())); if (!w) { last = "unreadable audio"; bad = true; break; }
      rate = w.rate; parts.push(w.pcm, Buffer.alloc(Math.round(w.rate * 0.25) * 2));
    }
    if (!bad && parts.length) return { ok: true, buf: wav(Buffer.concat(parts), rate), src: "groq" };
    if (/401/.test(last)) break;
  }
  return { ok: false, error: "Groq voice " + last };
}
const SARVAM_LANG = { en: "en-IN", hi: "hi-IN", ta: "ta-IN", te: "te-IN", bn: "bn-IN", mr: "mr-IN", gu: "gu-IN", kn: "kn-IN", ml: "ml-IN", pa: "pa-IN", or: "od-IN" };
async function ttsSarvam(key, text, lang, voice, f) {   // Sarvam AI Bulbul: Indian English + 10 Indian languages, fast, ≤ 2500 chars
  let last = "";
  for (const [model, spk] of [["bulbul:v3", voice === "m" ? "shubh" : "priya"], ["bulbul:v2", voice === "m" ? "abhilash" : "anushka"]]) {
    try {
      const r = await f("https://api.sarvam.ai/text-to-speech", { method: "POST", headers: { "content-type": "application/json", "api-subscription-key": key }, body: JSON.stringify({ text, language_code: SARVAM_LANG[lang], model, speaker: spk, speech_sample_rate: 24000, pace: 1.05 }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.audios && j.audios[0]) { const w = wavPcm(Buffer.from(j.audios.join ? j.audios[0] : j.audios, "base64")); if (w) return { ok: true, buf: wav(w.pcm, w.rate), src: "sarvam" }; last = "unreadable audio"; continue; }
      if (r.status === 429) return { ok: false, retry: 8, error: "voice quota busy" };
      last = r.status + ": " + String((j.error && (j.error.message || j.error)) || j.message || "").slice(0, 140);
      if (r.status === 401 || r.status === 403) break;
    } catch (e) { last = "network " + e.message; }
  }
  return { ok: false, error: "Sarvam voice " + last };
}
async function manTts(b, ctx, lang) {
  const { store } = ctx, f = ctx.aiFetch || fetch, kc = (await store.get("config:aikeys")) || {}, env = Object.assign({}, ctx.env || {}, { SARVAM_API_KEY: (ctx.env && ctx.env.SARVAM_API_KEY) || kc.sarvam || "", GROQ_API_KEY: (ctx.env && ctx.env.GROQ_API_KEY) || kc.groq || "" });
  const text = String(b.text || "").replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu, "").replace(/\s+/g, " ").trim().slice(0, 700), voice = b.voice === "m" ? "m" : "f";
  if (!text) return json(400, { ok: false, error: "Nothing to read." });
  if (!env.SARVAM_API_KEY && !env.GEMINI_API_KEY && !env.GROQ_API_KEY) return json(200, { ok: false, notConfigured: true, error: "No AI voice is connected — add a Sarvam AI key in 🎙️ Voice settings." });
  let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const ck = `mantts:${lang}:${voice}:${h.toString(36)}:${text.length}`, hit = await store.get(ck);
  if (hit && hit.b64) return json(200, { ok: true, b64: hit.b64, src: hit.src, cached: true });
  // fastest first; a busy engine never blocks — the next one is tried straight away, "retry" only if all of them are busy
  const errs = [], plan = []; let r = null, busy = 0;
  if (env.SARVAM_API_KEY && SARVAM_LANG[lang]) plan.push(() => ttsSarvam(env.SARVAM_API_KEY, text, lang, voice, f));
  if (env.GROQ_API_KEY && lang === "en") plan.push(() => ttsGroq(env.GROQ_API_KEY, text, voice, f));
  if (env.GEMINI_API_KEY) plan.push(() => ttsGemini(env, text, lang, voice, f));
  for (const go of plan) { const x = await go(); if (x.ok) { r = x; break; } if (x.retry) busy = Math.max(busy, x.retry); else errs.push(x.error); }
  if (!r && busy && !errs.length) r = { ok: false, retry: Math.min(busy, 20) };
  if (!r || !r.ok) return json(200, { ok: false, retry: r && r.retry, error: r && r.retry ? "The AI voice is busy — waiting a moment." : (errs.filter(Boolean).join(" · ") || "No AI voice for this language yet") + (lang === "zh" && !env.GEMINI_API_KEY ? " (Chinese voice needs the Gemini key)" : !env.SARVAM_API_KEY ? " — add a Sarvam AI key in 🎙️ Voice settings for fast Indian voices" : "") });
  const b64 = r.buf.toString("base64");
  if (b64.length < 4500000) await store.set(ck, { b64, src: r.src, at: ctx.t });
  return json(200, { ok: true, b64, src: r.src });
}
