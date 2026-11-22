/* vivo BI · vWork report reader (in-vwork.vivo.xyz), runs after the person has logged in themselves.
   It opens a report, chooses the whole organisation (ALL), sets the month and presses Query, then reads the state rows
   straight from the table — nothing is changed, saved, submitted or exported. Called about once a second:
   window.__biVwRun(job), job = { id, mode: "vw", rep: "visit", from: "2026-11-01", to: "2026-11-30", preset: "This month" | "Last month" | "" }.
   Returns JSON { s: login|you|run|done|err|stopped, msg, pct, rows: [[heading…], [state row…]…], diag } */
(function () {
  var W = window, D = document, KEY = "__bivw";
  var REPS = {
    visit: { app: /^visit form$/i, menu: /^personnel visit$/i, dim: /^by area$/i, date: /date of visit/i, first: /^sales area$/i, firstAs: "State", title: "Staff visit report by area" }
  };
  function vis(e) { try { var r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; var s = getComputedStyle(e); return s.visibility !== "hidden" && s.display !== "none"; } catch (x) { return false; } }
  function txt(e) { return String((e && (e.innerText || e.textContent)) || "").replace(/\s+/g, " ").trim(); }
  function tap(e) { try { e.scrollIntoView({ block: "center" }); } catch (x) { } ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(function (t) { try { e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: W })); } catch (x) { } }); e.click(); }
  function find(re, root, maxLen) { var best = null; [].forEach.call((root || D).querySelectorAll("a,span,div,li,button,p,td,label,h1,h2,h3,h4"), function (e) { var t = txt(e); if (t.length <= (maxLen || 40) && re.test(t) && vis(e) && (!best || best.contains(e))) best = e; }); return best; }
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(S) { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }
  function out(o) { return JSON.stringify(o); }
  function setInput(el, v) { el.focus(); try { el.select(); } catch (e) { } var ok = false; try { ok = D.execCommand("insertText", false, v); } catch (e) { } if (!ok || el.value !== v) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } }
  function enter(el) { ["keydown", "keypress", "keyup"].forEach(function (t) { el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })); }); }
  function busy() { return [].some.call(D.querySelectorAll(".ant-spin-spinning,.ant-table-loading,.el-loading-mask,.ant-spin-dot"), vis); }
  function diag(S) {
    var heads = [].filter.call(D.querySelectorAll("th"), vis).map(txt).filter(Boolean).slice(0, 30);
    var top = [].filter.call(D.querySelectorAll("header *,[class*=header] *"), function (e) { return vis(e) && !e.children.length && txt(e).length > 1 && txt(e).length < 50 && e.getBoundingClientRect().top < 90; }).map(txt).slice(0, 25);
    var ins = [].filter.call(D.querySelectorAll("input"), vis).map(function (i) { return (i.placeholder || "") + "=" + i.value; }).slice(0, 12);
    return "step=" + S.st + " url=" + location.pathname + location.hash.slice(0, 60) + " | headings=" + heads.join("/") + " | top=" + top.join("/") + " | inputs=" + ins.join(", ");
  }
  // the organisation switch at the top right ("Rajasthan - Bubugao …" → ALL)
  function orgTrigger() {
    var c = [].filter.call(D.querySelectorAll("div,span,a"), function (e) { var r = e.getBoundingClientRect(), t = txt(e); return vis(e) && r.top < 90 && r.left > innerWidth * 0.45 && t.length > 1 && t.length < 60 && !/homepage|frequently|vwork|v·work/i.test(t) && (/ - |^all$/i.test(t)) && !e.querySelector("input"); });
    c = c.filter(function (e) { return !c.some(function (o) { return o !== e && e.contains(o); }); });
    return c[0] || null;
  }
  // the visible table: headings + level-0 (top) rows
  function table(R) {
    var t = [].filter.call(D.querySelectorAll("table"), function (x) { return vis(x) && x.querySelector("th"); }), heads = null, rows = [];
    t.forEach(function (x) { var th = [].map.call(x.querySelectorAll("thead th"), txt); if (th.some(function (h) { return R.first.test(h); })) heads = th; });
    if (!heads) return null;
    var fi = heads.findIndex(function (h) { return R.first.test(h); });
    t.forEach(function (x) {
      [].forEach.call(x.querySelectorAll("tbody tr"), function (tr) {
        if (/ant-table-row-level-[1-9]/.test(tr.className) || /measure|placeholder|expanded-row/.test(tr.className)) return;
        var td = [].map.call(tr.children, txt); if (td.length < heads.length - 1 || !td[fi]) return; rows.push(td);
      });
    });
    return { heads: heads, fi: fi, rows: rows };
  }
  function pager() { var n = [].filter.call(D.querySelectorAll(".ant-pagination-next,.el-pagination .btn-next,.btn-next"), vis)[0]; if (!n) return null; if (/disabled/.test(n.className) || n.getAttribute("aria-disabled") === "true" || n.disabled) return null; return n; }

  W.__biVwRun = function (job) {
    try {
      var S = load();
      if (job && job.mode === "vw" && (!S || S.id !== job.id)) { S = { id: job.id, rep: job.rep, from: job.from, to: job.to, preset: job.preset || "", st: "open", tick: 0, t0: 0, rows: [], seen: {}, heads: null, pages: 0, tries: 0 }; save(S); }
      if (!S) return out({ s: "err", msg: "No job" });
      if (S.done) return out(S.done);
      var R = REPS[S.rep]; if (!R) return out({ s: "err", msg: "Unknown report" });
      var fin = function (s, msg, extra) { S.done = Object.assign({ s: s, mode: "vw", id: S.id, rep: S.rep, msg: msg, from: S.from, to: S.to, rows: S.heads ? [S.heads].concat(S.rows) : [] }, extra || {}); save(S); return out(S.done); };
      if (job && job.stop) return fin("stopped", "Stopped");
      if ([].some.call(D.querySelectorAll("input[type=password]"), vis)) return out({ s: "login" });
      S.tick++; save(S);
      var since = function () { return S.tick - S.t0; }, step = function (st) { S.st = st; S.t0 = S.tick; save(S); };
      if (S.tick > 260) return fin("err", "vWork took too long", { diag: diag(S) });

      if (S.st === "open") {   // Workbench → the report's app
        if (find(R.menu) && (find(R.dim) || find(R.date))) { step("org"); return out({ s: "run", pct: 15, msg: "Report open" }); }
        var a = find(R.app);
        if (a) { tap(a); step("menu"); return out({ s: "run", pct: 8, msg: "Opening " + txt(a) + "…" }); }
        var srch = [].filter.call(D.querySelectorAll("input"), function (i) { return vis(i) && /search for an app/i.test(i.placeholder || ""); })[0];
        if (srch && since() > 2 && !S.typed) { setInput(srch, R.app.source.replace(/[\^$\\/i]/g, "").replace(/\(\?:?|\)/g, "")); S.typed = 1; save(S); }
        if (since() > 25) return fin("err", "Couldn't find the report app in vWork", { diag: diag(S) });
        return out({ s: "run", pct: 4, msg: "Looking for the report in vWork…" });
      }
      if (S.st === "menu") {
        var m = find(R.menu); if (m && !S.menuTapped) { tap(m); S.menuTapped = 1; }
        if (find(R.date) || find(R.dim)) { step("org"); return out({ s: "run", pct: 15, msg: "Report open" }); }
        if (since() > 20) { step("open"); }
        return out({ s: "run", pct: 12, msg: "Opening the report…" });
      }
      if (S.st === "org") {   // whole organisation, not one distributor
        var o = orgTrigger();
        if (!o || /^all$/i.test(txt(o))) { step("dim"); return out({ s: "run", pct: 22, msg: "Organisation: ALL" }); }
        var allOpt = [].filter.call(D.querySelectorAll("li,div,span,a"), function (e) { return vis(e) && /^all$/i.test(txt(e)) && !e.children.length && e.getBoundingClientRect().top > 60; })[0];
        if (allOpt) { tap(allOpt.closest("li,[role=option],[class*=item]") || allOpt); S.orgDone = 1; step("orgwait"); return out({ s: "run", pct: 20, msg: "Choosing ALL…" }); }
        if (!S.orgOpen || since() % 5 === 4) { tap(o); S.orgOpen = 1; save(S); }
        if (since() > 20) { step("dim"); return out({ s: "run", pct: 22, msg: "Couldn't switch to ALL — continuing" }); }
        return out({ s: "run", pct: 18, msg: "Opening the organisation list…" });
      }
      if (S.st === "orgwait") { if (since() > 4 || (find(R.date) && !busy())) step(find(R.date) ? "dim" : "open"); return out({ s: "run", pct: 24, msg: "Loading for ALL…" }); }
      if (S.st === "dim") { step("date"); }
      if (S.st === "date") {   // the month: a preset (This month / Last month) or typed dates
        var lab = find(R.date), box = lab ? (lab.closest(".ant-form-item,.el-form-item,[class*=item]") || lab.parentElement) : null;
        var ins = box ? [].filter.call(box.querySelectorAll("input"), vis) : []; if (ins.length < 2) ins = [].filter.call(D.querySelectorAll(".ant-picker-range input,.el-range-input"), vis);
        if (ins.length < 2) { if (since() > 15) return fin("err", "Couldn't find the date boxes", { diag: diag(S) }); return out({ s: "run", pct: 28, msg: "Looking for the date of visit…" }); }
        var fmt = function (d, pad) { var p = d.split("-"); return pad ? p[0] + "/" + p[1] + "/" + p[2] : p[0] + "/" + (+p[1]) + "/" + (+p[2]); }, pad = /\/0\d/.test(ins[0].value);
        var want0 = fmt(S.from, pad), want1 = fmt(S.to, pad), same = function () { return (ins[0].value === want0 || ins[0].value === fmt(S.from, !pad)) && (ins[1].value === want1 || ins[1].value === fmt(S.to, !pad)); };
        if (same()) { var esc0 = D.activeElement; if (esc0 && esc0.blur) esc0.blur(); D.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true })); step("query"); return out({ s: "run", pct: 35, msg: "Dates set: " + want0 + " – " + want1 }); }
        S.tries++; save(S);
        if (S.preset && S.tries <= 3) {   // open the picker and tap the preset
          if (S.tries === 1) tap(ins[0]);
          var pr = [].filter.call(D.querySelectorAll("li,span,div,a"), function (e) { return vis(e) && !e.children.length && txt(e).toLowerCase() === S.preset.toLowerCase(); })[0];
          if (pr) tap(pr);
          return out({ s: "run", pct: 30, msg: "Choosing “" + S.preset + "”…" });
        }
        if (S.tries > 10) return fin("err", "Couldn't set the dates (" + ins[0].value + " – " + ins[1].value + ")", { diag: diag(S) });
        tap(ins[0]); setInput(ins[0], S.tries % 2 ? want0 : fmt(S.from, !pad)); enter(ins[0]);
        setInput(ins[1], S.tries % 2 ? want1 : fmt(S.to, !pad)); enter(ins[1]);
        return out({ s: "run", pct: 30, msg: "Typing the dates…" });
      }
      if (S.st === "query") {
        var q = [].filter.call(D.querySelectorAll("button"), function (b) { return vis(b) && /^query$/i.test(txt(b)); })[0];
        if (!q) { if (since() > 10) return fin("err", "No Query button", { diag: diag(S) }); return out({ s: "run", pct: 38, msg: "Looking for Query…" }); }
        tap(q); step("read"); return out({ s: "run", pct: 45, msg: "Query…" });
      }
      if (S.st === "read") {
        if (since() < 3 || busy()) { if (since() > 60) return fin("err", "vWork didn't answer the query", { diag: diag(S) }); return out({ s: "run", pct: 55, msg: "Waiting for the results…" }); }
        var T = table(R); if (!T || !T.rows.length) { if (since() > 20) return fin("err", "No rows in the report for these dates", { diag: diag(S) }); return out({ s: "run", pct: 60, msg: "Reading the table…" }); }
        var H = T.heads.slice(T.fi); H[0] = R.firstAs; S.heads = H;
        T.rows.forEach(function (r) { var row = r.slice(T.fi); row[0] = row[0].replace(/^[^A-Za-z0-9(]+/, "").trim(); var k = row[0]; if (!S.seen[k]) { S.seen[k] = 1; S.rows.push(row); } });
        var nx = pager(); if (nx && S.pages < 20) { tap(nx); S.pages++; S.t0 = S.tick; save(S); return out({ s: "run", pct: 70, msg: "Page " + (S.pages + 1) + "…" }); }
        return fin("done", "Read " + S.rows.length + " rows of " + R.title);
      }
      return out({ s: "run", pct: 50, msg: "Working…" });
    } catch (e) { return out({ s: "err", msg: String(e && e.message || e) }); }
  };
})();
