// Multi-language: 🌐 button switches the dashboard, every tool page and the web layer to Hindi or a regional language.
// Text on screen is translated by the server (AI, cached for everyone) and remembered on this device.
(function () {
  "use strict";
  if (window.BILANG) return;
  var LANGS = [["en", "English", "English"], ["hi", "हिन्दी", "Hindi"], ["ta", "தமிழ்", "Tamil"], ["te", "తెలుగు", "Telugu"], ["kn", "ಕನ್ನಡ", "Kannada"], ["mr", "मराठी", "Marathi"], ["bn", "বাংলা", "Bengali"], ["gu", "ગુજરાતી", "Gujarati"], ["zh", "中文", "Chinese"]];
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  var LANG = ls("biw-lang") || "en", DICT = {}, busy = false, timer = null, MO = null, nodes = [];
  function loadDict() { try { DICT = JSON.parse(ls("biw-tr-" + LANG) || "{}") || {}; } catch (e) { DICT = {}; } }
  function saveDict() { try { var s = JSON.stringify(DICT); if (s.length < 1500000) ls("biw-tr-" + LANG, s); } catch (e) { } }
  function auth() {
    var a = null;
    try { a = window.BIApp && window.BIApp.getAuth ? JSON.parse(window.BIApp.getAuth()) : null; } catch (e) { a = null; }
    if ((!a || !a.token) && window.__BI_AUTH && window.__BI_AUTH.token) a = window.__BI_AUTH;
    if (!a || !a.token) { try { var w = JSON.parse(ls("biw-auth") || "null"); if (w && w.token) a = { app: w.app, username: w.username, token: w.token }; } catch (e) { } }
    return a;
  }
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, svg: 1, SVG: 1, OPTION: 0 };
  var WANT = /[A-Za-z]{2}/, CODE = /^[\sA-Z0-9_\-\/.:#@+%₹,()|·•]*$/;
  function okText(s) { s = s.trim(); return s.length > 1 && s.length <= 300 && WANT.test(s) && !CODE.test(s) && !/^https?:|@\w+\.\w|^[\w.-]+\.(js|html|png|jpg)$/i.test(s); }
  function blocked(el) { for (var e = el; e && e !== document.body; e = e.parentNode) { if (e.nodeType === 1 && (SKIP[e.tagName] || e.isContentEditable || e.hasAttribute("data-noi18n") || (e.classList && e.classList.contains("btl-ov")))) return true; } return false; }
  function collect(root) {
    var out = [], w = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) {
      var cur = n.nodeValue; if (n.__bto != null && cur === n.__btw) { out.push(n); continue; }
      if (n.__btw !== cur) { n.__bto = cur; n.__btw = null; }
      if (okText(cur) && !blocked(n.parentNode)) out.push(n);
    }
    var at = (root || document.body).querySelectorAll ? (root || document.body).querySelectorAll("[placeholder],[title],[aria-label]") : [];
    for (var i = 0; i < at.length; i++) ["placeholder", "title"].forEach(function (a) { var el = at[i], v = el.getAttribute(a); if (!v) return; el.__bta = el.__bta || {}; if (el.__bta[a] == null || (el.__bta[a].w !== v)) el.__bta[a] = { o: v }; if (okText(el.__bta[a].o) && !blocked(el)) out.push({ el: el, a: a }); });
    return out;
  }
  function textOf(x) { return x.el ? x.el.__bta[x.a].o : x.__bto; }
  function put(x, val) { if (x.el) { x.el.__bta[x.a].w = val; x.el.setAttribute(x.a, val); } else { x.__btw = val; x.nodeValue = val; } }
  function lead(s) { var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s); return m; }
  function apply(all) {
    if (LANG === "en") { restore(); return; }
    var list = collect(document.body), need = {};
    list.forEach(function (x) { var o = textOf(x), m = lead(o), k = m[2]; if (DICT[k]) put(x, m[1] + DICT[k] + m[3]); else need[k] = 1; });
    var miss = Object.keys(need);
    if (miss.length && !busy) fetchSome(miss, 0);
  }
  function fetchSome(miss, round) {
    var a = auth(); if (!a || !a.token || round > 8) return;
    busy = true;
    fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json", "X-BI-App": "1" }, body: JSON.stringify({ app: a.app, username: a.username, token: a.token, action: "tr-get", lang: LANG, texts: miss.slice(0, 400) }) })
      .then(function (r) { return r.json(); }).then(function (r) {
        busy = false; if (!r || !r.ok) return;
        Object.keys(r.t || {}).forEach(function (k) { DICT[k] = r.t[k]; }); saveDict();
        apply();
        var left = miss.filter(function (k) { return !DICT[k]; });
        if (left.length && (r.pending > 0 || miss.length > 400)) setTimeout(function () { fetchSome(left, round + 1); }, 400);
      }).catch(function () { busy = false; });
  }
  function restore() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) if (n.__bto != null && n.nodeValue === n.__btw) { n.nodeValue = n.__bto; n.__btw = null; }
    var at = document.body.querySelectorAll("[placeholder],[title]"); for (var i = 0; i < at.length; i++) { var el = at[i]; if (el.__bta) Object.keys(el.__bta).forEach(function (a) { if (el.getAttribute(a) === el.__bta[a].w) el.setAttribute(a, el.__bta[a].o); }); }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(apply, 350); }
  function watch() { if (MO || !window.MutationObserver) return; MO = new MutationObserver(function (ms) { if (LANG === "en") return; for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.type === "characterData" && m.target.__btw === m.target.nodeValue) continue; schedule(); return; } }); MO.observe(document.body, { childList: true, subtree: true, characterData: true }); }
  function set(l) { if (!LANGS.some(function (x) { return x[0] === l; })) l = "en"; restore(); LANG = l; ls("biw-lang", l === "en" ? null : l); loadDict(); document.documentElement.lang = l; if (l !== "en") { watch(); apply(); } paint(); }
  // ---------- button + picker ----------
  var CSS = ".btl-b{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:34px;border-radius:99px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);cursor:pointer;font-size:15px;padding:0 6px;flex:none;margin:0 2px;line-height:1;color:inherit;font-weight:700}" +
    ".btl-b.fx{position:fixed;top:10px;right:52px;z-index:99990;background:#fff;color:#222;border-color:#ddd;box-shadow:0 2px 10px rgba(0,0,0,.18)}" +
    ".btl-ov{position:fixed;inset:0;background:rgba(10,12,24,.55);z-index:99999;display:flex;align-items:flex-end;justify-content:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".btl-s{background:#fff;color:#141833;width:100%;max-width:460px;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box}@media(min-width:700px){.btl-ov{align-items:center}.btl-s{border-radius:20px}}" +
    ".btl-s h3{margin:0 0 4px;font-size:18px}.btl-s p{margin:0 0 10px;color:#6B7088;font-size:12.5px}.btl-g{display:grid;grid-template-columns:1fr 1fr;gap:8px}" +
    ".btl-g button{border:2px solid #E3E5EF;border-radius:12px;padding:10px;background:#fff;cursor:pointer;font:600 15px inherit;color:#141833;text-align:left}.btl-g button small{display:block;color:#6B7088;font-size:11.5px;font-weight:500}.btl-g button.on{border-color:#415FFF;box-shadow:0 0 0 3px rgba(65,95,255,.15)}";
  function css() { if (document.getElementById("btl-css")) return; var s = document.createElement("style"); s.id = "btl-css"; s.setAttribute("data-bt-skip", "1"); s.textContent = CSS; (document.head || document.documentElement).appendChild(s); }
  function paint() { var b = document.getElementById("btl-b"); if (b) b.textContent = LANG === "en" ? "🌐" : (LANGS.find(function (x) { return x[0] === LANG; }) || ["", "🌐"])[1].slice(0, 2); }
  function place() {
    if (!document.body || document.getElementById("btl-b")) return;
    var tb = document.getElementById("btp-b"), slot = tb ? tb.parentNode : null; if (!slot && !document.getElementById("dash-root") && !document.querySelector(".hero .top")) return;
    css();
    var b = document.createElement("button"); b.id = "btl-b"; b.type = "button"; b.className = "btl-b" + (tb && tb.classList.contains("fx") ? " fx" : ""); b.setAttribute("data-bt-skip", "1"); b.setAttribute("data-noi18n", "1"); b.setAttribute("aria-label", "Language");
    b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); picker(); };
    if (tb) slot.insertBefore(b, tb); else { var h = document.querySelector(".hero .top"); if (h) h.insertBefore(b, h.lastElementChild); else return; }
    paint();
  }
  function picker() {
    css();
    var ov = document.createElement("div"); ov.className = "btl-ov"; ov.setAttribute("data-noi18n", "1"); ov.setAttribute("data-bt-skip", "1");
    ov.innerHTML = '<div class="btl-s"><h3>🌐 Language · भाषा</h3><p>Screens are translated automatically and remembered on this device. Numbers, IDs and names stay as they are.</p><div class="btl-g">' + LANGS.map(function (l) { return '<button data-l="' + l[0] + '" class="' + (LANG === l[0] ? "on" : "") + '">' + l[1] + "<small>" + l[2] + "</small></button>"; }).join("") + "</div></div>";
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    Array.prototype.forEach.call(ov.querySelectorAll("[data-l]"), function (b) { b.onclick = function () { ov.remove(); set(b.getAttribute("data-l")); }; });
    document.body.appendChild(ov);
  }
  window.BILANG = { set: set, current: function () { return LANG; }, langs: LANGS };
  loadDict();
  var tries = 0; (function p() { place(); if (!document.getElementById("btl-b") && tries++ < 40) setTimeout(p, 300); })();
  setInterval(function () { if (!document.getElementById("btl-b")) place(); }, 3000);
  function start() { if (LANG !== "en") { document.documentElement.lang = LANG; watch(); apply(); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(start, 200); }); else setTimeout(start, 200);
})();
