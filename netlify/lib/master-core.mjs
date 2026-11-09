// Master admin (an admin account with rec.master = true): customizes everything and releases changes to chosen audiences.
// Storage:
//   config:master          { claimed, claimedBy, claimedAt }
//   cust:<id>              { id, kind:"text"|"hide"|"list"|"fields"|"tool", page, match, value, up, listKey, items, formKey, fields, tool,
//                            status:"draft"|"released", audience:{ roles:[], users:[], states:[] }, note, createdAt, updatedAt, by }
//   ctsub:<toolId>:<id>    custom-form submission { id, tool, by, state, values, at }
//   custver                { v }   bumped on every change so apps refresh their cached customizations
import { randomBytes, createHash } from "node:crypto";
import { test as fxTest, refs as fxRefs, FUNCTIONS as FX_FUNCS } from "./formula-core.mjs";
import { cleanProTool, lintTool, proValues, enterFrom, canActPro, isProApproverAny, actPro, tickTat, lookupRecord, roleDir, LOOKUP_SOURCES, PRO_TYPES } from "./toolpro-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const cid = (v) => String(v || "").replace(/[^a-z0-9]/gi, "").slice(0, 30);
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
// One-time setup code that turns the first admin account into a master admin (SHA-256 only; the code itself is shared with the owner).
export const MASTER_SETUP_SHA256 = "378a5a032d12eca7ef9ddb9bf9d5df76db64330bac8ef5de5cdea5e0fa16bf2e";
export const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
export const FIELD_TYPES = ["text", "longtext", "number", "date", "select", "multi", "yesno", "rating", "photo",
  "email", "phone", "time", "datetime", "checkbox", "scale", "location", "heading", "image"];
const NOVALUE = ["heading", "image"];
export const TOOL_TYPES = ["form", "link", "page", "report"];
export const CATS = ["field", "reports", "engage", "learn", "support", "admin", "more"];

export const roleOf = (app, rec) => (app === "admin" ? (rec.master ? "master" : "admin") : "state");
export function inAudience(c, app, rec) {
  const a = c.audience || {}, role = roleOf(app, rec);
  if (role === "master") return true;
  const roles = a.roles || [], users = (a.users || []).map((u) => String(u).toLowerCase()), states = a.states || [];
  if (!roles.length && !users.length && !states.length) return true;          // released to everyone
  if (roles.includes(role) || (role === "master" && roles.includes("admin"))) return true;
  const ids = [rec.username, rec.vchatId, rec.email].filter(Boolean).map((x) => String(x).toLowerCase());
  if (ids.some((x) => users.includes(x))) return true;
  if (app === "state" && rec.state && states.includes(rec.state)) return true;
  return false;
}
export async function bumpVersion(store, t) { await store.set("custver", { v: t.toString(36) + randomBytes(2).toString("hex") }); }

const num = (v) => (v === "" || v == null || !isFinite(Number(v)) ? null : Number(v));
function cleanFields(a) {
  return (Array.isArray(a) ? a : []).slice(0, 80).map((f, i) => {
    const type = FIELD_TYPES.includes(f.type) ? f.type : "text";
    const o = { key: str(f.key, 30).replace(/[^a-z0-9_]/gi, "") || "f" + i + randomBytes(2).toString("hex"), label: str(f.label, 120), type,
      options: (Array.isArray(f.options) ? f.options : String(f.options || "").split(/\n/)).map((x) => str(x, 80)).filter(Boolean).slice(0, 60),
      required: f.required === true && !NOVALUE.includes(type), help: str(f.help, 300), placeholder: str(f.placeholder, 120) };
    if (num(f.min) != null) o.min = num(f.min); if (num(f.max) != null) o.max = num(f.max);
    if (type === "heading") { o.text = str(f.text, 2000); o.newPage = f.newPage === true; }
    if (type === "heading" || type === "image") o.image = cid(f.image);
    if (f.show && f.show.key) o.show = { key: str(f.show.key, 30).replace(/[^a-z0-9_]/gi, ""), value: str(f.show.value, 80) };
    return o;
  }).filter((f) => f.label || f.type === "image" || (f.type === "heading" && (f.text || f.image)));
}
function cleanForm(x) {
  x = x || {};
  return { banner: cid(x.banner), color: /^#[0-9a-f]{6}$/i.test(String(x.color || "")) ? x.color : "", intro: str(x.intro, 3000), thanks: str(x.thanks, 600), submitLabel: str(x.submitLabel, 30),
    oneResponse: x.oneResponse === true, anonymous: x.anonymous === true, closeAt: num(x.closeAt) || 0, showProgress: x.showProgress !== false };
}
function cleanFlow(x) {
  x = x || {};
  const steps = (Array.isArray(x.steps) ? x.steps : []).slice(0, 6).map((st, i) => ({ name: str(st.name, 60) || "Step " + (i + 1),
    roles: (Array.isArray(st.roles) ? st.roles : []).filter((r) => ["state", "admin", "master"].includes(r)),
    users: (Array.isArray(st.users) ? st.users : String(st.users || "").split(/[\s,;]+/)).map((u) => str(u, 60)).filter(Boolean).slice(0, 300),
    sameState: st.sameState === true, tatHours: Math.max(0, Math.min(720, Number(st.tatHours) || 0)) })).filter((st) => st.roles.length || st.users.length);
  return { steps, allowResubmit: x.allowResubmit !== false };
}
const visible = (f, vals) => !f.show || !f.show.key || (Array.isArray(vals[f.show.key]) ? vals[f.show.key].includes(f.show.value) : String(vals[f.show.key] ?? "") === f.show.value);
const idsOf = (rec) => [rec.username, rec.vchatId, rec.email].filter(Boolean).map((x) => String(x).toLowerCase());
function isApprover(st, app, rec, sub) {
  if (!st) return false;
  const role = roleOf(app, rec);
  const ok = st.roles.includes(role) || (role === "master" && st.roles.includes("admin")) || idsOf(rec).some((x) => st.users.map((u) => u.toLowerCase()).includes(x));
  if (!ok) return false;
  if (st.sameState && role === "state" && sub && rec.state !== sub.state) return false;
  return true;
}
// Clean submitted values against field definitions; returns { vals, missing, bad }
async function cleanValues(fields, input, ctx) {
  const { store, app, rec, who, sameUser } = ctx;
  const vals = {}, missing = [], bad = [];
  input = input || {};
  for (const f of fields) {
    if (NOVALUE.includes(f.type)) continue;
    let v = input[f.key];
    if (f.type === "photo") { const c = cid(v); const att = c ? await store.get(`att:${c}`) : null; v = att && sameUser(att.by, who(app, rec)) ? c : ""; }
    else if (f.type === "multi") v = (Array.isArray(v) ? v : []).map((x) => str(x, 80)).filter((x) => !f.options.length || f.options.includes(x)).slice(0, 30);
    else if (f.type === "number" || f.type === "scale" || f.type === "rating") { v = num(v); if (v == null) v = ""; else if ((f.min != null && v < f.min) || (f.max != null && v > f.max)) { bad.push(f.label); v = ""; } }
    else if (f.type === "checkbox") v = v === true || v === "Yes" || v === "yes" ? "Yes" : "";
    else if (f.type === "email") { v = str(v, 120); if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { bad.push(f.label); v = ""; } }
    else if (f.type === "phone") { v = str(v, 20).replace(/[^\d+]/g, ""); if (v && v.replace(/\D/g, "").length < 6) { bad.push(f.label); v = ""; } }
    else if (f.type === "location") { v = str(v, 80); if (v && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?/.test(v)) v = ""; }
    else if (f.type === "select") { v = str(v, 80); if (v && f.options.length && !f.options.includes(v)) v = ""; }
    else v = str(v, f.type === "longtext" ? 5000 : 400);
    vals[f.key] = v;
  }
  for (const f of fields) {   // conditional fields: hidden ones are cleared and never required
    if (NOVALUE.includes(f.type)) continue;
    if (!visible(f, vals)) { vals[f.key] = Array.isArray(vals[f.key]) ? [] : ""; continue; }
    const v = vals[f.key];
    if (f.required && (v === "" || v == null || (Array.isArray(v) && !v.length))) missing.push(f.label);
  }
  return { vals, missing, bad };
}
function cleanAudience(a) {
  a = a || {};
  return { roles: (Array.isArray(a.roles) ? a.roles : []).filter((r) => ["state", "admin", "master"].includes(r)), users: (Array.isArray(a.users) ? a.users : String(a.users || "").split(/[\s,;]+/)).map((u) => str(u, 60)).filter(Boolean).slice(0, 2000),
    states: (Array.isArray(a.states) ? a.states : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 60) };
}
// Accept up to 30 extra (master-added) field values on a record.
export function cleanExtra(x) {
  const o = {}; if (!x || typeof x !== "object") return o;
  Object.entries(x).slice(0, 30).forEach(([k, v]) => { const kk = String(k).replace(/[^a-z0-9_]/gi, "").slice(0, 30); if (!kk) return; o[kk] = Array.isArray(v) ? v.map((y) => str(y, 80)).slice(0, 20) : str(v, 1000); });
  return o;
}

export async function masterAction(b, ctx) {
  const { store, t, app, rec, key, pool, who, sameUser } = ctx;
  const isMaster = app === "admin" && rec.master === true;
  const role = roleOf(app, rec);
  const listAll = async () => (await pool(await store.list("cust:"), 40, (k) => store.get(k))).filter(Boolean);
  const mustMaster = () => json(403, { ok: false, error: "Only a master admin can do this." });

  // ---- what this user sees (all apps/pages call this, cached by version) ----
  if (b.action === "cust-get") {
    const ver = ((await store.get("custver")) || { v: "0" }).v;
    if (b.ver && b.ver === ver && !isMaster) return json(200, { ok: true, ver, same: true });
    const flowAppr = (c) => c.kind === "tool" && ((c.tool.flow && c.tool.flow.steps) || []).some((st) => isApprover(Object.assign({}, st, { sameState: false }), app, rec, null));
    const rows = (await listAll()).filter((c) => (c.status === "released" && (inAudience(c, app, rec) || flowAppr(c))) || isMaster);
    const out = rows.map((c) => { const o = Object.assign({}, c); o.draft = c.status !== "released"; if (!isMaster) { delete o.audience; delete o.note; } return o; });
    return json(200, { ok: true, ver: isMaster ? ver + ":" + rows.length + ":" + rows.reduce((a, c) => Math.max(a, c.updatedAt || 0), 0) : ver, role, master: isMaster, items: out });
  }

  // ---- custom tool use (forms) ----
  const me = who(app, rec), myBk = sha256(app + ":" + key);
  // approvers named in a tool's flow can always open it to approve, even when it isn't released to them for filling
  const flowApprover = (tl) => tl.tool.pro ? isProApproverAny(tl.tool, app, rec) : ((tl.tool.flow && tl.tool.flow.steps) || []).some((st) => isApprover(Object.assign({}, st, { sameState: false }), app, rec, null));
  const toolFor = async (id, approve) => { const tl = await store.get(`cust:${cid(id)}`); return tl && tl.kind === "tool" && ((tl.status === "released" && (inAudience(tl, app, rec) || (approve && flowApprover(tl)))) || isMaster) ? tl : null; };
  const isMine = (r) => r.bk === myBk || (!r.anon && sameUser(r.by, me));
  const steps = (tl) => (tl.tool.flow && tl.tool.flow.steps) || [];
  const canAct = (tl, r) => tl.tool.pro ? r.status === "pending" && (canActPro(r, app, rec) || (isMaster && r.cur && !(r.cur.done || []).includes(String(rec.username || "").toLowerCase()) && !(r.cur.done || []).includes("@master"))) : r.status === "pending" && (isMaster || isApprover(steps(tl)[r.step], app, rec, r));
  const myIds = [rec.username, rec.vchatId, rec.email, rec.mobile].filter(Boolean).map((x) => String(x).toLowerCase());
  const approverAny = (tl, r) => tl.tool.pro ? (canActPro(r, app, rec) || (r.history || []).some((h) => h.by && myIds.includes(String(h.by.username || "").toLowerCase()) && /approved|rejected|returned/.test(h.action))) : steps(tl).some((st) => isApprover(st, app, rec, r));
  const sysBy = { fullName: "System", username: "", app: "" };
  const ctxV = { store, app, rec, who, sameUser };
  const pub = (tl, r) => { const o = Object.assign({}, r, { mine: isMine(r), canAct: canAct(tl, r) }); delete o.bk; if (r.anon && !isMaster) { o.by = { fullName: "Anonymous", username: "" }; o.history = (r.history || []).map((h) => /submitted/.test(h.action) ? Object.assign({}, h, { by: { fullName: "Anonymous", username: "", app: "" } }) : h); } return o; };

  // ---- custom tool use (forms, surveys, approval flows) ----
  if (b.action === "ct-submit") {
    const tl = await toolFor(b.tool);
    if (!tl || tl.tool.type !== "form") return json(404, { ok: false, error: "Form not available." });
    const fm = tl.tool.form || {};
    if (fm.closeAt && t > fm.closeAt && !isMaster) return json(400, { ok: false, error: "This form is closed." });
    if (tl.tool.pro) return proSubmit(tl);
    const { vals, missing, bad } = await cleanValues(tl.tool.fields || [], b.values, ctxV);
    if (bad.length) return json(400, { ok: false, error: "Please check: " + bad.join(", ") });
    if (missing.length) return json(400, { ok: false, error: "Please fill: " + missing.join(", ") });
    const st = steps(tl), hist = { at: t, by: { fullName: rec.fullName, username: rec.username || "", app }, comment: str(b.comment, 500) };
    if (b.id) {   // resubmit after "sent back"
      const r = await store.get(`ctsub:${tl.id}:${cid(b.id)}`);
      if (!r || !isMine(r)) return json(404, { ok: false, error: "Not found." });
      if (r.status !== "returned") return json(400, { ok: false, error: "Only responses sent back to you can be edited." });
      r.values = vals; r.status = st.length ? "pending" : "submitted"; r.step = 0; r.stepAt = t; r.updatedAt = t;
      r.history.push(Object.assign(hist, { action: "resubmitted", step: 0 }));
      await store.set(`ctsub:${tl.id}:${r.id}`, r);
      return json(200, { ok: true, id: r.id, status: r.status });
    }
    if (fm.oneResponse) {
      const mine = (await pool(await store.list(`ctsub:${tl.id}:`), 40, (k) => store.get(k))).filter((r) => r && r.bk === myBk);
      if (mine.length) return json(409, { ok: false, error: "You've already responded to this form." });
    }
    const id = nid(t), anon = fm.anonymous === true;
    const r = { id, tool: tl.id, bk: myBk, anon, by: me, state: rec.state || (app === "admin" ? "HO" : ""), values: vals, at: t,
      status: st.length ? "pending" : "submitted", step: 0, stepAt: t, history: [Object.assign(hist, { action: "submitted", step: 0 })] };
    await store.set(`ctsub:${tl.id}:${id}`, r);
    return json(200, { ok: true, id, status: r.status, next: st.length ? st[0].name : "" });
  }
  async function proSubmit(tl) {   // Studio Pro: formulas, lookups, rules and the conditional approval flow
    const fm = tl.tool.form || {};
    const out = await proValues(tl.tool, b.values, { store, rec, app, pool, cleanBasic: (fs, inp) => cleanValues(fs, inp, ctxV) });
    if (out.errs.length) return json(400, { ok: false, error: out.errs.slice(0, 4).join(" · ") });
    const hasFlow = ((tl.tool.flow || {}).steps || []).length, hist = { at: t, by: { fullName: rec.fullName, username: rec.username || "", app }, comment: str(b.comment, 500) };
    let r;
    if (b.id) {
      r = await store.get(`ctsub:${tl.id}:${cid(b.id)}`);
      if (!r || !isMine(r)) return json(404, { ok: false, error: "Not found." });
      if (r.status !== "returned") return json(400, { ok: false, error: "Only responses sent back to you can be edited." });
      r.values = out.vals; r.user = out.user; r.updatedAt = t; r.trail = []; r.history.push(Object.assign(hist, { action: "resubmitted", step: "" }));
    } else {
      if (fm.oneResponse && (await pool(await store.list(`ctsub:${tl.id}:`), 40, (k) => store.get(k))).some((x) => x && x.bk === myBk)) return json(409, { ok: false, error: "You've already responded to this form." });
      r = { id: nid(t), tool: tl.id, bk: myBk, anon: fm.anonymous === true, by: me, state: rec.state || (app === "admin" ? "HO" : ""), values: out.vals, user: out.user, at: t, status: "submitted", step: 0, history: [Object.assign(hist, { action: "submitted", step: "" })], trail: [] };
    }
    if (hasFlow) await enterFrom(store, tl.tool, r, 0, t, sysBy); else r.status = "submitted";
    await store.set(`ctsub:${tl.id}:${r.id}`, r);
    const s0 = r.cur ? tl.tool.flow.steps[r.cur.idx] : null;
    return json(200, { ok: true, id: r.id, status: r.status, next: s0 ? s0.name : "", values: out.vals });
  }
  if (b.action === "ct-fx-ai") {   // Tool builder: "describe it in words" → a formula the engine accepts
    if (!isMaster) return json(403, { ok: false, error: "Master admins only." });
    const desc = str(b.desc, 600); if (desc.length < 4) return json(400, { ok: false, error: "Describe what the formula should do." });
    const flds = (Array.isArray(b.fields) ? b.fields : []).slice(0, 80).map((f) => ({ key: str(f.key, 40), label: str(f.label, 80), type: str(f.type, 20), options: (f.options || []).slice(0, 12).map((o) => str(o, 40)), columns: (f.columns || []).slice(0, 12).map((c) => ({ key: str(c.key, 30), label: str(c.label, 40), type: str(c.type, 12) })), lookup: f.lookup ? { source: str(f.lookup.source, 20), show: (f.lookup.show || []).slice(0, 10).map((x) => str(x, 30)) } : undefined }));
    const cond = b.purpose === "cond", keys = new Set(flds.map((f) => f.key));
    const sys = `You write formulas for a form-builder's formula engine. Reply with JSON only: {"formula":"…","explain":"one or two simple sentences"}.
Engine rules: refer to fields by their key exactly as given (table columns as table.column — only inside SUM/AVG/MIN/MAX/COUNT; lookup details as lookupkey.detail; the person filling: user.state, user.role ("state" or "admin"), user.name, user.designation). Text in "double quotes". Numbers plain (no ₹ or commas). Dates are "YYYY-MM-DD" text; use TODAY(), DAYS(later, earlier), ADDDAYS(date, n).
Operators: + - * / % ^, = != < <= > >=, & joins text, AND OR NOT, parentheses. Functions available ONLY: ${FX_FUNCS.join(", ")}. SLAB(value, "from:result,from:result") gives the result of the highest "from" reached; TIER same but text; PERCENT(a,b)=a/b*100; IF(c,a,b); IFS(c1,v1,c2,v2,TRUE,v); IN(x,"a","b"); CONTAINS(multiChoiceField,"option").
${cond ? "The result must be a CONDITION that is true or false." : "The result must be a VALUE (number, amount, date or text)."} Use only fields from FIELDS.`;
    let last = "", out = null;
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      const q = desc + (last ? `\n\nYour previous formula failed: ${last}. Fix it.` : "");
      const r = await ctx.askAI(ctx.env, q, "FIELDS: " + JSON.stringify(flds), [], ctx.aiFetch, { system: sys, label: "FORMULA" });
      if (!r.ok) return json(200, { ok: false, error: r.error });
      let d = null; try { const m = /\{[\s\S]*\}/.exec(r.text || ""); d = m ? JSON.parse(m[0]) : null; } catch (e) { d = null; }
      const fx = d && str(d.formula, 600).replace(/^=/, "");
      if (!fx) { last = "no JSON with a formula"; continue; }
      const tt = fxTest(fx, { vals: {}, user: {} });
      if (!tt.ok) { last = tt.error; continue; }
      const unknown = fxRefs(fx).filter((k) => k !== "user" && !keys.has(k));
      if (unknown.length) { last = "unknown field(s) " + unknown.join(", "); continue; }
      out = { formula: fx, explain: str(d.explain, 300) };
    }
    return json(200, out ? Object.assign({ ok: true }, out) : { ok: false, error: "Couldn't write a working formula (" + last + "). Try describing it differently or pick a recipe." });
  }
  if (b.action === "ct-tool-ai") {   // Studio: "describe your process" → a whole form + rules + approval steps
    if (!isMaster) return json(403, { ok: false, error: "Master admins only." });
    const desc = str(b.desc, 2000); if (desc.length < 10) return json(400, { ok: false, error: "Describe the process in a sentence or two." });
    const dir = await roleDir(store);
    const sys = `You design business forms with approval workflows for a mobile-phone sales company in India (vivo). Reply with JSON only:
{"name":"…","icon":"one emoji","category":"field|admin|finance|reports|support|more","desc":"one line","useCase":"2-3 plain sentences of the business rules",
 "fields":[{"key":"short_snake","label":"…","type":"${PRO_TYPES.filter((x) => x !== "image").join("|")}","required":true,"options":["for select/multi"],"formula":"only for type calc","format":"currency|number|text|date (calc only)","showIf":"condition","requiredIf":"condition","columns":[{"key":"…","label":"…","type":"text|number|currency|select|date","formula":"optional, uses other columns of the same row"}],"validations":[{"rule":"condition","msg":"…"}]}],
 "rules":[{"rule":"condition that must be true","msg":"shown when false"}],
 "steps":[{"name":"…","role":"one of ROLES","when":"condition (blank = always)","autoApproveIf":"condition","tatHours":24,"escalateRole":"role or blank","endIf":"condition after which no further step is needed"}]}
Formula rules: refer to fields by key; table columns as table.column only inside SUM/AVG/MIN/MAX/COUNT; COUNTROWS(table). Text in "double quotes". Numbers plain. Dates "YYYY-MM-DD"; TODAY(), DAYS(later, earlier), ADDDAYS(d,n), HOURS(later, earlier).
Operators + - * / , = != < <= > >=, AND OR NOT, & joins text. Functions ONLY: ${FX_FUNCS.join(", ")}.
Prefer the easy ones: PCT(amount, rate) = rate% of amount; PERCENT(a,b) = a/b*100; ABOVE(x, limit) = how much x is above limit (0 if not); BELOW; CAP(x, max); ATLEAST(x, min); BETWEEN(x, lo, hi); PER(x, every, pay) = pay for every 'every' units; ADDGST(x, rate); GSTOF(x, rate); DISCOUNT(x, rate); DIFF(a,b); RATIO(a,b); SLAB(v,"from:result,from:result"); TIER same but text; IF; IFS(c1,v1,c2,v2,TRUE,v); SWITCH(x,"a",1,"b",2,default); IN(x,"a","b"); NUM(text).
Select values are text, so compare as type = "Sick" and use NUM(field) when an option is a number. 4–14 fields, at most 5 steps. Only use roles from ROLES.`;
    let last = "", out = null;
    for (let attempt = 0; attempt < 3 && !out; attempt++) {
      const q = desc + (last ? `\n\nYour previous design had these problems: ${last}. Fix them and send the whole JSON again.` : "");
      const r = await ctx.askAI(ctx.env, q, "ROLES: " + JSON.stringify(dir.roles || []), [], ctx.aiFetch, { system: sys, label: "TOOLDESIGN", maxTokens: 3500 });
      if (!r.ok) return json(200, { ok: false, error: r.error });
      let d = null; try { const m = /\{[\s\S]*\}/.exec(r.text || ""); d = m ? JSON.parse(m[0]) : null; } catch (e) { d = null; }
      if (!d || !Array.isArray(d.fields) || !d.fields.length) { last = "no JSON with fields"; continue; }
      const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, 5).map((s, i) => ({ id: "s" + (i + 1), name: str(s.name, 60) || "Step " + (i + 1), when: str(s.when, 400), approver: { type: "role", role: str(s.role, 40) || "ASM", scope: "submitterState", users: [] }, mode: "any", tatHours: Math.max(0, Math.min(720, Number(s.tatHours) || 24)), escalate: s.escalateRole ? { type: "role", role: str(s.escalateRole, 40), scope: "submitterState", users: [] } : null, autoApproveIf: str(s.autoApproveIf, 400), routes: s.endIf ? [{ if: str(s.endIf, 400), goto: "end" }] : [], onReject: "end" }));
      const tl = cleanProTool({ fields: d.fields.map((f) => Object.assign({}, f, f && f.type === "calc" ? { formula: String(f.formula || "").replace(/^=/, ""), format: f.format || "currency", decimals: 0 } : {})), rules: d.rules, flow: { steps } });
      const fl = tl.fields;
      const lintIn = { fields: fl, rules: tl.rules, flow: { steps } };
      const probs = lintTool(lintIn), keys = new Set(fl.map((f) => f.key));
      const all = [].concat(fl.flatMap((f) => [f.formula, f.showIf, f.requiredIf].concat((f.validations || []).map((v) => v.rule)))).concat(tl.rules.map((r) => r.rule)).concat(steps.flatMap((s) => [s.when, s.autoApproveIf].concat(s.routes.map((r) => r.if)))).filter(Boolean);
      const unknown = [...new Set(all.flatMap((x) => { try { return fxRefs(x); } catch (e) { return []; } }).filter((k) => k !== "user" && !keys.has(k)))];
      if (unknown.length) probs.push("unknown field(s) " + unknown.join(", "));
      fl.filter((f) => f.type === "calc" && !f.formula).forEach((f) => probs.push(f.label + " is a calc with no formula"));
      if (probs.length) { last = probs.slice(0, 8).join("; "); continue; }
      out = { tool: { name: str(d.name, 80) || "New tool", icon: str(d.icon, 8) || "🧩", category: CATS.includes(d.category) ? d.category : (["finance"].includes(d.category) ? "admin" : "more"), desc: str(d.desc, 300), useCase: str(d.useCase, 1500), fields: fl, rules: tl.rules, steps } };
    }
    return json(200, out ? Object.assign({ ok: true }, out) : { ok: false, error: "Couldn't design a working tool (" + last + "). Add a little more detail and try again, or start from a template." });
  }
  if (b.action === "ct-lookup") {   // live lookup while filling a Studio Pro form
    const tl = await toolFor(b.tool); const f = tl && tl.tool.pro ? (tl.tool.fields || []).find((x) => x.key === str(b.field, 30) && x.type === "lookup") : null;
    if (!f) return json(404, { ok: false, error: "Not found." });
    return json(200, { ok: true, record: await lookupRecord(store, f, b.key, pool) });
  }
  if (b.action === "roledir-get") { if (app !== "admin") return json(403, { ok: false, error: "Admins only." }); return json(200, { ok: true, dir: await roleDir(store), sources: LOOKUP_SOURCES, types: PRO_TYPES }); }
  if (b.action === "ct-act") {   // approve / reject / send back
    const tl = await toolFor(b.tool, true);
    if (!tl) return json(404, { ok: false, error: "Not found." });
    const r = await store.get(`ctsub:${tl.id}:${cid(b.id)}`);
    if (!r) return json(404, { ok: false, error: "Not found." });
    if (!canAct(tl, r)) return json(403, { ok: false, error: "This isn't waiting for your approval." });
    const d = ["approve", "reject", "back"].includes(b.decision) ? b.decision : null;
    if (!d) return json(400, { ok: false, error: "Choose approve, reject or send back." });
    const comment = str(b.comment, 500);
    if (d !== "approve" && !comment) return json(400, { ok: false, error: "Please add a comment." });
    if (tl.tool.pro) { if (!r.cur && isMaster) return json(400, { ok: false, error: "Not waiting for approval." }); await actPro(store, tl.tool, r, d, app, rec, comment, t); r.updatedAt = t; await store.set(`ctsub:${tl.id}:${r.id}`, r); return json(200, { ok: true, item: pub(tl, r) }); }
    const st = steps(tl);
    r.history.push({ at: t, by: { fullName: rec.fullName, username: rec.username || "", app }, action: d === "approve" ? "approved" : d === "reject" ? "rejected" : "returned", step: r.step, stepName: (st[r.step] || {}).name || "", comment });
    if (d === "approve") { if (r.step + 1 < st.length) { r.step++; r.stepAt = t; } else r.status = "approved"; }
    else if (d === "reject") r.status = "rejected";
    else r.status = (tl.tool.flow || {}).allowResubmit === false ? "rejected" : "returned";
    r.updatedAt = t;
    await store.set(`ctsub:${tl.id}:${r.id}`, r);
    return json(200, { ok: true, item: pub(tl, r) });
  }
  if (b.action === "ct-list") {
    const tl = await toolFor(b.tool, true);
    if (!tl) return json(404, { ok: false, error: "Not found." });
    let rows = (await pool(await store.list(`ctsub:${tl.id}:`), 40, (k) => store.get(k))).filter(Boolean);
    if (tl.tool.pro) for (const r of rows) { if (await tickTat(store, tl.tool, r, t)) await store.set(`ctsub:${tl.id}:${r.id}`, r); }
    const all = app === "admin";
    if (!all) rows = rows.filter((r) => isMine(r) || approverAny(tl, r));
    const out = rows.sort((x, y) => (y.updatedAt || y.at) - (x.updatedAt || x.at)).slice(0, 3000).map((r) => pub(tl, r));
    return json(200, { ok: true, tool: tl.tool, rows: out, all, approver: isMaster || (tl.tool.pro ? isProApproverAny(tl.tool, app, rec) : steps(tl).some((st) => isApprover(st, app, rec, { state: rec.state }))), pending: out.filter((r) => r.canAct).length, now: t, me: { state: rec.state || (app === "admin" ? "HO" : ""), role: role, name: rec.fullName || "", username: rec.username || "", designation: rec.designation || "" } });
  }
  if (b.action === "ct-notify") {   // approvals waiting for me + my responses sent back, per tool
    const tools = (await listAll()).filter((c) => c.kind === "tool" && c.tool.type === "form" && ((c.status === "released" && (inAudience(c, app, rec) || flowApprover(c))) || isMaster));
    const out = {}; let total = 0;
    for (const tl of tools) {
      const ks = await store.list(`ctsub:${tl.id}:`); if (!ks.length) continue;
      const rows = (await pool(ks, 40, (k) => store.get(k))).filter(Boolean);
      if (tl.tool.pro) for (const r of rows) { if (await tickTat(store, tl.tool, r, t)) await store.set(`ctsub:${tl.id}:${r.id}`, r); }
      const n = rows.filter((r) => (tl.tool.pro ? canAct(tl, r) && (!isMaster || canActPro(r, app, rec)) : steps(tl).length && canAct(tl, r) && (!isMaster || isApprover(steps(tl)[r.step], app, rec, r))) || (r.status === "returned" && isMine(r))).length;
      if (n) { out[tl.id] = n; total += n; }
    }
    return json(200, { ok: true, tools: out, total });
  }
  if (b.action === "ct-file") {
    const tl = await store.get(`cust:${cid(b.tool)}`);
    const s = await store.get(`ctsub:${cid(b.tool)}:${cid(b.id)}`), f = cid(b.file);
    if (!tl || !s || !Object.values(s.values).includes(f) || (app !== "admin" && !isMine(s) && !approverAny(tl, s))) return json(404, { ok: false, error: "Not found." });
    const a = await store.get(`att:${f}`);
    return a ? json(200, { ok: true, name: a.name, mime: a.mime, data: a.data }) : json(404, { ok: false, error: "Not found." });
  }
  if (b.action === "ct-asset") {   // banner / images placed in a tool by a master
    const tl = await toolFor(b.tool), f = cid(b.file);
    const refs = tl ? [tl.tool.form && tl.tool.form.banner].concat((tl.tool.fields || []).map((x) => x.image)).filter(Boolean) : [];
    if (!tl || !f || !refs.includes(f)) return json(404, { ok: false, error: "Not found." });
    const a = await store.get(`att:${f}`);
    return a ? json(200, { ok: true, mime: a.mime, data: a.data }) : json(404, { ok: false, error: "Not found." });
  }
  // ---- answers to fields a master added to any existing form (saved next to the page's own record) ----
  const fieldsFor = async (formKey) => (await listAll()).filter((c) => c.kind === "fields" && c.formKey === formKey && ((c.status === "released" && inAudience(c, app, rec)) || isMaster)).flatMap((c) => c.fields || []);
  if (b.action === "cxx-save") {
    const formKey = str(b.formKey, 80), fs = await fieldsFor(formKey);
    if (!fs.length) return json(404, { ok: false, error: "No extra fields for this form." });
    const { vals, missing } = await cleanValues(fs, b.values, ctxV);
    if (missing.length) return json(400, { ok: false, error: "Please fill: " + missing.join(", ") });
    const id = nid(t), ref = {};
    Object.entries(b.ref || {}).slice(0, 6).forEach(([k, v]) => { if (/^[a-z]+$/i.test(k) && (typeof v === "string" || typeof v === "number")) ref[k.slice(0, 20)] = str(v, 60); });
    await store.set(`cxx:${sha256(formKey).slice(0, 16)}:${id}`, { id, formKey, action: str(b.from, 40), ref, by: me, state: rec.state || (app === "admin" ? "HO" : ""), values: vals, at: t });
    return json(200, { ok: true, id });
  }
  if (b.action === "cxx-list") {
    if (app !== "admin") return json(403, { ok: false, error: "Admins only." });
    const formKey = str(b.formKey, 80);
    const rows = (await pool(await store.list(`cxx:${sha256(formKey).slice(0, 16)}:`), 40, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 5000);
    return json(200, { ok: true, fields: await fieldsFor(formKey), rows });
  }

  if (!isMaster) return mustMaster();

  // ---- master: customizations ----
  if (b.action === "cust-list") return json(200, { ok: true, items: (await listAll()).sort((x, y) => y.updatedAt - x.updatedAt) });
  if (b.action === "cust-save") {
    const c0 = b.item || {}, kind = ["text", "hide", "list", "fields", "tool"].includes(c0.kind) ? c0.kind : null;
    if (!kind) return json(400, { ok: false, error: "Unknown change type." });
    const id = cid(c0.id) || nid(t), old = (await store.get(`cust:${id}`)) || {};
    const c = { id, kind, page: str(c0.page, 40), note: str(c0.note, 200), status: old.status === "released" && c0.keepReleased ? "released" : "draft",
      audience: c0.audience ? cleanAudience(c0.audience) : old.audience || { roles: [], users: [], states: [] }, createdAt: old.createdAt || t, updatedAt: t, by: rec.fullName };
    if (kind === "text") { c.match = str(c0.match, 300); c.value = str(c0.value, 300); c.attr = ["placeholder", "title"].includes(c0.attr) ? c0.attr : ""; if (!c.match) return json(400, { ok: false, error: "Nothing to change." }); }
    if (kind === "hide") { c.match = str(c0.match, 300); c.up = Math.max(0, Math.min(6, Number(c0.up) || 0)); if (!c.match) return json(400, { ok: false, error: "Nothing to hide." }); }
    if (kind === "list") { c.listKey = str(c0.listKey, 60); c.items = (Array.isArray(c0.items) ? c0.items : String(c0.items || "").split("\n")).map((x) => str(x, 80)).filter(Boolean).slice(0, 80); if (!c.listKey || !c.items.length) return json(400, { ok: false, error: "Add at least one option." }); }
    if (kind === "fields") { c.formKey = str(c0.formKey, 60); c.fields = cleanFields(c0.fields); if (!c.formKey || !c.fields.length) return json(400, { ok: false, error: "Add at least one field." }); }
    if (kind === "tool") {
      const tl = c0.tool || {};
      c.tool = { name: str(tl.name, 60), icon: str(tl.icon, 4) || "🧩", category: CATS.includes(tl.category) ? tl.category : "more", type: TOOL_TYPES.includes(tl.type) ? tl.type : "form", desc: str(tl.desc, 300),
        fields: cleanFields(tl.fields), form: cleanForm(tl.form), flow: cleanFlow(tl.flow), url: /^https?:\/\//i.test(String(tl.url || "")) ? str(tl.url, 600) : "", body: str(tl.body, 20000), report: tl.report && typeof tl.report === "object" ? JSON.parse(JSON.stringify(tl.report).slice(0, 4000)) : null, allowMany: tl.allowMany !== false };
      if (tl.pro === true) { Object.assign(c.tool, cleanProTool(tl), { pro: true, type: "form" }); if (!c.tool.fields.some((f) => !["heading", "image"].includes(f.type))) return json(400, { ok: false, error: "Add at least one field." }); }
      if (!c.tool.name) return json(400, { ok: false, error: "Give the tool a name." });
      if (!tl.pro && c.tool.type === "form" && !c.tool.fields.some((f) => !NOVALUE.includes(f.type))) return json(400, { ok: false, error: "Add at least one question / field to the form." });
      if (c.tool.type === "link" && !c.tool.url) return json(400, { ok: false, error: "Enter the link (https://…)." });
    }
    await store.set(`cust:${id}`, c); await bumpVersion(store, t);
    return json(200, { ok: true, item: c });
  }
  if (b.action === "cust-release") {   // status + audience; works for one or many ids
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(cid).filter(Boolean);
    let n = 0;
    for (const id of ids) {
      const c = await store.get(`cust:${id}`); if (!c) continue;
      if (b.status) c.status = b.status === "released" ? "released" : "draft";
      if (b.audience) c.audience = cleanAudience(b.audience);
      if (b.addUsers) { const a = c.audience || { roles: [], users: [], states: [] }; a.users = [...new Set((a.users || []).concat(cleanAudience({ users: b.addUsers }).users))]; c.audience = a; }
      c.updatedAt = t; c.releasedBy = b.status === "released" ? rec.fullName : c.releasedBy; c.releasedAt = b.status === "released" ? t : c.releasedAt;
      await store.set(`cust:${id}`, c); n++;
    }
    await bumpVersion(store, t);
    return json(200, { ok: true, updated: n });
  }
  if (b.action === "cust-delete") {
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(cid).filter(Boolean);
    for (const id of ids) { await store.delete(`cust:${id}`); for (const k of await store.list(`ctsub:${id}:`)) await store.delete(k); }
    await bumpVersion(store, t);
    return json(200, { ok: true });
  }

  if (b.action === "roledir-save") {   // who holds which role, per state / area (used by Studio Pro approvals)
    const d = b.dir || {}, roles = (Array.isArray(d.roles) ? d.roles : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 60);
    const rows = (Array.isArray(d.rows) ? d.rows : []).slice(0, 5000).map((r) => ({ role: str(r.role, 60), state: str(r.state, 40), area: str(r.area, 60), users: (Array.isArray(r.users) ? r.users : String(r.users || "").split(/[\s,;]+/)).map((u) => str(u, 80)).filter(Boolean).slice(0, 50) })).filter((r) => r.role && r.users.length);
    rows.forEach((r) => { if (!roles.includes(r.role)) roles.push(r.role); });
    await store.set("config:roledir", { roles, rows, by: rec.fullName, at: t });
    return json(200, { ok: true, dir: { roles, rows } });
  }
  // ---- master: who is a master ----
  if (b.action === "master-users") {
    const admins = (await pool(await store.list("user:admin:"), 40, (k) => store.get(k))).filter(Boolean).map((u) => ({ username: u.username, fullName: u.fullName, email: u.email || "", master: !!u.master, disabled: !!u.disabled, lastSeen: u.lastSeen || 0 }));
    return json(200, { ok: true, admins: admins.sort((x, y) => (y.master - x.master) || String(x.fullName).localeCompare(String(y.fullName))) });
  }
  if (b.action === "master-set") {
    const list = Array.isArray(b.users) ? b.users : [{ username: b.target, master: b.master }];
    const out = { updated: 0, notFound: [] };
    for (const x of list.slice(0, 200)) {
      const k = ctx.userKey(x.username); const u = k ? await store.get(`user:admin:${k}`) : null;
      if (!u) { out.notFound.push(str(x.username, 40)); continue; }
      if (k === key && x.master === false) continue;            // can't remove yourself
      u.master = x.master !== false; await store.set(`user:admin:${k}`, u); out.updated++;
      await ctx.logEvent(store, t, "admin", rec, u.master ? "master-granted" : "master-removed", { device: u.username, ver: "" });
    }
    return json(200, Object.assign({ ok: true }, out));
  }
  return json(400, { ok: false, error: "Unknown action" });
}
