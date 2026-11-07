/* Shared "Sell-out & stock data" panel used by the Scheme ROI analyzer and the Demand forecast pages.
   SODATA.render(el, { api, toast, download, xlsx, esc, onChange }) */
(function () {
  "use strict";
  function libXL() { return window.XLSX ? Promise.resolve() : new Promise(function (res) { var s = document.createElement("script"); s.src = "/vendor/xlsx.full.min.js"; s.onload = res; document.head.appendChild(s); }); }
  var ym = function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }, ymd = function (d) { return ym(d) + "-" + String(d.getDate()).padStart(2, "0"); };
  function sample() {   // ~20 months: monthly figures, then daily for the last 120 days, with festive peaks and one scheme bump
    var S = [["Bihar", 1.0], ["Uttar Pradesh", 1.9], ["West Bengal", 1.2], ["Maharashtra", 1.5], ["Kerala", .7]], M = [["V60", 32990, 14], ["V60e", 28999, 10], ["Y39", 16990, 26], ["Y29", 13999, 22], ["T4x", 13499, 12], ["X200 FE", 54999, 4]];
    var fest = { 1: 1.05, 2: 1.0, 3: 1.05, 4: 1.08, 5: 1.0, 6: .9, 7: .9, 8: 1.12, 9: 1.1, 10: 1.35, 11: 1.3, 12: 1.1 }, seed = 11, rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    var rows = [["Date or Month", "State", "Model", "Units", "Value", "Retailer ID (optional)"]], today = new Date(), cut = new Date(today.getTime() - 120 * 864e5);
    var sStart = new Date(today.getTime() - 75 * 864e5), sEnd = new Date(today.getTime() - 55 * 864e5);
    for (var k = 19; k >= 0; k--) {
      var d0 = new Date(today.getFullYear(), today.getMonth() - k, 1); if (d0 > today) continue;
      var mo = d0.getMonth() + 1, dim = new Date(d0.getFullYear(), mo, 0).getDate(), growth = 1 + (19 - k) * .012;
      S.forEach(function (s) { M.forEach(function (m) { var f = fest[mo] * (s[0] === "Kerala" && (mo === 8 || mo === 9) ? 1.35 : 1) * (s[0] === "West Bengal" && mo === 10 ? 1.2 : 1), base = m[2] * s[1] * growth * f * 30;
        if (new Date(d0.getFullYear(), mo - 1, dim) < cut) { var u = Math.round(base * (.9 + rnd() * .2)); rows.push([ym(d0), s[0], m[0], u, u * m[1]]); }
        else for (var dd = 1; dd <= dim; dd++) { var day = new Date(d0.getFullYear(), mo - 1, dd); if (day < cut || day > today) continue; var boost = m[0] === "V60" && (s[0] === "Bihar" || s[0] === "Uttar Pradesh") && day >= sStart && day <= sEnd ? 1.45 : 1, u2 = Math.round(base / 30 * boost * (.75 + rnd() * .5)); if (u2) rows.push([ymd(day), s[0], m[0], u2, u2 * m[1]]); }
      }); });
    }
    var stock = [["State", "Model", "Stock units"]]; S.forEach(function (s) { M.forEach(function (m, i) { stock.push([s[0], m[0], Math.round(m[2] * s[1] * 30 * [0.5, 1.4, 0.9, 1.1, 0.3, 2.0][i])]); }); });
    return { rows: rows, stock: stock, scheme: { from: ymd(sStart), to: ymd(sEnd) } };
  }
  function render(el, o) {
    el.innerHTML = '<div class="loading"><div class="spin"></div></div>';
    o.api({ action: "so-summary" }).then(function (r) {
      if (!r.ok) { el.innerHTML = '<div class="err">' + o.esc(r.error) + "</div>"; return; }
      var smp = sample();
      el.innerHTML = '<div class="card"><b>📦 Data in use</b><div style="font-size:13px;margin-top:6px;line-height:1.7">' + (r.rows ? (r.source === "portal" ? "Retailer portal business data (month-wise)" : "Uploaded sell-out" + (r.daily ? " (with daily rows)" : " (month-wise)")) + " · " + r.rows.toLocaleString("en-IN") + " rows · " + (r.months.length ? r.months[0] + " → " + r.months[r.months.length - 1] : "") + "<br>" + r.states.length + " states · " + r.models.length + " models" + (r.stockAsOf ? " · stock as of " + r.stockAsOf : "") : "No data yet — upload sell-out below, or the Retailer portal’s business data is used automatically.") + '</div></div>' +
        '<div class="card"><b>1 · Sell-out</b><div class="muted" style="font-size:12.5px">Columns: Date (or Month), State, Model, Units, Value, Retailer ID (optional). Daily rows give the sharpest scheme analysis; month-wise is fine for forecasting. Uploading a month again replaces that month for the states in the file.' + (r.isHO ? "" : " You can upload only " + o.esc(r.myState) + ".") + '</div><div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn pri sm" id="so_up">📥 Upload sell-out</button><button class="btn sec sm" id="so_t">⬇ Template</button></div></div>' +
        '<div class="card"><b>2 · Current stock</b><div class="muted" style="font-size:12.5px">Columns: State, Model, Stock units (channel stock today). Used for allocation.</div><div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn pri sm" id="st_up">📥 Upload stock</button><button class="btn sec sm" id="st_t">⬇ Template</button></div></div>' +
        '<div class="card"><b>🧪 Sample test data</b><div class="muted" style="font-size:12.5px">20 months × 5 states × 6 models with festive peaks, plus a scheme-like bump on V60 in Bihar & UP from ' + smp.scheme.from + " to " + smp.scheme.to + ' (use those dates in the ROI analyzer).</div><div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn sec sm" id="so_s">⬇ Download sample</button>' + (r.isHO ? '<button class="btn ghost sm" id="so_clr" style="color:var(--bad)">🗑️ Clear uploaded data</button>' : "") + '</div></div><div id="so_res"></div>';
      var res = el.querySelector("#so_res");
      el.querySelector("#so_t").onclick = function () { o.download(o.xlsx([{ name: "Sell-out", rows: [smp.rows[0], [smp.rows[smp.rows.length - 1][0], "Bihar", "V60", 12, 395880, "BRE001"]] }]), "Sellout_template.xlsx"); };
      el.querySelector("#st_t").onclick = function () { o.download(o.xlsx([{ name: "Stock", rows: smp.stock.slice(0, 3) }]), "Stock_template.xlsx"); };
      el.querySelector("#so_s").onclick = function () { o.download(o.xlsx([{ name: "Sell-out", rows: smp.rows }, { name: "Stock", rows: smp.stock }]), "Sellout_sample_test_data.xlsx"); };
      if (el.querySelector("#so_clr")) el.querySelector("#so_clr").onclick = function () { var b = this; if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again to delete all uploaded sell-out & stock"; return; } o.api({ action: "so-clear" }).then(function () { o.toast("Cleared"); render(el, o); if (o.onChange) o.onChange(); }); };
      var pick = function (cb) { var i = document.createElement("input"); i.type = "file"; i.accept = ".xlsx,.xls,.csv"; i.onchange = function () { if (!i.files[0]) return; res.innerHTML = '<div class="loading"><div class="spin"></div>Reading…</div>'; libXL().then(function () { return i.files[0].arrayBuffer(); }).then(function (buf) { cb(XLSX.read(buf, { type: "array" })); }); }; i.click(); };
      var sheetRows = function (wb, test) { for (var n = 0; n < wb.SheetNames.length; n++) { var A = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[n]], { header: 1, defval: "", raw: true }); for (var h = 0; h < Math.min(8, A.length); h++) { var hd = A[h].map(function (c) { return String(c).toLowerCase().trim(); }); if (test(hd)) return { hd: hd, rows: A.slice(h + 1) }; } } return null; };
      var chunks = function (action, rows, extra) { var out = { saved: 0, bad: 0, skipped: 0 }, go = function (i) { if (i >= rows.length) return Promise.resolve(out); return o.api(Object.assign({ action: action, rows: rows.slice(i, i + 4000) }, extra || {})).then(function (r) { if (!r.ok) throw new Error(r.error); out.saved += r.saved || 0; out.bad += r.bad || 0; out.skipped += r.skipped || 0; return go(i + 4000); }); }; return go(0); };
      el.querySelector("#so_up").onclick = function () { pick(function (wb) {
        var S = sheetRows(wb, function (hd) { return hd.some(function (c) { return /model/.test(c); }) && hd.some(function (c) { return /unit|qty|sold|sales/.test(c); }) && hd.some(function (c) { return /date|month|period/.test(c); }); });
        if (!S) { res.innerHTML = '<div class="err">Need columns Date/Month, State, Model, Units.</div>'; return; }
        var c = function (re) { return S.hd.findIndex(function (h) { return re.test(h); }); }, C = { date: c(/date|month|period/), state: c(/state/), model: c(/model/), units: c(/unit|qty|sold|sales/), value: c(/value|amount|revenue/), rid: c(/retailer|rid|dealer/) };
        var rows = S.rows.filter(function (r) { return String(r[C.model] || "").trim(); }).map(function (r) { var x = {}; Object.keys(C).forEach(function (k) { if (C[k] >= 0) x[k] = r[C[k]]; }); if (typeof x.date === "string" && /^\d{4}-\d{2}$/.test(x.date.trim())) { x.month = x.date; delete x.date; } return x; });
        chunks("so-import", rows, { batch: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }).then(function (x) { res.innerHTML = '<div class="card" style="background:#E6F4EA">✅ ' + x.saved.toLocaleString("en-IN") + " sell-out rows saved" + (x.bad ? " · " + x.bad + " rows without date/state/model" : "") + (x.skipped ? " · " + x.skipped + " skipped (another state)" : "") + "</div>"; setTimeout(function () { render(el, o); if (o.onChange) o.onChange(); }, 900); }).catch(function (e) { res.innerHTML = '<div class="err">' + o.esc(e.message) + "</div>"; });
        var St = sheetRows(wb, function (hd) { return hd.some(function (c) { return /stock|inventory/.test(c); }) && hd.some(function (c) { return /model/.test(c); }) && !hd.some(function (c) { return /date|month/.test(c); }); });
        if (St) { var c2 = function (re) { return St.hd.findIndex(function (h) { return re.test(h); }); }; o.api({ action: "so-stock-import", rows: St.rows.filter(function (r) { return String(r[c2(/model/)] || "").trim(); }).map(function (r) { return { state: r[c2(/state/)], model: r[c2(/model/)], units: r[c2(/stock|inventory|unit/)] }; }) }).then(function (r) { if (r.ok) o.toast("Stock sheet saved too (" + r.saved + " rows)"); }); }
      }); };
      el.querySelector("#st_up").onclick = function () { pick(function (wb) {
        var St = sheetRows(wb, function (hd) { return hd.some(function (c) { return /stock|inventory|unit/.test(c); }) && hd.some(function (c) { return /model/.test(c); }); });
        if (!St) { res.innerHTML = '<div class="err">Need columns State, Model, Stock units.</div>'; return; }
        var c2 = function (re) { return St.hd.findIndex(function (h) { return re.test(h); }); };
        o.api({ action: "so-stock-import", rows: St.rows.filter(function (r) { return String(r[c2(/model/)] || "").trim(); }).map(function (r) { return { state: r[c2(/state/)], model: r[c2(/model/)], units: r[c2(/stock|inventory|unit/)] }; }) }).then(function (r) { res.innerHTML = r.ok ? '<div class="card" style="background:#E6F4EA">✅ ' + r.saved + " stock rows saved</div>" : '<div class="err">' + o.esc(r.error) + "</div>"; if (r.ok) setTimeout(function () { render(el, o); if (o.onChange) o.onChange(); }, 900); });
      }); };
    });
  }
  window.SODATA = { render: render, sample: sample };
})();
