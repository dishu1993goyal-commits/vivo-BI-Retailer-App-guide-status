// Scheme payout engine (used by schemecalc.html; also runs under node for tests).
// A scheme = { basis, targetType, excludePartners, minAch, belowMin, cap, period, rules:[...] }.
// A row (one retailer / VBA) = { rid, name, target, vsTarget, upload, activation, both, either, value, vsSold, excl,
//   models:{ basis: { model: units } }, dash:{ active, appDays, features, appVisits, mvisits } }.
(function (root) {
  "use strict";
  var MATHF = { min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs };
  var VARS = ["units", "target", "ach", "value", "vsSold", "vsTarget", "upload", "activation", "both", "appDays", "features", "appVisits", "mvisits", "active", "payout"];
  var n = function (v) { var x = Number(v); return isFinite(x) ? x : 0; };
  var lc = function (s) { return String(s == null ? "" : s).trim().toLowerCase(); };

  function baseUnits(row, basis) {
    var u = n(row.upload), a = n(row.activation);
    var v = basis === "upload" ? u : basis === "activation" ? a : basis === "either" ? (row.either != null ? n(row.either) : Math.max(u, a)) : (row.both != null ? n(row.both) : Math.min(u, a));
    if (!row.fromImei) v -= n(row.excl);           // summary template: units sold through excluded EMI partners are taken out
    return Math.max(0, v);
  }
  function unitsFor(row, sc, rule) {
    if (rule && rule.models && rule.models.length) {
      var m = (row.models && row.models[sc.basis]) || null;
      if (!m) return 0;
      var t = 0; Object.keys(m).forEach(function (k) { if (rule.models.some(function (x) { return lc(k).indexOf(lc(x)) >= 0; })) t += n(m[k]); });
      return t;
    }
    return baseUnits(row, sc.basis);
  }
  function achOf(row, sc) {
    var tg = n(row.target); if (tg <= 0) return null;
    var got = sc.targetType === "value" ? n(row.value) : baseUnits(row, sc.basis);
    return got / tg * 100;
  }
  function slabFor(slabs, x) { var s = null; (slabs || []).forEach(function (z) { if (x != null && x >= n(z.from)) s = z; }); return s; }
  function whenOk(w, achieved) { return w === "achieved" ? achieved : w === "notAchieved" ? !achieved : true; }
  function evalFormula(expr, vars) {
    var ids = String(expr).match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    for (var i = 0; i < ids.length; i++) if (VARS.indexOf(ids[i]) < 0 && !MATHF[ids[i]]) throw new Error("Unknown name in formula: " + ids[i]);
    var names = VARS.concat(Object.keys(MATHF));
    var f = new Function(names.join(","), '"use strict"; return (' + expr + ");");
    var r = f.apply(null, VARS.map(function (k) { return n(vars[k]); }).concat(Object.keys(MATHF).map(function (k) { return MATHF[k]; })));
    return typeof r === "boolean" ? (r ? 1 : 0) : n(r);
  }
  function fmtSlab(z, unit) { return z ? "≥ " + z.from + unit + (z.to != null ? " (to " + z.to + unit + ")" : "") : "Below first slab"; }

  // ---- one row ----
  function computeRow(sc, row) {
    var rules = (sc.rules || []).filter(function (r) { return !r.off; });
    var units = baseUnits(row, sc.basis), tg = n(row.target), ach = achOf(row, sc);
    var minA = n(sc.minAch), achieved = ach != null && ach >= (minA || 100);
    var d = row.dash || {}, parts = [], reasons = [], pos = 0, neg = 0, mainSlab = null, factor = 1, gateMode = null, reduce = 0;
    // eligibility rules (dashboard data)
    rules.filter(function (r) { return r.type === "gate"; }).forEach(function (g) {
      var fails = [];
      if (g.active && !d.active) fails.push("not an active retailer on the dashboard");
      if (n(g.appDays) && n(d.appDays) < n(g.appDays)) fails.push("retailer app used on " + n(d.appDays) + " of " + n(g.appDays) + " days needed");
      if (n(g.features) && n(d.features) < n(g.features)) fails.push(n(d.features) + " of " + n(g.features) + " app features used");
      if (n(g.mvisits) && n(d.mvisits) < n(g.mvisits)) fails.push(n(d.mvisits) + " of " + n(g.mvisits) + " market visits");
      if (n(g.vsPct) && (n(row.vsTarget) > 0 ? n(row.vsSold) / n(row.vsTarget) * 100 : 0) < n(g.vsPct)) fails.push("V-Shield below " + n(g.vsPct) + "% of target");
      if (fails.length) { reasons.push((g.label || "Eligibility") + ": " + fails.join(", ")); if (g.effect === "reduce") reduce = Math.max(reduce, n(g.reducePct)); else gateMode = "zero"; }
    });
    var vars = { units: units, target: tg, ach: ach || 0, value: n(row.value), vsSold: n(row.vsSold), vsTarget: n(row.vsTarget), upload: n(row.upload), activation: n(row.activation), both: row.both != null ? n(row.both) : Math.min(n(row.upload), n(row.activation)), appDays: n(d.appDays), features: n(d.features), appVisits: n(d.appVisits), mvisits: n(d.mvisits), active: d.active ? 1 : 0, payout: 0 };
    rules.forEach(function (r) {
      var amt = 0, slabTxt = "", u = unitsFor(row, sc, r);
      if (r.type === "ach_slab") {
        var z = ach == null ? null : slabFor(r.slabs, ach);
        if (ach == null) reasons.push((r.label || "Achievement slab") + ": no target given");
        if (z) amt = r.pay === "fixed" ? n(z.amount) : n(z.amount) * u;
        slabTxt = fmtSlab(z, "%"); if (!mainSlab) mainSlab = slabTxt;
      } else if (r.type === "unit_slab") {
        var sl = r.slabs || [];
        if (r.mode === "incremental") {
          sl.forEach(function (s, i) { var lo = n(s.from), hi = s.to != null ? n(s.to) : (sl[i + 1] ? n(sl[i + 1].from) - 1 : Infinity); var inBand = Math.max(0, Math.min(u, hi) - lo + 1); amt += inBand * n(s.rate); });
          var zz = slabFor(sl, u); slabTxt = fmtSlab(zz, " units");
        } else { var z2 = slabFor(sl, u); if (z2) amt = u * n(z2.rate); slabTxt = fmtSlab(z2, " units"); }
        if (!mainSlab) mainSlab = slabTxt;
      } else if (r.type === "flat_unit") { if (whenOk(r.when, achieved)) amt = n(r.rate) * u; }
      else if (r.type === "value_pct") { if (whenOk(r.when, achieved)) amt = n(r.pct) / 100 * n(row.value); }
      else if (r.type === "kicker") { if (tg > 0 && sc.targetType !== "value") amt = Math.max(0, u - tg) * n(r.rate); }
      else if (r.type === "formula") { vars.payout = pos; try { amt = evalFormula(r.expr, vars); } catch (e) { reasons.push((r.label || "Formula") + ": " + e.message); amt = 0; } }
      else if (r.type === "penalty") {
        var ok = ach != null && ach >= n(r.minAch || 100), vsShort = n(row.vsTarget) > 0 && n(row.vsSold) < n(row.vsTarget);
        var hit = r.when === "vshieldShort" ? vsShort : r.when === "either" ? (!ok || vsShort) : r.when === "both" ? (!ok && vsShort) : !ok;
        if (hit) { var p = r.per === "shortUnit" ? Math.max(0, tg - u) * n(r.amount) : r.per === "vsShortUnit" ? Math.max(0, n(row.vsTarget) - n(row.vsSold)) * n(r.amount) : n(r.amount); parts.push({ id: r.id, label: r.label || "Negative incentive", type: r.type, amount: -p }); neg += p; }
        return;
      } else if (r.type === "multiplier") {
        if (ach != null && ach >= n(r.minAch) && (r.maxAch == null || ach < n(r.maxAch))) factor = Math.max(factor, n(r.factor) || 1);
        return;
      } else return;
      parts.push({ id: r.id, label: r.label || r.type, type: r.type, amount: amt, slab: slabTxt });
      pos += amt;
    });
    if (factor !== 1 && pos > 0) { parts.push({ label: "Multiplier ×" + factor, type: "multiplier", amount: pos * (factor - 1) }); pos *= factor; }
    if (minA > 0 && (ach == null || ach < minA)) {
      if (sc.belowMin === "prorata" && ach != null) { var cut = pos - pos * ach / minA; if (cut) parts.push({ label: "Pro-rata below " + minA + "%", type: "min", amount: -cut }); pos = pos * ach / minA; }
      else { if (pos) parts.push({ label: "Below minimum " + minA + "%", type: "min", amount: -pos }); pos = 0; reasons.push("Achievement below the minimum " + minA + "%"); }
    }
    if (gateMode === "zero" && pos) { parts.push({ label: "Not eligible", type: "gate", amount: -pos }); pos = 0; }
    else if (reduce && pos) { var rc = pos * reduce / 100; parts.push({ label: "Eligibility cut " + reduce + "%", type: "gate", amount: -rc }); pos -= rc; }
    if (n(sc.cap) > 0 && pos > n(sc.cap)) { parts.push({ label: "Capped at maximum", type: "cap", amount: n(sc.cap) - pos }); pos = n(sc.cap); }
    var total = Math.round((pos - neg) * 100) / 100;
    return { rid: row.rid, name: row.name || "", state: row.state || "", target: tg, units: units, value: n(row.value), ach: ach, achieved: achieved, upload: n(row.upload), activation: n(row.activation), vsSold: n(row.vsSold), vsTarget: n(row.vsTarget),
      parts: parts, positive: Math.round(pos * 100) / 100, penalty: Math.round(neg * 100) / 100, total: total, eligible: pos > 0, slab: mainSlab || "", reasons: reasons, dash: d, extra: row.extra || {} };
  }
  function bump(row, k) {
    var r = JSON.parse(JSON.stringify(row));
    ["upload", "activation", "both", "either"].forEach(function (f) { if (r[f] != null) r[f] = n(r[f]) + k; });
    var u0 = Math.max(n(row.upload), n(row.activation), 1); if (n(r.value) > 0) r.value = n(r.value) + k * n(r.value) / u0;
    if (r.models) Object.keys(r.models).forEach(function (b) { var ks = Object.keys(r.models[b]); if (ks.length) r.models[b][ks[0]] = n(r.models[b][ks[0]]) + k; });
    return r;
  }
  // who is closest to the next slab: "Sell 3 more → +₹1,200"
  function nextStep(sc, row, res) {
    var cands = [], u = res.units, tg = res.target, rules = (sc.rules || []).filter(function (r) { return !r.off; });
    if (n(sc.minAch) && tg > 0 && res.ach != null && res.ach < n(sc.minAch)) cands.push(Math.ceil(n(sc.minAch) / 100 * tg - u - 1e-9));
    rules.forEach(function (r) {
      if (r.type === "ach_slab" && tg > 0 && sc.targetType !== "value") (r.slabs || []).forEach(function (z) { var need = Math.ceil(n(z.from) / 100 * tg - u - 1e-9); if (need > 0) cands.push(need); });
      if (r.type === "unit_slab") (r.slabs || []).forEach(function (z) { var need = n(z.from) - unitsFor(row, sc, r); if (need > 0) cands.push(need); });
      if ((r.type === "multiplier" || (r.type === "penalty" && r.when !== "vshieldShort")) && tg > 0 && sc.targetType !== "value") { var nd = Math.ceil(n(r.minAch || 100) / 100 * tg - u - 1e-9); if (nd > 0) cands.push(nd); }
      if (r.type === "flat_unit" && r.when === "achieved" && tg > 0) { var nd2 = Math.ceil(tg - u - 1e-9); if (nd2 > 0) cands.push(nd2); }
    });
    cands = cands.filter(function (x) { return x > 0 && x <= Math.max(50, tg * 2); }).sort(function (a, b) { return a - b; });
    for (var i = 0; i < cands.length; i++) {
      var r2 = computeRow(sc, bump(row, cands[i])), gain = Math.round((r2.total - res.total) * 100) / 100;
      if (gain > 0) return { need: cands[i], gain: gain, newTotal: r2.total, slab: r2.slab };
    }
    return null;
  }
  function compute(sc, rows) {
    var out = rows.map(function (row) { var r = computeRow(sc, row); r.next = nextStep(sc, row, r); return r; });
    var tot = out.reduce(function (a, r) { return a + r.total; }, 0), el = out.filter(function (r) { return r.eligible; });
    var achs = out.filter(function (r) { return r.ach != null; });
    var buckets = [["Below 50%", 0, 50], ["50–80%", 50, 80], ["80–100%", 80, 100], ["100–120%", 100, 120], ["120%+", 120, Infinity]].map(function (b) { return [b[0], achs.filter(function (r) { return r.ach >= b[1] && r.ach < b[2]; }).length]; });
    var bySlab = {}; out.forEach(function (r) { var k = r.slab || "—"; bySlab[k] = bySlab[k] || { count: 0, payout: 0 }; bySlab[k].count++; bySlab[k].payout += r.total; });
    return { rows: out, summary: { total: Math.round(tot * 100) / 100, count: out.length, eligible: el.length, units: out.reduce(function (a, r) { return a + r.units; }, 0), avgAch: achs.length ? achs.reduce(function (a, r) { return a + r.ach; }, 0) / achs.length : null, penalties: out.reduce(function (a, r) { return a + r.penalty; }, 0), buckets: buckets, bySlab: bySlab } };
  }

  // ---- IMEI-level sales → per-retailer units (basis, same-month rule, EMI partner exclusion, models, value, V-Shield) ----
  function parseDate(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && v > 20000 && v < 80000) { var d0 = new Date(Math.round((v - 25569) * 864e5)); return d0.toISOString().slice(0, 10); }
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) { var y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2); }
    if ((m = /^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ,]+(\d{2,4})/.exec(s))) { var mo = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1; if (mo) return (m[3].length === 2 ? "20" + m[3] : m[3]) + "-" + ("0" + mo).slice(-2) + "-" + ("0" + m[1]).slice(-2); }
    var dd = new Date(s); return isNaN(dd) ? null : dd.toISOString().slice(0, 10);
  }
  function fromImei(sc, list) {
    var by = {}, period = sc.period || "", ex = (sc.excludePartners || []).map(lc).filter(Boolean), seen = {};
    var inP = function (d) { return d && (!period || d.slice(0, 7) === period); };
    list.forEach(function (x) {
      var rid = String(x.rid || "").trim().toUpperCase(); if (!rid) return;
      var imei = String(x.imei || "").trim(); if (imei) { if (seen[imei]) return; seen[imei] = 1; }
      var o = by[rid] || (by[rid] = { rid: rid, upload: 0, activation: 0, both: 0, either: 0, value: 0, vsSold: 0, excl: 0, fromImei: true, models: { upload: {}, activation: {}, both: {}, either: {} }, val: { upload: 0, activation: 0, both: 0, either: 0 }, vs: { upload: 0, activation: 0, both: 0, either: 0 } });
      var p = lc(x.partner);
      if (p && ex.some(function (e) { return p.indexOf(e) >= 0; })) { o.excl++; return; }
      var u = inP(parseDate(x.upload)), a = inP(parseDate(x.activation)), m = String(x.model || "Other").trim() || "Other", price = n(x.price), vsh = /^(y|yes|1|true)$/i.test(String(x.vshield || "").trim());
      var flags = { upload: !!u, activation: !!a, both: !!(u && a), either: !!(u || a) };
      Object.keys(flags).forEach(function (k) { if (!flags[k]) return; o[k]++; o.models[k][m] = (o.models[k][m] || 0) + 1; o.val[k] += price; if (vsh) o.vs[k]++; });
    });
    return by;
  }
  function finishImei(sc, o) { o.value = o.val[sc.basis] || 0; o.vsSold = o.vs[sc.basis] || 0; return o; }

  var api = { compute: compute, computeRow: computeRow, fromImei: fromImei, finishImei: finishImei, parseDate: parseDate, baseUnits: baseUnits, evalFormula: evalFormula, VARS: VARS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SCENG = api;
})(typeof window !== "undefined" ? window : globalThis);
