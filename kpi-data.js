// Shared by the report builder and leaderboard pages: loads the dashboard's own data and KPI engine from index.html,
// so reports show exactly the same numbers as the dashboard.
window.KPIDATA = (function () {
  var P = null;
  function load() {
    if (P) return P;
    P = fetch("/index.html", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("Couldn't load dashboard data (" + r.status + ")"); return r.text(); }).then(function (html) {
      var tag = '<script type="application/json" id="dd">', a = html.indexOf(tag), b = html.indexOf("</script>", a);
      var e0 = html.indexOf('<script id="s-eng">'), e1 = html.indexOf("</script>", e0);
      if (a < 0 || e0 < 0) throw new Error("Dashboard data not found");
      var D = JSON.parse(html.slice(a + tag.length, b));
      var KE = new Function("var module; " + html.slice(e0 + '<script id="s-eng">'.length, e1) + "; return KE;")();
      var RAW = D.rawlog[0], SETUP = D.setup[0];
      var codes = (SETUP.states || []).map(function (s) { return { code: String(s.code || ""), state: s.state }; }).filter(function (x) { return x.code; }).sort(function (x, y) { return y.code.length - x.code.length; });
      return { KE: KE, RAW: RAW, SETUP: SETUP, states: (SETUP.states || []).map(function (s) { return s.state; }), span: KE.span(RAW),
        stateOfRid: function (rid) { var r = String(rid || "").toUpperCase(); for (var i = 0; i < codes.length; i++) if (r.indexOf(codes[i].code) === 0) return codes[i].state; return ""; },
        months: function () { var set = {}; RAW.days.forEach(function (d) { set[d.slice(0, 7)] = 1; }); return Object.keys(set).sort(); } };
    });
    P.catch(function () { P = null; });
    return P;
  }
  return { load: load };
})();
