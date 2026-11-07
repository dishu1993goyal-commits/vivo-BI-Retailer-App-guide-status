// Shared sell-out & stock data for the analysis tools (Scheme ROI analyzer, Demand forecast).
// Uploaded by HO (all states) or state users (their state); falls back to the Retailer portal's business data.
//   so:<YYYY-MM>  { rows:[{ d:"YYYY-MM-DD"|"" , st, mo, u, v, r }] }   d "" = a whole-month figure; r = retailer ID (optional)
//   sostock       { asOf, rows:[{ st, mo, u }] }
//   fccal         festive calendar [{ id, name, months:[1-12], states:[] (empty = all India), uplift % }]
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]|rs\.?/gi, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
export const nk = (s) => String(s || "").toLowerCase().replace(/^vivo\s+/, "").replace(/\b5g\b/g, "").replace(/[^a-z0-9+]/g, "");
const MN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function dayOf(v) {   // → { d:"YYYY-MM-DD"|"", m:"YYYY-MM" }
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 30000 && v < 80000) { const s = new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10); return { d: s, m: s.slice(0, 7) }; }
  const s = String(v).trim(); let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { const d = m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0"); return { d, m: d.slice(0, 7) }; }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) { const d = m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); return { d, m: d.slice(0, 7) }; }
  if ((m = /^(\d{4})[-/.](\d{1,2})$/.exec(s))) return { d: "", m: m[1] + "-" + m[2].padStart(2, "0") };
  if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(s))) return { d: "", m: m[2] + "-" + m[1].padStart(2, "0") };
  if ((m = /^([a-z]{3})[a-z]*[\s\-'’,]*(\d{2,4})$/i.exec(s)) && MN.includes(m[1].toLowerCase())) return { d: "", m: (m[2].length === 2 ? "20" + m[2] : m[2]) + "-" + String(MN.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0") };
  return null;
}
export const DEFAULT_CAL = [
  { id: "rd", name: "Republic Day sales", months: [1], states: [], uplift: 8 },
  { id: "pongal", name: "Pongal / Sankranti", months: [1], states: ["Tamil Nadu", "Andhra Pradesh", "Telangana", "Karnataka"], uplift: 20 },
  { id: "wed1", name: "Wedding season (Feb)", months: [2], states: [], uplift: 6 },
  { id: "holi", name: "Holi", months: [3], states: ["Uttar Pradesh", "Bihar", "Rajasthan", "Madhya Pradesh", "Delhi", "Haryana"], uplift: 8 },
  { id: "ugadi", name: "Ugadi / Gudi Padwa", months: [3, 4], states: ["Karnataka", "Andhra Pradesh", "Telangana", "Maharashtra"], uplift: 15 },
  { id: "bihu", name: "Bohag Bihu / Vishu / Baisakhi / Poila Boishakh", months: [4], states: ["Assam", "Kerala", "Punjab", "West Bengal", "Odisha", "Tamil Nadu"], uplift: 15 },
  { id: "akshaya", name: "Akshaya Tritiya", months: [4, 5], states: [], uplift: 6 },
  { id: "eid", name: "Eid", months: [3], states: ["Kerala", "Uttar Pradesh", "West Bengal", "Jammu and Kashmir", "Telangana", "Bihar"], uplift: 8 },
  { id: "school", name: "Lean season (exams / monsoon)", months: [6, 7], states: [], uplift: -8 },
  { id: "id", name: "Independence Day & online sales", months: [8], states: [], uplift: 10 },
  { id: "rakhi", name: "Raksha Bandhan", months: [8], states: [], uplift: 5 },
  { id: "onam", name: "Onam", months: [8, 9], states: ["Kerala"], uplift: 45 },
  { id: "ganesh", name: "Ganesh Chaturthi", months: [9], states: ["Maharashtra", "Goa", "Karnataka", "Telangana", "Andhra Pradesh"], uplift: 15 },
  { id: "navratri", name: "Navratri / Dussehra", months: [10], states: [], uplift: 20 },
  { id: "puja", name: "Durga Puja", months: [10], states: ["West Bengal", "Odisha", "Assam", "Tripura", "Jharkhand", "Bihar"], uplift: 30 },
  { id: "diwali", name: "Dhanteras / Diwali", months: [10, 11], states: [], uplift: 35 },
  { id: "chhath", name: "Chhath", months: [11], states: ["Bihar", "Jharkhand", "Uttar Pradesh"], uplift: 15 },
  { id: "wed2", name: "Wedding season (Nov–Dec)", months: [11, 12], states: [], uplift: 8 },
  { id: "ny", name: "Christmas & New Year", months: [12], states: ["Kerala", "Goa", "Meghalaya", "Mizoram", "Nagaland"], uplift: 12 }
];

// all sell-out rows in [fromM, toM] (months, inclusive), optionally for some states; falls back to the Retailer portal data
export async function loadSales(store, pool, { fromM = "", toM = "9999-99", states = null } = {}) {
  const want = states && states.length ? new Set(states.map(low)) : null, out = [];
  const keys = (await store.list("so:")).filter((k) => { const m = k.slice(3); return m >= fromM && m <= toM; });
  let source = "upload";
  if (keys.length) (await pool(keys, 20, async (k) => ({ m: k.slice(3), x: await store.get(k) }))).forEach(({ m, x }) => (x && x.rows || []).forEach((r) => { if (!want || want.has(low(r.st))) { r.m = m; out.push(r); } }));
  else {   // Retailer portal: month × model per retailer
    source = "portal";
    const I = (await store.get("rtpidx")) || {};
    const ks = (await store.list("rtd:")).filter((k) => { const s = (I[k.slice(4)] || {}).s; return !want || want.has(low(s)); });
    (await pool(ks, 20, async (k) => ({ rid: k.slice(4), d: await store.get(k) }))).forEach(({ rid, d }) => (d && d.rows || []).forEach((r) => { if (r.m >= fromM && r.m <= toM) out.push({ d: "", m: r.m, st: (I[rid] || {}).s || "", mo: r.model, u: r.su, v: r.sv, r: rid, stk: r.stk }); }));
  }
  out.forEach((r) => { if (!r.m) r.m = (r.d || "").slice(0, 7); });
  return { rows: out, source };
}
export async function loadStock(store, pool, states) {
  const want = states && states.length ? new Set(states.map(low)) : null, s = await store.get("sostock");
  if (s && s.rows && s.rows.length) return { asOf: s.asOf, source: "upload", rows: s.rows.filter((r) => !want || want.has(low(r.st))) };
  const P = await loadSales(store, pool, {}); if (P.source !== "portal") return { asOf: "", source: "none", rows: [] };
  const last = {}; P.rows.forEach((r) => { if (r.stk != null && (!last[r.r] || r.m > last[r.r])) last[r.r] = r.m; });
  const agg = {}; P.rows.forEach((r) => { if (r.m === last[r.r] && r.stk && (!want || want.has(low(r.st)))) { const k = r.st + "|" + nk(r.mo); agg[k] = agg[k] || { st: r.st, mo: r.mo, u: 0 }; agg[k].u += r.stk; } });
  return { asOf: Object.values(last).sort().pop() || "", source: "portal", rows: Object.values(agg) };
}

export async function salesAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx, isHO = app === "admin", myState = isHO ? "" : str(rec.state, 40);
  const okState = (s) => isHO || low(s) === low(myState);
  if (b.action === "so-import") {   // rows: [{ date|month, state, model, units, value, rid }]
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 30000), byM = {}; let bad = 0, skipped = 0;
    rows.forEach((x) => { const dm = dayOf(x.date != null && x.date !== "" ? x.date : x.month), st = str(x.state, 40) || myState, mo = str(x.model, 60), u = num(x.units);
      if (!dm || !st || !mo) { bad++; return; } if (!okState(st)) { skipped++; return; }
      (byM[dm.m] || (byM[dm.m] = [])).push({ d: dm.d, st, mo, u, v: num(x.value), r: str(x.rid, 40).toUpperCase() }); });
    // one upload sent in several chunks shares a batch token: the first chunk replaces a month × state, later ones add to it
    const tk = String(b.batch || "").replace(/[^a-z0-9]/gi, "").slice(0, 24), seenK = tk ? `soimp:${tk}` : "", seen = new Set(seenK ? ((await store.get(seenK)) || { k: [] }).k : []);
    for (const m of Object.keys(byM)) {
      const old = (await store.get(`so:${m}`)) || { rows: [] }, sts = new Set(byM[m].map((r) => low(r.st)).filter((st) => !seen.has(m + "|" + st)));
      const keep = b.append ? old.rows : old.rows.filter((r) => !sts.has(low(r.st)));
      sts.forEach((st) => seen.add(m + "|" + st));
      await store.set(`so:${m}`, { rows: keep.concat(byM[m]).slice(-60000), updatedAt: t });
    }
    if (seenK) await store.set(seenK, { k: [...seen].slice(-5000), at: t });
    return json(200, { ok: true, saved: rows.length - bad - skipped, bad, skipped, months: Object.keys(byM).sort() });
  }
  if (b.action === "so-stock-import") {
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 20000).map((x) => ({ st: str(x.state, 40) || myState, mo: str(x.model, 60), u: num(x.units) })).filter((r) => r.st && r.mo && okState(r.st));
    const old = (await store.get("sostock")) || { rows: [] }, sts = new Set(rows.map((r) => low(r.st)));
    await store.set("sostock", { asOf: str(b.asOf, 10) || new Date(t + 19800000).toISOString().slice(0, 10), rows: old.rows.filter((r) => !sts.has(low(r.st))).concat(rows), updatedAt: t });
    return json(200, { ok: true, saved: rows.length });
  }
  if (b.action === "so-summary") {
    const months = (await store.list("so:")).map((k) => k.slice(3)).sort(), S = await loadSales(store, pool, { states: isHO ? null : [myState] }), st = await store.get("sostock");
    const sts = {}, mos = {}; S.rows.forEach((r) => { sts[r.st] = (sts[r.st] || 0) + r.u; mos[r.mo] = (mos[r.mo] || 0) + r.u; });
    return json(200, { ok: true, source: S.source, months: months.length ? months : [...new Set(S.rows.map((r) => r.m))].sort(), rows: S.rows.length, daily: S.rows.some((r) => r.d), states: Object.keys(sts).sort(), models: Object.keys(mos).sort((a, c) => mos[c] - mos[a]), stockAsOf: st ? st.asOf : "", isHO, myState });
  }
  if (b.action === "so-clear") {
    if (!isHO) return json(403, { ok: false, error: "HO only." });
    for (const k of await store.list("so:")) await store.delete(k); await store.delete("sostock");
    return json(200, { ok: true });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
