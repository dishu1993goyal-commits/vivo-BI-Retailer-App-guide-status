// Demand forecast & stock allocation: serves month × state × model sell-out (+ stock, festive calendar and model
// life-cycle settings) to the page, which runs the forecast live; saves shared allocation plans; AI explains.
//   fccal         festive calendar (sales-core DEFAULT_CAL until HO edits)
//   fccfg         { models:{ <key>:{ status:"new"|"regular"|"eol", note } } }
//   fcplan:<id>   saved plan { id, name, params, summary, rows, by, at }
import { randomBytes } from "node:crypto";
import { loadSales, loadStock, DEFAULT_CAL, nk } from "./sales-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();

export async function fcAction(b, ctx) {
  const { store, t, app, rec, pool, env } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "", myState = isHO ? "" : str(rec.state, 40);
  if (b.action === "fc-data") {
    const S = await loadSales(store, pool, { states: isHO ? null : [myState] }), agg = {};
    S.rows.forEach((r) => { const k = r.m + "|" + r.st + "|" + r.mo; agg[k] = (agg[k] || 0) + (r.u || 0); });
    const rows = Object.keys(agg).map((k) => { const p = k.split("|"); return [p[0], p[1], p[2], Math.round(agg[k])]; });
    const stock = await loadStock(store, pool, isHO ? null : [myState]);
    return json(200, { ok: true, source: S.source, rows, stock: { asOf: stock.asOf, source: stock.source, rows: stock.rows.map((r) => [r.st, r.mo, r.u]) }, cal: (await store.get("fccal")) || DEFAULT_CAL, cfg: (await store.get("fccfg")) || { models: {} }, isHO, myState, today: new Date(t + 19800000).toISOString().slice(0, 10) });
  }
  if (b.action === "fc-cal-save") {
    if (!isHO) return json(403, { ok: false, error: "Only HO admins can change the festive calendar." });
    const L = (Array.isArray(b.cal) ? b.cal : []).slice(0, 60).map((e, i) => ({ id: str(e.id, 20) || "e" + i, name: str(e.name, 60), months: (e.months || []).map(Number).filter((m) => m >= 1 && m <= 12).slice(0, 6), states: (e.states || []).map((s) => str(s, 40)).filter(Boolean).slice(0, 36), uplift: Math.max(-60, Math.min(200, Number(e.uplift) || 0)) })).filter((e) => e.name && e.months.length);
    await store.set("fccal", L); return json(200, { ok: true, cal: L });
  }
  if (b.action === "fc-cal-reset") { if (!isHO) return json(403, { ok: false, error: "HO only." }); await store.delete("fccal"); return json(200, { ok: true, cal: DEFAULT_CAL }); }
  if (b.action === "fc-cfg-save") {
    if (!isHO) return json(403, { ok: false, error: "HO only." });
    const M = {}; Object.keys((b.cfg && b.cfg.models) || {}).slice(0, 300).forEach((k) => { const x = b.cfg.models[k] || {}; if (["new", "eol"].includes(x.status)) M[nk(k)] = { status: x.status, note: str(x.note, 100) }; });
    await store.set("fccfg", { models: M, at: t, by }); return json(200, { ok: true, cfg: { models: M } });
  }
  if (b.action === "fc-plan-save") {
    const p = b.plan || {}, id = str(p.id, 30).replace(/[^a-z0-9]/gi, "") || t.toString(36) + randomBytes(2).toString("hex"), old = await store.get(`fcplan:${id}`);
    if (old && !isHO && old.by !== by) return json(403, { ok: false, error: "Only the creator or HO can change this plan." });
    const item = { id, name: str(p.name, 100) || "Allocation plan", params: p.params || {}, summary: p.summary || {}, rows: (Array.isArray(p.rows) ? p.rows : []).slice(0, 6000), by: old ? old.by : by, byState: myState || "HO", at: old ? old.at : t, updatedAt: t };
    if (JSON.stringify(item).length > 1500000) return json(400, { ok: false, error: "Plan is too large — narrow states / models." });
    await store.set(`fcplan:${id}`, item); return json(200, { ok: true, item: { id, name: item.name } });
  }
  if (b.action === "fc-plan-list") { const L = (await pool(await store.list("fcplan:"), 30, (k) => store.get(k))).filter((x) => x && (isHO || x.byState === myState)); return json(200, { ok: true, items: L.sort((a, c) => c.updatedAt - a.updatedAt).map((x) => ({ id: x.id, name: x.name, by: x.by, at: x.updatedAt, summary: x.summary })) }); }
  if (b.action === "fc-plan-get") { const x = await store.get(`fcplan:${str(b.id, 30)}`); return x && (isHO || x.byState === myState) ? json(200, { ok: true, item: x }) : json(404, { ok: false, error: "Not found." }); }
  if (b.action === "fc-plan-delete") { const x = await store.get(`fcplan:${str(b.id, 30)}`); if (x && (isHO || x.by === by)) await store.delete(`fcplan:${x.id}`); return json(200, { ok: true }); }
  if (b.action === "fc-ai") {
    const sys = b.mode === "festive"
      ? 'You are a demand planner for vivo smartphones in India. Using your knowledge of Indian festivals, sale events and regional buying seasons, list the events that affect smartphone sell-out in the months and states given. Reply ONE JSON object: {"events":[{"name":"","months":[numbers 1-12],"states":["state names or empty for all India"],"uplift":percent number,"why":"short"}]}. Uplift is the % change in that month vs a normal month (can be negative). Be realistic (most 5-40).'
      : "You are a demand & supply planner for vivo India. Use only DATA (forecast by state and model, stock, allocation, festive events). Explain in plain words: where demand peaks and why, risks of stock-outs or excess, which states / models to prioritise, and 5 concrete actions for the next 1-3 months. • bullets, under 14 lines, specific numbers.";
    const r = await ctx.askAI(env, b.mode === "festive" ? "Months: " + str(b.months, 80) + ". States: " + str(b.states, 600) : str(b.q, 400) || "Explain this forecast and allocation.", "DATA: " + JSON.stringify(b.data || {}).slice(0, 14000), [], ctx.aiFetch, { system: sys, label: "FORECAST" });
    if (!r.ok) return json(200, { ok: false, error: r.error });
    if (b.mode === "festive") { let d = null; try { const m = /\{[\s\S]*\}/.exec(r.text || ""); d = m ? JSON.parse(m[0]) : null; } catch (e) { d = null; } return json(200, d && Array.isArray(d.events) ? { ok: true, events: d.events.slice(0, 30) } : { ok: false, error: "AI didn't return events — try again." }); }
    return json(200, { ok: true, answer: r.text });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
