// API platform — HO publishes our platform's data as REST APIs for partners / other websites.
//   Endpoints are either a built-in SOURCE (read-only, a fixed safe field list from one tool) or a custom DATASET
//   (HO defines the fields; partners can read / create / update / delete as permitted).
//   Each client (partner) gets an API key (stored only as a hash, shown once), per-endpoint permissions, an optional
//   state scope, a rate limit and expiry. Documentation is generated per client and shared by a read-only link.
// Public API:  /api/v1            GET  list of endpoints for the key
//              /api/v1/<slug>     GET  list (filters, since, limit, cursor)   POST create (datasets)
//              /api/v1/<slug>/<id> GET one · PUT update · DELETE (datasets)
// Storage: oaep:<slug> · oacl:<id> · oakey:<sha256> {id} · oadoc:<token> {id} · oad:<slug>:<id> · oause:<id>:<day> · oarl:<id>:<minute>
import { createHash, randomBytes } from "node:crypto";
import { STATES } from "./cmp-core.mjs";
const J = (status, body, extra) => new Response(JSON.stringify(body), { status, headers: Object.assign({ "content-type": "application/json", "cache-control": "no-store" }, extra || {}) });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const slugOf = (s) => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const TYPES = ["text", "number", "date", "boolean"];

// ---- built-in sources: fixed, reviewed field lists (nothing else from these tools can be exposed) ----
export const SOURCES = {
  stores: { name: "Store directory", tool: "Store locator", prefix: "store:", fields: [["id", "text", "Store ID"], ["name", "text", "Store name"], ["type", "text", "Outlet type"], ["address", "text", "Address"], ["city", "text", "City"], ["state", "text", "State"], ["pincode", "text", "PIN code"], ["lat", "number", "Latitude"], ["lng", "number", "Longitude"], ["phone", "text", "Store phone"], ["hours", "text", "Opening hours"]], map: (r) => [r] },
  imei_unblock: { name: "IMEI unblock requests", tool: "IMEI unblock", prefix: "iubb:", fields: [["id", "text", "Batch + IMEI"], ["imei", "text", "IMEI"], ["status", "text", "Current status"], ["state", "text", "State"], ["partner", "text", "Finance partner"], ["batch", "text", "Request batch"], ["reason", "text", "Reason"], ["at", "date", "Raised at (ms)"]], map: (b) => (b.items || []).map((it) => ({ id: b.id + "-" + it.imei, imei: it.imei, status: it.status, state: b.state, partner: b.partner, batch: b.id, reason: b.reason, at: b.at })) },
  lost_sales: { name: "Lost sales", tool: "Lost-sale tracker", prefix: "lost:", fields: [["id", "text", "Record ID"], ["d", "text", "Day (YYYY-MM-DD)"], ["at", "date", "Logged at (ms)"], ["state", "text", "State"], ["store", "text", "Store"], ["model", "text", "Model asked for"], ["band", "text", "Price band"], ["reason", "text", "Why the sale was lost"], ["comp", "text", "Competitor bought"], ["fin", "text", "Finance issue"]], map: (r) => [r] },
  launches: { name: "Model launches", tool: "New-launch tracker", prefix: "launch:", fields: [["id", "text", "Launch ID"], ["model", "text", "Model"], ["date", "text", "Launch date"], ["states", "text", "States (comma separated)"], ["status", "text", "Status"]], map: (r) => [Object.assign({}, r, { states: (r.states || []).join(", ") })] },
  market_survey: { name: "Market survey responses", tool: "Market surveys", prefix: "msr:", fields: [["id", "text", "Response ID"], ["survey", "text", "Survey ID"], ["at", "date", "Submitted at (ms)"], ["state", "text", "State"], ["city", "text", "City"], ["store", "text", "Store"], ["lat", "number", "Latitude"], ["lng", "number", "Longitude"], ["answers", "text", "Answers (JSON: question id → answer)"]], map: (r, k) => r.done ? [{ id: r.id, survey: k.split(":")[1], at: r.at, state: r.state, city: r.city, store: r.store, lat: r.gps ? r.gps.lat : null, lng: r.gps ? r.gps.lng : null, answers: JSON.stringify(Object.fromEntries(Object.entries(r.answers || {}).filter(([, v]) => !(Array.isArray(v) && v.some((x) => /^R[A-Z0-9]+-/.test(String(x))))))) }] : [] },
};
const epFields = (ep) => ep.kind === "source" ? SOURCES[ep.source].fields.filter((f) => ep.fields.includes(f[0])).map((f) => ({ name: f[0], type: f[1], desc: f[2] })) : ep.fields;
const pubEp = (ep) => ({ slug: ep.slug, name: ep.name, desc: ep.desc, kind: ep.kind, source: ep.source || "", fields: epFields(ep), active: ep.active !== false, at: ep.at });
const pubCl = (c) => ({ id: c.id, name: c.name, org: c.org, contact: c.contact, keyHint: c.keyHint, active: c.active !== false, perms: c.perms || {}, states: c.states || [], rate: c.rate || 60, expires: c.expires || 0, docToken: c.docToken, at: c.at, lastAt: c.lastAt || 0 });
const day = (t) => new Date(t + 19800000).toISOString().slice(0, 10);

async function rowsOf(store, pool, ep) {
  if (ep.kind === "source") {
    const S = SOURCES[ep.source], keys = (await store.list(S.prefix)).slice(-3000), out = [];
    const recs = await pool(keys, 30, async (k) => [k, await store.get(k)]);
    for (const [k, r] of recs) if (r) { try { for (const row of S.map(r, k)) out.push(row); } catch (e) { } }
    return out;
  }
  return (await pool((await store.list("oad:" + ep.slug + ":")).slice(-5000), 30, (k) => store.get(k))).filter(Boolean);
}
const project = (ep, row) => { const o = {}; for (const f of epFields(ep)) o[f.name] = row[f.name] === undefined ? null : row[f.name]; if (ep.kind === "dataset") { o.id = row.id; o.createdAt = row.createdAt; o.updatedAt = row.updatedAt; } return o; };
function cleanRow(ep, body, partial) {
  const o = {};
  for (const f of ep.fields) {
    let v = body[f.name];
    if (v === undefined || v === null || v === "") { if (f.req && !partial) return { error: `Field "${f.name}" is required` }; if (v !== undefined) o[f.name] = null; continue; }
    if (f.type === "number") { if (isNaN(+v)) return { error: `Field "${f.name}" must be a number` }; v = +v; }
    else if (f.type === "boolean") { if (typeof v !== "boolean" && !/^(true|false)$/.test(String(v))) return { error: `Field "${f.name}" must be true or false` }; v = String(v) === "true"; }
    else if (f.type === "date") { v = String(v).slice(0, 30); if (isNaN(Date.parse(v))) return { error: `Field "${f.name}" must be a date (YYYY-MM-DD)` }; }
    else v = String(v).slice(0, 2000);
    o[f.name] = v;
  }
  const unknown = Object.keys(body).filter((k) => !ep.fields.some((f) => f.name === k) && !["id", "createdAt", "updatedAt"].includes(k));
  if (unknown.length) return { error: "Unknown field(s): " + unknown.slice(0, 5).join(", ") };
  return { row: o };
}

// the list/read logic is shared by the public API and the admin "Try it"
async function runList(ctx, ep, cl, q) {
  let rows = await rowsOf(ctx.store, ctx.pool, ep);
  const F = epFields(ep), has = (n) => F.some((f) => f.name === n);
  if (cl.states && cl.states.length && has("state")) rows = rows.filter((r) => cl.states.includes(r.state));
  if (cl.ownOnly && ep.kind === "dataset") rows = rows.filter((r) => r.client === cl.id);
  for (const [k, v] of Object.entries(q)) { if (["limit", "cursor", "since", "sort"].includes(k)) continue; if (!has(k) && k !== "id") return { status: 400, body: { ok: false, error: `Cannot filter on "${k}". Fields: ${F.map((f) => f.name).join(", ")}` } }; rows = rows.filter((r) => String(r[k] == null ? "" : r[k]).toLowerCase() === String(v).toLowerCase()); }
  const tOf = (r) => +(r.updatedAt || r.at || r.createdAt || 0);
  if (q.since) { const s = isNaN(+q.since) ? Date.parse(q.since) : +q.since; if (isNaN(s)) return { status: 400, body: { ok: false, error: "since must be a date (YYYY-MM-DD) or a millisecond timestamp" } }; rows = rows.filter((r) => tOf(r) >= s); }
  rows.sort((a, b) => tOf(b) - tOf(a) || String(a.id).localeCompare(String(b.id)));
  const limit = Math.max(1, Math.min(500, +q.limit || 100)), start = Math.max(0, +q.cursor || 0), page = rows.slice(start, start + limit);
  return { status: 200, body: { ok: true, count: page.length, total: rows.length, next: start + limit < rows.length ? String(start + limit) : null, data: page.map((r) => project(ep, r)) } };
}

// ======================= public REST API =======================
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-api-key, authorization", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
export async function oaHttp(req, { store, pool, now }) {
  const t = now || Date.now();
  const out = (s, b) => J(s, b, CORS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url), parts = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const key = (req.headers.get("x-api-key") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")).trim();
  if (!key) return out(401, { ok: false, error: "Missing API key. Send it in the X-API-Key header." });
  const ix = await store.get("oakey:" + sha(key)), cl = ix ? await store.get("oacl:" + ix.id) : null;
  if (!cl) return out(401, { ok: false, error: "Invalid API key." });
  if (cl.active === false) return out(403, { ok: false, error: "This API key is switched off. Contact vivo." });
  if (cl.expires && t > cl.expires) return out(403, { ok: false, error: "This API key has expired. Contact vivo." });
  const rk = `oarl:${cl.id}:${Math.floor(t / 60000)}`, rl = (await store.get(rk)) || { n: 0 }; rl.n++;
  if (rl.n > (cl.rate || 60)) return out(429, { ok: false, error: `Rate limit reached (${cl.rate || 60} requests a minute). Try again in a minute.` });
  await store.set(rk, rl);
  const count = async (slug, okk) => { const uk = `oause:${cl.id}:${day(t)}`, u = (await store.get(uk)) || { n: 0, err: 0, by: {} }; u.n++; if (!okk) u.err++; u.by[slug || "-"] = (u.by[slug || "-"] || 0) + 1; await store.set(uk, u); if (!cl.lastAt || t - cl.lastAt > 60000) { cl.lastAt = t; await store.set("oacl:" + cl.id, cl); } };
  const done = async (slug, s, b) => { await count(slug, s < 400); return out(s, b); };
  const perms = cl.perms || {};
  if (!parts.length) {
    const eps = []; for (const slug of Object.keys(perms)) { const ep = await store.get("oaep:" + slug); if (ep && ep.active !== false && (perms[slug].r || perms[slug].w)) eps.push({ endpoint: "/api/v1/" + slug, name: ep.name, read: !!perms[slug].r, write: ep.kind === "dataset" && !!perms[slug].w, delete: ep.kind === "dataset" && !!perms[slug].d }); }
    return done("", 200, { ok: true, client: cl.name, endpoints: eps });
  }
  const slug = parts[0], id = parts[1], ep = await store.get("oaep:" + slug), pm = perms[slug];
  if (!ep || ep.active === false || !pm) return done(slug, 404, { ok: false, error: "Unknown endpoint, or your key has no access to it." });
  const ctx = { store, pool };
  if (req.method === "GET") {
    if (!pm.r) return done(slug, 403, { ok: false, error: "Your key cannot read this endpoint." });
    const q = Object.fromEntries(url.searchParams.entries()); if (id) q.id = id;
    const r = await runList(ctx, ep, Object.assign({}, cl, { ownOnly: !pm.all }), id ? { id } : q);
    if (id && r.status === 200) return done(slug, r.body.data.length ? 200 : 404, r.body.data.length ? { ok: true, data: r.body.data[0] } : { ok: false, error: "Not found" });
    return done(slug, r.status, r.body);
  }
  if (ep.kind !== "dataset") return done(slug, 405, { ok: false, error: "This endpoint is read-only." });
  if (req.method === "DELETE") {
    if (!pm.d) return done(slug, 403, { ok: false, error: "Your key cannot delete on this endpoint." });
    const row = id ? await store.get(`oad:${slug}:${id}`) : null; if (!row || (row.client && row.client !== cl.id && !pm.all)) return done(slug, 404, { ok: false, error: "Not found" });
    await store.delete(`oad:${slug}:${id}`); return done(slug, 200, { ok: true, deleted: id });
  }
  if (!pm.w) return done(slug, 403, { ok: false, error: "Your key cannot write to this endpoint." });
  let body; try { body = JSON.parse(await req.text()); } catch (e) { return done(slug, 400, { ok: false, error: "The body must be JSON." }); }
  if (req.method === "POST" && !id) {
    const list = Array.isArray(body) ? body : Array.isArray(body.rows) ? body.rows : [body];
    if (!list.length || list.length > 100) return done(slug, 400, { ok: false, error: "Send 1 to 100 rows." });
    const made = [];
    for (const [i, b] of list.entries()) { const c = cleanRow(ep, b && typeof b === "object" ? b : {}, false); if (c.error) return done(slug, 400, { ok: false, error: (list.length > 1 ? "Row " + (i + 1) + ": " : "") + c.error }); made.push(c.row); }
    if (cl.states && cl.states.length && ep.fields.some((f) => f.name === "state")) { const bad = made.find((r) => !cl.states.includes(r.state)); if (bad) return done(slug, 403, { ok: false, error: "Your key can only write rows for: " + cl.states.join(", ") }); }
    const saved = [];
    for (const r of made) { const rid = t.toString(36) + randomBytes(4).toString("hex"); Object.assign(r, { id: rid, createdAt: t, updatedAt: t, client: cl.id }); await store.set(`oad:${slug}:${rid}`, r); saved.push(project(ep, r)); }
    return done(slug, 201, { ok: true, count: saved.length, data: list.length === 1 && !Array.isArray(body) && !body.rows ? saved[0] : saved });
  }
  if ((req.method === "PUT" || req.method === "PATCH") && id) {
    const row = await store.get(`oad:${slug}:${id}`); if (!row || (row.client && row.client !== cl.id && !pm.all)) return done(slug, 404, { ok: false, error: "Not found" });
    const c = cleanRow(ep, body && typeof body === "object" ? body : {}, true); if (c.error) return done(slug, 400, { ok: false, error: c.error });
    Object.assign(row, c.row, { updatedAt: t }); await store.set(`oad:${slug}:${id}`, row);
    return done(slug, 200, { ok: true, data: project(ep, row) });
  }
  return done(slug, 405, { ok: false, error: "Method not allowed here." });
}

// ======================= HO admin =======================
export async function oaAction(b, ctx) {
  const { store, t, app, rec, pool, env = {} } = ctx;
  if (app !== "admin") return J(403, { ok: false, error: "Only HO admins manage the API platform." });
  const by = rec.fullName || rec.username || "", site = env.SITE_URL || "";
  const eps = async () => (await pool(await store.list("oaep:"), 20, (k) => store.get(k))).filter(Boolean).sort((a, c) => a.name.localeCompare(c.name));
  const cls = async () => (await pool(await store.list("oacl:"), 20, (k) => store.get(k))).filter(Boolean).sort((a, c) => c.at - a.at);
  if (b.action === "oa-list") return J(200, { ok: true, base: site + "/api/v1", endpoints: (await eps()).map(pubEp), clients: (await cls()).map(pubCl), sources: Object.keys(SOURCES).map((k) => ({ id: k, name: SOURCES[k].name, tool: SOURCES[k].tool, fields: SOURCES[k].fields.map((f) => ({ name: f[0], type: f[1], desc: f[2] })) })), states: STATES, types: TYPES });
  if (b.action === "oa-ep-save") {
    const e = b.ep || {}, old = e.slug && !b.create ? await store.get("oaep:" + e.slug) : null;
    const slug = old ? old.slug : slugOf(e.slug || e.name);
    if (!slug || slug.length < 3) return J(400, { ok: false, error: "Give the endpoint a name (at least 3 letters)" });
    if (!old && await store.get("oaep:" + slug)) return J(409, { ok: false, error: "An endpoint called “" + slug + "” already exists" });
    const kind = old ? old.kind : e.kind === "source" ? "source" : "dataset";
    const ep = { slug, kind, name: str(e.name, 60) || slug, desc: str(e.desc, 300), active: e.active !== false, at: old ? old.at : t, by: old ? old.by : by, upd: t };
    if (kind === "source") {
      ep.source = old ? old.source : e.source; if (!SOURCES[ep.source]) return J(400, { ok: false, error: "Choose the data source" });
      ep.fields = (Array.isArray(e.fields) ? e.fields : []).map((f) => typeof f === "string" ? f : f.name).filter((f) => SOURCES[ep.source].fields.some((x) => x[0] === f));
      if (!ep.fields.length) return J(400, { ok: false, error: "Tick at least one field to share" });
    } else {
      ep.fields = (Array.isArray(e.fields) ? e.fields : []).slice(0, 40).map((f) => ({ name: str(f.name, 30).replace(/[^A-Za-z0-9_]/g, ""), type: TYPES.includes(f.type) ? f.type : "text", req: !!f.req, desc: str(f.desc, 120) })).filter((f) => /^[A-Za-z]/.test(f.name) && !["id", "createdAt", "updatedAt", "client"].includes(f.name));
      if (!ep.fields.length) return J(400, { ok: false, error: "Add at least one field" });
    }
    await store.set("oaep:" + slug, ep); return J(200, { ok: true, ep: pubEp(ep) });
  }
  if (b.action === "oa-ep-del") {
    const ep = await store.get("oaep:" + str(b.slug, 40)); if (!ep) return J(404, { ok: false, error: "Endpoint not found" });
    if (ep.kind === "dataset") for (const k of await store.list("oad:" + ep.slug + ":")) await store.delete(k);
    for (const c of await cls()) if (c.perms && c.perms[ep.slug]) { delete c.perms[ep.slug]; await store.set("oacl:" + c.id, c); }
    await store.delete("oaep:" + ep.slug); return J(200, { ok: true });
  }
  if (b.action === "oa-cl-save") {
    const c = b.client || {}, old = c.id ? await store.get("oacl:" + c.id) : null;
    if (c.id && !old) return J(404, { ok: false, error: "Client not found" });
    const cl = old || { id: "C" + t.toString(36).toUpperCase() + randomBytes(2).toString("hex"), at: t, by, docToken: randomBytes(12).toString("hex") };
    cl.name = str(c.name, 60); if (!cl.name) return J(400, { ok: false, error: "Enter the partner / client name" });
    cl.org = str(c.org, 80); cl.contact = str(c.contact, 120); cl.active = c.active !== false;
    cl.states = (Array.isArray(c.states) ? c.states : []).filter((s) => STATES.includes(s));
    cl.rate = Math.max(1, Math.min(600, +c.rate || 60)); cl.expires = +c.expires || 0;
    const all = await eps(); cl.perms = {};
    for (const ep of all) { const p = (c.perms || {})[ep.slug]; if (p && (p.r || p.w || p.d)) cl.perms[ep.slug] = { r: !!p.r, w: ep.kind === "dataset" && !!p.w, d: ep.kind === "dataset" && !!p.d, all: ep.kind === "dataset" && !!p.all }; }
    let newKey = "";
    if (!old || b.newKey) { if (cl.keyHash) await store.delete("oakey:" + cl.keyHash); newKey = "vbi_" + randomBytes(24).toString("hex"); cl.keyHash = sha(newKey); cl.keyHint = newKey.slice(0, 8) + "…" + newKey.slice(-4); await store.set("oakey:" + cl.keyHash, { id: cl.id }); }
    await store.set("oacl:" + cl.id, cl); await store.set("oadoc:" + cl.docToken, { id: cl.id });
    return J(200, { ok: true, client: pubCl(cl), newKey, docs: site + "/apiplatform.html?d=" + cl.docToken });
  }
  if (b.action === "oa-cl-del") {
    const cl = await store.get("oacl:" + str(b.id, 30)); if (!cl) return J(404, { ok: false, error: "Client not found" });
    if (cl.keyHash) await store.delete("oakey:" + cl.keyHash); await store.delete("oadoc:" + cl.docToken); await store.delete("oacl:" + cl.id); return J(200, { ok: true });
  }
  if (b.action === "oa-usage") {
    const out = {}; const days = []; for (let i = 0; i < 14; i++) days.push(day(t - i * 86400000));
    for (const c of await cls()) { out[c.id] = []; for (const d of days) { const u = await store.get(`oause:${c.id}:${d}`); out[c.id].push({ d, n: u ? u.n : 0, err: u ? u.err : 0, by: u ? u.by : {} }); } }
    return J(200, { ok: true, days, usage: out });
  }
  if (b.action === "oa-try") {   // preview what a client would get (no key needed, nothing counted)
    const ep = await store.get("oaep:" + str(b.slug, 40)); if (!ep) return J(404, { ok: false, error: "Endpoint not found" });
    const cl = b.client ? await store.get("oacl:" + b.client) : { states: [] };
    const r = await runList({ store, pool }, ep, cl || { states: [] }, Object.assign({ limit: 20 }, b.q || {}));
    return J(200, { ok: true, status: r.status, body: r.body });
  }
  if (b.action === "oa-rows-del") { await store.delete(`oad:${str(b.slug, 40)}:${str(b.id, 40)}`); return J(200, { ok: true }); }
  return J(400, { ok: false, error: "Unknown action" });
}

// read-only documentation for one client (no key in it)
export async function oaPublic(b, { store, pool, env = {} }) {
  const ix = await store.get("oadoc:" + String(b.d || "").replace(/[^a-f0-9]/g, "")), cl = ix ? await store.get("oacl:" + ix.id) : null;
  if (!cl) return J(404, { ok: false, error: "This documentation link isn't valid." });
  const eps = [];
  for (const slug of Object.keys(cl.perms || {})) { const ep = await store.get("oaep:" + slug); if (ep && ep.active !== false) eps.push(Object.assign(pubEp(ep), { perm: cl.perms[slug] })); }
  return J(200, { ok: true, client: { name: cl.name, org: cl.org, states: cl.states || [], rate: cl.rate || 60, expires: cl.expires || 0, keyHint: cl.keyHint, active: cl.active !== false }, base: (env.SITE_URL || "") + "/api/v1", endpoints: eps });
}
