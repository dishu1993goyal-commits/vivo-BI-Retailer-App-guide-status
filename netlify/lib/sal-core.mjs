// Salary & incentives for state sales employees. HO sets company-wide structures / plans; each state can add its own.
// Monthly: attendance + sales + adjustments → Calculate (draft) → Publish → employees see the break-up and payslips
// through their own secure link (checked with the last 4 digits of their mobile). Salary credit: 1st of next month,
// incentive: 15 days later (configurable). The engine is salcalc-core.mjs (same file the page uses).
//   sal:cfg:HO | sal:cfg:<state>   {structures, plans, settings}
//   sal:emp:<state> {list}   sal:in:<state>:<yyyy-mm> {att, sales, adj}   sal:run:<state>:<yyyy-mm> {status, rows}
//   sallink:<token> {state, code, fails, lockUntil}
import { randomBytes } from "node:crypto";
import { STRUCTURES, PLANS, compute } from "./salcalc-core.mjs";
import { STATES } from "./cmp-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const code = (v) => String(v || "").trim().replace(/[^A-Za-z0-9_\-\/]/g, "").slice(0, 30);
const mon = (v) => (/^\d{4}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const skey = (s) => String(s || "").replace(/[^A-Za-z0-9 &\-]/g, "").trim().slice(0, 50);
const clone = (o) => JSON.parse(JSON.stringify(o));
const SIZE = 400000;

// the HO library starts as a copy of the ready-made structures and plans
function seedHO() { return { structures: STRUCTURES.map((x) => Object.assign(clone(x), { id: "ho-" + x.id, scope: "HO" })), plans: PLANS.map((x) => Object.assign(clone(x), { id: "ho-" + x.id, scope: "HO" })), settings: { salDay: 1, incDelay: 15 } }; }
const cleanEmp = (x, state) => ({ code: code(x.code), name: str(x.name, 80), state, city: str(x.city, 60), role: str(x.role, 60) || "Sales promoter", doj: str(x.doj, 10), mobile: String(x.mobile || "").replace(/\D/g, "").slice(-10), gross: num(x.gross), ctc: num(x.ctc), dailyRate: num(x.dailyRate), ti: num(x.ti), insurance: num(x.insurance), otherAnnual: num(x.otherAnnual), struct: str(x.struct, 40), plan: str(x.plan, 40), uan: str(x.uan, 20), pan: str(x.pan, 12).toUpperCase(), bank: String(x.bank || "").replace(/\D/g, "").slice(-4), ifsc: str(x.ifsc, 15).toUpperCase(), store: str(x.store, 80), active: x.active !== false && !/^(no|inactive|left|0)$/i.test(String(x.active)) });

export async function salAction(b, ctx) {
  const { store, t, app, rec } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "";
  const myState = isHO ? "" : skey(rec.state);
  const stOf = (s) => (isHO ? skey(s) : myState);
  const getCfg = async (scope) => { const k = "sal:cfg:" + (scope || "HO"); let c = await store.get(k); if (!c && scope === "HO") { c = seedHO(); await store.set(k, c); } return c || { structures: [], plans: [], settings: {} }; };
  const merged = async (state) => { const H = await getCfg("HO"), S = state ? await getCfg(state) : { structures: [], plans: [], settings: {} };
    return { structures: H.structures.concat(S.structures || []), plans: H.plans.concat(S.plans || []), settings: Object.assign({ salDay: 1, incDelay: 15 }, H.settings || {}, S.settings || {}), hoSettings: H.settings || {} }; };
  const emps = async (state) => (await store.get("sal:emp:" + state)) || { list: [] };

  if (b.action === "sal-boot") {
    const L = await store.list("sal:emp:"), states = isHO ? [...new Set(STATES.concat(L.map((k) => k.slice(8))))].sort() : [myState];
    return json(200, { ok: true, me: { isHO, state: myState, name: by }, states, cfg: await merged(isHO ? skey(b.state) : myState) });
  }
  if (b.action === "sal-cfg-get") return json(200, { ok: true, cfg: await merged(stOf(b.state)) });
  if (b.action === "sal-cfg-save") {   // HO edits the HO library; a state edits only its own additions
    const scope = isHO && (!b.scope || b.scope === "HO") ? "HO" : stOf(b.scope || b.state); if (!scope) return json(400, { ok: false, error: "Pick the state." });
    const C = await getCfg(scope), pre = scope === "HO" ? "ho-" : "st-";
    const fix = (L) => (Array.isArray(L) ? L : []).slice(0, 40).map((x) => Object.assign(clone(x), { id: String(x.id || "").startsWith(pre) ? String(x.id).slice(0, 40) : pre + (Date.now().toString(36) + randomBytes(2).toString("hex")), scope, name: str(x.name, 100) || "Untitled", by, at: t }));
    if (b.structures) C.structures = fix(b.structures); if (b.plans) C.plans = fix(b.plans);
    if (b.settings) C.settings = { salDay: Math.max(1, Math.min(28, num(b.settings.salDay) || 1)), incDelay: Math.max(0, Math.min(60, num(b.settings.incDelay) || 15)) };
    if (JSON.stringify(C).length > SIZE) return json(400, { ok: false, error: "Too many rules — keep each library under 40 items." });
    await store.set("sal:cfg:" + scope, C); return json(200, { ok: true, cfg: await merged(scope === "HO" ? skey(b.state) : scope) });
  }

  // ---------- employees ----------
  if (b.action === "sal-emp-list") { const st = stOf(b.state); if (!st) return json(400, { ok: false, error: "Pick the state." }); return json(200, { ok: true, list: (await emps(st)).list }); }
  if (b.action === "sal-emp-save") {
    const st = stOf(b.state || (b.emp || {}).state); if (!st) return json(400, { ok: false, error: "Pick the state." });
    const E = await emps(st), e = cleanEmp(b.emp || {}, st); if (!e.code || !e.name) return json(400, { ok: false, error: "Employee code and name are needed." });
    const old = E.list.find((x) => x.code === e.code); if (old) e.token = old.token; E.list = E.list.filter((x) => x.code !== e.code).concat([e]);
    await store.set("sal:emp:" + st, E); return json(200, { ok: true, emp: e });
  }
  if (b.action === "sal-emp-import") {
    const st = stOf(b.state); if (!st) return json(400, { ok: false, error: "Pick the state." });
    const E = await emps(st), M = {}; E.list.forEach((x) => { M[x.code] = x; }); let n = 0;
    (b.rows || []).slice(0, 5000).forEach((x) => { const e = cleanEmp(x, st); if (!e.code || !e.name) return; const o = M[e.code]; if (o) { e.token = o.token; ["struct", "plan"].forEach((k) => { if (!e[k]) e[k] = o[k]; }); } M[e.code] = e; n++; });
    E.list = Object.values(M); if (JSON.stringify(E).length > 4000000) return json(400, { ok: false, error: "Too many employees for one state." });
    await store.set("sal:emp:" + st, E); return json(200, { ok: true, n, total: E.list.length });
  }
  if (b.action === "sal-emp-del") { const st = stOf(b.state), E = await emps(st); const e = E.list.find((x) => x.code === code(b.code)); if (!e) return json(404, { ok: false, error: "Not found." }); e.active = false; await store.set("sal:emp:" + st, E); return json(200, { ok: true }); }

  // ---------- monthly inputs ----------
  if (b.action === "sal-in-get") { const st = stOf(b.state), m = mon(b.month); if (!st || !m) return json(400, { ok: false, error: "Pick state and month." }); return json(200, { ok: true, inp: (await store.get(`sal:in:${st}:${m}`)) || { att: {}, sales: {}, adj: {} } }); }
  if (b.action === "sal-in-save") {   // merge rows of any of the three sheets
    const st = stOf(b.state), m = mon(b.month); if (!st || !m) return json(400, { ok: false, error: "Pick state and month." });
    const run = await store.get(`sal:run:${st}:${m}`); if (run && run.status === "published") return json(400, { ok: false, error: "This month is published — unpublish it first to change inputs." });
    const k = `sal:in:${st}:${m}`, I = (await store.get(k)) || { att: {}, sales: {}, adj: {} };
    const A = (o) => ({ present: num(o.present), paidLeave: num(o.paidLeave), weekOff: num(o.weekOff), holiday: num(o.holiday), lop: num(o.lop), fieldDays: num(o.fieldDays), extraDays: num(o.extraDays) });
    const S = (o) => { const fin = {}, models = {}, vars = {}; Object.keys(o.fin || {}).slice(0, 30).forEach((f) => { if (num(o.fin[f])) fin[str(f, 40)] = num(o.fin[f]); }); Object.keys(o.models || {}).slice(0, 80).forEach((f) => { if (num(o.models[f])) models[str(f, 40)] = num(o.models[f]); }); Object.keys(o.vars || {}).slice(0, 20).forEach((f) => { const kk = String(f).replace(/\W+/g, "_").slice(0, 30); if (kk) vars[kk] = num(o.vars[f]); });
      return { target: num(o.target), units: num(o.units), value: num(o.value), valueTarget: num(o.valueTarget), vshield: num(o.vshield), emi: num(o.emi), fin, models, vars }; };
    const D = (o) => ({ advance: num(o.advance), otherDed: num(o.otherDed), services: num(o.services), arrears: num(o.arrears), otherEarn: num(o.otherEarn), tds: num(o.tds), incDed: num(o.incDed), remark: str(o.remark, 120) });
    let n = 0; [["att", A], ["sales", S], ["adj", D]].forEach(([sh, fn]) => { const R = b[sh]; if (!R) return; if (b.replace) I[sh] = {}; Object.keys(R).slice(0, 5000).forEach((c) => { const cc = code(c); if (cc) { I[sh][cc] = fn(R[c] || {}); n++; } }); });
    I.at = t; I.by = by; if (JSON.stringify(I).length > 4000000) return json(400, { ok: false, error: "Too much data for one month." });
    await store.set(k, I); return json(200, { ok: true, n });
  }

  // ---------- calculate / publish ----------
  if (b.action === "sal-run") {
    const st = stOf(b.state), m = mon(b.month); if (!st || !m) return json(400, { ok: false, error: "Pick state and month." });
    const old = await store.get(`sal:run:${st}:${m}`); if (old && old.status === "published") return json(400, { ok: false, error: "Already published — unpublish to recalculate." });
    const [E, I, C] = await Promise.all([emps(st), store.get(`sal:in:${st}:${m}`), merged(st)]), inp = I || { att: {}, sales: {}, adj: {} };
    const SM = {}, PM = {}; C.structures.forEach((x) => { SM[x.id] = x; }); C.plans.forEach((x) => { PM[x.id] = x; });
    const rows = {}, warn = [];
    E.list.filter((e) => e.active !== false).forEach((e) => { const s = SM[e.struct], p = PM[e.plan]; if (!s) warn.push(e.code + ": no salary structure"); if (!p) warn.push(e.code + ": no incentive plan");
      try { const r = compute(e, s, p, { att: inp.att[e.code], sales: inp.sales[e.code], adj: inp.adj[e.code] }, m, C.settings); r.emp = { code: e.code, name: e.name, role: e.role, city: e.city, store: e.store, doj: e.doj, uan: e.uan, pan: e.pan ? e.pan.slice(0, 2) + "XXXXX" + e.pan.slice(-3) : "", bank: e.bank, ifsc: e.ifsc, gross: e.gross, ti: e.ti }; r.structName = s ? s.name : ""; r.planName = p ? p.name : ""; r.planSnap = p ? clone(p) : null; rows[e.code] = r; }
      catch (x) { warn.push(e.code + ": " + x.message); } });
    const R = Object.values(rows), tot = { n: R.length, gross: R.reduce((a, r) => a + (r.salary ? r.salary.gross : 0), 0), salNet: R.reduce((a, r) => a + (r.salary ? r.salary.net : 0), 0), incNet: R.reduce((a, r) => a + (r.incentive ? r.incentive.net : 0), 0), ded: R.reduce((a, r) => a + (r.salary ? r.salary.totalDed : 0), 0), employer: R.reduce((a, r) => a + (r.salary ? r.salary.employer.reduce((x, y) => x + y.amt, 0) : 0), 0) };
    const run = { state: st, month: m, status: "draft", at: t, by, rows, tot, warn: warn.slice(0, 100), settings: C.settings };
    if (JSON.stringify(run).length > 4500000) return json(400, { ok: false, error: "Too many employees to calculate at once." });
    await store.set(`sal:run:${st}:${m}`, run); return json(200, { ok: true, run });
  }
  if (b.action === "sal-run-get") { const st = stOf(b.state), m = mon(b.month); return json(200, { ok: true, run: (await store.get(`sal:run:${st}:${m}`)) || null }); }
  if (b.action === "sal-months") { const st = stOf(b.state), L = await store.list(`sal:run:${st}:`), out = []; for (const k of L.slice(-24)) { const r = await store.get(k); if (r) out.push({ month: r.month, status: r.status, n: r.tot.n, salNet: r.tot.salNet, incNet: r.tot.incNet, at: r.pubAt || r.at }); } return json(200, { ok: true, months: out.sort((a, c) => (a.month < c.month ? 1 : -1)) }); }
  if (b.action === "sal-publish") {
    const st = stOf(b.state), m = mon(b.month), k = `sal:run:${st}:${m}`, r = await store.get(k); if (!r) return json(400, { ok: false, error: "Calculate first." });
    r.status = b.undo ? "draft" : "published"; if (!b.undo) { r.pubAt = t; r.pubBy = by; } await store.set(k, r); return json(200, { ok: true, status: r.status });
  }
  // employee links: one secure link each (re-used), opened with the last 4 digits of their mobile
  if (b.action === "sal-links") {
    const st = stOf(b.state), E = await emps(st), only = Array.isArray(b.codes) ? b.codes.map(code) : null, out = []; let ch = false;
    for (const e of E.list) { if (e.active === false || (only && !only.includes(e.code))) continue; if (!e.token) { e.token = randomBytes(12).toString("hex"); ch = true; await store.set("sallink:" + e.token, { state: st, code: e.code, at: t }); } out.push({ code: e.code, name: e.name, mobile: e.mobile, token: e.token }); }
    if (ch) await store.set("sal:emp:" + st, E); return json(200, { ok: true, links: out });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// ---------- employee view (no login): secure link + last 4 digits of the registered mobile ----------
export async function salPublic(b, ctx) {
  const { store, t } = ctx, tok = String(b.token || "").replace(/[^a-f0-9]/g, "").slice(0, 40);
  const L = tok ? await store.get("sallink:" + tok) : null; if (!L) return json(404, { ok: false, error: "This link isn't valid — ask your state BI team for a new one." });
  if (L.lockUntil && L.lockUntil > t) return json(429, { ok: false, error: "Too many wrong tries — try again in an hour." });
  const E = (await store.get("sal:emp:" + L.state)) || { list: [] }, e = E.list.find((x) => x.code === L.code); if (!e || e.active === false) return json(404, { ok: false, error: "This link is no longer active." });
  const pin = String(b.pin || "").replace(/\D/g, "");
  if (!e.mobile || pin !== e.mobile.slice(-4)) { L.fails = (L.fails || 0) + 1; if (L.fails >= 8) { L.lockUntil = t + 36e5; L.fails = 0; } await store.set("sallink:" + tok, L); return json(403, { ok: false, need: "pin", error: pin ? "That doesn't match — enter the last 4 digits of your registered mobile." : "Enter the last 4 digits of your registered mobile." }); }
  if (L.fails) { L.fails = 0; await store.set("sallink:" + tok, L); }
  const keys = (await store.list(`sal:run:${L.state}:`)).slice(-12), months = [];
  for (const k of keys) { const r = await store.get(k); if (r && r.status === "published" && r.rows[e.code]) months.push(Object.assign({}, r.rows[e.code], { pubAt: r.pubAt })); }
  return json(200, { ok: true, emp: { code: e.code, name: e.name, role: e.role, state: L.state, city: e.city, store: e.store, doj: e.doj }, months: months.sort((a, c) => (a.month < c.month ? 1 : -1)) });
}
