// Key frames from a screen recording / demo video, read in the browser (nothing is uploaded until the AI step).
// VidFrames.pick(file, { max, onProgress(p, msg) }) → Promise<{ name, dur, w, h, frames:[{ t, src (≤960 px JPEG), thumb (≤360 px JPEG) }] }>
// A frame is kept when the picture has changed clearly from the last kept one AND has settled (two samples alike),
// so every new screen, pop-up or step of the recording is caught once, not the in-between animation.
(function () {
  "use strict";
  if (window.VidFrames) return;
  var SW = 64;   // width of the tiny grey picture used to compare frames
  function seek(v, t) {
    return new Promise(function (res) {
      var done = false, fin = function () { if (done) return; done = true; v.removeEventListener("seeked", fin); setTimeout(res, 15); };
      v.addEventListener("seeked", fin); setTimeout(fin, 2500);
      try { v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.05)); } catch (e) { fin(); }
    });
  }
  function sig(v, c, g) {
    var h = c.height; g.drawImage(v, 0, 0, SW, h);
    var d = g.getImageData(0, 0, SW, h).data, out = new Float32Array(SW * h);
    for (var i = 0, j = 0; i < d.length; i += 4, j++) out[j] = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    return out;
  }
  function diff(a, b) { if (!a || !b) return 1; var s = 0, n = 0; for (var i = 0; i < a.length; i++) { var x = Math.abs(a[i] - b[i]); if (x > 0.08) n++; s += x; } return Math.max(s / a.length * 4, n / a.length); }
  function snap(v, maxW, q) {
    var k = Math.min(1, maxW / v.videoWidth), c = document.createElement("canvas"); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", q);
  }
  function pick(file, opt) {
    opt = opt || {}; var max = Math.max(3, Math.min(24, opt.max || 14)), P = opt.onProgress || function () { };
    var url = URL.createObjectURL(file), v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous"; v.src = url;
    v.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px"; document.body.appendChild(v);
    var clean = function () { try { v.remove(); URL.revokeObjectURL(url); } catch (e) { } };
    return new Promise(function (res, rej) {
      var to = setTimeout(function () { rej(new Error("This video couldn't be opened here — try an MP4 (H.264) file.")); }, 20000);
      v.onloadedmetadata = function () { clearTimeout(to); res(); }; v.onerror = function () { clearTimeout(to); rej(new Error("This video format isn't supported on this device — try an MP4 (H.264) file.")); };
    }).then(function () {
      var dur = v.duration; if (!isFinite(dur) || dur <= 0) throw new Error("Couldn't read the video length.");
      if (!v.videoWidth) throw new Error("This file has no picture.");
      var c = document.createElement("canvas"); c.width = SW; c.height = Math.max(16, Math.round(SW * v.videoHeight / v.videoWidth)); var g = c.getContext("2d", { willReadFrequently: true });
      var step = Math.max(0.4, Math.min(2, dur / 260)), times = []; for (var t = Math.min(0.3, dur / 2); t < dur - 0.05; t += step) times.push(t);
      if (times.length < 2) times = [Math.min(0.3, dur / 2)];
      var S = [], i = 0;
      var next = function () {
        if (i >= times.length) return Promise.resolve();
        var t0 = times[i]; return seek(v, t0).then(function () { S.push({ t: t0, s: sig(v, c, g) }); i++; if (i % 6 === 0) P(0.05 + 0.6 * i / times.length, "Reading the video… " + Math.round(100 * i / times.length) + "%"); return next(); });
      };
      return next().then(function () {
        // keep: first frame, then each settled new picture
        var keep = [], last = null, TH = opt.threshold || 0.06;
        S.forEach(function (x, k) {
          var settled = k === S.length - 1 || diff(x.s, S[k + 1].s) < TH * 0.6;
          if (!last) { keep.push({ t: x.t, score: 1 }); last = x.s; return; }
          var d = diff(x.s, last); if (d > TH && settled) { keep.push({ t: x.t, score: d }); last = x.s; }
        });
        // a still video with no changes: take a few evenly
        if (keep.length < 3 && dur > 4) { keep = []; for (var j = 0; j < Math.min(max, Math.max(3, Math.round(dur / 6))); j++) keep.push({ t: (j + 0.5) * dur / Math.min(max, Math.max(3, Math.round(dur / 6))), score: 1 }); }
        // too many: keep the biggest changes (always the first), in time order
        if (keep.length > max) { var first = keep[0]; keep = [first].concat(keep.slice(1).sort(function (a, b) { return b.score - a.score; }).slice(0, max - 1)).sort(function (a, b) { return a.t - b.t; }); }
        var out = [], n = 0;
        var grab = function () {
          if (n >= keep.length) return Promise.resolve();
          var kt = keep[n]; return seek(v, kt.t + 0.05).then(function () { out.push({ t: Math.round(kt.t * 10) / 10, src: snap(v, opt.maxW || 960, 0.78), thumb: snap(v, 360, 0.62) }); n++; P(0.65 + 0.35 * n / keep.length, "Saving key frames… " + n + "/" + keep.length); return grab(); });
        };
        return grab().then(function () { var r = { name: file.name || "video", dur: Math.round(dur * 10) / 10, w: v.videoWidth, h: v.videoHeight, frames: out }; clean(); return r; });
      });
    }).catch(function (e) { clean(); throw e; });
  }
  function fmt(t) { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ":" + ("0" + (t % 60)).slice(-2); }
  window.VidFrames = { pick: pick, fmt: fmt };
})();
