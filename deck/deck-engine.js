/* vivo BI executive deck engine — one layout library, two outputs.
   A slide (JSON from the storyline) → primitives (rect / text / img / chart / line, in inches on a 13.333 × 7.5 canvas)
   → HTML preview (same geometry) and → PowerPoint (PptxGenJS, editable text and native charts).
   Numbers are never typed by the AI: charts and tables come from the person's own data (datasets), and every number
   in a slide's words is checked against the material (numCheck). Used by Executive deck, Deck doctor and the creative studio. */
(function () {
  "use strict";
  var W = 13.333, H = 7.5;
  var T = {
    navy: "14205B", blue: "3F5BFF", blue2: "2B3FD6", ink: "101533", mut: "5A6592", light: "EEF1FF", line: "E3E7F5", soft: "F6F7FC",
    green: "2E9D6A", amber: "E09B10", red: "E5484D", cyan: "00A6EE", purple: "7B61FF", white: "FFFFFF",
    pal: ["3F5BFF", "14205B", "00A6EE", "7B61FF", "2E9D6A", "E09B10", "E5484D", "9DB0FF"],
    tile: [["3F5BFF", "5B74FF"], ["1B2A8C", "2D3FB0"], ["00A6EE", "38BDF8"], ["7B61FF", "9580FF"], ["14205B", "26357F"], ["2E9D6A", "3DB882"]],
    font: "Trebuchet MS", fontCss: "'Trebuchet MS','Segoe UI',Roboto,Arial,sans-serif",
    logo: "/deck/bi-logo.png", logoW: "/deck/bi-logo-white.png", cover: "/deck/bi-cover.jpg", logoAR: 1400 / 512
  };
  var STATUS = { live: ["2E9D6A", "E3F6EC"], done: ["14205B", "E6E9F5"], completed: ["14205B", "E6E9F5"], pilot: ["B7790A", "FFF4DB"], upcoming: ["3F5BFF", "EEF1FF"], planned: ["3F5BFF", "EEF1FF"], risk: ["C2373C", "FDE7E7"], delayed: ["C2373C", "FDE7E7"], "on track": ["2E9D6A", "E3F6EC"] };

  // ---------- text measuring & fitting ----------
  var CV = null;
  function measure(text, sizePt, bold) {
    if (!CV) { try { CV = document.createElement("canvas").getContext("2d"); } catch (e) { CV = false; } }
    if (!CV) return String(text).length * sizePt * 0.5 / 72;
    CV.font = (bold ? "bold " : "") + sizePt + "px " + T.fontCss;
    return CV.measureText(String(text)).width / 72;   // inches
  }
  function lines(text, wIn, sizePt, bold) {
    var out = 0;
    String(text == null ? "" : text).split("\n").forEach(function (para) {
      var words = para.split(/\s+/), cur = "", n = 1;
      words.forEach(function (w0) { var t = cur ? cur + " " + w0 : w0; if (measure(t, sizePt, bold) > wIn && cur) { n++; cur = w0; } else cur = t; });
      out += n;
    });
    return out;
  }
  function fit(text, wIn, hIn, size, bold, lh, min) {   // biggest font size (≤ size) that fits the box
    lh = lh || 1.2; min = min || 8;
    for (var s = size; s >= min; s -= 0.5) { if (lines(text, wIn - 0.1, s, bold) * s * lh / 72 <= hIn - 0.06) return s; }
    return min;
  }

  // ---------- primitives ----------
  function R(x, y, w, h, fill, o) { return Object.assign({ t: "rect", x: x, y: y, w: w, h: h, fill: fill }, o || {}); }
  function X(x, y, w, h, s, o) { o = o || {}; var size = o.size || 14; if (o.fit !== false && typeof s === "string") size = fit(s, w, h, size, o.b, o.lh, o.min); return Object.assign({ t: "text", x: x, y: y, w: w, h: h, s: s, c: T.ink, al: "l", va: "t" }, o, { size: size }); }
  function I(x, y, w, h, src, o) { return Object.assign({ t: "img", x: x, y: y, w: w, h: h, src: src, mode: "contain" }, o || {}); }
  function C(x, y, w, h, ch) { return Object.assign({ t: "chart", x: x, y: y, w: w, h: h }, ch); }

  function header(P, sl, deck, dark) {
    P.push(R(0.38, 0.36, 0.2, 0.46, T.blue, { r: 0.04 }));
    P.push(X(0.72, 0.24, 10.6, 0.62, sl.title || "", { size: 24, b: true, c: T.navy, va: "m", min: 16 }));
    if (sl.subtitle) P.push(X(0.72, 0.86, 10.6, 0.34, sl.subtitle, { size: 11.5, c: T.mut, min: 9 }));
    P.push(I(11.7, 0.26, 1.33, 1.33 / T.logoAR, T.logo));
  }
  function footer(P, deck, n) {
    P.push(X(0.4, 7.08, 9, 0.28, "vivo Business Innovation  ·  " + (deck.title || "") + (deck.period ? "  ·  " + deck.period : ""), { size: 8, c: "8A93B8", fit: false }));
    P.push(X(12.2, 7.08, 0.75, 0.28, String(n), { size: 8, c: "8A93B8", al: "r", fit: false }));
  }
  function bulletsText(arr) { return (arr || []).filter(Boolean).map(function (b) { return String(b).replace(/^[-•●▪\s]+/, ""); }); }
  // bullets stacked from the top with natural spacing; the biggest font size (≤ max) that fits the space
  function stack(P, x, y, w, avail, items, o) {
    o = o || {}; var max = o.size || 13, min = o.min || 8.5, gap = o.gap || 0.16, tw = w - (o.indent || 0.3), size = min, hs = [];
    for (var s0 = max; s0 >= min; s0 -= 0.5) { hs = items.map(function (b) { return lines(b, tw - 0.08, s0, false) * s0 * 1.25 / 72 + 0.04; }); var tot = hs.reduce(function (a, b) { return a + b; }, 0) + gap * (items.length - 1); if (tot <= avail) { size = s0; break; } }
    if (size === min) hs = items.map(function (b) { return lines(b, tw - 0.08, min, false) * min * 1.25 / 72 + 0.04; });
    var yy = y;
    items.forEach(function (b, i) {
      if (o.mark === "dot" || !o.mark) P.push(R(x + 0.02, yy + size / 72 * 0.42, 0.09, 0.09, o.dot || T.blue, { r: 0.045 }));
      else P.push(X(x, yy, 0.3, size * 1.3 / 72, o.mark, { size: size, b: true, c: o.dot || T.blue, fit: false }));
      P.push(X(x + (o.indent || 0.3), yy, tw, hs[i], b, { size: size, c: o.c || T.ink, fit: false, lh: 1.25 }));
      yy += hs[i] + gap;
    });
    return size;
  }
  function bulletBox(P, x, y, w, h, title, arr, o) {
    o = o || {}; var dark = !!o.dark, items = bulletsText(arr).slice(0, 7);
    P.push(R(x, y, w, h, dark ? T.navy : T.white, { r: 0.14, shadow: !dark, line: dark ? null : T.line }));
    var ty = y + 0.18;
    if (title) { P.push(X(x + 0.25, ty, w - 0.5, 0.36, title, { size: 13, b: true, c: dark ? "FFFFFF" : T.navy, fit: false })); ty += 0.46; }
    if (!items.length) return;
    stack(P, x + 0.27, ty + 0.04, w - 0.5, y + h - ty - 0.25, items, { size: 14, min: 9, gap: 0.2, dot: dark ? "9DB0FF" : T.blue, c: dark ? "E8EBFF" : T.ink });
  }
  function kpiTiles(P, kpis, x, y, w, h) {
    kpis = (kpis || []).slice(0, 6); if (!kpis.length) return;
    var gap = 0.16, tw = (w - gap * (kpis.length - 1)) / kpis.length;
    kpis.forEach(function (k, i) {
      var g = T.tile[i % T.tile.length], xx = x + i * (tw + gap);
      P.push(R(xx, y, tw, h, g[0], { r: 0.14, grad: g, shadow: true }));
      P.push(X(xx + 0.18, y + 0.12, tw - 0.36, 0.28, String(k.label || "").toUpperCase(), { size: 9.5, b: true, c: "DDE3FF", min: 7 }));
      P.push(X(xx + 0.18, y + 0.38, tw - 0.36, h * 0.48, String(k.value == null ? "" : k.value), { size: 30, b: true, c: "FFFFFF", min: 14, va: "m" }));
      if (k.sub) P.push(X(xx + 0.18, y + h - 0.4, tw - 0.36, 0.3, String(k.sub), { size: 9.5, c: "DDE3FF", min: 7 }));
    });
  }

  // ---------- datasets → chart / table data ----------
  function num(v) { if (typeof v === "number") return v; var s = String(v == null ? "" : v).replace(/[,₹\s]/g, "").replace(/%$/, ""); return s !== "" && isFinite(+s) ? +s : null; }
  function colIdx(ds, name) { if (name == null) return -1; var n = String(name).toLowerCase().trim(); var i = ds.cols.findIndex(function (c) { return String(c).toLowerCase().trim() === n; }); if (i < 0) i = ds.cols.findIndex(function (c) { return String(c).toLowerCase().indexOf(n) >= 0; }); return i; }
  function chartData(spec, DS) {
    var ds = DS && spec && DS[spec.data]; if (!ds) return null;
    var xi = colIdx(ds, spec.x); if (xi < 0) xi = ds.cols.findIndex(function (c, i) { return ds.rows.some(function (r) { return num(r[i]) == null && r[i] !== "" && r[i] != null; }); });
    var ys = (Array.isArray(spec.y) ? spec.y : [spec.y]).filter(Boolean).map(function (y) { return colIdx(ds, y); }).filter(function (i) { return i >= 0 && i !== xi; });
    if (!ys.length) ys = ds.cols.map(function (c, i) { return i; }).filter(function (i) { return i !== xi && ds.rows.some(function (r) { return num(r[i]) != null; }); }).slice(0, 1);
    if (xi < 0 || !ys.length) return null;
    var map = {}, order = [];
    ds.rows.forEach(function (r) { var k = String(r[xi] == null ? "" : r[xi]).trim(); if (!k) return; if (!map[k]) { map[k] = ys.map(function () { return 0; }); order.push(k); } ys.forEach(function (yi, j) { var v = num(r[yi]); if (v != null) map[k][j] += v; }); });
    if (spec.sort === "desc" || spec.sort === "asc" || spec.top) order.sort(function (a, b) { return spec.sort === "asc" ? map[a][0] - map[b][0] : map[b][0] - map[a][0]; });
    if (spec.top) order = order.slice(0, Math.max(1, Math.min(40, +spec.top)));
    return { labels: order, series: ys.map(function (yi, j) { return { name: ds.cols[yi], values: order.map(function (k) { return Math.round(map[k][j] * 100) / 100; }) }; }) };
  }
  function tableData(spec, DS) {
    var ds = DS && spec && DS[spec.data]; if (!ds) return null;
    var ci = (spec.cols && spec.cols.length ? spec.cols.map(function (c) { return colIdx(ds, c); }).filter(function (i) { return i >= 0; }) : ds.cols.map(function (c, i) { return i; })).slice(0, 8);
    var rows = ds.rows.slice();
    if (spec.sort) { var si = colIdx(ds, spec.sort.col || spec.sort); if (si >= 0) rows.sort(function (a, b) { return (num(b[si]) || 0) - (num(a[si]) || 0); }); if (spec.sort.dir === "asc") rows.reverse(); }
    rows = rows.slice(0, Math.max(1, Math.min(14, +spec.top || 10)));
    return { head: ci.map(function (i) { return ds.cols[i]; }), rows: rows.map(function (r) { return ci.map(function (i) { var v = r[i]; return typeof v === "number" ? fmt(v) : String(v == null ? "" : v); }); }) };
  }
  function fmt(v) { if (typeof v !== "number") return String(v); var a = Math.abs(v); if (a >= 1e7) return (v / 1e7).toFixed(a >= 1e8 ? 0 : 1) + " Cr"; if (a >= 1e5) return (v / 1e5).toFixed(a >= 1e6 ? 0 : 1) + " L"; return (Math.round(v * 10) / 10).toLocaleString("en-IN"); }

  // ---------- layouts ----------
  var LAYOUTS = {
    cover: function (P, sl, deck) {
      P.bg = { img: T.cover };
      P.push(X(1.2, 5.42, 10.9, 0.56, sl.title || deck.title || "", { size: 26, b: true, c: T.navy, al: "c", va: "m", min: 16 }));
      if (sl.subtitle) P.push(X(1.6, 5.96, 10.1, 0.34, sl.subtitle, { size: 13, c: "3B4787", al: "c", min: 10 }));
      var k = (sl.kpis || []).slice(0, 4);
      if (k.length) { var w = 2.3, gap = 0.3, tot = k.length * w + (k.length - 1) * gap, x0 = (W - tot) / 2;
        k.forEach(function (q, i) { var xx = x0 + i * (w + gap); P.push(R(xx, 6.4, w, 0.86, "FFFFFF", { r: 0.14, alpha: 0.12, shadow: true }));
          P.push(X(xx + 0.1, 6.44, w - 0.2, 0.46, String(q.value), { size: 22, b: true, c: T.navy, al: "c", va: "m", min: 12 }));
          P.push(X(xx + 0.1, 6.9, w - 0.2, 0.3, String(q.label || ""), { size: 9.5, c: T.mut, al: "c", min: 7 })); }); }
      P.noFooter = true;
    },
    agenda: function (P, sl, deck) {
      header(P, sl, deck);
      P.push(R(0.4, 1.45, 4.1, 3.0, T.blue, { r: 0.18, grad: ["3F5BFF", "2B3FD6"], shadow: true }));
      P.push(X(0.75, 1.75, 3.5, 0.95, sl.kicker || deck.period || "Agenda", { size: 40, b: true, c: "FFFFFF", min: 18, va: "m" }));
      P.push(X(0.75, 2.75, 3.5, 1.5, sl.subtitle2 || deck.title || "", { size: 15, b: true, c: "E8EBFF", min: 10 }));
      var it = (sl.items && sl.items.length ? sl.items : bulletsText(sl.bullets).map(function (b) { return { title: b }; })).slice(0, 7), rh = Math.min(0.78, 5.4 / Math.max(1, it.length));
      it.forEach(function (q, i) { var y = 1.45 + i * (rh + 0.08);
        P.push(R(4.85, y, 8.1, rh, i % 2 ? T.white : T.soft, { r: 0.12, line: T.line }));
        P.push(X(5.05, y, 0.7, rh, String(i + 1).padStart(2, "0"), { size: 16, b: true, c: T.blue, va: "m", fit: false }));
        P.push(X(5.8, y + 0.06, 6.9, rh * 0.55, q.title || "", { size: 14, b: true, c: T.navy, va: "m", min: 10 }));
        if (q.text) P.push(X(5.8, y + rh * 0.55, 6.9, rh * 0.42, q.text, { size: 10, c: T.mut, min: 8 })); });
    },
    section: function (P, sl, deck) {
      P.bg = { color: T.blue, grad: ["3F5BFF", "2B3FD6"] };
      P.push(X(1.0, 2.2, 6, 1.3, sl.kicker || "", { size: 66, b: true, c: "8FF0C9", fit: false, va: "b" }));
      P.push(X(1.0, 3.5, 11, 1.0, sl.title || "", { size: 40, b: true, c: "FFFFFF", min: 20 }));
      if (sl.subtitle) P.push(X(1.0, 4.55, 10.5, 0.6, sl.subtitle, { size: 15, c: "DDE3FF", min: 10 }));
      P.push(I(11.55, 0.35, 1.45, 1.45 / T.logoAR, T.logoW));
      P.noFooter = true;
    },
    kpis: function (P, sl, deck, DS) {
      header(P, sl, deck);
      kpiTiles(P, sl.kpis, 0.4, 1.42, 12.55, 1.42);
      var cd = sl.chart && chartData(sl.chart, DS);
      if (cd) { chartCard(P, 0.4, 3.1, 7.9, 3.8, sl.chart, cd); bulletBox(P, 8.5, 3.1, 4.45, 3.8, sl.insightTitle || "What it means", sl.bullets, { dark: true }); }
      else bulletBox(P, 0.4, 3.1, 12.55, 3.8, sl.insightTitle || "What it means", sl.bullets);
    },
    chart: function (P, sl, deck, DS) {
      header(P, sl, deck);
      var cd = sl.chart && chartData(sl.chart, DS);
      if (cd) chartCard(P, 0.4, 1.4, 8.3, 5.5, sl.chart, cd); else P.push(X(0.6, 3.6, 8, 0.6, "⚠ Chart data not found — choose a table and columns", { size: 14, c: T.red }));
      bulletBox(P, 8.9, 1.4, 4.05, 5.5, sl.insightTitle || "Key insights", sl.bullets, { dark: true });
    },
    ranking: function (P, sl, deck, DS) {
      header(P, sl, deck);
      var cd = sl.chart && chartData(Object.assign({ sort: "desc", top: 10 }, sl.chart), DS);
      if (cd) { var labs = cd.labels, vals = cd.series[0].values, max = Math.max.apply(null, vals.concat([1])), n = labs.length, rh = Math.min(0.5, 5.3 / n);
        P.push(R(0.4, 1.4, 8.3, 5.5, T.white, { r: 0.14, shadow: true, line: T.line }));
        P.push(X(0.65, 1.55, 7.8, 0.34, sl.chart.title || cd.series[0].name, { size: 12, b: true, c: T.navy, fit: false }));
        labs.forEach(function (l, i) { var y = 2.05 + i * rh, bw = 5.0 * Math.max(0, vals[i]) / max, col = i === 0 ? "E09B10" : i === 1 ? "9AA3B5" : i === 2 ? "C07A3B" : T.blue;
          P.push(X(0.6, y, 0.45, rh, "#" + (i + 1), { size: Math.min(12, rh * 26), b: true, c: i < 3 ? col : T.mut, va: "m", fit: false }));
          P.push(X(1.05, y, 1.9, rh, l, { size: Math.min(12, rh * 26), c: T.ink, va: "m", min: 7 }));
          P.push(R(3.0, y + rh * 0.2, Math.max(0.05, bw), rh * 0.6, col, { r: 0.05 }));
          P.push(X(3.05 + bw, y, 1.2, rh, fmt(vals[i]), { size: Math.min(11, rh * 24), b: true, c: T.navy, va: "m", fit: false })); }); }
      bulletBox(P, 8.9, 1.4, 4.05, 5.5, sl.insightTitle || "What stands out", sl.bullets, { dark: true });
    },
    messages: function (P, sl, deck) {
      header(P, sl, deck);
      var it = (sl.items && sl.items.length ? sl.items : bulletsText(sl.bullets).map(function (b) { var m = b.split(/\s[—–:-]\s|:\s/); return { title: m[0], text: m.slice(1).join(" — ") }; })).slice(0, 6), rh = Math.min(1.0, 5.5 / it.length - 0.12);
      it.forEach(function (q, i) { var y = 1.4 + i * (rh + 0.12), col = T.pal[i % T.pal.length];
        P.push(R(0.4, y, 12.55, rh, T.white, { r: 0.12, shadow: true, line: T.line }));
        P.push(R(0.4, y, 0.09, rh, col));
        P.push(R(0.72, y + rh / 2 - 0.24, 0.48, 0.48, col, { r: 0.24 }));
        P.push(X(0.72, y + rh / 2 - 0.24, 0.48, 0.48, String(i + 1), { size: 14, b: true, c: "FFFFFF", al: "c", va: "m", fit: false }));
        P.push(X(1.45, y + 0.08, 11.3, rh * 0.45, q.title || "", { size: 15, b: true, c: T.navy, va: "m", min: 10 }));
        if (q.text) P.push(X(1.45, y + rh * 0.5, 11.3, rh * 0.46, q.text, { size: 11, c: T.mut, min: 8 })); });
    },
    compare: function (P, sl, deck) {
      header(P, sl, deck);
      var L = sl.left || {}, Rr = sl.right || {};
      [[L, 0.4, "8A93B8", "F3F4FA"], [Rr, 6.78, T.blue, T.light]].forEach(function (c) {
        P.push(R(c[1], 1.4, 6.17, 5.5, T.white, { r: 0.14, shadow: true, line: T.line }));
        P.push(R(c[1], 1.4, 6.17, 0.62, c[2], { r: 0.14 })); P.push(R(c[1], 1.8, 6.17, 0.22, c[2]));
        P.push(X(c[1] + 0.25, 1.4, 5.7, 0.62, c[0].title || "", { size: 15, b: true, c: "FFFFFF", va: "m", min: 10 }));
        stack(P, c[1] + 0.28, 2.25, 5.65, 4.45, bulletsText(c[0].bullets).slice(0, 7), { size: 14, min: 9, gap: 0.24, mark: c[2] === T.blue ? "✓" : "•", dot: c[2], indent: 0.34 });
      });
      P.push(R(6.42, 3.85, 0.5, 0.5, T.navy, { r: 0.25 })); P.push(X(6.42, 3.85, 0.5, 0.5, "→", { size: 16, b: true, c: "FFFFFF", al: "c", va: "m", fit: false }));
    },
    timeline: function (P, sl, deck) {
      header(P, sl, deck);
      var it = (sl.items || []).slice(0, 6), n = Math.max(1, it.length), gap = 0.16, cw = (12.55 - gap * (n - 1)) / n;
      var cols = ["3F5BFF", "F0663A", "18A57B", "E09B10", "7B61FF", "00A6EE"];
      it.forEach(function (q, i) { var x = 0.4 + i * (cw + gap), col = cols[i % cols.length];
        P.push(R(x, 1.4, cw, 5.5, T.white, { r: 0.14, shadow: true, line: T.line }));
        P.push(R(x, 1.4, cw, 0.95, col, { r: 0.14 })); P.push(R(x, 2.1, cw, 0.25, col));
        P.push(X(x + 0.18, 1.45, cw - 0.36, 0.5, q.tag || ("Q" + (i + 1)), { size: 20, b: true, c: "FFFFFF", va: "m", min: 11 }));
        P.push(X(x + 0.18, 1.92, cw - 0.36, 0.38, q.title || "", { size: 10.5, b: true, c: "FFFFFF", min: 7 }));
        stack(P, x + 0.2, 2.55, cw - 0.35, q.result ? 3.35 : 4.15, bulletsText(q.bullets || (q.text ? [q.text] : [])).slice(0, 6), { size: 12, min: 7.5, gap: 0.14, dot: col, indent: 0.2 });
        if (q.result) { P.push(R(x + 0.15, 6.05, cw - 0.3, 0.7, T.soft, { r: 0.1 })); P.push(X(x + 0.25, 6.08, cw - 0.5, 0.64, q.result, { size: 10, b: true, c: col, va: "m", min: 7 })); }
      });
    },
    cards: function (P, sl, deck) {
      header(P, sl, deck);
      var it = (sl.items || []).slice(0, 9), n = it.length, cols = n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), gap = 0.18, cw = (12.55 - gap * (cols - 1)) / cols, ch = (5.5 - gap * (rows - 1)) / rows;
      it.forEach(function (q, i) { var x = 0.4 + (i % cols) * (cw + gap), y = 1.4 + Math.floor(i / cols) * (ch + gap), st = STATUS[String(q.status || "").toLowerCase()];
        P.push(R(x, y, cw, ch, T.white, { r: 0.14, shadow: true, line: T.line }));
        P.push(R(x, y, 0.08, ch, st ? st[0] : T.blue));
        P.push(X(x + 0.28, y + 0.14, cw - (st ? 1.75 : 0.5), 0.42, q.title || "", { size: 14, b: true, c: T.navy, va: "m", min: 9 }));
        if (st) { P.push(R(x + cw - 1.38, y + 0.19, 1.18, 0.32, st[1], { r: 0.16 })); P.push(X(x + cw - 1.38, y + 0.19, 1.18, 0.32, String(q.status), { size: 9.5, b: true, c: st[0], al: "c", va: "m", fit: false })); }
        if (q.text) P.push(X(x + 0.28, y + 0.62, cw - 0.5, ch - 0.75, q.text, { size: 11.5, c: T.mut, min: 8 }));
      });
    },
    table: function (P, sl, deck, DS) {
      header(P, sl, deck);
      var td = sl.table && sl.table.data ? tableData(sl.table, DS) : sl.table && sl.table.head ? sl.table : null; if (!td) return;
      var hasB = bulletsText(sl.bullets).length, tw = hasB ? 8.6 : 12.55;
      P.push({ t: "table", x: 0.4, y: 1.4, w: tw, h: 5.5, head: td.head, rows: td.rows });
      if (hasB) bulletBox(P, 9.2, 1.4, 3.75, 5.5, sl.insightTitle || "Key insights", sl.bullets, { dark: true });
    },
    image: function (P, sl, deck, DS, IM) {
      header(P, sl, deck);
      var src = IM && sl.image && IM[sl.image];
      P.push(R(0.4, 1.4, 7.4, 5.5, T.soft, { r: 0.14, line: T.line }));
      if (src) P.push(I(0.55, 1.55, 7.1, 5.2, src.url || src)); else P.push(X(0.6, 3.8, 7, 0.5, "Picture not added", { size: 13, c: T.mut, al: "c" }));
      bulletBox(P, 8.0, 1.4, 4.95, 5.5, sl.insightTitle || "Highlights", sl.bullets);
    },
    asks: function (P, sl, deck) {
      header(P, sl, deck);
      P.push(R(0.4, 1.4, 4.3, 5.5, T.navy, { r: 0.16, grad: ["14205B", "26357F"] }));
      P.push(X(0.75, 1.75, 3.7, 1.4, sl.kicker || "What we need from you", { size: 26, b: true, c: "FFFFFF", min: 14 }));
      if (sl.subtitle2) P.push(X(0.75, 3.3, 3.6, 2.5, sl.subtitle2, { size: 13, c: "C9D1FF", min: 9 }));
      var it = (sl.items && sl.items.length ? sl.items : bulletsText(sl.bullets).map(function (b) { return { title: b }; })).slice(0, 6), rh = Math.min(0.95, 5.5 / it.length - 0.12);
      it.forEach(function (q, i) { var y = 1.4 + i * (rh + 0.12);
        P.push(R(4.95, y, 8.0, rh, T.white, { r: 0.12, shadow: true, line: T.line }));
        P.push(X(5.15, y, 0.6, rh, String(i + 1), { size: 22, b: true, c: T.blue, va: "m", fit: false }));
        P.push(X(5.8, y + 0.06, 6.95, q.text ? rh * 0.5 : rh - 0.12, q.title || "", { size: 14, b: true, c: T.navy, va: "m", min: 9 }));
        if (q.text) P.push(X(5.8, y + rh * 0.52, 6.95, rh * 0.45, q.text, { size: 10.5, c: T.mut, min: 8 })); });
    },
    closing: function (P, sl, deck) {
      P.bg = { color: T.navy, grad: ["14205B", "2B3FD6"] };
      P.push(I((W - 3.2) / 2, 1.6, 3.2, 3.2 / T.logoAR, T.logoW));
      P.push(X(1, 3.2, W - 2, 1.0, sl.title || "Thank you", { size: 40, b: true, c: "FFFFFF", al: "c", va: "m", min: 18 }));
      if (sl.subtitle) P.push(X(1.5, 4.25, W - 3, 0.6, sl.subtitle, { size: 15, c: "C9D1FF", al: "c", min: 10 }));
      P.noFooter = true;
    }
  };
  LAYOUTS.bullets = LAYOUTS.messages;
  function chartCard(P, x, y, w, h, spec, cd) {
    P.push(R(x, y, w, h, T.white, { r: 0.14, shadow: true, line: T.line }));
    P.push(X(x + 0.25, y + 0.14, w - 0.5, 0.36, spec.title || cd.series.map(function (s) { return s.name; }).join(" vs "), { size: 12, b: true, c: T.navy, fit: false }));
    var kind = spec.kind || (cd.labels.length > 8 ? "bar" : "col");
    P.push(C(x + 0.15, y + 0.55, w - 0.3, h - 0.7, { kind: kind, labels: cd.labels, series: cd.series, colors: spec.colors || (cd.series.length > 1 ? T.pal : [T.blue]), pct: !!spec.pct }));
  }
  var DESCRIBE = {
    cover: "title slide: title, subtitle, up to 4 headline kpis",
    agenda: "agenda: items[{title,text}] (3-7), kicker (e.g. the year)",
    section: "section divider: kicker (e.g. \"02\"), title, subtitle",
    kpis: "headline numbers: kpis[{label,value,sub}] (3-6) + bullets (2-5 so-what points) + optional chart",
    chart: "one chart from a dataset + bullets (3-5 insights): chart{data,x,y[],kind(col|bar|line|pie|doughnut),top,sort,title}",
    ranking: "ranked bars (top states/models) + bullets: chart{data,x,y,top}",
    messages: "key messages: items[{title,text}] (3-6) — each a bold point with one supporting line",
    compare: "two columns: left{title,bullets}, right{title,bullets} (e.g. Today vs Next, Problem vs Solution)",
    timeline: "phases / quarters / roadmap: items[{tag,title,bullets,result}] (2-6)",
    cards: "projects / initiatives grid: items[{title,status(Live|Pilot|Upcoming|Done|Risk),text}] (2-9)",
    table: "table from a dataset: table{data,cols[],sort,top} + optional bullets",
    image: "a picture the person added: image (id) + bullets",
    asks: "decisions / support needed from management: items[{title,text}] (2-6), kicker",
    closing: "last slide: title, subtitle"
  };

  // ---------- build ----------
  function build(sl, deck, n, DS, IM) {
    var P = []; P.bg = { color: "FFFFFF" };
    var f = LAYOUTS[sl.layout] || LAYOUTS.messages;
    try { f(P, sl, deck || {}, DS || {}, IM || {}); } catch (e) { P.push(X(0.5, 3, 12, 1, "⚠ " + (e.message || e), { size: 14, c: T.red })); }
    if (!P.noFooter) footer(P, deck || {}, n);
    return P;
  }

  // ---------- HTML preview ----------
  function hx(c) { return "#" + c; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function svgChart(p) {
    var w = p.w * 100, h = p.h * 100, L = p.labels, S = p.series, col = function (i) { return hx(p.colors[i % p.colors.length]); }, o = [];
    var all = [].concat.apply([], S.map(function (s) { return s.values; })), max = Math.max.apply(null, all.concat([0])), min = Math.min.apply(null, all.concat([0])), rng = (max - min) || 1;
    if (p.kind === "pie" || p.kind === "doughnut") {
      var vals = S[0].values, tot = vals.reduce(function (a, b) { return a + Math.max(0, b); }, 0) || 1, cx = w * 0.36, cy = h / 2, r = Math.min(w * 0.3, h * 0.44), a0 = -Math.PI / 2;
      vals.forEach(function (v, i) { var a1 = a0 + 2 * Math.PI * Math.max(0, v) / tot, lg = a1 - a0 > Math.PI ? 1 : 0;
        o.push('<path d="M' + cx + "," + cy + " L" + (cx + r * Math.cos(a0)) + "," + (cy + r * Math.sin(a0)) + " A" + r + "," + r + " 0 " + lg + ",1 " + (cx + r * Math.cos(a1)) + "," + (cy + r * Math.sin(a1)) + ' Z" fill="' + col(i) + '"/>'); a0 = a1;
        o.push('<rect x="' + (w * 0.72) + '" y="' + (20 + i * 22) + '" width="12" height="12" rx="3" fill="' + col(i) + '"/><text x="' + (w * 0.72 + 18) + '" y="' + (30 + i * 22) + '" font-size="12" fill="#101533">' + esc(L[i]) + " · " + esc(fmt(v)) + "</text>"); });
      if (p.kind === "doughnut") o.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.55) + '" fill="#fff"/>');
      return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' + o.join("") + "</svg>";
    }
    var horiz = p.kind === "bar", pad = { l: horiz ? 110 : 40, r: 20, t: S.length > 1 ? 30 : 22, b: horiz ? 10 : 34 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, n = L.length, ns = S.length;
    if (S.length > 1) S.forEach(function (s, i) { o.push('<rect x="' + (pad.l + i * 120) + '" y="4" width="12" height="12" rx="3" fill="' + col(i) + '"/><text x="' + (pad.l + i * 120 + 17) + '" y="14" font-size="11" fill="#5A6592">' + esc(s.name).slice(0, 18) + "</text>"); });
    if (p.kind === "line") {
      for (var g = 0; g <= 4; g++) { var yy = pad.t + ih * g / 4; o.push('<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + yy + '" y2="' + yy + '" stroke="#E3E7F5"/>'); }
      S.forEach(function (s, si) { var pts = s.values.map(function (v, i) { return (pad.l + (n > 1 ? iw * i / (n - 1) : iw / 2)) + "," + (pad.t + ih - ih * (v - min) / rng); }); o.push('<polyline fill="none" stroke="' + col(si) + '" stroke-width="3" points="' + pts.join(" ") + '"/>'); s.values.forEach(function (v, i) { var px = pad.l + (n > 1 ? iw * i / (n - 1) : iw / 2), py = pad.t + ih - ih * (v - min) / rng; o.push('<circle cx="' + px + '" cy="' + py + '" r="4" fill="' + col(si) + '"/>'); if (ns === 1) o.push('<text x="' + px + '" y="' + (py - 8) + '" font-size="10" text-anchor="middle" fill="#14205B">' + esc(fmt(v)) + "</text>"); }); });
      L.forEach(function (l, i) { if (n > 12 && i % Math.ceil(n / 12)) return; o.push('<text x="' + (pad.l + (n > 1 ? iw * i / (n - 1) : iw / 2)) + '" y="' + (h - 14) + '" font-size="10" text-anchor="middle" fill="#5A6592">' + esc(String(l).slice(0, 10)) + "</text>"); });
    } else if (horiz) {
      var bh = ih / n;
      L.forEach(function (l, i) { o.push('<text x="' + (pad.l - 8) + '" y="' + (pad.t + bh * i + bh / 2 + 4) + '" font-size="' + Math.min(12, bh * 0.6) + '" text-anchor="end" fill="#101533">' + esc(String(l).slice(0, 16)) + "</text>");
        S.forEach(function (s, si) { var v = s.values[i], bw = iw * Math.max(0, v) / (max || 1), y = pad.t + bh * i + bh * 0.15 + si * (bh * 0.7 / ns); o.push('<rect x="' + pad.l + '" y="' + y + '" width="' + bw + '" height="' + (bh * 0.7 / ns) + '" rx="3" fill="' + col(si) + '"/>'); if (ns === 1) o.push('<text x="' + (pad.l + bw + 5) + '" y="' + (y + bh * 0.35 + 4) + '" font-size="' + Math.min(11, bh * 0.55) + '" fill="#14205B" font-weight="700">' + esc(fmt(v)) + "</text>"); }); });
    } else {
      var bwid = iw / n;
      for (var g2 = 0; g2 <= 4; g2++) { var y2 = pad.t + ih * g2 / 4; o.push('<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + y2 + '" y2="' + y2 + '" stroke="#E3E7F5"/>'); }
      L.forEach(function (l, i) { S.forEach(function (s, si) { var v = s.values[i], bh2 = ih * Math.max(0, v) / (max || 1), x = pad.l + bwid * i + bwid * 0.15 + si * (bwid * 0.7 / ns); o.push('<rect x="' + x + '" y="' + (pad.t + ih - bh2) + '" width="' + (bwid * 0.7 / ns) + '" height="' + bh2 + '" rx="3" fill="' + col(si) + '"/>'); if (ns === 1 && n <= 14) o.push('<text x="' + (x + bwid * 0.35) + '" y="' + (pad.t + ih - bh2 - 5) + '" font-size="10" text-anchor="middle" fill="#14205B" font-weight="700">' + esc(fmt(v)) + "</text>"); });
        if (n <= 16 || i % Math.ceil(n / 16) === 0) o.push('<text x="' + (pad.l + bwid * i + bwid / 2) + '" y="' + (h - 14) + '" font-size="10" text-anchor="middle" fill="#5A6592">' + esc(String(l).slice(0, 9)) + "</text>"); });
    }
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" style="font-family:' + T.fontCss + '">' + o.join("") + "</svg>";
  }
  function toHtml(P, flags) {
    var o = [], bg = P.bg || {};
    var bgcss = bg.img ? "background:url(" + bg.img + ") center/cover" : bg.grad ? "background:linear-gradient(135deg," + hx(bg.grad[0]) + "," + hx(bg.grad[1]) + ")" : "background:" + hx(bg.color || "FFFFFF");
    P.forEach(function (p) {
      var pos = "position:absolute;left:" + p.x * 100 + "px;top:" + p.y * 100 + "px;width:" + p.w * 100 + "px;height:" + p.h * 100 + "px;";
      if (p.t === "rect") o.push('<div style="' + pos + (p.grad ? "background:linear-gradient(135deg," + hx(p.grad[0]) + "," + hx(p.grad[1]) + ");" : "background:" + (p.fill ? hx(p.fill) : "transparent") + ";") + (p.alpha ? "opacity:" + (1 - p.alpha) + ";" : "") + (p.r ? "border-radius:" + p.r * 100 + "px;" : "") + (p.line ? "border:1px solid " + hx(p.line) + ";box-sizing:border-box;" : "") + (p.shadow ? "box-shadow:0 4px 14px rgba(20,32,91,.09);" : "") + '"></div>');
      else if (p.t === "text") {
        var bad = flags && flags.length && numsIn(p.s).some(function (m) { return flags.indexOf(m) >= 0; });
        o.push('<div style="' + pos + "display:flex;flex-direction:column;justify-content:" + ({ t: "flex-start", m: "center", b: "flex-end" }[p.va] || "flex-start") + ";text-align:" + ({ l: "left", c: "center", r: "right" }[p.al] || "left") + ";font-family:" + T.fontCss + ";font-size:" + p.size * 100 / 72 + "px;line-height:" + (p.lh || 1.2) + ";font-weight:" + (p.b ? 700 : 400) + ";color:" + hx(p.c || T.ink) + ";overflow:hidden;white-space:pre-wrap;word-wrap:break-word" + (bad ? ";background:rgba(255,196,0,.28);outline:1.5px dashed #E09B10" : "") + '">' + esc(p.s) + "</div>");
      } else if (p.t === "img") o.push('<img src="' + esc(p.src) + '" style="' + pos + "object-fit:" + (p.mode === "cover" ? "cover" : "contain") + '">');
      else if (p.t === "chart") o.push('<div style="' + pos + '">' + svgChart(p) + "</div>");
      else if (p.t === "table") {
        var rh = Math.min(0.5, p.h / (p.rows.length + 1)), fs = Math.min(12, rh * 26);
        o.push('<div style="' + pos + 'border-radius:14px;overflow:hidden;box-shadow:0 4px 14px rgba(20,32,91,.09);background:#fff"><table style="width:100%;border-collapse:collapse;font-family:' + T.fontCss + ";font-size:" + fs * 100 / 72 + 'px"><tr>' + p.head.map(function (h0) { return '<th style="background:#14205B;color:#fff;text-align:left;padding:0 10px;height:' + rh * 100 + 'px">' + esc(h0) + "</th>"; }).join("") + "</tr>" +
          p.rows.map(function (r, i) { return '<tr style="background:' + (i % 2 ? "#F6F7FC" : "#fff") + '">' + r.map(function (c) { return '<td style="padding:0 10px;height:' + rh * 100 + 'px;color:#101533">' + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table></div>");
      }
    });
    return '<div class="bislide" style="position:relative;width:1333px;height:750px;overflow:hidden;' + bgcss + '">' + o.join("") + "</div>";
  }

  // ---------- PowerPoint ----------
  function toDataUrl(src) {
    if (!src || /^data:/.test(src)) return Promise.resolve(src);
    return fetch(src).then(function (r) { return r.blob(); }).then(function (b) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); }); });
  }
  function addPptxSlide(X0, slideP, notes) {
    var s = X0.addSlide(), bg = slideP.bg || {};
    if (bg.imgData) s.background = { data: bg.imgData }; else s.background = { color: bg.grad ? bg.grad[0] : (bg.color || "FFFFFF") };
    if (bg.grad && !bg.imgData) s.addShape(X0.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: bg.grad[1], transparency: 55 }, line: { type: "none" } });
    slideP.forEach(function (p) {
      if (p.t === "rect") {
        var o = { x: p.x, y: p.y, w: p.w, h: p.h, fill: { color: p.grad ? p.grad[0] : (p.fill || "FFFFFF"), transparency: p.alpha ? Math.round(p.alpha * 100) : 0 }, line: p.line ? { color: p.line, width: 0.75 } : { type: "none" } };
        if (p.r) o.rectRadius = Math.min(p.r, Math.min(p.w, p.h) / 2);
        if (p.shadow) o.shadow = { type: "outer", color: "14205B", opacity: 0.12, blur: 8, offset: 2, angle: 90 };
        s.addShape(p.r ? X0.ShapeType.roundRect : X0.ShapeType.rect, o);
      } else if (p.t === "text") {
        s.addText(String(p.s == null ? "" : p.s), { x: p.x, y: p.y, w: p.w, h: p.h, fontFace: T.font, fontSize: p.size, bold: !!p.b, color: p.c || T.ink, align: { l: "left", c: "center", r: "right" }[p.al] || "left", valign: { t: "top", m: "middle", b: "bottom" }[p.va] || "top", margin: 0.03, lineSpacingMultiple: p.lh || 1.1, fit: "shrink", wrap: true });
      } else if (p.t === "img" && p.data) {
        s.addImage({ data: p.data, x: p.x, y: p.y, w: p.w, h: p.h, sizing: { type: p.mode === "cover" ? "cover" : "contain", w: p.w, h: p.h } });
      } else if (p.t === "chart") {
        var ct = { col: "bar", bar: "bar", line: "line", pie: "pie", doughnut: "doughnut" }[p.kind] || "bar";
        var data = p.series.map(function (sr) { return { name: sr.name, labels: p.labels.map(String), values: sr.values }; });
        var o2 = { x: p.x, y: p.y, w: p.w, h: p.h, chartColors: p.colors, showLegend: p.series.length > 1 || ct === "pie" || ct === "doughnut", legendPos: ct === "pie" || ct === "doughnut" ? "r" : "t", legendFontSize: 10, legendFontFace: T.font,
          catAxisLabelFontSize: 10, valAxisLabelFontSize: 9, catAxisLabelFontFace: T.font, valAxisLabelFontFace: T.font, catAxisLabelColor: T.mut, valAxisLabelColor: T.mut, valGridLine: { color: T.line, size: 0.5 }, catGridLine: { style: "none" },
          showValue: p.series.length === 1 && p.labels.length <= 14, dataLabelFontSize: 9, dataLabelColor: T.navy, dataLabelFontBold: true };
        if (ct === "bar") { o2.barDir = p.kind === "bar" ? "bar" : "col"; o2.barGapWidthPct = 60; if (p.kind === "bar") o2.catAxisOrientation = "maxMin"; }
        if (ct === "line") { o2.lineSize = 3; o2.lineDataSymbolSize = 7; }
        if (ct === "doughnut") o2.holeSize = 55;
        s.addChart(X0.ChartType[ct], data, o2);
      } else if (p.t === "table") {
        var rh = Math.min(0.5, p.h / (p.rows.length + 1)), fs = Math.min(12, rh * 26);
        var rows = [p.head.map(function (h0) { return { text: String(h0), options: { bold: true, color: "FFFFFF", fill: { color: T.navy } } }; })].concat(p.rows.map(function (r, i) { return r.map(function (c) { return { text: String(c), options: { color: T.ink, fill: { color: i % 2 ? "F6F7FC" : "FFFFFF" } } }; }); }));
        s.addTable(rows, { x: p.x, y: p.y, w: p.w, rowH: rh, fontFace: T.font, fontSize: fs, border: { type: "solid", color: T.line, pt: 0.5 }, valign: "middle", margin: 0.06 });
      }
    });
    if (notes) s.addNotes(String(notes));
  }
  function pptx(deck, slides, DS, IM, fileName) {
    var built = slides.map(function (sl, i) { return build(sl, deck, i + 1, DS, IM); });
    var srcs = {};
    built.forEach(function (P) { if (P.bg && P.bg.img) srcs[P.bg.img] = 1; P.forEach(function (p) { if (p.t === "img" && p.src) srcs[p.src] = 1; }); });
    var keys = Object.keys(srcs);
    return Promise.all(keys.map(toDataUrl)).then(function (urls) {
      var M = {}; keys.forEach(function (k, i) { M[k] = urls[i]; });
      built.forEach(function (P) { if (P.bg && P.bg.img) P.bg.imgData = M[P.bg.img]; P.forEach(function (p) { if (p.t === "img") p.data = M[p.src]; }); });
      var X0 = new window.PptxGenJS(); X0.layout = "LAYOUT_WIDE"; X0.author = "vivo Business Innovation"; X0.company = "vivo India"; X0.title = deck.title || "Deck";
      built.forEach(function (P, i) { addPptxSlide(X0, P, slides[i].notes); });
      return X0.write({ outputType: "blob" });
    });
  }

  // ---------- numbers guard: every number in the words must come from the material ----------
  function numsIn(text) { return (String(text || "").match(/[₹]?\d[\d,]*(\.\d+)?\s?(%|k|K|L|lakh|Cr|crore|pts|x)?/g) || []).map(function (m) { return m.trim(); }); }
  function valOf(m) { var u = (m.match(/(%|k|K|L|lakh|Cr|crore)$/) || [""])[0], v = parseFloat(m.replace(/[₹,\s]|%|k|K|L|lakh|Cr|crore|pts|x/g, "")); if (!isFinite(v)) return []; var o = [v]; if (/^k$/i.test(u)) o.push(v * 1000); if (/^(L|lakh)$/.test(u)) o.push(v * 1e5); if (/^(Cr|crore)$/.test(u)) o.push(v * 1e7); return o; }
  function allowedSet(material) {
    var S = [];
    numsIn(material.text || "").forEach(function (m) { S = S.concat(valOf(m)); });
    Object.keys(material.DS || {}).forEach(function (k) { (material.DS[k].rows || []).forEach(function (r) { r.forEach(function (c) { var v = num(c); if (v != null) S.push(v); }); }); (material.DS[k].facts || []).forEach(function (v) { S.push(v); }); });
    return S;
  }
  function numCheck(slide, allowed) {
    allowed = allowed.concat([100]);   // "out of 100", "100%" are scales, not claims
    var words = [slide.title, slide.subtitle, slide.kicker, slide.subtitle2].concat(slide.bullets || [], (slide.kpis || []).map(function (k) { return k.value + " " + (k.sub || ""); }), (slide.items || []).map(function (q) { return [q.title, q.text, q.result].concat(q.bullets || []).join(" "); }), slide.left ? [slide.left.title].concat(slide.left.bullets || []) : [], slide.right ? [slide.right.title].concat(slide.right.bullets || []) : []).join("\n");
    var bad = [];
    words = words.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-' ]\d{2}\b/g, "$1").replace(/\bQ[1-4]\b|\bH[12]\b|\bFY\s?\d{2,4}/g, "");   // dates like Nov-26, Q3, FY27
    numsIn(words).forEach(function (m) {
      var vs = valOf(m); if (!vs.length) return; var v = vs[0];
      if (/^(19|20)\d\d$/.test(String(v)) || (v <= 12 && !/%/.test(m) && (!/\./.test(m) || /\.0$/.test(m)))) return;   // years and small counts (Q1, 3 states…)
      var ok = allowed.some(function (a) { return vs.some(function (x) { return Math.abs(a - x) <= Math.max(0.051, Math.abs(a) * 0.006); }); });
      if (!ok && bad.indexOf(m) < 0) bad.push(m);
    });
    return bad;
  }

  window.BIDECK = { W: W, H: H, T: T, LAYOUTS: LAYOUTS, DESCRIBE: DESCRIBE, build: build, toHtml: toHtml, pptx: pptx, chartData: chartData, tableData: tableData, numCheck: numCheck, allowedSet: allowedSet, fmt: fmt, num: num, fit: fit };
})();
