// Access control: hides tools, admin settings, dashboard tabs, filters and reports the master admin has switched off
// for this user, and blocks a tool page opened directly. Rules come from the server (acc-mine) and refresh when
// the page or app comes back to the front, so changes reach the apps and the web without an update.
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
    var st = document.getElementById("bia-css");
    if (!st) { st = document.createElement("style"); st.id = "bia-css"; st.setAttribute("data-bt-skip", "1"); (document.head || document.documentElement).appendChild(st); }
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
