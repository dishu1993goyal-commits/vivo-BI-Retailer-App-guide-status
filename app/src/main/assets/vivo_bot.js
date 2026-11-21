/* vivo BI · portal task recorder & player. Runs inside a vivo portal page (Admin app runner, or a bookmark on a computer).
   window.__biBotRun(job) → JSON status; called again and again (every ~1.5 s). One small action per call.
   job: { id, mode: "rec" | "play", steps:[…], rows:[{…}], fromStart: true, stop: true }
   status s: login | rec | run | you | wait | done | stopped | err
   It never types passwords or captchas: those are recorded as "your turn" pauses and the person types them. */
(function () {
  if (window.__biBotRun) return;
  var KEY = "__bibot", W = window, D = document;
  var load = function () { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  var save = function (s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { } };
  var vis = function (el) { if (!el || !el.getBoundingClientRect) return false; var r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity !== 0; };
  var clean = function (s, n) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n || 80); };
  var SECRET = /pass(word)?|pwd|密码/i, CAPTCHA = /captcha|verif(y|ication)?[\s_-]?code|验证码|security[\s_-]?code|otp/i;
  var RISKY = /delete|remove|删除|release|publish|发布|approve|reject|submit|提交|pay\b|transfer/i;
  function loginPage() { var p = [].filter.call(D.querySelectorAll("input[type=password]"), vis); return p.length > 0 && !D.querySelector(".el-menu,.el-aside,.sidebar,nav .menu"); }
  // ---------- describing an element so it can be found again ----------
  function labelOf(el) {
    if (el.id) { var l = D.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return clean(l.textContent, 60); }
    var it = el.closest(".el-form-item,.ant-form-item,.form-group,.form-item,tr,.van-field"); if (it) { var lb = it.querySelector(".el-form-item__label,.ant-form-item-label,label,th,td:first-child,.van-field__label"); if (lb && !lb.contains(el)) return clean(lb.textContent, 60); }
    var pl = el.closest("label"); if (pl) return clean(pl.textContent, 60);
    return "";
  }
  function target(el) {
    // climb from an icon / span to the thing a person meant to tap
    var t = el.closest("button,a,[role=button],[role=menuitem],[role=option],[role=tab],li,.el-button,.el-checkbox,.el-radio,.el-switch,.el-select,.el-dropdown-menu__item,.el-select-dropdown__item,.el-tabs__item,.el-menu-item,.el-submenu__title,label,input,textarea,select,td,th,span,div");
    return t || el;
  }
  function desc(el) {
    var tag = el.tagName.toLowerCase(), d = { tag: tag };
    if (el.id && !/\d{3,}|^el-id|^[a-f0-9-]{16,}$/i.test(el.id)) d.id = el.id;
    if (el.getAttribute("name")) d.name = el.getAttribute("name");
    if (el.getAttribute("placeholder")) d.ph = clean(el.getAttribute("placeholder"), 60);
    if (el.getAttribute("aria-label")) d.aria = clean(el.getAttribute("aria-label"), 60);
    if (el.getAttribute("type")) d.type = el.getAttribute("type");
    if (el.getAttribute("role")) d.role = el.getAttribute("role");
    if (!/^(input|textarea|select)$/.test(tag)) { var tx = clean(el.innerText || el.textContent, 60); if (tx && tx.length <= 60) d.text = tx; }
    var lb = labelOf(el); if (lb) d.label = lb;
    var cls = [].filter.call(el.classList || [], function (c) { return /^(el|ant|van)-/.test(c) && !/is-|hover|focus|active/.test(c); }).slice(0, 3); if (cls.length) d.css = tag + "." + cls.join(".");
    var all = find(d, true); d.idx = Math.max(0, all.indexOf(el));
    return d;
  }
  function find(d, many) {
    var sel = d.css || d.tag || "*", list = [].slice.call(D.querySelectorAll(sel));
    if (!list.length && d.tag) list = [].slice.call(D.querySelectorAll(d.tag));
    var m = list.filter(function (el) {
      if (d.id && el.id !== d.id) return false;
      if (d.name && el.getAttribute("name") !== d.name) return false;
      if (d.ph && clean(el.getAttribute("placeholder"), 60) !== d.ph) return false;
      if (d.aria && clean(el.getAttribute("aria-label"), 60) !== d.aria) return false;
      if (d.text && clean(el.innerText || el.textContent, 60) !== d.text) return false;
      if (d.label && labelOf(el) !== d.label) return false;
      return true;
    });
    if (many) return m;
    var v = m.filter(vis), pick = v[d.idx] || v[0];
    if (!pick && d.text) pick = [].filter.call(D.querySelectorAll("button,a,span,li,div,td"), function (el) { return vis(el) && clean(el.innerText, 60) === d.text && !el.querySelector("button,a,li"); })[0];   // looser: same visible text anywhere
    return pick || null;
  }
  // ---------- doing things the way a person would ----------
  function setVal(el, v) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var set = Object.getOwnPropertyDescriptor(proto, "value").set; el.focus(); set.call(el, v);
    ["input", "change", "blur"].forEach(function (e) { el.dispatchEvent(new Event(e, { bubbles: true })); });
  }
  function tap(el) { try { el.scrollIntoView({ block: "center" }); } catch (e) { } ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(function (e) { el.dispatchEvent(new MouseEvent(e, { bubbles: true, cancelable: true, view: W })); }); el.click(); }
  function portalMsg() { var m = [].filter.call(D.querySelectorAll(".el-message,.el-notification,.ant-message-notice,.el-form-item__error,.van-toast,.layui-layer-content"), vis).map(function (x) { return clean(x.innerText, 140); }).filter(Boolean); return m.slice(-2).join(" · "); }
  // ---------- small panel on the page ----------
  var P = null;
  function panel(text, btns) {
    if (!P) { P = D.createElement("div"); P.id = "__bibotp"; P.setAttribute("style", "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:#12163A;color:#fff;font:600 13px/1.4 system-ui,sans-serif;border-radius:12px;padding:9px 11px;box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;gap:8px;align-items:center;flex-wrap:wrap"); D.body.appendChild(P); }
    var key = text + "|" + btns.map(function (b) { return b[0]; }).join(",");
    if (P.__k === key) return; P.__k = key;
    P.innerHTML = '<span style="flex:1;min-width:160px"></span>'; P.firstChild.textContent = text;
    btns.forEach(function (b) { var x = D.createElement("button"); x.textContent = b[0]; x.setAttribute("style", "border:0;border-radius:8px;padding:6px 10px;font:700 12.5px system-ui;cursor:pointer;background:" + (b[2] || "#4D5BF9") + ";color:#fff"); x.onclick = function (e) { e.stopPropagation(); e.preventDefault(); b[1](); }; P.appendChild(x); });
  }
  var inPanel = function (el) { return P && P.contains(el); };
  // ---------- recording ----------
  var hooked = false;
  function hook() {
    if (hooked) return; hooked = true;
    var push = function (st) { var S = load(); if (!S || S.mode !== "rec" || S.done) return; st.page = location.pathname + location.hash; var L = S.steps, last = L[L.length - 1]; if (last && st.a !== "click" && last.a === st.a && JSON.stringify(last.sel) === JSON.stringify(st.sel)) L[L.length - 1] = st; else L.push(st); save(S); };
    D.addEventListener("click", function (e) {
      if (inPanel(e.target) || !e.isTrusted) return;
      var el = target(e.target), tag = el.tagName.toLowerCase();
      if (/^(input|textarea|select)$/.test(tag) && !/checkbox|radio|button|submit/.test(el.type || "")) return;   // typing is recorded on change
      if (/checkbox|radio/.test(el.type || "")) return;
      var d = desc(el); if (!d.text && !d.label && !d.aria && !d.id && !d.name) { var up = el.parentElement && target(el.parentElement); if (up && up !== el) d = desc(up); }
      push({ a: "click", sel: d, risky: RISKY.test(d.text || "") || undefined });
    }, true);
    D.addEventListener("change", function (e) {
      var el = e.target; if (inPanel(el) || !el.tagName || (!e.isTrusted && el.tagName !== "SELECT")) return;
      var tag = el.tagName.toLowerCase(), d = desc(el), hint = [el.name, el.id, el.getAttribute("placeholder"), labelOf(el)].join(" ");
      if (/checkbox|radio/.test(el.type || "")) return push({ a: "check", sel: d, on: !!el.checked });
      if (tag === "select") return push({ a: "select", sel: d, v: (el.options[el.selectedIndex] || {}).text || el.value });
      if (el.type === "password" || SECRET.test(hint)) return push({ a: "pause", sel: d, secret: true, say: "Type the password" + (d.label ? " (" + d.label + ")" : "") });
      if (CAPTCHA.test(hint)) return push({ a: "pause", sel: d, secret: true, say: "Type the captcha / code" + (d.label ? " (" + d.label + ")" : "") });
      if (/^(input|textarea)$/.test(tag)) push({ a: "type", sel: d, v: el.value });
    }, true);
  }
  // ---------- one tick ----------
  W.__biBotRun = function (job) {
    var S = load();
    if (job && job.id && (!S || S.id !== job.id)) { S = { id: job.id, mode: job.mode, steps: job.mode === "rec" ? [] : job.steps || [], rows: job.rows || [{}], fromStart: job.fromStart !== false, start: job.start || location.href, row: 0, step: 0, tries: 0, res: [], at: 0, you: false, done: false }; save(S); }
    if (!S) return JSON.stringify({ s: "wait", msg: "No job" });
    if (job && job.stop) { S.stop = true; save(S); }
    if (S.done) return JSON.stringify(S.final);
    var fin = function (s, msg, extra) { S.done = true; S.final = Object.assign({ s: s, msg: msg, mode: S.mode }, extra || {}); save(S); if (P) P.remove(); P = null; return JSON.stringify(S.final); };
    if (loginPage()) { panel("🔑 Log in to the portal yourself (user ID, password, captcha). The run continues after you log in.", []); return JSON.stringify({ s: "login" }); }
    // ---- recording
    if (S.mode === "rec") {
      hook();
      if (S.stop) return fin("done", "Recorded " + S.steps.length + " steps", { steps: S.steps, url: S.start });
      var n = S.steps.length;
      panel("● Recording · " + n + " step" + (n === 1 ? "" : "s") + " — do the task once, slowly", [
        ["＋ Your-turn step", function () { var say = prompt("What should the person do here? (e.g. Type the captcha, check the details)"); if (!say) return; var x = load(); x.steps.push({ a: "pause", sel: {}, say: say.slice(0, 160) }); save(x); }, "#8A5300"],
        ["↶ Undo", function () { var x = load(); x.steps.pop(); save(x); }, "#555"],
        ["■ Finish", function () { var x = load(); x.stop = true; save(x); }, "#13693F"]
      ]);
      return JSON.stringify({ s: "rec", msg: "Recording · " + n + " steps", n: n });
    }
    // ---- playing
    var R = S.rows, L = S.steps, tot = R.length;
    var done = function () { var ok = S.res.filter(function (x) { return x.ok; }).length; return fin(S.stop ? "stopped" : "done", ok + " of " + S.res.length + " rows done" + (S.res.length - ok ? ", " + (S.res.length - ok) + " with problems" : ""), { res: S.res, rows: tot }); };
    if (S.row >= tot) return done();
    if (S.stop && S.step === 0) return done();
    var st = L[S.step], rowNo = S.row + 1, pct = Math.round((S.row + S.step / Math.max(1, L.length)) / tot * 100);
    var head = "Row " + rowNo + " of " + tot + " · step " + (S.step + 1) + " of " + L.length;
    var next = function (msg) { S.step++; S.tries = 0; if (S.step >= L.length) { var pm = portalMsg(); S.res.push({ row: rowNo, ok: !/error|fail|失败|错误|invalid|not found/i.test(pm), msg: pm || "Done" }); S.row++; S.step = 0; S.needStart = S.fromStart; } save(S); return JSON.stringify({ s: "run", pct: pct, msg: head + (msg ? " · " + msg : "") }); };
    var failRow = function (msg) { S.res.push({ row: rowNo, ok: false, msg: msg + " (step " + (S.step + 1) + ")" }); S.row++; S.step = 0; S.tries = 0; S.needStart = true; save(S); return JSON.stringify({ s: "run", pct: pct, msg: "Row " + rowNo + ": " + msg + " — moving to the next row" }); };
    if (S.needStart) { S.needStart = false; save(S); if (location.href !== S.start) { location.href = S.start; return JSON.stringify({ s: "run", pct: pct, msg: "Opening the start page for row " + rowNo }); } }
    if (Date.now() - S.at < 900) return JSON.stringify({ s: "run", pct: pct, msg: head });   // let the page react to the last action
    if (st.a === "wait") { if (!S.waitTill) { S.waitTill = Date.now() + st.ms; save(S); } if (Date.now() < S.waitTill) return JSON.stringify({ s: "run", pct: pct, msg: head + " · waiting" }); S.waitTill = 0; return next(); }
    if (st.a === "pause") {
      if (!S.you) { S.you = true; save(S); var f = st.sel && st.sel.tag ? find(st.sel) : null; if (f) { try { f.scrollIntoView({ block: "center" }); f.focus(); } catch (e) { } } }
      panel("👉 Your turn (row " + rowNo + "): " + (st.say || "do this step") + " — then tap Continue", [["Continue ▶", function () { var x = load(); x.you = false; x.step++; x.tries = 0; x.at = Date.now(); if (x.step >= x.steps.length) { var pm = portalMsg(); x.res.push({ row: x.row + 1, ok: true, msg: pm || "Done" }); x.row++; x.step = 0; x.needStart = x.fromStart; } sessionStorage.setItem(KEY, JSON.stringify(x)); }, "#13693F"], ["Skip row", function () { var x = load(); x.you = false; x.res.push({ row: x.row + 1, ok: false, msg: "Skipped by you" }); x.row++; x.step = 0; x.needStart = true; sessionStorage.setItem(KEY, JSON.stringify(x)); }, "#B42318"]]);
      return JSON.stringify({ s: "you", pct: pct, msg: "Your turn (row " + rowNo + "): " + (st.say || "do this step") + " — then tap Continue on the portal" });
    }
    panel("⏳ " + head + (S.stop ? " · stopping after this row" : ""), [["■ Stop", function () { var x = load(); x.stop = true; sessionStorage.setItem(KEY, JSON.stringify(x)); }, "#B42318"]]);
    var el = find(st.sel || {});
    if (!el) { S.tries++; save(S); if (S.tries > 16) return failRow("couldn't find “" + (st.sel.text || st.sel.label || st.sel.ph || st.sel.tag) + "”"); return JSON.stringify({ s: "run", pct: pct, msg: head + " · looking for “" + clean(st.sel.text || st.sel.label || st.sel.ph || "", 40) + "”" }); }
    var val = st.col ? String(R[S.row][st.col] == null ? "" : R[S.row][st.col]) : st.v;
    try {
      if (st.a === "click") tap(el);
      else if (st.a === "type") setVal(el, val);
      else if (st.a === "select") { var o = [].filter.call(el.options || [], function (x) { return clean(x.text) === clean(val) || x.value === val; })[0]; if (!o) return failRow("option “" + val + "” not in the list"); setVal(el, o.value); }
      else if (st.a === "check") { var cb = el.type === "checkbox" || el.type === "radio" ? el : el.querySelector("input[type=checkbox],input[type=radio]") || el; var want = st.col ? /^(1|y|yes|true|✓|x)$/i.test(val) : st.on; if (!!cb.checked !== want) tap(cb.tagName === "INPUT" && !vis(cb) ? el : cb); }
    } catch (e) { return failRow("step failed: " + clean(e.message, 80)); }
    S.at = Date.now(); save(S);
    return next(st.a === "type" ? "typed" : "");
  };
  W.__biBotPanelOnly = panel;
})();
