// Salary & incentive engine for state sales employees — one source of truth: the server runs it for payroll,
// and build.py copies it to /salcalc.js so the page and the employee view show the same numbers and workings.
// No imports, no I/O: compute(employee, structure, plan, inputs, ctx) → full break-up with a "why" line for every amount.

export const FINANCIERS = ["Bajaj Finance", "HDB Financial", "TVS Credit", "Home Credit", "IDFC First", "Kotak", "HDFC Bank", "ICICI Bank", "Others"];

// Professional tax: monthly slabs on gross earned (editable in each structure — check your state's current rates with HR)
export const PT_PRESETS = {
  none: { n: "No professional tax", slabs: [] },
  maharashtra: { n: "Maharashtra", slabs: [[0, 7500, 0], [7500.01, 10000, 175], [10000.01, 1e12, 200]], feb: 300 },
  karnataka: { n: "Karnataka", slabs: [[0, 24999.99, 0], [25000, 1e12, 200]] },
  westbengal: { n: "West Bengal", slabs: [[0, 10000, 0], [10000.01, 15000, 110], [15000.01, 25000, 130], [25000.01, 40000, 150], [40000.01, 1e12, 200]] },
  telangana: { n: "Telangana", slabs: [[0, 15000, 0], [15000.01, 20000, 150], [20000.01, 1e12, 200]] },
  andhra: { n: "Andhra Pradesh", slabs: [[0, 15000, 0], [15000.01, 20000, 150], [20000.01, 1e12, 200]] },
  gujarat: { n: "Gujarat", slabs: [[0, 11999.99, 0], [12000, 1e12, 200]] },
  mp: { n: "Madhya Pradesh", slabs: [[0, 18750, 0], [18750.01, 25000, 125], [25000.01, 33333, 167], [33333.01, 1e12, 208]] },
  assam: { n: "Assam", slabs: [[0, 15000, 0], [15000.01, 25000, 180], [25000.01, 1e12, 208]] },
  odisha: { n: "Odisha", slabs: [[0, 13304, 0], [13304.01, 25000, 125], [25000.01, 1e12, 200]] }
};
// Income tax (new regime, FY 2026-27): slabs, ₹75,000 standard deduction, rebate up to ₹12 lakh taxable, 4% cess
export const TAX = { std: 75000, rebateUpto: 1200000, cess: 0.04, slabs: [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [1e15, 0.30]] };
export function annualTax(gross) {
  const ti = Math.max(0, gross - TAX.std); let tax = 0, lo = 0;
  for (const [hi, r] of TAX.slabs) { if (ti > lo) tax += (Math.min(ti, hi) - lo) * r; lo = hi; }
  if (ti <= TAX.rebateUpto) tax = 0; else tax = Math.min(tax, ti - TAX.rebateUpto);   // rebate + marginal relief just above ₹12 lakh
  return Math.round(tax * (1 + TAX.cess));
}

// ---------- safe formula language: numbers, variables, + - * / % ( ), < <= > >= == !=, and or not, ?: and
// min max round floor ceil abs if(c,a,b) slab(x, upto1, v1, upto2, v2, …, else) between(x,a,b) ----------
export function evalExpr(src, vars) {
  const s = String(src || ""); let i = 0;
  const err = (m) => { throw new Error(m + " at “" + s.slice(i, i + 12) + "”"); };
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = (t) => { ws(); return s.startsWith(t, i); };
  const eat = (t) => { if (peek(t)) { i += t.length; return true; } return false; };
  const FN = { min: Math.min, max: Math.max, round: (x, d) => { const p = Math.pow(10, d || 0); return Math.round(x * p) / p; }, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, if: (c, a, b) => (c ? a : b), between: (x, a, b) => (x >= a && x <= b ? 1 : 0),
    // easy words for everyday maths
    percent: (a, b) => (b ? a / b * 100 : 0), pct: (x, p) => x * p / 100, above: (x, limit) => Math.max(0, x - limit), below: (x, limit) => Math.max(0, limit - x),
    cap: (x, mx) => Math.min(x, mx), atleast: (x, mn) => Math.max(x, mn), per: (x, every, amt) => (every ? Math.floor(x / every) * amt : 0), avg: (...a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0), sum: (...a) => a.reduce((p, q) => p + q, 0),
    slab: (x, ...a) => { for (let k = 0; k + 1 < a.length; k += 2) if (x <= a[k]) return a[k + 1]; return a.length % 2 ? a[a.length - 1] : 0; } };
  const prim = () => {
    ws();
    if (eat("(")) { const v = tern(); if (!eat(")")) err("Missing )"); return v; }
    if (eat("-")) return -prim(); if (eat("+")) return prim(); if (eat("!") || (peek("not ") && (i += 4))) return prim() ? 0 : 1;
    const m = /^(\d+(?:\.\d+)?)(%?)/.exec(s.slice(i)); if (m) { i += m[0].length; return +m[1] / (m[2] ? 100 : 1); }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i)); if (!id) err("Unexpected");
    i += id[0].length; const nm = id[0];
    if (peek("(")) { eat("("); const args = []; if (!peek(")")) { do args.push(tern()); while (eat(",")); } if (!eat(")")) err("Missing )"); const f = FN[nm.toLowerCase()]; if (!f) err("Unknown function " + nm); return f(...args); }
    if (/^(true|yes)$/i.test(nm)) return 1; if (/^(false|no)$/i.test(nm)) return 0;
    const key = Object.keys(vars).find((k) => k.toLowerCase() === nm.toLowerCase()); if (key == null) err("Unknown name " + nm); const v = Number(vars[key]); return isFinite(v) ? v : 0;
  };
  const mul = () => { let v = prim(); for (;;) { if (eat("*")) v *= prim(); else if (eat("/")) { const d = prim(); v = d ? v / d : 0; } else return v; } };
  const add = () => { let v = mul(); for (;;) { if (eat("+")) v += mul(); else if (eat("-")) v -= mul(); else return v; } };
  const cmp = () => { const v = add(); if (eat("<=")) return v <= add() ? 1 : 0; if (eat(">=")) return v >= add() ? 1 : 0; if (eat("==")) return v === add() ? 1 : 0; if (eat("!=")) return v !== add() ? 1 : 0; if (eat("<")) return v < add() ? 1 : 0; if (eat(">")) return v > add() ? 1 : 0; return v; };
  const and = () => { let v = cmp(); while (eat("&&") || (peek("and ") && (i += 4))) { const r = cmp(); v = v && r ? 1 : 0; } return v; };
  const or = () => { let v = and(); while (eat("||") || (peek("or ") && (i += 3))) { const r = and(); v = v || r ? 1 : 0; } return v; };
  const tern = () => { const c = or(); if (eat("?")) { const a = tern(); if (!eat(":")) err("Missing :"); const b = tern(); return c ? a : b; } return c; };
  const v = tern(); ws(); if (i < s.length) err("Unexpected"); return isFinite(v) ? v : 0;
}

// ---------- ready-made salary structures (pick one, then edit) ----------
const C = (o) => Object.assign({ on: true, prorate: true }, o);
export const STRUCTURES = [
  { id: "std", name: "Sales promoter — Basic + HRA + Special (PF + ESI)", basis: "calendar", note: "Gross split by %, PF on Basic (capped at ₹15,000 wage), ESI when gross ≤ ₹21,000.",
    earn: [C({ k: "basic", n: "Basic", calc: "pctGross", v: 50, pf: true }), C({ k: "hra", n: "House rent allowance", calc: "pctGross", v: 20 }), C({ k: "conv", n: "Conveyance", calc: "fixed", v: 1600 }), C({ k: "spl", n: "Special allowance", calc: "balance" })],
    ded: [C({ k: "pf", n: "Provident fund (PF)", calc: "pf", v: 12, ceil: 15000, er: 12 }), C({ k: "esi", n: "ESI", calc: "esi", v: 0.75, limit: 21000, er: 3.25 }), C({ k: "pt", n: "Professional tax", calc: "pt", pt: "none" }), C({ k: "tds", n: "Income tax (TDS)", calc: "tds" }), C({ k: "ins", n: "Medical insurance", calc: "empField", field: "insurance", prorate: false }), C({ k: "adv", n: "Advance / loan recovery", calc: "input", field: "advance", prorate: false }), C({ k: "oth", n: "Other deductions", calc: "input", field: "otherDed", prorate: false })] },
  { id: "daily", name: "Daily-wage promoter — rate × paid days (ESI)", basis: "calendar", note: "Pay = daily rate × paid days. ESI applies; no PF.",
    earn: [C({ k: "wage", n: "Wages (daily rate × paid days)", calc: "perDay", field: "dailyRate", prorate: false }), C({ k: "ot", n: "Overtime / extra days", calc: "formula", expr: "extraDays * dailyRate", prorate: false })],
    ded: [C({ k: "esi", n: "ESI", calc: "esi", v: 0.75, limit: 21000, er: 3.25 }), C({ k: "pt", n: "Professional tax", calc: "pt", pt: "none" }), C({ k: "adv", n: "Advance recovery", calc: "input", field: "advance", prorate: false }), C({ k: "oth", n: "Other deductions", calc: "input", field: "otherDed", prorate: false })] },
  { id: "tl", name: "Field executive / team leader — PF, TDS, travel per field day", basis: "calendar", note: "Basic 40% of gross, HRA 40% of Basic, ₹150 travel per field day, PF capped, TDS projected (new regime).",
    earn: [C({ k: "basic", n: "Basic", calc: "pctGross", v: 40, pf: true }), C({ k: "hra", n: "House rent allowance", calc: "pctOf", of: "basic", v: 40 }), C({ k: "spl", n: "Special allowance", calc: "balance" }), C({ k: "trv", n: "Travel allowance (₹150 × field days)", calc: "formula", expr: "150 * fieldDays", prorate: false }), C({ k: "mob", n: "Mobile allowance", calc: "fixed", v: 500 })],
    ded: [C({ k: "pf", n: "Provident fund (PF)", calc: "pf", v: 12, ceil: 15000, er: 12 }), C({ k: "pt", n: "Professional tax", calc: "pt", pt: "none" }), C({ k: "tds", n: "Income tax (TDS)", calc: "tds" }), C({ k: "ins", n: "Medical insurance", calc: "empField", field: "insurance", prorate: false }), C({ k: "svc", n: "Services availed (phone / uniform)", calc: "input", field: "services", prorate: false }), C({ k: "adv", n: "Advance / loan recovery", calc: "input", field: "advance", prorate: false })] },
  { id: "ctc", name: "CTC-based — employer PF & ESI inside CTC", basis: "fixed26", note: "Monthly CTC includes employer PF/ESI; gross is worked back. 26-day month.",
    earn: [C({ k: "basic", n: "Basic", calc: "formula", expr: "round((ctc - min(ctc*0.5,15000)*0.12) * 0.5)", pf: true }), C({ k: "hra", n: "House rent allowance", calc: "pctOf", of: "basic", v: 50 }), C({ k: "spl", n: "Special allowance", calc: "formula", expr: "max(0, ctc - min(ctc*0.5,15000)*0.12 - basic - hra)" })],
    ded: [C({ k: "pf", n: "Provident fund (PF)", calc: "pf", v: 12, ceil: 15000, er: 12 }), C({ k: "esi", n: "ESI", calc: "esi", v: 0.75, limit: 21000, er: 3.25 }), C({ k: "pt", n: "Professional tax", calc: "pt", pt: "none" }), C({ k: "ins", n: "Medical insurance", calc: "empField", field: "insurance", prorate: false })] },
  { id: "stipend", name: "Trainee — fixed stipend (no PF / ESI)", basis: "calendar", note: "One fixed amount, cut for leave without pay.",
    earn: [C({ k: "stip", n: "Stipend", calc: "pctGross", v: 100 })],
    ded: [C({ k: "adv", n: "Advance recovery", calc: "input", field: "advance", prorate: false })] }
];

// ---------- ready-made incentive plans ----------
const R = (o) => Object.assign({ on: true }, o);
const FINR = (a) => FINANCIERS.map((f, i) => ({ fin: f, rate: a[i] != null ? a[i] : a[a.length - 1] }));
export const PLANS = [
  { id: "slabvs", name: "Promoter — achievement slab per unit + V-Shield + EMI", achOn: "units", note: "Per-unit rate by achievement %, V-Shield per unit with attach bonus, ₹ per EMI IMEI by financier, EMI attach bonus.",
    gates: { minPaidDays: 0, minAch: 0, prorate: true }, cap: { type: "none", v: 0 },
    rules: [R({ id: "r1", type: "slab", n: "Achievement slab (₹ per unit sold)", on_: "ach", mode: "perUnit", slabs: [[0, 79.99, 0], [80, 99.99, 40], [100, 119.99, 60], [120, 1e9, 80]] }),
      R({ id: "r2", type: "vshield", n: "V-Shield", rate: 50, slabs: [[30, 1e9, 500]] }),
      R({ id: "r3", type: "financier", n: "EMI by financier (₹ per IMEI)", rates: FINR([50, 40, 40, 30, 30, 30, 25, 25, 20]) }),
      R({ id: "r4", type: "emiAttach", n: "EMI attach bonus", slabs: [[40, 59.99, 300], [60, 1e9, 600]], mode: "fixed" })] },
  { id: "ti", name: "Target incentive (TI) — payout % by achievement", achOn: "units", note: "Each employee has a target incentive (TI). 70% → 50% of TI, 100% → 100%, 130% → 150% (in between is pro-rata). ₹1,000 kicker at 120%+.",
    gates: { minPaidDays: 0, minAch: 70, prorate: true }, cap: { type: "xTI", v: 1.6 },
    rules: [R({ id: "r1", type: "tiCurve", n: "TI payout", points: [[70, 50], [100, 100], [130, 150]] }), R({ id: "r2", type: "kicker", n: "Kicker at 120%+", minAch: 120, amount: 1000, perUnitAbove: 0 })] },
  { id: "model", name: "Model-wise ₹ per unit (series rates) + V-Shield", achOn: "units", note: "Rate per unit by model / series (Y* = all Y models), plus V-Shield per unit.",
    gates: { minPaidDays: 0, minAch: 0, prorate: false }, cap: { type: "none", v: 0 },
    rules: [R({ id: "r1", type: "model", n: "Model-wise incentive", rates: [{ m: "X*", rate: 300 }, { m: "V*", rate: 150 }, { m: "T*", rate: 70 }, { m: "Y*", rate: 50 }, { m: "*", rate: 30 }] }), R({ id: "r2", type: "vshield", n: "V-Shield", rate: 40, slabs: [] })] },
  { id: "value", name: "Value-based — % of sales value", achOn: "value", note: "0.5% of sales value above ₹5,00,000, plus 1% of value above the value target.",
    gates: { minPaidDays: 0, minAch: 0, prorate: false }, cap: { type: "fixed", v: 25000 },
    rules: [R({ id: "r1", type: "valuePct", n: "Sales value share", pct: 0.5, above: 500000 }), R({ id: "r2", type: "formula", n: "Over-target value bonus", expr: "valueTarget > 0 ? max(0, value - valueTarget) * 1% : 0" })] },
  { id: "hybrid", name: "Hybrid with gates — slab + EMI + kicker (min 22 days, 70%)", achOn: "units", note: "Paid only with 22+ paid days and 70%+ achievement. Capped at 2 × TI.",
    gates: { minPaidDays: 22, minAch: 70, prorate: false }, cap: { type: "xTI", v: 2 },
    rules: [R({ id: "r1", type: "slab", n: "Achievement slab (₹ per unit)", on_: "ach", mode: "perUnit", slabs: [[70, 99.99, 35], [100, 1e9, 55]] }), R({ id: "r2", type: "financier", n: "EMI by financier", rates: FINR([40, 35, 35, 25, 25, 25, 20, 20, 15]) }),
      R({ id: "r3", type: "kicker", n: "Above-target units", minAch: 100, amount: 0, perUnitAbove: 25 }), R({ id: "r4", type: "vshield", n: "V-Shield", rate: 50, slabs: [[25, 1e9, 300]] })] }
];
// fields a simple rule can use (label shown to HR)
export const EASY_FIELDS = [["units", "Units sold"], ["aboveTarget", "Units above target"], ["target", "Target (units)"], ["ach", "Achievement %"], ["value", "Sales value ₹"], ["valueTarget", "Value target ₹"], ["vshield", "V-Shield units"], ["vsAttach", "V-Shield attach %"], ["emi", "EMI units"], ["emiAttach", "EMI attach %"], ["paidDays", "Paid days"], ["presentDays", "Present days"], ["fieldDays", "Field days"], ["lopDays", "Leave without pay days"], ["ti", "Target incentive ₹"]];
export const EASY_OPS = [[">=", "is at least"], [">", "is more than"], ["<=", "is at most"], ["<", "is less than"], ["==", "is exactly"], ["!=", "is not"]];
const fieldName = (k) => ((EASY_FIELDS.find((f) => f[0] === k) || [k, k])[1]);
// a "simple rule": pay a fixed ₹ / ₹ per unit / % of a number / ₹ for every N — only when all its conditions are met — with an optional maximum
export function easyRule(r, V) {
  const conds = (r.conds || []).filter((c) => c && c.f), fails = conds.filter((c) => { const x = num(V[c.f]), v = num(c.v); return !({ ">=": x >= v, ">": x > v, "<=": x <= v, "<": x < v, "==": x === v, "!=": x !== v })[c.op || ">="]; });
  const opT = (op) => ((EASY_OPS.find((o) => o[0] === (op || ">=")) || ["", "is"])[1]), show = (c) => fieldName(c.f) + " " + opT(c.op) + " " + c.v;
  if (fails.length) return { amt: 0, why: "Not paid: " + fails.map((c) => fieldName(c.f) + " is " + Math.round(num(V[c.f]) * 10) / 10 + " (needs " + opT(c.op).replace(/^is /, "") + " " + c.v + ")").join("; ") };
  const q = num(V[r.of || "units"]), a = num(r.amt); let amt = 0, why = "";
  if (r.pay === "fixed") { amt = a; why = inr(a) + " fixed"; }
  else if (r.pay === "pct") { amt = q * a / 100; why = a + "% of " + fieldName(r.of) + " " + inr(q); }
  else if (r.pay === "every") { const n = Math.max(1, num(r.every) || 1); amt = Math.floor(q / n) * a; why = inr(a) + " for every " + n + " " + fieldName(r.of).toLowerCase() + " (" + q + " → " + Math.floor(q / n) + " × " + inr(a) + ")"; }
  else { amt = q * a; why = q + " " + fieldName(r.of || "units").toLowerCase() + " × " + inr(a); }
  if (num(r.max) && amt > num(r.max)) { amt = num(r.max); why += " · capped at " + inr(r.max); }
  if (conds.length) why += " · because " + conds.map(show).join(" and ");
  return { amt, why };
}
export function easyText(r) {
  const of = fieldName(r.of || "units").toLowerCase(), a = num(r.amt), pay = r.pay === "fixed" ? "Pay " + inr(a) : r.pay === "pct" ? "Pay " + a + "% of " + of : r.pay === "every" ? "Pay " + inr(a) + " for every " + (num(r.every) || 1) + " " + of : "Pay " + inr(a) + " per " + of.replace(/s$/, "");
  const c = (r.conds || []).filter((x) => x && x.f).map((x) => fieldName(x.f).toLowerCase() + " " + ((EASY_OPS.find((o) => o[0] === (x.op || ">=")) || ["", "is"])[1]) + " " + x.v);
  return pay + (c.length ? " when " + c.join(" and ") : "") + (num(r.max) ? ", up to " + inr(r.max) : "") + ".";
}
export const RULE_TYPES = { easy: "✅ Simple rule (pay ₹ / % when …)", slab: "Slab by achievement % / units", perUnit: "₹ per unit", model: "Model / series-wise ₹ per unit", vshield: "V-Shield per unit + attach bonus", emiAttach: "EMI attach % slab", financier: "₹ per IMEI by EMI company", valuePct: "% of sales value", kicker: "Kicker / above-target bonus", tiCurve: "Target incentive payout curve", formula: "Custom formula" };

// ---------- helpers ----------
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rup = (n) => Math.round(Number(n) || 0);
const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return isFinite(n) ? n : 0; };
const pct1 = (n) => Math.round(n * 10) / 10 + "%";
export function daysIn(month) { const [y, m] = String(month).split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function slabFind(x, slabs) { return (slabs || []).find((s) => x >= num(s[0]) && x <= num(s[1])); }
function matchModel(name, pat) { pat = String(pat || "").trim(); if (!pat || pat === "*") return true; const p = pat.toLowerCase(), n = String(name).toLowerCase(); return p.endsWith("*") ? n.startsWith(p.slice(0, -1)) : n === p; }

// paid days from attendance (present + paid leave + weekly offs + holidays, minus nothing; LOP reduces)
export function attendance(att, month, basis) {
  const md = daysIn(month), a = att || {}, present = num(a.present), pl = num(a.paidLeave), wo = num(a.weekOff), hol = num(a.holiday), lop = num(a.lop);
  let paid = present + pl + wo + hol; if (!paid && !lop) paid = md;   // no attendance row = full month
  paid = Math.min(md, paid);
  const lopCal = lop || Math.max(0, md - paid), bd = basis === "fixed26" ? 26 : basis === "fixed30" ? 30 : md;
  if (basis === "fixed26" || basis === "fixed30") paid = Math.max(0, bd - lopCal);   // fixed-day month: every LOP day cuts 1/26 (or 1/30)
  return { monthDays: md, basisDays: bd, paidDays: paid, presentDays: present || Math.max(0, paid - pl - wo - hol), lopDays: lopCal, fieldDays: num(a.fieldDays) || present, extraDays: num(a.extraDays), factor: bd ? Math.min(1, paid / bd) : 1 };
}

// ---------- salary ----------
export function salary(emp, st, inp, month, opts) {
  opts = opts || {}; const A = attendance(inp.att, month, st.basis), f = A.factor, gross = num(emp.gross), ctc = num(emp.ctc) || gross, adj = inp.adj || {};
  const V = Object.assign({ gross, ctc, dailyRate: num(emp.dailyRate), ti: num(emp.ti), insurance: num(emp.insurance) }, A), E = [], D = [], ER = [], vals = {};
  const earnList = (st.earn || []).filter((c) => c.on !== false);
  // full-month amounts first (balance needs the others), then prorate
  const full = {};
  earnList.forEach((c) => { if (c.calc === "balance") return; let v = 0, why = "";
    if (c.calc === "fixed") { v = num(c.v); why = inr(v) + " a month"; }
    else if (c.calc === "pctGross") { v = gross * num(c.v) / 100; why = num(c.v) + "% of gross " + inr(gross); }
    else if (c.calc === "pctOf") { v = (full[c.of] || 0) * num(c.v) / 100; why = num(c.v) + "% of " + ((earnList.find((x) => x.k === c.of) || {}).n || c.of); }
    else if (c.calc === "perDay") { const rate = num(emp[c.field] || c.v); v = rate * A.paidDays; why = inr(rate) + " × " + A.paidDays + " paid days"; }
    else if (c.calc === "empField") { v = num(emp[c.field]); why = "per employee"; }
    else if (c.calc === "input") { v = num(adj[c.field]); why = "this month’s input"; }
    else if (c.calc === "formula") { try { v = evalExpr(c.expr, Object.assign({}, V, full)); why = c.expr; } catch (e) { v = 0; why = "Formula error: " + e.message; } }
    full[c.k] = v; c._why = why; });
  earnList.forEach((c) => { if (c.calc !== "balance") return; const used = earnList.filter((x) => x.calc !== "balance" && x.prorate !== false && x.calc !== "perDay" && x.calc !== "input").reduce((a, x) => a + (full[x.k] || 0), 0); full[c.k] = Math.max(0, gross - used); c._why = "Gross " + inr(gross) + " − other parts"; });
  earnList.forEach((c) => { const pr = c.prorate !== false && !["perDay", "input"].includes(c.calc); const amt = r2((full[c.k] || 0) * (pr ? f : 1)); vals[c.k] = amt;
    E.push({ k: c.k, n: c.n, full: r2(full[c.k] || 0), amt, why: (c._why || "") + (pr && f < 1 ? " × " + A.paidDays + "/" + A.basisDays + " days" : ""), pf: !!c.pf }); });
  if (num(adj.arrears)) E.push({ k: "arr", n: "Arrears", full: num(adj.arrears), amt: r2(num(adj.arrears)), why: "this month’s input" });
  if (num(adj.otherEarn)) E.push({ k: "oe", n: "Other earnings", full: num(adj.otherEarn), amt: r2(num(adj.otherEarn)), why: adj.remark || "this month’s input" });
  const grossEarned = r2(E.reduce((a, x) => a + x.amt, 0)), pfWage = E.filter((x) => x.pf).reduce((a, x) => a + x.amt, 0);
  const DV = Object.assign({}, V, vals, { grossEarned, pfWage });
  (st.ded || []).filter((c) => c.on !== false).forEach((c) => { let v = 0, why = "";
    if (c.calc === "pf") { const w = c.ceil ? Math.min(pfWage, num(c.ceil)) : pfWage; v = w * num(c.v) / 100; why = num(c.v) + "% of PF wage " + inr(w) + (c.ceil && pfWage > c.ceil ? " (capped at " + inr(c.ceil) + ")" : ""); if (c.er) ER.push({ k: "pf_er", n: "Employer PF", amt: rup(w * num(c.er) / 100), why: num(c.er) + "% of " + inr(w) }); v = rup(v); }
    else if (c.calc === "esi") { if (gross <= num(c.limit || 21000)) { v = Math.ceil(grossEarned * num(c.v) / 100); why = num(c.v) + "% of gross earned " + inr(grossEarned); if (c.er) ER.push({ k: "esi_er", n: "Employer ESI", amt: Math.ceil(grossEarned * num(c.er) / 100), why: num(c.er) + "% of " + inr(grossEarned) }); } else why = "Not applicable (gross above " + inr(c.limit || 21000) + ")"; }
    else if (c.calc === "pt") { const P = c.slabs ? { slabs: c.slabs, feb: c.feb } : (PT_PRESETS[c.pt] || PT_PRESETS.none), s = slabFind(grossEarned, P.slabs); v = s ? num(s[2]) : 0; if (v && P.feb && /-02$/.test(month)) v = P.feb; why = (PT_PRESETS[c.pt] ? PT_PRESETS[c.pt].n : "State slab") + " on " + inr(grossEarned); }
    else if (c.calc === "tds") { if (num(adj.tds)) { v = num(adj.tds); why = "as given by HR"; } else { const yr = num(emp.gross) * 12 + num(emp.otherAnnual); const t = annualTax(yr); v = Math.round(t / 12); why = t ? "Yearly tax " + inr(t) + " on projected " + inr(yr) + " ÷ 12 (new regime)" : "Nil — projected income " + inr(yr) + " is within the ₹12 lakh rebate"; } }
    else if (c.calc === "fixed") { v = num(c.v); why = inr(v) + " a month"; }
    else if (c.calc === "empField") { v = num(emp[c.field]); why = "per employee"; }
    else if (c.calc === "input") { v = num(adj[c.field]); why = adj.remark && c.field === "otherDed" ? adj.remark : "this month’s input"; }
    else if (c.calc === "months") { v = (c.months || []).includes(Number(month.slice(5))) ? num(c.v) : 0; why = v ? "due this month" : "not due this month"; }
    else if (c.calc === "formula") { try { v = evalExpr(c.expr, DV); why = c.expr; } catch (e) { v = 0; why = "Formula error: " + e.message; } }
    if (c.prorate === true && !["pf", "esi", "pt", "tds"].includes(c.calc)) { v = v * f; why += " × " + A.paidDays + "/" + A.basisDays; }
    D.push({ k: c.k, n: c.n, amt: r2(Math.max(0, v)), why }); });
  const totalDed = r2(D.reduce((a, x) => a + x.amt, 0)), net = Math.round(grossEarned - totalDed);
  return { att: A, earn: E, ded: D, employer: ER, gross: grossEarned, fullGross: r2(Object.values(full).reduce((a, x) => a + x, 0)), totalDed, net, ctc: r2(grossEarned + ER.reduce((a, x) => a + x.amt, 0)) };
}

// ---------- incentive ----------
export function incentive(emp, plan, inp, month, att) {
  const s = inp.sales || {}, target = num(s.target), units = num(s.units), value = num(s.value), valueTarget = num(s.valueTarget), vs = num(s.vshield), fin = s.fin || {}, models = s.models || {};
  let emi = num(s.emi); const finTotal = Object.values(fin).reduce((a, x) => a + num(x), 0); if (!emi) emi = finTotal;
  const ach = plan.achOn === "value" ? (valueTarget ? value / valueTarget * 100 : 0) : (target ? units / target * 100 : 0);
  const ti = num(emp.ti), A = att || attendance(inp.att, month, "calendar");
  const V = Object.assign({ target, units, value, valueTarget, vshield: vs, emi, ach, achievement: ach, ti, gross: num(emp.gross), aboveTarget: Math.max(0, units - target), vsAttach: units ? vs / units * 100 : 0, emiAttach: units ? emi / units * 100 : 0 }, A, s.vars || {});
  Object.keys(fin).forEach((k) => { V["fin_" + k.replace(/\W+/g, "_")] = num(fin[k]); }); Object.keys(models).forEach((k) => { V["m_" + k.replace(/\W+/g, "_")] = num(models[k]); });
  const out = [];
  (plan.rules || []).filter((r) => r.on !== false).forEach((r) => { let amt = 0, why = "", lines = [];
    try {
      if (r.type === "slab") { const x = r.on_ === "units" ? units : ach, sl = slabFind(x, r.slabs), v = sl ? num(sl[2]) : 0, base = r.base === "above" ? V.aboveTarget : units;
        if (!sl || !v) why = (r.on_ === "units" ? units + " units" : "Achievement " + pct1(ach)) + " → no slab reached";
        else if (r.mode === "fixed") { amt = v; why = (r.on_ === "units" ? units + " units" : pct1(ach)) + " is in slab " + sl[0] + "–" + (sl[1] >= 1e8 ? "+" : sl[1]) + " → " + inr(v); }
        else if (r.mode === "pctTI") { amt = ti * v / 100; why = pct1(ach) + " → " + v + "% of TI " + inr(ti); }
        else { amt = base * v; why = (r.on_ === "units" ? units + " units" : pct1(ach)) + " → " + inr(v) + "/unit × " + base + (r.base === "above" ? " units above target" : " units"); } }
      else if (r.type === "perUnit") { const q = r.var ? num(V[r.var]) : units; amt = q * num(r.rate); why = q + " × " + inr(r.rate); }
      else if (r.type === "model") { Object.keys(models).forEach((m) => { const q = num(models[m]); if (!q) return; const rt = (r.rates || []).find((x) => matchModel(m, x.m)); if (rt) { amt += q * num(rt.rate); lines.push(m + ": " + q + " × " + inr(rt.rate) + " = " + inr(q * num(rt.rate))); } }); why = lines.length ? lines.length + " models" : "No model-wise sales given"; }
      else if (r.type === "vshield") { amt = vs * num(r.rate); why = vs + " V-Shield × " + inr(r.rate); const at = V.vsAttach, sl = slabFind(at, r.slabs); if (sl && num(sl[2])) { amt += num(sl[2]); why += " + attach " + pct1(at) + " bonus " + inr(sl[2]); } else if ((r.slabs || []).length) why += " (attach " + pct1(at) + ")"; }
      else if (r.type === "emiAttach") { const at = V.emiAttach, sl = slabFind(at, r.slabs); if (sl && num(sl[2])) { amt = r.mode === "perUnit" ? emi * num(sl[2]) : num(sl[2]); why = "EMI attach " + pct1(at) + " (" + emi + " of " + units + ") → " + (r.mode === "perUnit" ? inr(sl[2]) + " × " + emi : inr(sl[2])); } else why = "EMI attach " + pct1(at) + " → below the first slab"; }
      else if (r.type === "financier") { Object.keys(fin).forEach((k) => { const q = num(fin[k]); if (!q) return; const rt = (r.rates || []).find((x) => x.fin.toLowerCase() === k.toLowerCase()) || (r.rates || []).find((x) => /^others?$/i.test(x.fin)); const rate = rt ? num(rt.rate) : 0; amt += q * rate; lines.push(k + ": " + q + " IMEI × " + inr(rate) + " = " + inr(q * rate)); }); why = lines.length ? finTotal + " EMI IMEIs" : "No EMI sales given"; }
      else if (r.type === "valuePct") { const b = Math.max(0, value - num(r.above)); amt = b * num(r.pct) / 100; why = num(r.pct) + "% of (" + inr(value) + (num(r.above) ? " − " + inr(r.above) : "") + ")"; }
      else if (r.type === "kicker") { if (ach >= num(r.minAch)) { amt = num(r.amount) + V.aboveTarget * num(r.perUnitAbove); why = pct1(ach) + " ≥ " + r.minAch + "%" + (num(r.amount) ? " → " + inr(r.amount) : "") + (num(r.perUnitAbove) ? " + " + V.aboveTarget + " units above target × " + inr(r.perUnitAbove) : ""); } else why = pct1(ach) + " is below " + r.minAch + "%"; }
      else if (r.type === "tiCurve") { const P = (r.points || []).slice().sort((a, b) => a[0] - b[0]); let p = 0; if (P.length && ach >= P[0][0]) { p = P[P.length - 1][1]; for (let k = 0; k + 1 < P.length; k++) if (ach <= P[k + 1][0]) { p = P[k][1] + (ach - P[k][0]) / (P[k + 1][0] - P[k][0]) * (P[k + 1][1] - P[k][1]); break; } }
        amt = ti * p / 100; why = pct1(ach) + " achievement → " + pct1(p) + " of TI " + inr(ti); }
      else if (r.type === "formula") { amt = evalExpr(r.expr, V); why = r.expr; }
      else if (r.type === "easy") { const e = easyRule(r, V); amt = e.amt; why = e.why; }
    } catch (e) { amt = 0; why = "Formula error: " + e.message; }
    out.push({ id: r.id, n: r.n, type: r.type, amt: r2(Math.max(0, amt)), why, lines }); });
  let gross = r2(out.reduce((a, x) => a + x.amt, 0)); const notes = [], g = plan.gates || {};
  let paid = gross;
  if (num(g.minPaidDays) && A.paidDays < num(g.minPaidDays)) { notes.push("Not eligible: " + A.paidDays + " paid days (needs " + g.minPaidDays + ")"); paid = 0; }
  else if (num(g.minAch) && ach < num(g.minAch)) { notes.push("Not eligible: achievement " + pct1(ach) + " (needs " + g.minAch + "%)"); paid = 0; }
  else if (g.prorate && A.factor < 1) { paid = r2(gross * A.factor); notes.push("Prorated for attendance: " + A.paidDays + "/" + A.basisDays + " days"); }
  const cap = plan.cap || {}; let capAt = 0;
  if (cap.type === "fixed" && num(cap.v)) capAt = num(cap.v); if (cap.type === "xTI" && num(cap.v) && ti) capAt = ti * num(cap.v);
  if (capAt && paid > capAt) { notes.push("Capped at " + inr(capAt) + (cap.type === "xTI" ? " (" + cap.v + " × TI)" : "")); paid = capAt; }
  const ded = []; const adj = inp.adj || {};
  if (num(plan.tdsPct)) ded.push({ k: "tds", n: "TDS on incentive", amt: r2(paid * num(plan.tdsPct) / 100), why: plan.tdsPct + "%" });
  if (num(adj.incDed)) ded.push({ k: "rec", n: "Incentive recovery", amt: num(adj.incDed), why: adj.remark || "this month’s input" });
  const totalDed = r2(ded.reduce((a, x) => a + x.amt, 0));
  return { ach: r2(ach), vars: { target, units, value, valueTarget, vshield: vs, emi, vsAttach: r2(V.vsAttach), emiAttach: r2(V.emiAttach), aboveTarget: V.aboveTarget, fin, models }, rules: out, gross, eligible: r2(paid), notes, ded, totalDed, net: Math.round(Math.max(0, paid - totalDed)) };
}

// credit dates: salary on the 1st of the next month, incentive 15 days later (configurable)
export function creditDates(month, salDay, incDelay) { const [y, m] = month.split("-").map(Number), d = new Date(Date.UTC(y, m, salDay || 1)), e = new Date(d.getTime() + (incDelay == null ? 15 : incDelay) * 864e5); return { salary: d.toISOString().slice(0, 10), incentive: e.toISOString().slice(0, 10) }; }

export function compute(emp, st, plan, inp, month, settings) {
  settings = settings || {}; inp = inp || {};
  const sal = st ? salary(emp, st, inp, month) : null, inc = plan ? incentive(emp, plan, inp, month, sal ? sal.att : null) : null;
  return { month, code: emp.code, name: emp.name, salary: sal, incentive: inc, total: (sal ? sal.net : 0) + (inc ? inc.net : 0), credit: creditDates(month, settings.salDay, settings.incDelay) };
}
