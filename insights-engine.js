// Performance insights engine — shared by the server (cached snapshot) and the pages.
// Works from the dashboard's own data + KPI engine (KE), so numbers match the dashboard.
(function (root) {
  "use strict";
  var KPIS = [["app", "Retailer App"], ["sales", "Sales"], ["visit", "Visit efficiency"], ["comp", "Competition / SD"], ["vnotice", "v-Notice"], ["new", "New implementation"]];
  var KN = {}; KPIS.forEach(function (k) { KN[k[0]] = k[1]; });
  var PTS = { app: "pts_app", sales: "pts_sales", visit: "pts_visit", comp: "pts_comp", vnotice: "pts_vn", new: "pts_new" };
  var r1 = function (v) { return v == null || isNaN(v) ? null : Math.round(v * 10) / 10; };
  var r4 = function (v) { return v == null || isNaN(v) ? null : Math.round(v * 10000) / 10000; };
  function addDays(d, n) { var x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function lastDay(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); return m + "-" + String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0"); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dl(d) { return +d.slice(8, 10) + " " + MON[+d.slice(5, 7) - 1]; }
  function rowsOf(KE, RAW, SETUP, f, t) {
    var sp = KE.scorePeriod(RAW, SETUP, f, t, "Total"), out = {}, pan = null;
    (sp.kpi_state || []).forEach(function (r) {
      var o = { rank: r.rank, score: r1(r.score), onb: r.onb || 0, w: {} };
      KPIS.forEach(function (k) { o[k[0]] = r4(r[k[0]]); var p = r[PTS[k[0]]], a = r[k[0]]; if (a && p != null) o.w[k[0]] = r1(p / a); });
      if (r.code === "PAN" || r.state === "Total") pan = o; else if (r.state) out[r.state] = o;
    });
    var elig = {}; (sp.kpi_counts || []).forEach(function (c) { elig[c.state] = (elig[c.state] || 0) + (c.elig || 0); });
    Object.keys(out).forEach(function (s) { out[s].elig = elig[s] || 0; });
    return { rows: out, pan: pan || {} };
  }
  // ---------- snapshot ----------
  function snapshot(D, opts) {
    opts = opts || {};
    var KE = D.KE, RAW = D.RAW, SETUP = D.SETUP, span = KE.span(RAW);
    if (!span) throw new Error("no data in the dashboard");
    var appRows = KE.rows(RAW, "app") || [], asOf = "";
    appRows.forEach(function (r) { if (r[2] > asOf) asOf = r[2]; });
    if (!asOf || asOf > span.t) asOf = span.t;
    var states = (SETUP.states || []).map(function (s) { return s.state; });
    var ms = {}; RAW.days.forEach(function (d) { if (d <= asOf) ms[d.slice(0, 7)] = 1; });
    var months = Object.keys(ms).sort().slice(-12).map(function (m) {
      var f = m + "-01", t = lastDay(m) < asOf ? lastDay(m) : asOf, x = rowsOf(KE, RAW, SETUP, f < span.f ? span.f : f, t);
      var lab = m; try { lab = KE.monthLabel ? KE.monthLabel(m) : m; } catch (e) { }
      return { m: m, label: lab, f: f, t: t, partial: t < lastDay(m), rows: x.rows, pan: x.pan };
    });
    // weeks (Monday–Sunday), last 10
    var weeks = [], d0 = addDays(asOf, -((new Date(asOf + "T00:00:00Z").getUTCDay() + 6) % 7));
    for (var i = 0; i < 10; i++) {
      var f = addDays(d0, -7 * i), t = addDays(f, 6); if (t > asOf) t = asOf; if (t < span.f) break; var ff = f < span.f ? span.f : f;
      var x = rowsOf(KE, RAW, SETUP, ff, t); weeks.unshift({ w: f, f: ff, t: t, label: dl(ff) + "–" + dl(t), rows: x.rows, pan: x.pan });
    }
    // retailer health segments from retailer-app activity
    var codes = (SETUP.states || []).map(function (s) { return { code: String(s.code || "").toUpperCase(), state: s.state }; }).filter(function (x) { return x.code; }).sort(function (a, b) { return b.code.length - a.code.length; });
    var stOf = function (rid) { var u = String(rid || "").toUpperCase(); for (var j = 0; j < codes.length; j++) if (u.indexOf(codes[j].code) === 0) return codes[j].state; return ""; };
    var a30 = addDays(asOf, -29), a60 = addDays(asOf, -59), per = {}, feat = {};
    appRows.forEach(function (r) {
      var id = String(r[0]).toUpperCase(), p = per[id] || (per[id] = { d30: {}, dp: {}, last: "", n: 0, first: r[2] });
      if (r[2] > asOf) return;
      if (r[2] >= a30) p.d30[r[2]] = 1; else if (r[2] >= a60) p.dp[r[2]] = 1;
      if (r[2] > p.last) p.last = r[2]; if (r[2] < p.first) p.first = r[2]; p.n += +r[3] || 1;
      var fk = id + "|" + r[1]; feat[fk] = (feat[fk] || 0) + (+r[3] || 1);
    });
    var top = {}; Object.keys(feat).forEach(function (k) { var i = k.indexOf("|"), id = k.slice(0, i); if (!top[id] || feat[k] > feat[top[id]]) top[id] = k; });
    var rids = String(SETUP.rids || "").split(",").map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
    var seen = {}, dupRids = [], universe = {};
    rids.forEach(function (id) { if (seen[id]) dupRids.push(id); seen[id] = 1; universe[id] = 1; });
    Object.keys(per).forEach(function (id) { universe[id] = 1; });
    var seg = {}, lists = {};
    Object.keys(universe).forEach(function (id) {
      var st = stOf(id) || "Unmapped", p = per[id], d30 = p ? Object.keys(p.d30).length : 0, dp = p ? Object.keys(p.dp).length : 0, s;
      if (!p) s = "never"; else if (dp >= 2 && d30 <= Math.floor(dp / 2)) s = "atrisk"; else if (d30 >= 8) s = "champion"; else if (d30 >= 1) s = "active"; else s = "dormant";
      var c = seg[st] || (seg[st] = { champion: 0, active: 0, atrisk: 0, dormant: 0, never: 0, total: 0, onboarded: 0 }); c[s]++; c.total++; if (seen[id]) c.onboarded++;
      if (opts.lists) (lists[st] = lists[st] || []).push([id, s, d30, dp, p ? p.last : "", p ? p.n : 0, top[id] ? top[id].slice(top[id].indexOf("|") + 1) : "", seen[id] ? 1 : 0]);
    });
    // data quality
    var qc = [], allDays = {}, stDays = {}, stDaily = {};
    appRows.forEach(function (r) { if (r[2] > asOf) return; allDays[r[2]] = 1; var st = stOf(r[0]); if (!st) return; (stDays[st] = stDays[st] || {})[r[2]] = 1; var k = st + "|" + r[2]; stDaily[k] = (stDaily[k] || 0) + (+r[3] || 1); });
    var dayList = Object.keys(allDays).sort();
    states.forEach(function (st) {
      var have = stDays[st] || {}, miss = dayList.filter(function (d) { return !have[d]; });
      if (!Object.keys(have).length) qc.push({ sev: "high", type: "No data", state: st, detail: "No retailer-app activity at all in the data — check the state code or the import." });
      else if (miss.length) qc.push({ sev: miss.length > 3 ? "high" : "med", type: "Missing days", state: st, detail: miss.length + " day(s) with no app activity while other states have data: " + ranges(miss) });
      var vals = dayList.map(function (d) { return stDaily[st + "|" + d] || 0; }).filter(function (v) { return v > 0; });
      if (vals.length >= 7) { var mu = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length, sd = Math.sqrt(vals.reduce(function (a, b) { return a + (b - mu) * (b - mu); }, 0) / vals.length) || 1;
        var spikes = dayList.filter(function (d) { var v = stDaily[st + "|" + d] || 0; return v > 0 && (v - mu) / sd > 3.2 && v > mu * 2.5; });
        if (spikes.length) qc.push({ sev: "med", type: "Unusual spike", state: st, detail: "App activity far above normal on " + spikes.slice(0, 5).map(dl).join(", ") + " (usual ≈ " + Math.round(mu) + "/day) — check for duplicate uploads." }); }
    });
    if (dupRids.length) qc.push({ sev: "med", type: "Duplicate retailer IDs", state: "", detail: dupRids.length + " retailer ID(s) appear twice in the active list, e.g. " + dupRids.slice(0, 5).join(", ") });
    var unm = Object.keys(per).filter(function (id) { return !stOf(id); });
    if (unm.length) qc.push({ sev: "med", type: "Unmapped retailers", state: "", detail: unm.length + " retailer ID(s) in the app logs don't match any state code, e.g. " + unm.slice(0, 5).join(", ") });
    var notOnb = Object.keys(per).filter(function (id) { return !seen[id] && stOf(id); });
    if (rids.length && notOnb.length) qc.push({ sev: "low", type: "Active but not in the active-retailer list", state: "", detail: notOnb.length + " retailer(s) used the app but are not in the active retailer IDs, e.g. " + notOnb.slice(0, 5).join(", ") });
    months.forEach(function (mo, i) { if (i === 0) return; var prev = months[i - 1]; states.forEach(function (st) { var a = mo.rows[st], b = prev.rows[st]; if (a && b && b.score > 20 && a.score != null && a.score < b.score * 0.4 && !mo.partial) qc.push({ sev: "med", type: "Sharp drop", state: st, detail: "Score fell from " + b.score + " (" + prev.label + ") to " + a.score + " (" + mo.label + ") — check the month's data." }); }); });
    var snap = { v: 1, asOf: asOf, span: span, states: states, kpis: KPIS, months: months, weeks: weeks, seg: seg, qc: qc, retailers: Object.keys(universe).length };
    if (opts.lists) snap.lists = lists;
    return snap;
  }
  function ranges(days) { var out = [], s = null, p = null; days.forEach(function (d) { if (s && addDays(p, 1) === d) { p = d; return; } if (s) out.push(s === p ? dl(s) : dl(s) + "–" + dl(p)); s = p = d; }); if (s) out.push(s === p ? dl(s) : dl(s) + "–" + dl(p)); return out.slice(0, 6).join(", ") + (out.length > 6 ? "…" : ""); }
  // ---------- alerts ----------
  var DEF_RULES = { rankDrop: 3, belowPan: 2, scoreDrop: 5, kpiBelow: 50, dormantPct: 40, atriskPct: 15 };
  function alerts(S, rules, goals) {
    rules = Object.assign({}, DEF_RULES, rules || {});
    var out = [], add = function (st, sev, type, title, detail, per) { out.push({ id: (type + "|" + st + "|" + per).replace(/\s+/g, "_"), state: st, sev: sev, type: type, title: title, detail: detail, period: per }); };
    var M = S.months, W = S.weeks;
    var pairs = [];
    if (M.length >= 2) pairs.push([M[M.length - 2], M[M.length - 1], "month"]);
    if (W.length >= 2) pairs.push([W[W.length - 2], W[W.length - 1], "week"]);
    pairs.forEach(function (pr) {
      var a = pr[0], b = pr[1], lab = pr[2] === "month" ? b.label : "week " + b.label;
      S.states.forEach(function (st) {
        var x = a.rows[st], y = b.rows[st]; if (!x || !y) return;
        if (x.rank && y.rank && y.rank - x.rank >= rules.rankDrop) add(st, y.rank - x.rank >= rules.rankDrop * 2 ? "high" : "med", "Rank drop", st + " fell " + (y.rank - x.rank) + " places", "Rank #" + x.rank + " → #" + y.rank + " (" + lab + ")", pr[2] + ":" + (b.m || b.w));
        if (x.score != null && y.score != null && x.score - y.score >= rules.scoreDrop) add(st, "med", "Score drop", st + "'s score dropped " + r1(x.score - y.score) + " points", x.score + " → " + y.score + " (" + lab + ")", pr[2] + ":" + (b.m || b.w));
      });
    });
    // KPI below PAN for N periods in a row (months if enough, else weeks)
    var seq = M.length >= rules.belowPan ? M : W, unit = seq === M ? "months" : "weeks";
    if (seq.length >= rules.belowPan) {
      var last = seq.slice(-rules.belowPan);
      S.states.forEach(function (st) { KPIS.forEach(function (k) {
        if (k[0] === "new") return;
        if (last.every(function (p) { var r = p.rows[st]; return r && r[k[0]] != null && p.pan[k[0]] != null && r[k[0]] < p.pan[k[0]] - 0.0001; })) {
          var p = last[last.length - 1], r = p.rows[st]; add(st, "low", "Below PAN", st + ": " + k[1] + " below PAN India " + rules.belowPan + " " + unit + " in a row", Math.round(r[k[0]] * 1000) / 10 + "% vs PAN " + Math.round(p.pan[k[0]] * 1000) / 10 + "% (" + (p.label) + ")", unit + ":" + k[0] + ":" + (p.m || p.w));
        }
      }); });
    }
    var cur = M[M.length - 1];
    if (cur) S.states.forEach(function (st) { var r = cur.rows[st]; if (!r) return; KPIS.forEach(function (k) { if (k[0] === "new" || r[k[0]] == null) return; if (r[k[0]] * 100 < rules.kpiBelow / 2) add(st, "high", "Very low KPI", st + ": " + k[1] + " only " + Math.round(r[k[0]] * 1000) / 10 + "%", "Below half of the " + rules.kpiBelow + "% watch level (" + cur.label + ")", "kpi:" + k[0] + ":" + cur.m); }); });
    Object.keys(S.seg || {}).forEach(function (st) { var c = S.seg[st]; if (!c.total || st === "Unmapped") return; var dp = (c.dormant + c.never) / c.total * 100, ap = c.atrisk / c.total * 100;
      if (dp >= rules.dormantPct) add(st, "low", "Dormant retailers", st + ": " + Math.round(dp) + "% of retailers dormant", (c.dormant + c.never) + " of " + c.total + " retailers had no app activity in the last 30 days", "seg:dormant:" + S.asOf.slice(0, 7));
      if (ap >= rules.atriskPct) add(st, "med", "Retailers at risk", st + ": " + c.atrisk + " retailers slipping away", Math.round(ap) + "% used the app far less this month than last month", "seg:atrisk:" + S.asOf.slice(0, 7)); });
    (goals || []).forEach(function (g) { var pr = goalProgress(S, g); if (pr && pr.status === "behind") add(g.state, "med", "Goal off track", g.state + " is behind its goal", "Target " + (g.targetRank ? "rank #" + g.targetRank : "score " + g.targetScore) + " by " + g.by + " — now " + pr.nowLabel + ", needs " + pr.needWeekly + " points a week", "goal:" + g.state + ":" + S.asOf); });
    var o = { high: 0, med: 1, low: 2 }; out.sort(function (a, b) { return o[a.sev] - o[b.sev]; });
    return out;
  }
  // ---------- goals ----------
  function weeksBetween(a, b) { return Math.max(0.5, (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / (7 * 864e5)); }
  function goalProgress(S, g) {
    var cur = S.months[S.months.length - 1]; if (!cur) return null;
    var r = cur.rows[g.state]; if (!r) return null;
    var target = g.targetScore;
    if (g.targetRank) { var ord = Object.keys(cur.rows).map(function (s) { return cur.rows[s].score; }).filter(function (v) { return v != null; }).sort(function (a, b) { return b - a; }); target = (ord[Math.max(0, g.targetRank - 1)] || 0) + (r.rank <= g.targetRank ? 0 : 0.1); if (r.rank <= g.targetRank) target = Math.max(target, r.score); }
    target = r1(target);
    var left = weeksBetween(S.asOf, g.by), gap = r1(target - r.score), needWeekly = gap > 0 ? r1(gap / left) : 0;
    // weekly path since the goal was set
    var since = (g.at ? new Date(g.at).toISOString().slice(0, 10) : S.weeks[0] && S.weeks[0].f) || "";
    var path = S.weeks.filter(function (w) { return w.t >= since; }).map(function (w) { var x = w.rows[g.state]; return { label: w.label, score: x ? x.score : null, rank: x ? x.rank : null }; });
    var base = g.base && g.base.score != null ? g.base.score : (path[0] && path[0].score) || r.score;
    var total = weeksBetween(since || S.asOf, g.by), done = weeksBetween(since || S.asOf, S.asOf), planNow = base + (target - base) * Math.min(1, done / total);
    var status = gap <= 0 ? "achieved" : r.score >= planNow - 1 ? "ontrack" : "behind";
    if (status === "behind" && g.base && g.base.score === r.score && g.base.rank === r.rank) status = "ontrack";   // no new data since the goal was set
    // per-KPI weekly improvement needed: split the gap by headroom × weight
    var kp = [], head = 0;
    KPIS.forEach(function (k) { var a = r[k[0]], w = r.w[k[0]] || (cur.pan.w && cur.pan.w[k[0]]) || 0; if (a == null || !w) return; var h = Math.max(0, 1 - a) * w; head += h; kp.push({ k: k[0], name: k[1], now: a, w: w, h: h }); });
    kp.forEach(function (x) { var share = head ? x.h / head : 0, needPts = Math.max(0, gap) * share; x.needAch = Math.min(1, x.now + needPts / x.w); x.weeklyPp = r1((x.needAch - x.now) * 100 / left); });
    return { target: target, now: r.score, rank: r.rank, gap: gap, weeksLeft: r1(left), needWeekly: needWeekly, status: status, planNow: r1(planNow), path: path, kpis: kp, nowLabel: "#" + r.rank + " · " + r.score };
  }
  // ---------- badges & hall of fame ----------
  function badges(S) {
    var out = [];
    S.months.forEach(function (mo, i) {
      var rows = mo.rows, sts = Object.keys(rows).filter(function (s) { return rows[s].score != null; }), n = sts.length, prev = i ? S.months[i - 1].rows : null, list = [];
      var champ = sts.filter(function (s) { return rows[s].rank === 1; })[0]; if (champ) list.push({ b: "🏆", name: "Champion", state: champ, why: "Rank #1 with score " + rows[champ].score });
      if (prev) {
        var gains = sts.filter(function (s) { return prev[s] && prev[s].rank; }).map(function (s) { return { s: s, g: prev[s].rank - rows[s].rank, sg: (rows[s].score || 0) - (prev[s].score || 0) }; });
        var rs = gains.slice().sort(function (a, b) { return b.g - a.g || b.sg - a.sg; })[0]; if (rs && rs.g >= 2) list.push({ b: "🚀", name: "Rising Star", state: rs.s, why: "Up " + rs.g + " places to #" + rows[rs.s].rank });
        var mi = gains.slice().sort(function (a, b) { return b.sg - a.sg; })[0]; if (mi && mi.sg > 0.5 && (!rs || mi.s !== rs.s || rs.g < 2)) list.push({ b: "📈", name: "Most Improved", state: mi.s, why: "Score up " + r1(mi.sg) + " points" });
        gains.forEach(function (x) { if (prev[x.s].rank > n * 2 / 3 && rows[x.s].rank <= n / 2) list.push({ b: "🔄", name: "Comeback", state: x.s, why: "From #" + prev[x.s].rank + " to #" + rows[x.s].rank }); });
      }
      KPIS.forEach(function (k) { if (k[0] === "new") return; var best = sts.filter(function (s) { return rows[s][k[0]] != null; }).sort(function (a, b) { return rows[b][k[0]] - rows[a][k[0]]; }); if (best.length > 1 && rows[best[0]][k[0]] > rows[best[1]][k[0]]) list.push({ b: "⭐", name: k[1] + " Champion", state: best[0], why: Math.round(rows[best[0]][k[0]] * 1000) / 10 + "% — best in India" }); });
      if (i >= 2) sts.forEach(function (s) { if ([0, 1, 2].every(function (j) { var r = S.months[i - j].rows[s]; return r && r.rank <= 5; })) list.push({ b: "🧱", name: "Consistent Top 5", state: s, why: "Top 5 for 3 months in a row" }); });
      out.push({ m: mo.m, label: mo.label, partial: mo.partial, list: list });
    });
    var streaks = [];
    S.states.forEach(function (s) { var n = 0, best = 0; for (var i = 1; i < S.weeks.length; i++) { var a = S.weeks[i - 1].rows[s], b = S.weeks[i].rows[s]; if (a && b && b.score > a.score) { n++; best = n; } else n = 0; } if (n >= 3) streaks.push({ b: "🔥", name: n + "-week streak", state: s, why: "Score improved " + n + " weeks in a row" }); });
    var tally = {}; out.forEach(function (m) { m.list.forEach(function (x) { var t = tally[x.state] || (tally[x.state] = { state: x.state, n: 0, gold: 0 }); t.n++; if (x.name === "Champion") t.gold++; }); });
    return { months: out, streaks: streaks, fame: Object.keys(tally).map(function (k) { return tally[k]; }).sort(function (a, b) { return b.gold - a.gold || b.n - a.n; }) };
  }
  // ---------- peers ----------
  function peers(S, st) {
    var cur = S.months[S.months.length - 1]; if (!cur) return null;
    var sts = Object.keys(cur.rows).filter(function (s) { return cur.rows[s].score != null; }).sort(function (a, b) { return (cur.rows[a].onb || 0) - (cur.rows[b].onb || 0); });
    var n = sts.length, band = function (s) { var i = sts.indexOf(s); return i < n / 3 ? "Small" : i < 2 * n / 3 ? "Medium" : "Large"; };
    var groups = { Small: [], Medium: [], Large: [] }; sts.forEach(function (s) { groups[band(s)].push(s); });
    if (!st) return { groups: groups, band: band, cur: cur };
    var g = groups[band(st)], med = function (arr) { arr = arr.filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; }); if (!arr.length) return null; var m = Math.floor(arr.length / 2); return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2; };
    var keys = [["score", "Score"]].concat(KPIS.filter(function (k) { return k[0] !== "new"; }));
    var rowsK = keys.map(function (k) { var vals = g.map(function (s) { return cur.rows[s][k[0]]; }), bestS = g.slice().sort(function (a, b) { return (cur.rows[b][k[0]] || 0) - (cur.rows[a][k[0]] || 0); })[0]; return { k: k[0], name: k[1], me: cur.rows[st][k[0]], median: med(vals), best: cur.rows[bestS][k[0]], bestState: bestS, pan: cur.pan[k[0]] }; });
    var ord = g.slice().sort(function (a, b) { return cur.rows[b].score - cur.rows[a].score; });
    return { band: band(st), group: g, rankInGroup: ord.indexOf(st) + 1, rows: rowsK, cur: cur, order: ord };
  }
  // ---------- impact ----------
  function corr(xs, ys) { var n = xs.length; if (n < 3) return null; var mx = xs.reduce(function (a, b) { return a + b; }, 0) / n, my = ys.reduce(function (a, b) { return a + b; }, 0) / n, sxy = 0, sxx = 0, syy = 0; for (var i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null; }
  function impact(S, xk, yk, period) {
    var p = period != null ? S.months[period] : S.months[S.months.length - 1]; if (!p) return null;
    var pts = Object.keys(p.rows).map(function (s) { var r = p.rows[s]; return r[xk] != null && r[yk] != null ? { s: s, x: r[xk], y: r[yk] } : null; }).filter(Boolean);
    var r = corr(pts.map(function (q) { return q.x; }), pts.map(function (q) { return q.y; }));
    var per = S.states.map(function (s) { var xs = [], ys = []; S.weeks.forEach(function (w) { var q = w.rows[s]; if (q && q[xk] != null && q[yk] != null) { xs.push(q[xk]); ys.push(q[yk]); } }); return { s: s, r: corr(xs, ys), n: xs.length }; }).filter(function (q) { return q.r != null; });
    return { pts: pts, r: r, per: per, label: p.label };
  }
  function words(r) { if (r == null) return "not enough data"; var a = Math.abs(r); return (a >= 0.7 ? "strong" : a >= 0.4 ? "moderate" : a >= 0.2 ? "weak" : "no clear") + (a >= 0.2 ? (r > 0 ? " positive" : " negative") : "") + " link"; }
  // the KPI to focus on: lowest one under the target, else the smallest lead over PAN India
  function focusKpi(r, pan, target) { target = (target || 80) / 100; var ks = KPIS.filter(function (k) { return k[0] !== "new" && r[k[0]] != null; }); var low = ks.filter(function (k) { return r[k[0]] < target; }).sort(function (a, b) { return r[a[0]] - r[b[0]]; }); if (low.length) return low; return ks.sort(function (a, b) { return (r[a[0]] - ((pan || {})[a[0]] || 0)) - (r[b[0]] - ((pan || {})[b[0]] || 0)); }); }
  var API = { focusKpi: focusKpi, KPIS: KPIS, KN: KN, DEF_RULES: DEF_RULES, snapshot: snapshot, alerts: alerts, goalProgress: goalProgress, badges: badges, peers: peers, impact: impact, corr: corr, words: words, r1: r1 };
  root.INSENG = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
