// Key frames from a screen recording / demo video, read in the browser (the video is never uploaded).
// VidFrames.pick(file, { max, onProgress(p, msg), maxW }) → Promise<{ name, dur, w, h, frames:[{ t, src (≤maxW px JPEG), thumb (≤360 px JPEG) }] }>
// FAST: the video is PLAYED muted at high speed (decoding in order is many times faster than jumping around), a tiny grey copy
// of each frame is compared with the last kept one, and a new key frame is saved once a changed picture has settled.
// If the device can't play it, it falls back to jumping to ≤70 points in the video.
(function () {
  "use strict";
  var SW = 64;
  function grey(v, c, g) {
    g.drawImage(v, 0, 0, SW, c.height);
    var d = g.getImageData(0, 0, SW, c.height).data, out = new Float32Array(SW * c.height);
    for (var i = 0, j = 0; i < d.length; i += 4, j++) out[j] = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    return out;
  }
  function diff(a, b) { if (!a || !b) return 1; var s = 0, n = 0; for (var i = 0; i < a.length; i++) { var x = Math.abs(a[i] - b[i]); if (x > 0.08) n++; s += x; } return Math.max(s / a.length * 4, n / a.length); }
  var CC = document.createElement("canvas");
  function copy(v, maxW) { var k = Math.min(1, maxW / v.videoWidth); CC.width = Math.round(v.videoWidth * k); CC.height = Math.round(v.videoHeight * k); CC.getContext("2d").drawImage(v, 0, 0, CC.width, CC.height); return CC.toDataURL("image/jpeg", 0.74); }   // kept as JPEG at once (little memory)
  function thumb(src) { return new Promise(function (r) { var im = new Image(); im.onload = function () { var k = Math.min(1, 360 / im.width), d = document.createElement("canvas"); d.width = Math.round(im.width * k); d.height = Math.round(im.height * k); d.getContext("2d").drawImage(im, 0, 0, d.width, d.height); r(d.toDataURL("image/jpeg", 0.6)); }; im.onerror = function () { r(src); }; im.src = src; }); }
  // decide key frames from a stream of samples {t, s, grab()}
  function Picker(TH, keepMax) {
    var last = null, pend = null, prev = null, keep = [];
    return {
      add: function (t, s, grab) {
        if (!last) { keep.push({ t: t, score: 1, c: grab() }); last = s; prev = s; return; }
        if (pend) { if (diff(s, prev) < TH * 0.85) { keep.push({ t: t, score: pend, c: grab() }); last = s; pend = null; } }
        else if (diff(s, last) > TH) pend = diff(s, last);
        prev = s;
        if (keep.length > keepMax + 8) { var f = keep[0]; keep = [f].concat(keep.slice(1).sort(function (a, b) { return b.score - a.score; }).slice(0, keepMax + 3)).sort(function (a, b) { return a.t - b.t; }); }
      },
      done: function (lastGrab, lastT) { if (pend && lastGrab) keep.push({ t: lastT, score: pend, c: lastGrab() }); return keep; }
    };
  }
  function pick(file, opt) {
    opt = opt || {}; var max = Math.max(3, Math.min(30, opt.max || 14)), P = opt.onProgress || function () { }, maxW = opt.maxW || 800, TH = opt.threshold || 0.06;
    var url = URL.createObjectURL(file), v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.setAttribute("muted", ""); v.preload = "auto"; v.src = url;
    v.style.cssText = "position:fixed;left:0;top:0;width:4px;height:4px;opacity:0.01;pointer-events:none;z-index:-1"; document.body.appendChild(v);
    var clean = function () { try { v.pause(); v.remove(); URL.revokeObjectURL(url); } catch (e) { } };
    var c, g, dur;
    return new Promise(function (res, rej) {
      var to = setTimeout(function () { rej(new Error("This video couldn't be opened here — try an MP4 (H.264) file.")); }, 25000);
      v.onloadeddata = function () { clearTimeout(to); res(); }; v.onerror = function () { clearTimeout(to); rej(new Error("This video format isn't supported on this device — try an MP4 (H.264) file.")); };
    }).then(function () {
      dur = v.duration; if (!isFinite(dur) || dur <= 0) throw new Error("Couldn't read the video length.");
      if (!v.videoWidth) throw new Error("This file has no picture.");
      c = document.createElement("canvas"); c.width = SW; c.height = Math.max(16, Math.round(SW * v.videoHeight / v.videoWidth)); g = c.getContext("2d", { willReadFrequently: true });
      return byPlaying().catch(function () { return bySeeking(); });
    }).then(function (keep) {
      if (keep.length < 3 && dur > 6) return bySeeking(Math.min(max, Math.max(3, Math.round(dur / 8))), true);
      return keep;
    }).then(function (keep) {
      if (keep.length > max) { var first = keep[0]; keep = [first].concat(keep.slice(1).sort(function (a, b) { return b.score - a.score; }).slice(0, max - 1)).sort(function (a, b) { return a.t - b.t; }); }
      P(0.97, "Saving " + keep.length + " key frames…");
      return Promise.all(keep.map(function (k) { return thumb(k.c); })).then(function (th) {
        var frames = keep.map(function (k, i) { return { t: Math.round(k.t * 10) / 10, src: k.c, thumb: th[i] }; });
        var r = { name: file.name || "video", dur: Math.round(dur * 10) / 10, w: v.videoWidth, h: v.videoHeight, frames: frames }; clean(); return r; });
    }).catch(function (e) { clean(); throw e; });

    function byPlaying() {
      return new Promise(function (res, rej) {
        var pk = Picker(TH, max), step = Math.max(0.25, Math.min(1, dur / 400)), lastS = -1, fin = false, t0 = Date.now(), stall = 0, lastCT = -1;
        var rate = dur > 600 ? 16 : dur > 120 ? 12 : 8;
        var sample = function (mt) {
          if (fin) return; if (mt - lastS < step && mt < dur - 0.05) return; lastS = mt;
          var s = grey(v, c, g); pk.add(mt, s, function () { return copy(v, maxW); });
          P(Math.min(0.95, mt / dur), "Reading the video… " + Math.min(99, Math.round(100 * mt / dur)) + "% · " + Math.round((Date.now() - t0) / 1000) + " s");
        };
        var end = function (ok) {
          if (fin) return; fin = true; clearInterval(iv); try { v.pause(); } catch (e) { }
          if (!ok) return rej(new Error("play"));
          res(pk.done(function () { return copy(v, maxW); }, v.currentTime));
        };
        var useRVFC = typeof v.requestVideoFrameCallback === "function";
        var cb = function (now, m) { if (fin) return; sample(m.mediaTime); v.requestVideoFrameCallback(cb); };
        var iv = setInterval(function () {
          if (fin) return;
          if (!useRVFC && !v.paused) sample(v.currentTime);
          if (v.currentTime === lastCT && !v.ended) { if (++stall > 60) end(lastS > dur * 0.6); } else stall = 0;   // stuck for 6 s
          lastCT = v.currentTime;
          if (Date.now() - t0 > Math.max(60000, dur / rate * 1000 * 4 + 30000)) end(lastS > dur * 0.5);
        }, 100);
        v.onended = function () { sample(dur); end(true); };
        try { v.playbackRate = rate; } catch (e) { try { v.playbackRate = 4; } catch (e2) { } }
        if (useRVFC) v.requestVideoFrameCallback(cb);
        var pr = v.play(); if (pr && pr.catch) pr.catch(function () { end(false); });
      });
    }
    function bySeeking(n, even) {
      var cnt = n || Math.min(70, Math.max(8, Math.round(dur / 2))), times = [];
      for (var i = 0; i < cnt; i++) times.push(Math.min(dur - 0.1, (i + (even ? 0.5 : 0.15)) * dur / cnt));
      var pk = Picker(TH, max), out = [], k = 0, t0 = Date.now();
      var seek = function (t) { return new Promise(function (r) { var ok = false, f = function () { if (ok) return; ok = true; v.removeEventListener("seeked", f); setTimeout(r, 10); }; v.addEventListener("seeked", f); setTimeout(f, 3000); try { v.currentTime = Math.max(0, t); } catch (e) { f(); } }); };
      try { v.pause(); } catch (e) { }
      var next = function () {
        if (k >= times.length) return Promise.resolve(even ? out : pk.done(null));
        var t = times[k++]; return seek(t).then(function () {
          if (even) out.push({ t: t, score: 1, c: copy(v, maxW) }); else pk.add(t, grey(v, c, g), function () { return copy(v, maxW); });
          P(k / times.length * 0.95, "Reading the video… " + Math.round(100 * k / times.length) + "% · " + Math.round((Date.now() - t0) / 1000) + " s"); return next();
        });
      };
      return next();
    }
  }
  function fmt(t) { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ":" + ("0" + (t % 60)).slice(-2); }
  window.VidFrames = { pick: pick, fmt: fmt };
})();
