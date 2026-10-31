// App guide assistant: answers questions about the vivo Retailer app (English, Hindi, regional languages), writes
// manuals and narration scripts from the dashboard's own app-feature pages, and — when HO adds a D-ID API key and a
// presenter photo with that person's consent — makes "AI presenter" videos that speak the script.
// Storage:  config:appguide { kb, presenter:{ name, voice, hasPhoto, consentBy, consentAt, didImg }, videos:[…] }
//           agphoto { mime, b64, at, by }  (private: never served publicly; sent only to D-ID when a video is made)
//           config:agkey { did }  (write-only)      agai:<hash> { at, data }  (AI cache)
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { createHash, randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const AG_LANGS = { English: "en-IN", Hindi: "hi-IN", Hinglish: "en-IN", Tamil: "ta-IN", Telugu: "te-IN", Kannada: "kn-IN", Malayalam: "ml-IN", Marathi: "mr-IN", Bengali: "bn-IN", Gujarati: "gu-IN", Punjabi: "pa-IN", Odia: "or-IN" };
const VOICES = { "en-IN": ["en-IN-NeerjaNeural", "en-IN-PrabhatNeural"], "hi-IN": ["hi-IN-SwaraNeural", "hi-IN-MadhurNeural"], "ta-IN": ["ta-IN-PallaviNeural", "ta-IN-ValluvarNeural"], "te-IN": ["te-IN-ShrutiNeural", "te-IN-MohanNeural"], "kn-IN": ["kn-IN-SapnaNeural", "kn-IN-GaganNeural"], "ml-IN": ["ml-IN-SobhanaNeural", "ml-IN-MidhunNeural"], "mr-IN": ["mr-IN-AarohiNeural", "mr-IN-ManoharNeural"], "bn-IN": ["bn-IN-TanishaaNeural", "bn-IN-BashkarNeural"], "gu-IN": ["gu-IN-DhwaniNeural", "gu-IN-NiranjanNeural"], "pa-IN": ["pa-IN-OjasNeural", "pa-IN-OjasNeural"], "or-IN": ["or-IN-SubhasiniNeural", "or-IN-SukantNeural"] };
const langOf = (l) => (AG_LANGS[l] ? l : "English");
const DID = "https://api.d-id.com";

function pubCfg(c, isAdmin) {
  const p = c.presenter || {};
  return { kb: c.kb || "", presenter: { name: p.name || "", voice: p.voice === "m" ? "m" : "f", hasPhoto: !!p.hasPhoto, consentBy: p.consentBy || "", consentAt: p.consentAt || 0 },
    videos: (c.videos || []).filter((v) => isAdmin || v.status === "done").map((v) => ({ id: v.id, title: v.title, lang: v.lang, k: v.k, status: v.status, at: v.at, by: v.by, error: v.error })) };
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

  if (b.action === "ag-config") { const c = await cfg(); return json(200, Object.assign({ ok: true, hasKey: isAdmin ? !!((await store.get("config:agkey")) || {}).did : undefined }, pubCfg(c, isAdmin))); }

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
    const key = ((await store.get("config:agkey")) || {}).did; if (!key) return json(200, { ok: false, error: "The video service key was removed." });
    try { const r = await f(`${DID}/talks/${encodeURIComponent(v.talkId)}`, { headers: { authorization: "Basic " + key, accept: "application/json" } }); const d = await r.json().catch(() => ({})); if (!r.ok || !d.result_url) return json(200, { ok: false, error: "The video is no longer available at the video service." }); return json(200, { ok: true, url: d.result_url, title: v.title }); }
    catch (e) { return json(502, { ok: false, error: "Couldn't reach the video service." }); }
  }

  if (!isAdmin) return json(403, { ok: false, error: "Only HO admins can change the app guide." });

  if (b.action === "ag-save") {
    const c = await cfg(); c.kb = String(b.kb == null ? c.kb || "" : b.kb).slice(0, 6000);
    if (b.presenter) { c.presenter = Object.assign(c.presenter || {}, { name: str(b.presenter.name, 40), voice: b.presenter.voice === "m" ? "m" : "f" }); }
    c.by = rec.fullName || rec.username; c.at = t; await store.set("config:appguide", c); return json(200, Object.assign({ ok: true }, pubCfg(c, true)));
  }
  if (b.action === "ag-key") { const k = (await store.get("config:agkey")) || {}; if (b.did) k.did = str(b.did, 300); else delete k.did; await store.set("config:agkey", k); return json(200, { ok: true, hasKey: !!k.did }); }
  if (b.action === "ag-photo") {   // presenter photo — only with the person's consent
    const c = await cfg(); c.presenter = c.presenter || {};
    if (b.remove) { await store.delete("agphoto"); Object.assign(c.presenter, { hasPhoto: false, didImg: "", consentBy: "", consentAt: 0 }); await store.set("config:appguide", c); return json(200, Object.assign({ ok: true }, pubCfg(c, true))); }
    if (b.consent !== true) return json(400, { ok: false, error: "Confirm that the person in the photo has agreed to an AI video of them." });
    const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || "")); if (!m) return json(400, { ok: false, error: "Choose a JPG or PNG photo." });
    if (m[2].length > 2200000) return json(413, { ok: false, error: "The photo is too large (max about 1.5 MB)." });
    await store.set("agphoto", { mime: m[1], b64: m[2], at: t, by: rec.fullName || rec.username });
    Object.assign(c.presenter, { hasPhoto: true, didImg: "", consentBy: rec.fullName || rec.username, consentAt: t, name: str(b.name, 40) || c.presenter.name || "" });
    await store.set("config:appguide", c); return json(200, Object.assign({ ok: true }, pubCfg(c, true)));
  }
  if (b.action === "ag-photo-get") { const p = await store.get("agphoto"); return json(200, { ok: true, data: p ? `data:${p.mime};base64,${p.b64}` : "" }); }

  if (b.action === "ag-avatar") {   // start a presenter video at D-ID
    const c = await cfg(), P = c.presenter || {}, key = ((await store.get("config:agkey")) || {}).did;
    if (!key) return json(200, { ok: false, error: "Add the D-ID API key first (Presenter settings)." });
    if (!P.hasPhoto) return json(200, { ok: false, error: "Upload the presenter photo first." });
    const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 1800); if (text.length < 10) return json(400, { ok: false, error: "Write the script first." });
    const lang = langOf(b.lang), loc = AG_LANGS[lang], voice = (VOICES[loc] || VOICES["en-IN"])[P.voice === "m" ? 1 : 0];
    const H = { authorization: "Basic " + key, accept: "application/json" };
    try {
      if (!P.didImg) {   // upload the photo privately to D-ID once
        const ph = await store.get("agphoto"); if (!ph) return json(200, { ok: false, error: "Upload the presenter photo again." });
        const fd = new FormData(); fd.append("image", new Blob([Buffer.from(ph.b64, "base64")], { type: ph.mime }), ph.mime === "image/png" ? "presenter.png" : "presenter.jpg");
        const r = await f(`${DID}/images`, { method: "POST", headers: H, body: fd }), d = await r.json().catch(() => ({}));
        if (!r.ok || !d.url) return json(200, { ok: false, error: "The video service refused the photo" + (d.description || d.message ? ": " + str(d.description || d.message, 140) : " (" + r.status + ")") });
        P.didImg = d.url; c.presenter = P;
      }
      const body = { source_url: P.didImg, script: { type: "text", input: text, provider: { type: "microsoft", voice_id: voice } }, config: { stitch: true, fluent: true } };
      const r = await f(`${DID}/talks`, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, H), body: JSON.stringify(body) }), d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) return json(200, { ok: false, error: "The video service said no" + (d.description || d.message ? ": " + str(d.description || d.message, 160) : " (" + r.status + ")") });
      const v = { id: t.toString(36) + randomBytes(3).toString("hex"), talkId: str(d.id, 80), title: str(b.title, 100) || "App guide video", lang, k: str(b.k, 30), status: "making", at: t, by: rec.fullName || rec.username };
      c.videos = [v].concat(c.videos || []).slice(0, 60); await store.set("config:appguide", c);
      return json(200, { ok: true, video: { id: v.id, title: v.title, lang, k: v.k, status: v.status, at: t, by: v.by } });
    } catch (e) { return json(502, { ok: false, error: "Couldn't reach the video service: " + String(e.message || e).slice(0, 100) }); }
  }
  if (b.action === "ag-avatar-status") {
    const c = await cfg(), v = (c.videos || []).find((x) => x.id === str(b.id, 30)), key = ((await store.get("config:agkey")) || {}).did;
    if (!v) return json(404, { ok: false, error: "Video not found." });
    if (v.status !== "making" || !key) return json(200, { ok: true, status: v.status, error: v.error });
    try {
      const r = await f(`${DID}/talks/${encodeURIComponent(v.talkId)}`, { headers: { authorization: "Basic " + key, accept: "application/json" } }), d = await r.json().catch(() => ({}));
      if (d.status === "done" && d.result_url) { v.status = "done"; await store.set("config:appguide", c); return json(200, { ok: true, status: "done", url: d.result_url }); }
      if (d.status === "error" || d.status === "rejected") { v.status = "error"; v.error = str((d.error && (d.error.description || d.error.kind)) || d.status, 160); await store.set("config:appguide", c); return json(200, { ok: true, status: "error", error: v.error }); }
      return json(200, { ok: true, status: "making" });
    } catch (e) { return json(200, { ok: true, status: "making" }); }
  }
  if (b.action === "ag-video-delete") { const c = await cfg(); c.videos = (c.videos || []).filter((x) => x.id !== str(b.id, 30)); await store.set("config:appguide", c); return json(200, { ok: true }); }
  return json(400, { ok: false, error: "Unknown action." });
}
