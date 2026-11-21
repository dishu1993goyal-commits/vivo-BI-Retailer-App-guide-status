// Access control: hides tools, admin settings, dashboard tabs, filters and reports the master admin has switched off
// for this user, and blocks a tool page opened directly. Rules come from the server (acc-mine) and refresh when
// the page or app comes back to the front, so changes reach the apps and the web without an update.
// One-tool links: a browser signed in from a shared link may only stay on that one tool page.
(function () {
  try {
    var w = JSON.parse(localStorage.getItem("biw-auth") || "null"); if (!w || !w.link || !w.link.page) return;
    var L = w.link, pages = (L.pages && L.pages.length ? L.pages : [L.page]).map(function (p) { return String(p).toLowerCase(); });
    var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (here !== "open.html" && pages.indexOf(here) < 0) { location.replace("/" + pages[0]); return; }
    window.BI_LINK = L;
    var tool = (L.tools || []).filter(function (x) { return String(x.page).toLowerCase() === here; })[0] || { name: L.tool, tabs: [], all: [] };
    document.addEventListener("click", function (e) {   // links to other pages / the dashboard stay closed
      var a = e.target && e.target.closest && e.target.closest("a[href]"); if (!a) return;
      var h = a.getAttribute("href") || "", u; try { u = new URL(h, location.href); } catch (x) { return; }
      if (u.origin === location.origin && /\.html$|\/$/.test(u.pathname) && pages.indexOf(u.pathname.split("/").pop().toLowerCase()) < 0) { e.preventDefault(); e.stopPropagation(); alert("This shared link opens only " + (L.tool || "this tool") + "."); }
    }, true);
    // chosen tabs only: the other tab buttons of this tool are hidden; if the open tab is hidden, the first allowed one opens
    var keep = tool.tabs || [], all = tool.all || [];
    var tabs = function () {
      if (!keep.length) return;
      var shown = [], hidden = [];
      Array.prototype.forEach.call(document.querySelectorAll("[data-t]"), function (b) { var t = b.getAttribute("data-t"); if (all.indexOf(t) < 0) return; if (keep.indexOf(t) < 0) { if (b.style.display !== "none") b.style.display = "none"; hidden.push(b); } else shown.push(b); });
      if (hidden.some(function (b) { return b.classList.contains("on") || b.classList.contains("active") || b.getAttribute("aria-selected") === "true"; }) && shown[0]) shown[0].click();
    };
    var add = function () {
      if (!document.body) return; tabs();
      if (!window.__biLinkObs) { window.__biLinkObs = new MutationObserver(function () { clearTimeout(window.__biLinkT); window.__biLinkT = setTimeout(tabs, 30); }); window.__biLinkObs.observe(document.body, { childList: true, subtree: true }); }
      if (document.getElementById("bi-link-pill")) return;
      var d = document.createElement("div"); d.id = "bi-link-pill";
      d.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:10px;z-index:99999;background:" + (L.demo ? "rgba(180,35,24,.92)" : "rgba(18,22,58,.88)") + ";color:#fff;font:600 11.5px Arial,sans-serif;border-radius:99px;padding:6px 12px;max-width:92vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:" + (pages.length > 1 ? "pointer" : "default");
      d.textContent = (L.demo ? "🎭 DEMO · view only · " : "🔗 Shared: ") + (tool.name || L.tool || "") + (pages.length > 1 ? "  ·  switch tool ▾" : "");
      if (pages.length > 1) d.onclick = function () {
        var m = document.getElementById("bi-link-menu"); if (m) { m.remove(); return; }
        m = document.createElement("div"); m.id = "bi-link-menu"; m.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:46px;z-index:99999;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:6px;min-width:240px;max-width:92vw;font:600 14px Arial,sans-serif";
        (L.tools || pages.map(function (p) { return { page: p, name: p }; })).forEach(function (x) { var a = document.createElement("a"); a.href = "/" + x.page; a.textContent = (x.icon || "🔧") + "  " + x.name; a.style.cssText = "display:block;padding:10px 12px;border-radius:10px;color:#12163A;text-decoration:none;" + (String(x.page).toLowerCase() === here ? "background:#EEF0FF" : ""); m.appendChild(a); });
        document.body.appendChild(m);
      };
      document.body.appendChild(d);
      if (L.demo && !document.getElementById("bi-demo-mark")) { var wm = document.createElement("div"); wm.id = "bi-demo-mark"; wm.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99998;background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='160'><text x='20' y='100' transform='rotate(-20 130 80)' font-family='Arial' font-size='34' font-weight='700' fill='rgba(180,35,24,0.07)'>DEMO</text></svg>\")"; document.body.appendChild(wm); }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
  } catch (e) { }
})();
(function () {
  "use strict";
  if (window.BIACCESS) return;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function auth() {
    var a = null;
    try { a = window.BIApp && window.BIApp.getAuth ? JSON.parse(window.BIApp.getAuth()) : null; } catch (e) { a = null; }
    if ((!a || !a.token) && window.__BI_AUTH && window.__BI_AUTH.token) a = window.__BI_AUTH;
    if (!a || !a.token) { try { var w = JSON.parse(ls("biw-auth") || "null"); if (w && w.token) a = { app: w.app, username: w.username, token: w.token }; } catch (e) { } }
    return a;
  }
  var KEY = function () { var a = auth(); return a ? "biw-acc-" + a.app + "-" + String(a.username || "").toLowerCase() : ""; };
  var DENY = [], MASTER = false, SUBS = [], LAST = 0, busy = false;
  function isDash() { return !!(document.getElementById("dash-root") || document.getElementById("dd") || document.getElementById("rp")); }
  try { var c0 = JSON.parse(ls(KEY()) || "null"); if (c0 && c0.deny) { DENY = c0.deny; MASTER = !!c0.master; } } catch (e) { }
  function ok(id) { return DENY.indexOf(id) < 0; }
  function load() {
    var a = auth(); if (!a || !a.token || busy) { if (!a || !a.token) setTimeout(load, 1500); return; }
    busy = true; LAST = Date.now();
    fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json", "X-BI-App": "1" }, body: JSON.stringify({ app: a.app, username: a.username, token: a.token, action: "acc-mine" }) })
      .then(function (r) { return r.json(); }).then(function (r) {
        busy = false; if (!r || !r.ok) return;
        var changed = JSON.stringify(r.deny || []) !== JSON.stringify(DENY) || !!r.master !== MASTER;
        DENY = r.deny || []; MASTER = !!r.master; ls(KEY(), JSON.stringify({ deny: DENY, master: MASTER, at: Date.now() }));
        if (changed) { apply(); SUBS.forEach(function (f) { try { f(); } catch (e) { } }); }
      }).catch(function () { busy = false; });
  }
  // ---------- tag elements with their feature id ----------
  function tag(el, id) { if (el && el.getAttribute("data-acc") !== id) el.setAttribute("data-acc", id); }
  function tagAll() {
    var q = function (s) { return document.querySelectorAll(s); }, each = function (s, fn) { Array.prototype.forEach.call(q(s), fn); };
    each("#tabs button[data-t], #mlist a[data-t], #menu a[data-t]", function (b) { tag(b, "tab:" + b.getAttribute("data-t")); });
    var byTitle = {}; each("#tabs button[data-t]", function (b) { var t = (b.getAttribute("title") || "").split(" · ")[0].trim(); if (t) byTitle[t] = b.getAttribute("data-t"); });
    each("#mmenu a", function (a) { var b = a.querySelector("b"), k = b && byTitle[b.textContent.trim()]; if (k) tag(a, "tab:" + k); });
    var fl = function (id, f) { var s = document.getElementById(id); if (s) tag(s.closest("label") || s.parentNode, f); };
    fl("per-sel", "flt:period"); fl("scope-sel", "flt:state"); fl("kpi-sel", "flt:kpi"); var rw = document.getElementById("rng-wrap"); if (rw) tag(rw, "flt:range");
    [["exp-b", "rep:export"], ["exmenu", "rep:export"], ["imp-b", "rep:import"], ["lead-b", "rep:leaders"], ["more-b", "rep:guides"], ["mmenu", "rep:guides"], ["bx-eb", "adm:banners"], ["btp-studio", "adm:design"]].forEach(function (x) { tag(document.getElementById(x[0]), x[1]); });
    each(".snapbar button, button.xlbtn, .rp button", function (b) {
      var t = (b.textContent || "").trim(); if (t.length > 40) return;
      if (/^(⬇\s*)?Excel\b|Download Excel|⬇ Excel/i.test(t)) tag(b, "rep:excel"); else if (/Save PNG/i.test(t)) tag(b, "rep:png"); else if (/Share card/i.test(t)) tag(b, "rep:share"); else if (/^🎨\s*Creative$/i.test(t)) tag(b, "rep:creative");
    });
  }
  function css() {
    var st = document.getElementById("bacc-css");
    if (!st) { st = document.createElement("style"); st.id = "bacc-css"; st.setAttribute("data-bt-skip", "1"); (document.head || document.documentElement).appendChild(st); }
    st.textContent = DENY.length ? DENY.map(function (id) { return '[data-acc="' + id + '"]'; }).join(",") + "{display:none!important}" : "";
  }
  function fixTab() {   // the tab on screen was switched off: go back to the first allowed one
    var cur = document.querySelector('#tabs button[aria-selected="true"]');
    if (cur && !ok("tab:" + cur.getAttribute("data-t"))) { var f = Array.prototype.filter.call(document.querySelectorAll("#tabs button[data-t]"), function (b) { return ok("tab:" + b.getAttribute("data-t")); })[0]; if (f) f.click(); }
  }
  // ---------- tool pages opened directly ----------
  var CAT = null;
  function tools() { var out = []; (window.BIACCESS_CAT || []).forEach(function (g) { g.items.forEach(function (it) { if (/^t:/.test(it[2] || "")) out.push({ id: it[0], name: it[1], file: it[2].slice(2).split("#")[0], hash: (it[2].split("#")[1] || "") }); }); }); return out; }
  function pageBlock() {
    if (isDash() || MASTER) return unblock();
    var file = (location.pathname.split("/").pop() || "index.html").toLowerCase(); if (file === "hub.html" || file === "index.html" || file === "") return;
    if (!window.BIACCESS_CAT) { if (!CAT) { CAT = document.createElement("script"); CAT.src = "access-catalog.js?v=" + (window.BIACCESS_V || 1); CAT.onload = pageBlock; (document.head || document.documentElement).appendChild(CAT); } return; }
    var mine = tools().filter(function (x) { return x.file === file; }); if (!mine.length) return unblock();
    var h = (location.hash || "").replace(/^#/, "").split(/[/?&]/)[0], exact = mine.filter(function (x) { return x.hash && x.hash === h; });
    var off = exact.length ? exact.every(function (x) { return !ok(x.id); }) : mine.every(function (x) { return !ok(x.id); });
    if (off) block((exact[0] || mine[0]).name); else unblock();
  }
  function block(name) {
    if (!document.body) return setTimeout(function () { block(name); }, 100);
    var d = document.getElementById("bia-block");
    if (!d) { d = document.createElement("div"); d.id = "bia-block"; d.setAttribute("data-bt-skip", "1"); document.body.appendChild(d); }
    d.style.cssText = "position:fixed;inset:0;z-index:99998;background:#F5F6FB;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
    d.innerHTML = '<div style="max-width:360px;text-align:center;background:#fff;border-radius:18px;padding:26px 20px;box-shadow:0 10px 30px rgba(20,24,51,.12)"><div style="font-size:44px">🔒</div><h3 style="margin:8px 0 6px;color:#141833">' + String(name).replace(/[<>&]/g, "") + ' isn’t available</h3><div style="color:#6B7088;font-size:14px;line-height:1.5">HO has switched off access to this for your account. Ask your BI admin if you need it.</div><button style="margin-top:16px;border:0;border-radius:12px;background:#415FFF;color:#fff;font:700 14px inherit;padding:11px 18px;cursor:pointer" onclick="history.length>1?history.back():location.replace(\'hub.html\')">← Back</button></div>';
  }
  function unblock() { var d = document.getElementById("bia-block"); if (d) d.remove(); }
  // ---------- dashboard: tell HO which tabs this file has (admins) ----------
  function reportTabs() {
    var a = auth(); if (!isDash() || !a || a.app !== "admin") return;
    var tabs = Array.prototype.map.call(document.querySelectorAll("#tabs button[data-t]"), function (b) { return [b.getAttribute("data-t"), ((b.getAttribute("title") || "").split(" · ")[0] || b.textContent).trim()]; }).filter(function (x, i, l) { return x[0] && l.findIndex(function (y) { return y[0] === x[0]; }) === i; });
    if (!tabs.length) return; var sig = JSON.stringify(tabs); if (ls("biw-acc-cat") === sig) return;
    fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json", "X-BI-App": "1" }, body: JSON.stringify({ app: a.app, username: a.username, token: a.token, action: "acc-cat", tabs: tabs }) }).then(function (r) { if (r.ok) ls("biw-acc-cat", sig); }).catch(function () { });
  }
  function apply() { css(); tagAll(); fixTab(); pageBlock(); }
  var T = null;
  function watch() { if (!window.MutationObserver || !document.body) return; new MutationObserver(function () { clearTimeout(T); T = setTimeout(function () { tagAll(); fixTab(); }, 250); }).observe(document.body, { childList: true, subtree: true }); }
  window.BIACCESS = { ok: ok, deny: function () { return DENY.slice(); }, master: function () { return MASTER; }, onChange: function (f) { SUBS.push(f); }, refresh: load };
  css();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { apply(); watch(); setTimeout(reportTabs, 4000); }); else { apply(); watch(); setTimeout(reportTabs, 4000); }
  window.addEventListener("hashchange", function () { setTimeout(function () { fixTab(); pageBlock(); }, 150); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && Date.now() - LAST > 15000) load(); });
  load();
})();
