// BIFILES.extract(file) -> Promise<{ name, kind, text }>
// Reads a pdf, image (OCR), Excel/CSV, Word (.docx) or text file into plain text, entirely in the browser.
// Shared by Affordability (offer sheets) and any tool that needs offers/lines out of an uploaded file.
(function () {
  "use strict";
  var V = { xlsx: "/vendor/xlsx.full.min.js", zip: "/vendor/jszip.min.js", pdfjs: "/vendor/pdf.js" }, L = {};
  function lib(k) { return L[k] || (L[k] = new Promise(function (res, rej) { var s = document.createElement("script"); s.src = V[k]; s.onload = res; s.onerror = function () { L[k] = null; rej(new Error("Couldn't load a reader — check the connection.")); }; document.head.appendChild(s); })); }
  function xmlText(x) { return String(x || "").replace(/<[^>]+>/g, function (m) { return /<w:tab|<w:br|<\/w:p>/.test(m) ? " " : ""; }).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }).replace(/\s+/g, " ").trim(); }
  function readDocx(buf) {
    return lib("zip").then(function () { return window.JSZip.loadAsync(buf); }).then(function (z) {
      return z.file("word/document.xml").async("string").then(function (x) {
        var body = x.split("<w:body>")[1] || x, out = [];
        (body.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g) || []).forEach(function (b) {
          if (/^<w:tbl>/.test(b)) { (b.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).forEach(function (tr) { var cells = (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(xmlText).filter(Boolean); if (cells.length) out.push(cells.join(" | ")); }); return; }
          var t = xmlText(b); if (t) out.push(t);
        });
        return out.join("\n");
      });
    });
  }
  function readPdf(buf) {
    return lib("pdfjs").then(function () { var pj = window.pdfjsLib; pj.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.js"; return pj.getDocument({ data: buf }).promise; }).then(function (doc) {
      var n = Math.min(doc.numPages, 30), chain = Promise.resolve(), lines = [];
      for (var i = 1; i <= n; i++) (function (i) { chain = chain.then(function () { return doc.getPage(i).then(function (pg) { return pg.getTextContent().then(function (tc) {
        var rows = {}; tc.items.forEach(function (it) { var y = Math.round(it.transform[5] / 3) * 3; (rows[y] = rows[y] || []).push([it.transform[4], it.str]); });
        Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) { var t = rows[y].sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1]; }).join(" ").replace(/\s+/g, " ").trim(); if (t) lines.push(t); });
      }); }); }); })(i);
      return chain.then(function () { return lines.join("\n"); });
    });
  }
  function readSheet(buf) {
    return lib("xlsx").then(function () {
      var wb = window.XLSX.read(buf, { type: "array" }), out = [];
      wb.SheetNames.slice(0, 8).forEach(function (sn) { var A = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", raw: false }).filter(function (r) { return r.some(function (c) { return String(c).trim(); }); }); if (!A.length) return; if (wb.SheetNames.length > 1) out.push("## " + sn); A.slice(0, 200).forEach(function (r) { out.push(r.map(function (c) { return String(c).slice(0, 80); }).join(" | ")); }); });
      return out.join("\n");
    });
  }
  var OCRW = null, ocrN = 0, ocrCb = {};
  function ocr(buf) {
    return new Promise(function (res) {
      try { if (!OCRW) { OCRW = new Worker("/vendor/ocr-worker.js?v=1"); OCRW.onmessage = function (e) { var f = ocrCb[e.data.id]; if (f) { delete ocrCb[e.data.id]; f(e.data); } }; OCRW.onerror = function () { Object.keys(ocrCb).forEach(function (k) { ocrCb[k]({ ok: false }); delete ocrCb[k]; }); }; } } catch (e) { return res(""); }
      var id = ++ocrN; ocrCb[id] = function (r) { res(r && r.ok ? r.text || "" : ""); }; OCRW.postMessage({ id: id, op: "ocr", image: buf, langs: "eng", psm: 6 }, [buf]); setTimeout(function () { if (ocrCb[id]) { delete ocrCb[id]; res(""); } }, 60000);
    });
  }
  function imgBuf(file) {
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { var im = new Image(); im.onload = function () { var k = Math.min(1, 2000 / Math.max(im.width, im.height)), cv = document.createElement("canvas"); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); cv.toBlob(function (b) { b.arrayBuffer().then(res); }, "image/png"); }; im.onerror = function () { res(null); }; im.src = r.result; }; r.onerror = function () { res(null); }; r.readAsDataURL(file); });
  }
  function extract(file) {
    var n = file.name || "file", ext = (n.split(".").pop() || "").toLowerCase();
    var P;
    if (/^(png|jpe?g|gif|webp|bmp|heic)$/.test(ext) || /^image\//.test(file.type)) P = imgBuf(file).then(function (b) { return b ? ocr(b) : ""; }).then(function (t) { return { kind: "image", text: t }; });
    else if (ext === "pdf") P = file.arrayBuffer().then(readPdf).then(function (t) { return { kind: "pdf", text: t }; });
    else if (ext === "docx") P = file.arrayBuffer().then(readDocx).then(function (t) { return { kind: "word", text: t }; });
    else if (/^(xlsx|xls|csv)$/.test(ext)) P = file.arrayBuffer().then(readSheet).then(function (t) { return { kind: "data", text: t }; });
    else if (/^(txt|md|json|text)$/.test(ext) || /^text\//.test(file.type)) P = file.text().then(function (t) { return { kind: "text", text: t }; });
    else return Promise.reject(new Error(n + ": use a PDF, picture, Excel/CSV, Word (.docx) or text file (old .doc/.ppt: save as the new format first)."));
    return P.then(function (r) { r.name = n; r.text = (r.text || "").replace(/\u0000/g, "").trim(); if (r.text.length < 3) throw new Error(n + ": nothing readable was found" + (r.kind === "image" ? " in the picture." : ".")); return r; });
  }
  window.BIFILES = { extract: extract };
})();
