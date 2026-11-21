/* vivo BI · shared file reader for the AI tools.
   DOCREAD.read(file, opts) → Promise<{ name, kind, pages: [{ n, text, img }] }>
   - PDF: text of every page; pages with little or no text (scans, photos) are also drawn as a JPEG for AI to read
   - photo: one JPEG page (resized)   - Word (.docx): text   - text / csv: text
   opts: { maxPages (default 30), maxSide (default 1600), alwaysImg (draw every PDF page) } */
(function (root) {
  "use strict";
  function lib(src, test) { return test() ? Promise.resolve() : new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("Couldn't load " + src)); }; document.head.appendChild(s); }); }
  function jpeg(canvas, q) { return canvas.toDataURL("image/jpeg", q || 0.82); }
  function fit(w, h, max) { var k = Math.min(1, max / Math.max(w, h)); return [Math.round(w * k), Math.round(h * k)]; }
  function imgFile(file, max) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { var d = fit(im.naturalWidth, im.naturalHeight, max), c = document.createElement("canvas"); c.width = d[0]; c.height = d[1]; var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, d[0], d[1]); g.drawImage(im, 0, 0, d[0], d[1]); URL.revokeObjectURL(u); res(jpeg(c)); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("That picture couldn't be opened")); };
      im.src = u;
    });
  }
  function pdf(file, o) {
    return lib("/vendor/pdf.js", function () { return root.pdfjsLib; }).then(function () { var pj = root.pdfjsLib; pj.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.js"; return file.arrayBuffer().then(function (b) { return pj.getDocument({ data: b }).promise; }); }).then(function (doc) {
      var pages = [], n = Math.min(doc.numPages, o.maxPages), i = 1;
      return (function next() {
        if (i > n) return { pages: pages, total: doc.numPages };
        var no = i++;
        return doc.getPage(no).then(function (pg) {
          return pg.getTextContent().then(function (tc) {
            // keep line breaks: group text items by their vertical position
            var rows = {}, keys = []; tc.items.forEach(function (it) { if (!it.str) return; var y = Math.round(it.transform[5] / 3) * 3; if (!rows[y]) { rows[y] = []; keys.push(y); } rows[y].push([it.transform[4], it.str]); });
            keys.sort(function (a, b) { return b - a; });
            var text = keys.map(function (y) { return rows[y].sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1]; }).join("  "); }).join("\n").replace(/[ \t]{3,}/g, "   ").trim();
            if (text.replace(/\s/g, "").length >= 60 && !o.alwaysImg) { pages.push({ n: no, text: text }); return next(); }
            var vp = pg.getViewport({ scale: 1 }), k = Math.min(2.2, o.maxSide / Math.max(vp.width, vp.height)), v2 = pg.getViewport({ scale: k }), c = document.createElement("canvas"); c.width = Math.round(v2.width); c.height = Math.round(v2.height);
            var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
            return pg.render({ canvasContext: g, viewport: v2 }).promise.then(function () { pages.push({ n: no, text: text, img: jpeg(c) }); return next(); });
          });
        });
      })();
    });
  }
  function docx(file) { return lib("/vendor/jszip.min.js", function () { return root.JSZip; }).then(function () { return root.JSZip.loadAsync(file); }).then(function (z) { var f = z.file("word/document.xml"); return f ? f.async("string") : ""; }).then(function (x) { return String(x).replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<\/w:tc>/g, "\t").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim(); }); }
  function read(file, o) {
    o = Object.assign({ maxPages: 30, maxSide: 1600 }, o || {});
    var n = (file.name || "").toLowerCase(), t = file.type || "";
    if (/\.pdf$/.test(n) || t === "application/pdf") return pdf(file, o).then(function (r) { return { name: file.name, kind: "pdf", pages: r.pages, total: r.total }; });
    if (/^image\//.test(t) || /\.(jpe?g|png|webp|heic|gif|bmp)$/.test(n)) return imgFile(file, o.maxSide).then(function (d) { return { name: file.name, kind: "image", pages: [{ n: 1, text: "", img: d }] }; });
    if (/\.docx$/.test(n)) return docx(file).then(function (x) { return { name: file.name, kind: "docx", pages: [{ n: 1, text: x }] }; });
    if (/\.(txt|csv|md|json)$/.test(n) || /^text\//.test(t)) return file.text().then(function (x) { return { name: file.name, kind: "text", pages: [{ n: 1, text: x }] }; });
    return Promise.reject(new Error("Use a PDF, a photo, a Word (.docx) or a text file"));
  }
  root.DOCREAD = { read: read };
})(window);
