// Branding & fixtures material management — one place for every store's branding, fixtures, signage and POSM, PAN India.
// Order → approve → PO → dispatch (logistics) → receive (GRN → state stock) → install at store (store asset + photos)
// → repairs → virtual audits (photos per asset, HO review; issues become repair requests).
// Stores come from the Store locator directory (store:<id>), so there's one store master.
//   bm:items {list}   bm:vendors {list}   bm:cfg {limit, budget:{state:₹}}   bm:seq {n}
//   bm:ord:<id>  + bm:oidx {id: summary}          orders (HO- or state-vendor sourced)
//   bm:stk {state: {item: qty}}  bm:mov:<yyyymm> {list}   state warehouse stock + movement log
//   bm:ast:<storeId> {list}  + bm:sidx {storeId: summary}   material installed at each store
//   bm:rep:<id> + bm:ridx      repair requests          bm:aud:<id> (+ bm:aus:<id>:<storeId>) + bm:aidx   virtual audits
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const num = (v, lo, hi) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
const r2 = (n) => Math.round(n * 100) / 100;
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const sid = (v) => String(v || "").replace(/[^a-z0-9]/gi, "").slice(0, 30);
export const BM_CATS = ["In-shop branding", "Out-shop branding / signage", "Fixtures & counters", "Display & demo units", "POSM & promotional", "Furniture", "Lighting & electricals", "Other"];
const CONDS = ["Good", "Needs repair", "Damaged", "Missing", "Removed"];
const OST = { requested: "Requested", approved: "Approved", rejected: "Rejected", po: "PO raised", dispatched: "In transit", received: "Received", closed: "Closed", cancelled: "Cancelled" };
const RST = { open: "Open", assigned: "Vendor assigned", progress: "In progress", resolved: "Resolved", closed: "Closed" };
const ym = (t) => { const d = new Date(t + 5.5 * 36e5); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; };
const photos = (L) => (Array.isArray(L) ? L : []).map((u) => String(u || "")).filter((u) => /^\/api\/auth\?img=[a-z0-9]+$/i.test(u)).slice(0, 12);

export async function bmAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "";
  const myState = isHO ? "" : str(rec.state, 60);
  const see = (s) => isHO || low(s) === low(myState);
  const stOf = (s) => (isHO ? str(s, 60) : myState);   // states can only act for their own state
  const get = async (k, d) => (await store.get(k)) || d;
  const items = async () => (await get("bm:items", { list: [] })).list;
  const cfg = async () => Object.assign({ limit: 50000, budget: {} }, await get("bm:cfg", {}));
  const itemMap = async () => { const M = {}; (await items()).forEach((x) => { M[x.id] = x; }); return M; };
  const stores = async () => (await pool((await store.list("store:")).slice(0, 5000), 60, (k) => store.get(k))).filter(Boolean).map((s) => ({ id: s.id, name: s.name, type: s.type, city: s.city, state: s.state, address: s.address, phone: s.phone }));
  const tl = (x, st, note) => { x.tl = (x.tl || []).concat([{ at: t, by, st, note: str(note, 300) }]).slice(-40); };
  const sumO = (o) => ({ id: o.id, no: o.no, state: o.state, store: o.store || "", storeName: o.storeName || "", src: o.src, vendor: o.vendorName || "", status: o.status, total: o.total, n: o.lines.length, qty: o.lines.reduce((a, l) => a + l.qty, 0), at: o.at, by: o.by, upd: t, eta: (o.ship && o.ship.eta) || "", docket: (o.ship && o.ship.docket) || "" });
  const saveO = async (o) => { await store.set(`bm:ord:${o.id}`, o); const I = await get("bm:oidx", {}); I[o.id] = sumO(o); await store.set("bm:oidx", I); };
  const stock = async () => get("bm:stk", {});
  const moveLog = async (m) => { const k = `bm:mov:${ym(t)}`, L = await get(k, { list: [] }); L.list.push(Object.assign({ at: t, by }, m)); if (L.list.length > 4000) L.list = L.list.slice(-4000); await store.set(k, L); };
  const addStock = async (state, item, qty) => { const S = await stock(); S[state] = S[state] || {}; S[state][item] = r2((S[state][item] || 0) + qty); await store.set("bm:stk", S); return S[state][item]; };
  const assets = async (sidv) => get(`bm:ast:${sid(sidv)}`, { list: [] });
  const sumS = async (storeId, A, extra) => { const IM = await itemMap(), I = await get("bm:sidx", {}), L = A.list.filter((a) => a.cond !== "Removed"), o = Object.assign(I[storeId] || {}, extra || {});
    o.n = L.length; o.qty = L.reduce((x, a) => x + a.qty, 0); o.val = r2(L.reduce((x, a) => x + a.qty * (a.price || (IM[a.item] || {}).price || 0), 0)); o.issues = L.filter((a) => a.cond === "Needs repair" || a.cond === "Damaged" || a.cond === "Missing").length; o.state = o.state || A.state || ""; o.upd = t;
    I[storeId] = o; await store.set("bm:sidx", I); return o; };
  const saveA = async (storeId, A, extra) => { await store.set(`bm:ast:${storeId}`, A); return sumS(storeId, A, extra); };
  const findStore = async (id) => { const s = await store.get(`store:${sid(id)}`); return s ? { id: s.id, name: s.name, state: s.state, city: s.city, type: s.type, address: s.address } : null; };

  // ---------- setup ----------
  if (b.action === "bm-boot") {
    const [L, V, C, S] = await Promise.all([items(), get("bm:vendors", { list: [] }), cfg(), stores()]);
    const states = [...new Set(S.map((s) => s.state).filter(Boolean))].sort();
    return json(200, { ok: true, me: { isHO, state: myState, name: by }, cats: BM_CATS, conds: CONDS, ost: OST, rst: RST, items: L.filter((x) => isHO || x.src === "HO" || see(x.state)), vendors: V.list.filter((x) => isHO || x.type === "HO" || see(x.state)), cfg: { limit: C.limit, budget: isHO ? C.budget : { [myState]: C.budget[myState] || 0 } }, states: isHO ? states : [myState], storeCount: S.filter((s) => see(s.state)).length });
  }
  if (b.action === "bm-photo") {   // compressed on the phone first; served like banner pictures (unguessable id)
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ""));
    if (!m) return json(400, { ok: false, error: "Choose a JPG, PNG or WebP picture." });
    if (m[2].length > 2200000) return json(413, { ok: false, error: "The picture is too large (max about 1.5 MB)." });
    const id = nid(t) + randomBytes(5).toString("hex"); await store.set(`pubimg:${id}`, { mime: m[1], b64: m[2], at: t, by, bm: 1 });
    return json(200, { ok: true, url: "/api/auth?img=" + id });
  }
  if (b.action === "bm-item-save") {
    const D = await get("bm:items", { list: [] }), x = b.item || {}, id = sid(x.id) || nid(t), old = D.list.find((i) => i.id === id);
    const src = isHO ? (x.src === "State" ? "State" : "HO") : "State", state = src === "State" ? stOf(x.state) : "";
    if (old && !isHO && (old.src !== "State" || !see(old.state))) return json(403, { ok: false, error: "Only HO can change HO catalogue items." });
    const it = { id, name: str(x.name, 100), code: str(x.code, 30), cat: BM_CATS.includes(x.cat) ? x.cat : "Other", unit: str(x.unit, 20) || "pc", size: str(x.size, 60), spec: str(x.spec, 300), price: r2(num(x.price, 0, 1e8)), src, state, img: photos([x.img])[0] || "", life: num(x.life, 0, 120), active: x.active !== false, by, at: t };
    if (!it.name) return json(400, { ok: false, error: "Give the item a name." });
    D.list = D.list.filter((i) => i.id !== id).concat([it]); await store.set("bm:items", D); return json(200, { ok: true, item: it });
  }
  if (b.action === "bm-item-del") { const D = await get("bm:items", { list: [] }), x = D.list.find((i) => i.id === sid(b.id)); if (!x) return json(404, { ok: false, error: "Not found." }); if (!isHO && (x.src !== "State" || !see(x.state))) return json(403, { ok: false, error: "HO only." }); x.active = false; await store.set("bm:items", D); return json(200, { ok: true }); }
  if (b.action === "bm-item-import") {   // HO / state: catalogue from Excel
    const D = await get("bm:items", { list: [] }); let n = 0;
    for (const x of (b.rows || []).slice(0, 1000)) { const name = str(x.name, 100); if (!name) continue; const ex = D.list.find((i) => low(i.name) === low(name) || (x.code && low(i.code) === low(x.code))); if (ex && !isHO && ex.src !== "State") continue;
      const it = Object.assign(ex || { id: nid(t) + n, src: isHO ? (low(x.src) === "state" ? "State" : "HO") : "State" }, { name, code: str(x.code, 30) || (ex && ex.code) || "", cat: BM_CATS.find((c) => low(c) === low(x.cat)) || (ex && ex.cat) || "Other", unit: str(x.unit, 20) || "pc", size: str(x.size, 60), spec: str(x.spec, 300), price: r2(num(x.price, 0, 1e8)), active: true, by, at: t });
      if (it.src === "State") it.state = stOf(x.state || (ex && ex.state)); if (!ex) D.list.push(it); n++; }
    await store.set("bm:items", D); return json(200, { ok: true, n });
  }
  if (b.action === "bm-vendor-save") {
    const D = await get("bm:vendors", { list: [] }), x = b.vendor || {}, id = sid(x.id) || nid(t), old = D.list.find((v) => v.id === id);
    if (old && !isHO && (old.type !== "State" || !see(old.state))) return json(403, { ok: false, error: "Only HO can change HO vendors." });
    const v = { id, name: str(x.name, 100), type: isHO && x.type !== "State" ? "HO" : "State", state: isHO && x.type !== "State" ? "" : stOf(x.state), contact: str(x.contact, 80), phone: str(x.phone, 20), email: str(x.email, 100), gst: str(x.gst, 20), services: str(x.services, 200), active: x.active !== false, by, at: t };
    if (!v.name) return json(400, { ok: false, error: "Give the vendor a name." });
    D.list = D.list.filter((i) => i.id !== id).concat([v]); await store.set("bm:vendors", D); return json(200, { ok: true, vendor: v });
  }
  if (b.action === "bm-cfg-save") {
    if (!isHO) return json(403, { ok: false, error: "HO only." });
    const C = await cfg(); C.limit = num(b.limit, 0, 1e9); if (b.budget && typeof b.budget === "object") { C.budget = {}; Object.keys(b.budget).slice(0, 60).forEach((s) => { const v = num(b.budget[s], 0, 1e10); if (v) C.budget[str(s, 60)] = v; }); }
    C.by = by; C.at = t; await store.set("bm:cfg", C); return json(200, { ok: true });
  }

  // ---------- stores (from the Store locator) ----------
  if (b.action === "bm-stores") {
    const [S, I, aud] = await Promise.all([stores(), get("bm:sidx", {}), get("bm:aidx", {})]);
    const q = low(b.q), st = isHO ? str(b.state, 60) : myState;
    const L = S.filter((s) => see(s.state) && (!st || low(s.state) === low(st)) && (!q || low(s.name + " " + s.city + " " + s.id).includes(q)) && (!b.type || s.type === b.type)).map((s) => Object.assign(s, { bm: I[s.id] || null }));
    if (b.only === "branded") return json(200, { ok: true, stores: L.filter((s) => s.bm && s.bm.n).slice(0, 3000) });
    if (b.only === "issues") return json(200, { ok: true, stores: L.filter((s) => s.bm && s.bm.issues).slice(0, 3000) });
    return json(200, { ok: true, stores: L.slice(0, 3000), audits: Object.keys(aud).length });
  }
  if (b.action === "bm-store-add") {   // add a store to the shared directory (states: own state only)
    const x = b.store || {}, name = str(x.name, 80); if (!name) return json(400, { ok: false, error: "Store name is needed." });
    const s = { id: sid(x.id) || nid(t), name, type: ["exclusive", "authorized", "general", "reliance", "croma", "vijaysales", "service"].includes(x.type) ? x.type : "exclusive", address: str(x.address, 300), city: str(x.city, 60), state: stOf(x.state), pincode: str(x.pincode, 12), lat: null, lng: null, phone: str(x.phone, 20), hours: "", by, at: t };
    if (!s.state) return json(400, { ok: false, error: "Pick the state." });
    if (await store.get(`store:${s.id}`)) return json(400, { ok: false, error: "A store with this code already exists." });
    await store.set(`store:${s.id}`, s); return json(200, { ok: true, store: s });
  }
  if (b.action === "bm-store-get") {
    const s = await findStore(b.id); if (!s || !see(s.state)) return json(404, { ok: false, error: "Store not found." });
    const [A, IM, oi, ri, ai] = await Promise.all([assets(s.id), itemMap(), get("bm:oidx", {}), get("bm:ridx", {}), get("bm:aidx", {})]);
    const list = A.list.map((a) => Object.assign({}, a, { itemName: (IM[a.item] || {}).name || a.itemName || "Item", cat: (IM[a.item] || {}).cat || "", price: a.price || (IM[a.item] || {}).price || 0 }));
    return json(200, { ok: true, store: s, assets: list, orders: Object.values(oi).filter((o) => o.store === s.id).sort((x, y) => y.at - x.at).slice(0, 30), repairs: Object.values(ri).filter((r) => r.store === s.id).sort((x, y) => y.at - x.at).slice(0, 30), audits: Object.values(ai).filter((a) => (a.stores || []).includes(s.id)).sort((x, y) => y.at - x.at).slice(0, 10) });
  }
  if (b.action === "bm-asset-save") {   // edit one installed asset (condition, photos, remove) or add one directly (existing material already at the store)
    const s = await findStore(b.store); if (!s || !see(s.state)) return json(404, { ok: false, error: "Store not found." });
    const A = await assets(s.id), x = b.asset || {}, IM = await itemMap(); A.state = s.state;
    let a = x.id && A.list.find((y) => y.id === x.id);
    if (!a) { if (!IM[x.item]) return json(400, { ok: false, error: "Pick an item from the catalogue." }); a = { id: nid(t), item: x.item, itemName: IM[x.item].name, qty: num(x.qty, 1, 1e5), price: IM[x.item].price, installedAt: str(x.installedAt, 10) || new Date(t).toISOString().slice(0, 10), src: "existing", photos: [], cond: "Good", by, at: t }; A.list.push(a); }
    if (x.cond && CONDS.includes(x.cond)) a.cond = x.cond; if (x.qty != null) a.qty = num(x.qty, 0, 1e5); if (x.note != null) a.note = str(x.note, 300); if (x.size != null) a.size = str(x.size, 60); if (x.loc != null) a.loc = str(x.loc, 80);
    if (Array.isArray(x.photos)) a.photos = photos(x.photos.concat(a.photos || [])).slice(0, 12);
    a.upd = t; a.updBy = by; await saveA(s.id, A, { state: s.state }); return json(200, { ok: true, asset: a });
  }
  if (b.action === "bm-asset-import") {   // existing installed base from Excel (e.g. from vWork): store code, item, qty, installed, condition
    const IM = await itemMap(), names = {}; Object.values(IM).forEach((i) => { names[low(i.name)] = i; if (i.code) names[low(i.code)] = i; });
    const by_s = {}, bad = []; let n = 0;
    for (const x of (b.rows || []).slice(0, 5000)) { const it = names[low(x.item)]; if (!it) { bad.push("Item not in catalogue: " + str(x.item, 40)); continue; } (by_s[sid(x.store)] = by_s[sid(x.store)] || []).push({ x, it }); }
    for (const k of Object.keys(by_s)) { const s = await findStore(k); if (!s || !see(s.state)) { bad.push("Store not found: " + k); continue; } const A = await assets(k); A.state = s.state;
      by_s[k].forEach(({ x, it }) => { A.list.push({ id: nid(t) + n, item: it.id, itemName: it.name, qty: num(x.qty, 1, 1e5), price: it.price, installedAt: str(x.installed, 10), cond: CONDS.find((c) => low(c) === low(x.cond)) || "Good", src: "import", photos: photos(String(x.photos || "").split(/[\s,]+/)), note: str(x.note, 200), by, at: t }); n++; });
      await saveA(k, A, { state: s.state }); }
    return json(200, { ok: true, n, bad: bad.slice(0, 30) });
  }

  // ---------- orders: request → approve → PO → dispatch → receive (stock in) → close ----------
  if (b.action === "bm-ord-list") {
    const I = await get("bm:oidx", {}), st = isHO ? str(b.state, 60) : myState;
    const L = Object.values(I).filter((o) => see(o.state) && (!st || low(o.state) === low(st)) && (!b.status || o.status === b.status || (b.status === "open" && !["closed", "cancelled", "rejected"].includes(o.status)))).sort((x, y) => y.at - x.at);
    return json(200, { ok: true, orders: L.slice(0, 1500) });
  }
  if (b.action === "bm-ord-get") { const o = await store.get(`bm:ord:${sid(b.id)}`); if (!o || !see(o.state)) return json(404, { ok: false, error: "Not found." }); return json(200, { ok: true, order: o }); }
  if (b.action === "bm-ord-save") {   // new request (or edit while still "requested")
    const x = b.order || {}, IM = await itemMap(), V = (await get("bm:vendors", { list: [] })).list, C = await cfg();
    let o = x.id ? await store.get(`bm:ord:${sid(x.id)}`) : null;
    if (o && (o.status !== "requested" || !see(o.state))) return json(400, { ok: false, error: "Only requests that aren't approved yet can be edited." });
    const lines = (x.lines || []).slice(0, 60).map((l) => { const it = IM[l.item]; return it ? { item: it.id, name: it.name, unit: it.unit, qty: num(l.qty, 1, 1e6), price: r2(num(l.price == null || l.price === "" ? it.price : l.price, 0, 1e8)) } : null; }).filter(Boolean);
    if (!lines.length) return json(400, { ok: false, error: "Add at least one item." });
    lines.forEach((l) => { l.amount = r2(l.qty * l.price); });
    const state = stOf(x.state || (o && o.state)); if (!state) return json(400, { ok: false, error: "Pick the state." });
    const s = x.store ? await findStore(x.store) : null; if (x.store && (!s || low(s.state) !== low(state))) return json(400, { ok: false, error: "That store isn't in " + state + "." });
    const src = x.src === "State" ? "State" : "HO", ven = V.find((v) => v.id === x.vendor);
    if (!o) { const Q = await get("bm:seq", { n: 0 }); Q.n++; await store.set("bm:seq", Q); o = { id: nid(t), no: "BM-" + String(ym(t)).slice(2) + "-" + String(Q.n).padStart(4, "0"), at: t, by, byApp: app, status: "requested", tl: [] }; tl(o, "requested", x.note || "Request raised"); }
    Object.assign(o, { state, store: s ? s.id : "", storeName: s ? s.name : "", src, vendor: ven ? ven.id : "", vendorName: ven ? ven.name : "", lines, total: r2(lines.reduce((a, l) => a + l.amount, 0)), purpose: str(x.purpose, 200), need: str(x.need, 10), note: str(x.note, 500), photos: photos(x.photos) });
    // state-vendor purchases within the HO limit are approved by the state itself
    if (o.status === "requested" && src === "State" && !isHO && o.total <= C.limit) { o.status = "approved"; tl(o, "approved", "Auto-approved: state purchase within the ₹" + C.limit.toLocaleString("en-IN") + " limit"); }
    await saveO(o); return json(200, { ok: true, order: o });
  }
  if (b.action === "bm-ord-act") {
    const o = await store.get(`bm:ord:${sid(b.id)}`); if (!o || !see(o.state)) return json(404, { ok: false, error: "Not found." });
    const a = b.act, d = b.data || {}, C = await cfg(), mineSrc = o.src === "State";
    const canHO = isHO, canState = !isHO && mineSrc;   // HO handles HO-supplied orders; the state handles its own vendor purchases
    if (a === "approve" || a === "reject") { if (o.status !== "requested") return json(400, { ok: false, error: "Already " + OST[o.status] + "." }); if (!(isHO || (mineSrc && o.total <= C.limit))) return json(403, { ok: false, error: "HO approves this request." }); o.status = a === "approve" ? "approved" : "rejected"; tl(o, o.status, d.note); }
    else if (a === "po") { if (o.status !== "approved") return json(400, { ok: false, error: "Approve the request first." }); if (!(canHO || canState)) return json(403, { ok: false, error: "HO raises the PO for HO-supplied material." }); o.po = { no: str(d.no, 40), date: str(d.date, 10), vendor: str(d.vendor, 100) || o.vendorName, amount: r2(num(d.amount || o.total, 0, 1e9)), note: str(d.note, 300) }; if (!o.po.no) return json(400, { ok: false, error: "Enter the PO number." }); o.status = "po"; tl(o, "po", "PO " + o.po.no); }
    else if (a === "dispatch") { if (!["po", "approved"].includes(o.status)) return json(400, { ok: false, error: "Raise the PO first." }); if (!(canHO || canState)) return json(403, { ok: false, error: "HO updates dispatch for HO-supplied material." }); o.ship = { mode: str(d.mode, 30) || "Road", transporter: str(d.transporter, 80), docket: str(d.docket, 40), date: str(d.date, 10), eta: str(d.eta, 10), freight: r2(num(d.freight, 0, 1e8)), link: /^https?:\/\//.test(String(d.link || "")) ? str(d.link, 300) : "", note: str(d.note, 300) }; o.status = "dispatched"; tl(o, "dispatched", [o.ship.transporter, o.ship.docket].filter(Boolean).join(" · ")); }
    else if (a === "receive") {   // GRN at the state warehouse / store: received + damaged per line → stock in
      if (!["dispatched", "po", "approved"].includes(o.status)) return json(400, { ok: false, error: "Nothing to receive." });
      const R = Array.isArray(d.lines) ? d.lines : []; o.grn = { date: str(d.date, 10) || new Date(t).toISOString().slice(0, 10), note: str(d.note, 300), photos: photos(d.photos), by, lines: o.lines.map((l, i) => { const q = R[i] || {}; const rq = num(q.rq == null ? l.qty : q.rq, 0, 1e6), dmg = num(q.dmg, 0, rq); return { item: l.item, name: l.name, rq, dmg }; }) };
      for (const g of o.grn.lines) { const good = g.rq - g.dmg; if (good > 0) { await addStock(o.state, g.item, good); await moveLog({ type: "in", state: o.state, item: g.item, name: g.name, qty: good, ref: o.no, note: "GRN" }); } if (g.dmg) await moveLog({ type: "damaged", state: o.state, item: g.item, name: g.name, qty: g.dmg, ref: o.no, note: "Damaged on arrival" }); }
      o.status = "received"; tl(o, "received", o.grn.lines.reduce((a2, g) => a2 + g.rq, 0) + " received" + (o.grn.lines.some((g) => g.dmg) ? ", " + o.grn.lines.reduce((a2, g) => a2 + g.dmg, 0) + " damaged" : ""));
    }
    else if (a === "close") { if (o.status !== "received") return json(400, { ok: false, error: "Receive it first." }); o.status = "closed"; tl(o, "closed", d.note); }
    else if (a === "cancel") { if (["received", "closed"].includes(o.status)) return json(400, { ok: false, error: "Already received." }); if (!isHO && o.by !== by) return json(403, { ok: false, error: "Only HO or the requester can cancel." }); o.status = "cancelled"; tl(o, "cancelled", d.note); }
    else if (a === "note") tl(o, o.status, d.note);
    else return json(400, { ok: false, error: "Unknown step." });
    await saveO(o); return json(200, { ok: true, order: o });
  }

  // ---------- stock: in / out to a store (install) / transfer / adjust ----------
  if (b.action === "bm-stock") {
    const [S, IM] = await Promise.all([stock(), itemMap()]), st = isHO ? str(b.state, 60) : myState, rows = [];
    Object.keys(S).filter((s) => see(s) && (!st || low(s) === low(st))).forEach((s) => Object.keys(S[s]).forEach((i) => { if (!S[s][i]) return; const it = IM[i] || {}; rows.push({ state: s, item: i, name: it.name || "Item", cat: it.cat || "", unit: it.unit || "pc", qty: S[s][i], val: r2(S[s][i] * (it.price || 0)) }); }));
    const mv = []; for (let k = 0; k < 3; k++) { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() - k); const L = await get(`bm:mov:${d.getUTCFullYear() * 100 + d.getUTCMonth() + 1}`, { list: [] }); mv.push(...L.list.filter((m) => see(m.state) && (!st || low(m.state) === low(st)))); }
    return json(200, { ok: true, rows, moves: mv.sort((x, y) => y.at - x.at).slice(0, 300) });
  }
  if (b.action === "bm-move") {
    const type = b.type, IM = await itemMap(), it = IM[b.item], qty = num(b.qty, 0, 1e6), state = stOf(b.state); if (!it || !qty) return json(400, { ok: false, error: "Pick an item and quantity." }); if (!state) return json(400, { ok: false, error: "Pick the state." });
    const S = await stock(), have = ((S[state] || {})[it.id]) || 0;
    if (type === "in") { await addStock(state, it.id, qty); await moveLog({ type: "in", state, item: it.id, name: it.name, qty, ref: str(b.ref, 60), note: str(b.note, 200) || "Manual stock in" }); }
    else if (type === "adjust") { const nq = num(b.newQty, 0, 1e6); await addStock(state, it.id, nq - have); await moveLog({ type: "adjust", state, item: it.id, name: it.name, qty: r2(nq - have), note: str(b.note, 200) || "Stock count correction" }); }
    else if (type === "transfer") { if (!isHO) return json(403, { ok: false, error: "HO moves stock between states." }); const to = str(b.toState, 60); if (!to || low(to) === low(state)) return json(400, { ok: false, error: "Pick another state." }); if (qty > have) return json(400, { ok: false, error: "Only " + have + " in stock." }); await addStock(state, it.id, -qty); await addStock(to, it.id, qty); await moveLog({ type: "transfer", state, to, item: it.id, name: it.name, qty, note: str(b.note, 200) }); }
    else if (type === "out") {   // install at a store → becomes that store's asset
      const s = await findStore(b.store); if (!s || low(s.state) !== low(state)) return json(400, { ok: false, error: "Pick a store in " + state + "." });
      if (qty > have) return json(400, { ok: false, error: "Only " + have + " " + it.unit + " in " + state + " stock." });
      await addStock(state, it.id, -qty); const A = await assets(s.id); A.state = s.state;
      const a = { id: nid(t), item: it.id, itemName: it.name, qty, price: it.price, installedAt: str(b.date, 10) || new Date(t).toISOString().slice(0, 10), src: "stock", cond: "Good", photos: photos(b.photos), loc: str(b.loc, 80), note: str(b.note, 200), by, at: t };
      A.list.push(a); await saveA(s.id, A, { state: s.state }); await moveLog({ type: "out", state, item: it.id, name: it.name, qty, store: s.id, storeName: s.name, note: str(b.note, 200) || "Installed at store" });
      return json(200, { ok: true, asset: a });
    }
    else return json(400, { ok: false, error: "Unknown movement." });
    return json(200, { ok: true });
  }

  // ---------- repairs ----------
  const sumR = (r) => ({ id: r.id, no: r.no, store: r.store, storeName: r.storeName, state: r.state, asset: r.asset, itemName: r.itemName, issue: r.issue, prio: r.prio, status: r.status, vendor: r.vendorName || "", cost: r.cost || 0, at: r.at, by: r.by, upd: t });
  const saveR = async (r) => { await store.set(`bm:rep:${r.id}`, r); const I = await get("bm:ridx", {}); I[r.id] = sumR(r); await store.set("bm:ridx", I); };
  const setCond = async (storeId, assetId, cond) => { const A = await assets(storeId), a = A.list.find((x) => x.id === assetId); if (a) { a.cond = cond; a.upd = t; await saveA(storeId, A); } };
  const newRepair = async (s, a, issue, prio, ph, from) => { const Q = await get("bm:rseq", { n: 0 }); Q.n++; await store.set("bm:rseq", Q);
    const r = { id: nid(t), no: "RP-" + String(ym(t)).slice(2) + "-" + String(Q.n).padStart(4, "0"), store: s.id, storeName: s.name, state: s.state, asset: a ? a.id : "", itemName: a ? a.itemName : "", issue: str(issue, 400), prio: ["High", "Medium", "Low"].includes(prio) ? prio : "Medium", photos: photos(ph), status: "open", from: from || "manual", by, at: t, tl: [] }; tl(r, "open", from === "audit" ? "From virtual audit" : "Repair requested");
    await saveR(r); if (a) await setCond(s.id, a.id, "Needs repair"); return r; };
  if (b.action === "bm-rep-list") { const I = await get("bm:ridx", {}), st = isHO ? str(b.state, 60) : myState; return json(200, { ok: true, repairs: Object.values(I).filter((r) => see(r.state) && (!st || low(r.state) === low(st)) && (!b.status || r.status === b.status || (b.status === "open" && !["resolved", "closed"].includes(r.status)))).sort((x, y) => y.at - x.at).slice(0, 1500) }); }
  if (b.action === "bm-rep-get") { const r = await store.get(`bm:rep:${sid(b.id)}`); if (!r || !see(r.state)) return json(404, { ok: false, error: "Not found." }); return json(200, { ok: true, repair: r }); }
  if (b.action === "bm-rep-save") { const s = await findStore(b.store); if (!s || !see(s.state)) return json(404, { ok: false, error: "Store not found." }); const A = await assets(s.id), a = A.list.find((x) => x.id === b.asset); if (!str(b.issue, 10)) return json(400, { ok: false, error: "Describe the problem." }); const r = await newRepair(s, a, b.issue, b.prio, b.photos); return json(200, { ok: true, repair: r }); }
  if (b.action === "bm-rep-act") {
    const r = await store.get(`bm:rep:${sid(b.id)}`); if (!r || !see(r.state)) return json(404, { ok: false, error: "Not found." });
    const d = b.data || {}, V = (await get("bm:vendors", { list: [] })).list;
    if (d.vendor) { const v = V.find((x) => x.id === d.vendor); if (v) { r.vendor = v.id; r.vendorName = v.name; } }
    if (d.cost != null) r.cost = r2(num(d.cost, 0, 1e8)); if (d.eta != null) r.eta = str(d.eta, 10);
    if (Array.isArray(d.photos)) r.fixPhotos = photos(d.photos.concat(r.fixPhotos || []));
    const st = RST[d.status] ? d.status : r.status; if (st !== r.status || d.note) tl(r, st, d.note || RST[st]); r.status = st;
    if (st === "resolved" || st === "closed") { if (r.asset) await setCond(r.store, r.asset, d.cond && CONDS.includes(d.cond) ? d.cond : "Good"); }
    await saveR(r); return json(200, { ok: true, repair: r });
  }

  // ---------- virtual audits: HO / state picks stores → state team uploads photos per asset in the app → reviewer marks OK / issue ----------
  const sumAu = (a) => ({ id: a.id, title: a.title, due: a.due, at: a.at, by: a.by, stores: a.stores, states: a.states, done: a.done || {}, scores: a.scores || {}, status: a.status });
  if (b.action === "bm-aud-create") {
    const ids = [...new Set((b.stores || []).map(sid))].slice(0, 300); if (!ids.length) return json(400, { ok: false, error: "Pick at least one store." });
    const S = (await pool(ids, 20, findStore)).filter((s) => s && see(s.state)); if (!S.length) return json(400, { ok: false, error: "None of those stores are yours." });
    const a = { id: nid(t), title: str(b.title, 120) || "Branding audit · " + new Date(t).toLocaleDateString("en-IN", { month: "short", year: "numeric" }), due: str(b.due, 10), note: str(b.note, 400), stores: S.map((s) => s.id), names: Object.fromEntries(S.map((s) => [s.id, s.name])), states: [...new Set(S.map((s) => s.state))], status: "open", by, at: t, done: {}, scores: {} };
    await store.set(`bm:aud:${a.id}`, a); const I = await get("bm:aidx", {}); I[a.id] = sumAu(a); await store.set("bm:aidx", I); return json(200, { ok: true, audit: a });
  }
  if (b.action === "bm-aud-list") { const I = await get("bm:aidx", {}); return json(200, { ok: true, audits: Object.values(I).filter((a) => isHO || (a.states || []).some(see)).sort((x, y) => y.at - x.at).slice(0, 300) }); }
  if (b.action === "bm-aud-get") {   // one audit, or one store inside it with the checklist of its assets
    const a = await store.get(`bm:aud:${sid(b.id)}`); if (!a || !(isHO || a.states.some(see))) return json(404, { ok: false, error: "Not found." });
    if (!b.store) { const I = await get("bm:sidx", {}); return json(200, { ok: true, audit: Object.assign({}, a, { rows: a.stores.filter((s) => isHO || see((I[s] || {}).state || a.states[0])).map((s) => ({ id: s, name: a.names[s], state: (I[s] || {}).state || "", status: (a.done[s] || {}).st || "pending", score: a.scores[s] != null ? a.scores[s] : null, at: (a.done[s] || {}).at || 0 })) }) }); }
    const s = await findStore(b.store); if (!s || !see(s.state) || !a.stores.includes(s.id)) return json(404, { ok: false, error: "Store not in this audit." });
    const [A, sub] = await Promise.all([assets(s.id), store.get(`bm:aus:${a.id}:${s.id}`)]);
    return json(200, { ok: true, audit: { id: a.id, title: a.title, due: a.due, note: a.note }, store: s, assets: A.list.filter((x) => x.cond !== "Removed"), sub: sub || null });
  }
  if (b.action === "bm-aud-submit") {
    const a = await store.get(`bm:aud:${sid(b.id)}`), s = await findStore(b.store); if (!a || !s || !see(s.state) || !a.stores.includes(s.id)) return json(404, { ok: false, error: "Not found." });
    const A = await assets(s.id), checks = (b.checks || []).slice(0, 200).map((c) => ({ asset: str(c.asset, 30), present: c.present !== false, cond: CONDS.includes(c.cond) ? c.cond : "Good", photos: photos(c.photos), remark: str(c.remark, 300) })).filter((c) => A.list.some((x) => x.id === c.asset));
    const front = photos(b.front), extra = (b.extra || []).slice(0, 20).map((e) => ({ name: str(e.name, 80), photos: photos(e.photos), remark: str(e.remark, 200) })).filter((e) => e.name || e.photos.length);
    if (!front.length && !checks.some((c) => c.photos.length)) return json(400, { ok: false, error: "Add at least the store front photo or one asset photo." });
    const okN = checks.filter((c) => c.present && c.cond === "Good").length, score = checks.length ? Math.round(okN / checks.length * 100) : null;
    const sub = { by, at: t, checks, front, extra, note: str(b.note, 400), score, review: null };
    await store.set(`bm:aus:${a.id}:${s.id}`, sub);
    a.done[s.id] = { st: "submitted", at: t, by }; if (score != null) a.scores[s.id] = score; if (a.stores.every((x) => a.done[x])) a.status = "submitted";
    await store.set(`bm:aud:${a.id}`, a); const I = await get("bm:aidx", {}); I[a.id] = sumAu(a); await store.set("bm:aidx", I);
    // the store's asset photos and conditions update straight away
    checks.forEach((c) => { const x = A.list.find((y) => y.id === c.asset); if (!x) return; if (!c.present) x.cond = "Missing"; else if (c.cond) x.cond = c.cond; if (c.photos.length) x.photos = photos(c.photos.concat(x.photos || [])); x.lastAudit = t; });
    await saveA(s.id, A, { state: s.state, lastAud: t, score });
    return json(200, { ok: true, score });
  }
  if (b.action === "bm-aud-review") {   // reviewer: OK / issue per asset; issues → repair requests
    const a = await store.get(`bm:aud:${sid(b.id)}`), s = await findStore(b.store); if (!a || !s || !see(s.state)) return json(404, { ok: false, error: "Not found." });
    const sub = await store.get(`bm:aus:${a.id}:${s.id}`); if (!sub) return json(400, { ok: false, error: "Not submitted yet." });
    const A = await assets(s.id), res = (b.results || []).slice(0, 200), made = [];
    for (const r of res) { if (r.ok === false) { const x = A.list.find((y) => y.id === r.asset); const ck = sub.checks.find((c) => c.asset === r.asset) || {}; made.push((await newRepair(s, x, r.note || ("Audit: " + (ck.present === false ? "missing" : ck.cond || "issue")), r.prio || "Medium", ck.photos || [], "audit")).no); } }
    sub.review = { by, at: t, results: res.map((r) => ({ asset: str(r.asset, 30), ok: r.ok !== false, note: str(r.note, 300) })), note: str(b.note, 400), repairs: made };
    await store.set(`bm:aus:${a.id}:${s.id}`, sub);
    a.done[s.id] = Object.assign(a.done[s.id] || {}, { st: "reviewed", rat: t }); if (a.stores.every((x) => a.done[x] && a.done[x].st === "reviewed")) a.status = "closed";
    await store.set(`bm:aud:${a.id}`, a); const I = await get("bm:aidx", {}); I[a.id] = sumAu(a); await store.set("bm:aidx", I);
    return json(200, { ok: true, repairs: made });
  }

  // ---------- overview ----------
  if (b.action === "bm-dash") {
    const [S, SI, OI, RI, AI, STK, IM, C] = await Promise.all([stores(), get("bm:sidx", {}), get("bm:oidx", {}), get("bm:ridx", {}), get("bm:aidx", {}), stock(), itemMap(), cfg()]);
    const st = isHO ? str(b.state, 60) : myState, inS = (s) => see(s) && (!st || low(s) === low(st));
    const by_st = {}, row = (s) => by_st[s] || (by_st[s] = { state: s, stores: 0, branded: 0, val: 0, issues: 0, ordOpen: 0, ordVal: 0, transit: 0, spend: 0, stockVal: 0, repOpen: 0, repCost: 0, audits: 0, scoreSum: 0, scoreN: 0, budget: C.budget[s] || 0 });
    S.filter((s) => inS(s.state)).forEach((s) => { const r = row(s.state); r.stores++; const x = SI[s.id]; if (x && x.n) { r.branded++; r.val += x.val; r.issues += x.issues; } if (x && x.score != null) { r.scoreSum += x.score; r.scoreN++; } });
    const fy = (() => { const d = new Date(t + 5.5 * 36e5), y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return Date.UTC(y, 3, 1) - 5.5 * 36e5; })();
    const pipe = {}; Object.values(OI).filter((o) => inS(o.state)).forEach((o) => { pipe[o.status] = (pipe[o.status] || 0) + 1; const r = row(o.state); if (!["closed", "cancelled", "rejected", "received"].includes(o.status)) { r.ordOpen++; r.ordVal += o.total; } if (o.status === "dispatched") r.transit++; if (["received", "closed"].includes(o.status) && o.at >= fy) r.spend += o.total; });
    Object.keys(STK).filter(inS).forEach((s) => { const r = row(s); Object.keys(STK[s]).forEach((i) => { r.stockVal += (STK[s][i] || 0) * ((IM[i] || {}).price || 0); }); });
    Object.values(RI).filter((x) => inS(x.state)).forEach((x) => { const r = row(x.state); if (!["resolved", "closed"].includes(x.status)) r.repOpen++; r.repCost += x.cost || 0; });
    Object.values(AI).forEach((a) => (a.states || []).filter(inS).forEach((s) => { row(s).audits++; }));
    const rows = Object.values(by_st).map((r) => Object.assign(r, { val: r2(r.val), ordVal: r2(r.ordVal), spend: r2(r.spend), stockVal: r2(r.stockVal), score: r.scoreN ? Math.round(r.scoreSum / r.scoreN) : null })).sort((x, y) => y.val - x.val);
    const T = rows.reduce((a, r) => { ["stores", "branded", "val", "issues", "ordOpen", "ordVal", "transit", "spend", "stockVal", "repOpen", "repCost", "audits", "budget", "scoreSum", "scoreN"].forEach((k) => { a[k] = (a[k] || 0) + r[k]; }); return a; }, {});
    const auditOpen = Object.values(AI).filter((a) => a.status === "open" && (a.states || []).some(inS)).length;
    return json(200, { ok: true, total: Object.assign(T, { score: T.scoreN ? Math.round(T.scoreSum / T.scoreN) : null, auditOpen }), rows, pipe, recent: Object.values(OI).filter((o) => inS(o.state)).sort((x, y) => (y.upd || y.at) - (x.upd || x.at)).slice(0, 8), repairs: Object.values(RI).filter((x) => inS(x.state) && !["resolved", "closed"].includes(x.status)).sort((x, y) => y.at - x.at).slice(0, 6) });
  }
  if (b.action === "bm-export") {   // everything (visible to this user) for one Excel workbook
    const [SI, OI, RI, STK, IM, S] = await Promise.all([get("bm:sidx", {}), get("bm:oidx", {}), get("bm:ridx", {}), stock(), itemMap(), stores()]);
    const SN = {}; S.forEach((s) => { SN[s.id] = s; });
    const ids = Object.keys(SI).filter((k) => see(SI[k].state)).slice(0, 3000), A = [];
    await pool(ids, 30, async (k) => { const L = await assets(k), s = SN[k] || {}; L.list.forEach((a) => A.push({ store: k, storeName: s.name || "", state: s.state || L.state || "", city: s.city || "", item: a.itemName || (IM[a.item] || {}).name || "", cat: (IM[a.item] || {}).cat || "", qty: a.qty, price: a.price || (IM[a.item] || {}).price || 0, installed: a.installedAt || "", cond: a.cond, photos: (a.photos || []).length, lastAudit: a.lastAudit || 0 })); });
    const stk = []; Object.keys(STK).filter(see).forEach((s) => Object.keys(STK[s]).forEach((i) => { if (STK[s][i]) stk.push({ state: s, item: (IM[i] || {}).name || i, qty: STK[s][i], val: r2(STK[s][i] * ((IM[i] || {}).price || 0)) }); }));
    return json(200, { ok: true, assets: A, orders: Object.values(OI).filter((o) => see(o.state)), repairs: Object.values(RI).filter((r) => see(r.state)), stock: stk, items: Object.values(IM) });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
