// Studio Pro: tools with formulas, lookups into existing tools, conditional fields, and rule-based approval flows with
// a role directory and TAT escalation. Used by master-core.mjs for tools saved with tool.pro = true (older tools keep
// the simple engine). The same formula engine runs in the browser (formula.js) so users see results live; the server
// recomputes everything on submit, so a calculated amount or an approval route can't be faked.
//
// Flow (tool.flow, version 2):
//   steps: [{ id, name, when, approver:{ type:"role"|"users"|"field"|"submitter"|"group", role, scope:"submitterState"|"fieldState"|"any",
//             stateField, areaField, users[], field, group:"state"|"admin"|"master" }, mode:"any"|"all", tatHours,
//             escalate:{ type, role, users[], group, scope }, autoApproveIf, routes:[{ if, goto }], onReject:"end"|"back"|<stepId> }]
//   A step is skipped when `when` is false. After an approval, the first route whose `if` is true decides the next step
//   ("end" finishes as approved); with no matching route the next step in the list follows.
// Submission (ctsub:<tool>:<id>) adds: cur:{ id, idx, approvers[], done[], enteredAt, dueAt, escalated }, trail[] of steps visited.
// Role directory: config:roledir { roles:[…], rows:[{ role, state, area, users:[…] }] }
import { evaluate, truthy, computeAll, test as fxTest } from "./formula-core.mjs";
import { randomBytes } from "node:crypto";
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const keyOf = (v) => str(v, 30).replace(/[^a-z0-9_]/gi, "");
const num = (v) => (v === "" || v == null || !isFinite(Number(v)) ? null : Number(v));
const low = (x) => String(x || "").trim().toLowerCase();
export const PRO_TYPES = ["text", "longtext", "number", "currency", "date", "time", "datetime", "select", "multi", "yesno", "checkbox", "rating", "scale",
  "email", "phone", "photo", "location", "heading", "image", "calc", "lookup", "table", "user"];
const NOVALUE = ["heading", "image"];
export const LOOKUP_SOURCES = { retailer: "Retailer (payouts / portal)", user: "User (state / HO)", product: "vivo model (Affordability price)", scheme: "Scheme policy", tool: "Another Studio tool's entries" };
const APPROVER_TYPES = ["role", "users", "field", "submitter", "group"];

function cleanExpr(v) { return str(v, 600); }
export function cleanProFields(a) {
  return (Array.isArray(a) ? a : []).slice(0, 120).map((f, i) => {
    const type = PRO_TYPES.includes(f.type) ? f.type : "text";
    const o = { key: keyOf(f.key) || "f" + i + randomBytes(2).toString("hex"), label: str(f.label, 140), type,
      options: (Array.isArray(f.options) ? f.options : String(f.options || "").split(/\n/)).map((x) => str(x, 100)).filter(Boolean).slice(0, 80),
      required: f.required === true && !NOVALUE.includes(type) && type !== "calc", help: str(f.help, 400), placeholder: str(f.placeholder, 140) };
    if (num(f.min) != null) o.min = num(f.min); if (num(f.max) != null) o.max = num(f.max);
    ["showIf", "requiredIf", "readonlyIf", "default"].forEach((k) => { if (f[k]) o[k] = cleanExpr(f[k]); });
    if (type === "calc") { o.formula = cleanExpr(f.formula); o.decimals = num(f.decimals) == null ? null : Math.max(0, Math.min(6, num(f.decimals))); o.format = ["number", "currency", "percent", "text", "date"].includes(f.format) ? f.format : "number"; }
    if (type === "heading") { o.text = str(f.text, 3000); o.newPage = f.newPage === true; }
    if (type === "heading" || type === "image") o.image = str(f.image, 30).replace(/[^a-z0-9]/gi, "");
    if (type === "lookup") { const l = f.lookup || {}; o.lookup = { source: LOOKUP_SOURCES[l.source] ? l.source : "retailer", tool: str(l.tool, 30).replace(/[^a-z0-9]/gi, ""), match: keyOf(l.match), show: (Array.isArray(l.show) ? l.show : String(l.show || "").split(/[,\n]/)).map((x) => str(x, 40)).filter(Boolean).slice(0, 12) }; }
    if (type === "table") { o.columns = (Array.isArray(f.columns) ? f.columns : []).slice(0, 12).map((c, j) => ({ key: keyOf(c.key) || "c" + j, label: str(c.label, 60), type: ["text", "number", "currency", "select", "date"].includes(c.type) ? c.type : "text", options: (Array.isArray(c.options) ? c.options : String(c.options || "").split(/\n/)).map((x) => str(x, 60)).filter(Boolean).slice(0, 40), formula: cleanExpr(c.formula), required: c.required === true })).filter((c) => c.label); o.minRows = Math.max(0, Math.min(50, num(f.minRows) || 0)); o.maxRows = Math.max(1, Math.min(100, num(f.maxRows) || 20)); }
    if (type === "user") o.userScope = ["any", "sameState", "admins"].includes(f.userScope) ? f.userScope : "any";
    if (type === "currency") o.unit = "₹";
    o.validations = (Array.isArray(f.validations) ? f.validations : []).slice(0, 6).map((v) => ({ rule: cleanExpr(v.rule), msg: str(v.msg, 160) })).filter((v) => v.rule);
    return o;
  }).filter((f) => f.label || f.type === "image" || (f.type === "heading" && (f.text || f.image)));
}
function cleanApprover(a) {
  a = a || {};
  return { type: APPROVER_TYPES.includes(a.type) ? a.type : "role", role: str(a.role, 60), scope: ["submitterState", "fieldState", "any"].includes(a.scope) ? a.scope : "submitterState",
    stateField: keyOf(a.stateField), areaField: keyOf(a.areaField), field: keyOf(a.field), group: ["state", "admin", "master"].includes(a.group) ? a.group : "admin",
    users: (Array.isArray(a.users) ? a.users : String(a.users || "").split(/[\s,;]+/)).map((u) => str(u, 80)).filter(Boolean).slice(0, 200) };
}
export function cleanProFlow(x) {
  x = x || {};
  const steps = (Array.isArray(x.steps) ? x.steps : []).slice(0, 15).map((s, i) => ({ id: keyOf(s.id) || "s" + (i + 1), name: str(s.name, 60) || "Step " + (i + 1), when: cleanExpr(s.when), approver: cleanApprover(s.approver),
    mode: s.mode === "all" ? "all" : "any", tatHours: Math.max(0, Math.min(2160, Number(s.tatHours) || 0)), escalate: s.escalate && (s.escalate.type || s.escalate.role || (s.escalate.users || []).length) ? cleanApprover(s.escalate) : null,
    autoApproveIf: cleanExpr(s.autoApproveIf), routes: (Array.isArray(s.routes) ? s.routes : []).slice(0, 10).map((r) => ({ if: cleanExpr(r.if), goto: keyOf(r.goto) || "end" })).filter((r) => r.if),
    onReject: str(s.onReject, 30).replace(/[^a-z0-9_]/gi, "") || "end", note: str(s.note, 300) }));
  const ids = new Set(steps.map((s) => s.id));
  steps.forEach((s) => { s.routes = s.routes.filter((r) => r.goto === "end" || r.goto === "next" || ids.has(r.goto)); if (!["end", "back"].includes(s.onReject) && !ids.has(s.onReject)) s.onReject = "end"; });
  return { version: 2, steps, allowResubmit: x.allowResubmit !== false, notifySubmitter: x.notifySubmitter !== false };
}
export function cleanProTool(tl) {
  return { fields: cleanProFields(tl.fields), flow: cleanProFlow(tl.flow), useCase: str(tl.useCase, 3000),
    rules: (Array.isArray(tl.rules) ? tl.rules : []).slice(0, 20).map((r) => ({ rule: cleanExpr(r.rule), msg: str(r.msg, 200) })).filter((r) => r.rule),
    titleFormula: cleanExpr(tl.titleFormula), summaryFields: (Array.isArray(tl.summaryFields) ? tl.summaryFields : []).map(keyOf).filter(Boolean).slice(0, 6) };
}
// formula check for the builder: every formula in the tool, with sample values
export function lintTool(tl) {
  const problems = [], keys = new Set((tl.fields || []).map((f) => f.key)), check = (where, src) => { if (!src) return; const r = fxTest(src, { vals: {}, user: {} }); if (!r.ok) problems.push(where + ": " + r.error); };
  (tl.fields || []).forEach((f) => { check(f.label + " · formula", f.formula); check(f.label + " · show if", f.showIf); check(f.label + " · required if", f.requiredIf); (f.validations || []).forEach((v) => check(f.label + " · rule", v.rule)); (f.columns || []).forEach((c) => check(f.label + " › " + c.label, c.formula)); if (f.lookup && f.lookup.match && !keys.has(f.lookup.match)) problems.push(f.label + ": lookup key field “" + f.lookup.match + "” doesn't exist"); });
  ((tl.flow || {}).steps || []).forEach((s) => { check(s.name + " · runs when", s.when); check(s.name + " · auto-approve", s.autoApproveIf); s.routes.forEach((r) => check(s.name + " · route", r.if)); });
  (tl.rules || []).forEach((r) => check("Form rule", r.rule));
  return problems;
}

// ---------- lookups into existing tools ----------
export async function lookupRecord(store, f, keyVal, pool) {
  const k = str(keyVal, 120); if (!k || !f.lookup) return null;
  const L = f.lookup, K = low(k);
  if (L.source === "retailer") {
    const rid = k.toUpperCase().replace(/[^A-Z0-9_\-./]/g, ""), idx = (await store.get("rpidx")) || {}, m = (await store.get(`rtl:${rid}`)) || null, i = idx[rid];
    if (!m && !i) return null;
    return { key: rid, id: rid, name: (m && m.name) || (i && i.n) || "", state: (m && m.state) || (i && i.s) || "", city: (m && m.city) || (i && i.c) || "", mobile: (m && m.mobile) || "", type: (m && m.type) || "", balance: i ? i.bal : 0, earned: i ? i.cr : 0, paid: i ? i.dr : 0 };
  }
  if (L.source === "user") {
    for (const app of ["state", "admin"]) for (const key of await store.list(`user:${app}:`)) { const u = await store.get(key); if (u && [u.username, u.vchatId, u.email, u.mobile].filter(Boolean).map(low).includes(K)) return { key: u.username, username: u.username, name: u.fullName || u.username, state: u.state || (app === "admin" ? "HO" : ""), designation: u.designation || "", mobile: u.mobile || "", email: u.email || "", app }; }
    return null;
  }
  if (L.source === "product") {
    const cat = (await store.get("affcat")) || { models: [] }, nk = (s) => low(s).replace(/vivo/g, "").replace(/[^a-z0-9+]/g, "");
    const m = cat.models.find((x) => nk(x.name) === nk(k)) || cat.models.find((x) => nk(x.name).startsWith(nk(k))); if (!m) return null;
    const d = await store.get(`affm:${m.slug}`), ps = ((d && d.variants) || []).map((v) => v.price).filter(Boolean);
    return { key: m.name, name: m.name, series: m.series || "", price: ps.length ? Math.min(...ps) : 0, maxPrice: ps.length ? Math.max(...ps) : 0 };
  }
  if (L.source === "scheme") {
    const all = (await pool(await store.list("spol:"), 30, (x) => store.get(x))).filter(Boolean), p = all.find((x) => low(x.id) === K) || all.find((x) => low(x.title) === K) || all.find((x) => low(x.title).includes(K));
    if (!p) return null; const b = p.brief || {};
    return { key: p.title, title: p.title, from: p.dateFrom, to: p.dateTo, category: p.category, maxPayout: b.maxPayout || "", models: (p.models || []).join(", "), status: p.disabled ? "disabled" : p.dateTo < new Date(Date.now() + 19800000).toISOString().slice(0, 10) ? "expired" : "ongoing" };
  }
  if (L.source === "tool" && L.tool) {
    const rows = (await pool(await store.list(`ctsub:${L.tool}:`), 40, (x) => store.get(x))).filter(Boolean).sort((a, b) => (b.updatedAt || b.at) - (a.updatedAt || a.at));
    const hit = rows.find((r) => Object.values(r.values || {}).some((v) => low(typeof v === "object" ? "" : v) === K)); if (!hit) return null;
    const o = { key: k, status: hit.status || "submitted", by: (hit.by && hit.by.fullName) || "", at: hit.at };
    Object.entries(hit.values || {}).forEach(([a, v]) => { if (typeof v !== "object") o[a] = v; });
    return o;
  }
  return null;
}

// ---------- submit: clean, look up, compute, check ----------
export async function proValues(tl, input, ctx) {
  const { store, rec, app, pool, cleanBasic } = ctx, fields = tl.fields || [], vals = {}, errs = [];
  input = input || {};
  const user = { state: rec.state || (app === "admin" ? "HO" : ""), role: app === "admin" ? (rec.master ? "master" : "admin") : "state", name: rec.fullName || "", username: rec.username || "", designation: rec.designation || "" };
  for (const f of fields) {
    if (NOVALUE.includes(f.type) || f.type === "calc") continue;
    let v = input[f.key];
    if (f.type === "table") {
      const rows = (Array.isArray(v) ? v : []).slice(0, f.maxRows || 20).map((r) => { const o = {}; (f.columns || []).forEach((c) => { if (c.formula) return; let x = r && r[c.key]; if (c.type === "number" || c.type === "currency") { x = num(x); x = x == null ? "" : x; } else x = str(x, 200); if (c.type === "select" && x && c.options.length && !c.options.includes(x)) x = ""; o[c.key] = x; }); return o; })
        .filter((r) => Object.values(r).some((x) => x !== "" && x != null));
      vals[f.key] = rows; continue;
    }
    if (f.type === "lookup") { const keyIn = f.lookup.match ? input[f.lookup.match] : (v && typeof v === "object" ? v.key : v); const recd = await lookupRecord(store, f, keyIn, pool); vals[f.key] = recd || ""; continue; }
    if (f.type === "currency") { v = num(v); vals[f.key] = v == null ? "" : v; continue; }
    if (f.type === "user") { vals[f.key] = str(v, 80); continue; }
    const one = await cleanBasic([Object.assign({}, f, { required: false, show: null })], { [f.key]: v });
    vals[f.key] = one.vals[f.key]; if (one.bad.length) errs.push(f.label + " is not valid");
  }
  // lookups that depend on another field's value (match) were done above; now compute formulas + defaults
  fields.forEach((f) => { if (f.default && (vals[f.key] === "" || vals[f.key] == null) && f.type !== "calc") vals[f.key] = evaluate(f.default, { vals, user }, ""); });
  const env = computeAll(fields, vals, user);
  // visibility, required, validations
  for (const f of fields) {
    if (NOVALUE.includes(f.type)) continue;
    const vis = truthy(f.showIf, env, true);
    if (!vis) { vals[f.key] = Array.isArray(vals[f.key]) ? [] : ""; continue; }
    const v = vals[f.key], empty = v === "" || v == null || (Array.isArray(v) && !v.length);
    if (f.type === "table") { if ((f.minRows || (f.required ? 1 : 0)) > (v || []).length) errs.push(f.label + ": add at least " + Math.max(1, f.minRows || 1) + " row(s)"); (f.columns || []).filter((c) => c.required && !c.formula).forEach((c) => { if ((v || []).some((r) => r[c.key] === "" || r[c.key] == null)) errs.push(f.label + " › " + c.label + " is needed in every row"); }); }
    else if ((f.required || truthy(f.requiredIf, env, false)) && empty) errs.push("Please fill: " + f.label);
    if (f.type === "lookup" && f.required && !v) errs.push(f.label + ": not found — check the " + (f.lookup.match || "key"));
    if ((f.type === "number" || f.type === "currency") && v !== "" && v != null) { if (f.min != null && v < f.min) errs.push(f.label + " must be at least " + f.min); if (f.max != null && v > f.max) errs.push(f.label + " must be at most " + f.max); }
    if (!empty) (f.validations || []).forEach((r) => { if (!truthy(r.rule, env, true)) errs.push(r.msg || f.label + " doesn't meet the rule"); });
  }
  (tl.rules || []).forEach((r) => { if (!truthy(r.rule, env, true)) errs.push(r.msg || "A form rule isn't met"); });
  return { vals, errs, env, user };
}

// ---------- approvals ----------
export async function roleDir(store) { return (await store.get("config:roledir")) || { roles: ["ASM", "RSM", "ZSM", "State BI head", "State head", "HR", "Finance", "HO BI"], rows: [] }; }
async function resolve(store, ap, sub, env) {
  if (!ap) return [];
  const vals = sub.values || {};
  if (ap.type === "users") return ap.users.map(low);
  if (ap.type === "submitter") return [low(sub.by && sub.by.username)].filter(Boolean);
  if (ap.type === "group") return ["@" + ap.group];
  if (ap.type === "field") { const v = vals[ap.field]; return (Array.isArray(v) ? v : [v]).map((x) => low(typeof x === "object" && x ? x.username || x.key : x)).filter(Boolean); }
  if (ap.type === "role") {
    const dir = await roleDir(store), stateOf = ap.scope === "fieldState" ? (typeof vals[ap.stateField] === "object" && vals[ap.stateField] ? vals[ap.stateField].state : vals[ap.stateField]) : ap.scope === "any" ? "" : sub.state;
    const area = ap.areaField ? low(typeof vals[ap.areaField] === "object" && vals[ap.areaField] ? vals[ap.areaField].city || vals[ap.areaField].key : vals[ap.areaField]) : "";
    let rows = dir.rows.filter((r) => low(r.role) === low(ap.role));
    if (stateOf) { const s = rows.filter((r) => low(r.state) === low(stateOf)); rows = s.length ? s : rows.filter((r) => !r.state || low(r.state) === "all" || low(r.state) === "pan india"); }
    if (area) { const a = rows.filter((r) => low(r.area) === area); if (a.length) rows = a; }
    return [...new Set(rows.flatMap((r) => r.users || []).map(low))];
  }
  return [];
}
const envOf = (tl, sub) => { const vals = JSON.parse(JSON.stringify(sub.values || {})); return computeAll(tl.fields || [], vals, sub.user || {}); };
const nowHist = (t, by, action, step, extra) => Object.assign({ at: t, by, action, step: step ? step.id : "", stepName: step ? step.name : "" }, extra || {});
// move the submission into step index i (skipping steps whose `when` is false, auto-approving where the rule says so)
export async function enterFrom(store, tl, sub, i, t, sysBy) {
  const steps = (tl.flow || {}).steps || [], env = envOf(tl, sub);
  for (let guard = 0; guard < 40; guard++) {
    if (i >= steps.length || i < 0) { sub.status = "approved"; sub.cur = null; sub.doneAt = t; return sub; }
    const s = steps[i];
    if (!truthy(s.when, env, true)) { sub.history.push(nowHist(t, sysBy, "skipped", s, { comment: "Condition not met" })); i++; continue; }
    sub.trail = (sub.trail || []).concat([s.id]);
    if (truthy(s.autoApproveIf, env, false)) { sub.history.push(nowHist(t, sysBy, "auto-approved", s, { comment: "Auto-approved by rule" })); const nx = nextAfter(tl, s, env); if (nx === "end") { sub.status = "approved"; sub.cur = null; sub.doneAt = t; return sub; } i = nx; continue; }
    let ap = await resolve(store, s.approver, sub, env), note = "";
    if (!ap.length && s.escalate) { ap = await resolve(store, s.escalate, sub, env); note = "No approver found — sent to the escalation approver"; }
    if (!ap.length) { ap = ["@master"]; note = "No approver found for this step — sent to master admins"; }
    sub.status = "pending"; sub.step = i;
    sub.cur = { id: s.id, idx: i, approvers: ap, done: [], enteredAt: t, dueAt: s.tatHours ? t + s.tatHours * 3600e3 : 0, escalated: false };
    if (note) sub.history.push(nowHist(t, sysBy, "routed", s, { comment: note }));
    return sub;
  }
  sub.status = "approved"; sub.cur = null; return sub;
}
function nextAfter(tl, s, env) {
  const steps = tl.flow.steps, i = steps.findIndex((x) => x.id === s.id);
  for (const r of s.routes || []) if (truthy(r.if, env, false)) { if (r.goto === "end") return "end"; if (r.goto === "next") return i + 1; const j = steps.findIndex((x) => x.id === r.goto); if (j >= 0) return j; }
  return i + 1;
}
export function canActPro(sub, app, rec) {
  if (sub.status !== "pending" || !sub.cur) return false;
  const role = app === "admin" ? (rec.master ? "master" : "admin") : "state", ids = [rec.username, rec.vchatId, rec.email, rec.mobile].filter(Boolean).map(low);
  const ap = sub.cur.approvers || [], done = sub.cur.done || [];
  const mine = ap.filter((a) => (a === "@" + role) || (a === "@admin" && role === "master") || ids.includes(a));
  return mine.some((a) => !done.includes(a));
}
export function isProApproverAny(tl, app, rec) {   // could this user ever approve in this tool? (lets approvers open it)
  const ids = [rec.username, rec.vchatId, rec.email].filter(Boolean).map(low), role = app === "admin" ? (rec.master ? "master" : "admin") : "state";
  return ((tl.flow || {}).steps || []).some((s) => [s.approver, s.escalate].filter(Boolean).some((a) => (a.type === "group" && (a.group === role || (a.group === "admin" && role === "master"))) || (a.type === "users" && a.users.map(low).some((u) => ids.includes(u))) || a.type === "role" || a.type === "field"));
}
export async function actPro(store, tl, sub, decision, app, rec, comment, t) {
  const steps = tl.flow.steps, s = steps[sub.cur.idx], by = { fullName: rec.fullName, username: rec.username || "", app }, env = envOf(tl, sub);
  const ids = [rec.username, rec.vchatId, rec.email, rec.mobile].filter(Boolean).map(low), role = app === "admin" ? (rec.master ? "master" : "admin") : "state";
  const myTag = (sub.cur.approvers || []).find((a) => ids.includes(a)) || "@" + role;
  if (decision === "approve") {
    sub.history.push(nowHist(t, by, "approved", s, { comment }));
    sub.cur.done = [...new Set((sub.cur.done || []).concat([myTag]))];
    if (s.mode === "all") { const need = sub.cur.approvers.filter((a) => !a.startsWith("@")); if (need.length && need.some((a) => !sub.cur.done.includes(a))) return sub; }
    const nx = nextAfter(tl, s, env);
    if (nx === "end") { sub.status = "approved"; sub.cur = null; sub.doneAt = t; return sub; }
    return enterFrom(store, tl, sub, nx, t, { fullName: "System", username: "", app: "" });
  }
  if (decision === "back") { sub.history.push(nowHist(t, by, "returned", s, { comment })); sub.status = tl.flow.allowResubmit === false ? "rejected" : "returned"; sub.cur = null; return sub; }
  sub.history.push(nowHist(t, by, "rejected", s, { comment }));
  if (s.onReject === "back") { sub.status = "returned"; sub.cur = null; return sub; }
  if (s.onReject && s.onReject !== "end") { const j = steps.findIndex((x) => x.id === s.onReject); if (j >= 0) return enterFrom(store, tl, sub, j, t, { fullName: "System", username: "", app: "" }); }
  sub.status = "rejected"; sub.cur = null; sub.doneAt = t; return sub;
}
// TAT: when a step runs past its time, add the escalation approver (done lazily whenever the tool is read)
export async function tickTat(store, tl, sub, t) {
  if (sub.status !== "pending" || !sub.cur || !sub.cur.dueAt || t <= sub.cur.dueAt || sub.cur.escalated) return false;
  const s = tl.flow.steps[sub.cur.idx]; if (!s) return false;
  sub.cur.escalated = true;
  if (s.escalate) { const add = await resolve(store, s.escalate, sub, envOf(tl, sub)); sub.cur.approvers = [...new Set(sub.cur.approvers.concat(add.length ? add : ["@master"]))]; }
  sub.history.push(nowHist(t, { fullName: "System", username: "", app: "" }, "escalated", s, { comment: "TAT of " + s.tatHours + "h crossed" + (s.escalate ? " — escalated" : "") }));
  return true;
}
