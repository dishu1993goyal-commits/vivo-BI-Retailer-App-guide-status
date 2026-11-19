/* vivo BI — Process Center capture helper.
   Runs on the Process Center designer page (vform-in.vivo.xyz) only when the user clicks the bookmark.
   It reads the design that is already open (form fields, approval flow) and, while it is on, notes the
   designer's own save / load calls. Nothing is sent anywhere: the user downloads the file and shares it.
   Passwords, tokens and cookies are removed. */
(function () {
  "use strict";
  if (window.__biCap) { window.__biCap.show(); return; }
  var LOG = [], MAXB = 600000, t0 = Date.now(), FOUND = [];
  var SECRET = /token|passw|pwd|cookie|authori|secret|ticket|session|sign(ature)?$/i;
  function red(v, d) {   // remove secrets, cut huge values
    d = d || 0; if (d > 60) return "…";
    if (v == null || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "string") return v.length > 20000 ? v.slice(0, 20000) + "…(cut)" : v;
    if (Array.isArray(v)) return v.slice(0, 500).map(function (x) { return red(x, d + 1); });
    if (typeof v === "object") { var o = {}; Object.keys(v).slice(0, 400).forEach(function (k) { o[k] = SECRET.test(k) ? "(removed)" : red(v[k], d + 1); }); return o; }
    return String(v);
  }
  function body(b) { if (b == null) return null; if (typeof b !== "string") { try { b = JSON.stringify(b); } catch (e) { return "(binary)"; } } var j = null; try { j = JSON.parse(b); } catch (e) { } if (j) return red(j); b = b.replace(/((?:token|password|pwd|ticket)=)[^&]*/gi, "$1(removed)"); return b.length > MAXB ? b.slice(0, MAXB) + "…(cut)" : b; }
  function keep(u) { return !/\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico)(\?|$)/i.test(u) && !/sentry|log(ger)?\/|track|monitor|beacon|heartbeat/i.test(u); }
  function note(m, u, rq, st, rs) { if (!keep(u)) return; LOG.push({ s: Math.round((Date.now() - t0) / 1000), method: m, url: String(u).replace(/([?&](?:token|ticket|sign|t)=)[^&]*/gi, "$1(removed)"), req: body(rq), status: st, res: body(rs) }); if (LOG.length > 300) LOG.shift(); paint(); }
  // ---- watch the designer's own calls ----
  var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__bi = { m: m, u: u }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) { var x = this, i = x.__bi || {}; x.addEventListener("loadend", function () { var r = null; try { r = x.responseType === "" || x.responseType === "text" ? x.responseText : x.responseType === "json" ? x.response : "(" + x.responseType + ")"; } catch (e) { } note(i.m, i.u, b, x.status, r); }); return XS.apply(this, arguments); };
  var FO = window.fetch;
  if (FO) window.fetch = function (u, o) { var url = typeof u === "string" ? u : u && u.url, m = (o && o.method) || (u && u.method) || "GET", b = o && o.body; return FO.apply(this, arguments).then(function (r) { try { r.clone().text().then(function (t) { note(m, url, b, r.status, t); }); } catch (e) { } return r; }); };
  // ---- read the design that is open in the page (Vue state) ----
  var KEYS = /^(widgetList|formConfig|formJson|formData|formSchema|schema|fields|widgets|nodeConfig|childNode|conditionNodes|processJson|processConfig|processData|flowData|bpmnXml|approvalNodes|nodeList|nodes|edges|globalConfig|basicInfo|baseInfo|permissions?|fieldPermission)$/;
  function scan() {
    FOUND = []; var seen = new WeakSet(), hits = 0;
    function walk(o, path, d) {
      if (!o || typeof o !== "object" || d > 14 || hits > 60) return; if (seen.has(o)) return; seen.add(o);
      if (o instanceof Node || o === window) return;
      var ks; try { ks = Object.keys(o); } catch (e) { return; }
      for (var i = 0; i < ks.length && i < 300; i++) {
        var k = ks[i], v; if (k.charAt(0) === "_" && k !== "_value" && k !== "_rawValue") continue;
        try { v = o[k]; } catch (e) { continue; }
        if (KEYS.test(k) && v && typeof v === "object") { var s = null; try { s = JSON.parse(JSON.stringify(v)); } catch (e) { } if (s && JSON.stringify(s).length > 10) { FOUND.push({ path: path + "." + k, value: red(s) }); hits++; continue; } }
        if (Array.isArray(v) && v.length >= 2 && looksLikeFields(v)) { var s2 = null; try { s2 = JSON.parse(JSON.stringify(v)); } catch (e) { } if (s2) { FOUND.push({ path: path + "." + k, value: red(s2) }); hits++; continue; } }
        if (v && typeof v === "object") walk(v, path + "." + k, d + 1);
      }
    }
    function looksLikeFields(a) { var n = 0, m = Math.min(a.length, 12); for (var j = 0; j < m; j++) { var x = a[j]; if (x && typeof x === "object" && !Array.isArray(x) && ("type" in x || "component" in x || "widgetType" in x || "fieldType" in x || "controlType" in x || "nodeType" in x || "tag" in x) && ("label" in x || "title" in x || "name" in x || "fieldName" in x || "nodeName" in x || "options" in x || "props" in x)) n++; } return n >= Math.max(2, m * 0.6); }
    var els = document.querySelectorAll("*"), roots = 0;
    for (var i = 0; i < els.length && roots < 6; i++) {
      var el = els[i];
      if (el.__vue_app__) { roots++; var app = el.__vue_app__; try { var gp = app.config.globalProperties; if (gp.$pinia && gp.$pinia._s) gp.$pinia._s.forEach(function (st, id) { walk(st.$state, "pinia." + id, 0); }); if (gp.$store && gp.$store.state) walk(gp.$store.state, "vuex", 0); } catch (e) { }
        (function tree(inst, p, d) { if (!inst || d > 40) return; try { walk(inst.setupState, p + ".setup", 0); walk(inst.data, p + ".data", 0); walk(inst.props, p + ".props", 0); } catch (e) { } var st = inst.subTree; (function kids(vn, dd) { if (!vn || dd > 400) return; if (vn.component) tree(vn.component, p + ">" + ((vn.component.type && (vn.component.type.name || vn.component.type.__name)) || "c"), d + 1); if (Array.isArray(vn.children)) vn.children.forEach(function (c) { if (c && typeof c === "object") kids(c, dd + 1); }); if (vn.suspense && vn.suspense.activeBranch) kids(vn.suspense.activeBranch, dd + 1); })(st, 0); })(app._instance, "app", 0);
      }
      if (el.__vue__ && !el.__vue__.$parent) { roots++; (function tree2(vm, p, d) { if (!vm || d > 40) return; try { walk(vm.$data, p + ".data", 0); walk(vm._props, p + ".props", 0); if (vm.$store) walk(vm.$store.state, "vuex", 0); } catch (e) { } (vm.$children || []).forEach(function (c) { tree2(c, p + ">" + (c.$options.name || "c"), d + 1); }); })(el.__vue__, "vue2", 0); }
    }
    // React pages
    for (var r = 0; r < els.length && roots < 8; r++) {
      var ks2 = Object.keys(els[r]).filter(function (k) { return /^__react(Fiber|Container)\$/.test(k); });
      if (!ks2.length) continue; roots++;
      var f0 = els[r][ks2[0]]; if (f0 && f0.stateNode && f0.stateNode.current) f0 = f0.stateNode.current;
      var stack = [f0], cnt = 0;
      while (stack.length && cnt < 8000) { var f = stack.pop(); if (!f) continue; cnt++;
        var nm = f.type && (f.type.displayName || f.type.name) || "";
        try { walk(f.memoizedProps, "react>" + nm + ".props", 0); var h = f.memoizedState, hi = 0; while (h && hi < 40) { walk(h.memoizedState, "react>" + nm + ".state" + hi, 0); h = h.next; hi++; } } catch (e) { }
        if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child); }
      break;
    }
    // page-level data
    try { Object.keys(window).forEach(function (k) { if (/^(webkit|on|chrome|__bi)/.test(k) || k.length < 3) return; var v = window[k]; if (v && typeof v === "object" && !(v instanceof Node) && v !== window) walk(v, "window." + k, 4); }); } catch (e) { }
    paint(); return FOUND.length;
  }
  var REFETCHED = false;
  function refetch(done) {
    if (REFETCHED) return done(); REFETCHED = true;
    var seen = {}, list = (performance.getEntriesByType("resource") || []).filter(function (e) { return (e.initiatorType === "xmlhttprequest" || e.initiatorType === "fetch") && keep(e.name); }).map(function (e) { return e.name; })
      .filter(function (u) { var h; try { h = new URL(u).hostname; } catch (e) { return false; } return /vivo/i.test(h) && !/(save|submit|delete|del|remove|update|upd|release|publish|create|add|insert|approve|reject|send|upload|logout|import)/i.test(u.split("?")[0].split("/").slice(-2).join("/")) && !seen[u] && (seen[u] = 1); }).slice(0, 60);
    var i = 0, OF = FO || fetch;
    (function next() { if (i >= list.length) return done(); var u = list[i++]; OF.call(window, u, { credentials: "include" }).then(function (r) { return r.text().then(function (t) { LOG.push({ s: Math.round((Date.now() - t0) / 1000), method: "GET (re-read)", url: u.replace(/([?&](?:token|ticket|sign|t)=)[^&]*/gi, "$1(removed)"), req: null, status: r.status, res: body(t) }); }); }).catch(function () { }).then(function () { paint(); next(); }); })();
  }
  // ---- small panel ----
  var P = document.createElement("div");
  P.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;width:300px;background:#12163A;color:#fff;font:13px/1.45 Arial,sans-serif;border-radius:14px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)";
  document.body.appendChild(P);
  var B = "border:0;border-radius:9px;padding:8px 10px;margin:6px 6px 0 0;font:700 12.5px Arial;cursor:pointer;";
  function paint() {
    var saves = LOG.filter(function (x) { return x.method && x.method.toUpperCase() !== "GET"; }).length;
    P.innerHTML = '<b>📥 vivo BI · Process capture</b><div style="opacity:.85;margin-top:4px">1. Open each tab: Basic info, Form design, Process design (tap a node to open its settings).<br>2. Tap <b>Read design</b> (it also re-reads what the page loaded). Download even if parts = 0 — the data calls usually hold the design.<br>3. Optional, on a TEST process only: press the designer\'s <b>Save</b>.<br>4. Tap <b>Download</b> and send the file.</div>' +
      '<div style="margin-top:6px;background:rgba(255,255,255,.1);border-radius:8px;padding:6px 8px">Design parts found: <b>' + FOUND.length + "</b> · data calls: <b>" + LOG.length + "</b> (saves: " + saves + ")</div>" +
      '<button id="biR" style="' + B + 'background:#4D5BF9;color:#fff">🔍 Read design</button><button id="biD" style="' + B + 'background:#1E9E61;color:#fff">⬇ Download</button><button id="biX" style="' + B + 'background:#fff;color:#12163A">✕</button>';
    P.querySelector("#biR").onclick = function () { var b = this; b.textContent = "Reading…"; refetch(function () { scan(); b.textContent = "🔍 Read design"; }); };
    P.querySelector("#biD").onclick = function () { refetch(function () { scan(); dl(); }); };
    function dl() { var out = { tool: "vivo BI Process capture v1", page: location.origin + location.pathname + location.hash.replace(/([?&](?:token|ticket)=)[^&]*/gi, "$1(removed)"), title: document.title, at: new Date().toISOString(), found: FOUND, calls: LOG, lexicon: [].slice.call(document.querySelectorAll(".el-tabs__item,.widget-label,label")).slice(0, 300).map(function (e) { return (e.textContent || "").trim(); }).filter(Boolean) }; var blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "process_capture_" + Date.now() + ".json"; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 1000); }
    P.querySelector("#biX").onclick = function () { P.style.display = "none"; };
  }
  window.__biCap = { show: function () { P.style.display = ""; paint(); } };
  paint();
})();
