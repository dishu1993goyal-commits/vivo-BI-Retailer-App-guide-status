/* vivo BI · vWork report reader (in-vwork.vivo.xyz), runs after the person has logged in themselves.
   It opens a report, chooses the whole organisation (ALL), sets the month and presses Query, then reads the state rows
   straight from the table — nothing is changed, saved, submitted or exported. Called about once a second:
   window.__biVwRun(job), job = { id, mode: "vw", rep: "visit", from: "2026-11-01", to: "2026-11-30", preset: "This month" | "Last month" | "" }.
   Returns JSON { s: login|you|run|done|err|stopped, msg, pct, rows: [[heading…], [state row…]…], diag } */
(function () {
  var W = window, D = document, KEY = "__bivw";
  var REPS = {
    app: { kind: "ana", saved: /^retailer app usability$/i, title: "Retailer App usability (Visit Details analysis)" },
    sd: { kind: "export", app: /^retailer support d/i, last: 1, file: /retailer issue feedback/i, title: "Retailer Support Desk" },
    comp: { kind: "export", app: /^competitor tracking$/i, menu: /^upload history$/i, col: /^creation time$/i, fields: [/^level i agent$/i, /^store code$/i, /^creation time$/i], names: "Level I agent, Store code, Creation time", file: /^upload record/i, title: "Competition upload records" },
    visit: { app: /^visit form$/i, menu: /^personnel visit$/i, dim: /^by area$/i, date: /date of visit/i, first: /^sales area$/i, firstAs: "State", title: "Staff visit report by area" }
  };
  // vWork opens apps inside frames: look in the page and in every same-site frame
  function docs() { var out = [D]; for (var i = 0; i < out.length && i < 20; i++) { [].forEach.call(out[i].querySelectorAll("iframe,frame"), function (f) { try { var d = f.contentDocument; if (d && d.body && out.indexOf(d) < 0) { var r = f.getBoundingClientRect(); if (r.width > 0 && r.height > 0) out.push(d); } } catch (x) { } }); } return out; }
  function qa(sel) { var a = []; docs().forEach(function (d) { try { a.push.apply(a, d.querySelectorAll(sel)); } catch (x) { } }); return a; }
  function allText() { return docs().map(function (d) { return d.body ? d.body.innerText : ""; }).join("\n"); }
  function vis(e) { try { var r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; var s = (e.ownerDocument.defaultView || W).getComputedStyle(e); return s.visibility !== "hidden" && s.display !== "none"; } catch (x) { return false; } }
  function txt(e) { return String((e && (e.innerText || e.textContent)) || "").replace(/\s+/g, " ").trim(); }
  function tap(e) { try { e.scrollIntoView({ block: "center" }); } catch (x) { } ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(function (t) { try { e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: e.ownerDocument.defaultView || W })); } catch (x) { } }); e.click(); }
  function findAll(re) { var a = [].filter.call(qa("a,span,div,li,button,p,td,label"), function (e) { var t = txt(e); return t.length <= 40 && re.test(t) && vis(e); }); return a.filter(function (e) { return !a.some(function (o) { return o !== e && e.contains(o); }); }); }
  function find(re, root, maxLen) { var best = null; [].forEach.call((root ? root.querySelectorAll.bind(root) : qa)("a,span,div,li,button,p,td,label,h1,h2,h3,h4"), function (e) { var t = txt(e); if (t.length <= (maxLen || 40) && re.test(t) && vis(e) && (!best || best.contains(e))) best = e; }); return best; }
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(S) { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }
  function out(o) { return JSON.stringify(o); }
  function setInput(el, v) { el.focus(); try { el.select(); } catch (e) { } var ok = false; try { ok = el.ownerDocument.execCommand("insertText", false, v); } catch (e) { } if (!ok || el.value !== v) { Object.getOwnPropertyDescriptor((el.ownerDocument.defaultView || W).HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } }
  function enter(el) { ["keydown", "keypress", "keyup"].forEach(function (t) { el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })); }); }
  function busy() { return [].some.call(qa(".ant-spin-spinning,.ant-table-loading,.el-loading-mask,.ant-spin-dot"), vis); }
  function diag(S) {
    var heads = [].filter.call(qa("th"), vis).map(txt).filter(Boolean).slice(0, 30);
    var top = [].filter.call(qa("header *,[class*=header] *"), function (e) { return vis(e) && !e.children.length && txt(e).length > 1 && txt(e).length < 50 && e.getBoundingClientRect().top < 90; }).map(txt).slice(0, 25);
    var ins = [].filter.call(qa("input"), vis).map(function (i) { return (i.placeholder || "") + "=" + i.value; }).slice(0, 12);
    return "step=" + S.st + " url=" + location.pathname + location.hash.slice(0, 60) + " | headings=" + heads.join("/") + " | top=" + top.join("/") + " | inputs=" + ins.join(", ");
  }
  // the organisation switch at the top right ("Rajasthan - Bubugao …" → ALL)
  function orgTrigger() {
    var c = [].filter.call(qa("div,span,a"), function (e) { var r = e.getBoundingClientRect(), t = txt(e); return vis(e) && r.top < 90 && r.left > innerWidth * 0.45 && t.length > 1 && t.length < 60 && !/homepage|frequently|vwork|v·work/i.test(t) && (/ - |^all$/i.test(t)) && !e.querySelector("input"); });
    c = c.filter(function (e) { return !c.some(function (o) { return o !== e && e.contains(o); }); });
    return c[0] || null;
  }
  // the visible table: headings + level-0 (top) rows
  function table(R) {
    var t = [].filter.call(qa("table"), function (x) { return vis(x) && x.querySelector("th"); }), heads = null, rows = [];
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
  function fre(R) { return new RegExp(R.file.source.replace(/^\^/, "") + "[\\s_]*(\\d{14})", "i"); }
  function ready() { var R = REPS[(load() || {}).rep] || {}; return R.kind === "export" ? (R.col ? [].some.call(qa("th"), function (e) { return vis(e) && R.col.test(txt(e)); }) : [].some.call(qa("button,a,span"), function (e) { return vis(e) && /^export\b.{0,3}$/i.test(txt(e)); })) : !!(find(R.dim) || find(R.date)); }
  function t14() { var d = new Date(Date.now() - 120000), p = function (n) { return ("0" + n).slice(-2); }; return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
  function pager() { var n = [].filter.call(qa(".ant-pagination-next,.el-pagination .btn-next,.btn-next"), vis)[0]; if (!n) return null; if (/disabled/.test(n.className) || n.getAttribute("aria-disabled") === "true" || n.disabled) return null; return n; }

  // ---- Retailer App logs: IT Operations → Visit Details → the saved analysis "Retailer app usability" (rows Job No. · Menu path · Visit Date, value COUNT).
  // For each slice of the month: set the Visit Date filter, Generate, then "Copy data" (the copied rows are caught here as vWork copies them) — the result shows at most 10,000 rows, so the month is read in slices.
  function addDays(d, n) { var x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.getFullYear() + "-" + ("0" + (x.getMonth() + 1)).slice(-2) + "-" + ("0" + x.getDate()).slice(-2); }
  function slices(a, b, n) { var o = []; for (var d = a; d <= b; d = addDays(d, n)) { var e = addDays(d, n - 1); o.push([d, e > b ? b : e]); } return o; }
  function hookCopy() {
    docs().forEach(function (d) { var w = d.defaultView; if (!w || w.__biCopyHook) return; w.__biCopyHook = 1;
      var keep = function (t) { if (t && String(t).length > 20) W.__biCopied = String(t); };
      try { if (w.navigator.clipboard) { var wt = w.navigator.clipboard.writeText; w.navigator.clipboard.writeText = function (t) { keep(t); try { return wt.call(w.navigator.clipboard, t); } catch (x) { return Promise.resolve(); } }; } } catch (x) { }
      try { var sd = w.DataTransfer.prototype.setData; w.DataTransfer.prototype.setData = function (f, t) { if (/text/.test(f)) keep(t); return sd.apply(this, arguments); }; } catch (x) { }
      try { var ex = d.execCommand; d.execCommand = function (c) { if (/copy/i.test(c)) { var a = d.activeElement; keep(a && "value" in a && a.value ? a.value : String(w.getSelection())); } return ex.apply(d, arguments); }; } catch (x) { }
      try { var co = w.URL.createObjectURL; w.URL.createObjectURL = function (b) { try { if (b && b.size > 100) W.__biBlob = b; } catch (x) { } return co.apply(w.URL, arguments); }; } catch (x) { }
    });
  }
  function parseCopy(t, S) {   // tab-separated: Job No. · Menu path · Visit Date · count
    var L = String(t).split(/\r?\n/).filter(function (x) { return x.trim(); }).map(function (x) { return x.split("\t"); });
    var hi = L.findIndex(function (r) { return r.some(function (c) { return /menu\s*path/i.test(c); }); }); if (hi < 0) return null;
    var H = L[hi].map(function (c) { return c.trim().toLowerCase(); }), ci = function (re) { return H.findIndex(function (h) { return re.test(h); }); };
    var cj = ci(/^job\s*no\.?$/), cm = ci(/menu\s*path/), cd = ci(/visit\s*date/), cn = H.findIndex(function (h, i) { return i !== cj && /job\s*no|count/.test(h); });
    if (cj < 0 || cm < 0 || cd < 0) return null;
    var fz = S.fz || (S.fz = []), out = [], bad = 0;
    L.slice(hi + 1).forEach(function (r) { var id = String(r[cj] || "").trim(), m = String(r[cm] || "").trim(), dd = String(r[cd] || "").trim().slice(0, 10).replace(/\//g, "-"), n = cn >= 0 ? parseFloat(r[cn]) : 1;
      if (!id || !m || !/^\d{4}-\d\d-\d\d$/.test(dd) || /^total/i.test(id)) return; if (dd < S.cur[0] || dd > S.cur[1]) { bad++; return; }
      var fi = fz.indexOf(m); if (fi < 0) { fi = fz.length; fz.push(m); } out.push(id + "|" + fi + "|" + dd + "|" + (isFinite(n) ? n : 1)); });
    return { rows: out, bad: bad };
  }
  function ana(S, R, fin, since, step) {
    if (!S.sl) { S.sl = [[S.from, S.to]]; S.si = 0; S.cz = ""; S.n = 0; S.cap = 10000; S.ast = "find"; save(S); }
    var outR = function (o) { save(S); return out(o); }, pct = function (a) { return Math.round(10 + 85 * (S.si + a) / S.sl.length); };
    var A = S.ast, sinceA = function () { return S.tick - (S.at0 || 0); }, go = function (st) { S.ast = st; S.at0 = S.tick; S.tries = 0; save(S); };
    var gen = [].filter.call(qa("button"), function (b) { return vis(b) && /generate/i.test(txt(b)); })[0];
    var chip = function () { var c = [].filter.call(qa("div,span"), function (e) { return vis(e) && /^visit date\s*:/i.test(txt(e)) && txt(e).length < 60; }); return c.filter(function (e) { return !c.some(function (o) { return o !== e && e.contains(o); }); })[0]; };
    if (A === "find") {   // the saved analysis open with Generate and the Visit Date filter
      if (gen && find(R.saved) && chip()) { go("lim"); return outR({ s: "run", pct: 8, msg: "Analysis open" }); }
      var sv = find(R.saved); if (sv && sinceA() % 6 === 1) tap(sv);
      var vd = find(/^visit details$/i); if (!sv && vd && sinceA() % 8 === 2) tap(vd);
      var it = find(/^it operations$/i); if (!sv && !vd && it && sinceA() % 8 === 3) tap(it);
      if (sinceA() > 25) return outR({ s: "you", msg: "Open IT Operations → Visit Details → your saved analysis “Retailer app usability” — the helper then reads the month" });
      return outR({ s: "run", pct: 4, msg: "Opening IT Operations → Visit Details…" });
    }
    if (A === "lim") {   // "Result display" (rows shown, 10000 by default): raise it as far as vWork allows, so the month comes in one go
      var lab = [].filter.call(qa("div,span,label"), function (e) { return vis(e) && !e.children.length && /^result$|^result\s*display$/i.test(txt(e)); })[0], li = null;
      if (lab) { var lr = lab.getBoundingClientRect(); li = [].filter.call(qa("input"), function (i) { var r = i.getBoundingClientRect(); return vis(i) && Math.abs(r.top + r.height / 2 - (lr.top + lr.height / 2)) < 30 && r.left > lr.left && r.left - lr.right < 160; })[0]; }
      if (!li) li = [].filter.call(qa("input"), function (i) { return vis(i) && /^\d{4,}$/.test(i.value) && +i.value >= 1000; })[0];
      if (!li) { S.cap = 10000; S.sl = slices(S.from, S.to, 4); go("date"); return outR({ s: "run", pct: 9, msg: "Result display not found — reading the month 4 days at a time" }); }
      var cv = parseInt(String(li.value).replace(/\D/g, "")) || 0;
      if (S.tries === 0) { S.tries = 1; save(S); setInput(li, "1000000"); enter(li); try { li.blur(); li.dispatchEvent(new Event("blur", { bubbles: true })); } catch (x) { } return outR({ s: "run", pct: 9, msg: "Raising Result display…" }); }
      if (sinceA() < 3) return outR({ s: "run", pct: 9, msg: "Raising Result display…" });
      S.cap = cv >= 10000 ? cv : 10000;
      if (S.cap < 60000) S.sl = slices(S.from, S.to, S.cap >= 30000 ? 10 : 4);
      go("date"); return outR({ s: "run", pct: 10, msg: "Result display: " + S.cap.toLocaleString() + " rows" + (S.sl.length > 1 ? " — reading the month in " + S.sl.length + " parts" : " — reading the whole month at once") });
    }
    var cur = S.sl[S.si]; S.cur = cur;
    var dlg = [].filter.call(qa("div"), function (e) { return vis(e) && /fixed time/i.test(txt(e)) && /select time/i.test(txt(e)) && e.getBoundingClientRect().width < innerWidth * 0.95; });
    dlg = dlg.filter(function (e) { return !dlg.some(function (o) { return o !== e && e.contains(o); }); })[0];
    if (A === "date") {
      if (dlg) { go("set"); return outR({ s: "run", pct: pct(0.1), msg: "Dates " + cur[0] + " → " + cur[1] + "…" }); }
      var c = chip(); if (!c) { if (sinceA() > 15) return fin("err", "Couldn't find the Visit Date filter of the analysis", { diag: diag(S) }); return outR({ s: "run", pct: pct(0), msg: "Looking for the Visit Date filter…" }); }
      if (sinceA() % 4 === 0) { tap(c); var ar = c.parentElement && [].filter.call(c.parentElement.querySelectorAll("[class*=arrow],[class*=icon],svg,i"), vis)[0]; if (sinceA() >= 8 && ar) tap(ar); }
      if (sinceA() > 4) { var fm = find(/^filter$/i); if (fm) tap(fm); }
      if (sinceA() > 24) return fin("err", "The Visit Date filter didn't open", { diag: diag(S) });
      return outR({ s: "run", pct: pct(0), msg: "Opening the Visit Date filter…" });
    }
    if (A === "set") {
      if (!dlg) { go("date"); return outR({ s: "run", pct: pct(0), msg: "Reopening the filter…" }); }
      var st = (txt(dlg).match(/select time\s*:?\s*(\d{4}-\d\d-\d\d)\s*(?:to|~|-)\s*(\d{4}-\d\d-\d\d)/i) || []);
      if (st[1] === cur[0] && st[2] === cur[1]) { var okb = [].filter.call(dlg.querySelectorAll("button"), function (b) { return vis(b) && /^(ok|confirm)$/i.test(txt(b)); })[0]; if (okb) { tap(okb); go("gen"); return outR({ s: "run", pct: pct(0.3), msg: "Dates set " + cur[0] + " → " + cur[1] }); } }
      S.tries++; save(S); if (S.tries > 20) return fin("err", "Couldn't set the dates " + cur[0] + " → " + cur[1] + " (shows " + (st[1] || "?") + " → " + (st[2] || "?") + ")", { diag: diag(S) });
      if (/dynamic/i.test(txt(dlg)) && S.tries === 1) { var fx = [].filter.call(dlg.querySelectorAll("div,span"), function (e) { return vis(e) && /^fixed time$/i.test(txt(e)); })[0]; if (fx) tap(fx); }
      var di = [].filter.call(dlg.querySelectorAll("input"), vis);
      if (di.length >= 2 && S.tries <= 2) { setInput(di[0], cur[0]); enter(di[0]); setInput(di[1], cur[1]); enter(di[1]); return outR({ s: "run", pct: pct(0.2), msg: "Typing the dates…" }); }
      // pick on the calendar: month panel "Nov 2026", start day then end day
      var MN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], want = MN[+cur[0].slice(5, 7) - 1] + " " + cur[0].slice(0, 4);
      var heads = [].filter.call(dlg.querySelectorAll("div,span,button"), function (e) { return vis(e) && !e.children.length && txt(e).toLowerCase() === want; });
      if (!heads.length) { var pv = [].filter.call(dlg.querySelectorAll("button,span,a,i"), function (e) { return vis(e) && (/prev/i.test(e.className) || /^[‹<]$/.test(txt(e))); })[0]; if (pv) tap(pv); return outR({ s: "run", pct: pct(0.2), msg: "Finding " + want + " on the calendar…" }); }
      var hb = heads[0].getBoundingClientRect(), panelCells = [].filter.call(dlg.querySelectorAll("td,div,span"), function (e) { var r = e.getBoundingClientRect(); return vis(e) && !e.children.length && /^\d{1,2}$/.test(txt(e)) && r.top >= hb.bottom - 2 && Math.abs(r.left + r.width / 2 - (hb.left + hb.width / 2)) < 260 && !/disabled|other|prev-month|next-month|not-current|out/i.test((e.className || "") + " " + ((e.parentElement || {}).className || "")); });
      var cellOf = function (d) { var n = +d.slice(8); return panelCells.filter(function (e) { return +txt(e) === n; }).sort(function (a, b) { return n > 20 ? b.getBoundingClientRect().top - a.getBoundingClientRect().top : a.getBoundingClientRect().top - b.getBoundingClientRect().top; })[0]; };
      var c0 = cellOf(cur[0]), c1 = cellOf(cur[1]); if (!c0 || !c1) return outR({ s: "run", pct: pct(0.2), msg: "Reading the calendar…" });
      tap(c0); tap(c1); return outR({ s: "run", pct: pct(0.25), msg: "Picking " + cur[0] + " → " + cur[1] + " on the calendar…" });
    }
    if (A === "gen") {
      if (dlg) { if (sinceA() > 6) go("set"); return outR({ s: "run", pct: pct(0.3), msg: "Closing the filter…" }); }
      if (!gen) return fin("err", "No Generate button", { diag: diag(S) });
      tap(gen); W.__biCopied = null; go("wait"); return outR({ s: "run", pct: pct(0.4), msg: "Generate " + cur[0] + " → " + cur[1] + "…" });
    }
    if (A === "wait") {
      if (sinceA() < 3 || busy() || [].some.call(qa("[class*=loading],[class*=spin]"), function (e) { return vis(e) && /spin|loading/.test(e.className) && !/spin-container|nested/.test(e.className) && e.getBoundingClientRect().width < 200; })) { if (sinceA() > 120) return fin("err", "vWork didn't finish generating", { diag: diag(S) }); return outR({ s: "run", pct: pct(0.5), msg: "vWork is generating " + cur[0] + " → " + cur[1] + "…" }); }
      hookCopy(); go("copy");
    }
    if (A === "copy") {
      if (W.__biCopied) {
        var P = parseCopy(W.__biCopied, S); W.__biCopied = null;
        if (!P) return fin("err", "Copy data gave an unexpected format", { diag: diag(S) });
        if (P.bad > P.rows.length && S.tries < 2) { S.tries++; go("gen"); return outR({ s: "run", pct: pct(0.6), msg: "Old result still showing — generating again…" }); }
        if (P.rows.length >= S.cap - 10 && cur[0] < cur[1]) {   // hit the Result display limit: read this slice in two halves
          var half = Math.floor((new Date(cur[1]) - new Date(cur[0])) / 864e5 / 2); S.sl.splice(S.si, 1, [cur[0], addDays(cur[0], half)], [addDays(cur[0], half + 1), cur[1]]); go("date");
          return outR({ s: "run", pct: pct(0.6), msg: "Over " + S.cap.toLocaleString() + " rows — reading " + cur[0] + " → " + cur[1] + " in two parts" });
        }
        if (P.rows.length >= S.cap - 10) return fin("err", "A single day has over " + S.cap.toLocaleString() + " rows — download it from vWork yourself", { diag: diag(S) });
        S.cz += (S.cz && P.rows.length ? ";" : "") + P.rows.join(";"); S.n += P.rows.length; S.got = (S.got || []).concat([[cur[0], cur[1], P.rows.length]]); S.si++;
        if (S.si >= S.sl.length) return fin("done", "Read " + S.n.toLocaleString() + " rows of Retailer App logs (" + S.sl.length + " parts)", { fz: S.fz, cz: S.cz, n: S.n, parts: S.got });
        go("date"); return outR({ s: "run", pct: pct(0), msg: "Part " + S.si + " of " + S.sl.length + " read (" + P.rows.length + " rows)" });
      }
      var cp = [].filter.call(qa("span,button,a,div"), function (e) { return vis(e) && /^copy data$/i.test(txt(e)); }); cp = cp.filter(function (e) { return !cp.some(function (o) { return o !== e && e.contains(o); }); })[0];
      if (!cp) { if (sinceA() > 15) return fin("err", "No “Copy data” button on the result", { diag: diag(S) }); return outR({ s: "run", pct: pct(0.7), msg: "Looking for Copy data…" }); }
      if (sinceA() % 5 === 0) { hookCopy(); tap(cp); }
      if (sinceA() > 22) return fin("err", "“Copy data” didn't give the rows — use Download data in vWork and drop the file into the tool", { diag: diag(S) });
      return outR({ s: "run", pct: pct(0.8), msg: "Copying the rows…" });
    }
    return outR({ s: "run", pct: 50, msg: "Working…" });
  }

  W.__biVwRun = function (job) {
    try {
      var S = load();
      if (job && job.mode === "vw" && (!S || S.id !== job.id)) { S = { id: job.id, rep: job.rep, from: job.from, to: job.to, preset: job.preset || "", st: "open", app: !!job.app, parts: job.parts || null, tick: 0, t0: 0, rows: [], seen: {}, heads: null, pages: 0, tries: 0 }; if (S.parts && S.parts.length) { S.from = S.parts[0][0]; S.to = S.parts[0][1]; } save(S); try { sessionStorage.removeItem(KEY + "u"); } catch (x) { } }
      if (!S) return out({ s: "err", msg: "No job" });
      if (S.done) return out(S.done);
      var R = REPS[S.rep]; if (!R) return out({ s: "err", msg: "Unknown report" });
      var fin = function (s, msg, extra) { S.done = Object.assign({ s: s, mode: "vw", id: S.id, rep: S.rep, msg: msg, from: S.from, to: S.to, rows: S.heads ? [S.heads].concat(S.rows) : [] }, extra || {}); save(S); return out(S.done); };
      if (job && job.stop) return fin("stopped", "Stopped");
      if ([].some.call(qa("input[type=password]"), vis)) return out({ s: "login" });
      S.tick++; save(S);
      var since = function () { return S.tick - S.t0; }, step = function (st) { S.st = st; S.t0 = S.tick; save(S); };
      if (S.tick > (R.kind === "ana" ? 1500 : 260)) return fin("err", "vWork took too long", { diag: diag(S) });
      if (R.kind === "ana") return ana(S, R, fin, since, step);

      if (S.st === "open") {   // Workbench → the report's app
        if (R.menu ? find(R.menu) : (S.appTapped && ready())) { step("menu"); return out({ s: "run", pct: 12, msg: "Report open" }); }
        if (S.appTapped && since() < 8) return out({ s: "run", pct: 8, msg: "Opening…" });
        var aa = findAll(R.app), a = R.last ? aa[aa.length - 1] : aa[0];
        if (a) { tap(a); S.appTapped = 1; if (R.menu) { step("menu"); } else { S.t0 = S.tick; save(S); }  return out({ s: "run", pct: 8, msg: "Opening " + txt(a) + "…" }); }
        var srch = [].filter.call(qa("input"), function (i) { return vis(i) && /search for an app/i.test(i.placeholder || ""); })[0];
        if (srch && since() > 2 && !S.typed) { setInput(srch, R.app.source.replace(/[\^$\\/i]/g, "").replace(/\(\?:?|\)/g, "")); S.typed = 1; save(S); }
        if (since() > 25) return fin("err", "Couldn't find the report app in vWork", { diag: diag(S) });
        return out({ s: "run", pct: 4, msg: "Looking for the report in vWork…" });
      }
      if (S.st === "menu") {
        var m = R.menu ? find(R.menu) : null; if (!R.menu) S.menuTapped = 1; if (m && (!S.menuTapped || since() % 8 === 7)) { tap(m); S.menuTapped = 1; save(S); }
        if (S.menuTapped && since() > 1 && ready()) { step("org"); return out({ s: "run", pct: 15, msg: "Report open" }); }
        if (since() > 20) { step("open"); }
        return out({ s: "run", pct: 12, msg: "Opening the report…" });
      }
      if (R.kind === "export" && S.st === "org") step(R.col ? "xdate" : "xwait");
      if (S.st === "xdate") {   // the date filter under the column heading (e.g. Creation time): Start time ~ End time
        var th = [].filter.call(qa("th,[class*=header-cell],[class*=cell]"), function (e) { return vis(e) && R.col.test(txt(e)); })[0];
        var rgs = [].filter.call(qa(".ant-picker-range,.el-date-editor--datetimerange,.el-date-editor--daterange,[class*=range-picker],[class*=picker-range]"), vis);
        if (!th || !rgs.length) { if (since() > 20) return fin("err", "Couldn't find the date filter", { diag: diag(S) }); return out({ s: "run", pct: 22, msg: "Looking for the date filter…" }); }
        var cx = th.getBoundingClientRect(), mid = cx.left + cx.width / 2;
        rgs.sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return Math.abs(ra.left + ra.width / 2 - mid) - Math.abs(rb.left + rb.width / 2 - mid); });
        var xi = [].filter.call(rgs[0].querySelectorAll("input"), vis);
        if (xi.length < 2) return out({ s: "run", pct: 22, msg: "Looking for the date filter…" });
        var tm = /\d:\d\d/.test(xi[0].value + xi[1].value + (xi[0].placeholder || "")) || S.tries % 2 === 1, f0 = S.from.replace(/-/g, "/") + (tm ? " 00:00:00" : ""), f1 = S.to.replace(/-/g, "/") + (tm ? " 23:59:59" : "");
        var dOk = function (v, d) { var q = v.replace(/[-.]/g, "/").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return q && q[1] + "-" + ("0" + q[2]).slice(-2) + "-" + ("0" + q[3]).slice(-2) === d; };
        if (dOk(xi[0].value, S.from) && dOk(xi[1].value, S.to)) {
          var okb = [].filter.call(qa(".ant-picker-ok button,.el-picker-panel__footer button,button"), function (b) { return vis(b) && /^(confirm|ok)$/i.test(txt(b)); })[0]; if (okb) { tap(okb); return out({ s: "run", pct: 28, msg: "Confirming the dates…" }); }
          D.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
          S.n0 = S.tick; step("xwait"); return out({ s: "run", pct: 30, msg: "Dates set: " + S.from + " → " + S.to });
        }
        S.tries++; save(S);
        if (S.tries > 12) return fin("err", "Couldn't set the dates (" + xi[0].value + " – " + xi[1].value + ")", { diag: diag(S) });
        tap(xi[0]); setInput(xi[0], f0); enter(xi[0]); setInput(xi[1], f1); enter(xi[1]);
        return out({ s: "run", pct: 26, msg: "Typing the dates…" });
      }
      if (S.st === "xwait") {   // the list reloads for the dates; note the total
        if (since() < 3 || busy()) { if (since() > 90) return fin("err", "vWork didn't load the list", { diag: diag(S) }); return out({ s: "run", pct: 34, msg: "Loading the list…" }); }
        var tot = (allText().match(/total\s*:?\s*([\d,]+)\s*(items|records|條|条)?/i) || [])[1]; S.total = tot ? +tot.replace(/,/g, "") : null;
        step("xmenu"); return out({ s: "run", pct: 40, msg: (S.total != null ? S.total.toLocaleString() + " rows" : "List loaded") + " — exporting…" });
      }
      if (S.st === "xmenu") {   // Export ▾ → Export all
        var all = [].filter.call(qa("li,[role=menuitem],span,div,a"), function (e) { return vis(e) && /^export all$/i.test(txt(e)) && !e.querySelector("li"); })[0];
        if (all) { tap(all.closest("li,[role=menuitem]") || all); if (!R.fields) { S.t14 = t14(); S.tries = 0; step("xpc"); return out({ s: "run", pct: 55, msg: "Export started — vWork is preparing the file…" }); } step("xfields"); return out({ s: "run", pct: 45, msg: "Export all…" }); }
        var xb = [].filter.call(qa("button,a,span,div"), function (e) { return vis(e) && /^export\b.{0,3}$/i.test(txt(e)) && e.getBoundingClientRect().top < innerHeight * 0.5; });
        xb = xb.filter(function (e) { return !xb.some(function (o) { return o !== e && e.contains(o); }); })[0];
        if (xb && since() % 3 === 0) { tap(xb); try { xb.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); xb.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); } catch (x) { } }
        if (since() > 20) return fin("err", "Couldn't open Export ▸ Export all", { diag: diag(S) });
        return out({ s: "run", pct: 42, msg: "Opening Export…" });
      }
      if (S.st === "xfields") {   // Export fields: tick only the needed columns, then Export
        var dlg = [].filter.call(qa(".ant-modal,.el-dialog,[role=dialog]"), function (e) { return vis(e) && /export fields/i.test(txt(e)); })[0];
        if (!dlg) { if (since() > 15) return fin("err", "The Export fields window didn't open", { diag: diag(S) }); return out({ s: "run", pct: 46, msg: "Waiting for Export fields…" }); }
        var cbs = [].filter.call(dlg.querySelectorAll("label,.ant-checkbox-wrapper,.el-checkbox"), function (e) { return vis(e) && e.querySelector("input[type=checkbox],.ant-checkbox,.el-checkbox__input"); });
        cbs = cbs.filter(function (e) { return !cbs.some(function (o) { return o !== e && o.contains(e); }); });
        var isOn = function (e) { var i = e.querySelector("input[type=checkbox]"); return /checked/.test(e.className + " " + ((e.querySelector(".ant-checkbox,.el-checkbox__input") || {}).className || "")) || !!(i && i.checked); };
        var want = function (e) { var t = txt(e); return R.fields.some(function (re) { return re.test(t); }); }, wrong = cbs.filter(function (e) { return isOn(e) !== want(e); });
        if (wrong.length) { if (S.tries++ > 6) return fin("err", "Couldn't tick the export fields", { diag: diag(S) }); save(S); wrong.forEach(function (e) { tap(e.querySelector(".ant-checkbox-input,input[type=checkbox]") || e); }); return out({ s: "run", pct: 48, msg: "Choosing the columns: " + R.names }); }
        if (cbs.filter(want).length < R.fields.length) return fin("err", "Some columns are missing in Export fields", { diag: diag(S) });
        var go = [].filter.call(dlg.querySelectorAll("button"), function (b) { return vis(b) && /^export$/i.test(txt(b)); })[0];
        if (!go) return out({ s: "run", pct: 50, msg: "Looking for the Export button…" });
        S.t14 = t14();
        tap(go); S.tries = 0; step("xpc"); return out({ s: "run", pct: 55, msg: "Export started — vWork is preparing the file…" });
      }
      if (S.st === "xpc") {   // vWork's Process center lists the export; open it
        var pcOpen = [].some.call(qa("div,span,h1,h2,h3,h4"), function (e) { return vis(e) && /^process cent(er|re)$/i.test(txt(e)) && e.getBoundingClientRect().top < 140; });
        if (pcOpen) { step("xdl"); return out({ s: "run", pct: 62, msg: "Process center open" }); }
        if (since() < 2) return out({ s: "run", pct: 58, msg: "Export started…" });
        var lk = [].filter.call(qa("a,span,button,div"), function (e) { return vis(e) && /process cent(er|re)|download cent(er|re)/i.test(txt(e)) && txt(e).length < 60 && !e.querySelector("a,button"); })[0]
          || [].filter.call(qa("[title],[aria-label]"), function (e) { return vis(e) && /process|download|task|export/i.test(e.getAttribute("title") + " " + e.getAttribute("aria-label")) && e.getBoundingClientRect().top < 90; })[0]
          || [].filter.call(qa("[class*=cloud],[class*=download],[class*=process],[class*=task-center],[class*=taskCenter]"), function (e) { var r = e.getBoundingClientRect(); return vis(e) && r.top < 90 && r.left > innerWidth * 0.4; })[0];
        if (lk && since() % 4 === 2) tap(lk);
        if (since() > 12) return out({ s: "you", msg: "Tap the Process center icon (top right of vWork) — the helper then downloads the file" });
        return out({ s: "run", pct: 60, msg: "Opening the Process center…" });
      }
      if (S.st === "xdl") {   // the newest "Upload record_<time>.xlsx" made after our Export → Download
        if (!S.clicked) { docs().forEach(function (d) { try { var w = d.defaultView; if (w.__biHooked) return; w.__biHooked = 1; var o0 = w.open; w.open = function (u) { try { sessionStorage.setItem(KEY + "u", new URL(String(u), d.baseURI).href); } catch (x) { } return o0.apply(w, arguments); }; d.addEventListener("click", function (ev) { var a = ev.target && ev.target.closest && ev.target.closest("a[href]"); if (a && /^https:/.test(a.href)) try { sessionStorage.setItem(KEY + "u", a.href); } catch (x) { } }, true); } catch (x) { } }); }
        if (S.clicked) {
          var cu = null; try { cu = sessionStorage.getItem(KEY + "u"); } catch (x) { }
          if (cu && /^https:/.test(cu) && S.app) return out({ s: "grab", url: cu, fname: S.fname || "" });
          if (!(S.app) && since() > 3) return fin("done", "Downloaded " + (S.fname || "the file") + " — drop it into the vivo BI tool", { file: "browser", fname: S.fname, total: S.total });
          if (since() > 90) return fin("err", "The download didn't start — tap Download yourself and drop the file into the tool", { diag: diag(S) });
          return out({ s: "run", pct: 85, msg: "Downloading…" });
        }
        var items = [].filter.call(qa("li,div,tr"), function (e) { return vis(e) && fre(R).test(txt(e)) && txt(e).length < 300; });
        items = items.filter(function (e) { return !items.some(function (o) { return o !== e && e.contains(o); }); });
        var best = null, bt = "";
        items.forEach(function (e) { var m = txt(e).match(fre(R)); if (m && m[1] >= S.t14 && m[1] > bt) { bt = m[1]; best = e; } });
        if (!best) { if (since() > 150) return fin("err", "No new export in the Process center", { diag: diag(S) }); if (since() % 10 === 9) { var rf = [].filter.call(qa("button,span,a"), function (e) { return vis(e) && /^(refresh|search)$/i.test(txt(e)); })[0]; if (rf) tap(rf); } return out({ s: "run", pct: 70, msg: "vWork is preparing the file…" }); }
        var dl = [].filter.call(best.querySelectorAll("button,a,span"), function (e) { return vis(e) && /^download$/i.test(txt(e)); })[0];
        if (!dl) return out({ s: "run", pct: 75, msg: "Waiting for vWork to finish the file…" });
        S.fname = (txt(best).match(new RegExp(R.file.source.replace(/^\^/, "") + "[\\s_]*\\d{14}\\.\\w+", "i")) || [""])[0]; S.clicked = 1; S.t0 = S.tick; save(S); tap(dl);
        return out({ s: "run", pct: 80, msg: "Download…" });
      }
      if (S.st === "org") {   // whole organisation, not one distributor
        var o = orgTrigger();
        if (!o || /^all$/i.test(txt(o))) { step("dim"); return out({ s: "run", pct: 22, msg: "Organisation: ALL" }); }
        var allOpt = [].filter.call(qa("li,div,span,a"), function (e) { return vis(e) && /^all$/i.test(txt(e)) && !e.children.length && e.getBoundingClientRect().top > 60; })[0];
        if (allOpt) { tap(allOpt.closest("li,[role=option],[class*=item]") || allOpt); S.orgDone = 1; step("orgwait"); return out({ s: "run", pct: 20, msg: "Choosing ALL…" }); }
        if (!S.orgOpen || since() % 5 === 4) { tap(o); S.orgOpen = 1; save(S); }
        if (since() > 20) { step("dim"); return out({ s: "run", pct: 22, msg: "Couldn't switch to ALL — continuing" }); }
        return out({ s: "run", pct: 18, msg: "Opening the organisation list…" });
      }
      if (S.st === "orgwait") { if (since() > 4 || (find(R.date) && !busy())) step(find(R.date) ? "dim" : "open"); return out({ s: "run", pct: 24, msg: "Loading for ALL…" }); }
      if (S.st === "dim") { step("date"); }
      if (S.st === "date") {   // the month: a preset (This month / Last month) or typed dates
        var lab = find(R.date), box = lab ? (lab.closest(".ant-form-item,.el-form-item,[class*=item]") || lab.parentElement) : null;
        var ins = box ? [].filter.call(box.querySelectorAll("input"), vis) : []; if (ins.length < 2) ins = [].filter.call(qa(".ant-picker-range input,.el-range-input"), vis);
        if (ins.length < 2) { if (since() > 15) return fin("err", "Couldn't find the date boxes", { diag: diag(S) }); return out({ s: "run", pct: 28, msg: "Looking for the date of visit…" }); }
        var fmt = function (d, pad) { var p = d.split("-"); return pad ? p[0] + "/" + p[1] + "/" + p[2] : p[0] + "/" + (+p[1]) + "/" + (+p[2]); }, pad = /\/0\d/.test(ins[0].value);
        var want0 = fmt(S.from, pad), want1 = fmt(S.to, pad), same = function () { return (ins[0].value === want0 || ins[0].value === fmt(S.from, !pad)) && (ins[1].value === want1 || ins[1].value === fmt(S.to, !pad)); };
        if (same()) { var esc0 = D.activeElement; if (esc0 && esc0.blur) esc0.blur(); D.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true })); step("query"); return out({ s: "run", pct: 35, msg: "Dates set: " + want0 + " – " + want1 }); }
        S.tries++; save(S);
        if (S.preset && S.tries <= 3) {   // open the picker and tap the preset
          if (S.tries === 1) tap(ins[0]);
          var pr = [].filter.call(qa("li,span,div,a"), function (e) { return vis(e) && !e.children.length && txt(e).toLowerCase() === S.preset.toLowerCase(); })[0];
          if (pr) tap(pr);
          return out({ s: "run", pct: 30, msg: "Choosing “" + S.preset + "”…" });
        }
        if (S.tries > 10) return fin("err", "Couldn't set the dates (" + ins[0].value + " – " + ins[1].value + ")", { diag: diag(S) });
        tap(ins[0]); setInput(ins[0], S.tries % 2 ? want0 : fmt(S.from, !pad)); enter(ins[0]);
        setInput(ins[1], S.tries % 2 ? want1 : fmt(S.to, !pad)); enter(ins[1]);
        return out({ s: "run", pct: 30, msg: "Typing the dates…" });
      }
      if (S.st === "query") {
        var q = [].filter.call(qa("button"), function (b) { return vis(b) && /^query$/i.test(txt(b)); })[0];
        if (!q) { if (since() > 10) return fin("err", "No Query button", { diag: diag(S) }); return out({ s: "run", pct: 38, msg: "Looking for Query…" }); }
        tap(q); step("read"); return out({ s: "run", pct: 45, msg: "Query…" });
      }
      if (S.st === "read") {
        if (since() < 3 || busy()) { if (since() > 60) return fin("err", "vWork didn't answer the query", { diag: diag(S) }); return out({ s: "run", pct: 55, msg: "Waiting for the results…" }); }
        var T = table(R); if (!T || !T.rows.length) { if (since() > 20) return fin("err", "No rows in the report for these dates", { diag: diag(S) }); return out({ s: "run", pct: 60, msg: "Reading the table…" }); }
        var H = T.heads.slice(T.fi); H[0] = R.firstAs; S.heads = H;
        T.rows.forEach(function (r) { var row = r.slice(T.fi); row[0] = row[0].replace(/^[^A-Za-z0-9(]+/, "").trim(); var k = row[0]; if (!S.seen[k]) { S.seen[k] = 1; S.rows.push(row); } });
        var nx = pager(); if (nx && S.pages < 20) { tap(nx); S.pages++; S.t0 = S.tick; save(S); return out({ s: "run", pct: 70, msg: "Page " + (S.pages + 1) + "…" }); }
        if (S.parts && S.parts.length) {   // several months: one report each, same screen, new dates
          S.res = (S.res || []).concat([{ from: S.from, to: S.to, rows: [S.heads].concat(S.rows) }]); S.pi = (S.pi || 0) + 1;
          if (S.pi < S.parts.length) { S.from = S.parts[S.pi][0]; S.to = S.parts[S.pi][1]; S.rows = []; S.seen = {}; S.heads = null; S.pages = 0; S.tries = 0; step("date"); return out({ s: "run", pct: 50, msg: "Month " + S.pi + " of " + S.parts.length + " read — next " + S.from + " → " + S.to }); }
          return fin("done", "Read " + S.res.length + " months of " + R.title, { parts: S.res, from: S.parts[0][0], to: S.parts[S.parts.length - 1][1] });
        }
        return fin("done", "Read " + S.rows.length + " rows of " + R.title);
      }
      return out({ s: "run", pct: 50, msg: "Working…" });
    } catch (e) { return out({ s: "err", msg: String(e && e.message || e) }); }
  };
})();
