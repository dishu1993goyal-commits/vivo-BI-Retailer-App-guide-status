// Email geo-locator — consent first. An authorised HO admin enters an email: the server says whether it belongs to a
// registered app user. For a registered user it shows the latest location that user chose to share (an approved
// request, or their own market-visit check-in), otherwise HO sends an in-app request that the user can approve or
// decline. Nothing is captured without the user's tap; every search, request and answer is in the audit log.
// Storage:  geoq:<id> { id, to:{app,key}, email, by:{app,key,name}, note, at, exp, status: pending|approved|declined|expired, loc }
//           geoloc:<app>:<key> { lat, lng, acc, at, src, reqId }      geolog:<ts>-<rand> { at, by, email, act, status }
import { allowedFor } from "./access-core.mjs";
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const EXP = 24 * 3600000, FRESH = 7 * 864e5, VISIT_AGE = 30 * 864e5;
const num = (v, lo, hi) => { const n = Number(v); return isFinite(n) && n >= lo && n <= hi ? n : null; };

async function findByEmail(store, pool, email) {
  for (const app of ["state", "admin"]) {
    const us = await pool(await store.list(`user:${app}:`), 40, async (k) => ({ k, u: await store.get(k) }));
    const hit = us.find((x) => x.u && low(x.u.email) === email);
    if (hit) return { app, key: hit.k.slice(`user:${app}:`.length), u: hit.u };
  }
  return null;
}

export async function geoAction(b, ctx) {
  const { store, t, app, rec, key, pool } = ctx, me = { app, key, name: rec.fullName || rec.username };
  const log = (act, email, extra) => store.set(`geolog:${t}-${randomBytes(3).toString("hex")}`, Object.assign({ at: t, by: me, email, act }, extra || {}));

  // ---- the user's side: requests waiting for me, and my answer ----
  if (b.action === "geo-pending") {
    const ks = await store.list("geoq:"), L = (await pool(ks, 40, (k) => store.get(k))).filter((q) => q && q.to.app === app && q.to.key === key && q.status === "pending" && q.exp > t);
    const mine = (await store.get(`geoloc:${app}:${key}`)) || null;
    return json(200, { ok: true, items: L.map((q) => ({ id: q.id, from: q.by.name, note: q.note, at: q.at, exp: q.exp })), lastShared: mine ? { at: mine.at, src: mine.src } : null });
  }
  if (b.action === "geo-respond") {
    const q = await store.get(`geoq:${str(b.id, 40).replace(/[^a-z0-9]/gi, "")}`);
    if (!q || q.to.app !== app || q.to.key !== key) return json(404, { ok: false, error: "Request not found." });
    if (q.status !== "pending" || q.exp <= t) return json(400, { ok: false, error: "This request has expired or was already answered." });
    if (!b.allow) { q.status = "declined"; q.answeredAt = t; await store.set(`geoq:${q.id}`, q); await log("declined", q.email, { req: q.id, status: "declined" }); return json(200, { ok: true, status: "declined" }); }
    const lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180), acc = num(b.acc, 0, 100000);
    if (lat == null || lng == null) return json(400, { ok: false, error: "Couldn't read your location — switch on location and try again." });
    const loc = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: acc == null ? null : Math.round(acc), at: t, src: "request", reqId: q.id };
    q.status = "approved"; q.answeredAt = t; q.loc = loc; await store.set(`geoq:${q.id}`, q); await store.set(`geoloc:${app}:${key}`, loc);
    await log("approved", q.email, { req: q.id, status: "approved" });
    return json(200, { ok: true, status: "approved" });
  }
  if (b.action === "geo-forget") {   // the user removes the location they shared
    await store.delete(`geoloc:${app}:${key}`); await log("user-cleared", low(rec.email)); return json(200, { ok: true });
  }

  // ---- HO side ----
  if (app !== "admin") return json(403, { ok: false, error: "Only authorised HO admins can use the geo-locator." });
  const rule = ((await store.get("config:access")) || { r: {} }).r || {};
  if (!allowedFor(rule["tool:geolocate"], app, rec)) return json(403, { ok: false, error: "You are not authorised for the geo-locator. Ask the master admin (Access control)." });

  if (b.action === "geo-search") {
    const email = low(str(b.email, 120)); if (!EMAIL.test(email)) return json(400, { ok: false, error: "Enter a valid email ID." });
    const u = await findByEmail(store, pool, email);
    if (!u) { await log("search", email, { status: "not-registered" }); return json(200, { ok: true, email, registered: false }); }
    const user = { name: u.u.fullName || u.u.username, username: u.u.username, app: u.app === "admin" ? "Admin app" : "State app", state: u.u.state || "", disabled: !!u.u.disabled };
    let last = null; const shared = await store.get(`geoloc:${u.app}:${u.key}`);
    if (shared && t - shared.at < 90 * 864e5) last = Object.assign({}, shared, { label: "Shared by the user on request" });
    // their own market-visit check-in is location they already shared with HO for that visit
    const mo = (d) => new Date(d + 19800000).toISOString().slice(0, 7).replace("-", "");
    for (const m of [...new Set([mo(t), mo(t - 31 * 864e5)])]) {
      const vs = await pool(await store.list(`visit:${m}:`), 40, (k) => store.get(k));
      vs.forEach((v) => { if (!v || !v.by || v.by.app !== u.app || low(v.by.username) !== low(u.u.username) || !v.in || v.in.lat == null || t - v.in.t > VISIT_AGE) return; if (!last || v.in.t > last.at) last = { lat: v.in.lat, lng: v.in.lng, acc: v.in.acc == null ? null : v.in.acc, at: v.in.t, src: "visit", label: "Market visit check-in" + (v.store && v.store.name ? " — " + str(v.store.name, 60) : "") }; });
    }
    const qs = (await pool(await store.list("geoq:"), 40, (k) => store.get(k))).filter((q) => q && q.to.app === u.app && q.to.key === u.key).sort((a, c) => c.at - a.at);
    qs.forEach((q) => { if (q.status === "pending" && q.exp <= t) q.status = "expired"; });
    await log("search", email, { status: "registered" + (last ? " · location shown" : "") });
    return json(200, { ok: true, email, registered: true, active: !u.u.disabled, user, last, fresh: !!(last && t - last.at < FRESH),
      requests: qs.slice(0, 5).map((q) => ({ id: q.id, status: q.status, at: q.at, by: q.by.name, answeredAt: q.answeredAt || 0 })) });
  }
  if (b.action === "geo-request") {
    const email = low(str(b.email, 120)), u = EMAIL.test(email) ? await findByEmail(store, pool, email) : null;
    if (!u) return json(404, { ok: false, error: "This email is not registered." });
    if (u.u.disabled) return json(400, { ok: false, error: "This user is disabled." });
    if (u.app === app && u.key === key) return json(400, { ok: false, error: "That's you." });
    const open = (await pool(await store.list("geoq:"), 40, (k) => store.get(k))).find((q) => q && q.to.app === u.app && q.to.key === u.key && q.status === "pending" && q.exp > t);
    if (open) return json(200, { ok: true, id: open.id, already: true });
    const id = t.toString(36) + randomBytes(4).toString("hex");
    await store.set(`geoq:${id}`, { id, to: { app: u.app, key: u.key }, email, by: me, note: str(b.note, 160), at: t, exp: t + EXP, status: "pending" });
    await log("request", email, { req: id, status: "sent" });
    return json(200, { ok: true, id });
  }
  if (b.action === "geo-status") {
    const q = await store.get(`geoq:${str(b.id, 40).replace(/[^a-z0-9]/gi, "")}`); if (!q) return json(404, { ok: false, error: "Request not found." });
    const st = q.status === "pending" && q.exp <= t ? "expired" : q.status;
    return json(200, { ok: true, status: st, loc: st === "approved" ? Object.assign({}, q.loc, { label: "Shared by the user on request" }) : null, answeredAt: q.answeredAt || 0 });
  }
  if (b.action === "geo-cancel") {
    const q = await store.get(`geoq:${str(b.id, 40).replace(/[^a-z0-9]/gi, "")}`); if (!q || q.status !== "pending") return json(200, { ok: true });
    q.status = "cancelled"; await store.set(`geoq:${q.id}`, q); await log("cancel", q.email, { req: q.id }); return json(200, { ok: true });
  }
  if (b.action === "geo-log") {
    const ks = (await store.list("geolog:")).sort().reverse().slice(0, 200);
    return json(200, { ok: true, items: (await pool(ks, 40, (k) => store.get(k))).filter(Boolean).map((x) => ({ at: x.at, by: x.by.name, email: x.email, act: x.act, status: x.status || "" })) });
  }
  return json(400, { ok: false, error: "Unknown action." });
}
