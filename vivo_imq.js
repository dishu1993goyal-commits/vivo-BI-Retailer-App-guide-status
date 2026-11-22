/* vivo BI · IMEI activation check on the IMEI Query System (in-transfer.vivo.xyz).
   Runs inside the portal page after the person has logged in themselves (it never touches the login form, password or captcha).
   Steps: Registeration Imeis → Batch Search → paste IMEIs → Ok → Search → read "Activation Date" for every row (all pages).
   Called about once a second: window.__biImqRun(job) where job = { id, mode: "imq", imeis: [...] } the first time, then no argument.
   Returns JSON { s: login|run|you|done|err|stopped, msg, pct, res: { imei: { found, act, model } } } */
(function () {
  var W = window, KEY = "__biimq";
  function docs() { var L = [document]; (function walk(w) { for (var i = 0; i < w.frames.length; i++) { try { var d = w.frames[i].document; if (d && d.body) { L.push(d); walk(w.frames[i]); } } catch (e) { } } })(window); return L; }
  function vis(e) { try { var r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; var s = (e.ownerDocument.defaultView || W).getComputedStyle(e); return s.visibility !== "hidden" && s.display !== "none"; } catch (x) { return false; } }
  function txt(e) { return String(e.innerText || e.textContent || e.value || "").replace(/\s+/g, " ").trim(); }
  function find(re, root) { var best = null; (root ? [root] : docs()).forEach(function (d) { [].forEach.call(d.querySelectorAll("a,span,div,li,button,input[type=button],td,label,b"), function (e) { var t = txt(e); if (t.length < 40 && re.test(t) && vis(e) && (!best || best.contains(e) || txt(best).length > t.length)) best = e; }); }); return best; }
  function tap(e) { try { e.scrollIntoView({ block: "center" }); } catch (x) { } ["mousedown", "mouseup"].forEach(function (t) { try { e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: e.ownerDocument.defaultView })); } catch (x) { } }); e.click(); }
  function setv(el, v) { var w = el.ownerDocument.defaultView || W, P = el.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(P, "value").set.call(el, v); ["input", "change", "keyup"].forEach(function (t) { el.dispatchEvent(new w.Event(t, { bubbles: true })); }); }
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(S) { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }
  function out(o) { return JSON.stringify(o); }
  function busy() { return docs().some(function (d) { return [].some.call(d.querySelectorAll(".datagrid-mask,.datagrid-mask-msg,.panel-loading,.layui-layer-loading,.loading"), vis); }); }

  // read the result grid: every row → imei + activation date (+ model). EasyUI grids split columns into two views, joined by row index.
  function grid() {
    var res = {}, any = false;
    docs().forEach(function (d) {
      var heads = [].filter.call(d.querySelectorAll(".datagrid-header td[field],th,td"), function (e) { return vis(e) && txt(e).length < 30; });
      var hAct = heads.filter(function (e) { return /^activation\s*date/i.test(txt(e)); })[0], hIm = heads.filter(function (e) { return /^imei\s*1?$/i.test(txt(e)); })[0], hMod = heads.filter(function (e) { return /^model\s*name/i.test(txt(e)); })[0];
      if (!hAct || !hIm) return;
      var fA = hAct.getAttribute("field"), fI = hIm.getAttribute("field"), fM = hMod && hMod.getAttribute("field");
      if (fA && fI) {   // EasyUI datagrid
        var box = hAct.closest(".datagrid") || d, by = {};
        var take = function (f, k) { if (!f) return; [].forEach.call(box.querySelectorAll(".datagrid-body td[field='" + f + "']"), function (td) { var tr = td.closest("tr"), i = tr && (tr.getAttribute("datagrid-row-index") || tr.rowIndex); (by[i] = by[i] || {})[k] = txt(td); }); };
        take(fI, "imei"); take(fA, "act"); take(fM, "model");
        Object.keys(by).forEach(function (i) { var r = by[i], m = String(r.imei || "").match(/\d{15}/); if (m) { any = true; res[m[0]] = { found: true, act: (r.act || "").trim(), model: r.model || "" }; } });
        return;
      }
      var table = hAct.closest("table"); if (!table) return;   // plain HTML table
      var hr = hAct.closest("tr"), cells = [].slice.call(hr.children), cA = cells.indexOf(hAct.closest("td,th")), cI = cells.indexOf(hIm.closest("td,th")), cM = hMod ? cells.indexOf(hMod.closest("td,th")) : -1;
      [].forEach.call(table.querySelectorAll("tr"), function (tr) { if (tr === hr) return; var c = tr.children, m = c[cI] && txt(c[cI]).match(/\d{15}/); if (m) { any = true; res[m[0]] = { found: true, act: c[cA] ? txt(c[cA]) : "", model: cM >= 0 && c[cM] ? txt(c[cM]) : "" }; } });
    });
    return any ? res : {};
  }
  function emptyGrid() { return docs().some(function (d) { return [].some.call(d.querySelectorAll(".datagrid-body,.datagrid-view2 .datagrid-body"), function (b) { return vis(b) && !b.querySelector("tr.datagrid-row"); }); }); }
  function nextPage() {
    var n = null; docs().forEach(function (d) { [].forEach.call(d.querySelectorAll(".pagination-next"), function (e) { var a = e.closest("a,.l-btn") || e; if (vis(a)) n = a; }); });
    if (!n || /disabled/.test(n.className) || (n.closest(".l-btn-disabled"))) return null; return n;
  }
  function pageSig() { var p = ""; docs().forEach(function (d) { var i = d.querySelector(".pagination-num"); if (i && vis(i)) p += i.value; var x = d.querySelector(".pagination-info"); if (x) p += txt(x); }); return p; }

  W.__biImqRun = function (job) {
    try {
      var S = load();
      if (job && job.mode === "imq" && (!S || S.id !== job.id)) { S = { id: job.id, all: job.imeis.slice(0, 2000), chunk: Math.max(5, Math.min(100, job.chunk || 50)), i: 0, st: "nav", res: {}, tick: 0, pages: 0, sig: "" }; save(S); }
      if (!S) return out({ s: "err", msg: "No job" });
      if (S.done) return out(S.done);
      var fin = function (s, msg) { S.done = { s: s, mode: "imq", id: S.id, msg: msg, res: S.res, n: S.all.length }; save(S); return out(S.done); };
      if (job && job.stop) return fin("stopped", "Stopped — " + Object.keys(S.res).length + " IMEIs checked");
      // login page: the person logs in; nothing is filled here
      var pwd = null; docs().forEach(function (d) { if (!pwd) pwd = [].filter.call(d.querySelectorAll("input[type=password]"), vis)[0] || null; });
      if (pwd) return out({ s: "login" });
      S.tick++; save(S);
      var chunk = S.all.slice(S.i, S.i + S.chunk), pct = Math.round(S.i / S.all.length * 100), head = "Checking " + (S.i + 1) + "–" + (S.i + chunk.length) + " of " + S.all.length;
      if (!chunk.length) return fin("done", "Checked " + S.all.length + " IMEIs on the portal");

      if (S.st === "nav") {   // open "Registeration Imeis" (the screen with the imei box + Batch Search)
        var bs = find(/^batch\s*search$/i);
        if (bs) { S.st = "open"; save(S); }
        else {
          var m = find(/^regist(e)?ration\s*imeis?$/i), q = find(/^imeis?\s*query$/i);
          if (m && S.tick % 3 === 1) tap(m); else if (q && !m && S.tick % 3 === 1) tap(q);
          save(S); if (S.tick > 40) return fin("err", "Couldn't find Registeration Imeis — open it once, the app carries on"); return out({ s: "run", pct: pct, msg: "Opening Registeration Imeis…" });
        }
      }
      if (S.st === "open") { var b2 = find(/^batch\s*search$/i); if (!b2) { S.st = "nav"; save(S); return out({ s: "run", pct: pct, msg: "Opening Batch Search…" }); } tap(b2); S.st = "fill"; S.t0 = S.tick; save(S); return out({ s: "run", pct: pct, msg: head + " · Batch Search" }); }
      if (S.st === "fill") {
        var ta = null; docs().forEach(function (d) { if (!ta) ta = [].filter.call(d.querySelectorAll("textarea"), vis)[0] || null; });
        if (!ta) { if (S.tick - S.t0 > 6) { S.st = "open"; save(S); } return out({ s: "run", pct: pct, msg: head + " · waiting for the Batch Search box" }); }
        setv(ta, chunk.join(","));
        var dlg = ta.closest(".window,.panel,.dialog,.layui-layer,[role=dialog]") || ta.ownerDocument;
        var ok = [].filter.call(dlg.querySelectorAll("a,button,input[type=button],span.l-btn-text"), function (e) { return vis(e) && /^(ok|确定)$/i.test(txt(e)); })[0];
        if (ok) tap(ok.closest("a,button") || ok);
        S.st = "search"; S.t0 = S.tick; save(S); return out({ s: "run", pct: pct, msg: head + " · IMEIs pasted" });
      }
      if (S.st === "search") {
        if (S.tick - S.t0 < 1) return out({ s: "run", pct: pct, msg: head });
        var sb = find(/^search$/i); if (!sb) return out({ s: "run", pct: pct, msg: head + " · looking for Search" });
        tap(sb.closest("a,button") || sb); S.st = "read"; S.t0 = S.tick; S.pages = 0; S.sig = ""; save(S); return out({ s: "run", pct: pct, msg: head + " · searching" });
      }
      if (S.st === "read") {
        if (S.tick - S.t0 < 2 || busy()) { if (S.tick - S.t0 > 40) return fin("err", "The portal didn't answer the search"); return out({ s: "run", pct: pct, msg: head + " · waiting for results" }); }
        var R = grid(); Object.keys(R).forEach(function (k) { if (chunk.indexOf(k) >= 0 || S.all.indexOf(k) >= 0) S.res[k] = R[k]; });
        var nx = nextPage(), sig = pageSig();
        if (nx && sig !== S.sig && S.pages < 40 && Object.keys(R).length) { S.sig = sig; S.pages++; tap(nx); S.t0 = S.tick; save(S); return out({ s: "run", pct: pct, msg: head + " · page " + (S.pages + 1) }); }
        chunk.forEach(function (k) { if (!S.res[k]) S.res[k] = { found: false, act: "", model: "" }; });
        S.i += S.chunk; S.st = S.i < S.all.length ? "open" : "end"; save(S);
        if (S.st === "end") return fin("done", "Checked " + S.all.length + " IMEIs on the portal");
        return out({ s: "run", pct: Math.round(S.i / S.all.length * 100), msg: "Next batch…" });
      }
      return out({ s: "run", pct: pct, msg: head });
    } catch (e) { return out({ s: "err", msg: String(e && e.message || e) }); }
  };
})();
