// Customizations made by master admins (labels, hidden items, dropdown lists, extra form fields, custom tools),
// applied on every shared page (web + apps) and on the web dashboard. Masters also get a ✏️ Customize mode.
(function () {
  "use strict";
  if (window.CUST) return;
  var PAGE = window.CUST_PAGE || (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "") || "index";
  if (PAGE === "index") PAGE = "dashboard";
  var AUTH = null;
  function readAuth() {
  AUTH = null;
  try { AUTH = window.BIApp && window.BIApp.getAuth ? JSON.parse(window.BIApp.getAuth()) : null; } catch (e) { AUTH = null; }
  if ((!AUTH || !AUTH.token) && window.__BI_AUTH && window.__BI_AUTH.token) AUTH = window.__BI_AUTH;
  if (!AUTH || !AUTH.token) { try { var w = JSON.parse(localStorage.getItem("biw-auth") || "null"); if (w && w.token) AUTH = { app: w.app, username: w.username, token: w.token }; } catch (e) { } }
  CK = AUTH ? "bi-cust:" + AUTH.app + ":" + String(AUTH.username).toLowerCase() : "";
  DATA = { ver: "", items: [], master: false, role: AUTH ? (AUTH.app === "admin" ? "admin" : "state") : "" };
  try { var c = CK && JSON.parse(localStorage.getItem(CK) || "null"); if (c && c.items) DATA = c; } catch (e) { }
  }
  var CK = "", DATA = null; readAuth();
  var EDIT = false, applying = false;
  function api(body) {
    if (!AUTH) return Promise.resolve({ ok: false });
    return fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json", "X-BI-App": "1" }, body: JSON.stringify(Object.assign({ app: AUTH.app, username: AUTH.username, token: AUTH.token }, body)) })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: "No internet connection." }; });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function mine(kind) { return DATA.items.filter(function (x) { return x.kind === kind && (!x.page || x.page === "*" || x.page === PAGE); }); }

  // ---------- public API for pages ----------
  var CUST = window.CUST = {
    page: PAGE,
    get master() { return !!DATA.master; },
    get role() { return DATA.role; },
    list: function (key, defaults) { var l = DATA.items.filter(function (x) { return x.kind === "list" && x.listKey === key; }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })[0]; return l ? l.items.slice() : (defaults || []).slice(); },
    fields: function (formKey) { var out = []; DATA.items.filter(function (x) { return x.kind === "fields" && x.formKey === formKey; }).sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }).forEach(function (x) { (x.fields || []).forEach(function (f) { out.push(Object.assign({ draft: x.draft, item: x.id }, f)); }); }); return out; },
    tools: function () { return DATA.items.filter(function (x) { return x.kind === "tool"; }); },
    tool: function (id) { return DATA.items.find(function (x) { return x.kind === "tool" && x.id === id; }) || null; },
    // renders extra fields into a container; returns { collect() -> {key: value} or null (shows error) }
    renderExtra: function (box, formKey, values, onChange) {
      box.setAttribute("data-form", formKey);
      var fs = CUST.fields(formKey);
      if (!fs.length) { box.innerHTML = ""; box.style.display = EDIT ? "" : "none"; return { collect: function () { return {}; }, count: 0 }; }
      return CUST.renderFields(box, fs, values, onChange, formKey);
    },
    // opts: { asset: function(id) -> Promise<dataUrl> }  (images inside custom tools)
    renderFields: function (box, fs, values, onChange, formKey, opts) {
      values = values || {}; formKey = formKey || "tool"; opts = opts || {};
      box.style.display = ""; box.classList.add("cx-fs");
      var page = 0, pages = 1, curPage = -1;
      var html = fs.map(function (f) {
        var v = values[f.key], id = "cx_" + formKey.replace(/\W/g, "") + "_" + f.key;
        var req = f.required ? ' <b style="color:#E05757">*</b>' : "", dr = f.draft ? ' <span class="cx-d">draft</span>' : "";
        var lab = '<label class="cx-l" for="' + id + '">' + esc(f.label) + req + dr + "</label>", help = f.help ? '<div class="cx-help">' + esc(f.help) + "</div>" : "";
        var ph = f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "", mm = (f.min != null ? ' min="' + f.min + '"' : "") + (f.max != null ? ' max="' + f.max + '"' : "");
        var inner;
        if (f.type === "heading") inner = (f.image ? '<img class="cx-img" data-asset="' + esc(f.image) + '" alt="">' : "") + (f.label ? '<div class="cx-h">' + esc(f.label) + dr + "</div>" : "") + (f.text ? '<div class="cx-ht">' + esc(f.text).replace(/\n/g, "<br>") + "</div>" : "");
        else if (f.type === "image") inner = '<img class="cx-img" data-asset="' + esc(f.image) + '" alt="">' + (f.label ? '<div class="cx-help" style="text-align:center">' + esc(f.label) + "</div>" : "");
        else if (f.type === "select") inner = lab + '<select class="tx" id="' + id + '" data-k="' + f.key + '"><option value="">' + esc(f.placeholder || "Choose…") + "</option>" + f.options.map(function (o) { return "<option" + (v === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>" + help;
        else if (f.type === "multi") inner = lab + '<div class="cx-ch" data-k="' + f.key + '" data-multi="1">' + f.options.map(function (o) { return '<button type="button" class="' + ((v || []).indexOf(o) >= 0 ? "on" : "") + '">' + esc(o) + "</button>"; }).join("") + "</div>" + help;
        else if (f.type === "yesno") inner = lab + '<div class="cx-ch" data-k="' + f.key + '"><button type="button" class="' + (v === "Yes" ? "on" : "") + '">Yes</button><button type="button" class="' + (v === "No" ? "on" : "") + '">No</button></div>' + help;
        else if (f.type === "rating") inner = lab + '<div class="cx-ch cx-star" data-k="' + f.key + '" data-num="1">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-v="' + n + '" class="' + (Number(v) >= n ? "on" : "") + '">★</button>'; }).join("") + "</div>" + help;
        else if (f.type === "scale") { var lo = f.min != null ? f.min : 0, hi = f.max != null ? f.max : 10, bs = []; for (var n = lo; n <= hi && bs.length < 21; n++) bs.push('<button type="button" data-v="' + n + '" class="' + (String(v) === String(n) ? "on" : "") + '">' + n + "</button>"); inner = lab + '<div class="cx-ch cx-scale" data-k="' + f.key + '" data-num="1">' + bs.join("") + "</div>" + (f.placeholder ? '<div class="cx-help">' + esc(f.placeholder) + "</div>" : "") + help; }
        else if (f.type === "checkbox") inner = '<label class="cx-cb"><input type="checkbox" data-k="' + f.key + '"' + (v === "Yes" ? " checked" : "") + "> <span>" + esc(f.label) + req + dr + "</span></label>" + help;
        else if (f.type === "longtext") inner = lab + '<textarea class="tx" id="' + id + '" data-k="' + f.key + '"' + ph + ">" + esc(v || "") + "</textarea>" + help;
        else if (f.type === "photo") inner = lab + '<div class="cx-row"><button type="button" class="btn sec sm" data-photo="' + f.key + '">📷 ' + (v ? "Change photo" : "Add photo") + '</button><span class="cx-pn">' + (v ? "✓ added" : "") + '</span></div><input type="hidden" data-k="' + f.key + '" value="' + esc(v || "") + '">' + help;
        else if (f.type === "location") inner = lab + '<div class="cx-row"><button type="button" class="btn sec sm" data-loc="' + f.key + '">📍 ' + (v ? "Update location" : "Capture my location") + '</button><span class="cx-pn">' + esc(v || "") + '</span></div><input type="hidden" data-k="' + f.key + '" value="' + esc(v || "") + '">' + help;
        else { var ty = { number: "number", date: "date", email: "email", phone: "tel", time: "time", datetime: "datetime-local" }[f.type] || "text"; inner = lab + '<input class="tx" id="' + id + '" data-k="' + f.key + '" type="' + ty + '"' + ph + mm + (f.type === "phone" ? ' inputmode="tel"' : f.type === "number" ? ' inputmode="decimal"' : "") + ' value="' + esc(v == null ? "" : v) + '">' + help; }
        return '<div class="cx-f cx-t-' + f.type + '" data-f="' + f.key + '" data-page="' + page + '">' + inner + "</div>";
      });
      // page numbers: each heading marked "new page" (except a leading one) starts the next page
      page = 0; var started = false;
      fs.forEach(function (f, i) { if (f.type === "heading" && f.newPage && started) page++; started = true; f.__p = page; });
      pages = page + 1;
      box.innerHTML = html.map(function (h, i) { return h.replace(/data-page="\d+"/, 'data-page="' + fs[i].__p + '"'); }).join("");
      [].forEach.call(box.querySelectorAll("img[data-asset]"), function (im) { var a = im.getAttribute("data-asset"); if (!a || !opts.asset) { im.remove(); return; } opts.asset(a).then(function (u) { if (u) im.src = u; else im.remove(); }); });
      var update = function () {
        var o = collectRaw();
        fs.forEach(function (f) { var el = box.querySelector('[data-f="' + f.key + '"]'); if (!el) return; var vis = isVis(f, o) && (curPage < 0 || f.__p === curPage); el.style.display = vis ? "" : "none"; });
      };
      var fire = function () { update(); if (onChange) onChange(collectRaw()); };
      [].forEach.call(box.querySelectorAll("input[data-k],select[data-k],textarea[data-k]"), function (i) { i.addEventListener("input", fire); i.addEventListener("change", fire); });
      [].forEach.call(box.querySelectorAll(".cx-ch"), function (g) { [].forEach.call(g.children, function (b) { b.onclick = function () {
        if (EDIT) return;
        if (g.classList.contains("cx-star")) { var n = +b.dataset.v, cur = [].filter.call(g.children, function (x) { return x.classList.contains("on"); }).length; [].forEach.call(g.children, function (x) { x.classList.toggle("on", +x.dataset.v <= (cur === n ? 0 : n)); }); }
        else if (g.dataset.multi) b.classList.toggle("on"); else [].forEach.call(g.children, function (x) { x.classList.toggle("on", x === b && !b.classList.contains("on")); });
        fire(); }; }); });
      [].forEach.call(box.querySelectorAll("[data-photo]"), function (b) { b.onclick = function () { pickPhoto(function (id) { box.querySelector('input[data-k="' + b.dataset.photo + '"]').value = id; b.parentNode.querySelector(".cx-pn").textContent = "✓ added"; fire(); }); }; });
      [].forEach.call(box.querySelectorAll("[data-loc]"), function (b) { b.onclick = function () {
        if (!navigator.geolocation) return toast("This device can't share location.");
        b.disabled = true; b.textContent = "📍 Getting location…";
        navigator.geolocation.getCurrentPosition(function (p) { var v = p.coords.latitude.toFixed(6) + "," + p.coords.longitude.toFixed(6); box.querySelector('input[data-k="' + b.dataset.loc + '"]').value = v; b.parentNode.querySelector(".cx-pn").textContent = v + " (±" + Math.round(p.coords.accuracy) + " m)"; b.disabled = false; b.textContent = "📍 Update location"; fire(); },
          function () { b.disabled = false; b.textContent = "📍 Capture my location"; toast("Couldn't get your location — turn on GPS and allow location."); }, { enableHighAccuracy: true, timeout: 20000 });
      }; });
      function isVis(f, o) { if (!f.show || !f.show.key) return true; var x = o[f.show.key]; return Array.isArray(x) ? x.indexOf(f.show.value) >= 0 : String(x == null ? "" : x) === f.show.value; }
      function collectRaw() {
        var o = {};
        fs.forEach(function (f) {
          var el = box.querySelector('[data-k="' + f.key + '"]'); if (!el) return;
          if (el.classList.contains("cx-ch")) { var on = [].filter.call(el.children, function (x) { return x.classList.contains("on"); }); if (el.dataset.num) o[f.key] = el.classList.contains("cx-star") ? (on.length || "") : (on[0] ? +on[0].dataset.v : ""); else { on = on.map(function (x) { return x.textContent; }); o[f.key] = el.dataset.multi ? on : on[0] || ""; } }
          else if (el.type === "checkbox") o[f.key] = el.checked ? "Yes" : "";
          else o[f.key] = el.value;
        });
        return o;
      }
      update();
      var api2 = { count: fs.filter(function (f) { return f.type !== "heading" && f.type !== "image"; }).length, pages: pages,
        setPage: function (n) { curPage = n; update(); },
        collect: function (quiet, onlyPage) {
          var o = collectRaw();
          fs.forEach(function (f) { if (!isVis(f, o) && f.key in o) o[f.key] = Array.isArray(o[f.key]) ? [] : ""; });
          var miss = fs.filter(function (f) { var v = o[f.key]; return f.required && isVis(f, o) && (onlyPage == null || f.__p === onlyPage) && (v === "" || v == null || (Array.isArray(v) && !v.length)); });
          var bad = fs.filter(function (f) { var v = o[f.key]; if (v === "" || v == null || (onlyPage != null && f.__p !== onlyPage)) return false; if (f.type === "email") return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); if (f.type === "phone") return String(v).replace(/\D/g, "").length < 6; if (f.type === "number") return (f.min != null && +v < f.min) || (f.max != null && +v > f.max); return false; });
          if ((miss.length || bad.length) && !quiet) { toast(miss.length ? "Please fill: " + miss.map(function (f) { return f.label; }).join(", ") : "Please check: " + bad.map(function (f) { return f.label; }).join(", ")); var first = box.querySelector('[data-f="' + (miss[0] || bad[0]).key + '"]'); if (first && first.scrollIntoView) first.scrollIntoView({ block: "center", behavior: "smooth" }); return null; }
          return o;
        } };
      box.__F = api2;
      return api2;
    },
    // read-only rows "label: value" for a record's extra values
    extraRows: function (formKey, extra) { extra = extra || {}; return CUST.fields(formKey).filter(function (f) { var v = extra[f.key]; return v != null && v !== "" && !(Array.isArray(v) && !v.length); }).map(function (f) { var v = extra[f.key]; return [f.label, f.type === "photo" ? "📷 photo" : Array.isArray(v) ? v.join(", ") : String(v)]; }); },
    extraColumns: function (formKey) { return CUST.fields(formKey).map(function (f) { return [f.key, f.label]; }); },
    refresh: refresh, edit: function (on) { if (on && !document.querySelector(".cx-fab")) masterUi(); setEdit(on); },
    // the web dashboard logs in / out without reloading the page
    reauth: function () { var was = AUTH && AUTH.token; readAuth(); if (!AUTH) { if (EDIT) setEdit(false); var f = document.querySelector(".cx-fab"); if (f) f.remove(); apply(); return Promise.resolve(); } if (!DATA.master) { var f2 = document.querySelector(".cx-fab"); if (f2) f2.remove(); } apply(); return refresh().then(function () { if (DATA.master) masterUi(); }); }
  };
  function toast(m) { var t = document.createElement("div"); t.className = "toast"; t.textContent = m; t.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1F2340;color:#fff;padding:10px 16px;border-radius:12px;z-index:2147483600;font:600 13px Segoe UI,Arial;max-width:90vw"; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3000); }
  function pickPhoto(cb) {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = function () { var f = inp.files[0]; if (!f) return; var img = new Image(), u = URL.createObjectURL(f); img.onload = function () { var k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = img.width * k; c.height = img.height * k; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); api({ action: "support-upload", name: "field-" + Date.now() + ".jpg", data: c.toDataURL("image/jpeg", 0.78).split(",")[1] }).then(function (r) { if (!r.ok) return toast(r.error || "Upload failed"); cb(r.att.id); }); }; img.src = u; };
    inp.click();
  }

  // ---------- apply text + hide overrides to the live page ----------
  var ORIG = new WeakMap();
  function apply() {
    if (applying || !document.body) return;
    applying = true;
    try {
      var texts = mine("text"), hides = mine("hide");
      if (texts.length || hides.length) {
        var tmap = {}, amap = {}; texts.forEach(function (x) { if (x.attr) amap[x.match] = x; else tmap[x.match] = x; });
        var hmap = {}; hides.forEach(function (x) { hmap[x.match] = x; });
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n, todo = [];
        while ((n = walker.nextNode())) { var p = n.parentNode; if (!p || p.closest && p.closest(".cx-panel,script,style,textarea")) continue; var raw = ORIG.has(n) ? ORIG.get(n) : n.nodeValue, k = raw.trim(); if (!k) continue; if (tmap[k] || hmap[k] || ORIG.has(n)) todo.push([n, raw, k]); }
        todo.forEach(function (x) {
          var node = x[0], raw = x[1], k = x[2], o = tmap[k];
          if (o) { if (!ORIG.has(node)) ORIG.set(node, raw); var want = raw.replace(k, o.value); if (node.nodeValue !== want) node.nodeValue = want; markDraft(node.parentNode, o.draft); }
          else if (ORIG.has(node) && node.nodeValue !== raw) node.nodeValue = raw;
          var h = hmap[k];
          if (h) { var el = node.parentNode; for (var i = 0; i < (h.up || 0) && el.parentNode && el.parentNode !== document.body; i++) el = el.parentNode; if (DATA.master && EDIT) { el.style.opacity = ".35"; el.style.outline = "2px dashed #E05757"; } else el.style.display = "none"; el.setAttribute("data-cx-hidden", h.id); }
        });
        if (Object.keys(amap).length) [].forEach.call(document.querySelectorAll("[placeholder],[title]"), function (el) { ["placeholder", "title"].forEach(function (a) { var key = "data-cx-o" + a, ov = el.getAttribute(key) || el.getAttribute(a); if (!ov) return; var o = amap[ov.trim()]; if (o && o.attr === a) { if (!el.getAttribute(key)) el.setAttribute(key, ov); if (el.getAttribute(a) !== o.value) el.setAttribute(a, o.value); } }); });
      }
      applyAutoLists();
    } finally { applying = false; }
  }
  function autoKey(sel) { var k = sel.id || sel.getAttribute("name"); return k && !/^cx_/.test(k) ? "auto:" + PAGE + ":" + k : ""; }
  function origOpts(sel) {
    var o = sel.getAttribute("data-cx-orig");
    if (o) try { return JSON.parse(o); } catch (e) { }
    var list = [].map.call(sel.options, function (x) { return [x.textContent.trim(), x.value]; });
    sel.setAttribute("data-cx-orig", JSON.stringify(list)); return list;
  }
  function applyAutoLists() {
    var lists = DATA.items.filter(function (x) { return x.kind === "list" && String(x.listKey).indexOf("auto:" + PAGE + ":") === 0; });
    if (!lists.length) return;
    lists.forEach(function (l) {
      var id = l.listKey.slice(("auto:" + PAGE + ":").length);
      [].forEach.call(document.querySelectorAll("select"), function (sel) {
        if (sel.hasAttribute("data-list") || (sel.id || sel.getAttribute("name")) !== id) return;
        var orig = origOpts(sel), want = l.items, cur = [].map.call(sel.options, function (x) { return x.textContent.trim(); });
        // keep a leading placeholder ("Choose…", "Select …") that the page added
        var ph = orig.length && /^(choose|select|all\b|--)/i.test(orig[0][0]) && orig[0][1] === "" ? orig[0] : null;
        var full = (ph ? [ph[0]] : []).concat(want);
        if (cur.join("\n") === full.join("\n")) return;
        var val = sel.value, vmap = {}; orig.forEach(function (o) { vmap[o[0]] = o[1]; });
        sel.innerHTML = full.map(function (t, i) { var v = ph && i === 0 ? "" : (vmap[t] != null ? vmap[t] : t); return '<option value="' + esc(v) + '">' + esc(t) + "</option>"; }).join("");
        if ([].some.call(sel.options, function (o) { return o.value === val; })) sel.value = val;
        markDraft(sel, l.draft);
      });
    });
  }
  function markDraft(el, draft) { if (DATA.master && draft && el && el.style) el.style.boxShadow = "inset 0 -2px 0 #F5A623"; }
  // ---------- extra fields on ANY existing form (not only the ones built with hooks) ----------
  var NO_AUTO = { dashboard: 1, studio: 1, tool: 1, hub: 1, invite: 1 };
  var FORM_SEL = "form,.card,.sheet,.f2,.f3,.f4,.f5,.f6,.f8,.flds";
  function fieldEls(root) { return [].filter.call(root.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=search]),select,textarea"), function (x) { return !x.closest(".cx-panel,.cx-fs,.cx-auto,[data-form]"); }); }
  // the block that holds a form: a known form wrapper, else the outermost block under the page / pop-up
  var STOP = "body,.wrap,#view,#pane,.ov,.hero";
  function formOf(el) {
    var x = el, best = null;
    while (x && x.parentElement && !x.parentElement.matches(STOP)) {
      x = x.parentElement;
      if (x.matches(FORM_SEL + ",.fs,.fs2")) return x;
      best = x;
    }
    return best || (el.parentElement && !el.parentElement.matches(STOP) ? el.parentElement : null);
  }
  function formContainers() {
    var out = [], seen = [];
    fieldEls(document).forEach(function (el) {
      var c = formOf(el); if (!c || seen.indexOf(c) >= 0) return; seen.push(c);
      if (c.querySelector("[data-form]:not(.cx-auto)")) return;
      var fs = fieldEls(c); if (fs.length < 2) return;
      var first = fs.find(function (x) { return x.id; }); if (!first) return;
      out.push({ el: c, key: "auto:" + PAGE + ":" + first.id, last: fs[fs.length - 1] });
    });
    return out;
  }
  function autoForms() {
    if (NO_AUTO[PAGE]) return;
    formContainers().forEach(function (c) {
      var fs = CUST.fields(c.key), box = null;
      [].some.call(c.el.querySelectorAll(".cx-auto"), function (b) { if (b.getAttribute("data-form") === c.key) { box = b; return true; } });
      if (!fs.length && !EDIT) { if (box) box.remove(); return; }
      if (!box) {
        box = document.createElement("div"); box.className = "cx-auto"; box.setAttribute("data-form", c.key);
        var top = c.last; while (top.parentElement && top.parentElement !== c.el) top = top.parentElement;   // after the block holding the last field
        while (top.nextElementSibling && top.nextElementSibling.classList.contains("cx-opt")) top = top.nextElementSibling;
        top.insertAdjacentElement("afterend", box);
      }
      var sig = JSON.stringify(fs.map(function (f) { return [f.key, f.label, f.type, f.options, f.required, f.draft]; }));
      if (box.__sig !== sig) { box.__sig = sig; var keep = box.__F ? box.__F.collect(true) : {}; if (fs.length) CUST.renderFields(box, fs, keep, null, c.key); else { box.innerHTML = ""; box.__F = null; } }
    });
  }
  // When a page saves its form, the answers to the added fields are saved too (and required ones are checked first).
  var lastBtn = 0;
  document.addEventListener("click", function (e) { var b = e.target && e.target.closest && e.target.closest("button,.act,[role=button],input[type=submit]"); if (b && !b.closest(".cx-panel,.cx-fab,.cx-add,.cx-auto,.cx-fs")) lastBtn = Date.now(); }, true);
  var SKIP = /^(cust|ct|cxx|master|mod|notify|ping|hub|login|logout|qr)-?|-(list|get|notify|file|files|search|stats|seen|read|upload|lookup|catalog|models|prices?|history|board|summary|export|detail|details|view|ask|me|my|mine|status|check|config|rules)$|upload|ask/i;
  var ofetch = window.fetch;
  if (ofetch && !NO_AUTO[PAGE]) window.fetch = function (url, o) {
    var self = this, args = arguments;
    try {
      if (String(url).indexOf("/api/auth") >= 0 && o && o.method === "POST" && typeof o.body === "string" && Date.now() - lastBtn < 20000) {
        var body = JSON.parse(o.body), act = String(body.action || "");
        var boxes = [].filter.call(document.querySelectorAll(".cx-auto"), function (b) { return b.__F && b.offsetParent !== null; });
        if (act && !SKIP.test(act) && boxes.length) {
          var vals = [];
          for (var i = 0; i < boxes.length; i++) { var v = boxes[i].__F.collect(false); if (v === null) return Promise.resolve(new Response(JSON.stringify({ ok: false, error: "Please fill the required fields marked *" }), { status: 400, headers: { "content-type": "application/json" } })); vals.push([boxes[i], v]); }
          return ofetch.apply(self, args).then(function (r) {
            r.clone().json().then(function (j) {
              if (!j || !j.ok) return;
              var ref = {}; ["id", "visitId", "ticket", "no"].forEach(function (k) { if (j[k] != null) ref[k] = j[k]; }); if (j.item && j.item.id) ref.id = j.item.id; if (j.visit && j.visit.id) ref.id = j.visit.id;
              vals.forEach(function (x) {
                var any = Object.keys(x[1]).some(function (k) { var y = x[1][k]; return Array.isArray(y) ? y.length : y !== "" && y != null; });
                if (any) api({ action: "cxx-save", formKey: x[0].getAttribute("data-form"), values: x[1], from: act, ref: ref });
                var fs = CUST.fields(x[0].getAttribute("data-form")); if (fs.length) CUST.renderFields(x[0], fs, {}, null, x[0].getAttribute("data-form"));
              });
            }).catch(function () { });
            return r;
          });
        }
      }
    } catch (e) { }
    return ofetch.apply(self, args);
  };
  var pend = 0;
  function schedule() { if (pend) return; pend = requestAnimationFrame(function () { pend = 0; apply(); autoForms(); if (EDIT) addFieldButtons(); }); }
  function start() {
    apply(); autoForms();
    new MutationObserver(function () { if (!applying) schedule(); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    if (DATA.master) masterUi();
  }
  function refresh() {
    if (!AUTH) return Promise.resolve();
    return api({ action: "cust-get", ver: DATA.master ? "" : DATA.ver }).then(function (r) {
      if (!r || !r.ok || r.same) return;
      var before = JSON.stringify(DATA.items.filter(function (x) { return x.kind === "list" || x.kind === "fields" || x.kind === "tool"; }).map(function (x) { return [x.id, x.updatedAt]; }));
      var wasMaster = DATA.master;
      DATA = { ver: r.ver, items: r.items || [], master: !!r.master, role: r.role };
      try { localStorage.setItem(CK, JSON.stringify(DATA)); } catch (e) { }
      apply(); autoForms();
      if (DATA.master && !wasMaster) masterUi();
      var after = JSON.stringify(DATA.items.filter(function (x) { return x.kind === "list" || x.kind === "fields" || x.kind === "tool"; }).map(function (x) { return [x.id, x.updatedAt]; }));
      if (before !== after && typeof window.__custChanged === "function") window.__custChanged();
    });
  }

  // ---------- master: ✏️ Customize mode ----------
  var css = ".cx-help{font-size:11.5px;color:#6B7090;margin:3px 2px 0}.cx-h{font-size:17px;font-weight:800;color:#1F2340;margin:18px 0 2px}.cx-ht{font-size:14px;color:#3A3F5C;line-height:1.55;margin-top:4px}" +
    ".cx-img{display:block;max-width:100%;border-radius:14px;margin:12px auto 4px}.cx-cb{display:flex!important;gap:10px;align-items:flex-start;margin:14px 2px 2px;font-size:14px;cursor:pointer}.cx-cb input{width:20px;height:20px;margin:0;flex:none}" +
    ".cx-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cx-pn{font-size:12px;color:#6B7090}.cx-star button{font-size:22px;color:#C9CCDA;padding:2px 8px!important;border:0!important;background:none!important}.cx-star button.on{color:#F5A623!important}" +
    ".cx-scale button{min-width:38px;padding:7px 0!important}.cx-auto{margin-top:6px}.cx-auto:empty{display:none}" +
    ".cx-l{display:block;font-size:12px;color:#6B7090;font-weight:600;margin:10px 2px 3px}.cx-d{background:#FFF4E5;color:#B26A00;border-radius:6px;padding:0 5px;font-size:10.5px}" +
    ".cx-ch{display:flex;flex-wrap:wrap;gap:6px}.cx-ch button{border:1px solid #D8DAE5;background:#fff;border-radius:99px;padding:6px 12px;font:600 13px inherit;cursor:pointer}.cx-ch button.on{background:#EEF0FF;border-color:#4D5BF9;color:#2B33A6}" +
    ".cx-fab{position:fixed;left:12px;bottom:14px;z-index:2147483000;border:0;border-radius:99px;padding:10px 14px;font:700 13px Segoe UI,Arial;background:#1F2340;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer}" +
    "body:has(.biw-frame) .cx-fab,body:has(.biw-frame) .cx-bar{display:none!important}.cx-fab.on{background:#F5A623;color:#1F2340}.cx-bar{position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#F5A623;color:#1F2340;font:700 12.5px Segoe UI,Arial;padding:7px 12px;text-align:center}" +
    ".cx-hl{outline:2px solid #F5A623!important;outline-offset:2px;cursor:pointer!important}.cx-sel{outline:3px solid #E05757!important;outline-offset:2px}" +
    ".cx-panel{position:fixed;left:50%;transform:translateX(-50%);bottom:12px;width:min(520px,94vw);max-height:80vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 14px 40px rgba(0,0,0,.3);z-index:2147483100;padding:14px;font:14px Segoe UI,Arial;color:#1F2340}" +
    ".cx-panel h4{margin:0 0 8px;font-size:15px}.cx-panel input,.cx-panel textarea,.cx-panel select{width:100%;box-sizing:border-box;border:1px solid #D8DAE5;border-radius:10px;padding:9px 10px;font:14px inherit;margin-top:4px}" +
    ".cx-panel .r{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.cx-panel button{border:0;border-radius:10px;padding:9px 12px;font:700 13px inherit;cursor:pointer;background:#F1F2F8;color:#1F2340}.cx-panel .p{background:#4D5BF9;color:#fff}.cx-panel .g{background:#1E9E61;color:#fff}.cx-panel .d{background:#FDECEC;color:#B3402F}" +
    ".cx-panel small{color:#6B7090;font-size:12px}.cx-opt{margin-top:4px!important;padding:6px!important;font-size:12px!important}.cx-add{display:block;width:100%;margin-top:10px;border:1.5px dashed #F5A623!important;background:#FFFBF2!important;color:#B26A00!important;border-radius:12px;padding:10px;font:700 13px Segoe UI,Arial;cursor:pointer}";
  function masterUi() {
    if (document.querySelector(".cx-fab")) return;
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var b = document.createElement("button"); b.className = "cx-fab"; b.textContent = "✏️ Customize"; b.title = "Master admin: customize this screen";
    b.onclick = function (e) { e.stopPropagation(); setEdit(!EDIT); };
    document.body.appendChild(b);
    if (PAGE !== "dashboard") try { if (sessionStorage.getItem("cx-edit") === "1") setEdit(true); } catch (e) { }
  }
  if (!document.querySelector("style[data-cx]")) { var st0 = document.createElement("style"); st0.setAttribute("data-cx", "1"); st0.textContent = css.split(".cx-fab")[0]; (document.head || document.documentElement).appendChild(st0); }
  var hoverEl = null, bar = null;
  function setEdit(on) {
    EDIT = !!on; try { sessionStorage.setItem("cx-edit", EDIT ? "1" : "0"); } catch (e) { }
    var fab = document.querySelector(".cx-fab"); if (fab) { fab.classList.toggle("on", EDIT); fab.textContent = EDIT ? "✓ Done customizing" : "✏️ Customize"; }
    if (EDIT) { bar = document.createElement("div"); bar.className = "cx-bar"; bar.textContent = "Customize mode · tap any text, dropdown or form · changes are drafts until released in Studio"; document.body.appendChild(bar); document.addEventListener("click", onClick, true); document.addEventListener("mouseover", onHover, true); document.addEventListener("pointerdown", onDown, true); document.addEventListener("mousedown", onDown, true); document.addEventListener("touchstart", onDown, { capture: true, passive: false }); addFieldButtons(); }
    else { if (bar) bar.remove(); document.removeEventListener("click", onClick, true); document.removeEventListener("mouseover", onHover, true); document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("mousedown", onDown, true); document.removeEventListener("touchstart", onDown, { capture: true, passive: false }); [].forEach.call(document.querySelectorAll("[data-cx-ob]"), function (x) { x.removeAttribute("data-cx-ob"); }); if (hoverEl) hoverEl.classList.remove("cx-hl"); [].forEach.call(document.querySelectorAll(".cx-add"), function (x) { x.remove(); }); closePanel(); }
    autoForms(); if (EDIT) addFieldButtons();
    [].forEach.call(document.querySelectorAll("[data-cx-hidden]"), function (el) { el.style.display = EDIT ? "" : "none"; el.style.opacity = EDIT ? ".35" : ""; el.style.outline = EDIT ? "2px dashed #E05757" : ""; });
  }
  function onHover(e) { var t = pickTarget(e.target); if (hoverEl && hoverEl !== t) hoverEl.classList.remove("cx-hl"); hoverEl = t; if (t) t.classList.add("cx-hl"); }
  function ownText(el) { var s = ""; [].forEach.call(el.childNodes, function (c) { if (c.nodeType === 3) s += c.nodeValue; }); return s.trim(); }
  function pickTarget(el) {
    if (!el || !el.closest || el.closest(".cx-panel,.cx-fab,.cx-bar")) return null;
    if (el.closest(".cx-add")) return null;
    var lst = el.closest("[data-list]"); if (lst) return lst;
    if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.getAttribute("placeholder")) return el;
    var x = el; for (var i = 0; i < 4 && x; i++) { if (ownText(x)) return x; x = x.parentElement; }
    return null;
  }
  function listTarget(el) {
    if (!el || !el.closest || el.closest(".cx-panel,.cx-fab,.cx-bar,.cx-add")) return null;
    var l = el.closest("[data-list]"); if (l) return l;
    var sel = el.closest("select"); if (sel && autoKey(sel)) return sel;
    return null;
  }
  var lastDown = 0;
  function onDown(e) {
    var t = listTarget(e.target); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (Date.now() - lastDown < 600) return; lastDown = Date.now();
    if (t.blur) try { t.blur(); } catch (x) { }
    openList(t);
  }
  function openList(t) {
    if (t.hasAttribute("data-list")) return listPanel(t.getAttribute("data-list"), t);
    var o = origOpts(t), ph = o.length && /^(choose|select|all\b|--)/i.test(o[0][0]) && o[0][1] === "";
    listPanel(autoKey(t), t, (ph ? o.slice(1) : o).map(function (x) { return x[0]; }));
  }
  function onClick(e) {
    if (e.target.closest && (e.target.closest(".cx-panel") || e.target.closest(".cx-fab") || e.target.closest(".cx-add"))) return;
    e.preventDefault(); e.stopPropagation();
    var lt = listTarget(e.target); if (lt) { if (Date.now() - lastDown > 600) { lastDown = Date.now(); openList(lt); } return; }
    var t = pickTarget(e.target); if (!t) return;
    textPanel(t);
  }
  var panel = null, selEl = null;
  function closePanel() { if (panel) panel.remove(); panel = null; if (selEl) selEl.classList.remove("cx-sel"); selEl = null; }
  function openPanel(html) { closePanel(); panel = document.createElement("div"); panel.className = "cx-panel"; panel.innerHTML = html; document.body.appendChild(panel); panel.addEventListener("click", function (e) { e.stopPropagation(); }); return panel; }
  function save(item, release) {
    item.page = item.page || PAGE;
    return api({ action: "cust-save", item: item }).then(function (r) {
      if (!r.ok) { toast(r.error || "Couldn't save"); return null; }
      var p = release ? api({ action: "cust-release", id: r.item.id, status: "released", audience: { roles: [], users: [], states: [] } }) : Promise.resolve();
      return p.then(function () { toast(release ? "Released to everyone" : "Saved as draft — only masters see it until you release it in Studio"); closePanel(); return refresh().then(function () { apply(); return r.item; }); });
    });
  }
  function textPanel(el) {
    var isAttr = (el.tagName === "INPUT" || el.tagName === "TEXTAREA"), orig = isAttr ? (el.getAttribute("data-cx-oplaceholder") || el.getAttribute("placeholder")) : (function () { var s = ""; [].forEach.call(el.childNodes, function (c) { if (c.nodeType === 3) s += ORIG.has(c) ? ORIG.get(c) : c.nodeValue; }); return s.trim(); })();
    var existing = mine("text").find(function (x) { return x.match === orig && (x.attr || "") === (isAttr ? "placeholder" : ""); });
    var hid = mine("hide").find(function (x) { return x.match === orig; });
    selEl = el; el.classList.add("cx-sel");
    var up = hid ? hid.up || 0 : 0;
    var pn = openPanel("<h4>✏️ " + (isAttr ? "Placeholder" : "Text") + " on this screen</h4><small>Original</small><div style=\"font-weight:700;margin:2px 0 8px\">" + esc(orig) + '</div><small>New wording</small><input id="cxv" value="' + esc(existing ? existing.value : orig) + '">' +
      (isAttr ? "" : '<div class="r" style="align-items:center"><small style="flex:1">Hide: <b id="cxlv"></b></small><button id="cxm">− smaller</button><button id="cxp">＋ bigger</button></div>') +
      '<div class="r"><button class="p" id="cxs">Save draft</button><button class="g" id="cxr">Save & release to all</button>' + (isAttr ? "" : '<button class="d" id="cxh">' + (hid ? "Unhide" : "Hide this") + "</button>") + (existing ? '<button class="d" id="cxx">Reset wording</button>' : "") + '<button id="cxc">Cancel</button></div><small>Targeted release (roles, states, user IDs) is in 🧩 Studio.</small>');
    var target = function () { var x = el; for (var i = 0; i < up && x.parentElement && x.parentElement !== document.body; i++) x = x.parentElement; return x; };
    var show = function () { if (selEl) selEl.classList.remove("cx-sel"); selEl = target(); selEl.classList.add("cx-sel"); var lv = pn.querySelector("#cxlv"); if (lv) lv.textContent = up === 0 ? "just this text" : up === 1 ? "its box" : "a bigger section (" + up + ")"; };
    if (!isAttr) { show(); pn.querySelector("#cxm").onclick = function () { if (up > 0) { up--; show(); } }; pn.querySelector("#cxp").onclick = function () { if (up < 6) { up++; show(); } }; }
    var doSave = function (rel) { var v = pn.querySelector("#cxv").value.trim(); if (!v || v === orig && !existing) return closePanel(); save({ id: existing ? existing.id : "", kind: "text", match: orig, value: v, attr: isAttr ? "placeholder" : "" }, rel); };
    pn.querySelector("#cxs").onclick = function () { doSave(false); };
    pn.querySelector("#cxr").onclick = function () { doSave(true); };
    if (pn.querySelector("#cxh")) pn.querySelector("#cxh").onclick = function () { if (hid) api({ action: "cust-delete", id: hid.id }).then(function () { location.reload(); }); else save({ kind: "hide", match: orig, up: up }, false); };
    if (pn.querySelector("#cxx")) pn.querySelector("#cxx").onclick = function () { api({ action: "cust-delete", id: existing.id }).then(function () { location.reload(); }); };
    pn.querySelector("#cxc").onclick = closePanel;
  }
  function listPanel(key, el, defs) {
    var def = defs || []; if (!defs) try { def = JSON.parse(el.getAttribute("data-list-default") || "[]"); } catch (e) { }
    var cur = CUST.list(key, def), existing = DATA.items.find(function (x) { return x.kind === "list" && x.listKey === key; });
    selEl = el; el.classList.add("cx-sel");
    var pn = openPanel('<h4>📋 Dropdown options</h4><small>One option per line — add, remove, rename or reorder.</small><textarea id="cxl" rows="9">' + esc(cur.join("\n")) + '</textarea><div class="r"><button class="p" id="cxs">Save draft</button><button class="g" id="cxr">Save & release to all</button>' + (existing ? '<button class="d" id="cxx">Back to default</button>' : "") + '<button id="cxc">Cancel</button></div><small>Existing records keep their old values.</small>');
    var doSave = function (rel) { var items = pn.querySelector("#cxl").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean); if (!items.length) return toast("Add at least one option."); save({ id: existing ? existing.id : "", kind: "list", listKey: key, items: items, page: key.indexOf("auto:") === 0 ? PAGE : "*" }, rel).then(function (it) {
      if (typeof window.__custChanged === "function") window.__custChanged();
      // a form already open in a pop-up keeps its old options until it is opened again
      if (it && key.indexOf("auto:") !== 0 && el.isConnected && el.tagName !== "SELECT") toast("Saved ✓ — close and reopen this form to see the new options");
    }); };
    pn.querySelector("#cxs").onclick = function () { doSave(false); }; pn.querySelector("#cxr").onclick = function () { doSave(true); };
    if (pn.querySelector("#cxx")) pn.querySelector("#cxx").onclick = function () { api({ action: "cust-delete", id: existing.id }).then(function () { if (key.indexOf("auto:") === 0) return location.reload(); refresh().then(function () { closePanel(); if (window.__custChanged) window.__custChanged(); }); }); };
    pn.querySelector("#cxc").onclick = closePanel;
  }
  function addFieldButtons() {
    [].forEach.call(document.querySelectorAll("[data-list],select"), function (el) {
      if (el.hasAttribute("data-cx-ob") || el.closest(".cx-panel")) return;
      if (el.tagName === "SELECT" && !el.hasAttribute("data-list") && !autoKey(el)) return;
      if (el.tagName === "SELECT" && !el.hasAttribute("data-list") && el.parentElement && el.parentElement.closest("[data-list]")) return;
      el.setAttribute("data-cx-ob", "1");
      var b = document.createElement("button"); b.type = "button"; b.className = "cx-add cx-opt"; b.textContent = "📋 Edit options";
      b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openList(el); };
      el.insertAdjacentElement("afterend", b);
    });
    [].forEach.call(document.querySelectorAll("[data-form]"), function (box) {
      box.style.display = "";
      if (box.querySelector(":scope > .cx-add")) return;
      var b = document.createElement("button"); b.type = "button"; b.className = "cx-add"; b.textContent = "＋ Add a field to this form";
      b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); fieldPanel(box.getAttribute("data-form")); };
      box.appendChild(b);
    });
  }
  var TYPES = [["text", "Short text"], ["longtext", "Long text / paragraph"], ["number", "Number"], ["select", "Dropdown (pick one)"], ["multi", "Checkboxes (pick many)"], ["yesno", "Yes / No"], ["rating", "Star rating"], ["scale", "Scale 0–10"],
    ["date", "Date"], ["time", "Time"], ["datetime", "Date & time"], ["email", "Email"], ["phone", "Phone"], ["photo", "Photo"], ["location", "GPS location"], ["checkbox", "Tick box (agree / confirm)"], ["heading", "Section title / note"]];
  CUST.TYPES = TYPES;
  function fieldPanel(formKey) {
    var pn = openPanel('<h4>＋ New field</h4><small>Label / question</small><input id="fl" placeholder="e.g. Display condition"><small>Type</small><select id="ft">' + TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + "</option>"; }).join("") + "</select>" +
      '<div id="fo" style="display:none"><small>Options (one per line)</small><textarea id="fop" rows="5"></textarea></div><small>Hint shown inside the box (optional)</small><input id="fph"><small>Help text under the field (optional)</small><input id="fh"><label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="fr" style="width:auto;margin:0"> Required</label>' +
      '<div class="r"><button class="p" id="fs">Save draft</button><button class="g" id="fg">Save & release to all</button><button id="fc">Cancel</button></div><small>Answers are saved with each submission — see them in 🧩 Studio → Changes → 📊 Answers. Edit or remove fields there too.</small>');
    pn.querySelector("#ft").onchange = function () { pn.querySelector("#fo").style.display = /select|multi/.test(this.value) ? "" : "none"; };
    var doSave = function (rel) { var l = pn.querySelector("#fl").value.trim(); if (!l) return toast("Enter the label."); save({ kind: "fields", formKey: formKey, page: "*", fields: [{ label: l, type: pn.querySelector("#ft").value, options: pn.querySelector("#fop").value, required: pn.querySelector("#fr").checked, placeholder: pn.querySelector("#fph").value, help: pn.querySelector("#fh").value }] }, rel).then(function () { if (window.__custChanged) window.__custChanged(); autoForms(); }); };
    pn.querySelector("#fs").onclick = function () { doSave(false); }; pn.querySelector("#fg").onclick = function () { doSave(true); }; pn.querySelector("#fc").onclick = closePanel;
  }


  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { start(); refresh(); }); else { start(); refresh(); }
})();
