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
    renderFields: function (box, fs, values, onChange, formKey) {
      values = values || {}; formKey = formKey || "tool";
      box.style.display = "";
      box.innerHTML = fs.map(function (f) {
        var v = values[f.key], id = "cx_" + formKey.replace(/\W/g, "") + "_" + f.key, lab = '<label class="cx-l" for="' + id + '">' + esc(f.label) + (f.required ? ' <b style="color:#E05757">*</b>' : "") + (f.draft ? ' <span class="cx-d">draft</span>' : "") + "</label>";
        if (f.type === "select") return lab + '<select class="tx" id="' + id + '" data-k="' + f.key + '"><option value="">Choose…</option>' + f.options.map(function (o) { return "<option" + (v === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>";
        if (f.type === "multi") return lab + '<div class="cx-ch" data-k="' + f.key + '" data-multi="1">' + f.options.map(function (o) { return '<button type="button" class="' + ((v || []).indexOf(o) >= 0 ? "on" : "") + '">' + esc(o) + "</button>"; }).join("") + "</div>";
        if (f.type === "yesno") return lab + '<div class="cx-ch" data-k="' + f.key + '"><button type="button" class="' + (v === "Yes" ? "on" : "") + '">Yes</button><button type="button" class="' + (v === "No" ? "on" : "") + '">No</button></div>';
        if (f.type === "rating") return lab + '<div class="cx-ch" data-k="' + f.key + '">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="' + (String(v) === String(n) ? "on" : "") + '">' + n + "★</button>"; }).join("") + "</div>";
        if (f.type === "longtext") return lab + '<textarea class="tx" id="' + id + '" data-k="' + f.key + '">' + esc(v || "") + "</textarea>";
        if (f.type === "photo") return lab + '<div class="row"><button type="button" class="btn sec sm" data-photo="' + f.key + '">📷 ' + (v ? "Change photo" : "Add photo") + '</button><span class="cx-pn" style="font-size:12px;color:#6B7090">' + (v ? "✓ added" : "") + '</span></div><input type="hidden" data-k="' + f.key + '" value="' + esc(v || "") + '">';
        return lab + '<input class="tx" id="' + id + '" data-k="' + f.key + '" type="' + (f.type === "number" ? "number" : f.type === "date" ? "date" : "text") + '" value="' + esc(v == null ? "" : v) + '">' + (f.help ? '<div style="font-size:11.5px;color:#6B7090">' + esc(f.help) + "</div>" : "");
      }).join("");
      var fire = function () { if (onChange) onChange(collectRaw()); };
      [].forEach.call(box.querySelectorAll("input[data-k],select[data-k],textarea[data-k]"), function (i) { i.addEventListener("input", fire); i.addEventListener("change", fire); });
      [].forEach.call(box.querySelectorAll(".cx-ch"), function (g) { [].forEach.call(g.children, function (b) { b.onclick = function () { if (EDIT) return; if (g.dataset.multi) b.classList.toggle("on"); else [].forEach.call(g.children, function (x) { x.classList.toggle("on", x === b && !b.classList.contains("on")); }); fire(); }; }); });
      [].forEach.call(box.querySelectorAll("[data-photo]"), function (b) { b.onclick = function () { pickPhoto(function (id) { box.querySelector('input[data-k="' + b.dataset.photo + '"]').value = id; b.parentNode.querySelector(".cx-pn").textContent = "✓ added"; fire(); }); }; });
      function collectRaw() {
        var o = {};
        fs.forEach(function (f) {
          var el = box.querySelector('[data-k="' + f.key + '"]'); if (!el) return;
          if (el.classList.contains("cx-ch")) { var on = [].filter.call(el.children, function (x) { return x.classList.contains("on"); }).map(function (x) { return x.textContent.replace("★", ""); }); o[f.key] = el.dataset.multi ? on : on[0] || ""; }
          else o[f.key] = el.value;
        });
        return o;
      }
      return { count: fs.length, collect: function (quiet) { var o = collectRaw(), miss = fs.filter(function (f) { var v = o[f.key]; return f.required && (v === "" || v == null || (Array.isArray(v) && !v.length)); }); if (miss.length && !quiet) { toast("Please fill: " + miss.map(function (f) { return f.label; }).join(", ")); return null; } return o; } };
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
    } finally { applying = false; }
  }
  function markDraft(el, draft) { if (DATA.master && draft && el && el.style) el.style.boxShadow = "inset 0 -2px 0 #F5A623"; }
  var pend = 0;
  function schedule() { if (pend) return; pend = requestAnimationFrame(function () { pend = 0; apply(); if (EDIT) addFieldButtons(); }); }
  function start() {
    apply();
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
      apply();
      if (DATA.master && !wasMaster) masterUi();
      var after = JSON.stringify(DATA.items.filter(function (x) { return x.kind === "list" || x.kind === "fields" || x.kind === "tool"; }).map(function (x) { return [x.id, x.updatedAt]; }));
      if (before !== after && typeof window.__custChanged === "function") window.__custChanged();
    });
  }

  // ---------- master: ✏️ Customize mode ----------
  var css = ".cx-l{display:block;font-size:12px;color:#6B7090;font-weight:600;margin:10px 2px 3px}.cx-d{background:#FFF4E5;color:#B26A00;border-radius:6px;padding:0 5px;font-size:10.5px}" +
    ".cx-ch{display:flex;flex-wrap:wrap;gap:6px}.cx-ch button{border:1px solid #D8DAE5;background:#fff;border-radius:99px;padding:6px 12px;font:600 13px inherit;cursor:pointer}.cx-ch button.on{background:#EEF0FF;border-color:#4D5BF9;color:#2B33A6}" +
    ".cx-fab{position:fixed;left:12px;bottom:14px;z-index:2147483000;border:0;border-radius:99px;padding:10px 14px;font:700 13px Segoe UI,Arial;background:#1F2340;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer}" +
    "body:has(.biw-frame) .cx-fab,body:has(.biw-frame) .cx-bar{display:none!important}.cx-fab.on{background:#F5A623;color:#1F2340}.cx-bar{position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#F5A623;color:#1F2340;font:700 12.5px Segoe UI,Arial;padding:7px 12px;text-align:center}" +
    ".cx-hl{outline:2px solid #F5A623!important;outline-offset:2px;cursor:pointer!important}.cx-sel{outline:3px solid #E05757!important;outline-offset:2px}" +
    ".cx-panel{position:fixed;left:50%;transform:translateX(-50%);bottom:12px;width:min(520px,94vw);max-height:80vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 14px 40px rgba(0,0,0,.3);z-index:2147483100;padding:14px;font:14px Segoe UI,Arial;color:#1F2340}" +
    ".cx-panel h4{margin:0 0 8px;font-size:15px}.cx-panel input,.cx-panel textarea,.cx-panel select{width:100%;box-sizing:border-box;border:1px solid #D8DAE5;border-radius:10px;padding:9px 10px;font:14px inherit;margin-top:4px}" +
    ".cx-panel .r{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.cx-panel button{border:0;border-radius:10px;padding:9px 12px;font:700 13px inherit;cursor:pointer;background:#F1F2F8;color:#1F2340}.cx-panel .p{background:#4D5BF9;color:#fff}.cx-panel .g{background:#1E9E61;color:#fff}.cx-panel .d{background:#FDECEC;color:#B3402F}" +
    ".cx-panel small{color:#6B7090;font-size:12px}.cx-add{display:block;width:100%;margin-top:10px;border:1.5px dashed #F5A623!important;background:#FFFBF2!important;color:#B26A00!important;border-radius:12px;padding:10px;font:700 13px Segoe UI,Arial;cursor:pointer}";
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
    if (EDIT) { bar = document.createElement("div"); bar.className = "cx-bar"; bar.textContent = "Customize mode · tap any text, dropdown or form · changes are drafts until released in Studio"; document.body.appendChild(bar); document.addEventListener("click", onClick, true); document.addEventListener("mouseover", onHover, true); addFieldButtons(); }
    else { if (bar) bar.remove(); document.removeEventListener("click", onClick, true); document.removeEventListener("mouseover", onHover, true); if (hoverEl) hoverEl.classList.remove("cx-hl"); [].forEach.call(document.querySelectorAll(".cx-add"), function (x) { x.remove(); }); closePanel(); }
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
  function onClick(e) {
    if (e.target.closest && (e.target.closest(".cx-panel") || e.target.closest(".cx-fab") || e.target.closest(".cx-add"))) return;
    e.preventDefault(); e.stopPropagation();
    var t = pickTarget(e.target); if (!t) return;
    if (t.hasAttribute("data-list")) return listPanel(t.getAttribute("data-list"), t);
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
  function listPanel(key, el) {
    var def = []; try { def = JSON.parse(el.getAttribute("data-list-default") || "[]"); } catch (e) { }
    var cur = CUST.list(key, def), existing = DATA.items.find(function (x) { return x.kind === "list" && x.listKey === key; });
    selEl = el; el.classList.add("cx-sel");
    var pn = openPanel('<h4>📋 Dropdown options</h4><small>One option per line — add, remove, rename or reorder.</small><textarea id="cxl" rows="9">' + esc(cur.join("\n")) + '</textarea><div class="r"><button class="p" id="cxs">Save draft</button><button class="g" id="cxr">Save & release to all</button>' + (existing ? '<button class="d" id="cxx">Back to default</button>' : "") + '<button id="cxc">Cancel</button></div><small>Existing records keep their old values.</small>');
    var doSave = function (rel) { var items = pn.querySelector("#cxl").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean); if (!items.length) return toast("Add at least one option."); save({ id: existing ? existing.id : "", kind: "list", listKey: key, items: items, page: "*" }, rel).then(function () { if (typeof window.__custChanged === "function") window.__custChanged(); }); };
    pn.querySelector("#cxs").onclick = function () { doSave(false); }; pn.querySelector("#cxr").onclick = function () { doSave(true); };
    if (pn.querySelector("#cxx")) pn.querySelector("#cxx").onclick = function () { api({ action: "cust-delete", id: existing.id }).then(function () { refresh().then(function () { closePanel(); if (window.__custChanged) window.__custChanged(); }); }); };
    pn.querySelector("#cxc").onclick = closePanel;
  }
  function addFieldButtons() {
    [].forEach.call(document.querySelectorAll("[data-form]"), function (box) {
      box.style.display = "";
      if (box.querySelector(":scope > .cx-add")) return;
      var b = document.createElement("button"); b.type = "button"; b.className = "cx-add"; b.textContent = "＋ Add a field to this form (" + box.getAttribute("data-form") + ")";
      b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); fieldPanel(box.getAttribute("data-form")); };
      box.appendChild(b);
    });
  }
  function fieldPanel(formKey) {
    var pn = openPanel('<h4>＋ New field · ' + esc(formKey) + '</h4><small>Label</small><input id="fl" placeholder="e.g. Display condition"><small>Type</small><select id="ft"><option value="text">Short text</option><option value="longtext">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Dropdown (one)</option><option value="multi">Multiple choice</option><option value="yesno">Yes / No</option><option value="rating">Rating 1–5</option><option value="photo">Photo</option></select>' +
      '<div id="fo" style="display:none"><small>Options (one per line)</small><textarea id="fop" rows="5"></textarea></div><label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="fr" style="width:auto;margin:0"> Required</label>' +
      '<div class="r"><button class="p" id="fs">Save draft</button><button class="g" id="fg">Save & release to all</button><button id="fc">Cancel</button></div><small>Existing fields can be edited or removed in 🧩 Studio → Changes.</small>');
    pn.querySelector("#ft").onchange = function () { pn.querySelector("#fo").style.display = /select|multi/.test(this.value) ? "" : "none"; };
    var doSave = function (rel) { var l = pn.querySelector("#fl").value.trim(); if (!l) return toast("Enter the label."); save({ kind: "fields", formKey: formKey, page: "*", fields: [{ label: l, type: pn.querySelector("#ft").value, options: pn.querySelector("#fop").value, required: pn.querySelector("#fr").checked }] }, rel).then(function () { if (window.__custChanged) window.__custChanged(); }); };
    pn.querySelector("#fs").onclick = function () { doSave(false); }; pn.querySelector("#fg").onclick = function () { doSave(true); }; pn.querySelector("#fc").onclick = closePanel;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { start(); refresh(); }); else { start(); refresh(); }
})();
