// App guide assistant: answers questions about the vivo Retailer app (English, Hindi, regional languages), writes
// manuals and narration scripts from the dashboard's own app-feature pages, and — when HO adds a D-ID API key and a
// presenter photo with that person's consent — makes "AI presenter" videos that speak the script.
// Storage:  config:appguide { kb, presenter:{ name, voice, hasPhoto, consentBy, consentAt, didImg, hgAvatar }, video:{ provider, show, hfSpace, hfApi, motion, expr }, videos:[…] }
//           agphoto { mime, b64, at, by }  (private: never served publicly; sent only to D-ID when a video is made)
//           config:agkey { did, heygen, hf }  (write-only)      agai:<hash> { at, data }  (AI cache)
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { createHash, randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const AG_LANGS = { English: "en-IN", Hindi: "hi-IN", Hinglish: "en-IN", Tamil: "ta-IN", Telugu: "te-IN", Kannada: "kn-IN", Malayalam: "ml-IN", Marathi: "mr-IN", Bengali: "bn-IN", Gujarati: "gu-IN", Punjabi: "pa-IN", Odia: "or-IN" };
const VOICES = { "en-IN": ["en-IN-NeerjaNeural", "en-IN-PrabhatNeural"], "hi-IN": ["hi-IN-SwaraNeural", "hi-IN-MadhurNeural"], "ta-IN": ["ta-IN-PallaviNeural", "ta-IN-ValluvarNeural"], "te-IN": ["te-IN-ShrutiNeural", "te-IN-MohanNeural"], "kn-IN": ["kn-IN-SapnaNeural", "kn-IN-GaganNeural"], "ml-IN": ["ml-IN-SobhanaNeural", "ml-IN-MidhunNeural"], "mr-IN": ["mr-IN-AarohiNeural", "mr-IN-ManoharNeural"], "bn-IN": ["bn-IN-TanishaaNeural", "bn-IN-BashkarNeural"], "gu-IN": ["gu-IN-DhwaniNeural", "gu-IN-NiranjanNeural"], "pa-IN": ["pa-IN-OjasNeural", "pa-IN-OjasNeural"], "or-IN": ["or-IN-SubhasiniNeural", "or-IN-SukantNeural"] };
const langOf = (l) => (AG_LANGS[l] ? l : "English");
const DID = "https://api.d-id.com", HG = "https://api.heygen.com";
const PROVIDERS = ["did", "heygen", "hf"];
const errMsg = (d, r) => str((d && ((d.error && (d.error.message || d.error.description || d.error.kind)) || d.description || d.message)) || (r ? "HTTP " + r.status : ""), 180);
function vcfg(c) {   // presenter-video settings HO switches between
  const V = c.video || {}, S = V.show || {};
  return { provider: PROVIDERS.includes(V.provider) ? V.provider : "did", show: { slide: S.slide !== false, ai: S.ai !== false, tp: S.tp !== false, clip: S.clip !== false },
    hfSpace: str(V.hfSpace, 120), hfApi: str(V.hfApi, 60), motion: str(V.motion, 200) || "standing and gesturing naturally with both hands while presenting, pointing to the side as if showing a screen", expr: ["low", "medium", "high"].includes(V.expr) ? V.expr : "high", hgVoices: V.hgVoices || {} };
}
// ---------- free presenter: a Gradio app on a Hugging Face Space, driven from the server ----------
const HFAPI = "https://huggingface.co/api/spaces/";
const lc = (s) => String(s || "").toLowerCase();
async function hfSpace(space, token, f) {   // where the Space lives and whether it is awake
  const H = token ? { authorization: "Bearer " + token } : {};
  let stage = "", host = "";
  try { const r = await f(HFAPI + space, { headers: H }), d = await r.json().catch(() => ({})); if (r.status === 404) throw new Error("No Space called “" + space + "” — check the name (owner/space-name)."); if (r.status === 401 || r.status === 403) throw new Error("Hugging Face refused the token for this Space — check the token."); stage = (d.runtime && d.runtime.stage) || ""; host = d.host || ""; } catch (e) { if (/No Space|refused/.test(e.message)) throw e; }
  if (!host) { try { const r = await f(HFAPI + space + "/host", { headers: H }), d = await r.json().catch(() => ({})); host = d.host || (d.subdomain ? "https://" + d.subdomain + ".hf.space" : ""); } catch (e) { } }
  if (!host) host = "https://" + lc(space).replace(/[^a-z0-9]+/g, "-") + ".hf.space";
  let jwt = "";
  if (token) { try { const r = await f(HFAPI + space + "/jwt", { headers: H }), d = await r.json().catch(() => ({})); jwt = d.token || ""; } catch (e) { } }
  return { host: host.replace(/\/+$/, ""), stage, headers: Object.assign({}, H, jwt ? { "x-zerogpu-token": jwt } : {}) };
}
async function hfApi(S, f) {   // the Space's API description (Gradio 4: /info, Gradio 5: /gradio_api/info)
  for (const pre of ["/gradio_api", ""]) {
    try { const r = await f(S.host + pre + "/info", { headers: S.headers }); if (!r.ok) continue; const d = await r.json(); if (d && d.named_endpoints) return { pre, info: d }; } catch (e) { }
  }
  throw new Error(S.stage && S.stage !== "RUNNING" ? "The Space is " + lc(S.stage).replace(/_/g, " ") + (S.stage === "SLEEPING" ? " — it is waking up now, try again in 1–2 minutes." : " — try again later or use another Space.") : "Couldn't read the Space’s API — it may be busy, building or not a Gradio app.");
}
const ENDPOINT_OK = (w) => /^\/?[A-Za-z0-9_]+$/.test(String(w || "").trim());
// Choose how to drive the Space: a video endpoint that takes the photo + (text or a voice clip), and — when it needs a
// voice clip — a text-to-speech endpoint in the same Space to make that clip from the script.
export function hfMap(info, want) {
  const eps = info.named_endpoints || {}, names = Object.keys(eps), comp = (p) => lc(p.component), lab = (p) => lc((p.label || "") + " " + (p.parameter_name || ""));
  const outs = (e) => (e.returns || []).map((r) => comp(r) + " " + lc(r.label)).join(" ");
  const pick = want && ENDPOINT_OK(want) ? names.filter((n) => n === want || n === "/" + String(want).replace(/^\//, "")) : [];
  let best = null, bestScore = -1;
  for (const name of pick.length ? pick : names) {
    const e = eps[name], ps = e.parameters || [];
    const img = ps.find((p) => comp(p) === "image" || /extendedimage|imageeditor/.test(comp(p))) || ps.find((p) => /image|photo|portrait|face|source|avatar|reference/.test(lab(p)) && /file|image/.test(comp(p)));
    const aud = ps.find((p) => comp(p) === "audio" || (/audio|voice|speech|wav/.test(lab(p)) && /file/.test(comp(p))));
    const tbs = ps.filter((p) => comp(p) === "textbox");
    const speech = tbs.find((p) => /speech|script|say|tts|speak|words|narrat|transcript/.test(lab(p))) || (!aud ? tbs.find((p) => /text|sentence|content|input/.test(lab(p)) && !/prompt|negative/.test(lab(p))) || tbs.filter((p) => !/negative/.test(lab(p)))[0] : null);
    const vidOut = /video/.test(outs(e)), sc = (img ? 4 : 0) + (vidOut ? 4 : 0) + (speech ? 3 : 0) + (aud ? 2 : 0) - (/preprocess|clear|session|orientation/.test(name) ? 5 : 0);
    if (img && (speech || aud) && vidOut && sc > bestScore) { best = { name, e, img, aud, speech }; bestScore = sc; }
  }
  if (!best) return null;
  const ps = best.e.parameters || [];
  const lang = ps.find((p) => /lang/.test(lab(p)));
  const prm = ps.find((p) => p !== best.speech && comp(p) === "textbox" && !/negative/.test(lab(p)));
  // a voice clip is needed and the script has nowhere else to go → find a text-to-speech endpoint in the Space
  let tts = null;
  if (best.aud && !best.speech) {
    for (const name of names) {
      if (name === best.name) continue;
      const e = eps[name], tp = e.parameters || [], tb = tp.filter((p) => comp(p) === "textbox");
      if (!tb.length || !/audio/.test(outs(e)) || tp.some((p) => /image|video/.test(comp(p)))) continue;
      const sc = (/speak|tts|voice|say|speech/.test(lc(name)) ? 3 : 0) + (tp.length <= 4 ? 1 : 0);
      if (!tts || sc > tts.sc) tts = { name, params: tp, text: tb.find((p) => /text|speech|script|say|prompt|input/.test(lab(p))) || tb[0], lang: tp.find((p) => /lang/.test(lab(p))), sc };
    }
  }
  const nm = (p) => (p ? p.label || p.parameter_name || "" : "");
  return { name: best.name, params: ps, img: best.img, aud: best.aud, txt: best.speech, lang, prm, tts,
    summary: { endpoint: best.name, image: nm(best.img), text: best.speech ? nm(best.speech) : best.aud && tts ? "voice made by " + tts.name : "", audio: best.aud ? nm(best.aud) : "", lang: nm(lang), prompt: nm(prm), needsVoice: !!(best.aud && !best.speech && !tts), ignoredEndpoint: want && !pick.length ? String(want) : "" } };
}
export function hfDescribe(info) {   // one line per endpoint, for the error message
  return Object.keys(info.named_endpoints || {}).slice(0, 8).map((n) => n + "(" + (info.named_endpoints[n].parameters || []).map((p) => (p.label || p.parameter_name || "?") + ":" + lc(p.component)).join(", ") + " → " + (info.named_endpoints[n].returns || []).map((r) => lc(r.component)).join("+") + ")").join("; ");
}
function langChoice(p, lang) {
  const en = (p.type && p.type.enum) || (String((p.python_type && p.python_type.type) || "").match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
  const want = lc(lang === "Hinglish" ? "Hindi" : lang), code = lc((AG_LANGS[lang] || "").slice(0, 2));
  return en.find((o) => lc(o).includes(want)) || en.find((o) => lc(o) === code || lc(o).startsWith(code + "-") || lc(o).startsWith(code + "_")) || null;
}
// Background job: run the Space and save the video link on the record (called by agvideo-background).
export async function runHfJob(store, env, jobId, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const f = fetchImpl, job = await store.get(`aghfjob:${String(jobId || "").replace(/[^a-z0-9]/gi, "")}`); if (!job) return;
  await store.delete(`aghfjob:${jobId}`);
  const update = async (patch) => { const c = (await store.get("config:appguide")) || { videos: [] }, v = (c.videos || []).find((x) => x.id === job.vid); if (!v) return false; Object.assign(v, patch); await store.set("config:appguide", c); return true; };
  try {
    const c = (await store.get("config:appguide")) || {}, V = vcfg(c), keys = (await store.get("config:agkey")) || {}, ph = await store.get("agphoto");
    if (!ph) throw new Error("Upload the presenter photo again.");
    await update({ stage: "Connecting to the free model…" });
    const S = await hfSpace(V.hfSpace, keys.hf, f);
    if (S.stage === "SLEEPING") { await update({ stage: "Waking up the free model (1–2 minutes)…" }); try { await f(S.host + "/", { headers: S.headers }); } catch (e) { } await new Promise((r) => setTimeout(r, 60000)); }
    let api = null; for (let i = 0; i < 4 && !api; i++) { try { api = await hfApi(S, f); } catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 25000)); } }
    const M = hfMap(api.info, V.hfApi); if (!M) throw new Error("This Space has no endpoint that makes a video from a photo plus text or voice.");
    if (M.summary.needsVoice) throw new Error("This Space needs a voice recording and has no text-to-speech step — pick another Space.");
    const base = S.host + api.pre;
    const call = async (name, data, label) => {   // one Gradio API call: start it, then read its result stream
      const ep = name.replace(/^\//, ""), rc = await f(base + "/call/" + ep, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, S.headers), body: JSON.stringify({ data }) }), dc = await rc.json().catch(() => ({}));
      if (!rc.ok || !dc.event_id) throw new Error("The Space refused the " + label + " request: " + str(dc.detail || dc.error || rc.status, 160));
      const rs = await f(base + "/call/" + ep + "/" + dc.event_id, { headers: Object.assign({ accept: "text/event-stream" }, S.headers) });
      if (!rs.ok || !rs.body) throw new Error("Lost the connection to the Space (" + rs.status + ").");
      const reader = rs.body.getReader(), dec = new TextDecoder(); let buf = "", ev = "", result, failure = null, lastStage = 0, got = false;
      const deadline = now() + 12 * 60000;
      while (!got && !failure) {
        if (now() > deadline) throw new Error("The free model took too long — try a shorter script or another time.");
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let k; while ((k = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, k).replace(/\r$/, ""); buf = buf.slice(k + 1);
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) {
            const raw = line.slice(5).trim();
            if (ev === "complete") { try { result = JSON.parse(raw); } catch (e) { result = raw; } got = true; }
            else if (ev === "error") failure = raw && raw !== "null" ? raw : "The model reported an error.";
            else if (ev === "generating" && now() - lastStage > 20000) { lastStage = now(); await update({ stage: label === "voice" ? "Making the voice…" : "The model is making the video…" }); }
          }
        }
      }
      try { reader.cancel(); } catch (e) { }
      if (failure) { let m = failure; try { const j2 = JSON.parse(failure); m = j2 && (j2.message || j2.error || j2.detail) || failure; } catch (e) { } throw new Error(/quota|exceeded|ZeroGPU|GPU task aborted/i.test(m) ? "The free daily GPU time is used up for this Hugging Face account — try tomorrow, or switch method." : "The model said: " + str(m, 200)); }
      if (!got) throw new Error("The Space closed the connection before finishing — it may be overloaded; try again.");
      return result;
    };
    const fileOf = (x) => { let r = null; (function walk(y) { if (r || !y) return; if (typeof y === "string") { if (/^\/|^https?:/.test(y) && /\.\w{2,4}$/.test(y)) r = y; return; } if (Array.isArray(y)) return y.forEach(walk); if (typeof y === "object") { if (y.path || y.url) { r = y.path || y.url; return; } Object.keys(y).forEach((k) => walk(y[k])); } })(x); return r; };
    const fill = (p, lang) => { if (p && lang) { const ch = langChoice(p, lang); if (ch) return ch; } return p.parameter_has_default ? p.parameter_default : p.example_input != null && !(typeof p.example_input === "object") ? p.example_input : null; };
    // upload the photo
    const fd = new FormData(); fd.append("files", new Blob([Buffer.from(ph.b64, "base64")], { type: ph.mime }), ph.mime === "image/png" ? "presenter.png" : "presenter.jpg");
    const ru = await f(base + "/upload", { method: "POST", headers: S.headers, body: fd }), up = await ru.json().catch(() => null);
    const path = Array.isArray(up) ? up[0] : up && up.files ? up.files[0] : null; if (!ru.ok || !path) throw new Error("The Space didn’t accept the photo (" + ru.status + ").");
    // voice clip from the script, when the video step needs one
    let voice = null;
    if (M.aud && !M.txt) {
      await update({ stage: "Making the voice…" });
      const vd = await call(M.tts.name, M.tts.params.map((p) => p === M.tts.text ? job.text : fill(p, p === M.tts.lang ? job.lang : null)), "voice");
      const vp = fileOf(vd); if (!vp) throw new Error("The Space’s voice step returned no audio.");
      voice = { path: /^https?:/.test(vp) ? undefined : vp, url: /^https?:/.test(vp) ? vp : undefined, meta: { _type: "gradio.FileData" }, orig_name: "voice.wav" };
    }
    const data = M.params.map((p) => {
      if (p === M.img) return { path, meta: { _type: "gradio.FileData" }, orig_name: "presenter.jpg" };
      if (p === M.aud && voice) return voice;
      if (p === M.txt) return job.text;
      if (p === M.prm) return "A friendly person presenting to the camera at a vivo store, talking naturally, " + V.motion + ", steady camera, realistic";
      return fill(p, p === M.lang ? job.lang : null);
    });
    await update({ stage: "Waiting in the free GPU queue…" });
    const result = await call(M.name, data, "video");
    let url = null; (function walk(x) { if (url || !x) return; if (typeof x === "string") { if (/\.(mp4|webm|mov)(\?|$)/i.test(x)) url = /^https?:/.test(x) ? x : base + "/file=" + x; return; } if (Array.isArray(x)) return x.forEach(walk); if (typeof x === "object") { const u = x.url || (x.path ? base + "/file=" + x.path : ""); if (u && /video|mp4|webm|mov/i.test((x.mime_type || "") + u + (x.orig_name || ""))) { url = u; return; } if (x.video) walk(x.video); Object.keys(x).forEach((k) => { if (k !== "video") walk(x[k]); }); } })(result);
    if (!url) throw new Error("The model finished but returned no video.");
    await update({ status: "done", hfUrl: url, stage: "", error: "" });
  } catch (e) { await update({ status: "error", error: str(e.message || e, 220), stage: "" }); }
}
// fresh status / download link for a presenter video, whichever service made it
async function freshVideo(v, keys, f) {
  if (v.provider === "hf") return v.status === "done" ? { status: "done", url: v.hfUrl, headers: keys.hf ? { authorization: "Bearer " + keys.hf } : {} } : { status: v.status, error: v.error };
  if (v.provider === "heygen") {
    if (!keys.heygen) return { status: "error", error: "The HeyGen key was removed." };
    const r = await f(`${HG}/v3/videos/${encodeURIComponent(v.hgId)}`, { headers: { "x-api-key": keys.heygen, accept: "application/json" } }), d = await r.json().catch(() => ({})), x = d.data || d;
    if (x.status === "completed" && x.video_url) return { status: "done", url: x.video_url };
    if (x.status === "failed") return { status: "error", error: str(x.failure_message || x.error || "HeyGen could not make the video", 180) };
    return { status: "making" };
  }
  if (!keys.did) return { status: "error", error: "The D-ID key was removed." };
  const r = await f(`${DID}/talks/${encodeURIComponent(v.talkId)}`, { headers: { authorization: "Basic " + keys.did, accept: "application/json" } }), d = await r.json().catch(() => ({}));
  if (d.status === "done" && d.result_url) return { status: "done", url: d.result_url };
  if (d.status === "error" || d.status === "rejected") return { status: "error", error: str((d.error && (d.error.description || d.error.kind)) || d.status, 160) };
  return { status: "making" };
}

function pubCfg(c, isAdmin, keys) {
  const p = c.presenter || {}, V = vcfg(c);
  return { kb: c.kb || "", video: isAdmin ? { provider: V.provider, show: V.show, hfSpace: V.hfSpace, hfApi: V.hfApi, motion: V.motion, expr: V.expr, keys: keys ? { did: !!keys.did, heygen: !!keys.heygen, hf: !!keys.hf } : undefined } : { provider: V.provider, show: V.show }, presenter: { name: p.name || "", voice: p.voice === "m" ? "m" : "f", hasPhoto: !!p.hasPhoto, consentBy: p.consentBy || "", consentAt: p.consentAt || 0 },
    videos: (c.videos || []).filter((v) => isAdmin || v.status === "done").map((v) => ({ id: v.id, title: v.title, tag: v.tag || "", lang: v.lang, k: v.k, scenes: v.scenes || [], status: v.status, at: v.at, by: v.by, error: v.error, stage: v.stage || "", provider: v.provider || "did" })) };
}

// GET /api/auth?agvid=<videoId> — stream the finished D-ID video from the same origin, so the page can draw it onto a
// canvas (compositing the presenter into the slideshow) without the browser tainting the canvas.
export async function serveAgVideo(id, store, env = {}, fetchImpl = fetch) {
  const vid = String(id || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  const c = (await store.get("config:appguide")) || { videos: [] }, v = (c.videos || []).find((x) => x.id === vid);
  if (!v || v.status !== "done") return new Response("Not found", { status: 404 });
  const keys = (await store.get("config:agkey")) || {};
  try {
    const fr = await freshVideo(v, keys, fetchImpl);
    if (!fr.url) return new Response("Not ready", { status: 404 });
    const up = await fetchImpl(fr.url, fr.headers ? { headers: fr.headers } : undefined);
    if (!up.ok && v.provider === "hf") return new Response("This free video has expired on Hugging Face — make it again.", { status: 410 });
    if (!up.ok || !up.body) return new Response("Unavailable", { status: 502 });
    return new Response(up.body, { status: 200, headers: { "content-type": up.headers.get("content-type") || "video/mp4", "cache-control": "private, max-age=600", "access-control-allow-origin": "*" } });
  } catch (e) { return new Response("Error", { status: 502 }); }
}

export async function appguideAction(b, ctx) {
  const { store, t, app, rec, env = {} } = ctx, isAdmin = app === "admin", f = ctx.aiFetch || fetch;
  const cfg = async () => (await store.get("config:appguide")) || { videos: [] };
  const ai = async (prompt, validate, cacheKey) => {
    const k = "agai:" + createHash("sha1").update(cacheKey || prompt).digest("hex").slice(0, 24), hit = cacheKey ? await store.get(k) : null;
    if (hit && t - hit.at < 7 * 864e5) return { ok: true, data: hit.data };
    const keys = await aiKeys(store, env); if (!keys.groq) return { ok: false, error: "AI key not set (Affordability → Data → Groq key)." };
    const r = await groqJSON(keys.groq, prompt, f, { validate });
    if (r.ok && cacheKey) await store.set(k, { at: t, data: r.data });
    return r;
  };

  const keysOf = async () => (await store.get("config:agkey")) || {};
  if (b.action === "ag-config") { const c = await cfg(), k = isAdmin ? await keysOf() : null; return json(200, Object.assign({ ok: true, hasKey: isAdmin ? !!(k.did || k.heygen || k.hf) : undefined }, pubCfg(c, isAdmin, k))); }

  if (b.action === "ag-ask") {   // voice / text assistant, grounded on the app guide
    const q = str(b.q, 500), lang = langOf(b.lang); if (q.length < 2) return json(400, { ok: false, error: "Ask a question." });
    const c = await cfg(), guide = String(b.guide || "").slice(0, 14000);
    const hist = (Array.isArray(b.history) ? b.history : []).slice(-6).map((h) => (h.me ? "Q: " : "A: ") + str(h.text, 400)).join("\n");
    const prompt = `You are "vivo Saathi", a friendly assistant that teaches retailers and vivo field teams how to use the vivo Retailer app (vivo Retailer Workplace).
Answer in ${lang}${lang === "Hinglish" ? " (Hindi in Latin letters mixed with English)" : lang === "English" ? "" : " using its own script"}; keep app button and screen names in English as they appear in the app.
Use ONLY the APP GUIDE and HO NOTES below. If the answer is not there, say so politely and suggest the Retailer Support Desk. Never invent screens or numbers.
The answer will be read aloud: short, plain sentences, at most 90 words; put the taps in "steps".
Return JSON only: {"answer":"","steps":["",""],"feature":"key of the most relevant feature or empty","followups":["short follow-up question",""]}
APP GUIDE:
${guide}
HO NOTES:
${str(c.kb, 3000)}
${hist ? "CONVERSATION SO FAR:\n" + hist + "\n" : ""}QUESTION: ${q}`;
    const r = await ai(prompt, (d) => d && d.answer);
    if (!r.ok) return json(200, { ok: false, error: r.error });
    try { await ctx.logEvent(store, t, app, rec, "appguide-ask", { device: lang, ver: "" }); } catch (e) { }
    const d = r.data; return json(200, { ok: true, answer: str(d.answer, 1200), steps: (Array.isArray(d.steps) ? d.steps : []).slice(0, 8).map((x) => str(x, 240)).filter(Boolean), feature: str(d.feature, 30), followups: (Array.isArray(d.followups) ? d.followups : []).slice(0, 3).map((x) => str(x, 120)).filter(Boolean) });
  }

  if (b.action === "ag-manual") {   // translate / polish the feature guide into a manual in the chosen language
    const lang = langOf(b.lang), feats = String(b.feats || "").slice(0, 16000); if (feats.length < 40) return json(400, { ok: false, error: "No features to write about." });
    const prompt = `Write a user manual for the vivo Retailer app for retailers, in ${lang}${lang === "English" ? "" : " (its own script; keep app button and screen names in English)"}.
Use ONLY the FEATURES data. Keep every step; make the wording simple and friendly. Do not invent features or screens.
Return JSON only: {"title":"","intro":"2-3 sentences","sections":[{"k":"feature key","name":"feature name in ${lang}","purpose":"one sentence","steps":[""],"tips":[""],"benefits":[""]}],"faq":[{"q":"","a":""}],"help":"one sentence on where to get help"}
FEATURES:
${feats}`;
    const r = await ai(prompt, (d) => d && Array.isArray(d.sections) && d.sections.length, "man|" + lang + "|" + feats);
    if (!r.ok) return json(200, { ok: false, error: r.error });
    return json(200, { ok: true, manual: r.data });
  }

  if (b.action === "ag-script") {   // narration for one feature (or an overview), for the presenter or the slideshow
    const lang = langOf(b.lang), feat = String(b.feat || "").slice(0, 5000); if (feat.length < 20) return json(400, { ok: false, error: "Choose a feature." });
    const prompt = `Write a short video narration in ${lang}${lang === "English" ? "" : " (its own script; keep app button and screen names in English)"} where a friendly vivo presenter at a vivo store explains this vivo Retailer app feature to retailers.
Use ONLY the FEATURE data. 70-110 words in total, warm and clear, spoken style. Start with a one-line greeting, then how to open it and use it, then one benefit, then a closing line.
Also split it into 3-6 scenes that match the steps, each with an on-screen caption of max 8 words.
Return JSON only: {"title":"","script":"the whole narration","scenes":[{"say":"narration for this scene","caption":"","shot":"screenshot id from the FEATURE data or empty"}]}
FEATURE:
${feat}`;
    const r = await ai(prompt, (d) => d && d.script && Array.isArray(d.scenes), "scr|" + lang + "|" + feat);
    if (!r.ok) return json(200, { ok: false, error: r.error });
    const d = r.data; return json(200, { ok: true, title: str(d.title, 100), script: str(d.script, 1500), scenes: d.scenes.slice(0, 8).map((s) => ({ say: str(s && s.say, 500), caption: str(s && s.caption, 80), shot: str(s && s.shot, 40) })) });
  }

  if (b.action === "ag-video-url") {   // a fresh link for a finished presenter video
    const c = await cfg(), v = (c.videos || []).find((x) => x.id === str(b.id, 30)); if (!v || v.status !== "done") return json(404, { ok: false, error: "Video not ready." });
    try { const fr = await freshVideo(v, await keysOf(), f); if (!fr.url) return json(200, { ok: false, error: fr.error || "The video is no longer available at the video service." }); return json(200, { ok: true, url: fr.url, title: v.title }); }
    catch (e) { return json(502, { ok: false, error: "Couldn't reach the video service." }); }
  }

  if (!isAdmin) return json(403, { ok: false, error: "Only HO admins can change the app guide." });

  if (b.action === "ag-save") {
    const c = await cfg(); c.kb = String(b.kb == null ? c.kb || "" : b.kb).slice(0, 6000);
    if (b.presenter) { c.presenter = Object.assign(c.presenter || {}, { name: str(b.presenter.name, 40), voice: b.presenter.voice === "m" ? "m" : "f" }); }
    if (b.video && typeof b.video === "object") { const V = vcfg(c), x = b.video; c.video = Object.assign({}, c.video || {}, { provider: PROVIDERS.includes(x.provider) ? x.provider : V.provider, show: x.show ? { slide: x.show.slide !== false, ai: x.show.ai !== false, tp: x.show.tp !== false, clip: x.show.clip !== false } : V.show, hfSpace: x.hfSpace != null ? str(x.hfSpace, 120).replace(/^https?:\/\/(huggingface\.co\/spaces\/|([\w-]+)\.hf\.space).*$/, (m, a1, sub) => sub ? sub : m).replace(/^https?:\/\/huggingface\.co\/spaces\//, "").replace(/[?#].*$/, "").replace(/\/+$/, "") : V.hfSpace, hfApi: x.hfApi != null ? (ENDPOINT_OK(x.hfApi) ? str(x.hfApi, 60) : "") : V.hfApi, motion: x.motion != null ? str(x.motion, 200) : V.motion, expr: ["low", "medium", "high"].includes(x.expr) ? x.expr : V.expr }); }
    c.by = rec.fullName || rec.username; c.at = t; await store.set("config:appguide", c); return json(200, Object.assign({ ok: true }, pubCfg(c, true, await keysOf())));
  }
  if (b.action === "ag-key") {   // write-only service keys: did / heygen / hf
    const k = await keysOf(), which = ["did", "heygen", "hf"].includes(b.which) ? b.which : "did", val = b.which ? b.value : b.did;
    if (val) k[which] = str(val, 400); else delete k[which];
    await store.set("config:agkey", k); return json(200, { ok: true, hasKey: !!k[which], keys: { did: !!k.did, heygen: !!k.heygen, hf: !!k.hf } });
  }
  if (b.action === "ag-hf-check") {   // is the free Space usable? (runs on the server, so office networks / browsers don't matter)
    const c = await cfg(), V = vcfg(c), k = await keysOf();
    if (!/^[\w.-]+\/[\w.-]+$/.test(V.hfSpace)) return json(200, { ok: false, error: V.hfSpace ? "“" + V.hfSpace + "” isn’t a Space name. Enter it as owner/space-name — e.g. alexnasa/OmniAvatar." : "Enter the Hugging Face Space first." });
    try {
      const S = await hfSpace(V.hfSpace, k.hf, f);
      if (S.stage === "SLEEPING" || S.stage === "PAUSED") { if (S.stage === "SLEEPING") { try { await f(S.host + "/", { headers: S.headers }); } catch (e) { } } return json(200, { ok: false, error: S.stage === "SLEEPING" ? "The Space is asleep — I’ve woken it; press Check again in 1–2 minutes." : "This Space is paused by its owner — pick another Space." }); }
      if (/ERROR/.test(S.stage)) return json(200, { ok: false, error: "This Space is broken right now (" + lc(S.stage).replace(/_/g, " ") + ") — pick another Space." });
      const api = await hfApi(S, f), M = hfMap(api.info, V.hfApi);
      if (!M) return json(200, { ok: false, error: "This Space has no step that makes a video from a photo plus text or voice. What it offers: " + str(hfDescribe(api.info), 700) });
      if (M.summary.needsVoice) return json(200, { ok: false, error: "This Space makes the video from a voice recording and has no text-to-speech step, so it can’t speak your script. Pick another Space. (" + str(hfDescribe(api.info), 500) + ")" });
      return json(200, { ok: true, space: V.hfSpace, stage: S.stage || "RUNNING", token: !!k.hf, map: M.summary });
    } catch (e) { return json(200, { ok: false, error: str(e.message || e, 240) }); }
  }
  if (b.action === "ag-photo") {   // presenter photo — only with the person's consent
    const c = await cfg(); c.presenter = c.presenter || {};
    if (b.remove) { await store.delete("agphoto"); Object.assign(c.presenter, { hasPhoto: false, didImg: "", hgAvatar: "", consentBy: "", consentAt: 0 }); await store.set("config:appguide", c); return json(200, Object.assign({ ok: true }, pubCfg(c, true, await keysOf()))); }
    if (b.consent !== true) return json(400, { ok: false, error: "Confirm that the person in the photo has agreed to an AI video of them." });
    const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || "")); if (!m) return json(400, { ok: false, error: "Choose a JPG or PNG photo." });
    if (m[2].length > 2200000) return json(413, { ok: false, error: "The photo is too large (max about 1.5 MB)." });
    await store.set("agphoto", { mime: m[1], b64: m[2], at: t, by: rec.fullName || rec.username });
    Object.assign(c.presenter, { hasPhoto: true, didImg: "", hgAvatar: "", consentBy: rec.fullName || rec.username, consentAt: t, name: str(b.name, 40) || c.presenter.name || "" });
    await store.set("config:appguide", c); return json(200, Object.assign({ ok: true }, pubCfg(c, true, await keysOf())));
  }
  if (b.action === "ag-photo-get") { const p = await store.get("agphoto"); return json(200, { ok: true, data: p ? `data:${p.mime};base64,${p.b64}` : "" }); }

  if (b.action === "ag-avatar") {   // start a presenter video at the paid service HO selected (D-ID or HeyGen)
    const c = await cfg(), P = c.presenter || {}, V = vcfg(c), keys = await keysOf(), prov = b.provider === "heygen" || b.provider === "did" ? b.provider : V.provider;
    if (prov === "hf" && !V.hfSpace) return json(200, { ok: false, error: "Set the free Hugging Face Space in Presenter settings first." });
    if (prov !== "hf" && !keys[prov]) return json(200, { ok: false, error: "Add the " + (prov === "heygen" ? "HeyGen" : "D-ID") + " API key first (Presenter settings)." });
    if (!P.hasPhoto) return json(200, { ok: false, error: "Upload the presenter photo first." });
    const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 1800); if (text.length < 10) return json(400, { ok: false, error: "Write the script first." });
    const lang = langOf(b.lang), loc = AG_LANGS[lang];
    const scenes = (Array.isArray(b.scenes) ? b.scenes : []).slice(0, 10).map((s) => ({ say: str(s && s.say, 500), caption: str(s && s.caption, 80), shot: str(s && s.shot, 40) }));
    const v = { id: t.toString(36) + randomBytes(3).toString("hex"), provider: prov, title: str(b.title, 100) || "App guide video", tag: str(b.tag, 120), lang, k: str(b.k, 30), scenes, status: "making", at: t, by: rec.fullName || rec.username };
    if (prov === "hf") {   // free model: runs in a background job (it can take several minutes)
      const jid = t.toString(36) + randomBytes(5).toString("hex");
      v.stage = "Starting…"; c.videos = [v].concat(c.videos || []).slice(0, 60); await store.set("config:appguide", c);
      await store.set(`aghfjob:${jid}`, { vid: v.id, text, lang, at: t });
      try {
        const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 5000);
        try { const r = await (ctx.jobFetch || fetch)((env.SITE_URL || "") + "/.netlify/functions/agvideo-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: jid }), signal: ac.signal }); if (r && r.status >= 400) throw new Error("status " + r.status); }
        catch (e) { if (!(e && e.name === "AbortError")) throw e; } finally { clearTimeout(tm); }
      } catch (e) { v.status = "error"; v.error = "Couldn't start the free model job (" + e.message + ")."; await store.set("config:appguide", c); return json(200, { ok: false, error: v.error }); }
      return json(200, { ok: true, video: { id: v.id, title: v.title, tag: v.tag, lang, k: v.k, scenes, status: v.status, stage: v.stage, at: t, by: v.by, provider: prov } });
    }
    try {
      const ph = (!P.didImg && prov === "did") || (!P.hgAvatar && prov === "heygen") ? await store.get("agphoto") : null;
      if (prov === "heygen") {
        const H = { "x-api-key": keys.heygen, accept: "application/json" };
        if (!P.hgAvatar) {   // the photo becomes a HeyGen photo avatar once
          if (!ph) return json(200, { ok: false, error: "Upload the presenter photo again." });
          const fd = new FormData(); fd.append("file", new Blob([Buffer.from(ph.b64, "base64")], { type: ph.mime }), ph.mime === "image/png" ? "presenter.png" : "presenter.jpg");
          const ra = await f(`${HG}/v3/assets`, { method: "POST", headers: H, body: fd }), da = await ra.json().catch(() => ({})), aid = (da.data && (da.data.asset_id || da.data.id)) || da.asset_id || da.id;
          if (!ra.ok || !aid) return json(200, { ok: false, error: "HeyGen refused the photo: " + errMsg(da, ra) });
          const rb = await f(`${HG}/v3/avatars`, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, H), body: JSON.stringify({ type: "photo", name: "vivo presenter " + (P.name || ""), file: { type: "asset_id", asset_id: aid } }) }), db = await rb.json().catch(() => ({}));
          const avid = db.data && ((db.data.avatar_item && db.data.avatar_item.id) || db.data.avatar_id || db.data.id);
          if (!rb.ok || !avid) return json(200, { ok: false, error: "HeyGen couldn't make the photo avatar: " + errMsg(db, rb) });
          P.hgAvatar = avid; c.presenter = P;
        }
        const LNG = lang === "Hinglish" ? "Hindi" : lang, g = P.voice === "m" ? "male" : "female", vk = LNG + "|" + g;
        c.video = c.video || {}; c.video.hgVoices = c.video.hgVoices || {};
        let voice = c.video.hgVoices[vk];
        if (!voice) {
          for (const L of [LNG, "English"]) {
            const rv = await f(`${HG}/v3/voices?language=${encodeURIComponent(L)}&gender=${g}&limit=20`, { headers: H }), dv = await rv.json().catch(() => ({}));
            const list = Array.isArray(dv.data) ? dv.data : []; const pick = list.find((x) => /india/i.test(x.name + " " + (x.language || ""))) || list[0];
            if (pick && pick.voice_id) { voice = pick.voice_id; break; }
          }
          if (!voice) return json(200, { ok: false, error: "HeyGen has no " + LNG + " voice available for this account." });
          c.video.hgVoices[vk] = voice;
        }
        const body = { type: "avatar", avatar_id: P.hgAvatar, script: text, voice_id: voice, title: v.title, resolution: "720p", aspect_ratio: "9:16", motion_prompt: V.motion, expressiveness: V.expr };
        const r = await f(`${HG}/v3/videos`, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, H), body: JSON.stringify(body) }), d = await r.json().catch(() => ({}));
        const vid = (d.data && d.data.video_id) || d.video_id;
        if (!r.ok || !vid) return json(200, { ok: false, error: "HeyGen said no: " + errMsg(d, r) });
        v.hgId = str(vid, 80);
      } else {
        const voice = (VOICES[loc] || VOICES["en-IN"])[P.voice === "m" ? 1 : 0], H = { authorization: "Basic " + keys.did, accept: "application/json" };
        if (!P.didImg) {   // upload the photo privately to D-ID once
          if (!ph) return json(200, { ok: false, error: "Upload the presenter photo again." });
          const fd = new FormData(); fd.append("image", new Blob([Buffer.from(ph.b64, "base64")], { type: ph.mime }), ph.mime === "image/png" ? "presenter.png" : "presenter.jpg");
          const r = await f(`${DID}/images`, { method: "POST", headers: H, body: fd }), d = await r.json().catch(() => ({}));
          if (!r.ok || !d.url) return json(200, { ok: false, error: "The video service refused the photo" + (d.description || d.message ? ": " + str(d.description || d.message, 140) : " (" + r.status + ")") });
          P.didImg = d.url; c.presenter = P;
        }
        const body = { source_url: P.didImg, script: { type: "text", input: text, provider: { type: "microsoft", voice_id: voice } }, config: { stitch: true, fluent: true } };
        const r = await f(`${DID}/talks`, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, H), body: JSON.stringify(body) }), d = await r.json().catch(() => ({}));
        if (!r.ok || !d.id) return json(200, { ok: false, error: "The video service said no" + (d.description || d.message ? ": " + str(d.description || d.message, 160) : " (" + r.status + ")") });
        v.talkId = str(d.id, 80);
      }
      c.videos = [v].concat(c.videos || []).slice(0, 60); await store.set("config:appguide", c);
      return json(200, { ok: true, video: { id: v.id, title: v.title, tag: v.tag, lang, k: v.k, scenes, status: v.status, at: t, by: v.by, provider: prov } });
    } catch (e) { return json(502, { ok: false, error: "Couldn't reach the video service: " + String(e.message || e).slice(0, 100) }); }
  }
  if (b.action === "ag-avatar-status") {
    const c = await cfg(), v = (c.videos || []).find((x) => x.id === str(b.id, 30));
    if (!v) return json(404, { ok: false, error: "Video not found." });
    if (v.status !== "making" || v.provider === "hf") return json(200, { ok: true, status: v.status, error: v.error, stage: v.stage || "" });
    try {
      const fr = await freshVideo(v, await keysOf(), f);
      if (fr.status === "making") return json(200, { ok: true, status: "making" });
      v.status = fr.status; v.error = fr.error; await store.set("config:appguide", c);
      return json(200, { ok: true, status: fr.status, url: fr.url, error: fr.error });
    } catch (e) { return json(200, { ok: true, status: "making" }); }
  }
  if (b.action === "ag-video-delete") { const c = await cfg(); c.videos = (c.videos || []).filter((x) => x.id !== str(b.id, 30)); await store.set("config:appguide", c); return json(200, { ok: true }); }
  return json(400, { ok: false, error: "Unknown action." });
}
