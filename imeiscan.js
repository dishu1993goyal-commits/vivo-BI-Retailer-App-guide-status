/* IMEI helpers shared by the Retailer portal and IMEI unblock tools.
   BISCAN.extract(text)  → valid 15-digit IMEIs (Luhn-checked, de-duplicated) found in any pasted text
   BISCAN.valid(imei)    → true / false
   BISCAN.open(onImei, {multi}) → camera scanner (box barcode / QR). Uses the phone's built-in barcode reader when
   available, otherwise loads ZXing. Calls onImei(imei) for each IMEI read. */
(function () {
  "use strict";
  function valid(s) {
    s = String(s || ""); if (!/^\d{15}$/.test(s)) return false;
    var sum = 0; for (var i = 0; i < 15; i++) { var d = +s[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0;
  }
  function extract(text) {
    var out = [], seen = {}, add = function (x) { if (valid(x) && !seen[x]) { seen[x] = 1; out.push(x); return true; } return false; };
    String(text || "").split(/[\n\r,;|\t]+/).forEach(function (chunk) {
      var m, re = /(?:^|\D)(\d{15})(?=\D|$)/g, found = false;
      while ((m = re.exec(chunk))) { if (add(m[1])) found = true; re.lastIndex = m.index + m[0].length; }
      if (!found) { var c = chunk.replace(/(\d)[ \-]+(?=\d)/g, "$1"); while ((m = re.exec(c))) { add(m[1]); re.lastIndex = m.index + m[0].length; } }
    });
    return out;
  }
  function bad(text) { var out = [], m, re = /(?:^|\D)(\d{14,16})(?=\D|$)/g, s = String(text || ""); while ((m = re.exec(s))) if (!valid(m[1])) out.push(m[1]); return out; }
  var zx = null;
  function loadZX() { if (window.ZXing) return Promise.resolve(); if (!zx) zx = new Promise(function (res, rej) { var s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js"; s.onload = res; s.onerror = function () { zx = null; rej(new Error("Scanner couldn't load — check the internet.")); }; document.head.appendChild(s); }); return zx; }
  function open(onImei, opts) {
    opts = opts || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alertMsg("Camera isn't available here. Type the IMEI instead" + (window.BIApp ? " (or update the app)." : ".")); return; }
    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center";
    ov.innerHTML = '<video playsinline muted style="width:100%;max-height:78vh;object-fit:cover"></video><div style="position:absolute;left:8%;right:8%;top:38%;height:22%;border:3px solid #7CFFB2;border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.35)"></div>' +
      '<div id="bsc-m" style="position:absolute;top:14px;left:0;right:0;text-align:center;color:#fff;font:600 14px system-ui">Point at the IMEI barcode on the box or phone</div><div id="bsc-l" style="position:absolute;bottom:80px;left:0;right:0;text-align:center;color:#7CFFB2;font:700 14px system-ui"></div>' +
      '<button style="position:absolute;bottom:22px;border:0;border-radius:99px;padding:12px 26px;font:700 15px system-ui;background:#fff;color:#111">' + (opts.multi ? "Done" : "Close") + "</button>";
    document.body.appendChild(ov);
    var video = ov.querySelector("video"), stream = null, stop = false, reader = null, got = {}, n = 0;
    var close = function () { stop = true; try { reader && reader.reset(); } catch (e) { } if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); ov.remove(); };
    ov.querySelector("button").onclick = close;
    var hit = function (txt) {
      var L = extract(txt); if (!L.length) return;
      L.forEach(function (i) { if (got[i]) return; got[i] = 1; n++; try { navigator.vibrate && navigator.vibrate(60); } catch (e) { } onImei(i); });
      ov.querySelector("#bsc-l").textContent = "✓ " + n + " IMEI" + (n === 1 ? "" : "s") + " read" + (opts.multi ? " — scan the next one" : "");
      if (!opts.multi) setTimeout(close, 350);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } }).then(function (s) {
      stream = s; video.srcObject = s; return video.play();
    }).then(function () {
      if ("BarcodeDetector" in window) {
        var det; try { det = new window.BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "qr_code", "data_matrix", "itf"] }); } catch (e) { det = null; }
        if (det) { var loop = function () { if (stop) return; det.detect(video).then(function (r) { r.forEach(function (x) { hit(x.rawValue); }); }).catch(function () { }).then(function () { if (!stop) setTimeout(loop, 180); }); }; loop(); return; }
      }
      return loadZX().then(function () {
        if (stop) return; reader = new window.ZXing.BrowserMultiFormatReader();
        reader.decodeFromVideoElementContinuously ? reader.decodeFromVideoElementContinuously(video, function (r) { if (r) hit(r.getText()); }) : reader.decodeFromVideoDevice(undefined, video, function (r) { if (r) hit(r.getText()); });
      });
    }).catch(function (e) { close(); alertMsg((e && e.name === "NotAllowedError" ? "Camera permission was denied. " : "") + ((e && e.message) || "Camera couldn't start.") + " You can type the IMEI instead."); });
  }
  function alertMsg(m) { if (window.toast) window.toast(m); else { var d = document.createElement("div"); d.textContent = m; d.style.cssText = "position:fixed;left:16px;right:16px;bottom:24px;background:#222;color:#fff;padding:12px 14px;border-radius:12px;z-index:99999;font:14px system-ui"; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 4000); } }
  window.BISCAN = { valid: valid, extract: extract, bad: bad, open: open };
})();
