/* IMEI / model-wise report behind a payout line (Retailer payouts + Retailer portal).
   PAYITEMS.show(items, line, { sheet, esc, download, xlsx })
   items: [[imei, model, qty, date, value, eligible 1|0, payout per unit, payout amount, remark]] */
(function () {
  "use strict";
  var rs = function (n) { n = Number(n) || 0; return "₹" + Math.round(n).toLocaleString("en-IN"); };
  function summary(items) {
    var M = {}; items.forEach(function (it) { var k = it[1] || "—", m = M[k] || (M[k] = { model: k, qty: 0, eligible: 0, imeis: 0, value: 0, payout: 0 }); m.qty += it[2] || 0; if (it[5]) m.eligible += it[2] || 0; if (it[0]) m.imeis++; m.value += it[4] || 0; m.payout += it[7] || (it[5] ? (it[6] || 0) * (it[2] || 0) : 0); });
    return Object.keys(M).map(function (k) { return M[k]; }).sort(function (a, b) { return b.qty - a.qty; });
  }
  function excel(items, line, o) {
    var S = summary(items), base = (line.rid || "") + "_" + String(line.scheme || "scheme").replace(/\W+/g, "_").slice(0, 30) + "_" + (line.month || "");
    o.download(o.xlsx([
      { name: "Summary", rows: [["Retailer", (line.name || "") + " (" + (line.rid || "") + ")"], ["Scheme", line.scheme || ""], ["Month", line.month || ""], ["Net payout", line.net || 0], [], ["Model", "Qty", "Eligible qty", "IMEIs", "Sale value", "Payout"]].concat(S.map(function (m) { return [m.model, m.qty, m.eligible, m.imeis, Math.round(m.value), Math.round(m.payout)]; })).concat([["Total", S.reduce(function (a, m) { return a + m.qty; }, 0), S.reduce(function (a, m) { return a + m.eligible; }, 0), S.reduce(function (a, m) { return a + m.imeis; }, 0), Math.round(S.reduce(function (a, m) { return a + m.value; }, 0)), Math.round(S.reduce(function (a, m) { return a + m.payout; }, 0))]]) },
      { name: "IMEI list", rows: [["IMEI", "Model", "Qty", "Date", "Sale value", "Eligible", "Payout per unit", "Payout", "Remark"]].concat(items.map(function (it) { return [it[0], it[1], it[2], it[3], it[4] || "", it[5] ? "Yes" : "No", it[6] || "", it[7] || "", it[8] || ""]; })) }
    ]), "IMEI_report_" + base + ".xlsx");
  }
  function show(items, line, o) {
    var esc = o.esc, S = summary(items), q = S.reduce(function (a, m) { return a + m.qty; }, 0), el = S.reduce(function (a, m) { return a + m.eligible; }, 0), pay = S.reduce(function (a, m) { return a + m.payout; }, 0), hasImei = items.some(function (it) { return it[0]; });
    var ov = o.sheet("📄 " + (line.scheme || "Scheme") + " — IMEI / model report", (line.name ? line.name + " · " : "") + (line.month || "") + " · " + q + " units (" + el + " eligible)" + (pay ? " · " + rs(pay) : ""), [["⬇", "Download Excel", function () { excel(items, line, o); }, "pri"]],
      '<div style="font-weight:800;font-size:13px;margin-top:10px">Model-wise</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:4px"><tr style="background:#F3F4FA;color:#6B7090;font-size:11px"><th style="text-align:left;padding:6px">Model</th><th style="text-align:right;padding:6px">Qty</th><th style="text-align:right;padding:6px">Eligible</th><th style="text-align:right;padding:6px">Payout</th></tr>' + S.map(function (m) { return '<tr style="border-top:1px solid #EEF0F6"><td style="padding:6px"><b>' + esc(m.model) + '</b></td><td style="text-align:right;padding:6px">' + m.qty + '</td><td style="text-align:right;padding:6px">' + m.eligible + '</td><td style="text-align:right;padding:6px">' + (m.payout ? rs(m.payout) : "—") + "</td></tr>"; }).join("") + "</table></div>" +
      (hasImei ? '<div style="font-weight:800;font-size:13px;margin-top:12px">IMEI list (' + items.filter(function (it) { return it[0]; }).length + ')</div><input class="tx" id="pif" placeholder="🔍 Find an IMEI or model" style="margin-top:4px"><div id="pil" style="max-height:44vh;overflow:auto;margin-top:4px"></div>' : "") +
      '<div style="font-size:11.5px;color:#8A8FA8;margin-top:8px">This is the list the payout was worked out on. Check it against your own sales; raise a query if anything is missing.</div>');
    var list = ov.querySelector("#pil");
    var draw = function (f) { f = String(f || "").toLowerCase(); var L = items.filter(function (it) { return it[0] && (!f || (it[0] + " " + it[1]).toLowerCase().indexOf(f) >= 0); }); list.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px">' + L.slice(0, 400).map(function (it) { return '<tr style="border-top:1px solid #EEF0F6"><td style="padding:5px;font-family:ui-monospace,Menlo,monospace">' + esc(it[0]) + '</td><td style="padding:5px">' + esc(it[1]) + '</td><td style="padding:5px;color:#8A8FA8">' + esc(it[3] || "") + '</td><td style="padding:5px;text-align:right">' + (it[5] ? (it[7] ? rs(it[7]) : "✓") : '<span style="color:#B42318">not eligible</span>') + (it[8] ? '<br><small style="color:#8A8FA8">' + esc(it[8]) + "</small>" : "") + "</td></tr>"; }).join("") + "</table>" + (L.length > 400 ? '<div style="font-size:11.5px;color:#8A8FA8;margin-top:4px">Showing 400 of ' + L.length + " — download the Excel for all.</div>" : ""); };
    if (list) { draw(""); ov.querySelector("#pif").oninput = function () { draw(this.value); }; }
    return ov;
  }
  window.PAYITEMS = { show: show, excel: excel, summary: summary };
})();
