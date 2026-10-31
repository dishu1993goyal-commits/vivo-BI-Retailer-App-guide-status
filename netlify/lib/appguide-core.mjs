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
// fresh status / download link for a presenter video, whichever service made it
async function freshVideo(v, keys, f) {
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
    videos: (c.videos || []).filter((v) => isAdmin || v.status === "done").map((v) => ({ id: v.id, title: v.title, tag: v.tag || "", lang: v.lang, k: v.k, scenes: v.scenes || [], status: v.status, at: v.at, by: v.by, error: v.error, provider: v.provider || "did" })) };
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
    const up = await fetchImpl(fr.url);
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
    if (b.video && typeof b.video === "object") { const V = vcfg(c), x = b.video; c.video = Object.assign({}, c.video || {}, { provider: PROVIDERS.includes(x.provider) ? x.provider : V.provider, show: x.show ? { slide: x.show.slide !== false, ai: x.show.ai !== false, tp: x.show.tp !== false, clip: x.show.clip !== false } : V.show, hfSpace: x.hfSpace != null ? str(x.hfSpace, 120).replace(/^https?:\/\/huggingface\.co\/spaces\//, "") : V.hfSpace, hfApi: x.hfApi != null ? str(x.hfApi, 60) : V.hfApi, motion: x.motion != null ? str(x.motion, 200) : V.motion, expr: ["low", "medium", "high"].includes(x.expr) ? x.expr : V.expr }); }
    c.by = rec.fullName || rec.username; c.at = t; await store.set("config:appguide", c); return json(200, Object.assign({ ok: true }, pubCfg(c, true, await keysOf())));
  }
  if (b.action === "ag-key") {   // write-only service keys: did / heygen / hf
    const k = await keysOf(), which = ["did", "heygen", "hf"].includes(b.which) ? b.which : "did", val = b.which ? b.value : b.did;
    if (val) k[which] = str(val, 400); else delete k[which];
    await store.set("config:agkey", k); return json(200, { ok: true, hasKey: !!k[which], keys: { did: !!k.did, heygen: !!k.heygen, hf: !!k.hf } });
  }
  if (b.action === "ag-hf-cred") {   // free Hugging Face presenter runs from the admin's own device
    const c = await cfg(), V = vcfg(c), k = await keysOf();
    if (!V.hfSpace) return json(200, { ok: false, error: "Set the Hugging Face Space in Presenter settings first." });
    return json(200, { ok: true, token: k.hf || "", space: V.hfSpace, api: V.hfApi });
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
    if (prov === "hf") return json(200, { ok: false, error: "The free Hugging Face presenter runs on this device — use the 🤗 button." });
    if (!keys[prov]) return json(200, { ok: false, error: "Add the " + (prov === "heygen" ? "HeyGen" : "D-ID") + " API key first (Presenter settings)." });
    if (!P.hasPhoto) return json(200, { ok: false, error: "Upload the presenter photo first." });
    const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 1800); if (text.length < 10) return json(400, { ok: false, error: "Write the script first." });
    const lang = langOf(b.lang), loc = AG_LANGS[lang];
    const scenes = (Array.isArray(b.scenes) ? b.scenes : []).slice(0, 10).map((s) => ({ say: str(s && s.say, 500), caption: str(s && s.caption, 80), shot: str(s && s.shot, 40) }));
    const v = { id: t.toString(36) + randomBytes(3).toString("hex"), provider: prov, title: str(b.title, 100) || "App guide video", tag: str(b.tag, 120), lang, k: str(b.k, 30), scenes, status: "making", at: t, by: rec.fullName || rec.username };
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
    if (v.status !== "making") return json(200, { ok: true, status: v.status, error: v.error });
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
