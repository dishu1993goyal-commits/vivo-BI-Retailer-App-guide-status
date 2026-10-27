// Theme switcher for the BI dashboard, every shared tool page and the web layer — web and both apps.
// Recolours the page's own styles (and inline colours) from its original palette to the chosen theme, without
// touching the original <style> text, so "Save updated file" still saves the original design.
//   Choice per person/device: localStorage "biw-theme" = theme id | "auto"
//   Default for everyone: set by HO admins → server (config:theme) + optionally the dashboard file (META.theme)
(function () {
  "use strict";
  if (window.BITHEME) return;
  var THEMES = [
    { id: "signature", cat: "Brand", name: "vivo Signature", desc: "Brand blue — the vivo look", accent: "#415FFF", deep: "#0A1C5C", tint: "#F2F5FF" },
    { id: "vsky", cat: "Brand", name: "vivo Sky", desc: "Light, airy brand blue", accent: "#2E6BFF", deep: "#0B2A6F", tint: "#EEF4FF" },
    { id: "xblack", cat: "Brand", name: "X Series Black", desc: "Premium black and silver", accent: "#8D97AD", deep: "#0B0C10", tint: "#F4F5F7" },
    { id: "vaurora", cat: "Brand", name: "V Series Aurora", desc: "Purple glow of the V series", accent: "#7B4DF9", deep: "#2A1458", tint: "#F5F0FF" },
    { id: "yteal", cat: "Brand", name: "Y Series Teal", desc: "Fresh and youthful", accent: "#00A3A3", deep: "#00393D", tint: "#ECFAFA" },
    { id: "tenergy", cat: "Brand", name: "T Series Energy", desc: "Bold orange energy", accent: "#FF5A1F", deep: "#2B0F05", tint: "#FFF3EC" },
    { id: "classic", cat: "Brand", name: "Classic", desc: "The original black and gold", accent: "#C9A227", deep: "#0B0B0C", tint: "#FBF9F3" },
    { id: "aurora", cat: "Brand", name: "Aurora", desc: "Indigo to violet", accent: "#5B5BF6", deep: "#1B1F5E", tint: "#F3F4F9" },
    { id: "royal", cat: "Brand", name: "Royal Indigo", desc: "Deep navy — for management reviews", accent: "#5146C9", deep: "#12153A", tint: "#F5F5FB" },
    { id: "sunrise", cat: "Festive", name: "Sunrise", desc: "Saffron and maroon — festive", accent: "#F2711C", deep: "#5B1A2E", tint: "#FFF5EC" },
    { id: "marigold", cat: "Festive", name: "Marigold", desc: "Warm marigold yellow", accent: "#F5A300", deep: "#5C2A00", tint: "#FFF7E6" },
    { id: "diwali", cat: "Festive", name: "Diwali Gold", desc: "Gold diyas on deep brown", accent: "#E0A82E", deep: "#3B1F00", tint: "#FFF9EC" },
    { id: "rangoli", cat: "Festive", name: "Rangoli", desc: "Pink and magenta colours", accent: "#E91E63", deep: "#4A0D2B", tint: "#FFF0F6" },
    { id: "holi", cat: "Festive", name: "Holi", desc: "Playful pink and violet", accent: "#FF4FA3", deep: "#2E1A6B", tint: "#FFF2FA" },
    { id: "navratri", cat: "Festive", name: "Navratri", desc: "Rich festive crimson", accent: "#C2185B", deep: "#3D0820", tint: "#FDEFF5" },
    { id: "durga", cat: "Festive", name: "Durga Puja", desc: "Red and white of the pandal", accent: "#D32F2F", deep: "#3E0A0A", tint: "#FFF3F0" },
    { id: "ganesh", cat: "Festive", name: "Ganesh Utsav", desc: "Vermilion and saffron", accent: "#FF7A00", deep: "#5A1E00", tint: "#FFF4EA" },
    { id: "onam", cat: "Festive", name: "Onam", desc: "Banana-leaf green", accent: "#2E9E4F", deep: "#123D22", tint: "#F2FBF0" },
    { id: "pongal", cat: "Festive", name: "Pongal", desc: "Harvest yellow", accent: "#E6A100", deep: "#4A3200", tint: "#FFFAEA" },
    { id: "lohri", cat: "Festive", name: "Lohri", desc: "Bonfire orange", accent: "#FF6F00", deep: "#3D1C00", tint: "#FFF6EC" },
    { id: "eid", cat: "Festive", name: "Eid", desc: "Calm emerald and white", accent: "#1B8A5A", deep: "#0A3524", tint: "#EEF9F3" },
    { id: "christmas", cat: "Festive", name: "Christmas", desc: "Red and pine green", accent: "#C62828", deep: "#1B3B1F", tint: "#FFF4F2" },
    { id: "newyear", cat: "Festive", name: "New Year Silver", desc: "Silver sparkle", accent: "#8E99B5", deep: "#141826", tint: "#F4F6FA" },
    { id: "tiranga", cat: "Festive", name: "Tiranga", desc: "Saffron, white and navy", accent: "#FF9933", deep: "#0B3D91", tint: "#F7FBF5" },
    { id: "bihu", cat: "Festive", name: "Bihu", desc: "Assam red and cream", accent: "#B71C1C", deep: "#3B0B0B", tint: "#FFF8EE" },
    { id: "emerald", cat: "Nature", name: "Emerald", desc: "Fresh teal", accent: "#0E9F8E", deep: "#0B3B3C", tint: "#EEF8F6" },
    { id: "peacock", cat: "Nature", name: "Peacock", desc: "Peacock blue-green", accent: "#0F8FA3", deep: "#073B4C", tint: "#EAF7FA" },
    { id: "lotus", cat: "Nature", name: "Lotus", desc: "Soft lotus pink", accent: "#E86A92", deep: "#5A1F38", tint: "#FFF1F5" },
    { id: "monsoon", cat: "Nature", name: "Monsoon", desc: "Rainy-day blue", accent: "#3E7CB1", deep: "#14324D", tint: "#EEF4FA" },
    { id: "mango", cat: "Nature", name: "Mango", desc: "Ripe mango and leaf", accent: "#F2A900", deep: "#3A4A00", tint: "#FFFBEA" },
    { id: "forest", cat: "Nature", name: "Forest", desc: "Deep forest green", accent: "#2F7D32", deep: "#123214", tint: "#F0F7EF" },
    { id: "ocean", cat: "Nature", name: "Ocean", desc: "Deep sea blue", accent: "#0077B6", deep: "#03304D", tint: "#EAF6FC" },
    { id: "sky", cat: "Nature", name: "Sky", desc: "Clear sky blue", accent: "#3BA3F5", deep: "#0D3B66", tint: "#EEF7FF" },
    { id: "mint", cat: "Nature", name: "Mint", desc: "Cool mint", accent: "#14B8A6", deep: "#0B3B37", tint: "#ECFDF9" },
    { id: "lavender", cat: "Nature", name: "Lavender", desc: "Gentle lavender", accent: "#8B6FD9", deep: "#2E2160", tint: "#F5F2FF" },
    { id: "sakura", cat: "Nature", name: "Cherry Blossom", desc: "Blossom pink", accent: "#F06292", deep: "#4A1430", tint: "#FFF0F5" },
    { id: "citrus", cat: "Nature", name: "Citrus", desc: "Zesty orange-yellow", accent: "#F59E0B", deep: "#3D2A00", tint: "#FFFBEB" },
    { id: "turquoise", cat: "Nature", name: "Turquoise", desc: "Bright turquoise", accent: "#06B6D4", deep: "#073B47", tint: "#ECFEFF" },
    { id: "arctic", cat: "Nature", name: "Arctic", desc: "Icy light blue", accent: "#5DADE2", deep: "#0E2A3B", tint: "#F2F9FD" },
    { id: "desert", cat: "Nature", name: "Sandstone", desc: "Rajasthan sandstone", accent: "#C47A3A", deep: "#3E2412", tint: "#FBF5EE" },
    { id: "graphite", cat: "Professional", name: "Graphite", desc: "Neutral grey — clean reports", accent: "#4B5563", deep: "#111827", tint: "#F5F6F8" },
    { id: "slate", cat: "Professional", name: "Slate", desc: "Slate blue-grey", accent: "#475569", deep: "#0F172A", tint: "#F4F6FA" },
    { id: "steel", cat: "Professional", name: "Steel", desc: "Steel blue", accent: "#4A6FA5", deep: "#1A2638", tint: "#F3F6FA" },
    { id: "sapphire", cat: "Professional", name: "Sapphire", desc: "Rich sapphire blue", accent: "#2747C9", deep: "#0E1A4F", tint: "#F1F4FF" },
    { id: "ruby", cat: "Professional", name: "Ruby", desc: "Deep ruby red", accent: "#B3123A", deep: "#3A0614", tint: "#FFF1F4" },
    { id: "wine", cat: "Professional", name: "Wine", desc: "Burgundy", accent: "#8E2457", deep: "#2E0A1C", tint: "#FBF1F5" },
    { id: "copper", cat: "Professional", name: "Copper", desc: "Warm copper", accent: "#B87333", deep: "#3A2210", tint: "#FBF4EE" },
    { id: "bronze", cat: "Professional", name: "Bronze", desc: "Classic bronze", accent: "#A97142", deep: "#33210F", tint: "#FAF4EE" },
    { id: "champagne", cat: "Professional", name: "Champagne", desc: "Soft champagne gold", accent: "#C9A86A", deep: "#3A2F1A", tint: "#FBF8F1" },
    { id: "rosegold", cat: "Professional", name: "Rose Gold", desc: "Rose gold", accent: "#B76E79", deep: "#3B1E23", tint: "#FBF2F3" },
    { id: "coral", cat: "Professional", name: "Coral", desc: "Living coral", accent: "#FF6F61", deep: "#4A1A15", tint: "#FFF3F1" },
    { id: "plum", cat: "Professional", name: "Plum", desc: "Deep plum", accent: "#7B2D8E", deep: "#2A0D33", tint: "#F8F1FA" },
    { id: "midnight", cat: "Dark", name: "Midnight", desc: "Dark mode — easy on the eyes at night", accent: "#8B9BFF", deep: "#0B0F1C", tint: "#141A2E", dark: true },
    { id: "charcoal", cat: "Dark", name: "Charcoal", desc: "Neutral dark grey", accent: "#60A5FA", deep: "#0E1013", tint: "#16191E", dark: true },
    { id: "amoled", cat: "Dark", name: "AMOLED Black", desc: "True black — saves battery", accent: "#4D7CFF", deep: "#000000", tint: "#0A0A0A", dark: true },
    { id: "oceannight", cat: "Dark", name: "Ocean Night", desc: "Dark navy with cyan", accent: "#38BDF8", deep: "#04131F", tint: "#0B1E2D", dark: true },
    { id: "forestnight", cat: "Dark", name: "Forest Night", desc: "Dark green", accent: "#4ADE80", deep: "#06140B", tint: "#0D2116", dark: true },
    { id: "plumnight", cat: "Dark", name: "Plum Night", desc: "Dark purple", accent: "#C084FC", deep: "#120818", tint: "#1E1027", dark: true },
    { id: "diwalinight", cat: "Dark", name: "Diwali Night", desc: "Gold lights on black", accent: "#E6C35C", deep: "#0D0B05", tint: "#1A160B", dark: true },
    { id: "crimsonnight", cat: "Dark", name: "Crimson Night", desc: "Dark with red accents", accent: "#F87171", deep: "#140707", tint: "#211010", dark: true }
  ];
  var CATS = ["Brand", "Festive", "Nature", "Professional", "Dark"];
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
    if (T._ind && isStatus(h, s)) {   // admin's indicator colours (good / watch / needs action)
      var k = (h >= 85 && h <= 175) ? "good" : (h <= 22 || h >= 335) ? "bad" : (h >= 25 && h <= 60 && SRC !== "classic") ? "warn" : null, q = k && T._ind[k];
      if (q) { res = hsl2rgb(q[0], q[1] * (0.55 + s * 0.45), T.dark && role === "t" ? Math.max(l, 0.62) : T.dark && l > 0.8 ? 0.18 : l); return (MEMO[key] = out(res, a)); }
    }
    if (T.identity) return (MEMO[key] = null);
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
  function indOf() { var I = CFG.ind || {}, o = {}; ["good", "warn", "bad"].forEach(function (k) { if (/^#[0-9a-f]{6}$/i.test(I[k] || "")) o[k] = hslOf(I[k]); }); return Object.keys(o).length ? o : null; }
  function effTheme() {   // what the colour engine should do on this page
    var ind = indOf(), native = !CUR || CUR.id === SRC && !(CFG.custom && CFG.custom[CUR.id]);
    if (!native) { CUR._ind = ind; return CUR; }
    if (!ind) return null;
    var base = prep(BYID[SRC]); base.identity = true; base._ind = ind; return base;
  }
  function apply(T) {
    CUR = T ? prep(T) : null; MEMO = {};
    var TT = effTheme();
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
        var T = effTheme();
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
    studio();
    try { window.dispatchEvent(new CustomEvent("bitheme", { detail: { id: CUR ? CUR.id : "" } })); } catch (e) { }
    if (document.getElementById("btp-b")) paintButton();
  }

  // ---------- which theme? person's pick > admin default (server) > dashboard file default > original look ----------
  function phoneDark() { try { if (window.AndroidDL && window.AndroidDL.isNight) return !!window.AndroidDL.isNight(); } catch (e) { } return !!(MQ && MQ.matches); }
  var LEGACY = ["signature", "classic", "aurora", "emerald", "royal", "sunrise", "midnight"];
  function enabled() { var on = Array.isArray(CFG.on) && CFG.on.length && !(CFG.on.length === LEGACY.length && LEGACY.every(function (x) { return CFG.on.indexOf(x) >= 0; })) ? CFG.on : THEMES.map(function (t) { return t.id; }); return THEMES.filter(function (t) { return on.indexOf(t.id) >= 0; }); }
  function defaultId() { var d = CFG.def || (FILE && FILE.def) || ""; return BYID[d] ? d : ""; }
  function pickId() {
    var mine = CFG.allowUser === false ? null : ls("biw-theme"), en = enabled().map(function (t) { return t.id; });
    if (mine === "auto" && CFG.auto !== false) return phoneDark() ? "midnight" : defaultId();
    if (mine && BYID[mine] && en.indexOf(mine) >= 0) return mine;
    if (CFG.defAuto && phoneDark() && BYID.midnight) return "midnight";
    return defaultId();
  }
  var SIG = "";
  function refresh() { var id = pickId(), sig = JSON.stringify([CFG.ind || null, CFG.custom && CFG.custom[id] || null]); if ((CUR ? CUR.id : "") !== id || sig !== SIG) { SIG = sig; apply(BYID[id] || null); } else studio(); }
  // ---------- design studio: background art + cards + layout (admin settings, applied for everyone) ----------
  var PAGE = SRC === "classic" ? "dashboard" : "tools";
  var PATTERNS = {
    rangoli: function (c) { return '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><g fill="none" stroke="' + c + '" stroke-opacity=".5" stroke-width="2"><circle cx="60" cy="60" r="22"/><circle cx="60" cy="60" r="10"/>' + [0, 45, 90, 135, 180, 225, 270, 315].map(function (d) { return '<ellipse cx="60" cy="30" rx="7" ry="13" transform="rotate(' + d + ' 60 60)"/>'; }).join("") + '</g><g fill="' + c + '" fill-opacity=".35"><circle cx="0" cy="0" r="4"/><circle cx="120" cy="0" r="4"/><circle cx="0" cy="120" r="4"/><circle cx="120" cy="120" r="4"/></g></svg>'; },
    diyas: function (c) { return '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90"><g fill="' + c + '" fill-opacity=".45"><path d="M25 52c0 7 9 11 20 11s20-4 20-11z"/><path d="M45 34c4 5 5 9 0 14-5-5-4-9 0-14z" fill-opacity=".7"/></g><circle cx="10" cy="12" r="2" fill="' + c + '" fill-opacity=".4"/><circle cx="78" cy="20" r="1.6" fill="' + c + '" fill-opacity=".4"/><circle cx="70" cy="80" r="2.2" fill="' + c + '" fill-opacity=".35"/></svg>'; },
    waves: function (c) { return '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60" viewBox="0 0 160 60"><path d="M0 30 Q20 10 40 30 T80 30 T120 30 T160 30" fill="none" stroke="' + c + '" stroke-opacity=".35" stroke-width="2"/><path d="M0 50 Q20 30 40 50 T80 50 T120 50 T160 50" fill="none" stroke="' + c + '" stroke-opacity=".2" stroke-width="2"/></svg>'; },
    dots: function (c) { return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="3" cy="3" r="2" fill="' + c + '" fill-opacity=".3"/></svg>'; },
    grid: function (c) { return '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path d="M40 0H0V40" fill="none" stroke="' + c + '" stroke-opacity=".18"/></svg>'; },
    diagonal: function (c) { return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M-4 4l8-8M0 16L16 0M12 20l8-8" stroke="' + c + '" stroke-opacity=".22" stroke-width="2"/></svg>'; },
    confetti: function (c) { return '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140"><g fill="' + c + '" fill-opacity=".4"><rect x="12" y="20" width="8" height="3" transform="rotate(30 16 21)"/><rect x="90" y="14" width="9" height="3" transform="rotate(-40 94 15)"/><circle cx="60" cy="60" r="3"/><rect x="30" y="100" width="8" height="3" transform="rotate(70 34 101)"/><circle cx="118" cy="96" r="2.5"/><rect x="100" y="60" width="7" height="3" transform="rotate(15 103 61)"/></g></svg>'; },
    mandala: function (c) { return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><g fill="none" stroke="' + c + '" stroke-opacity=".28" stroke-width="1.5">' + [20, 40, 60, 80].map(function (r) { return '<circle cx="100" cy="100" r="' + r + '"/>'; }).join("") + Array.from({ length: 16 }, function (_, i) { return '<path d="M100 100 L100 18" transform="rotate(' + i * 22.5 + ' 100 100)"/>'; }).join("") + Array.from({ length: 12 }, function (_, i) { return '<ellipse cx="100" cy="52" rx="10" ry="22" transform="rotate(' + i * 30 + ' 100 100)"/>'; }).join("") + "</g></svg>"; },
    glow: function (c) { return ""; }
  };
  var CARD_SEL = { dashboard: [".rp .card", ".rp .tile", ".rp .pp", ".rp .m-card", ".rp .sdc", ".rp .t5", ".rp a.rm-tile", ".rp .cpan", ".rp .fgroup", ".rp .rm-out", ".rp .tip"], tools: [".card", ".tl", ".bx", ".it2", ".al", ".pp", ".res", ".sv", ".of", ".ln", ".nt", ".ev", ".gi", ".tipc", ".mapw", ".it", ".quick button", ".lst", ".rk", ".bg", ".wc", ".mp", ".nar", ".dg", ".types button", ".ops button"] };
  function inScope(sc) { return !sc || sc === "all" || sc === PAGE; }
  // ---------- dashboard tab layout (order / show / rename) ----------
  var DEF_TABS = [["overview", "Overview"], ["rank", "Rankings"], ["trend", "Trends"], ["app", "Retailer app"], ["retv", "Active retailers"], ["sd", "Support desk"], ["plan", "Action plan"], ["news", "BI Newsletter"], ["creative", "HO Creative"], ["cfg", "Configuration"], ["rm", "Roadmap 2027"], ["how", "How to use"], ["kq4", "KPI framework"], ["grw", "Growth"], ["cmp", "Compare"], ["onb", "Onboarded"], ["q3", "Q3 rankings"], ["dl", "Get the app"], ["tl", "Smart tools"]];
  function labelOf(b) { var sp = b.querySelector(".tl"); return (sp ? sp.textContent : b.textContent).trim(); }
  function setLabel(b, t) { var sp = b.querySelector(".tl"); if (sp) sp.textContent = t; else if (b.querySelector("svg")) { var n = Array.prototype.filter.call(b.childNodes, function (c) { return c.nodeType === 3 && c.nodeValue.trim(); })[0]; if (n) n.nodeValue = t; } else b.textContent = t; }
  function tabList() {
    var tb = document.getElementById("tabs"), out = [], seen = {};
    if (tb) Array.prototype.forEach.call(tb.querySelectorAll("button[data-t]"), function (b) { var k = b.dataset.t; if (seen[k]) return; seen[k] = 1; if (b.dataset.bto == null) b.dataset.bto = labelOf(b); out.push([k, b.dataset.bto]); });
    return out.length ? out : DEF_TABS;
  }
  function applyTabs() {
    var tb = document.getElementById("tabs"); if (!tb || PAGE !== "dashboard") return;
    var T = CFG.tabs || {}, hide = T.hide || [], names = T.names || {}, order = T.order || [];
    var btns = Array.prototype.slice.call(tb.querySelectorAll("button[data-t]")); if (!btns.length) return;
    var links = Array.prototype.slice.call(document.querySelectorAll("#mlist a[data-t]"));
    btns.concat(links).forEach(function (b) {
      var k = b.dataset.t; if (b.dataset.bto == null) b.dataset.bto = labelOf(b);
      var want = names[k] || b.dataset.bto; if (labelOf(b) !== want) setLabel(b, want);
      var off = k !== "overview" && hide.indexOf(k) >= 0; if (off !== (b.style.display === "none")) b.style.display = off ? "none" : "";
    });
    if (order.length) {
      var rank = function (b) { var i = order.indexOf(b.dataset.t); return i < 0 ? 900 + btns.indexOf(b) : i; };
      var sorted = btns.slice().sort(function (a, b) { return rank(a) - rank(b); });
      if (sorted.some(function (b, i) { return b !== btns[i]; })) { sorted.forEach(function (b) { tb.appendChild(b); }); Array.prototype.forEach.call(tb.querySelectorAll(".tgl"), function (g) { g.style.display = "none"; }); }
      var ml = document.getElementById("mlist"); if (ml) links.slice().sort(function (a, b) { var x = order.indexOf(a.dataset.t), y = order.indexOf(b.dataset.t); return (x < 0 ? 900 : x) - (y < 0 ? 900 : y); }).forEach(function (a) { ml.appendChild(a); });
    }
  }
  function studio() {
    var C = CFG.card || {}, A = CFG.art || {}, T = CUR || prep(BYID[SRC]), acc = T.accent, deep = T.deep, tint = T.tint, dark = !!(CUR && CUR.dark), x = "";
    var sel = function (extra) { return CARD_SEL[PAGE].map(function (q) { return "html body " + q + (extra || ""); }).join(","); };
    if (inScope(C.scope)) {
      var R = { sharp: "3px", soft: "8px", rounded: "14px", round: "22px", pill: "30px" }[C.radius];
      if (R) x += sel() + "{border-radius:" + R + "!important}";
      var bgc = dark ? "rgba(22,26,40,.62)" : "rgba(255,255,255,.74)";
      x += { glass: sel() + "{background:" + bgc + "!important;-webkit-backdrop-filter:blur(12px) saturate(1.2);backdrop-filter:blur(12px) saturate(1.2);border:1px solid " + (dark ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.6)") + "!important;box-shadow:0 8px 24px rgba(20,24,51,.10)!important}",
        outline: sel() + "{box-shadow:none!important;border:1.5px solid " + acc + "55!important}",
        soft: sel() + "{box-shadow:0 2px 6px rgba(20,24,51,.05)!important;border:1px solid rgba(20,24,51,.07)!important}",
        elevated: sel() + "{box-shadow:0 16px 36px -14px rgba(20,24,51,.38)!important}",
        gradient: sel() + "{background-image:linear-gradient(160deg," + (dark ? "rgba(255,255,255,.04)" : "#ffffff") + "," + (dark ? acc + "22" : tint) + ")!important}",
        flat: sel() + "{box-shadow:none!important;border:0!important}" }[C.style] || "";
      if (C.accentBar === "left") x += sel() + "{border-left:4px solid " + acc + "!important}";
      if (C.accentBar === "top") x += sel() + "{border-top:4px solid " + acc + "!important}";
      if (C.density === "compact") x += sel() + "{padding:9px 11px!important}";
      if (C.density === "comfortable") x += sel() + "{padding:18px 18px!important}";
      var F = { rounded: '"Nunito","Varela Round","SF Pro Rounded",ui-rounded,system-ui,sans-serif', serif: 'Georgia,"Noto Serif","Times New Roman",serif', modern: '"Inter","Segoe UI","Roboto",system-ui,sans-serif', condensed: '"Roboto Condensed","Arial Narrow","sans-serif-condensed",sans-serif' }[C.font];
      if (F) x += "html body,html body button,html body input,html body select,html body textarea{font-family:" + F + "!important}";
      var Z = { small: 0.92, large: 1.08, xl: 1.16 }[C.text]; if (Z) x += "html body{zoom:" + Z + "}";
      if (PAGE === "tools") { if (C.hero === "solid") x += "html body .hero{background:" + deep + "!important}"; if (C.hero === "compact") x += "html body .hero{padding-bottom:30px!important}html body .hero h1{font-size:20px!important}"; if (C.hero === "accent") x += "html body .hero{background:linear-gradient(135deg," + deep + "," + acc + ")!important}"; if (C.hero === "art" && A.on && (A.url || A.pattern)) x += "html body .hero{background:" + deep + "cc!important;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}"; }
      else { if (C.hero === "solid") x += "html body .rp .hero{background:" + deep + "!important}"; if (C.hero === "accent") x += "html body .rp .hero{background:linear-gradient(135deg," + deep + "," + acc + ")!important}"; }
      if (C.tiles === "circle") x += "html body .it .ic3{border-radius:99px!important}html body .quick button i{border-radius:99px!important}";
      if (C.tiles === "square") x += "html body .it .ic3{border-radius:6px!important}html body .quick button i{border-radius:6px!important}";
      if (C.buttons === "pill") x += "html body .btn{border-radius:99px!important}";
      if (C.buttons === "square") x += "html body .btn{border-radius:4px!important}";
    }
    var layer = document.getElementById("bt-art");
    if (A.on && inScope(A.scope) && (A.url || A.pattern)) {
      var op = { faint: 0.9, light: 0.78, medium: 0.6, strong: 0.36 }[A.strength] || 0.78, base = dark ? deep : tint;
      var img = A.pattern && PATTERNS[A.pattern] ? (A.pattern === "glow" ? "radial-gradient(60% 50% at 20% 10%," + acc + "55,transparent 70%),radial-gradient(50% 40% at 90% 30%," + deep + "44,transparent 70%),radial-gradient(60% 50% at 50% 100%," + acc + "33,transparent 70%)" : 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(PATTERNS[A.pattern](acc)) + '")') : 'url("' + String(A.url).replace(/"/g, "") + '")';
      var tile = A.pattern && A.pattern !== "glow" || A.fit === "tile";
      x += "html,html body{background:transparent!important}" + (PAGE === "dashboard" ? "html body #rp,html body .rp,html body #dash-root,html body .rp .bnr,html body .rp[data-layout=hub] .filters,html body .rp .wrap,html body .rp main{background:transparent!important}html body .rp .top{background:" + (dark ? "rgba(14,16,22,.82)" : "rgba(255,255,255,.82)") + "!important;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}" : "html body .wrap{background:transparent!important}");
      if (!layer && document.body) { layer = document.createElement("div"); layer.id = "bt-art"; layer.setAttribute("data-bt-skip", "1"); layer.setAttribute("aria-hidden", "true"); document.body.insertBefore(layer, document.body.firstChild); }
      if (layer) {
        layer.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;background-color:" + base + ";background-image:" + img + ";background-size:" + (tile ? "auto" : "cover") + ";background-position:center;background-repeat:" + (tile ? "repeat" : "no-repeat") + (A.blur ? ";filter:blur(" + (+A.blur) + "px);transform:scale(1.04)" : "");
        layer.innerHTML = '<i style="position:absolute;inset:0;background:' + base + ";opacity:" + (A.pattern ? 0 : op) + '"></i>';
      }
    } else if (layer) layer.remove();
    applyTabs();
    var st = document.getElementById("bt-studio");
    if (!x) { if (st) st.remove(); return; }
    if (!st) { st = document.createElement("style"); st.id = "bt-studio"; st.setAttribute("data-bt-skip", "1"); }
    st.textContent = x; (document.head || document.documentElement).appendChild(st);
  }
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
    ".btp-note{background:#FFF6DD;color:#7A5300;border-radius:10px;padding:8px 10px;font-size:12.5px;margin-top:10px}" +
    ".btp-q{width:100%;box-sizing:border-box;border:1px solid #D5D8E6;border-radius:10px;padding:9px 11px;font:inherit;font-size:14px;margin-top:10px}" +
    ".btp-cats,.btp-tabs{display:flex;gap:6px;overflow-x:auto;margin-top:8px;padding-bottom:2px}.btp-cats span,.btp-tabs span{flex:none;border:1px solid #DDE0EF;border-radius:99px;padding:5px 11px;font-size:12.5px;cursor:pointer;font-weight:600;color:#2A2F4A;background:#fff}.btp-cats span.on,.btp-tabs span.on{background:#415FFF;border-color:#415FFF;color:#fff}" +
    ".btp-g2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.btp-g2 label{display:block!important;margin:0!important;font-size:12px;color:#6B7088}" +
    ".btp-art{height:130px;border-radius:12px;overflow:hidden;border:1px solid #E3E5EF;margin-top:8px;background:#F4F5F9}.btp-art img{width:100%;height:100%;object-fit:cover}" +
    ".btp-thumbs{display:flex;gap:8px;overflow-x:auto;margin-top:6px;padding-bottom:4px}.btp-thumbs img,.btp-thumbs span{flex:none;width:92px;height:58px;border-radius:9px;object-fit:cover;border:2px solid #E3E5EF;cursor:pointer;font-size:11px;font-weight:700;color:#2A2F4A;display:flex;align-items:flex-end;justify-content:center;padding-bottom:3px;box-sizing:border-box;text-transform:capitalize}.btp-thumbs .on{border-color:#415FFF;box-shadow:0 0 0 3px rgba(65,95,255,.2)}" +
    ".btp-tl{margin-top:8px;display:flex;flex-direction:column;gap:6px}.btp-tr{display:flex;align-items:center;gap:6px}.btp-tr .btp-btn{padding:6px 10px;margin:0}.btp-tr .btp-btn[disabled]{opacity:.35}.btp-tn{flex:1;min-width:0;border:1px solid #D5D8E6;border-radius:9px;padding:7px 9px;font:inherit;font-size:13px}" +
    ".btp-pv{color:#fff;border-radius:99px;padding:3px 10px;font-size:12px;font-weight:800}";
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
    var ov = document.createElement("div"); ov.className = "btp-ov"; ov.setAttribute("data-bt-skip", "1"); ov.setAttribute("data-noi18n", "1");
    var mine = ls("biw-theme") || "", adm = isAdmin(), en = enabled(), def = defaultId(), cat = ls("biw-theme-cat") || "All", q = "";
    var head = '<div class="btp-s"><h3>🎨 Theme <span class="m" style="font-weight:500">(' + en.length + " to choose from)</span></h3><div class=\"m\">Your choice is remembered on this device. " + (def ? "Default for everyone: <b>" + esc(BYID[def].name) + "</b>." : "Default: the original look.") + "</div>";
    var draw = function () {
      var h = head;
      if (CFG.allowUser === false) h += '<div class="btp-note">HO has set one theme for everyone' + (adm ? " — you can still change it in the Design studio." : ".") + "</div>";
      else {
        var list = en.filter(function (t) { return (cat === "All" || t.cat === cat) && (!q || (t.name + " " + t.desc + " " + t.cat).toLowerCase().indexOf(q) >= 0); });
        h += '<input class="btp-q" id="btp-q" placeholder="Search themes — e.g. Diwali, dark, blue" value="' + esc(q) + '"><div class="btp-cats">' + ["All"].concat(CATS).filter(function (c) { return c === "All" || en.some(function (t) { return t.cat === c; }); }).map(function (c) { return '<span data-cat="' + c + '" class="' + (c === cat ? "on" : "") + '">' + c + "</span>"; }).join("") + "</div>";
        h += '<div class="btp-g">' + list.map(function (t) { return '<button class="btp-c' + (mine === t.id ? " on" : "") + '" data-id="' + t.id + '">' + swatch(t) + "<b>" + esc(t.name) + (t.id === def ? " · default" : "") + "</b><small>" + esc(t.desc) + "</small></button>"; }).join("") +
          (cat === "All" && !q && CFG.auto !== false && en.some(function (t) { return t.id === "midnight"; }) ? '<button class="btp-c' + (mine === "auto" ? " on" : "") + '" data-id="auto"><div class="btp-sw"><i style="background:#0B0F1C"></i><i style="background:' + (def ? BYID[def].accent : "#C9A227") + '"></i><i style="background:#F3F4F9"></i></div><b>Auto</b><small>Midnight when the phone is in dark mode</small></button>' : "") + "</div>" +
          (list.length ? "" : '<div class="m" style="margin-top:10px">No theme matches.</div>') + '<div class="btp-row"><button class="btp-btn" data-id="">↺ Use the default' + (def ? " (" + esc(BYID[def].name) + ")" : "") + "</button></div>";
      }
      if (adm) h += '<div class="btp-adm"><button class="btp-btn p" id="btp-studio" style="width:100%">🛡️ Design studio — themes, background art, cards & indicators for everyone</button></div>';
      h += '<div class="btp-row" style="justify-content:flex-end"><button class="btp-btn" id="btp-x">Close</button></div></div>';
      ov.innerHTML = h;
      ov.querySelector("#btp-x").onclick = close;
      var qi = ov.querySelector("#btp-q"); if (qi) qi.oninput = function () { q = qi.value.toLowerCase().trim(); var p = qi.selectionStart; draw(); var n = ov.querySelector("#btp-q"); n.focus(); try { n.setSelectionRange(p, p); } catch (e) { } };
      Array.prototype.forEach.call(ov.querySelectorAll("[data-cat]"), function (c) { c.onclick = function () { cat = c.getAttribute("data-cat"); ls("biw-theme-cat", cat); draw(); }; });
      Array.prototype.forEach.call(ov.querySelectorAll("[data-id]"), function (b) { b.onclick = function () { var id = b.getAttribute("data-id"); mine = id; ls("biw-theme", id || null); refresh(); Array.prototype.forEach.call(ov.querySelectorAll(".btp-c"), function (x) { x.classList.toggle("on", x.getAttribute("data-id") === id); }); }; });
      var sb = ov.querySelector("#btp-studio"); if (sb) sb.onclick = function () { ov.remove(); openStudio(); };
    };
    var close = function () { ov.remove(); refresh(); };
    ov.onclick = function (e) { if (e.target === ov) close(); };
    document.body.appendChild(ov); draw();
  }
  // ---------- admin design studio ----------
  function upload(cb, max) {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = function () { var f = inp.files[0]; if (!f) return; var im = new Image(); im.onload = function () { var k = Math.min(1, (max || 1920) / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); var qq = 0.85, d = c.toDataURL("image/jpeg", qq); while (d.length > 1400000 && qq > 0.4) { qq -= 0.1; d = c.toDataURL("image/jpeg", qq); } var a = auth(); post({ app: "admin", username: a && a.username, token: a && a.token, action: "bnr-upload", data: d }).then(function (r) { cb(r && r.ok ? r.url : null, r && r.error); }); }; im.onerror = function () { cb(null, "Couldn't open this picture."); }; im.src = URL.createObjectURL(f); };
    inp.click();
  }
  function openStudio() {
    css();
    var D = JSON.parse(JSON.stringify(CFG || {})); D.custom = D.custom || {}; D.art = D.art || {}; D.card = D.card || {}; D.ind = D.ind || {}; D.tabs = D.tabs || {};
    var KEEP = JSON.parse(JSON.stringify(CFG || {})), tab = "themes", banners = null, saved = false;
    var ov = document.createElement("div"); ov.className = "btp-ov"; ov.setAttribute("data-bt-skip", "1"); ov.setAttribute("data-noi18n", "1"); document.body.appendChild(ov);
    var a0 = auth();
    if (a0 && a0.token) post({ app: a0.app, username: a0.username, token: a0.token, action: "bnr-get" }).then(function (r) { banners = r && r.ok ? r.banners.items.filter(function (x) { return x.img; }) : []; if (tab === "art") draw(); });
    var preview = function () { CFG = Object.assign({}, KEEP, D); SIG = ""; refresh(); };
    var sel = function (id, opts, val) { return '<select data-k="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(val || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>"; };
    var draw = function (msg) {
      var on = Array.isArray(D.on) && D.on.length ? D.on : THEMES.map(function (t) { return t.id; });
      var h = '<div class="btp-s"><h3>🛡️ Design studio</h3><div class="m">For everyone — dashboard, both apps and the web. Changes preview live; tap Save to publish.</div><div class="btp-tabs">' + [["themes", "🎨 Themes"], ["art", "🖼️ Background art"], ["cards", "🧩 Cards & layout"], ["tabs", "📑 Dashboard tabs"], ["ind", "🚦 Indicators"]].map(function (t) { return '<span data-tab="' + t[0] + '" class="' + (tab === t[0] ? "on" : "") + '">' + t[1] + "</span>"; }).join("") + "</div><div class=\"btp-adm\" style=\"border:0;padding-top:4px\">";
      if (tab === "themes") {
        h += '<label style="display:block">Default theme for everyone<select id="btp-def"><option value="">Original look (no theme)</option>' + CATS.map(function (c) { return '<optgroup label="' + c + '">' + THEMES.filter(function (t) { return t.cat === c; }).map(function (t) { return '<option value="' + t.id + '"' + (t.id === D.def ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") + "</optgroup>"; }).join("") + "</select></label>" +
          '<div class="m" style="margin-top:10px">Themes people can pick (' + on.length + " of " + THEMES.length + ')</div><div class="btp-row" style="margin-top:4px"><button class="btp-btn" id="btp-all">All</button><button class="btp-btn" id="btp-none">None</button></div>' + CATS.map(function (c) { return '<div class="m" style="margin-top:8px;font-weight:700">' + c + '</div><div class="btp-chk">' + THEMES.filter(function (t) { return t.cat === c; }).map(function (t) { return '<label><input type="checkbox" data-on="' + t.id + '"' + (on.indexOf(t.id) >= 0 ? " checked" : "") + '> <i style="display:inline-block;width:10px;height:10px;border-radius:99px;background:' + t.accent + '"></i> ' + esc(t.name) + "</label>"; }).join("") + "</div>"; }).join("") +
          '<label><input type="checkbox" id="btp-allow"' + (D.allowUser !== false ? " checked" : "") + "> Let people choose their own theme</label>" +
          '<label><input type="checkbox" id="btp-auto"' + (D.auto !== false ? " checked" : "") + "> Offer “Auto” (Midnight in phone dark mode)</label>" +
          '<label><input type="checkbox" id="btp-dauto"' + (D.defAuto ? " checked" : "") + "> Switch to Midnight automatically in phone dark mode for people who haven’t picked a theme</label>" +
          '<div class="m" style="margin-top:12px;font-weight:700">Customise a theme\'s colours</div><select id="btp-ct">' + THEMES.map(function (t) { return '<option value="' + t.id + '">' + esc(t.cat + " · " + t.name) + "</option>"; }).join("") + '</select><div class="btp-cols" id="btp-cols"></div><div class="btp-row" style="margin-top:6px"><button class="btp-btn" id="btp-prev">👁 Preview this theme</button><button class="btp-btn" id="btp-rst">↺ Original colours</button></div>';
      }
      if (tab === "art") {
        var A = D.art, P = Object.keys(PATTERNS);
        h += '<label><input type="checkbox" id="btp-aon"' + (A.on ? " checked" : "") + "> Show background art</label>" +
          '<div class="btp-art">' + (A.url && !A.pattern ? '<img src="' + esc(A.url) + '" alt="">' : A.pattern ? '<div style="height:100%;background:' + (A.pattern === "glow" ? "linear-gradient(135deg,#eef,#fde)" : "url('data:image/svg+xml;charset=utf-8," + encodeURIComponent(PATTERNS[A.pattern]((CUR || BYID[SRC]).accent)) + "')") + '"></div>' : '<div class="m" style="padding:30px;text-align:center">No art chosen</div>') + "</div>" +
          '<div class="btp-row"><button class="btp-btn p" id="btp-up">📤 Upload a picture</button><input id="btp-url" placeholder="…or paste a picture link (https://)" style="flex:1;min-width:150px;border:1px solid #D5D8E6;border-radius:9px;padding:8px;font:inherit;font-size:13px"><button class="btp-btn" id="btp-urlb">Use link</button></div>' +
          '<div class="m" style="margin-top:6px">Upload a real photo (e.g. a vivo store on Diwali) or artwork. Best: landscape, 1920 px wide.</div>' +
          (banners && banners.length ? '<div class="m" style="margin-top:10px;font-weight:700">From your dashboard banners</div><div class="btp-thumbs">' + banners.map(function (b) { return '<img data-burl="' + esc(b.img) + '" src="' + esc(b.img) + '" alt="" class="' + (A.url === b.img ? "on" : "") + '">'; }).join("") + "</div>" : "") +
          '<div class="m" style="margin-top:10px;font-weight:700">Built-in art (uses the theme colour)</div><div class="btp-thumbs">' + P.map(function (k) { return '<span data-pat="' + k + '" class="' + (A.pattern === k ? "on" : "") + '" style="background:' + (k === "glow" ? "radial-gradient(60% 60% at 30% 20%," + (CUR || BYID[SRC]).accent + "66,transparent),#fff" : "#fff url('data:image/svg+xml;charset=utf-8," + encodeURIComponent(PATTERNS[k]((CUR || BYID[SRC]).accent)) + "')") + '">' + k + "</span>"; }).join("") + "</div>" +
          '<div class="btp-g2"><label>Strength' + sel("art.strength", [["faint", "Faint"], ["light", "Light"], ["medium", "Medium"], ["strong", "Strong"]], A.strength || "light") + "</label><label>Blur" + sel("art.blur", [["0", "None"], ["3", "Soft"], ["8", "Strong"]], A.blur || "0") + "</label><label>Fit" + sel("art.fit", [["cover", "Fill the screen"], ["tile", "Repeat"]], A.fit || "cover") + "</label><label>Show on" + sel("art.scope", [["all", "Dashboard + tools"], ["dashboard", "Dashboard only"], ["tools", "Tools only"]], A.scope || "all") + "</label></div>";
      }
      if (tab === "cards") {
        var C = D.card;
        h += '<div class="btp-g2"><label>Card style' + sel("card.style", [["", "Solid (default)"], ["glass", "Glass"], ["soft", "Soft"], ["elevated", "Elevated"], ["outline", "Outline"], ["gradient", "Gradient"], ["flat", "Flat"]], C.style) + "</label>" +
          "<label>Corners" + sel("card.radius", [["", "Default"], ["sharp", "Sharp"], ["soft", "Slightly round"], ["rounded", "Rounded"], ["round", "Extra round"], ["pill", "Pill"]], C.radius) + "</label>" +
          "<label>Accent bar" + sel("card.accentBar", [["", "None"], ["left", "Left edge"], ["top", "Top edge"]], C.accentBar) + "</label>" +
          "<label>Spacing" + sel("card.density", [["", "Normal"], ["compact", "Compact"], ["comfortable", "Comfortable"]], C.density) + "</label>" +
          "<label>Text size" + sel("card.text", [["", "Normal"], ["small", "Small"], ["large", "Large"], ["xl", "Extra large"]], C.text) + "</label>" +
          "<label>Font" + sel("card.font", [["", "Default"], ["rounded", "Rounded"], ["modern", "Modern"], ["serif", "Serif"], ["condensed", "Condensed"]], C.font) + "</label>" +
          "<label>Header band" + sel("card.hero", [["", "Default"], ["accent", "Theme gradient"], ["solid", "Solid dark"], ["compact", "Compact (tools)"], ["art", "See-through over art (tools)"]], C.hero) + "</label>" +
          "<label>Tool icons" + sel("card.tiles", [["", "Rounded square"], ["circle", "Circle"], ["square", "Square"]], C.tiles) + "</label>" +
          "<label>Buttons" + sel("card.buttons", [["", "Default"], ["pill", "Pill"], ["square", "Square"]], C.buttons) + "</label>" +
          "<label>Apply to" + sel("card.scope", [["all", "Dashboard + tools"], ["dashboard", "Dashboard only"], ["tools", "Tools only"]], C.scope || "all") + "</label></div>" +
          '<div class="btp-row"><button class="btp-btn" id="btp-crst">↺ Reset cards & layout</button></div>';
      }
      if (tab === "tabs") {
        var TL = tabList(), TT = D.tabs, ord = (TT.order || []).filter(function (k) { return TL.some(function (x) { return x[0] === k; }); });
        TL.forEach(function (x) { if (ord.indexOf(x[0]) < 0) ord.push(x[0]); });
        h += '<div class="m">Choose which dashboard tabs everyone sees, their order and their names. Overview always stays.' + (PAGE !== "dashboard" ? " (Open the dashboard to preview.)" : "") + '</div><div class="btp-tl">' + ord.map(function (k, i) { var o = TL.filter(function (x) { return x[0] === k; })[0]; return '<div class="btp-tr" data-tk="' + k + '"><input type="checkbox" data-tv' + ((TT.hide || []).indexOf(k) < 0 ? " checked" : "") + (k === "overview" ? " disabled" : "") + '><input class="btp-tn" data-tn placeholder="' + esc(o[1]) + '" value="' + esc((TT.names || {})[k] || "") + '" maxlength="24"><button class="btp-btn" data-up' + (i ? "" : " disabled") + '>↑</button><button class="btp-btn" data-dn' + (i < ord.length - 1 ? "" : " disabled") + ">↓</button></div>"; }).join("") + '</div><div class="m" style="margin-top:6px">Leave a name empty to keep the original.</div><div class="btp-row"><button class="btp-btn" id="btp-trst">↺ Original tabs</button></div>';
        D._ord = ord;
      }
      if (tab === "ind") {
        var I = D.ind;
        h += '<div class="m">Colours of good / watch / needs-action indicators (arrows, chips, scores, map, alerts). Thresholds are in the Configuration centre.</div><div class="btp-cols">' + [["good", "Good", "#1E9E61"], ["warn", "Watch", "#E69A00"], ["bad", "Needs action", "#D93B3B"]].map(function (x) { return "<label>" + x[1] + '<input type="color" data-ind="' + x[0] + '" value="' + (I[x[0]] || x[2]).toLowerCase() + '"></label>'; }).join("") + '</div><div class="btp-row"><span class="btp-pv" style="background:' + (I.good || "#1E9E61") + '">▲ 2.9 pt</span><span class="btp-pv" style="background:' + (I.warn || "#E69A00") + '">watch</span><span class="btp-pv" style="background:' + (I.bad || "#D93B3B") + '">▼ 4 places</span></div>' +
          '<div class="btp-row"><button class="btp-btn" data-ipre="0">Classic</button><button class="btp-btn" data-ipre="1">Colour-blind safe</button><button class="btp-btn" data-ipre="2">Soft pastel</button><button class="btp-btn" data-ipre="3">vivo blue</button></div>';
      }
      h += (msg || "") + '<div class="btp-row" style="margin-top:14px"><button class="btp-btn" id="btp-back">← Back</button><button class="btp-btn" id="btp-cancel">Cancel</button><button class="btp-btn p" id="btp-save" style="flex:1">💾 Save for everyone</button></div></div></div>';
      ov.innerHTML = h;
      var $o = function (id) { return ov.querySelector(id); };
      Array.prototype.forEach.call(ov.querySelectorAll("[data-tab]"), function (t) { t.onclick = function () { keepThemes(); tab = t.getAttribute("data-tab"); draw(); }; });
      Array.prototype.forEach.call(ov.querySelectorAll("select[data-k]"), function (e) { e.onchange = function () { var k = e.getAttribute("data-k").split("."); D[k[0]][k[1]] = e.value; preview(); }; });
      if (tab === "themes") {
        var ct = $o("#btp-ct"), cols = function () { var t = BYID[ct.value], c = D.custom[t.id] || {}; $o("#btp-cols").innerHTML = [["accent", "Accent"], ["deep", "Header / dark"], ["tint", "Background tint"]].map(function (x) { return "<label>" + x[1] + '<input type="color" data-ck="' + x[0] + '" value="' + (c[x[0]] || t[x[0]]).toLowerCase() + '"></label>'; }).join(""); Array.prototype.forEach.call(ov.querySelectorAll("[data-ck]"), function (i) { i.oninput = function () { var o = D.custom[t.id] = D.custom[t.id] || {}; o[i.getAttribute("data-ck")] = i.value.toUpperCase(); }; }); };
        ct.value = (CUR && CUR.id) || D.def || "signature"; cols(); ct.onchange = cols;
        $o("#btp-prev").onclick = function () { keepThemes(); ls("biw-theme", ct.value); preview(); };
        $o("#btp-rst").onclick = function () { delete D.custom[ct.value]; cols(); preview(); };
        $o("#btp-all").onclick = function () { D.on = THEMES.map(function (t) { return t.id; }); draw(); };
        $o("#btp-none").onclick = function () { D.on = [D.def || "signature"]; draw(); };
        Array.prototype.forEach.call(ov.querySelectorAll("[data-on]"), function (i) { i.onchange = keepThemes; });
        $o("#btp-def").onchange = function () { keepThemes(); preview(); };
      }
      if (tab === "art") {
        $o("#btp-aon").onchange = function () { D.art.on = this.checked; preview(); draw(); };
        $o("#btp-up").onclick = function () { draw('<div class="btp-note">Uploading…</div>'); upload(function (u, err) { if (!u) return draw('<div class="btp-note">' + esc(err || "Upload failed") + "</div>"); D.art.url = u; D.art.pattern = ""; D.art.on = true; preview(); draw(); }); };
        $o("#btp-urlb").onclick = function () { var u = $o("#btp-url").value.trim(); if (!/^https:\/\/\S+$/.test(u)) return draw('<div class="btp-note">Paste a link that starts with https://</div>'); D.art.url = u; D.art.pattern = ""; D.art.on = true; preview(); draw(); };
        Array.prototype.forEach.call(ov.querySelectorAll("[data-burl]"), function (im) { im.onclick = function () { D.art.url = im.getAttribute("data-burl"); D.art.pattern = ""; D.art.on = true; preview(); draw(); }; });
        Array.prototype.forEach.call(ov.querySelectorAll("[data-pat]"), function (p) { p.onclick = function () { D.art.pattern = p.getAttribute("data-pat"); D.art.on = true; preview(); draw(); }; });
      }
      if (tab === "tabs") {
        var rd = function () { var o = [], hd = [], nm = {}; Array.prototype.forEach.call(ov.querySelectorAll("[data-tk]"), function (r) { var k = r.getAttribute("data-tk"); o.push(k); if (!r.querySelector("[data-tv]").checked && k !== "overview") hd.push(k); var v = r.querySelector("[data-tn]").value.trim(); if (v) nm[k] = v; }); D.tabs = { order: o, hide: hd, names: nm }; preview(); };
        Array.prototype.forEach.call(ov.querySelectorAll("[data-tv],[data-tn]"), function (i) { i.onchange = rd; });
        Array.prototype.forEach.call(ov.querySelectorAll("[data-up],[data-dn]"), function (b) { b.onclick = function () { var r = b.closest("[data-tk]"), sib = b.hasAttribute("data-up") ? r.previousElementSibling : r.nextElementSibling; if (!sib) return; if (b.hasAttribute("data-up")) r.parentNode.insertBefore(r, sib); else r.parentNode.insertBefore(sib, r); rd(); draw(); }; });
        $o("#btp-trst").onclick = function () { D.tabs = {}; preview(); draw(); };
      }
      if (tab === "cards") $o("#btp-crst").onclick = function () { D.card = {}; preview(); draw(); };
      if (tab === "ind") {
        Array.prototype.forEach.call(ov.querySelectorAll("[data-ind]"), function (i) { i.onchange = function () { D.ind[i.getAttribute("data-ind")] = i.value.toUpperCase(); preview(); draw(); }; });
        var PRE = [{}, { good: "#1A85FF", warn: "#FFB000", bad: "#D41159" }, { good: "#4CAF82", warn: "#F2B84B", bad: "#E57373" }, { good: "#415FFF", warn: "#F5A300", bad: "#E0245E" }];
        Array.prototype.forEach.call(ov.querySelectorAll("[data-ipre]"), function (b) { b.onclick = function () { D.ind = Object.assign({}, PRE[+b.getAttribute("data-ipre")]); preview(); draw(); }; });
      }
      $o("#btp-back").onclick = function () { keepThemes(); if (!saved) { CFG = KEEP; SIG = ""; refresh(); } ov.remove(); openPicker(); };
      $o("#btp-cancel").onclick = function () { CFG = KEEP; SIG = ""; refresh(); ov.remove(); };
      $o("#btp-save").onclick = function () { keepThemes(); save(); };
    };
    var keepThemes = function () {
      if (tab !== "themes" || !ov.querySelector("#btp-def")) return;
      D.def = ov.querySelector("#btp-def").value; D.on = Array.prototype.filter.call(ov.querySelectorAll("[data-on]"), function (i) { return i.checked; }).map(function (i) { return i.getAttribute("data-on"); });
      D.allowUser = ov.querySelector("#btp-allow").checked; D.auto = ov.querySelector("#btp-auto").checked; D.defAuto = ov.querySelector("#btp-dauto").checked;
      if (D.def && D.on.indexOf(D.def) < 0) D.on.push(D.def);
    };
    var save = function () {
      var c = { def: D.def || "", on: D.on, allowUser: D.allowUser, auto: D.auto, defAuto: D.defAuto, custom: D.custom, art: D.art, card: D.card, ind: D.ind, tabs: { order: (D.tabs.order || []), hide: D.tabs.hide || [], names: D.tabs.names || {} } };
      var parts = [], a = auth(), jobs = [];
      if (a && a.app === "admin") jobs.push(post({ app: "admin", username: a.username, token: a.token, action: "theme-set", theme: c }).then(function (r) { if (r && r.ok) { CFG = r.theme; KEEP = JSON.parse(JSON.stringify(CFG)); saved = true; ls("biw-theme-cfg", JSON.stringify(CFG)); parts.push("✅ Saved for everyone — apps and web update on their next open."); } else parts.push("⚠️ " + ((r && r.error) || "Couldn't save online.")); }));
      if (fileAdmin()) { try { var api = window.__DASHAPI; api.META.theme = c; FILE = c; api.markDirty(); parts.push("📄 Also stored in this dashboard file — now use <b>Export & share → Save updated file</b>."); } catch (e) { } }
      if (!jobs.length && !fileAdmin()) parts.push("⚠️ Log in as an HO admin to save.");
      Promise.all(jobs).then(function () { SIG = ""; refresh(); draw('<div class="btp-note">' + parts.join("<br>") + "</div>"); });
    };
    ov.onclick = function (e) { if (e.target === ov) { CFG = KEEP; SIG = ""; refresh(); ov.remove(); } };
    draw();
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
  document.addEventListener("DOMContentLoaded", function () { placeButton(); studio(); [400, 1500, 4000].forEach(function (ms) { setTimeout(applyTabs, ms); }); if (window.__DASHAPI) BITHEME.fileDefault(window.__DASHAPI.META && window.__DASHAPI.META.theme); });
  setInterval(function () { if (!document.getElementById("btp-b")) placeButton(); }, 3000);
  loadCfg();
  // apps keep the page open in the background: pick up new HO design settings when it comes back
  var lastCfg = Date.now();
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && Date.now() - lastCfg > 30000) { lastCfg = Date.now(); loadCfg(); } });
  [2500, 6000].forEach(function (ms) { setTimeout(function () { SIG = ""; refresh(); }, ms); });
})();
