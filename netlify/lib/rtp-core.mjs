// Retailer portal: one page per retailer with everything in one place — business (purchase / sales / stock / targets
// from an Excel upload), schemes that apply (from Scheme policies), payouts & wallet (from Retailer payouts),
// announcements & new launches, an AI assistant and queries to the sales team / HO.
// Staff (HO: all retailers, state users: their state) open it in the apps / web. A retailer can be sent a read-only
// web link (expiring, revocable) — no retailer accounts.
// Storage:
//   rtl:<RID>        master { rid, name, owner, mobile, state, city, area, type, asm, gst, since, updatedAt, by }
//   rtd:<RID>        business { rows:[{ m:"YYYY-MM", model, pu, pv, su, sv, stk }], targets:{ m:{ u, v } }, updatedAt }
//   rtpidx           { RID: { n, s, c, t, m, su, sv, stk, tu } }
//   rtpann:<id>      announcement { id, kind:"news"|"launch"|"scheme"|"alert", title, body, link, model, states:[], rids:[], pin, at, by, byKey, until }
//   rtpq:<id>        query { id, rid, rname, state, topic, to:"sales"|"ho", text, status:"open"|"answered"|"closed", thread:[{ by, at, text, staff }], at, by, via }
//   rtplink:<token>  { rid, at, by, exp, asks:{ day, n } }
//   rtil:<RID>       IMEIs { items:[{ i, m, bd, act, ad, fin, fp, ls, dp }], updatedAt }   (bd billing date, act activated, fin financed, fp finance partner, ls lock / loan status)
//   rtimei:<IMEI>    { rid }        — which retailer holds an IMEI (for search)
//   rto:<id>         order { id, rid, rname, state, items:[{ model, qty, price, value }], total, status, note, by, via, at, month, history }
//   config:rtporder  { on, balance:"credit"|"wallet"|"none", defMax, cover, minValue, note, models:{ <key>:{ max, price, hide } } }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]|rs\.?/gi, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const RID = (v) => str(v, 40).toUpperCase().replace(/[^A-Z0-9_\-./]/g, "");
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const low = (x) => String(x || "").trim().toLowerCase();
const r2 = (n) => Math.round(n * 100) / 100;
export const RTP_TOPICS = ["Payout / scheme", "Stock & supply", "Pricing", "Display & branding", "Service / repair", "New launch", "Other"];
const ANN_KINDS = ["news", "launch", "scheme", "alert"];
const nk = (s) => String(s || "").toLowerCase().replace(/^vivo\s+/, "").replace(/\b5g\b/g, "").replace(/[^a-z0-9+]/g, "");
const dateOf = (v) => {
  if (v == null || v === "") return "";
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = String(v).trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s); if (m) return (m[3].length === 2 ? "20" + m[3] : m[3]) + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  const d = new Date(s); return isNaN(d) ? "" : d.toISOString().slice(0, 10);
};
const yes = (v) => /^(y|yes|true|1|financed|activated|active|done)$/i.test(String(v == null ? "" : v).trim());
const IMEI = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, 15);
const STATUSES = ["placed", "accepted", "dispatched", "delivered", "rejected", "cancelled"], COMMITTED = ["placed", "accepted", "dispatched"];
const BUCKETS = [[0, 15, "0–15 days"], [16, 30, "16–30"], [31, 45, "31–45"], [46, 60, "46–60"], [61, 90, "61–90"], [91, 1e9, "90+ days"]];
function ageing(items, today) {
  const T = Date.parse(today + "T00:00:00Z"), un = (items || []).filter((x) => !x.act);
  const age = (x) => (x.bd ? Math.max(0, Math.round((T - Date.parse(x.bd + "T00:00:00Z")) / 864e5)) : null);
  const buckets = BUCKETS.map((b) => ({ label: b[2], n: 0 })), models = {};
  un.forEach((x) => { const a = age(x); if (a == null) return; const bi = BUCKETS.findIndex((b) => a >= b[0] && a <= b[1]); buckets[bi].n++; const M = models[x.m] || (models[x.m] = { model: x.m, n: 0, sum: 0, max: 0, old60: 0, b: BUCKETS.map(() => 0) }); M.n++; M.sum += a; M.max = Math.max(M.max, a); if (a > 60) M.old60++; M.b[bi]++; });
  const all = items || [];
  return { total: all.length, unsold: un.length, sold: all.length - un.length, financed: all.filter((x) => x.fin).length, buckets, models: Object.values(models).map((M) => ({ model: M.model, n: M.n, avg: Math.round(M.sum / (M.n || 1)), max: M.max, old60: M.old60, b: M.b })).sort((a, c) => c.avg - a.avg),
    oldest: un.filter((x) => x.bd).map((x) => ({ i: x.i, m: x.m, bd: x.bd, age: age(x), fin: !!x.fin })).sort((a, c) => c.age - a.age).slice(0, 25), updatedAt: 0 };
}
// running offers for these models (Affordability Corner: AI-researched + HO / field reports verified for this state)
async function offersFor(store, pool, modelNames, state, today) {
  const cat = (await store.get("affcat")) || { models: [] }, want = new Set(modelNames.map(nk)), st = low(state);
  let L = cat.models.filter((m) => want.has(nk(m.name)));
  cat.models.slice(0, 40).forEach((m) => { if (L.length < 24 && !L.includes(m)) L.push(m); });
  const ok = (v) => !v || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v >= today;
  const out = await pool(L.slice(0, 24), 12, async (c) => {
    const m = (await store.get(`affm:${c.slug}`)) || {}, hide = (await store.get(`affhide:${c.slug}`)) || {}, offers = [];
    ["emi", "exchange", "upgrade", "vshield", "abb", "cashback", "other"].forEach((k) => (m[k] || []).forEach((o) => { if (!hide[o.key] && ok(o.validTill)) offers.push({ kind: k, partner: o.partner || "", scheme: o.scheme || "", benefit: o.benefit || o.plan || "", details: o.details || "", validTill: o.validTill || "", src: "AI" }); }));
    for (const k of (await store.list(`affr:${c.slug}:`)).slice(-60)) { const r = await store.get(k); if (r && r.verified && ok(r.validTill) && (!r.state || /all india/i.test(r.state) || low(r.state) === st)) offers.push({ kind: r.kind, partner: r.partner, scheme: r.scheme, benefit: r.benefit, details: r.details, validTill: r.validTill, src: "HO" }); }
    const ps = ((m.variants) || []).map((v) => v.price).filter(Boolean);
    return { model: c.name, slug: c.slug, series: c.series || "", price: ps.length ? Math.min(...ps) : 0, offers: offers.sort((a, b) => (a.src === "HO" ? 0 : 1) - (b.src === "HO" ? 0 : 1)).slice(0, 20), updatedAt: m.updatedAt || 0 };
  });
  return out.filter((x) => x.offers.length || want.has(nk(x.model)));
}
function imeiOut(x, today) { const age = x.bd ? Math.max(0, Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(x.bd + "T00:00:00Z")) / 864e5)) : null; return { imei: x.i, model: x.m, billed: x.bd, ageDays: x.act ? null : age, activated: !!x.act, activatedOn: x.ad || "", financed: !!x.fin, financier: x.fp || "", lockStatus: x.ls || "", dealerPrice: x.dp || 0 }; }
async function orderCfg(store) { return Object.assign({ on: true, balance: "credit", defMax: 20, cover: 30, minValue: 0, note: "", models: {} }, (await store.get("config:rtporder")) || {}); }
// what this retailer can order now: models, prices, limits left this month, suggestions, balance
async function orderInfo(store, pool, rid, D) {
  const cfg = await orderCfg(store), cat = (await store.get("affcat")) || { models: [] }, month = D.today.slice(0, 7);
  const orders = (await pool(await store.list("rto:"), 30, (k) => store.get(k))).filter((o) => o && o.rid === rid).sort((a, c) => c.at - a.at);
  const used = {}, last = {}; let committed = 0;
  orders.forEach((o) => { if (!["rejected", "cancelled"].includes(o.status) && o.month === month) o.items.forEach((x) => { used[nk(x.model)] = (used[nk(x.model)] || 0) + x.qty; }); if (COMMITTED.includes(o.status)) committed += o.total; o.items.forEach((x) => { if (last[nk(x.model)] == null) last[nk(x.model)] = { qty: x.qty, at: o.at }; }); });
  const rows = D.biz.rows, months = [...new Set(rows.map((r) => r.m))].sort(), m3 = months.slice(-3), stockM = [...new Set(rows.filter((r) => r.stk).map((r) => r.m))].sort().pop();
  const sales = {}, stock = {}; rows.forEach((r) => { const k = nk(r.model); if (m3.includes(r.m)) sales[k] = (sales[k] || 0) + r.su; if (r.m === stockM) stock[k] = (stock[k] || 0) + r.stk; });
  const models = await pool(cat.models.slice(0, 200), 30, async (c) => {
    const k = nk(c.name), o = cfg.models[k] || {}; if (o.hide) return null;
    let price = num(o.price); if (!price) { const m = await store.get(`affm:${c.slug}`); const ps = ((m && m.variants) || []).map((v) => v.price).filter(Boolean); price = ps.length ? Math.min(...ps) : 0; }
    const max = o.max != null && o.max !== "" ? Math.max(0, Math.round(num(o.max))) : cfg.defMax, avgM = (sales[k] || 0) / (m3.length || 1);
    return { model: c.name, series: c.series || "", price, max, used: used[k] || 0, left: Math.max(0, max - (used[k] || 0)), stock: stock[k] || 0, avgSales: Math.round(avgM * 10) / 10, suggest: Math.min(Math.max(0, max - (used[k] || 0)), Math.max(0, Math.round(avgM * cfg.cover / 30 - (stock[k] || 0)))), last: last[k] || null };
  });
  const inCat = new Set(cat.models.map((c) => nk(c.name))), extra = {};   // models the retailer deals in that aren't in the catalog yet
  rows.forEach((r) => { const k = nk(r.model); if (!k || inCat.has(k)) return; const x = extra[k] || (extra[k] = { model: r.model, pu: 0, pv: 0 }); x.pu += r.pu; x.pv += r.pv; });
  Object.keys(extra).forEach((k) => { const o = cfg.models[k] || {}; if (o.hide) return; const x = extra[k], price = num(o.price) || (x.pu ? Math.round(x.pv / x.pu) : 0), max = o.max != null && o.max !== "" ? Math.max(0, Math.round(num(o.max))) : cfg.defMax, avgM = (sales[k] || 0) / (m3.length || 1);
    models.push({ model: x.model, series: "", price, max, used: used[k] || 0, left: Math.max(0, max - (used[k] || 0)), stock: stock[k] || 0, avgSales: Math.round(avgM * 10) / 10, suggest: Math.min(Math.max(0, max - (used[k] || 0)), Math.max(0, Math.round(avgM * cfg.cover / 30 - (stock[k] || 0)))), last: last[k] || null }); });
  const L = models.filter(Boolean).sort((a, c) => (c.suggest - a.suggest) || (c.avgSales - a.avgSales) || (c.price - a.price));
  const base = cfg.balance === "wallet" ? D.wallet.balance : cfg.balance === "credit" ? (num(D.retailer.credit) || D.wallet.balance) : null;
  return { on: cfg.on !== false, balanceMode: cfg.balance, balance: base, committed: r2(committed), available: base == null ? null : r2(base - committed), minValue: cfg.minValue, note: cfg.note, cover: cfg.cover, models: L, orders: orders.slice(0, 30) };
}
async function placeOrder(store, pool, rid, D, b, by, via, t) {
  const I = await orderInfo(store, pool, rid, D); if (!I.on) return { error: "Ordering is switched off right now." };
  const want = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map((x) => ({ model: str(x.model, 60), qty: Math.round(num(x.qty)) })).filter((x) => x.model && x.qty > 0);
  if (!want.length) return { error: "Add at least one model to the cart." };
  const items = [];
  for (const w of want) {
    const M = I.models.find((m) => nk(m.model) === nk(w.model)); if (!M) return { error: w.model + " can't be ordered." };
    if (w.qty > M.left) return { error: `${M.model}: you can order up to ${M.left} more this month (limit ${M.max}).` };
    items.push({ model: M.model, qty: w.qty, price: M.price, value: r2(M.price * w.qty) });
  }
  const total = r2(items.reduce((a, x) => a + x.value, 0));
  if (I.minValue && total < I.minValue) return { error: "Minimum order value is ₹" + I.minValue.toLocaleString("en-IN") + "." };
  if (I.available != null && total > I.available) return { error: "Order ₹" + Math.round(total).toLocaleString("en-IN") + " is more than the available balance ₹" + Math.round(I.available).toLocaleString("en-IN") + "." };
  const o = { id: nid(t), rid, rname: D.retailer.name, state: D.retailer.state, items, total, status: "placed", note: txt(b.note, 300), by, via, at: t, month: D.today.slice(0, 7), history: [{ status: "placed", by, at: t }] };
  await store.set(`rto:${o.id}`, o); return { order: o };
}

function monthOf(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 7); }   // Excel serial date
  const s = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})/.exec(s); if (m) return m[1] + "-" + m[2].padStart(2, "0");
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); if (m) return m[3] + "-" + m[2].padStart(2, "0");
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s); if (m) return m[2] + "-" + m[1].padStart(2, "0");
  const M = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = /^([a-z]{3})[a-z]*[\s\-'’,]*(\d{2,4})$/i.exec(s); if (m && M.includes(m[1].toLowerCase())) { const y = m[2].length === 2 ? "20" + m[2] : m[2]; return y + "-" + String(M.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0"); }
  return "";
}
function idxOf(d, m0) {
  const months = [...new Set((d.rows || []).map((r) => r.m))].sort(), last = months[months.length - 1] || "";
  const L = (d.rows || []).filter((r) => r.m === last), stockM = [...new Set((d.rows || []).filter((r) => r.stk).map((r) => r.m))].sort().pop() || "";
  return { m: last, su: L.reduce((a, r) => a + r.su, 0), sv: r2(L.reduce((a, r) => a + r.sv, 0)), stk: (d.rows || []).filter((r) => r.m === stockM).reduce((a, r) => a + r.stk, 0), tu: ((d.targets || {})[last] || {}).u || 0, ...m0 };
}

// Everything the portal shows for one retailer. `staff` adds staff-only parts (links, internal notes).
async function portalData(store, pool, rid, opts) {
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const [m, d, I, pr] = await Promise.all([store.get(`rtl:${rid}`), store.get(`rtd:${rid}`), store.get("rpidx"), store.get(`rpr:${rid}`)]);
  const pi = (I || {})[rid];
  if (!m && !d && !pi && !pr) return null;
  const master = Object.assign({ rid, name: (pi && pi.n) || (pr && pr.name) || rid, state: (pi && pi.s) || (pr && pr.state) || "", city: (pi && pi.c) || (pr && pr.city) || "", mobile: (pr && pr.mobile) || "" }, m || {});
  // payouts: wallet ledger + published payout lines
  const entries = ((pr && pr.entries) || []).map((e) => ({ date: e.date, month: e.month, type: e.type, kind: e.kind, amount: e.amount, scheme: e.scheme, note: e.note, item: e.item })).sort((a, c) => (c.date || "").localeCompare(a.date || ""));
  let cr = 0, dr = 0; entries.forEach((e) => { if (e.type === "cr") cr += e.amount; else dr += e.amount; });
  const lines = [];
  for (const x of (await pool(await store.list("rpb:"), 30, (k) => store.get(k))).filter((x) => x && x.status === "published")) x.rows.forEach((row) => { if (row.rid === rid) lines.push({ title: x.title, month: x.month, scheme: row.scheme, gross: row.gross, ded: row.ded, tds: row.tds, net: row.net, info: row.info || {}, next: row.next || null, parts: (row.parts || []).slice(0, 12) }); });
  lines.sort((a, c) => (c.month || "").localeCompare(a.month || ""));
  // schemes that apply to this retailer's state
  const st = low(master.state);
  const schemes = (await pool(await store.list("spol:"), 40, (k) => store.get(k))).filter(Boolean).filter((p) => p.status !== "draft" && !p.disabled && (!p.dateTo || p.dateTo >= today) && (() => { const a = p.audience || {}; if (a.scope === "users") return !!opts.staffSees && opts.staffSees(p); if (a.scope === "states") return (a.states || []).some((s) => low(s) === st); return true; })())
    .map((p) => { const b = p.brief || {}; return { id: p.id, title: p.title, from: p.dateFrom, to: p.dateTo, upcoming: !!(p.dateFrom && p.dateFrom > today), category: p.category, models: (p.models || []).slice(0, 20), summary: str(b.summary, 500), keyPoints: (b.keyPoints || []).slice(0, 6), slabs: (b.slabs || []).slice(0, 10), maxPayout: b.maxPayout || "", terms: (b.terms || []).slice(0, 5) }; })
    .sort((a, c) => (a.upcoming ? 1 : 0) - (c.upcoming ? 1 : 0) || (a.to || "9").localeCompare(c.to || "9"));
  // announcements & launches
  const anns = (await pool(await store.list("rtpann:"), 30, (k) => store.get(k))).filter(Boolean).filter((a) => (!a.until || a.until >= today) && (!(a.states || []).length || a.states.some((s) => low(s) === st)) && (!(a.rids || []).length || a.rids.includes(rid)))
    .sort((a, c) => (c.pin ? 1 : 0) - (a.pin ? 1 : 0) || c.at - a.at).slice(0, 40).map((a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, link: a.link, model: a.model, pin: !!a.pin, at: a.at, by: a.by, until: a.until || "" }));
  const launches = [];
  for (const k of (await store.list("prod:")).slice(0, 200)) { const p = await store.get(k); if (p && p.launch && p.launch >= new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)) launches.push({ slug: k.slice(5), name: p.name || k.slice(5), launch: p.launch, mrp: p.mrp || 0, highlights: (p.highlights || []).slice(0, 4), img: (p.images || [])[0] || "" }); }
  launches.sort((a, c) => c.launch.localeCompare(a.launch));
  const qs = (await pool(await store.list("rtpq:"), 30, (k) => store.get(k))).filter((q) => q && q.rid === rid).sort((a, c) => c.at - a.at).slice(0, 40);
  const il = (await store.get(`rtil:${rid}`)) || { items: [] }, age = ageing(il.items, today); age.updatedAt = il.updatedAt || 0;
  const offers = opts.noOffers ? [] : await offersFor(store, pool, [...new Set(((d && d.rows) || []).map((r) => r.model).concat(il.items.map((x) => x.m)))], master.state, today);
  return { today, retailer: master, biz: d ? { rows: d.rows || [], targets: d.targets || {}, updatedAt: d.updatedAt || 0 } : { rows: [], targets: {}, updatedAt: 0 },
    wallet: { earned: r2(cr), used: r2(dr), balance: r2(cr - dr), entries: entries.slice(0, 60) }, payouts: lines.slice(0, 40), schemes, anns, launches: launches.slice(0, 12), queries: qs, ageing: age, offers };
}
// short text the AI reads
function aiContext(D) {
  const rows = D.biz.rows, months = [...new Set(rows.map((r) => r.m))].sort().slice(-6);
  const byM = months.map((m) => { const L = rows.filter((r) => r.m === m); return { month: m, purchaseUnits: L.reduce((a, r) => a + r.pu, 0), purchaseValue: r2(L.reduce((a, r) => a + r.pv, 0)), salesUnits: L.reduce((a, r) => a + r.su, 0), salesValue: r2(L.reduce((a, r) => a + r.sv, 0)), target: D.biz.targets[m] || null }; });
  const last = months[months.length - 1], stockM = [...new Set(rows.filter((r) => r.stk).map((r) => r.m))].sort().pop();
  const models = rows.filter((r) => r.m === last || r.m === stockM).reduce((o, r) => { const x = o[r.model] || (o[r.model] = { model: r.model, sold: 0, stock: 0 }); if (r.m === last) x.sold += r.su; if (r.m === stockM) x.stock += r.stk; return o; }, {});
  return JSON.stringify({ today: D.today, retailer: { id: D.retailer.rid, name: D.retailer.name, city: D.retailer.city, state: D.retailer.state, type: D.retailer.type }, monthly: byM, models: Object.values(models).slice(0, 40), wallet: { earned: D.wallet.earned, used: D.wallet.used, balance: D.wallet.balance },
    recentPayouts: D.payouts.slice(0, 8).map((p) => ({ month: p.month, scheme: p.scheme, net: p.net, next: p.next })), schemes: D.schemes.slice(0, 12).map((s) => ({ title: s.title, from: s.from, to: s.to, models: s.models, summary: s.summary, slabs: s.slabs, maxPayout: s.maxPayout })),
    announcements: D.anns.slice(0, 8).map((a) => ({ kind: a.kind, title: a.title, body: str(a.body, 300) })), launches: D.launches.slice(0, 5).map((l) => ({ name: l.name, launch: l.launch, mrp: l.mrp })),
    stockAgeing: { unsold: D.ageing.unsold, buckets: D.ageing.buckets, models: D.ageing.models.slice(0, 12) }, offers: (D.offers || []).slice(0, 12).map((o) => ({ model: o.model, price: o.price, offers: o.offers.slice(0, 6).map((x) => [x.kind, x.partner, x.scheme, x.benefit, x.details].filter(Boolean).join(" · ").slice(0, 160)) })) }).slice(0, 18000);
}
const AI_SYS = "You are the vivo India retailer assistant. Answer the retailer's or vivo staff member's question using ONLY the DATA given (their purchase, sales, stock, stock ageing, targets, payouts, wallet, running schemes, consumer offers (EMI / exchange / upgrade etc.), announcements and launches). Be short, friendly and specific with numbers (₹ and units). If something isn't in the DATA, say so and suggest raising a query to the sales team. Never invent scheme amounts. Plain text, at most 8 short lines; use • bullets where useful.";
const AI_SUMMARY = "Give this retailer a one-glance business summary from DATA: 1) how this month is going vs target, 2) stock health (models with high stock and low sales, models running out), 3) money: payouts earned / wallet balance, 4) the 2-3 best scheme opportunities right now with exactly what to do, 5) one line on new launches. Use • bullets, under 10 lines.";

async function ask(ctx, D, q, history, summary) {
  if (!ctx.askAI) return { ok: false, error: "AI is not available." };
  const r = await ctx.askAI(ctx.env, summary ? AI_SUMMARY : str(q, 500), "DATA: " + aiContext(D), summary ? [] : history, ctx.aiFetch, { system: AI_SYS, label: "RETAILER" });
  return r.ok ? { ok: true, answer: r.text } : { ok: false, error: r.error || "AI is busy — try again." };
}

// ---------- public (read-only link sent to a retailer; no login) ----------
export async function rtpPublic(b, ctx) {
  const { store, t, pool } = ctx;
  const k = str(b.k, 40).replace(/[^a-zA-Z0-9]/g, ""), L = k ? await store.get(`rtplink:${k}`) : null;
  if (!L || L.revoked || t > L.exp) return json(404, { ok: false, error: "This link has expired. Please ask your vivo sales team for a new one." });
  const D = await portalData(store, pool, L.rid, {}); if (!D) return json(404, { ok: false, error: "Not found." });
  if (b.action === "rtp-public") {
    D.queries = D.queries.map((q) => ({ id: q.id, topic: q.topic, to: q.to, text: q.text, status: q.status, at: q.at, thread: q.thread.map((m) => ({ by: m.staff ? "vivo team" : m.by, at: m.at, text: m.text, staff: !!m.staff })) }));
    delete D.retailer.asm;
    return json(200, Object.assign({ ok: true, topics: RTP_TOPICS, exp: L.exp }, D));
  }
  if (b.action === "rtp-public-q") {
    const text = txt(b.text, 1500); if (text.length < 3) return json(400, { ok: false, error: "Write your question." });
    if (D.queries.filter((q) => q.status === "open").length >= 15) return json(429, { ok: false, error: "You already have many open queries — please wait for replies." });
    const q = { id: nid(t), rid: L.rid, rname: D.retailer.name, state: D.retailer.state, topic: RTP_TOPICS.includes(b.topic) ? b.topic : "Other", to: b.to === "ho" ? "ho" : "sales", text, status: "open", thread: [], at: t, by: str(b.name, 60) || D.retailer.name, via: "link" };
    await store.set(`rtpq:${q.id}`, q); return json(200, { ok: true, id: q.id });
  }
  if (b.action === "rtp-public-imei") { const i = IMEI(b.imei), il = (await store.get(`rtil:${L.rid}`)) || { items: [] }, x = il.items.find((y) => y.i === i); return json(200, x ? { ok: true, item: imeiOut(x, D.today), retailer: { rid: L.rid, name: D.retailer.name } } : { ok: false, error: "This IMEI isn't in your stock list." }); }
  if (b.action === "rtp-public-ordercat") return json(200, Object.assign({ ok: true }, await orderInfo(store, pool, L.rid, D)));
  if (b.action === "rtp-public-order") { const r = await placeOrder(store, pool, L.rid, D, b, str(b.name, 60) || D.retailer.name, "link", t); return json(r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : { ok: true, order: r.order }); }
  if (b.action === "rtp-public-order-cancel") { const o = await store.get(`rto:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!o || o.rid !== L.rid) return json(404, { ok: false, error: "Not found." }); if (o.status !== "placed") return json(400, { ok: false, error: "Only orders not yet accepted can be cancelled." }); o.status = "cancelled"; o.history.push({ status: "cancelled", by: D.retailer.name, at: t }); await store.set(`rto:${o.id}`, o); return json(200, { ok: true }); }
  if (b.action === "rtp-public-ask") {
    const day = new Date(t + 19800000).toISOString().slice(0, 10); L.asks = L.asks && L.asks.day === day ? L.asks : { day, n: 0 };
    if (L.asks.n >= 30) return json(429, { ok: false, error: "Daily question limit reached — try tomorrow or raise a query." });
    L.asks.n++; await store.set(`rtplink:${k}`, L);
    const r = await ask(ctx, D, b.q, b.history, b.summary === true); return json(200, r);
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// ---------- staff (HO + state users) ----------
export async function rtpAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "", myState = isHO ? "" : str(rec.state, 40);
  const seeState = (s) => isHO || low(s) === low(myState);
  const ids = [rec.username, rec.vchatId, rec.email].filter(Boolean).map(low);
  const staffSees = (p) => isHO || ((p.audience || {}).users || []).some((u) => ids.includes(low(u)));
  const stateOf = async (rid) => { const m = await store.get(`rtl:${rid}`); if (m) return m.state; const I = (await store.get("rpidx")) || {}; return I[rid] ? I[rid].s : null; };

  if (b.action === "rtp-me") return json(200, { ok: true, isHO, state: myState, topics: RTP_TOPICS });
  if (b.action === "rtp-list") {
    const [I, P] = await Promise.all([store.get("rtpidx"), store.get("rpidx")]), A = Object.assign({}, I || {}), q = low(b.q), st = str(b.state, 40);
    Object.keys(P || {}).forEach((rid) => { const p = P[rid]; A[rid] = Object.assign({ n: p.n, s: p.s, c: p.c }, A[rid] || {}, { bal: p.bal, cr: p.cr }); });
    let L = Object.keys(A).map((rid) => Object.assign({ rid }, A[rid])).filter((x) => seeState(x.s));
    const states = [...new Set(L.map((x) => x.s).filter(Boolean))].sort();
    if (st) L = L.filter((x) => low(x.s) === low(st));
    if (q) L = L.filter((x) => (x.rid + " " + (x.n || "") + " " + (x.c || "")).toLowerCase().includes(q));
    const openQ = (await pool(await store.list("rtpq:"), 30, (k) => store.get(k))).filter((x) => x && x.status === "open" && seeState(x.state)).length;
    const newOrders = (await pool(await store.list("rto:"), 30, (k) => store.get(k))).filter((o) => o && o.status === "placed" && seeState(o.state)).length;
    return json(200, { ok: true, items: L.sort((a, c) => (c.sv || 0) - (a.sv || 0) || (c.bal || 0) - (a.bal || 0)).slice(0, 600), count: L.length, states, openQ, newOrders });
  }
  if (b.action === "rtp-get") {
    const rid = RID(b.rid); const D = await portalData(store, pool, rid, { staffSees }); if (!D) return json(404, { ok: false, error: "No data for this retailer yet." });
    if (!seeState(D.retailer.state)) return json(403, { ok: false, error: "This retailer is in another state." });
    const links = [];
    for (const k of await store.list("rtplink:")) { const L = await store.get(k); if (L && L.rid === rid && !L.revoked && L.exp > t) links.push({ k: k.slice(8), exp: L.exp, by: L.by, at: L.at }); }
    return json(200, Object.assign({ ok: true, topics: RTP_TOPICS, links, isHO }, D));
  }
  if (b.action === "rtp-import") {   // kind "master" (retailer list) or "biz" (month × model rows)
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 20000); let n = 0, skipped = 0;
    if (b.kind === "master") {
      const I = (await store.get("rtpidx")) || {};
      for (const x of rows) {
        const rid = RID(x.rid); if (!rid) continue; const state = str(x.state, 40) || myState;
        if (!seeState(state)) { skipped++; continue; }
        const old = (await store.get(`rtl:${rid}`)) || {};
        const m = Object.assign(old, { rid, name: str(x.name, 80) || old.name || rid, owner: str(x.owner, 80) || old.owner || "", mobile: str(x.mobile, 20) || old.mobile || "", state, city: str(x.city, 60) || old.city || "", area: str(x.area, 60) || old.area || "", type: str(x.type, 40) || old.type || "", asm: str(x.asm, 80) || old.asm || "", gst: str(x.gst, 20) || old.gst || "", credit: x.credit != null && String(x.credit).trim() !== "" ? num(x.credit) : old.credit || 0, updatedAt: t, by });
        await store.set(`rtl:${rid}`, m); I[rid] = Object.assign(I[rid] || {}, { n: m.name, s: m.state, c: m.city, t: m.type }); n++;
      }
      await store.set("rtpidx", I); return json(200, { ok: true, saved: n, skipped });
    }
    if (b.kind === "imei") {   // IMEI-level stock: IMEI, model, retailer, billing date, activation, finance
      const by2 = {}; let bad = 0;
      rows.forEach((x) => { const rid = RID(x.rid), i = IMEI(x.imei); if (!rid || i.length !== 15) { bad++; return; } (by2[rid] || (by2[rid] = [])).push(Object.assign({}, x, { i })); });
      for (const rid of Object.keys(by2)) {
        const st = (await stateOf(rid)) || str(by2[rid][0].state, 40) || myState;
        if (!seeState(st)) { skipped += by2[rid].length; continue; }
        const il = (await store.get(`rtil:${rid}`)) || { items: [] }, map = new Map(il.items.map((y) => [y.i, y]));
        for (const x of by2[rid]) {
          const old = map.get(x.i) || {}, ad = dateOf(x.ad), act = x.act != null && String(x.act).trim() !== "" ? yes(x.act) || !!ad : !!(old.act || ad);
          map.set(x.i, { i: x.i, m: str(x.model, 50) || old.m || "", bd: dateOf(x.bd) || old.bd || "", act, ad: ad || old.ad || "", fin: x.fin != null && String(x.fin).trim() !== "" ? yes(x.fin) : !!old.fin, fp: str(x.fp, 40) || old.fp || "", ls: str(x.ls, 40) || old.ls || "", dp: num(x.dp) || old.dp || 0 });
          const w = await store.get(`rtimei:${x.i}`); if (!w || w.rid !== rid) await store.set(`rtimei:${x.i}`, { rid });
          n++;
        }
        il.items = [...map.values()].slice(-8000); il.updatedAt = t; await store.set(`rtil:${rid}`, il);
        if (!(await store.get(`rtl:${rid}`))) { await store.set(`rtl:${rid}`, { rid, name: str(by2[rid][0].name, 80) || rid, state: st, updatedAt: t, by }); const I = (await store.get("rtpidx")) || {}; I[rid] = Object.assign(I[rid] || {}, { n: str(by2[rid][0].name, 80) || rid, s: st }); await store.set("rtpidx", I); }
      }
      return json(200, { ok: true, saved: n, skipped, bad, retailers: Object.keys(by2).length });
    }
    if (b.kind === "biz") {
      const by2 = {}; let bad = 0;
      rows.forEach((x) => { const rid = RID(x.rid), m = monthOf(x.month); if (!rid || !m) { bad++; return; } (by2[rid] || (by2[rid] = [])).push(Object.assign({}, x, { m })); });
      const I = (await store.get("rtpidx")) || {};
      for (const rid of Object.keys(by2)) {
        const st = (await stateOf(rid)) || str(by2[rid][0].state, 40) || myState;
        if (!seeState(st)) { skipped += by2[rid].length; continue; }
        const d = (await store.get(`rtd:${rid}`)) || { rows: [], targets: {} }, months = new Set(by2[rid].map((x) => x.m));
        d.rows = d.rows.filter((r) => !months.has(r.m));
        by2[rid].forEach((x) => {
          const model = str(x.model, 50);
          if (model) d.rows.push({ m: x.m, model, pu: num(x.pu), pv: num(x.pv), su: num(x.su), sv: num(x.sv), stk: num(x.stk) });
          if (num(x.tu) || num(x.tv)) { const tg = d.targets[x.m] || { u: 0, v: 0 }; d.targets[x.m] = { u: Math.max(tg.u, num(x.tu)), v: Math.max(tg.v, num(x.tv)) }; }
          n++;
        });
        d.rows = d.rows.slice(-6000); d.updatedAt = t; await store.set(`rtd:${rid}`, d);
        const nm = by2[rid][0].name ? str(by2[rid][0].name, 80) : "";
        I[rid] = idxOf(d, Object.assign({ n: (I[rid] && I[rid].n) || nm || rid, s: (I[rid] && I[rid].s) || st, c: (I[rid] && I[rid].c) || str(by2[rid][0].city, 60) }, {}));
        if (!(await store.get(`rtl:${rid}`))) await store.set(`rtl:${rid}`, { rid, name: nm || rid, state: st, city: str(by2[rid][0].city, 60), updatedAt: t, by });
      }
      await store.set("rtpidx", I); return json(200, { ok: true, saved: n, skipped, bad, retailers: Object.keys(by2).length });
    }
    return json(400, { ok: false, error: "Unknown import." });
  }
  if (b.action === "rtp-imei") {   // IMEI search (scan or type)
    const i = IMEI(b.imei); if (i.length !== 15) return json(400, { ok: false, error: "Enter the 15-digit IMEI." });
    const w = await store.get(`rtimei:${i}`); if (!w) return json(404, { ok: false, error: "This IMEI isn't in any uploaded retailer stock." });
    const st = await stateOf(w.rid); if (!seeState(st)) return json(403, { ok: false, error: "This IMEI is with a retailer in another state." });
    const il = (await store.get(`rtil:${w.rid}`)) || { items: [] }, x = il.items.find((y) => y.i === i); if (!x) return json(404, { ok: false, error: "Not found." });
    const m = (await store.get(`rtl:${w.rid}`)) || {}; return json(200, { ok: true, item: imeiOut(x, new Date(t + 19800000).toISOString().slice(0, 10)), retailer: { rid: w.rid, name: m.name || w.rid, state: st, city: m.city || "" } });
  }
  if (b.action === "rtp-order-cat") { const rid = RID(b.rid), D = await portalData(store, pool, rid, { staffSees, noOffers: true }); if (!D) return json(404, { ok: false, error: "Not found." }); if (!seeState(D.retailer.state)) return json(403, { ok: false, error: "Another state's retailer." }); return json(200, Object.assign({ ok: true }, await orderInfo(store, pool, rid, D))); }
  if (b.action === "rtp-order") { const rid = RID(b.rid), D = await portalData(store, pool, rid, { staffSees, noOffers: true }); if (!D) return json(404, { ok: false, error: "Not found." }); if (!seeState(D.retailer.state)) return json(403, { ok: false, error: "Another state's retailer." }); const r = await placeOrder(store, pool, rid, D, b, by, "staff", t); return json(r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : { ok: true, order: r.order }); }
  if (b.action === "rtp-order-list") {
    let L = (await pool(await store.list("rto:"), 30, (k) => store.get(k))).filter((o) => o && seeState(o.state));
    if (b.rid) L = L.filter((o) => o.rid === RID(b.rid)); if (b.status) L = L.filter((o) => o.status === b.status);
    return json(200, { ok: true, items: L.sort((a, c) => (a.status === "placed" ? 0 : 1) - (c.status === "placed" ? 0 : 1) || c.at - a.at).slice(0, 300), statuses: STATUSES });
  }
  if (b.action === "rtp-order-status") {
    const o = await store.get(`rto:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!o || !seeState(o.state)) return json(404, { ok: false, error: "Not found." });
    if (!STATUSES.includes(b.status)) return json(400, { ok: false, error: "Pick a status." });
    o.status = b.status; o.history.push({ status: b.status, by, at: t, note: txt(b.note, 300) }); await store.set(`rto:${o.id}`, o); return json(200, { ok: true, item: o });
  }
  if (b.action === "rtp-order-cfg") {   // HO: read / save the ordering rules
    const cfg = await orderCfg(store);
    if (!b.save) { const cat = (await store.get("affcat")) || { models: [] }; return json(200, { ok: true, cfg, models: cat.models.slice(0, 200).map((m) => ({ name: m.name, key: nk(m.name), series: m.series || "" })), isHO }); }
    if (!isHO) return json(403, { ok: false, error: "Only HO admins can change ordering rules." });
    const c = b.cfg || {}, models = {};
    Object.keys(c.models || {}).slice(0, 300).forEach((k) => { const x = c.models[k] || {}, o = {}; if (x.max !== "" && x.max != null && isFinite(+x.max)) o.max = Math.max(0, Math.round(+x.max)); if (num(x.price)) o.price = num(x.price); if (x.hide) o.hide = true; if (Object.keys(o).length) models[nk(k)] = o; });
    const out = { on: c.on !== false, balance: ["credit", "wallet", "none"].includes(c.balance) ? c.balance : "credit", defMax: Math.max(0, Math.round(num(c.defMax))) || 20, cover: Math.max(7, Math.min(90, Math.round(num(c.cover)) || 30)), minValue: Math.max(0, num(c.minValue)), note: txt(c.note, 300), models, by, at: t };
    await store.set("config:rtporder", out); return json(200, { ok: true, cfg: out });
  }
  if (b.action === "rtp-clear") {   // remove a retailer's business data (HO only)
    if (!isHO) return json(403, { ok: false, error: "HO only." });
    const rid = RID(b.rid); await store.delete(`rtd:${rid}`); const I = (await store.get("rtpidx")) || {}; if (I[rid]) { I[rid] = { n: I[rid].n, s: I[rid].s, c: I[rid].c, t: I[rid].t }; await store.set("rtpidx", I); }
    return json(200, { ok: true });
  }
  // announcements
  if (b.action === "rtp-ann-list") {
    const L = (await pool(await store.list("rtpann:"), 30, (k) => store.get(k))).filter(Boolean).filter((a) => isHO || !(a.states || []).length || a.states.some((s) => low(s) === low(myState)));
    return json(200, { ok: true, items: L.sort((a, c) => c.at - a.at).map((a) => Object.assign({}, a, { mine: isHO || a.byKey === app + ":" + rec.username })) });
  }
  if (b.action === "rtp-ann-save") {
    const a0 = b.item || {}, id = str(a0.id, 30).replace(/[^a-z0-9]/gi, ""), old = id ? await store.get(`rtpann:${id}`) : null;
    if (old && !isHO && old.byKey !== app + ":" + rec.username) return json(403, { ok: false, error: "You can edit only your own posts." });
    const title = str(a0.title, 140); if (!title) return json(400, { ok: false, error: "Add a title." });
    let states = (Array.isArray(a0.states) ? a0.states : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 40); if (!isHO) states = [myState];
    const a = { id: id || nid(t), kind: ANN_KINDS.includes(a0.kind) ? a0.kind : "news", title, body: txt(a0.body, 3000), link: /^https:\/\//.test(String(a0.link || "")) ? str(a0.link, 400) : "", model: str(a0.model, 60), states, rids: (Array.isArray(a0.rids) ? a0.rids : String(a0.rids || "").split(/[\s,;]+/)).map(RID).filter(Boolean).slice(0, 500), pin: !!a0.pin, until: /^\d{4}-\d{2}-\d{2}$/.test(a0.until || "") ? a0.until : "", at: old ? old.at : t, updatedAt: t, by: old ? old.by : by, byKey: old ? old.byKey : app + ":" + rec.username, byState: old ? old.byState : myState || "HO" };
    await store.set(`rtpann:${a.id}`, a); return json(200, { ok: true, item: a });
  }
  if (b.action === "rtp-ann-delete") {
    const id = str(b.id, 30).replace(/[^a-z0-9]/gi, ""), a = await store.get(`rtpann:${id}`); if (!a) return json(200, { ok: true });
    if (!isHO && a.byKey !== app + ":" + rec.username) return json(403, { ok: false, error: "You can delete only your own posts." });
    await store.delete(`rtpann:${id}`); return json(200, { ok: true });
  }
  // queries
  if (b.action === "rtp-q-list") {
    let L = (await pool(await store.list("rtpq:"), 30, (k) => store.get(k))).filter(Boolean).filter((q) => seeState(q.state));
    if (b.rid) L = L.filter((q) => q.rid === RID(b.rid)); if (b.status) L = L.filter((q) => q.status === b.status); if (b.to) L = L.filter((q) => q.to === b.to);
    return json(200, { ok: true, items: L.sort((a, c) => (a.status === "open" ? 0 : 1) - (c.status === "open" ? 0 : 1) || c.at - a.at).slice(0, 300) });
  }
  if (b.action === "rtp-q-raise") {   // staff raising on behalf of a retailer (e.g. on a visit)
    const rid = RID(b.rid), st = await stateOf(rid); if (st == null) return json(404, { ok: false, error: "Retailer not found." }); if (!seeState(st)) return json(403, { ok: false, error: "Another state's retailer." });
    const text = txt(b.text, 1500); if (text.length < 3) return json(400, { ok: false, error: "Write the query." });
    const m = (await store.get(`rtl:${rid}`)) || {}, I = (await store.get("rpidx")) || {};
    const q = { id: nid(t), rid, rname: m.name || (I[rid] && I[rid].n) || rid, state: st, topic: RTP_TOPICS.includes(b.topic) ? b.topic : "Other", to: b.to === "ho" ? "ho" : "sales", text, status: "open", thread: [], at: t, by, via: "staff" };
    await store.set(`rtpq:${q.id}`, q); return json(200, { ok: true, item: q });
  }
  if (b.action === "rtp-q-reply") {
    const id = str(b.id, 30).replace(/[^a-z0-9]/gi, ""), q = await store.get(`rtpq:${id}`); if (!q || !seeState(q.state)) return json(404, { ok: false, error: "Not found." });
    const text = txt(b.text, 1500); if (text) q.thread.push({ by, at: t, text, staff: true });
    if (["open", "answered", "closed"].includes(b.status)) q.status = b.status; else if (text) q.status = "answered";
    if (b.to === "ho" || b.to === "sales") q.to = b.to;
    q.updatedAt = t; await store.set(`rtpq:${id}`, q); return json(200, { ok: true, item: q });
  }
  // AI
  if (b.action === "rtp-ask") {
    const rid = RID(b.rid), D = await portalData(store, pool, rid, { staffSees }); if (!D) return json(404, { ok: false, error: "No data for this retailer yet." });
    if (!seeState(D.retailer.state)) return json(403, { ok: false, error: "Another state's retailer." });
    return json(200, await ask(ctx, D, b.q, b.history, b.summary === true));
  }
  // retailer web link
  if (b.action === "rtp-link") {
    const rid = RID(b.rid), st = await stateOf(rid); if (st == null) return json(404, { ok: false, error: "Retailer not found." }); if (!seeState(st)) return json(403, { ok: false, error: "Another state's retailer." });
    const days = Math.max(1, Math.min(90, Number(b.days) || 30)), k = randomBytes(16).toString("hex");
    await store.set(`rtplink:${k}`, { rid, at: t, by, exp: t + days * 864e5 }); return json(200, { ok: true, k, exp: t + days * 864e5 });
  }
  if (b.action === "rtp-link-revoke") {
    const k = str(b.k, 40).replace(/[^a-zA-Z0-9]/g, ""), L = await store.get(`rtplink:${k}`); if (!L) return json(200, { ok: true });
    if (!seeState(await stateOf(L.rid))) return json(403, { ok: false, error: "Not allowed." });
    L.revoked = true; await store.set(`rtplink:${k}`, L); return json(200, { ok: true });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
