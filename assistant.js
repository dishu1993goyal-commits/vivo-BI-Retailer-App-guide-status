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
    { k: "new", name: "New retailer implementation", short: "New impl.", col: 0 },
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
  // State app: Active retailers only when the user's state is known (the app then locks it to that state).
  function tabAllowed(t) { return !(APP === "state" && !window.BI_STATE && (t === "ret" || t === "retv")); }

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
  // The copy is created only when an answer needs data, and removed after 90 s idle to free memory.
  var frame = null, frameReady = null, frameIdle = null;
  var FRAME_IDLE_MS = 90000;
  function releaseFrame() {
    if (frameIdle) clearTimeout(frameIdle);
    frameIdle = null;
    if (frame) { try { frame.src = "about:blank"; } catch (e) { } frame.remove(); }
    frame = null; frameReady = null;
  }
  function touchFrame() { if (frameIdle) clearTimeout(frameIdle); frameIdle = setTimeout(releaseFrame, FRAME_IDLE_MS); }
  function harvester() {
    touchFrame();
    if (frameReady) return frameReady;
    frameReady = new Promise(function (resolve, reject) {
      frame = el("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;left:-12000px;top:0;width:420px;height:1000px;opacity:0;pointer-events:none;border:0";
      frame.src = location.origin + location.pathname;
      frame.onload = async function () {
        var w = frame.contentWindow;
        var ok = await waitFor(function () { return w.document.querySelector("#tabs [data-t]") && w.document.querySelector("#per-sel option"); }, 30000);
        if (ok) resolve(w); else { releaseFrame(); reject(new Error("load")); }
      };
      D.body.appendChild(frame);
    });
    return frameReady;
  }
  // Mirror the period chosen on the visible dashboard so answers match what the user sees.
  // Answers use the whole year by default (not the period filter on screen); the user can switch.
  var AP = null;
  function periodOptions(re) { return [].filter.call(D.querySelectorAll("#per-sel option"), function (o) { return re.test(o.value); }); }
  function yearPeriod() { var o = periodOptions(/^y:/).pop(); return o ? o.value : ((D.getElementById("per-sel") || {}).value || ""); }
  function curAP() { if (!AP) AP = yearPeriod(); return AP; }
  function labelOf(v) { var o = [].find.call(D.querySelectorAll("#per-sel option"), function (x) { return x.value === v; }); return o ? o.textContent.trim() : v; }
  function apLabel() { return labelOf(curAP()); }
  // Latest quarter that has started (used where exact KPI points matter).
  function curQuarter() {
    var now = new Date(), y = now.getFullYear(), q = Math.ceil((now.getMonth() + 1) / 3);
    var qs = periodOptions(/^q:/).map(function (o) { return o.value; });
    var cur = qs.filter(function (v) { return v.slice(2) <= y + "-" + q; }).pop();
    return cur || qs.pop() || curAP();
  }
  function pointsPeriod() { return /^y:/.test(curAP()) ? curQuarter() : curAP(); }
  function recentMonths(n) {
    var now = new Date(), cur = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    var ms = periodOptions(/^m:/).map(function (o) { return o.value; }).filter(function (v) { return v.slice(2) <= cur; });
    return ms.slice(-n);
  }

  async function prepare(scope, period) {
    var w = await harvester(), fd = w.document;
    setSelect(fd, "per-sel", period || curAP(), false);
    setSelect(fd, "kpi-sel", "overall", false);
    setSelect(fd, "scope-sel", scope || "PAN India", true);
    if (fd.location.hash) { try { w.history.replaceState(null, "", w.location.pathname); w.dispatchEvent(new HashChangeEvent("hashchange")); } catch (e) { } }
    await sleep(150);
    return w;
  }
  async function readRankings(period) {
    var w = await prepare("PAN India", period), fd = w.document;
    clickTab(fd, "rank");
    var table = await waitFor(function () {
      return [].find.call(fd.querySelectorAll("table"), function (t) {
        var h = [].map.call(t.querySelectorAll("thead th"), function (x) { return x.textContent.trim(); });
        return h.indexOf("State") >= 0 && (h.indexOf("Score") >= 0 || h.indexOf("Year score") >= 0) ? t : null;
      });
    }, 8000);
    if (!table) return null;
    var head = [].map.call(table.querySelectorAll("thead th"), function (x) { return x.textContent.trim(); });
    var iState = head.indexOf("State"), iScore = head.indexOf("Score"), iChg = head.indexOf("Change");
    if (iScore < 0) iScore = head.indexOf("Year score");
    var qCols = head.map(function (h, i) { return /^Q\d-\d{4} score$/.test(h) ? i : -1; }).filter(function (i) { return i >= 0; });
    var iPrev = head.findIndex(function (h) { return / rank$/i.test(h) && h !== "#"; });
    var rows = [].map.call(table.querySelectorAll("tbody tr"), function (tr) {
      var c = [].map.call(tr.children, function (td) { return td.textContent.trim(); });
      var r = { rank: num(c[0]), state: c[iState], score: num(c[iScore]), prev: iPrev >= 0 ? num(c[iPrev]) : null,
        change: iChg >= 0 ? c[iChg] : "", kpis: {} };
      KPI.forEach(function (k) { var i = head.indexOf(k.short); if (i >= 0 && num(c[i]) != null) r.kpis[k.k] = num(c[i]) / 100; });
      r.quarters = qCols.map(function (i) { return [head[i].replace(" score", ""), num(c[i])]; });
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
  function closeAll() { var o = D.getElementById("bia-ov"); if (o) o.remove(); if (frame) touchFrame(); }

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
    var hello = bot("👋 Hi! I'm your BI Assistant. I read the whole dashboard (" + (apLabel() || "full year") + ") and can explain rankings, scores, KPI logic, schemes and what to do next.\n\nTap an option or type any question.");
    menu();
    bridgeCall("status", []).then(function (r) {
      AI.on = !!(r && r.ok && r.ai);
      if (AI.on) hello.textContent += "\n\n🤖 AI is on: ask anything, including general smartphone market questions.";
    });
    if (question) ask(question);
  }
  var AI = { on: null, hist: [], ctx: null, ctxAt: 0 };
  window.__biaiPending = window.__biaiPending || {};
  window.__biaiCb = function (id, json) {
    var f = window.__biaiPending[id]; if (!f) return; delete window.__biaiPending[id];
    try { f(typeof json === "string" ? JSON.parse(json) : json); } catch (e) { f(null); }
  };
  function bridgeCall(method, args) {
    return new Promise(function (res) {
      if (!window.BIAI || !window.BIAI[method]) { res(null); return; }
      var id = "r" + Math.random().toString(36).slice(2);
      window.__biaiPending[id] = res;
      try { window.BIAI[method].apply(window.BIAI, [id].concat(args || [])); } catch (e) { delete window.__biaiPending[id]; res(null); return; }
      setTimeout(function () { if (window.__biaiPending[id]) { delete window.__biaiPending[id]; res({ ok: false, error: "AI took too long." }); } }, 60000);
    });
  }
  // Compact text of the dashboard for the AI: whole year, each quarter, recent months, weights, action plan.
  async function aiContext() {
    if (AI.ctx && Date.now() - AI.ctxAt < 600000) return AI.ctx;
    var parts = ["App: " + (APP === "state" ? "State app" : "Admin app") + (window.BI_STATE ? "; user's state: " + window.BI_STATE : "") +
      "; today: " + new Date().toDateString()];
    var W = await readWeights();
    if (W) parts.push("KPI weights (" + W.quarter + "): " + Object.keys(W.k).map(function (k) { return k + " " + W.k[k].w; }).join(", "));
    parts.push("Columns: rank. state score | " + KPI.map(function (k) { return k.short + "%"; }).join(" ") + " | change vs previous (- = KPI not in that period)");
    var ps = [yearPeriod()].concat(periodOptions(/^q:/).map(function (o) { return o.value; }), recentMonths(2));
    ps = ps.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    for (var i = 0; i < ps.length; i++) {
      var r = await rankings(ps[i]); if (!r || !r.rows.length) continue;
      parts.push("== " + r.period);
      r.rows.forEach(function (x) {
        parts.push(x.rank + ". " + x.state + " " + x.score + " | " + KPI.map(function (k) { return x.kpis[k.k] == null ? "-" : Math.round(x.kpis[k.k] * 1000) / 10; }).join(" ") + (x.change ? " | " + x.change : ""));
      });
    }
    try {
      var plan = await readPlan(window.BI_STATE || "PAN India");
      if (plan && plan.kpi) parts.push("Action plan (" + (window.BI_STATE || "PAN India") + ", " + apLabel() + "): fix first " + plan.kpi + " – " + plan.loss + ". " + plan.actions.join(" "));
    } catch (e) { }
    AI.ctx = parts.join("\n"); AI.ctxAt = Date.now();
    return AI.ctx;
  }
  function renderAI(t) {
    var h = esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^\s*[-*•]\s+/gm, "• ").replace(/^#+\s*(.+)$/gm, "<b>$1</b>").replace(/\n/g, "<br>");
    return "<div style='font-size:11px;color:#7A7F99;margin-bottom:4px'>🤖 AI answer · may contain mistakes</div>" + h;
  }
  async function aiAnswer(q) {
    busy = true;
    var t = el("div", "bia-typing", AI.ctx ? "Thinking…" : "Thinking… (reading the whole year first, about 10 seconds)");
    chatBody.appendChild(t); scroll();
    var ctx = ""; try { ctx = await aiContext(); } catch (e) { }
    var r = await bridgeCall("ask", [q, ctx, JSON.stringify(AI.hist.slice(-6))]);
    t.remove(); busy = false;
    if (r && r.ok) {
      AI.hist.push({ q: q, a: r.text });
      bot(renderAI(r.text), true);
      more([{ t: "🏆 Rankings", fn: answerRankings }, { t: "🚀 Improve rank", fn: function () { pickState("improve"); } }]);
    } else {
      if (r && r.notConfigured) AI.on = false;
      askBuiltIn(q);
    }
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
    busy = true; var t = el("div", "bia-typing", frameReady ? "Reading the dashboard…" : "Reading the dashboard… (first answer takes a few seconds)"); chatBody.appendChild(t); scroll();
    try { await fn(); } catch (e) { bot("Sorry, I couldn't read that part of the dashboard right now. Please check your internet and try again."); }
    t.remove(); busy = false; scroll();
  }
  function menu() {
    chips([
      { t: "📅 Period: " + (apLabel() || "Year"), fn: pickPeriod },
      { t: "🏆 State rankings", fn: answerRankings },
      { t: "📍 A state's performance", fn: pickState },
      { t: "🧮 How is the score calculated?", fn: answerCalc },
      { t: "🚀 How to improve rank", fn: function () { pickState("improve"); } },
      { t: "🎯 Key focus areas", fn: answerFocus },
      { t: "📱 Retailer app features", fn: answerFeatures },
      { t: "📘 Dashboard features", fn: answerDashboard },
      { t: "⚔️ Compare two states", fn: pickCompare },
      { t: "💰 Schemes & payout", fn: answerSchemes },
      { t: "🧾 Payout calculator", fn: function () { openCalculator(); }, say: false },
      { t: "📉 Sales this month vs last", fn: function () { answerSalesTrend(window.BI_STATE || null); } }
    ]);
  }
  function more(extra) { chips((extra || []).concat([{ t: "☰ Main menu", fn: function () { bot("What else would you like to know?"); menu(); } }])); }

  var rcache = {};
  async function rankings(p) {
    p = p || curAP();
    var c = rcache[p];
    if (c && Date.now() - c.at < 300000) return c.r;
    var r = await readRankings(p);
    // A quarter without KPIs falls back to the year table: treat it as no data.
    if (r && /^q:/.test(p) && r.head.indexOf("Year score") >= 0) r = null;
    if (r) rcache[p] = { r: r, at: Date.now() };
    return r;
  }
  function pickPeriod() {
    bot("Which period should I use? (Now: " + apLabel() + ")");
    var opts = [yearPeriod()].concat(periodOptions(/^q:/).map(function (o) { return o.value; }), recentMonths(3));
    chips(opts.filter(function (v, i, a) { return v && a.indexOf(v) === i; }).map(function (v) {
      return { t: labelOf(v), fn: function () { AP = v; AI.ctx = null; bot("✅ Now answering for <b>" + esc(labelOf(v)) + "</b>.", true); menu(); } };
    }));
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
      var r = await rankings(), W = await readWeights(), isYear = /^y:/.test(curAP());
      var row = r && r.rows.find(function (x) { return x.state === state; });
      if (!row) { bot("I couldn't find " + state + " in the rankings for " + apLabel() + "."); more([{ t: "📅 Change period", fn: pickPeriod }]); return; }
      var L = kpiLines(row, W), sorted = L.slice().sort(function (a, b) { return isYear ? a.a - b.a : b.lost - a.lost; });
      var strong = L.slice().sort(function (a, b) { return b.a - a.a; })[0], weak = sorted[0];
      var above = r.rows.find(function (x) { return x.rank === row.rank - 1; });
      var h = "<b>📍 " + esc(state) + " · " + esc(r.period) + "</b><br>Rank <b>#" + row.rank + "</b> of " + r.rows.length +
        " with score <b>" + row.score + "</b>" + (row.prev ? " (was #" + row.prev + ", change " + esc(row.change) + ")" : "") + "<table>" +
        L.map(function (x) { return "<tr><td>" + esc(x.k.short) + "</td><td style='text-align:right'>" + pct(x.a) + "</td>" + (isYear ? "" : "<td style='text-align:right'>" + x.pts.toFixed(1) + "/" + x.w + "</td>") + "</tr>"; }).join("") +
        "</table>💪 Strongest: <b>" + esc(strong.k.name) + "</b> (" + pct(strong.a) + ")<br>⚠️ " + (isYear ? "Weakest" : "Losing most points") + ": <b>" + esc(weak.k.name) + "</b> (" + (isYear ? pct(weak.a) : "−" + weak.lost.toFixed(1) + " pts") + ")";
      if (above) h += "<br>⬆️ To overtake #" + above.rank + " " + esc(above.state) + " needs <b>+" + Math.max(0.1, above.score - row.score + 0.1).toFixed(1) + " pts</b>.";
      if (isYear) {
        var qs = periodOptions(/^q:/).map(function (o) { return o.value; }), trend = [];
        for (var qi = 0; qi < qs.length; qi++) {
          var qr = await rankings(qs[qi]); var x = qr && qr.rows.find(function (y) { return y.state === state; });
          if (x) trend.push(esc(labelOf(qs[qi]).replace("-", " ")) + ": <b>#" + x.rank + "</b> of " + qr.rows.length + " · score " + x.score);
        }
        if (trend.length) h += "<br><br>📈 <b>Quarter by quarter</b><br>" + trend.join("<br>");
      }
      bot(h, true);
      more([{ t: "How can " + state + " improve?", fn: function () { answerImprove(state); } },
        { t: "Compare with #1", fn: function () { answerCompare(state, r.rows[0].state === state ? r.rows[1].state : r.rows[0].state); } },
        { t: "Open " + state + " analysis", go: function () { NAV.state(state); } }]);
    });
  }

  function answerImprove(state) {
    return working(async function () {
      var r = await rankings(pointsPeriod()), W = await readWeights();
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
        h += "<br><br><b>📐 What the numbers say (" + esc(r.period) + ")</b><br>Each +10% in <b>" + esc(w0.k.short) + "</b> adds <b>+" + (w0.w * 0.1).toFixed(1) + " pts</b> (weight " + w0.w + ").";
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
      var W = await readWeights(), r = await rankings(pointsPeriod());
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
        h += "<br><b>Example: " + esc(x.state) + "</b> (#1, " + esc(r.period) + ")<br>" + L.map(function (l) { return pct(Math.min(1, l.a)) + " × " + l.w; }).join(" + ") + " = <b>" + L.reduce(function (s, l) { return s + l.pts; }, 0).toFixed(1) + "</b> (dashboard shows " + x.score + ")";
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

  // ---------------- PAYOUT CALCULATOR ----------------
  // Achievement % = Achieved ÷ Target × 100. Slab = highest slab whose From % ≤ Achievement %.
  // Retro: units → achieved × ₹/unit + bonus; value → achieved ₹ × % ÷ 100 + bonus.
  // Incremental: each band between thresholds (From % × Target ÷ 100) is paid at its own rate, + bonus.
  function computePayout(o) {
    var slabs = o.slabs.filter(function (x) { return isFinite(x.from) && isFinite(x.rate); })
      .sort(function (a, b) { return a.from - b.from; });
    var T = o.target, A = o.achieved;
    var ach = T > 0 ? A / T * 100 : 0;
    var idx = -1;
    slabs.forEach(function (sl, i) { if (sl.from <= ach + 1e-9) idx = i; });
    var res = { ach: ach, idx: idx, slabs: slabs, payout: 0, lines: [] };
    var unitPay = function (qty, rate) { return o.kind === "value" ? qty * rate / 100 : qty * rate; };
    if (idx >= 0) {
      var sl = slabs[idx], bonus = sl.bonus || 0;
      if (o.method === "retro") {
        var base = unitPay(A, sl.rate);
        res.lines.push((o.kind === "value" ? "₹" + fmt(A) + " × " + sl.rate + "%" : fmt(A) + " units × ₹" + sl.rate) + " = ₹" + fmt(base));
        res.payout = base + bonus;
      } else {
        var total = 0;
        for (var i = 0; i <= idx; i++) {
          var lo = slabs[i].from * T / 100, hi = i + 1 < slabs.length ? slabs[i + 1].from * T / 100 : Infinity;
          var qty = Math.max(0, Math.min(A, hi) - lo);
          var amt = unitPay(qty, slabs[i].rate);
          total += amt;
          res.lines.push("Band " + slabs[i].from + "%" + (isFinite(hi) ? "–" + slabs[i + 1].from + "%" : "+") + ": " +
            (o.kind === "value" ? "₹" + fmt(qty) + " × " + slabs[i].rate + "%" : fmt(qty) + " units × ₹" + slabs[i].rate) + " = ₹" + fmt(amt));
        }
        res.payout = total + bonus;
      }
      if (bonus) res.lines.push("Slab bonus = ₹" + fmt(bonus));
    }
    var next = slabs[idx + 1];
    if (next) {
      var need = Math.ceil(next.from * T / 100 - A - 1e-9);
      res.next = { slab: next, need: Math.max(0, need) };
      var alt = computePayoutNoNext({ kind: o.kind, method: o.method, target: T, achieved: A + Math.max(0, need), slabs: slabs });
      res.next.payout = alt;
    }
    return res;
  }
  function computePayoutNoNext(o) { var copy = Object.assign({}, o); var r = computePayoutCore(copy); return r; }
  function computePayoutCore(o) {
    var slabs = o.slabs, T = o.target, A = o.achieved, ach = T > 0 ? A / T * 100 : 0, idx = -1;
    slabs.forEach(function (sl, i) { if (sl.from <= ach + 1e-9) idx = i; });
    if (idx < 0) return 0;
    var unitPay = function (qty, rate) { return o.kind === "value" ? qty * rate / 100 : qty * rate; };
    if (o.method === "retro") return unitPay(A, slabs[idx].rate) + (slabs[idx].bonus || 0);
    var total = 0;
    for (var i = 0; i <= idx; i++) {
      var lo = slabs[i].from * T / 100, hi = i + 1 < slabs.length ? slabs[i + 1].from * T / 100 : Infinity;
      total += unitPay(Math.max(0, Math.min(A, hi) - lo), slabs[i].rate);
    }
    return total + (slabs[idx].bonus || 0);
  }
  function fmt(n) { return (Math.round(n * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }

  var calcCss = ".bia-form label{display:block;font-size:13px;color:#555;margin:10px 2px 4px}" +
    ".bia-form input,.bia-form select{width:100%;box-sizing:border-box;border:1px solid #D8DAE5;background:#F5F6FA;border-radius:10px;padding:10px 12px;font-size:15px;font-family:inherit}" +
    ".bia-seg{display:flex;gap:6px}.bia-seg button{flex:1;border:1px solid #D8DAE5;background:#fff;border-radius:99px;padding:9px;font-size:14px;font-family:inherit}" +
    ".bia-seg button.on{background:#4D5BF9;color:#fff;border-color:#4D5BF9}" +
    ".bia-slab{display:grid;grid-template-columns:1fr 1fr 1fr 34px;gap:6px;margin-bottom:6px}.bia-slab input{padding:9px 8px;font-size:14px}" +
    ".bia-slab button{border:0;background:#FDECEC;color:#C62828;border-radius:8px;font-size:16px}" +
    ".bia-sh{display:grid;grid-template-columns:1fr 1fr 1fr 34px;gap:6px;font-size:11.5px;color:#7A7F99;margin:8px 2px 4px}" +
    ".bia-btn{width:100%;border:0;border-radius:12px;padding:13px;font-size:16px;color:#fff;background:linear-gradient(135deg,#4D5BF9,#9152E0);margin-top:14px;font-family:inherit}" +
    ".bia-add{border:1px dashed #9AA1F5;background:#fff;color:#3D47C8;border-radius:10px;padding:8px;width:100%;font-family:inherit;font-size:14px}" +
    ".bia-result{background:#fff;border:1px solid #E6E8F0;border-radius:14px;padding:14px;margin-top:14px;font-size:14.5px;line-height:1.5}" +
    ".bia-big{font-size:28px;font-weight:800;color:#2E7D32}.bia-note{font-size:12px;color:#7A7F99;margin-top:8px}";

  function openCalculator() {
    var p = overlay("Payout calculator", "Tentative scheme payout for any month");
    if (!D.getElementById("bia-calc-css")) { var st = el("style"); st.id = "bia-calc-css"; st.textContent = calcCss; D.head.appendChild(st); }
    var body = el("div", "bia-body bia-form"); p.appendChild(body);
    var saved = {}; try { saved = JSON.parse(localStorage.getItem("bia-calc") || "{}"); } catch (e) { }
    var state = { kind: saved.kind || "units", method: saved.method || "retro",
      slabs: saved.slabs || [{ from: 80, rate: 100, bonus: 0 }, { from: 90, rate: 150, bonus: 0 }, { from: 100, rate: 200, bonus: 0 }, { from: 110, rate: 250, bonus: 1000 }] };

    function seg(labelTxt, options, key) {
      body.appendChild(el("label", null, labelTxt));
      var sg = el("div", "bia-seg");
      options.forEach(function (o) {
        var b = el("button", state[key] === o[0] ? "on" : "", o[1]);
        b.onclick = function () { state[key] = o[0]; render(); };
        sg.appendChild(b);
      });
      body.appendChild(sg);
    }
    var tIn, aIn, mIn;
    function render() {
      var tv = tIn ? tIn.value : (saved.target || ""), av = aIn ? aIn.value : (saved.achieved || ""), mv = mIn ? mIn.value : (saved.month || "");
      body.innerHTML = "";
      body.appendChild(el("label", null, "Month (optional)"));
      mIn = el("input"); mIn.type = "month"; mIn.value = mv; body.appendChild(mIn);
      seg("Scheme type", [["units", "Units (₹ per unit)"], ["value", "Value (% of ₹)"]], "kind");
      seg("Payout method", [["retro", "Retro (usual)"], ["incremental", "Incremental"]], "method");
      var u = state.kind === "value" ? "₹" : "units";
      body.appendChild(el("label", null, "Target (" + u + ")"));
      tIn = el("input"); tIn.type = "number"; tIn.inputMode = "decimal"; tIn.placeholder = "e.g. 500"; tIn.value = tv; body.appendChild(tIn);
      body.appendChild(el("label", null, "Achieved (" + u + ")"));
      aIn = el("input"); aIn.type = "number"; aIn.inputMode = "decimal"; aIn.placeholder = "e.g. 470"; aIn.value = av; body.appendChild(aIn);
      body.appendChild(el("label", null, "Slabs"));
      var sh = el("div", "bia-sh");
      ["From %", state.kind === "value" ? "Payout %" : "₹ per unit", "Bonus ₹", ""].forEach(function (h) { sh.appendChild(el("div", null, h)); });
      body.appendChild(sh);
      state.slabs.forEach(function (sl, i) {
        var r = el("div", "bia-slab");
        ["from", "rate", "bonus"].forEach(function (k) {
          var inp = el("input"); inp.type = "number"; inp.inputMode = "decimal"; inp.value = sl[k] == null ? "" : sl[k];
          inp.oninput = function () { sl[k] = inp.value === "" ? (k === "bonus" ? 0 : NaN) : parseFloat(inp.value); };
          r.appendChild(inp);
        });
        var del = el("button", null, "×"); del.onclick = function () { state.slabs.splice(i, 1); render(); };
        r.appendChild(del); body.appendChild(r);
      });
      var add = el("button", "bia-add", "+ Add slab");
      add.onclick = function () { var last = state.slabs[state.slabs.length - 1]; state.slabs.push({ from: last ? last.from + 10 : 100, rate: last ? last.rate : 0, bonus: 0 }); render(); };
      body.appendChild(add);
      var go = el("button", "bia-btn", "Calculate payout");
      var out = el("div");
      go.onclick = function () { calc(out); };
      body.appendChild(go); body.appendChild(out);
      body.appendChild(el("div", "bia-note", "Tentative estimate using the slabs you enter. Actual payout follows the official scheme circular and final achievement data."));
    }
    function calc(out) {
      var T = parseFloat(tIn.value), A = parseFloat(aIn.value);
      out.innerHTML = "";
      if (!(T > 0) || !(A >= 0)) { out.appendChild(el("div", "bia-result", "Enter a target above 0 and the achieved figure.")); return; }
      if (!state.slabs.length) { out.appendChild(el("div", "bia-result", "Add at least one slab.")); return; }
      try { localStorage.setItem("bia-calc", JSON.stringify({ kind: state.kind, method: state.method, slabs: state.slabs, target: tIn.value, achieved: aIn.value, month: mIn.value })); } catch (e) { }
      var r = computePayout({ kind: state.kind, method: state.method, target: T, achieved: A, slabs: state.slabs });
      var u = state.kind === "value" ? "₹" : " units";
      var box = el("div", "bia-result");
      var h = (mIn.value ? "<b>" + esc(new Date(mIn.value + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" })) + "</b><br>" : "") +
        "Achievement: <b>" + (Math.round(r.ach * 10) / 10) + "%</b> (" + fmt(A) + " of " + fmt(T) + (state.kind === "value" ? " ₹" : " units") + ")<br>";
      if (r.idx < 0) {
        h += "Below the first slab (" + r.slabs[0].from + "%), so payout is <b>₹0</b>.<div class='bia-big'>₹0</div>";
      } else {
        var sl = r.slabs[r.idx];
        h += "Slab reached: <b>" + sl.from + "%</b> → " + (state.kind === "value" ? sl.rate + "% of value" : "₹" + sl.rate + " per unit") + (sl.bonus ? " + ₹" + fmt(sl.bonus) + " bonus" : "") +
          "<br>Method: <b>" + (state.method === "retro" ? "Retro (whole achievement at slab rate)" : "Incremental (each band at its own rate)") + "</b>" +
          "<div class='bia-big'>₹" + fmt(r.payout) + "</div>" + r.lines.map(function (l) { return "• " + esc(l); }).join("<br>");
      }
      if (r.next) {
        h += "<br><br>🎯 <b>Next slab " + r.next.slab.from + "%:</b> sell <b>" + fmt(r.next.need) + (state.kind === "value" ? " ₹ more" : " more units") +
          "</b> → payout about <b>₹" + fmt(r.next.payout) + "</b> (+₹" + fmt(r.next.payout - r.payout) + ")";
      } else if (r.idx >= 0) h += "<br><br>🏆 Highest slab reached.";
      box.innerHTML = h; out.appendChild(box);
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    render();
  }

  // ---------------- SCHEMES, PAYOUT AND SALES ----------------
  function answerSchemes() {
    bot("<b>💰 How schemes and payouts work</b><br><br>" +
      "<b>Why schemes matter:</b> they reward retailers for hitting sell-out targets, push focus models, and give a clear reason to sell more before month end. Announcing them in the Retailer App on day 1, and showing payouts there, also lifts the app-usage KPI.<br><br>" +
      "<b>Achievement %</b> = Achieved ÷ Target × 100<br>" +
      "<b>Slab</b> = the highest slab whose From % ≤ Achievement %. Below the first slab the payout is ₹0.<br><br>" +
      "<b>Retro payout (usual):</b> the whole achievement is paid at the reached slab's rate.<br>• Units: Achieved units × slab ₹/unit + slab bonus<br>• Value: Achieved ₹ × slab % ÷ 100 + slab bonus<br><br>" +
      "<b>Incremental payout:</b> each band between thresholds is paid at its own rate.<br>• Threshold = From % × Target ÷ 100<br>• Payout = Σ (units in band × band rate) + bonus<br><br>" +
      "<b>Next-slab nudge:</b> Units needed = ⌈Next From % × Target ÷ 100⌉ − Achieved<br><br>" +
      "<b>Example (retro, units):</b> target 500, achieved 470 → 94% → 90% slab at ₹150 → 470 × 150 = <b>₹70,500</b>. 30 more units reach the 100% slab.", true);
    more([{ t: "🧾 Open payout calculator", fn: function () { openCalculator(); }, say: false },
      { t: "📱 Show payouts in the app", fn: answerFeatures }]);
  }

  function answerSalesTrend(state) {
    return working(async function () {
      var ps = [].map.call(D.querySelectorAll("#per-sel option"), function (o) { return o.value; }).filter(function (v) { return /^m:/.test(v); });
      var cur = (D.getElementById("per-sel") || {}).value || "";
      var mi = ps.indexOf(cur); if (mi < 1) mi = ps.indexOf("m:2026-10");
      if (mi < 1) mi = ps.length - 1;
      var thisM = ps[mi], prevM = ps[mi - 1];
      var a = await rankings(thisM), b = await rankings(prevM);
      var label = function (v) { var o = D.querySelector('#per-sel option[value="' + v + '"]'); return o ? o.textContent.trim() : v; };
      var avg = function (r) { var v = r ? r.rows.filter(function (x) { return x.kpis.sales != null; }) : []; return v.length ? v.reduce(function (s, x) { return s + x.kpis.sales; }, 0) / v.length : null; };
      var pick = function (r) { var x = r && r.rows.find(function (y) { return y.state === state; }); return x ? x.kpis.sales : null; };
      var aV = state ? pick(a) : avg(a), bV = state ? pick(b) : avg(b);
      var h = "<b>📉 Sales: " + esc(label(thisM)) + " vs " + esc(label(prevM)) + " · " + esc(state || "PAN India (average of states)") + "</b><br>";
      if (aV != null && bV != null) {
        h += "Sales target achievement: <b>" + pct(bV) + "</b> → <b>" + pct(aV) + "</b> (" + (aV >= bV ? "+" : "") + ((aV - bV) * 100).toFixed(1) + " pts)<br>";
        if (!state && a && b) {
          var drops = a.rows.map(function (x) { var y = b.rows.find(function (z) { return z.state === x.state; }); return y && x.kpis.sales != null && y.kpis.sales != null ? { s: x.state, d: x.kpis.sales - y.kpis.sales } : null; })
            .filter(Boolean).sort(function (p, q) { return p.d - q.d; }).slice(0, 4);
          if (drops.length && drops[0].d < 0) h += "Biggest falls: " + drops.filter(function (x) { return x.d < 0; }).map(function (x) { return esc(x.s) + " (" + (x.d * 100).toFixed(0) + " pts)"; }).join(", ") + "<br>";
        }
      } else h += "The dashboard doesn't have sales achievement for both months yet.<br>";
      if (aV != null && bV != null && aV >= bV) h += "<br>✅ In this data " + esc(label(thisM)) + " is <b>not lower</b> than " + esc(label(prevM)) + " for " + esc(state || "PAN India") + ". If your actual sell-out volume fell, it can still happen with lower targets, so check volumes too.<br>";
      h += "<br><b>Common reasons for a weaker month</b><br>" +
        "• Festive timing: buying shifts into the festive weeks (e.g. Diwali), so the month before or after looks softer.<br>" +
        "• Scheme gaps: a month without a strong scheme, or a late announcement, slows sell-out.<br>" +
        "• Higher targets: achievement % falls when targets rise faster than sales.<br>" +
        "• Stock and model availability: missing focus models or late supply.<br>" +
        "• Fewer store visits: low visit coverage usually shows up in sales next.<br>" +
        "• Competition offers in the same weeks.<br><br>" +
        "<b>What to do:</b> announce the next scheme in the app on day 1, track target vs achievement weekly, fix stock gaps and cover every store each month." +
        "<div style='color:#7A7F99;font-size:12px;margin-top:6px'>The dashboard holds target achievement %, not unit volumes or last year's sales, so year-on-year volume can't be compared here.</div>";
      bot(h, true);
      more([{ t: "💰 Schemes & payout", fn: answerSchemes }, { t: "🧾 Payout calculator", fn: function () { openCalculator(); }, say: false },
        state ? { t: "How can " + state + " improve?", fn: function () { answerImprove(state); } } : { t: "🎯 Key focus areas", fn: answerFocus }]);
    });
  }

  // Typed questions go to the AI when it's on; otherwise (or if it fails) to the built-in answers.
  function ask(q) {
    me(q);
    var n = norm(q);
    if (/\b(payout calc|calculator|calculate (my )?payout|tentative payout)\b/.test(n)) { openCalculator(); return; }
    if (AI.on && window.BIAI) return aiAnswer(q);
    askBuiltIn(q);
  }

  // Built-in answers: match states, KPIs and intent words.
  function askBuiltIn(q) {
    var n = norm(q), state = findState(q);
    var has = function (re) { return re.test(n); };
    if (has(/\b(hi|hello|hey|namaste|menu|help|start)\b/) && n.split(" ").length <= 3) { bot("Here's what I can help with:"); menu(); return; }
    if (has(/\b(vs|versus|compare|comparison)\b/)) {
      var found = mainStates().filter(function (s) { return s !== "PAN India" && n.indexOf(norm(s)) >= 0; });
      if (found.length >= 2) return answerCompare(found[0], found[1]);
      return pickCompare();
    }
    if (has(/\b(payout calc|calculator|calculate (my )?payout|tentative payout)\b/)) { openCalculator(); return; }
    if (has(/\b(slab|payout|scheme|retro|incremental|incentive)\b/) && !has(/\b(app|feature)\b/)) return answerSchemes();
    if (has(/\b(sales|volume|sell|growth|less|lower|drop|decline)\b/) && has(/\b(month|october|september|november|august|last year|year|previous|compared|why)\b/)) return answerSalesTrend(state);
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

  window.BIAssist = { openSearch: openSearch, openChat: openChat, openCalculator: openCalculator, findOnPage: findOnPage,
    computePayout: computePayout, version: "2.0" };
})();
