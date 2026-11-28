// 🏆 Retailer Rewards Hub — one rewards-points & redemption engine, a separate fully-configurable program per state.
// Each State HO sets its own clubs / tiers (entry, retention, grace, downgrade, fast-track, multipliers), earning rules
// (from 22 editable templates or a custom IF / THEN rule on any metric), vouchers & offers (code pool, redirect link,
// manual or scheme-wallet credit), tasks, budget guard-rails and approvals. Retailers see their club, points, how to
// earn and the catalogue in the Retailer portal (and the vivo Retailer App), and redeem there.
// Data comes from the existing retailer tools: business & targets (rtd:), IMEIs / activations (rtil:), scheme payouts
// (rpb:), the scheme wallet (rpr:), plus uploaded KPI sheets and approved tasks.
// Storage (st = state slug):
//   rh:cfg:<st>        { state, draft, live, status:"draft"|"pending"|"live", pending:{by,at,note}, ver, roles:{approvers:[]}, upd, by }
//   rh:ver:<st>:<n>    { n, cfg, at, by, approvedBy, note }                    — every approved version (rollback)
//   rh:aud:<st>        { items:[{ at, by, act, what }] }                       — audit log (latest 3000)
//   rh:led:<st>:<RID>  { rid, name, tier, tierSince, grace, hist:[], e:[{ id, at, d, type, pts, left, exp, ref, rule, note, by }] }
//   rh:red:<st>:<id>   { id, rid, name, offer, oname, pts, value, status, code, link, at, by, via, upd, note }
//   rh:codes:<st>:<offer> { codes:[{ c, rid, red, at }] }                    — never sent to devices in bulk
//   rh:tsub:<st>:<id>  { id, rid, name, task, tname, note, photo, status, at, pts, by }
//   rh:kpi:<st>:<periodKey> { name, rows:{ RID:{ metric:value } }, at, by }
//   rh:run:<st>:<id>   { id, period, mode, at, by, totals, rows }              — simulations / postings
import { randomBytes } from "node:crypto";

const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const num = (v, d) => { if (v == null || v === "") return d == null ? 0 : d; const n = Number(String(v).replace(/[₹,%\s]/g, "")); return isFinite(n) ? n : (d == null ? 0 : d); };
const low = (x) => String(x || "").trim().toLowerCase();
const RID = (v) => str(v, 40).toUpperCase().replace(/[^A-Z0-9_\-./]/g, "");
const ST = (s) => low(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const nid = () => Date.now().toString(36) + randomBytes(3).toString("hex");
const r2 = (n) => Math.round(n * 100) / 100;
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const mOf = (d) => String(d || "").slice(0, 7);
const monthsBetween = (a, b) => { const out = []; let y = +a.slice(0, 4), m = +a.slice(5, 7); const Y = +b.slice(0, 4), M = +b.slice(5, 7); while ((y < Y || (y === Y && m <= M)) && out.length < 40) { out.push(y + "-" + String(m).padStart(2, "0")); m++; if (m > 12) { m = 1; y++; } } return out; };
const lastDay = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const nk = (s) => String(s || "").toLowerCase().replace(/^vivo\s+/, "").replace(/\b5g\b/g, "").replace(/[^a-z0-9+]/g, "");
const listOf = (v, n) => (Array.isArray(v) ? v : String(v || "").split(/[,\n;]/)).map((x) => str(x, 60)).filter(Boolean).slice(0, n || 200);
function parse(t) { const s = String(t || "").replace(/^```(json)?/i, "").replace(/```\s*$/, ""); try { return JSON.parse(s); } catch (e) { } const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { } } return null; }

// ================= catalogue: metrics, operators, award types, templates =================
export const RH_METRICS = [
  ["su", "Sell-out units", "units"], ["sv", "Sell-out value (₹)", "₹"], ["pu", "Purchase / sell-in units", "units"], ["pv", "Purchase / sell-in value (₹)", "₹"],
  ["tu", "Target units", "units"], ["tv", "Target value (₹)", "₹"], ["ach_u", "Target achievement — units %", "%"], ["ach_v", "Target achievement — value %", "%"],
  ["g_mom_u", "Growth vs previous period — units %", "%"], ["g_mom_v", "Growth vs previous period — value %", "%"], ["g_yoy_u", "Growth vs same period last year — units %", "%"], ["g_yoy_v", "Growth vs same period last year — value %", "%"],
  ["prem_share", "Premium mix — value share %", "%"], ["prem_u", "Premium units", "units"], ["models_u", "Units of selected models / series", "units"], ["models_v", "Value of selected models / series (₹)", "₹"],
  ["act", "IMEI activations", "units"], ["act_rate", "Activation rate % (activated ÷ billed)", "%"], ["fin_share", "Financed share % of activations", "%"], ["sell_thru", "Sell-through % (sales ÷ purchase)", "%"],
  ["stock_days", "Stock cover (days)", "days"], ["streak", "Consecutive months at/above achievement %", "months"], ["tasks", "Approved tasks", "count"], ["payout", "Scheme payout earned (₹)", "₹"],
  ["slab_hits", "Scheme payout lines achieved", "count"], ["tier_rank", "Current club rank (1 = top)", "rank"], ["months_active", "Months with sales (last 12)", "months"], ["kpi", "Uploaded KPI (by name)", "value"]];
const MK = RH_METRICS.map((m) => m[0]);
export const RH_OPS = [[">=", "≥"], [">", ">"], ["<=", "≤"], ["<", "<"], ["==", "="], ["!=", "≠"], ["between", "between"]];
export const RH_AWARDS = [["fixed", "Fixed points"], ["per_unit", "Points per unit"], ["per_value", "Points per ₹ of value"], ["slab", "Slab table (by a metric)"], ["per_pct_over", "Points per 1% above a level"], ["pct_bonus", "% bonus on other points earned"], ["multiplier", "Multiply points of chosen rules (campaign)"]];
export const RH_PERIODS = [["month", "Monthly"], ["week", "Weekly"], ["quarter", "Quarterly"], ["half", "Half-yearly"], ["year", "Yearly"], ["custom", "Festival / special dates"]];
export const RH_CATS = [["shopping", "🛍 Shopping"], ["travel", "✈️ Travel"], ["hotel", "🏨 Hotels"], ["fuel", "⛽ Fuel"], ["food", "🍽 Food"], ["electronics", "📱 Electronics"], ["experience", "🎟 Experiences"], ["vivo", "💙 vivo merchandise"], ["wallet", "💰 Scheme wallet credit"], ["cash", "🏦 Bank / UPI"], ["other", "🎁 Other"]];
const C = (m, op, v, v2, models, extra) => Object.assign({ m, op, v }, v2 != null ? { v2 } : {}, models ? { models } : {}, extra || {});
export const RH_TEMPLATES = [
  { k: "target_slab", ic: "🎯", name: "Monthly target slab", desc: "Points by achievement band — e.g. 90%, 100%, 110%, 120% of the monthly value target.", rule: { period: "month", when: { all: true, conds: [C("ach_v", ">=", 90)] }, award: { type: "slab", metric: "ach_v", slabs: [{ min: 90, max: 99.99, pts: 200 }, { min: 100, max: 109.99, pts: 500 }, { min: 110, max: 119.99, pts: 750 }, { min: 120, max: 0, pts: 1000 }] }, tierMult: true, group: "target", stack: false } },
  { k: "per_unit", ic: "📦", name: "Points per unit sold", desc: "Simple earn on every unit of sell-out.", rule: { period: "month", when: { all: true, conds: [C("su", ">=", 1)] }, award: { type: "per_unit", metric: "su", value: 10 }, tierMult: true } },
  { k: "per_value", ic: "₹", name: "Points per ₹ value", desc: "e.g. 1 point for every ₹1,000 of sell-out value.", rule: { period: "month", when: { all: true, conds: [C("sv", ">=", 1)] }, award: { type: "per_value", metric: "sv", value: 1, per: 1000 }, tierMult: true } },
  { k: "over_ach", ic: "🚀", name: "Over-achievement kicker", desc: "Bonus for every 1% above 100% of target (capped).", rule: { period: "month", when: { all: true, conds: [C("ach_v", ">", 100)] }, award: { type: "per_pct_over", metric: "ach_v", base: 100, value: 20 }, cap: { perRetailer: 1000 }, tierMult: true } },
  { k: "growth_mom", ic: "📈", name: "Growth vs last month", desc: "Reward growth over the previous month (slabs).", rule: { period: "month", when: { all: true, conds: [C("g_mom_v", ">=", 10), C("sv", ">=", 100000)] }, award: { type: "slab", metric: "g_mom_v", slabs: [{ min: 10, max: 19.99, pts: 200 }, { min: 20, max: 0, pts: 400 }] }, tierMult: true } },
  { k: "growth_yoy", ic: "📊", name: "Growth vs last year", desc: "Reward growth over the same month last year.", rule: { period: "month", when: { all: true, conds: [C("g_yoy_v", ">=", 15)] }, award: { type: "fixed", value: 400 }, tierMult: true } },
  { k: "festive", ic: "🪔", name: "Festival / special-duration bonus", desc: "Extra points for a festive window (e.g. Diwali): per unit sold between two dates.", rule: { period: "custom", from: "", to: "", when: { all: true, conds: [C("su", ">=", 10)] }, award: { type: "per_unit", metric: "su", value: 15 }, tierMult: true, group: "festive" } },
  { k: "weekly", ic: "⚡", name: "Weekly sprint", desc: "Hit a weekly units target, earn points every week.", rule: { period: "week", when: { all: true, conds: [C("su", ">=", 15)] }, award: { type: "fixed", value: 100 } } },
  { k: "launch", ic: "🆕", name: "New-launch push", desc: "Points per unit of selected launch models / series.", rule: { period: "month", when: { all: true, conds: [C("models_u", ">=", 1, null, ["V70"])] }, award: { type: "per_unit", metric: "models_u", value: 25, models: ["V70"] }, tierMult: true } },
  { k: "premium", ic: "💎", name: "Premium mix bonus", desc: "Bonus when premium models are a big share of sales.", rule: { period: "month", when: { all: true, conds: [C("prem_share", ">=", 30), C("sv", ">=", 200000)] }, award: { type: "fixed", value: 300 }, tierMult: true } },
  { k: "series", ic: "🔷", name: "Series focus", desc: "Points per unit of a series (e.g. X or V series).", rule: { period: "month", when: { all: true, conds: [C("models_u", ">=", 5, null, ["X", "V"])] }, award: { type: "per_unit", metric: "models_u", value: 12, models: ["X", "V"] } } },
  { k: "streak", ic: "🔥", name: "Consistency streak", desc: "Bonus for 3 (or 6) months in a row at or above 100% of target.", rule: { period: "month", when: { all: true, conds: [C("streak", ">=", 3, null, null, { thr: 100 })] }, award: { type: "slab", metric: "streak", slabs: [{ min: 3, max: 5, pts: 500 }, { min: 6, max: 0, pts: 1200 }] }, group: "streak", stack: false } },
  { k: "tasks", ic: "✅", name: "Task-based points", desc: "Points for display photos, training, surveys, app tasks (set tasks in Tasks).", rule: { period: "month", when: { all: true, conds: [C("tasks", ">=", 1)] }, award: { type: "per_unit", metric: "tasks", value: 50 } } },
  { k: "activation", ic: "📲", name: "Activation & market hygiene", desc: "Reward fast, clean activations (activated ÷ billed).", rule: { period: "month", when: { all: true, conds: [C("act_rate", ">=", 90), C("act", ">=", 20)] }, award: { type: "fixed", value: 250 } } },
  { k: "finance", ic: "💳", name: "Affordability / finance share", desc: "Bonus when financed sales cross a share.", rule: { period: "month", when: { all: true, conds: [C("fin_share", ">=", 40), C("act", ">=", 15)] }, award: { type: "fixed", value: 200 } } },
  { k: "scheme", ic: "🎁", name: "Scheme achiever", desc: "Points on top of scheme payouts — per ₹100 of payout earned (links to Retailer payouts).", rule: { period: "month", when: { all: true, conds: [C("payout", ">", 0)] }, award: { type: "per_value", metric: "payout", value: 1, per: 100 } } },
  { k: "sellthru", ic: "🔄", name: "Healthy sell-through", desc: "Sell-through high and stock cover in a healthy range.", rule: { period: "month", when: { all: true, conds: [C("sell_thru", ">=", 85), C("stock_days", "<=", 35)] }, award: { type: "fixed", value: 150 } } },
  { k: "kpi", ic: "🧾", name: "Custom KPI (uploaded)", desc: "Any KPI you upload per retailer (e.g. display score, training score).", rule: { period: "month", when: { all: true, conds: [C("kpi", ">=", 80, null, null, { kpi: "display_score" })] }, award: { type: "fixed", value: 150 } } },
  { k: "campaign_x2", ic: "✖️2", name: "Double-points campaign", desc: "Multiply points of chosen rules during a window.", rule: { period: "custom", from: "", to: "", when: { all: true, conds: [] }, award: { type: "multiplier", value: 2, rules: [] } } },
  { k: "bonus_pct", ic: "➕", name: "% bonus for a club", desc: "Extra % on everything earned in the period (e.g. +10% for Diamond).", rule: { period: "month", when: { all: true, conds: [] }, award: { type: "pct_bonus", value: 10 }, tiers: [] } },
  { k: "welcome", ic: "👋", name: "Welcome / re-activation", desc: "One-time points when a retailer first sells (or returns after a gap).", rule: { period: "month", when: { all: true, conds: [C("su", ">=", 5), C("months_active", "<=", 1)] }, award: { type: "fixed", value: 300 }, once: true } },
  { k: "units_slab", ic: "🧮", name: "Units slab (no target needed)", desc: "Points by units sold, e.g. 20 / 50 / 100 units.", rule: { period: "month", when: { all: true, conds: [C("su", ">=", 20)] }, award: { type: "slab", metric: "su", slabs: [{ min: 20, max: 49, pts: 150 }, { min: 50, max: 99, pts: 450 }, { min: 100, max: 0, pts: 1000 }] }, tierMult: true } }];
export const RH_TIER_PRESETS = {
  four: [{ id: "diamond", name: "Diamond", icon: "💎", color: "#5BC0EB", min: 5000000, keep: 4000000, mult: 2, grace: 1 }, { id: "platinum", name: "Platinum", icon: "🏆", color: "#9AA5B1", min: 3000000, keep: 2400000, mult: 1.5, grace: 1 }, { id: "gold", name: "Gold", icon: "🥇", color: "#F2B705", min: 1500000, keep: 1200000, mult: 1.25, grace: 1 }, { id: "silver", name: "Silver", icon: "🥈", color: "#B8C2CC", min: 0, keep: 0, mult: 1, grace: 0 }],
  three: [{ id: "gold", name: "Gold", icon: "🥇", color: "#F2B705", min: 1000000, keep: 800000, mult: 1.5, grace: 1 }, { id: "silver", name: "Silver", icon: "🥈", color: "#B8C2CC", min: 400000, keep: 300000, mult: 1.2, grace: 1 }, { id: "bronze", name: "Bronze", icon: "🥉", color: "#CD7F32", min: 0, keep: 0, mult: 1, grace: 0 }],
  five: [{ id: "elite", name: "Elite", icon: "👑", color: "#7A4CFF", min: 8000000, keep: 6500000, mult: 2.5, grace: 1 }, { id: "diamond", name: "Diamond", icon: "💎", color: "#5BC0EB", min: 5000000, keep: 4000000, mult: 2, grace: 1 }, { id: "platinum", name: "Platinum", icon: "🏆", color: "#9AA5B1", min: 3000000, keep: 2400000, mult: 1.5, grace: 1 }, { id: "gold", name: "Gold", icon: "🥇", color: "#F2B705", min: 1500000, keep: 1200000, mult: 1.25, grace: 1 }, { id: "silver", name: "Silver", icon: "🥈", color: "#B8C2CC", min: 0, keep: 0, mult: 1, grace: 0 }] };
export function rhDefault(state) {
  return { name: (state || "State") + " Retailer Rewards", on: true, from: today().slice(0, 4) + "-01-01", to: today().slice(0, 4) + "-12-31", pointValue: 0.25, currency: "₹",
    expiry: { mode: "rolling", months: 12, fixedDate: "" }, carryOver: true, eligible: { types: [], cities: [], include: [], exclude: [], minSalesMonths: 0 },
    budget: { yearRs: 2500000, monthRs: 0, alertPct: 80, block: false }, approval: { required: true, autoRedeemUpTo: 1000, selfApprove: false },
    premium: { asp: 25000, models: [] }, redeem: { minBalance: 0, maxPerMonth: 0, blockIfAtRisk: false, minTier: "" },
    tierEval: { basis: "sv", window: 3, period: "quarter", rolling: true, upgradeNow: true, downgrade: "one", fastTrack: 0, lockFrom: "", lockTo: "", newTier: "" },
    tiers: RH_TIER_PRESETS.four.map((t) => Object.assign({ benefits: "", extra: [], upBonus: 0, keepBonus: 0, on: true }, t)), rules: [], offers: [], tasks: [],
    terms: "Points are earned as per the rules shown in the app. vivo may change or end the program; points have no cash value except where stated." };
}

// ================= cleaning a config (everything editable, nothing trusted) =================
function cleanCond(c) { c = c || {}; const m = MK.includes(c.m) ? c.m : "su"; return { m, op: RH_OPS.some((o) => o[0] === c.op) ? c.op : ">=", v: num(c.v), v2: num(c.v2), models: listOf(c.models, 60), thr: num(c.thr, 100), kpi: str(c.kpi, 40).replace(/[^\w-]/g, "_") }; }
function cleanRule(r, i) {
  r = r || {}; const a = r.award || {}, w = r.when || {};
  return { id: str(r.id, 24).replace(/[^\w-]/g, "") || "r" + nid(), name: str(r.name, 80) || "Rule " + (i + 1), desc: txt(r.desc, 400), on: r.on !== false, template: str(r.template, 20), show: r.show !== false,
    period: RH_PERIODS.some((p) => p[0] === r.period) ? r.period : "month", from: str(r.from, 10), to: str(r.to, 10), dateFrom: str(r.dateFrom, 10), dateTo: str(r.dateTo, 10),
    when: { all: w.all !== false, conds: (Array.isArray(w.conds) ? w.conds : []).slice(0, 12).map(cleanCond) },
    award: { type: RH_AWARDS.some((x) => x[0] === a.type) ? a.type : "fixed", value: num(a.value), per: Math.max(1, num(a.per, 1)), base: num(a.base, 100), metric: MK.includes(a.metric) ? a.metric : "su", models: listOf(a.models, 60), kpi: str(a.kpi, 40),
      slabs: (Array.isArray(a.slabs) ? a.slabs : []).slice(0, 20).map((s) => ({ min: num(s.min), max: num(s.max), pts: num(s.pts), perUnit: !!s.perUnit })), rules: listOf(a.rules, 40) },
    tiers: listOf(r.tiers, 20), types: listOf(r.types, 20), cities: listOf(r.cities, 100), include: listOf(r.include, 2000).map(RID), exclude: listOf(r.exclude, 2000).map(RID),
    tierMult: !!r.tierMult, cap: { perRetailer: Math.max(0, num((r.cap || {}).perRetailer)), total: Math.max(0, num((r.cap || {}).total)) }, priority: Math.round(num(r.priority, 5)), group: str(r.group, 30), stack: r.stack !== false,
    qualifying: r.qualifying !== false, once: !!r.once, expiryMonths: Math.max(0, Math.round(num(r.expiryMonths))) };
}
function cleanTier(t, i) { t = t || {}; return { id: str(t.id, 20).replace(/[^\w-]/g, "") || "t" + i, name: str(t.name, 30) || "Club " + (i + 1), icon: str(t.icon, 4) || "⭐", color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#6C5CFF", on: t.on !== false,
  min: Math.max(0, num(t.min)), keep: Math.max(0, num(t.keep)), mult: Math.max(0, Math.min(10, num(t.mult, 1))), grace: Math.max(0, Math.min(12, Math.round(num(t.grace)))), extra: (Array.isArray(t.extra) ? t.extra : []).slice(0, 6).map(cleanCond),
  upBonus: Math.max(0, num(t.upBonus)), keepBonus: Math.max(0, num(t.keepBonus)), benefits: txt(t.benefits, 600) }; }
function cleanOffer(o, i) { o = o || {}; return { id: str(o.id, 24).replace(/[^\w-]/g, "") || "o" + nid(), name: str(o.name, 80) || "Offer " + (i + 1), brand: str(o.brand, 40), cat: RH_CATS.some((c) => c[0] === o.cat) ? o.cat : "other", icon: str(o.icon, 4) || "🎁",
  img: /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(String(o.img || "")) && String(o.img).length < 120000 ? String(o.img) : "", pts: Math.max(1, Math.round(num(o.pts, 100))), value: Math.max(0, num(o.value)),
  fulfil: ["codes", "link", "manual", "wallet"].includes(o.fulfil) ? o.fulfil : "codes", link: /^https:\/\//.test(String(o.link || "")) ? str(o.link, 500) : "", howTo: txt(o.howTo, 600), terms: txt(o.terms, 800), validityDays: Math.max(0, Math.round(num(o.validityDays, 180))),
  tiers: listOf(o.tiers, 20), types: listOf(o.types, 20), cities: listOf(o.cities, 100), perMonth: Math.max(0, Math.round(num(o.perMonth))), perTotal: Math.max(0, Math.round(num(o.perTotal))), stockAlert: Math.max(0, Math.round(num(o.stockAlert, 20))),
  approval: ["auto", "manual", "above"].includes(o.approval) ? o.approval : "auto", from: str(o.from, 10), to: str(o.to, 10), on: o.on !== false, featured: !!o.featured, maxStock: Math.max(0, Math.round(num(o.maxStock))) }; }
function cleanTask(x, i) { x = x || {}; return { id: str(x.id, 24).replace(/[^\w-]/g, "") || "k" + nid(), name: str(x.name, 80) || "Task " + (i + 1), desc: txt(x.desc, 400), pts: Math.max(0, Math.round(num(x.pts, 50))), proof: ["photo", "text", "none"].includes(x.proof) ? x.proof : "photo",
  freq: ["once", "daily", "weekly", "monthly"].includes(x.freq) ? x.freq : "monthly", from: str(x.from, 10), to: str(x.to, 10), tiers: listOf(x.tiers, 20), on: x.on !== false, auto: !!x.auto, tierMult: !!x.tierMult }; }
export function cleanCfg(c, state) {
  const d = rhDefault(state); c = c && typeof c === "object" ? c : {};
  const ob = (k) => Object.assign({}, d[k], c[k] && typeof c[k] === "object" ? c[k] : {});
  const ex = ob("expiry"), el = ob("eligible"), bu = ob("budget"), ap = ob("approval"), pr = ob("premium"), rd = ob("redeem"), te = ob("tierEval");
  return { name: str(c.name, 80) || d.name, on: c.on !== false, from: str(c.from, 10) || d.from, to: str(c.to, 10) || d.to, pointValue: Math.max(0.001, Math.min(100, num(c.pointValue, d.pointValue))), currency: "₹",
    expiry: { mode: ["rolling", "fixed", "never"].includes(ex.mode) ? ex.mode : "rolling", months: Math.max(1, Math.min(60, Math.round(num(ex.months, 12)))), fixedDate: str(ex.fixedDate, 10) }, carryOver: c.carryOver !== false,
    eligible: { types: listOf(el.types, 20), cities: listOf(el.cities, 200), include: listOf(el.include, 5000).map(RID), exclude: listOf(el.exclude, 5000).map(RID), minSalesMonths: Math.max(0, Math.round(num(el.minSalesMonths))) },
    budget: { yearRs: Math.max(0, num(bu.yearRs)), monthRs: Math.max(0, num(bu.monthRs)), alertPct: Math.max(1, Math.min(100, num(bu.alertPct, 80))), block: !!bu.block },
    approval: { required: ap.required !== false, autoRedeemUpTo: Math.max(0, num(ap.autoRedeemUpTo)), selfApprove: !!ap.selfApprove },
    premium: { asp: Math.max(0, num(pr.asp, 25000)), models: listOf(pr.models, 100) },
    redeem: { minBalance: Math.max(0, num(rd.minBalance)), maxPerMonth: Math.max(0, Math.round(num(rd.maxPerMonth))), blockIfAtRisk: !!rd.blockIfAtRisk, minTier: str(rd.minTier, 20) },
    tierEval: { basis: MK.includes(te.basis) || te.basis === "qpts" ? te.basis : "sv", window: Math.max(1, Math.min(12, Math.round(num(te.window, 3)))), period: ["month", "quarter", "half", "year"].includes(te.period) ? te.period : "quarter", rolling: te.rolling !== false,
      upgradeNow: te.upgradeNow !== false, downgrade: te.downgrade === "fit" ? "fit" : "one", fastTrack: Math.max(0, num(te.fastTrack)), lockFrom: str(te.lockFrom, 10), lockTo: str(te.lockTo, 10), newTier: str(te.newTier, 20) },
    tiers: (Array.isArray(c.tiers) ? c.tiers : d.tiers).slice(0, 12).map(cleanTier), rules: (Array.isArray(c.rules) ? c.rules : []).slice(0, 80).map(cleanRule),
    offers: (Array.isArray(c.offers) ? c.offers : []).slice(0, 200).map(cleanOffer), tasks: (Array.isArray(c.tasks) ? c.tasks : []).slice(0, 60).map(cleanTask), terms: txt(c.terms, 3000) || d.terms };
}

// ================= periods =================
// key forms: M:2026-11  W:2026-11-16 (week starting)  Q:2026-Q4  H:2026-H2  Y:2026  C:2026-10-20_2026-11-05
export function periodOf(key) {
  key = String(key || ""); let m;
  const mk = (k, from, to, label) => { const months = monthsBetween(mOf(from), mOf(to)), len = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1; return { key: k, from, to, label, months, days: len, full: from.slice(8) === "01" && to === lastDay(mOf(to)) }; };
  if ((m = /^M:(\d{4})-(\d{2})$/.exec(key))) return mk(key, m[1] + "-" + m[2] + "-01", lastDay(m[1] + "-" + m[2]), new Date(m[1] + "-" + m[2] + "-01T00:00:00Z").toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }));
  if ((m = /^W:(\d{4}-\d{2}-\d{2})$/.exec(key))) return mk(key, m[1], addDays(m[1], 6), "Week of " + m[1]);
  if ((m = /^Q:(\d{4})-Q([1-4])$/.exec(key))) { const q = +m[2], a = m[1] + "-" + String(q * 3 - 2).padStart(2, "0"); return mk(key, a + "-01", lastDay(m[1] + "-" + String(q * 3).padStart(2, "0")), "Q" + q + " " + m[1]); }
  if ((m = /^H:(\d{4})-H([12])$/.exec(key))) { const h = +m[2]; return mk(key, m[1] + (h === 1 ? "-01-01" : "-07-01"), m[1] + (h === 1 ? "-06-30" : "-12-31"), "H" + h + " " + m[1]); }
  if ((m = /^Y:(\d{4})$/.exec(key))) return mk(key, m[1] + "-01-01", m[1] + "-12-31", "Year " + m[1]);
  if ((m = /^C:(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(key)) && m[1] <= m[2]) return mk(key, m[1], m[2], m[1] + " → " + m[2]);
  return null;
}
function shiftWin(P, months, days) { const from = days ? addDays(P.from, -days) : addMonths(P.from, -months), to = days ? addDays(P.to, -days) : (P.full ? lastDay(mOf(addMonths(P.to.slice(0, 8) + "01", -months))) : addMonths(P.to, -months)); return { from, to, months: monthsBetween(mOf(from), mOf(to)), full: P.full }; }
export function periodFor(kind, date) {   // the period of a rule kind that contains a date
  const d = date || today(), y = d.slice(0, 4), mo = +d.slice(5, 7);
  if (kind === "week") { const x = new Date(d + "T00:00:00Z"), wd = (x.getUTCDay() + 6) % 7; return "W:" + addDays(d, -wd); }
  if (kind === "quarter") return "Q:" + y + "-Q" + Math.ceil(mo / 3);
  if (kind === "half") return "H:" + y + "-H" + (mo <= 6 ? 1 : 2);
  if (kind === "year") return "Y:" + y;
  return "M:" + d.slice(0, 7);
}

// ================= metrics for one retailer and one window =================
function sumRows(rows, win, ctx) {
  const ms = new Set(win.months), o = { su: 0, sv: 0, pu: 0, pv: 0, stk: 0, models: {}, byMonth: {} };
  const lastM = win.months[win.months.length - 1];
  rows.forEach((r) => { if (!ms.has(r.m)) return; o.su += +r.su || 0; o.sv += +r.sv || 0; o.pu += +r.pu || 0; o.pv += +r.pv || 0; if (r.m === lastM) o.stk += +r.stk || 0;
    const k = r.model || "?", x = o.models[k] || (o.models[k] = { u: 0, v: 0 }); x.u += +r.su || 0; x.v += +r.sv || 0; const bm = o.byMonth[r.m] || (o.byMonth[r.m] = { su: 0, sv: 0 }); bm.su += +r.su || 0; bm.sv += +r.sv || 0; });
  // partial months (weeks / festival windows): IMEI activations when known, else a pro-rata share of the month
  if (!win.full && ctx) {
    const acts = ctx.imeis.filter((x) => x.act && x.ad && x.ad >= win.from && x.ad <= win.to);
    if (ctx.imeis.some((x) => x.ad)) { o.su = acts.length; o.sv = acts.reduce((a, x) => a + (+x.dp || 0), 0); o.models = {}; acts.forEach((x) => { const k = x.m || "?", y = o.models[k] || (o.models[k] = { u: 0, v: 0 }); y.u++; y.v += +x.dp || 0; }); o.src = "imei"; }
    else { const f = win.months.reduce((a, m) => a + Math.max(0, (Math.min(Date.parse(win.to), Date.parse(lastDay(m))) - Math.max(Date.parse(win.from), Date.parse(m + "-01"))) / 864e5 + 1) / +lastDay(m).slice(8), 0) / Math.max(1, win.months.length);
      ["su", "sv", "pu", "pv"].forEach((k) => { o[k] = Math.round(o[k] * f); }); Object.values(o.models).forEach((x) => { x.u = Math.round(x.u * f); x.v = Math.round(x.v * f); }); o.src = "prorata"; }
  }
  return o;
}
const pct = (a, b) => (b > 0 ? r2(a / b * 100) : 0);
const grow = (a, b) => (b > 0 ? r2((a - b) / b * 100) : (a > 0 ? 100 : 0));
const modelMatch = (name, list) => { const n = nk(name); return list.some((p) => { const q = nk(p); return q && (n === q || n.startsWith(q)); }); };
function metricsOf(ctx, P, cfg, condsUsed) {
  const rows = ctx.biz.rows || [], T = ctx.biz.targets || {};
  const cur = sumRows(rows, P, ctx), prev = sumRows(rows, P.full ? shiftWin(P, P.months.length) : shiftWin(P, 0, P.days), ctx), ly = sumRows(rows, shiftWin(P, 12), ctx);
  let tu = 0, tv = 0; P.months.forEach((m) => { const t = T[m] || {}; const share = P.full ? 1 : Math.max(0, Math.min(1, ((Math.min(Date.parse(P.to), Date.parse(lastDay(m))) - Math.max(Date.parse(P.from), Date.parse(m + "-01"))) / 864e5 + 1) / +lastDay(m).slice(8))); tu += (+t.u || 0) * share; tv += (+t.v || 0) * share; });
  const prem = Object.keys(cur.models).filter((k) => modelMatch(k, cfg.premium.models) || (cur.models[k].u > 0 && cur.models[k].v / cur.models[k].u >= cfg.premium.asp));
  const premV = prem.reduce((a, k) => a + cur.models[k].v, 0), premU = prem.reduce((a, k) => a + cur.models[k].u, 0);
  const billed = ctx.imeis.filter((x) => x.bd && x.bd >= P.from && x.bd <= P.to), acts = ctx.imeis.filter((x) => x.act && x.ad && x.ad >= P.from && x.ad <= P.to);
  const avgDay = (() => { const ms = monthsBetween(mOf(addMonths(P.to, -2)), mOf(P.to)); let s = 0; rows.forEach((r) => { if (ms.includes(r.m)) s += +r.su || 0; }); return s / 90; })();
  const M = { su: cur.su, sv: cur.sv, pu: cur.pu, pv: cur.pv, tu: Math.round(tu), tv: Math.round(tv), ach_u: pct(cur.su, tu), ach_v: pct(cur.sv, tv), g_mom_u: grow(cur.su, prev.su), g_mom_v: grow(cur.sv, prev.sv), g_yoy_u: grow(cur.su, ly.su), g_yoy_v: grow(cur.sv, ly.sv),
    prem_share: pct(premV, cur.sv), prem_u: premU, act: acts.length, act_rate: pct(billed.filter((x) => x.act).length, billed.length), fin_share: pct(acts.filter((x) => x.fin).length, acts.length), sell_thru: pct(cur.su, cur.pu),
    stock_days: avgDay > 0 ? Math.round(cur.stk / avgDay) : (cur.stk > 0 ? 999 : 0), tasks: (ctx.tasks || []).filter((s) => s.d >= P.from && s.d <= P.to).length,
    payout: r2((ctx.payouts || []).filter((x) => P.months.includes(x.month)).reduce((a, x) => a + (+x.net || 0), 0)), slab_hits: (ctx.payouts || []).filter((x) => P.months.includes(x.month) && x.net > 0).length,
    tier_rank: ctx.tierRank || 99, months_active: (() => { const ms = monthsBetween(mOf(addMonths(P.to, -11)), mOf(P.to)); return ms.filter((m) => rows.some((r) => r.m === m && (+r.su || 0) > 0)).length; })(), src: cur.src || "monthly" };
  // per-condition metrics: selected models, streaks, KPIs
  M.of = (c) => {
    if (c.m === "models_u" || c.m === "models_v") { const L = c.models && c.models.length ? c.models : []; let u = 0, v = 0; Object.keys(cur.models).forEach((k) => { if (modelMatch(k, L)) { u += cur.models[k].u; v += cur.models[k].v; } }); return c.m === "models_u" ? u : v; }
    if (c.m === "streak") { let n = 0, m = mOf(P.to); for (let i = 0; i < 24; i++) { let sv = 0; rows.forEach((r) => { if (r.m === m) sv += +r.sv || 0; }); const t = (T[m] || {}).v || 0; if (t > 0 && sv / t * 100 >= (c.thr || 100)) { n++; m = mOf(addMonths(m + "-01", -1)); } else break; } return n; }
    if (c.m === "kpi") return num(((ctx.kpi || {})[c.kpi] || 0));
    return M[c.m] == null ? 0 : M[c.m];
  };
  return M;
}
function test(v, c) { switch (c.op) { case ">": return v > c.v; case "<=": return v <= c.v; case "<": return v < c.v; case "==": return v === c.v; case "!=": return v !== c.v; case "between": return v >= c.v && v <= c.v2; default: return v >= c.v; } }
function slabPts(slabs, v, units) { let best = null; slabs.forEach((s) => { if (v >= s.min && (!s.max || v <= s.max)) { if (!best || s.min >= best.min) best = s; } }); return best ? (best.perUnit ? best.pts * (units || 0) : best.pts) : 0; }

// ================= the engine: points for every retailer in a period =================
async function retailersOf(store, state) {
  const I = (await store.get("rtpidx")) || {}, P2 = (await store.get("rpidx")) || {}, out = {};
  Object.keys(I).forEach((rid) => { if (low(I[rid].s) === low(state)) out[rid] = { rid, name: I[rid].n || rid, city: I[rid].c || "", type: I[rid].t || "" }; });
  Object.keys(P2).forEach((rid) => { if (!out[rid] && low(P2[rid].s) === low(state)) out[rid] = { rid, name: P2[rid].n || rid, city: P2[rid].c || "", type: "" }; });
  return Object.values(out);
}
const eligibleR = (cfg, r) => { const e = cfg.eligible; if (e.exclude.includes(r.rid)) return false; if (e.include.length && e.include.includes(r.rid)) return true; if (e.types.length && !e.types.some((t) => low(t) === low(r.type))) return false; if (e.cities.length && !e.cities.some((c) => low(c) === low(r.city))) return false; return true; };
const ruleFor = (rule, r, tierId) => { if (rule.exclude.includes(r.rid)) return false; if (rule.include.length && !rule.include.includes(r.rid)) return false; if (rule.tiers.length && !rule.tiers.includes(tierId)) return false; if (rule.types.length && !rule.types.some((t) => low(t) === low(r.type))) return false; if (rule.cities.length && !rule.cities.some((c) => low(c) === low(r.city))) return false; return true; };
async function rctx(store, pool, state, r, payLines) {
  const [biz, il, led, m] = await Promise.all([store.get(`rtd:${r.rid}`), store.get(`rtil:${r.rid}`), store.get(`rh:led:${ST(state)}:${r.rid}`), store.get(`rtl:${r.rid}`)]);
  if (m) { r.type = r.type || m.type || ""; r.city = r.city || m.city || ""; r.name = m.name || r.name; }
  const L = led || { rid: r.rid, tier: "", e: [], hist: [] };
  return { r, biz: biz || { rows: [], targets: {} }, imeis: ((il && il.items) || []).map((x) => ({ m: x.m, bd: x.bd, act: !!x.act, ad: x.ad, fin: !!x.fin, dp: x.dp })), led: L,
    tasks: (L.e || []).filter((e) => e.type === "earn" && /^task\|/.test(e.ref || "")).map((e) => ({ d: e.d })), payouts: payLines[r.rid] || [] };
}
async function payoutLines(store, pool) {
  const out = {}; for (const x of (await pool(await store.list("rpb:"), 30, (k) => store.get(k))).filter((x) => x && x.status === "published")) (x.rows || []).forEach((row) => { (out[row.rid] = out[row.rid] || []).push({ month: x.month, net: +row.net || 0, scheme: row.scheme }); });
  return out;
}
export async function runEngine(store, pool, state, cfg, pkey, opt) {
  opt = opt || {}; const P = periodOf(pkey); if (!P) return { ok: false, error: "Choose a valid period." };
  const all = (await retailersOf(store, state)).filter((r) => eligibleR(cfg, r) && (!opt.rids || opt.rids.includes(r.rid)));
  const pay = await payoutLines(store, pool), kpiDoc = (await store.get(`rh:kpi:${ST(state)}:${pkey}`)) || { rows: {} };
  const tiers = cfg.tiers.filter((t) => t.on), rules = cfg.rules.filter((x) => x.on && (!opt.ruleIds || opt.ruleIds.includes(x.id)) && ruleInPeriod(x, P));
  const base = rules.filter((x) => !["pct_bonus", "multiplier"].includes(x.award.type)).sort((a, b) => a.priority - b.priority), after = rules.filter((x) => ["pct_bonus", "multiplier"].includes(x.award.type));
  const rows = [], byRule = {}; let total = 0;
  const ctxs = await pool(all, 25, async (r) => rctx(store, pool, state, r, pay));
  for (const cx of ctxs) {
    const r = cx.r, tierId = cx.led.tier || "", ti = tiers.findIndex((t) => t.id === tierId), tier = tiers[ti];
    cx.tierRank = ti >= 0 ? ti + 1 : 99; cx.kpi = kpiDoc.rows[r.rid] || {};
    const M = metricsOf(cx, P, cfg), got = {}, why = {}; let groupBest = {};
    for (const ru of base) {
      if (!ruleFor(ru, r, tierId)) continue;
      if (ru.once && (cx.led.e || []).some((e) => e.rule === ru.id && e.type === "earn")) continue;
      const ok = ru.when.conds.length ? (ru.when.all ? ru.when.conds.every((c) => test(M.of(c), c)) : ru.when.conds.some((c) => test(M.of(c), c))) : true;
      if (!ok) continue;
      const a = ru.award, mv = M.of({ m: a.metric, models: a.models, kpi: a.kpi, thr: 100 }); let p = 0;
      if (a.type === "fixed") p = a.value; else if (a.type === "per_unit") p = a.value * mv; else if (a.type === "per_value") p = Math.floor(mv / a.per) * a.value;
      else if (a.type === "slab") p = slabPts(a.slabs, mv, M.su); else if (a.type === "per_pct_over") p = Math.max(0, Math.floor(mv - a.base)) * a.value;
      if (ru.tierMult && tier) p *= tier.mult;
      if (ru.cap.perRetailer) p = Math.min(p, ru.cap.perRetailer);
      p = Math.round(p); if (p <= 0) continue;
      if (ru.group && !ru.stack) { const g = groupBest[ru.group]; if (g && got[g] >= p) continue; if (g) delete got[g]; groupBest[ru.group] = ru.id; }
      got[ru.id] = p; why[ru.id] = a.metric + "=" + r2(mv);
    }
    for (const ru of after) {
      if (!ruleFor(ru, r, tierId)) continue;
      const ok = ru.when.conds.length ? (ru.when.all ? ru.when.conds.every((c) => test(M.of(c), c)) : ru.when.conds.some((c) => test(M.of(c), c))) : true; if (!ok) continue;
      const from = Object.keys(got).filter((id) => !ru.award.rules.length || ru.award.rules.includes(id)), s = from.reduce((a, id) => a + got[id], 0);
      const p = Math.round(ru.award.type === "pct_bonus" ? s * ru.award.value / 100 : s * Math.max(0, ru.award.value - 1));
      if (p > 0) { got[ru.id] = ru.cap.perRetailer ? Math.min(p, ru.cap.perRetailer) : p; why[ru.id] = "on " + s + " pts"; }
    }
    const tot = Object.values(got).reduce((a, x) => a + x, 0);
    Object.keys(got).forEach((id) => { const b = byRule[id] || (byRule[id] = { pts: 0, n: 0, sv: 0 }); b.pts += got[id]; b.n++; b.sv += M.sv; });
    total += tot;
    rows.push({ rid: r.rid, name: r.name, city: r.city, tier: tierId, pts: got, why, total: tot, m: { su: M.su, sv: M.sv, ach_v: M.ach_v, g_mom_v: M.g_mom_v, prem_share: M.prem_share, act: M.act, src: M.src } });
  }
  // rule budget caps: scale down when a rule's total cap is exceeded
  rules.forEach((ru) => { const b = byRule[ru.id]; if (!b || !ru.cap.total || b.pts <= ru.cap.total) return; const f = ru.cap.total / b.pts; let s = 0; rows.forEach((x) => { if (x.pts[ru.id]) { const n = Math.floor(x.pts[ru.id] * f); x.total += n - x.pts[ru.id]; total += n - x.pts[ru.id]; x.pts[ru.id] = n; s += n; } }); b.pts = s; b.scaled = r2(f); });
  rows.sort((a, b) => b.total - a.total);
  return { ok: true, period: P, rows, byRule, total, costRs: r2(total * cfg.pointValue), retailers: all.length, earners: rows.filter((x) => x.total > 0).length };
}
function ruleInPeriod(ru, P) {
  if (ru.dateFrom && P.to < ru.dateFrom) return false; if (ru.dateTo && P.from > ru.dateTo) return false;
  if (ru.period === "custom") return !!(ru.from && ru.to && P.key === "C:" + ru.from + "_" + ru.to);
  const k = P.key.slice(0, 1); return ({ month: "M", week: "W", quarter: "Q", half: "H", year: "Y" })[ru.period] === k;
}

// ================= ledger =================
function expDate(cfg, d, rule) { if (cfg.expiry.mode === "never") return ""; if (cfg.expiry.mode === "fixed" && cfg.expiry.fixedDate) return cfg.expiry.fixedDate; return addMonths(d, (rule && rule.expiryMonths) || cfg.expiry.months); }
function settle(L, d) {   // expire lots that have passed their date; returns balance
  d = d || today(); let changed = false;
  (L.e || []).forEach((e) => { if (e.type === "earn" && e.left > 0 && e.exp && e.exp < d) { L.e.push({ id: nid(), at: Date.now(), d: e.exp, type: "expire", pts: -e.left, ref: "exp|" + e.id, note: "Expired (" + (e.note || e.rule || "points") + ")" }); e.left = 0; changed = true; } });
  return changed;
}
export function balanceOf(L) { return (L.e || []).reduce((a, e) => a + (e.pts || 0), 0); }
function spend(L, pts) { let need = pts; (L.e || []).filter((e) => e.type === "earn" && e.left > 0).sort((a, b) => (a.exp || "9999").localeCompare(b.exp || "9999")).forEach((e) => { if (need <= 0) return; const t = Math.min(e.left, need); e.left -= t; need -= t; }); }
function credit(L, cfg, o) {   // idempotent by ref: re-posting the same rule + period changes the earlier credit
  const old = (L.e || []).find((e) => e.ref === o.ref && e.type === "earn");
  if (old) { const delta = o.pts - old.pts; if (!delta) return 0; old.pts = o.pts; old.left = Math.max(0, old.left + delta); if (old.left === 0 && delta < 0) { /* already spent: the shortfall stays as a debit */ } old.note = o.note || old.note; old.upd = Date.now(); if (delta < 0 && old.left === 0) { const spent = -delta; L.e.push({ id: nid(), at: Date.now(), d: today(), type: "adjust", pts: 0, ref: o.ref + "|fix", note: "Recalculated (" + spent + " pts were already used)" }); } return delta; }
  L.e.push({ id: nid(), at: Date.now(), d: o.d || today(), type: "earn", pts: o.pts, left: o.pts, exp: expDate(cfg, o.d || today(), o.rule), ref: o.ref, rule: o.ruleId || "", note: o.note || "", by: o.by || "", qual: o.qual !== false });
  return o.pts;
}
const ledKey = (state, rid) => `rh:led:${ST(state)}:${rid}`;
async function getLed(store, state, rid, name) { const L = (await store.get(ledKey(state, rid))) || { rid, name: name || rid, tier: "", tierSince: "", grace: 0, hist: [], e: [] }; if (name) L.name = name; if (settle(L)) await store.set(ledKey(state, rid), L); return L; }
async function audit(store, state, by, act, what) { const k = `rh:aud:${ST(state)}`, A = (await store.get(k)) || { items: [] }; A.items.unshift({ at: Date.now(), by, act, what: str(what, 300) }); A.items = A.items.slice(0, 3000); await store.set(k, A); }

// ================= tiers =================
async function evalTiers(store, pool, state, cfg, onDate, post, by) {
  const tiers = cfg.tiers.filter((t) => t.on); if (!tiers.length) return { ok: false, error: "No clubs set up." };
  const te = cfg.tierEval, d = onDate || today(), win = { from: addMonths(mOf(d) + "-01", -(te.window - 1)), to: lastDay(mOf(d)) }; win.months = monthsBetween(mOf(win.from), mOf(win.to)); win.full = true; win.days = 0;
  const lock = te.lockFrom && te.lockTo && d >= te.lockFrom && d <= te.lockTo, pay = await payoutLines(store, pool);
  const all = (await retailersOf(store, state)).filter((r) => eligibleR(cfg, r)), out = [];
  const ctxs = await pool(all, 25, async (r) => rctx(store, pool, state, r, pay));
  for (const cx of ctxs) {
    const r = cx.r, L = cx.led, P = Object.assign({ key: "T", label: "" }, win), M = metricsOf(cx, P, cfg);
    const basisV = te.basis === "qpts" ? (L.e || []).filter((e) => e.type === "earn" && e.qual !== false && e.d >= win.from && e.d <= win.to).reduce((a, e) => a + e.pts, 0) : M.of({ m: te.basis, thr: 100 });
    const monthsV = win.months.map((m) => { const s = sumRows(cx.biz.rows || [], { months: [m], full: true }); return te.basis === "su" ? s.su : s.sv; });
    const qualifies = (t) => basisV >= t.min && t.extra.every((c) => test(M.of(c), c));
    let target = tiers.findIndex(qualifies); if (target < 0) target = tiers.length - 1;
    if (te.fastTrack && te.basis !== "qpts" && Math.max.apply(null, monthsV.concat([0])) >= te.fastTrack) target = 0;
    const curI = tiers.findIndex((t) => t.id === L.tier), nti = te.newTier ? tiers.findIndex((t) => t.id === te.newTier) : -1; let next = curI, act = "", grace = L.grace || 0, bonus = 0;
    if (curI < 0) { act = "joined"; next = nti >= 0 ? Math.min(target, nti) : target; }
    else if (target < curI) { next = te.upgradeNow ? target : curI - 1; act = "up"; grace = 0; bonus = tiers[next].upBonus; }
    else if (target > curI) {
      const cur = tiers[curI];
      if (basisV >= cur.keep && cur.extra.every((c) => test(M.of(c), c))) { act = "kept"; grace = 0; bonus = cur.keepBonus; }
      else if (lock) act = "locked";
      else if (grace < cur.grace) { act = "at risk"; grace++; }
      else { next = te.downgrade === "fit" ? target : curI + 1; act = "down"; grace = 0; }
    } else { act = "kept"; grace = 0; bonus = tiers[curI].keepBonus; }
    const nt = tiers[next], nxt = next > 0 ? tiers[next - 1] : null;
    out.push({ rid: r.rid, name: r.name, from: L.tier || "", to: nt.id, act, basis: r2(basisV), need: nxt ? Math.max(0, r2(nxt.min - basisV)) : 0, keep: nt.keep, grace, bonus });
    if (post) {
      if (L.tier !== nt.id) { L.hist = (L.hist || []).concat([{ d, from: L.tier || "", to: nt.id, act, basis: r2(basisV) }]).slice(-60); L.tier = nt.id; L.tierSince = d; }
      L.grace = grace; L.basis = r2(basisV); L.tierEvalAt = d; L.atRisk = act === "at risk";
      if (bonus > 0) credit(L, cfg, { ref: "tier|" + act + "|" + mOf(d), pts: Math.round(bonus), note: (act === "up" ? "Club upgrade bonus — " : "Club retention bonus — ") + nt.name, ruleId: "tier", by });
      await store.set(ledKey(state, r.rid), L);
    }
  }
  const dist = {}; out.forEach((x) => { dist[x.to] = (dist[x.to] || 0) + 1; });
  return { ok: true, date: d, window: win, rows: out, dist, up: out.filter((x) => x.act === "up").length, down: out.filter((x) => x.act === "down").length, risk: out.filter((x) => x.act === "at risk").length };
}

// ================= retailer-facing view (Retailer portal / vivo Retailer App) =================
export async function rhRetailer(store, pool, rid, state, b, who, actx) {
  const cfgDoc = await store.get(`rh:cfg:${ST(state)}`), cfg = cfgDoc && cfgDoc.live ? cleanCfg(cfgDoc.live, state) : null;
  if (!cfg || !cfg.on) return { ok: true, on: false };
  const m = (await store.get(`rtl:${rid}`)) || {}, rr = { rid, name: m.name || rid, city: m.city || "", type: m.type || "" };
  if (!eligibleR(cfg, rr)) return { ok: true, on: false, reason: "Your store is not part of the rewards program yet." };
  const L = await getLed(store, state, rid, rr.name), tiers = cfg.tiers.filter((t) => t.on);
  const act = b.rh || "view";
  if (act === "redeem") return redeem(store, cfg, state, rr, L, b, who || { via: "retailer", by: rr.name });
  if (act === "task") {
    const tk = cfg.tasks.find((x) => x.id === str(b.task, 24) && x.on); if (!tk) return { ok: false, error: "Task not found." };
    const key = taskKey(tk, today()); if ((L.e || []).some((e) => e.ref === "task|" + tk.id + "|" + key)) return { ok: false, error: "Already done for this " + (tk.freq === "once" ? "program" : tk.freq.replace("ly", "")) + "." };
    const open = (await pool(await store.list(`rh:tsub:${ST(state)}:`), 30, (k) => store.get(k))).filter((s) => s && s.rid === rid && s.task === tk.id && s.key === key && s.status === "pending");
    if (open.length) return { ok: false, error: "Already sent — waiting for approval." };
    const photo = /^data:image\/(jpeg|png|webp);base64,/.test(String(b.photo || "")) && String(b.photo).length < 700000 ? String(b.photo) : "";
    if (tk.proof === "photo" && !photo) return { ok: false, error: "Add a photo." };
    const s = { id: nid(), rid, name: rr.name, task: tk.id, tname: tk.name, key, note: txt(b.note, 500), photo, status: "pending", at: Date.now(), pts: tk.pts };
    if (tk.auto) { s.status = "approved"; const tier = tiers.find((t) => t.id === L.tier); credit(L, cfg, { ref: "task|" + tk.id + "|" + key, pts: Math.round(tk.pts * (tk.tierMult && tier ? tier.mult : 1)), note: "Task: " + tk.name, ruleId: "task" }); await store.set(ledKey(state, rid), L); }
    await store.set(`rh:tsub:${ST(state)}:${s.id}`, s); return { ok: true, status: s.status };
  }
  if (act === "ask" || act === "best") {   // 🤖 rewards assistant — answers only from this retailer's own rewards data
    if (!actx || !actx.askAI) return { ok: false, error: "AI is not available right now." };
    const dk = "rh:ask:" + today() + ":" + rid, n = ((await store.get(dk)) || 0) + 1; if (n > 30) return { ok: false, error: "You've asked 30 questions today — try again tomorrow." }; await store.set(dk, n);
    const V = await rhRetailer(store, pool, rid, state, { rh: "view" }, who, null);
    const data = { program: V.program, me: V.me, myClub: V.tiers.find((t) => t.id === V.me.tier) || null, clubs: V.tiers.map((t) => ({ id: t.id, name: t.name, crit: t.crit, mult: t.mult, benefits: t.benefits })),
      earnNow: V.rules.map((r) => ({ id: r.id, name: r.name, how: r.desc, period: r.period, ends: r.ends, progress: r.cond, award: r.award })), offers: V.offers.map((o) => ({ id: o.id, name: o.name, brand: o.brand, cat: o.cat, pts: o.pts, value: o.value, canRedeemNow: o.can, outOfStock: o.out, limit: o.limit, valuePerPoint: o.pts ? Math.round(o.value / o.pts * 1000) / 1000 : 0 })),
      tasks: V.tasks, vouchers: V.vouchers.slice(0, 10).map((v) => ({ name: v.oname, status: v.status, at: new Date(v.at).toISOString().slice(0, 10) })), recent: V.ledger.slice(0, 15) };
    const lang = str(b.lang, 20);
    const sys = `You are the friendly vivo Rewards assistant for a mobile retailer in India. Use ONLY the JSON data given (their club, points, expiring points, live earning rules with progress, clubs, catalogue). Never invent points, offers, prices or rules. Be short, warm and practical, in simple words${lang && lang !== "en" ? " — reply in the language code " + lang : " — reply in the language the retailer writes in (English, Hindi, Hinglish…)"}. Use ₹ and Indian number format.
${act === "best" ? `Task: recommend the BEST vouchers for this retailer right now. Consider: what they can afford now, points expiring soon (use them first), value per point (higher is better), stock and limits, their stated need ("${str(b.q, 300)}"), and whether saving for a bigger reward is wiser. Then give 1-2 quick tips to earn more points this month from the live rules.
Reply ONLY JSON: {"answer":"3-6 short lines for the retailer","picks":[{"id":"offer id","why":"one short reason"}] (max 3, best first)}` : 'Answer the question. If they ask how to reach a club or earn more, use the live rules progress and say exactly how much more is needed. If relevant, point to an offer by name. Reply ONLY JSON: {"answer":"…","picks":[{"id":"offer id","why":"…"}] (optional, max 3)}'}`;
    const r = await actx.askAI(actx.env, act === "best" ? "Which vouchers should I redeem? " + str(b.q, 300) : str(b.q, 500), "DATA: " + JSON.stringify(data).slice(0, 12000), [], actx.aiFetch, { system: sys, label: "REWARDS", json: true, raw: true, maxTokens: 1200 });
    const d = r.ok ? parse(r.text) : null; if (!d) return { ok: false, error: (r.error || "The assistant couldn't answer") + " — try again." };
    const ids = new Set(V.offers.map((o) => o.id));
    return { ok: true, answer: txt(d.answer, 1500), picks: (Array.isArray(d.picks) ? d.picks : []).filter((x) => x && ids.has(x.id)).slice(0, 3).map((x) => ({ id: x.id, why: str(x.why, 200) })) };
  }
  // view
  const ti = tiers.findIndex((t) => t.id === L.tier), tier = tiers[ti] || null, next = ti > 0 ? tiers[ti - 1] : (ti < 0 && tiers.length ? tiers[tiers.length - 1] : null);
  const bal = balanceOf(L), soon = (L.e || []).filter((e) => e.type === "earn" && e.left > 0 && e.exp && e.exp <= addDays(today(), 30)).reduce((a, e) => a + e.left, 0);
  const soonDate = ((L.e || []).filter((e) => e.type === "earn" && e.left > 0 && e.exp).sort((a, c) => a.exp.localeCompare(c.exp))[0] || {}).exp || "";
  // live progress on this month's rules
  const pay = await payoutLines(store, pool), cx = await rctx(store, pool, state, rr, pay); cx.tierRank = ti >= 0 ? ti + 1 : 99;
  const prog = [];
  for (const ru of cfg.rules.filter((x) => x.on && x.show && ruleFor(x, rr, L.tier) && !["pct_bonus", "multiplier"].includes(x.award.type))) {
    const pk = ru.period === "custom" ? (ru.from && ru.to && today() <= ru.to ? "C:" + ru.from + "_" + ru.to : "") : periodFor(ru.period, today()); const P = pk && periodOf(pk); if (!P) continue;
    if (ru.dateTo && today() > ru.dateTo) continue;
    const M = metricsOf(cx, P, cfg), c0 = ru.when.conds[0];
    prog.push({ id: ru.id, name: ru.name, desc: ru.desc || autoDesc(ru, cfg), period: P.label, ends: P.to, upcoming: P.from > today(), cond: c0 ? { label: mLabel(c0), now: r2(M.of(c0)), need: c0.v, unit: (RH_METRICS.find((x) => x[0] === c0.m) || [])[2] || "", done: test(M.of(c0), c0) } : null, award: awardText(ru, tier) });
  }
  const now = today(), red = (await pool(await store.list(`rh:red:${ST(state)}:`), 30, (k) => store.get(k))).filter((x) => x && x.rid === rid).sort((a, c) => c.at - a.at);
  const usedMonth = (oid) => red.filter((x) => x.offer === oid && !["rejected", "cancelled"].includes(x.status) && mOf(new Date(x.at + 19800000).toISOString()) === mOf(now)).length;
  const offers = [];
  for (const o of cfg.offers.filter((o) => o.on && (!o.from || o.from <= now) && (!o.to || o.to >= now) && (!o.tiers.length || o.tiers.includes(L.tier)) && (!o.types.length || o.types.some((t) => low(t) === low(rr.type))) && (!o.cities.length || o.cities.some((c) => low(c) === low(rr.city))))) {
    let stock = null; if (o.fulfil === "codes") { const P2 = (await store.get(`rh:codes:${ST(state)}:${o.id}`)) || { codes: [] }; stock = P2.codes.filter((c) => !c.rid).length; }
    const lim = o.perMonth && usedMonth(o.id) >= o.perMonth ? "Monthly limit reached" : o.perTotal && red.filter((x) => x.offer === o.id && !["rejected", "cancelled"].includes(x.status)).length >= o.perTotal ? "Limit reached" : "";
    offers.push({ id: o.id, name: o.name, brand: o.brand, cat: o.cat, icon: o.icon, img: o.img, pts: o.pts, value: o.value, fulfil: o.fulfil, howTo: o.howTo, terms: o.terms, validityDays: o.validityDays, featured: o.featured, stock, out: stock === 0, limit: lim, can: bal >= o.pts && stock !== 0 && !lim });
  }
  const tasks = cfg.tasks.filter((x) => x.on && (!x.from || x.from <= now) && (!x.to || x.to >= now) && (!x.tiers.length || x.tiers.includes(L.tier))).map((x) => { const key = taskKey(x, now); return { id: x.id, name: x.name, desc: x.desc, pts: x.pts, proof: x.proof, freq: x.freq, done: (L.e || []).some((e) => e.ref === "task|" + x.id + "|" + key) }; });
  const subs = (await pool(await store.list(`rh:tsub:${ST(state)}:`), 30, (k) => store.get(k))).filter((s) => s && s.rid === rid).sort((a, c) => c.at - a.at).slice(0, 20).map((s) => ({ id: s.id, task: s.task, tname: s.tname, status: s.status, at: s.at, note: s.reason || "" }));
  const tierInfo = tiers.map((t) => ({ id: t.id, name: t.name, icon: t.icon, color: t.color, min: t.min, keep: t.keep, mult: t.mult, benefits: t.benefits, crit: tierCrit(t, cfg) }));
  return { ok: true, on: true, program: { name: cfg.name, pointValue: cfg.pointValue, expiry: cfg.expiry, terms: cfg.terms, basis: (RH_METRICS.find((x) => x[0] === cfg.tierEval.basis) || ["", "Qualifying points"])[1], window: cfg.tierEval.window },
    me: { rid, name: rr.name, tier: L.tier, tierSince: L.tierSince, atRisk: !!L.atRisk, grace: L.grace || 0, basis: L.basis || 0, balance: bal, earned: (L.e || []).filter((e) => e.type === "earn").reduce((a, e) => a + e.pts, 0), redeemed: -(L.e || []).filter((e) => e.type === "redeem").reduce((a, e) => a + e.pts, 0), expired: -(L.e || []).filter((e) => e.type === "expire").reduce((a, e) => a + e.pts, 0), expSoon: soon, expDate: soonDate,
      nextTier: next && (!tier || next.id !== tier.id) ? { id: next.id, name: next.name, need: Math.max(0, r2(next.min - (L.basis || 0))) } : null, keepNeed: tier ? Math.max(0, r2(tier.keep - (L.basis || 0))) : 0 },
    tiers: tierInfo, rules: prog, offers, tasks, subs, ledger: (L.e || []).slice().sort((a, c) => (c.d || "").localeCompare(a.d || "") || c.at - a.at).slice(0, 80).map((e) => ({ d: e.d, type: e.type, pts: e.pts, note: e.note, exp: e.exp || "" })),
    vouchers: red.slice(0, 50).map((x) => ({ id: x.id, oname: x.oname, pts: x.pts, status: x.status, code: x.status === "fulfilled" ? x.code || "" : "", link: x.status === "fulfilled" ? x.link || "" : "", at: x.at, validTill: x.validTill || "", howTo: x.howTo || "", note: x.note || "" })) };
}
const taskKey = (tk, d) => tk.freq === "once" ? "once" : tk.freq === "daily" ? d : tk.freq === "weekly" ? periodFor("week", d).slice(2) : mOf(d);
const mLabel = (c) => { const m = RH_METRICS.find((x) => x[0] === c.m); let s = m ? m[1] : c.m; if ((c.m === "models_u" || c.m === "models_v") && c.models.length) s += " (" + c.models.join(", ") + ")"; if (c.m === "kpi") s = "KPI " + c.kpi; return s; };
const fmtN = (v, m) => { const u = (RH_METRICS.find((x) => x[0] === m) || [])[2]; if (u === "₹") return "₹" + Math.round(v).toLocaleString("en-IN"); if (u === "%") return v + "%"; return String(v); };
export function autoDesc(ru, cfg) {
  const cs = ru.when.conds.map((c) => mLabel(c) + " " + ((RH_OPS.find((o) => o[0] === c.op) || [])[1] || c.op) + " " + fmtN(c.v, c.m) + (c.op === "between" ? "–" + fmtN(c.v2, c.m) : "")).join(ru.when.all ? " and " : " or ");
  return (cs ? "When " + cs + ": " : "") + awardText(ru, null);
}
function awardText(ru, tier) {
  const a = ru.award, mu = ru.tierMult && tier && tier.mult !== 1 ? " × " + tier.mult + " (" + tier.name + ")" : "";
  if (a.type === "fixed") return a.value + " points" + mu;
  if (a.type === "per_unit") return a.value + " points per unit" + mu;
  if (a.type === "per_value") return a.value + " point" + (a.value === 1 ? "" : "s") + " per ₹" + a.per.toLocaleString("en-IN") + mu;
  if (a.type === "slab") return a.slabs.map((s) => fmtN(s.min, a.metric) + (s.max ? "–" + fmtN(s.max, a.metric) : "+") + " → " + s.pts + (s.perUnit ? "/unit" : "")).join(" · ") + mu;
  if (a.type === "per_pct_over") return a.value + " points per 1% above " + a.base + "%" + mu;
  if (a.type === "pct_bonus") return "+" + a.value + "% on points earned";
  return "× " + a.value + " points";
}
function tierCrit(t, cfg) { const te = cfg.tierEval, bl = te.basis === "qpts" ? "qualifying points" : ((RH_METRICS.find((x) => x[0] === te.basis) || [])[1] || te.basis).toLowerCase(); const f = (v) => te.basis === "qpts" ? Math.round(v).toLocaleString("en-IN") : fmtN(v, te.basis); return t.min > 0 ? "Enter: " + bl + " ≥ " + f(t.min) + " in " + te.window + " month" + (te.window > 1 ? "s" : "") + (t.keep ? " · Stay: ≥ " + f(t.keep) : "") + (t.extra.length ? " · " + t.extra.map((c) => mLabel(c) + " " + c.op + " " + fmtN(c.v, c.m)).join(", ") : "") : "Everyone starts here"; }
async function redeem(store, cfg, state, rr, L, b, who) {
  const o = cfg.offers.find((x) => x.id === str(b.offer, 24) && x.on); if (!o) return { ok: false, error: "This offer is not available." };
  const now = today(), bal = balanceOf(L);
  if ((o.from && o.from > now) || (o.to && o.to < now)) return { ok: false, error: "This offer is not running now." };
  if (o.tiers.length && !o.tiers.includes(L.tier)) return { ok: false, error: "This offer is for other clubs." };
  if (cfg.redeem.minTier) { const ts = cfg.tiers.filter((t) => t.on), a = ts.findIndex((t) => t.id === L.tier), m = ts.findIndex((t) => t.id === cfg.redeem.minTier); if (m >= 0 && (a < 0 || a > m)) return { ok: false, error: "Redemption opens from the " + ts[m].name + " club." }; }
  if (cfg.redeem.blockIfAtRisk && L.atRisk) return { ok: false, error: "Redemption is paused while your club is at risk — please contact your vivo team." };
  if (bal < o.pts || bal - o.pts < cfg.redeem.minBalance) return { ok: false, error: "Not enough points (you have " + bal + ")." };
  const all = (await store.list(`rh:red:${ST(state)}:`)), mine = [];
  for (const k of all) { const x = await store.get(k); if (x && x.rid === rr.rid && !["rejected", "cancelled"].includes(x.status)) mine.push(x); }
  const thisMonth = mine.filter((x) => mOf(new Date(x.at + 19800000).toISOString()) === mOf(now));
  if (o.perMonth && thisMonth.filter((x) => x.offer === o.id).length >= o.perMonth) return { ok: false, error: "Monthly limit for this offer reached." };
  if (o.perTotal && mine.filter((x) => x.offer === o.id).length >= o.perTotal) return { ok: false, error: "You have already used this offer." };
  if (cfg.redeem.maxPerMonth && thisMonth.length >= cfg.redeem.maxPerMonth) return { ok: false, error: "Monthly redemption limit reached." };
  const manual = o.approval === "manual" || o.fulfil === "manual" || (o.approval === "above" && o.pts > cfg.approval.autoRedeemUpTo);
  const x = { id: nid(), rid: rr.rid, name: rr.name, offer: o.id, oname: o.name, pts: o.pts, value: o.value, fulfil: o.fulfil, status: manual ? "pending" : "fulfilled", at: Date.now(), by: who.by || "", via: who.via || "", howTo: o.howTo, validTill: o.validityDays ? addDays(now, o.validityDays) : "" };
  if (!manual) { const f = await fulfil(store, state, o, x, rr); if (f.error) return { ok: false, error: f.error }; }
  L.e.push({ id: nid(), at: Date.now(), d: now, type: "redeem", pts: -o.pts, ref: "red|" + x.id, note: "Redeemed: " + o.name }); spend(L, o.pts);
  await store.set(ledKey(state, rr.rid), L); await store.set(`rh:red:${ST(state)}:${x.id}`, x);
  return { ok: true, status: x.status, code: x.code || "", link: x.link || "", balance: balanceOf(L), id: x.id };
}
async function fulfil(store, state, o, x, rr) {
  if (o.fulfil === "codes") {
    const k = `rh:codes:${ST(state)}:${o.id}`, P = (await store.get(k)) || { codes: [] }, c = P.codes.find((y) => !y.rid);
    if (!c) return { error: "Sorry — this voucher is out of stock right now." };
    c.rid = rr.rid; c.red = x.id; c.at = Date.now(); await store.set(k, P); x.code = c.c;
  } else if (o.fulfil === "link") x.link = o.link.replace(/\{rid\}/g, encodeURIComponent(rr.rid)).replace(/\{ref\}/g, x.id);
  else if (o.fulfil === "wallet") {   // credit the scheme wallet (Retailer payouts) — usable for orders and shown in Payouts
    const r = (await store.get(`rpr:${rr.rid}`)) || { rid: rr.rid, name: rr.name, state, city: rr.city, entries: [] };
    r.entries.push({ id: "rh-" + x.id, at: Date.now(), date: today(), month: mOf(today()), type: "cr", kind: "rewards", amount: o.value, scheme: "Rewards: " + o.name, note: "Rewards points redeemed (" + o.pts + " pts)" });
    await store.set(`rpr:${rr.rid}`, r); const I = (await store.get("rpidx")) || {}; let cr = 0, dr = 0; r.entries.forEach((e) => { if (e.type === "cr") cr += e.amount; else dr += e.amount; });
    I[rr.rid] = Object.assign({}, I[rr.rid] || {}, { n: r.name, s: state, c: rr.city, cr: r2(cr), dr: r2(dr), bal: r2(cr - dr), last: today() }); await store.set("rpidx", I); x.code = "₹" + o.value + " added to your scheme wallet";
  }
  x.status = "fulfilled"; x.upd = Date.now(); return {};
}

// ================= staff actions =================
export async function rhAction(b, ctx) {
  const { store, pool, app, rec } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "", a = b.action;
  const myState = isHO ? "" : str(rec.state, 40);
  if (a === "rh-meta") {
    const I = (await store.get("rtpidx")) || {}, states = [...new Set(Object.values(I).map((x) => x.s).filter(Boolean))].sort();
    return J(200, { ok: true, isHO, myState, states: isHO ? states : [myState], metrics: RH_METRICS, ops: RH_OPS, awards: RH_AWARDS, periods: RH_PERIODS, cats: RH_CATS, templates: RH_TEMPLATES, tierPresets: RH_TIER_PRESETS });
  }
  const state = isHO ? str(b.state, 40) : myState;
  if (!state) return J(400, { ok: false, error: isHO ? "Choose a state." : "Your account has no state — ask HO to set it." });
  const sk = ST(state), cfgKey = `rh:cfg:${sk}`;
  const doc = async () => (await store.get(cfgKey)) || { state, draft: rhDefault(state), live: null, status: "draft", ver: 0, roles: { approvers: [] }, upd: 0 };
  const canApprove = (D) => isHO || (D.roles.approvers || []).map(low).includes(low(rec.username)) || (D.roles.approvers || []).map(low).includes(low(rec.email));
  const liveCfg = async () => { const D = await doc(); return D.live ? cleanCfg(D.live, state) : null; };

  if (a === "rh-get") {
    const D = await doc(); const sum = await quick(store, pool, state);
    return J(200, { ok: true, state, doc: { draft: cleanCfg(D.draft, state), live: D.live ? cleanCfg(D.live, state) : null, status: D.status, pending: D.pending || null, ver: D.ver || 0, upd: D.upd, by: D.by, roles: D.roles }, canApprove: canApprove(D), sum });
  }
  if (a === "rh-save") {   // draft only — goes live after approval (or straight away when approval is off)
    const D = await doc(); if (D.status === "pending" && !b.force) return J(400, { ok: false, error: "A change is waiting for approval — approve or withdraw it first." });
    D.draft = cleanCfg(b.cfg, state); D.status = D.live ? (JSON.stringify(cleanCfg(D.live, state)) === JSON.stringify(D.draft) ? "live" : "draft") : "draft"; D.upd = Date.now(); D.by = by;
    if (b.roles && (isHO || canApprove(D))) D.roles = { approvers: listOf(b.roles.approvers, 20) };
    await store.set(cfgKey, D); await audit(store, state, by, "save draft", str(b.note, 200) || "Draft saved"); return J(200, { ok: true, status: D.status });
  }
  if (a === "rh-submit") {
    const D = await doc(); D.status = "pending"; D.pending = { by, byKey: low(rec.username), at: Date.now(), note: str(b.note, 300) }; await store.set(cfgKey, D); await audit(store, state, by, "submit", D.pending.note || "Submitted for approval");
    if (!D.draft.approval.required || (D.draft.approval.selfApprove && canApprove(D))) return approve(D);
    return J(200, { ok: true, status: "pending" });
  }
  async function approve(D) {
    D.ver = (D.ver || 0) + 1; D.live = cleanCfg(D.draft, state); D.status = "live";
    await store.set(`rh:ver:${sk}:${D.ver}`, { n: D.ver, cfg: D.live, at: Date.now(), by: (D.pending || {}).by || by, approvedBy: by, note: (D.pending || {}).note || "" }); D.pending = null;
    await store.set(cfgKey, D); await audit(store, state, by, "approve", "Version " + D.ver + " is live"); return J(200, { ok: true, status: "live", ver: D.ver });
  }
  if (a === "rh-approve") { const D = await doc(); if (D.status !== "pending") return J(400, { ok: false, error: "Nothing waiting." }); if (!canApprove(D)) return J(403, { ok: false, error: "Only an approver (or HO) can approve." }); if (D.pending && D.pending.byKey === low(rec.username) && !D.draft.approval.selfApprove && !isHO) return J(403, { ok: false, error: "Someone else must approve your own change." }); return approve(D); }
  if (a === "rh-reject") { const D = await doc(); if (!canApprove(D)) return J(403, { ok: false, error: "Only an approver can reject." }); D.status = "draft"; D.pending = null; await store.set(cfgKey, D); await audit(store, state, by, "reject", str(b.note, 200) || "Change sent back"); return J(200, { ok: true }); }
  if (a === "rh-versions") { const out = []; for (const k of (await store.list(`rh:ver:${sk}:`))) { const v = await store.get(k); if (v) out.push({ n: v.n, at: v.at, by: v.by, approvedBy: v.approvedBy, note: v.note, rules: v.cfg.rules.length, tiers: v.cfg.tiers.length, offers: v.cfg.offers.length }); } return J(200, { ok: true, rows: out.sort((x, y) => y.n - x.n) }); }
  if (a === "rh-rollback") { const v = await store.get(`rh:ver:${sk}:${Math.round(num(b.n))}`); if (!v) return J(404, { ok: false, error: "Version not found." }); const D = await doc(); D.draft = cleanCfg(v.cfg, state); D.status = "draft"; await store.set(cfgKey, D); await audit(store, state, by, "rollback", "Draft restored from version " + v.n); return J(200, { ok: true }); }
  if (a === "rh-switch") {   // instant on / off of a rule, club, offer, task or the whole program — on draft AND live, no approval (safety switch)
    const D = await doc(), kind = b.kind, id = str(b.id, 24), on = !!b.on;
    [D.draft, D.live].forEach((c) => { if (!c) return; if (kind === "program") c.on = on; else { const L = c[kind]; if (Array.isArray(L)) L.forEach((x) => { if (x.id === id) x.on = on; }); } });
    await store.set(cfgKey, D); await audit(store, state, by, on ? "enable" : "disable", kind + " " + id); return J(200, { ok: true });
  }
  if (a === "rh-audit") { const A = (await store.get(`rh:aud:${sk}`)) || { items: [] }; return J(200, { ok: true, rows: A.items.slice(0, 500) }); }

  // ---- engine ----
  if (a === "rh-run") {   // simulate (draft or live) or post points for a period
    const D = await doc(), cfg = b.draft ? cleanCfg(D.draft, state) : (D.live ? cleanCfg(D.live, state) : null);
    if (!cfg) return J(400, { ok: false, error: "The program isn't live yet — simulate on the draft, then submit for approval." });
    const pk = str(b.period, 40), R = await runEngine(store, pool, state, cfg, pk, { ruleIds: Array.isArray(b.rules) && b.rules.length ? b.rules : null });
    if (!R.ok) return J(400, R);
    const year = pk.slice(2, 6), spent = await issuedRs(store, pool, state, cfg, year), month = pk.startsWith("M:") ? await issuedRs(store, pool, state, cfg, pk.slice(2)) : 0;
    R.budget = { yearRs: cfg.budget.yearRs, spentRs: spent, afterRs: r2(spent + R.costRs), monthRs: cfg.budget.monthRs, monthSpent: month, alertPct: cfg.budget.alertPct };
    const over = (cfg.budget.yearRs && R.budget.afterRs > cfg.budget.yearRs) || (cfg.budget.monthRs && pk.startsWith("M:") && month + R.costRs > cfg.budget.monthRs);
    if (b.post) {
      if (b.draft) return J(400, { ok: false, error: "Points can only be posted with the live program." });
      if (over && cfg.budget.block) return J(400, { ok: false, error: "This would cross the budget cap — raise the cap or lower the rules first." });
      let n = 0, pts = 0; const d = R.period.to < today() ? R.period.to : today();
      for (const x of R.rows) { const L = await getLed(store, state, x.rid, x.name); let ch = 0;
        for (const id of Object.keys(x.pts)) { const ru = cfg.rules.find((r) => r.id === id); ch += credit(L, cfg, { ref: id + "|" + pk, pts: x.pts[id], d, note: (ru ? ru.name : id) + " · " + R.period.label, ruleId: id, by, qual: ru ? ru.qualifying : true, rule: ru }); }
        // rules that no longer give points for this period are reversed
        (L.e || []).filter((e) => e.type === "earn" && e.ref && e.ref.endsWith("|" + pk) && !/^task\||^tier\||^man\|/.test(e.ref) && !x.pts[e.rule]).forEach((e) => { ch -= e.pts; e.left = 0; e.pts = 0; e.note += " (reversed on recalculation)"; });
        if (ch) { await store.set(ledKey(state, x.rid), L); n++; pts += ch; } }
      const id = nid(); await store.set(`rh:run:${sk}:${id}`, { id, period: pk, label: R.period.label, at: Date.now(), by, total: R.total, costRs: R.costRs, earners: R.earners, changed: n, delta: pts, rows: R.rows.slice(0, 300).map((x) => ({ rid: x.rid, name: x.name, total: x.total })) });
      await audit(store, state, by, "post points", R.period.label + ": " + R.total + " pts to " + R.earners + " retailers (change " + pts + ")");
      R.posted = { changed: n, delta: pts };
    }
    R.over = !!over; R.rows = R.rows.slice(0, 1500); return J(200, R);
  }
  if (a === "rh-tiers") { const D = await doc(), cfg = b.draft ? cleanCfg(D.draft, state) : await liveCfg(); if (!cfg) return J(400, { ok: false, error: "The program isn't live yet." }); if (b.post && b.draft) return J(400, { ok: false, error: "Clubs can only be updated with the live program." }); const R = await evalTiers(store, pool, state, cfg, str(b.date, 10) || today(), !!b.post, by); if (b.post && R.ok) await audit(store, state, by, "update clubs", "Up " + R.up + " · down " + R.down + " · at risk " + R.risk); return J(200, R); }
  if (a === "rh-runs") { const out = []; for (const k of (await store.list(`rh:run:${sk}:`)).slice(-200)) { const x = await store.get(k); if (x) out.push({ id: x.id, period: x.period, label: x.label, at: x.at, by: x.by, total: x.total, costRs: x.costRs, earners: x.earners, delta: x.delta }); } return J(200, { ok: true, rows: out.sort((p, q) => q.at - p.at) }); }

  // ---- retailers & ledger ----
  if (a === "rh-retailers") {
    const cfg = await liveCfg() || cleanCfg((await doc()).draft, state), all = await retailersOf(store, state), q = low(b.q);
    const rows = await pool(all.filter((r) => !q || low(r.rid + " " + r.name + " " + r.city).includes(q)).slice(0, 3000), 30, async (r) => { const L = await store.get(ledKey(state, r.rid)); const bal = L ? balanceOf(L) : 0; return { rid: r.rid, name: r.name, city: r.city, type: r.type, tier: L ? L.tier : "", atRisk: !!(L && L.atRisk), basis: L ? L.basis || 0 : 0, bal, earned: L ? L.e.filter((e) => e.type === "earn").reduce((s, e) => s + e.pts, 0) : 0, redeemed: L ? -L.e.filter((e) => e.type === "redeem").reduce((s, e) => s + e.pts, 0) : 0, elig: eligibleR(cfg, r) }; });
    return J(200, { ok: true, rows });
  }
  if (a === "rh-ledger") { const rid = RID(b.rid), L = await getLed(store, state, rid); return J(200, { ok: true, led: { rid, name: L.name, tier: L.tier, tierSince: L.tierSince, grace: L.grace, atRisk: !!L.atRisk, basis: L.basis || 0, hist: L.hist || [], bal: balanceOf(L), e: (L.e || []).slice().sort((x, y) => (y.d || "").localeCompare(x.d || "") || y.at - x.at).slice(0, 500) } }); }
  if (a === "rh-adjust") {   // manual credit / debit / set club, with a reason
    const rid = RID(b.rid), cfg = await liveCfg() || cleanCfg((await doc()).draft, state), L = await getLed(store, state, rid, str(b.name, 80)), why = str(b.note, 200);
    if (!why) return J(400, { ok: false, error: "Give a reason." });
    if (b.tier != null) { const t = cfg.tiers.find((x) => x.id === b.tier); if (!t) return J(400, { ok: false, error: "Club not found." }); L.hist = (L.hist || []).concat([{ d: today(), from: L.tier, to: t.id, act: "manual", note: why, by }]); L.tier = t.id; L.tierSince = today(); L.grace = 0; L.atRisk = false; }
    const p = Math.round(num(b.pts)); if (p > 0) credit(L, cfg, { ref: "man|" + nid(), pts: p, note: "Manual credit: " + why, ruleId: "manual", by, qual: !!b.qual }); else if (p < 0) { L.e.push({ id: nid(), at: Date.now(), d: today(), type: "adjust", pts: p, ref: "man|" + nid(), note: "Manual debit: " + why, by }); spend(L, -p); }
    await store.set(ledKey(state, rid), L); await audit(store, state, by, "adjust", rid + ": " + (p ? (p > 0 ? "+" : "") + p + " pts " : "") + (b.tier != null ? "club → " + b.tier + " " : "") + "(" + why + ")"); return J(200, { ok: true, bal: balanceOf(L) });
  }
  if (a === "rh-bulk") {   // Excel: Retailer ID, Points, Reason  (or Club)
    const cfg = await liveCfg() || cleanCfg((await doc()).draft, state), rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 5000); let n = 0, pts = 0, bad = 0;
    for (const r of rows) { const rid = RID(r.rid), p = Math.round(num(r.pts)); if (!rid || (!p && !r.tier)) { bad++; continue; } const L = await getLed(store, state, rid, str(r.name, 80)), why = str(r.note, 200) || str(b.note, 200) || "Bulk upload";
      if (r.tier) { const t = cfg.tiers.find((x) => low(x.id) === low(r.tier) || low(x.name) === low(r.tier)); if (t) { L.hist = (L.hist || []).concat([{ d: today(), from: L.tier, to: t.id, act: "bulk", note: why, by }]); L.tier = t.id; L.tierSince = today(); } }
      if (p > 0) credit(L, cfg, { ref: "man|" + (str(r.ref, 40) || nid()), pts: p, note: why, ruleId: "bulk", by }); else if (p < 0) { L.e.push({ id: nid(), at: Date.now(), d: today(), type: "adjust", pts: p, ref: "man|" + nid(), note: why, by }); spend(L, -p); }
      await store.set(ledKey(state, rid), L); n++; pts += p; }
    await audit(store, state, by, "bulk upload", n + " retailers, " + pts + " pts"); return J(200, { ok: true, n, pts, bad });
  }
  if (a === "rh-kpi") {   // upload a KPI sheet for a period: rows [{ rid, metric, value }]
    const pk = str(b.period, 40); if (!periodOf(pk)) return J(400, { ok: false, error: "Choose the period." });
    const k = `rh:kpi:${sk}:${pk}`, D = (await store.get(k)) || { rows: {} }; let n = 0;
    (Array.isArray(b.rows) ? b.rows : []).slice(0, 20000).forEach((r) => { const rid = RID(r.rid), m = str(r.metric, 40).replace(/[^\w-]/g, "_"); if (!rid || !m) return; (D.rows[rid] = D.rows[rid] || {})[m] = num(r.value); n++; });
    D.at = Date.now(); D.by = by; await store.set(k, D); await audit(store, state, by, "upload KPI", pk + ": " + n + " values"); return J(200, { ok: true, n, metrics: [...new Set(Object.values(D.rows).flatMap((x) => Object.keys(x)))] });
  }
  // ---- redemptions, codes, tasks ----
  if (a === "rh-reds") { const rows = (await pool(await store.list(`rh:red:${sk}:`), 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 2000).map((x) => Object.assign({}, x, { code: x.code ? (x.fulfil === "codes" ? x.code.slice(0, 3) + "•••" : x.code) : "" })); return J(200, { ok: true, rows }); }
  if (a === "rh-red-act") {
    const k = `rh:red:${sk}:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`, x = await store.get(k); if (!x) return J(404, { ok: false, error: "Not found." });
    const cfg = await liveCfg(); const L = await getLed(store, state, x.rid);
    if (b.do === "approve") { if (x.status !== "pending") return J(400, { ok: false, error: "Not pending." }); const o = cfg && cfg.offers.find((y) => y.id === x.offer) || { fulfil: "manual" };
      if (o.fulfil === "manual") { x.code = str(b.code, 200); x.link = /^https:\/\//.test(String(b.link || "")) ? str(b.link, 500) : ""; x.status = "fulfilled"; } else { const f = await fulfil(store, state, o, x, { rid: x.rid, name: x.name, city: "" }); if (f.error) return J(400, { ok: false, error: f.error }); } }
    else if (b.do === "reject" || b.do === "cancel") { if (["rejected", "cancelled"].includes(x.status)) return J(400, { ok: false, error: "Already closed." }); if (x.status === "fulfilled" && x.fulfil !== "manual" && !b.force) return J(400, { ok: false, error: "Already fulfilled — use force to reverse." });
      x.status = b.do === "reject" ? "rejected" : "cancelled"; L.e.push({ id: nid(), at: Date.now(), d: today(), type: "earn", pts: x.pts, left: x.pts, exp: expDate(cfg || rhDefault(state), today()), ref: "rev|" + x.id, note: "Points returned: " + x.oname + (b.note ? " — " + str(b.note, 120) : "") }); await store.set(ledKey(state, x.rid), L); }
    x.note = str(b.note, 200) || x.note || ""; x.upd = Date.now(); x.actBy = by; await store.set(k, x); await audit(store, state, by, "redemption " + b.do, x.rid + " · " + x.oname); return J(200, { ok: true });
  }
  if (a === "rh-codes") {   // add codes to an offer's pool (or count); codes are never listed back
    const oid = str(b.offer, 24).replace(/[^\w-]/g, ""), k = `rh:codes:${sk}:${oid}`, P = (await store.get(k)) || { codes: [] };
    if (Array.isArray(b.add)) { const have = new Set(P.codes.map((c) => c.c)); let n = 0; b.add.slice(0, 20000).forEach((c) => { c = str(c, 120); if (c && !have.has(c)) { P.codes.push({ c }); have.add(c); n++; } }); await store.set(k, P); await audit(store, state, by, "add codes", oid + ": +" + n); }
    if (b.clearUnused) { P.codes = P.codes.filter((c) => c.rid); await store.set(k, P); await audit(store, state, by, "clear unused codes", oid); }
    return J(200, { ok: true, total: P.codes.length, free: P.codes.filter((c) => !c.rid).length });
  }
  if (a === "rh-stock") { const cfg = cleanCfg((await doc()).draft, state), out = {}; for (const o of cfg.offers.filter((o) => o.fulfil === "codes")) { const P = (await store.get(`rh:codes:${sk}:${o.id}`)) || { codes: [] }; out[o.id] = { total: P.codes.length, free: P.codes.filter((c) => !c.rid).length }; } return J(200, { ok: true, stock: out }); }
  if (a === "rh-tsubs") { const rows = (await pool(await store.list(`rh:tsub:${sk}:`), 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 1000); return J(200, { ok: true, rows }); }
  if (a === "rh-tsub-act") {
    const k = `rh:tsub:${sk}:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`, s = await store.get(k); if (!s || s.status !== "pending") return J(400, { ok: false, error: "Not pending." });
    const cfg = await liveCfg(); if (!cfg) return J(400, { ok: false, error: "Program not live." }); const tk = cfg.tasks.find((x) => x.id === s.task) || { pts: s.pts, name: s.tname };
    if (b.do === "approve") { const L = await getLed(store, state, s.rid, s.name), tier = cfg.tiers.find((t) => t.id === L.tier); credit(L, cfg, { ref: "task|" + s.task + "|" + s.key, pts: Math.round((b.pts != null ? num(b.pts) : tk.pts) * (tk.tierMult && tier ? tier.mult : 1)), note: "Task: " + tk.name, ruleId: "task", by }); await store.set(ledKey(state, s.rid), L); s.status = "approved"; }
    else { s.status = "rejected"; s.reason = str(b.note, 200); }
    s.by = by; s.upd = Date.now(); await store.set(k, s); await audit(store, state, by, "task " + s.status, s.rid + " · " + s.tname); return J(200, { ok: true });
  }
  // ---- dashboard & reports ----
  if (a === "rh-dash") {
    const cfg = await liveCfg() || cleanCfg((await doc()).draft, state), all = await retailersOf(store, state), months = {}, dist = {}, rules = {};
    let issued = 0, redeemed = 0, expired = 0, outstanding = 0, active = 0, risk = 0, members = 0;
    await pool(all, 30, async (r) => { const L = await store.get(ledKey(state, r.rid)); if (!L) return; members++; let any = false; settle(L);
      L.e.forEach((e) => { const m = (e.d || "").slice(0, 7), M = months[m] || (months[m] = { iss: 0, red: 0, exp: 0 }); if (e.type === "earn") { issued += e.pts; M.iss += e.pts; any = true; if (e.rule) rules[e.rule] = (rules[e.rule] || 0) + e.pts; } else if (e.type === "redeem") { redeemed -= e.pts; M.red -= e.pts; } else if (e.type === "expire") { expired -= e.pts; M.exp -= e.pts; } });
      outstanding += balanceOf(L); if (any) active++; if (L.atRisk) risk++; dist[L.tier || "-"] = (dist[L.tier || "-"] || 0) + 1; });
    const reds = (await pool(await store.list(`rh:red:${sk}:`), 30, (k) => store.get(k))).filter(Boolean), tsubs = (await pool(await store.list(`rh:tsub:${sk}:`), 30, (k) => store.get(k))).filter(Boolean);
    const stock = []; for (const o of cfg.offers.filter((o) => o.fulfil === "codes" && o.on)) { const P = (await store.get(`rh:codes:${sk}:${o.id}`)) || { codes: [] }, free = P.codes.filter((c) => !c.rid).length; if (free <= o.stockAlert) stock.push({ id: o.id, name: o.name, free }); }
    const year = today().slice(0, 4), spent = await issuedRs(store, pool, state, cfg, year), D = await doc();
    return J(200, { ok: true, kpi: { retailers: all.length, members, active, issued, redeemed, expired, outstanding, liabilityRs: r2(outstanding * cfg.pointValue), redRate: issued ? r2(redeemed / issued * 100) : 0, risk, pendingRed: reds.filter((x) => x.status === "pending").length, pendingTasks: tsubs.filter((x) => x.status === "pending").length, budgetYear: cfg.budget.yearRs, spentYear: spent },
      months: Object.keys(months).filter(Boolean).sort().slice(-12).map((m) => Object.assign({ m }, months[m])), dist, rules: Object.keys(rules).map((id) => ({ id, name: (cfg.rules.find((r) => r.id === id) || { name: id === "task" ? "Tasks" : id === "tier" ? "Club bonuses" : id === "manual" || id === "bulk" ? "Manual / bulk" : id }).name, pts: rules[id] })).sort((x, y) => y.pts - x.pts).slice(0, 15),
      offers: Object.values(reds.reduce((m, x) => { if (["rejected", "cancelled"].includes(x.status)) return m; const o = m[x.offer] || (m[x.offer] = { name: x.oname, n: 0, pts: 0 }); o.n++; o.pts += x.pts; return m; }, {})).sort((x, y) => y.n - x.n).slice(0, 10), lowStock: stock, status: D.status, live: !!D.live, pending: D.pending || null });
  }
  if (a === "rh-preview") { const rid = RID(b.rid); const r = await rhRetailer(store, pool, rid, state, b.rh === "ask" || b.rh === "best" ? { rh: b.rh, q: b.q, lang: b.lang } : { rh: "view" }, { by, via: "staff" }, ctx); return J(r.ok ? 200 : 400, r); }
  if (a === "rh-redeem-for") { const rid = RID(b.rid); const r = await rhRetailer(store, pool, rid, state, { rh: "redeem", offer: b.offer }, { by, via: "staff" }); if (r.ok) await audit(store, state, by, "redeem for retailer", rid + " · " + b.offer); return J(r.ok ? 200 : 400, r); }
  // ---- ✨ AI: one rule from words · voucher catalogue · program review ----
  if (a === "rh-ai-rule") {
    if (!ctx.askAI) return J(400, { ok: false, error: "AI is not available." });
    const q = txt(b.text, 2000); if (q.length < 8) return J(400, { ok: false, error: "Describe the rule." });
    const cfg = cleanCfg((await doc()).draft, state);
    const sys = `Turn the State HO's description into ONE earning rule for a vivo retailer rewards program. Reply with ONE JSON object:
{"name":"…","desc":"one line for retailers","template":"template key or empty","period":"month|week|quarter|half|year|custom","from":"YYYY-MM-DD","to":"YYYY-MM-DD","dateFrom":"","dateTo":"","when":{"all":true,"conds":[{"m":metric,"op":">=|>|<=|<|==|!=|between","v":n,"v2":n,"models":[],"thr":100,"kpi":""}]},"award":{"type":"fixed|per_unit|per_value|slab|per_pct_over|pct_bonus|multiplier","value":n,"per":n,"base":100,"metric":metric,"models":[],"kpi":"","slabs":[{"min":n,"max":n,"pts":n,"perUnit":false}],"rules":[]},"tiers":[club ids],"types":[],"cities":[],"tierMult":true|false,"cap":{"perRetailer":n,"total":n},"group":"","stack":true,"priority":5,"qualifying":true,"once":false,"note":"anything you assumed"}
Metrics: ${RH_METRICS.map((m) => m[0] + " = " + m[1]).join("; ")}. Clubs: ${cfg.tiers.map((t) => t.id + " (" + t.name + ")").join(", ")}. Existing rule ids for multipliers: ${cfg.rules.map((r) => r.id + " (" + r.name + ")").join(", ") || "none"}. Rupees as numbers (₹2L = 200000). Today is ${today()}.`;
    const r = await ctx.askAI(ctx.env, q, "", [], ctx.aiFetch, { system: sys, label: "RULE", json: true, raw: true, maxTokens: 1500 });
    const d = r.ok ? parse(r.text) : null; if (!d) return J(200, { ok: false, error: (r.error || "The AI answer couldn't be read") + " — try again." });
    const rule = cleanRule(Object.assign({}, d, { id: "" }), cfg.rules.length); return J(200, { ok: true, rule, note: str(d.note, 400), text: autoDesc(rule, cfg) });
  }
  if (a === "rh-ai-offers") {
    if (!ctx.askAI) return J(400, { ok: false, error: "AI is not available." });
    const cfg = cleanCfg((await doc()).draft, state);
    const sys = `Suggest a balanced rewards catalogue (8-12 vouchers / offers) for vivo smartphone retailers in ${state}, India, for this program: 1 point = ₹${cfg.pointValue}; clubs ${cfg.tiers.map((t) => t.name).join(", ")}. Mix everyday (shopping, food, fuel), aspirational (travel, hotels, experiences), business-useful (scheme wallet credit, vivo merchandise / demo devices) and 1-2 exclusive top-club offers. Points = face value ÷ point value, rounded (aspirational items may cost slightly more points per ₹). ${str(b.text, 600) ? "HO note: " + str(b.text, 600) + "." : ""}
Reply ONLY JSON: {"offers":[{"name":"…","brand":"…","cat":"shopping|travel|hotel|fuel|food|electronics|experience|vivo|wallet|cash|other","icon":"one emoji","pts":n,"value":rupees,"fulfil":"codes|link|manual|wallet","validityDays":n,"tiers":[club ids or empty],"perMonth":n,"approval":"auto|above|manual","howTo":"…","why":"why it belongs"}]} — club ids: ${cfg.tiers.map((t) => t.id).join(", ")}.`;
    const r = await ctx.askAI(ctx.env, "Suggest the catalogue.", "", [], ctx.aiFetch, { system: sys, label: "CATALOGUE", json: true, raw: true, maxTokens: 3000 });
    const d = r.ok ? parse(r.text) : null; if (!d || !Array.isArray(d.offers)) return J(200, { ok: false, error: (r.error || "The AI answer couldn't be read") + " — try again." });
    return J(200, { ok: true, offers: d.offers.slice(0, 15).map((o, i) => Object.assign(cleanOffer(Object.assign({}, o, { id: "" }), i), { why: str(o.why, 200) })) });
  }
  if (a === "rh-ai-review") {   // AI advisor: reviews the draft (and an optional simulation) for gaps, overlaps, cost and fairness
    if (!ctx.askAI) return J(400, { ok: false, error: "AI is not available." });
    const D = await doc(), cfg = cleanCfg(D.draft, state), sim = b.sim && typeof b.sim === "object" ? b.sim : null;
    const slim = { pointValue: cfg.pointValue, expiry: cfg.expiry, budget: cfg.budget, tierEval: cfg.tierEval, tiers: cfg.tiers.map((t) => ({ name: t.name, min: t.min, keep: t.keep, mult: t.mult, grace: t.grace, on: t.on })), rules: cfg.rules.map((r) => ({ id: r.id, name: r.name, on: r.on, period: r.period, logic: autoDesc(r, cfg), tiers: r.tiers, cap: r.cap, group: r.group, stack: r.stack, mult: r.tierMult })),
      offers: cfg.offers.map((o) => ({ name: o.name, pts: o.pts, value: o.value, fulfil: o.fulfil, tiers: o.tiers, on: o.on, rsPerPoint: o.pts ? Math.round(o.value / o.pts * 1000) / 1000 : 0 })), tasks: cfg.tasks.map((t) => ({ name: t.name, pts: t.pts, freq: t.freq })), redeem: cfg.redeem, sim };
    const sys = `You are a channel-loyalty expert reviewing the State HO's retailer rewards program for vivo India (${state}). Be specific and practical, refer to rules / clubs / vouchers by name, use ₹ and Indian number format.
Give, in short sections with bullets: 1) ✅ What works well, 2) ⚠️ Risks — overlapping or double-paying rules, rules nobody can reach or everybody gets, club thresholds too close / far apart, cost vs budget (use the simulation if given: cost per retailer, share going to top earners), point value consistency across vouchers, expiry and liability, abuse risks (tasks, manual, wallet), 3) 💡 Top 5 improvements with the exact change to make (numbers), 4) 🎯 Ideas missing for vivo (e.g. launch push, premium mix, activation hygiene, festive window, streak) if absent. Plain text, no tables.`;
    const r = await ctx.askAI(ctx.env, "Review this program." + (b.focus ? " Focus: " + str(b.focus, 300) : ""), JSON.stringify(slim).slice(0, 14000), [], ctx.aiFetch, { system: sys, label: "PROGRAM", maxTokens: 2500 });
    return J(200, r.ok ? { ok: true, text: txt(r.text, 8000) } : { ok: false, error: r.error || "AI is busy — try again." });
  }
  // ---- AI program designer: describe the state's policy → a full draft (clubs, rules, offers, tasks) ----
  if (a === "rh-ai") {
    if (!ctx.askAI) return J(400, { ok: false, error: "AI is not available." });
    const brief = txt(b.brief, 12000); if (brief.length < 20) return J(400, { ok: false, error: "Describe the policy (or paste the circular)." });
    const sys = `You design retailer rewards-points programs for vivo India (smartphones). From the State HO's policy text, build a program config as ONE JSON object with these keys only:
{"name":"…","pointValue":rupees per point,"expiry":{"mode":"rolling|fixed|never","months":n},"budget":{"yearRs":n,"monthRs":n,"alertPct":80},
"tierEval":{"basis":"sv|su|ach_v|qpts","window":months,"period":"month|quarter|half|year","upgradeNow":true,"downgrade":"one|fit","fastTrack":0},
"tiers":[{"id":"diamond","name":"Diamond","icon":"💎","color":"#5BC0EB","min":entry value,"keep":retention value,"mult":points multiplier,"grace":periods,"upBonus":pts,"keepBonus":pts,"benefits":"…"}] (highest first, last one min 0),
"rules":[{"name":"…","desc":"…","template":"one of the template keys","period":"month|week|quarter|half|year|custom","from":"YYYY-MM-DD","to":"YYYY-MM-DD","when":{"all":true,"conds":[{"m":metric,"op":">=|>|<=|<|==|between","v":n,"v2":n,"models":["…"],"thr":100,"kpi":"name"}]},"award":{"type":"fixed|per_unit|per_value|slab|per_pct_over|pct_bonus|multiplier","value":n,"per":n,"base":100,"metric":metric,"models":[],"slabs":[{"min":n,"max":n (0 = no upper),"pts":n,"perUnit":false}]},"tierMult":true,"tiers":[],"cap":{"perRetailer":n,"total":n},"group":"…","stack":true,"priority":n}],
"offers":[{"name":"Amazon ₹500","brand":"Amazon","cat":"shopping|travel|hotel|fuel|food|electronics|experience|vivo|wallet|cash|other","icon":"🛍","pts":n,"value":rupees,"fulfil":"codes|link|manual|wallet","link":"https://…","validityDays":180,"tiers":[],"perMonth":1,"approval":"auto|manual|above"}],
"tasks":[{"name":"…","desc":"…","pts":n,"proof":"photo|text|none","freq":"once|daily|weekly|monthly"}]}
Metrics: ${RH_METRICS.map((m) => m[0] + " (" + m[1] + ")").join("; ")}. Templates: ${RH_TEMPLATES.map((t) => t.k + " = " + t.name).join("; ")}.
Use ONLY what the policy says; where it is silent use sensible vivo-style defaults and say so in each rule's desc. Values in rupees are numbers (₹15L = 1500000). Reply with the JSON only.`;
    const r = await ctx.askAI(ctx.env, "Build the program.", brief, [], ctx.aiFetch, { system: sys, label: "POLICY", json: true, raw: true, maxTokens: 9000, ctxMax: 14000 });
    const d = r.ok ? parse(r.text) : null; if (!d) return J(200, { ok: false, error: (r.error || "The AI answer couldn't be read") + " — try again." });
    const base = cleanCfg((await doc()).draft, state); const out = cleanCfg(Object.assign({}, base, d, { expiry: Object.assign({}, base.expiry, d.expiry || {}), budget: Object.assign({}, base.budget, d.budget || {}), tierEval: Object.assign({}, base.tierEval, d.tierEval || {}) }), state);
    return J(200, { ok: true, cfg: out });
  }
  return J(400, { ok: false, error: "Unknown action" });
}
async function issuedRs(store, pool, state, cfg, prefix) {   // ₹ value of points issued in a year (YYYY) or month (YYYY-MM)
  let s = 0; for (const k of await store.list(`rh:led:${ST(state)}:`)) { const L = await store.get(k); if (L) (L.e || []).forEach((e) => { if (e.type === "earn" && (e.d || "").startsWith(prefix)) s += e.pts; }); }
  return r2(s * cfg.pointValue);
}
async function quick(store, pool, state) { const sk = ST(state); return { pendingRed: (await store.list(`rh:red:${sk}:`)).length, members: (await store.list(`rh:led:${sk}:`)).length }; }
