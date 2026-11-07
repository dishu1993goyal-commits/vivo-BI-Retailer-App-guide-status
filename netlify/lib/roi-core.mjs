// Scheme ROI analyzer: did a scheme move extra volume, or only cost money?
// Sales during the scheme vs a baseline period of the same length before it, corrected for the market trend with
// "control" models (vivo models NOT in the scheme). Cost = payouts published in Retailer payouts for that scheme
// (or entered). Then: incremental units / value / margin, ROI, cost per extra unit, post-scheme dip (pull-forward),
// state & model split, payout leakage (paid to retailers who didn't grow), verdict, and an AI action plan.
//   roi:<id>  saved analysis { id, input, result, ai, by, at }
import { randomBytes } from "node:crypto";
import { loadSales, nk } from "./sales-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const r1 = (n) => Math.round(n * 10) / 10, r0 = (n) => Math.round(n);
const D = (s) => Date.parse(s + "T00:00:00Z"), iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// share of a row that falls inside [a, b] (dates). Daily rows: 1 or 0. Month rows: overlap days / days in month.
function frac(r, a, b) {
  if (r.d) return r.d >= a && r.d <= b ? 1 : 0;
  const m0 = D(r.m + "-01"), m1 = Date.UTC(+r.m.slice(0, 4), +r.m.slice(5, 7), 0), lo = Math.max(m0, D(a)), hi = Math.min(m1, D(b));
  return hi < lo ? 0 : ((hi - lo) / 864e5 + 1) / ((m1 - m0) / 864e5 + 1);
}
function sum(rows, a, b, pick) { let u = 0, v = 0; rows.forEach((r) => { if (pick && !pick(r)) return; const f = frac(r, a, b); if (f) { u += r.u * f; v += (r.v || 0) * f; } }); return { u, v }; }

export async function analyse(store, pool, inp) {
  const from = inp.from, to = inp.to, len = (D(to) - D(from)) / 864e5 + 1;
  const bFrom = iso(D(from) - len * 864e5), bTo = iso(D(from) - 864e5), qFrom = iso(D(to) + 864e5), qTo = iso(D(to) + len * 864e5);
  const S = await loadSales(store, pool, { fromM: bFrom.slice(0, 7), toM: qTo.slice(0, 7), states: inp.states && inp.states.length ? inp.states : null });
  const rows = S.rows, models = new Set((inp.models || []).map(nk)), isS = (r) => models.has(nk(r.mo)), isC = (r) => !models.has(nk(r.mo));
  if (!rows.length) return { error: "No sell-out data for these dates. Upload sell-out (date or month × state × model × units) or Retailer portal business data first." };
  if (!models.size) return { error: "Pick the scheme models." };
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const SP = sum(rows, from, to, isS), SB = sum(rows, bFrom, bTo, isS), CP = sum(rows, from, to, isC), CB = sum(rows, bFrom, bTo, isC);
  const postDone = qTo <= today && rows.some((r) => (r.d || r.m + "-28") > to), SQ = postDone ? sum(rows, qFrom, qTo, isS) : null, CQ = postDone ? sum(rows, qFrom, qTo, isC) : null;
  const trend = CB.u > 0 ? CP.u / CB.u : 1, expected = SB.u * trend, inc = SP.u - expected, asp = SP.u ? SP.v / SP.u : (SB.u ? SB.v / SB.u : 0);
  const incValue = inc * asp, margin = (inp.marginPct == null ? 10 : inp.marginPct) / 100, incMargin = incValue * margin;
  // cost: payouts published for this scheme (name match) in the scheme months
  const keyName = low(inp.name).replace(/[^a-z0-9]/g, "");
  const months = new Set(); for (let m = D(from); m <= D(to); m += 864e5) months.add(iso(m).slice(0, 7));
  let paid = 0; const payRid = {};
  if (keyName) (await pool(await store.list("rpb:"), 30, (k) => store.get(k))).filter((x) => x && x.status === "published" && months.has(x.month)).forEach((x) => x.rows.forEach((row) => { const s = low(row.scheme).replace(/[^a-z0-9]/g, ""); if (s && (s.includes(keyName) || keyName.includes(s))) { paid += row.net || 0; payRid[row.rid] = (payRid[row.rid] || 0) + (row.net || 0); } }));
  const cost = (inp.cost > 0 ? inp.cost : paid) + (inp.otherCost || 0);
  const roi = cost > 0 ? (incMargin - cost) / cost : null, cpu = inc > 0 && cost > 0 ? cost / inc : null, uplift = expected > 0 ? SP.u / expected - 1 : null;
  const pull = SQ && SB.u ? (SQ.u - SB.u * (CB.u ? CQ.u / CB.u : 1)) / (SB.u * (CB.u ? CQ.u / CB.u : 1) || 1) : null;
  // state & model split
  const by = (key) => { const o = {}; rows.forEach((r) => { if (!isS(r)) return; const k = key(r); const x = o[k] || (o[k] = { name: k, p: 0, bse: 0, cp: 0, cb: 0 }); x.p += r.u * frac(r, from, to); x.bse += r.u * frac(r, bFrom, bTo); });
    rows.forEach((r) => { if (!isC(r)) return; const k = key(r); if (o[k]) { o[k].cp += r.u * frac(r, from, to); o[k].cb += r.u * frac(r, bFrom, bTo); } });
    return Object.values(o).map((x) => { const tr = x.cb > 0 ? x.cp / x.cb : trend, ex = x.bse * tr; return { name: x.name, during: r0(x.p), before: r0(x.bse), expected: r0(ex), extra: r0(x.p - ex), uplift: ex > 0 ? r1((x.p / ex - 1) * 100) : null }; }).sort((a, c) => c.extra - a.extra); };
  const byState = by((r) => r.st || "—"), byModel = (() => { const o = {}; rows.forEach((r) => { if (!isS(r)) return; const k = r.mo; const x = o[k] || (o[k] = { name: k, p: 0, bse: 0 }); x.p += r.u * frac(r, from, to); x.bse += r.u * frac(r, bFrom, bTo); }); return Object.values(o).map((x) => { const ex = x.bse * trend; return { name: x.name, during: r0(x.p), before: r0(x.bse), expected: r0(ex), extra: r0(x.p - ex), uplift: ex > 0 ? r1((x.p / ex - 1) * 100) : null }; }).sort((a, c) => c.extra - a.extra); })();
  // retailer-level: who was paid, did they grow?
  const rr = {}; rows.forEach((r) => { if (!r.r || !isS(r)) return; const x = rr[r.r] || (rr[r.r] = { p: 0, b: 0 }); x.p += r.u * frac(r, from, to); x.b += r.u * frac(r, bFrom, bTo); });
  const paidRids = Object.keys(payRid), grew = paidRids.filter((k) => rr[k] && rr[k].p > rr[k].b * trend * 1.05), flat = paidRids.filter((k) => rr[k] && !(rr[k].p > rr[k].b * trend * 1.05));
  const leak = flat.reduce((a, k) => a + payRid[k], 0), sortedPay = paidRids.map((k) => payRid[k]).sort((a, c) => c - a), top10 = sortedPay.slice(0, Math.max(1, Math.ceil(sortedPay.length / 10))).reduce((a, x) => a + x, 0);
  const retail = paidRids.length ? { paid: paidRids.length, withData: paidRids.filter((k) => rr[k]).length, grew: grew.length, flat: flat.length, leak: r0(leak), leakPct: paid ? r1(leak / paid * 100) : null, top10Pct: paid ? r1(top10 / paid * 100) : null, avg: r0(paid / paidRids.length) } : null;
  let verdict, tone;
  if (uplift == null) { verdict = "Not enough baseline data to judge"; tone = "m"; }
  else if (uplift >= 0.1 && (roi == null || roi >= 0)) { verdict = "Moved volume — and paid for itself"; tone = "g"; }
  else if (uplift >= 0.1) { verdict = "Moved volume, but cost more than the extra margin"; tone = "o"; }
  else if (uplift < 0.03) { verdict = "Mostly cost — little or no extra volume"; tone = "r"; }
  else { verdict = "Small lift — needs redesign to pay off"; tone = "o"; }
  // weekly / monthly series for the chart (scheme models vs control), baseline → scheme → after
  const series = []; const step = rows.some((r) => r.d) ? 7 : 30;
  for (let s = D(bFrom); s <= D(postDone ? qTo : to); s += step * 864e5) { const a = iso(s), b = iso(Math.min(s + (step - 1) * 864e5, D(postDone ? qTo : to))); series.push({ from: a, to: b, phase: b < from ? "before" : a > to ? "after" : "during", s: r0(sum(rows, a, b, isS).u), c: r0(sum(rows, a, b, isC).u) }); }
  return { source: S.source, granularity: rows.some((r) => r.d) ? "daily" : "monthly", periods: { scheme: [from, to], before: [bFrom, bTo], after: postDone ? [qFrom, qTo] : null },
    units: { during: r0(SP.u), before: r0(SB.u), expected: r0(expected), extra: r0(inc), controlTrendPct: r1((trend - 1) * 100), after: SQ ? r0(SQ.u) : null }, value: { during: r0(SP.v), asp: r0(asp), extra: r0(incValue), extraMargin: r0(incMargin), marginPct: r1(margin * 100) },
    cost: { total: r0(cost), payouts: r0(paid), manual: inp.cost > 0, other: inp.otherCost || 0 }, roiPct: roi == null ? null : r1(roi * 100), costPerExtraUnit: cpu == null ? null : r0(cpu), upliftPct: uplift == null ? null : r1(uplift * 100), pullForwardPct: pull == null ? null : r1(pull * 100), costPctOfSales: SP.v ? r1(cost / SP.v * 100) : null,
    byState, byModel, retail, verdict, tone, series };
}

export async function roiAction(b, ctx) {
  const { store, t, app, rec, pool, env } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "", myState = isHO ? "" : str(rec.state, 40);
  if (b.action === "roi-schemes") {   // pick list from Scheme policies
    const today = new Date(t + 19800000).toISOString().slice(0, 10);
    const L = (await pool(await store.list("spol:"), 30, (k) => store.get(k))).filter((p) => p && p.status !== "draft" && p.dateFrom && p.dateFrom <= today).map((p) => ({ id: p.id, title: p.title, from: p.dateFrom, to: p.dateTo, models: p.models || [], states: (p.audience || {}).scope === "states" ? p.audience.states : [], slabs: ((p.brief || {}).slabs || []).slice(0, 8), maxPayout: (p.brief || {}).maxPayout || "" }));
    return json(200, { ok: true, items: L.sort((a, c) => String(c.from).localeCompare(String(a.from))), isHO, myState });
  }
  if (b.action === "roi-run") {
    const i = b.input || {}, inp = { name: str(i.name, 120), spol: str(i.spol, 40), from: str(i.from, 10), to: str(i.to, 10), models: (i.models || []).map((m) => str(m, 60)).filter(Boolean).slice(0, 60), states: isHO ? (i.states || []).map((s) => str(s, 40)).filter(Boolean) : [myState], cost: Math.max(0, Number(i.cost) || 0), otherCost: Math.max(0, Number(i.otherCost) || 0), marginPct: i.marginPct === "" || i.marginPct == null ? 10 : Math.max(0, Math.min(60, Number(i.marginPct) || 0)), notes: str(i.notes, 600) };
    if (!okDate(inp.from) || !okDate(inp.to) || inp.to < inp.from) return json(400, { ok: false, error: "Enter the scheme start and end dates." });
    const R = await analyse(store, pool, inp); if (R.error) return json(400, { ok: false, error: R.error });
    let item = null;
    if (b.save !== false) { const id = str(b.id, 30).replace(/[^a-z0-9]/gi, "") || t.toString(36) + randomBytes(2).toString("hex"); const old = await store.get(`roi:${id}`); item = { id, input: inp, result: R, ai: null, by: old ? old.by : by, byState: myState || "HO", at: old ? old.at : t, updatedAt: t }; await store.set(`roi:${id}`, item); }
    return json(200, { ok: true, result: R, item });
  }
  if (b.action === "roi-list") {
    const L = (await pool(await store.list("roi:"), 30, (k) => store.get(k))).filter((x) => x && (isHO || x.byState === myState || (x.input.states || []).some((s) => low(s) === low(myState))));
    return json(200, { ok: true, items: L.sort((a, c) => c.updatedAt - a.updatedAt).map((x) => ({ id: x.id, name: x.input.name, from: x.input.from, to: x.input.to, states: x.input.states, models: x.input.models.length, uplift: x.result.upliftPct, roi: x.result.roiPct, extra: x.result.units.extra, cost: x.result.cost.total, cpu: x.result.costPerExtraUnit, verdict: x.result.verdict, tone: x.result.tone, by: x.by, at: x.updatedAt, ai: !!x.ai })) });
  }
  if (b.action === "roi-get") { const x = await store.get(`roi:${str(b.id, 30)}`); return x ? json(200, { ok: true, item: x }) : json(404, { ok: false, error: "Not found." }); }
  if (b.action === "roi-delete") { const x = await store.get(`roi:${str(b.id, 30)}`); if (x && (isHO || x.by === by)) await store.delete(`roi:${x.id}`); return json(200, { ok: true }); }
  if (b.action === "roi-ai") {
    const x = await store.get(`roi:${str(b.id, 30)}`); if (!x) return json(404, { ok: false, error: "Run the analysis first." });
    const pol = x.input.spol ? await store.get(`spol:${x.input.spol}`) : null, br = (pol && pol.brief) || {};
    const comp = [];   // competitor channel schemes / offers from the Competition tool, if researched
    for (const k of (await store.list("cmpb:")).slice(0, 14)) { const c = await store.get(k); if (c && c.data) comp.push({ brand: c.brand, retailerSchemes: (c.data.channelSchemes || []).slice(0, 3).map((s) => s.details), offers: (c.data.affordability || []).slice(0, 3).map((s) => [s.type, s.partner, s.details].filter(Boolean).join(" ")) }); }
    const R = x.result, data = { scheme: { name: x.input.name, from: x.input.from, to: x.input.to, models: x.input.models, states: x.input.states, slabs: br.slabs || [], keyPoints: br.keyPoints || [], maxPayout: br.maxPayout || "", notes: x.input.notes }, result: Object.assign({}, R, { series: undefined, byState: R.byState.slice(0, 15), byModel: R.byModel.slice(0, 15) }), competition: comp };
    const sys = 'You are a senior trade-marketing analyst at vivo India. Judge a retailer scheme on the numbers given (incremental units vs a control-adjusted baseline, ROI on margin, cost per extra unit, payout leakage to retailers who did not grow, pull-forward dip after the scheme). Reply with ONE JSON object only: {"summary":"3-4 sentences, plain","worked":["…"],"didnt":["…"],"changes":[{"change":"specific design change (slabs, targets, eligible models, states, duration, payout type)","why":"tied to a number in DATA","impact":"expected effect"}],"nextDesign":"one paragraph: the improved scheme","watch":["KPIs to track next time"]}. Be specific with numbers, states and models from DATA. No invented figures.';
    const r = await ctx.askAI(env, "Analyse this scheme and give the action plan.", "DATA: " + JSON.stringify(data).slice(0, 14000), [], ctx.aiFetch, { system: sys, label: "ROI" });
    if (!r.ok) return json(200, { ok: false, error: r.error });
    let ai = null; try { const m = /\{[\s\S]*\}/.exec(r.text || ""); ai = m ? JSON.parse(m[0]) : null; } catch (e) { ai = null; }
    if (!ai || !ai.summary) ai = { summary: str(r.text, 3000), worked: [], didnt: [], changes: [], nextDesign: "", watch: [] };
    x.ai = Object.assign(ai, { at: t }); await store.set(`roi:${x.id}`, x); return json(200, { ok: true, ai: x.ai });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
