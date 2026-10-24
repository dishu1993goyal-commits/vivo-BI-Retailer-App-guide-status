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
  // ---- models: names in the scheme (V80, X300 Pro …), per-retailer model targets (row.mt) and sold units (row.ms or IMEI models)
  var mkey = function (s) { return lc(s).replace(/[^a-z0-9]/g, ""); };
  function modelNames(sc, extra) { var a = (sc.models || []).map(function (m) { return m.name; }).concat(extra || []); var seen = {}; return a.filter(function (x) { var k = mkey(x); if (!k || seen[k]) return false; seen[k] = 1; return true; }); }
  // which scheme model a sold handset belongs to: the longest model name contained in it ("vivo X300 Pro 5G" → X300 Pro, not X300)
  function bestModel(raw, names) { var rk = mkey(raw), best = null; names.forEach(function (nm) { var k = mkey(nm); if (k && rk.indexOf(k) >= 0 && (!best || k.length > mkey(best).length)) best = nm; }); return best; }
  function pick(map, name) { if (!map) return null; var k = mkey(name); for (var x in map) if (mkey(x) === k) return n(map[x]); return null; }
  function modelSold(row, sc, name, names) {
    var v = pick(row.ms, name); if (v != null) return v;
    var m = row.models && row.models[sc.basis]; if (!m) return 0;
    names = names || modelNames(sc, [name]); if (!names.some(function (x) { return mkey(x) === mkey(name); })) names = names.concat([name]);
    var t = 0; Object.keys(m).forEach(function (raw) { var b = bestModel(raw, names); if (b && mkey(b) === mkey(name)) t += n(m[raw]); }); return t;
  }
  function modelTarget(row, sc, name) { var v = pick(row.mt, name); if (v != null) return v; var d = (sc.models || []).find(function (m) { return mkey(m.name) === mkey(name); }); return d ? n(d.target) : 0; }
  function modelRows(row, sc) { return modelNames(sc).map(function (nm) { var tg = modelTarget(row, sc, nm), sd = modelSold(row, sc, nm); return { name: nm, target: tg, sold: sd, ach: tg > 0 ? sd / tg * 100 : null }; }); }
  function unitsFor(row, sc, rule) {
    if (rule && rule.models && rule.models.length) { var names = modelNames(sc, rule.models); return rule.models.reduce(function (a, nm) { return a + modelSold(row, sc, nm, names); }, 0); }
    return baseUnits(row, sc.basis);
  }
  // targets: volume (units), value (₹), both (must reach both → the lower %), either (the higher %)
  function unitTarget(row, sc) { var t = n(row.target); if (t > 0) return t; return modelNames(sc).reduce(function (a, nm) { return a + modelTarget(row, sc, nm); }, 0); }
  function valueTarget(row, sc) { var t = n(row.targetValue); if (t > 0) return t; return sc.targetType === "value" ? n(row.target) : 0; }
  function achParts(row, sc) {
    var tu = sc.targetType === "value" ? 0 : unitTarget(row, sc), tv = sc.targetType === "units" || !sc.targetType ? 0 : valueTarget(row, sc);
    var ua = tu > 0 ? baseUnits(row, sc.basis) / tu * 100 : null, va = tv > 0 ? n(row.value) / tv * 100 : null;
    var ach = sc.targetType === "value" ? va : sc.targetType === "both" ? (ua != null && va != null ? Math.min(ua, va) : ua != null ? ua : va) : sc.targetType === "either" ? (ua != null && va != null ? Math.max(ua, va) : ua != null ? ua : va) : ua;
    return { ach: ach, ua: ua, va: va, tu: tu, tv: tv };
  }
  function achOf(row, sc) { return achParts(row, sc).ach; }
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
    var AP = achParts(row, sc), units = baseUnits(row, sc.basis), tg = AP.tu, ach = AP.ach, MR = modelRows(row, sc);
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
      if (g.allModels) { var miss = MR.filter(function (m) { return m.target > 0 && m.sold < m.target; }); if (miss.length) fails.push("model target missed: " + miss.map(function (m) { return m.name + " " + m.sold + "/" + m.target; }).join(", ")); }
      if (fails.length) { reasons.push((g.label || "Eligibility") + ": " + fails.join(", ")); if (g.effect === "reduce") reduce = Math.max(reduce, n(g.reducePct)); else gateMode = "zero"; }
    });
    // gifts / product rewards (e.g. 10 units → 1 vivo V80). When "consume" is on, the units used for the gift are not paid in cash.
    var consumed = 0, gifts = [];
    rules.filter(function (r) { return r.type === "reward"; }).forEach(function (r) { var z = slabFor(r.slabs, unitsFor(row, sc, r)); if (z) { gifts.push({ item: z.item || "Gift", qty: n(z.qty) || 1, value: n(z.value), rule: r.label || "" }); if (r.consume) consumed = Math.max(consumed, n(z.from)); } });
    var bandAmt = function (sl, u) { var a = 0; sl.forEach(function (s, i) { var lo = n(s.from), hi = s.to != null ? n(s.to) : (sl[i + 1] ? n(sl[i + 1].from) - 1 : Infinity); a += Math.max(0, Math.min(u, hi) - lo + 1) * n(s.rate); }); return a; };
    var vars = { units: units, target: tg, ach: ach || 0, value: n(row.value), vsSold: n(row.vsSold), vsTarget: n(row.vsTarget), upload: n(row.upload), activation: n(row.activation), both: row.both != null ? n(row.both) : Math.min(n(row.upload), n(row.activation)), appDays: n(d.appDays), features: n(d.features), appVisits: n(d.appVisits), mvisits: n(d.mvisits), active: d.active ? 1 : 0, payout: 0 };
    rules.forEach(function (r) {
      var amt = 0, slabTxt = "", u = unitsFor(row, sc, r), pu = Math.max(0, u - consumed);
      if (r.type === "ach_slab") {
        var z = ach == null ? null : slabFor(r.slabs, ach);
        if (ach == null) reasons.push((r.label || "Achievement slab") + ": no target given");
        if (z) amt = r.pay === "fixed" ? n(z.amount) : n(z.amount) * pu;
        slabTxt = fmtSlab(z, "%"); if (!mainSlab) mainSlab = slabTxt;
      } else if (r.type === "unit_slab") {
        var sl = r.slabs || [];
        if (r.mode === "incremental") {
          amt = bandAmt(sl, u) - bandAmt(sl, Math.min(u, consumed));
          var zz = slabFor(sl, u); slabTxt = fmtSlab(zz, " units");
        } else { var z2 = slabFor(sl, u); if (z2) amt = pu * n(z2.rate); slabTxt = fmtSlab(z2, " units"); }
        if (consumed && amt >= 0) slabTxt += " · cash on " + pu + " unit" + (pu === 1 ? "" : "s");
        if (!mainSlab) mainSlab = slabTxt;
      } else if (r.type === "flat_unit") { if (whenOk(r.when, achieved)) amt = n(r.rate) * pu; }
      else if (r.type === "reward") {
        var gz = slabFor(r.slabs, u);
        if (gz) { var gq = n(gz.qty) || 1; amt = gq * n(gz.value); slabTxt = "≥ " + gz.from + " units"; parts.push({ id: r.id, label: "🎁 " + gq + " × " + (gz.item || "Gift") + (r.consume ? " (" + gz.from + " units)" : ""), type: r.type, amount: amt, slab: slabTxt, gift: true }); pos += amt; }
        return;
      }
      else if (r.type === "value_pct") { if (whenOk(r.when, achieved)) amt = n(r.pct) / 100 * n(row.value); }
      else if (r.type === "kicker") { if (tg > 0 && sc.targetType !== "value") amt = Math.max(0, u - tg) * n(r.rate); }
      else if (r.type === "model_rate") {   // ₹ per unit by model (e.g. V80 ₹1,099, X300 Pro ₹2,000)
        var names = modelNames(sc, (r.rates || []).map(function (x) { return x.model; })), any = false;
        (r.rates || []).forEach(function (x) {
          if (!x.model) return;
          var sold = modelSold(row, sc, x.model, names), mt = modelTarget(row, sc, x.model), pct = n(r.minAch || 100);
          var ok = x.when === "modelAchieved" ? mt > 0 && sold >= mt * pct / 100 : x.when === "achieved" ? achieved : x.when === "notAchieved" ? !achieved : true;
          if (!sold) return;
          var a = ok ? sold * n(x.rate) : 0; any = true;
          parts.push({ id: r.id, label: (r.label ? r.label + " · " : "") + x.model + " × " + sold + (ok ? " @ ₹" + n(x.rate).toLocaleString("en-IN") : " (model target " + sold + "/" + mt + " not met)"), type: r.type, amount: a, slab: "" });
          pos += a;
        });
        if (!any) parts.push({ id: r.id, label: (r.label || "Model rates") + ": none of these models sold", type: r.type, amount: 0 });
        return;
      }
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
    return { gifts: gifts, rid: row.rid, name: row.name || "", state: row.state || "", target: tg, targetValue: AP.tv, unitAch: AP.ua, valueAch: AP.va, models: MR, units: units, value: n(row.value), ach: ach, achieved: achieved, upload: n(row.upload), activation: n(row.activation), vsSold: n(row.vsSold), vsTarget: n(row.vsTarget),
      parts: parts, positive: Math.round(pos * 100) / 100, penalty: Math.round(neg * 100) / 100, total: total, eligible: pos > 0, slab: mainSlab || "", reasons: reasons, dash: d, extra: row.extra || {} };
  }
  function bump(row, k, model) {
    var r = JSON.parse(JSON.stringify(row));
    ["upload", "activation", "both", "either"].forEach(function (f) { if (r[f] != null) r[f] = n(r[f]) + k; });
    var u0 = Math.max(n(row.upload), n(row.activation), 1); if (n(r.value) > 0) r.value = n(r.value) + k * n(r.value) / u0;
    if (r.ms) { var mk = model ? Object.keys(r.ms).find(function (x) { return mkey(x) === mkey(model); }) : Object.keys(r.ms)[0]; if (mk) r.ms[mk] = n(r.ms[mk]) + k; else if (model) r.ms[model] = k; }
    if (r.models) Object.keys(r.models).forEach(function (b) { var ks = Object.keys(r.models[b]); var key = model ? ks.find(function (x) { return mkey(x).indexOf(mkey(model)) >= 0; }) || model : ks[0]; if (key) r.models[b][key] = n(r.models[b][key]) + k; });
    return r;
  }
  // who is closest to the next slab: "Sell 3 more → +₹1,200"
  function nextStep(sc, row, res) {
    var cands = [], u = res.units, tg = res.target, rules = (sc.rules || []).filter(function (r) { return !r.off; });
    if (n(sc.minAch) && tg > 0 && res.ach != null && res.ach < n(sc.minAch)) cands.push(Math.ceil(n(sc.minAch) / 100 * tg - u - 1e-9));
    rules.forEach(function (r) {
      if (r.type === "ach_slab" && tg > 0 && sc.targetType !== "value") (r.slabs || []).forEach(function (z) { var need = Math.ceil(n(z.from) / 100 * tg - u - 1e-9); if (need > 0) cands.push(need); });
      if (r.type === "unit_slab" || r.type === "reward") (r.slabs || []).forEach(function (z) { var need = n(z.from) - unitsFor(row, sc, r); if (need > 0) cands.push(need); });
      if ((r.type === "multiplier" || (r.type === "penalty" && r.when !== "vshieldShort")) && tg > 0 && sc.targetType !== "value") { var nd = Math.ceil(n(r.minAch || 100) / 100 * tg - u - 1e-9); if (nd > 0) cands.push(nd); }
      if (r.type === "flat_unit" && r.when === "achieved" && tg > 0) { var nd2 = Math.ceil(tg - u - 1e-9); if (nd2 > 0) cands.push(nd2); }
    });
    // model targets: "Sell 2 more V80"
    var mc = [];
    rules.forEach(function (r) {
      if (r.type === "model_rate") (r.rates || []).forEach(function (x) { if (x.when !== "modelAchieved") return; var mt = modelTarget(row, sc, x.model), sd = modelSold(row, sc, x.model); var need = Math.ceil(mt * n(r.minAch || 100) / 100 - sd - 1e-9); if (mt > 0 && need > 0) mc.push([need, x.model]); });
      if (r.type === "gate" && r.allModels) (res.models || []).forEach(function (m) { if (m.target > 0 && m.sold < m.target) mc.push([m.target - m.sold, m.name]); });
    });
    var all = cands.filter(function (x) { return x > 0 && x <= Math.max(50, tg * 2); }).map(function (x) { return [x, null]; }).concat(mc.filter(function (x) { return x[0] <= 200; }));
    all.sort(function (a, b) { return a[0] - b[0]; });
    for (var i = 0; i < all.length; i++) {
      var r2 = computeRow(sc, bump(row, all[i][0], all[i][1])), gain = Math.round((r2.total - res.total) * 100) / 100;
      if (gain > 0) return { need: all[i][0], model: all[i][1] || "", gain: gain, newTotal: r2.total, slab: r2.slab };
    }
    return null;
  }
  function compute(sc, rows) {
    var out = rows.map(function (row) { var r = computeRow(sc, row); r.next = nextStep(sc, row, r); return r; });
    var tot = out.reduce(function (a, r) { return a + r.total; }, 0), el = out.filter(function (r) { return r.eligible; });
    var achs = out.filter(function (r) { return r.ach != null; });
    var buckets = [["Below 50%", 0, 50], ["50–80%", 50, 80], ["80–100%", 80, 100], ["100–120%", 100, 120], ["120%+", 120, Infinity]].map(function (b) { return [b[0], achs.filter(function (r) { return r.ach >= b[1] && r.ach < b[2]; }).length]; });
    var gifts = {}; out.forEach(function (r) { (r.gifts || []).forEach(function (g) { gifts[g.item] = (gifts[g.item] || 0) + g.qty; }); });
    var bySlab = {}; out.forEach(function (r) { var k = r.slab || "—"; bySlab[k] = bySlab[k] || { count: 0, payout: 0 }; bySlab[k].count++; bySlab[k].payout += r.total; });
    return { rows: out, summary: { total: Math.round(tot * 100) / 100, count: out.length, eligible: el.length, units: out.reduce(function (a, r) { return a + r.units; }, 0), avgAch: achs.length ? achs.reduce(function (a, r) { return a + r.ach; }, 0) / achs.length : null, penalties: out.reduce(function (a, r) { return a + r.penalty; }, 0), buckets: buckets, bySlab: bySlab, gifts: gifts } };
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
    var df = sc.dateFrom || "", dto = sc.dateTo || "";
    var inP = function (d) { return d && (df || dto ? (!df || d >= df) && (!dto || d <= dto) : (!period || d.slice(0, 7) === period)); };
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

  var api = { modelNames: modelNames, bestModel: bestModel, compute: compute, computeRow: computeRow, fromImei: fromImei, finishImei: finishImei, parseDate: parseDate, baseUnits: baseUnits, evalFormula: evalFormula, VARS: VARS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SCENG = api;
})(typeof window !== "undefined" ? window : globalThis);
