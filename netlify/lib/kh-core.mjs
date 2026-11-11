// 🏪 Kirana Business Manager ("Khata"): a complete digital book for a retail shop — items with cost / selling price /
// margin, distributors and key customers, purchase bills, sale bills, payments both ways, cash & UPI counter sales,
// stock with FIFO lots (ageing + expiry), reports and AI insights. Every rupee has a record, and every bill / payment
// can be acknowledged by the other side through their own secure link (the link itself is the key — no PIN).
//
// Who uses it
//   • The shop owner: his own login (mobile + password) on khata.html — no BI account, no dashboard, nothing else.
//     Actions "kh-o-<op>" carry the owner's session token (b.ktok).
//   • HO admins (BI session, admin app): create shops and owner logins, open any shop to help: "kh-a-<op>" with b.shop.
//   • Customers / distributors (no login): "kh-p-open" / "kh-p-act" with their link token (b.l) — no PIN.
// Storage (sid = shop id, pid = party id)
//   kh:shops {list}                     kh:shop:<sid> profile & settings (pk = Periskope key, write-only)
//   kh:prod:<sid> {list}  items incl. stock lots [{d,q,e,c,doc}] and price history
//   kh:party:<sid> {list} customers (k:"c") & distributors (k:"d"), with cached ledger summary (s)
//   kh:pt:<sid>:<pid> {list} every document of that party: sale | rcpt | pur | pay | ret | adj | po
//   kh:day:<sid>:<yyyy-mm> {days:{date:{cs,us,ex:[],bills:[],note}}}   counter (walk-in) sales and expenses
//   kh:mv:<sid>:<yyyy-mm> {p:{pid:{i,o}}}   stock in / out per month (sales velocity for re-ordering)
//   kh:inbox:<sid> {list}   what customers / distributors did through their links      kh:log:<sid> {list} audit trail
//   kh:sms:<sid> {refs:[]} UPI refs already imported      kh:img:<sid>:<docId> bill photo
//   kh:user:<mobile> owner login      kh:sess:<sha> owner session      kh:link:<token> party link
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readImages } from "./schemecalc-core.mjs";
import { aiKeys, research } from "./aff-core.mjs";
import { parseLoose } from "./man-core.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const qn = (v) => { const n = Number(String(v == null ? "" : v).replace(/[,\s]/g, "")); return isFinite(n) ? Math.round(n * 1000) / 1000 : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const istDay = (t) => new Date(t + 19800000).toISOString().slice(0, 10);
const addD = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const diffD = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
const ph10 = (v) => { const d = String(v || "").replace(/\D/g, "").slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : ""; };
const mail = (v) => { const e = String(v || "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 80 ? e : ""; };
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const nid = (p) => (p || "") + Date.now().toString(36).slice(-5) + randomBytes(3).toString("hex");
const cid = (v) => String(v || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 30);
const rs = (n) => (Number(n) < -0.5 ? "−" : "") + "₹" + Math.abs(Math.round(Number(n) || 0)).toLocaleString("en-IN");
const dShow = (d) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hashPw = (pw, salt = randomBytes(16).toString("hex")) => ({ salt, hash: scryptSync(String(pw), salt, 32).toString("hex") });
const checkPw = (pw, u) => { try { const a = Buffer.from(scryptSync(String(pw), u.salt, 32).toString("hex")), b = Buffer.from(u.hash); return a.length === b.length && timingSafeEqual(a, b); } catch (e) { return false; } };
const pwProblem = (pw) => (String(pw || "").length < 6 ? "Password must be at least 6 characters." : String(pw).length > 64 ? "Password is too long." : "");
const K = {
  shops: "kh:shops", shop: (s) => "kh:shop:" + s, prod: (s) => "kh:prod:" + s, party: (s) => "kh:party:" + s, pt: (s, p) => `kh:pt:${s}:${p}`,
  day: (s, m) => `kh:day:${s}:${m}`, mv: (s, m) => `kh:mv:${s}:${m}`, inbox: (s) => "kh:inbox:" + s, log: (s) => "kh:log:" + s, sms: (s) => "kh:sms:" + s,
  img: (s, d) => `kh:img:${s}:${d}`, user: (m) => "kh:user:" + m, sess: (h) => "kh:sess:" + h, link: (t) => "kh:link:" + t,
};
const TYPES = { c: ["sale", "rcpt", "ret", "adj"], d: ["pur", "pay", "ret", "adj", "po"] };
const MODES = ["Cash", "UPI", "Bank", "Cheque", "Card", "Other"];
const SESS_MS = 180 * 864e5;

// ---------- cleaning ----------
function cleanShop(x, o) {
  x = x || {}; o = o || {};
  const g = (k, n) => (x[k] !== undefined ? str(x[k], n) : o[k] || "");
  return {
    id: o.id, name: g("name", 80) || "My shop", owner: g("owner", 60), ph: x.ph !== undefined ? ph10(x.ph) : o.ph || "", wa: x.wa !== undefined ? ph10(x.wa) : o.wa || "",
    em: x.em !== undefined ? mail(x.em) : o.em || "", addr: g("addr", 200), city: g("city", 40), state: g("state", 40), gstin: g("gstin", 15).toUpperCase(),
    upi: x.upi !== undefined ? str(x.upi, 60).replace(/\s/g, "") : o.upi || "", upiName: g("upiName", 60), pre: (x.pre !== undefined ? str(x.pre, 8) : o.pre || "INV").replace(/[^A-Za-z0-9-]/g, "") || "INV",
    terms: g("terms", 400), days: x.days !== undefined ? Math.max(0, Math.min(365, Math.round(num(x.days)))) : o.days != null ? o.days : 30,
    ddays: x.ddays !== undefined ? Math.max(0, Math.min(365, Math.round(num(x.ddays)))) : o.ddays != null ? o.ddays : 15,
    lang: ["en", "hi"].includes(x.lang) ? x.lang : o.lang || "hi", margin: x.margin !== undefined ? Math.max(0, Math.min(500, num(x.margin))) : o.margin != null ? o.margin : 12,
    gst: x.gst !== undefined ? !!x.gst : !!o.gst, qitems: x.qitems !== undefined ? !!x.qitems : o.qitems !== false, ordOn: x.ordOn !== undefined ? !!x.ordOn : o.ordOn !== false, catOn: x.catOn !== undefined ? !!x.catOn : o.catOn !== false, low: x.low !== undefined ? Math.max(0, qn(x.low)) : o.low != null ? o.low : 5, expWarn: x.expWarn !== undefined ? Math.max(1, Math.min(365, Math.round(num(x.expWarn)))) : o.expWarn || 30,
    auto: { wa: x.auto ? !!x.auto.wa : !!(o.auto && o.auto.wa), mail: x.auto ? x.auto.mail !== false : !(o.auto && o.auto.mail === false) },
    seq: o.seq || { sale: 0, rcpt: 0, pay: 0, po: 0, ret: 0 }, pk: o.pk || null, created: o.created || 0, off: !!o.off,
    rules: x.rules !== undefined ? cleanRules(x.rules) : o.rules ? cleanRules(o.rules) : defaultRules(), rulesOn: x.rulesOn !== undefined ? x.rulesOn !== false : o.rulesOn !== false,
    rhour: x.rhour !== undefined ? Math.max(6, Math.min(21, Math.round(num(x.rhour)))) : o.rhour || 10, rlast: o.rlast || "",
    grps: x.grps !== undefined ? (Array.isArray(x.grps) ? x.grps : String(x.grps).split(",")).map((g) => str(g, 24)).filter(Boolean).slice(0, 20) : o.grps || ["Regular", "Wholesale", "VIP", "New", "Risky"],
  };
}
// ---------- ⚙️ rules: what happens automatically for customers / distributors in each situation ----------
export const TRIGS = { overdue: "A bill is overdue by N days or more", limit: "Balance goes above the credit limit", due_soon: "A payment falls due within N days", no_pay: "No payment for N days (with a balance)", big_bal: "Balance is ₹N or more", pay_done: "A payment is entered (instant)", sale_done: "A sale / purchase bill is entered (instant)" };
export const ACTS = { wa: "WhatsApp them (auto)", mail: "E-mail them", owner: "Alert me (inbox + e-mail)", block: "Stop credit (warn on new bills)", interest: "Add interest on overdue (monthly)", thank: "Send a thank-you" };
function cleanRules(a) {
  return (Array.isArray(a) ? a : []).slice(0, 30).map((r, i) => ({ id: cid(r.id) || "r" + i + randomBytes(2).toString("hex"), name: str(r.name, 60) || "Rule " + (i + 1), on: r.on !== false, who: r.who === "d" ? "d" : "c", grp: str(r.grp, 24),
    trig: TRIGS[r.trig] ? r.trig : "overdue", n: Math.max(0, Math.min(100000000, num(r.n))), acts: (Array.isArray(r.acts) ? r.acts : []).filter((x) => ACTS[x]).slice(0, 6), every: Math.max(0, Math.min(90, Math.round(num(r.every)))), rate: Math.max(0, Math.min(5, num(r.rate))), msg: str(r.msg, 300) }));
}
function defaultRules() {
  return cleanRules([
    { id: "r_od", name: "Remind customers when a bill is overdue", who: "c", trig: "overdue", n: 1, acts: ["wa", "mail"], every: 3 },
    { id: "r_lim", name: "Credit limit crossed — alert me & stop credit", who: "c", trig: "limit", acts: ["owner", "block", "wa"], every: 7 },
    { id: "r_od30", name: "30+ days late — alert me", who: "c", trig: "overdue", n: 30, acts: ["owner", "block"], every: 7 },
    { id: "r_paid", name: "Thank the customer when they pay", who: "c", trig: "pay_done", acts: ["wa"] },
    { id: "r_dpay", name: "Tell the distributor when I pay him", who: "d", trig: "pay_done", acts: ["wa", "mail"] },
    { id: "r_ddue", name: "Distributor payment due in 2 days — alert me", who: "d", trig: "due_soon", n: 2, acts: ["owner"], every: 2 },
    { id: "r_int", name: "Interest 1.5%/month on 60+ days overdue", on: false, who: "c", trig: "overdue", n: 60, acts: ["interest"], rate: 1.5 },
  ]);
}
function ruleHits(r, p, s, today) {
  if (!r.on || p.on === false || r.who !== p.k || (r.grp && r.grp !== (p.grp || ""))) return "";
  s = s || {};
  if (r.trig === "overdue") return s.over > 0.5 && s.od >= Math.max(1, r.n) ? `${rs(s.over)} overdue, ${s.od} days late` : "";
  if (r.trig === "limit") { const lim = p.lim || 0; return lim > 0 && s.bal > lim + 0.5 ? `balance ${rs(s.bal)} is above the limit ${rs(lim)}` : ""; }
  if (r.trig === "due_soon") return s.bal > 0.5 && s.soon > 0.5 && s.nextDue && diffD(s.nextDue, today) <= r.n ? `${rs(s.soon)} due on ${dShow(s.nextDue)}` : "";
  if (r.trig === "no_pay") return s.bal > 0.5 && (!s.lastCr || diffD(today, s.lastCr) >= Math.max(1, r.n)) ? `no payment ${s.lastCr ? "since " + dShow(s.lastCr) : "yet"}, balance ${rs(s.bal)}` : "";
  if (r.trig === "big_bal") return r.n > 0 && s.bal >= r.n ? `balance ${rs(s.bal)}` : "";
  return "";
}
const shopOut = (s) => { const o = Object.assign({}, s); o.pkSet = !!(s.pk && s.pk.key); o.pkPhone = s.pk ? s.pk.phone || "" : ""; delete o.pk; return o; };
function cleanProd(x, o) {
  x = x || {}; o = o || {};
  const g = (k, n) => (x[k] !== undefined ? str(x[k], n) : o[k] || ""), n = (k) => (x[k] !== undefined && x[k] !== "" ? num(x[k]) : o[k] || 0);
  return { id: o.id || cid(x.id) || nid("i"), n: g("n", 90), cat: g("cat", 40) || "General", br: g("br", 40), u: g("u", 12) || "pc", bc: g("bc", 40), hsn: g("hsn", 12),
    cost: n("cost"), mrp: n("mrp"), sp: n("sp"), gst: n("gst"), rol: x.rol !== undefined && x.rol !== "" ? qn(x.rol) : o.rol != null ? o.rol : null, pack: x.pack !== undefined ? qn(x.pack) : o.pack || 0,
    dist: x.dist !== undefined ? cid(x.dist) : o.dist || "", ns: x.ns !== undefined ? (x.ns ? 1 : 0) : o.ns ? 1 : 0, qk: o.qk ? 1 : 0, ...(o.im ? { im: o.im } : {}), ...(o.iu ? { iu: o.iu } : {}), ...(o.ix ? { ix: 1 } : {}), ...(o.mrpSrc && x.mrp === undefined ? { mrpSrc: o.mrpSrc } : {}), stk: o.stk != null ? o.stk : 0, lots: o.lots || [], ph: o.ph || [], lp: o.lp || "", ls: o.ls || "", prh: o.prh || [], on: x.on !== undefined ? x.on !== false : o.on !== false, at: Date.now() };
}
// 📈 every change of cost / selling price / MRP is kept (newest first) — price drop & hike history
const PF = { cost: "Cost", sp: "Selling", mrp: "MRP" };
function priceSet(p, f, nv, src, today) {
  nv = num(nv); if (!(nv > 0)) return false; const ov = num(p[f]); if (Math.abs(ov - nv) < 0.009) return false;
  p[f] = nv; if (ov > 0) p.prh = [{ d: today, f, o: ov, n: nv, src: str(src, 20) }].concat(p.prh || []).slice(0, 40);
  if (f === "cost" && ov > 0) p.ph = [[today, ov, nv, src]].concat(p.ph || []).slice(0, 8);
  return ov > 0;
}
function cleanParty(x, o, shop) {
  x = x || {}; o = o || {};
  const g = (k, n) => (x[k] !== undefined ? str(x[k], n) : o[k] || ""), k = o.k || (x.k === "d" ? "d" : "c");
  return { id: o.id || nid(k), k, n: g("n", 80), firm: g("firm", 80), ph: x.ph !== undefined ? ph10(x.ph) : o.ph || "", wa: x.wa !== undefined ? ph10(x.wa) : o.wa || "", em: x.em !== undefined ? mail(x.em) : o.em || "",
    addr: g("addr", 200), gst: g("gst", 15).toUpperCase(), days: x.days !== undefined && x.days !== "" ? Math.max(0, Math.min(365, Math.round(num(x.days)))) : o.days != null ? o.days : k === "d" ? shop.ddays : shop.days,
    lim: x.lim !== undefined ? num(x.lim) : o.lim || 0, upi: x.upi !== undefined ? (Array.isArray(x.upi) ? x.upi : String(x.upi).split(/[\s,;]+/)).map((u) => str(u, 60).toLowerCase()).filter(Boolean).slice(0, 8) : o.upi || [],
    sman: g("sman", 60), sph: x.sph !== undefined ? ph10(x.sph) : o.sph || "", od: g("od", 40), lead: x.lead !== undefined ? Math.max(0, Math.min(60, Math.round(num(x.lead)))) : o.lead != null ? o.lead : 2,
    ob: x.ob !== undefined ? num(x.ob) : o.ob || 0, obd: x.obd !== undefined ? day(x.obd) : o.obd || "", notes: g("notes", 300), on: x.on !== undefined ? x.on !== false : o.on !== false,
    grp: x.grp !== undefined ? str(x.grp, 24) : o.grp || "", hold: x.hold !== undefined ? (x.hold ? { by: "owner", why: str(x.holdWhy, 120) || "Stopped by owner", at: Date.now() } : null) : o.hold || null,
    av: o.av || "", rem: o.rem || {}, int: o.int || {}, tok: o.tok || "", conf: o.conf || null, s: o.s || null, at: o.at || Date.now() };
}
function cleanItems(a) {
  return (Array.isArray(a) ? a : []).slice(0, 300).map((i) => ({ p: cid(i.p), n: str(i.n, 90), q: qn(i.q), fq: qn(i.fq), r: num(i.r), u: str(i.u, 12), g: num(i.g), dsc: Math.max(0, Math.min(100, num(i.dsc))),
    mrp: num(i.mrp), e: day(i.e), b: str(i.b, 20), ta: Math.max(0, num(i.ta)) })).filter((i) => (i.p || i.n) && (i.q || i.fq));
}
function cleanDoc(x, o, party, shop) {
  x = x || {}; o = o || {};
  const ty = TYPES[party.k].includes(x.ty) ? x.ty : o.ty; if (!ty) return null;
  const d = day(x.d) || o.d || istDay(Date.now()), items = ty === "rcpt" || ty === "pay" || ty === "adj" ? [] : cleanItems(x.items);
  items.forEach((i) => { i.amt = i.ta > 0 ? i.ta : r2(i.q * i.r * (1 - i.dsc / 100)); if (!i.ta) delete i.ta; });
  const sub = r2(items.reduce((s, i) => s + i.amt, 0)), disc = num(x.disc), oth = num(x.oth), rnd = num(x.rnd);
  let amt = items.length ? r2(sub - disc + oth + rnd) : num(x.amt); if (ty !== "adj") amt = Math.abs(amt);
  const paid = ty === "sale" || ty === "pur" ? Math.max(0, Math.min(amt, num(x.paid))) : 0;
  return { id: o.id || nid(ty[0]), ty, no: str(x.no, 30) || o.no || "", d, items, sub, disc, oth, rnd, amt, paid, mode: MODES.includes(x.mode) ? x.mode : o.mode || (ty === "sale" || ty === "pur" ? "" : "Cash"),
    ref: str(x.ref, 60), note: str(x.note, 300), due: ty === "sale" || ty === "pur" || (ty === "adj" && amt > 0) ? day(x.due) || addD(d, party.days || 0) : "",
    against: (Array.isArray(x.against) ? x.against : []).map(cid).filter(Boolean).slice(0, 40), st: ["final", "draft", "pending"].includes(x.st) ? x.st : o.st || "final",
    src: o.src || str(x.src, 10) || "owner", eta: day(x.eta), ack: o.ack || null, hist: o.hist || [], sent: o.sent || {}, ...(o.sn ? { sn: o.sn } : {}), ...(o.rd ? { rd: o.rd } : {}), photo: o.photo || !!x.photo, at: o.at || Date.now(), by: o.by || "", void: o.void || null };
}

// ---------- ledger: running balance + which bills are still open (own payment first, then the rest oldest-first) ----------
// customer: + = they owe the shop.  distributor: + = the shop owes them.
const live = (d) => !d.void && d.st === "final" && d.ty !== "po";
export function ledger(p, docs, today) {
  const L = docs.filter(live).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.at - b.at));
  const bills = [], rows = []; let bal = 0;
  if (p.ob) { bal = p.ob; rows.push({ id: "ob", ty: "ob", d: p.obd || "", no: "Opening balance", dr: Math.max(0, p.ob), cr: Math.max(0, -p.ob), bal }); if (p.ob > 0) bills.push({ id: "ob", no: "Opening balance", d: p.obd || "", due: p.obd || "", amt: p.ob, out: p.ob }); }
  const credits = p.ob < 0 ? [{ amt: -p.ob, against: [] }] : [];
  for (const x of L) {
    const dr = x.ty === "sale" || x.ty === "pur" ? x.amt : x.ty === "adj" && x.amt > 0 ? x.amt : 0;
    const cr = x.ty === "sale" || x.ty === "pur" ? x.paid : x.ty === "rcpt" || x.ty === "pay" || x.ty === "ret" ? x.amt : x.ty === "adj" && x.amt < 0 ? -x.amt : 0;
    bal = r2(bal + dr - cr);
    rows.push({ id: x.id, ty: x.ty, d: x.d, no: x.no, dr, cr, bal, due: x.due, mode: x.mode, ref: x.ref, note: x.note, ack: x.ack, n: x.items.length });
    if (dr) bills.push({ id: x.id, no: x.no, d: x.d, due: x.due || x.d, amt: dr, out: r2(dr - (x.ty === "sale" || x.ty === "pur" ? x.paid : 0)) });
    if (cr && x.ty !== "sale" && x.ty !== "pur") credits.push({ amt: cr, against: x.against || [] });
  }
  let adv = 0;
  for (const c of credits) {
    let left = c.amt;
    for (const id of c.against) { const b = bills.find((y) => y.id === id); if (b && left > 0) { const u = Math.min(b.out, left); b.out = r2(b.out - u); left = r2(left - u); } }
    for (const b of bills) { if (left <= 0) break; if (b.out > 0) { const u = Math.min(b.out, left); b.out = r2(b.out - u); left = r2(left - u); } }
    adv = r2(adv + left);
  }
  const aging = [0, 0, 0, 0]; let over = 0, od = 0, nextDue = "", soon = 0;
  for (const b of bills) {
    b.status = b.out <= 0.009 ? "paid" : b.out < b.amt ? "part" : "open";
    if (b.out > 0.009) {
      const age = Math.max(0, diffD(today, b.d || today)); aging[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += b.out;
      if (b.due && b.due < today) { over += b.out; od = Math.max(od, diffD(today, b.due)); b.late = diffD(today, b.due); } else if (b.due) { if (!nextDue || b.due < nextDue) nextDue = b.due; if (diffD(b.due, today) <= 7) soon += b.out; }
    }
  }
  const lastCr = L.filter((x) => x.ty === "rcpt" || x.ty === "pay").slice(-1)[0];
  const unack = L.filter((x) => (x.ty === "sale" || x.ty === "rcpt" || x.ty === "pay") && !(x.ack && x.ack.ok)).length;
  return { rows, bills, s: { bal: r2(bal), over: r2(over), soon: r2(soon), od, aging: aging.map(r2), nextDue, adv, lastCr: lastCr ? lastCr.d : "", lastAmt: lastCr ? lastCr.amt : 0, unack, open: bills.filter((b) => b.out > 0.009).length, n: L.length } };
}

// ---------- stock (FIFO lots → ageing, expiry, valuation) ----------
function stockDelta(kind, ty, it) { if (kind === "d") return ty === "pur" ? it.q + it.fq : ty === "ret" ? -it.q : 0; return ty === "sale" ? -it.q : ty === "ret" ? it.q : 0; }
function consume(pr, q, docId) {
  if (docId) { for (const l of pr.lots) if (l.doc === docId && q > 0) { const u = Math.min(l.q, q); l.q = qn(l.q - u); q = qn(q - u); } }
  pr.lots.sort((a, b) => (a.d < b.d ? -1 : 1));
  for (const l of pr.lots) { if (q <= 0) break; const u = Math.min(l.q, q); l.q = qn(l.q - u); q = qn(q - u); }
  pr.lots = pr.lots.filter((l) => l.q > 0.0005);
}
function addBack(pr, q, d) { pr.lots.sort((a, b) => (a.d < b.d ? -1 : 1)); if (pr.lots.length) pr.lots[0].q = qn(pr.lots[0].q + q); else pr.lots.push({ d, q, c: pr.cost, e: "" }); }
function applyStock(PM, mv, kind, doc, sign, today) {
  const touched = new Set();
  for (const it of doc.items) {
    const pr = PM[it.p]; if (!pr) continue;
    const dl = stockDelta(kind, doc.ty, it) * sign; if (!dl) continue;
    touched.add(pr.id);
    if (pr.ns) {   // ⚡ loose / unpackaged "quick" item: no stock count, but the sale is still remembered
      if (doc.ty === "sale") { const ym0 = doc.d.slice(0, 7), m0 = mv[ym0] || (mv[ym0] = { p: {} }), mp0 = m0.p[pr.id] || (m0.p[pr.id] = { i: 0, o: 0 }); mp0.o = qn(mp0.o - dl); if (dl < 0 && (!pr.ls || doc.d > pr.ls)) pr.ls = doc.d; }
      continue;
    }
    pr.stk = qn((pr.stk || 0) + dl);
    const ym = doc.d.slice(0, 7), m = mv[ym] || (mv[ym] = { p: {} }), mp = m.p[pr.id] || (m.p[pr.id] = { i: 0, o: 0 });
    if (kind === "d" && doc.ty === "pur") {
      mp.i = qn(mp.i + dl);
      if (sign > 0) {
        const tot = it.q + it.fq, landed = tot ? r2((it.amt || it.q * it.r) / tot) : it.r;
        pr.lots.push({ d: doc.d, q: tot, e: it.e || "", c: landed, doc: doc.id, b: it.b || "" });
        if (!pr.lp || doc.d >= pr.lp) { priceSet(pr, "cost", landed, "purchase", doc.d); pr.lp = doc.d; pr.dist = pr.dist || doc._pid || ""; }
        if (it.mrp) priceSet(pr, "mrp", it.mrp, "purchase", doc.d);
      } else consume(pr, -dl, doc.id);
    } else if (dl < 0) { consume(pr, -dl); if (doc.ty === "sale") { mp.o = qn(mp.o - dl); if (!pr.ls || doc.d > pr.ls) pr.ls = doc.d; } }
    else { addBack(pr, dl, doc.d || today); if (doc.ty === "sale") mp.o = qn(mp.o - dl); }
  }
  return touched;
}

// ---------- messages (the same text goes to WhatsApp, e-mail and the link page) ----------
const L10 = {
  en: { hi: "Hello", bill: "Bill", rcpt: "Payment received", pay: "Payment made", po: "Order", total: "Total", paidNow: "Paid now", balBill: "Balance on this bill", due: "Due by", bal: "Your total balance", adv: "Advance with us", clear: "All clear — no dues", view: "View & confirm", code: "Code: last 4 digits of your mobile", thanks: "Thank you", remind: "Gentle reminder", overdue: "overdue", owe: "Our balance payable to you", stmt: "Statement", items: "items", mode: "Mode", conf: "Please confirm receipt on the link" },
  hi: { hi: "नमस्ते", bill: "बिल", rcpt: "भुगतान प्राप्त हुआ", pay: "भुगतान किया गया", po: "ऑर्डर", total: "कुल", paidNow: "अभी जमा", balBill: "इस बिल पर बाकी", due: "भुगतान की तारीख", bal: "आपका कुल बकाया", adv: "आपका एडवांस", clear: "कोई बकाया नहीं", view: "देखें और पुष्टि करें", code: "कोड: आपके मोबाइल के आखिरी 4 अंक", thanks: "धन्यवाद", remind: "विनम्र याद-दिहानी", overdue: "देरी", owe: "हमारी ओर से आपको देय", stmt: "खाता विवरण", items: "आइटम", mode: "माध्यम", conf: "कृपया लिंक पर प्राप्ति की पुष्टि करें" },
};
function message(kind, shop, p, doc, s, link) {
  const T = L10[shop.lang] || L10.hi, nm = p.n || p.firm || "", lines = [`${T.hi} ${nm} ji,`];
  const balLine = p.k === "c" ? (s.bal > 0.5 ? `${T.bal}: *${rs(s.bal)}*` + (s.over > 0.5 ? ` (${rs(s.over)} ${T.overdue})` : "") : s.bal < -0.5 ? `${T.adv}: ${rs(-s.bal)}` : T.clear)
    : (s.bal > 0.5 ? `${T.owe}: ${rs(s.bal)}` : T.clear);
  if (kind === "sale" || kind === "pur") {
    lines.push(`🧾 ${T.bill} ${doc.no ? "#" + doc.no + " " : ""}· ${dShow(doc.d)}`, `${T.total}: *${rs(doc.amt)}*` + (doc.items.length ? ` (${doc.items.length} ${T.items})` : ""));
    // the full bill inside the message itself — the customer sees every item without opening a link or a file
    if (doc.items.length) { lines.push("────────────"); doc.items.slice(0, 50).forEach((i, k) => lines.push(`${k + 1}. ${i.n} — ${i.q}${i.u ? " " + i.u : ""}${i.r ? " × " + rs(i.r) : ""} = *${rs(i.amt != null ? i.amt : i.q * i.r)}*`)); if (doc.items.length > 50) lines.push(`… +${doc.items.length - 50} ${T.items}`);
      if (doc.disc) lines.push(`Discount: −${rs(doc.disc)}`); if (doc.oth) lines.push(`Other charges: ${rs(doc.oth)}`); lines.push("────────────", `${T.total}: *${rs(doc.amt)}*`); }
    if (doc.paid) lines.push(`${T.paidNow}: ${rs(doc.paid)}`);
    if (doc.amt - doc.paid > 0.5) lines.push(`${T.balBill}: ${rs(doc.amt - doc.paid)} · ${T.due} ${dShow(doc.due)}`);
    lines.push(balLine);
  } else if (kind === "rcpt" || kind === "pay") {
    lines.push(`✅ ${kind === "rcpt" ? T.rcpt : T.pay}: *${rs(doc.amt)}* · ${dShow(doc.d)}`, `${T.mode}: ${doc.mode}${doc.ref ? " · Ref " + doc.ref : ""}`, balLine);
    if (kind === "pay") lines.push(T.conf);
  } else if (kind === "po") {
    lines.push(`🛒 ${T.po} ${doc.no ? "#" + doc.no : ""} · ${dShow(doc.d)}`); doc.items.slice(0, 40).forEach((i, k) => lines.push(`${k + 1}. ${i.n} — ${i.q} ${i.u || ""}`));
    if (doc.note) lines.push(doc.note);
  } else if (kind === "remind") { lines.push(`🙏 ${T.remind}: ${balLine}` + (s.nextDue && s.over < 0.5 ? ` · ${T.due} ${dShow(s.nextDue)}` : "")); if (shop.upi && p.k === "c" && s.bal > 0) lines.push(`UPI: ${shop.upi}`); }
  else lines.push(`📒 ${T.stmt} · ${dShow(istDay(Date.now()))}`, balLine);
  if (link) lines.push("", `${T.view}: ${link}`);
  if (link && doc && doc.id && /[#&]d=/.test(link) && kind === "sale" && doc.items.length) lines.push(`📄 PDF: ${link}&pdf=1`);
  lines.push("", `${T.thanks} 🙏`, `${shop.name}${shop.ph ? " · " + shop.ph : ""}`);
  return lines.join("\n");
}
async function sendMail(ctx, to, subject, html) {
  let { env, store, mailFetch } = ctx;
  if (!env.BREVO_API_KEY || !env.OTP_FROM_EMAIL) { const ec = await store.get("config:email"); if (ec && ec.apiKey && ec.from) env = Object.assign({}, env, { BREVO_API_KEY: ec.apiKey, OTP_FROM_EMAIL: ec.from }); }
  if (!env.BREVO_API_KEY || !env.OTP_FROM_EMAIL) return { ok: false, error: "E-mail isn't set up on the server yet (BI admin: Security → e-mail)." };
  try {
    const r = await (mailFetch || fetch)("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": env.BREVO_API_KEY },
      body: JSON.stringify({ sender: { name: subject.split(" · ")[0].slice(0, 60), email: env.OTP_FROM_EMAIL }, to: [{ email: to }], subject, htmlContent: html, replyTo: ctx.replyTo ? { email: ctx.replyTo } : undefined }) });
    if (r.ok) return { ok: true }; const j = await r.json().catch(() => ({})); return { ok: false, error: "E-mail " + r.status + (j.message ? ": " + String(j.message).slice(0, 80) : "") };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 80) }; }
}
function mailHtml(shop, p, doc, text, link) {
  const items = doc && doc.items && doc.items.length ? `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:10px 0"><tr style="background:#F6F1E3"><th style="text-align:left;padding:6px">#</th><th style="text-align:left;padding:6px">Item</th><th style="text-align:right;padding:6px">Qty</th><th style="text-align:right;padding:6px">Rate</th><th style="text-align:right;padding:6px">Amount</th></tr>${doc.items.map((i, k) => `<tr><td style="padding:5px 6px;border-top:1px solid #eee">${k + 1}</td><td style="padding:5px 6px;border-top:1px solid #eee">${escH(i.n)}</td><td style="padding:5px 6px;border-top:1px solid #eee;text-align:right">${i.q} ${escH(i.u || "")}</td><td style="padding:5px 6px;border-top:1px solid #eee;text-align:right">${rs(i.r)}</td><td style="padding:5px 6px;border-top:1px solid #eee;text-align:right">${rs(i.amt)}</td></tr>`).join("")}</table>` : "";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;background:#F6F4EE;padding:16px"><div style="max-width:600px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;color:#1c1a14"><div style="background:#14532D;color:#fff;padding:14px 18px"><div style="font-size:19px;font-weight:800">${escH(shop.name)}</div><div style="font-size:12px;opacity:.85">${escH([shop.addr, shop.ph, shop.gstin ? "GSTIN " + shop.gstin : ""].filter(Boolean).join(" · "))}</div></div><div style="padding:16px 18px;font-size:14px;line-height:1.55">${escH(text).replace(/\*([^*]+)\*/g, "<b>$1</b>").replace(/\n/g, "<br>")}${items}${link ? `<p style="text-align:center;margin:18px 0"><a href="${escH(link)}" style="background:#14532D;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">View & confirm</a></p>` : ""}</div></div></div>`;
}
async function sendWa(ctx, shop, to, text) {
  if (!shop.pk || !shop.pk.key) return { ok: false, error: "WhatsApp auto-send isn't connected" };
  try {
    const r = await (ctx.waFetch || fetch)("https://api.periskope.app/v1/message/send", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + shop.pk.key, "x-phone": "91" + (shop.pk.phone || shop.wa || shop.ph) }, body: JSON.stringify({ chat_id: "91" + to + "@c.us", message: text }) });
    if (r.ok) return { ok: true }; const j = await r.json().catch(() => ({})); return { ok: false, error: "WhatsApp " + r.status + (j.message ? ": " + String(j.message).slice(0, 80) : "") };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 80) }; }
}

// ---------- one shop's books ----------
// items are kept in shards of 2,500 (a shop can have 50,000+ items); only changed shards are written and re-sent
const pimK = (sid, id) => "kh:pim:" + sid + ":" + id, IMG_RE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/, IU_RE = /^https:\/\/images\.(openfoodfacts|openproductsfacts|openbeautyfacts)\.(org|net)\/[\w\-./]+\.(jpg|jpeg|png|webp)$/i;
const SH = 2500, MAXP = 60000, shKey = (sid, i) => "kh:prodsh:" + sid + ":" + i;
async function books(store, sid, light) {
  const [shop, P, R] = await Promise.all([store.get(K.shop(sid)), store.get(K.prod(sid)), store.get(K.party(sid))]);
  let prods = [], orig = [], vers = [];
  if (light) return { shop: shop ? cleanShop({}, shop) : null, prods: [], parties: (R && R.list) || [], _pv: (P && P.vers) || [], _light: true };
  if (P && P.shards != null) {
    const parts = await Promise.all(Array.from({ length: P.shards }, (_, i) => store.get(shKey(sid, i))));
    parts.forEach((x, i) => { const L = (x && x.list) || []; orig[i] = JSON.stringify(L); prods = prods.concat(L); }); vers = (P.vers || []).slice(0, P.shards);
  } else prods = (P && P.list) || [];
  return { shop: shop ? cleanShop({}, shop) : null, prods, parties: (R && R.list) || [], _po: orig, _pv: vers, _legacy: !(P && P.shards != null) };
}
async function writeProds(store, sid, B, t) {
  const n = Math.max(1, Math.ceil(B.prods.length / SH)), vers = [], jobs = [];
  for (let i = 0; i < n; i++) {
    const L = B.prods.slice(i * SH, (i + 1) * SH), js = JSON.stringify(L);
    if (B._legacy || js !== B._po[i] || !B._pv[i]) { jobs.push(store.set(shKey(sid, i), { list: L, at: t })); vers[i] = t.toString(36) + i; B._po[i] = js; } else vers[i] = B._pv[i];
  }
  await Promise.all(jobs); B._pv = vers; B._legacy = false;
  await store.set(K.prod(sid), { shards: n, vers, count: B.prods.length, at: t });
}
async function addLog(store, sid, t, by, what) { const L = (await store.get(K.log(sid))) || { list: [] }; L.list.unshift({ at: t, by, what: String(what).slice(0, 240) }); L.list = L.list.slice(0, 1500); await store.set(K.log(sid), L); }
async function loadMv(store, sid, months) { const out = {}; await Promise.all(months.map(async (m) => { out[m] = (await store.get(K.mv(sid, m))) || { p: {} }; })); return out; }
async function saveMv(store, sid, mv) { await Promise.all(Object.keys(mv).map((m) => store.set(K.mv(sid, m), mv[m]))); }
const lastMonths = (today, n) => { const out = []; const d = new Date(today + "T00:00:00Z"); d.setUTCDate(1); for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); } return out; };
function linkUrl(origin, tok, docId) { return (origin || "") + "/khata.html#l=" + tok + (docId ? "&d=" + docId : ""); }
async function ensureLink(store, sid, p) { if (p.tok) return p.tok; p.tok = randomBytes(12).toString("hex"); await store.set(K.link(p.tok), { sid, pid: p.id, fails: 0 }); return p.tok; }
const prodLite = (p) => p;   // the page needs lots for ageing / expiry

// velocity: units sold per day over the last ~60 days (sales + stock-count differences)
function velocity(mv, months, today) {
  const v = {}, dIn = Number(today.slice(8, 10));
  months.slice(0, 3).forEach((m, i) => { const w = i === 0 ? dIn : i === 1 ? 30 : 0; if (!w && i > 1) return; Object.entries((mv[m] || { p: {} }).p).forEach(([id, x]) => { v[id] = (v[id] || 0) + (x.o || 0); }); });
  const days = Math.max(20, dIn + 30); Object.keys(v).forEach((k) => { v[k] = Math.round(v[k] / days * 1000) / 1000; }); return v;
}

// slow AI work (reading a photo / voice / pack) runs as a background job so the phone never sees a 504 timeout
const JOB_OPS = { "read-order": 1, "list-read": 1, "pack-read": 1, "bill-read": 1 };
const LIGHT_OPS = { "read-order": 1, "list-read": 1, "pack-read": 1, "bill-read": 1, "job-get": 1, "match-ai": 1, "i18n": 1, "i18n-get": 1, "prod-shard": 1, "prod-imgs": 1, "db-sync": 1 };
// ===== 🌐 public product database: Open Food Facts (India) pictures + names, Open Prices (INR) shelf prices =====
// Built once and shared by all shops; fetched politely (their limit is 10 searches a minute), resumable across runs.
const OFF_IMG = "https://images.openfoodfacts.org/images/products/", OFF_UA = { "user-agent": "ShopKhata/1.0 (kirana billing app; vivo-business-innovation-dashboard-22.netlify.app)", accept: "application/json" };
const offKey = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
async function offBuild(store, fetchImpl, env, until) {
  const gap = Number(env.OFF_GAP_MS) || 6500, CH = 4000;
  let M = (await store.get("kh:offdb:meta")) || { page: 0, count: 0, total: 0, done: false, at: 0, chunks: 0 };
  if (M.done && Date.now() - M.at > 30 * 86400000) M = { page: 0, count: 0, total: 0, done: false, at: 0, chunks: 0 };   // refresh monthly
  let fails = 0;
  while (!M.done && Date.now() < until) {
    const pg = M.page + 1; let j = null;
    try { const r = await fetchImpl(`https://in.openfoodfacts.org/api/v2/search?fields=code,product_name,product_name_en,brands,quantity,image_front_small_url&page_size=1000&page=${pg}&sort_by=unique_scans_n`, { headers: OFF_UA }); j = r.ok ? await r.json().catch(() => null) : null; } catch (e) { j = null; }
    if (!j || !Array.isArray(j.products)) { if (++fails >= 2) break; await nap(Math.min(gap * 2, 15000)); continue; }
    fails = 0;
    const ci = Math.floor(M.count / CH), C = (M.count % CH ? await store.get("kh:offdb:c" + ci) : null) || { m: {} };
    let C2 = null, add = 0, cn = Object.keys(C.m).length;
    for (const x of j.products) {
      const code = String(x.code || "").replace(/\D/g, ""); if (code.length < 8 || code.length > 14) continue;
      const img = IU_RE.test(String(x.image_front_small_url || "")) && String(x.image_front_small_url).startsWith(OFF_IMG) ? String(x.image_front_small_url).slice(OFF_IMG.length) : "";
      const row = [str(x.product_name_en || x.product_name, 80), str(String(x.brands || "").split(",")[0], 30), str(x.quantity, 20), img];
      if (!row[0] && !img) continue;
      const isNew = !(code in C.m) && !(C2 && code in C2.m), tgt = code in C.m || cn < CH ? C : (C2 = C2 || { m: {} }); if (isNew) { add++; if (tgt === C) cn++; } tgt.m[code] = row;
    }
    await store.set("kh:offdb:c" + ci, C); if (C2) await store.set("kh:offdb:c" + (ci + 1), C2);
    M.page = pg; M.count += add; M.total = num(j.count) || M.total; M.chunks = Math.floor(Math.max(0, M.count - 1) / CH) + 1; M.at = Date.now();
    const size = num(j.page_size) || j.products.length || 1;
    if (!j.products.length || pg * size >= (num(j.count) || 0) || pg >= 400) M.done = true;
    await store.set("kh:offdb:meta", M);
    if (!M.done) await nap(gap);
  }
  return M;
}
async function offPrices(store, fetchImpl, env, until) {
  let P = (await store.get("kh:offpr")) || { at: 0, m: {}, page: 0, pages: 0, done: false };
  if (P.done && Date.now() - P.at < 7 * 86400000) return P;
  if (P.done) P = { at: 0, m: {}, page: 0, pages: 0, done: false };
  const gap = Number(env.OFF_GAP_MS) ? Number(env.OFF_GAP_MS) : 1500; let fails = 0;
  while (!P.done && Date.now() < until) {
    const pg = P.page + 1; let j = null;
    try { const r = await fetchImpl(`https://prices.openfoodfacts.org/api/v1/prices?currency=INR&size=100&page=${pg}&order_by=-date`, { headers: OFF_UA }); j = r.ok ? await r.json().catch(() => null) : null; } catch (e) { j = null; }
    if (!j || !Array.isArray(j.items)) { if (++fails >= 2) break; await nap(3000); continue; }
    fails = 0;
    for (const x of j.items) { const code = String(x.product_code || "").replace(/\D/g, ""), pr = num(x.price_is_discounted && x.price_without_discount ? x.price_without_discount : x.price);
      if (code.length < 8 || x.currency !== "INR" || !(pr > 0) || pr > 100000 || (x.price_is_discounted && !x.price_without_discount) || (x.price_per && x.price_per !== "UNIT")) continue;
      if (!P.m[code]) P.m[code] = [r2(pr), String(x.date || "").slice(0, 10)]; }   // newest first, so the first one seen is the latest
    P.page = pg; P.pages = num(j.pages) || P.pages; P.at = Date.now(); if (!j.items.length || pg >= P.pages || pg >= 150) P.done = true;
    await store.set("kh:offpr", P); if (!P.done) await nap(gap);
  }
  return P;
}
async function dbSync(store, sid, ctx) {
  const t0 = Date.now(), f = ctx.aiFetch || fetch, env = ctx.env || {}, quick = Number(env.OFF_GAP_MS) > 0 && Number(env.OFF_GAP_MS) < 500;
  const M = await offBuild(store, f, env, t0 + (quick ? 20000 : 8.5 * 60000)), P = await offPrices(store, f, env, t0 + (quick ? 30000 : 11 * 60000));
  // match this shop's items — the books are read only now and written straight back, so bills made meanwhile are not lost
  const DB = {}, byName = {};
  for (let i = 0; i < (M.chunks || 0); i++) { const C = await store.get("kh:offdb:c" + i); if (C && C.m) Object.assign(DB, C.m); }
  Object.keys(DB).forEach((code) => { const r = DB[code]; if (r[3] && r[0]) { const k = offKey((r[0].toLowerCase().includes(String(r[1]).toLowerCase()) ? "" : r[1] + " ") + r[0] + " " + r[2]); if (k.split(" ").length >= 3 && !(k in byName)) byName[k] = code; else if (byName[k] !== code) byName[k] = ""; } });
  const B = await books(store, sid, false); if (!B.shop) return json(404, { ok: false, error: "Shop not found." });
  const today = istDay(Date.now()); let pics = 0, named = 0, mrps = 0, withBc = 0;
  const codes = (bc) => { const c = String(bc || "").replace(/\D/g, ""); return c.length < 8 ? [] : [c, c.replace(/^0+/, ""), "0" + c, c.padStart(13, "0")]; };
  for (const pr of B.prods) {
    if (pr.on === false) continue;
    const cs = codes(pr.bc); if (cs.length) withBc++;
    const hit = cs.find((c) => DB[c]), ph = cs.find((c) => P.m && P.m[c]);
    if (!pr.im && !pr.iu) {
      if (hit && DB[hit][3]) { pr.iu = OFF_IMG + DB[hit][3]; delete pr.ix; pics++; }
      else if (!cs.length) { const k = offKey(pr.n + (pr.br && !pr.n.toLowerCase().includes(String(pr.br).toLowerCase()) ? " " + pr.br : "")), c2 = k.split(" ").length >= 3 ? byName[k] : ""; if (c2 && DB[c2][3]) { pr.iu = OFF_IMG + DB[c2][3]; delete pr.ix; pics++; named++; } }
    }
    if (ph && !(pr.mrp > 0) && P.m[ph][0] >= (pr.sp || 0)) { priceSet(pr, "mrp", P.m[ph][0], "Open Prices", today); pr.mrpSrc = "op:" + P.m[ph][1]; mrps++; }
  }
  if (pics || mrps) await writeProds(store, sid, B, Date.now());
  if (pics || mrps) await addLog(store, sid, Date.now(), ctx.by || "Owner", `Public product database: ${pics} pictures, ${mrps} MRPs filled`);
  return json(200, Object.assign({ ok: true, db: M.count, dbTotal: M.total, dbDone: !!M.done, prices: Object.keys(P.m || {}).length, pricesDone: !!P.done, pics, named, mrps, withBc, items: B.prods.length, more: !M.done || !P.done, reached: M.count > 0 || M.page > 0 }, B.prods.length <= SH ? { prods: B.prods } : { pv: B._pv, pcount: B.prods.length }));
}
export async function runKhJob(store, env, id, fetchImpl, askAIfn) {
  const k = "kh:job:" + String(id).replace(/[^a-z0-9]/g, ""), j = await store.get(k); if (!j || j.status !== "running") return;
  let out; try {
    const res = await ownerOp(j.op, j.b, { store, t: Date.now(), sid: j.sid, by: j.by, env, aiFetch: fetchImpl, mailFetch: fetchImpl, waFetch: fetchImpl, askAI: askAIfn, bg: true });
    out = await res.json();
  } catch (e) { out = { ok: false, error: "Couldn't finish reading (" + String(e.message || e).slice(0, 120) + ")." }; }
  await store.set(k, { status: "done", at: Date.now(), sid: j.sid, out });
}
async function ownerOp(op, b, ctx) {
  const { store, t, sid, by } = ctx, today = istDay(t);
  if (op === "job-get") {
    const j = await store.get("kh:job:" + String(b.job || "").replace(/[^a-z0-9]/g, ""));
    if (!j || j.sid !== sid) return json(404, { ok: false, error: "This reading has expired — try again." });
    if (j.status === "done") return json(200, { ok: true, done: true, out: j.out });
    return json(200, { ok: true, done: false, secs: Math.round((t - j.at) / 1000) });
  }
  if (JOB_OPS[op] && !ctx.bg && ((b.images && b.images.length) || b.audio) && (ctx.env.SITE_URL || ctx.env.URL)) {
    const id = t.toString(36) + randomBytes(5).toString("hex");
    await store.set("kh:job:" + id, { status: "running", at: t, sid, by, op, b: Object.assign({}, b, { ktok: undefined }) });
    try { await (ctx.jobFetch || fetch)((ctx.env.SITE_URL || ctx.env.URL) + "/.netlify/functions/khread-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: id }) }); }
    catch (e) { await store.set("kh:job:" + id, { status: "done", at: t, sid, out: { ok: false, error: "Couldn't start reading — try again." } }); }
    return json(200, { ok: true, job: id });
  }
  if (op === "db-sync") {   // 🌐 fill pictures / MRP from the public product database — runs in the background (minutes)
    if (ctx.bg) return dbSync(store, sid, ctx);
    if (!(ctx.env.SITE_URL || ctx.env.URL)) return json(400, { ok: false, error: "Background jobs are not available here." });
    const id = t.toString(36) + randomBytes(5).toString("hex");
    await store.set("kh:job:" + id, { status: "running", at: t, sid, by, op, b: {} });
    try { await (ctx.jobFetch || fetch)((ctx.env.SITE_URL || ctx.env.URL) + "/.netlify/functions/khread-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: id }) }); }
    catch (e) { await store.set("kh:job:" + id, { status: "done", at: t, sid, out: { ok: false, error: "Couldn't start — try again." } }); }
    return json(200, { ok: true, bgjob: id });
  }
  if (op === "prod-shard") { const P = await store.get(K.prod(sid)), i = Math.max(0, Math.round(num(b.i))); if (!P || P.shards == null || i >= P.shards) return json(404, { ok: false, error: "No such part." }); const x = await store.get(shKey(sid, i)); return json(200, { ok: true, i, v: (P.vers || [])[i], list: (x && x.list) || [] }); }
  const B = await books(store, sid, !!LIGHT_OPS[op]); if (!B.shop) return json(404, { ok: false, error: "Shop not found." });
  const { shop } = B, PM = Object.fromEntries(B.prods.map((p) => [p.id, p])), RM = Object.fromEntries(B.parties.map((p) => [p.id, p]));
  const saveProds = () => writeProds(store, sid, B, t);
  // big shops: send shard versions instead of every item; the page fetches only the shards that changed
  const allP = () => (B.prods.length <= SH ? { prods: B.prods } : { pv: B._pv, pcount: B.prods.length });
  const saveParties = () => store.set(K.party(sid), { list: B.parties, at: t });
  const docsOf = async (pid) => ((await store.get(K.pt(sid, pid))) || { list: [] }).list;
  const refresh = (p, docs) => { const L = ledger(p, docs, today); p.s = L.s; return L; };
  const origin = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(String(b.origin || "")) ? b.origin : (ctx.env && ctx.env.URL) || "";

  if (op === "boot") {
    const inbox = ((await store.get(K.inbox(sid))) || { list: [] }).list.filter((x) => !x.done).slice(0, 80);
    const ym = today.slice(0, 7), D = (await store.get(K.day(sid, ym))) || { days: {} };
    const months = lastMonths(today, 3), mv = await loadMv(store, sid, months);
    if (B._legacy && B.prods.length) await saveProds();
    return json(200, Object.assign({ ok: true, shop: shopOut(shop), parties: B.parties }, allP(), { inbox, today, todayDay: D.days[today] || null, month: D.days, vel: velocity(mv, months, today), modes: MODES, by }));
  }
  if (op === "shop-save") {
    const n = cleanShop(b.shop, shop); n.id = sid; await store.set(K.shop(sid), Object.assign({}, n, { pk: shop.pk }));
    const S = (await store.get(K.shops)) || { list: [] }, e = S.list.find((x) => x.id === sid); if (e) { e.name = n.name; e.owner = n.owner; e.city = n.city; e.state = n.state; await store.set(K.shops, S); }
    await addLog(store, sid, t, by, "Shop settings saved"); return json(200, { ok: true, shop: shopOut(n) });
  }
  if (op === "keys") {   // WhatsApp auto-send (Periskope) — key is write-only
    const n = Object.assign({}, shop);
    if (b.clear) n.pk = null; else { const k = String(b.pkKey || "").trim(); if (k && (k.length < 10 || k.length > 4000)) return json(400, { ok: false, error: "That key doesn't look right." }); n.pk = { key: k || (shop.pk && shop.pk.key) || "", phone: ph10(b.pkPhone) || (shop.pk && shop.pk.phone) || "" }; if (!n.pk.key) return json(400, { ok: false, error: "Paste the API key." }); }
    await store.set(K.shop(sid), n); await addLog(store, sid, t, by, b.clear ? "WhatsApp auto-send disconnected" : "WhatsApp auto-send connected"); return json(200, { ok: true, shop: shopOut(n) });
  }

  // ----- items -----
  if (op === "prod-save") {
    const x = b.item || {}, old = x.id ? PM[cid(x.id)] : null, n = cleanProd(x, old);
    if (!n.n) return json(400, { ok: false, error: "Item name is needed." });
    if (!old && B.prods.some((p) => p.on !== false && p.n.toLowerCase() === n.n.toLowerCase() && (p.u || "") === n.u)) return json(409, { ok: false, error: "An item with this name already exists." });
    if (!old && x.stk && !n.ns) { n.stk = qn(x.stk); if (n.stk > 0) n.lots = [{ d: day(x.lp) || today, q: n.stk, c: n.cost, e: day(x.e), doc: "open" }]; }
    if (old) { const nv = { cost: n.cost, sp: n.sp, mrp: n.mrp }; Object.keys(PF).forEach((f) => { n[f] = old[f]; }); Object.assign(old, n); Object.keys(PF).forEach((f) => priceSet(old, f, nv[f], "edit", today)); } else { B.prods.push(n); if (B.prods.length > 6000) return json(400, { ok: false, error: "Too many items (6,000 max)." }); }
    await saveProds();
    const sv = old || n; if (sv.bc && /^\d{8,14}$/.test(sv.bc) && sv.n) { const c0 = await store.get("kh:bc:" + sv.bc); if (!c0 || !c0.name || c0.src !== "shop") await store.set("kh:bc:" + sv.bc, { name: sv.n, brand: sv.br || "", qty: "", mrp: sv.mrp || 0, src: "shop", at: t }); }   // teach the shared barcode book
    return json(200, { ok: true, item: sv });
  }
  if (op === "prod-bulk") {   // Excel import: match by id, barcode or name; never touches stock of existing items
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 3000) : []; let add = 0, upd = 0;
    const byName = {}; B.prods.forEach((p) => { byName[p.n.toLowerCase() + "|" + (p.u || "")] = p; if (p.bc) byName["bc:" + p.bc] = p; });
    for (const r of rows) {
      if (!str(r.n, 90)) continue; const u = str(r.u, 12) || "pc";
      const rbc = r.bc ? String(r.bc).replace(/\.0$/, "").trim() : "", nm = byName[str(r.n, 90).toLowerCase() + "|" + u] || byName[str(r.n, 90).toLowerCase() + "|pc"];
      if (rbc) r.bc = rbc;
      // same name but a different barcode = a different pack / variant → its own item
      const old = (r.id && PM[cid(r.id)]) || (rbc && byName["bc:" + str(rbc, 40)]) || (nm && (!rbc || !nm.bc || nm.bc === rbc) ? nm : null);
      const clean = {}; Object.keys(r).forEach((k) => { if (r[k] !== "" && r[k] != null) clean[k] = r[k]; });
      if (old) { const n = cleanProd(clean, old), nv = { cost: n.cost, sp: n.sp, mrp: n.mrp }; Object.keys(PF).forEach((f) => { n[f] = old[f]; }); Object.assign(old, n); Object.keys(PF).forEach((f) => priceSet(old, f, nv[f], "import", today)); upd++; }
      else { const n = cleanProd(clean, null); if (clean.stk) { n.stk = qn(clean.stk); if (n.stk > 0) n.lots = [{ d: today, q: n.stk, c: n.cost, e: day(clean.e), doc: "open" }]; } B.prods.push(n); byName[n.n.toLowerCase() + "|" + n.u] = n; if (n.bc) byName["bc:" + n.bc] = n; add++; }
    }
    if (B.prods.length > MAXP) return json(400, { ok: false, error: "Too many items (60,000 max)." });
    await saveProds(); if (!b.quiet || b.last) await addLog(store, sid, t, by, `Items imported: ${add} new, ${upd} updated`); return json(200, Object.assign({ ok: true, add, upd }, b.quiet && !b.last ? { pv: B._pv, pcount: B.prods.length, noFetch: true } : allP()));
  }
  if (op === "prod-price") {   // set selling prices from a target margin (category or selected items)
    const ids = new Set((b.ids || []).map(cid)), m = num(b.margin); let n = 0;
    if (!(m >= 0 && m < 500)) return json(400, { ok: false, error: "Enter a margin %." });
    for (const p of B.prods) { if (!ids.has(p.id) || !p.cost) continue; let sp = p.cost * (1 + m / 100); sp = b.round ? Math.ceil(sp) : r2(sp); if (p.mrp && sp > p.mrp && !b.overMrp) sp = p.mrp; priceSet(p, "sp", sp, "margin", today); n++; }
    await saveProds(); await addLog(store, sid, t, by, `Selling price set at ${m}% margin for ${n} items`); return json(200, Object.assign({ ok: true, n }, allP()));
  }
  if (op === "prod-del") { const p = PM[cid(b.id)]; if (!p) return json(404, { ok: false, error: "Not found" }); p.on = false; await saveProds(); return json(200, { ok: true }); }
  if (op === "count") {   // physical stock count: the difference is stock used / sold (feeds re-order speed)
    const rows = Array.isArray(b.rows) ? b.rows : [], d = day(b.d) || today, mv = await loadMv(store, sid, [d.slice(0, 7)]), out = [];
    for (const r of rows) {
      const p = PM[cid(r.p)]; if (!p || r.c === "" || r.c == null) continue; const c = qn(r.c), dl = qn(c - (p.stk || 0)); if (!dl) continue;
      const mp = (mv[d.slice(0, 7)].p[p.id] = mv[d.slice(0, 7)].p[p.id] || { i: 0, o: 0 });
      if (dl < 0) { consume(p, -dl); mp.o = qn(mp.o - dl); } else p.lots.push({ d, q: dl, c: p.cost, e: "", doc: "count" });
      p.stk = c; out.push({ n: p.n, from: qn(c - dl), to: c });
    }
    await saveProds(); await saveMv(store, sid, mv); if (out.length) await addLog(store, sid, t, by, "Stock count: " + out.slice(0, 12).map((x) => `${x.n} ${x.from}→${x.to}`).join(", ") + (out.length > 12 ? ` +${out.length - 12} more` : ""));
    return json(200, Object.assign({ ok: true, changed: out.length }, allP()));
  }

  if (op === "stock-bulk") {   // ⬆ bulk stock update from Excel: set the counted stock or add received stock, item by item
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 3000) : [], mvm = await loadMv(store, sid, [today.slice(0, 7)]), mm = mvm[today.slice(0, 7)];
    const byName = {}; B.prods.forEach((p) => { if (p.on === false) return; byName[p.n.toLowerCase()] = byName[p.n.toLowerCase()] || p; if (p.bc) byName["bc:" + p.bc] = p; });
    let set = 0, added = 0, created = 0, prices = 0; const missing = [], lines = [];
    for (const r of rows) {
      const nm = str(r.n, 90); if (!nm && !r.bc && !r.id) continue;
      let p = (r.id && PM[cid(r.id)]) || (r.bc && byName["bc:" + str(r.bc, 40)]) || (nm && byName[nm.toLowerCase()]);
      if (!p) { if (!b.create || !nm) { missing.push(nm || r.bc); continue; } p = cleanProd({ n: nm, u: r.u, cat: r.cat, bc: r.bc, cost: r.cost, sp: r.sp, mrp: r.mrp, gst: r.gst }, null); B.prods.push(p); PM[p.id] = p; byName[nm.toLowerCase()] = p; created++; }
      ["cost", "sp", "mrp"].forEach((f) => { if (r[f] !== undefined && r[f] !== "" && priceSet(p, f, r[f], "stock import", today)) prices++; });
      if (r.q === undefined || r.q === "" || r.q == null) continue;
      const q = qn(r.q), mode = /^(add|in|\+|received|purchase)/i.test(String(r.mode || "")) ? "add" : "set", mp = (mm.p[p.id] = mm.p[p.id] || { i: 0, o: 0 }), from = p.stk || 0;
      if (mode === "add") { if (q <= 0) continue; p.lots.push({ d: day(r.d) || today, q, c: num(r.cost) || p.cost, e: day(r.e), doc: "import", b: str(r.b, 20) }); p.stk = qn(from + q); mp.i = qn(mp.i + q); added++; }
      else { const dl = qn(q - from); if (dl < 0) { consume(p, -dl); mp.o = qn(mp.o - dl); } else if (dl > 0) p.lots.push({ d: today, q: dl, c: p.cost, e: day(r.e), doc: "count" }); p.stk = q; set++; }
      lines.push(`${p.n} ${from}→${p.stk}`);
    }
    if (B.prods.length > MAXP) return json(400, { ok: false, error: "Too many items (60,000 max)." });
    await saveProds(); await saveMv(store, sid, mvm);
    await addLog(store, sid, t, by, `Stock import: ${set} counted, ${added} received, ${created} new items, ${prices} price changes` + (lines.length ? " — " + lines.slice(0, 8).join(", ") + (lines.length > 8 ? " …" : "") : ""));
    return json(200, Object.assign({ ok: true, set, added, created, prices, missing: missing.slice(0, 200) }, b.quiet && !b.last ? { noFetch: true } : allP()));
  }
  if (op === "price-bulk") {   // 📈 price list update (Excel / distributor rate list) — every change goes into the history
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 3000) : [], ch = [], missing = [];
    const byName = {}; B.prods.forEach((p) => { if (p.on === false) return; byName[p.n.toLowerCase()] = byName[p.n.toLowerCase()] || p; if (p.bc) byName["bc:" + p.bc] = p; });
    for (const r of rows) {
      const nm = str(r.n, 90), p = (r.id && PM[cid(r.id)]) || (r.bc && byName["bc:" + str(r.bc, 40)]) || (nm && byName[nm.toLowerCase()]); if (!p) { if (nm) missing.push(nm); continue; }
      ["cost", "sp", "mrp"].forEach((f) => { const o = p[f]; if (r[f] !== undefined && r[f] !== "" && priceSet(p, f, r[f], str(r.src, 20) || "price list", day(r.d) || today)) ch.push({ n: p.n, f, o, nv: p[f] }); });
      if (b.keepMargin && r.cost && !r.sp && p.sp && ch.length && ch[ch.length - 1].n === p.n && ch[ch.length - 1].f === "cost") { const c0 = ch[ch.length - 1]; const m = c0.o > 0 ? (p.sp - c0.o) / c0.o : 0; let sp = Math.ceil(p.cost * (1 + m)); if (p.mrp && sp > p.mrp) sp = p.mrp; const o = p.sp; if (priceSet(p, "sp", sp, "keep margin", today)) ch.push({ n: p.n, f: "sp", o, nv: sp }); }
    }
    await saveProds(); await addLog(store, sid, t, by, `Price update: ${ch.length} changes` + (ch.length ? " — " + ch.slice(0, 6).map((c) => `${c.n} ${PF[c.f]} ${c.o}→${c.nv}`).join(", ") : ""));
    return json(200, Object.assign({ ok: true, changes: ch.slice(0, 2000), nch: ch.length, missing: missing.slice(0, 200) }, b.quiet && !b.last ? { noFetch: true } : allP()));
  }
  if (op === "price-hist" || op === "price-ai") {   // drops & hikes of the last N days, and AI advice on them
    const days = Math.max(1, Math.min(365, Math.round(num(b.days) || 30))), from = addD(today, -days), L = [];
    B.prods.forEach((p) => { if (p.on === false) return; (p.prh || []).forEach((h) => { if (h.d >= from) L.push({ id: p.id, n: p.n, cat: p.cat, u: p.u, stk: p.stk, cost: p.cost, sp: p.sp, mrp: p.mrp, d: h.d, f: h.f, o: h.o, nv: h.n, pct: h.o ? Math.round((h.n - h.o) / h.o * 1000) / 10 : 0, src: h.src }); }); });
    L.sort((a, c) => (a.d < c.d ? 1 : a.d > c.d ? -1 : Math.abs(c.pct) - Math.abs(a.pct)));
    if (op === "price-hist") return json(200, { ok: true, days, list: L.slice(0, 600) });
    if (!L.length) return json(200, { ok: true, ai: { headline: "No price changes in the last " + days + " days.", items: [], message: "" } });
    const months = lastMonths(today, 3), vel = velocity(await loadMv(store, sid, months), months, today);
    const facts = L.slice(0, 60).map((x) => `${x.n} (${x.cat}): ${PF[x.f]} ${x.o}→${x.nv} (${x.pct > 0 ? "+" : ""}${x.pct}%) on ${x.d}; now cost ${x.cost}, selling ${x.sp}, MRP ${x.mrp}, stock ${x.stk} ${x.u}, sells ${vel[x.id] || 0}/day`).join("\n");
    const lang = b.lang === "en" ? "English" : "simple Hindi (Devanagari) mixed with common English business words";
    const r = await ctx.askAI(ctx.env, "Advise the shop owner on these price drops and hikes.", facts, [], ctx.aiFetch, { system: `You advise an Indian kirana shop owner on price changes. Reply in ${lang} as JSON only: {"headline":"one line","items":[{"n":"exact item name","kind":"hike|drop","advice":"one practical sentence (raise / keep selling price, buy more before the next hike, sell old stock first, tell customers, etc.)","newSp":0}],"message":"a short friendly WhatsApp message for regular customers announcing the PRICE DROPS / offers only (empty if there are none)"}. newSp = suggested selling price in rupees (0 = keep). Never suggest a selling price above MRP.`, label: "SHOP DATA", maxTokens: 1800, json: true, raw: true });
    const j = r.ok ? parseLoose(r.text) : null; if (!j || !Array.isArray(j.items)) return json(200, { ok: false, error: r.error || "The AI reply couldn't be read — try again." });
    j.items = j.items.slice(0, 40).map((x) => { const p = B.prods.find((y) => y.n.toLowerCase() === str(x.n, 90).toLowerCase()); let sp = num(x.newSp); if (p && p.mrp && sp > p.mrp) sp = p.mrp; return { id: p ? p.id : "", n: str(x.n, 90), kind: x.kind === "drop" ? "drop" : "hike", advice: str(x.advice, 300), newSp: sp }; });
    return json(200, { ok: true, ai: { headline: str(j.headline, 200), items: j.items, message: str(j.message, 1200) } });
  }
  if (op === "broadcast") {   // send one message (e.g. price-drop offer) to chosen customers — auto WhatsApp needs Periskope
    const text = String(b.text || "").slice(0, 1500).trim(); if (text.length < 5) return json(400, { ok: false, error: "Write the message." });
    const ids = (Array.isArray(b.pids) ? b.pids : []).map(cid).slice(0, 60), L = ids.map((id) => RM[id]).filter((p) => p && p.on !== false && (p.wa || p.ph));
    if (!shop.pk || !shop.pk.key) return json(200, { ok: true, auto: false, list: L.map((p) => ({ id: p.id, n: pname0(p), wa: p.wa || p.ph })) });
    let sent = 0; const fails = [];
    for (const p of L) { const r = await sendWa(ctx, shop, p.wa || p.ph, text.replace(/\{name\}/g, p.n || p.firm || "")); if (r.ok) sent++; else fails.push(pname0(p) + ": " + r.error); }
    await addLog(store, sid, t, by, `Message sent to ${sent} of ${L.length} customers`); return json(200, { ok: true, auto: true, sent, fails });
  }
  if (op === "list-read" || op === "read-order") {   // ✨ a list (photo / voice / typed) → bill lines with quantity, in any Indian language
    let text = String(b.text || "").slice(0, 6000).trim(), heard = "";
    if (b.audio) {
      const st = await speechToText(ctx, store, String(b.audio));
      if (!st.ok) return json(502, { ok: false, error: st.error });
      text = heard = st.text; if (!text.trim()) return json(400, { ok: false, error: "Couldn't hear any items — speak a little slower, close to the phone." });
    }
    const imgs = (Array.isArray(b.images) ? b.images : []).filter((u) => /^data:image\/(jpeg|png|webp);base64,/.test(String(u)) && String(u).length < 4000000).slice(0, 4);
    const who = b.mode === "po" ? "an order a shop owner is placing with his distributor / wholesaler" : "a customer's shopping list for an Indian grocery (kirana) shop";
    const shape = `{"items":[{"name":"English name","hi":"हिंदी नाम","written":"as written","qty":0,"unit":"kg|g|L|ml|pc|pkt|box|bag|dozen","amount":0}]}`;
    let raw = null;
    if (imgs.length) {
      const keys = await aiKeys(store, ctx.env);
      const ASKP = `This photo is ${who}. It may be handwritten or printed, in Hindi (Devanagari), English, Hinglish (Hindi in English letters) or another Indian language (Punjabi, Gujarati, Marathi, Bengali, Tamil, Telugu, Kannada, Malayalam, Odia, Urdu). Read EVERY line carefully, letter by letter. Reply with ONLY JSON: ${shape}\n${LIST_RULES}`;
      // 1) quick pass (no long thinking, 20 s limit). 2) if that gives no items, a careful pass with thinking, then Groq. An answer only counts if it has items.
      const hasItems = (tx) => { const r0 = parseLoose(tx); return !!(r0 && Array.isArray(r0.items) && r0.items.some((x) => x && (x.name || x.hi || x.written))); };
      let v = await readImages(keys, ctx.env, imgs, ctx.aiFetch, ASKP, { prefer: "gemini", fast: true, json: true, accept: hasItems, timeout: 20000, maxModels: 2, noGroq: true });
      if (!v.ok) { const e1 = v.error; v = await readImages(keys, ctx.env, imgs, ctx.aiFetch, ASKP + "\nThe handwriting may be hard to read — look again slowly and list every line you can make out, even if unsure.", { prefer: "gemini", json: true, accept: hasItems, timeout: 55000, maxModels: 2 }); if (!v.ok) v.error = e1 + " | " + v.error; }
      if (!v.ok) return json(502, { ok: false, error: /empty answer/.test(String(v.error)) && !/\b(4\d\d|5\d\d)\b|too long/.test(String(v.error)) ? "No items could be read from this photo — take it straight from above, in good light, with the whole list inside." : "Couldn't read the photo right now (" + String(v.error).slice(0, 160) + "). Try again in a moment." });
      raw = parseLoose(v.text);
    } else {
      if (text.length < 2) return json(400, { ok: false, error: "Write or speak the items first." });
      const r = await ctx.askAI(ctx.env, text, "", [], ctx.aiFetch, { system: `You turn ${who} into bill lines. The text may be typed or spoken (speech-to-text), in Hindi, English, Hinglish or another Indian language, and may be one long sentence ("do kilo cheeni, ek packet maggi aur aadha kilo chana dal"). Reply with ONLY JSON: ${shape}\n${LIST_RULES}`, label: "LIST", maxTokens: 2500, json: true, raw: true });
      if (!r.ok) return json(502, { ok: false, error: r.error || "AI is busy — try again." });
      raw = parseLoose(r.text);
    }
    if (!raw || !Array.isArray(raw.items)) return json(502, { ok: false, error: "The list couldn't be read clearly — try again (whole list in the photo, or speak item by item)." });
    const items = raw.items.slice(0, 150).map(fixLine).filter((x) => x && x.name);
    if (!items.length) return json(400, { ok: false, error: "No items found in that. Try again." });
    return json(200, { ok: true, items, heard });
  }
  if (op === "i18n-get" || op === "i18n") {   // 🌐 app screens in Hindi / Hinglish — translated once by AI, shared by every shop
    const lang = b.lang === "hn" ? "hn" : "hi", key = "kh:i18n:" + lang, M = (await store.get(key)) || { map: {} };
    if (op === "i18n-get") return json(200, { ok: true, map: M.map, n: Object.keys(M.map).length });
    const want = [...new Set((Array.isArray(b.keys) ? b.keys : []).map((k) => String(k).slice(0, 300)).filter((k) => k.length > 1 && !M.map[k]))].slice(0, 70);
    if (!want.length) return json(200, { ok: true, map: {} });
    const sys = lang === "hi"
      ? "Translate the on-screen labels of a mobile khata (accounts, billing and stock) app for Indian kirana shop owners into simple, everyday Hindi in Devanagari — the words a shopkeeper actually uses (बिक्री, खरीद, उधार, बकाया, भुगतान, माल, ग्राहक, वितरक). Keep these as they are or in common Devanagari form: UPI, GST, WhatsApp, PDF, Excel, MRP, AI, SMS, OTP, IMEI, QR, e-mail, link, app. Keep emojis, ₹, and the {#} placeholders exactly. Keep the meaning short — button labels stay short."
      : "Translate the on-screen labels of a mobile khata (accounts, billing and stock) app for Indian kirana shop owners into Hinglish — conversational Hindi written in English letters, the way shopkeepers text (e.g. 'Aaj ki bikri', 'Udhaar', 'Baaki paise', 'Grahak', 'Maal', 'Bill banao', 'Payment mila'). Common English words (bill, stock, item, UPI, GST, WhatsApp, Excel, MRP, rate) stay English. Keep emojis, ₹ and the {#} placeholders exactly. Keep button labels short.";
    const r = await ctx.askAI(ctx.env, "Translate each value. Reply with ONLY JSON {\"t\":{\"<original>\":\"<translation>\"}} with every original as a key.", JSON.stringify(want), [], ctx.aiFetch, { system: sys, label: "LABELS", maxTokens: 3500, json: true, raw: true });
    const j = r.ok ? parseLoose(r.text) : null, add = {};
    if (j && j.t && typeof j.t === "object") want.forEach((k) => { const v = j.t[k]; if (typeof v === "string" && v.trim() && v.length < 600 && (k.match(/\{#\}/g) || []).length === (v.match(/\{#\}/g) || []).length) add[k] = v.trim(); });
    if (Object.keys(add).length) { const M2 = (await store.get(key)) || { map: {} }; Object.assign(M2.map, add); await store.set(key, M2); }
    return json(200, { ok: !!Object.keys(add).length || !want.length, map: add, error: r.ok ? "" : r.error });
  }
  if (op === "match-ai") {   // AI picks the right item (shop list or catalogue) for lines the simple search wasn't sure about
    const L = (Array.isArray(b.lines) ? b.lines : []).slice(0, 80).map((x, i) => ({ i: num(x.i) || i, name: str(x.name, 90), hi: str(x.hi, 90), written: str(x.written, 90), unit: str(x.unit, 10), cands: (Array.isArray(x.cands) ? x.cands : []).slice(0, 8).map((c) => ({ k: str(c.k, 80), n: str(c.n, 100) })) })).filter((x) => x.cands.length);
    if (!L.length) return json(200, { ok: true, picks: [] });
    const facts = L.map((x) => `LINE ${x.i}: "${x.name}"${x.hi ? " / " + x.hi : ""}${x.written ? " (written: " + x.written + ")" : ""}${x.unit ? " [" + x.unit + "]" : ""}\n` + x.cands.map((c) => `  - ${c.k}: ${c.n}`).join("\n")).join("\n");
    const r = await ctx.askAI(ctx.env, "Pick the matching product for each line.", facts, [], ctx.aiFetch, { system: `You match lines from an Indian kirana list to the shop's products. For each LINE choose the candidate key that is the SAME product (same item; same brand if a brand is written; for loose goods like sugar / dal / chana, a loose or any-brand candidate of that item is fine; pack size can differ only for loose goods). Hindi names: cheeni/चीनी = sugar, maida = refined flour, atta = wheat flour, besan = gram flour, suji/rava = semolina, chhole/kabuli chana = chickpeas, rajma = kidney beans, arhar/toor/tuvar = pigeon pea dal, masoor = red lentil, moong = green gram, urad = black gram, namak = salt, tel = oil, sarson = mustard, ghee, gud = jaggery, haldi = turmeric, mirch = chilli, dhaniya = coriander, jeera = cumin, chai patti = tea, sabun = soap, ande = eggs, doodh = milk, chawal = rice, poha = flattened rice, sabudana = sago. Brand rule: if the line does NOT mention a brand and the product is a packaged / branded item, answer "" (the shop bills it as written) — a brand may be picked only for loose goods sold by weight (atta, sugar, dal, rice…) or when the line names that brand. If no candidate is the same product, answer "". Reply with ONLY JSON: {"picks":[{"i":0,"k":"key or empty"}]}`, label: "MATCH", maxTokens: 1500, json: true, raw: true });
    const j = r.ok ? parseLoose(r.text) : null;
    return json(200, { ok: true, picks: j && Array.isArray(j.picks) ? j.picks.map((x) => ({ i: num(x.i), k: str(x.k, 80) })) : [] });
  }
  if (op === "bc-find") {   // 📷 barcode not in my items → shared cache → product databases → web search (name, brand, size, MRP)
    const code = String(b.code || "").replace(/\D/g, "").slice(0, 14); if (code.length < 8) return json(400, { ok: false, error: "That barcode looks too short." });
    const cache = await store.get("kh:bc:" + code); if (cache && (cache.name || (cache.miss && t - cache.at < 7 * 864e5 && !b.deep))) return json(200, Object.assign({ ok: true, cached: true }, cache));
    let out = { name: "", brand: "", qty: "", mrp: 0, src: "" };
    const tidy = () => { if (out.brand && out.name.toLowerCase().indexOf(out.brand.toLowerCase()) < 0) out.name = out.brand + " " + out.name; if (out.qty && out.name.toLowerCase().replace(/\s/g, "").indexOf(String(out.qty).toLowerCase().replace(/\s/g, "")) < 0) out.name += " " + out.qty; };
    const get = async (u, h) => { try { const r = await ctx.aiFetch(u, { headers: Object.assign({ "user-agent": "ShopKhata/1.0 (kirana billing)", accept: "application/json" }, h || {}) }); return r.ok ? await r.json().catch(() => null) : null; } catch (e) { return null; } };
    for (const host of ["in.openfoodfacts.org", "world.openfoodfacts.org", "world.openproductsfacts.org", "world.openbeautyfacts.org"]) {
      const j = await get(`https://${host}/api/v2/product/${code}.json?fields=product_name,product_name_en,product_name_hi,generic_name,brands,quantity`);
      const pr = j && j.status === 1 && j.product; if (pr && (pr.product_name || pr.product_name_en || pr.generic_name)) { out = { name: str(pr.product_name_en || pr.product_name || pr.generic_name, 90), brand: str(String(pr.brands || "").split(",")[0], 40), qty: str(pr.quantity, 30), mrp: 0, src: "openfoodfacts" }; break; }
    }
    if (!out.name) { const j = await get("https://api.upcitemdb.com/prod/trial/lookup?upc=" + code); const it = j && Array.isArray(j.items) && j.items[0]; if (it && it.title) out = { name: str(it.title, 90), brand: str(it.brand, 40), qty: str(it.size, 30), mrp: 0, src: "upcitemdb" }; }
    // web search: Indian shopping sites list most EAN codes with the product name and MRP
    if (!out.name || !out.mrp) {
      try {
        const r = await research(store, ctx.env, { queries: [code + " barcode", code + " MRP", '"' + code + '" product'], validate: (d) => d && typeof d === "object",
          prompt: `Find the packaged product sold in India whose barcode (EAN / GTIN) is ${code}${out.name ? " (a database says: " + out.name + ")" : ""}. Use only results that show this exact number. Reply with ONLY JSON: {"name":"brand + product + variant","brand":"","pack":"net quantity e.g. 70 g / 1 L","mrp":0,"category":"","source":"url"} — mrp = printed MRP in rupees if a page shows it, else 0. If no page shows this exact barcode, reply {"name":""}.` }, { fetchImpl: ctx.aiFetch, now: () => t });
        const d = r.ok ? r.data || {} : {};
        if (d.name && !out.name) out = { name: str(d.name, 90), brand: str(d.brand, 40), qty: str(d.pack, 30), mrp: num(d.mrp), src: "web", cat: str(d.category, 40) };
        else if (out.name && num(d.mrp) > 0) out.mrp = num(d.mrp);
      } catch (e) { }
    }
    if (out.name) tidy();
    await store.set("kh:bc:" + code, out.name ? Object.assign({}, out, { at: t }) : { miss: true, at: t });   // shared by every shop: each barcode is searched once
    return json(200, Object.assign({ ok: true }, out));
  }
  if (op === "pack-read") {   // 📷 photo of the pack → name, MRP, net quantity, barcode (Indian packs must print the MRP)
    const imgs = (Array.isArray(b.images) ? b.images : []).filter((u) => /^data:image\/(jpeg|png|webp);base64,/.test(String(u)) && String(u).length < 4000000).slice(0, 2);
    if (!imgs.length) return json(400, { ok: false, error: "Take a photo of the pack." });
    const keys = await aiKeys(store, ctx.env);
    const v = await readImages(keys, ctx.env, imgs, ctx.aiFetch, 'This is a photo of a packaged product sold in India. Read the printed label. Reply with ONLY JSON: {"name":"product name with brand and variant in English","brand":"","net":"net quantity e.g. 500 g / 1 L / 10 pcs","mrp":0,"barcode":"digits under the barcode if visible","category":"e.g. Biscuits, Dal, Oil, Soap"} — mrp = the number after "MRP" / "M.R.P." / "Max. Retail Price" (incl. of all taxes) in rupees; if several MRPs, the latest / not crossed out. 0 if you cannot see it. Never guess.', { prefer: "gemini", fast: true, json: true });
    if (!v.ok) return json(502, { ok: false, error: "Couldn't read the pack (" + String(v.error).slice(0, 120) + ")." });
    const j = parseLoose(v.text) || {};
    return json(200, { ok: true, name: str(j.name, 90), brand: str(j.brand, 40), net: str(j.net, 30), mrp: num(j.mrp), bc: String(j.barcode || "").replace(/\D/g, "").slice(0, 14), cat: str(j.category, 40) });
  }
  if (op === "rules-run") {   // ⚙️ run the rules now (or preview: dry)
    const res = await runRules(ctx, store, sid, B, { dry: b.dry === true, origin, today, t });
    return json(200, Object.assign({ ok: true }, res));
  }
  if (op === "rules-log") return json(200, { ok: true, list: ((await store.get("kh:rlog:" + sid)) || { list: [] }).list.slice(0, 300) });
  if (op === "rules-ai") {   // ✨ describe a rule in words → a rule the engine understands
    const q = str(b.q, 500); if (q.length < 6) return json(400, { ok: false, error: "Describe the rule in a sentence." });
    const sys = `Turn the shop owner's sentence into automation rules for an Indian kirana shop khata app. Reply with JSON only: {"rules":[{"name":"short name","who":"c (customers) or d (distributors)","grp":"customer group or empty for all — one of: ${shop.grps.join(", ")}","trig":"one of: ${Object.entries(TRIGS).map(([k, v]) => k + " = " + v).join("; ")}","n":0,"acts":["any of: ${Object.entries(ACTS).map(([k, v]) => k + " = " + v).join("; ")}"],"every":0,"rate":0,"msg":"optional extra line added to the WhatsApp / e-mail"}]}. n = the number of days or rupees in the trigger. every = repeat every N days while it stays true (0 = once). rate = interest % per month (only with the interest action).`;
    const r = await ctx.askAI(ctx.env, q, "GROUPS: " + shop.grps.join(", "), [], ctx.aiFetch, { system: sys, label: "RULE", maxTokens: 900, json: true, raw: true });
    const j = r.ok ? parseLoose(r.text) : null; if (!j || !Array.isArray(j.rules) || !j.rules.length) return json(200, { ok: false, error: r.error || "Couldn't turn that into a rule — try saying who, when and what should happen." });
    return json(200, { ok: true, rules: cleanRules(j.rules.map((x) => Object.assign({}, x, { id: "" }))) });
  }

  if (op === "party-photo") {   // 📷 customer / distributor photo — a small thumbnail lives with the party, the full photo separately
    const p = RM[cid(b.pid)]; if (!p) return json(404, { ok: false, error: "Not found." });
    if (b.remove) { p.av = ""; await store.delete("kh:pimg:" + sid + ":" + p.id); }
    else {
      const img = String(b.img || ""), av = String(b.av || "");
      if (!/^data:image\/(jpeg|webp|png);base64,/.test(img) || img.length > 400000 || !/^data:image\/(jpeg|webp|png);base64,/.test(av) || av.length > 20000) return json(400, { ok: false, error: "Photo is too large or not an image." });
      await store.set("kh:pimg:" + sid + ":" + p.id, { img, at: t }); p.av = av;
    }
    await store.set(K.party(sid), { list: B.parties, at: t }); return json(200, { ok: true, party: p });
  }
  // 🖼 item pictures: a small thumbnail per item (own photo) or a web picture found from the barcode
  if (op === "prod-img") {
    const pr = PM[cid(b.id)]; if (!pr) return json(404, { ok: false, error: "Item not found." });
    if (b.remove) { delete pr.im; delete pr.iu; pr.ix = 1; await store.delete(pimK(sid, pr.id)); }
    else { const img = String(b.img || ""); if (!IMG_RE.test(img) || img.length > 60000) return json(400, { ok: false, error: "Photo is too large or not an image." }); await store.set(pimK(sid, pr.id), { img, at: t }); pr.im = t.toString(36); delete pr.iu; }
    await saveProds(); return json(200, { ok: true, prod: pr, img: b.remove ? "" : String(b.img) });
  }
  if (op === "prod-imgs") { const ids = (Array.isArray(b.ids) ? b.ids : []).map(cid).filter(Boolean).slice(0, 60), imgs = {}; await Promise.all(ids.map(async (id) => { const x = await store.get(pimK(sid, id)); if (x && x.img) imgs[id] = x.img; })); return json(200, { ok: true, imgs }); }
  if (op === "img-auto") {   // look up a pack picture on Open Food Facts for items that have a barcode and no picture yet
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(cid).filter(Boolean).slice(0, 12), done = [];
    await Promise.all(ids.map(async (id) => { const pr = PM[id]; if (!pr || pr.im || pr.iu || pr.ix || !/^\d{8,14}$/.test(String(pr.bc || ""))) return; pr.ix = 1; done.push(pr);
      for (const host of ["in.openfoodfacts.org", "world.openfoodfacts.org"]) { try { const r = await ctx.aiFetch(`https://${host}/api/v2/product/${pr.bc}.json?fields=image_front_small_url,image_small_url`, { headers: { "user-agent": "ShopKhata/1.0 (kirana billing)", accept: "application/json" } }); const j = r.ok ? await r.json().catch(() => null) : null, u = j && j.status === 1 && j.product && (j.product.image_front_small_url || j.product.image_small_url); if (IU_RE.test(String(u || ""))) { pr.iu = String(u).slice(0, 200); delete pr.ix; break; } } catch (e) { /* next host */ } } }));
    if (done.length) await saveProds(); return json(200, { ok: true, prods: done });
  }
  if (op === "party-photo-get") { const x = await store.get("kh:pimg:" + sid + ":" + cid(b.pid)); return json(200, { ok: true, img: x ? x.img : "" }); }
  // ----- parties -----
  if (op === "party-save") {
    const x = b.party || {}, old = x.id ? RM[cid(x.id)] : null, n = cleanParty(x, old, shop);
    if (!n.n && !n.firm) return json(400, { ok: false, error: "Name is needed." });
    if (old) Object.assign(old, n); else { if (B.parties.length > 3000) return json(400, { ok: false, error: "Too many parties." }); B.parties.push(n); }
    const p = old || n; refresh(p, await docsOf(p.id)); await saveParties(); await addLog(store, sid, t, by, (old ? "Updated " : "Added ") + (p.k === "c" ? "customer " : "distributor ") + (p.n || p.firm));
    return json(200, { ok: true, party: p });
  }
  if (op === "party-bulk") {
    let add = 0; for (const r of (b.rows || []).slice(0, 2000)) { if (!str(r.n, 80)) continue; const ex = B.parties.find((p) => p.k === (r.k === "d" ? "d" : "c") && (p.n.toLowerCase() === str(r.n, 80).toLowerCase() || (ph10(r.ph) && p.ph === ph10(r.ph)))); if (ex) { Object.assign(ex, cleanParty(r, ex, shop)); continue; } const n = cleanParty(r, null, shop); n.s = ledger(n, [], today).s; B.parties.push(n); add++; }
    await saveParties(); return json(200, { ok: true, add, parties: B.parties });
  }
  if (op === "ledger") {
    const p = RM[cid(b.pid)]; if (!p) return json(404, { ok: false, error: "Not found" });
    const docs = await docsOf(p.id), L = refresh(p, docs); await saveParties();
    return json(200, { ok: true, party: p, docs, rows: L.rows, bills: L.bills, s: L.s });
  }
  if (op === "link") {   // the party's own secure page
    const p = RM[cid(b.pid)]; if (!p) return json(404, { ok: false, error: "Not found" });
    if (b.reset && p.tok) { await store.delete(K.link(p.tok)); p.tok = ""; }
    await ensureLink(store, sid, p); await saveParties(); return json(200, { ok: true, tok: p.tok, url: linkUrl(origin, p.tok), hasPhone: !!p.ph });
  }

  // ----- documents: bills, payments, returns, adjustments, orders -----
  if (op === "doc-save") {
    const p = RM[cid(b.pid)]; if (!p) return json(404, { ok: false, error: "Choose the customer / distributor." });
    const docs = await docsOf(p.id), x = b.doc || {}, old = x.id ? docs.find((d) => d.id === cid(x.id)) : null;
    if (old && old.void) return json(400, { ok: false, error: "This entry was cancelled." });
    const n = cleanDoc(x, old, p, shop); if (!n) return json(400, { ok: false, error: "Unknown entry type." });
    if (!n.amt && n.ty !== "po") return json(400, { ok: false, error: "Enter the amount or the items." });
    if (!old && n.ty === "sale" && n.st === "final" && n.amt - n.paid > 0.5 && !b.override) {   // ⚙️ credit stopped / limit — the owner decides
      const s0 = p.s || {}, after = r2((s0.bal || 0) + n.amt - n.paid);
      if (p.hold) return json(409, { ok: false, hold: true, error: `Credit is stopped for ${pname0(p)}: ${p.hold.why}. Balance after this bill: ${rs(after)}.` });
      if (p.lim > 0 && after > p.lim + 0.5 && shop.rules.some((r) => r.on && r.trig === "limit" && r.who === "c" && r.acts.includes("block") && (!r.grp || r.grp === (p.grp || "")))) return json(409, { ok: false, hold: true, error: `This bill takes ${pname0(p)} to ${rs(after)} — above the credit limit of ${rs(p.lim)}.` });
    }
    // 💾 items typed on a final sale bill that are not in the item list are saved (with this selling price) so the next bill can pick them
    const qnew = [], qtouch = new Set();
    if (n.ty === "sale" && n.st === "final" && shop.qitems !== false) {
      const nm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim(), byKey = {};
      B.prods.forEach((p) => { if (p.on !== false) { const k = nm(p.n) + "|" + (p.u || "pc"); if (!byKey[k] || (p.qk && !byKey[k].qk)) byKey[k] = p; } });
      for (const i of n.items) {
        if (PM[i.p] || !String(i.n || "").trim() || !(i.r > 0)) continue;
        const key = nm(i.n) + "|" + (i.u || "pc"); if (!nm(i.n)) continue;
        let pr = byKey[key];
        if (!pr) {
          if (B.prods.length >= MAXP) continue;
          pr = cleanProd({ n: i.n, u: i.u || "pc", cat: "Quick items", sp: r2(i.r), mrp: i.mrp || 0, gst: i.g || 0, ns: 1 }, null); pr.qk = 1; pr.ns = 1;
          B.prods.push(pr); PM[pr.id] = pr; byKey[key] = pr; qnew.push(pr.n);
        } else if (pr.qk) priceSet(pr, "sp", r2(i.r), "sale bill", today);   // a saved quick item keeps the latest selling price
        i.p = pr.id; i.n = pr.n; i.u = pr.u; qtouch.add(pr.id);
      }
    }
    if (n.ty === "sale") n.items.forEach((i) => { const pr = PM[i.p]; i.c = pr ? pr.cost : 0; });
    const mv = await loadMv(store, sid, [...new Set([n.d.slice(0, 7), old ? old.d.slice(0, 7) : n.d.slice(0, 7)])]);
    const touched = new Set(qtouch);
    if (old && old.st === "final") { old._pid = p.id; applyStock(PM, mv, p.k, old, -1, today).forEach((x) => touched.add(x)); delete old._pid; }
    if (!n.no && (n.ty === "sale" || n.ty === "rcpt" || n.ty === "pay" || n.ty === "po" || n.ty === "ret")) { shop.seq[n.ty] = (shop.seq[n.ty] || 0) + 1; const pre = { sale: shop.pre, rcpt: "R", pay: "P", po: "PO", ret: "CN" }[n.ty]; n.no = pre + "-" + String(shop.seq[n.ty]).padStart(4, "0"); await store.set(K.shop(sid), Object.assign({}, shop)); }
    if (n.st === "final") { n._pid = p.id; applyStock(PM, mv, p.k, n, 1, today).forEach((x) => touched.add(x)); delete n._pid; }
    if (old) { if (old.st === "final" && (old.amt !== n.amt || old.paid !== n.paid || old.d !== n.d)) n.hist = [{ at: t, by, amt: old.amt, paid: old.paid, d: old.d }].concat(old.hist || []).slice(0, 20); if (old.amt !== n.amt && old.ack) n.ack = null; n.by = old.by; Object.assign(old, n); }
    else { n.by = by; docs.push(n); }
    if (x.photo && /^data:image\/(jpeg|png|webp);base64,/.test(x.photo) && x.photo.length < 2500000) { await store.set(K.img(sid, n.id), { src: x.photo, at: t }); (old || n).photo = true; }
    const L = refresh(p, docs);
    await store.set(K.pt(sid, p.id), { list: docs }); await saveParties(); if (touched.size) await saveProds(); await saveMv(store, sid, mv);
    await addLog(store, sid, t, by, `${old ? "Edited" : "New"} ${n.ty} ${n.no || ""} · ${p.n || p.firm} · ${rs(n.amt)}${n.st !== "final" ? " (" + n.st + ")" : ""}`);
    const doc = old || n, out = { ok: true, doc, party: p, s: L.s, prods: [...touched].map((id) => PM[id]) }; if (qnew.length) out.qnew = qnew;
    if (doc.st === "final" && (b.send || (!old && (shop.auto.wa || shop.auto.mail)))) out.sent = await deliver(ctx, shop, p, doc, L.s, origin, b.send ? b.via : null, store, sid);
    if (!old && doc.st === "final") {   // ⚙️ instant rules: payment made / received, bill entered, credit limit crossed
      const trig = doc.ty === "rcpt" || doc.ty === "pay" ? "pay_done" : doc.ty === "sale" || doc.ty === "pur" ? "sale_done" : "";
      const R = shop.rules.filter((r) => r.on && r.trig === trig && r.who === p.k && (!r.grp || r.grp === (p.grp || "")));
      const via = [...new Set(R.flatMap((r) => r.acts.filter((a) => a === "wa" || a === "mail" || a === "thank").map((a) => (a === "thank" ? "wa" : a))))].filter((v) => !(out.sent && (v === "wa" ? out.sent.auto && out.sent.auto.ok : out.sent.mail && out.sent.mail.ok)));
      if (via.length) { const extra = R.map((r) => r.msg).filter(Boolean).join(" "); const sent = await deliver(ctx, shop, p, doc, L.s, origin, via, store, sid, null, extra); out.sent = out.sent ? Object.assign({}, out.sent, { auto: sent.auto || out.sent.auto, mail: sent.mail || out.sent.mail }) : sent; out.ruled = R.map((r) => r.name); }
      if (R.some((r) => r.acts.includes("owner"))) { const I = (await store.get(K.inbox(sid))) || { list: [] }; I.list.unshift({ id: nid("n"), kind: "rule", text: `⚙️ ${{ rcpt: "Payment received from", pay: "You paid", sale: "Bill to", pur: "Bill from" }[doc.ty]} ${pname0(p)}: ${rs(doc.amt)}`, at: t }); await store.set(K.inbox(sid), I); }
      if (doc.ty === "sale" || doc.ty === "rcpt") { const B2 = { shop, parties: B.parties }; const rr = await runRules(ctx, store, sid, B2, { dry: false, origin, today, t, only: p.id, trigs: ["limit"] }); if (rr.list.length) out.rules = rr.list; }
    }
    return json(200, out);
  }
  if (op === "doc-void") {
    const p = RM[cid(b.pid)]; if (!p) return json(404, { ok: false, error: "Not found" });
    const docs = await docsOf(p.id), d = docs.find((x) => x.id === cid(b.id)); if (!d) return json(404, { ok: false, error: "Not found" });
    if (d.st === "draft") { docs.splice(docs.indexOf(d), 1); } else {
      if (d.void) return json(400, { ok: false, error: "Already cancelled." });
      const why = str(b.why, 200); if (!why) return json(400, { ok: false, error: "Write why it is cancelled — the other side sees it." });
      const mv = await loadMv(store, sid, [d.d.slice(0, 7)]); if (d.st === "final") { d._pid = p.id; applyStock(PM, mv, p.k, d, -1, today); delete d._pid; await saveProds(); await saveMv(store, sid, mv); }
      d.void = { at: t, by, why };
    }
    const L = refresh(p, docs); await store.set(K.pt(sid, p.id), { list: docs }); await saveParties();
    await addLog(store, sid, t, by, `Cancelled ${d.ty} ${d.no || ""} · ${p.n || p.firm} · ${rs(d.amt)} — ${str(b.why, 120)}`);
    return json(200, { ok: true, party: p, s: L.s, prods: d.items.map((i) => PM[i.p]).filter(Boolean) });
  }
  if (op === "photo") { const im = await store.get(K.img(sid, cid(b.id))); return json(200, { ok: true, src: im ? im.src : "" }); }
  if (op === "send") {   // WhatsApp text + link (manual), plus e-mail / WhatsApp auto when asked
    const p = RM[cid(b.pid)]; if (!p) return json(404, { ok: false, error: "Not found" });
    const docs = await docsOf(p.id), L = refresh(p, docs), doc = b.id ? docs.find((x) => x.id === cid(b.id)) : null;
    const res = await deliver(ctx, shop, p, doc, L.s, origin, Array.isArray(b.via) ? b.via : [], store, sid, b.kind);
    if (doc && !(Array.isArray(b.via) && b.via.length)) { const ds = ((await store.get(K.pt(sid, p.id))) || { list: [] }).list, d2 = ds.find((x) => x.id === doc.id); if (d2) { d2.sent = Object.assign({}, d2.sent, { man: t }); await store.set(K.pt(sid, p.id), { list: ds }); res.sent = d2.sent; } }
    await saveParties(); return json(200, Object.assign({ ok: true }, res));
  }

  // ----- counter (walk-in) sales, expenses, day book -----
  if (op === "day-get") { const m = /^\d{4}-\d{2}$/.test(b.m) ? b.m : today.slice(0, 7); return json(200, { ok: true, m, days: ((await store.get(K.day(sid, m))) || { days: {} }).days }); }
  if (op === "day-save") {
    const d = day(b.d) || today, m = d.slice(0, 7), D = (await store.get(K.day(sid, m))) || { days: {} }, x = D.days[d] || { cs: 0, us: 0, ex: [], bills: [], note: "" };
    if (b.cs !== undefined) x.cs = Math.max(0, num(b.cs)); if (b.us !== undefined) x.us = Math.max(0, num(b.us)); if (b.cd !== undefined) x.cd = Math.max(0, num(b.cd));
    if (Array.isArray(b.ex)) x.ex = b.ex.slice(0, 40).map((e) => ({ n: str(e.n, 60), a: num(e.a), m: MODES.includes(e.m) ? e.m : "Cash" })).filter((e) => e.n && e.a);
    if (b.note !== undefined) x.note = str(b.note, 300); if (Array.isArray(b.addEx)) x.ex = (x.ex || []).concat(b.addEx.slice(0, 40).map((e) => ({ n: str(e.n, 60), a: Math.abs(num(e.a)), m: MODES.includes(e.m) ? e.m : "UPI" })).filter((e) => e.n && e.a)).slice(0, 40); if (b.addUpi) x.us = r2((x.us || 0) + Math.max(0, num(b.addUpi)));
    x.at = t; x.by = by; D.days[d] = x; await store.set(K.day(sid, m), D);
    await addLog(store, sid, t, by, `Day ${d}: cash ${rs(x.cs)}, UPI ${rs(x.us)}${x.ex.length ? ", expenses " + rs(x.ex.reduce((s, e) => s + e.a, 0)) : ""}`); return json(200, { ok: true, day: x });
  }
  if (op === "counter") {   // an itemised walk-in bill: reduces stock and adds to the day's cash / UPI sale
    const d = day(b.d) || today, m = d.slice(0, 7), D = (await store.get(K.day(sid, m))) || { days: {} }, x = D.days[d] || { cs: 0, us: 0, ex: [], bills: [], note: "" };
    const items = cleanItems(b.items); items.forEach((i) => { i.amt = i.ta > 0 ? i.ta : r2(i.q * i.r * (1 - i.dsc / 100)); if (!i.ta) delete i.ta; i.c = PM[i.p] ? PM[i.p].cost : 0; });
    const amt = r2(items.reduce((s, i) => s + i.amt, 0) - num(b.disc)); if (!items.length || amt <= 0) return json(400, { ok: false, error: "Add items." });
    const mode = b.mode === "UPI" ? "UPI" : "Cash", bill = { id: nid("w"), items, amt, mode, at: t };
    const mv = await loadMv(store, sid, [m]); const touched = applyStock(PM, mv, "c", { ty: "sale", d, items, id: bill.id }, 1, today);
    x.bills = (x.bills || []).concat(bill).slice(-400); if (mode === "UPI") x.us = r2((x.us || 0) + amt); else x.cs = r2((x.cs || 0) + amt);
    D.days[d] = x; await store.set(K.day(sid, m), D); await saveProds(); await saveMv(store, sid, mv);
    return json(200, { ok: true, day: x, bill, prods: [...touched].map((id) => PM[id]) });
  }

  // ----- what customers / distributors did on their links -----
  if (op === "inbox-act") {
    const I = (await store.get(K.inbox(sid))) || { list: [] }, it = I.list.find((x) => x.id === cid(b.id)); if (!it) return json(404, { ok: false, error: "Not found" });
    if (it.doc && (it.kind === "claim" || it.kind === "bill")) {
      const p = RM[it.pid], docs = await docsOf(it.pid), d = docs.find((x) => x.id === it.doc);
      if (p && d && d.st === "pending") {
        if (b.act === "accept") { const mv = await loadMv(store, sid, [d.d.slice(0, 7)]); d.st = "final"; if (b.amt) d.amt = Math.abs(num(b.amt)); if (it.kind === "bill" && Array.isArray(b.items)) { d.items = cleanItems(b.items); d.items.forEach((i) => { i.amt = r2(i.q * i.r); }); } d._pid = p.id; applyStock(PM, mv, p.k, d, 1, today); delete d._pid; await saveProds(); await saveMv(store, sid, mv); d.ack = { ok: true, at: t, by: p.n, note: "Entered by " + (p.n || p.firm) }; }
        else d.void = { at: t, by, why: str(b.why, 200) || "Not accepted by the shop" };
        refresh(p, docs); await store.set(K.pt(sid, p.id), { list: docs }); await saveParties();
      }
    }
    it.done = { at: t, by, act: b.act || "seen" }; await store.set(K.inbox(sid), I);
    await addLog(store, sid, t, by, `Inbox: ${it.text} → ${b.act || "seen"}`);
    return json(200, { ok: true, parties: B.parties });
  }

  // ----- UPI SMS / statement import (de-duplicated by UPI reference) -----
  if (op === "sms-refs") { const S = (await store.get(K.sms(sid))) || { refs: [] }; return json(200, { ok: true, refs: S.refs }); }
  if (op === "sms-done") { const S = (await store.get(K.sms(sid))) || { refs: [] }; S.refs = [...new Set((b.refs || []).map((r) => str(r, 40)).concat(S.refs))].slice(0, 5000); await store.set(K.sms(sid), S); return json(200, { ok: true }); }

  // ----- reports -----
  if (op === "report") {
    const from = day(b.from) || addD(today, -30), to = day(b.to) || today, all = [];
    const OUT = {}; // what is still unpaid on each bill right now (later payments settle the oldest bills first)
    await Promise.all(B.parties.map(async (p) => { const ds = await docsOf(p.id); ds.forEach((d) => { if (!d.void && d.st === "final") all.push(Object.assign({ pid: p.id, pk: p.k, pn: p.n || p.firm }, d)); }); try { ledger(p, ds, today).bills.forEach((x) => { OUT[x.id] = x.out; }); } catch (e) { /* summary only */ } }));
    const months = []; { let m = from.slice(0, 7); while (m <= to.slice(0, 7) && months.length < 25) { months.push(m); const d = new Date(m + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); m = d.toISOString().slice(0, 7); } }
    const days = {}; await Promise.all(months.map(async (m) => { Object.assign(days, ((await store.get(K.day(sid, m))) || { days: {} }).days); }));
    const inR = (d) => d >= from && d <= to, docs = all.filter((d) => inR(d.d)), dd = Object.keys(days).filter(inR).sort();
    return json(200, { ok: true, from, to, docs: docs.map((d) => ({ id: d.id, pid: d.pid, pk: d.pk, pn: d.pn, ty: d.ty, no: d.no, d: d.d, amt: d.amt, sn: d.sn || 0, rd: d.rd || 0, snt: d.sent && (d.sent.man || d.sent.wa || d.sent.mail) ? 1 : 0, ak: d.ack ? (d.ack.ok ? 1 : 2) : 0, paid: d.paid, out: OUT[d.id] != null ? Math.max(0, OUT[d.id]) : undefined, mode: d.mode, items: d.items.map((i) => ({ p: i.p, n: i.n, q: i.q, r: i.r, amt: i.amt, c: i.c || 0 })) })), days: dd.map((k) => Object.assign({ d: k }, days[k])) });
  }
  // ----- 📚 product catalogue: HO's updated price list + AI search of Indian retailer sites -----
  if (op === "catalog") { const c = await store.get("kh:catalog"); return json(200, { ok: true, rows: c ? c.rows : [], at: c ? c.at : 0, by: c ? c.by : "" }); }
  if (op === "find" || op === "price-check") {
    const keys = await aiKeys(store, ctx.env); if (!keys.groq && !keys.tavily && !(ctx.env && ctx.env.GEMINI_API_KEY)) return json(400, { ok: false, error: "Online search isn't set up yet — ask your BI team." });
    const cats = (Array.isArray(b.cats) ? b.cats : []).map((c) => str(c, 40)).slice(0, 40).join(", ");
    let task;
    if (op === "find") {
      const q = str(b.q, 80); if (q.length < 2) return json(400, { ok: false, error: "Type what to search, e.g. Haldiram namkeen" });
      task = { queries: [q + " MRP price India bigbasket", q + " MRP jiomart blinkit"], validate: (d) => d && Array.isArray(d.items) && d.items.length > 0,
        prompt: `Find packaged grocery / kirana / confectionery products sold in Indian shops that match "${q}". List every distinct product and pack size you can find (up to 30). Reply with ONLY JSON: {"items":[{"name":"brand + product name","brand":"","pack":"pack size e.g. 500 g / 1 L / pack of 10","category":"one of: ${cats}","mrp":0,"price":0,"source":"url"}]} — mrp = printed MRP in rupees, price = usual selling price online in rupees, numbers only. Only real products with real current prices from Indian retailer or brand sites; leave out anything you are not sure about.` };
    } else {
      const L = (Array.isArray(b.items) ? b.items : []).slice(0, 12).map((x, i) => ({ i, n: str(x.n, 90), pack: str(x.pack, 30), mrp: num(x.mrp) })).filter((x) => x.n);
      if (!L.length) return json(400, { ok: false, error: "Pick items to check." });
      task = { queries: L.slice(0, 4).map((x) => x.n + " " + x.pack + " MRP"), validate: (d) => d && Array.isArray(d.items),
        prompt: `For each Indian grocery product below, find today's printed MRP and the usual online selling price in India (BigBasket, JioMart, Blinkit, Zepto, Amazon or the brand site). Reply with ONLY JSON: {"items":[{"i":0,"mrp":0,"price":0,"pack":"pack size the price is for","source":"url"}]} — numbers only, skip a product if you can't find it.\n` + L.map((x) => `${x.i}. ${x.n}${x.pack ? " (" + x.pack + ")" : ""}${x.mrp ? " — our current MRP ₹" + x.mrp : ""}`).join("\n") };
    }
    const r = await research(store, ctx.env, task, { fetchImpl: ctx.aiFetch, now: () => t });
    if (!r.ok) return json(200, { ok: false, error: "Couldn't search online right now — try again in a minute. (" + String(r.error).slice(0, 160) + ")" });
    const items = (r.data.items || []).slice(0, 40).map((x) => ({ i: x.i != null ? Math.round(num(x.i)) : undefined, name: str(x.name, 90), brand: str(x.brand, 40), pack: str(x.pack, 30), category: str(x.category, 40), mrp: num(x.mrp), price: num(x.price), source: /^https?:\/\//.test(String(x.source || "")) ? str(x.source, 300) : "" })).filter((x) => x.mrp > 0 || x.price > 0);
    return json(200, { ok: true, items, sources: (r.sources || []).slice(0, 8), model: r.model || "" });
  }
  if (op === "log") return json(200, { ok: true, list: ((await store.get(K.log(sid))) || { list: [] }).list.slice(0, 400) });

  // ----- AI: read a bill photo, insights, order plan, ask anything -----
  if (op === "bill-read") {
    const imgs = (Array.isArray(b.images) ? b.images : []).filter((u) => /^data:image\/(jpeg|png|webp);base64,/.test(String(u)) && String(u).length < 3000000).slice(0, 3);
    if (!imgs.length) return json(400, { ok: false, error: "Add a clear photo of the bill." });
    const keys = await aiKeys(store, ctx.env);
    const v = await readImages(keys, ctx.env, imgs, ctx.aiFetch, "This is a purchase bill / invoice from a distributor to an Indian grocery (kirana) shop. Read it and reply with ONLY JSON: {\"distributor\":\"\",\"billNo\":\"\",\"date\":\"YYYY-MM-DD\",\"items\":[{\"name\":\"\",\"qty\":0,\"free\":0,\"unit\":\"\",\"rate\":0,\"mrp\":0,\"gst\":0,\"amount\":0,\"expiry\":\"YYYY-MM-DD or empty\",\"batch\":\"\"}],\"discount\":0,\"total\":0}. rate = price per unit charged to the shop (after scheme discount if shown per line). Copy item names exactly. Numbers only, no currency signs.");
    if (!v.ok) return json(502, { ok: false, error: "Couldn't read the photo right now (" + String(v.error).slice(0, 160) + "). Try a clearer photo or enter the bill by hand." });
    const j = parseLoose(v.text); if (!j || !Array.isArray(j.items)) return json(502, { ok: false, error: "The bill couldn't be read clearly — try again with the full bill in the photo." });
    return json(200, { ok: true, bill: j });
  }
  if (op === "ai") {
    const months = lastMonths(today, 3), mv = await loadMv(store, sid, months), vel = velocity(mv, months, today), live2 = B.prods.filter((p) => p.on !== false && !p.ns);
    const val = live2.reduce((s, p) => s + Math.max(0, p.stk) * (p.cost || 0), 0), C = B.parties.filter((p) => p.k === "c" && p.on !== false), Dd = B.parties.filter((p) => p.k === "d" && p.on !== false);
    const low = live2.filter((p) => (vel[p.id] || 0) > 0 && p.stk <= Math.max(p.rol != null ? p.rol : shop.low, (vel[p.id] || 0) * 7)).sort((a, b) => (vel[b.id] || 0) - (vel[a.id] || 0)).slice(0, 30);
    const dead = live2.filter((p) => p.stk > 0 && !(vel[p.id] > 0) && p.lots.some((l) => diffD(today, l.d) > 60)).sort((a, b) => b.stk * b.cost - a.stk * a.cost).slice(0, 15);
    const exp = []; live2.forEach((p) => p.lots.forEach((l) => { if (l.e && diffD(l.e, today) <= shop.expWarn) exp.push(`${p.n}: ${l.q} ${p.u} expire ${l.e}`); }));
    const thin = live2.filter((p) => p.cost && p.sp && (p.sp - p.cost) / p.sp * 100 < 5).slice(0, 15), up = live2.filter((p) => p.ph && p.ph[0] && diffD(today, p.ph[0][0]) < 45 && p.ph[0][2] > p.ph[0][1]).slice(0, 15);
    const facts = [`Shop: ${shop.name}. Today ${today}. Items ${live2.length}, stock value at cost ${rs(val)}.`,
      `Customers owe ${rs(C.reduce((s, p) => s + Math.max(0, (p.s && p.s.bal) || 0), 0))}, overdue ${rs(C.reduce((s, p) => s + ((p.s && p.s.over) || 0), 0))}. Top overdue: ` + C.filter((p) => p.s && p.s.over > 0).sort((a, b) => b.s.over - a.s.over).slice(0, 8).map((p) => `${p.n} ${rs(p.s.over)} (${p.s.od} days late, last paid ${p.s.lastCr || "never"})`).join("; "),
      `Shop owes distributors ${rs(Dd.reduce((s, p) => s + Math.max(0, (p.s && p.s.bal) || 0), 0))}. Due soon / overdue: ` + Dd.filter((p) => p.s && p.s.bal > 0).sort((a, b) => (a.s.nextDue || "9") < (b.s.nextDue || "9") ? -1 : 1).slice(0, 8).map((p) => `${p.n || p.firm} ${rs(p.s.bal)} ${p.s.over > 0 ? "OVERDUE " + rs(p.s.over) : "next due " + (p.s.nextDue || "-")}`).join("; "),
      "Running low (sold per day / in stock): " + low.map((p) => `${p.n} ${vel[p.id]}/day, stock ${p.stk}`).join("; "),
      "Not selling for 60+ days: " + dead.map((p) => `${p.n} stock ${p.stk} worth ${rs(p.stk * p.cost)}`).join("; "),
      "Expiring soon: " + exp.slice(0, 15).join("; "), "Thin margin (<5%): " + thin.map((p) => `${p.n} cost ${p.cost} sells ${p.sp}`).join("; "),
      "Recent cost increases: " + up.map((p) => `${p.n} ${p.ph[0][1]}→${p.ph[0][2]} (selling ${p.sp})`).join("; ")].join("\n");
    const lang = b.lang === "en" ? "English" : "simple Hindi (Devanagari) mixed with common English business words";
    if (b.kind === "ask") {
      const q = str(b.q, 400); if (!q) return json(400, { ok: false, error: "Ask a question." });
      const ql = q.toLowerCase(), hits = B.parties.filter((p) => ql.includes((p.n || "").toLowerCase().split(" ")[0]) && (p.n || "").length > 2).slice(0, 5).map((p) => `${p.k === "c" ? "Customer" : "Distributor"} ${p.n}: balance ${rs(p.s ? p.s.bal : 0)}, overdue ${rs(p.s ? p.s.over : 0)}, last payment ${p.s ? p.s.lastCr : ""}`);
      const ph = live2.filter((p) => ql.split(/\s+/).some((w) => w.length > 2 && p.n.toLowerCase().includes(w))).slice(0, 12).map((p) => `${p.n}: cost ${p.cost}, sell ${p.sp}, MRP ${p.mrp}, stock ${p.stk} ${p.u}, sells ${vel[p.id] || 0}/day`);
      const r = await ctx.askAI(ctx.env, q, facts + "\n" + hits.join("\n") + "\n" + ph.join("\n"), [], ctx.aiFetch, { system: `You are the business assistant of an Indian kirana shop owner. Answer in ${lang}, short and practical, using only the shop data given. Use ₹.`, label: "SHOP DATA", maxTokens: 700 });
      return json(200, r.ok ? { ok: true, answer: r.text } : { ok: false, error: r.error });
    }
    if (b.kind === "order") {
      const days = Math.max(3, Math.min(45, Math.round(num(b.days) || 10))), plan = {};
      for (const p of live2) {
        const v = vel[p.id] || 0, dist = RM[p.dist], lead = dist ? dist.lead || 2 : 2, need = v * (days + lead) - Math.max(0, p.stk), min = p.rol != null ? p.rol : 0;
        let q = Math.max(need, p.stk < min ? min * 2 - p.stk : 0); if (q <= 0.0005) continue; if (p.pack > 1) q = Math.ceil(q / p.pack) * p.pack; else q = Math.ceil(q);
        const k = p.dist || "-"; (plan[k] = plan[k] || []).push({ p: p.id, n: p.n, q, u: p.u, r: p.cost, stk: p.stk, v });
      }
      const groups = Object.keys(plan).map((k) => ({ dist: k, name: RM[k] ? RM[k].n || RM[k].firm : "No distributor set", lines: plan[k].sort((a, c) => c.v - a.v).slice(0, 120), value: r2(plan[k].reduce((s, x) => s + x.q * x.r, 0)) }));
      let notes = "";
      if (b.ai !== false) { const r = await ctx.askAI(ctx.env, `Review this re-order plan for the next ${days} days and give 3-6 short practical tips (cash flow vs dues to distributors, items to skip or push, expiry, cost increases). Plain text bullets.`, facts + "\nPLAN: " + groups.map((g) => g.name + ": " + g.lines.slice(0, 25).map((x) => `${x.n} ${x.q}`).join(", ")).join(" | "), [], ctx.aiFetch, { system: `Retail stock planning advisor for an Indian kirana shop. Answer in ${lang}.`, label: "SHOP DATA", maxTokens: 600 }); if (r.ok) notes = r.text; }
      return json(200, { ok: true, days, groups, notes });
    }
    const r = await ctx.askAI(ctx.env, "Give this shop owner the most useful insights and actions for this week.", facts, [], ctx.aiFetch, { system: `You advise an Indian kirana (grocery) shop owner. Use only the data given. Reply in ${lang} as JSON: {"headline":"one line","cards":[{"icon":"emoji","title":"short","text":"2-3 sentences with ₹ figures and names","action":"one concrete step"}]} with 5-8 cards covering collections, payments due, re-ordering, dead stock / expiry, margins and prices, cash flow.`, label: "SHOP DATA", maxTokens: 2200, json: true, raw: true });
    const j = r.ok ? parseLoose(r.text) : null; if (!j || !Array.isArray(j.cards)) return json(200, { ok: false, error: r.error || "The AI reply couldn't be read — try again." });
    return json(200, { ok: true, ai: j, facts });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// sends a bill / receipt / statement: always returns the WhatsApp text + link; e-mail / auto-WhatsApp when available
const pname0 = (p) => (p ? p.n || p.firm || "—" : "—");
async function deliver(ctx, shop, p, doc, s, origin, via, store, sid, kind, extra) {
  await ensureLink(store, sid, p);
  const k = kind || (doc ? (doc.ty === "rcpt" ? "rcpt" : doc.ty === "pay" ? "pay" : doc.ty === "po" ? "po" : doc.ty === "pur" ? "pur" : "sale") : "stmt");
  const link = linkUrl(origin, p.tok, doc ? doc.id : ""); let text = message(k, shop, p, doc || { items: [] }, s, link);
  if (extra) { const L = text.split("\n"); L.splice(1, 0, String(extra).slice(0, 300)); text = L.join("\n"); }
  const out = { text, link, wa: p.wa || p.ph || "", mail: null, auto: null };
  const wantMail = via ? via.includes("mail") : shop.auto.mail, wantWa = via ? via.includes("wa") : shop.auto.wa;
  if (wantMail && p.em) out.mail = await sendMail(Object.assign({}, ctx, { replyTo: shop.em }), p.em, `${shop.name} · ${{ sale: "Bill", rcpt: "Payment receipt", pay: "Payment advice", po: "Purchase order", pur: "Purchase bill", remind: "Payment reminder", stmt: "Account statement" }[k] || "Update"}${doc && doc.no ? " " + doc.no : ""}`, mailHtml(shop, p, doc, text, link));
  if (wantWa && (p.wa || p.ph) && shop.pk && shop.pk.key) out.auto = await sendWa(ctx, shop, p.wa || p.ph, text);
  if (doc && (out.mail && out.mail.ok || out.auto && out.auto.ok)) {
    const docs = ((await store.get(K.pt(sid, p.id))) || { list: [] }).list, d = docs.find((x) => x.id === doc.id);
    if (d) { d.sent = Object.assign({}, d.sent, out.mail && out.mail.ok ? { mail: Date.now() } : {}, out.auto && out.auto.ok ? { wa: Date.now() } : {}); await store.set(K.pt(sid, p.id), { list: docs }); doc.sent = d.sent; }
  }
  return out;
}

// ---------- ✨ reading lists: rules shared by photo / voice / typed text ----------
const LIST_RULES = `Rules:
- One entry per item. Keep every item line, even if unsure (give your best reading). Ignore totals, dates, shop names, phone numbers and doodles.
- "name": the item in simple English as an Indian kirana shop calls it. Keep a brand ONLY if it is written / spoken (e.g. "Parle-G", "Tata Salt 1 kg", "Harpic", "Clinic Plus"); NEVER add a brand that isn't there — "biscuit" stays "Biscuit", "atta" stays "Atta". "hi": the same in Hindi (Devanagari). "written": exactly as written, in the original script.
- Quantity is often written BEFORE the item: "2 parle-G" = 2 Parle-G; "4 kg आटा" = Atta 4 kg; "1 Harpic" = 1 Harpic.
- "5 वाले" / "10 wala" / "₹5 ka" after an item = the ₹5 / ₹10 pack: "4 बिस्कुट 5 वाले" → name "Biscuit (₹5 pack)", qty 4, unit "pc", amount 20. "बड़ा" / "bada" = big pack, "छोटा" / "chhota" = small pack — add "(big)" / "(small)" to the name.
- Common Hindi grocery words: आटा atta (wheat flour), चीनी cheeni (sugar), बूरा boora (powdered sugar), खांड khand (unrefined sugar), राजमा rajma, चना दाल chana dal, अरहर / तूर arhar (toor dal), मसूर masoor dal, मूंग moong dal, उड़द urad dal, चावल rice, तेल oil, घी ghee, नमक salt, हल्दी turmeric, मिर्च chilli, धनिया coriander, जीरा cumin, साबुन soap, सर्फ़ detergent.
- qty + unit = HOW MUCH is wanted. A weight / volume written with a loose item IS the amount: "maida 250gm" → qty 0.25, unit "kg" (NOT 250 pieces); "chana dal 250 g" → 0.25 kg; "chini 1/2 kilo" or "aadha kilo cheeni" → 0.5 kg; "chhole 1 kg" → 1 kg; "sarson tel 1 ltr" → 1 L; "doodh 500 ml" → 0.5 L. Always give grams as kg and ml as L (divide by 1000).
- A plain count means pieces / packets: "maggi 10" → 10 pc; "parle g 5 pkt" → 5 pkt; "ande 1 darjan" → 12 pc.
- If BOTH a pack size and a count are written ("tata salt 1kg x 2", "atta 5kg 1 bag", "surf 500g - 3"), keep the pack size in the name and qty = the count: name "Tata Salt 1 kg", qty 2, unit "pc".
- Hindi number words: paav/pav = 0.25, aadha/adha = 0.5, sawa = 1.25, dedh = 1.5, dhai/adhai = 2.5, ek 1, do 2, teen 3, char 4, paanch 5, chhe 6, saat 7, aath 8, nau 9, das 10, darjan 12; Devanagari digits ०१२३४५६७८९ = 0-9; ½ = 0.5, ¼ = 0.25.
- "amount": only if a price is written on that line (₹ / Rs / /- / =) — the rupees written for that line; else 0. Never invent prices.`;
const UNITS = { g: "g", gm: "g", gms: "g", gram: "g", grams: "g", gr: "g", "ग्राम": "g", kg: "kg", kgs: "kg", kilo: "kg", kilogram: "kg", "किलो": "kg", ml: "ml", "मिली": "ml", l: "L", lt: "L", ltr: "L", litre: "L", liter: "L", "लीटर": "L", pc: "pc", pcs: "pc", piece: "pc", pieces: "pc", nag: "pc", no: "pc", nos: "pc", pkt: "pkt", packet: "pkt", packets: "pkt", pack: "pkt", "पैकेट": "pkt", box: "box", bag: "bag", bori: "bag", dozen: "dozen", darjan: "dozen", doz: "dozen", "दर्जन": "dozen" };
function fixLine(x) {
  if (!x) return null;
  const dev = (t) => String(t || "").replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d));
  let q = num(dev(x.qty)), u = UNITS[String(x.unit || "").toLowerCase().replace(/\./g, "").trim()] || "pc";
  const w = dev(x.written || "") + " " + dev(x.name || "");
  const wm = /(\d+(?:\.\d+)?)\s*(g|gm|gms|grams?|ml|ग्राम|मिली)\b/i.exec(w);
  if ((u === "pc" || u === "pkt") && wm && Math.abs(q - num(wm[1])) < 0.001 && q >= 20) { u = /ml|मिली/i.test(wm[2]) ? "ml" : "g"; }   // "maida 250gm" read as 250 pieces
  if (u === "g") { q = q / 1000; u = "kg"; } else if (u === "ml") { q = q / 1000; u = "L"; }
  if (u === "dozen") { q = q * 12; u = "pc"; }
  if ((u === "kg" || u === "L") && q > 60 && /g|ml|ग्राम/i.test(w)) q = q / 1000;   // grams left as kg
  if (!(q > 0)) q = 1;
  const amt = num(dev(x.amount)) || 0, rate = amt ? Math.round(amt / q * 100) / 100 : num(dev(x.rate));
  return { name: str(x.name, 90), hi: str(x.hi, 90), written: str(x.written, 90), qty: Math.round(q * 1000) / 1000, unit: u, rate };
}
async function speechToText(ctx, store, dataUrl) {
  const m = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/i.exec(dataUrl); if (!m) return { ok: false, error: "No recording received." };
  const mime = m[1], buf = Buffer.from(m[2], "base64"); if (buf.length < 800) return { ok: false, error: "The recording is too short." }; if (buf.length > 6e6) return { ok: false, error: "Keep the recording under 2 minutes." };
  const c = (await store.get("config:aikeys")) || {}, keys = await aiKeys(store, ctx.env), sarvam = ctx.env.SARVAM_API_KEY || c.sarvam, errs = [], f = ctx.aiFetch;
  const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : "webm";
  const file = () => new Blob([buf], { type: mime.split(";")[0] });
  if (sarvam) {   // best for Hindi & Indian languages (and mixed Hindi-English)
    try { const fd = new FormData(); fd.append("file", file(), "list." + ext); fd.append("model", "saarika:v2.5"); fd.append("language_code", "unknown");
      const r = await f("https://api.sarvam.ai/speech-to-text", { method: "POST", headers: { "api-subscription-key": sarvam }, body: fd }); const j = await r.json().catch(() => ({}));
      if (r.ok && j.transcript) return { ok: true, text: String(j.transcript), src: "sarvam" }; errs.push("Sarvam " + r.status); } catch (e) { errs.push("Sarvam: " + e.message); }
  }
  if (keys.groq) {
    try { const fd = new FormData(); fd.append("file", file(), "list." + ext); fd.append("model", "whisper-large-v3"); fd.append("response_format", "json"); fd.append("temperature", "0"); fd.append("prompt", "किराना सामान: चीनी 1 किलो, आटा 5 किलो, Maggi 10 packet, chana dal aadha kilo, Tata salt 2, sarson tel 1 litre.");
      const r = await f("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + keys.groq }, body: fd }); const j = await r.json().catch(() => ({}));
      if (r.ok && j.text != null) return { ok: true, text: String(j.text), src: "groq" }; errs.push("Groq " + r.status + " " + String((j.error && j.error.message) || "").slice(0, 60)); } catch (e) { errs.push("Groq: " + e.message); }
  }
  if (ctx.env.GEMINI_API_KEY) {
    try { const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${ctx.env.GEMINI_MODEL || "gemini-2.5-flash"}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": ctx.env.GEMINI_API_KEY }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Transcribe this voice note exactly (it lists grocery items in Hindi / English / an Indian language). Reply with only the words spoken." }, { inline_data: { mime_type: mime.split(";")[0], data: m[2] } }] }] }) });
      const j = await r.json().catch(() => ({})); const t = (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("") || "";
      if (r.ok && t.trim()) return { ok: true, text: t.trim(), src: "gemini" }; errs.push("Gemini " + r.status); } catch (e) { errs.push("Gemini: " + e.message); }
  }
  return { ok: false, error: errs.length ? "Couldn't understand the recording (" + errs.join(" | ").slice(0, 160) + ")." : "Voice needs an AI key — the HO admin can add the free Groq key (AI keys)." };
}

// ---------- ⚙️ run the rules for one shop (daily schedule, "Run now", or instantly after a bill) ----------
async function runRules(ctx, store, sid, B, o) {
  const { dry, origin, today, t } = o, shop = B.shop, out = [], owner = [];
  const rules = shop.rules.filter((r) => r.on && r.trig !== "pay_done" && r.trig !== "sale_done" && (!o.trigs || o.trigs.includes(r.trig)));
  let changed = false;
  for (const p of B.parties) {
    if (p.on === false || (o.only && p.id !== o.only)) continue;
    const docs = ((await store.get(K.pt(sid, p.id))) || { list: [] }).list; p.s = ledger(p, docs, today).s; changed = true;
    const s = p.s; let holdWhy = "", holdRule = "";
    for (const r of rules) {
      const why = ruleHits(r, p, s, today); if (!why) continue;
      if (r.acts.includes("block") && !holdWhy) { holdWhy = r.name + " — " + why; holdRule = r.id; }
      const last = (p.rem || {})[r.id], due = !last || (r.every > 0 && diffD(today, last) >= r.every) || (o.force && last !== today);
      const row = { pid: p.id, n: pname0(p), k: p.k, rule: r.name, why, acts: r.acts };
      if (!due) { row.skip = "already done on " + dShow(last); out.push(row); continue; }
      if (dry) { out.push(row); continue; }
      const done = [], via = r.acts.filter((x) => x === "wa" || x === "mail");
      if (via.length) {
        const res = await deliver(ctx, shop, p, null, s, origin, via, store, sid, p.k === "c" ? "remind" : "stmt", r.msg);
        if (via.includes("wa")) done.push(res.auto ? (res.auto.ok ? "WhatsApp sent" : "WhatsApp failed (" + res.auto.error + ")") : (p.wa || p.ph) ? "WhatsApp not connected" : "no mobile");
        if (via.includes("mail")) done.push(res.mail ? (res.mail.ok ? "e-mail sent" : "e-mail failed") : "no e-mail");
      }
      if (r.acts.includes("owner")) { owner.push(`${pname0(p)}: ${why} (${r.name})`); done.push("alerted you"); }
      if (r.acts.includes("block")) done.push("credit stopped");
      if (r.acts.includes("interest") && r.rate > 0 && s.over > 0.5 && (p.int || {})[r.id] !== today.slice(0, 7)) {
        const amt = r2(s.over * r.rate / 100), d = cleanDoc({ ty: "adj", amt, d: today, note: `Interest @${r.rate}%/month on overdue ${rs(s.over)} — ${r.name}` }, null, p, shop);
        if (d && amt >= 1) { d.src = "rule"; d.by = "Rule"; docs.push(d); await store.set(K.pt(sid, p.id), { list: docs }); p.s = ledger(p, docs, today).s; p.int = Object.assign({}, p.int, { [r.id]: today.slice(0, 7) }); done.push("interest " + rs(amt) + " added"); }
      }
      p.rem = Object.assign({}, p.rem, { [r.id]: today }); row.done = done; out.push(row);
    }
    if (!dry) {
      if (holdWhy && !p.hold) p.hold = { by: "rule", rule: holdRule, why: holdWhy, at: t };
      else if (!holdWhy && p.hold && p.hold.by === "rule" && (!o.trigs || rules.some((r) => r.id === p.hold.rule))) p.hold = null;
    }
  }
  if (!dry) {
    if (changed) await store.set(K.party(sid), { list: B.parties, at: t });
    const done = out.filter((x) => x.done);
    if (done.length) { const Lg = (await store.get("kh:rlog:" + sid)) || { list: [] }; Lg.list = done.map((x) => ({ at: t, n: x.n, rule: x.rule, why: x.why, done: x.done })).concat(Lg.list).slice(0, 1500); await store.set("kh:rlog:" + sid, Lg); }
    if (owner.length) {
      const I = (await store.get(K.inbox(sid))) || { list: [] }; owner.slice(0, 40).forEach((x) => I.list.unshift({ id: nid("n"), kind: "rule", text: "⚙️ " + x.slice(0, 280), at: t })); I.list = I.list.slice(0, 600); await store.set(K.inbox(sid), I);
      if (shop.em) await sendMail(ctx, shop.em, `${shop.name} · ${owner.length} alert${owner.length > 1 ? "s" : ""} from your rules`, `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6"><h3 style="color:#14532D">⚙️ Today’s alerts</h3><ul>${owner.map((x) => "<li>" + escH(x) + "</li>").join("")}</ul></div>`);
    }
  }
  return { list: out.slice(0, 500), alerts: owner.length, sent: out.filter((x) => x.done && x.done.some((d) => /sent/.test(d))).length };
}
// called every hour by the scheduler: each shop's rules run once a day at the owner's chosen hour (IST)
export async function runKhataDaily(store, env, t, fetchImpl) {
  const S = (await store.get(K.shops)) || { list: [] }, today = istDay(t), hr = new Date(t + 19800000).getUTCHours(), out = [];
  for (const e of S.list) {
    if (e.off) continue;
    try {
      const B = await books(store, e.id); if (!B.shop || !B.shop.rulesOn || B.shop.rlast === today || hr < (B.shop.rhour || 10)) continue;
      const raw = await store.get(K.shop(e.id)); raw.rlast = today; await store.set(K.shop(e.id), raw);
      const r = await runRules({ env, store, mailFetch: fetchImpl, waFetch: fetchImpl }, store, e.id, B, { dry: false, origin: env.URL || env.SITE_URL || "", today, t });
      await addLog(store, e.id, t, "Rules", `Daily rules: ${r.list.filter((x) => x.done).length} actions, ${r.alerts} alerts`); out.push(e.id);
    } catch (err) { }
  }
  return out;
}

// ---------- HO admin (BI session): shops + owner logins, and full help inside any shop ----------
export async function khAdmin(b, ctx) {
  const { store, t, app, rec } = ctx;
  if (app !== "admin") return json(403, { ok: false, error: "Only HO admins can set up shops." });
  const by = (rec.fullName || rec.username) + " (BI)";
  if (b.action === "kh-shops") {
    const S = (await store.get(K.shops)) || { list: [] };
    const list = await Promise.all(S.list.map(async (x) => { const R = (await store.get(K.party(x.id))) || { list: [] }, P = (await store.get(K.prod(x.id))) || { list: [] }; const sum = (k) => R.list.filter((p) => p.k === k).reduce((s, p) => s + Math.max(0, (p.s && p.s.bal) || 0), 0); return Object.assign({}, x, { items: P.count != null ? P.count : (P.list || []).length, parties: R.list.length, recv: r2(sum("c")), pay: r2(sum("d")) }); }));
    return json(200, { ok: true, shops: list });
  }
  if (b.action === "kh-shop-new" || b.action === "kh-shop-login") {
    const S = (await store.get(K.shops)) || { list: [] }; let sid = cid(b.shop), sh = sid ? await store.get(K.shop(sid)) : null;
    if (b.action === "kh-shop-new") { const n = cleanShop(b.info || {}, null); if (!str((b.info || {}).name, 80)) return json(400, { ok: false, error: "Shop name is needed." }); sid = nid("s"); n.id = sid; n.created = t; sh = n; await store.set(K.shop(sid), n); S.list.push({ id: sid, name: n.name, owner: n.owner, city: n.city, state: n.state, mob: "", at: t, by }); await store.set(K.prod(sid), { list: [] }); await store.set(K.party(sid), { list: [] }); }
    if (!sh) return json(404, { ok: false, error: "Shop not found." });
    const mob = ph10(b.mob); if (!mob) return json(400, { ok: false, error: "Enter the owner's 10-digit mobile number." });
    const ex = await store.get(K.user(mob)); if (ex && ex.sid !== sid) return json(409, { ok: false, error: "This mobile number already logs in to another shop." });
    const pe = pwProblem(b.pw); if (pe) return json(400, { ok: false, error: pe });
    const e = S.list.find((x) => x.id === sid); if (e && e.mob && e.mob !== mob) { await store.delete(K.user(e.mob)); }
    await store.set(K.user(mob), Object.assign({ sid, name: str(b.ownerName, 60) || sh.owner || "", fails: 0 }, hashPw(b.pw), { sessions: [] }));
    if (e) { e.mob = mob; e.loginAt = t; } await store.set(K.shops, S); await addLog(store, sid, t, by, "Owner login set for " + mob.slice(0, 2) + "******" + mob.slice(-2));
    return json(200, { ok: true, sid, mob });
  }
  if (b.action === "kh-cat-save") {   // HO's updated catalogue prices (Excel) — every shop sees them
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 8000).map((x) => ({ n: str(x.n, 90), br: str(x.br, 40), cat: str(x.cat, 40), u: str(x.u, 12) || "pc", pack: str(x.pack, 30), mrp: num(x.mrp), dp: num(x.dp), sp: num(x.sp) })).filter((x) => x.n && (x.mrp || x.sp));
    if (b.clear) { await store.delete("kh:catalog"); return json(200, { ok: true, n: 0 }); }
    if (!rows.length) return json(400, { ok: false, error: "No rows with a name and a price." });
    await store.set("kh:catalog", { rows, at: t, by }); return json(200, { ok: true, n: rows.length });
  }
  if (b.action === "kh-shop-off") {
    const S = (await store.get(K.shops)) || { list: [] }, e = S.list.find((x) => x.id === cid(b.shop)); if (!e) return json(404, { ok: false, error: "Not found" });
    e.off = !!b.off; await store.set(K.shops, S); const sh = await store.get(K.shop(e.id)); if (sh) { sh.off = e.off; await store.set(K.shop(e.id), sh); }
    if (e.off && e.mob) { const u = await store.get(K.user(e.mob)); if (u) { for (const h of u.sessions || []) await store.delete(K.sess(h)); u.sessions = []; await store.set(K.user(e.mob), u); } }
    return json(200, { ok: true });
  }
  const m = /^kh-a-(.+)$/.exec(b.action); if (!m) return json(400, { ok: false, error: "Unknown action" });
  // shop id comes as b.sid (b.shop may carry the shop details being saved)
  const sid = cid(b.sid || (typeof b.shop === "string" ? b.shop : "")); if (!sid || !(await store.get(K.shop(sid)))) return json(404, { ok: false, error: "Shop not found." });
  return ownerOp(m[1], b, Object.assign({}, ctx, { sid, by }));
}

// ---------- no BI login: the shop owner (own login) and customers / distributors (secure link) ----------
export async function khPublic(b, ctx) {
  const { store, t } = ctx, today = istDay(t);
  if (b.action === "kh-o-login") {
    const mob = ph10(b.mob), u = mob ? await store.get(K.user(mob)) : null, bad = "Mobile number or password is incorrect.";
    if (!u) return json(401, { ok: false, error: bad });
    if (u.lockUntil && u.lockUntil > t) return json(429, { ok: false, error: "Too many wrong tries — try again in " + Math.ceil((u.lockUntil - t) / 60000) + " min." });
    if (!checkPw(b.pw, u)) { u.fails = (u.fails || 0) + 1; if (u.fails >= 6) { u.fails = 0; u.lockUntil = t + 15 * 60000; } await store.set(K.user(mob), u); return json(401, { ok: false, error: bad }); }
    const sh = await store.get(K.shop(u.sid)); if (!sh || sh.off) return json(403, { ok: false, error: "This shop is switched off. Please contact your BI team." });
    const tok = randomBytes(24).toString("hex"), h = sha(tok); await store.set(K.sess(h), { sid: u.sid, mob, at: t, exp: t + SESS_MS });
    u.fails = 0; u.lockUntil = 0; u.sessions = [h].concat(u.sessions || []).slice(0, 6); u.last = t; await store.set(K.user(mob), u);
    return json(200, { ok: true, ktok: tok, sid: u.sid, shop: sh.name, name: u.name || sh.owner || "" });
  }
  if (/^kh-o-/.test(b.action)) {
    const h = sha(String(b.ktok || "")), S = b.ktok ? await store.get(K.sess(h)) : null;
    if (!S || S.exp < t) return json(401, { ok: false, loggedOut: true, error: "Please log in again." });
    const op = b.action.slice(5);
    if (op === "logout") { await store.delete(K.sess(h)); return json(200, { ok: true }); }
    const sh = await store.get(K.shop(S.sid)); if (!sh || sh.off) return json(403, { ok: false, loggedOut: true, error: "This shop is switched off. Please contact your BI team." });
    if (op === "pw") {
      const u = await store.get(K.user(S.mob)); if (!u || !checkPw(b.old, u)) return json(400, { ok: false, error: "Current password is wrong." });
      const pe = pwProblem(b.pw); if (pe) return json(400, { ok: false, error: pe });
      Object.assign(u, hashPw(b.pw)); for (const x of (u.sessions || []).filter((x) => x !== h)) await store.delete(K.sess(x)); u.sessions = [h]; await store.set(K.user(S.mob), u);
      return json(200, { ok: true });
    }
    return ownerOp(op, b, Object.assign({}, ctx, { sid: S.sid, by: "Owner" }));
  }
  // ---- party link ----
  const tok = String(b.l || "").replace(/[^a-f0-9]/g, "").slice(0, 40), L = tok ? await store.get(K.link(tok)) : null;
  if (!L) return json(404, { ok: false, error: "This link isn't valid any more — ask the shop for a new one." });
  if (L.lockUntil && L.lockUntil > t) return json(429, { ok: false, error: "Too many wrong tries — try again in an hour." });
  const [sh, R] = await Promise.all([store.get(K.shop(L.sid)), store.get(K.party(L.sid))]); const parties = (R && R.list) || [], p = parties.find((x) => x.id === L.pid);
  if (!sh || !p || p.tok !== tok) return json(404, { ok: false, error: "This link isn't valid any more — ask the shop for a new one." });
  const shop = cleanShop({}, sh), pin = String(b.pin || "").replace(/\D/g, "");
  // the link itself is the key (96-bit random token, reset any time from the party page) — no PIN asked
  void pin;
  if (L.fails) { L.fails = 0; await store.set(K.link(tok), L); }
  const docs = ((await store.get(K.pt(L.sid, p.id))) || { list: [] }).list;
  const inbox = async (kind, text, extra) => { const I = (await store.get(K.inbox(L.sid))) || { list: [] }; I.list.unshift(Object.assign({ id: nid("n"), kind, pid: p.id, pn: p.n || p.firm, pk: p.k, text: String(text).slice(0, 300), at: t }, extra || {})); I.list = I.list.slice(0, 600); await store.set(K.inbox(L.sid), I); };
  if (b.action === "kh-p-open" && !b.peek) { let ch = false; docs.forEach((d) => { if (!d.void && d.st === "final" && !d.sn) { d.sn = t; ch = true; } }); if (ch) await store.set(K.pt(L.sid, p.id), { list: docs }); }
  const nmK = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim();
  const pubItem = (x) => ({ id: x.id, n: x.n, u: x.u || "pc", sp: x.sp || x.mrp || 0, mrp: x.mrp || 0, iu: x.iu || "", im: x.im ? 1 : 0 });
  if (b.action === "kh-p-read" || b.action === "kh-p-job") {   // 🎤 / ✍️ the customer speaks or types the whole list — read with the same AI as the shop's own list reading
    if (p.k !== "c" || shop.ordOn === false) return json(403, { ok: false, error: "Ordering is switched off for this shop." });
    const octx = Object.assign({}, ctx, { sid: L.sid, by: (p.n || p.firm) + " (via link)" });
    if (b.action === "kh-p-job") return ownerOp("job-get", { job: cid(b.job) }, octx);
    const rd = L.rd && L.rd.d === today ? L.rd : { d: today, n: 0 };
    if (rd.n >= 25) return json(429, { ok: false, error: "Too many tries today — please type the items one by one." });
    const audio = b.audio ? String(b.audio) : "", text = String(b.text || "").slice(0, 3000).trim();
    if (audio && (audio.length > 1800000 || !/^data:audio\//.test(audio))) return json(400, { ok: false, error: "That recording is too long — keep it under a minute." });
    if (!audio && text.length < 2) return json(400, { ok: false, error: "Say or write the items." });
    rd.n++; L.rd = rd; await store.set(K.link(tok), L);
    return ownerOp("list-read", audio ? { audio, mode: "sale" } : { text, mode: "sale" }, octx);
  }
  if (b.action === "kh-p-cat") {   // 🛍 what the shop sells — names, pack, price and picture only (never cost or stock)
    if (p.k !== "c" || shop.ordOn === false) return json(403, { ok: false, error: "Ordering is switched off for this shop." });
    if (shop.catOn === false) return json(200, { ok: true, items: [], off: true });
    const B2 = await books(store, L.sid, false), live = B2.prods.filter((x) => x.on !== false && (x.sp || x.mrp)), w = nmK(b.q).split(" ").filter(Boolean).slice(0, 6);
    let out;
    if (w.length) {
      out = live.filter((x) => { const h = nmK(x.n + " " + (x.br || "") + " " + (x.cat || "")); return w.every((k) => h.includes(k)); });
      const r = (x) => { const n = nmK(x.n); return (n.startsWith(w[0]) ? 0 : 2) + (x.im || x.iu ? 0 : 1) + n.length / 1000; };
      out = out.sort((a, c) => r(a) - r(c)).slice(0, 30);
    } else {
      const months = lastMonths(today, 3), mv = await loadMv(store, L.sid, months), vel = velocity(mv, months, today), mine = {};
      docs.filter((d) => d.ty === "sale" && !d.void && d.st === "final").forEach((d) => d.items.forEach((i) => { if (i.p) mine[i.p] = (mine[i.p] || 0) + 1; }));
      out = live.filter((x) => mine[x.id] || vel[x.id] > 0).sort((a, c) => (mine[c.id] || 0) * 50 + (vel[c.id] || 0) - ((mine[a.id] || 0) * 50 + (vel[a.id] || 0))).slice(0, 40);
      if (out.length < 24) { const have = new Set(out.map((x) => x.id)), rest = live.filter((x) => !have.has(x.id)); out = out.concat(rest.filter((x) => x.im || x.iu).slice(0, 24 - out.length)); if (out.length < 24) out = out.concat(rest.filter((x) => !(x.im || x.iu)).slice(0, 24 - out.length)); }
    }
    const items = out.map(pubItem); await Promise.all(items.map(async (x) => { if (x.im) { const g = await store.get(pimK(L.sid, x.id)); if (g && g.img) x.img = g.img; } }));
    return json(200, { ok: true, items });
  }
  if (b.action === "kh-p-act") {
    const a = b.act, who = (p.n || p.firm) + " (via link)";
    if (a === "seen") { const d = docs.find((x) => x.id === cid(b.id)); if (d && !d.void && d.st === "final" && !d.rd) { d.rd = t; if (!d.sn) d.sn = t; await store.set(K.pt(L.sid, p.id), { list: docs }); } return json(200, { ok: true }); }
    if (a === "order") {   // 🛒 customer's order from the link → a DRAFT sale bill the shop checks, prices and finalizes
      if (p.k !== "c" || shop.ordOn === false) return json(403, { ok: false, error: "Ordering is switched off for this shop." });
      const rows = (Array.isArray(b.items) ? b.items : []).slice(0, 80).map((i) => ({ p: cid(i.p), n: str(i.n, 90).trim(), q: Math.min(9999, Math.abs(qn(i.q)) || 1), u: str(i.u, 12) })).filter((i) => i.p || i.n);
      if (!rows.length) return json(400, { ok: false, error: "Add at least one item." });
      if (docs.filter((d) => d.st === "draft" && d.src === "link" && !d.void).length >= 5) return json(429, { ok: false, error: "You already have orders waiting with the shop — please wait for them to be billed." });
      const B2 = await books(store, L.sid, false), PM2 = Object.fromEntries(B2.prods.map((x) => [x.id, x])), byN = {};
      B2.prods.forEach((x) => { if (x.on !== false) { const k = nmK(x.n); if (!byN[k] || (x.sp && !byN[k].sp)) byN[k] = x; } });
      const un = (u) => { u = String(u || "").toLowerCase().trim(); return /^(l|ltr|litre|liter)s?$/.test(u) ? "l" : /^(g|gm|gms|gram|grams)$/.test(u) ? "g" : /^(kg|kgs|kilo)$/.test(u) ? "kg" : /^(pc|pcs|piece|pieces|no|nos)$/.test(u) ? "pc" : /^(dozen|dz|darjan)$/.test(u) ? "dozen" : u; };
      const CONV = { "g>kg": 0.001, "kg>g": 1000, "ml>l": 0.001, "l>ml": 1000, "dozen>pc": 12 };
      const loose = (n) => { const w = nmK(n).split(" ").filter(Boolean); if (!w.length) return null; const c = B2.prods.filter((x) => x.on !== false && w.every((k) => (" " + nmK(x.n) + " ").includes(" " + k + " "))); if (c.length === 1) return c[0]; const lo = c.filter((x) => /loose|khula/i.test(x.n)); return lo.length === 1 ? lo[0] : null; };
      const items = rows.map((i) => {
        const pr = PM2[i.p] || byN[nmK(i.n)] || (i.p ? null : loose(i.n));
        if (pr && pr.on !== false) { const cu = un(i.u), pu = un(pr.u); let q = i.q, fit = !cu || cu === pu || !!PM2[i.p];
          if (!fit && CONV[cu + ">" + pu]) { q = Math.round(i.q * CONV[cu + ">" + pu] * 1000) / 1000; fit = true; }
          if (fit) return { p: pr.id, n: pr.n, u: pr.u, q, r: pr.sp || pr.mrp || 0, mrp: pr.mrp || 0, g: pr.gst || 0 }; }
        return { p: "", n: i.n, u: i.u || "pc", q: i.q, r: 0 };
      }).filter((i) => i.n);
      if (!items.length) return json(400, { ok: false, error: "Add at least one item." });
      const d = cleanDoc({ ty: "sale", items, st: "draft", note: b.note, d: today }, null, p, shop); d.src = "link"; d.by = who; d.ord = { at: t, n: items.length, open: items.filter((i) => !i.r).length };
      docs.push(d); await store.set(K.pt(L.sid, p.id), { list: docs });
      await inbox("order", `🛒 ${p.n || p.firm} ordered ${items.length} item${items.length > 1 ? "s" : ""}${d.amt ? " (about " + rs(d.amt) + ")" : ""}${d.ord.open ? " — " + d.ord.open + " need a price" : ""}${d.note ? " — " + d.note : ""}`, { doc: d.id, amt: d.amt });
      return json(200, { ok: true, order: { id: d.id, n: items.length, amt: d.amt, open: d.ord.open } });
    }
    if (a === "ack") {
      const d = docs.find((x) => x.id === cid(b.id) && !x.void && x.st === "final"); if (!d) return json(404, { ok: false, error: "Not found" });
      d.ack = { ok: b.ok !== false, at: t, by: who, note: str(b.note, 300) };
      await store.set(K.pt(L.sid, p.id), { list: docs });
      await inbox(b.ok !== false ? "ack" : "dispute", `${p.n || p.firm} ${b.ok !== false ? "confirmed" : "DISPUTED"} ${{ sale: "bill", rcpt: "payment receipt", pay: "your payment", pur: "purchase bill", ret: "return" }[d.ty] || d.ty} ${d.no || ""} (${rs(d.amt)})${b.note ? " — " + str(b.note, 160) : ""}`, { doc: d.id });
    } else if (a === "bal") {
      const s = ledger(p, docs, today).s; p.conf = { ok: b.ok !== false, at: t, bal: s.bal, note: str(b.note, 300) }; await store.set(K.party(L.sid), { list: parties });
      await inbox(b.ok !== false ? "ack" : "dispute", `${p.n || p.firm} ${b.ok !== false ? "agreed" : "did NOT agree"} with the balance ${rs(s.bal)}${b.note ? " — " + str(b.note, 160) : ""}`);
    } else if (a === "claim" && p.k === "c") {   // "I have paid" — waits for the shop to accept
      const amt = Math.abs(num(b.amt)); if (!amt) return json(400, { ok: false, error: "Enter the amount you paid." });
      const d = cleanDoc({ ty: "rcpt", amt, d: day(b.d) || today, mode: MODES.includes(b.mode) ? b.mode : "UPI", ref: b.ref, note: b.note, st: "pending" }, null, p, shop); d.src = "link"; d.by = who; docs.push(d);
      await store.set(K.pt(L.sid, p.id), { list: docs }); await inbox("claim", `${p.n} says they paid ${rs(amt)} by ${d.mode}${d.ref ? " (ref " + d.ref + ")" : ""}${d.note ? " — " + d.note : ""}`, { doc: d.id, amt });
    } else if (a === "bill" && p.k === "d") {   // distributor enters his bill for the shop to accept
      const d = cleanDoc({ ty: "pur", no: b.no, d: b.d, items: b.items, amt: b.amt, disc: b.disc, note: b.note, st: "pending" }, null, p, shop); if (!d || !d.amt) return json(400, { ok: false, error: "Enter the bill amount or items." });
      d.src = "link"; d.by = who; docs.push(d); await store.set(K.pt(L.sid, p.id), { list: docs });
      await inbox("bill", `${p.n || p.firm} sent bill ${d.no || ""} for ${rs(d.amt)}${d.items.length ? " (" + d.items.length + " items)" : ""}`, { doc: d.id, amt: d.amt });
    } else if (a === "po" && p.k === "d") {   // distributor answers an order: quantities he can supply, rates, delivery date
      const d = docs.find((x) => x.id === cid(b.id) && x.ty === "po" && !x.void); if (!d) return json(404, { ok: false, error: "Not found" });
      (Array.isArray(b.lines) ? b.lines : []).forEach((l) => { const it = d.items[Math.round(num(l.i))]; if (it) { it.sq = qn(l.q); if (num(l.r)) it.sr = num(l.r); } });
      d.reply = { at: t, eta: day(b.eta), note: str(b.note, 300) }; await store.set(K.pt(L.sid, p.id), { list: docs });
      await inbox("po", `${p.n || p.firm} replied to order ${d.no}: ${d.reply.eta ? "delivery " + d.reply.eta : ""}${d.reply.note ? " — " + d.reply.note : ""}`, { doc: d.id });
    } else return json(400, { ok: false, error: "Unknown action" });
  }
  const L2 = ledger(p, docs, today), keep = (d) => ({ id: d.id, ty: d.ty, no: d.no, d: d.d, due: d.due, amt: d.amt, paid: d.paid, mode: d.mode, ref: d.ref, note: d.note, st: d.st, ack: d.ack, void: d.void ? { why: d.void.why, at: d.void.at } : null, eta: d.eta, reply: d.reply, src: d.src,
    items: d.items.map((i) => ({ p: i.p, n: i.n, q: i.q, fq: i.fq, u: i.u, r: i.r, amt: i.amt, sq: i.sq, sr: i.sr })), sub: d.sub, disc: d.disc, oth: d.oth, rnd: d.rnd, hist: (d.hist || []).length });
  return json(200, { ok: true, shop: { name: shop.name, owner: shop.owner, ph: shop.ph, addr: shop.addr, city: shop.city, gstin: shop.gstin, upi: shop.upi, upiName: shop.upiName || shop.name, terms: shop.terms, lang: shop.lang, ordOn: p.k === "c" && shop.ordOn !== false, catOn: shop.catOn !== false },
    orders: docs.filter((d) => d.st === "draft" && d.src === "link" && !d.void).map((d) => ({ id: d.id, at: (d.ord && d.ord.at) || d.at, n: d.items.length, amt: d.amt, items: d.items.map((i) => ({ n: i.n, q: i.q, u: i.u })) })),
    party: { n: p.n, firm: p.firm, k: p.k, conf: p.conf, days: p.days }, s: L2.s, bills: L2.bills, rows: L2.rows, docs: docs.filter((d) => d.st !== "draft").sort((a, c) => (a.d < c.d ? 1 : -1)).slice(0, 200).map(keep) });
}
