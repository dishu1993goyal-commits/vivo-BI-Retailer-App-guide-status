// Master admin (an admin account with rec.master = true): customizes everything and releases changes to chosen audiences.
// Storage:
//   config:master          { claimed, claimedBy, claimedAt }
//   cust:<id>              { id, kind:"text"|"hide"|"list"|"fields"|"tool", page, match, value, up, listKey, items, formKey, fields, tool,
//                            status:"draft"|"released", audience:{ roles:[], users:[], states:[] }, note, createdAt, updatedAt, by }
//   ctsub:<toolId>:<id>    custom-form submission { id, tool, by, state, values, at }
//   custver                { v }   bumped on every change so apps refresh their cached customizations
import { randomBytes, createHash } from "node:crypto";
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
  const flowApprover = (tl) => ((tl.tool.flow && tl.tool.flow.steps) || []).some((st) => isApprover(Object.assign({}, st, { sameState: false }), app, rec, null));
  const toolFor = async (id, approve) => { const tl = await store.get(`cust:${cid(id)}`); return tl && tl.kind === "tool" && ((tl.status === "released" && (inAudience(tl, app, rec) || (approve && flowApprover(tl)))) || isMaster) ? tl : null; };
  const isMine = (r) => r.bk === myBk || (!r.anon && sameUser(r.by, me));
  const steps = (tl) => (tl.tool.flow && tl.tool.flow.steps) || [];
  const canAct = (tl, r) => r.status === "pending" && (isMaster || isApprover(steps(tl)[r.step], app, rec, r));
  const approverAny = (tl, r) => steps(tl).some((st) => isApprover(st, app, rec, r));
  const ctxV = { store, app, rec, who, sameUser };
  const pub = (tl, r) => { const o = Object.assign({}, r, { mine: isMine(r), canAct: canAct(tl, r) }); delete o.bk; if (r.anon && !isMaster) { o.by = { fullName: "Anonymous", username: "" }; o.history = (r.history || []).map((h) => /submitted/.test(h.action) ? Object.assign({}, h, { by: { fullName: "Anonymous", username: "", app: "" } }) : h); } return o; };

  // ---- custom tool use (forms, surveys, approval flows) ----
  if (b.action === "ct-submit") {
    const tl = await toolFor(b.tool);
    if (!tl || tl.tool.type !== "form") return json(404, { ok: false, error: "Form not available." });
    const fm = tl.tool.form || {};
    if (fm.closeAt && t > fm.closeAt && !isMaster) return json(400, { ok: false, error: "This form is closed." });
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
    const all = app === "admin";
    if (!all) rows = rows.filter((r) => isMine(r) || approverAny(tl, r));
    const out = rows.sort((x, y) => (y.updatedAt || y.at) - (x.updatedAt || x.at)).slice(0, 3000).map((r) => pub(tl, r));
    return json(200, { ok: true, tool: tl.tool, rows: out, all, approver: isMaster || steps(tl).some((st) => isApprover(st, app, rec, { state: rec.state })), pending: out.filter((r) => r.canAct).length });
  }
  if (b.action === "ct-notify") {   // approvals waiting for me + my responses sent back, per tool
    const tools = (await listAll()).filter((c) => c.kind === "tool" && c.tool.type === "form" && ((c.status === "released" && (inAudience(c, app, rec) || flowApprover(c))) || isMaster));
    const out = {}; let total = 0;
    for (const tl of tools) {
      const ks = await store.list(`ctsub:${tl.id}:`); if (!ks.length) continue;
      const rows = (await pool(ks, 40, (k) => store.get(k))).filter(Boolean);
      const n = rows.filter((r) => (steps(tl).length && canAct(tl, r) && (!isMaster || isApprover(steps(tl)[r.step], app, rec, r))) || (r.status === "returned" && isMine(r))).length;
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
      if (!c.tool.name) return json(400, { ok: false, error: "Give the tool a name." });
      if (c.tool.type === "form" && !c.tool.fields.some((f) => !NOVALUE.includes(f.type))) return json(400, { ok: false, error: "Add at least one question / field to the form." });
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
