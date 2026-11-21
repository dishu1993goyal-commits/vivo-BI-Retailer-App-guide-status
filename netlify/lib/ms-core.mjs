// Market survey for the field (research & insights)
//   HO builds a survey (price checks, competitor offers, display audits, customer feedback…). Field staff open ONE web
//   link (no app login), fill it once per store / visit with photos and their GPS location. HO sees live results:
//   per-question summaries (by state), every response with photos and a map link, an AI summary, and Excel with photos.
// Storage:
//   ms:<sid>            survey        mstok:<token> { sid }
//   msr:<sid>:<rid>     response      msp:<pid> { sid, rid, data, thumb, w, h }
import { randomBytes } from "node:crypto";
import { STATES } from "./cmp-core.mjs";
import { gas } from "./sf-core.mjs";
import { createHash } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const tok = () => randomBytes(10).toString("hex");
const phoneOf = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const B64 = /^[A-Za-z0-9+/=]+$/;
export const MS_TYPES = { text: "Short answer", long: "Long answer", choice: "Choose one", multi: "Choose many", yesno: "Yes / No", number: "Number", price: "Price (₹)", rating: "Rating 1–5", photo: "Photo(s)" };

function clean(c, old, t) {
  const o = old || { id: "S" + nid(t).toUpperCase().slice(-6), token: tok(), at: t, status: "draft" };
  const qs = (Array.isArray(c.questions) ? c.questions : []).slice(0, 40).map((q, i) => ({
    id: str(q.id, 12) || "q" + (i + 1) + nid(t + i).slice(-3), q: str(q.q, 200), type: MS_TYPES[q.type] ? q.type : "text", req: q.req !== false,
    options: (Array.isArray(q.options) ? q.options : String(q.options || "").split(/\n|,/)).map((x) => str(x, 60)).filter(Boolean).slice(0, 20),
    max: q.type === "photo" ? Math.max(1, Math.min(4, +q.max || 1)) : undefined, group: str(q.group, 60),
  })).filter((q) => q.q);
  return Object.assign(o, {
    title: str(c.title, 100) || "Market survey", desc: txt(c.desc, 1200), end: +c.end || 0,
    states: (Array.isArray(c.states) ? c.states : []).filter((s) => STATES.includes(s)),
    ask: { phone: c.ask ? c.ask.phone !== false : true, empId: c.ask ? c.ask.empId !== false : true, store: c.ask ? c.ask.store !== false : true, city: c.ask ? c.ask.city !== false : true, gps: c.ask ? c.ask.gps !== false : true, gpsReq: c.ask ? !!c.ask.gpsReq : false },
    questions: qs, upd: t,
  });
}
const pub = (s) => ({ id: s.id, title: s.title, desc: s.desc, end: s.end, states: s.states, ask: s.ask, questions: s.questions, status: s.status });
const isLive = (s, t) => s.status === "live" && (!s.end || t <= s.end);
async function respOf(store, pool, sid) { return (await pool(await store.list("msr:" + sid + ":"), 30, (k) => store.get(k))).filter((r) => r && r.done); }

export async function msAction(b, ctx) {
  const { store, t, app, rec, pool, env = {}, askAI, aiFetch } = ctx;
  if (app !== "admin") return json(403, { ok: false, error: "Only HO admins manage market surveys. The field team fills them through the survey link." });
  const site = env.SITE_URL || "", by = rec.fullName || rec.username || "";
  const get = async (id) => store.get("ms:" + str(id, 20));
  if (b.action === "ms-list") {
    const L = (await pool(await store.list("ms:"), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at);
    const rows = []; for (const s of L) rows.push({ id: s.id, title: s.title, status: s.status, end: s.end, at: s.at, n: (await store.list("msr:" + s.id + ":")).length, link: site + "/msurvey.html?k=" + s.token });
    return json(200, { ok: true, rows, states: STATES, types: MS_TYPES });
  }
  if (b.action === "ms-get") { const s = await get(b.id); return s ? json(200, { ok: true, s, link: site + "/msurvey.html?k=" + s.token }) : json(404, { ok: false, error: "Survey not found" }); }
  if (b.action === "ms-save") {
    const old = b.id ? await get(b.id) : null; if (b.id && !old) return json(404, { ok: false, error: "Survey not found" });
    const s = clean(b.s || {}, old, t); s.by = s.by || by;
    if (["draft", "live", "closed"].includes(b.status)) s.status = b.status;
    if (!s.questions.length) return json(400, { ok: false, error: "Add at least one question" });
    await store.set("ms:" + s.id, s); await store.set("mstok:" + s.token, { sid: s.id });
    return json(200, { ok: true, s, link: site + "/msurvey.html?k=" + s.token });
  }
  if (b.action === "ms-delete") {
    const s = await get(b.id); if (!s) return json(404, { ok: false, error: "Survey not found" });
    for (const k of await store.list("msr:" + s.id + ":")) { const r = await store.get(k); for (const p of (r && r.photos) || []) await store.delete("msp:" + p); await store.delete(k); }
    await store.delete("mstok:" + s.token); await store.delete("ms:" + s.id);
    return json(200, { ok: true });
  }
  const s = await get(b.sid); if (!s) return json(404, { ok: false, error: "Survey not found" });
  if (b.action === "ms-results") return json(200, { ok: true, s, rows: (await respOf(store, pool, s.id)).sort((x, y) => y.at - x.at).map((r) => { delete r.up; return r; }) });
  if (b.action === "ms-gform") {   // the same survey as a Google Form (no photos / GPS there); answers come back with ms-gres
    const cfg = (await store.get("sf:cfg")) || {}; if (!cfg.gasUrl || !cfg.gasKey) return json(400, { ok: false, error: "Google Forms is not connected yet — connect it once in 📝 Survey & poll creator → Set-up." });
    const f = ctx.aiFetch || fetch, link = site + "/msurvey.html#s=" + s.token, cols = [], me = [];
    const add = (arr, key, q) => { arr.push(q); if (q.type !== "info") cols.push(key); };
    add(me, "name", { id: "n", type: "short", title: "Your name", required: true }); add(me, "state", { id: "st", type: "dropdown", title: "State", options: s.states.length ? s.states : STATES, required: true });
    if (s.ask.phone) add(me, "phone", { id: "ph", type: "phone", title: "Mobile number", required: true });
    if (s.ask.empId) add(me, "empId", { id: "em", type: "short", title: "Employee ID" });
    if (s.ask.store) add(me, "store", { id: "sto", type: "short", title: "Store / retailer name", required: true });
    if (s.ask.city) add(me, "city", { id: "ci", type: "short", title: "City" });
    const qs = [], TY = { text: "short", long: "paragraph", choice: "single", multi: "multi", yesno: "yesno", number: "number", price: "number", rating: "scale" };
    s.questions.forEach((q) => {
      if (q.type === "photo") return add(qs, null, { type: "info", title: "📷 " + q.q, help: "Photos can't be added in a Google Form. To send photos, fill the survey link instead: " + link });
      const g = { id: q.id, type: TY[q.type] || "short", title: q.q + (q.type === "price" ? " (₹)" : ""), required: q.req, help: q.group || "" };
      if (q.type === "choice" || q.type === "multi") g.options = q.options; if (q.type === "yesno") g.options = ["Yes", "No"]; if (q.type === "rating") g.scale = { min: 1, max: 5, minLabel: "Poor", maxLabel: "Excellent" };
      if (q.type === "number" || q.type === "price") g.validation = { min: 0 };
      add(qs, q.id, g);
    });
    const survey = { title: s.title, description: (s.desc ? s.desc + "\n\n" : "") + "Fill this once for every store you visit.", confirmation: "Thank you — your response is recorded.", settings: { progressBar: true },
      sections: [{ id: "s1", title: "About you and the store", questions: me }, { id: "s2", title: "Survey", questions: qs }] };
    const r = await gas(cfg, { action: "create", survey, opts: {} }, f); if (!r.ok) return json(502, { ok: false, error: r.error || "Google didn't make the form" });
    const old = s.gform; s.gform = { id: r.id, url: r.url, shortUrl: r.shortUrl, editUrl: r.editUrl, at: t, cols, pulled: 0, n: 0 };
    if (old && old.id) { s.gold = (s.gold || []).concat([{ id: old.id }]).slice(-4); }
    await store.set("ms:" + s.id, s); return json(200, { ok: true, gform: s.gform, warn: r.warnings || [] });
  }
  if (b.action === "ms-gres") {   // pull Google Form answers into the results (one response per row, marked "Google Form")
    const cfg = (await store.get("sf:cfg")) || {}, G = s.gform; if (!G) return json(400, { ok: false, error: "No Google Form for this survey yet" });
    const r = await gas(cfg, { action: "results", id: G.id, max: 3000 }, ctx.aiFetch || fetch); if (!r.ok) return json(502, { ok: false, error: r.error || "Couldn't read the Google Form" });
    let n = 0; const byQ = Object.fromEntries(s.questions.map((q) => [q.id, q]));
    for (const row of r.rows || []) {
      const h = createHash("sha256").update(G.id + "|" + row.join("|")).digest("hex").slice(0, 10), rid = "G" + h.toUpperCase(), k = `msr:${s.id}:${rid}`;
      if (await store.get(k)) continue;
      const d = { name: "", phone: "", empId: "", store: "", city: "", state: "" }, answers = {};
      G.cols.forEach((c, i) => { const v = row[i + 2] == null ? "" : String(row[i + 2]); if (c in d) d[c] = v; else if (byQ[c]) { const q = byQ[c]; answers[c] = q.type === "multi" ? v.split(", ").filter(Boolean) : ["number", "price", "rating"].includes(q.type) && v !== "" && !isNaN(+v) ? +v : v; } });
      s.questions.forEach((q) => { if (q.type === "photo") answers[q.id] = []; });
      const at = Date.parse(String(row[0]).replace(" ", "T") + ":00+05:30") || t;
      await store.set(k, { id: rid, at, name: str(d.name, 80), phone: phoneOf(d.phone), empId: str(d.empId, 30), store: str(d.store, 100), city: str(d.city, 60), state: STATES.find((x) => low(x) === low(d.state)) || str(d.state, 40), gps: null, answers, photos: [], need: 0, done: true, src: "Google Form" });
      n++;
    }
    G.pulled = t; G.n = (r.rows || []).length; await store.set("ms:" + s.id, s);
    return json(200, { ok: true, added: n, total: G.n });
  }
  if (b.action === "ms-thumbs") {
    const out = {}; for (const id of (Array.isArray(b.ids) ? b.ids : []).slice(0, 40)) { const p = await store.get("msp:" + str(id, 30)); if (p && p.sid === s.id) out[id] = { d: p.thumb, w: p.w, h: p.h }; }
    return json(200, { ok: true, thumbs: out });
  }
  if (b.action === "ms-img") { const p = await store.get("msp:" + str(b.id, 30)); return p && p.sid === s.id ? json(200, { ok: true, data: p.data }) : json(404, { ok: false, error: "Photo not found" }); }
  if (b.action === "ms-ai") {   // AI summary of the results (numbers worked out here; text answers sampled)
    const R = await respOf(store, pool, s.id);
    if (!R.length) return json(400, { ok: false, error: "No responses yet" });
    const lines = [];
    lines.push(`Survey "${s.title}" — ${R.length} responses from ${new Set(R.map((r) => r.state)).size} states, ${new Set(R.map((r) => low(r.store))).size} stores.`);
    for (const q of s.questions) {
      if (q.type === "photo") continue;
      const vals = R.map((r) => ({ v: (r.answers || {})[q.id], st: r.state })).filter((x) => x.v !== undefined && x.v !== "" && !(Array.isArray(x.v) && !x.v.length));
      if (["number", "price", "rating"].includes(q.type)) {
        const nums = vals.map((x) => +x.v).filter((x) => !isNaN(x)); if (!nums.length) continue;
        const bySt = {}; vals.forEach((x) => { if (!isNaN(+x.v)) (bySt[x.st] = bySt[x.st] || []).push(+x.v); });
        lines.push(`Q "${q.q}" (${q.type}): n=${nums.length}, avg ${(nums.reduce((a, c) => a + c, 0) / nums.length).toFixed(1)}, min ${Math.min(...nums)}, max ${Math.max(...nums)}; by state: ` + Object.keys(bySt).map((k) => `${k} avg ${(bySt[k].reduce((a, c) => a + c, 0) / bySt[k].length).toFixed(1)} (n=${bySt[k].length})`).join("; "));
      } else if (["choice", "multi", "yesno"].includes(q.type)) {
        const cnt = {}; vals.forEach((x) => (Array.isArray(x.v) ? x.v : [x.v]).forEach((o) => { cnt[o] = (cnt[o] || 0) + 1; }));
        lines.push(`Q "${q.q}": ` + Object.keys(cnt).sort((a, c) => cnt[c] - cnt[a]).map((k) => `${k} ${cnt[k]} (${Math.round((cnt[k] * 100) / vals.length)}%)`).join(", "));
      } else {
        lines.push(`Q "${q.q}" — sample answers: ` + vals.slice(0, 60).map((x) => `[${x.st}] ${String(x.v).slice(0, 160)}`).join(" | "));
      }
    }
    if (!askAI) return json(400, { ok: false, error: "AI is not set up yet." });
    const r = await askAI(env, "Write a short insight summary for vivo India's sales and marketing heads: 5–8 bullet points with the key findings and numbers, notable differences between states, competitor moves or risks, and 3 recommended actions. Plain text bullets, no tables.", lines.join("\n"), [], aiFetch, { label: "MARKET SURVEY RESULTS", system: "You are vivo India's research & insights analyst. Be specific and use the numbers given. Do not invent numbers." });
    if (!r.ok) return json(502, { ok: false, error: r.error || "AI didn't answer" });
    s.ai = { text: String(r.text).slice(0, 4000), at: t, n: R.length }; await store.set("ms:" + s.id, s);
    return json(200, { ok: true, ai: s.ai });
  }
  if (b.action === "ms-del-resp") {
    const r = await store.get(`msr:${s.id}:${str(b.rid, 20)}`); if (!r) return json(404, { ok: false, error: "Response not found" });
    for (const p of r.photos || []) await store.delete("msp:" + p); await store.delete(`msr:${s.id}:${r.id}`);
    return json(200, { ok: true });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

export async function msPublic(b, ctx) {
  const { store, t } = ctx;
  const ix = await store.get("mstok:" + String(b.k || "").replace(/[^a-f0-9]/g, ""));
  const s = ix ? await store.get("ms:" + ix.sid) : null;
  if (!s || s.status === "draft") return json(404, { ok: false, error: "This survey link isn't active." });
  if (b.action === "ms-p-info") return json(200, { ok: true, s: pub(s), live: isLive(s, t), states: STATES });
  if (!isLive(s, t)) return json(403, { ok: false, error: "This survey is closed." });
  if (b.action === "ms-p-submit") {
    if (b.hp) return json(200, { ok: true });
    const hk = "msrate:" + s.id + ":" + new Date(t).toISOString().slice(0, 13); const h = (await store.get(hk)) || { n: 0 };
    if (h.n > 600) return json(429, { ok: false, error: "Too many responses this hour — try again later." });
    const d = b.d || {};
    const name = str(d.name, 80), state = STATES.find((x) => low(x) === low(d.state)) || "";
    if (!name) return json(400, { ok: false, error: "Enter your name" });
    if (!state) return json(400, { ok: false, error: "Choose the state" });
    if (s.states.length && !s.states.includes(state)) return json(403, { ok: false, error: "This survey is for: " + s.states.join(", ") });
    if (s.ask.phone && !phoneOf(d.phone)) return json(400, { ok: false, error: "Enter your 10-digit mobile number" });
    if (s.ask.store && !str(d.store, 100)) return json(400, { ok: false, error: "Enter the store / retailer name" });
    const g = d.gps && isFinite(+d.gps.lat) && isFinite(+d.gps.lng) && Math.abs(+d.gps.lat) <= 90 && Math.abs(+d.gps.lng) <= 180 ? { lat: +(+d.gps.lat).toFixed(6), lng: +(+d.gps.lng).toFixed(6), acc: Math.round(+d.gps.acc || 0) } : null;
    if (s.ask.gps && s.ask.gpsReq && !g) return json(400, { ok: false, error: "Allow location — this survey needs where you are" });
    const answers = {}; let nPh = 0;
    for (const q of s.questions) {
      let v = (d.answers || {})[q.id];
      if (q.type === "photo") { const n = Math.max(0, Math.min(q.max || 1, Math.floor(+v || 0))); if (q.req && !n) return json(400, { ok: false, error: "Add a photo: " + q.q }); answers[q.id] = []; nPh += n; continue; }
      if (q.type === "multi") { v = (Array.isArray(v) ? v : []).map((x) => str(x, 60)).filter((x) => q.options.includes(x)); if (q.req && !v.length) return json(400, { ok: false, error: "Answer: " + q.q }); answers[q.id] = v; continue; }
      v = txt(v, q.type === "long" ? 1500 : 200);
      if (q.type === "choice" && v && !q.options.includes(v)) v = "";
      if (q.type === "yesno" && v && !["Yes", "No"].includes(v)) v = "";
      if (["number", "price", "rating"].includes(q.type) && v !== "") { if (isNaN(+v)) return json(400, { ok: false, error: "“" + q.q + "” needs a number" }); v = +v; if (q.type === "rating") v = Math.max(1, Math.min(5, Math.round(v))); }
      if (q.req && (v === "" || v == null)) return json(400, { ok: false, error: "Answer: " + q.q });
      answers[q.id] = v;
    }
    const rid = "R" + nid(t).toUpperCase().slice(-7);
    const r = { id: rid, at: t, name, phone: phoneOf(d.phone), empId: str(d.empId, 30), store: str(d.store, 100), city: str(d.city, 60), state, gps: g, answers, photos: [], need: nPh, up: tok(), done: nPh === 0 };
    await store.set(`msr:${s.id}:${rid}`, r); h.n++; await store.set(hk, h);
    return json(200, { ok: true, rid, up: r.up, need: nPh });
  }
  if (b.action === "ms-p-photo") {
    const r = await store.get(`msr:${s.id}:${str(b.rid, 20)}`);
    if (!r || !b.up || r.up !== String(b.up)) return json(403, { ok: false, error: "Upload not allowed — send the form again" });
    const q = s.questions.find((x) => x.id === b.qid && x.type === "photo"); if (!q) return json(400, { ok: false, error: "Bad photo question" });
    const data = String(b.data || ""), th = String(b.thumb || "");
    if (!B64.test(data) || data.length > 1700000 || !B64.test(th) || th.length > 120000) return json(400, { ok: false, error: "That photo is too big — try again" });
    if (r.photos.length >= r.need) return json(400, { ok: false, error: "All photos are already uploaded" });
    const pid = r.id + "-" + nid(t).slice(-6);
    await store.set("msp:" + pid, { sid: s.id, rid: r.id, data, thumb: th, w: Math.round(+b.w || 0), h: Math.round(+b.h || 0) });
    r.photos.push(pid); (r.answers[q.id] = r.answers[q.id] || []).push(pid);
    if (r.photos.length >= r.need) { r.done = true; delete r.up; }
    await store.set(`msr:${s.id}:${r.id}`, r);
    return json(200, { ok: true, done: r.done });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
