import { cleanExtra } from "./master-core.mjs";
// Market hygiene (#7): HO uploads suspicious pre-activated IMEIs → each row goes to its state's team →
// the team records the action taken → hygiene score per dealer and per state.
// Storage:
//   hygb:<batchId>              { id, name, createdAt, by, states:{<state>:n}, total, closed:false }
//   hygr:<batchId>:<stateSlug>  { batch, state, rows:[{ i, imei, model, dealerCode, dealer, city, activatedOn, reason, status, remark, photo, by, at, assignee }] }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "na";
export const HYG_STATUS = ["Pending", "Under review", "Genuine sale – cleared", "Dealer warned", "Stock recalled / corrected", "Escalated to HO"];
const CLEARED = "Genuine sale – cleared", MISUSE = ["Dealer warned", "Stock recalled / corrected", "Escalated to HO"];
const DAY = 86400000;

// Dealer score: starts at 100; −10 for each confirmed misuse, −5 for each still pending after 7 days, −2 for each under review; 0–100.
export function dealerScore(rows, t) {
  let s = 100;
  rows.forEach((r) => { if (MISUSE.includes(r.status)) s -= 10; else if (r.status === "Pending" && t - r.uploadedAt > 7 * DAY) s -= 5; else if (r.status === "Under review" || r.status === "Pending") s -= 2; });
  return Math.max(0, Math.min(100, s));
}
export const grade = (s) => (s >= 90 ? "A" : s >= 75 ? "B" : s >= 50 ? "C" : "D");

export async function hygieneAction(b, ctx) {
  const { store, t, app, rec, pool, who } = ctx;
  const isAdmin = app === "admin", me = who(app, rec);
  const batches = async () => (await pool(await store.list("hygb:"), 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.createdAt - x.createdAt);
  const chunksFor = async (batchId, state) => {
    const prefix = batchId ? `hygr:${batchId}:` : "hygr:";
    const ks = (await store.list(prefix)).filter((k) => isAdmin && !state ? true : k.endsWith(":" + slug(state || rec.state)));
    return (await pool(ks, 30, (k) => store.get(k))).filter(Boolean);
  };

  if (b.action === "hyg-upload") {
    if (!isAdmin) return json(403, { ok: false, error: "Only HO admins upload IMEI lists." });
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 20000);
    const byState = {}, bad = [];
    rows.forEach((r, n) => {
      const imei = String(r.imei || "").replace(/\D/g, ""), state = str(r.state, 40);
      if (imei.length < 14 || imei.length > 16 || !state) { bad.push(n + 2); return; }
      (byState[state] = byState[state] || []).push({ imei, model: str(r.model, 40), dealerCode: str(r.dealerCode, 30), dealer: str(r.dealer, 80), city: str(r.city, 40), activatedOn: str(r.activatedOn, 20), reason: str(r.reason, 120),
        status: "Pending", remark: "", photo: "", by: null, at: 0, uploadedAt: t });
    });
    if (!Object.keys(byState).length) return json(400, { ok: false, error: "No valid rows. Each row needs a 15-digit IMEI and a state." });
    const id = t.toString(36) + randomBytes(3).toString("hex");
    const states = {};
    for (const [st, list] of Object.entries(byState)) { list.forEach((r, i) => { r.i = i; }); states[st] = list.length; await store.set(`hygr:${id}:${slug(st)}`, { batch: id, state: st, rows: list }); }
    await store.set(`hygb:${id}`, { id, name: str(b.name, 80) || "IMEI list " + new Date(t + 5.5 * 3600000).toISOString().slice(0, 10), createdAt: t, by: rec.fullName, states, total: Object.values(states).reduce((a, n) => a + n, 0), dueDays: Math.max(1, Math.min(30, Number(b.dueDays) || 7)) });
    await ctx.logEvent(store, t, app, rec, "hygiene-upload", { device: Object.values(states).reduce((a, n) => a + n, 0) + " IMEIs", ver: "" });
    return json(200, { ok: true, id, states, skipped: bad.slice(0, 50), skippedCount: bad.length });
  }

  if (b.action === "hyg-list") {   // rows for one batch (state users: their state only)
    const bs = await batches();
    const batchId = b.batch || (bs[0] && bs[0].id) || "";
    const chunks = batchId ? await chunksFor(batchId, isAdmin ? b.state : "") : [];
    const rows = [];
    chunks.forEach((c) => c.rows.forEach((r) => rows.push(Object.assign({ state: c.state, batch: c.batch }, r))));
    return json(200, { ok: true, batches: isAdmin ? bs : bs.filter((x) => x.states[rec.state || ""]), batch: batchId, rows, statuses: HYG_STATUS, myState: rec.state || "", now: t });
  }

  if (b.action === "hyg-act") {   // record the action for one or more rows of a state chunk
    const st = isAdmin ? str(b.state, 40) : rec.state || "";
    const k = `hygr:${String(b.batch || "").replace(/[^a-z0-9]/gi, "")}:${slug(st)}`;
    const c = await store.get(k);
    if (!c) return json(404, { ok: false, error: "List not found for your state." });
    const status = HYG_STATUS.includes(b.status) ? b.status : null;
    if (!status) return json(400, { ok: false, error: "Choose the action taken." });
    const remark = str(b.remark, 300);
    if (status !== "Under review" && status !== "Pending" && remark.length < 3) return json(400, { ok: false, error: "Add a short remark (what was found / done)." });
    let photo = "";
    if (b.photo) { const pid = String(b.photo).replace(/[^a-z0-9]/gi, ""); const f = await store.get(`att:${pid}`); if (f && ctx.sameUser(f.by, me)) photo = pid; }
    const idx = (Array.isArray(b.rows) ? b.rows : [b.row]).map(Number).filter((n) => isFinite(n));
    let n = 0;
    c.rows.forEach((r) => { if (idx.includes(r.i)) { r.status = status; r.remark = remark; const ex = cleanExtra(b.extra); if (Object.keys(ex).length) r.extra = ex; if (photo) r.photo = photo; r.by = { app, username: rec.username, fullName: rec.fullName }; r.at = t; n++; } });
    if (!n) return json(400, { ok: false, error: "Select at least one IMEI." });
    await store.set(k, c);
    return json(200, { ok: true, updated: n });
  }

  if (b.action === "hyg-photo") {
    const c = await store.get(`hygr:${String(b.batch || "").replace(/[^a-z0-9]/gi, "")}:${slug(isAdmin ? b.state : rec.state)}`);
    const r = c && c.rows.find((x) => x.i === Number(b.row));
    if (!r || !r.photo) return json(404, { ok: false, error: "No photo." });
    const f = await store.get(`att:${r.photo}`);
    return f ? json(200, { ok: true, mime: f.mime, data: f.data }) : json(404, { ok: false, error: "No photo." });
  }

  if (b.action === "hyg-scores") {   // dealer + state hygiene across all batches (state users: own state)
    const chunks = await chunksFor("", isAdmin ? b.state : "");
    const dealers = {}, states = {};
    chunks.forEach((c) => c.rows.forEach((r) => {
      const dk = c.state + "|" + (r.dealerCode || r.dealer || "Unknown");
      (dealers[dk] = dealers[dk] || { state: c.state, dealerCode: r.dealerCode, dealer: r.dealer || r.dealerCode || "Unknown", city: r.city, rows: [] }).rows.push(r);
      const s = states[c.state] = states[c.state] || { state: c.state, total: 0, actioned: 0, onTime: 0, misuse: 0, cleared: 0, pending: 0 };
      s.total++; if (r.status !== "Pending") { s.actioned++; if (r.at - r.uploadedAt <= 7 * DAY) s.onTime++; } else s.pending++;
      if (MISUSE.includes(r.status)) s.misuse++; if (r.status === CLEARED) s.cleared++;
    }));
    const dl = Object.values(dealers).map((d) => { const sc = dealerScore(d.rows, t); return { state: d.state, dealerCode: d.dealerCode, dealer: d.dealer, city: d.city, imeis: d.rows.length, misuse: d.rows.filter((r) => MISUSE.includes(r.status)).length, pending: d.rows.filter((r) => r.status === "Pending").length, cleared: d.rows.filter((r) => r.status === CLEARED).length, score: sc, grade: grade(sc) }; })
      .sort((x, y) => x.score - y.score || y.imeis - x.imeis);
    const sl = Object.values(states).map((s) => Object.assign(s, { actionPct: s.total ? Math.round(s.actioned / s.total * 100) : 0, onTimePct: s.total ? Math.round(s.onTime / s.total * 100) : 0 })).sort((x, y) => y.actionPct - x.actionPct);
    return json(200, { ok: true, dealers: dl.slice(0, 3000), states: sl, now: t });
  }

  if (b.action === "hyg-delete") {
    if (!isAdmin) return json(403, { ok: false, error: "Only admins." });
    const id = String(b.batch || "").replace(/[^a-z0-9]/gi, "");
    for (const k of await store.list(`hygr:${id}:`)) await store.delete(k);
    await store.delete(`hygb:${id}`);
    return json(200, { ok: true });
  }

  if (b.action === "hyg-notify") {
    if (isAdmin) return json(200, { ok: true, pending: 0 });
    const chunks = await chunksFor("", "");
    return json(200, { ok: true, pending: chunks.reduce((a, c) => a + c.rows.filter((r) => r.status === "Pending").length, 0) });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
