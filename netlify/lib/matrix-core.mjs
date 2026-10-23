// "Current features usability" matrix: admins import states × features from Excel,
// each state user ticks only their own state's row, admins can freeze it (then only admins can edit).
// Storage:
//   matrix:current              { id, title, features[], states[], initial:{norm:{feature:true}}, frozen, ... }
//   mrow:<id>:<stateNorm>       { cells:{feature:bool}, by, byName, at, confirmed, confirmedAt }
//   matrix:arch:<id>            snapshot of an older matrix (with its rows merged in)
import { randomBytes } from "node:crypto";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
export const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const MAX_F = 80, MAX_S = 80;

async function merged(store, m, pool) {
  const ks = await store.list(`mrow:${m.id}:`);
  const rows = (await pool(ks, 40, (k) => store.get(k))).filter(Boolean);
  const byNorm = {}; rows.forEach((r) => { byNorm[r.norm] = r; });
  return m.states.map((s) => {
    const n = norm(s), r = byNorm[n];
    const init = (m.initial && m.initial[n]) || {};
    const cells = {};
    m.features.forEach((f) => { cells[f] = r && r.cells && f in r.cells ? !!r.cells[f] : !!init[f]; });
    return { state: s, norm: n, cells, by: r ? r.byName || r.by : "", byApp: r ? r.byApp : "", at: r ? r.at : 0, confirmed: !!(r && r.confirmed), confirmedAt: r ? r.confirmedAt || 0 : 0 };
  });
}

export async function matrixAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx;
  const isAdmin = app === "admin";
  const myNorm = norm(rec.state);
  const m = await store.get("matrix:current");

  if (b.action === "matrix-get" || b.action === "matrix-notify") {
    if (!m) return b.action === "matrix-notify" ? null : json(200, { ok: true, matrix: null, archive: await archList() });
    const rows = await merged(store, m, pool);
    const mine = rows.find((r) => r.norm === myNorm);
    if (b.action === "matrix-notify") {
      return { id: m.id, title: m.title, frozen: !!m.frozen, importedAt: m.createdAt, announcedAt: Math.max(m.createdAt || 0, m.remindedAt || 0),
        pending: !isAdmin && !m.frozen && !!mine && !mine.confirmed,
        confirmed: rows.filter((r) => r.confirmed).length, total: rows.length };
    }
    return json(200, { ok: true, matrix: { id: m.id, title: m.title, note: m.note || "", features: m.features, states: m.states, frozen: !!m.frozen,
      frozenAt: m.frozenAt || 0, frozenBy: m.frozenBy || "", createdAt: m.createdAt, createdBy: m.createdBy, updatedAt: m.updatedAt || m.createdAt },
      rows, myState: mine ? mine.state : "", me: { state: rec.state || "", app }, canEditMine: !!mine && !m.frozen && !isAdmin, isAdmin, archive: isAdmin ? await archList() : [] });
  }

  async function archList() {
    if (!isAdmin) return [];
    const ks = await store.list("matrix:arch:");
    return (await pool(ks, 20, (k) => store.get(k))).filter(Boolean)
      .map((a) => ({ id: a.id, title: a.title, createdAt: a.createdAt, archivedAt: a.archivedAt, frozen: a.frozen })).sort((x, y) => y.archivedAt - x.archivedAt);
  }

  if (b.action === "matrix-arch") {
    if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can see older matrices." });
    const a = await store.get(`matrix:arch:${String(b.id || "").replace(/[^a-z0-9]/gi, "")}`);
    return a ? json(200, { ok: true, archived: a }) : json(404, { ok: false, error: "Not found." });
  }

  if (b.action === "matrix-import") {
    if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can import the matrix." });
    const features = [], states = [], fn = new Set(), sn = new Set();
    (Array.isArray(b.features) ? b.features : []).forEach((f) => { const v = str(f, 60); if (v && !fn.has(norm(v)) && features.length < MAX_F) { fn.add(norm(v)); features.push(v); } });
    (Array.isArray(b.states) ? b.states : []).forEach((s) => { const v = str(s, 40); if (v && norm(v) && !sn.has(norm(v)) && states.length < MAX_S) { sn.add(norm(v)); states.push(v); } });
    if (!features.length) return json(400, { ok: false, error: "No features found in the first row." });
    if (!states.length) return json(400, { ok: false, error: "No states found in the first column." });
    const initial = {};
    const cells = b.cells && typeof b.cells === "object" ? b.cells : {};
    states.forEach((s) => {
      const row = cells[s] || {}; const o = {};
      features.forEach((f) => { if (row[f] === true) o[f] = true; });
      initial[norm(s)] = o;
    });
    if (m) {   // keep the old matrix (with everyone's ticks) for reference
      const rows = await merged(store, m, pool);
      await store.set(`matrix:arch:${m.id}`, Object.assign({}, m, { rows, archivedAt: t, archivedBy: rec.username }));
    }
    const nm = { id: t.toString(36) + randomBytes(3).toString("hex"), title: str(b.title, 100) || "Current features usability",
      note: str(b.note, 300), features, states, initial, frozen: false, createdAt: t, createdBy: rec.username, updatedAt: t };
    await store.set("matrix:current", nm);
    await ctx.logEvent(store, t, app, rec, "matrix-imported", { device: nm.title.slice(0, 60), ver: "" });
    return json(200, { ok: true, id: nm.id, features: features.length, states: states.length });
  }

  if (!m) return json(404, { ok: false, error: "No matrix has been imported yet." });

  if (b.action === "matrix-set") {
    const target = isAdmin ? norm(b.state) : myNorm;
    const sName = m.states.find((s) => norm(s) === target);
    if (!sName) return json(isAdmin ? 404 : 403, { ok: false, error: isAdmin ? "State not in the matrix." : "Your state (" + (rec.state || "not set") + ") is not in this matrix. Ask a BI admin." });
    if (!isAdmin && b.state && norm(b.state) !== myNorm) return json(403, { ok: false, error: "You can edit only your own state's row." });
    if (m.frozen && !isAdmin) return json(423, { ok: false, error: "The matrix is frozen by a BI admin. It can only be viewed now.", frozen: true });
    const rk = `mrow:${m.id}:${target}`;
    const row = (await store.get(rk)) || { norm: target, cells: Object.assign({}, (m.initial || {})[target] || {}) };
    const inCells = b.cells && typeof b.cells === "object" ? b.cells : {};
    let changed = 0;
    m.features.forEach((f) => { if (f in inCells) { const v = inCells[f] === true; if (!!row.cells[f] !== v) changed++; row.cells[f] = v; } });
    Object.assign(row, { norm: target, by: rec.username, byName: rec.fullName, byApp: app, at: t });
    if (b.confirm === true) { row.confirmed = true; row.confirmedAt = t; }
    if (b.confirm === false) row.confirmed = false;
    await store.set(rk, row);
    if (changed || b.confirm === true) { m.updatedAt = t; await store.set("matrix:current", m); }
    return json(200, { ok: true, row: { state: sName, cells: row.cells, confirmed: !!row.confirmed, at: t, by: rec.fullName } });
  }

  if (b.action === "matrix-freeze") {
    if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can freeze the matrix." });
    m.frozen = b.frozen === true;
    if (m.frozen) { m.frozenAt = t; m.frozenBy = rec.username; } else { m.unfrozenAt = t; m.unfrozenBy = rec.username; }
    m.updatedAt = t;
    await store.set("matrix:current", m);
    await ctx.logEvent(store, t, app, rec, m.frozen ? "matrix-frozen" : "matrix-unfrozen", { device: m.title.slice(0, 60), ver: "" });
    return json(200, { ok: true, frozen: m.frozen });
  }

  if (b.action === "matrix-remind") {
    if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can do this." });
    m.remindedAt = t; await store.set("matrix:current", m);
    return json(200, { ok: true });
  }

  return json(400, { ok: false, error: "Unknown action" });
}
