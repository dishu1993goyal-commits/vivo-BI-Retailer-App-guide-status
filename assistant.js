/* vivo BI Assistant — search + chatbot for the BI KPI Dashboard apps.
 * Loaded by the Android apps from this site, so it can be improved without new APKs, and it is a
 * separate file so publishing a new dashboard index.html never overwrites it.
 * All answers are read live from the dashboard itself (a hidden copy of the page), so they always
 * match the data in the latest published HTML. */
(function () {
  "use strict";
  if (window.BIAssist) return;
  var APP = window.BI_APP || "web";           // "admin" | "state" | "web"
  var D = document;

  // ---------------- small helpers ----------------
  function el(tag, cls, text) { var e = D.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function norm(s) { return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim(); }
  function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + "%"; }
  function num(s) { var n = parseFloat(String(s).replace(/[^0-9.\-−]/g, "").replace("−", "-")); return isNaN(n) ? null : n; }
  function visible(e) { if (!e) return false; var cs = getComputedStyle(e); return cs.display !== "none" && cs.visibility !== "hidden" && e.getClientRects().length > 0; }
  async function waitFor(fn, ms) { var t = Date.now(); while (Date.now() - t < (ms || 8000)) { try { var v = fn(); if (v) return v; } catch (e) { } await sleep(120); } return null; }

  var KPI = [
    { k: "app", name: "Retailer app usage", short: "Retailer app", col: 2 },
    { k: "sales", name: "Sales target achievement", short: "Sales target", col: 3 },
    { k: "visit", name: "Customer visit efficiency", short: "Customer visit", col: 4 },
    { k: "comp", name: "Competition management / Support desk", short: "Comp / support", col: 5 },
    { k: "vnotice", name: "v-Notice utilization", short: "v-Notice", col: 6 }
  ];
  var TIPS = {
    app: ["Announce every scheme in the Retailer App on the day it starts, and remind on day 3.",
      "Show payouts in the app first so retailers open it to check their earnings.",
      "Call retailers who never opened the app and help them log in on the spot.",
      "Run a weekly state challenge on the weakest app feature and share the leaderboard."],
    sales: ["Track target vs achievement weekly, not at month end.",
      "Push focus models with scheme-linked offers in low-achievement districts.",
      "Fix stock gaps early so demand is not lost."],
    visit: ["Plan routes so every eligible store is covered each month.",
      "Track visits against the store list weekly and close gaps before month end.",
      "Prioritise stores not visited in the last 30 days."],
    comp: ["Record competition activity on time and close support tickets quickly.",
      "Follow up on low ratings within 48 hours.",
      "Review open tickets every week with the team."],
    vnotice: ["Make sure every store uses v-Notice every month.",
      "Check flagged stores weekly and fix them before the month closes."]
  };
  var FEATURES = {
    sa: ["Scheme announcement", "Retailers who viewed scheme announcements in the app. Share every new scheme in the app first."],
    sp: ["Scheme payout", "Retailers who checked scheme payouts in the app. Payout visibility is the strongest reason to open the app."],
    an: ["Announcements & notifications", "Retailers who opened announcements and notifications. Send short, useful updates, not too many."],
    av: ["App visits", "Retailers who opened the app in the period. Daily ordering, targets and stock make it a habit."]
  };
  var ALIASES = { "mp": "Madhya Pradesh", "up": "Uttar Pradesh", "wb": "West Bengal", "tn": "Tamil Nadu", "hp": "Himachal Pradesh",
    "jk": "Jammu & Kashmir", "j and k": "Jammu & Kashmir", "ne": "North East", "ap": "Andhra Pradesh", "uk": "Uttarakhand",
    "cg": "Chhattisgarh", "mumbai": "MHM", "pune": "MHP", "nagpur": "MHN", "aurangabad": "MHA", "pan india": "PAN India", "india": "PAN India" };

  // ---------------- main page access ----------------
  function mainStates() { return [].map.call(D.querySelectorAll("#scope-sel option"), function (o) { return o.textContent.trim(); }); }
  function periodLabel(doc) { var s = (doc || D).querySelector("#per-sel"); return s && s.selectedOptions[0] ? s.selectedOptions[0].textContent.trim() : ""; }
  function setSelect(doc, id, value, byText) {
    var s = doc.getElementById(id); if (!s) return false;
    var opt = [].find.call(s.options, function (o) { return byText ? o.textContent.trim() === value : o.value === value; });
    if (!opt) return false;
    if (s.value !== opt.value) { s.value = opt.value; s.dispatchEvent(new Event("change", { bubbles: true })); }
    return true;
  }
  function clickTab(doc, t) { var b = doc.querySelector('#tabs [data-t="' + t + '"]'); if (b) { b.click(); return true; } return false; }
  function tabAllowed(t) { return !(APP === "state" && (t === "ret" || t === "retv")); }

  // Navigation used by search results and chat buttons (on the visible dashboard).
  var NAV = {
    tab: function (t) { if (tabAllowed(t)) { try { history.replaceState(null, "", location.pathname); } catch (e) { } clickTab(D, t); } },
    state: function (name) {
      setSelect(D, "scope-sel", name, true);
      if (name === "PAN India") { clickTab(D, "overview"); return; }
      location.hash = "state=" + encodeURIComponent(name);
    },
    kpi: function (v) { setSelect(D, "kpi-sel", v, false); clickTab(D, "rank"); }
  };

  // ---------------- hidden copy of the dashboard for reading data ----------------
  var frame = null, frameReady = null;
  function harvester() {
    if (frameReady) return frameReady;
    frameReady = new Promise(function (resolve, reject) {
      frame = el("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;left:-12000px;top:0;width:420px;height:1000px;opacity:0;pointer-events:none;border:0";
      frame.src = location.origin + location.pathname;
      frame.onload = async function () {
        var w = frame.contentWindow;
        var ok = await waitFor(function () { return w.document.querySelector("#tabs [data-t]") && w.document.querySelector("#per-sel option"); }, 20000);
        if (ok) resolve(w); else { frameReady = null; reject(new Error("load")); }
      };
      D.body.appendChild(frame);
    });
    return frameReady;
  }
  // Mirror the period chosen on the visible dashboard so answers match what the user sees.
  async function prepare(scope) {
    var w = await harvester(), fd = w.document;
    var mp = D.getElementById("per-sel");
    if (mp && mp.value !== "custom") setSelect(fd, "per-sel", mp.value, false);
    setSelect(fd, "kpi-sel", "overall", false);
    setSelect(fd, "scope-sel", scope || "PAN India", true);
    if (fd.location.hash) { try { w.history.replaceState(null, "", w.location.pathname); w.dispatchEvent(new HashChangeEvent("hashchange")); } catch (e) { } }
    await sleep(150);
    return w;
  }
  async function readRankings() {
    var w = await prepare("PAN India"), fd = w.document;
    clickTab(fd, "rank");
    var table = await waitFor(function () {
      return [].find.call(fd.querySelectorAll("table"), function (t) {
        var h = [].map.call(t.querySelectorAll("thead th"), function (x) { return x.textContent.trim(); });
        return h.indexOf("State") >= 0 && h.indexOf("Score") >= 0 ? t : null;
      });
    }, 8000);
    if (!table) return null;
    var head = [].map.call(table.querySelectorAll("thead th"), function (x) { return x.textContent.trim(); });
    var iState = head.indexOf("State"), iScore = head.indexOf("Score"), iChg = head.indexOf("Change");
    var iPrev = head.findIndex(function (h) { return / rank$/i.test(h) && h !== "#"; });
    var rows = [].map.call(table.querySelectorAll("tbody tr"), function (tr) {
      var c = [].map.call(tr.children, function (td) { return td.textContent.trim(); });
      var r = { rank: num(c[0]), state: c[iState], score: num(c[iScore]), prev: iPrev >= 0 ? num(c[iPrev]) : null,
        change: iChg >= 0 ? c[iChg] : "", kpis: {} };
      KPI.forEach(function (k) { var i = head.indexOf(k.short); if (i >= 0) r.kpis[k.k] = num(c[i]) / 100; });
      return r;
    }).filter(function (r) { return r.state; });
    return { period: periodLabel(fd), head: head, prevLabel: iPrev >= 0 ? head[iPrev] : "", rows: rows };
  }
  async function readWeights() {
    try {
      var fdData = JSON.parse(D.getElementById("dd").textContent);
      var setup = fdData.setup && fdData.setup[0];
      var mp = D.getElementById("per-sel"), v = mp ? mp.value : "";
      var m = /^(?:q:(\d{4})-(\d)|m:(\d{4})-(\d\d))/.exec(v);
      var qk = m ? (m[1] ? m[1] + "-Q" + m[2] : m[3] + "-Q" + Math.ceil(+m[4] / 3)) : null;
      var cfgs = setup.cfg || {};
      if (!qk || !cfgs[qk]) qk = Object.keys(cfgs).sort().filter(function (k) { return Object.keys(cfgs[k].k || {}).length; }).pop();
      var c = cfgs[qk] || {};
      var w = {}; Object.keys(c.k || {}).forEach(function (k) { w[k] = c.k[k]; });
      if (!Object.keys(w).length) Object.keys(setup.weights || {}).forEach(function (k) { w[k] = { w: setup.weights[k] }; });
      return { quarter: qk, k: w, pw: c.pw || {} };
    } catch (e) { return null; }
  }
  function weightOf(W, k) { return W && W.k[k] ? W.k[k].w : ({ app: 40, sales: 20, visit: 20, comp: 10, vnotice: 10 })[k] || 0; }
  async function readText(tab, scope, from, until) {
    var w = await prepare(scope), fd = w.document;
    clickTab(fd, tab);
    await sleep(300);
    var txt = await waitFor(function () { var t = fd.body.innerText; var i = t.indexOf(from); return i >= 0 ? t.slice(i) : null; }, 6000);
    if (!txt) return "";
    if (until) { var j = -1; until.forEach(function (u) { var k = txt.indexOf(u, from.length); if (k > 0 && (j < 0 || k < j)) j = k; }); if (j > 0) txt = txt.slice(0, j); }
    return txt.trim();
  }
  async function readPlan(scope) {
    var t = await readText("plan", scope, "FIX FIRST", ["Detailed analysis", "Largest rank drops", "Lowest scores"]);
    if (!t) return null;
    var lines = t.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    var out = { kpi: lines[1] || "", loss: lines[2] || "", actions: [], next: "", nextActions: [] };
    var i = lines.indexOf("Actions"), mode = "a";
    for (var k = (i >= 0 ? i + 1 : 3); k < lines.length; k++) {
      var L = lines[k];
      if (/^Next priority/i.test(L)) { out.next = L.replace(/^Next priority:\s*/i, ""); mode = "n"; continue; }
      (mode === "a" ? out.actions : out.nextActions).push(L);
    }
    return out;
  }
  async function readAppFeatures(scope) {
    var t = await readText("app", scope, "Period average by feature", ["Bar:", "Monthly trend"]);
    var lines = t.split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(1);
    var res = [];
    for (var i = 0; i + 1 < lines.length; i += 2) if (/%$/.test(lines[i + 1])) res.push([lines[i], lines[i + 1]]);
    return { features: res };
  }

  // ---------------- styles ----------------
  var css = "" +
    ".bia-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(15,16,40,.45);display:flex;flex-direction:column;justify-content:flex-end;font-family:system-ui,-apple-system,Roboto,'Segoe UI',sans-serif}" +
    ".bia-panel{background:#fff;border-radius:18px 18px 0 0;max-height:92vh;height:92vh;display:flex;flex-direction:column;box-shadow:0 -8px 30px rgba(0,0,0,.2)}" +
    ".bia-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(135deg,#4D5BF9,#9152E0);color:#fff;border-radius:18px 18px 0 0}" +
    ".bia-head b{font-size:17px;flex:1}.bia-head small{display:block;font-weight:400;opacity:.85;font-size:12px}" +
    ".bia-x{background:rgba(255,255,255,.2);border:0;color:#fff;width:34px;height:34px;border-radius:50%;font-size:20px;line-height:34px}" +
    ".bia-body{flex:1;overflow:auto;padding:14px 12px 8px;background:#F4F5FA}" +
    ".bia-msg{max-width:88%;margin:6px 0;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}" +
    ".bia-bot{background:#fff;color:#1a1a2e;border:1px solid #E6E8F0;border-top-left-radius:4px}" +
    ".bia-me{background:#4D5BF9;color:#fff;margin-left:auto;border-top-right-radius:4px}" +
    ".bia-msg b{font-weight:700}.bia-msg table{border-collapse:collapse;margin:6px 0;font-size:13px;width:100%}.bia-msg td{padding:3px 4px;border-bottom:1px solid #eef}" +
    ".bia-chips{display:flex;flex-wrap:wrap;gap:7px;margin:6px 0 10px}" +
    ".bia-chip{border:1px solid #C9CDF7;background:#fff;color:#3D47C8;border-radius:99px;padding:8px 12px;font-size:13.5px;font-family:inherit}" +
    ".bia-chip.go{background:#EEF0FF;border-color:#EEF0FF}" +
    ".bia-in{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #E6E8F0;background:#fff}" +
    ".bia-in input{flex:1;border:1px solid #D8DAE5;background:#F5F6FA;border-radius:22px;padding:11px 15px;font-size:15px;font-family:inherit;outline:none}" +
    ".bia-send{border:0;background:linear-gradient(135deg,#4D5BF9,#9152E0);color:#fff;border-radius:50%;width:44px;height:44px;font-size:18px}" +
    ".bia-typing{color:#7A7F99;font-size:13px;margin:4px 6px}" +
    ".bia-res{list-style:none;margin:0;padding:0}.bia-res li{display:flex;align-items:center;gap:12px;padding:12px 6px;border-bottom:1px solid #EEF0F5;font-size:15px;color:#1a1a2e}" +
    ".bia-res li small{color:#7A7F99;font-size:12px;display:block}.bia-res .ic{width:34px;height:34px;border-radius:10px;background:#EEF0FF;display:flex;align-items:center;justify-content:center;flex:none}" +
    ".bia-find{position:fixed;left:10px;right:10px;bottom:14px;z-index:2147483001;background:#1a1a2e;color:#fff;border-radius:14px;padding:8px 10px;display:flex;align-items:center;gap:8px;font:14px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)}" +
    ".bia-find span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bia-find button{background:rgba(255,255,255,.15);border:0;color:#fff;border-radius:8px;padding:7px 11px;font-size:14px}" +
    "mark.bia-hit{background:#FFE066;color:inherit;border-radius:3px}mark.bia-hit.cur{background:#FF9F1C}";
  function ensureCss() { if (!D.getElementById("bia-css")) { var s = el("style"); s.id = "bia-css"; s.textContent = css; D.head.appendChild(s); } }

  function overlay(title, sub) {
    ensureCss(); closeAll();
    var ov = el("div", "bia-ov"); ov.id = "bia-ov";
    var p = el("div", "bia-panel");
    var h = el("div", "bia-head");
    var t = el("b", null, title); var s = el("small", null, sub); t.appendChild(s); h.appendChild(t);
    var x = el("button", "bia-x", "×"); x.setAttribute("aria-label", "Close"); x.onclick = closeAll; h.appendChild(x);
    p.appendChild(h); ov.appendChild(p);
    ov.addEventListener("click", function (e) { if (e.target === ov) closeAll(); });
    D.body.appendChild(ov);
    return p;
  }
  function closeAll() { var o = D.getElementById("bia-ov"); if (o) o.remove(); }

  // ---------------- SEARCH ----------------
  function searchIndex() {
    var items = [];
    [].forEach.call(D.querySelectorAll("#tabs [data-t]"), function (b) {
      var t = b.dataset.t; if (!tabAllowed(t) || !b.textContent.trim()) return;
      if (APP === "state" && getComputedStyle(b).display === "none") return;
      items.push({ ic: "📑", label: b.textContent.trim(), sub: "Dashboard page", go: function () { NAV.tab(t); } });
    });
    mainStates().forEach(function (s) { items.push({ ic: "📍", label: s, sub: "State / region — open its analysis", go: function () { NAV.state(s); } }); });
    [].forEach.call(D.querySelectorAll("#kpi-sel option"), function (o) {
      items.push({ ic: "📊", label: o.textContent.trim(), sub: "KPI — rank all states by it", go: function () { NAV.kpi(o.value); } });
    });
    [].forEach.call(D.querySelectorAll("#per-sel option"), function (o) {
      if (o.value === "custom") return;
      items.push({ ic: "📅", label: o.textContent.trim(), sub: "Period — show this period", go: function () { setSelect(D, "per-sel", o.value, false); } });
    });
    return items;
  }
  function openSearch(q) {
    var p = overlay("Search dashboard", "States, KPIs, pages, periods — or any word on this page");
    var body = el("div", "bia-body"); body.style.background = "#fff";
    var box = el("div", "bia-in"); box.style.borderTop = "0"; box.style.borderBottom = "1px solid #E6E8F0";
    var inp = el("input"); inp.type = "search"; inp.placeholder = "Search e.g. Bihar, payout, rankings…"; inp.value = q || "";
    box.appendChild(inp); p.appendChild(box); p.appendChild(body);
    var list = el("ul", "bia-res"); body.appendChild(list);
    var idx = searchIndex();
    function render() {
      list.innerHTML = "";
      var v = norm(inp.value), alias = ALIASES[v];
      var hits = v ? idx.filter(function (it) { var n = norm(it.label); return n.indexOf(v) >= 0 || (alias && it.label === alias) || v.split(" ").every(function (w) { return n.indexOf(w) >= 0; }); }) : idx.slice(0, 15);
      if (v) hits.push({ ic: "🔎", label: "Find “" + inp.value.trim() + "” on this page", sub: "Highlights every match on the current screen", go: function () { findOnPage(inp.value.trim()); }, keep: true });
      if (v) hits.push({ ic: "💬", label: "Ask the assistant about “" + inp.value.trim() + "”", sub: "Explanations, calculations and tips", go: function () { openChat(inp.value.trim()); }, keep: true });
      hits.slice(0, 40).forEach(function (it) {
        var li = el("li"); var ic = el("span", "ic", it.ic); var tx = el("div"); tx.appendChild(D.createTextNode(it.label)); tx.appendChild(el("small", null, it.sub));
        li.appendChild(ic); li.appendChild(tx);
        li.onclick = function () { if (!it.keep) closeAll(); it.go(); };
        list.appendChild(li);
      });
      if (!hits.length) list.appendChild(el("li", null, "No results"));
    }
    inp.addEventListener("input", render);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && inp.value.trim()) { var f = list.querySelector("li"); if (f) f.click(); } });
    render(); setTimeout(function () { inp.focus(); }, 50);
  }
  // Highlights matches in the visible page with next / previous buttons.
  var hits = [], cur = -1;
  function clearHits() {
    hits.forEach(function (m) { var p = m.parentNode; if (p) { p.replaceChild(D.createTextNode(m.textContent), m); p.normalize(); } });
    hits = []; cur = -1; var b = D.getElementById("bia-find"); if (b) b.remove();
  }
  function findOnPage(q) {
    closeAll(); clearHits(); if (!q) return;
    var re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    var walker = D.createTreeWalker(D.body, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      var p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|OPTION)$/.test(p.tagName) || p.closest(".bia-ov,.bia-find")) return NodeFilter.FILTER_REJECT;
      return re.test(n.nodeValue) && visible(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    } });
    var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      var frag = D.createDocumentFragment(), s = n.nodeValue, last = 0; re.lastIndex = 0; var m;
      while ((m = re.exec(s))) { frag.appendChild(D.createTextNode(s.slice(last, m.index))); var mk = el("mark", "bia-hit", m[0]); frag.appendChild(mk); hits.push(mk); last = m.index + m[0].length; }
      frag.appendChild(D.createTextNode(s.slice(last))); n.parentNode.replaceChild(frag, n);
    });
    ensureCss();
    var bar = el("div", "bia-find"); bar.id = "bia-find";
    var lab = el("span"); var prev = el("button", null, "‹"); var next = el("button", null, "›"); var x = el("button", null, "✕");
    function go(i) {
      if (!hits.length) { lab.textContent = "No matches for “" + q + "” on this screen. Try Search for pages and states."; return; }
      if (cur >= 0) hits[cur].classList.remove("cur");
      cur = (i + hits.length) % hits.length; hits[cur].classList.add("cur");
      hits[cur].scrollIntoView({ block: "center", behavior: "smooth" });
      lab.textContent = (cur + 1) + " of " + hits.length + " · “" + q + "”";
    }
    prev.onclick = function () { go(cur - 1); }; next.onclick = function () { go(cur + 1); }; x.onclick = clearHits;
    bar.appendChild(lab); bar.appendChild(prev); bar.appendChild(next); bar.appendChild(x); D.body.appendChild(bar);
    go(0);
  }

  // ---------------- CHATBOT ----------------
  var chatBody = null, chatInput = null, busy = false;
  function openChat(question) {
    var p = overlay("BI Assistant", "Ask about rankings, states, KPIs and how to improve");
    chatBody = el("div", "bia-body"); p.appendChild(chatBody);
    var inb = el("div", "bia-in"); chatInput = el("input"); chatInput.placeholder = "Ask e.g. “How can Delhi improve?”";
    var send = el("button", "bia-send", "➤"); send.setAttribute("aria-label", "Send");
    inb.appendChild(chatInput); inb.appendChild(send); p.appendChild(inb);
    function submit() { var v = chatInput.value.trim(); if (!v || busy) return; chatInput.value = ""; ask(v); }
    send.onclick = submit; chatInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    bot("👋 Hi! I'm your BI Assistant. I read the live dashboard (" + (periodLabel() || "selected period") + ") and can explain rankings, scores, KPI logic and what to do next.\n\nWhat would you like to know?");
    menu();
    harvester().catch(function () { });          // start loading data in the background
    if (question) ask(question);
  }
  function scroll() { if (chatBody) chatBody.scrollTop = chatBody.scrollHeight; }
  function bubble(cls, content, html) { var m = el("div", "bia-msg " + cls); if (html) m.innerHTML = content; else m.textContent = content; chatBody.appendChild(m); scroll(); return m; }
  function bot(t, html) { return bubble("bia-bot", t, html); }
  function me(t) { return bubble("bia-me", t); }
  function chips(list) {
    var c = el("div", "bia-chips");
    list.forEach(function (x) {
      if (!x) return;
      var b = el("button", "bia-chip" + (x.go ? " go" : ""), x.t);
      b.onclick = function () {
        if (x.go) { closeAll(); x.go(); return; }
        if (busy) return;
        if (x.say !== false) me(x.t);
        x.fn();
      };
      c.appendChild(b);
    });
    chatBody.appendChild(c); scroll();
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  async function working(fn) {
    busy = true; var t = el("div", "bia-typing", "Reading the dashboard…"); chatBody.appendChild(t); scroll();
    try { await fn(); } catch (e) { bot("Sorry, I couldn't read that part of the dashboard right now. Please check your internet and try again."); }
    t.remove(); busy = false; scroll();
  }
  function menu() {
    chips([
      { t: "🏆 State rankings", fn: answerRankings },
      { t: "📍 A state's performance", fn: pickState },
      { t: "🧮 How is the score calculated?", fn: answerCalc },
      { t: "🚀 How to improve rank", fn: function () { pickState("improve"); } },
      { t: "🎯 Key focus areas", fn: answerFocus },
      { t: "📱 Retailer app features", fn: answerFeatures },
      { t: "📘 Dashboard features", fn: answerDashboard },
      { t: "⚔️ Compare two states", fn: pickCompare }
    ]);
  }
  function more(extra) { chips((extra || []).concat([{ t: "☰ Main menu", fn: function () { bot("What else would you like to know?"); menu(); } }])); }

  var cache = { rank: null, at: 0, period: "" };
  async function rankings() {
    var p = (D.getElementById("per-sel") || {}).value;
    if (cache.rank && cache.period === p && Date.now() - cache.at < 120000) return cache.rank;
    var r = await readRankings(); if (r) { cache = { rank: r, at: Date.now(), period: p }; }
    return r;
  }
  function findState(text) {
    var n = norm(text), states = mainStates();
    var a = ALIASES[n]; if (a) return a;
    var exact = states.find(function (s) { return norm(s) === n; }); if (exact) return exact;
    for (var key in ALIASES) { if (new RegExp("\\b" + key + "\\b").test(n) && ALIASES[key] !== "PAN India") return ALIASES[key]; }
    var best = null; states.forEach(function (s) { var sn = norm(s); if (sn.length > 2 && n.indexOf(sn) >= 0 && (!best || sn.length > norm(best).length)) best = s; });
    return best;
  }
  function stateChips(next) {
    var st = mainStates().filter(function (s) { return s !== "PAN India"; });
    chips(st.map(function (s) { return { t: s, fn: function () { next(s); } }; }));
  }
  function pickState(mode) {
    bot(mode === "improve" ? "Which state should I build an improvement plan for?" : "Pick a state or region:");
    if (mode === "improve") chips([{ t: "PAN India", fn: function () { answerImprove("PAN India"); } }]);
    stateChips(mode === "improve" ? answerImprove : answerState);
  }
  function pickCompare() {
    bot("Pick the first state:");
    stateChips(function (a) { bot("Now pick the state to compare " + a + " with:"); stateChips(function (b) { answerCompare(a, b); }); });
  }

  function answerRankings() {
    return working(async function () {
      var r = await rankings();
      if (!r || !r.rows.length) { bot("I couldn't find rankings for this period yet."); more(); return; }
      var top = r.rows.slice(0, 5), bot5 = r.rows.slice(-5).reverse();
      var movers = r.rows.filter(function (x) { return num(x.change) > 0; }).sort(function (a, b) { return num(b.change) - num(a.change); }).slice(0, 3);
      var h = "<b>🏆 Rankings · " + esc(r.period) + "</b><br><b>Top 5</b><table>" +
        top.map(function (x) { return "<tr><td>#" + x.rank + "</td><td>" + esc(x.state) + "</td><td style='text-align:right'><b>" + x.score + "</b></td><td>" + esc(x.change) + "</td></tr>"; }).join("") +
        "</table><b>Need most support</b><table>" +
        bot5.map(function (x) { return "<tr><td>#" + x.rank + "</td><td>" + esc(x.state) + "</td><td style='text-align:right'><b>" + x.score + "</b></td><td>" + esc(x.change) + "</td></tr>"; }).join("") + "</table>";
      if (movers.length) h += "📈 <b>Biggest climbers</b> vs " + esc(r.prevLabel.replace(/ rank$/i, "")) + ": " + movers.map(function (x) { return esc(x.state) + " (" + esc(x.change) + ")"; }).join(", ");
      bot(h, true);
      more([{ t: "Why is " + top[0].state + " #1?", fn: function () { answerState(top[0].state); } },
        { t: "Help " + bot5[0].state + " improve", fn: function () { answerImprove(bot5[0].state); } },
        { t: "Open Rankings page", go: function () { NAV.tab("rank"); } }]);
    });
  }

  function kpiLines(row, W) {
    return KPI.filter(function (k) { return row.kpis[k.k] != null; }).map(function (k) {
      var w = weightOf(W, k.k), a = Math.min(1, row.kpis[k.k]);
      return { k: k, w: w, a: row.kpis[k.k], pts: w * a, lost: w * (1 - a) };
    });
  }
  function answerState(state) {
    if (state === "PAN India") return answerFocus();
    return working(async function () {
      var r = await rankings(), W = await readWeights();
      var row = r && r.rows.find(function (x) { return x.state === state; });
      if (!row) { bot("I couldn't find " + state + " in the rankings for this period."); more(); return; }
      var L = kpiLines(row, W), sorted = L.slice().sort(function (a, b) { return b.lost - a.lost; });
      var strong = L.slice().sort(function (a, b) { return b.a - a.a; })[0], weak = sorted[0];
      var above = r.rows.find(function (x) { return x.rank === row.rank - 1; });
      var h = "<b>📍 " + esc(state) + " · " + esc(r.period) + "</b><br>Rank <b>#" + row.rank + "</b> of " + r.rows.length +
        " with score <b>" + row.score + "</b>" + (row.prev ? " (was #" + row.prev + ", change " + esc(row.change) + ")" : "") + "<table>" +
        L.map(function (x) { return "<tr><td>" + esc(x.k.short) + "</td><td style='text-align:right'>" + pct(x.a) + "</td><td style='text-align:right'>" + x.pts.toFixed(1) + "/" + x.w + "</td></tr>"; }).join("") +
        "</table>💪 Strongest: <b>" + esc(strong.k.name) + "</b> (" + pct(strong.a) + ")<br>⚠️ Losing most points: <b>" + esc(weak.k.name) + "</b> (−" + weak.lost.toFixed(1) + " pts)";
      if (above) h += "<br>⬆️ To overtake #" + above.rank + " " + esc(above.state) + " needs <b>+" + Math.max(0.1, above.score - row.score + 0.1).toFixed(1) + " pts</b>.";
      bot(h, true);
      more([{ t: "How can " + state + " improve?", fn: function () { answerImprove(state); } },
        { t: "Compare with #1", fn: function () { answerCompare(state, r.rows[0].state === state ? r.rows[1].state : r.rows[0].state); } },
        { t: "Open " + state + " analysis", go: function () { NAV.state(state); } }]);
    });
  }

  function answerImprove(state) {
    return working(async function () {
      var r = await rankings(), W = await readWeights();
      var plan = await readPlan(state);
      var h = "<b>🚀 Improvement plan · " + esc(state) + "</b>";
      if (plan && plan.kpi) {
        h += "<br><br><b>Fix first: " + esc(plan.kpi) + "</b><br>" + esc(plan.loss);
        if (plan.actions.length) h += "<br>" + plan.actions.map(function (a) { return "• " + esc(a); }).join("<br>");
        if (plan.next) h += "<br><br><b>Next priority:</b> " + esc(plan.next) + (plan.nextActions.length ? "<br>" + plan.nextActions.map(function (a) { return "• " + esc(a); }).join("<br>") : "");
      }
      var row = r && r.rows.find(function (x) { return x.state === state; });
      if (row) {
        var L = kpiLines(row, W).sort(function (a, b) { return b.lost - a.lost; });
        var w0 = L[0];
        h += "<br><br><b>📐 What the numbers say</b><br>Each +10% in <b>" + esc(w0.k.short) + "</b> adds <b>+" + (w0.w * 0.1).toFixed(1) + " pts</b> (weight " + w0.w + ").";
        var target = [1, 3, 5].map(function (n) { var t = r.rows.find(function (x) { return x.rank === row.rank - n; }); return t ? "#" + t.rank + " needs +" + Math.max(0.1, t.score - row.score + 0.1).toFixed(1) + " pts" : null; }).filter(Boolean);
        if (target.length) h += "<br>To climb: " + target.join(" · ");
        if (!plan || !plan.actions.length) h += "<br>" + (TIPS[w0.k.k] || []).map(function (a) { return "• " + esc(a); }).join("<br>");
      }
      if (!plan && !row) h += "<br>I couldn't read the plan right now.";
      bot(h, true);
      more([row ? { t: state + " KPI scores", fn: function () { answerState(state); } } : null,
        { t: "Tips for each KPI", fn: answerTips },
        { t: "Open Action plan", go: function () { if (state !== "PAN India") setSelect(D, "scope-sel", state, true); NAV.tab("plan"); } }]);
    });
  }

  function answerCalc() {
    return working(async function () {
      var W = await readWeights(), r = await rankings();
      var names = { app: "Retailer app usage", sales: "Sales target achievement", visit: "Customer visit efficiency", comp: "Competition management / Support desk", vnotice: "v-Notice utilization", "new": "New retailer onboarding" };
      var keys = W ? Object.keys(W.k) : [];
      var h = "<b>🧮 How the BI KPI score is calculated</b>" + (W && W.quarter ? " (" + esc(W.quarter.replace("-", " ")) + " framework)" : "") +
        "<br><br>Score (out of 100) = sum of KPI points.<br>KPI points = <b>achievement % (capped at 100%) × weight</b>.<br>Monthly values are averaged across the months of the selected period.<table>" +
        keys.map(function (k) { return "<tr><td>" + esc(names[k] || k) + "</td><td style='text-align:right'><b>" + W.k[k].w + "</b> pts</td></tr>"; }).join("") + "</table>";
      var pw = W && W.pw ? Object.keys(W.pw).filter(function (k) { return W.pw[k] > 0; }) : [];
      if (pw.length) {
        var tot = pw.reduce(function (s, k) { return s + W.pw[k]; }, 0);
        h += "<b>Retailer app usage</b> combines app features: " + pw.map(function (k) { return esc(FEATURES[k] ? FEATURES[k][0] : k) + " " + Math.round(W.pw[k] / tot * 100) + "%"; }).join(", ") + ".<br>";
      }
      if (r && r.rows.length) {
        var x = r.rows[0], L = kpiLines(x, W);
        h += "<br><b>Example: " + esc(x.state) + "</b> (#1)<br>" + L.map(function (l) { return pct(Math.min(1, l.a)) + " × " + l.w; }).join(" + ") + " = <b>" + L.reduce(function (s, l) { return s + l.pts; }, 0).toFixed(1) + "</b> (dashboard shows " + x.score + ")";
      }
      bot(h, true);
      more([{ t: "📱 How app usage is measured", fn: answerFeatures },
        { t: "Open KPI framework", go: function () { NAV.tab("kq4"); } }]);
    });
  }

  function answerFocus() {
    return working(async function () {
      var r = await rankings(), W = await readWeights(), plan = await readPlan("PAN India");
      var h = "<b>🎯 Key focus areas · PAN India · " + esc(r ? r.period : periodLabel()) + "</b>";
      if (r && r.rows.length) {
        var loss = KPI.map(function (k) {
          var v = r.rows.filter(function (x) { return x.kpis[k.k] != null; });
          var avg = v.reduce(function (s, x) { return s + Math.min(1, x.kpis[k.k]); }, 0) / Math.max(1, v.length);
          return { k: k, avg: avg, lost: weightOf(W, k.k) * (1 - avg) };
        }).sort(function (a, b) { return b.lost - a.lost; });
        h += "<br><br><b>Where states lose the most points (average)</b><table>" + loss.map(function (l) { return "<tr><td>" + esc(l.k.short) + "</td><td style='text-align:right'>" + pct(l.avg) + "</td><td style='text-align:right'>−" + l.lost.toFixed(1) + "</td></tr>"; }).join("") + "</table>";
        var low = r.rows.slice(-3).map(function (x) { return x.state + " (" + x.score + ")"; });
        var drops = r.rows.filter(function (x) { return num(x.change) < 0; }).sort(function (a, b) { return num(a.change) - num(b.change); }).slice(0, 3).map(function (x) { return x.state + " (" + x.change + ")"; });
        h += "🆘 <b>States needing support:</b> " + esc(low.join(", "));
        if (drops.length) h += "<br>📉 <b>Biggest drops:</b> " + esc(drops.join(", "));
      }
      if (plan && plan.actions.length) h += "<br><br><b>Fix first: " + esc(plan.kpi) + "</b><br>" + plan.actions.map(function (a) { return "• " + esc(a); }).join("<br>");
      bot(h, true);
      more([{ t: "📱 Improve app usability", fn: answerFeatures }, { t: "Tips for each KPI", fn: answerTips },
        { t: "Open Action plan", go: function () { setSelect(D, "scope-sel", "PAN India", true); NAV.tab("plan"); } }]);
    });
  }

  function answerFeatures() {
    return working(async function () {
      var f = await readAppFeatures("PAN India");
      var h = "<b>📱 Retailer App usage</b><br>The biggest KPI. It measures the share of eligible retailers using each app feature:<br>";
      Object.keys(FEATURES).forEach(function (k) {
        var row = f.features.find(function (x) { return norm(x[0]) === norm(FEATURES[k][0]); });
        h += "<br>• <b>" + esc(FEATURES[k][0]) + "</b>" + (row ? " — PAN India " + esc(row[1]) : "") + "<br>&nbsp;&nbsp;" + esc(FEATURES[k][1]);
      });
      h += "<br><br><b>To raise usage:</b><br>" + TIPS.app.map(function (a) { return "• " + esc(a); }).join("<br>");
      bot(h, true);
      more([{ t: "Open Retailer app page", go: function () { NAV.tab("app"); } }, { t: "🎯 Key focus areas", fn: answerFocus }]);
    });
  }

  function answerTips() {
    var h = "<b>💡 How to improve each KPI</b>";
    KPI.forEach(function (k) { h += "<br><br><b>" + esc(k.name) + "</b><br>" + (TIPS[k.k] || []).map(function (a) { return "• " + esc(a); }).join("<br>"); });
    bot(h, true);
    more([{ t: "🚀 Plan for a state", fn: function () { pickState("improve"); } }]);
  }

  function answerDashboard() {
    var tiles = [].map.call(D.querySelectorAll(".tile"), function (t) { var b = t.querySelector("b"), s = t.querySelector("small"); return b ? [b.textContent.trim(), s ? s.textContent.trim() : "", t.dataset.go] : null; })
      .filter(function (x) { return x && tabAllowed(x[2]); });
    var tabs = [].map.call(D.querySelectorAll("#tabs [data-t]"), function (b) { return [b.textContent.trim(), b.dataset.t]; })
      .filter(function (x) { return x[0] && tabAllowed(x[1]); });
    var h = "<b>📘 What's in the dashboard</b><br>";
    if (tiles.length) h += tiles.map(function (t) { return "• <b>" + esc(t[0]) + "</b>" + (t[1] ? " — " + esc(t[1]) : ""); }).join("<br>");
    else h += tabs.map(function (t) { return "• " + esc(t[0]); }).join("<br>");
    h += "<br><br>Use <b>Filters & tools</b> to change the period, state and KPI. Tap 🔍 to jump to any page or state.";
    bot(h, true);
    chips(tabs.slice(0, 10).map(function (t) { return { t: "Open " + t[0], go: function () { NAV.tab(t[1]); } }; }));
    more();
  }

  function answerCompare(a, b) {
    return working(async function () {
      var r = await rankings(), W = await readWeights();
      var A = r && r.rows.find(function (x) { return x.state === a; }), B = r && r.rows.find(function (x) { return x.state === b; });
      if (!A || !B) { bot("I couldn't find both states in this period's rankings."); more(); return; }
      var h = "<b>⚔️ " + esc(a) + " vs " + esc(b) + " · " + esc(r.period) + "</b><table><tr><td></td><td style='text-align:right'><b>" + esc(a) + "</b></td><td style='text-align:right'><b>" + esc(b) + "</b></td></tr>" +
        "<tr><td>Rank</td><td style='text-align:right'>#" + A.rank + "</td><td style='text-align:right'>#" + B.rank + "</td></tr>" +
        "<tr><td>Score</td><td style='text-align:right'>" + A.score + "</td><td style='text-align:right'>" + B.score + "</td></tr>" +
        KPI.filter(function (k) { return A.kpis[k.k] != null; }).map(function (k) {
          var better = A.kpis[k.k] >= B.kpis[k.k];
          return "<tr><td>" + esc(k.short) + "</td><td style='text-align:right'>" + (better ? "<b>" : "") + pct(A.kpis[k.k]) + (better ? "</b>" : "") + "</td><td style='text-align:right'>" + (!better ? "<b>" : "") + pct(B.kpis[k.k]) + (!better ? "</b>" : "") + "</td></tr>";
        }).join("") + "</table>";
      var gap = KPI.filter(function (k) { return A.kpis[k.k] != null; }).map(function (k) { return { k: k, d: (Math.min(1, B.kpis[k.k]) - Math.min(1, A.kpis[k.k])) * weightOf(W, k.k) }; }).sort(function (x, y) { return y.d - x.d; })[0];
      if (gap && gap.d > 0) h += "Biggest gap for " + esc(a) + ": <b>" + esc(gap.k.name) + "</b> (" + gap.d.toFixed(1) + " pts behind " + esc(b) + ").";
      bot(h, true);
      more([{ t: "How can " + a + " improve?", fn: function () { answerImprove(a); } }, { t: "Open Compare page", go: function () { NAV.tab("cmp"); } }]);
    });
  }

  // Free-text questions: match states, KPIs and intent words.
  function ask(q) {
    me(q);
    var n = norm(q), state = findState(q);
    var has = function (re) { return re.test(n); };
    if (has(/\b(hi|hello|hey|namaste|menu|help|start)\b/) && n.split(" ").length <= 3) { bot("Here's what I can help with:"); menu(); return; }
    if (has(/\b(vs|versus|compare|comparison)\b/)) {
      var found = mainStates().filter(function (s) { return s !== "PAN India" && n.indexOf(norm(s)) >= 0; });
      if (found.length >= 2) return answerCompare(found[0], found[1]);
      return pickCompare();
    }
    if (has(/\b(calculat|formula|weight|logic|how is .*score|scor(e|ing) work|points? work|framework)/)) return answerCalc();
    if (has(/\b(improve|increase|better|boost|raise|up rank|climb|action|plan|what (should|can)|measures?|steps?)\b/)) return answerImprove(state || "PAN India");
    if (has(/\b(focus|priority|priorities|key area|weak|lagging|problem|attention)\b/) && !state) return answerFocus();
    if (has(/\b(scheme|payout|notification|announcement|app visit|app usage|usability|retailer app|feature)\b/) && !state) return answerFeatures();
    if (has(/\b(tip|tips|kpi tips)\b/)) return answerTips();
    if (state) return answerState(state);
    if (has(/\b(rank|ranking|top|best|bottom|lowest|worst|leader|position)\b/)) return answerRankings();
    if (has(/\b(tab|page|section|dashboard|what can|features|use|navigate)\b/)) return answerDashboard();
    bot("I can answer questions about rankings, any state, the score calculation, focus areas and how to improve. Try one of these:");
    menu();
  }

  window.BIAssist = { openSearch: openSearch, openChat: openChat, findOnPage: findOnPage, version: "1.0" };
})();
