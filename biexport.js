/* biexport.js: turns any rendered page into
   • an editable PowerPoint: native text boxes, shapes and pictures placed exactly where they are on screen, split across N slides at safe lines
     (never through text or a picture), N suggested and editable;
   • an editable Word file: headings, paragraphs, tables (tiles / rows become table cells) and pictures, in reading order;
   • a paged PDF that cuts only between items (no lines through text).
   Used by the Monthly one-pager, the BI newsletter and the HO creative. Works in the web portal and both apps (AndroidDL download bridge). */
(function () {
  "use strict";
  if (window.BIEXPORT) return;
  var LIB = { pptx: ["/vendor/pptx/pptxgen.bundle.js", function () { return !!window.PptxGenJS; }], zip: ["/vendor/jszip.min.js", function () { return !!window.JSZip; }], h2i: ["/vendor/html-to-image.js", function () { return !!window.htmlToImage; }], pdf: ["/vendor/jspdf/jspdf.umd.min.js", function () { return !!(window.jspdf && window.jspdf.jsPDF); }] };
  function lib(k) { var L = LIB[k]; return new Promise(function (res, rej) { if (L[1]()) return res(); var s = document.createElement("script"); s.src = L[0]; s.onload = function () { L[1]() ? res() : rej(new Error("Could not load " + k)); }; s.onerror = function () { rej(new Error("Could not load " + L[0])); }; document.head.appendChild(s); }); }
  var MIME = { pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf" };
  function save(blob, name) {
    if (window.AndroidDL && window.AndroidDL.save) { var fr = new FileReader(); fr.onload = function () { var d = String(fr.result); window.AndroidDL.save(d.slice(d.indexOf(",") + 1), name, blob.type || ""); }; fr.readAsDataURL(blob); return; }
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var xe = function (s) { return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // ---------- colours ----------
  function col(s) { // -> {hex, a} or null when invisible
    s = String(s || "").trim(); if (!s || s === "transparent") return null; var m = /rgba?\(([^)]+)\)/.exec(s); if (!m) { if (/^#[0-9a-f]{6}$/i.test(s)) return { hex: s.slice(1).toUpperCase(), a: 1 }; return null; }
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat), a = p.length > 3 ? p[3] : 1; if (!(a > 0.03)) return null;
    return { hex: p.slice(0, 3).map(function (v) { return ("0" + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join("").toUpperCase(), a: a };
  }
  function firstGrad(s) { var m = /rgba?\([^)]+\)|#[0-9a-f]{6}/i.exec(String(s || "")); return m ? col(m[0]) : null; }
  function lum(hex) { var n = parseInt(hex, 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  function mix(c, bgHex) { if (!c) return null; if (c.a >= 0.98 || !bgHex) return c.hex; var a = c.a, n = parseInt(c.hex, 16), m = parseInt(bgHex, 16), o = [16, 8, 0].map(function (s) { return Math.round(((n >> s) & 255) * a + ((m >> s) & 255) * (1 - a)); }); return o.map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("").toUpperCase(); }
  function font(ff) { var f = String(ff || "").split(",")[0].replace(/["']/g, "").trim(); if (!f || /system-ui|apple|BlinkMac|sans-serif|^Inter$|Roboto|Helvetica|Noto Sans/i.test(f)) return "Segoe UI"; if (/^serif$|Times|Playfair|DM Serif|Merriweather|Lora/i.test(f)) return "Georgia"; if (/mono/i.test(f)) return "Consolas"; return f; }

  // ---------- pictures ----------
  function loadImg(src) { return new Promise(function (res) { var i = new Image(); i.decoding = "sync"; i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; }); }
  function blobUrl(src) { return fetch(src, { credentials: "same-origin" }).then(function (r) { return r.blob(); }).then(function (b) { return URL.createObjectURL(b); }).catch(function () { return null; }); }
  // the picture exactly as shown: object-fit and rounded / round corners baked in
  function rasterImg(el, w, h, cs) {
    var src = el.currentSrc || el.src; if (!src || w < 2 || h < 2) return Promise.resolve(null);
    var go = function (im) { if (!im || !im.naturalWidth) return null; var k = Math.min(2, 1600 / Math.max(w, h)), W = Math.max(2, Math.round(w * k)), H = Math.max(2, Math.round(h * k)), c = document.createElement("canvas"); c.width = W; c.height = H; var g = c.getContext("2d"), r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2) * k;
      if (r > 0) { g.beginPath(); if (g.roundRect) g.roundRect(0, 0, W, H, r); else g.rect(0, 0, W, H); g.clip(); }
      var iw = im.naturalWidth, ih = im.naturalHeight, fit = cs.objectFit || "fill", dx = 0, dy = 0, dw = W, dh = H;
      if (fit === "cover" || fit === "contain") { var s = fit === "cover" ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih); dw = iw * s; dh = ih * s; dx = (W - dw) / 2; dy = (H - dh) / 2; }
      g.drawImage(im, dx, dy, dw, dh); try { return { src: c.toDataURL(r > 0 || /png|svg|webp|gif/i.test(src.slice(0, 30)) ? "image/png" : "image/jpeg", 0.9), pw: W, ph: H }; } catch (e) { return "taint"; } };
    return loadImg(src).then(function (im) { var o = go(im); if (o !== "taint") return o; return blobUrl(src).then(function (u) { if (!u) return null; return loadImg(u).then(function (i2) { var o2 = go(i2); URL.revokeObjectURL(u); return o2 === "taint" ? null : o2; }); }); });
  }
  function rasterNode(el, w, h, extra) { return lib("h2i").then(function () { return window.htmlToImage.toPng(el, Object.assign({ pixelRatio: Math.min(2, 1800 / Math.max(w, h, 1)), cacheBust: false, skipFonts: true, width: w, height: h }, extra || {})); }).then(function (d) { return d && d.length > 200 ? { src: d } : null; }).catch(function () { return null; }); }
  function rasterSvg(el, w, h) {
    // inline the computed paint so CSS classes survive, then draw the SVG as a picture
    try { var cl = el.cloneNode(true), a = el.querySelectorAll("*"), b = cl.querySelectorAll("*"), P = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline", "fill-opacity", "stroke-opacity", "stroke-linecap"];
      for (var i = 0; i < a.length && i < 4000; i++) { var c = getComputedStyle(a[i]); P.forEach(function (p) { var v = c.getPropertyValue(p); if (v && !b[i].getAttribute(p)) b[i].setAttribute(p, v); }); }
      var c0 = getComputedStyle(el); cl.setAttribute("width", w); cl.setAttribute("height", h); cl.setAttribute("xmlns", "http://www.w3.org/2000/svg"); if (!cl.getAttribute("font-family")) cl.setAttribute("font-family", c0.fontFamily); if (!cl.getAttribute("color")) cl.setAttribute("color", c0.color); cl.style.color = c0.color;
      var s = new XMLSerializer().serializeToString(cl), u = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
      return loadImg(u).then(function (im) { if (!im) return rasterNode(el, w, h); var k = Math.min(3, 2000 / Math.max(w, h)), c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); return { src: c.toDataURL("image/png") }; });
    } catch (e) { return rasterNode(el, w, h); }
  }
  function rasterBg(el, cs, w, h) {
    var d = document.createElement("div"), host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-30000px;top:0;pointer-events:none"; d.style.cssText = "width:" + w + "px;height:" + h + "px;border-radius:" + cs.borderRadius + ";background-color:" + cs.backgroundColor + ";background-image:" + cs.backgroundImage + ";background-size:" + cs.backgroundSize + ";background-position:" + cs.backgroundPosition + ";background-repeat:" + cs.backgroundRepeat;
    host.appendChild(d); document.body.appendChild(host);
    return rasterNode(d, w, h).then(function (r) { host.remove(); return r; }, function () { host.remove(); return null; });
  }

  // ---------- read the page ----------
  var INLINE = { inline: 1, contents: 1 };
  function visible(el, cs) { return cs.display !== "none" && cs.visibility !== "hidden" && !(parseFloat(cs.opacity) < 0.05) && !(el.matches && el.matches("[data-noexp],script,style,noscript,template,link,meta,input[type=file],input[type=hidden],.noexp")); }
  function hasPaint(cs) { var bw = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderRightWidth) + parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderLeftWidth); return !!col(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== "none") || bw > 0.4; }
  function inlineOnly(el, deep) { // only text and plain inline elements inside (one text box with mixed formatting)
    var ok = true, any = false;
    (function walk(n, d) { for (var c = n.firstChild; c && ok; c = c.nextSibling) {
      if (c.nodeType === 3) { if (/\S/.test(c.nodeValue)) any = true; continue; } if (c.nodeType !== 1) continue; var t = c.tagName;
      if (t === "BR") continue; if (/^(IMG|SVG|CANVAS|VIDEO|INPUT|SELECT|TEXTAREA|TABLE|IFRAME|svg)$/.test(t)) { ok = false; return; }
      var cs = getComputedStyle(c); if (cs.display === "none") continue; if (!INLINE[cs.display] || hasPaint(cs) || cs.position === "absolute" || cs.position === "fixed") { ok = false; return; } walk(c, d + 1); } })(el, 0);
    return ok && any;
  }
  function runsOf(el, base) {
    var R = [];
    (function walk(n, cs) { for (var c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { var t = c.nodeValue, ws = cs.whiteSpace; if (!/^pre/.test(ws)) t = t.replace(/\s+/g, " "); if (!t) continue; var tt = cs.textTransform; if (tt === "uppercase") t = t.toUpperCase(); else if (tt === "lowercase") t = t.toLowerCase(); else if (tt === "capitalize") t = t.replace(/\b\w/g, function (x) { return x.toUpperCase(); });
        R.push({ t: t, b: (parseInt(cs.fontWeight, 10) || 400) >= 600, i: cs.fontStyle === "italic", u: /underline/.test(cs.textDecorationLine || cs.textDecoration || ""), c: col(cs.color), px: parseFloat(cs.fontSize) || 14, f: font(cs.fontFamily) }); }
      else if (c.nodeType === 1) { if (c.tagName === "BR") { R.push({ t: "\n", br: 1, px: parseFloat(cs.fontSize) || 14 }); continue; } var cc = getComputedStyle(c); if (cc.display === "none" || cc.visibility === "hidden") continue; walk(c, cc); } } })(el, base);
    // trim edges and collapse doubled spaces between runs
    for (var i = 1; i < R.length; i++) if (/ $/.test(R[i - 1].t) && /^ /.test(R[i].t)) R[i].t = R[i].t.slice(1);
    while (R.length && !/\S/.test(R[0].t) && !R[0].br) R.shift(); while (R.length && !/\S/.test(R[R.length - 1].t)) R.pop();
    if (R.length) { R[0].t = R[0].t.replace(/^\s+/, ""); R[R.length - 1].t = R[R.length - 1].t.replace(/\s+$/, ""); }
    return R.filter(function (r) { return r.t; });
  }
  function textRect(node) { var r = document.createRange(); r.selectNodeContents(node); var L = Array.from(r.getClientRects()).filter(function (q) { return q.width > 0.5 && q.height > 0.5; }); if (!L.length) return null; var o = { l: 1e9, t: 1e9, r: -1e9, b: -1e9 }; L.forEach(function (q) { o.l = Math.min(o.l, q.left); o.t = Math.min(o.t, q.top); o.r = Math.max(o.r, q.right); o.b = Math.max(o.b, q.bottom); }); return o; }

  /** capture(root) -> {W, H, bg, items:[box|img|txt]} in page px (unscaled), in paint order */
  function capture(root) {
    var R0 = root.getBoundingClientRect(), K = R0.width / (root.offsetWidth || R0.width) || 1, X = function (v) { return (v - R0.left) / K; }, Y = function (v) { return (v - R0.top) / K; };
    var items = [], jobs = [], W = root.scrollWidth || root.offsetWidth, H = Math.max(root.scrollHeight, root.offsetHeight);
    var rbg = null; for (var e = root; e && e.nodeType === 1 && !rbg; e = e.parentElement) { var ec = getComputedStyle(e); rbg = col(ec.backgroundColor) || firstGrad(ec.backgroundImage); }
    var bgHex = rbg ? rbg.hex : "FFFFFF";
    function inClip(r, clip) { return !clip || (r.r > clip.l + 1 && r.l < clip.r - 1 && r.b > clip.t + 1 && r.t < clip.b - 1); }
    function clipR(r, clip) { if (!clip) return r; return { l: Math.max(r.l, clip.l), t: Math.max(r.t, clip.t), r: Math.min(r.r, clip.r), b: Math.min(r.b, clip.b) }; }
    function pushTxt(rr, runs, cs, el, clip) {
      if (!rr || !runs.length || !inClip(rr, clip)) return; var cb = el.getBoundingClientRect(), pl = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), pr = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth), cl = cb.left + pl * K, cr = cb.right - pr * K, al = cs.textAlign;
      al = /center/.test(al) ? "ctr" : /right|end/.test(al) ? "r" : "l"; var lh = parseFloat(cs.lineHeight), px = parseFloat(cs.fontSize) || 14; if (!(lh > 0)) lh = px * 1.25;
      var x0, x1; if (al === "ctr") { x0 = Math.min(rr.l, cl); x1 = Math.max(rr.r, cr); } else if (al === "r") { x0 = Math.min(cl, rr.l); x1 = rr.r; } else { x0 = rr.l; x1 = Math.max(rr.r, cr); }
      if (cs.position === "absolute" || (x1 - x0) > (rr.r - rr.l) * 4 + 40) { x0 = al === "l" ? rr.l : x0; x1 = al === "r" ? rr.r : x1; }
      var hh = (rr.b - rr.t) / K, one = hh < lh * 1.55;
      if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) { var keep = Math.max(3, Math.floor(runs.reduce(function (a, r) { return a + r.t.length; }, 0) * el.clientWidth / el.scrollWidth) - 1), n = 0; runs = runs.map(function (r) { var o = Object.assign({}, r), room = keep - n; n += r.t.length; if (room <= 0) o.t = ""; else if (r.t.length > room) o.t = r.t.slice(0, room).trimEnd() + "…"; return o; }).filter(function (r) { return r.t; }); }
      runs.forEach(function (r) { if (!r.c) r.c = { hex: "111111", a: 1 }; });
      items.push({ t: "txt", x: X(x0), y: Y(rr.t), w: (x1 - x0) / K, h: hh, runs: runs, al: al, lh: lh, one: one, px: px });
    }
    function visit(el, clip, depth) {
      if (depth > 60) return; var cs = getComputedStyle(el); if (!visible(el, cs)) return;
      var b = el.getBoundingClientRect(), r = { l: b.left, t: b.top, r: b.right, b: b.bottom }, w = b.width / K, h = b.height / K, tag = el.tagName, sized = w >= 1 && h >= 1;
      if (sized && el !== root && inClip(r, clip) && !(cs.display === "inline" && !hasPaint(cs))) {
        var c = clipR(r, clip), bx = { x: X(c.l), y: Y(c.t), w: (c.r - c.l) / K, h: (c.b - c.t) / K }, rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
        var fill = col(cs.backgroundColor), bimg = cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : "";
        var bws = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat), bcs = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(col), sty = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
        var on = bws.map(function (v, i) { return v > 0.4 && bcs[i] && sty[i] !== "none" && sty[i] !== "hidden"; }), all = on[0] && on[1] && on[2] && on[3] && bcs.every(function (q) { return q.hex === bcs[0].hex; }) && bws.every(function (q) { return Math.abs(q - bws[0]) < 0.6; });
        if (bimg && tag !== "IMG") { var it = { t: "img", x: bx.x, y: bx.y, w: bx.w, h: bx.h, bg: 1 }; items.push(it); jobs.push(rasterBg(el, cs, Math.round(w), Math.round(h)).then(function (q) { if (q) it.src = q.src; else { var g = firstGrad(bimg); if (g) { it.t = "box"; it.fill = g; it.r = rad; } } })); fill = null; }
        if (fill || all) items.push({ t: "box", x: bx.x, y: bx.y, w: bx.w, h: bx.h, fill: fill, line: all ? { hex: mix(bcs[0], bgHex), w: bws[0] } : null, dash: all && sty[0] === "dashed", r: rad, ell: rad >= Math.min(w, h) / 2 - 0.5 && Math.abs(w - h) < 2 });
        if (!all) on.forEach(function (o, i) { if (!o) return; var v = bws[i], q = bcs[i], hx = mix(q, bgHex); if (i === 0) items.push({ t: "box", x: bx.x, y: bx.y, w: bx.w, h: v, fill: { hex: hx, a: 1 } }); if (i === 2) items.push({ t: "box", x: bx.x, y: bx.y + bx.h - v, w: bx.w, h: v, fill: { hex: hx, a: 1 } }); if (i === 3) items.push({ t: "box", x: bx.x, y: bx.y, w: v, h: bx.h, fill: { hex: hx, a: 1 } }); if (i === 1) items.push({ t: "box", x: bx.x + bx.w - v, y: bx.y, w: v, h: bx.h, fill: { hex: hx, a: 1 } }); });
      }
      if (tag === "IMG") { if (sized && inClip(r, clip)) { var im = { t: "img", x: X(b.left), y: Y(b.top), w: w, h: h }; items.push(im); jobs.push(rasterImg(el, w, h, cs).then(function (q) { if (q) im.src = q.src; })); } return; }
      if (tag === "svg" || tag === "SVG" || el instanceof SVGElement) { if (sized && inClip(r, clip)) { var sv = { t: "img", x: X(b.left), y: Y(b.top), w: w, h: h }; items.push(sv); jobs.push(rasterSvg(el, Math.round(w), Math.round(h)).then(function (q) { if (q) sv.src = q.src; })); } return; }
      if (tag === "CANVAS") { if (sized) { try { items.push({ t: "img", x: X(b.left), y: Y(b.top), w: w, h: h, src: el.toDataURL("image/png") }); } catch (e) {} } return; }
      if (tag === "IFRAME" || tag === "VIDEO") return;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") { var v = tag === "SELECT" ? (el.options[el.selectedIndex] || {}).text : el.type === "checkbox" || el.type === "radio" ? (el.checked ? "☑" : "☐") : el.value || el.placeholder || ""; if (v && sized) items.push({ t: "txt", x: X(b.left) + 6, y: Y(b.top) + Math.max(0, (h - parseFloat(cs.fontSize) * 1.3) / 2), w: w - 8, h: Math.min(h, parseFloat(cs.fontSize) * 1.4), runs: [{ t: v, c: col(cs.color) || { hex: "111111", a: 1 }, px: parseFloat(cs.fontSize) || 14, f: font(cs.fontFamily) }], al: "l", lh: parseFloat(cs.fontSize) * 1.3, one: tag !== "TEXTAREA", px: parseFloat(cs.fontSize) }); return; }
      var nclip = clip; if (el !== root && (cs.overflowX !== "visible" || cs.overflowY !== "visible") && sized) nclip = clip ? clipR(r, clip) : r;
      if (inlineOnly(el)) { pushTxt(textRect(el), runsOf(el, cs), cs, el, nclip); return; }
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { if (/\S/.test(c.nodeValue)) { var tmp = document.createElement("span"); /* measure just this text */ var rg = document.createRange(); rg.selectNodeContents(c); var L = Array.from(rg.getClientRects()).filter(function (q) { return q.width > 0.5; }); if (!L.length) continue; var o = { l: 1e9, t: 1e9, r: -1e9, b: -1e9 }; L.forEach(function (q) { o.l = Math.min(o.l, q.left); o.t = Math.min(o.t, q.top); o.r = Math.max(o.r, q.right); o.b = Math.max(o.b, q.bottom); });
          var t = c.nodeValue.replace(/\s+/g, " ").trim(), tt = cs.textTransform; if (tt === "uppercase") t = t.toUpperCase(); pushTxt(o, [{ t: t, b: (parseInt(cs.fontWeight, 10) || 400) >= 600, i: cs.fontStyle === "italic", c: col(cs.color), px: parseFloat(cs.fontSize) || 14, f: font(cs.fontFamily) }], cs, el, nclip); } }
        else if (c.nodeType === 1) visit(c, nclip, depth + 1);
      }
    }
    visit(root, null, 0);
    return Promise.all(jobs).then(function () { return { W: W, H: H, bg: bgHex, items: items.filter(function (i) { return i.t !== "img" || i.src; }) }; });
  }

  // ---------- where the page can be cut (between items, never through text or a picture) ----------
  function cutsOf(cap) {
    var at = cap.items.filter(function (i) { return i.t === "txt" || i.t === "img" || (i.t === "box" && i.h < 140 && i.w < cap.W * 0.97); }).map(function (i) { return [i.y + 0.5, i.y + i.h - 0.5]; }).sort(function (a, b) { return a[0] - b[0]; });
    var M = []; at.forEach(function (a) { var L = M[M.length - 1]; if (L && a[0] <= L[1]) L[1] = Math.max(L[1], a[1]); else M.push([a[0], a[1]]); });
    var big = cap.items.filter(function (i) { return i.t === "box" && i.h >= 60 && i.w > cap.W * 0.2; });
    // a short text-only run just above a gap is a heading: never leave it alone at the bottom of a slide
    var solid = cap.items.filter(function (i) { return i.t === "img" || (i.t === "box" && i.h < 140 && i.w < cap.W * 0.97); });
    var isHead = function (m) { return m && m[1] - m[0] < 70 && !solid.some(function (i) { return i.y + 0.5 >= m[0] - 1 && i.y + i.h - 0.5 <= m[1] + 1; }); };
    var C = [], prev = 0, last = null; M.forEach(function (m) { if (m[0] > prev + 1) { var c = cand(prev, m[0]); c.head = isHead(last) && m[0] - prev < 90; C.push(c); } prev = Math.max(prev, m[1]); last = m; }); if (cap.H > prev + 1) C.push(cand(prev, cap.H));
    function cand(a, b) { var best = null; [(a + b) / 2].concat(big.reduce(function (l, i) { [[i.y, -8], [i.y + i.h, 8]].forEach(function (e) { if (e[0] >= a - 1 && e[0] <= b + 1) l.push(Math.max(a, Math.min(b, e[0] + e[1] * Math.min(1, (b - a) / 24)))); }); return l; }, [])).forEach(function (y) { var cross = big.filter(function (i) { return i.y < y - 2 && i.y + i.h > y + 2; }).length; var edge = y !== (a + b) / 2; if (!best || cross < best.cross || (cross === best.cross && edge && !best.edge)) best = { y: y, cross: cross, edge: edge }; }); return { y: best.y, cross: best.cross, edge: best.edge, gap: b - a }; }
    return C.filter(function (c) { return c.y > 4 && c.y < cap.H - 4; });
  }
  function greedy(C, H, L) { var out = [], y = 0; while (H - y > L + 0.5) { var best = null; C.forEach(function (c) { if (c.y > y + 2 && c.y <= y + L) { var sc = (c.y - y) / L - c.cross * 0.18 + Math.min(c.gap, 40) / 400 + (c.edge && !c.cross ? 0.12 : 0); if (!best || sc > best.sc) best = { y: c.y, sc: sc }; } }); if (!best) { var nx = C.find(function (c) { return c.y > y + 2; }); if (!nx) break; best = { y: nx.y }; } out.push([y, best.y]); y = best.y; } out.push([y, H]); return out; }
  function bandsFor(cap, n, C) {
    C = C || cutsOf(cap); var H = cap.H; if (n <= 1 || !C.length) return [[0, H]];
    var lo = 1, hi = H, B = [[0, H]]; for (var k = 0; k < 30; k++) { var mid = (lo + hi) / 2, g = greedy(C, H, mid); if (g.length <= n) { hi = mid; B = g; } else lo = mid; }
    // balance: pick exactly n bands of similar height (no near-empty last slide), avoiding cuts through boxes and after headings
    var L = hi * 1.08, T = H / n, P = [{ y: 0, pen: 0 }].concat(C.slice().sort(function (a, b) { return a.y - b.y; }).map(function (c) { return { y: c.y, pen: c.cross * 0.35 + (c.head ? 0.9 : 0) - (c.edge && !c.cross ? 0.05 : 0) }; })).concat([{ y: H, pen: 0 }]), Q = P.length, INF = 1e18;
    var f = [], from = []; for (var b = 0; b <= n; b++) { f.push(new Array(Q).fill(INF)); from.push(new Array(Q).fill(-1)); } f[0][0] = 0;
    for (b = 1; b <= n; b++) for (var j = 1; j < Q; j++) for (var i = j - 1; i >= 0; i--) { var h = P[j].y - P[i].y; if (h > L) break; if (f[b - 1][i] >= INF) continue; var v = f[b - 1][i] + Math.pow((h - T) / L, 2) + (j < Q - 1 ? P[j].pen : 0); if (v < f[b][j]) { f[b][j] = v; from[b][j] = i; } }
    var bb = -1; for (b = 1; b <= n; b++) if (f[b][Q - 1] < INF && (bb < 0 || b > bb)) bb = b; if (bb < 0) return B;
    var out = [], j2 = Q - 1; for (b = bb; b >= 1; b--) { var i2 = from[b][j2]; out.unshift([P[i2].y, P[j2].y]); j2 = i2; } return out;
  }
  function geo(shape) { return shape === "portrait" ? { w: 8.27, h: 11.69, m: 0.35, name: "A4P" } : { w: 13.333, h: 7.5, m: 0.3, name: "LAYOUT_WIDE" }; }
  function suggest(cap, shape, C) { var G = geo(shape), uw = G.w - 2 * G.m, uh = G.h - 2 * G.m - 0.2; return greedy(C || cutsOf(cap), cap.H, uh * cap.W / uw * 1.04).length; }
  function scaleOf(cap, band, G) { var uw = G.w - 2 * G.m, uh = G.h - 2 * G.m - 0.2; return Math.min(uw / cap.W, uh / Math.max(1, band[1] - band[0])); }
  function minPt(cap, B, G) { var m = 99; B.forEach(function (b) { var s = scaleOf(cap, b, G); cap.items.forEach(function (i) { if (i.t === "txt" && i.y >= b[0] - 1 && i.y < b[1]) m = Math.min(m, i.px * s * 72); }); }); return Math.round(m * 10) / 10; }
  function inBand(i, b) { if (i.t === "box" && !(i.h < 140)) return i.y < b[1] && i.y + i.h > b[0]; var cy = i.y + Math.min(i.h, 40) / 2; return cy >= b[0] && cy < b[1]; }

  // ---------- PowerPoint ----------
  function pptx(cap, n, shape, meta) {
    return lib("pptx").then(function () {
      var P = new window.PptxGenJS(), G = geo(shape), B = bandsFor(cap, n), ST = P.ShapeType || P.shapes || {};
      if (shape === "portrait") P.defineLayout({ name: "A4P", width: G.w, height: G.h }); P.layout = G.name; P.title = (meta && meta.title) || "vivo BI"; P.company = "vivo Business Innovation";
      B.forEach(function (b, si) { drawSlide(P, ST, cap, b, G, si, B.length); });
      return P.write({ outputType: "blob" }).then(function (bl) { return { blob: new Blob([bl], { type: MIME.pptx }), n: B.length }; });
    });
  }
  // one slide per captured page (used by the one-pager's AI-arranged slides) — each fitted and centred on its slide
  function pptxPages(caps, shape, meta) {
    return lib("pptx").then(function () {
      var P = new window.PptxGenJS(), G = geo(shape), ST = P.ShapeType || P.shapes || {};
      if (shape === "portrait") P.defineLayout({ name: "A4P", width: G.w, height: G.h }); P.layout = G.name; P.title = (meta && meta.title) || "vivo BI"; P.company = "vivo Business Innovation";
      caps.forEach(function (cap, si) { drawSlide(P, ST, cap, [0, cap.H], G, si, caps.length, true); });
      return P.write({ outputType: "blob" }).then(function (bl) { return { blob: new Blob([bl], { type: MIME.pptx }), n: caps.length }; });
    });
  }
  function drawSlide(P, ST, cap, b, G, si, total, centre) {
        var s = scaleOf(cap, b, G), ox = G.m + ((G.w - 2 * G.m) - cap.W * s) / 2, oy = centre ? Math.max(G.m, (G.h - (b[1] - b[0]) * s) / 2 - 0.05) : G.m, S = P.addSlide(); S.background = { color: cap.bg };
        var px = function (v) { return v * s; }, ptOf = function (v) { return Math.max(4, Math.round(v * s * 72 * 10) / 10); };
        cap.items.forEach(function (i) { if (!inBand(i, b)) return;
          var y0 = Math.max(i.y, b[0]), y1 = i.t === "box" ? Math.min(i.y + i.h, b[1]) : i.y + i.h, x = ox + px(i.x), y = oy + px(y0 - b[0]), w = Math.max(0.01, px(i.w)), h = Math.max(0.01, px(y1 - y0));
          if (i.t === "box") { var o = { x: x, y: y, w: w, h: h, fill: i.fill ? { color: i.fill.hex, transparency: Math.round((1 - i.fill.a) * 100) } : { type: "none" }, line: i.line ? { color: i.line.hex, width: Math.max(0.25, i.line.w * s * 72), dashType: i.dash ? "dash" : "solid" } : { type: "none" } };
            if (i.ell) S.addShape(ST.ellipse || "ellipse", o); else if (i.r > 0.6) { o.rectRadius = Math.min(px(i.r), w / 2, h / 2); S.addShape(ST.roundRect || "roundRect", o); } else S.addShape(ST.rect || "rect", o); }
          else if (i.t === "img") S.addImage({ data: i.src, x: x, y: y, w: w, h: h });
          else if (i.t === "txt") {
            var runs = [], last = i.runs.length - 1; i.runs.forEach(function (r, k) { if (r.br) { if (runs.length) runs[runs.length - 1].options.breakLine = true; return; } runs.push({ text: r.t, options: { bold: !!r.b, italic: !!r.i, underline: r.u ? { style: "sng" } : undefined, color: r.c ? mix(r.c, cap.bg) : "111111", fontSize: ptOf(r.px), fontFace: r.f || "Segoe UI" } }); });
            if (!runs.length) return; var extra = i.al === "l" ? Math.max(0.06, w * 0.06) : 0;
            S.addText(runs, { x: i.al === "ctr" ? x - w * 0.03 : x, y: y, w: w + extra + (i.al === "ctr" ? w * 0.06 : 0), h: Math.max(h, ptOf(i.px) / 72 * 1.1), margin: 0, align: i.al === "ctr" ? "center" : i.al === "r" ? "right" : "left", valign: "top", wrap: !i.one, lineSpacing: i.one ? undefined : Math.max(6, Math.round(i.lh * s * 72 * 10) / 10), paraSpaceBefore: 0, paraSpaceAfter: 0, fit: "none" });
          } });
        if (total > 1) S.addText(String(si + 1) + " / " + total, { x: G.w - 1.2, y: G.h - 0.32, w: 1, h: 0.25, fontSize: 8, color: lum(cap.bg) < 0.5 ? "DDDDDD" : "8A8573", align: "right", margin: 0 });
  }

  // ---------- PDF (picture of the page, paged at the same safe lines) ----------
  function pdf(root, cap0, n, shape) {
    var cap; return Promise.all([lib("h2i"), lib("pdf"), capture(root)]).then(function (x) { cap = x[2];
      var W = cap.W, H = cap.H, pr = Math.max(0.8, Math.min(2, Math.sqrt(15e6 / (W * H))));
      return window.htmlToImage.toCanvas(root, { pixelRatio: pr, width: W, height: H, backgroundColor: "#" + cap.bg, cacheBust: false }).then(function (cv) {
        var G = geo(shape), B = bandsFor(cap, n), D = new window.jspdf.jsPDF({ orientation: G.w > G.h ? "l" : "p", unit: "in", format: [G.w, G.h], compress: true });
        B.forEach(function (b, i) { if (i) D.addPage([G.w, G.h], G.w > G.h ? "l" : "p"); D.setFillColor("#" + cap.bg); D.rect(0, 0, G.w, G.h, "F"); var s = scaleOf(cap, b, G), c = document.createElement("canvas"); c.width = Math.round(W * pr); c.height = Math.max(1, Math.round((b[1] - b[0]) * pr)); var g = c.getContext("2d"); g.fillStyle = "#" + cap.bg; g.fillRect(0, 0, c.width, c.height); g.drawImage(cv, 0, Math.round(b[0] * pr), c.width, c.height, 0, 0, c.width, c.height);
          D.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", G.m + ((G.w - 2 * G.m) - W * s) / 2, G.m, W * s, (b[1] - b[0]) * s); });
        return { blob: new Blob([D.output("arraybuffer")], { type: MIME.pdf }), n: B.length };
      });
    });
  }

  // ---------- Word ----------
  function wordBlocks(root) {
    var R0 = root.getBoundingClientRect(), K = R0.width / (root.offsetWidth || R0.width) || 1, RW = R0.width, jobs = [], CW = 6.9;
    function bgEl(el) { for (var e = el; e && e.nodeType === 1; e = e.parentElement) { var c = getComputedStyle(e), f = col(c.backgroundColor) || (c.backgroundImage && c.backgroundImage !== "none" ? firstGrad(c.backgroundImage) : null); if (f && f.a > 0.5) return { hex: f.hex, w: e.getBoundingClientRect().width }; if (e === root) break; } return { hex: "FFFFFF", w: RW }; }
    function para(el, cs, runs) { var px = runs.reduce(function (m, r) { return Math.max(m, r.px || 0); }, 0), bold = runs.some(function (r) { return r.b; }), txt = runs.map(function (r) { return r.t; }).join(""), bg = bgEl(el);
      var st = px >= 25 ? "Heading1" : px >= 19 && txt.length < 140 ? "Heading2" : px >= 15 && bold && txt.length < 90 ? "Heading3" : null, al = /center/.test(cs.textAlign) ? "center" : /right|end/.test(cs.textAlign) ? "right" : null, shd = null;
      if (bg.hex !== "FFFFFF" && lum(bg.hex) < 0.97) { if (bg.w >= RW * 0.5) shd = bg.hex; else runs = runs.map(function (r) { var c = r.c ? r.c.hex : "111111"; if (lum(c) > 0.8 || Math.abs(lum(c) - lum(bg.hex)) < 0.25) { var q = Object.assign({}, r); q.c = { hex: lum(bg.hex) > 0.8 ? "333333" : bg.hex, a: 1 }; return q; } return r; }); }
      return { p: runs, st: st, al: al, shd: shd, li: el.tagName === "LI" }; }
    function textOnly(el) { var cs = getComputedStyle(el); return inlineOnly(el) && !(col(cs.backgroundColor) && el.getBoundingClientRect().width > 60); }
    function emptyish(el) { return !/^(IMG|CANVAS|svg|SVG)$/.test(el.tagName) && !/\S/.test(el.textContent || "") && !el.querySelector("img,svg,canvas") && !/url\(/.test(getComputedStyle(el).backgroundImage || ""); }
    function rowsOf(kids) { var R = []; kids.forEach(function (k) { var b = k.getBoundingClientRect(), row = R.find(function (r) { return b.top < r.b - 3 && b.bottom > r.t + 3; }); if (row) { row.c.push({ el: k, b: b }); row.t = Math.min(row.t, b.top); row.b = Math.max(row.b, b.bottom); } else R.push({ t: b.top, b: b.bottom, c: [{ el: k, b: b }] }); }); R.forEach(function (r) { r.c.sort(function (a, b) { return a.b.left - b.b.left; }); }); return R; }
    function pic(el, b, cs, width, whole) { var wi = Math.min(width, b.width / RW * CW), hi = wi * b.height / Math.max(1, b.width); if (hi > 8.5) { wi *= 8.5 / hi; hi = 8.5; } var it = { img: null, w: wi, h: hi }, tag = el.tagName, w = Math.round(b.width / K), h = Math.round(b.height / K);
      jobs.push((whole ? rasterNode(el, w, h) : tag === "IMG" ? rasterImg(el, w, h, cs) : tag === "CANVAS" ? Promise.resolve({ src: el.toDataURL("image/png") }) : rasterSvg(el, w, h)).then(function (q) { if (q) it.img = q.src; })); return it; }
    function walk(el, tl, width) {
      var cs = getComputedStyle(el); if (!visible(el, cs)) return []; var tag = el.tagName, b = el.getBoundingClientRect(), out = [];
      if (tag === "IMG" || tag === "CANVAS" || el instanceof SVGElement) { if (b.width < 22 && b.height < 22) return []; return [pic(el, b, cs, width)]; }
      // a picture with numbered tags drawn over it (app screens) → one picture, tags included
      if (el.querySelector(":scope > img") && Array.prototype.some.call(el.children, function (c) { return getComputedStyle(c).position === "absolute" && c.tagName !== "IMG"; })) return [pic(el, b, cs, width, true)];
      var bi = cs.backgroundImage || ""; if (/url\(/.test(bi) && b.width >= 24 && b.height >= 24 && (b.width >= RW * 0.5 || !/\S/.test(el.textContent || ""))) return [pic(el, b, cs, width, true)];
      if (tag === "TABLE") { var rows = Array.from(el.rows).filter(function (r) { return visible(r, getComputedStyle(r)); }).map(function (tr) { return Array.from(tr.cells).map(function (td) { var c = getComputedStyle(td); return { b: inlineOnly(td) ? [para(td, c, runsOf(td, c))] : kidsOf(td, tl + 1, width / Math.max(1, tr.cells.length)), shd: (col(c.backgroundColor) || {}).hex, h: td.tagName === "TH", span: td.colSpan || 1 }; }); }); if (rows.length) out.push({ tbl: rows, cw: null }); return out; }
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") { var v = tag === "SELECT" ? (el.options[el.selectedIndex] || {}).text : el.value; if (v) out.push({ p: [{ t: v, px: 14 }] }); return out; }
      if (inlineOnly(el)) { var rs = runsOf(el, cs); if (rs.length) out.push(para(el, cs, rs)); return out; }
      return kidsOf(el, tl, width);
    }
    function kidsOf(el, tl, width) {
      var out = [], kids = [], seq = [];
      for (var c = el.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3 && /\S/.test(c.nodeValue)) seq.push({ txt: c }); else if (c.nodeType === 1) { var cs = getComputedStyle(c); if (!visible(c, cs) || cs.position === "fixed") continue; var b = c.getBoundingClientRect(); if (b.width < 1 && b.height < 1 && !c.children.length) continue; if (emptyish(c)) continue; seq.push({ el: c }); kids.push(c); } }
      var R = kids.length >= 2 ? rowsOf(kids) : null, multi = R && R.some(function (r) { return r.c.length >= 2; });
      if (multi && !seq.some(function (x) { return x.txt; })) {
        // short label rows (“#1 Telangana 90.2 ▲1”, “✅ text”, “① Step”) read best as one line, not a table
        var lineish = R.every(function (r) { return r.c.every(function (q) { return textOnly(q.el) || (q.b.width < 44 && (q.el.textContent || "").trim().length <= 3); }) || (r.c.length === 2 && r.c[0].b.width < 44 && (r.c[0].el.textContent || "").trim().length <= 3); });
        if (lineish) { R.forEach(function (r) { var head = []; r.c.forEach(function (q, i) { var cs = getComputedStyle(q.el); if (textOnly(q.el)) { var rs = runsOf(q.el, cs); if (!rs.length) return; if (head.length) head.push({ t: i ? "   " : "", px: rs[0].px }); head = head.concat(rs); } else { var sub = walk(q.el, tl, width); if (head.length && sub.length && sub[0].p) { sub[0] = Object.assign({}, sub[0], { p: head.concat([{ t: "  ", px: head[0].px }], sub[0].p) }); head = []; } else if (head.length) { out.push(para(q.el, cs, head)); head = []; } out = out.concat(sub); } }); if (head.length) out.push(para(r.c[0].el, getComputedStyle(r.c[0].el), head)); }); return merge(out); }
        var wide = R.some(function (r) { return r.c.some(function (q) { return q.b.width >= RW * 0.42 || q.el.querySelector("table"); }); }) || R.some(function (r) { return r.c.length > 8; });
        if (!wide && tl < 2) { var cols = Math.max.apply(null, R.map(function (r) { return r.c.length; })), widest = R.find(function (r) { return r.c.length === cols; }), tw = widest.c.reduce(function (a, q) { return a + q.b.width; }, 0) || 1;
          var cw = widest.c.map(function (q) { return width * q.b.width / tw; });
          out.push({ tbl: R.map(function (r) { var cells = r.c.map(function (q, i) { var cc = getComputedStyle(q.el), bg = col(cc.backgroundColor); return { b: walk(q.el, tl + 1, (cw[i] || width / cols) - 0.15), shd: bg && bg.a > 0.5 && bg.hex !== "FFFFFF" ? bg.hex : null }; }); while (cells.length < cols) cells.push({ b: [] }); return cells; }), cw: cw, row: R.length === 1 });
          return merge(out); }
      }
      seq.forEach(function (x) { if (x.txt) { var cs = getComputedStyle(el), t = x.txt.nodeValue.replace(/\s+/g, " ").trim(); if (t) out.push(para(el, cs, [{ t: cs.textTransform === "uppercase" ? t.toUpperCase() : t, b: (parseInt(cs.fontWeight, 10) || 400) >= 600, c: col(cs.color), px: parseFloat(cs.fontSize) || 14 }])); } else { if (getComputedStyle(x.el).position === "absolute" && (x.el.textContent || "").trim().length < 4) return; out = out.concat(walk(x.el, tl, width)); } });
      return merge(out);
    }
    function merge(L) { var o = []; L.forEach(function (x) { var p = o[o.length - 1]; if (x.tbl && x.row && p && p.tbl && p.row && p.cw && x.cw && p.cw.length === x.cw.length) { p.tbl = p.tbl.concat(x.tbl); } else o.push(x); }); return o; }
    var blocks = kidsOf(root, 0, CW);
    return Promise.all(jobs).then(function () { return blocks; });
  }
  function docx(root, meta) {
    return Promise.all([lib("zip"), wordBlocks(root)]).then(function (x) {
      var blocks = x[1], media = [], did = 1, TW = 1440, bgOf = function (hx) { return hx || null; };
      function runX(r, shd) { if (r.br) return "<w:r><w:br/></w:r>"; var c = r.c ? r.c.hex : "111111"; if ((!shd || lum(shd) > 0.75) && lum(c) > 0.8) c = "333333"; if (shd && lum(shd) < 0.45 && lum(c) < 0.6) c = "FFFFFF";
        var sz = Math.max(14, Math.min(64, Math.round((r.px || 14) * 0.75 * 2)));
        return "<w:r><w:rPr>" + (r.f ? '<w:rFonts w:ascii="' + xe(r.f) + '" w:hAnsi="' + xe(r.f) + '" w:cs="' + xe(r.f) + '"/>' : "") + (r.b ? "<w:b/>" : "") + (r.i ? "<w:i/>" : "") + (r.u ? '<w:u w:val="single"/>' : "") + '<w:color w:val="' + c + '"/><w:sz w:val="' + sz + '"/></w:rPr>' + String(r.t).split("\n").map(function (s, i) { return (i ? "<w:br/>" : "") + '<w:t xml:space="preserve">' + xe(s) + "</w:t>"; }).join("") + "</w:r>"; }
      function pX(b) { var shd = b.shd; return "<w:p><w:pPr>" + (b.st ? '<w:pStyle w:val="' + b.st + '"/>' : "") + (b.li ? '<w:ind w:left="300" w:hanging="200"/>' : "") + (shd ? '<w:shd w:val="clear" w:color="auto" w:fill="' + shd + '"/>' : "") + '<w:spacing w:before="' + (b.st ? 120 : 20) + '" w:after="' + (b.st ? 60 : 60) + '"/>' + (b.al ? '<w:jc w:val="' + b.al + '"/>' : "") + "</w:pPr>" + (b.li && !/^\s*[•\-–\d]/.test((b.p[0] || {}).t || "") ? runX({ t: "• ", px: (b.p[0] || {}).px || 14 }, shd) : "") + b.p.map(function (r) { return runX(r, shd); }).join("") + "</w:p>"; }
      function imgX(b) { if (!b.img) return ""; var m = /^data:image\/(png|jpe?g)/.exec(b.img); if (!m) return ""; var ext = m[1] === "png" ? "png" : "jpeg", n = "image" + (media.length + 1) + "." + ext; media.push({ n: n, d: b.img.slice(b.img.indexOf(",") + 1) }); var id = "rIdI" + media.length, cx = Math.round(b.w * 914400), cy = Math.round(b.h * 914400); did++;
        return '<w:p><w:pPr><w:spacing w:before="40" w:after="80"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + did + '" name="Picture ' + did + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + did + '" name="' + n + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'; }
      function tblX(b, width) { var cols = Math.max.apply(null, b.tbl.map(function (r) { return r.reduce(function (a, c) { return a + (c.span || 1); }, 0); })), cw = b.cw && b.cw.length === cols ? b.cw : Array(cols).fill(width / cols), sum = cw.reduce(function (a, c) { return a + c; }, 0); cw = cw.map(function (c) { return c * width / sum; });
        var brd = '<w:tblBorders>' + ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (s) { return "<w:" + s + ' w:val="single" w:sz="4" w:space="0" w:color="E1DCCB"/>'; }).join("") + "</w:tblBorders>";
        return '<w:tbl><w:tblPr><w:tblW w:w="' + Math.round(width * TW) + '" w:type="dxa"/>' + brd + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="50" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + cw.map(function (c) { return '<w:gridCol w:w="' + Math.round(c * TW) + '"/>'; }).join("") + "</w:tblGrid>" +
          b.tbl.map(function (r) { var ci = 0; return "<w:tr><w:trPr><w:cantSplit/></w:trPr>" + r.map(function (c) { var sp = c.span || 1, w = cw.slice(ci, ci + sp).reduce(function (a, q) { return a + q; }, 0) || width / cols; ci += sp; var shd = c.h ? "1D1F2B" : c.shd; var inner = body((c.b || []).map(function (q) { if (q.p && shd && !q.shd) return Object.assign({}, q, { shd: null, cellShd: shd }); return q; }), w - 0.15, shd);
            if (!/<w:p[ >][\s\S]*<\/w:p>$|<w:p\/>$/.test(inner)) inner += "<w:p/>"; return '<w:tc><w:tcPr><w:tcW w:w="' + Math.round(w * TW) + '" w:type="dxa"/>' + (sp > 1 ? '<w:gridSpan w:val="' + sp + '"/>' : "") + (shd ? '<w:shd w:val="clear" w:color="auto" w:fill="' + shd + '"/>' : "") + "</w:tcPr>" + inner + "</w:tc>"; }).join("") + "</w:tr>"; }).join("") + "</w:tbl>"; }
      function body(L, width, cellShd) { return L.map(function (b) { if (b.p) { if (cellShd && !b.shd) { var o = Object.assign({}, b); o.shd = null; return pX(Object.assign(o, { p: b.p.map(function (r) { var q = Object.assign({}, r); var c = q.c ? q.c.hex : "111111"; if (lum(cellShd) < 0.45 && lum(c) < 0.6) q.c = { hex: "FFFFFF", a: 1 }; return q; }) })); } return pX(b); } if (b.tbl) return tblX(b, width) + "<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\"/></w:pPr></w:p>"; if (b.w) { if (b.w > width) { b.h *= width / b.w; b.w = width; } return imgX(b); } return ""; }).join(""); }
      var head = meta && meta.title ? pX({ p: [{ t: meta.title, px: 30, b: 1, c: { hex: "1D1F2B", a: 1 } }], st: "Title" }) + (meta.sub ? pX({ p: [{ t: meta.sub, px: 13, c: { hex: "6B6657", a: 1 } }] }) : "") : "";
      var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + head + body(blocks, 6.9) +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>';
      var hs = function (id, nm, sz, c, extra) { return '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + nm + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>' + (extra || "") + '</w:pPr><w:rPr><w:b/><w:color w:val="' + c + '"/><w:sz w:val="' + sz + '"/></w:rPr></w:style>'; };
      var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:eastAsia="Segoe UI" w:cs="Segoe UI"/><w:sz w:val="20"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
        hs("Title", "Title", 52, "1D1F2B") + hs("Heading1", "heading 1", 36, "1D1F2B", '<w:outlineLvl w:val="0"/>') + hs("Heading2", "heading 2", 28, "2A2F45", '<w:outlineLvl w:val="1"/>') + hs("Heading3", "heading 3", 24, "3A3F55", '<w:outlineLvl w:val="2"/>') + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
      var Z = new window.JSZip(), X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
      Z.file("[Content_Types].xml", X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
      Z.file("_rels/.rels", X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
      Z.file("docProps/core.xml", X + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xe((meta && meta.title) || "vivo BI") + '</dc:title><dc:creator>vivo Business Innovation</dc:creator></cp:coreProperties>');
      Z.file("word/_rels/document.xml.rels", X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + media.map(function (m, i) { return '<Relationship Id="rIdI' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + m.n + '"/>'; }).join("") + "</Relationships>");
      Z.file("word/document.xml", doc); Z.file("word/styles.xml", styles); media.forEach(function (m) { Z.file("word/media/" + m.n, m.d, { base64: true }); });
      return Z.generateAsync({ type: "blob", mimeType: MIME.docx, compression: "DEFLATE" }).then(function (b) { return { blob: new Blob([b], { type: MIME.docx }), n: blocks.length }; });
    });
  }

  // ---------- slide previews ----------
  var IMC = {};
  function preview(cv, cap, band, G) {
    var g = cv.getContext("2d"), k = cv.width / G.w, s = scaleOf(cap, band, G), ox = G.m + ((G.w - 2 * G.m) - cap.W * s) / 2; g.fillStyle = "#" + cap.bg; g.fillRect(0, 0, cv.width, cv.height);
    cap.items.forEach(function (i) { if (!inBand(i, band)) return; var y0 = Math.max(i.y, band[0]), y1 = i.t === "box" ? Math.min(i.y + i.h, band[1]) : i.y + i.h, x = (ox + i.x * s) * k, y = (G.m + (y0 - band[0]) * s) * k, w = i.w * s * k, h = (y1 - y0) * s * k;
      if (i.t === "box") { if (i.fill) { g.globalAlpha = i.fill.a; g.fillStyle = "#" + i.fill.hex; g.fillRect(x, y, w, h); g.globalAlpha = 1; } if (i.line) { g.strokeStyle = "#" + i.line.hex; g.lineWidth = 0.6; g.strokeRect(x, y, w, h); } }
      else if (i.t === "img") { var im = IMC[i.src]; if (im && im.complete && im.naturalWidth) g.drawImage(im, x, y, w, h); else { g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(x, y, w, h); if (!im) { im = IMC[i.src] = new Image(); im.onload = function () { cv._redraw && cv._redraw(); }; im.src = i.src; } } }
      else { var r = i.runs[0] || {}; g.fillStyle = r.c ? "#" + mix(r.c, cap.bg) : "#111"; var fs = Math.max(2, i.px * s * k); g.font = (r.b ? "700 " : "") + fs + "px " + (r.f || "sans-serif"); var t = i.runs.map(function (q) { return q.t; }).join(""), lines = Math.max(1, Math.round(i.h / i.lh)), per = Math.ceil(t.length / lines); for (var L = 0; L < lines && L < 30; L++) g.fillText(t.slice(L * per, (L + 1) * per), x + (i.al === "ctr" ? 0 : 0), y + fs * 0.9 + L * i.lh * s * k, w * 1.05); } });
  }

  // ---------- the export sheet ----------
  var CSS = ".bxe-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(17,17,17,.55);display:flex;align-items:flex-end;justify-content:center;font-family:'Segoe UI',system-ui,Arial,sans-serif}.bxe-c{background:#fff;color:#1c1a14;width:min(760px,100%);max-height:92vh;overflow:auto;border-radius:22px 22px 0 0;padding:16px 16px 22px;box-shadow:0 -10px 40px rgba(0,0,0,.3)}@media(min-width:800px){.bxe-ov{align-items:center}.bxe-c{border-radius:22px}}.bxe-c h3{margin:0 0 2px;font-size:19px}.bxe-s{color:#6b6657;font-size:13px;margin-bottom:10px}.bxe-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px}.bxe-k button{border:1.5px solid #e6dfc8;background:#fffdf6;border-radius:14px;padding:10px;text-align:left;cursor:pointer;font:inherit}.bxe-k button b{display:block;font-size:14.5px}.bxe-k button span{font-size:12px;color:#6b6657}.bxe-k button.on{border-color:#111;background:#111;color:#fff}.bxe-k button.on span{color:#d9cfa8}.bxe-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.bxe-r label{font-size:13px;font-weight:700}.bxe-n{display:inline-flex;align-items:center;border:1.5px solid #e6dfc8;border-radius:12px;overflow:hidden}.bxe-n button{border:0;background:#f6f1e1;width:38px;height:38px;font-size:20px;cursor:pointer}.bxe-n input{width:56px;height:38px;border:0;text-align:center;font-size:17px;font-weight:800}.bxe-sel{height:38px;border:1.5px solid #e6dfc8;border-radius:12px;padding:0 8px;font:inherit;background:#fff}.bxe-pv{display:flex;gap:8px;overflow-x:auto;padding:6px 2px 10px}.bxe-pv div{flex:none;text-align:center;font-size:11px;color:#6b6657}.bxe-pv canvas{display:block;border:1px solid #e6dfc8;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,.08);margin-bottom:3px}.bxe-go{width:100%;height:48px;border:0;border-radius:14px;background:#111;color:#fff;font-size:16px;font-weight:700;cursor:pointer;margin-top:6px}.bxe-go:disabled{opacity:.5}.bxe-x{float:right;border:0;background:#f3efe2;border-radius:99px;width:34px;height:34px;font-size:18px;cursor:pointer}.bxe-note{font-size:12.5px;color:#6b6657;line-height:1.4}.bxe-chip{display:inline-block;background:#f3efe2;border-radius:99px;padding:3px 9px;font-size:12px;font-weight:700;margin-right:4px}";
  /** open({title, sub, name, getRoot: () => Promise<{root, done()}>, kinds:["ppt","word","pdf"], kind, shape:"wide"|"portrait", say(msg)}) */
  function open(o) {
    if (!document.getElementById("bxe-css")) { var st = document.createElement("style"); st.id = "bxe-css"; st.textContent = CSS; document.head.appendChild(st); }
    var kinds = o.kinds || ["ppt", "word"], K = o.kind || kinds[0], shape = o.shape || "wide", cap = null, C = null, N = 1, SUG = 1, busy = false;
    var LBL = { ppt: ["📊 PowerPoint", "Editable slides (.pptx)"], word: ["📝 Word", "Editable document (.docx)"], pdf: ["📄 PDF", "Pages cut only between items"] };
    var ov = document.createElement("div"); ov.className = "bxe-ov"; ov.innerHTML = '<div class="bxe-c"><button class="bxe-x" type="button" aria-label="Close">×</button><h3>⬇ ' + esc(o.title || "Export") + '</h3><div class="bxe-s">' + esc(o.sub || "Everything shown on the page goes into the file — text stays editable.") + '</div><div class="bxe-k">' + kinds.map(function (k) { return '<button type="button" data-k="' + k + '"><b>' + LBL[k][0] + "</b><span>" + LBL[k][1] + "</span></button>"; }).join("") + '</div><div id="bxe-body"><div class="bxe-note">Reading the page…</div></div><button class="bxe-go" type="button" disabled>⬇ Download</button></div>';
    document.body.appendChild(ov); var Q = function (s) { return ov.querySelector(s); }, close = function () { ov.remove(); };
    Q(".bxe-x").onclick = close; ov.addEventListener("click", function (e) { if (e.target === ov && !busy) close(); });
    function withRoot(fn) { return Promise.resolve(o.getRoot()).then(function (h) { var root = h.root || h; return sleep(60).then(function () { return fn(root); }).then(function (r) { if (h.done) h.done(); return r; }, function (e) { if (h.done) h.done(); throw e; }); }); }
    function draw() {
      [].forEach.call(ov.querySelectorAll("[data-k]"), function (b) { b.classList.toggle("on", b.dataset.k === K); });
      var bd = Q("#bxe-body"); if (!cap) return;
      if (K === "word") { bd.innerHTML = '<div class="bxe-note"><span class="bxe-chip">A4 · portrait</span>Headings, paragraphs, tables and pictures in the same order as the page — tiles and side-by-side cards become table cells, charts and photos become pictures. Open it in Word, WPS or Google Docs and edit freely.</div>'; Q(".bxe-go").disabled = false; Q(".bxe-go").textContent = "⬇ Download Word file"; return; }
      var G = geo(shape), B = bandsFor(cap, N, C), mp = minPt(cap, B, G), nm = K === "ppt" ? "slides" : "pages";
      bd.innerHTML = '<div class="bxe-r"><label>Number of ' + nm + '</label><span class="bxe-n"><button type="button" data-d="-1">−</button><input id="bxe-n" type="number" min="1" max="60" value="' + N + '"><button type="button" data-d="1">+</button></span><select class="bxe-sel" id="bxe-sh"><option value="wide"' + (shape === "wide" ? " selected" : "") + '>Wide 16:9</option><option value="portrait"' + (shape === "portrait" ? " selected" : "") + ">Portrait A4</option></select>" + (N !== SUG ? '<button type="button" class="bxe-sel" id="bxe-sug">↺ Suggested ' + SUG + "</button>" : "") + "</div>" +
        '<div class="bxe-note">Suggested <b>' + SUG + " " + nm + "</b> keeps text the same size as on the page. " + (B.length !== N ? "It fits in <b>" + B.length + " " + nm + "</b> — the page can only be split between items, never through text. " : "") + "Smallest text in the file ≈ <b>" + mp + " pt</b>" + (mp < 7 ? " — add " + nm + " to make it bigger." : ".") + (K === "ppt" ? " Every text box, tile and shape stays editable; charts and photos are pictures." : "") + '</div><div class="bxe-pv" id="bxe-pv"></div>';
      var pv = Q("#bxe-pv"), tw = G.w > G.h ? 168 : 96; B.forEach(function (b, i) { var d = document.createElement("div"), c = document.createElement("canvas"); c.width = tw * 2; c.height = Math.round(tw * 2 * G.h / G.w); c.style.width = tw + "px"; c._redraw = function () { preview(c, cap, b, G); }; c._redraw(); d.appendChild(c); d.appendChild(document.createTextNode((K === "ppt" ? "Slide " : "Page ") + (i + 1))); pv.appendChild(d); });
      [].forEach.call(bd.querySelectorAll("[data-d]"), function (b) { b.onclick = function () { N = Math.max(1, Math.min(60, N + +b.dataset.d)); draw(); }; });
      Q("#bxe-n").onchange = function () { N = Math.max(1, Math.min(60, parseInt(this.value, 10) || 1)); draw(); };
      Q("#bxe-sh").onchange = function () { shape = this.value; SUG = suggest(cap, shape, C); N = SUG; draw(); };
      if (Q("#bxe-sug")) Q("#bxe-sug").onclick = function () { N = SUG; draw(); };
      Q(".bxe-go").disabled = false; Q(".bxe-go").textContent = "⬇ Download " + (K === "ppt" ? "PowerPoint" : "PDF") + " · " + B.length + " " + nm;
    }
    [].forEach.call(ov.querySelectorAll("[data-k]"), function (b) { b.onclick = function () { K = b.dataset.k; draw(); }; });
    withRoot(capture).then(function (c) { cap = c; C = cutsOf(cap); SUG = suggest(cap, shape, C); N = SUG; draw(); }).catch(function (e) { Q("#bxe-body").innerHTML = '<div class="bxe-note">Could not read the page: ' + esc(e && e.message || e) + "</div>"; });
    Q(".bxe-go").onclick = function () {
      if (busy || !cap) return; busy = true; var b = this, t0 = b.textContent; b.disabled = true; b.textContent = "Preparing…";
      var nm = (o.name || "vivo_BI").replace(/[^\w.-]+/g, "_");
      var job = K === "ppt" ? pptx(cap, N, shape, { title: o.title }).then(function (r) { save(r.blob, nm + ".pptx"); return "✅ " + nm + ".pptx · " + r.n + " editable slides"; })
        : K === "word" ? withRoot(function (root) { return docx(root, { title: o.docTitle, sub: o.docSub }); }).then(function (r) { save(r.blob, nm + ".docx"); return "✅ " + nm + ".docx saved"; })
        : withRoot(function (root) { return pdf(root, cap, N, shape); }).then(function (r) { save(r.blob, nm + ".pdf"); return "✅ " + nm + ".pdf · " + r.n + " pages"; });
      job.then(function (msg) { busy = false; b.disabled = false; b.textContent = msg; if (o.say) o.say(msg); setTimeout(function () { if (b.isConnected) b.textContent = t0; }, 3500); }, function (e) { busy = false; b.disabled = false; b.textContent = t0; var m = "Could not create the file: " + (e && e.message || e); if (o.say) o.say(m); var nb = document.getElementById("bxe-body"); if (nb) { var d = document.createElement("div"); d.className = "bxe-note"; d.style.color = "#b42318"; d.textContent = m; nb.appendChild(d); } });
    };
    return { close: close };
  }
  window.BIEXPORT = { _wb: wordBlocks, open: open, capture: capture, pptx: pptx, pptxPages: pptxPages, cuts: cutsOf, minPt: minPt, geo: geo, docx: docx, pdf: pdf, bands: bandsFor, suggest: suggest, save: save };
})();
