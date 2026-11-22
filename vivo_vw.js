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
    comp: { kind: "export", app: /^competitor tracking$/i, menu: /^upload (history|records?)$/i, col: /^creation time\b/i, fields: [/^level i agent$/i, /^store code$/i, /^creation time$/i], names: "Level I agent, Store code, Creation time", file: /^upload record/i, title: "Competition upload records" },
    visit: { app: /^visit form$/i, menu: /^personnel visit( report)?$/i, dim: /^by area$/i, date: /date of visit/i, first: /^sales area$/i, firstAs: "State", title: "Staff visit report by area" }
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
  var WN = "__bivw:";
  function load() {
    var a = null, b = null; try { a = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { }
    try { if (String(W.name).indexOf(WN) === 0) b = JSON.parse(W.name.slice(WN.length)); } catch (e) { }
    return a && b ? ((b.sv || 0) > (a.sv || 0) ? b : a) : a || b;
  }
  function save(S) { if (!S) return; S.sv = Date.now(); var j = JSON.stringify(S); try { sessionStorage.setItem(KEY, j); } catch (e) { } try { W.name = WN + j; } catch (e) { } }
  // the report itself sits in a window from another vivo site (itbi-in / vform-in…) that this page can't read: open that window on its own
  function foreignFrame() {
    var best = null, ba = 0;
    [].forEach.call(D.querySelectorAll("iframe,frame"), function (f) { var ok = false; try { ok = !!f.contentDocument; } catch (x) { } if (ok || !vis(f)) return; var src = String(f.src || ""); if (!/^https:\/\/([a-z0-9-]+\.)*vivo\.(xyz|com|in)\//i.test(src) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(src)) return; var r = f.getBoundingClientRect(), ar = r.width * r.height; if (ar > ba && ar > innerWidth * innerHeight * 0.2) { ba = ar; best = src; } });
    return best;
  }
  function hop(S, url, why) { S.hops = (S.hops || 0) + 1; save(S); if (S.hops > 6) return false; setTimeout(function () { location.href = url; }, 50); return true; }
  function out(o) { return JSON.stringify(o); }
  function setInput(el, v) { el.focus(); try { el.select(); } catch (e) { } var ok = false; try { ok = el.ownerDocument.execCommand("insertText", false, v); } catch (e) { } if (!ok || el.value !== v) { Object.getOwnPropertyDescriptor((el.ownerDocument.defaultView || W).HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } }
  function enter(el) { ["keydown", "keypress", "keyup"].forEach(function (t) { el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })); }); }
  function busy() { return [].some.call(qa(".ant-spin-spinning,.ant-table-loading,.el-loading-mask,.ant-spin-dot"), vis); }
  function diag(S) {
    var heads = [].filter.call(qa("th"), vis).map(txt).filter(Boolean).slice(0, 30);
    var top = [].filter.call(qa("header *,[class*=header] *"), function (e) { return vis(e) && !e.children.length && txt(e).length > 1 && txt(e).length < 50 && e.getBoundingClientRect().top < 90; }).map(txt).slice(0, 25);
    var ins = [].filter.call(qa("input"), vis).map(function (i) { return (i.placeholder || "") + "=" + i.value; }).slice(0, 12);
    var fr = [].slice.call(D.querySelectorAll("iframe,frame")), blocked = fr.filter(function (f) { try { return !f.contentDocument; } catch (x) { return true; } }).length;
    return "step=" + S.st + "/" + (S.ast || "") + " frames=" + fr.length + (blocked ? " (" + blocked + " not readable: " + fr.map(function (f) { return String(f.src).slice(0, 60); }).join(" ; ") + ")" : "") + " url=" + location.pathname + location.hash.slice(0, 60) + " | headings=" + heads.join("/") + " | top=" + top.join("/") + " | inputs=" + ins.join(", ");
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
  function ready() { var R = REPS[(load() || {}).rep] || {}; return R.kind === "export" ? (R.col ? [].some.call(qa("th,[class*=header] *,[class*=title]"), function (e) { return vis(e) && R.col.test(txt(e)); }) : [].some.call(qa("button,a,span"), function (e) { return vis(e) && /^export\b.{0,3}$/i.test(txt(e)); })) : !!(find(R.dim) || find(R.date)); }
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
  // ---- Data exploration canvas (IT Operations → Visit Details → 🔍 Data exploration): drag fields, set filters
  function leaf(re, root) { var a = [].filter.call(root ? root.querySelectorAll("*") : qa("*"), function (e) { if (!vis(e)) return false; var t = txt(e); return t.length < 60 && re.test(t) && ![].some.call(e.children, function (c) { return re.test(txt(c)); }); }); return a; }
  function zone(name) {   // Row / Column / Value / Result Filter → { el, chips[], x, y } (where to drop)
    var lab = leaf(name === "filter" ? /^result filter$/i : new RegExp("^" + name + "$", "i"))[0]; if (!lab) return null;
    var lr = lab.getBoundingClientRect(), el = lab, r;
    for (var i = 0; i < 6 && el.parentElement; i++) { el = el.parentElement; r = el.getBoundingClientRect(); if (name === "filter" ? r.height >= 70 : r.width >= 300) break; }
    r = el.getBoundingClientRect();
    var chips = [].filter.call(el.querySelectorAll("*"), function (e) { var t = txt(e); return vis(e) && e !== lab && !e.contains(lab) && t && t.length < 600 && !/please drag|drag item|^row$|^column$|^value$|^result filter$/i.test(t) && e.children.length <= 6 && e.getBoundingClientRect().height < 400 && e.getBoundingClientRect().width > 40; });
    chips = chips.filter(function (e) { var inn = chips.filter(function (o) { return o !== e && e.contains(o); }); return !inn.length || (inn.length < 2 && !inn.some(function (o) { return txt(o).length >= txt(e).length * 0.6; })); });
    chips = chips.filter(function (e) { return !chips.some(function (o) { return o !== e && o.contains(e); }); });
    var x = name === "filter" ? r.left + r.width / 2 : Math.min(r.right - 40, Math.max(lr.right + 80, chips.length ? chips[chips.length - 1].getBoundingClientRect().right + 60 : lr.right + 80)), y = name === "filter" ? r.top + Math.min(r.height / 2, 40) : r.top + r.height / 2;
    return { el: el, chips: chips, x: x, y: y, doc: el.ownerDocument };
  }
  function hasChip(z, re) { return z && z.chips.some(function (c) { return re.test(txt(c)); }); }
  function fire(el, type, x, y, dt) {
    var w = el.ownerDocument.defaultView || W, o = { bubbles: true, cancelable: true, view: w, clientX: x, clientY: y, screenX: x, screenY: y, buttons: /up|end|drop/.test(type) ? 0 : 1, button: 0, pointerId: 1, isPrimary: true, pointerType: "mouse" };
    var ev; try { ev = /^drag|^drop/.test(type) ? new w.DragEvent(type, Object.assign(o, { dataTransfer: dt })) : /^pointer/.test(type) ? new w.PointerEvent(type, o) : new w.MouseEvent(type, o); } catch (x2) { ev = new w.MouseEvent(type, o); }
    el.dispatchEvent(ev);
  }
  function drag(src, z, mode) {   // mode 0: HTML5 drag & drop events · mode 1: mouse / pointer moves
    try { src.scrollIntoView({ block: "center" }); } catch (x) { }
    var r = src.getBoundingClientRect(), sx = r.left + Math.min(r.width / 2, 40), sy = r.top + r.height / 2, d = z.doc, tgt = d.elementFromPoint(z.x, z.y) || z.el;
    if (mode === 0) {
      var dt; try { dt = new (d.defaultView || W).DataTransfer(); } catch (x) { dt = null; }
      fire(src, "pointerdown", sx, sy); fire(src, "mousedown", sx, sy); fire(src, "dragstart", sx, sy, dt); fire(src, "drag", sx, sy, dt);
      fire(tgt, "dragenter", z.x, z.y, dt); fire(tgt, "dragover", z.x, z.y, dt); fire(tgt, "dragover", z.x + 2, z.y, dt); fire(tgt, "drop", z.x + 2, z.y, dt); fire(src, "dragend", z.x, z.y, dt);
    } else {
      fire(src, "pointerdown", sx, sy); fire(src, "mousedown", sx, sy);
      for (var i = 1; i <= 8; i++) { var x = sx + (z.x - sx) * i / 8, y = sy + (z.y - sy) * i / 8, e = d.elementFromPoint(x, y) || d.body; fire(e, "pointermove", x, y); fire(e, "mousemove", x, y); if (i === 8) { fire(e, "pointerover", x, y); fire(e, "mouseover", x, y); fire(e, "mouseenter", x, y); } }
      fire(tgt, "pointermove", z.x + 1, z.y); fire(tgt, "mousemove", z.x + 1, z.y); fire(tgt, "pointerup", z.x + 1, z.y); fire(tgt, "mouseup", z.x + 1, z.y);
    }
  }
  function dimItem(name, z) {   // the field in the Dimension list (left), exact name
    var re = new RegExp("^(t\\s+)?" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"), zx = z ? z.el.getBoundingClientRect().left : innerWidth;
    var a = leaf(re).filter(function (e) { var r = e.getBoundingClientRect(); return r.left < zx - 20 && r.height < 40; });
    return a.sort(function (p, q) { return p.getBoundingClientRect().left - q.getBoundingClientRect().left; })[0];
  }
  function chipMenu(chip, re) {   // a chip's ▾ menu → item (Filter / Edit filter)
    var it = leaf(re).filter(function (e) { return e.getBoundingClientRect().height < 40; })[0]; if (it) { tap(it); return true; }
    for (var up = 0; up < 2 && chip.parentElement && chip.parentElement.getBoundingClientRect().height < 50 && txt(chip.parentElement).length < txt(chip).length + 6; up++) chip = chip.parentElement;
    var ic = [].filter.call(chip.querySelectorAll("i,svg,span,em,b"), function (e) { return vis(e) && (!txt(e) || /^[▾▼⌄v]$/.test(txt(e))); });
    ic.sort(function (p, q) { return q.getBoundingClientRect().right - p.getBoundingClientRect().right; });
    try { chip.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); chip.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); } catch (x) { }
    tap(ic[0] || chip); return false;
  }
  function hasOk(e) { return [].some.call(e.querySelectorAll("button"), function (b) { return /^(ok|confirm)$/i.test(txt(b)); }); }
  function listDlg() { var a = [].filter.call(qa("div"), function (e) { var t = txt(e); return vis(e) && /basic screening/i.test(t) && /select all/i.test(t) && hasOk(e) && e.getBoundingClientRect().width < innerWidth * 0.8; }); return a.filter(function (e) { return !a.some(function (o) { return o !== e && e.contains(o); }); })[0]; }
  function listPick(S, word) {   // search → select all → OK. Returns "done" when OK was pressed with something selected
    var dl = listDlg(); if (!dl) return "nodlg";
    var inp = [].filter.call(dl.querySelectorAll("input"), function (i) { return vis(i) && i.type !== "checkbox" && i.type !== "radio"; })[0];
    if (inp && inp.value.toLowerCase() !== word.toLowerCase()) { setInput(inp, word); try { inp.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true })); } catch (x) { } S.lp = S.tick; return "typed"; }
    if (S.tick - (S.lp || 0) < 2) return "wait";
    var sel = (txt(dl).match(/view selected\s*\[?\(?\s*(\d+)/i) || [])[1];
    if (/no data found/i.test(txt(dl)) && !(+sel)) { var sd = leaf(/search from database/i, dl)[0]; if (sd && S.tick - (S.sdb || 0) > 4) { tap(sd); S.sdb = S.tick; } return "wait"; }
    if (!(+sel)) { var sa = leaf(/^select all$/i, dl)[0]; if (sa) tap(sa); return "wait"; }
    var ok = [].filter.call(dl.querySelectorAll("button"), function (b) { return vis(b) && /^(ok|confirm)$/i.test(txt(b)); })[0]; if (ok) { tap(ok); return "done:" + sel; }
    return "wait";
  }
  function isCanvas() { return !!(leaf(/^result filter$/i)[0] && leaf(/^dimension$/i)[0] && leaf(/^row$/i)[0] && leaf(/^value$/i)[0]); }
  function exploreIcon() {   // the 🔍 "Data exploration" icon over the Visit Details result (right side)
    var t = [].filter.call(qa("[title],[aria-label],[data-title],[data-original-title],[data-tip]"), function (e) { return vis(e) && /exploration/i.test([e.getAttribute("title"), e.getAttribute("aria-label"), e.getAttribute("data-title"), e.getAttribute("data-original-title"), e.getAttribute("data-tip")].join(" ")); })[0];
    return t || null;
  }
  function toolbarIcons() {   // small icons on the right above "Copy data"
    var cp = leaf(/^copy data$/i)[0]; if (!cp) return [];
    var cr = cp.getBoundingClientRect();
    var a = [].filter.call(qa("i,svg,span,button,a,div"), function (e) { var r = e.getBoundingClientRect(); return vis(e) && r.width >= 10 && r.width <= 34 && r.height >= 10 && r.height <= 34 && r.bottom <= cr.top + 4 && r.bottom > cr.top - 70 && r.left > cr.left - 260 && !txt(e); });
    a = a.filter(function (e) { return !a.some(function (o) { return o !== e && e.contains(o); }); });
    return a.sort(function (p, q) { return p.getBoundingClientRect().left - q.getBoundingClientRect().left; });
  }
  function ana(S, R, fin, since, step) {
    if (!S.sl) { S.sl = [[S.from, S.to]]; S.si = 0; S.cz = ""; S.n = 0; S.cap = 10000; S.ast = "find"; save(S); }
    var outR = function (o) { save(S); return out(o); }, pct = function (a) { return Math.round(10 + 85 * (S.si + a) / S.sl.length); };
    var A = S.ast, sinceA = function () { return S.tick - (S.at0 || 0); }, go = function (st) { S.ast = st; S.at0 = S.tick; S.tries = 0; save(S); };
    var gen = [].filter.call(qa("button"), function (b) { return vis(b) && /generate/i.test(txt(b)); })[0];
    var chip = function () {   // the Visit Date filter: chip in Result Filter ("Visit Date : (…)") or the Visit Date field in Row
      var zf = zone("filter"), c = zf && zf.chips.filter(function (e) { return /^visit date\s*:/i.test(txt(e)); })[0]; if (c) return c;
      var zr = zone("row"); return zr && zr.chips.filter(function (e) { return /^visit date\s*\(/i.test(txt(e)) || /^visit date$/i.test(txt(e)); })[0];
    };
    if (A === "find") {   // IT Operations → Visit Details → 🔍 Data exploration
      if (isCanvas()) { go("build"); return outR({ s: "run", pct: 6, msg: "Data exploration open" }); }
      var onVD = leaf(/^visit details$/i).some(function (e) { return e.getBoundingClientRect().top > 150 && e.getBoundingClientRect().left > 300; }) || (leaf(/^copy data$/i)[0] && leaf(/^visit date\s*:?$/i)[0]);
      var ff4 = !onVD && !isCanvas() && foreignFrame(); if (ff4 && sinceA() > 2) { S.at0 = S.tick; hop(S, ff4); return outR({ s: "run", pct: 4, msg: "Opening the Visit Details window…" }); }
      if (onVD) { go("explore"); return outR({ s: "run", pct: 5, msg: "Visit Details open — opening Data exploration" }); }
      var vd = find(/^visit details$/i); if (vd && sinceA() % 6 === 1) tap(vd);
      var it = find(/^it operations$/i); if (!vd && it && sinceA() % 8 === 3) tap(it);
      if (sinceA() > 30) return outR({ s: "you", msg: "Open IT Operations → Visit Details in vWork — the helper then builds the Retailer App logs" });
      return outR({ s: "run", pct: 3, msg: "Opening IT Operations → Visit Details…" });
    }
    if (A === "explore") {
      if (isCanvas()) { go("build"); return outR({ s: "run", pct: 6, msg: "Data exploration open" }); }
      var ex = exploreIcon();
      if (!ex) {   // no title on the icons: hover them one by one until the tooltip says "Data exploration"
        var tip = leaf(/^data exploration$/i)[0], icons = toolbarIcons();
        if (tip && S.hov != null && icons[S.hov]) ex = icons[S.hov];
        else if (icons.length) { S.hov = ((S.hov == null ? -1 : S.hov) + 1) % icons.length; var h = icons[S.hov]; ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"].forEach(function (t) { try { h.dispatchEvent(new MouseEvent(t, { bubbles: t.indexOf("enter") < 0, clientX: h.getBoundingClientRect().left + 5, clientY: h.getBoundingClientRect().top + 5 })); } catch (x) { } }); save(S); }
      }
      if (ex && sinceA() - (S.exT || -9) > 4) { tap(ex); S.exT = sinceA(); save(S); }
      if (sinceA() > 40) return fin("err", "Couldn't open Data exploration on Visit Details", { diag: diag(S) });
      return outR({ s: "run", pct: 5, msg: ex ? "Opening Data exploration…" : "Looking for the Data exploration icon…" });
    }
    if (A === "build") {   // Row: Job No. · Menu path · Visit Date — Value: Job No. (COUNT) — Result Filter: Sub-post
      var NEED = [["Job No.", "row", /^job no\.?(\s|$)/i], ["Menu path", "row", /^menu path/i], ["Visit Date", "row", /^visit date/i], ["Job No.", "value", /^job no/i], ["Sub-post", "filter", /^sub-?post/i]];
      for (var ni = 0; ni < NEED.length; ni++) {
        var nd = NEED[ni], z = zone(nd[1]); if (!z) return outR({ s: "run", pct: 7, msg: "Reading the exploration screen…" });
        if (hasChip(z, nd[2])) continue;
        if (S.ni !== ni) { S.ni = ni; S.dt = 0; S.dlast = -9; save(S); }
        if (S.tick - S.dlast < 3) return outR({ s: "run", pct: 7 + ni, msg: "Adding " + nd[0] + " to " + (nd[1] === "filter" ? "Result Filter" : nd[1][0].toUpperCase() + nd[1].slice(1)) + "…" });
        if (S.dt >= 8) return fin("err", "Couldn't drag " + nd[0] + " to " + nd[1] + " — drag it yourself and press 🤖 again", { diag: diag(S) });
        var src = dimItem(nd[0], zone("filter")); if (!src) { var sb = [].filter.call(qa("input"), function (i) { return vis(i) && /keyword|search/i.test(i.placeholder || ""); })[0]; if (sb && !S.typedF) { setInput(sb, ""); S.typedF = 1; } return outR({ s: "run", pct: 7, msg: "Looking for " + nd[0] + " in the field list…" }); }
        drag(src, z, S.dt % 2); S.dt++; S.dlast = S.tick; save(S);
        return outR({ s: "run", pct: 7 + ni, msg: "Dragging " + nd[0] + " → " + (nd[1] === "filter" ? "Result Filter" : nd[1]) + "…" });
      }
      go("fsub"); return outR({ s: "run", pct: 8, msg: "Fields in place" });
    }
    if (A === "fsub" || A === "fmenu") {   // Sub-post = every "Retailer" post · Menu path = every "vMessage" page
      var isSub = A === "fsub", zf2 = zone("filter"), fc = zf2 && zf2.chips.filter(function (e) { return (isSub ? /^sub-?post\s*=/i : /^menu path\s*=/i).test(txt(e)); })[0];
      if (fc && !/unlimited/i.test(txt(fc)) && !listDlg()) { go(isSub ? "fmenu" : "lim"); return outR({ s: "run", pct: 9, msg: (isSub ? "Sub-post" : "Menu path") + " filter set" }); }
      var lpr = listPick(S, isSub ? "Retailer" : "vmessage");
      if (/^done/.test(lpr)) return outR({ s: "run", pct: 9, msg: (isSub ? "Sub-post: " : "Menu path: ") + lpr.slice(5) + " selected" });
      if (lpr !== "nodlg") return outR({ s: "run", pct: 9, msg: isSub ? "Choosing every Retailer post…" : "Choosing every vMessage page…" });
      if (sinceA() > 45) return fin("err", "Couldn't set the " + (isSub ? "Sub-post" : "Menu path") + " filter", { diag: diag(S) });
      if (sinceA() % 4 === 1) { var host = isSub ? fc : (zone("row") || { chips: [] }).chips.filter(function (e) { return /^menu path/i.test(txt(e)); })[0]; if (host) chipMenu(host, isSub ? /^edit filter$/i : /^filter$/i); }
      else if (sinceA() % 4 === 2) { var mi = leaf(isSub ? /^edit filter$/i : /^filter$/i).filter(function (e) { return e.getBoundingClientRect().height < 40; })[0]; if (mi) tap(mi); }
      return outR({ s: "run", pct: 9, msg: "Opening the " + (isSub ? "Sub-post" : "Menu path") + " filter…" });
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
    var dlg = [].filter.call(qa("div"), function (e) { return vis(e) && /fixed time/i.test(txt(e)) && /dynamic time/i.test(txt(e)) && hasOk(e) && e.getBoundingClientRect().width < innerWidth * 0.95; });
    dlg = dlg.filter(function (e) { return !dlg.some(function (o) { return o !== e && e.contains(o); }); })[0];
    if (A === "date") {
      if (dlg) { go("set"); return outR({ s: "run", pct: pct(0.1), msg: "Dates " + cur[0] + " → " + cur[1] + "…" }); }
      var c = chip(); if (!c) { if (sinceA() > 15) return fin("err", "Couldn't find the Visit Date filter of the analysis", { diag: diag(S) }); return outR({ s: "run", pct: pct(0), msg: "Looking for the Visit Date filter…" }); }
      if (sinceA() % 4 === 0) { if (/^visit date\s*:/i.test(txt(c))) { tap(c); if (sinceA() >= 8) chipMenu(c, /^edit filter$/i); } else chipMenu(c, /^filter$/i); }
      if (sinceA() % 4 === 2) { var fm = leaf(/^(edit )?filter$/i).filter(function (e) { return e.getBoundingClientRect().height < 40; })[0]; if (fm) tap(fm); }
      if (sinceA() > 24) return fin("err", "The Visit Date filter didn't open", { diag: diag(S) });
      return outR({ s: "run", pct: pct(0), msg: "Opening the Visit Date filter…" });
    }
    if (A === "set") {
      if (!dlg) { go("date"); return outR({ s: "run", pct: pct(0), msg: "Reopening the filter…" }); }
      var st = (txt(dlg).match(/select time\s*:?\s*(\d{4}-\d\d-\d\d)\s*(?:to|~|-)\s*(\d{4}-\d\d-\d\d)/i) || []);
      if (!st[1]) { var iv = [].filter.call(dlg.querySelectorAll("input"), vis).map(function (i) { return i.value; }); if (/^\d{4}-\d\d-\d\d$/.test(iv[0] || "") && /^\d{4}-\d\d-\d\d$/.test(iv[1] || "")) st = [0, iv[0], iv[1]]; }
      if (st[1] === cur[0] && st[2] === cur[1]) { var okb = [].filter.call(dlg.querySelectorAll("button"), function (b) { return vis(b) && /^(ok|confirm)$/i.test(txt(b)); })[0]; if (okb) { tap(okb); go("dchk"); return outR({ s: "run", pct: pct(0.3), msg: "Dates set " + cur[0] + " → " + cur[1] }); } }
      S.tries++; save(S); if (S.tries > 20) return fin("err", "Couldn't set the dates " + cur[0] + " → " + cur[1] + " (shows " + (st[1] || "?") + " → " + (st[2] || "?") + ")", { diag: diag(S) });
      if (/dynamic/i.test(txt(dlg)) && S.tries === 1) { var fx = [].filter.call(dlg.querySelectorAll("div,span"), function (e) { return vis(e) && /^fixed time$/i.test(txt(e)); })[0]; if (fx) tap(fx); }
      var di = [].filter.call(dlg.querySelectorAll("input"), vis);
      if (di.length >= 2 && S.tries <= 2 && !S.noType) { setInput(di[0], cur[0]); enter(di[0]); setInput(di[1], cur[1]); enter(di[1]); return outR({ s: "run", pct: pct(0.2), msg: "Typing the dates…" }); }
      // pick on the calendar: month panel "Nov 2026", start day then end day
      var MN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], want = MN[+cur[0].slice(5, 7) - 1] + " " + cur[0].slice(0, 4);
      var heads = [].filter.call(dlg.querySelectorAll("div,span,button"), function (e) { return vis(e) && !e.children.length && txt(e).toLowerCase() === want; });
      if (!heads.length) { var pv = [].filter.call(dlg.querySelectorAll("button,span,a,i"), function (e) { return vis(e) && (/prev/i.test(e.className) || /^[‹<]$/.test(txt(e))); })[0]; if (pv) tap(pv); return outR({ s: "run", pct: pct(0.2), msg: "Finding " + want + " on the calendar…" }); }
      var hb = heads[0].getBoundingClientRect(), panelCells = [].filter.call(dlg.querySelectorAll("td,div,span"), function (e) { var r = e.getBoundingClientRect(); return vis(e) && !e.children.length && /^\d{1,2}$/.test(txt(e)) && r.top >= hb.bottom - 2 && Math.abs(r.left + r.width / 2 - (hb.left + hb.width / 2)) < 260 && !/disabled|other|prev-month|next-month|not-current|out/i.test((e.className || "") + " " + ((e.parentElement || {}).className || "")); });
      var cellOf = function (d) { var n = +d.slice(8); return panelCells.filter(function (e) { return +txt(e) === n; }).sort(function (a, b) { return n > 20 ? b.getBoundingClientRect().top - a.getBoundingClientRect().top : a.getBoundingClientRect().top - b.getBoundingClientRect().top; })[0]; };
      var c0 = cellOf(cur[0]), c1 = cellOf(cur[1]); if (!c0 || !c1) return outR({ s: "run", pct: pct(0.2), msg: "Reading the calendar…" });
      tap(c0); tap(c1); return outR({ s: "run", pct: pct(0.25), msg: "Picking " + cur[0] + " → " + cur[1] + " on the calendar…" });
    }
    if (A === "dchk") {   // the filter chip must now show the dates; typed dates that vWork ignored → pick them on the calendar
      if (dlg) { if (sinceA() > 4) go("set"); return outR({ s: "run", pct: pct(0.3), msg: "Closing the filter…" }); }
      var zc = zone("filter"), dc = zc && zc.chips.filter(function (e) { return /^visit date\s*:/i.test(txt(e)); })[0];
      if (dc && txt(dc).indexOf(cur[0]) >= 0 && txt(dc).indexOf(cur[1]) >= 0) { go("gen"); return outR({ s: "run", pct: pct(0.32), msg: "Visit Date " + cur[0] + " → " + cur[1] }); }
      if (sinceA() < 3) return outR({ s: "run", pct: pct(0.3), msg: "Checking the dates…" });
      if (dc && !S.noType) { S.noType = 1; go("date"); return outR({ s: "run", pct: pct(0.3), msg: "Dates didn't take — picking them on the calendar" }); }
      go("gen"); return outR({ s: "run", pct: pct(0.32), msg: "Generate…" });
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
        var ff0 = !ready() && foreignFrame();
        if (ff0 && (R.kind === "export" || R.kind === "ana")) { S.st = R.kind === "ana" ? "open" : "menu"; S.t0 = S.tick; hop(S, ff0); return out({ s: "run", pct: 10, msg: "Opening the report window…" }); }
        if (ff0 && R.menu) { step("org"); return out({ s: "run", pct: 12, msg: "Report open" }); }
        if (R.menu ? (find(R.menu) || ready()) : ready()) { step("menu"); return out({ s: "run", pct: 12, msg: "Report open" }); }
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
        var ff1 = !ready() && since() > 3 && foreignFrame();
        if (ff1 && R.kind === "export") { S.t0 = S.tick; hop(S, ff1); return out({ s: "run", pct: 14, msg: "Opening the report window…" }); }
        if (ff1) { step("org"); return out({ s: "run", pct: 15, msg: "Report open — choosing ALL first" }); }
        if ((S.menuTapped && since() > 1 && ready()) || (since() > 3 && ready())) { step("org"); return out({ s: "run", pct: 15, msg: "Report open" }); }
        if (since() > 20) { S.mloops = (S.mloops || 0) + 1; if (S.mloops > 2) return fin("err", "The report page didn't show what the helper expects", { diag: diag(S) }); step("open"); }
        return out({ s: "run", pct: 12, msg: "Opening the report…" });
      }
      if (R.kind === "export" && S.st === "org") step(R.col ? "xdate" : "xwait");
      if (S.st === "xdate") {   // the date filter under the column heading (e.g. Creation time): Start time ~ End time
        var th = [].filter.call(qa("th,[class*=header-cell],[class*=cell]"), function (e) { return vis(e) && R.col.test(txt(e)); })[0];
        var rgs = [].filter.call(qa(".ant-picker-range,.el-date-editor--datetimerange,.el-date-editor--daterange,[class*=range-picker],[class*=picker-range]"), vis);
        var ff3 = !th && foreignFrame(); if (ff3) { S.t0 = S.tick; hop(S, ff3); return out({ s: "run", pct: 20, msg: "Opening the report window…" }); }
        var xi = [];
        if (th) {
          var cx = th.getBoundingClientRect(), mid = cx.left + cx.width / 2, dist = function (e) { var r = e.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - mid); };
          if (rgs.length) { rgs.sort(function (a, b) { return dist(a) - dist(b); }); if (dist(rgs[0]) < 260) xi = [].filter.call(rgs[0].querySelectorAll("input"), vis); }
          if (xi.length < 2) {   // Start time ~ End time boxes under the column (any date-picker kind)
            var st0 = [].filter.call(qa("input"), function (i) { return vis(i) && /start/i.test(i.placeholder || ""); }).sort(function (a, b) { return dist(a) - dist(b); })[0];
            if (st0) { var sr = st0.getBoundingClientRect(), en0 = [].filter.call(qa("input"), function (i) { var r = i.getBoundingClientRect(); return vis(i) && i !== st0 && /end/i.test(i.placeholder || "") && Math.abs(r.top - sr.top) < 12 && r.left > sr.left && r.left - sr.right < 160; })[0]; if (en0 && dist(st0) < 300) xi = [st0, en0]; }
          }
        }
        if (!th || xi.length < 2) { if (since() > 20) return fin("err", "Couldn't find the date filter", { diag: diag(S) }); return out({ s: "run", pct: 22, msg: "Looking for the date filter…" }); }
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
        if (!/^in-vwork\./i.test(location.hostname) && since() > 3) { S.t0 = S.tick; hop(S, "https://in-vwork.vivo.xyz/vwork/"); return out({ s: "run", pct: 60, msg: "Back to vWork for the Process center…" }); }
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
      if (S.st === "orgwait") { if (since() > 4 || (find(R.date) && !busy())) step("dim"); return out({ s: "run", pct: 24, msg: "Loading for ALL…" }); }
      if (S.st === "dim") { step("date"); }
      if (S.st === "date") {   // the month: a preset (This month / Last month) or typed dates
        var lab = find(R.date), box = lab ? (lab.closest(".ant-form-item,.el-form-item,[class*=item]") || lab.parentElement) : null;
        var ins = box ? [].filter.call(box.querySelectorAll("input"), vis) : []; if (ins.length < 2) ins = [].filter.call(qa(".ant-picker-range input,.el-range-input"), vis);
        var ff2 = ins.length < 2 && foreignFrame(); if (ff2) { S.t0 = S.tick; hop(S, ff2); return out({ s: "run", pct: 27, msg: "Opening the report window…" }); }
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
