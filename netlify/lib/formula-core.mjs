// Formula engine for Studio tools (shared: the server imports this file; tools/pages/build.py turns it into
// /formula.js for the browser, so a formula gives the same answer on the phone and when the server checks it).
// No eval: formulas are tokenised and parsed into a tree, and only the operators and functions below can run.
//
//   Values:     numbers 12.5 · "text" or 'text' · TRUE / FALSE · field keys (amount, nights) · {Field key with spaces}
//               user.state / user.role / user.name / user.designation / user.username · table.column (all rows)
//   Operators:  + - * / % ^   = == != <> < <= > >=   & (join text)   AND OR NOT   ( )
//   Functions:  IF IFS SWITCH AND OR NOT · ROUND ROUNDUP ROUNDDOWN CEIL FLOOR ABS MIN MAX SUM AVG COUNT POWER SQRT
//               PERCENT SLAB (value, "0:0,5:100,10:200") TIER (value, "0:A,50:B,80:C") · LEN LOWER UPPER TRIM CONCAT
//               CONTAINS STARTSWITH ENDSWITH IN ISBLANK BLANK COALESCE NUM TEXT LEFT RIGHT REPLACE
//               TODAY NOW DATE DAYS ADDDAYS YEAR MONTH DAY WEEKDAY HOURS · COUNTROWS(table) · LOOKUP results come in as
//               ordinary field values (the field holds the looked-up record).
const FN = {};
const isBlank = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const N = (v) => { if (Array.isArray(v)) return v.reduce((a, x) => a + N(x), 0); if (v === true) return 1; if (v === false || v == null || v === "") return 0; const n = Number(String(v).replace(/[₹,\s]/g, "")); return isFinite(n) ? n : 0; };
const S = (v) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v));
const B = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v !== "" && !/^(false|no|0)$/i.test(v.trim()) : !!v);
const flat = (a) => a.reduce((o, x) => o.concat(Array.isArray(x) ? x : [x]), []);
const dOf = (v) => { if (v instanceof Date) return v; const s = S(v); const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s); if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))); const t = Number(v); return isFinite(t) && t > 1e11 ? new Date(t) : null; };
const iso = (d) => (d ? d.toISOString().slice(0, 10) : "");
const istNow = () => new Date(Date.now() + 19800000);
function cmp(a, b) { const na = Number(a), nb = Number(b); if (a !== "" && b !== "" && a != null && b != null && isFinite(na) && isFinite(nb) && typeof a !== "boolean" && typeof b !== "boolean") return na < nb ? -1 : na > nb ? 1 : 0; const sa = S(a).toLowerCase(), sb = S(b).toLowerCase(); return sa < sb ? -1 : sa > sb ? 1 : 0; }
function slabPairs(spec) { return S(spec).split(/[,;\n]/).map((p) => p.split(":")).filter((p) => p.length >= 2 && p[0].trim() !== "").map((p) => [N(p[0]), p.slice(1).join(":").trim()]).sort((a, b) => a[0] - b[0]); }
Object.assign(FN, {
  IF: (c, a, b) => (B(c) ? a : b === undefined ? "" : b),
  IFS: (...a) => { for (let i = 0; i + 1 < a.length; i += 2) if (B(a[i])) return a[i + 1]; return a.length % 2 ? a[a.length - 1] : ""; },
  SWITCH: (v, ...a) => { for (let i = 0; i + 1 < a.length; i += 2) if (cmp(v, a[i]) === 0) return a[i + 1]; return a.length % 2 ? a[a.length - 1] : ""; },
  AND: (...a) => flat(a).every(B), OR: (...a) => flat(a).some(B), NOT: (a) => !B(a),
  ROUND: (x, n) => { const p = Math.pow(10, N(n)); return Math.round(N(x) * p) / p; },
  ROUNDUP: (x, n) => { const p = Math.pow(10, N(n)); return Math.ceil(N(x) * p) / p; }, ROUNDDOWN: (x, n) => { const p = Math.pow(10, N(n)); return Math.floor(N(x) * p) / p; },
  CEIL: (x) => Math.ceil(N(x)), FLOOR: (x) => Math.floor(N(x)), ABS: (x) => Math.abs(N(x)), POWER: (a, b) => Math.pow(N(a), N(b)), SQRT: (a) => Math.sqrt(Math.max(0, N(a))),
  MIN: (...a) => { const v = flat(a).filter((x) => !isBlank(x)).map(N); return v.length ? Math.min(...v) : 0; }, MAX: (...a) => { const v = flat(a).filter((x) => !isBlank(x)).map(N); return v.length ? Math.max(...v) : 0; },
  SUM: (...a) => flat(a).reduce((s, x) => s + N(x), 0), AVG: (...a) => { const v = flat(a).filter((x) => !isBlank(x)); return v.length ? v.reduce((s, x) => s + N(x), 0) / v.length : 0; },
  COUNT: (...a) => flat(a).filter((x) => !isBlank(x) && x !== false).length, COUNTROWS: (t) => (Array.isArray(t) ? t.length : 0),
  PERCENT: (a, b) => (N(b) ? N(a) / N(b) * 100 : 0),
  SLAB: (v, spec) => { const x = N(v); let out = 0; slabPairs(spec).forEach((p) => { if (x >= p[0]) out = N(p[1]); }); return out; },
  TIER: (v, spec) => { const x = N(v); let out = ""; slabPairs(spec).forEach((p) => { if (x >= p[0]) out = p[1]; }); return out; },
  LEN: (s) => S(s).length, LOWER: (s) => S(s).toLowerCase(), UPPER: (s) => S(s).toUpperCase(), TRIM: (s) => S(s).trim(), CONCAT: (...a) => flat(a).map(S).join(""),
  CONTAINS: (s, x) => (Array.isArray(s) ? s.some((y) => cmp(y, x) === 0) : S(s).toLowerCase().includes(S(x).toLowerCase())),
  STARTSWITH: (s, x) => S(s).toLowerCase().startsWith(S(x).toLowerCase()), ENDSWITH: (s, x) => S(s).toLowerCase().endsWith(S(x).toLowerCase()),
  IN: (v, ...a) => flat(a).some((x) => cmp(v, x) === 0), ISBLANK: (v) => isBlank(v), BLANK: () => "", COALESCE: (...a) => { for (const x of a) if (!isBlank(x)) return x; return ""; },
  NUM: (v) => N(v), TEXT: (v, dp) => (dp === undefined ? S(v) : N(v).toFixed(Math.max(0, Math.min(6, N(dp))))),
  LEFT: (s, n) => S(s).slice(0, N(n)), RIGHT: (s, n) => S(s).slice(-N(n) || undefined), REPLACE: (s, a, b) => S(s).split(S(a)).join(S(b)),
  TODAY: () => iso(istNow()), NOW: () => istNow().toISOString().slice(0, 16).replace("T", " "),
  DATE: (y, m, d) => iso(new Date(Date.UTC(N(y), N(m) - 1, N(d)))),
  DAYS: (a, b) => { const x = dOf(a), y = dOf(b); return x && y ? Math.round((x - y) / 864e5) : 0; },
  ADDDAYS: (a, n) => { const x = dOf(a); return x ? iso(new Date(x.getTime() + N(n) * 864e5)) : ""; },
  YEAR: (a) => { const x = dOf(a); return x ? x.getUTCFullYear() : 0; }, MONTH: (a) => { const x = dOf(a); return x ? x.getUTCMonth() + 1 : 0; }, DAY: (a) => { const x = dOf(a); return x ? x.getUTCDate() : 0; },
  WEEKDAY: (a) => { const x = dOf(a); return x ? x.getUTCDay() || 7 : 0; },
  HOURS: (a, b) => { const x = dOf(a), y = dOf(b); return x && y ? Math.round((x - y) / 36e5 * 100) / 100 : 0; }
});
export const FUNCTIONS = Object.keys(FN).sort();

function tokenize(src) {
  const T = [], s = String(src); let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; T.push({ t: "n", v: Number(s.slice(i, j)) }); i = j; continue; }
    if (c === '"' || c === "'") { let j = i + 1, out = ""; while (j < s.length && s[j] !== c) { if (s[j] === "\\" && j + 1 < s.length) j++; out += s[j++]; } if (j >= s.length) throw new Error("A text in quotes isn't closed"); T.push({ t: "s", v: out }); i = j + 1; continue; }
    if (c === "{") { const j = s.indexOf("}", i); if (j < 0) throw new Error("A { isn't closed"); T.push({ t: "id", v: s.slice(i + 1, j).trim() }); i = j + 1; continue; }
    if (/[A-Za-z_ऀ-ॿ]/.test(c)) { let j = i; while (j < s.length && /[A-Za-z0-9_.ऀ-ॿ]/.test(s[j])) j++; const w = s.slice(i, j), U = w.toUpperCase(); T.push(U === "AND" || U === "OR" || U === "NOT" ? { t: "op", v: U } : U === "TRUE" ? { t: "b", v: true } : U === "FALSE" ? { t: "b", v: false } : { t: "id", v: w }); i = j; continue; }
    const two = s.slice(i, i + 2);
    if (["<=", ">=", "!=", "<>", "==", "&&", "||"].includes(two)) { T.push({ t: "op", v: two === "&&" ? "AND" : two === "||" ? "OR" : two === "<>" ? "!=" : two === "==" ? "=" : two }); i += 2; continue; }
    if ("+-*/%^=<>&!(),".includes(c)) { T.push(c === "(" || c === ")" || c === "," ? { t: c } : { t: "op", v: c === "!" ? "NOT" : c }); i++; continue; }
    throw new Error("Unexpected “" + c + "”");
  }
  return T;
}
const PREC = { OR: 1, AND: 2, "=": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "&": 5, "+": 6, "-": 6, "*": 7, "/": 7, "%": 7, "^": 8 };
export function parse(src) {
  const T = tokenize(src); let p = 0;
  const peek = () => T[p], next = () => T[p++];
  function primary() {
    const k = next(); if (!k) throw new Error("The formula ends too early");
    if (k.t === "n" || k.t === "s" || k.t === "b") return { k: "v", v: k.v };
    if (k.t === "op" && (k.v === "-" || k.v === "+")) return { k: "u", o: k.v, a: expr(8) };
    if (k.t === "op" && k.v === "NOT") return { k: "u", o: "NOT", a: expr(3) };
    if (k.t === "(") { const e = expr(0); if (!peek() || peek().t !== ")") throw new Error("A ( isn't closed"); next(); return e; }
    if (k.t === "id") {
      if (peek() && peek().t === "(") { next(); const name = k.v.toUpperCase(), args = []; if (!FN[name]) throw new Error("Unknown function " + k.v); if (peek() && peek().t === ")") { next(); return { k: "f", n: name, a: args }; } for (;;) { args.push(expr(0)); const z = next(); if (!z) throw new Error("A ( isn't closed in " + name); if (z.t === ")") break; if (z.t !== ",") throw new Error("Expected , or ) in " + name); } return { k: "f", n: name, a: args }; }
      return { k: "r", n: k.v };
    }
    throw new Error("Unexpected " + (k.v || k.t));
  }
  function expr(min) {
    let left = primary();
    for (;;) { const o = peek(); if (!o || o.t !== "op" || !(o.v in PREC) || PREC[o.v] < min) break; next(); const pr = PREC[o.v]; left = { k: "b", o: o.v, l: left, r: expr(o.v === "^" ? pr : pr + 1) }; }
    return left;
  }
  const e = expr(0); if (p < T.length) throw new Error("Unexpected " + (T[p].v || T[p].t)); return e;
}
function resolve(name, env) {
  const vals = env.vals || {}, nk = String(name).toLowerCase();
  if (nk.indexOf(".") > 0) {
    const [a, ...rest] = String(name).split("."), b = rest.join(".");
    if (a.toLowerCase() === "user") { const u = env.user || {}; return u[b] !== undefined ? u[b] : u[b.toLowerCase()] !== undefined ? u[b.toLowerCase()] : ""; }
    const base = vals[a] !== undefined ? vals[a] : (env.byLabel || {})[a.toLowerCase()];
    if (Array.isArray(base)) return base.map((row) => (row && typeof row === "object" ? row[b] : ""));   // table column
    if (base && typeof base === "object") return base[b] !== undefined ? base[b] : "";                 // looked-up record
    return "";
  }
  if (vals[name] !== undefined) return vals[name];
  const lab = (env.byLabel || {})[nk]; if (lab !== undefined) return lab;
  return "";
}
function ev(n, env) {
  switch (n.k) {
    case "v": return n.v;
    case "r": return resolve(n.n, env);
    case "u": { const a = ev(n.a, env); return n.o === "NOT" ? !B(a) : n.o === "-" ? -N(a) : N(a); }
    case "f": {
      if (n.n === "IF") { return B(ev(n.a[0], env)) ? (n.a[1] ? ev(n.a[1], env) : "") : (n.a[2] ? ev(n.a[2], env) : ""); }
      return FN[n.n](...n.a.map((x) => ev(x, env)));
    }
    case "b": {
      if (n.o === "AND") return B(ev(n.l, env)) && B(ev(n.r, env));
      if (n.o === "OR") return B(ev(n.l, env)) || B(ev(n.r, env));
      const a = ev(n.l, env), b = ev(n.r, env);
      switch (n.o) {
        case "+": return N(a) + N(b); case "-": return N(a) - N(b); case "*": return N(a) * N(b);
        case "/": return N(b) === 0 ? 0 : N(a) / N(b); case "%": return N(b) === 0 ? 0 : N(a) % N(b); case "^": return Math.pow(N(a), N(b));
        case "&": return S(a) + S(b);
        case "=": return Array.isArray(a) ? a.some((x) => cmp(x, b) === 0) : cmp(a, b) === 0;
        case "!=": return Array.isArray(a) ? !a.some((x) => cmp(x, b) === 0) : cmp(a, b) !== 0;
        case "<": return cmp(a, b) < 0; case "<=": return cmp(a, b) <= 0; case ">": return cmp(a, b) > 0; case ">=": return cmp(a, b) >= 0;
      }
    }
  }
  return "";
}
const CACHE = new Map();
export function compile(src) { const k = String(src); if (!CACHE.has(k)) { if (CACHE.size > 500) CACHE.clear(); CACHE.set(k, parse(k)); } return CACHE.get(k); }
// evaluate: returns the value, or `fallback` when the formula is broken
export function evaluate(src, env, fallback) { if (src == null || String(src).trim() === "") return fallback === undefined ? "" : fallback; try { const v = ev(compile(src), env || {}); return typeof v === "number" && !isFinite(v) ? 0 : v; } catch (e) { return fallback === undefined ? "" : fallback; } }
export function test(src, env) { try { compile(src); return { ok: true, value: ev(compile(src), env || {}) }; } catch (e) { return { ok: false, error: e.message }; } }
export function truthy(src, env, dflt) { if (src == null || String(src).trim() === "") return dflt; try { return B(ev(compile(src), env || {})); } catch (e) { return dflt; } }
// field keys a formula refers to (for the builder's "uses" hints and for ordering calculations)
export function refs(src) { try { const out = new Set(); (function w(n) { if (!n) return; if (n.k === "r") out.add(String(n.n).split(".")[0]); if (n.a) (Array.isArray(n.a) ? n.a : [n.a]).forEach(w); if (n.l) w(n.l); if (n.r) w(n.r); })(compile(src)); return [...out]; } catch (e) { return []; } }
// Work out every calculated field (several passes so calcs may use other calcs), table row formulas and totals.
export function computeAll(fields, vals, user) {
  const env = { vals, user: user || {}, byLabel: {} };
  const relabel = () => { env.byLabel = {}; fields.forEach((f) => { if (f.label) env.byLabel[String(f.label).toLowerCase()] = vals[f.key]; }); };
  for (let pass = 0; pass < 4; pass++) {
    relabel();
    fields.forEach((f) => {
      if (f.type === "table" && Array.isArray(vals[f.key])) {
        vals[f.key] = vals[f.key].map((row) => { const r2 = Object.assign({}, row); (f.columns || []).forEach((c) => { if (c.formula) r2[c.key] = evaluate(c.formula, { vals: Object.assign({}, vals, r2), user: env.user, byLabel: env.byLabel }, ""); }); return r2; });
      }
      if (f.type === "calc" && f.formula) { let v = evaluate(f.formula, env, ""); if (typeof v === "number" && f.decimals != null) v = Math.round(v * Math.pow(10, f.decimals)) / Math.pow(10, f.decimals); vals[f.key] = v; }
    });
  }
  relabel();
  return env;
}
