// Smart tools sync (dashboard page only, web + both apps).
// The dashboard's smart tools keep their data in localStorage under "bi_tl_<name>". This script mirrors that data to
// the server for the signed-in user, without changing the dashboard file itself — so a new dashboard file keeps working:
//   notes / audits / kpis  -> follow the user to every device (HO sees all states' notes & audits in Field notes)
//   beat (uploaded list)   -> shared with the user's state team (HO: shared by all admins)
//   beatv (visited map)    -> merged per state, plus Market visits punch-ins
//   idea box               -> one live board for all states (votes count together)
//   a few settings         -> language, weights, survey questions, name
(function () {
  "use strict";
  if (window.TLSYNC) { window.TLSYNC.start(); return; }
  var P = "bi_tl_", LISTS = { notes: 1, audits: 1, kpis: 1 }, PREFS = ["vlang", "beatw", "sostgt", "vq", "me"], USERDATA = ["notes", "audits", "kpis", "beat", "beatv", "myvotes", "ideas"].concat(PREFS);
  var ls; try { ls = window.localStorage; } catch (e) { return; }
  var AUTH = null, SNAP = {}, timers = {}, muted = false, busy = false, lastPull = 0, failed = {};
  function readAuth() {
    var a = null;
    try { a = window.BIApp && window.BIApp.getAuth ? JSON.parse(window.BIApp.getAuth()) : null; } catch (e) { a = null; }
    if ((!a || !a.token) && window.__BI_AUTH && window.__BI_AUTH.token) a = window.__BI_AUTH;
    if (!a || !a.token) { try { var w = JSON.parse(ls.getItem("biw-auth") || "null"); if (w && w.token) a = { app: w.app, username: w.username, token: w.token }; } catch (e) { } }
    return a && a.token ? { app: a.app, username: a.username, token: a.token } : null;
  }
  function api(body) {
    return fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json", "X-BI-App": "1" }, body: JSON.stringify(Object.assign({ app: AUTH.app, username: AUTH.username, token: AUTH.token }, body)) })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, offline: true }; });
  }
  var oSet = Storage.prototype.setItem, oRem = Storage.prototype.removeItem;
  function get(k) { try { var v = ls.getItem(P + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } }
  function put(k, v) { muted = true; try { if (v == null) oRem.call(ls, P + k); else oSet.call(ls, P + k, JSON.stringify(v)); } catch (e) { } muted = false; }
  var SK = function () { return "bi_tls_" + AUTH.app + ":" + String(AUTH.username).toLowerCase(); };
  function saveSnap() { try { oSet.call(ls, SK(), JSON.stringify(SNAP)); } catch (e) { } }
  Storage.prototype.setItem = function (k, v) { oSet.call(this, k, v); try { if (!muted && this === ls && AUTH && String(k).indexOf(P) === 0) changed(String(k).slice(P.length)); } catch (e) { } };
  Storage.prototype.removeItem = function (k) { oRem.call(this, k); try { if (!muted && this === ls && AUTH && String(k).indexOf(P) === 0) changed(String(k).slice(P.length)); } catch (e) { } };

  function changed(ns) {
    if (!(LISTS[ns] || ns === "beat" || ns === "beatv" || PREFS.indexOf(ns) >= 0)) return;
    clearTimeout(timers[ns]); timers[ns] = setTimeout(function () { push(ns); }, 700);
  }
  function idMap(list) { var m = {}; (list || []).forEach(function (x) { if (x && x.id) m[x.id] = JSON.stringify(x); }); return m; }
  function push(ns) {
    if (!AUTH) return Promise.resolve();
    var p;
    if (LISTS[ns]) {
      var cur = get(ns) || [], prev = SNAP[ns] || {}, now = idMap(cur), up = [], del = [];
      cur.forEach(function (x) { if (x && x.id && !x._shared && now[x.id] !== prev[x.id]) up.push(x); });
      Object.keys(prev).forEach(function (id) { if (!now[id]) del.push(id); });
      if (!up.length && !del.length) return Promise.resolve();
      p = api({ action: "tl-push", ns: ns, upserts: up, deletes: del }).then(function (r) { if (r.ok) { SNAP[ns] = now; (r.refused || []).forEach(function (id) { delete SNAP[ns][id]; }); saveSnap(); delete failed[ns]; } else failed[ns] = 1; });
    } else if (ns === "beatv") p = api({ action: "tl-push", ns: "beatv", map: get("beatv") || {} });
    else if (ns === "beat") { var v = get("beat"); p = api({ action: "tl-push", ns: "beat", value: v }).then(function (r) { if (r.ok) { SNAP.beat = v ? 1 : 0; saveSnap(); } }); }
    else { var pv = {}; pv[ns] = get(ns); p = api({ action: "tl-push", ns: "prefs", value: pv }); }
    return p.then(function (r) { if (r && r.offline) failed[ns] = 1; });
  }

  function ideaUrl() { return "/api/auth?tl=ideas&a=" + encodeURIComponent(AUTH.app) + "&u=" + encodeURIComponent(AUTH.username) + "&k=" + encodeURIComponent(AUTH.token); }
  function pull() {
    if (!AUTH || busy) return Promise.resolve();
    busy = true; lastPull = Date.now();
    var before = JSON.stringify(USERDATA.map(get));
    return api({ action: "tl-pull" }).then(function (r) {
      if (!r.ok) return;
      var toPush = [];
      // lists: server copy wins; items only on this device are uploaded; items deleted elsewhere are removed here
      Object.keys(LISTS).forEach(function (ns) {
        var srv = r[ns] || [], loc = get(ns) || [], sm = idMap(srv), prev = SNAP[ns] || {}, out = srv.slice(), extra = false;
        loc.forEach(function (x) { if (x && x.id && !sm[x.id] && !prev[x.id] && !x._shared) { out.push(x); extra = true; } });
        out.sort(function (a, b) { return String(b.at || "") > String(a.at || "") ? 1 : -1; });
        put(ns, out); SNAP[ns] = sm; if (extra) toPush.push(ns);
      });
      // visited map: newest date wins
      var bv = get("beatv") || {}, sv = r.beatv || {}, newer = false;
      Object.keys(sv).forEach(function (k) { if (!bv[k] || bv[k] < sv[k]) bv[k] = sv[k]; });
      Object.keys(bv).forEach(function (k) { if (!sv[k] || sv[k] < bv[k]) newer = true; });
      put("beatv", bv); if (newer) toPush.push("beatv");
      // uploaded beat list: shared per state
      var lb = get("beat");
      if (r.beat) { put("beat", r.beat); SNAP.beat = 1; }
      else if (lb && !SNAP.beat) toPush.push("beat");
      else if (lb && SNAP.beat) { put("beat", null); SNAP.beat = 0; }
      // settings
      var pr = r.prefs || {};
      PREFS.forEach(function (k) { if (pr[k] != null) put(k, pr[k]); else if (get(k) != null) toPush.push(k); });
      // idea box -> live shared board on this server
      put("ideaurl", ideaUrl()); put("ideakey", "");
      saveSnap();
      toPush.forEach(push);
      return ideas();
    }).then(function () {
      busy = false;
      var after = JSON.stringify(USERDATA.map(get));
      if (after !== before) rerender();
    }, function () { busy = false; });
  }
  // Ideas saved on this device before the live board was connected are moved to the board; my votes are restored
  function ideas() {
    var loc = get("ideas") || [];
    var send = loc.filter(function (x) { return x && x.id && x.t; });
    var chain = Promise.resolve();
    send.forEach(function (x) { chain = chain.then(function () { return api({ action: "tl-ideas", op: "add", idea: x }); }); });
    return chain.then(function () {
      if (send.length) put("ideas", []);
      return api({ action: "tl-ideas", op: "list" });
    }).then(function (r) {
      if (!r || !r.ok) return;
      var mv = {}, old = get("myvotes") || {};
      Object.keys(old).forEach(function (k) { if (old[k] === "in") mv[k] = "in"; });
      (r.ideas || []).forEach(function (x) { if (x.mine) mv[x.id] = true; });
      put("myvotes", mv);
    });
  }
  function inTool() { return /^#?(smart-tools|tool-)/.test(location.hash || ""); }
  function rerender() {
    var h = location.hash || "";
    if (inTool() || h === "" || h === "#") { try { window.dispatchEvent(new HashChangeEvent("hashchange")); } catch (e) { try { var ev = document.createEvent("Event"); ev.initEvent("hashchange", true, true); window.dispatchEvent(ev); } catch (x) { } } }
  }
  // State users: the dashboard lock only allows downloads from their own state's retailer view. Inside the smart tools
  // (their own notes, audits, KPIs, reconciliation of their state's data) downloads and sharing are allowed.
  function allowToolExports() {
    var o = window.__biCanExport;
    if (typeof o === "function" && !o.__tl) { var f = function () { return inTool() || o.apply(this, arguments); }; f.__tl = 1; window.__biCanExport = f; }
  }
  var wrapTries = 0, wrapT = setInterval(function () { allowToolExports(); if (++wrapTries > 30) clearInterval(wrapT); }, 1000);
  window.addEventListener("hashchange", allowToolExports);

  // usage: which smart tool was opened / used (upload, export, share, save) — shown to HO in Smart tools activity
  var TOOLS = { "smart-tools": "tl", "tool-voice-notes": "tlv", "tool-photo-audit": "tlp", "tool-beat-planner": "tlb", "tool-reconciliation": "tlr", "tool-excel-insight": "tli", "tool-kpi-builder": "tlk", "tool-share-card": "tls", "tool-idea-box": "tld" };
  function curTool() { var h = String(location.hash || "").replace(/^#/, "").split(/[?&~]/)[0]; return TOOLS[h] || null; }
  var sent = {};
  function use(kind) {
    var tl = curTool(); if (!tl || !AUTH) return;
    var k = tl + ":" + kind, gap = kind === "opens" ? 600000 : 60000;
    if (sent[k] && Date.now() - sent[k] < gap) return; sent[k] = Date.now();
    api({ action: "tl-use", tool: tl, kind: kind });
  }
  window.addEventListener("hashchange", function () { setTimeout(function () { use("opens"); }, 300); });
  document.addEventListener("click", function (e) { var b = e.target && e.target.closest && e.target.closest("[data-tlroot] button, [data-tlroot] .xlbtn"); if (b) use("acts"); }, true);
  document.addEventListener("change", function (e) { if (e.target && e.target.type === "file" && curTool()) use("acts"); }, true);

  function start() {
    var a = readAuth();
    if (!a) { AUTH = null; return; }
    var who = a.app + ":" + String(a.username).toLowerCase(), last = null;
    try { last = ls.getItem("bi_tls_user"); } catch (e) { }
    if (last && last !== who) USERDATA.forEach(function (k) { put(k, null); });   // another person signed in on this device
    try { oSet.call(ls, "bi_tls_user", who); } catch (e) { }
    AUTH = a;
    try { SNAP = JSON.parse(ls.getItem(SK()) || "{}") || {}; } catch (e) { SNAP = {}; }
    allowToolExports();
    pull();
    setTimeout(function () { use("opens"); }, 500);
  }
  function stop() { AUTH = null; }
  window.TLSYNC = { start: start, stop: stop, pull: pull };
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && AUTH && Date.now() - lastPull > 60000) { Object.keys(failed).forEach(push); pull(); } });
  setInterval(function () { if (AUTH && document.visibilityState === "visible" && Date.now() - lastPull > 180000) pull(); }, 60000);
  window.addEventListener("online", function () { if (AUTH) { Object.keys(failed).forEach(push); pull(); } });
  start();
})();
