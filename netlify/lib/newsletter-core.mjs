// AI newsletter: HO picks a month or quarter; the page reads the dashboard (scores, ranks, KPIs, support desk, roadmap,
// projects) and this module adds activity from the tools (visits, ideas, best practices, quizzes, support, disputes,
// rewards). AI writes the stories; HO edits, publishes for everyone in the apps and web, and can email it.
// Storage:  nl:<id> { id, title, period, at, by, html, summary, published, sent }   nlai:<hash> { at, ai }
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { createHash, randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const dOK = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
const ist = (ts) => new Date((Number(ts) || Date.parse(ts) || 0) + 19800000).toISOString().slice(0, 10);
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
function safeHtml(h) {
  return String(h || "").slice(0, 900000).replace(/<\s*(script|iframe|object|embed|form|link|meta|base)[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, "").replace(/<\s*(script|iframe|object|embed|form|link|meta|base|input|button)[^>]*>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript|data:text)[^"']*\2/gi, '$1="#"');
}
export async function newsletterAction(b, ctx) {
  const { store, t, app, rec, pool, env = {} } = ctx, isAdmin = app === "admin";
  if (b.action === "nl-list") {
    const L = (await pool((await store.list("nl:")).sort().reverse().slice(0, 60), 20, (k) => store.get(k))).filter((x) => x && (isAdmin || x.published)).sort((a, c) => c.at - a.at);
    return json(200, { ok: true, items: L.map((x) => ({ id: x.id, title: x.title, period: x.period, at: x.at, by: x.by, summary: x.summary, published: x.published, sent: x.sent || 0 })) });
  }
  if (b.action === "nl-get") { const x = await store.get(`nl:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x || (!isAdmin && !x.published)) return json(404, { ok: false, error: "Not found." }); return json(200, { ok: true, item: x }); }
  if (!isAdmin) return json(403, { ok: false, error: "Only HO admins create newsletters." });
  if (b.action === "nl-data") {   // activity from the tools for the period
    const f = dOK(b.f) ? b.f : "", to = dOK(b.t) ? b.t : ""; if (!f || !to) return json(400, { ok: false, error: "Choose a period." });
    const inP = (ts) => { const d = ist(ts); return d >= f && d <= to; }, months = []; for (let d = new Date(f + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7).replace("-", ""));
    const out = { visits: { total: 0, valid: 0, byState: {} }, ideas: { total: 0, top: [] }, wall: { total: 0, top: [] }, quizzes: { passed: 0, attempts: 0 }, support: { raised: 0, closed: 0 }, disputes: { raised: 0, resolved: 0 }, rewards: { top: [] }, fieldNotes: 0 };
    for (const m of [...new Set(months)]) (await pool(await store.list(`visit:${m}:`), 40, (k) => store.get(k))).forEach((v) => { if (!v || v.status === "open" || v.status === "cancelled" || !inP(v.createdAt)) return; out.visits.total++; if (v.valid) out.visits.valid++; const s = out.visits.byState[v.state || "?"] = out.visits.byState[v.state || "?"] || { visits: 0, valid: 0 }; s.visits++; if (v.valid) s.valid++; });
    const ideas = (await pool(await store.list("idea:"), 40, (k) => store.get(k))).filter((x) => x && inP(x.at)); out.ideas.total = ideas.length;
    out.ideas.top = ideas.sort((a, c) => (c.voters || []).length - (a.voters || []).length).slice(0, 6).map((x) => ({ title: str(x.title, 90), category: x.category, state: x.state, votes: (x.voters || []).length, status: x.status || "" }));
    const wall = (await pool(await store.list("wall:"), 40, (k) => store.get(k))).filter((x) => x && inP(x.createdAt)); out.wall.total = wall.length;
    out.wall.top = wall.sort((a, c) => (c.featured ? 100 : 0) + Object.keys(c.likes || {}).length - ((a.featured ? 100 : 0) + Object.keys(a.likes || {}).length)).slice(0, 4).map((x) => ({ title: str(x.title, 90), state: x.state, result: str(x.result, 120), likes: Object.keys(x.likes || {}).length }));
    (await pool(await store.list("qatt:"), 40, (k) => store.get(k))).forEach((a) => { if (a && inP(a.at)) { out.quizzes.attempts++; if (a.passed) out.quizzes.passed++; } });
    (await pool(await store.list("ticket:"), 40, (k) => store.get(k))).forEach((x) => { if (!x) return; if (inP(x.createdAt)) out.support.raised++; if (x.status === "closed" && inP(x.closedAt || x.updatedAt)) out.support.closed++; });
    (await pool(await store.list("disp:"), 40, (k) => store.get(k))).forEach((x) => { if (!x || !x.createdAt) return; if (inP(x.createdAt)) out.disputes.raised++; if (x.resolvedAt && inP(x.resolvedAt)) out.disputes.resolved++; });
    out.rewards.top = (await pool(await store.list("rww:"), 40, (k) => store.get(k))).filter(Boolean).map((w) => ({ name: w.name || w.username, state: w.state, pts: (w.earned || []).filter((e) => inP(e.at)).reduce((a, e) => a + e.pts, 0) })).filter((x) => x.pts > 0).sort((a, c) => c.pts - a.pts).slice(0, 5);
    out.fieldNotes = (await store.list("tl:notes:")).length;
    return json(200, { ok: true, data: out });
  }
  if (b.action === "nl-ai") {
    const data = String(typeof b.data === "string" ? b.data : JSON.stringify(b.data || {})).slice(0, 18000);
    if (data.length < 50) return json(400, { ok: false, error: "No data to write about." });
    const lang = str(b.lang, 30) || "English", tone = str(b.tone, 20) || "professional";
    const k = "nlai:" + createHash("sha1").update(data + lang + tone + str(b.extra, 300)).digest("hex").slice(0, 20), hit = await store.get(k);
    if (hit && !b.fresh && t - hit.at < 12 * 3600000) return json(200, { ok: true, ai: hit.ai, cached: true });
    const keys = await aiKeys(store, env); if (!keys.groq) return json(200, { ok: false, error: "AI key not set (Affordability → Data → Groq key)." });
    const prompt = `You are the editor of "BI Pulse", the internal newsletter of vivo India's Business Innovation team for state BI teams and HO.
Write the newsletter for ${str(b.period, 40)} in ${lang}, ${tone} and upbeat but factual. Use ONLY facts and numbers in DATA; never invent numbers, names or dates. Short sentences, phone-friendly.${b.extra ? " Extra instructions: " + str(b.extra, 300) : ""}
Return JSON only:
{"title":"newsletter title (max 7 words)","headline":"one-line cover headline","editorial":"3-4 sentence note from HO",
"sections":{"scorecard":"2-3 sentences on overall score and rankings","kpis":[{"kpi":"","text":"one sentence"}],"app":"2 sentences on Retailer App usage","support":"2 sentences on support desk","field":"2-3 sentences on market visits, retailer feedback and requirements","achievements":["", ""],"projects":"2-3 sentences on running and pilot projects","upcoming":["", ""],"newimpl":"1-2 sentences on new implementation","people":"1-2 sentences on trainings, best practices and rewards"},
"spotlight":[{"state":"","why":"one sentence"}],"tip":"one practical tip for state teams","quote":"short motivating closing line"}
DATA:
${data}`;
    const r = await groqJSON(keys.groq, prompt, ctx.aiFetch || fetch, { validate: (d) => d && d.title && d.sections });
    if (!r.ok) return json(200, { ok: false, error: r.error });
    const d = r.data, S = d.sections || {}, L = (v, n, m) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => str(typeof x === "object" ? x.text || x.title || JSON.stringify(x) : x, m)).filter(Boolean);
    const ai = { title: str(d.title, 80), headline: str(d.headline, 160), editorial: str(d.editorial, 700), tip: str(d.tip, 240), quote: str(d.quote, 160),
      sections: { scorecard: str(S.scorecard, 500), kpis: (Array.isArray(S.kpis) ? S.kpis : []).slice(0, 8).map((x) => ({ kpi: str(x && x.kpi, 40), text: str(x && x.text, 240) })), app: str(S.app, 400), support: str(S.support, 400), field: str(S.field, 500), achievements: L(S.achievements, 6, 200), projects: str(S.projects, 500), upcoming: L(S.upcoming, 6, 200), newimpl: str(S.newimpl, 300), people: str(S.people, 400) },
      spotlight: (Array.isArray(d.spotlight) ? d.spotlight : []).slice(0, 3).map((x) => ({ state: str(x && x.state, 40), why: str(x && x.why, 200) })) };
    await store.set(k, { at: t, ai }); return json(200, { ok: true, ai });
  }
  if (b.action === "nl-save") {
    const id = str(b.id, 30).replace(/[^a-z0-9]/gi, "") || t.toString(36) + randomBytes(3).toString("hex"), old = (await store.get(`nl:${id}`)) || {};
    const x = Object.assign(old, { id, title: str(b.title, 100) || "BI Pulse", period: str(b.period, 40), html: safeHtml(b.html), summary: str(b.summary, 300), at: old.at || t, updatedAt: t, by: rec.fullName || rec.username, published: !!b.published });
    if (x.html.length < 50) return json(400, { ok: false, error: "The newsletter is empty." });
    await store.set(`nl:${id}`, x); return json(200, { ok: true, id, published: x.published });
  }
  if (b.action === "nl-delete") { await store.delete(`nl:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); return json(200, { ok: true }); }
  if (b.action === "nl-email") {   // email to all state users (+ admins), in BCC batches
    const x = await store.get(`nl:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x) return json(404, { ok: false, error: "Save the newsletter first." });
    const me = { key: env.BREVO_API_KEY, from: env.OTP_FROM_EMAIL, name: env.OTP_FROM_NAME }; if (!me.key || !me.from) return json(400, { ok: false, error: "Email isn't set up on the server." });
    const who = b.admins ? ["state", "admin"] : ["state"], to = new Set();
    for (const a of who) (await pool(await store.list(`user:${a}:`), 40, (k) => store.get(k))).forEach((u) => { if (u && !u.disabled && EMAIL.test(u.email || "") && (!Array.isArray(b.states) || !b.states.length || b.states.includes(u.state))) to.add(u.email.toLowerCase()); });
    if (b.test) { to.clear(); if (rec.email) to.add(rec.email); }
    const list = [...to]; let sent = 0, err = "";
    for (let i = 0; i < list.length; i += 45) {
      const chunk = list.slice(i, i + 45), body = { sender: { name: me.name || "vivo BI", email: me.from }, to: [{ email: me.from }], bcc: chunk.map((e) => ({ email: e })), subject: (b.test ? "[TEST] " : "") + x.title + (x.period ? " — " + x.period : ""), htmlContent: x.html };
      if (b.test) { body.to = [{ email: chunk[0] }]; delete body.bcc; }
      try { const r = await (ctx.mailFetch || fetch)("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": me.key }, body: JSON.stringify(body) }); if (r.ok) sent += chunk.length; else err = "Email service " + r.status; } catch (e) { err = String(e.message || e).slice(0, 100); }
    }
    if (!b.test) { x.sent = (x.sent || 0) + sent; x.sentAt = t; await store.set(`nl:${x.id}`, x); }
    return json(200, { ok: !err || sent > 0, sent, error: err });
  }
  return json(400, { ok: false, error: "Unknown action." });
}
