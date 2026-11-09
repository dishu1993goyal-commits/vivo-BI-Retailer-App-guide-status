// 🏪 Kirana Business Manager ("Khata"): a complete digital book for a retail shop — items with cost / selling price /
// margin, distributors and key customers, purchase bills, sale bills, payments both ways, cash & UPI counter sales,
// stock with FIFO lots (ageing + expiry), reports and AI insights. Every rupee has a record, and every bill / payment
// can be acknowledged by the other side through their own secure link (checked with the last 4 digits of their mobile).
//
// Who uses it
//   • The shop owner: his own login (mobile + password) on khata.html — no BI account, no dashboard, nothing else.
//     Actions "kh-o-<op>" carry the owner's session token (b.ktok).
//   • HO admins (BI session, admin app): create shops and owner logins, open any shop to help: "kh-a-<op>" with b.shop.
//   • Customers / distributors (no login): "kh-p-open" / "kh-p-act" with their link token (b.l) + last 4 of mobile (b.pin).
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
    gst: x.gst !== undefined ? !!x.gst : !!o.gst, low: x.low !== undefined ? Math.max(0, qn(x.low)) : o.low != null ? o.low : 5, expWarn: x.expWarn !== undefined ? Math.max(1, Math.min(365, Math.round(num(x.expWarn)))) : o.expWarn || 30,
    auto: { wa: x.auto ? !!x.auto.wa : !!(o.auto && o.auto.wa), mail: x.auto ? x.auto.mail !== false : !(o.auto && o.auto.mail === false) },
    seq: o.seq || { sale: 0, rcpt: 0, pay: 0, po: 0, ret: 0 }, pk: o.pk || null, created: o.created || 0, off: !!o.off,
  };
}
const shopOut = (s) => { const o = Object.assign({}, s); o.pkSet = !!(s.pk && s.pk.key); o.pkPhone = s.pk ? s.pk.phone || "" : ""; delete o.pk; return o; };
function cleanProd(x, o) {
  x = x || {}; o = o || {};
  const g = (k, n) => (x[k] !== undefined ? str(x[k], n) : o[k] || ""), n = (k) => (x[k] !== undefined && x[k] !== "" ? num(x[k]) : o[k] || 0);
  return { id: o.id || cid(x.id) || nid("i"), n: g("n", 90), cat: g("cat", 40) || "General", br: g("br", 40), u: g("u", 12) || "pc", bc: g("bc", 40), hsn: g("hsn", 12),
    cost: n("cost"), mrp: n("mrp"), sp: n("sp"), gst: n("gst"), rol: x.rol !== undefined && x.rol !== "" ? qn(x.rol) : o.rol != null ? o.rol : null, pack: x.pack !== undefined ? qn(x.pack) : o.pack || 0,
    dist: x.dist !== undefined ? cid(x.dist) : o.dist || "", stk: o.stk != null ? o.stk : 0, lots: o.lots || [], ph: o.ph || [], lp: o.lp || "", ls: o.ls || "", on: x.on !== undefined ? x.on !== false : o.on !== false, at: Date.now() };
}
function cleanParty(x, o, shop) {
  x = x || {}; o = o || {};
  const g = (k, n) => (x[k] !== undefined ? str(x[k], n) : o[k] || ""), k = o.k || (x.k === "d" ? "d" : "c");
  return { id: o.id || nid(k), k, n: g("n", 80), firm: g("firm", 80), ph: x.ph !== undefined ? ph10(x.ph) : o.ph || "", wa: x.wa !== undefined ? ph10(x.wa) : o.wa || "", em: x.em !== undefined ? mail(x.em) : o.em || "",
    addr: g("addr", 200), gst: g("gst", 15).toUpperCase(), days: x.days !== undefined && x.days !== "" ? Math.max(0, Math.min(365, Math.round(num(x.days)))) : o.days != null ? o.days : k === "d" ? shop.ddays : shop.days,
    lim: x.lim !== undefined ? num(x.lim) : o.lim || 0, upi: x.upi !== undefined ? (Array.isArray(x.upi) ? x.upi : String(x.upi).split(/[\s,;]+/)).map((u) => str(u, 60).toLowerCase()).filter(Boolean).slice(0, 8) : o.upi || [],
    sman: g("sman", 60), sph: x.sph !== undefined ? ph10(x.sph) : o.sph || "", od: g("od", 40), lead: x.lead !== undefined ? Math.max(0, Math.min(60, Math.round(num(x.lead)))) : o.lead != null ? o.lead : 2,
    ob: x.ob !== undefined ? num(x.ob) : o.ob || 0, obd: x.obd !== undefined ? day(x.obd) : o.obd || "", notes: g("notes", 300), on: x.on !== undefined ? x.on !== false : o.on !== false,
    tok: o.tok || "", conf: o.conf || null, s: o.s || null, at: o.at || Date.now() };
}
function cleanItems(a) {
  return (Array.isArray(a) ? a : []).slice(0, 300).map((i) => ({ p: cid(i.p), n: str(i.n, 90), q: qn(i.q), fq: qn(i.fq), r: num(i.r), u: str(i.u, 12), g: num(i.g), dsc: Math.max(0, Math.min(100, num(i.dsc))),
    mrp: num(i.mrp), e: day(i.e), b: str(i.b, 20) })).filter((i) => (i.p || i.n) && (i.q || i.fq));
}
function cleanDoc(x, o, party, shop) {
  x = x || {}; o = o || {};
  const ty = TYPES[party.k].includes(x.ty) ? x.ty : o.ty; if (!ty) return null;
  const d = day(x.d) || o.d || istDay(Date.now()), items = ty === "rcpt" || ty === "pay" || ty === "adj" ? [] : cleanItems(x.items);
  items.forEach((i) => { i.amt = r2(i.q * i.r * (1 - i.dsc / 100)); });
  const sub = r2(items.reduce((s, i) => s + i.amt, 0)), disc = num(x.disc), oth = num(x.oth), rnd = num(x.rnd);
  let amt = items.length ? r2(sub - disc + oth + rnd) : num(x.amt); if (ty !== "adj") amt = Math.abs(amt);
  const paid = ty === "sale" || ty === "pur" ? Math.max(0, Math.min(amt, num(x.paid))) : 0;
  return { id: o.id || nid(ty[0]), ty, no: str(x.no, 30) || o.no || "", d, items, sub, disc, oth, rnd, amt, paid, mode: MODES.includes(x.mode) ? x.mode : o.mode || (ty === "sale" || ty === "pur" ? "" : "Cash"),
    ref: str(x.ref, 60), note: str(x.note, 300), due: ty === "sale" || ty === "pur" || (ty === "adj" && amt > 0) ? day(x.due) || addD(d, party.days || 0) : "",
    against: (Array.isArray(x.against) ? x.against : []).map(cid).filter(Boolean).slice(0, 40), st: ["final", "draft", "pending"].includes(x.st) ? x.st : o.st || "final",
    src: o.src || str(x.src, 10) || "owner", eta: day(x.eta), ack: o.ack || null, hist: o.hist || [], sent: o.sent || {}, photo: o.photo || !!x.photo, at: o.at || Date.now(), by: o.by || "", void: o.void || null };
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
    pr.stk = qn((pr.stk || 0) + dl);
    const ym = doc.d.slice(0, 7), m = mv[ym] || (mv[ym] = { p: {} }), mp = m.p[pr.id] || (m.p[pr.id] = { i: 0, o: 0 });
    if (kind === "d" && doc.ty === "pur") {
      mp.i = qn(mp.i + dl);
      if (sign > 0) {
        const tot = it.q + it.fq, landed = tot ? r2((it.amt || it.q * it.r) / tot) : it.r;
        pr.lots.push({ d: doc.d, q: tot, e: it.e || "", c: landed, doc: doc.id, b: it.b || "" });
        if (!pr.lp || doc.d >= pr.lp) { if (pr.cost && Math.abs(pr.cost - landed) > 0.009) pr.ph = [[doc.d, pr.cost, landed, doc.id]].concat(pr.ph || []).slice(0, 8); pr.cost = landed; pr.lp = doc.d; pr.dist = pr.dist || doc._pid || ""; }
        if (it.mrp) pr.mrp = it.mrp;
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
  if (link) lines.push("", `${T.view}: ${link}`, `(${T.code})`);
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
async function books(store, sid) {
  const [shop, P, R] = await Promise.all([store.get(K.shop(sid)), store.get(K.prod(sid)), store.get(K.party(sid))]);
  return { shop: shop ? cleanShop({}, shop) : null, prods: (P && P.list) || [], parties: (R && R.list) || [] };
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

async function ownerOp(op, b, ctx) {
  const { store, t, sid, by } = ctx, today = istDay(t);
  const B = await books(store, sid); if (!B.shop) return json(404, { ok: false, error: "Shop not found." });
  const { shop } = B, PM = Object.fromEntries(B.prods.map((p) => [p.id, p])), RM = Object.fromEntries(B.parties.map((p) => [p.id, p]));
  const saveProds = () => store.set(K.prod(sid), { list: B.prods, at: t });
  const saveParties = () => store.set(K.party(sid), { list: B.parties, at: t });
  const docsOf = async (pid) => ((await store.get(K.pt(sid, pid))) || { list: [] }).list;
  const refresh = (p, docs) => { const L = ledger(p, docs, today); p.s = L.s; return L; };
  const origin = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(String(b.origin || "")) ? b.origin : (ctx.env && ctx.env.URL) || "";

  if (op === "boot") {
    const inbox = ((await store.get(K.inbox(sid))) || { list: [] }).list.filter((x) => !x.done).slice(0, 80);
    const ym = today.slice(0, 7), D = (await store.get(K.day(sid, ym))) || { days: {} };
    const months = lastMonths(today, 3), mv = await loadMv(store, sid, months);
    return json(200, { ok: true, shop: shopOut(shop), prods: B.prods.map(prodLite), parties: B.parties, inbox, today, todayDay: D.days[today] || null, month: D.days, vel: velocity(mv, months, today), modes: MODES, by });
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
    if (!old && x.stk) { n.stk = qn(x.stk); if (n.stk > 0) n.lots = [{ d: day(x.lp) || today, q: n.stk, c: n.cost, e: day(x.e), doc: "open" }]; }
    if (old && old.cost !== n.cost && n.cost) n.ph = [[today, old.cost, n.cost, "edit"]].concat(old.ph || []).slice(0, 8);
    if (old) Object.assign(old, n); else { B.prods.push(n); if (B.prods.length > 6000) return json(400, { ok: false, error: "Too many items (6,000 max)." }); }
    await saveProds(); return json(200, { ok: true, item: old || n });
  }
  if (op === "prod-bulk") {   // Excel import: match by id, barcode or name; never touches stock of existing items
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 6000) : []; let add = 0, upd = 0;
    const byName = {}; B.prods.forEach((p) => { byName[p.n.toLowerCase() + "|" + (p.u || "")] = p; if (p.bc) byName["bc:" + p.bc] = p; });
    for (const r of rows) {
      if (!str(r.n, 90)) continue; const u = str(r.u, 12) || "pc";
      const old = (r.id && PM[cid(r.id)]) || (r.bc && byName["bc:" + str(r.bc, 40)]) || byName[str(r.n, 90).toLowerCase() + "|" + u] || byName[str(r.n, 90).toLowerCase() + "|pc"];
      const clean = {}; Object.keys(r).forEach((k) => { if (r[k] !== "" && r[k] != null) clean[k] = r[k]; });
      if (old) { const keepCost = old.cost; Object.assign(old, cleanProd(clean, old)); if (keepCost !== old.cost && keepCost) old.ph = [[today, keepCost, old.cost, "import"]].concat(old.ph || []).slice(0, 8); upd++; }
      else { const n = cleanProd(clean, null); if (clean.stk) { n.stk = qn(clean.stk); if (n.stk > 0) n.lots = [{ d: today, q: n.stk, c: n.cost, e: day(clean.e), doc: "open" }]; } B.prods.push(n); byName[n.n.toLowerCase() + "|" + n.u] = n; add++; }
    }
    if (B.prods.length > 6000) return json(400, { ok: false, error: "Too many items (6,000 max)." });
    await saveProds(); await addLog(store, sid, t, by, `Items imported: ${add} new, ${upd} updated`); return json(200, { ok: true, add, upd, prods: B.prods });
  }
  if (op === "prod-price") {   // set selling prices from a target margin (category or selected items)
    const ids = new Set((b.ids || []).map(cid)), m = num(b.margin); let n = 0;
    if (!(m >= 0 && m < 500)) return json(400, { ok: false, error: "Enter a margin %." });
    for (const p of B.prods) { if (!ids.has(p.id) || !p.cost) continue; let sp = p.cost * (1 + m / 100); sp = b.round ? Math.ceil(sp) : r2(sp); if (p.mrp && sp > p.mrp && !b.overMrp) sp = p.mrp; p.sp = sp; n++; }
    await saveProds(); await addLog(store, sid, t, by, `Selling price set at ${m}% margin for ${n} items`); return json(200, { ok: true, n, prods: B.prods });
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
    return json(200, { ok: true, changed: out.length, prods: B.prods });
  }

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
    if (n.ty === "sale") n.items.forEach((i) => { const pr = PM[i.p]; i.c = pr ? pr.cost : 0; });
    const mv = await loadMv(store, sid, [...new Set([n.d.slice(0, 7), old ? old.d.slice(0, 7) : n.d.slice(0, 7)])]);
    const touched = new Set();
    if (old && old.st === "final") { old._pid = p.id; applyStock(PM, mv, p.k, old, -1, today).forEach((x) => touched.add(x)); delete old._pid; }
    if (!n.no && (n.ty === "sale" || n.ty === "rcpt" || n.ty === "pay" || n.ty === "po" || n.ty === "ret")) { shop.seq[n.ty] = (shop.seq[n.ty] || 0) + 1; const pre = { sale: shop.pre, rcpt: "R", pay: "P", po: "PO", ret: "CN" }[n.ty]; n.no = pre + "-" + String(shop.seq[n.ty]).padStart(4, "0"); await store.set(K.shop(sid), Object.assign({}, shop)); }
    if (n.st === "final") { n._pid = p.id; applyStock(PM, mv, p.k, n, 1, today).forEach((x) => touched.add(x)); delete n._pid; }
    if (old) { if (old.st === "final" && (old.amt !== n.amt || old.paid !== n.paid || old.d !== n.d)) n.hist = [{ at: t, by, amt: old.amt, paid: old.paid, d: old.d }].concat(old.hist || []).slice(0, 20); if (old.amt !== n.amt && old.ack) n.ack = null; n.by = old.by; Object.assign(old, n); }
    else { n.by = by; docs.push(n); }
    if (x.photo && /^data:image\/(jpeg|png|webp);base64,/.test(x.photo) && x.photo.length < 2500000) { await store.set(K.img(sid, n.id), { src: x.photo, at: t }); (old || n).photo = true; }
    const L = refresh(p, docs);
    await store.set(K.pt(sid, p.id), { list: docs }); await saveParties(); if (touched.size) await saveProds(); await saveMv(store, sid, mv);
    await addLog(store, sid, t, by, `${old ? "Edited" : "New"} ${n.ty} ${n.no || ""} · ${p.n || p.firm} · ${rs(n.amt)}${n.st !== "final" ? " (" + n.st + ")" : ""}`);
    const doc = old || n, out = { ok: true, doc, party: p, s: L.s, prods: [...touched].map((id) => PM[id]) };
    if (doc.st === "final" && (b.send || (!old && (shop.auto.wa || shop.auto.mail)))) out.sent = await deliver(ctx, shop, p, doc, L.s, origin, b.send ? b.via : null, store, sid);
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
    await saveParties(); return json(200, Object.assign({ ok: true }, res));
  }

  // ----- counter (walk-in) sales, expenses, day book -----
  if (op === "day-get") { const m = /^\d{4}-\d{2}$/.test(b.m) ? b.m : today.slice(0, 7); return json(200, { ok: true, m, days: ((await store.get(K.day(sid, m))) || { days: {} }).days }); }
  if (op === "day-save") {
    const d = day(b.d) || today, m = d.slice(0, 7), D = (await store.get(K.day(sid, m))) || { days: {} }, x = D.days[d] || { cs: 0, us: 0, ex: [], bills: [], note: "" };
    if (b.cs !== undefined) x.cs = Math.max(0, num(b.cs)); if (b.us !== undefined) x.us = Math.max(0, num(b.us)); if (b.cd !== undefined) x.cd = Math.max(0, num(b.cd));
    if (Array.isArray(b.ex)) x.ex = b.ex.slice(0, 40).map((e) => ({ n: str(e.n, 60), a: num(e.a), m: MODES.includes(e.m) ? e.m : "Cash" })).filter((e) => e.n && e.a);
    if (b.note !== undefined) x.note = str(b.note, 300); if (b.addUpi) x.us = r2((x.us || 0) + Math.max(0, num(b.addUpi)));
    x.at = t; x.by = by; D.days[d] = x; await store.set(K.day(sid, m), D);
    await addLog(store, sid, t, by, `Day ${d}: cash ${rs(x.cs)}, UPI ${rs(x.us)}${x.ex.length ? ", expenses " + rs(x.ex.reduce((s, e) => s + e.a, 0)) : ""}`); return json(200, { ok: true, day: x });
  }
  if (op === "counter") {   // an itemised walk-in bill: reduces stock and adds to the day's cash / UPI sale
    const d = day(b.d) || today, m = d.slice(0, 7), D = (await store.get(K.day(sid, m))) || { days: {} }, x = D.days[d] || { cs: 0, us: 0, ex: [], bills: [], note: "" };
    const items = cleanItems(b.items); items.forEach((i) => { i.amt = r2(i.q * i.r * (1 - i.dsc / 100)); i.c = PM[i.p] ? PM[i.p].cost : 0; });
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
    await Promise.all(B.parties.map(async (p) => { (await docsOf(p.id)).forEach((d) => { if (!d.void && d.st === "final") all.push(Object.assign({ pid: p.id, pk: p.k, pn: p.n || p.firm }, d)); }); }));
    const months = []; { let m = from.slice(0, 7); while (m <= to.slice(0, 7) && months.length < 25) { months.push(m); const d = new Date(m + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); m = d.toISOString().slice(0, 7); } }
    const days = {}; await Promise.all(months.map(async (m) => { Object.assign(days, ((await store.get(K.day(sid, m))) || { days: {} }).days); }));
    const inR = (d) => d >= from && d <= to, docs = all.filter((d) => inR(d.d)), dd = Object.keys(days).filter(inR).sort();
    return json(200, { ok: true, from, to, docs: docs.map((d) => ({ id: d.id, pid: d.pid, pk: d.pk, pn: d.pn, ty: d.ty, no: d.no, d: d.d, amt: d.amt, paid: d.paid, mode: d.mode, items: d.items.map((i) => ({ p: i.p, n: i.n, q: i.q, r: i.r, amt: i.amt, c: i.c || 0 })) })), days: dd.map((k) => Object.assign({ d: k }, days[k])) });
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
    const months = lastMonths(today, 3), mv = await loadMv(store, sid, months), vel = velocity(mv, months, today), live2 = B.prods.filter((p) => p.on !== false);
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
async function deliver(ctx, shop, p, doc, s, origin, via, store, sid, kind) {
  await ensureLink(store, sid, p);
  const k = kind || (doc ? (doc.ty === "rcpt" ? "rcpt" : doc.ty === "pay" ? "pay" : doc.ty === "po" ? "po" : doc.ty === "pur" ? "pur" : "sale") : "stmt");
  const link = linkUrl(origin, p.tok, doc ? doc.id : ""), text = message(k, shop, p, doc || { items: [] }, s, link), out = { text, link, wa: p.wa || p.ph || "", mail: null, auto: null };
  const wantMail = via ? via.includes("mail") : shop.auto.mail, wantWa = via ? via.includes("wa") : shop.auto.wa;
  if (wantMail && p.em) out.mail = await sendMail(Object.assign({}, ctx, { replyTo: shop.em }), p.em, `${shop.name} · ${{ sale: "Bill", rcpt: "Payment receipt", pay: "Payment advice", po: "Purchase order", pur: "Purchase bill", remind: "Payment reminder", stmt: "Account statement" }[k] || "Update"}${doc && doc.no ? " " + doc.no : ""}`, mailHtml(shop, p, doc, text, link));
  if (wantWa && (p.wa || p.ph) && shop.pk && shop.pk.key) out.auto = await sendWa(ctx, shop, p.wa || p.ph, text);
  if (doc && (out.mail && out.mail.ok || out.auto && out.auto.ok)) {
    const docs = ((await store.get(K.pt(sid, p.id))) || { list: [] }).list, d = docs.find((x) => x.id === doc.id);
    if (d) { d.sent = Object.assign({}, d.sent, out.mail && out.mail.ok ? { mail: Date.now() } : {}, out.auto && out.auto.ok ? { wa: Date.now() } : {}); await store.set(K.pt(sid, p.id), { list: docs }); doc.sent = d.sent; }
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
    const list = await Promise.all(S.list.map(async (x) => { const R = (await store.get(K.party(x.id))) || { list: [] }, P = (await store.get(K.prod(x.id))) || { list: [] }; const sum = (k) => R.list.filter((p) => p.k === k).reduce((s, p) => s + Math.max(0, (p.s && p.s.bal) || 0), 0); return Object.assign({}, x, { items: P.list.length, parties: R.list.length, recv: r2(sum("c")), pay: r2(sum("d")) }); }));
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
  const sid = cid(b.shop); if (!sid || !(await store.get(K.shop(sid)))) return json(404, { ok: false, error: "Shop not found." });
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
  if (!p.ph) return json(403, { ok: false, need: "phone", shop: shop.name, error: "The shop hasn't saved your mobile number yet — ask them to add it, then open the link again." });
  if (pin !== p.ph.slice(-4)) { L.fails = (L.fails || 0) + 1; if (L.fails >= 8) { L.lockUntil = t + 36e5; L.fails = 0; } await store.set(K.link(tok), L); return json(403, { ok: false, need: "pin", shop: shop.name, party: p.n, error: pin ? "That doesn't match — enter the last 4 digits of your mobile number." : "" }); }
  if (L.fails) { L.fails = 0; await store.set(K.link(tok), L); }
  const docs = ((await store.get(K.pt(L.sid, p.id))) || { list: [] }).list;
  const inbox = async (kind, text, extra) => { const I = (await store.get(K.inbox(L.sid))) || { list: [] }; I.list.unshift(Object.assign({ id: nid("n"), kind, pid: p.id, pn: p.n || p.firm, pk: p.k, text: String(text).slice(0, 300), at: t }, extra || {})); I.list = I.list.slice(0, 600); await store.set(K.inbox(L.sid), I); };
  if (b.action === "kh-p-act") {
    const a = b.act, who = (p.n || p.firm) + " (via link)";
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
    items: d.items.map((i) => ({ n: i.n, q: i.q, fq: i.fq, u: i.u, r: i.r, amt: i.amt, sq: i.sq, sr: i.sr })), sub: d.sub, disc: d.disc, oth: d.oth, rnd: d.rnd, hist: (d.hist || []).length });
  return json(200, { ok: true, shop: { name: shop.name, owner: shop.owner, ph: shop.ph, addr: shop.addr, city: shop.city, gstin: shop.gstin, upi: shop.upi, upiName: shop.upiName || shop.name, terms: shop.terms, lang: shop.lang },
    party: { n: p.n, firm: p.firm, k: p.k, conf: p.conf, days: p.days }, s: L2.s, bills: L2.bills, rows: L2.rows, docs: docs.filter((d) => d.st !== "draft").sort((a, c) => (a.d < c.d ? 1 : -1)).slice(0, 200).map(keep) });
}
