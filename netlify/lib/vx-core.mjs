// 🎬 Long AI work on imported screen recordings, run as background jobs (no 26-second limit, the page polls):
//   ux        key frames → AI reads each one → UI/UX studio rebuilds the screens + step-by-step flow
//   man       key frames → AI reads each one → Tool manuals step script
//   explain   key frames → AI reads each one with the spots to point at → presenter script (Video explainer)
//   translate an explainer script → another language
// Saved Video explainer projects: vx:p:<app>:<user key>:<id>
//   vxjob:<id>  { kind, req, app, key, rec:{username, fullName}, at, st: queued|running|done, p, msg, res }   vxjobf:<id> [frames] (deleted when done)
import { randomBytes } from "node:crypto";
import { seeFrames, uxAction } from "./ux-core.mjs";
import { manAction } from "./man-core.mjs";

const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const day = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
export const VX_LANGS = { en: "English", hi: "Hindi (Devanagari script)", zh: "Simplified Chinese", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi", gu: "Gujarati", kn: "Kannada", ml: "Malayalam", pa: "Punjabi (Gurmukhi)", or: "Odia", as: "Assamese", ur: "Urdu" };
const IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function parse(t) { const s = String(t || "").replace(/^```(json)?/i, "").replace(/```\s*$/, ""); try { return JSON.parse(s); } catch (e) { } const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { } } return null; }

export async function vxAction(b, ctx) {
  const { store, app, rec, key } = ctx, a = b.action, owner = app + ":" + key;
  if (a === "vx-job") {
    const kind = ["ux", "man", "explain", "translate"].includes(b.kind) ? b.kind : "";
    if (!kind) return J(400, { ok: false, error: "Unknown job" });
    if (kind === "man" && app !== "admin") return J(403, { ok: false, error: "Tool manuals are for HO admins." });
    const dk = "vx:use:" + day() + ":" + owner, n = ((await store.get(dk)) || 0) + 1;
    if (n > (app === "admin" ? 80 : 30)) return J(200, { ok: false, error: "Daily limit for video AI jobs reached — try again tomorrow." });
    await store.set(dk, n);
    const frames = (Array.isArray(b.frames) ? b.frames : []).slice(0, 30).filter((f) => f && IMG.test(String(f.src || "")) && String(f.src).length < 900000).map((f) => ({ t: Math.max(0, +f.t || 0), src: String(f.src) }));
    if (kind !== "translate" && !frames.length) return J(400, { ok: false, error: "No key frames were sent — choose the video again." });
    const req = Object.assign({}, b); delete req.frames; delete req.token; delete req.username; delete req.app; delete req.action;
    if (JSON.stringify(req).length > 2500000) return J(413, { ok: false, error: "Too much data — remove some frames." });
    const id = randomBytes(8).toString("hex");
    if (frames.length) await store.set("vxjobf:" + id, frames);
    await store.set("vxjob:" + id, { kind, req, app, key, rec: { username: rec.username || "", fullName: rec.fullName || "" }, at: Date.now(), st: "queued", p: 0, msg: "Waiting to start…" });
    if (ctx.jobFetch && ctx.siteUrl) { try { await ctx.jobFetch(ctx.siteUrl + "/.netlify/functions/vxjob-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: id }) }); } catch (e) { } }
    else runVxJob(store, id, { askAI: ctx.askAI, aiFetch: ctx.aiFetch, env: ctx.env });   // tests / local
    return J(200, { ok: true, job: id });
  }
  if (a === "vx-job-get") {
    const id = String(b.job || "").replace(/[^a-f0-9]/g, ""), j = await store.get("vxjob:" + id);
    if (!j || j.app + ":" + j.key !== owner) return J(200, { ok: false, error: "Job not found" });
    // a job that never started (background start failed) or died: say so instead of waiting for ever
    if (j.st !== "done" && Date.now() - (j.beat || j.at) > (j.st === "queued" ? 120000 : 900000)) return J(200, { ok: true, st: "done", res: { ok: false, error: "The AI job stopped — please try again." } });
    return J(200, { ok: true, st: j.st, p: j.p || 0, msg: j.msg || "", res: j.st === "done" ? j.res : null });
  }
  // ---- saved Video explainer projects (script per language + small thumbnails; the video itself stays on the device) ----
  const pk = (id) => "vx:p:" + owner + ":" + str(id, 24).replace(/[^\w-]/g, "");
  if (a === "vx-save") {
    const id = str(b.id, 24).replace(/[^\w-]/g, "") || Date.now().toString(36) + randomBytes(2).toString("hex"), old = await store.get(pk(id));
    const x = { id, name: str(b.name, 100), title: str(b.title, 120), dur: Math.max(0, +b.dur || 0), w: Math.round(+b.w || 0), h: Math.round(+b.h || 0), presenter: str(b.presenter, 12), opts: b.opts && typeof b.opts === "object" ? b.opts : {},
      frames: (Array.isArray(b.frames) ? b.frames : []).slice(0, 30).map((f) => ({ t: Math.max(0, +f.t || 0), thumb: IMG.test(String(f.thumb || "")) && String(f.thumb).length < 60000 ? String(f.thumb) : "" })),
      scripts: cleanScripts(b.scripts), at: old ? old.at : Date.now(), upd: Date.now() };
    if (JSON.stringify(x).length > 1800000) return J(413, { ok: false, error: "Too big to save — remove some frames." });
    await store.set(pk(id), x); return J(200, { ok: true, id });
  }
  if (a === "vx-list") { const L = await store.list("vx:p:" + owner + ":"), R = []; for (const k of L.slice(0, 100)) { const x = await store.get(k); if (x) R.push({ id: x.id, name: x.name, title: x.title, dur: x.dur, langs: Object.keys(x.scripts || {}), upd: x.upd, thumb: (x.frames[0] || {}).thumb || "" }); } return J(200, { ok: true, rows: R.sort((p, q) => q.upd - p.upd) }); }
  if (a === "vx-get") { const x = await store.get(pk(b.id)); return x ? J(200, { ok: true, item: x }) : J(404, { ok: false, error: "Not found" }); }
  if (a === "vx-del") { await store.delete(pk(b.id)); return J(200, { ok: true }); }
  return J(400, { ok: false, error: "Unknown action" });
}
function cleanScript(sc) {
  sc = sc && typeof sc === "object" ? sc : {};
  return { title: str(sc.title, 140), intro: str(sc.intro, 900), outro: str(sc.outro, 900),
    steps: (Array.isArray(sc.steps) ? sc.steps : []).slice(0, 40).map((s) => ({ f: Math.max(0, Math.round(+s.f || 0)), title: str(s.title, 100), skip: !!s.skip,
      beats: (Array.isArray(s.beats) ? s.beats : []).slice(0, 8).map((q) => ({ text: str(q && q.text, 600), x: Math.max(0, Math.min(100, +(q && q.x) || 50)), y: Math.max(0, Math.min(100, +(q && q.y) || 50)), pt: !!(q && q.pt) })).filter((q) => q.text) })) };
}
function cleanScripts(S) { const o = {}; if (S && typeof S === "object") Object.keys(S).slice(0, 14).forEach((l) => { if (VX_LANGS[l]) o[l] = cleanScript(S[l]); }); return o; }

// ---------------- the background runner ----------------
export async function runVxJob(store, id, deps) {
  const k = "vxjob:" + id, j = await store.get(k); if (!j || j.st === "done") return;
  const upd = async (p, msg) => { j.p = p; j.msg = msg; j.beat = Date.now(); await store.set(k, j); };
  j.st = "running"; await upd(0.02, "Starting…");
  const ctx = { store, t: Date.now(), app: j.app, key: j.key, rec: j.rec, who: j.rec.username, askAI: deps.askAI, aiFetch: deps.aiFetch, env: deps.env || {}, long: true,
    pool: async (arr, n, fn) => { const out = []; for (const x of arr) out.push(await fn(x)); return out; } };
  let res;
  try {
    const R = j.req || {};
    let seen = [];
    if (j.kind !== "translate") {
      const F = (await store.get("vxjobf:" + id)) || [];
      for (let i = 0; i < F.length; i += 3) {
        const part = F.slice(i, i + 3);
        await upd(0.05 + 0.65 * i / F.length, "🤖 AI is watching frames " + (i + 1) + "–" + (i + part.length) + " of " + F.length + "…");
        let r = await seeFrames(ctx, part.map((f) => f.src), { offset: i, times: part.map((f) => f.t), about: R.about || R.note || "", points: j.kind === "explain" });
        if (!r.ok) r = await seeFrames(ctx, part.map((f) => f.src), { offset: i, times: part.map((f) => f.t), about: R.about || R.note || "", points: j.kind === "explain" });
        part.forEach((f, q) => seen.push(Object.assign({ t: f.t }, (r.ok && r.frames[q]) || { i: i + q, screen: "Frame " + (i + q + 1), texts: [], action: "", points: [] })));
      }
      if (!seen.some((x) => x.texts && x.texts.length || x.layout)) throw new Error("The AI couldn't read the video frames right now (busy or not set up) — please try again in a minute.");
    }
    if (j.kind === "ux") {
      await upd(0.75, "🎨 Rebuilding the screens as an editable design with the step-by-step flow… (1–3 minutes)");
      const r = await (await uxAction(Object.assign({}, R, { action: "ux-ai", mode: "fromvideo", seen }), ctx)).json();
      res = r.ok ? { ok: true, doc: r.doc } : { ok: false, error: r.error || "The AI couldn't build the design — try again." };
    } else if (j.kind === "man") {
      await upd(0.8, "✍️ Writing the step-by-step script…");
      const r = await (await manAction(Object.assign({}, R, { action: "man-vid-script", seen }), ctx)).json();
      res = r.ok ? { ok: true, script: r.script } : { ok: false, error: r.error || "The AI couldn't write the script — try again." };
    } else if (j.kind === "explain") {
      await upd(0.78, "✍️ Writing what the presenter says on every screen…");
      res = await explainScript(ctx, seen, R);
    } else {
      await upd(0.3, "🌐 Translating the script…");
      res = await translateScript(ctx, R);
    }
  } catch (e) { res = { ok: false, error: String(e && e.message || e).slice(0, 300) }; }
  j.st = "done"; j.res = res; j.p = 1; j.msg = ""; j.done = Date.now(); await store.set(k, j);
  try { await store.delete("vxjobf:" + id); } catch (e) { }
}

async function explainScript(ctx, seen, R) {
  const lang = VX_LANGS[R.lang] ? R.lang : "en", L = VX_LANGS[lang];
  const F = seen.map((x, i) => ({ f: i, t: Math.round((+x.t || 0) * 10) / 10, screen: x.screen, kind: x.kind, texts: (x.texts || []).slice(0, 30), layout: str(x.layout, 400), action: x.action, why: x.why, points: (x.points || []).map((q, p) => ({ p, label: q.label, say: q.say })) }));
  const sys = `You are an AI presenter who explains a SCREEN RECORDING of ${str(R.about, 200) || "an app or website"} to ${R.aud === "mgmt" ? "management" : R.aud === "dev" ? "developers" : R.aud === "retailer" ? "retailers" : "its users"}.
Below is what each key frame of the recording shows (in time order) with numbered "points" (important elements, each with a position on the screen).
Write the voice-over in ${L}${lang !== "en" ? " (keep app, button and field names exactly as they appear on screen, in quotes)" : ""}, as a ${str(R.tone, 40) || "friendly, clear trainer"}: natural spoken sentences, second person, no emojis, no markdown, no reading out of coordinates.
For EVERY frame write a step: a short title (max 6 words) and 1-5 "beats". A beat is 1-2 sentences that explain ONE feature, number, button or detail visible on that screen — what it is, what it shows or does, and why it matters — and "p" = the number of the point it talks about (or -1 for a general remark). Cover ALL the important features and details shown, and say what the user does next. Link the steps naturally ("Now…", "Next…"). Mark "skip": true only for a loading screen, a blurred transition or a repeat of the previous screen.
Also write a title for the video, a 1-2 sentence intro and a 1-2 sentence closing.
Reply with ONE JSON object: {"title":"…","intro":"…","outro":"…","steps":[{"f":frame number,"title":"…","skip":false,"beats":[{"p":0,"text":"…"}]}]}`;
  const r = await ctx.askAI(ctx.env, "Write the presenter script.", JSON.stringify({ video: str(R.name, 80), note: str(R.note, 600), frames: F }).slice(0, 30000), [], ctx.aiFetch, { system: sys, label: "RECORDING", json: true, raw: true, maxTokens: 9000, ctxMax: 30000, budgetMs: 400000, callMs: 180000 });
  const d = r.ok ? parse(r.text) : null;
  if (!d || !Array.isArray(d.steps)) return { ok: false, error: (r.error || "The AI reply couldn't be read") + " — try again." };
  d.steps = d.steps.map((s) => { const f = Math.max(0, Math.min(F.length - 1, Math.round(+s.f || 0))), P = seen[f].points || [];
    return { f, title: s.title, skip: !!s.skip, beats: (Array.isArray(s.beats) ? s.beats : [{ text: s.text }]).map((q) => { const pt = P[+q.p]; return { text: q.text, x: pt ? pt.x : 50, y: pt ? pt.y : 50, pt: !!pt }; }) }; })
    .filter((s, i, a) => a.findIndex((y) => y.f === s.f) === i).sort((p, q) => p.f - q.f);
  return { ok: true, lang, script: cleanScript(d), seen: seen.map((x) => ({ screen: x.screen, points: x.points || [] })) };
}
async function translateScript(ctx, R) {
  const to = VX_LANGS[R.to] ? R.to : "", src = cleanScript(R.script);
  if (!to) return { ok: false, error: "Choose a language." };
  const slim = { title: src.title, intro: src.intro, outro: src.outro, steps: src.steps.map((s) => ({ title: s.title, beats: s.beats.map((q) => q.text) })) };
  const sys = `Translate this video voice-over script into ${VX_LANGS[to]}. It is spoken by a presenter, so use natural, simple spoken ${VX_LANGS[to]} (not word-for-word). Keep app, button and field names exactly as on screen (in English, in quotes). Keep the same structure and the same number of steps and beats. Reply with JSON only, same shape: {"title":"…","intro":"…","outro":"…","steps":[{"title":"…","beats":["…"]}]}`;
  const r = await ctx.askAI(ctx.env, "Translate.", JSON.stringify(slim).slice(0, 30000), [], ctx.aiFetch, { system: sys, label: "SCRIPT", json: true, raw: true, maxTokens: 9000, ctxMax: 30000, budgetMs: 400000, callMs: 180000 });
  const d = r.ok ? parse(r.text) : null;
  if (!d || !Array.isArray(d.steps)) return { ok: false, error: (r.error || "The translation couldn't be read") + " — try again." };
  const out = Object.assign({}, src, { title: d.title || src.title, intro: d.intro || "", outro: d.outro || "",
    steps: src.steps.map((s, i) => { const t = d.steps[i] || {}, B = Array.isArray(t.beats) ? t.beats : []; return Object.assign({}, s, { title: t.title || s.title, beats: s.beats.map((q, k) => Object.assign({}, q, { text: typeof B[k] === "string" ? B[k] : (B[k] && B[k].text) || q.text })) }); }) });
  return { ok: true, lang: to, script: cleanScript(out) };
}
