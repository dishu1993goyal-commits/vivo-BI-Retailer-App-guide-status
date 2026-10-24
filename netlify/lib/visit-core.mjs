import { cleanExtra } from "./master-core.mjs";
// Market visits (beat plan): users add the store, punch in/out with GPS, fill the visit form and photos.
// Admins track all visits, score states and get Gemini analysis.
// Storage:
//   visit:<yyyymm>:<id>       one visit (id starts with yyyymm so the key can be rebuilt)
//   vopen:<app>:<userKey>     { id } the user's visit in progress
//   vstore:<state>:<slug>     store memory for suggestions { name, area, city, lat, lng, visits, lastAt }
//   config:visits             validity rules
import { randomBytes } from "node:crypto";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/,/g, "")); return v === "" || v == null || !isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100; };
const ymOf = (t) => new Date(t + 19800000).toISOString().slice(0, 7).replace("-", "");
const dayOf = (t) => new Date(t + 19800000).toISOString().slice(0, 10);
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const vKey = (id) => { const c = String(id || "").replace(/[^a-z0-9-]/gi, ""); return `visit:${c.slice(0, 6)}:${c}`; };
export const DEFAULT_RULES = { minMinutes: 10, maxDriftM: 300, minPhotos: 1, maxHours: 8 };

export function distanceM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
function geo(b) {
  const lat = Number(b && b.lat), lng = Number(b && b.lng), acc = Number(b && b.acc);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: isFinite(acc) ? Math.round(acc) : null };
}

export const STORE_FIELDS = { name: 80, area: 60, city: 60, district: 60, address: 200, retailerId: 40, owner: 60, phone: 15, type: 30, purpose: 40 };
export const FORM_TEXT = { stockModels: 300, nplNote: 500, emiNote: 500, competitorNote: 500, appFeedback: 1500, retailerFeedback: 1500, productFeedback: 1500, improvement: 1000, outcome: 1000, nextAction: 500 };
export const FORM_NUM = ["salesUnits", "salesValue", "vbaCount", "footfall"];
export const FORM_YN = ["stockIssue", "nplSupport", "emiIssue", "offersVisible"];
export const FORM_MULTI = { emiIssues: 8, competitors: 10 };
const FEEDBACK = ["appFeedback", "retailerFeedback", "productFeedback", "improvement", "outcome"];

function cleanForm(f) {
  const o = {}; f = f && typeof f === "object" ? f : {};
  for (const [k, n] of Object.entries(FORM_TEXT)) { const v = str(f[k], n); if (v) o[k] = v; }
  for (const k of FORM_NUM) { const v = num(f[k]); if (v != null) o[k] = v; }
  for (const k of FORM_YN) if (f[k] === "Yes" || f[k] === "No") o[k] = f[k];
  for (const [k, n] of Object.entries(FORM_MULTI)) if (Array.isArray(f[k])) { const a = f[k].map((x) => str(x, 40)).filter(Boolean).slice(0, n); if (a.length) o[k] = a; }
  const r = Math.round(Number(f.appRating)); if (r >= 1 && r <= 5) o.appRating = r;
  const u = str(f.appUsage, 20); if (["Daily", "Weekly", "Rarely", "Not using"].includes(u)) o.appUsage = u;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(f.followUp || ""))) o.followUp = f.followUp;
  const x = cleanExtra(f.extra); if (Object.keys(x).length) o.extra = x;
  return o;
}
// 0–100 quality score from the data itself (AI score is separate).
export function qualityScore(v, rules) {
  const f = v.form || {};
  const fields = Object.keys(FORM_TEXT).length + FORM_NUM.length + FORM_YN.length + 4;
  const filled = Object.keys(f).length;
  const fbChars = FEEDBACK.reduce((a, k) => a + String(f[k] || "").length, 0);
  return Math.round((v.valid ? 30 : v.minutes >= rules.minMinutes ? 15 : 0) + Math.min(1, (v.photos || []).length / 3) * 20 + Math.min(1, filled / (fields * 0.6)) * 30 + Math.min(1, fbChars / 300) * 20);
}
function judge(v, rules) {
  const why = [];
  if (v.minutes < rules.minMinutes) why.push(`Less than ${rules.minMinutes} min at store`);
  if (v.drift != null && v.drift > rules.maxDriftM) why.push(`Punch out ${v.drift} m from punch in`);
  if (!v.in || !v.out) why.push("Location missing");
  if ((v.photos || []).length < rules.minPhotos) why.push(`Fewer than ${rules.minPhotos} photo(s)`);
  v.valid = !why.length; v.invalidWhy = why; v.quality = qualityScore(v, rules);
  return v;
}

export async function visitAction(b, ctx) {
  const { store, t, app, rec, key, pool, who, sameUser } = ctx;
  const isAdmin = app === "admin";
  const me = who(app, rec);
  const rules = Object.assign({}, DEFAULT_RULES, (await store.get("config:visits")) || {});
  const openKey = `vopen:${app}:${key}`;
  const mine = (v) => v && v.by && sameUser(v.by, me);
  const canSee = (v) => isAdmin || mine(v);
  async function attList(ids) {
    const out = [];
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 8)) {
      const a = await store.get(`att:${String(id).replace(/[^a-z0-9]/gi, "")}`);
      if (a && sameUser(a.by, me)) out.push(a.id);
    }
    return out;
  }
  async function monthVisits(ym) { const ks = await store.list(`visit:${ym}:`); return (await pool(ks, 40, (k) => store.get(k))).filter(Boolean); }
  function monthsBetween(from, to) { const out = []; let y = +from.slice(0, 4), m = +from.slice(5, 7); const ey = +to.slice(0, 4), em = +to.slice(5, 7); while ((y < ey || (y === ey && m <= em)) && out.length < 24) { out.push(`${y}${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } } return out; }
  const okDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

  if (b.action === "visit-config") {
    if (b.set) {
      if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can change visit rules." });
      const s = b.set, n = {};
      if (num(s.minMinutes) != null) n.minMinutes = Math.min(240, Math.max(1, Math.round(num(s.minMinutes))));
      if (num(s.maxDriftM) != null) n.maxDriftM = Math.min(5000, Math.max(50, Math.round(num(s.maxDriftM))));
      if (num(s.minPhotos) != null) n.minPhotos = Math.min(6, Math.max(0, Math.round(num(s.minPhotos))));
      if (num(s.maxHours) != null) n.maxHours = Math.min(24, Math.max(1, Math.round(num(s.maxHours))));
      await store.set("config:visits", Object.assign({}, rules, n, { updatedBy: rec.username, updatedAt: t }));
      return json(200, { ok: true, rules: Object.assign({}, rules, n) });
    }
    const op = await store.get(openKey);
    const open = op ? await store.get(vKey(op.id)) : null;
    return json(200, { ok: true, now: t, rules, open: open && open.status === "open" ? open : null, me: { state: rec.state || "", app, name: rec.fullName } });
  }

  if (b.action === "visit-stores") {
    const st = isAdmin ? str(b.state, 40) : rec.state || "";
    if (!st) return json(200, { ok: true, stores: [] });
    const q = slug(b.q);
    const ks = (await store.list(`vstore:${slug(st)}:`)).filter((k) => !q || k.includes(q)).slice(0, 300);
    const rows = (await pool(ks, 40, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.lastAt - x.lastAt).slice(0, 30);
    return json(200, { ok: true, stores: rows });
  }

  if (b.action === "visit-start") {
    const cur = await store.get(openKey);
    if (cur) { const cv = await store.get(vKey(cur.id)); if (cv && cv.status === "open") return json(409, { ok: false, error: "You already have a visit in progress. Punch out of it first.", open: cv }); }
    const s = {}; const inS = b.store || {};
    for (const [k, n] of Object.entries(STORE_FIELDS)) { const v = str(inS[k], n); if (v) s[k] = v; }
    if (!s.name || s.name.length < 2) return json(400, { ok: false, error: "Enter the store name.", field: "name" });
    if (!s.area) return json(400, { ok: false, error: "Enter the area / market.", field: "area" });
    if (!s.city) return json(400, { ok: false, error: "Enter the town / city.", field: "city" });
    s.state = isAdmin ? str(inS.state, 40) : rec.state || "";
    if (!s.state) return json(400, { ok: false, error: "Choose the state.", field: "state" });
    const g = geo(b.geo);
    if (!g) return json(400, { ok: false, error: "Location is needed to punch in. Allow location access and try again.", field: "geo" });
    const sk = `vstore:${slug(s.state)}:${slug(s.name + " " + s.area)}`;
    const known = await store.get(sk);
    const id = ymOf(t) + "-" + t.toString(36) + randomBytes(3).toString("hex");
    const v = { id, status: "open", by: Object.assign({}, me, { phone: rec.phone || "", designation: rec.designation || "" }), state: s.state, store: s,
      in: Object.assign({ t }, g), storeDistance: known && known.lat != null ? distanceM(g, known) : null, repeat: !!known, form: {}, photos: [], createdAt: t, device: str(b.device, 60), via: str(b.via, 10) };
    await store.set(vKey(id), v);
    await store.set(openKey, { id });
    return json(200, { ok: true, visit: v, rules, now: t });
  }

  const v = b.id ? await store.get(vKey(b.id)) : null;

  if (b.action === "visit-save" || b.action === "visit-end") {
    if (!v || !mine(v)) return json(404, { ok: false, error: "Visit not found." });
    if (v.status !== "open") return json(400, { ok: false, error: "This visit is already closed." });
    v.form = cleanForm(b.form);
    v.photos = await attList(b.photos);
    if (b.action === "visit-save") { v.savedAt = t; await store.set(vKey(v.id), v); return json(200, { ok: true, visit: v }); }
    const g = geo(b.geo);
    if (!g) return json(400, { ok: false, error: "Location is needed to punch out. Allow location access and try again.", field: "geo" });
    const required = [];
    if (!v.form.appFeedback && !v.form.retailerFeedback && !v.form.productFeedback) required.push("at least one feedback");
    if (v.photos.length < rules.minPhotos) required.push(`${rules.minPhotos} photo(s)`);
    if (required.length && b.force !== true) return json(400, { ok: false, error: "Please add " + required.join(" and ") + " before punching out.", missing: required });
    v.out = Object.assign({ t }, g); v.status = "closed"; v.closedAt = t;
    v.minutes = Math.round((t - v.in.t) / 60000);
    v.drift = distanceM(v.in, v.out);
    judge(v, rules);
    await store.set(vKey(v.id), v);
    await store.delete(openKey);
    const sk = `vstore:${slug(v.state)}:${slug(v.store.name + " " + v.store.area)}`;
    const known = (await store.get(sk)) || { name: v.store.name, area: v.store.area, city: v.store.city, district: v.store.district || "", retailerId: v.store.retailerId || "", lat: v.in.lat, lng: v.in.lng, visits: 0, firstAt: t };
    Object.assign(known, { visits: (known.visits || 0) + 1, lastAt: t, lastBy: rec.fullName });
    await store.set(sk, known);
    await ctx.logEvent(store, t, app, rec, "market-visit", { device: v.store.name.slice(0, 40) + " · " + v.minutes + " min", ver: "" });
    return json(200, { ok: true, visit: v });
  }

  if (b.action === "visit-cancel") {
    if (!v || !(mine(v) || isAdmin)) return json(404, { ok: false, error: "Visit not found." });
    if (v.status === "open" && mine(v)) await store.delete(openKey);
    if (v.status !== "open" && !isAdmin) return json(403, { ok: false, error: "Only an admin can delete a finished visit." });
    await store.delete(vKey(v.id));
    return json(200, { ok: true });
  }

  if (b.action === "visit-get") {
    if (!v || !canSee(v)) return json(404, { ok: false, error: "Visit not found." });
    return json(200, { ok: true, visit: v, rules });
  }

  if (b.action === "visit-list") {
    const to = okDay(b.to) ? b.to : dayOf(t), from = okDay(b.from) ? b.from : to.slice(0, 8) + "01";
    let rows = [];
    for (const ym of monthsBetween(from, to)) rows = rows.concat(await monthVisits(ym));
    rows = rows.filter((x) => { const d = dayOf(x.in.t); return d >= from && d <= to; });
    if (!isAdmin) rows = rows.filter(mine);
    else {
      if (b.state) rows = rows.filter((x) => x.state === b.state);
      if (b.user) rows = rows.filter((x) => x.by.username.toLowerCase() === String(b.user).toLowerCase());
    }
    // Visits left open too long show as "not punched out".
    rows.forEach((x) => { if (x.status === "open" && t - x.in.t > rules.maxHours * 3600000) x.stale = true; });
    rows.sort((x, y) => y.in.t - x.in.t);
    return json(200, { ok: true, visits: rows.slice(0, 3000), from, to, rules, truncated: rows.length > 3000 });
  }

  // ---------- Admin only ----------
  if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can do this." });

  if (b.action === "visit-live") {
    const ks = await store.list("vopen:");
    const rows = (await pool(ks, 40, async (k) => { const o = await store.get(k); return o ? store.get(vKey(o.id)) : null; })).filter((x) => x && x.status === "open");
    rows.forEach((x) => { x.stale = t - x.in.t > rules.maxHours * 3600000; });
    return json(200, { ok: true, visits: rows.sort((x, y) => y.in.t - x.in.t) });
  }

  if (b.action === "visit-stats") {
    const to = okDay(b.to) ? b.to : dayOf(t), from = okDay(b.from) ? b.from : to.slice(0, 8) + "01";
    let rows = [];
    for (const ym of monthsBetween(from, to)) rows = rows.concat(await monthVisits(ym));
    rows = rows.filter((x) => { const d = dayOf(x.in.t); return d >= from && d <= to && x.status === "closed"; });
    const uks = await store.list("user:state:");
    const users = (await pool(uks, 40, (k) => store.get(k))).filter((u) => u && !u.disabled);
    const reg = {}; users.forEach((u) => { if (u.state) reg[u.state] = (reg[u.state] || 0) + 1; });
    const by = {};
    rows.forEach((x) => {
      const s = by[x.state] = by[x.state] || { state: x.state, visits: 0, valid: 0, minutes: 0, quality: 0, ai: 0, aiN: 0, photos: 0, people: {}, stores: {}, stock: 0, npl: 0, emi: 0, adminVisits: 0 };
      s.visits++; if (x.valid) s.valid++; s.minutes += x.minutes || 0; s.quality += x.quality || 0; s.photos += (x.photos || []).length;
      if (x.ai && x.ai.score) { s.ai += x.ai.score; s.aiN++; }
      if (x.by.app === "admin") s.adminVisits++; else s.people[x.by.username.toLowerCase()] = 1;
      s.stores[slug(x.store.name + " " + x.store.area)] = 1;
      if (x.form.stockIssue === "Yes") s.stock++; if (x.form.nplSupport === "Yes") s.npl++; if (x.form.emiIssue === "Yes") s.emi++;
    });
    const list = Object.values(by).map((s) => {
      const people = Object.keys(s.people).length, stateVisits = s.visits - s.adminVisits;
      return { state: s.state, visits: s.visits, stateVisits, adminVisits: s.adminVisits, valid: s.valid, validPct: s.visits ? Math.round(s.valid / s.visits * 100) : 0,
        avgMinutes: s.visits ? Math.round(s.minutes / s.visits) : 0, avgQuality: s.visits ? Math.round(s.quality / s.visits) : 0, avgAi: s.aiN ? Math.round(s.ai / s.aiN * 10) / 10 : null, aiScored: s.aiN,
        photos: s.photos, people, registered: reg[s.state] || 0, coveragePct: reg[s.state] ? Math.round(Math.min(1, people / reg[s.state]) * 100) : 0,
        perPerson: people ? Math.round(stateVisits / people * 10) / 10 : 0, stores: Object.keys(s.stores).length, stockIssues: s.stock, nplNeeds: s.npl, emiIssues: s.emi };
    });
    // State score (0–100): activity 40 (visits per person vs best state), quality 25, valid % 20, team coverage 15.
    const bestPer = Math.max(1, ...list.map((s) => s.perPerson));
    list.forEach((s) => { s.score = Math.round(40 * Math.min(1, s.perPerson / bestPer) + 0.25 * s.avgQuality + 0.20 * s.validPct + 0.15 * s.coveragePct); });
    list.sort((x, y) => y.score - x.score);
    Object.keys(reg).forEach((st) => { if (!list.some((s) => s.state === st)) list.push({ state: st, visits: 0, stateVisits: 0, adminVisits: 0, valid: 0, validPct: 0, avgMinutes: 0, avgQuality: 0, avgAi: null, aiScored: 0, photos: 0, people: 0, registered: reg[st], coveragePct: 0, perPerson: 0, stores: 0, stockIssues: 0, nplNeeds: 0, emiIssues: 0, score: 0 }); });
    const last = await store.get("vai:last");
    return json(200, { ok: true, from, to, states: list, total: rows.length, lastAi: last || null, rules });
  }

  if (b.action === "visit-ai-one" || b.action === "visit-ai-states") {
    if (!ctx.env.GEMINI_API_KEY) return json(400, { ok: false, error: "AI is not set up yet." });
    const ck = `aiv:${dayOf(t)}:${key}`, used = ((await store.get(ck)) || { n: 0 }).n;
    if (used >= 400) return json(429, { ok: false, error: "Daily AI limit for visit analysis reached. Try again tomorrow." });
    if (b.action === "visit-ai-one") {
      if (!v || v.status !== "closed") return json(404, { ok: false, error: "Visit not found." });
      const f = v.form || {};
      const ctxText = [`State: ${v.state}`, `Store: ${v.store.name}, ${v.store.area}, ${v.store.city} (${v.store.type || "retailer"})`, `Visitor: ${v.by.fullName} (${v.by.app === "admin" ? "HO admin" : "state BI"})`,
        `Time at store: ${v.minutes} min; valid: ${v.valid ? "yes" : "no (" + v.invalidWhy.join("; ") + ")"}; photos: ${v.photos.length}`,
        `Monthly sales: ${f.salesUnits ?? "-"} units, Rs ${f.salesValue ?? "-"}; VBA promoters: ${f.vbaCount ?? "-"}; footfall/day: ${f.footfall ?? "-"}`,
        `Stock issue: ${f.stockIssue || "-"} ${f.stockModels || ""}; NPL support needed: ${f.nplSupport || "-"} ${f.nplNote || ""}; EMI issue: ${f.emiIssue || "-"} ${(f.emiIssues || []).join(", ")} ${f.emiNote || ""}`,
        `Offers visible: ${f.offersVisible || "-"}; competitors: ${(f.competitors || []).join(", ")} ${f.competitorNote || ""}`,
        `Retailer app usage: ${f.appUsage || "-"}; app rating: ${f.appRating || "-"}/5; feedback on our system & apps: ${f.appFeedback || "-"}`,
        `Retailer feedback: ${f.retailerFeedback || "-"}`, `Product feedback: ${f.productFeedback || "-"}`, `Improvement areas: ${f.improvement || "-"}`, `Outcome: ${f.outcome || "-"}; next action: ${f.nextAction || "-"}`].join("\n");
      const sys = `You review market (store) visit reports from vivo India's state BI teams. Score how useful and thorough the visit was for HO (1-10): depth and specificity of feedback (especially on vivo's systems and apps), clear issues raised, actions agreed, data filled, evidence (photos, valid time). Reply ONLY with compact JSON: {"score":n,"summary":"<= 45 words","issues":["short tag", ...max 4],"sentiment":"positive|neutral|negative"}.`;
      const r = await ctx.askAI(ctx.env, "Score this visit.", ctxText, [], ctx.aiFetch, { system: sys, label: "VISIT" });
      if (!r.ok) return json(502, r);
      await store.set(ck, { n: used + 1 });
      let j = null; try { j = JSON.parse((r.text.match(/\{[\s\S]*\}/) || [""])[0]); } catch { j = null; }
      if (!j || !(Number(j.score) >= 1)) return json(502, { ok: false, error: "AI reply couldn't be read. Try again." });
      v.ai = { score: Math.max(1, Math.min(10, Math.round(Number(j.score)))), summary: str(j.summary, 400), issues: (Array.isArray(j.issues) ? j.issues : []).map((x) => str(x, 40)).slice(0, 4), sentiment: str(j.sentiment, 10), at: t };
      await store.set(vKey(v.id), v);
      return json(200, { ok: true, ai: v.ai });
    }
    const ctxText = String(b.context || "").slice(0, 14000);
    const sys = `You are the HO analyst for vivo India's Business Innovation team. State BI teams visit stores to collect feedback on vivo's systems and apps, stock, promoters (VBA), EMI and offers. Using ONLY the VISIT DATA, write for the HO admin, plain text, under 350 words:
1) "State scores (out of 10):" one line per state — score, then a 6-10 word reason (activity, data quality, feedback depth).
2) "What the field is saying:" 3-5 bullets ("- ") on recurring feedback about our systems/apps, stock, EMI, competition.
3) "States needing attention:" 1-3 bullets.
4) "Actions for HO:" 3-4 specific bullets.
No disclaimers.`;
    const r = await ctx.askAI(ctx.env, String(b.question || "Analyse and score the states.").slice(0, 300), ctxText, [], ctx.aiFetch, { system: sys, label: "VISIT DATA" });
    if (!r.ok) return json(502, r);
    await store.set(ck, { n: used + 1 });
    const last = { text: r.text, at: t, by: rec.fullName, from: str(b.from, 10), to: str(b.to, 10) };
    await store.set("vai:last", last);
    return json(200, { ok: true, ...last });
  }

  return json(400, { ok: false, error: "Unknown action" });
}
