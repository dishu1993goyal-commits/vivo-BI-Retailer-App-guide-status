// Theme switcher for the BI dashboard, every shared tool page and the web layer — web and both apps.
// Recolours the page's own styles (and inline colours) from its original palette to the chosen theme, without
// touching the original <style> text, so "Save updated file" still saves the original design.
//   Choice per person/device: localStorage "biw-theme" = theme id | "auto"
//   Default for everyone: set by HO admins → server (config:theme) + optionally the dashboard file (META.theme)
(function () {
  "use strict";
  if (window.BITHEME) return;
  var THEMES = [
    { id: "signature", name: "vivo Signature", desc: "Brand blue — the vivo look", accent: "#415FFF", deep: "#0A1C5C", tint: "#F2F5FF" },
    { id: "classic", name: "Classic", desc: "The original black and gold", accent: "#C9A227", deep: "#0B0B0C", tint: "#FBF9F3" },
    { id: "aurora", name: "Aurora", desc: "Indigo to violet", accent: "#5B5BF6", deep: "#1B1F5E", tint: "#F3F4F9" },
    { id: "emerald", name: "Emerald", desc: "Fresh teal", accent: "#0E9F8E", deep: "#0B3B3C", tint: "#EEF8F6" },
    { id: "royal", name: "Royal Indigo", desc: "Deep navy — for management reviews", accent: "#5146C9", deep: "#12153A", tint: "#F5F5FB" },
    { id: "sunrise", name: "Sunrise", desc: "Saffron and maroon — festive", accent: "#F2711C", deep: "#5B1A2E", tint: "#FFF5EC" },
    { id: "midnight", name: "Midnight", desc: "Dark mode — easy on the eyes at night", accent: "#8B9BFF", deep: "#0B0F1C", tint: "#141A2E", dark: true }
  ];
  var BYID = {}; THEMES.forEach(function (t) { BYID[t.id] = t; });
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  var CFG = (function () { try { return JSON.parse(ls("biw-theme-cfg") || "null") || {}; } catch (e) { return {}; } })();
  var FILE = null;   // default saved inside the dashboard file (META.theme)
  // which palette is this page built in? dashboard + web layer = black & gold; shared tool pages = indigo
  var SRC = /--brand:\s*#4D5BF9/i.test(Array.prototype.map.call(document.querySelectorAll("style"), function (s) { return s.textContent.slice(0, 600); }).join("")) ? "aurora" : "classic";
  var CUR = null, MQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  // ---------- colour maths ----------
  function hex2rgb(h) { h = h.replace("#", ""); if (h.length === 3 || h.length === 4) h = h.split("").map(function (c) { return c + c; }).join(""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]; }
  function rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2; if (mx !== mn) { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; }
  function hsl2rgb(h, s, l) { h = ((h % 360) + 360) % 360 / 360; var f = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; if (!s) return [l * 255, l * 255, l * 255]; var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255]; }
  function out(rgb, a) { var r = Math.round(rgb[0]), g = Math.round(rgb[1]), b = Math.round(rgb[2]); return a < 1 ? "rgba(" + r + "," + g + "," + b + "," + (Math.round(a * 1000) / 1000) + ")" : "#" + [r, g, b].map(function (x) { return ("0" + Math.max(0, Math.min(255, x)).toString(16)).slice(-2); }).join(""); }
  var cl = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
  function hslOf(hex) { var c = hex2rgb(hex); return rgb2hsl(c[0], c[1], c[2]); }
  function isAccent(h, s, l) { return SRC === "classic" ? (h >= 30 && h <= 60 && s >= 0.28) : (h >= 215 && h <= 292 && s >= 0.25); }
  function isStatus(h, s) { if (s < 0.3) return false; if (SRC === "classic") return (h >= 85 && h <= 175) || h <= 22 || h >= 335 || (h > 195 && h < 215); return (h >= 85 && h <= 175) || h <= 22 || h >= 335 || (h >= 25 && h <= 60); }
  var MEMO = {};
  // role: "t" = text colour, "s" = surface/border/shadow
  function mapColour(r, g, b, a, role, T) {
    var key = r + "," + g + "," + b + "," + a + role; if (MEMO[key]) return MEMO[key];
    var hsl = rgb2hsl(r, g, b), h = hsl[0], s = hsl[1], l = hsl[2], A = T._a, D = T._d, N = T._n, res;
    if (!T.dark) {
      if (isStatus(h, s)) res = null;
      else if (isAccent(h, s, l)) res = l < 0.28 ? hsl2rgb(D[0], D[1], cl(D[2] + l * 0.4, 0, 0.32)) : hsl2rgb(A[0], cl(A[1] * (0.6 + s * 0.5), 0, 1), l > 0.8 ? l : cl(l + (A[2] - 0.47) * 0.6, 0.12, 0.95));
      else if (l <= 0.3) res = hsl2rgb(D[0], D[1], cl(D[2] + l * 0.55, 0, 0.36));
      else if (a < 1 && l > 0.95) res = null;
      else res = hsl2rgb(N[0], l > 0.9 ? N[1] : N[1] * 0.45, l);
    } else {
      if (a < 1 && (l < 0.06 || l > 0.95)) res = null;   // shadows and light overlays stay
      else if (isStatus(h, s)) res = role === "t" ? hsl2rgb(h, s, Math.max(l, 0.62)) : l > 0.8 ? hsl2rgb(h, s * 0.5, 0.17) : hsl2rgb(h, s, cl(l, 0.35, 0.6));
      else if (isAccent(h, s, l)) res = role === "t" ? hsl2rgb(A[0], A[1], Math.max(l, A[2])) : l > 0.8 ? hsl2rgb(A[0], A[1] * 0.45, 0.19) : l < 0.28 ? hsl2rgb(D[0], D[1], 0.1) : hsl2rgb(A[0], A[1], cl(l, 0.45, 0.7));
      else if (role === "t") res = hsl2rgb(N[0], 0.12, l < 0.5 ? cl(0.93 - l * 0.6, 0.62, 0.95) : Math.max(l, 0.85));
      else res = hsl2rgb(N[0], N[1] * 0.6, l >= 0.6 ? cl(0.07 + (1 - l) * 0.55, 0.07, 0.3) : l < 0.3 ? cl(0.09 + l * 0.3, 0.07, 0.18) : cl(0.22 + (l - 0.3) * 0.4, 0.2, 0.34));
    }
    return (MEMO[key] = res ? out(res, a) : null);
  }
  var COLRE = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)|\b(white|black)\b/gi;
  function mapValue(v, role, T) {
    return v.replace(COLRE, function (m, hx, r, g, b, a, kw) {
      var c = hx ? hex2rgb(hx) : kw ? (kw.toLowerCase() === "white" ? [255, 255, 255, 1] : [0, 0, 0, 1]) : [+r, +g, +b, a == null ? 1 : +a];
      return mapColour(c[0], c[1], c[2], c[3], role, T) || m;
    });
  }
  var TEXTP = /^(color|-webkit-text-fill-color|caret-color|--(ink|ink2|txt|mut|text|fg)[\w-]*)$/i;
  function mapDecls(css, T) {
    return css.replace(/([\w-]+)(\s*:\s*)([^;{}]+)/g, function (m, p, sep, v) {
      if (!/#[0-9a-f]{3}|rgb|white|black/i.test(v) || /^(content|font|src|url|filter|grid-template-areas)$/i.test(p)) return m;
      if (/url\(/i.test(v)) return p + sep + v.replace(/(url\([^)]*\))|([^u]+|u)/gi, function (x, u) { return u ? u : mapValue(x, TEXTP.test(p) ? "t" : "s", T); });
      return p + sep + mapValue(v, TEXTP.test(p) ? "t" : "s", T);
    });
  }
  function prep(T) {
    var c = (CFG.custom && CFG.custom[T.id]) || {};
    var t = Object.assign({}, T, { accent: c.accent || T.accent, deep: c.deep || T.deep, tint: c.tint || T.tint });
    t._a = hslOf(t.accent); t._d = hslOf(t.deep); t._n = hslOf(t.tint); if (t._n[1] < 0.05) t._n[1] = 0.05;
    return t;
  }

  // ---------- applying ----------
  var STY = [], applying = false, MO = null;
  function own(el) { return el.hasAttribute && (el.hasAttribute("data-bt") || el.hasAttribute("data-bt-skip")); }
  function themeStyle(s, T) {
    if (own(s)) return;
    if (s.__bto == null) { s.__bto = s.textContent; STY.push(s); }
    var clone = s.__btc;
    if (!T) { if (clone) { clone.remove(); s.__btc = null; } s.media = s.__btm || ""; return; }
    if (!clone) { clone = document.createElement("style"); clone.setAttribute("data-bt", "1"); s.__btc = clone; s.__btm = s.media || ""; }
    clone.textContent = mapDecls(s.__bto, T);
    if (clone.previousSibling !== s) s.parentNode.insertBefore(clone, s.nextSibling);
    s.media = "not all";
  }
  var ATTRS = ["fill", "stroke", "stop-color", "bgcolor", "color"];
  function themeEl(el, T) {
    if (el.nodeType !== 1 || own(el) || (el.closest && el.closest("[data-bt-skip]"))) return;
    var st = el.getAttribute("style");
    if (st == null) { if (el.__btw != null) { el.__bto = null; el.__btw = null; } }
    else if (st !== el.__btw) { el.__bto = st; }
    if (el.__bto != null) { var nv = T ? mapDecls(el.__bto, T) : el.__bto; if (nv !== el.getAttribute("style")) { el.__btw = nv; el.setAttribute("style", nv); } else el.__btw = nv; }
    for (var i = 0; i < ATTRS.length; i++) {
      var an = ATTRS[i], av = el.getAttribute(an); if (!av) continue;
      el.__bta = el.__bta || {};
      if (!el.__bta[an] || (av !== el.__bta[an].w)) el.__bta[an] = { o: av };
      var o = el.__bta[an].o, w = T ? mapValue(o, an === "color" ? "t" : "s", T) : o;
      el.__bta[an].w = w; if (w !== av) el.setAttribute(an, w);
    }
  }
  function themeTree(root, T) {
    if (root.nodeType !== 1) return;
    if (root.tagName === "STYLE") return themeStyle(root, T);
    themeEl(root, T);
    var list = root.querySelectorAll("style,[style],[fill],[stroke],[stop-color],[bgcolor]");
    for (var i = 0; i < list.length; i++) { if (list[i].tagName === "STYLE") themeStyle(list[i], T); else themeEl(list[i], T); }
  }
  function apply(T) {
    CUR = T ? prep(T) : null; MEMO = {};
    var native = !CUR || CUR.id === SRC && !(CFG.custom && CFG.custom[CUR.id]);
    var TT = native ? null : CUR;
    applying = true;
    try {
      Array.prototype.forEach.call(document.querySelectorAll("style"), function (s) { themeStyle(s, TT); });
      if (document.documentElement) themeTree(document.documentElement, TT);
    } finally { applying = false; }
    document.documentElement.setAttribute("data-theme", CUR ? CUR.id : "original");
    if (CUR && CUR.dark) document.documentElement.style.colorScheme = "dark"; else document.documentElement.style.colorScheme = "";
    var m = document.querySelector('meta[name="theme-color"]'); if (!m && document.head) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
    if (m) m.content = CUR ? (CUR.dark ? CUR.deep : CUR.deep) : "";
    if (!MO && window.MutationObserver) {
      MO = new MutationObserver(function (muts) {
        if (applying) return;
        var T = CUR && !(CUR.id === SRC && !(CFG.custom && CFG.custom[CUR.id])) ? CUR : null;
        applying = true;
        try {
          muts.forEach(function (mu) {
            if (mu.type === "childList") { for (var i = 0; i < mu.addedNodes.length; i++) { var n = mu.addedNodes[i]; if (n.nodeType === 1) themeTree(n, T); else if (n.nodeType === 3 && n.parentNode && n.parentNode.tagName === "STYLE" && !own(n.parentNode)) { n.parentNode.__bto = null; themeStyle(n.parentNode, T); } } }
            else if (mu.type === "attributes" && mu.target.nodeType === 1 && T) themeEl(mu.target, T);
            else if (mu.type === "attributes" && mu.target.nodeType === 1 && !T && mu.attributeName === "style") { var e = mu.target; if (e.getAttribute("style") !== e.__btw) e.__bto = null; }
          });
        } finally { applying = false; }
      });
      MO.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "fill", "stroke", "stop-color", "bgcolor"] });
    }
    try { window.dispatchEvent(new CustomEvent("bitheme", { detail: { id: CUR ? CUR.id : "" } })); } catch (e) { }
    if (document.getElementById("btp-b")) paintButton();
  }

  // ---------- which theme? person's pick > admin default (server) > dashboard file default > original look ----------
  function phoneDark() { try { if (window.AndroidDL && window.AndroidDL.isNight) return !!window.AndroidDL.isNight(); } catch (e) { } return !!(MQ && MQ.matches); }
  function enabled() { var on = Array.isArray(CFG.on) && CFG.on.length ? CFG.on : THEMES.map(function (t) { return t.id; }); return THEMES.filter(function (t) { return on.indexOf(t.id) >= 0; }); }
  function defaultId() { var d = CFG.def || (FILE && FILE.def) || ""; return BYID[d] ? d : ""; }
  function pickId() {
    var mine = CFG.allowUser === false ? null : ls("biw-theme"), en = enabled().map(function (t) { return t.id; });
    if (mine === "auto" && CFG.auto !== false) return phoneDark() ? "midnight" : defaultId();
    if (mine && BYID[mine] && en.indexOf(mine) >= 0) return mine;
    if (CFG.defAuto && phoneDark() && BYID.midnight) return "midnight";
    return defaultId();
  }
  function refresh() { var id = pickId(); if ((CUR ? CUR.id : "") !== id || (CUR && JSON.stringify((CFG.custom || {})[id] || null) !== CUR._cs)) { apply(BYID[id] || null); if (CUR) CUR._cs = JSON.stringify((CFG.custom || {})[id] || null); } }
  if (MQ && MQ.addEventListener) MQ.addEventListener("change", refresh);

  // ---------- auth / server ----------
  function auth() {
    var a = null;
    try { a = window.BIApp && window.BIApp.getAuth ? JSON.parse(window.BIApp.getAuth()) : null; } catch (e) { a = null; }
    if ((!a || !a.token) && window.__BI_AUTH && window.__BI_AUTH.token) a = window.__BI_AUTH;
    if (!a || !a.token) { try { var w = JSON.parse(ls("biw-auth") || "null"); if (w && w.token) a = { app: w.app, username: w.username, token: w.token }; } catch (e) { } }
    return a;
  }
  function post(body) { return fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json", "X-BI-App": "1" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: "No internet connection." }; }); }
  function loadCfg() {
    var a = auth();
    post({ app: (a && a.app) || "state", action: "theme-get" }).then(function (r) {
      if (!r || !r.ok) return;
      CFG = r.theme || {}; ls("biw-theme-cfg", JSON.stringify(CFG)); refresh();
    });
  }
  function fileAdmin() { try { return !!(window.__DASHAPI && window.__DASHAPI.isAdmin && window.__DASHAPI.isAdmin()); } catch (e) { return false; } }
  function isAdmin() { var a = auth(); return (a && a.app === "admin") || fileAdmin(); }

  // ---------- palette button + picker ----------
  var CSS = ".btp-b{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:99px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);cursor:pointer;font-size:17px;padding:0;flex:none;margin:0 6px;line-height:1;color:inherit}" +
    ".btp-b.fx{position:fixed;top:10px;right:10px;z-index:99990;background:#fff;border-color:#ddd;box-shadow:0 2px 10px rgba(0,0,0,.18)}" +
    ".btp-ov{position:fixed;inset:0;background:rgba(10,12,24,.55);z-index:99999;display:flex;align-items:flex-end;justify-content:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".btp-s{background:#fff;color:#141833;width:100%;max-width:560px;max-height:90vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box}" +
    "@media(min-width:700px){.btp-ov{align-items:center}.btp-s{border-radius:20px}}" +
    ".btp-s h3{margin:0 0 2px;font-size:18px}.btp-s .m{color:#6B7088;font-size:12.5px}.btp-g{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:12px}" +
    ".btp-c{border:2px solid #E3E5EF;border-radius:14px;padding:9px;cursor:pointer;background:#fff;text-align:left;font:inherit;color:#141833}.btp-c.on{border-color:#415FFF;box-shadow:0 0 0 3px rgba(65,95,255,.15)}" +
    ".btp-sw{display:flex;height:34px;border-radius:9px;overflow:hidden;margin-bottom:7px}.btp-sw i{flex:1}.btp-sw i:first-child{flex:2}" +
    ".btp-c b{display:block;font-size:13.5px}.btp-c small{display:block;color:#6B7088;font-size:11.5px;line-height:1.3;margin-top:1px}" +
    ".btp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.btp-btn{border:0;border-radius:10px;padding:10px 14px;font:600 13.5px inherit;cursor:pointer;background:#F0F1F8;color:#2A2F4A}" +
    ".btp-btn.p{background:#415FFF;color:#fff}.btp-adm{margin-top:16px;border-top:1px dashed #D5D8E6;padding-top:12px}.btp-adm h4{margin:0 0 6px;font-size:14px}" +
    ".btp-adm label{display:flex;gap:8px;align-items:center;font-size:13px;margin-top:7px;cursor:pointer}.btp-adm select{border:1px solid #D5D8E6;border-radius:9px;padding:7px;font:inherit;font-size:13px;width:100%;margin-top:4px}" +
    ".btp-chk{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.btp-chk label{margin:0;border:1px solid #E3E5EF;border-radius:99px;padding:4px 10px;font-size:12px}" +
    ".btp-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px}.btp-cols label{display:block;font-size:11.5px;color:#6B7088;margin:0}.btp-cols input{width:100%;height:36px;border:1px solid #D5D8E6;border-radius:8px;padding:2px;margin-top:3px;box-sizing:border-box}" +
    ".btp-note{background:#FFF6DD;color:#7A5300;border-radius:10px;padding:8px 10px;font-size:12.5px;margin-top:10px}";
  function css() { if (document.getElementById("btp-css")) return; var s = document.createElement("style"); s.id = "btp-css"; s.setAttribute("data-bt-skip", "1"); s.textContent = CSS; (document.head || document.documentElement).appendChild(s); }
  function paintButton() { var b = document.getElementById("btp-b"); if (b) b.title = "Theme: " + (CUR ? CUR.name : "original"); }
  function slot() {
    var d = document.querySelector("#rp .top .wrap"); if (d) return { el: d, before: d.querySelector(".burger") };
    var h = document.querySelector(".hero .top"); if (h) return { el: h, before: h.lastElementChild };
    return null;
  }
  function placeButton() {
    if (!document.body || document.getElementById("btp-b")) return;
    if (CFG.allowUser === false && !isAdmin()) return;
    css();
    var b = document.createElement("button"); b.id = "btp-b"; b.type = "button"; b.className = "btp-b"; b.setAttribute("data-bt-skip", "1"); b.setAttribute("aria-label", "Change theme"); b.textContent = "🎨";
    b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openPicker(); };
    var s = slot();
    if (s) s.el.insertBefore(b, s.before && s.before.parentNode === s.el ? s.before : null);
    else if (document.getElementById("biw-root") || document.getElementById("dash-root")) { b.className += " fx"; document.body.appendChild(b); }
    else return;
    paintButton();
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function swatch(t) { var c = (CFG.custom && CFG.custom[t.id]) || {}; return '<div class="btp-sw"><i style="background:' + (c.deep || t.deep) + '"></i><i style="background:' + (c.accent || t.accent) + '"></i><i style="background:' + (c.tint || t.tint) + '"></i></div>'; }
  function openPicker() {
    css();
    var ov = document.createElement("div"); ov.className = "btp-ov"; ov.setAttribute("data-bt-skip", "1");
    var mine = ls("biw-theme") || "", adm = isAdmin(), en = enabled(), def = defaultId(), cur = CUR ? CUR.id : "";
    var h = '<div class="btp-s"><h3>🎨 Theme</h3><div class="m">Your choice is remembered on this device. ' + (def ? "Default for everyone: <b>" + esc(BYID[def].name) + "</b>." : "Default: the original look.") + "</div>";
    if (CFG.allowUser === false) h += '<div class="btp-note">HO has set one theme for everyone' + (adm ? " — you can still change it below as admin." : ".") + "</div>";
    else {
      h += '<div class="btp-g">' + en.map(function (t) { return '<button class="btp-c' + (mine === t.id ? " on" : "") + '" data-id="' + t.id + '">' + swatch(t) + "<b>" + esc(t.name) + (t.id === def ? " · default" : "") + "</b><small>" + esc(t.desc) + "</small></button>"; }).join("") +
        (CFG.auto !== false && BYID.midnight && en.some(function (t) { return t.id === "midnight"; }) ? '<button class="btp-c' + (mine === "auto" ? " on" : "") + '" data-id="auto"><div class="btp-sw"><i style="background:#0B0F1C"></i><i style="background:' + (def ? BYID[def].accent : "#C9A227") + '"></i><i style="background:#F3F4F9"></i></div><b>Auto</b><small>Midnight when the phone is in dark mode</small></button>' : "") + "</div>" +
        '<div class="btp-row"><button class="btp-btn" data-id="">↺ Use the default' + (def ? " (" + esc(BYID[def].name) + ")" : "") + "</button></div>";
    }
    if (adm) {
      var on = Array.isArray(CFG.on) && CFG.on.length ? CFG.on : THEMES.map(function (t) { return t.id; });
      h += '<div class="btp-adm"><h4>🛡️ Admin · for everyone</h4><div class="m">Changes apply to all users of the dashboard, both apps and the web.</div>' +
        '<label style="display:block">Default theme<select id="btp-def"><option value="">Original look (no theme)</option>' + THEMES.map(function (t) { return '<option value="' + t.id + '"' + (t.id === CFG.def || (!CFG.def && FILE && FILE.def === t.id) ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") + "</select></label>" +
        '<div class="m" style="margin-top:10px">Themes people can pick</div><div class="btp-chk">' + THEMES.map(function (t) { return '<label><input type="checkbox" data-on="' + t.id + '"' + (on.indexOf(t.id) >= 0 ? " checked" : "") + "> " + esc(t.name) + "</label>"; }).join("") + "</div>" +
        '<label><input type="checkbox" id="btp-allow"' + (CFG.allowUser !== false ? " checked" : "") + "> Let people choose their own theme</label>" +
        '<label><input type="checkbox" id="btp-auto"' + (CFG.auto !== false ? " checked" : "") + "> Offer “Auto” (Midnight in phone dark mode)</label>" +
        '<label><input type="checkbox" id="btp-dauto"' + (CFG.defAuto ? " checked" : "") + "> Switch to Midnight automatically in phone dark mode for people who haven’t picked a theme</label>" +
        '<div class="m" style="margin-top:12px">Customise colours</div><select id="btp-ct">' + THEMES.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + "</option>"; }).join("") + '</select><div class="btp-cols" id="btp-cols"></div><div class="btp-row" style="margin-top:6px"><button class="btp-btn" id="btp-prev">👁 Preview</button><button class="btp-btn" id="btp-rst">↺ Original colours</button></div>' +
        '<div class="btp-row" style="margin-top:14px"><button class="btp-btn p" id="btp-save">💾 Save for everyone</button></div><div id="btp-msg"></div></div>';
    }
    h += '<div class="btp-row" style="justify-content:flex-end"><button class="btp-btn" id="btp-x">Close</button></div></div>';
    ov.innerHTML = h; document.body.appendChild(ov);
    var close = function () { ov.remove(); refresh(); };
    ov.onclick = function (e) { if (e.target === ov) close(); };
    ov.querySelector("#btp-x").onclick = close;
    Array.prototype.forEach.call(ov.querySelectorAll("[data-id]"), function (b) {
      b.onclick = function () { var id = b.getAttribute("data-id"); ls("biw-theme", id || null); refresh(); Array.prototype.forEach.call(ov.querySelectorAll(".btp-c"), function (x) { x.classList.toggle("on", x.getAttribute("data-id") === id); }); };
    });
    if (!adm) return;
    var draft = JSON.parse(JSON.stringify(CFG || {})); draft.custom = draft.custom || {};
    var ct = ov.querySelector("#btp-ct");
    var cols = function () {
      var t = BYID[ct.value], c = draft.custom[t.id] || {};
      ov.querySelector("#btp-cols").innerHTML = [["accent", "Accent"], ["deep", "Header / dark"], ["tint", "Background tint"]].map(function (x) { return '<label>' + x[1] + '<input type="color" data-k="' + x[0] + '" value="' + (c[x[0]] || t[x[0]]).toLowerCase() + '"></label>'; }).join("");
      Array.prototype.forEach.call(ov.querySelectorAll("#btp-cols input"), function (i) { i.oninput = function () { var o = draft.custom[t.id] = draft.custom[t.id] || {}; o[i.getAttribute("data-k")] = i.value.toUpperCase(); }; });
    };
    ct.value = cur || def || "signature"; cols(); ct.onchange = cols;
    ov.querySelector("#btp-prev").onclick = function () { var keep = CFG; CFG = Object.assign({}, CFG, { custom: draft.custom }); apply(BYID[ct.value]); CUR._cs = "preview"; CFG = keep; };
    ov.querySelector("#btp-rst").onclick = function () { delete draft.custom[ct.value]; cols(); };
    ov.querySelector("#btp-save").onclick = function () {
      var c = { def: ov.querySelector("#btp-def").value, on: Array.prototype.filter.call(ov.querySelectorAll("[data-on]"), function (i) { return i.checked; }).map(function (i) { return i.getAttribute("data-on"); }),
        allowUser: ov.querySelector("#btp-allow").checked, auto: ov.querySelector("#btp-auto").checked, defAuto: ov.querySelector("#btp-dauto").checked, custom: draft.custom };
      if (c.def && c.on.indexOf(c.def) < 0) c.on.push(c.def);
      var msg = ov.querySelector("#btp-msg"), parts = [], a = auth(), jobs = [];
      if (a && a.app === "admin") jobs.push(post({ app: "admin", username: a.username, token: a.token, action: "theme-set", theme: c }).then(function (r) { if (r && r.ok) { CFG = r.theme; ls("biw-theme-cfg", JSON.stringify(CFG)); parts.push("✅ Saved for everyone — apps and web update on their next open."); } else parts.push("⚠️ " + ((r && r.error) || "Couldn't save online.")); }));
      if (fileAdmin()) { try { var api = window.__DASHAPI; api.META.theme = c; FILE = c; api.markDirty(); parts.push("📄 Also stored in this dashboard file — now use <b>Export & share → Save updated file</b>."); } catch (e) { } }
      if (!jobs.length && !fileAdmin()) parts.push("⚠️ Log in as an HO admin to save.");
      Promise.all(jobs).then(function () { if (!(a && a.app === "admin")) { CFG = Object.assign({}, CFG, c); ls("biw-theme-cfg", JSON.stringify(CFG)); } refresh(); msg.innerHTML = '<div class="btp-note">' + parts.join("<br>") + "</div>"; });
    };
  }

  // ---------- public ----------
  window.BITHEME = {
    themes: THEMES, open: openPicker, current: function () { return CUR ? CUR.id : ""; },
    set: function (id) { ls("biw-theme", id || null); refresh(); },
    fileDefault: function (t) { if (t && typeof t === "object") { FILE = t; if (!CFG.def && t.custom && !CFG.custom) CFG = Object.assign({}, t, CFG); refresh(); } },
    _map: function (css, id) { var T = BYID[id]; return T ? mapDecls(css, prep(T)) : css; }
  };
  refresh();
  var tries = 0; (function place() { placeButton(); if (!document.getElementById("btp-b") && tries++ < 40) setTimeout(place, 250); })();
  document.addEventListener("DOMContentLoaded", function () { placeButton(); if (window.__DASHAPI) BITHEME.fileDefault(window.__DASHAPI.META && window.__DASHAPI.META.theme); });
  setInterval(function () { if (!document.getElementById("btp-b")) placeButton(); }, 3000);
  loadCfg();
})();
