// On-device text recognition (Tesseract OCR engine, Apache-2.0) for scheme posters, photos and scanned PDFs.
// Runs in a Web Worker; all files are hosted with the site, so no outside AI service is needed to read a picture.
/* global TesseractCore, importScripts */
var mod = null, api = null, langsNow = "", loaded = {};
var SIMD = (function () { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } })();
function base() { return self.location.origin + "/vendor/tesseract/"; }
function core() {
  if (mod) return Promise.resolve(mod);
  importScripts(base() + (SIMD ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js"));
  return TesseractCore({ print: function () { }, printErr: function () { } }).then(function (m) { mod = m; return m; });
}
function init(langs) {
  return core().then(function (m) {
    var need = langs.split("+").filter(function (l) { return !loaded[l]; });
    return Promise.all(need.map(function (l) {
      return fetch(base() + l + ".traineddata").then(function (r) { if (!r.ok) throw new Error("language data " + l + " " + r.status); return r.arrayBuffer(); })
        .then(function (b) { m.FS.writeFile("./" + l + ".traineddata", new Uint8Array(b)); loaded[l] = 1; });
    })).then(function () {
      if (api && langsNow === langs) return;
      if (api) { try { api.End(); } catch (e) { } }
      api = new m.TessBaseAPI();
      if (api.Init(null, langs, 1) === -1) throw new Error("OCR engine could not start");
      api.SetVariable("tessedit_pageseg_mode", "3");
      api.SetVariable("preserve_interword_spaces", "1");
      langsNow = langs;
    });
  });
}
self.onmessage = function (e) {
  var d = e.data || {}, id = d.id;
  var done = function (o) { self.postMessage(Object.assign({ id: id }, o)); };
  if (d.op === "ocr") {
    init(d.langs || "eng").then(function () {
      api.SetVariable("tessedit_pageseg_mode", String(d.psm || 3));   // 3 = full page, 11 = sparse text (numbers in boxes)
      mod.FS.writeFile("/input", new Uint8Array(d.image));
      if (api.SetImageFile(1, 0) === 1) throw new Error("Couldn't open the picture");
      api.Recognize(null);
      var text = api.GetUTF8Text() || "", conf = api.MeanTextConf();
      done({ ok: true, text: text, conf: conf });
    }).catch(function (err) { done({ ok: false, error: String(err && err.message || err) }); });
  }
};
