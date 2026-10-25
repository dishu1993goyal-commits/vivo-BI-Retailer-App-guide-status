// Dashboard extras: admin-editable featured banners (change picture, link, order, show/hide, schedule, add new).
// The banners in the dashboard file stay as they are; HO's changes come from the server and apply on the web and in both apps.
(function () {
  "use strict";
  if (window.__dashx) return; window.__dashx = 1;
  var BUILT = { fold: "bnr-fold", bi: "bnr-bi", v80: "bnr-v80" }, NAMES = { fold: "Retailer App (X Fold6)", bi: "Insights that drive growth", v80: "vivo V80" };
  var ORIG = {}, TIMER = null, CFG = { builtins: { fold: { on: true, link: "" }, bi: { on: true, link: "" }, v80: { on: true, link: "" } }, items: [], order: ["b:fold", "b:bi", "b:v80"] };
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function auth() {
    var a = null;
    try { a = window.BIApp && window.BIApp.getAuth ? JSON.parse(window.BIApp.getAuth()) : null; } catch (e) { a = null; }
    if ((!a || !a.token) && window.__BI_AUTH && window.__BI_AUTH.token) a = window.__BI_AUTH;
    if (!a || !a.token) { try { var w = JSON.parse(ls("biw-auth") || "null"); if (w && w.token) a = { app: w.app, username: w.username, token: w.token }; } catch (e) { } }
    return a;
  }
  function post(body) { var a = auth(); return fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json", "X-BI-App": "1" }, body: JSON.stringify(Object.assign({ app: (a && a.app) || "state", username: a && a.username, token: a && a.token }, body)) }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: "No internet connection." }; }); }
  function isAdmin() { var a = auth(); return !!(a && a.app === "admin"); }
  function today() { var d = new Date(Date.now() + 5.5 * 3600000); return d.toISOString().slice(0, 10); }
  function live(x) { var d = today(); return x.on !== false && (!x.from || x.from <= d) && (!x.to || x.to >= d); }
  function grab() { Object.keys(BUILT).forEach(function (k) { if (!ORIG[k]) { var el = document.getElementById(BUILT[k]); if (el) ORIG[k] = el; } }); return !!document.getElementById("bnr-track"); }
  function openLink(link, newTab) {
    if (!link) return;
    if (/^t:/.test(link)) { var f = link.slice(2).split("#"); try { if (window.BIApp && window.BIApp.openTool) return window.BIApp.openTool(f[0], "", f[1] ? "#" + f[1] : "#list"); } catch (e) { } location.href = f[0] + (f[1] ? "#" + f[1] : ""); return; }
    if (/^#/.test(link)) { location.hash = link; return; }
    if (newTab) window.open(link, "_blank", "noopener"); else location.href = link;
  }
  function slideFor(id, c) {
    if (/^b:/.test(id)) {
      var k = id.slice(2), b = c.builtins[k] || {}, o = ORIG[k]; if (!o || b.on === false) return null;
      if (!b.link) return o;   // unchanged: keeps the dashboard's own behaviour
      var n = document.createElement("a"); n.className = o.className; n.id = o.id; n.href = b.link; n.title = b.title || o.title || "";
      n.innerHTML = o.innerHTML; n.addEventListener("click", function (e) { e.preventDefault(); openLink(b.link, b.newTab); });
      return n;
    }
    var x = c.items.find(function (i) { return i.id === id; }); if (!x || !live(x)) return null;
    var a = document.createElement(x.link ? "a" : "div"); a.className = "bnr-s"; a.setAttribute("data-bx", x.id); if (x.link) { a.href = x.link; a.title = x.title || ""; a.addEventListener("click", function (e) { e.preventDefault(); openLink(x.link, x.newTab); }); }
    a.innerHTML = '<img src="' + esc(x.img) + '" alt="' + esc(x.title || "Banner") + '" loading="lazy">';
    return a;
  }
  function apply(c) {
    if (!grab()) return;
    var old = document.getElementById("bnr-track"), sec = document.getElementById("bnr");
    var tr = old.cloneNode(false); var slides = c.order.map(function (id) { return slideFor(id, c); }).filter(Boolean);
    if (!slides.length) { if (sec) sec.style.display = isAdmin() ? "" : "none"; }
    else if (sec) sec.style.display = "";
    slides.forEach(function (s) { tr.appendChild(s); });
    old.parentNode.replaceChild(tr, old);
    ["bnr-dots", "bnr-prev", "bnr-next"].forEach(function (id) { var e = document.getElementById(id); if (e) { var n = e.cloneNode(false); if (id !== "bnr-dots") n.innerHTML = e.innerHTML; e.parentNode.replaceChild(n, e); } });
    carousel(tr);
    editButton();
  }
  function carousel(tr) {
    var dots = document.getElementById("bnr-dots"), n = tr.children.length, cur = 0;
    clearInterval(TIMER); if (dots) dots.innerHTML = "";
    for (var i = 0; i < n; i++) (function (i) { var d = document.createElement("button"); d.type = "button"; d.setAttribute("aria-label", "Banner " + (i + 1)); d.onclick = function () { go(i, true); }; dots && dots.appendChild(d); })(i);
    var mark = function () { if (dots) Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle("on", i === cur); }); };
    var go = function (i, user) { if (!n) return; cur = (i + n) % n; tr.scrollTo({ left: tr.clientWidth * cur, behavior: "smooth" }); mark(); if (user) restart(); };
    var restart = function () { clearInterval(TIMER); if (n > 1) TIMER = setInterval(function () { if (!document.hidden && !tr.matches(":hover") && document.body.contains(tr)) go(cur + 1); }, 7000); };
    tr.addEventListener("scroll", function () { var i = Math.round(tr.scrollLeft / Math.max(1, tr.clientWidth)); if (i !== cur) { cur = i; mark(); } });
    var p = document.getElementById("bnr-prev"), x = document.getElementById("bnr-next");
    if (p) { p.onclick = function () { go(cur - 1, true); }; p.style.display = n > 1 ? "" : "none"; } if (x) { x.onclick = function () { go(cur + 1, true); }; x.style.display = n > 1 ? "" : "none"; }
    mark(); restart();
  }
  // ---------- admin editor ----------
  var CSS = ".bx-eb{position:absolute;top:8px;right:28px;z-index:5;border:0;border-radius:99px;padding:7px 12px;font:600 12.5px system-ui,sans-serif;background:rgba(17,17,17,.82);color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}" +
    "@media(max-width:640px){.bx-eb{right:20px;top:6px}}" +
    ".bx-ov{position:fixed;inset:0;background:rgba(10,12,24,.55);z-index:99998;display:flex;align-items:flex-end;justify-content:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".bx-s{background:#fff;color:#141833;width:100%;max-width:640px;max-height:92vh;overflow:auto;border-radius:20px 20px 0 0;padding:16px 16px 20px;box-sizing:border-box}@media(min-width:700px){.bx-ov{align-items:center}.bx-s{border-radius:20px}}" +
    ".bx-s h3{margin:0;font-size:18px}.bx-m{color:#6B7088;font-size:12.5px}.bx-it{border:1px solid #E3E5EF;border-radius:14px;padding:10px;margin-top:10px;display:grid;grid-template-columns:96px 1fr;gap:10px}" +
    ".bx-it.off{opacity:.55}.bx-th{width:96px;height:54px;border-radius:9px;background:#EEF0F6 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:11px;color:#6B7088;text-align:center;overflow:hidden}" +
    ".bx-it b{font-size:13.5px}.bx-it input[type=text],.bx-it input[type=url],.bx-it input[type=date]{width:100%;border:1px solid #D5D8E6;border-radius:8px;padding:6px 8px;font:inherit;font-size:12.5px;box-sizing:border-box;margin-top:4px}" +
    ".bx-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}.bx-row label{font-size:12px;display:flex;gap:5px;align-items:center}.bx-b{border:0;border-radius:9px;padding:7px 11px;font:600 12.5px inherit;cursor:pointer;background:#F0F1F8;color:#2A2F4A}" +
    ".bx-b.p{background:#415FFF;color:#fff}.bx-b.r{background:#FDECEC;color:#B3402F}.bx-chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px}.bx-chips span{font-size:11px;border:1px solid #DDE0EF;border-radius:99px;padding:2px 8px;cursor:pointer}" +
    ".bx-note{background:#FFF6DD;color:#7A5300;border-radius:10px;padding:8px 10px;font-size:12.5px;margin-top:10px}.bx-ok{background:#E6F4EA;color:#0F6B43}";
  function css() { if (document.getElementById("bx-css")) return; var s = document.createElement("style"); s.id = "bx-css"; s.setAttribute("data-bt-skip", "1"); s.textContent = CSS; document.head.appendChild(s); }
  function editButton() {
    if (!isAdmin()) return; var inn = document.querySelector("#bnr .bnr-in"); if (!inn || document.getElementById("bx-eb")) return;
    css(); var b = document.createElement("button"); b.id = "bx-eb"; b.className = "bx-eb"; b.type = "button"; b.setAttribute("data-bt-skip", "1"); b.textContent = "✏️ Edit banners"; b.onclick = function (e) { e.preventDefault(); editor(); }; inn.appendChild(b);
  }
  function thumbOf(id, c) {
    if (/^b:/.test(id)) { var o = ORIG[id.slice(2)], im = o && o.querySelector("img.bf-ph, img"); return im ? im.src : ""; }
    var x = c.items.find(function (i) { return i.id === id; }); return x ? x.img : "";
  }
  function resize(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { var k = Math.min(1, 1600 / im.naturalWidth), c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); var q = 0.85, d = c.toDataURL("image/jpeg", q); while (d.length > 1400000 && q > 0.4) { q -= 0.1; d = c.toDataURL("image/jpeg", q); } res({ data: d, w: c.width, h: c.height }); };
      im.onerror = function () { rej(new Error("Couldn't open this picture. Use a JPG or PNG.")); }; im.src = u;
    });
  }
  function editor() {
    css();
    var D = JSON.parse(JSON.stringify(CFG));
    var ov = document.createElement("div"); ov.className = "bx-ov"; ov.setAttribute("data-bt-skip", "1"); document.body.appendChild(ov);
    var draw = function (msg) {
      var h = '<div class="bx-s"><h3>🖼️ Banners on the dashboard</h3><div class="bx-m">Change the picture or link, reorder, hide, schedule or add banners. Saving updates the dashboard for everyone — web and both apps. Best size: 1600 × 900 (16:9).</div>';
      D.order.forEach(function (id, i) {
        var bi = /^b:/.test(id), k = id.slice(2), x = bi ? D.builtins[k] : D.items.find(function (q) { return q.id === id; }); if (!x) return;
        var th = thumbOf(id, D), on = bi ? x.on !== false : x.on !== false;
        h += '<div class="bx-it' + (on ? "" : " off") + '"><div class="bx-th" style="' + (th ? "background-image:url('" + esc(th) + "')" : "") + '">' + (th ? "" : "picture") + "</div><div>" +
          "<b>" + esc(bi ? NAMES[k] : x.title || "Banner " + (i + 1)) + "</b>" + (bi ? ' <span class="bx-m">· built into the dashboard</span>' : "") +
          (bi ? "" : '<input type="text" data-f="title" data-id="' + id + '" value="' + esc(x.title) + '" placeholder="Title (shown to screen readers and admins)">') +
          '<input type="text" data-f="link" data-id="' + id + '" value="' + esc(x.link) + '" placeholder="' + (bi ? "Link (empty = keep the dashboard's own action)" : "Link — https://… or a tool (optional)") + '">' +
          '<div class="bx-chips">' + [["Retailer app tab", "#app"], ["All tools", "t:hub.html"], ["Scheme calculator", "t:schemecalc.html"], ["Affordability", "t:affordability.html"], ["Guide", "t:guide.html"]].map(function (c) { return '<span data-chip="' + c[1] + '" data-id="' + id + '">' + c[0] + "</span>"; }).join("") + "</div>" +
          '<div class="bx-row"><label><input type="checkbox" data-f="on" data-id="' + id + '"' + (on ? " checked" : "") + "> Show</label><label><input type=\"checkbox\" data-f=\"newTab\" data-id=\"" + id + '"' + (x.newTab ? " checked" : "") + "> Open in browser</label>" +
          (bi ? "" : '<label>From <input type="date" data-f="from" data-id="' + id + '" value="' + esc(x.from) + '"></label><label>To <input type="date" data-f="to" data-id="' + id + '" value="' + esc(x.to) + '"></label>') + "</div>" +
          '<div class="bx-row"><button class="bx-b" data-mv="-1" data-id="' + id + '"' + (i ? "" : " disabled") + '>↑</button><button class="bx-b" data-mv="1" data-id="' + id + '"' + (i < D.order.length - 1 ? "" : " disabled") + ">↓</button>" +
          (bi ? "" : '<button class="bx-b" data-rp="' + id + '">🖼 Change picture</button><button class="bx-b r" data-del="' + id + '">Delete</button>') + "</div></div></div>";
      });
      h += '<div class="bx-row" style="margin-top:12px"><button class="bx-b" id="bx-add">＋ Add banner (upload picture)</button><button class="bx-b" id="bx-addu">＋ Add from a picture link</button></div><div class="bx-row" id="bx-ur" style="display:none"><input type="url" id="bx-uv" placeholder="https://… picture link" style="flex:1;border:1px solid #D5D8E6;border-radius:8px;padding:7px;font:inherit;font-size:12.5px"><button class="bx-b p" id="bx-ua">Add</button></div>' + (msg || "") +
        '<div class="bx-row" style="justify-content:flex-end;margin-top:14px"><button class="bx-b" id="bx-x">Close</button><button class="bx-b p" id="bx-sv">💾 Save for everyone</button></div></div>';
      ov.innerHTML = h;
      var get = function (id) { return /^b:/.test(id) ? D.builtins[id.slice(2)] : D.items.find(function (q) { return q.id === id; }); };
      Array.prototype.forEach.call(ov.querySelectorAll("[data-f]"), function (e) { e.oninput = e.onchange = function () { var x = get(e.getAttribute("data-id")), f = e.getAttribute("data-f"); x[f] = e.type === "checkbox" ? e.checked : e.value; if (f === "on") e.closest(".bx-it").classList.toggle("off", !e.checked); }; });
      Array.prototype.forEach.call(ov.querySelectorAll("[data-chip]"), function (e) { e.onclick = function () { var x = get(e.getAttribute("data-id")); x.link = e.getAttribute("data-chip"); x.newTab = false; draw(); }; });
      Array.prototype.forEach.call(ov.querySelectorAll("[data-mv]"), function (e) { e.onclick = function () { var id = e.getAttribute("data-id"), i = D.order.indexOf(id), j = i + (+e.getAttribute("data-mv")); if (j < 0 || j >= D.order.length) return; D.order.splice(i, 1); D.order.splice(j, 0, id); draw(); }; });
      Array.prototype.forEach.call(ov.querySelectorAll("[data-del]"), function (e) { e.onclick = function () { var id = e.getAttribute("data-del"); D.items = D.items.filter(function (q) { return q.id !== id; }); D.order = D.order.filter(function (q) { return q !== id; }); draw(); }; });
      var upload = function (cb) {
        var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
        inp.onchange = function () { var f = inp.files[0]; if (!f) return; draw('<div class="bx-note">Uploading ' + esc(f.name) + "…</div>"); resize(f).then(function (r) { return post({ action: "bnr-upload", data: r.data }).then(function (x) { if (!x.ok) throw new Error(x.error); cb(x.url, r); }); }).catch(function (er) { draw('<div class="bx-note">' + esc(er.message) + "</div>"); }); };
        inp.click();
      };
      Array.prototype.forEach.call(ov.querySelectorAll("[data-rp]"), function (e) { e.onclick = function () { var x = get(e.getAttribute("data-rp")); upload(function (u, r) { x.img = u; draw(r.w / r.h < 1.5 || r.w / r.h > 2.1 ? '<div class="bx-note">Tip: this picture is ' + r.w + "×" + r.h + " — 16:9 pictures fit best (edges may be cut).</div>" : ""); }); }; });
      var add = function (img, r) { var id = "x" + Date.now().toString(36); D.items.push({ id: id, img: img, title: "", link: "", newTab: true, on: true }); D.order.splice(0, 0, id); draw(r && (r.w / r.h < 1.5 || r.w / r.h > 2.1) ? '<div class="bx-note">Added at the top. This picture is ' + r.w + "×" + r.h + " — 16:9 fits best.</div>" : '<div class="bx-note bx-ok">Added at the top — add a link, then Save.</div>'); };
      ov.querySelector("#bx-add").onclick = function () { upload(add); };
      ov.querySelector("#bx-addu").onclick = function () { ov.querySelector("#bx-ur").style.display = "flex"; ov.querySelector("#bx-uv").focus(); };
      ov.querySelector("#bx-ua").onclick = function () { var u = ov.querySelector("#bx-uv").value.trim(); if (/^https:\/\/\S+$/.test(u)) add(u); else ov.querySelector("#bx-uv").style.borderColor = "#D93B3B"; };
      ov.querySelector("#bx-x").onclick = function () { ov.remove(); };
      ov.querySelector("#bx-sv").onclick = function () {
        this.disabled = true;
        post({ action: "bnr-save", banners: D }).then(function (r) {
          if (!r.ok) return draw('<div class="bx-note">' + esc(r.error || "Couldn't save.") + "</div>");
          CFG = r.banners; ls("biw-bnr", JSON.stringify(CFG)); apply(CFG); draw('<div class="bx-note bx-ok">✅ Saved — everyone sees the new banners on their next open.</div>');
        });
      };
    };
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    draw();
  }
  function start() {
    if (!grab()) return setTimeout(start, 400);
    var cached = null; try { cached = JSON.parse(ls("biw-bnr") || "null"); } catch (e) { cached = null; }
    if (cached && cached.order) { CFG = cached; apply(CFG); } else editButton();
    post({ action: "bnr-get" }).then(function (r) {
      if (!r || !r.ok) return;
      var changed = JSON.stringify(r.banners) !== JSON.stringify(CFG); CFG = r.banners; ls("biw-bnr", JSON.stringify(CFG));
      if (changed && (CFG.items.length || CFG.order.join() !== "b:fold,b:bi,b:v80" || Object.keys(CFG.builtins).some(function (k) { var b = CFG.builtins[k]; return b.on === false || b.link; }))) apply(CFG);
      editButton();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(start, 50); }); else setTimeout(start, 50);
  var eb = 0, ebT = setInterval(function () { if (CFG) editButton(); if (++eb > 20 || document.getElementById("bx-eb")) clearInterval(ebT); }, 2000);
  window.DASHX = { banners: function () { return CFG; }, edit: function () { if (CFG) editor(); } };
})();
