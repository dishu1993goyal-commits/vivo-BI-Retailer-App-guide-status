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
export const FIELD_TYPES = ["text", "longtext", "number", "date", "select", "multi", "yesno", "rating", "photo"];
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

function cleanFields(a) {
  return (Array.isArray(a) ? a : []).slice(0, 30).map((f, i) => ({
    key: str(f.key, 30).replace(/[^a-z0-9_]/gi, "") || "f" + i + randomBytes(2).toString("hex"), label: str(f.label, 80), type: FIELD_TYPES.includes(f.type) ? f.type : "text",
    options: (Array.isArray(f.options) ? f.options : String(f.options || "").split(/\n|,/)).map((o) => str(o, 80)).filter(Boolean).slice(0, 40), required: f.required === true, help: str(f.help, 160) })).filter((f) => f.label);
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
    const rows = (await listAll()).filter((c) => (c.status === "released" && inAudience(c, app, rec)) || isMaster);
    const out = rows.map((c) => { const o = Object.assign({}, c); o.draft = c.status !== "released"; if (!isMaster) { delete o.audience; delete o.note; } return o; });
    return json(200, { ok: true, ver: isMaster ? ver + ":" + rows.length + ":" + rows.reduce((a, c) => Math.max(a, c.updatedAt || 0), 0) : ver, role, master: isMaster, items: out });
  }

  // ---- custom tool use (forms) ----
  if (b.action === "ct-submit") {
    const tl = await store.get(`cust:${cid(b.tool)}`);
    if (!tl || tl.kind !== "tool" || tl.tool.type !== "form" || !((tl.status === "released" && inAudience(tl, app, rec)) || isMaster)) return json(404, { ok: false, error: "Form not available." });
    const vals = {}, missing = [];
    for (const f of tl.tool.fields || []) {
      let v = (b.values || {})[f.key];
      if (f.type === "photo") { const c = cid(v); const att = c ? await store.get(`att:${c}`) : null; v = att && sameUser(att.by, who(app, rec)) ? c : ""; }
      else if (f.type === "multi") v = (Array.isArray(v) ? v : []).map((x) => str(x, 80)).filter((x) => !f.options.length || f.options.includes(x)).slice(0, 20);
      else if (f.type === "number") v = v === "" || v == null || !isFinite(Number(v)) ? "" : Number(v);
      else v = str(v, f.type === "longtext" ? 3000 : 300);
      if (f.required && (v === "" || (Array.isArray(v) && !v.length))) missing.push(f.label);
      vals[f.key] = v;
    }
    if (missing.length) return json(400, { ok: false, error: "Please fill: " + missing.join(", ") });
    const id = nid(t);
    await store.set(`ctsub:${tl.id}:${id}`, { id, tool: tl.id, by: who(app, rec), state: rec.state || (app === "admin" ? "HO" : ""), values: vals, at: t });
    return json(200, { ok: true, id });
  }
  if (b.action === "ct-list") {
    const tl = await store.get(`cust:${cid(b.tool)}`);
    if (!tl || tl.kind !== "tool") return json(404, { ok: false, error: "Not found." });
    let rows = (await pool(await store.list(`ctsub:${tl.id}:`), 40, (k) => store.get(k))).filter(Boolean);
    const me = who(app, rec);
    if (app !== "admin") rows = rows.filter((r) => sameUser(r.by, me));
    return json(200, { ok: true, tool: tl.tool, rows: rows.sort((x, y) => y.at - x.at).slice(0, 3000), all: app === "admin" });
  }
  if (b.action === "ct-file") {
    const s = await store.get(`ctsub:${cid(b.tool)}:${cid(b.id)}`), f = cid(b.file);
    if (!s || !Object.values(s.values).includes(f) || (app !== "admin" && !sameUser(s.by, who(app, rec)))) return json(404, { ok: false, error: "Not found." });
    const a = await store.get(`att:${f}`);
    return a ? json(200, { ok: true, name: a.name, mime: a.mime, data: a.data }) : json(404, { ok: false, error: "Not found." });
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
        fields: cleanFields(tl.fields), url: /^https?:\/\//i.test(String(tl.url || "")) ? str(tl.url, 600) : "", body: str(tl.body, 20000), report: tl.report && typeof tl.report === "object" ? JSON.parse(JSON.stringify(tl.report).slice(0, 4000)) : null, allowMany: tl.allowMany !== false };
      if (!c.tool.name) return json(400, { ok: false, error: "Give the tool a name." });
      if (c.tool.type === "form" && !c.tool.fields.length) return json(400, { ok: false, error: "Add at least one field to the form." });
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
