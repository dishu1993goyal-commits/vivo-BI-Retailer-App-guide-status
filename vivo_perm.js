// vivo "Imei Query System" portal — Set Product Permission for many partner roles × many models.
// Runs inside the portal page AFTER the user has logged in themselves (it never touches the captcha).
// It presses the same things a person presses: Role Permission → tick the role → Set Product Permission →
// type the model in TypeName → Search → tick each product that is not ticked → in the state window tick all → close.
// It never clicks a box that is already ticked, so it can only add permissions, never remove them.
//   window.__biPermRun({ id, roles:[…], models:[…], exact:false, dry:false, fill:{u,p}, stop:false, panel:false })
// returns a JSON string: { s: login|run|done|stopped|err, msg, pct, res:[…], roles:[…], log:[…] }
window.__biPermRun = function (c) {
  "use strict";
  var W = window;
  function docs() {
    var L = [document];
    (function walk(w) { for (var i = 0; i < w.frames.length; i++) { try { var d = w.frames[i].document; if (d && d.body) { L.push(d); walk(w.frames[i]); } } catch (e) { } } })(W);
    return L;
  }
  function vis(e) {
    try { var r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; var s = (e.ownerDocument.defaultView || W).getComputedStyle(e); return s.visibility !== "hidden" && s.display !== "none" && +s.opacity !== 0; } catch (x) { return false; }
  }
  function txt(e) { return String(e.innerText || e.textContent || e.value || "").replace(/\s+/g, " ").trim(); }
  var norm = function (s) { return String(s == null ? "" : s).toLowerCase().replace(/[\s:：]+/g, ""); };

  // ---------- login screen (app only): fill the saved user ID + password; the captcha is always typed by the person ----------
  var pwd = null;
  docs().forEach(function (d) { if (!pwd) pwd = [].filter.call(d.querySelectorAll("input[type=password]"), vis)[0] || null; });
  if (pwd && !/main\./i.test(location.pathname)) {
    var D0 = pwd.ownerDocument, W0 = D0.defaultView || W;
    var ins = [].filter.call(D0.querySelectorAll("input"), function (e) { return vis(e) && /^(text|email|tel|number|)$/i.test(e.type || ""); });
    var isCap = function (e) { return /captcha|verif|vcode|valid|check.?code|auth.?code|验证/i.test([e.name, e.id, e.placeholder, e.className].join(" ")); };
    var user = null, cap = null;
    ins.forEach(function (e) { var before = pwd.compareDocumentPosition(e) & 2; if (isCap(e)) cap = cap || e; else if (before) user = e; else if (!cap) cap = e; });
    var setv0 = function (el, v) { var d = Object.getOwnPropertyDescriptor(W0.HTMLInputElement.prototype, "value"); d.set.call(el, v); ["input", "change", "keyup"].forEach(function (t) { el.dispatchEvent(new W0.Event(t, { bubbles: true })); }); };
    if (c.fill && user) { if (!user.value) setv0(user, c.fill.u); if (!pwd.value) setv0(pwd, c.fill.p); if (cap && D0.activeElement !== cap && !cap.value) { try { cap.focus(); } catch (e) { } } }
    return JSON.stringify({ s: "login", msg: "", u: user ? user.value : "", p: pwd.value || "" });
  }

  if (W.__biPerm && W.__biPerm.id === c.id) { if (c.stop) W.__biPerm.stop = true; return W.__biPerm.status(); }
  if (W.__biPerm && W.__biPerm.state === "run") return JSON.stringify({ s: "busy", msg: "Another run is still going on this page — stop it or wait.", res: [], roles: [], log: [] });

  // ---------- the run ----------
  var KEY = "biPerm:" + c.id, S = null;
  try { S = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { }
  if (!S) S = { done: {}, log: [], roles: [], state: "run" };
  var R = W.__biPerm = { id: c.id, stop: false, msg: "Starting…", state: S.state === "done" ? "done" : "run", cur: 0 };
  var roles = (c.roles || []).map(function (x) { return String(x).trim(); }).filter(Boolean), models = (c.models || []).map(function (x) { return String(x).trim(); }).filter(Boolean), total = roles.length * models.length || 1;
  var save = function () { S.state = R.state; if (S.log.length > 600) S.log = S.log.slice(-600); try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } };
  var log = function (t) { var d = new Date(); S.log.push(("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2) + " " + t); R.msg = t; paint(); };
  var res = function () { var L = []; roles.forEach(function (r) { models.forEach(function (m) { var x = S.done[r + "|" + m]; if (x) L.push(x); }); }); return L; };
  R.status = function () { return JSON.stringify({ s: R.state, msg: R.msg, pct: Math.round(Object.keys(S.done).length * 100 / total), res: res(), roles: S.roles, log: S.log.slice(-250), dry: !!c.dry }); };

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function Stop() { this.stop = true; }
  var chk = function () { if (R.stop) throw new Stop(); };
  function busy() {
    return docs().some(function (d) {
      return [].some.call(d.querySelectorAll(".datagrid-mask-msg,.datagrid-mask,.messager-progress,.messager-p-msg"), vis);
    });
  }
  async function settle(max) {   // wait until the portal has stopped showing "Processing / Loading, please wait"
    var t0 = Date.now(), quiet = 0; await sleep(120);
    while (Date.now() - t0 < (max || 30000)) { if (busy()) quiet = 0; else if ((quiet += 100) >= 300) return true; await sleep(100); }
    return false;
  }
  async function until(fn, max, step) { var t0 = Date.now(), v; while (Date.now() - t0 < (max || 10000)) { chk(); try { v = fn(); } catch (e) { v = null; } if (v) return v; await sleep(step || 200); } return null; }
  function tap(e) { try { e.scrollIntoView({ block: "center", inline: "center" }); } catch (x) { } e.click(); }
  function find(re, scope, after) {   // smallest visible element whose own text matches; optionally the first one after another element
    var best = null;
    (scope ? [scope] : docs()).forEach(function (d) {
      [].forEach.call(d.querySelectorAll("a,span,div,li,button,input[type=button],input[type=submit],td,label,b"), function (e) {
        var t = txt(e); if (t.length > 50 || !re.test(t) || !vis(e)) return;
        if (after && !(after.compareDocumentPosition(e) & 4)) return;
        if (!best || best.contains(e)) best = e;
      });
    });
    return best ? (best.closest("a,button") || best) : null;
  }
  function setv(el, v) {
    var w = el.ownerDocument.defaultView || W, d = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value");
    try { el.focus(); } catch (e) { }
    d.set.call(el, v); ["input", "keyup", "change"].forEach(function (t) { el.dispatchEvent(new w.Event(t, { bubbles: true })); });
    var hid = el.parentNode && el.parentNode.querySelector("input.textbox-value,input[type=hidden]"); if (hid && /textbox/.test(el.className || "")) hid.value = v;   // EasyUI textbox keeps the value in a hidden twin
    try { el.blur(); } catch (e) { }
  }

  // ---------- EasyUI datagrid, read the way it is drawn ----------
  function grids() {
    var G = [];
    docs().forEach(function (d) {
      [].forEach.call(d.querySelectorAll("div.datagrid-view"), function (v) {
        if (!vis(v)) return;
        var H = {}; [].forEach.call(v.querySelectorAll(".datagrid-header td[field]"), function (td) { var t = norm(txt(td)); if (t) H[t] = td.getAttribute("field"); });
        var wrap = v.closest(".datagrid") || v.parentNode;
        G.push({
          v: v, d: d, H: H, win: v.closest(".window,.window-body,.dialog"), wrap: wrap,
          headCb: function () { return v.querySelector(".datagrid-header-check input[type=checkbox]"); },
          rows: function () {
            var M = {}, L = [];
            [].forEach.call(v.querySelectorAll(".datagrid-body tr.datagrid-row"), function (tr) { var i = tr.getAttribute("datagrid-row-index"); if (i == null) return; if (!M[i]) { M[i] = { trs: [] }; L.push(M[i]); } M[i].trs.push(tr); });
            L.forEach(function (r) {
              r.cell = function (name) { var f = H[name]; if (!f) return ""; for (var i = 0; i < r.trs.length; i++) { var td = r.trs[i].querySelector('td[field="' + f + '"]'); if (td) return txt(td); } return ""; };
              r.cb = function () { for (var i = 0; i < r.trs.length; i++) { var x = r.trs[i].querySelector(".datagrid-cell-check input[type=checkbox],td input[type=checkbox]"); if (x) return x; } return null; };
            });
            return L;
          },
          pager: function () { return wrap.querySelector(".datagrid-pager,.pagination"); }
        });
      });
    });
    return G;
  }
  var gridWith = function (h, inWin) { return grids().filter(function (g) { return g.H[h] && (inWin == null || !!g.win === inWin); })[0] || null; };
  var roleGrid = function () { return gridWith("rolename", false); }, prodGrid = function () { return gridWith("typename", false); }, compGrid = function () { return gridWith("companyname", true) || grids().filter(function (g) { return g.H.companyname && g.H.companyid; })[0] || null; };
  async function biggestPage(get) {   // show as many rows per page as the portal allows
    var g = get(), p = g && g.pager(), sel = p && p.querySelector("select.pagination-page-list"); if (!sel || !sel.options.length) return;
    var mx = 0; [].forEach.call(sel.options, function (o) { if (+o.value > mx) mx = +o.value; });
    if (mx && +sel.value !== mx) { sel.value = String(mx); sel.dispatchEvent(new (sel.ownerDocument.defaultView || W).Event("change", { bubbles: true })); await settle(); await sleep(300); }
  }
  async function nextPage(get) {
    var g = get(), p = g && g.pager(), n = p && p.querySelector(".pagination-next"); if (!n) return false;
    var a = n.closest("a,.l-btn") || n; if (/l-btn-disabled/.test(a.className) || a.disabled) return false;
    var first = (g.rows()[0] || { trs: [] }).trs.map(function (t) { return txt(t); }).join("|");
    tap(a); await settle(); await sleep(250);
    var g2 = get(); return !!g2 && (g2.rows()[0] || { trs: [] }).trs.map(function (t) { return txt(t); }).join("|") !== first;
  }
  async function firstPage(get) { var g = get(), p = g && g.pager(), n = p && p.querySelector(".pagination-first"); if (!n) return; var a = n.closest("a,.l-btn") || n; if (!/l-btn-disabled/.test(a.className)) { tap(a); await settle(); await sleep(200); } }
  function diag() { return grids().map(function (g) { return (g.win ? "window:" : "") + "[" + Object.keys(g.H).join(",") + "] " + g.rows().length + " rows"; }).join(" · ") || "no tables found on the screen"; }
  function roleOnScreen() {   // 设置商品权限：当前角色 [12 : hdfc]
    var out = null;
    docs().forEach(function (d) { [].forEach.call(d.querySelectorAll("span,div,td,b,font,label,p"), function (e) { if (out || !vis(e)) return; var t = txt(e); if (t.length > 80) return; var m = /\[\s*(\d+)\s*[:：]\s*([^\]]+?)\s*\]/.exec(t); if (m) out = m[2]; }); });
    return out;
  }

  // ---------- steps ----------
  async function openRoleScreen() {
    for (var i = 0; i < 14; i++) {
      chk();
      if (roleGrid()) return true;
      if (prodGrid()) { var b = find(/^back$/i); if (b) { tap(b); await settle(); await sleep(400); continue; } }
      var a = find(/^role\s*permission$/i);
      if (a && !a.closest(".tabs")) { tap(a); await settle(); await sleep(900); continue; }
      var p = find(/^permissions?\s*config$/i); if (p && i % 2 === 0) { tap(p); await sleep(700); continue; }
      var s = find(/^system\s*config$/i); if (s) { tap(s); await sleep(900); continue; }
      await sleep(700);
    }
    return !!roleGrid();
  }
  async function readRoles() {
    await biggestPage(roleGrid); await firstPage(roleGrid);
    var seen = {}, L = [];
    for (var p = 0; p < 30; p++) { var g = roleGrid(); if (!g) break; g.rows().forEach(function (r) { var n = r.cell("rolename"); if (n && !seen[n]) { seen[n] = 1; L.push(n); } }); if (!(await nextPage(roleGrid))) break; }
    await firstPage(roleGrid);
    return L;
  }
  async function pickRole(role) {
    await biggestPage(roleGrid); await firstPage(roleGrid);
    for (var p = 0; p < 30; p++) {
      chk();
      var g = roleGrid(); if (!g) return "Role list is not on the screen";
      var rows = g.rows(), hit = rows.filter(function (r) { return norm(r.cell("rolename")) === norm(role); })[0];
      for (var i = 0; i < rows.length; i++) { var cb = rows[i].cb(); if (cb && cb.checked && rows[i] !== hit) { tap(cb); await sleep(120); } }   // only one role may be ticked
      if (hit) {
        var hc = hit.cb(); if (hc && !hc.checked) { tap(hc); await sleep(250); } else if (!hc) { tap(hit.trs[hit.trs.length - 1]); await sleep(250); }
        var btn = find(/^set\s*product\s*permissions?$/i); if (!btn) return "Button “Set Product Permission” not found";
        tap(btn); await settle();
        if (!(await until(prodGrid, 15000))) return "The product list did not open";
        await settle(); await sleep(300);
        var on = await until(roleOnScreen, 5000);
        if (!on || norm(on) !== norm(role)) return "The portal shows role “" + (on || "?") + "” instead of “" + role + "” — nothing was changed";
        return "";
      }
      if (!(await nextPage(roleGrid))) break;
    }
    return "Role “" + role + "” is not in the portal's role list";
  }
  async function tickStates(x) {   // the window that opens after a product is ticked: tick every state
    var g = await until(compGrid, 9000);
    if (!g) return "state window did not open";
    await settle(); await until(function () { var q = compGrid(); return q && q.rows().length; }, 8000);
    await biggestPage(compGrid);
    var err = "";
    for (var p = 0; p < 20; p++) {
      chk(); g = compGrid(); if (!g) break;
      var un = g.rows().filter(function (r) { var b = r.cb(); return b && !b.checked; });
      if (un.length) {
        var h = g.headCb();
        if (h && vis(h) && !h.checked) { tap(h); await settle(); await sleep(350); }
        g = compGrid(); un = g ? g.rows().filter(function (r) { var b = r.cb(); return b && !b.checked; }) : [];
        for (var i = 0; i < un.length && i < 80; i++) { chk(); var b = un[i].cb(); if (b && !b.checked) { tap(b); await settle(); await sleep(150); } }
        g = compGrid(); var left = g ? g.rows().filter(function (r) { var b = r.cb(); return b && !b.checked; }).length : 0;
        if (left) err = left + " state(s) could not be ticked";
        x.states += g ? g.rows().length - left : 0;
      } else x.states += g.rows().length;
      if (!(await nextPage(compGrid))) break;
    }
    // close the window
    g = compGrid();
    if (g) {
      var w = g.v.closest(".window") || g.win, cl = w && w.querySelector(".panel-tool-close,.window-header .panel-tool a,.dialog-close");
      if (cl) tap(cl); else { var cb = find(/^(close|关闭)$/i, w); if (cb) tap(cb); }
      await until(function () { return !compGrid(); }, 6000);
    }
    return err;
  }
  async function doModel(role, model) {
    var x = { role: role, model: model, found: 0, ticked: 0, already: 0, failed: 0, states: 0, note: "", names: [] }, g = prodGrid();
    if (!g) { x.note = "Product list is not on the screen"; x.failed = 1; return x; }
    var lab = find(/^type\s*name\s*[:：]?$/i, g.d), inp = null;
    if (lab) inp = [].filter.call(g.d.querySelectorAll("input"), function (e) { return vis(e) && !/^(checkbox|radio|button|submit|hidden|file)$/i.test(e.type || "") && (lab.compareDocumentPosition(e) & 4) && !e.closest(".datagrid-view,.window"); })[0];
    if (!inp) { x.note = "Search box “TypeName” not found"; x.failed = 1; return x; }
    setv(inp, model); await sleep(200);
    var sb = find(/^search$/i, g.d, inp); if (!sb || sb.closest(".window")) { x.note = "Search button not found"; x.failed = 1; return x; }
    tap(sb); await settle(); await sleep(400);
    var key = norm(model), match = function (r) { var n = norm(r.cell("typename")); return c.exact ? n.replace(/[(（].*$/, "") === key : n.indexOf(key) >= 0; };
    await until(function () { var q = prodGrid(); if (!q) return false; var rr = q.rows(); return !rr.length || rr.every(function (r) { return norm(r.cell("typename")).indexOf(key) >= 0; }); }, 9000);
    await biggestPage(prodGrid); await firstPage(prodGrid);
    var seen = {};
    for (var p = 0; p < 60; p++) {
      for (var guard = 0; guard < 400; guard++) {
        chk(); g = prodGrid(); if (!g) { x.note = "Product list closed unexpectedly"; x.failed++; return x; }
        var row = g.rows().filter(function (r) { var id = r.cell("typeid") || r.cell("typename"); return id && !seen[id] && match(r); })[0];
        if (!row) break;
        var id = row.cell("typeid") || row.cell("typename"), name = row.cell("typename"), cb = row.cb();
        seen[id] = 1; x.found++;
        if (!cb) { x.failed++; x.note = "No tick box on " + name; continue; }
        if (cb.checked) { x.already++; continue; }
        if (c.dry) { x.ticked++; x.names.push(name); continue; }
        if (norm(roleOnScreen()) !== norm(role)) { x.failed++; x.note = "Role on the screen changed — stopped this role"; return x; }
        R.msg = role + " · " + name; paint();
        tap(cb); await settle(); await sleep(200);
        var e = await tickStates(x);
        await settle(); await sleep(250);
        var g2 = prodGrid(), again = g2 && g2.rows().filter(function (r) { return (r.cell("typeid") || r.cell("typename")) === id; })[0], ok = again && again.cb() && again.cb().checked;
        if (!ok) { x.failed++; x.note = name + ": tick did not stay"; log("✗ " + role + " · " + name + " — tick did not stay"); }
        else if (e) { x.ticked++; x.failed++; x.note = name + ": " + e; log("⚠ " + role + " · " + name + " — " + e); }
        else { x.ticked++; x.names.push(name); log("✓ " + role + " · " + name); }
        if (x.failed >= 5) { x.note += " · too many problems, stopped this model"; return x; }
      }
      if (!(await nextPage(prodGrid))) break;
    }
    if (!x.found) x.note = "No product found for “" + model + "”";
    return x;
  }
  async function main() {
    try {
      if (!roles.length || !models.length) throw new Error("No roles or models in this job");
      log((c.dry ? "Check only (no changes) — " : "") + roles.length + " role(s) × " + models.length + " model(s)");
      if (!(await openRoleScreen())) throw new Error("Could not open System Config → Permissions Config → Role Permission. Open it yourself and run again. Seen: " + diag());
      await settle();
      try { S.roles = await readRoles(); } catch (e) { if (e instanceof Stop) throw e; }
      var bad = 0;
      for (var i = 0; i < roles.length; i++) {
        var role = roles[i]; chk();
        if (models.every(function (m) { return S.done[role + "|" + m]; })) continue;
        if (!(await openRoleScreen())) throw new Error("Lost the Role Permission screen. Seen: " + diag());
        log("Role " + role + " — opening Set Product Permission");
        var err = await pickRole(role);
        if (err) {
          log("✗ " + role + ": " + err);
          models.forEach(function (m) { if (!S.done[role + "|" + m]) S.done[role + "|" + m] = { role: role, model: m, found: 0, ticked: 0, already: 0, failed: 1, states: 0, note: err, names: [] }; });
          save(); if (++bad >= 3 && bad === i + 1) throw new Error("The first roles all failed — stopped. Seen: " + diag());
          continue;
        }
        for (var j = 0; j < models.length; j++) {
          chk(); var m = models[j]; if (S.done[role + "|" + m]) continue;
          R.msg = role + " · searching " + m; paint();
          var x = await doModel(role, m);
          S.done[role + "|" + m] = x; save();
          log((x.failed ? "⚠ " : "● ") + role + " · " + m + ": " + x.found + " found, " + (c.dry ? x.ticked + " to tick" : x.ticked + " ticked") + ", " + x.already + " already ticked" + (x.failed ? ", " + x.failed + " problem(s)" : "") + (x.note ? " — " + x.note : ""));
        }
        var b = find(/^back$/i); if (b) { tap(b); await settle(); await sleep(500); }
      }
      R.state = "done"; log(c.dry ? "Check finished — nothing was changed." : "Finished.");
    } catch (e) {
      if (e instanceof Stop) { R.state = "stopped"; log("Stopped by you."); }
      else { R.state = "err"; log("Stopped: " + (e && e.message || e)); }
    }
    save(); paint();
  }

  // ---------- small status box (when run from the browser, not the app) ----------
  var box = null;
  function paint() {
    if (!c.panel) return;
    try {
      if (!box) {
        box = document.createElement("div"); box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;width:340px;max-width:92vw;background:#141833;color:#fff;font:13px/1.45 Arial,sans-serif;border-radius:12px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,.35)";
        box.innerHTML = '<b>vivo BI · product permissions</b><div data-m style="margin:6px 0;word-break:break-word"></div><div style="height:6px;background:#2c3266;border-radius:9px;overflow:hidden"><div data-p style="height:100%;width:0;background:#7CF5C3"></div></div><div style="margin-top:9px;display:flex;gap:8px"><button data-s style="flex:1;padding:7px;border:0;border-radius:8px;cursor:pointer">Stop</button><button data-c style="flex:2;padding:7px;border:0;border-radius:8px;cursor:pointer;background:#4D5BF9;color:#fff">Copy result</button><button data-x style="padding:7px 10px;border:0;border-radius:8px;cursor:pointer">✕</button></div><textarea data-t readonly style="display:none;width:100%;height:70px;margin-top:8px;box-sizing:border-box"></textarea>';
        document.body.appendChild(box);
        box.querySelector("[data-s]").onclick = function () { R.stop = true; };
        box.querySelector("[data-x]").onclick = function () { box.style.display = "none"; };
        box.querySelector("[data-c]").onclick = function () { var t = box.querySelector("[data-t]"); t.style.display = "block"; t.value = "BIPERM:" + c.id + ":" + btoa(unescape(encodeURIComponent(R.status()))); t.select(); try { document.execCommand("copy"); } catch (e) { } try { navigator.clipboard.writeText(t.value); } catch (e) { } this.textContent = "Copied — paste it in the BI tool"; };
      }
      box.querySelector("[data-m]").textContent = (R.state === "run" ? "⏳ " : R.state === "done" ? "✅ " : "⚠ ") + R.msg;
      box.querySelector("[data-p]").style.width = Math.round(Object.keys(S.done).length * 100 / total) + "%";
      if (R.state !== "run") box.querySelector("[data-s]").style.display = "none";
    } catch (e) { }
  }
  if (R.state !== "done") main(); else paint();
  return R.status();
};
