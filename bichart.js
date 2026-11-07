/* Small SVG chart kit for the analysis tools (Scheme ROI, Forecast, Competition). No dependencies.
   BICH.bars([[label, value, note?, color?]], {color, fmt})      horizontal bars
   BICH.lines({labels, series:[{name, values, color, dash, band:[[lo,hi]…]}], height, fmt, shade:[{from,to,color}]})
   BICH.stack({rows:[{label, parts:{key:value}}], keys, colors, pct})   100% (or absolute) stacked columns
   BICH.legend([[name, color]])
   BICH.color(name, i)                                              stable brand / series colour */
(function () {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var nf = function (n) { n = Number(n) || 0; var a = Math.abs(n); return a >= 1e7 ? (n / 1e7).toFixed(1) + "Cr" : a >= 1e5 ? (n / 1e5).toFixed(1) + "L" : a >= 1e4 ? (n / 1e3).toFixed(1) + "k" : Math.round(n).toLocaleString("en-IN"); };
  var PAL = ["#5B4CFF", "#16A06A", "#F2A93B", "#E05757", "#2BB3D9", "#8F5BFF", "#D9488F", "#7A8B2B", "#3D6BD6", "#B86E2B", "#5BA3A0", "#9A9FB5", "#C7A100", "#5E6AD2"];
  var BR = { vivo: "#415FFF", samsung: "#1428A0", apple: "#7D7D86", oppo: "#0E8F5B", realme: "#E2B800", xiaomi: "#FF6900", redmi: "#FF6900", oneplus: "#E5202E", motorola: "#5C88DA", nothing: "#222222", google: "#34A853", transsion: "#8A3FFC", infinix: "#8A3FFC", lava: "#C2185B", honor: "#00A0E9", iqoo: "#F7B500", others: "#B8BCCB" };
  function color(name, i) { var k = String(name || "").toLowerCase().replace(/[^a-z]/g, ""); for (var b in BR) if (k.indexOf(b) === 0) return BR[b]; return PAL[(i || 0) % PAL.length]; }
  function bars(L, o) {
    o = o || {}; if (!L || !L.length) return "";
    var mx = Math.max.apply(null, L.map(function (x) { return Math.abs(x[1]); }).concat([1e-9])), neg = L.some(function (x) { return x[1] < 0; });
    return '<div class="bich">' + L.map(function (x, i) { var w = Math.abs(x[1]) / mx * (neg ? 50 : 100), c = x[3] || o.color || (x[1] < 0 ? "#E05757" : PAL[0]);
      return '<div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12px"><span style="width:' + (o.lw || 104) + 'px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(x[0]) + '">' + esc(x[0]) + '</span><span style="flex:1;background:#F1F2F8;border-radius:6px;height:14px;position:relative;overflow:hidden">' + (neg ? '<i style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#C9CCDA"></i>' : "") + '<i style="position:absolute;top:0;bottom:0;' + (neg ? (x[1] < 0 ? "right:50%" : "left:50%") : "left:0") + ";width:" + Math.max(1.5, w) + "%;background:" + c + ';border-radius:6px"></i></span><b style="min-width:54px;text-align:right;flex:none;white-space:nowrap">' + (o.fmt ? o.fmt(x[1]) : nf(x[1])) + (x[2] ? '<small style="color:#8A8FA8;font-weight:500"> ' + esc(x[2]) + "</small>" : "") + "</b></div>"; }).join("") + "</div>";
  }
  function lines(o) {
    var W = 340, H = o.height || 150, P = 36, labels = o.labels || [], n = labels.length; if (!n) return "";
    var vals = []; o.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) vals.push(v); }); (s.band || []).forEach(function (b) { if (b) { vals.push(b[0]); vals.push(b[1]); } }); });
    var mx = Math.max.apply(null, vals.concat([1])), mn = o.zero === false ? Math.min.apply(null, vals.concat([mx])) : 0, rng = mx - mn || 1;
    var X = function (i) { return P + (n === 1 ? (W - P) / 2 : i * (W - P - 6) / (n - 1)); }, Y = function (v) { return 8 + (H - 8) * (1 - (v - mn) / rng); };
    var g = '<svg viewBox="0 0 ' + W + " " + (H + 24) + '" style="width:100%;height:auto;font-family:inherit">';
    (o.shade || []).forEach(function (s) { g += '<rect x="' + (X(s.from) - 4) + '" y="4" width="' + Math.max(6, X(s.to) - X(s.from) + 8) + '" height="' + (H - 2) + '" fill="' + (s.color || "#F4F2FF") + '" rx="6"/>' + (s.label ? '<text x="' + (X(s.from) + (X(s.to) - X(s.from)) / 2) + '" y="16" font-size="9.5" text-anchor="middle" fill="#6A4CFF">' + esc(s.label) + "</text>" : ""); });
    [0, .5, 1].forEach(function (f) { var v = mn + rng * f; g += '<line x1="' + P + '" x2="' + W + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#ECEEF5"/><text x="' + (P - 4) + '" y="' + (Y(v) + 3) + '" font-size="9" text-anchor="end" fill="#9AA0B8">' + (o.fmt ? o.fmt(v) : nf(v)) + "</text>"; });
    o.series.forEach(function (s, si) {
      var c = s.color || color(s.name, si);
      if (s.band && s.band.length) { var up = [], dn = []; s.band.forEach(function (b, i) { if (b) { up.push(X(i) + "," + Y(b[1])); dn.unshift(X(i) + "," + Y(b[0])); } }); if (up.length) g += '<polygon points="' + up.concat(dn).join(" ") + '" fill="' + c + '" opacity=".13"/>'; }
      var seg = [], segs = []; s.values.forEach(function (v, i) { if (v == null) { if (seg.length) segs.push(seg); seg = []; } else seg.push(X(i) + "," + Y(v)); }); if (seg.length) segs.push(seg);
      segs.forEach(function (sg) { g += '<polyline fill="none" stroke="' + c + '" stroke-width="' + (s.width || 2.4) + '"' + (s.dash ? ' stroke-dasharray="5 4"' : "") + ' points="' + sg.join(" ") + '"/>'; });
      if (s.dots !== false && n <= 16) s.values.forEach(function (v, i) { if (v != null) g += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="2.8" fill="' + c + '"><title>' + esc(s.name + " · " + labels[i] + ": " + (o.fmt ? o.fmt(v) : nf(v))) + "</title></circle>"; });
    });
    var every = Math.ceil(n / 8); labels.forEach(function (l, i) { if (i % every === 0 || i === n - 1) g += '<text x="' + X(i) + '" y="' + (H + 18) + '" font-size="9.5" text-anchor="' + (i === n - 1 && n > 1 ? "end" : "middle") + '" fill="#6B7090">' + esc(l) + "</text>"; });
    return g + "</svg>" + (o.legend === false ? "" : legend(o.series.map(function (s, i) { return [s.name, s.color || color(s.name, i), s.dash]; })));
  }
  function stack(o) {
    var rows = o.rows || [], keys = o.keys || [], W = 340, H = o.height || 160, n = rows.length; if (!n) return "";
    var bw = Math.min(46, (W - 30) / n * .7), tot = rows.map(function (r) { return keys.reduce(function (a, k) { return a + (Number(r.parts[k]) || 0); }, 0); }), mx = o.pct ? 100 : Math.max.apply(null, tot.concat([1]));
    var g = '<svg viewBox="0 0 ' + W + " " + (H + 26) + '" style="width:100%;height:auto">';
    rows.forEach(function (r, i) { var x = 20 + i * (W - 30) / n + ((W - 30) / n - bw) / 2, y = H, T = o.pct ? (tot[i] || 1) : 1;
      keys.forEach(function (k, ki) { var v = Number(r.parts[k]) || 0; if (!v) return; var h = (o.pct ? v / T * 100 : v) / mx * (H - 8); y -= h; g += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(0, h - .6) + '" fill="' + (o.colors && o.colors[k] || color(k, ki)) + '"><title>' + esc(k + ": " + (o.pct ? Math.round(v / T * 100) + "%" : nf(v))) + "</title></rect>" + (h > 13 && bw > 24 ? '<text x="' + (x + bw / 2) + '" y="' + (y + h / 2 + 3.5) + '" font-size="9" text-anchor="middle" fill="#fff">' + (o.pct ? Math.round(v / T * 100) : nf(v)) + "</text>" : ""); });
      g += '<text x="' + (x + bw / 2) + '" y="' + (H + 16) + '" font-size="9.5" text-anchor="middle" fill="#6B7090">' + esc(r.label) + "</text>"; });
    return g + "</svg>" + legend(keys.map(function (k, i) { return [k, o.colors && o.colors[k] || color(k, i)]; }));
  }
  function legend(L) { return '<div style="display:flex;flex-wrap:wrap;gap:6px 12px;font-size:11.5px;color:#6B7090;margin-top:4px">' + L.map(function (x) { return '<span><i style="display:inline-block;width:10px;height:' + (x[2] ? 3 : 10) + "px;border-radius:3px;background:" + x[1] + ';margin-right:4px;vertical-align:' + (x[2] ? "3px" : "-1px") + '"></i>' + esc(x[0]) + "</span>"; }).join("") + "</div>"; }
  window.BICH = { bars: bars, lines: lines, stack: stack, legend: legend, color: color, nf: nf, PAL: PAL };
})();
