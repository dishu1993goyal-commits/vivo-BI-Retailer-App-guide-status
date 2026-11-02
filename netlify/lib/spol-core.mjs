// Scheme policies: one place for every scheme letter. HO (and state publishers HO appoints) upload letters in any
// format and publish them to everyone, chosen states or chosen users. AI reads each letter into a brief (dates, models,
// targets, slabs, payout table, conditions) so the dashboard can summarise all ongoing schemes on one page, and the
// scheme tools (calculator, assistant, retailer payouts, target planner) can use a published letter instead of an upload.
// HO sees everything; others see only the policies addressed to them. Disable = shown as disabled; revoke = removed.
// Storage:
//   spol:<id>            { id, title, dateFrom, dateTo, category, models[], audience:{scope,states[],users[]}, files:[{fid,name,mime,size}],
//                          brief, text, status:"published"|"draft", disabled, by, byKey, byState, at, updatedAt }
//   spolm:<fid>          { name, mime, size, chunks, byKey, at }      spolf:<fid>:<n>  binary chunk
//   config:spol          { publishers:[username / vChat ID] }          spoldig:<hash>   { at, data } AI digest cache
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { readImages } from "./schemecalc-core.mjs";
import { cleanPlan } from "./schemeai-core.mjs";
import { createHash, randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const nid = (t) => t.toString(36) + randomBytes(4).toString("hex");
const DATE = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const arr = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => str(x && typeof x === "object" ? x.text || x.name || JSON.stringify(x) : x, m)).filter(Boolean);
const CHUNK_MAX = 2700000, CHUNKS_MAX = 8;   // ~20 MB a file, sent in pieces under the function size limit
export const SPOL_CATS = ["Sell-out", "Sell-in", "Model focus", "Launch", "Festive", "Display / visibility", "V-Shield / services", "Finance / EMI", "Retailer app", "Other"];

function cleanBrief(d) {
  d = d && typeof d === "object" ? d : {};
  return {
    title: str(d.title, 140), period: str(d.period, 80), dateFrom: DATE(d.dateFrom), dateTo: DATE(d.dateTo), category: SPOL_CATS.includes(d.category) ? d.category : "",
    audienceText: str(d.audienceText, 160), summary: str(d.summary, 700), keyPoints: arr(d.keyPoints, 8, 220),
    targets: (Array.isArray(d.targets) ? d.targets : []).slice(0, 10).map((x) => ({ metric: str(x && x.metric, 80), value: str(x && x.value, 40), unit: str(x && x.unit, 24) })).filter((x) => x.metric),
    slabs: (Array.isArray(d.slabs) ? d.slabs : []).slice(0, 20).map((x) => ({ label: str(x && x.label, 60), condition: str(x && x.condition, 120), payout: str(x && x.payout, 80) })).filter((x) => x.condition || x.payout),
    focusModels: arr(d.focusModels, 25, 50), maxPayout: str(d.maxPayout, 80), eligibility: arr(d.eligibility, 8, 200), actions: arr(d.actions, 8, 200), terms: arr(d.terms, 12, 220),
    incentiveNote: str(d.incentiveNote, 300), plan: cleanPlan(d.plan)
  };
}
// the shape the Scheme assistant / target planner use (so a policy can be used there directly)
export function asAssistantScheme(p) {
  const b = p.brief || {};
  return { title: p.title || b.title || "Scheme", period: b.period || [p.dateFrom, p.dateTo].filter(Boolean).join(" to "), summary: b.summary || "", targets: b.targets || [], slabs: b.slabs || [], focusModels: b.focusModels || p.models || [], actions: b.actions || [], inputs: [], incentiveNote: b.incentiveNote || "", terms: b.terms || [], plan: b.plan || null, policyId: p.id };
}

export async function spolAction(b, ctx) {
  const { store, t, app, rec, pool, env = {} } = ctx, isHO = app === "admin", f = ctx.aiFetch || fetch;
  const me = app + ":" + (ctx.key || rec.username), ids = [rec.username, rec.vchatId, rec.email].filter(Boolean).map(low);
  const cfg = async () => (await store.get("config:spol")) || { publishers: [] };
  const isPub = async () => isHO || (app === "state" && (await cfg()).publishers.some((u) => ids.includes(low(u))));
  const today = new Date(t + 19800000).toISOString().slice(0, 10);
  const statusOf = (p) => p.status === "draft" ? "draft" : p.disabled ? "disabled" : p.dateTo && p.dateTo < today ? "expired" : p.dateFrom && p.dateFrom > today ? "upcoming" : "ongoing";
  const canSee = (p) => {
    if (isHO || p.byKey === me) return true;
    if (p.status === "draft") return false;
    const a = p.audience || {};
    if (a.scope === "users") return (a.users || []).some((u) => ids.includes(low(u)));
    if (a.scope === "states") return app === "state" && (a.states || []).some((s) => low(s) === low(rec.state));
    return true;   // everyone
  };
  const canEdit = (p) => isHO || p.byKey === me;
  const all = async () => (await pool(await store.list("spol:"), 40, (k) => store.get(k))).filter(Boolean);
  const pub = (p, full) => Object.assign({ id: p.id, title: p.title, dateFrom: p.dateFrom, dateTo: p.dateTo, category: p.category, models: p.models || [], audience: canEdit(p) ? p.audience : { scope: p.audience && p.audience.scope }, files: p.files || [], brief: p.brief || {}, status: statusOf(p), disabled: !!p.disabled, by: p.by, byState: p.byState, at: p.at, updatedAt: p.updatedAt, mine: canEdit(p) }, full ? { text: p.text || "" } : {});

  if (b.action === "spol-me") { const c = await cfg(); return json(200, { ok: true, canPublish: await isPub(), isHO, state: rec.state || "", publishers: isHO ? c.publishers : undefined, cats: SPOL_CATS, today }); }
  if (b.action === "spol-list") {
    const L = (await all()).filter(canSee).map((p) => pub(p)).sort((a, c) => ({ ongoing: 0, upcoming: 1, draft: 2, expired: 3, disabled: 4 }[a.status] - { ongoing: 0, upcoming: 1, draft: 2, expired: 3, disabled: 4 }[c.status]) || (a.dateTo || "9").localeCompare(c.dateTo || "9"));
    return json(200, { ok: true, items: L, today });
  }
  if (b.action === "spol-get") { const p = await store.get(`spol:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!p || !canSee(p)) return json(404, { ok: false, error: "This scheme isn't available (it may have been revoked)." }); return json(200, { ok: true, item: pub(p, true), assistant: asAssistantScheme(p) }); }
  if (b.action === "spol-pick") {   // for the other scheme tools: the policies this user may use, with what each tool needs
    const want = (Array.isArray(b.ids) ? b.ids : []).map((x) => str(x, 30)), L = (await all()).filter((p) => canSee(p) && p.status !== "draft");
    if (!want.length) return json(200, { ok: true, items: L.map((p) => ({ id: p.id, title: p.title, dateFrom: p.dateFrom, dateTo: p.dateTo, status: statusOf(p), hasPlan: !!(p.brief && p.brief.plan), models: p.models || [] })).filter((x) => x.status !== "disabled").sort((a, c) => (a.status === "ongoing" ? 0 : 1) - (c.status === "ongoing" ? 0 : 1) || (c.dateFrom || "").localeCompare(a.dateFrom || "")) });
    return json(200, { ok: true, items: L.filter((p) => want.includes(p.id)).map((p) => ({ id: p.id, title: p.title, text: p.text || "", assistant: asAssistantScheme(p), files: p.files || [] })) });
  }
  if (b.action === "spol-dl") {   // one piece of a letter file (base64)
    const fid = str(b.fid, 40).replace(/[^a-z0-9]/gi, ""), m = await store.get(`spolm:${fid}`); if (!m) return json(404, { ok: false, error: "File not found." });
    const owner = (await all()).find((p) => (p.files || []).some((x) => x.fid === fid));
    if (owner ? !canSee(owner) : m.byKey !== me) return json(403, { ok: false, error: "Not available." });
    const idx = Math.max(0, Math.min(m.chunks - 1, Math.floor(Number(b.idx) || 0)));
    const s = await store.getStream(`spolf:${fid}:${idx}`); if (!s) return json(404, { ok: false, error: "File piece missing." });
    const buf = Buffer.from(await new Response(s).arrayBuffer());
    return json(200, { ok: true, name: m.name, mime: m.mime, size: m.size, chunks: m.chunks, idx, data: buf.toString("base64") });
  }
  if (b.action === "spol-digest") {   // AI one-page summary of everything ongoing / upcoming for this user
    const L = (await all()).filter(canSee).filter((p) => ["ongoing", "upcoming"].includes(statusOf(p)));
    if (!L.length) return json(200, { ok: true, digest: null });
    const key = "spoldig:" + createHash("sha1").update(L.map((p) => p.id + p.updatedAt).sort().join("|") + today).digest("hex").slice(0, 24), hit = await store.get(key);
    if (hit && !b.fresh && t - hit.at < 12 * 3600e3) return json(200, { ok: true, digest: hit.data, cached: true });
    const keys = await aiKeys(store, env); if (!keys.groq) return json(200, { ok: false, error: "AI key not set (Affordability → Data → Groq key)." });
    const briefs = L.slice(0, 25).map((p) => ({ id: p.id, title: p.title, from: p.dateFrom, to: p.dateTo, status: statusOf(p), category: p.category, models: (p.models || []).slice(0, 12), summary: str(p.brief && p.brief.summary, 400), keyPoints: (p.brief && p.brief.keyPoints || []).slice(0, 5), slabs: (p.brief && p.brief.slabs || []).slice(0, 8), maxPayout: p.brief && p.brief.maxPayout, terms: (p.brief && p.brief.terms || []).slice(0, 5) }));
    const prompt = `You brief vivo India retailers and state sales teams on all their running schemes at once. TODAY is ${today}. Using SCHEMES, write a one-page digest in simple, professional English.
Return JSON only:
{"headline":"one line: how many schemes run now and the single biggest earning opportunity",
"highlights":["4-6 short bullets: the most valuable things to know right now (biggest payouts, overlapping schemes on the same models, schemes ending soon)"],
"bestEarning":[{"scheme":"title","why":"one line on why it pays well / what to do","id":"scheme id"}],
"focusModels":[{"model":"","schemes":["titles"],"tip":"one line — combine schemes on this model"}],
"deadlines":[{"scheme":"title","date":"YYYY-MM-DD","note":"what must be done by then"}],
"actions":["4-6 concrete actions for this week across all schemes"],
"watchouts":["3-5 common conditions that cut payouts (activation, upload, V-Shield, achievement %, no online sales)"]}
Use only facts from SCHEMES; never invent payouts.
SCHEMES: ${JSON.stringify(briefs)}`;
    const r = await groqJSON(keys.groq, prompt, f, { validate: (d) => d && (d.headline || (d.highlights && d.highlights.length)) });
    if (!r.ok) return json(200, { ok: false, error: r.error });
    const d = r.data, out = { headline: str(d.headline, 240), highlights: arr(d.highlights, 8, 240),
      bestEarning: (Array.isArray(d.bestEarning) ? d.bestEarning : []).slice(0, 6).map((x) => ({ scheme: str(x && x.scheme, 120), why: str(x && x.why, 220), id: str(x && x.id, 30) })).filter((x) => x.scheme),
      focusModels: (Array.isArray(d.focusModels) ? d.focusModels : []).slice(0, 12).map((x) => ({ model: str(x && x.model, 50), schemes: arr(x && x.schemes, 6, 120), tip: str(x && x.tip, 200) })).filter((x) => x.model),
      deadlines: (Array.isArray(d.deadlines) ? d.deadlines : []).slice(0, 10).map((x) => ({ scheme: str(x && x.scheme, 120), date: DATE(x && x.date), note: str(x && x.note, 200) })).filter((x) => x.scheme),
      actions: arr(d.actions, 8, 220), watchouts: arr(d.watchouts, 8, 220), at: t, count: L.length };
    await store.set(key, { at: t, data: out });
    return json(200, { ok: true, digest: out });
  }

  // ---------- publishing (HO, or state publishers HO has named) ----------
  if (!(await isPub())) return json(403, { ok: false, error: "Only HO or state publishers named by HO can publish scheme letters." });
  const myState = isHO ? "" : str(rec.state, 40);
  if (b.action === "spol-up") {   // one piece of a letter file
    const name = str(b.name, 140) || "scheme", mime = str(b.mime, 120) || "application/octet-stream", total = Math.floor(Number(b.total) || 1), idx = Math.floor(Number(b.idx) || 0);
    if (total < 1 || total > CHUNKS_MAX || idx < 0 || idx >= total) return json(400, { ok: false, error: "File too large (max ~20 MB)." });
    const buf = Buffer.from(String(b.data || ""), "base64"); if (!buf.length || buf.length > CHUNK_MAX) return json(400, { ok: false, error: "Bad file piece." });
    let fid = str(b.fid, 40).replace(/[^a-z0-9]/gi, "");
    if (idx === 0) { fid = nid(t); await store.set(`spolm:${fid}`, { name, mime, size: Number(b.size) || 0, chunks: total, byKey: me, at: t }); }
    else { const m = await store.get(`spolm:${fid}`); if (!m || m.byKey !== me) return json(400, { ok: false, error: "Upload expired — try again." }); }
    await store.setBinary(`spolf:${fid}:${idx}`, buf);
    return json(200, { ok: true, fid });
  }
  if (b.action === "spol-parse") {   // AI brief of a letter (text read on the device, or pictures read here)
    const keys = await aiKeys(store, env); if (!keys.groq) return json(200, { ok: false, error: "AI key not set (Affordability → Data → Groq key)." });
    let text = String(b.text == null ? "" : b.text).slice(0, 20000), via = "";
    const imgs = (Array.isArray(b.images) ? b.images : []).filter((u) => /^data:image\/(jpeg|png|webp);base64,/.test(String(u)) && String(u).length < 3000000).slice(0, 3);
    if (imgs.length) { const v = await readImages(keys, env, imgs, f); if (v.ok) { text = String(v.text).slice(0, 20000) + (text ? "\n\n(Phone OCR, for cross-checking:)\n" + text.slice(0, 5000) : ""); via = v.model; } }
    if (text.replace(/\s/g, "").length < 30) return json(200, { ok: false, error: "No readable text in this letter.", text });
    const prompt = `You read vivo India scheme letters / policies and extract them for a scheme dashboard. TODAY is ${today}. Read the SCHEME TEXT (from a PDF, picture, Word, PowerPoint or Excel; table cells may be separated by |).
Return JSON only:
{"title":"short scheme name","period":"as written","dateFrom":"YYYY-MM-DD first day","dateTo":"YYYY-MM-DD last day (year ${today.slice(0, 4)} if not written)","category":"one of ${JSON.stringify(SPOL_CATS)}",
"audienceText":"who it applies to (e.g. All GT & ES retailers, Bihar)","summary":"3-4 plain sentences","keyPoints":["4-6 most important points"],
"targets":[{"metric":"","value":"","unit":""}],"slabs":[{"label":"","condition":"","payout":""}],"focusModels":["every model / series named"],"maxPayout":"max payout or cap if stated",
"eligibility":["who / what sales count"],"actions":["what the retailer must do"],"terms":["conditions that cut or cancel payout"],"incentiveNote":"how/when paid",
"plan":{"achLabel":"","components":[
 {"kind":"matrix","name":"","tiers":[{"label":"≥100%","min":100}],"rows":[{"name":"model or series","basis":"pct" or "perUnit","values":[one number per tier]}]},
 {"kind":"slab","name":"","models":"","basis":"pct"|"perUnit"|"flat","slabs":[{"label":"","min":units,"max":units or null,"value":number}]},
 {"kind":"band","name":"","bands":[{"label":"","value":₹ per unit}]},
 {"kind":"perUnit","name":"","models":"","value":₹ per unit}],
 "conditions":[{"label":"","factor":share paid when NOT met e.g. 0.7}]}}
Copy every payout table row exactly; plain numbers in the plan; never invent anything not in the text.
SCHEME TEXT:
${text}`;
    const r = await groqJSON(keys.groq, prompt, f, { validate: (d) => d && (d.title || d.summary) });
    if (!r.ok) return json(200, { ok: false, error: r.error, text });
    return json(200, { ok: true, brief: cleanBrief(r.data), text, via });
  }
  if (b.action === "spol-save") {
    const id0 = str(b.id, 30).replace(/[^a-z0-9]/gi, ""), old = id0 ? await store.get(`spol:${id0}`) : null;
    if (old && !canEdit(old)) return json(403, { ok: false, error: "Only HO or the publisher can change this scheme." });
    const x = b.policy || {}, a = x.audience || {};
    let audience = { scope: ["all", "states", "users"].includes(a.scope) ? a.scope : "all", states: (Array.isArray(a.states) ? a.states : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 40), users: (Array.isArray(a.users) ? a.users : []).map((u) => str(u, 80)).filter(Boolean).slice(0, 3000) };
    if (!isHO) {   // a state publisher can only publish within their own state
      if (audience.scope === "all" || audience.scope === "states") audience = { scope: "states", states: [myState], users: [] };
      else { const okUsers = new Set(); for (const k of await store.list("user:state:")) { const u = await store.get(k); if (u && low(u.state) === low(myState)) [u.username, u.vchatId, u.email].filter(Boolean).forEach((v) => okUsers.add(low(v))); } audience.users = audience.users.filter((u) => okUsers.has(low(u))); if (!audience.users.length) return json(400, { ok: false, error: "Choose users from " + myState + "." }); }
    }
    if (audience.scope === "states" && !audience.states.length) return json(400, { ok: false, error: "Choose at least one state." });
    if (audience.scope === "users" && !audience.users.length) return json(400, { ok: false, error: "Choose at least one user." });
    const files = (Array.isArray(x.files) ? x.files : []).slice(0, 10).map((y) => ({ fid: str(y && y.fid, 40).replace(/[^a-z0-9]/gi, ""), name: str(y && y.name, 140), mime: str(y && y.mime, 120), size: Number(y && y.size) || 0 })).filter((y) => y.fid);
    if (!files.length && !old) return json(400, { ok: false, error: "Attach the scheme letter." });
    const brief = cleanBrief(x.brief || (old && old.brief));
    const p = { id: old ? old.id : nid(t), title: str(x.title, 140) || brief.title || "Scheme", dateFrom: DATE(x.dateFrom) || brief.dateFrom, dateTo: DATE(x.dateTo) || brief.dateTo, category: SPOL_CATS.includes(x.category) ? x.category : brief.category || "Other",
      models: (Array.isArray(x.models) ? x.models : brief.focusModels).map((m) => str(m, 50)).filter(Boolean).slice(0, 30), audience, files: files.length ? files : old.files, brief, text: String(x.text == null ? (old ? old.text : "") : x.text).slice(0, 30000),
      status: x.status === "draft" ? "draft" : "published", disabled: old ? !!old.disabled : false, by: old ? old.by : rec.fullName || rec.username, byKey: old ? old.byKey : me, byState: old ? old.byState : isHO ? "HO" : myState, at: old ? old.at : t, updatedAt: t };
    if (!p.dateFrom || !p.dateTo) return json(400, { ok: false, error: "Add the scheme start and end dates." });
    if (p.dateTo < p.dateFrom) return json(400, { ok: false, error: "The end date is before the start date." });
    await store.set(`spol:${p.id}`, p);
    try { await ctx.logEvent(store, t, app, rec, "spol-publish", { device: p.title.slice(0, 55), ver: "" }); } catch (e) { }
    return json(200, { ok: true, item: pub(p) });
  }
  if (b.action === "spol-disable") {
    const p = await store.get(`spol:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!p) return json(404, { ok: false, error: "Not found." });
    if (!canEdit(p)) return json(403, { ok: false, error: "Only HO or the publisher can do this." });
    p.disabled = b.disabled !== false; p.updatedAt = t; await store.set(`spol:${p.id}`, p); return json(200, { ok: true, item: pub(p) });
  }
  if (b.action === "spol-revoke") {   // remove everywhere, with its files
    const p = await store.get(`spol:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!p) return json(200, { ok: true });
    if (!canEdit(p)) return json(403, { ok: false, error: "Only HO or the publisher can revoke this." });
    for (const fl of p.files || []) { const m = await store.get(`spolm:${fl.fid}`); for (let i = 0; i < ((m && m.chunks) || 1); i++) { try { await store.delete(`spolf:${fl.fid}:${i}`); } catch (e) { } } await store.delete(`spolm:${fl.fid}`); }
    await store.delete(`spol:${p.id}`); return json(200, { ok: true });
  }
  if (b.action === "spol-users") {   // audience picker
    const q = low(b.q), out = [];
    for (const k of await store.list("user:state:")) { const u = await store.get(k); if (!u || u.disabled) continue; if (!isHO && low(u.state) !== low(myState)) continue; if (b.state && low(u.state) !== low(b.state)) continue; const row = { id: u.username || u.vchatId, name: u.fullName || u.username, state: u.state || "", vchatId: u.vchatId || "" }; if (q && !(row.id + " " + row.name + " " + row.vchatId).toLowerCase().includes(q)) continue; out.push(row); if (out.length >= 300) break; }
    return json(200, { ok: true, users: out.sort((a, c) => a.state.localeCompare(c.state) || a.name.localeCompare(c.name)) });
  }
  if (b.action === "spol-users-check") {   // bulk import: which of these user names / vChat IDs exist (and may be addressed by me)
    const want = new Set((Array.isArray(b.ids) ? b.ids : []).slice(0, 20000).map(low).filter(Boolean)), found = {};
    if (want.size) for (const k of await store.list("user:state:")) {
      const u = await store.get(k); if (!u || u.disabled) continue;
      const keys = [u.username, u.vchatId, u.email, u.mobile].filter(Boolean).map(low), hit = keys.find((x) => want.has(x)); if (!hit) continue;
      const okState = isHO || low(u.state) === low(myState);
      keys.forEach((x) => { if (want.has(x)) found[x] = { id: u.username || u.vchatId, name: u.fullName || u.username, state: u.state || "", ok: okState }; });
    }
    return json(200, { ok: true, found });
  }
  if (b.action === "spol-publishers") {   // HO names the state publishers
    if (!isHO) return json(403, { ok: false, error: "Only HO can choose state publishers." });
    const c = await cfg(); if (Array.isArray(b.publishers)) { c.publishers = b.publishers.map((u) => str(u, 80)).filter(Boolean).slice(0, 200); await store.set("config:spol", c); }
    return json(200, { ok: true, publishers: c.publishers });
  }
  return json(400, { ok: false, error: "Unknown action." });
}
