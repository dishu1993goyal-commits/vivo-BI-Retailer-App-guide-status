// Retailer payouts: scheme payouts per retailer (from the payout calculator or a manual-payout Excel), published by HO
// into each retailer's wallet ledger; balance = published payouts − vouchers bought − amounts already paid (bank /
// credit note). State teams see their state's retailers; HO sees all. Vouchers/services uploaded by HO can be bought
// instantly from a retailer's balance (no approval) — the code / link is shown right away.
// Storage:
//   rpb:<id>          batch { id, title, month, source:"calc"|"manual", status:"draft"|"published", state, by, at, publishedAt, schemes:{key:scheme}, rows:[…] }
//   rpr:<RID>         retailer { rid, name, mobile, state, city, entries:[{ id, at, date, month, type:"cr"|"dr", kind, amount, scheme, batch, ref, note, item, code, link }] }
//   rpidx             { RID: { n, s, c, cr, dr, bal, last } }      — quick list / search
//   rpv:cat           { items:[{ id, name, cat, provider, value, price, mode:"code"|"link", link, howTo, validity, active }] }
//   rpv:codes:<item>  { codes:[…] }     — never sent to devices in bulk
//   rps:<id>          { id, scheme, by, byKey, state, at }   — this tool's own scheme rules (separate from the payout calculator's)
import { randomBytes } from "node:crypto";
import { cleanScheme } from "./schemecalc-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const money = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]|rs\.?/gi, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const numOr = (v) => { if (v == null || String(v).trim() === "") return null; const n = Number(String(v).replace(/[₹,%\s]/g, "")); return isFinite(n) ? n : null; };
const RID = (v) => str(v, 40).toUpperCase().replace(/[^A-Z0-9_\-./]/g, "");
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const MONTH = (v) => (/^\d{4}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const low = (x) => String(x || "").trim().toLowerCase();
export const VCATS = { travel: "✈️ Air tickets & travel", hotel: "🏨 Hotel booking", grocery: "🛒 Grocery", shopping: "🛍️ Shopping", fuel: "⛽ Fuel", food: "🍽️ Food", mobile: "📱 Recharge & bills", other: "🎁 Other" };

function cleanRow(x, defState) {
  x = x || {};
  const parts = (Array.isArray(x.parts) ? x.parts : []).slice(0, 30).map((p) => ({ label: str(p && p.label, 120) || "Payout", slab: str(p && p.slab, 60), amount: money(p && p.amount), type: str(p && p.type, 20) })).filter((p) => p.amount || p.label);
  let gross = numOr(x.gross), ded = Math.abs(money(x.ded)), tds = Math.abs(money(x.tds)), net = numOr(x.net);
  const pos = parts.filter((p) => p.amount > 0 && p.type !== "tds").reduce((a, p) => a + p.amount, 0), neg = -parts.filter((p) => p.amount < 0 && p.type !== "tds").reduce((a, p) => a + p.amount, 0);
  if (gross == null) gross = parts.length ? pos : net || 0;
  if (!ded && neg) ded = Math.round(neg * 100) / 100;
  if (!tds) { const tp = parts.find((p) => p.type === "tds"); if (tp) tds = Math.abs(tp.amount); }
  if (net == null) net = Math.round((gross - ded - tds) * 100) / 100;
  const info = {}; ["target", "achieved", "ach", "units", "value", "upload", "activation", "vsSold", "vsTarget", "targetValue"].forEach((k) => { const v = numOr(x.info && x.info[k]); if (v != null) info[k] = v; });
  ["slab", "dedReason", "basis"].forEach((k) => { if (x.info && x.info[k]) info[k] = str(x.info[k], 80); });
  const models = (Array.isArray(x.info && x.info.models) ? x.info.models : []).slice(0, 30).map((m) => ({ name: str(m && m.name, 40), target: numOr(m && m.target), sold: numOr(m && m.sold) })).filter((m) => m.name);
  if (models.length) info.models = models;
  const next = x.next && typeof x.next === "object" ? { need: numOr(x.next.need), model: str(x.next.model, 40), gain: money(x.next.gain) } : null;
  // IMEI / model-wise detail for this payout line: [imei, model, qty, date, value, eligible 1|0, payout per unit, payout amount, remark]
  const items = (Array.isArray(x.items) ? x.items : []).slice(0, 5000).map((it) => Array.isArray(it) ? [str(it[0], 20).replace(/[^0-9A-Za-z]/g, ""), str(it[1], 50), numOr(it[2]) == null ? 1 : numOr(it[2]), str(it[3], 10), money(it[4]), it[5] === 0 || it[5] === "N" || it[5] === false ? 0 : 1, money(it[6]), money(it[7]), str(it[8], 80)] : null).filter((it) => it && (it[0] || it[1]));
  let input = null; if (x.input && typeof x.input === "object") { try { const s = JSON.stringify(x.input); if (s.length < 60000) input = JSON.parse(s); } catch (e) { } }
  return { rid: RID(x.rid), name: str(x.name, 80), mobile: str(x.mobile, 20), state: str(x.state, 40) || defState || "", city: str(x.city, 60), scheme: str(x.scheme, 100) || "Scheme", skey: str(x.skey, 40), parts, gross: Math.round(gross * 100) / 100, ded, tds, net: Math.round(net * 100) / 100, info, next, input, items: items.length ? items : undefined, remarks: str(x.remarks, 300), query: x.query ? { by: str(x.query.by, 60), at: Number(x.query.at) || 0, note: str(x.query.note, 300) } : null };
}

export async function rpayAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx, isAdmin = app === "admin";
  const by = rec.fullName || rec.username || "";
  const myState = isAdmin ? "" : str(rec.state, 40);
  const seeState = (s) => isAdmin || low(s) === low(myState);
  const idx = async () => (await store.get("rpidx")) || {};
  const getR = async (rid) => store.get(`rpr:${rid}`);
  const sum = (r) => { let cr = 0, dr = 0, last = ""; (r.entries || []).forEach((e) => { if (e.type === "cr") cr += e.amount; else dr += e.amount; if (e.month > last) last = e.month; }); return { n: r.name, s: r.state, c: r.city, cr: Math.round(cr * 100) / 100, dr: Math.round(dr * 100) / 100, bal: Math.round((cr - dr) * 100) / 100, last }; };
  const saveR = async (r, I) => { await store.set(`rpr:${r.rid}`, r); I[r.rid] = sum(r); };
  const pubBatch = (x) => ({ id: x.id, title: x.title, month: x.month, source: x.source, status: x.status, state: x.state, by: x.by, at: x.at, publishedAt: x.publishedAt || 0, count: x.rows.length, total: Math.round(x.rows.reduce((a, r) => a + r.net, 0) * 100) / 100, schemes: [...new Set(x.rows.map((r) => r.scheme))].slice(0, 12), queries: x.rows.filter((r) => r.query).length });
  const visRows = (x) => x.rows.filter((r) => seeState(r.state));

  // ---------- this tool's scheme rule sets (read from letters by AI; the payout calculator's schemes are not touched) ----------
  if (b.action === "rp-scheme-list") {
    const L = (await pool(await store.list("rps:"), 30, (k) => store.get(k))).filter(Boolean).filter((x) => isAdmin || low(x.state) === low(myState));
    return json(200, { ok: true, items: L.sort((a, c) => c.at - a.at).map((x) => ({ id: x.id, scheme: x.scheme, by: x.by, state: x.state, at: x.at, mine: x.byKey === app + ":" + rec.username })) });
  }
  if (b.action === "rp-scheme-save") {
    const id0 = str(b.id, 30).replace(/[^a-z0-9]/gi, ""), old = id0 ? await store.get(`rps:${id0}`) : null;
    if (old && !isAdmin && low(old.state) !== low(myState)) return json(403, { ok: false, error: "Not your state." });
    const x = { id: old ? old.id : nid(t), scheme: cleanScheme(b.scheme || {}, false), by: old ? old.by : by, byKey: old ? old.byKey : app + ":" + rec.username, state: old ? old.state : myState || "HO", at: old ? old.at : t, updatedAt: t };
    x.scheme.source = null;
    await store.set(`rps:${x.id}`, x); return json(200, { ok: true, id: x.id, scheme: x.scheme });
  }
  if (b.action === "rp-scheme-delete") {
    const x = await store.get(`rps:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x) return json(200, { ok: true });
    if (!isAdmin && low(x.state) !== low(myState)) return json(403, { ok: false, error: "Not your state." });
    await store.delete(`rps:${x.id}`); return json(200, { ok: true });
  }

  // ---------- batches ----------
  if (b.action === "rp-batch-save") {   // create / replace a draft batch (calculator results or manual Excel)
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 6000).map((x) => cleanRow(x, myState)).filter((r) => r.rid);
    if (!rows.length) return json(400, { ok: false, error: "No retailer rows with a Retailer ID." });
    if (!isAdmin && rows.some((r) => low(r.state) !== low(myState))) return json(403, { ok: false, error: "You can only add payouts for " + (myState || "your state") + "." });
    const month = MONTH(b.month); if (!month) return json(400, { ok: false, error: "Choose the payout month." });
    const id0 = str(b.id, 30).replace(/[^a-z0-9]/gi, ""), old = id0 ? await store.get(`rpb:${id0}`) : null;
    if (old && old.status === "published") return json(400, { ok: false, error: "This batch is published — unpublish it first to change it." });
    if (old && !isAdmin && old.byKey !== app + ":" + rec.username) return json(403, { ok: false, error: "This draft belongs to someone else." });
    const schemes = {}; if (b.schemes && typeof b.schemes === "object") Object.keys(b.schemes).slice(0, 20).forEach((k) => { try { const s = JSON.stringify(b.schemes[k]); if (s.length < 80000) schemes[str(k, 40)] = JSON.parse(s); } catch (e) { } });
    const x = { id: old ? old.id : nid(t), title: str(b.title, 120) || "Payouts " + month, month, source: b.source === "calc" ? "calc" : "manual", status: "draft", state: isAdmin ? str(b.state, 40) || "PAN India" : myState, by, byKey: old ? old.byKey : app + ":" + rec.username, at: old ? old.at : t, updatedAt: t, schemes, rows };
    await store.set(`rpb:${x.id}`, x);
    return json(200, { ok: true, batch: pubBatch(x) });
  }
  if (b.action === "rp-batches") {
    const L = (await pool(await store.list("rpb:"), 30, (k) => store.get(k))).filter(Boolean).filter((x) => isAdmin || low(x.state) === low(myState) || x.rows.some((r) => seeState(r.state)));
    return json(200, { ok: true, items: L.sort((a, c) => (c.month || "").localeCompare(a.month || "") || c.at - a.at).map((x) => isAdmin ? pubBatch(x) : pubBatch(Object.assign({}, x, { rows: visRows(x) }))) });
  }
  if (b.action === "rp-batch-get") {
    const x = await store.get(`rpb:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x) return json(404, { ok: false, error: "Not found." });
    const rows = visRows(x); if (!isAdmin && !rows.length) return json(403, { ok: false, error: "Not your state." });
    return json(200, { ok: true, batch: Object.assign(pubBatch(Object.assign({}, x, { rows })), { rows: rows.map((r) => Object.assign({}, r, { input: undefined, items: undefined, ni: (r.items || []).length, nq: (r.items || []).reduce((a, it) => a + (it[5] ? it[2] : 0), 0) })) }) });
  }
  if (b.action === "rp-batch-delete") {
    const x = await store.get(`rpb:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x) return json(200, { ok: true });
    if (x.status === "published") return json(400, { ok: false, error: "Unpublish it first." });
    if (!isAdmin && x.byKey !== app + ":" + rec.username) return json(403, { ok: false, error: "Only the person who made this draft or HO can delete it." });
    await store.delete(`rpb:${x.id}`); return json(200, { ok: true });
  }
  if (b.action === "rp-publish" || b.action === "rp-unpublish") {   // HO only: move a batch into / out of retailer wallets
    if (!isAdmin) return json(403, { ok: false, error: "Only HO admins publish payouts." });
    const x = await store.get(`rpb:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x) return json(404, { ok: false, error: "Not found." });
    const pub = b.action === "rp-publish";
    if (pub && x.status === "published") return json(200, { ok: true, already: true });
    if (!pub && x.status !== "published") return json(200, { ok: true });
    const I = await idx(), byR = {};
    x.rows.forEach((r) => { (byR[r.rid] = byR[r.rid] || []).push(r); });
    await pool(Object.keys(byR), 20, async (rid) => {
      const rows = byR[rid], r = (await getR(rid)) || { rid, name: "", mobile: "", state: "", city: "", entries: [] };
      r.entries = (r.entries || []).filter((e) => e.batch !== x.id);   // idempotent
      if (pub) {
        const f = rows[0]; r.name = f.name || r.name; r.mobile = f.mobile || r.mobile; r.state = f.state || r.state; r.city = f.city || r.city;
        rows.forEach((row, i) => r.entries.push({ id: x.id + "-" + i, at: t, date: x.month + "-01", month: x.month, type: "cr", kind: "payout", amount: row.net, scheme: row.scheme, batch: x.id, note: x.title }));
      }
      await saveR(r, I);
    });
    x.status = pub ? "published" : "draft"; x.publishedAt = pub ? t : 0; x.publishedBy = pub ? by : "";
    await store.set(`rpb:${x.id}`, x); await store.set("rpidx", I);
    return json(200, { ok: true, batch: pubBatch(x) });
  }
  if (b.action === "rp-query") {   // flag a payout line for checking (with a note)
    const x = await store.get(`rpb:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x) return json(404, { ok: false, error: "Not found." });
    const row = x.rows[Number(b.row)]; if (!row || !seeState(row.state)) return json(404, { ok: false, error: "Not found." });
    row.query = b.clear ? null : { by, at: t, note: str(b.note, 300) || "Please check" };
    await store.set(`rpb:${x.id}`, x); return json(200, { ok: true });
  }

  // ---------- retailers ----------
  if (b.action === "rp-retailers") {
    const I = await idx(), q = low(b.q), st = str(b.state, 40);
    let L = Object.keys(I).map((rid) => Object.assign({ rid }, I[rid])).filter((x) => seeState(x.s));
    if (st) L = L.filter((x) => low(x.s) === low(st));
    if (q) L = L.filter((x) => (x.rid + " " + x.n + " " + x.c).toLowerCase().includes(q));
    const tot = L.reduce((a, x) => ({ cr: a.cr + x.cr, dr: a.dr + x.dr, bal: a.bal + x.bal }), { cr: 0, dr: 0, bal: 0 });
    const states = [...new Set(Object.values(I).filter((x) => seeState(x.s)).map((x) => x.s).filter(Boolean))].sort();
    return json(200, { ok: true, items: L.sort((a, c2) => c2.bal - a.bal).slice(0, 500), count: L.length, totals: tot, states });
  }
  if (b.action === "rp-retailer") {   // one retailer's dashboard: ledger + every payout line (published, plus drafts for staff)
    const rid = RID(b.rid), r = await getR(rid);
    const batches = (await pool(await store.list("rpb:"), 30, (k) => store.get(k))).filter(Boolean);
    const lines = [];
    batches.forEach((x) => x.rows.forEach((row, i) => { if (row.rid === rid) lines.push({ batch: x.id, row: i, title: x.title, month: x.month, status: x.status, source: x.source, scheme: row.scheme, parts: row.parts, gross: row.gross, ded: row.ded, tds: row.tds, net: row.net, info: row.info, next: row.next, remarks: row.remarks, query: row.query, verifiable: !!(row.input && row.skey && x.schemes && x.schemes[row.skey]), ni: (row.items || []).length, nq: (row.items || []).reduce((a, it) => a + (it[5] ? it[2] : 0), 0), name: row.name, state: row.state, city: row.city, mobile: row.mobile }); }));
    const st = (r && r.state) || (lines[0] && lines[0].state) || "";
    if (!r && !lines.length) return json(404, { ok: false, error: "No payouts for this retailer yet." });
    if (!seeState(st)) return json(403, { ok: false, error: "This retailer is in another state." });
    const base = r || { rid, name: lines[0].name, mobile: lines[0].mobile, state: st, city: lines[0].city, entries: [] };
    return json(200, { ok: true, retailer: { rid, name: base.name, mobile: base.mobile, state: base.state, city: base.city }, entries: (base.entries || []).sort((a, c) => (a.date || "").localeCompare(c.date || "") || a.at - c.at), summary: sum(base), lines: lines.sort((a, c) => (c.month || "").localeCompare(a.month || "")) });
  }
  if (b.action === "rp-items") {   // IMEI / model-wise report behind one payout line
    const x = await store.get(`rpb:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x) return json(404, { ok: false, error: "Not found." });
    const row = x.rows[Number(b.row)]; if (!row || !seeState(row.state)) return json(404, { ok: false, error: "Not found." });
    return json(200, { ok: true, items: row.items || [], line: { rid: row.rid, name: row.name, scheme: row.scheme, month: x.month, net: row.net, title: x.title, status: x.status } });
  }
  if (b.action === "rp-share") {   // one click: a read-only Retailer-portal link for every retailer in a batch (reuses active links)
    const x = await store.get(`rpb:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x) return json(404, { ok: false, error: "Not found." });
    if (x.status !== "published") return json(400, { ok: false, error: "Publish the batch first — retailers only see published payouts." });
    const days = Math.max(7, Math.min(90, Number(b.days) || 30)), byR = {};
    visRows(x).forEach((r) => { const o = byR[r.rid] || (byR[r.rid] = { rid: r.rid, name: r.name, mobile: r.mobile, state: r.state, net: 0, items: 0, schemes: [] }); o.net += r.net; o.items += (r.items || []).length; if (!o.schemes.includes(r.scheme)) o.schemes.push(r.scheme); });
    const active = {}; for (const k of await store.list("rtplink:")) { const L = await store.get(k); if (L && byR[L.rid] && !L.revoked && L.exp > t + 5 * 864e5) active[L.rid] = k.slice(8); }
    const { randomBytes } = await import("node:crypto");
    const out = await pool(Object.values(byR), 20, async (o) => { let k = active[o.rid]; if (!k) { k = randomBytes(16).toString("hex"); await store.set(`rtplink:${k}`, { rid: o.rid, at: t, by, exp: t + days * 864e5, via: "payout-batch" }); } return Object.assign(o, { net: Math.round(o.net * 100) / 100, k }); });
    return json(200, { ok: true, items: out, month: x.month, title: x.title });
  }
  if (b.action === "rp-verify") {   // the exact rules + the retailer's numbers, so the page can re-run the payout engine
    const x = await store.get(`rpb:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x) return json(404, { ok: false, error: "Not found." });
    const row = x.rows[Number(b.row)]; if (!row || !seeState(row.state)) return json(404, { ok: false, error: "Not found." });
    return json(200, { ok: true, scheme: row.skey && x.schemes ? x.schemes[row.skey] || null : null, input: row.input || null, row: Object.assign({}, row, { input: undefined }) });
  }

  // ---------- vouchers / services ----------
  if (b.action === "rp-vouchers") {
    const c = (await store.get("rpv:cat")) || { items: [] };
    const items = await pool(c.items.filter((x) => isAdmin || x.active !== false), 20, async (x) => Object.assign({}, x, { left: x.mode === "code" ? ((await store.get(`rpv:codes:${x.id}`)) || { codes: [] }).codes.length : null }));
    return json(200, { ok: true, items, cats: VCATS });
  }
  if (b.action === "rp-buy") {   // instant purchase from a retailer's balance — no approval
    const rid = RID(b.rid), r = await getR(rid); if (!r) return json(404, { ok: false, error: "This retailer has no balance yet." });
    if (!seeState(r.state)) return json(403, { ok: false, error: "This retailer is in another state." });
    const c = (await store.get("rpv:cat")) || { items: [] }, it = c.items.find((x) => x.id === str(b.item, 30));
    if (!it || it.active === false) return json(404, { ok: false, error: "This voucher isn't available." });
    const qty = Math.max(1, Math.min(10, Math.floor(Number(b.qty) || 1))), cost = Math.round(it.price * qty * 100) / 100, bal = sum(r).bal;
    if (cost > bal + 0.001) return json(400, { ok: false, error: "Not enough balance (₹" + bal.toLocaleString("en-IN") + " available)." });
    let codes = [];
    if (it.mode === "code") {
      const pool2 = (await store.get(`rpv:codes:${it.id}`)) || { codes: [] };
      if (pool2.codes.length < qty) return json(400, { ok: false, error: pool2.codes.length ? "Only " + pool2.codes.length + " left." : "Out of stock — HO will add more codes." });
      codes = pool2.codes.splice(0, qty); await store.set(`rpv:codes:${it.id}`, pool2);
    }
    const e = { id: nid(t), at: t, date: new Date(t + 19800000).toISOString().slice(0, 10), month: new Date(t + 19800000).toISOString().slice(0, 7), type: "dr", kind: "voucher", amount: cost, item: it.name, qty, code: codes.join(", "), link: it.mode === "link" ? it.link : "", howTo: it.howTo || "", validity: it.validity || "", note: "Bought by " + by, by };
    r.entries.push(e); const I = await idx(); await saveR(r, I); await store.set("rpidx", I);
    return json(200, { ok: true, entry: e, balance: I[rid].bal });
  }

  // ---------- HO only ----------
  if (!isAdmin) return json(403, { ok: false, error: "Only HO admins can do this." });
  if (b.action === "rp-voucher-save") {
    const c = (await store.get("rpv:cat")) || { items: [] }, x = b.item || {};
    const it = { id: str(x.id, 30).replace(/[^a-z0-9]/gi, "") || nid(t), name: str(x.name, 80), cat: VCATS[x.cat] ? x.cat : "other", provider: str(x.provider, 60), value: money(x.value), price: money(x.price || x.value), mode: x.mode === "link" ? "link" : "code",
      link: /^https:\/\/[^\s"'<>]{4,500}$/i.test(String(x.link || "")) ? String(x.link) : "", howTo: str(x.howTo, 400), validity: str(x.validity, 60), active: x.active !== false, by, at: t };
    if (!it.name || !(it.price > 0)) return json(400, { ok: false, error: "Add a name and a price (₹)." });
    if (it.mode === "link" && !it.link) return json(400, { ok: false, error: "Add the https:// link for this service." });
    const i = c.items.findIndex((y) => y.id === it.id); if (i >= 0) c.items[i] = it; else c.items.push(it);
    await store.set("rpv:cat", c);
    if (Array.isArray(b.codes) && b.codes.length) { const p = (await store.get(`rpv:codes:${it.id}`)) || { codes: [] }; const seen = new Set(p.codes); b.codes.map((z) => str(z, 120)).filter((z) => z && !seen.has(z)).slice(0, 5000).forEach((z) => { seen.add(z); p.codes.push(z); }); await store.set(`rpv:codes:${it.id}`, p); }
    return json(200, { ok: true, item: it });
  }
  if (b.action === "rp-voucher-delete") { const c = (await store.get("rpv:cat")) || { items: [] }; const id = str(b.id, 30); c.items = c.items.filter((x) => x.id !== id); await store.set("rpv:cat", c); await store.delete(`rpv:codes:${id}`); return json(200, { ok: true }); }
  if (b.action === "rp-payments") {   // amounts already paid to retailers (bank / UPI / credit note) → debit entries
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 6000); if (!rows.length) return json(400, { ok: false, error: "No rows." });
    const I = await idx(), byR = {}; let n = 0, skipped = 0;
    rows.forEach((x) => { const rid = RID(x.rid), amt = Math.abs(money(x.amount)); if (!rid || !amt) { skipped++; return; } (byR[rid] = byR[rid] || []).push(x); });
    await pool(Object.keys(byR), 20, async (rid) => {
      const r = (await getR(rid)) || { rid, name: str(byR[rid][0].name, 80), mobile: "", state: str(byR[rid][0].state, 40), city: "", entries: [] };
      byR[rid].forEach((x) => {
        const ref = str(x.ref, 60), date = /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || "")) ? x.date : new Date(t + 19800000).toISOString().slice(0, 10);
        if (ref && r.entries.some((e) => e.kind !== "voucher" && e.type === "dr" && e.ref === ref)) { skipped++; return; }   // same reference already loaded
        r.entries.push({ id: nid(t) + n, at: t, date, month: date.slice(0, 7), type: "dr", kind: /credit/i.test(x.mode) ? "creditnote" : "bank", amount: Math.abs(money(x.amount)), ref, note: str(x.mode, 30) + (x.remarks ? " · " + str(x.remarks, 120) : ""), by }); n++;
      });
      await saveR(r, I);
    });
    await store.set("rpidx", I);
    return json(200, { ok: true, added: n, skipped });
  }
  if (b.action === "rp-entry-delete") {   // undo a wrong payment / adjustment line
    const rid = RID(b.rid), r = await getR(rid); if (!r) return json(404, { ok: false, error: "Not found." });
    const e = r.entries.find((y) => y.id === str(b.entry, 40)); if (!e) return json(404, { ok: false, error: "Not found." });
    if (e.kind === "payout") return json(400, { ok: false, error: "Payout lines come from a batch — unpublish the batch instead." });
    if (e.kind === "voucher" && e.code) return json(400, { ok: false, error: "A voucher code was already issued — add an adjustment instead." });
    r.entries = r.entries.filter((y) => y.id !== e.id); const I = await idx(); await saveR(r, I); await store.set("rpidx", I); return json(200, { ok: true });
  }
  if (b.action === "rp-adjust") {   // manual credit / debit with a reason
    const rid = RID(b.rid), amt = money(b.amount); if (!rid || !amt) return json(400, { ok: false, error: "Retailer and amount needed." });
    const r = (await getR(rid)) || { rid, name: str(b.name, 80), mobile: "", state: str(b.state, 40), city: "", entries: [] };
    const date = new Date(t + 19800000).toISOString().slice(0, 10);
    r.entries.push({ id: nid(t), at: t, date, month: date.slice(0, 7), type: amt > 0 ? "cr" : "dr", kind: "adjust", amount: Math.abs(amt), note: str(b.note, 200) || "Adjustment", by });
    const I = await idx(); await saveR(r, I); await store.set("rpidx", I); return json(200, { ok: true });
  }
  return json(400, { ok: false, error: "Unknown action." });
}
