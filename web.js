/* vivo BI — web layer for the dashboard link.
 * Adds what the apps have: login, profile & settings, search, BI Assistant (AI + payout calculator),
 * support desk, admin tools (registered users, access logs & support desk insights).
 * The Android apps have these natively, so this file does nothing inside the apps.
 * Loaded from index.html (two lines added by tools/prepare_site.py at publish time). */
(function () {
  "use strict";
  var DE = document.documentElement;
  if (!DE.classList.contains("biw-web") || window.__biw) return;
  window.__biw = 1;

  var API = "/api/auth";
  var APP_LINKS = {
    state: "https://github.com/dishu1993goyal-commits/vivo-BI-Retailer-App-guide-status/releases/latest/download/vivo-BI-States.apk",
    admin: "https://github.com/dishu1993goyal-commits/vivo-BI-Retailer-App-guide-status/releases/latest/download/vivo-BI-Dashboard.apk"
  };
  var TOPICS = ["Overview", "Rankings", "Trends", "Retailer app usage", "Active retailers", "Support desk KPI", "Action plan",
    "KPI framework / calculation", "Sales target", "Customer visit", "Competition", "v-Notice", "Schemes & payout",
    "Data mismatch", "App issue", "Other"];
  var TOPIC_ICONS = ["🏠", "🏆", "📈", "📱", "👥", "🎧", "🎯", "🧮", "💹", "🚶", "⚔️", "🔔", "💰", "⚠️", "🛠️", "💬"];
  var KPIS = ["Overall BI KPI score", "Retailer app usage", "Sales target achievement", "Customer visit efficiency",
    "Competition management", "Support desk", "v-Notice utilization", "Scheme announcement", "Scheme payout",
    "Announcements & notifications", "App visits"];
  var FALLBACK_STATES = ["Bihar", "Chhattisgarh", "Delhi", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu & Kashmir",
    "Jharkhand", "Karnataka", "Kerala", "MHA", "MHM", "MHN", "MHP", "Madhya Pradesh", "North East", "Odisha", "Punjab",
    "Rajasthan", "Tamil Nadu", "Telangana", "Uttar Pradesh", "Uttarakhand", "West Bengal"];

  // ---------- helpers ----------
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function fmtTime(t, opt) { return t ? new Date(t).toLocaleString("en-IN", Object.assign({ timeZone: "Asia/Kolkata" }, opt || { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })) : "—"; }
  function initials(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase(); }
  function stars(n) { var s = ""; for (var i = 1; i <= 5; i++) s += i <= n ? "★" : "☆"; return s; }
  function toast(msg) {
    var t = el("div", "biw-toast", esc(msg)); document.body.appendChild(t);
    setTimeout(function () { t.classList.add("on"); }, 10);
    setTimeout(function () { t.classList.remove("on"); setTimeout(function () { t.remove(); }, 300); }, 3200);
  }
  function browserName() { var u = navigator.userAgent; return /Edg\//.test(u) ? "Edge" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : /Firefox\//.test(u) ? "Firefox" : "Browser"; }
  var DEVICE = "Web · " + browserName() + (/Mobi/.test(navigator.userAgent) ? " (mobile)" : " (desktop)");

  // ---------- session + API ----------
  var AUTH = store("biw-auth");        // {app, username, token}
  var PROFILE = store("biw-profile") || {};
  function api(body, auth) {
    var b = Object.assign({ device: DEVICE, ver: "web" }, body);
    var a = auth === false ? null : AUTH;
    if (a) { b.app = b.app || a.app; b.username = b.username || a.username; b.token = a.token; }
    return fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "X-BI-App": "1" }, body: JSON.stringify(b) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "Service not available (" + r.status + ")." }; }); })
      .catch(function () { return { ok: false, error: "No internet connection. Please try again." }; });
  }
  function isAdmin() { return AUTH && AUTH.app === "admin"; }
  function saveProfile(p) { if (p) { PROFILE = p; store("biw-profile", p); } }
  function sessionLost(res) { if (res && res.loggedOut) { logoutLocal(); showLogin("You were logged out (password changed or reset). Please log in again."); return true; } return false; }

  // ---------- styles (match the dashboard: black + gold) ----------
  var CSS = "" +
    "#biw-root{font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;color:#111}" +
    "#biw-root *{box-sizing:border-box}" +
    ".biw-bar{position:fixed;top:12px;right:12px;z-index:2147482000;display:flex;align-items:center;gap:4px;background:#0b0b0c;border:1px solid #c9a227;border-radius:99px;padding:4px;box-shadow:0 6px 18px rgba(0,0,0,.25)}" +
    ".biw-bar button{position:relative;border:0;background:transparent;color:#e6cf86;width:38px;height:38px;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}" +
    ".biw-bar button:hover{background:#1f1f22}" +
    ".biw-av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#c9a227,#8a6a1f);color:#111;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;overflow:hidden}" +
    ".biw-av img{width:100%;height:100%;object-fit:cover}" +
    ".biw-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;border-radius:99px;background:#e53935;color:#fff;font-size:10px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 4px}" +
    ".biw-ov{position:fixed;inset:0;z-index:2147482500;background:rgba(10,10,12,.55);display:flex;justify-content:flex-end}" +
    ".biw-drawer{background:#fbf9f3;width:100%;max-width:440px;height:100%;overflow:auto;box-shadow:-10px 0 30px rgba(0,0,0,.3);animation:biwIn .22s ease-out}" +
    "@keyframes biwIn{from{transform:translateX(30px);opacity:.6}to{transform:none;opacity:1}}" +
    ".biw-dhead{background:#0b0b0c;color:#fff;padding:14px 16px 18px;position:sticky;top:0;z-index:2;border-bottom:2px solid #c9a227}" +
    ".biw-dhead .row{display:flex;align-items:center;gap:10px}.biw-dhead h2{margin:0;font-size:19px;flex:1;font-weight:600}" +
    ".biw-eyebrow{font-size:11px;letter-spacing:.18em;color:#c9a227;text-transform:uppercase}" +
    ".biw-x{border:0;background:#1f1f22;color:#e6cf86;width:34px;height:34px;border-radius:50%;font-size:18px;cursor:pointer}" +
    ".biw-back{border:0;background:none;color:#e6cf86;font-size:22px;cursor:pointer;padding:0 6px 0 0}" +
    ".biw-body{padding:12px 14px 30px}" +
    ".biw-prof{background:linear-gradient(135deg,#0b0b0c,#2a2416);color:#fff;border:1px solid #c9a227;border-radius:16px;padding:18px;text-align:center}" +
    ".biw-prof .biw-av{width:84px;height:84px;font-size:28px;margin:0 auto 8px;border:2px solid #e6cf86;cursor:pointer}" +
    ".biw-prof b{display:block;font-size:19px}.biw-prof small{color:#e6cf86;font-size:13px}" +
    ".biw-pill{display:inline-block;margin-top:8px;border:1px solid #c9a227;color:#e6cf86;border-radius:99px;padding:3px 10px;font-size:12px}" +
    ".biw-sec{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:#8a6a1f;font-weight:700;margin:18px 4px 6px}" +
    ".biw-card{background:#fff;border:1px solid #eadfc4;border-radius:14px;overflow:hidden}" +
    ".biw-row{display:flex;align-items:center;gap:12px;padding:13px 14px;border-top:1px solid #f1ead8;cursor:pointer;font-size:15px}" +
    ".biw-row:first-child{border-top:0}.biw-row:hover{background:#fdf9ee}.biw-row .ic{width:26px;text-align:center;font-size:17px}" +
    ".biw-row .lab{flex:1}.biw-row .val{color:#6b6657;font-size:13px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.biw-row .chev{color:#c9b98a;font-size:20px}" +
    ".biw-btn{display:block;width:100%;border:0;border-radius:12px;padding:13px;font:600 15px inherit;cursor:pointer;margin-top:12px}" +
    ".biw-gold{background:linear-gradient(135deg,#e6cf86,#c9a227);color:#111}" +
    ".biw-dark{background:#0b0b0c;color:#e6cf86;border:1px solid #c9a227}" +
    ".biw-danger{background:#fff;color:#b3402f;border:1px solid #efc6bf}" +
    ".biw-link{display:block;text-align:center;color:#8a6a1f;font-size:14px;margin-top:12px;cursor:pointer;text-decoration:none}" +
    ".biw-f label{display:block;font-size:13px;color:#6b6657;margin:12px 2px 5px}" +
    ".biw-f input,.biw-f select,.biw-f textarea{width:100%;border:1px solid #e3d9bf;background:#fff;border-radius:10px;padding:11px 12px;font:15px inherit;color:#111}" +
    ".biw-f textarea{min-height:110px;resize:vertical}" +
    ".biw-msg{font-size:14px;margin-top:10px;text-align:center;min-height:18px}.biw-msg.err{color:#b3402f}.biw-msg.ok{color:#2e7d5b}" +
    ".biw-seg{display:flex;gap:6px;margin:10px 0}.biw-seg button{flex:1;border:1px solid #e3d9bf;background:#fff;border-radius:99px;padding:9px 6px;font:600 13px inherit;cursor:pointer;color:#333}" +
    ".biw-seg button.on{background:#0b0b0c;color:#e6cf86;border-color:#0b0b0c}" +
    ".biw-item{background:#fff;border:1px solid #eadfc4;border-radius:12px;padding:12px 14px;margin-top:8px;font-size:14px}" +
    ".biw-item b{font-size:15px}.biw-mut{color:#6b6657;font-size:12.5px}" +
    ".biw-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);background:#0b0b0c;color:#e6cf86;border:1px solid #c9a227;padding:10px 16px;border-radius:12px;font:14px 'Segoe UI',system-ui,sans-serif;z-index:2147483600;opacity:0;transition:.25s;max-width:90vw}" +
    ".biw-toast.on{opacity:1;transform:translate(-50%,0)}" +
    // login
    ".biw-login{position:fixed;inset:0;z-index:2147483000;background:radial-gradient(circle at 80% 0%,#2a2416,#0b0b0c 60%);display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto}" +
    ".biw-lcard{width:100%;max-width:400px;background:#fbf9f3;border-radius:20px;padding:22px 20px 18px;box-shadow:0 20px 50px rgba(0,0,0,.5);border:1px solid #c9a227}" +
    ".biw-logo{background:#fff;border-radius:12px;padding:8px 12px;display:inline-block;box-shadow:0 2px 10px rgba(0,0,0,.08)}.biw-logo img{height:40px;display:block}" +
    ".biw-lcard h1{font:400 26px Georgia,'Times New Roman',serif;margin:16px 0 2px}.biw-lcard h1 em{color:#c9a227;font-style:italic}" +
    ".biw-lcard p{margin:0;color:#6b6657;font-size:14px}" +
    ".biw-note{background:#fff7e0;border:1px solid #f0dca0;border-radius:10px;padding:10px 12px;font-size:13px;color:#5c4300;margin-top:14px;line-height:1.45}" +
    ".biw-note a{color:#8a6a1f;font-weight:700}" +
    // support desk (same look as the apps)
    ".biw-sd{position:fixed;inset:0;z-index:2147482600;background:#F3F4F9;overflow:auto;font-family:'Segoe UI',system-ui,-apple-system,Roboto,sans-serif}" +
    ".biw-sdw{max-width:760px;margin:0 auto;padding-bottom:30px}" +
    ".biw-hero{background:linear-gradient(135deg,#1B1F5E,#3A3FB8 55%,#9152E0);color:#fff;padding:12px 16px 20px}" +
    ".biw-hero .top{display:flex;align-items:center;gap:10px}.biw-hero .top .sp{flex:1}" +
    ".biw-hero .logo{background:#fff;border-radius:10px;padding:5px 8px}.biw-hero .logo img{height:28px;display:block}" +
    ".biw-hero .hs{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:22px}" +
    ".biw-hero h2{margin:14px 0 2px;font-size:21px}.biw-hero p{margin:0;color:#DCDDFB;font-size:13px}" +
    ".biw-hero .bk{border:0;background:none;color:#fff;font-size:24px;cursor:pointer;padding:0 6px 0 0}" +
    ".biw-stats{display:flex;gap:6px;padding:12px 11px 2px}.biw-stats div{flex:1;background:#fff;border:1px solid #E6E8F0;border-radius:12px;text-align:center;padding:10px 4px;font-weight:700;font-size:13px}" +
    ".biw-stats b{display:block;font-size:20px}" +
    ".biw-sdb{padding:0 14px}" +
    ".biw-blue{background:linear-gradient(135deg,#4D5BF9,#9152E0);color:#fff}" +
    ".biw-tk{display:flex;background:#fff;border:1px solid #E6E8F0;border-radius:12px;margin-top:10px;overflow:hidden;cursor:pointer}" +
    ".biw-tk .strip{width:4px;flex:none}.biw-tk .in{padding:12px 14px;flex:1;min-width:0}" +
    ".biw-tk .h{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#3D47C8}" +
    ".biw-tk .ti{width:30px;height:30px;border-radius:9px;background:#EEF0FF;display:flex;align-items:center;justify-content:center;font-size:15px}" +
    ".biw-tk .s{font-size:16px;font-weight:700;margin:7px 0 2px;color:#141833}" +
    ".biw-tk .p{color:#4A4F6A;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".biw-st{margin-left:auto;border-radius:99px;padding:2px 9px;font-size:11px;font-weight:700}" +
    ".biw-st.open{background:#FFF4E5;color:#B26A00}.biw-st.answered{background:#E6F4EA;color:#1E9E61}.biw-st.closed{background:#EEE;color:#616161}" +
    ".biw-sc{background:#fff;border:1px solid #E6E8F0;border-radius:14px;padding:14px;margin:12px 14px 0}" +
    ".biw-sc h4{margin:0 0 8px;color:#3D47C8;font-size:13px}" +
    ".biw-chips{display:grid;grid-template-columns:1fr 1fr;gap:6px}" +
    ".biw-chips button{border:1px solid #E1E3EE;background:#F7F8FC;border-radius:10px;padding:10px 8px;text-align:left;font:13px inherit;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".biw-chips button.on{border:2px solid #4D5BF9;background:#EEF0FF;color:#2B33A6;font-weight:700}" +
    ".biw-sdf input,.biw-sdf select,.biw-sdf textarea{width:100%;border:1px solid #D8DAE5;background:#F5F6FA;border-radius:10px;padding:11px 12px;font:15px inherit;margin-bottom:8px}" +
    ".biw-sdf label{display:block;font-size:13px;color:#666;margin:6px 2px 4px}.biw-sdf textarea{min-height:110px}" +
    ".biw-att{display:flex;align-items:center;gap:8px;background:#F5F6FA;border-radius:8px;padding:8px 10px;margin-top:6px;font-size:13px}" +
    ".biw-att span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.biw-att button{border:0;background:none;color:#C62828;font-size:16px;cursor:pointer}" +
    ".biw-attbtn{width:100%;border:1px dashed #9AA1F5;background:#F7F8FF;color:#4D5BF9;border-radius:10px;padding:11px;font:600 14px inherit;cursor:pointer}" +
    ".biw-bub{border-radius:14px;padding:10px 14px;margin:8px 14px;border:1px solid #E6E8F0;background:#fff;max-width:620px}" +
    ".biw-bub.adm{background:#EEF0FF;border-color:#C9CDF7;margin-left:40px}.biw-bub.usr{margin-right:40px}" +
    ".biw-bub .w{font-weight:700;font-size:13px}.biw-bub .t{font-size:15px;margin:4px 0 2px;white-space:pre-wrap;word-wrap:break-word}" +
    ".biw-bub .tm{font-size:11px;color:#7A7F99}" +
    ".biw-file{display:block;background:#fff;border:1px solid #DADCF5;border-radius:8px;padding:8px 10px;margin-top:6px;color:#2B33A6;font-size:14px;cursor:pointer}" +
    ".biw-rate{background:#FFFBF0;border:1px solid #F5D58A;border-radius:14px;padding:12px;margin:2px 14px 8px 40px;text-align:center}" +
    ".biw-rate .q{font-weight:700;color:#5C4300;font-size:14px}.biw-rate .row{display:flex;justify-content:space-around;margin:6px 0 2px}" +
    ".biw-rate .row button{border:0;background:none;font-size:34px;color:#F5A623;cursor:pointer;line-height:1}" +
    ".biw-rate small{color:#8A6D1F;font-size:11px}" +
    ".biw-frame{position:fixed;inset:0;z-index:2147482700;background:#F3F4F9;display:flex;flex-direction:column}" +
    ".biw-frame .bar{background:#0b0b0c;color:#e6cf86;display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:2px solid #c9a227}" +
    ".biw-frame iframe{flex:1;border:0;width:100%}" +
    "@media(max-width:560px){html.biw-web .rp .top .sbfoot2{display:none!important}.biw-bar{top:13px;right:8px;padding:3px}.biw-bar button{width:34px;height:34px;font-size:16px}.biw-av{width:30px;height:30px}}";
  function css() { if (!document.getElementById("biw-css")) { var s = el("style"); s.id = "biw-css"; s.textContent = CSS; document.head.appendChild(s); } }

  var ROOT = el("div"); ROOT.id = "biw-root";
  function mount() { css(); if (!ROOT.isConnected) document.body.appendChild(ROOT); }
  function unlock() { DE.classList.remove("biw-locked"); }
  function lock() { DE.classList.add("biw-locked"); }

  // ---------- states list (same as the dashboard) ----------
  var STATES = FALLBACK_STATES;
  fetch("/states.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.states && j.states.length) STATES = j.states; }).catch(function () { });

  // ---------- LOGIN ----------
  var loginEl = null;
  function showLogin(info) {
    mount(); lock();
    if (barEl) { barEl.remove(); barEl = null; }
    if (loginEl) loginEl.remove();
    var role = store("biw-role") || "state";
    loginEl = el("div", "biw-login");
    loginEl.innerHTML =
      '<div class="biw-lcard biw-f">' +
      '<div class="biw-logo"><img src="brand-logo.png" alt="vivo Business Innovation"></div>' +
      '<h1>BI KPI <em>Dashboard</em></h1><p>Log in with your app user name and password</p>' +
      '<div class="biw-seg"><button data-r="state">State user</button><button data-r="admin">Admin user</button></div>' +
      '<label>User name</label><input id="biw-u" autocomplete="username" maxlength="30">' +
      '<label>Password</label><input id="biw-p" type="password" autocomplete="current-password" maxlength="64">' +
      '<label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="biw-sp" style="width:auto"> Show password</label>' +
      '<div class="biw-msg" id="biw-lm"></div>' +
      '<button class="biw-btn biw-dark" id="biw-go">Log in</button>' +
      '<div class="biw-note">New user, or forgot your password? Sign-up and password reset need mobile verification with Truecaller, so they are done in the mobile app: ' +
      '<a href="' + APP_LINKS.state + '">State app</a> · <a href="' + APP_LINKS.admin + '">Admin app</a>. Then log in here with the same user name and password.</div>' +
      "</div>";
    ROOT.appendChild(loginEl);
    var u = loginEl.querySelector("#biw-u"), p = loginEl.querySelector("#biw-p"), m = loginEl.querySelector("#biw-lm"), go = loginEl.querySelector("#biw-go");
    u.value = store("biw-last-user") || "";
    function setRole(r) { role = r; [].forEach.call(loginEl.querySelectorAll("[data-r]"), function (b) { b.classList.toggle("on", b.dataset.r === r); }); }
    [].forEach.call(loginEl.querySelectorAll("[data-r]"), function (b) { b.onclick = function () { setRole(b.dataset.r); }; });
    setRole(role);
    loginEl.querySelector("#biw-sp").onchange = function () { p.type = this.checked ? "text" : "password"; };
    if (info) { m.className = "biw-msg ok"; m.textContent = info; }
    function doLogin() {
      if (!u.value.trim() || !p.value) { m.className = "biw-msg err"; m.textContent = "Enter your user name and password."; return; }
      go.disabled = true; go.textContent = "Logging in…";
      api({ app: role, action: "login", username: u.value.trim(), password: p.value }, false).then(function (res) {
        go.disabled = false; go.textContent = "Log in";
        if (!res.ok) { m.className = "biw-msg err"; m.textContent = res.error || "Login failed."; p.value = ""; return; }
        AUTH = { app: role, username: res.username, token: res.token };
        store("biw-auth", AUTH); store("biw-role", role); store("biw-last-user", res.username);
        saveProfile(res.profile);
        loginEl.remove(); loginEl = null;
        startSession(true);
      });
    }
    go.onclick = doLogin;
    p.onkeydown = function (e) { if (e.key === "Enter") doLogin(); };
    setTimeout(function () { (u.value ? p : u).focus(); }, 50);
  }
  function logoutLocal() { AUTH = null; PROFILE = {}; store("biw-auth", null); store("biw-profile", null); store("biw-photo", null); }

  // ---------- SESSION START ----------
  function startSession(fresh) {
    mount();
    var go = function () {
      if (AUTH.app === "state") {
        if (!PROFILE.state) { askState(); return; }
        applyStateLock(PROFILE.state);
      }
      unlock(); buildBar(); refreshBadge(); syncPhoto();
    };
    if (fresh) { go(); return; }
    // Check the saved session (also records the visit in the access log).
    api({ action: "ping" }).then(function (res) {
      if (!res.ok) { if (res.loggedOut) { logoutLocal(); showLogin(); } else { go(); } return; }
      saveProfile(res.profile); go();
    });
  }

  function askState() {
    var ov = el("div", "biw-login");
    ov.innerHTML = '<div class="biw-lcard biw-f"><div class="biw-logo"><img src="brand-logo.png" alt=""></div><h1>Your <em>state</em></h1>' +
      "<p>Select the state you belong to. You'll see Active retailer IDs for this state only.</p><label>State</label><select id=\"biw-st\"><option value=\"\">Select your state</option>" +
      STATES.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("") + '</select><div class="biw-msg" id="biw-sm"></div><button class="biw-btn biw-dark" id="biw-ss">Save</button></div>';
    ROOT.appendChild(ov);
    ov.querySelector("#biw-ss").onclick = function () {
      var v = ov.querySelector("#biw-st").value, m = ov.querySelector("#biw-sm");
      if (!v) { m.className = "biw-msg err"; m.textContent = "Please select your state."; return; }
      api({ action: "set-state-once", state: v }).then(function (res) {
        if (!res.ok) { if (!sessionLost(res)) { m.className = "biw-msg err"; m.textContent = res.error; } return; }
        saveProfile(res.profile); ov.remove(); startSession(true);
      });
    };
  }

  // ---------- STATE USER RESTRICTIONS (same rules as the state app) ----------
  function applyStateLock(own) {
    if (window.__bist) return;
    window.__bist = 1; window.__biStateApp = 1; window.BI_STATE = own;
    var retSel = '[data-t="ret"],[data-t="retv"],[data-go="ret"],[data-go="retv"],a[href*="retailers="],';
    var cssTxt = "#data-tools,#unlock-b,#exmenu,#imodal,#umodal,#lmodal,#cmodal,#tmodal," + (own ? "" : retSel) + "input[type=file]:not(.biw-file-in){display:none!important}";
    var st = el("style"); st.textContent = cssTxt; document.head.appendChild(st);
    var bad = new RegExp("(import data|export & share|edit leaders|save updated file|shareable copy|blank template|common all-states|common file|unlock my state|save png" + (own ? "" : "|active retailers|retailer ids") + ")", "i");
    var exl = /(excel|export)/i;
    function hashTxt() { try { return decodeURIComponent(location.hash.slice(1)); } catch (x) { return ""; } }
    function retvOn() { var b = document.querySelector('#tabs [data-t="retv"]'); return !!(b && b.getAttribute("aria-selected") === "true"); }
    function scopeVal() { var s = document.getElementById("scope-sel"); return s && s.selectedOptions[0] ? s.selectedOptions[0].textContent.trim() : ""; }
    function inRet() { return /^retailers=/i.test(hashTxt()) || retvOn(); }
    window.__biCanExport = function () { if (!own || !inRet()) return false; var h = hashTxt(); if (/^retailers=/i.test(h)) return h.indexOf("retailers=" + own + "~") === 0; return scopeVal() === own; };
    function setScope() { var s = document.getElementById("scope-sel"); if (!s) return; var o = [].find.call(s.options, function (x) { return x.textContent.trim() === own; }); if (o && s.value !== o.value) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); } }
    function enforce() { var h = hashTxt(), m = /^retailers=([^~]*)~?(.*)$/i.exec(h); if (m && m[1] !== own) { location.replace("#retailers=" + encodeURIComponent(own) + "~" + (m[2] || "all")); return; } if (retvOn() && scopeVal() !== own) setScope(); }
    function check(e) {
      if (e.closest && e.closest("#biw-root,.bia-ov")) return;
      if (e.__bis === 1) return; var t = (e.textContent || "") + " " + (e.title || "");
      if (bad.test(t)) { e.style.setProperty("display", "none", "important"); e.__bis = 1; return; }
      if (exl.test(t)) { if (window.__biCanExport()) { if (e.__bis === 2) { e.style.removeProperty("display"); e.__bis = 0; } } else { e.style.setProperty("display", "none", "important"); e.__bis = 2; } }
    }
    function scan() { enforce(); [].forEach.call(document.querySelectorAll("button,a"), check); }
    var q = 0; function tick() { if (q) return; q = 1; setTimeout(function () { q = 0; scan(); }, 120); }
    new MutationObserver(tick).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
    window.addEventListener("hashchange", tick);
    document.addEventListener("change", function (e) { if (e.target && e.target.id === "scope-sel") tick(); }, true);
    // Excel downloads only from own-state retailer view.
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href*="retailers="]') : null;
      if (a) { var h2 = ""; try { h2 = decodeURIComponent((a.getAttribute("href") || "").split("#")[1] || ""); } catch (x) { }
        if (h2.indexOf("retailers=" + own + "~") !== 0) { e.preventDefault(); e.stopImmediatePropagation(); location.hash = "retailers=" + encodeURIComponent(own) + "~all"; } }
    }, true);
    var oc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      var h = this.href || "";
      if (this.hasAttribute("download") && (h.indexOf("blob:") === 0 || h.indexOf("data:") === 0) && !this.__biwOwn && !window.__biCanExport()) return;
      return oc.apply(this, arguments);
    };
    scan();
  }

  // ---------- TOP BAR ----------
  var barEl = null, badgeEl = null;
  function buildBar() {
    if (barEl) barEl.remove();
    barEl = el("div", "biw-bar");
    barEl.innerHTML = '<button title="Search" aria-label="Search">🔍</button><button title="BI Assistant" aria-label="BI Assistant">💬</button>' +
      '<button title="Support desk" aria-label="Support desk">🎧<span class="biw-badge"></span></button><button title="Profile" aria-label="Profile & settings"><span class="biw-av"></span></button>';
    var b = barEl.querySelectorAll("button");
    b[0].onclick = function () { assistant("openSearch"); };
    b[1].onclick = function () { assistant("openChat"); };
    b[2].onclick = function () { openSupport(); };
    b[3].onclick = function () { openDrawer(); };
    badgeEl = barEl.querySelector(".biw-badge");
    ROOT.appendChild(barEl);
    paintAvatar(barEl.querySelector(".biw-av"));
  }
  function paintAvatar(node) {
    if (!node) return;
    var ph = store("biw-photo");
    node.innerHTML = ph && ph.data ? '<img alt="" src="data:image/jpeg;base64,' + ph.data + '">' : esc(initials(PROFILE.fullName || (AUTH && AUTH.username)));
  }
  function syncPhoto() {
    var v = PROFILE.photoVersion || 0, have = store("biw-photo");
    if (!v) { store("biw-photo", null); paintAvatar(barEl && barEl.querySelector(".biw-av")); return; }
    if (have && have.v === v) return;
    api({ action: "get-photo" }).then(function (res) { if (res.ok && res.photo) { store("biw-photo", { v: res.photoVersion, data: res.photo }); paintAvatar(barEl && barEl.querySelector(".biw-av")); } });
  }
  function refreshBadge() {
    if (!AUTH) return;
    api({ action: "support-unread" }).then(function (res) {
      if (!res.ok || !badgeEl) return;
      badgeEl.textContent = res.unread > 9 ? "9+" : res.unread; badgeEl.style.display = res.unread > 0 ? "flex" : "none";
    });
  }
  setInterval(function () { if (AUTH && document.visibilityState === "visible") refreshBadge(); }, 120000);

  // ---------- BI ASSISTANT (search, chat, AI, payout calculator) ----------
  window.__biaiPending = window.__biaiPending || {};
  window.BIAI = {   // same interface the apps provide; answers come from the accounts service
    status: function (id) { api({ action: "ai-status" }).then(function (r) { window.__biaiCb && window.__biaiCb(id, JSON.stringify(r)); }); },
    ask: function (id, q, ctx, hist) {
      var h = []; try { h = JSON.parse(hist || "[]"); } catch (e) { }
      api({ action: "ai-ask", question: q, context: ctx, history: h }).then(function (r) { window.__biaiCb && window.__biaiCb(id, JSON.stringify(r)); });
    }
  };
  var assistLoading = null;
  function loadAssistant() {
    if (window.BIAssist && parseFloat(window.BIAssist.version || "0") >= 2) return Promise.resolve();
    if (assistLoading) return assistLoading;
    window.BI_APP = AUTH ? AUTH.app : "web";
    assistLoading = new Promise(function (res, rej) {
      var s = el("script"); s.src = "/assistant.js?v=" + Date.now(); s.onload = function () { res(); }; s.onerror = function () { assistLoading = null; rej(); };
      document.head.appendChild(s);
    });
    return assistLoading;
  }
  function assistant(fn) {
    loadAssistant().then(function () { if (window.BIAssist && window.BIAssist[fn]) window.BIAssist[fn](); })
      .catch(function () { toast("Couldn't load the assistant. Check your internet."); });
  }

  // ---------- PROFILE DRAWER ----------
  var drawerOv = null;
  function closeDrawer() { if (drawerOv) { drawerOv.remove(); drawerOv = null; } }
  function drawer(title, back, bodyHtml) {
    closeDrawer();
    drawerOv = el("div", "biw-ov");
    var d = el("div", "biw-drawer");
    d.innerHTML = '<div class="biw-dhead"><div class="biw-eyebrow">vivo Business Innovation</div><div class="row">' +
      (back ? '<button class="biw-back" aria-label="Back">←</button>' : "") + "<h2>" + esc(title) + '</h2><button class="biw-x" aria-label="Close">×</button></div></div>' +
      '<div class="biw-body">' + bodyHtml + "</div>";
    drawerOv.appendChild(d); ROOT.appendChild(drawerOv);
    d.querySelector(".biw-x").onclick = closeDrawer;
    if (back) d.querySelector(".biw-back").onclick = back;
    drawerOv.addEventListener("click", function (e) { if (e.target === drawerOv) closeDrawer(); });
    return d;
  }
  function rows(items) {
    return '<div class="biw-card">' + items.filter(Boolean).map(function (it, i) {
      return '<div class="biw-row" data-i="' + i + '"><span class="ic">' + it[0] + '</span><span class="lab">' + esc(it[1]) + '</span><span class="val">' + esc(it[2] || "") + "</span>" + (it[3] ? '<span class="chev">›</span>' : "") + "</div>";
    }).join("") + "</div>";
  }
  function bindRows(d, sel, items) { var list = items.filter(Boolean); [].forEach.call(d.querySelectorAll(sel + " .biw-row"), function (r) { var it = list[+r.dataset.i]; if (it && it[3]) r.onclick = it[3]; }); }

  var ZOOMS = [[0.9, "Small"], [1, "Normal"], [1.1, "Large"], [1.2, "Extra large"]];
  function applyZoom() { var z = store("biw-zoom") || 1, r = document.querySelector(".rp") || document.getElementById("dash-root"); if (r) r.style.zoom = z === 1 ? "" : z; }
  function zoomLabel() { var z = store("biw-zoom") || 1; var f = ZOOMS.find(function (x) { return x[0] === z; }); return f ? f[1] : "Normal"; }

  function openDrawer() {
    var p = PROFILE, admin = isAdmin();
    var ph = store("biw-photo");
    var adminItems = [["👥", "Registered users", "", function () { showUsers("state"); }], ["📊", "Access logs & insights", "", function () { openInsights("logs"); }], ["🎧", "Support desk report", "", function () { openInsights("support"); }]];
    var helpItems = [["🎧", "Support desk", "", function () { closeDrawer(); openSupport(); }], ["🧾", "Payout calculator", "", function () { closeDrawer(); assistant("openCalculator"); }], ["💬", "BI Assistant", "", function () { closeDrawer(); assistant("openChat"); }]];
    var accItems = [["👤", "Edit profile", p.email || "", showEdit], ["🔒", "Change password", "", showPassword]];
    var setItems = [["🔠", "Dashboard text size", zoomLabel(), chooseZoom], ["🔄", "Refresh dashboard", "", function () { location.reload(); }]];
    var supItems = [["📲", "Get the State app", "APK", function () { location.href = APP_LINKS.state; }], admin ? ["📲", "Get the Admin app", "APK", function () { location.href = APP_LINKS.admin; }] : null,
      ["🔗", "Copy dashboard link", "", function () { try { navigator.clipboard.writeText(location.origin + "/"); toast("Link copied"); } catch (e) { toast(location.origin); } }],
      ["🛡️", "Privacy policy", "", function () { window.open("privacy.html", "_blank"); }], ["📄", "Terms of service", "", function () { window.open("terms.html", "_blank"); }]];
    var about = [["ℹ️", "Version", "Web · " + (window.BIAssist ? "assistant " + window.BIAssist.version : "latest"), null], p.createdAt ? ["📅", "Member since", fmtTime(p.createdAt, { day: "numeric", month: "short", year: "numeric" }), null] : null];
    var sub = (admin ? "Admin" : "State user") + (p.designation ? " · " + p.designation : "") + (p.state ? " · " + p.state : "");
    var d = drawer("Profile", null,
      '<div class="biw-prof"><div class="biw-av" id="biw-pav">' + (ph && ph.data ? '<img alt="" src="data:image/jpeg;base64,' + ph.data + '">' : esc(initials(p.fullName || AUTH.username))) + "</div>" +
      '<a class="biw-link" id="biw-chph" style="color:#e6cf86;margin:0 0 6px">📷 Change photo</a><b>' + esc(p.fullName || AUTH.username) + "</b><small>@" + esc(AUTH.username) + (p.phone ? " · " + esc(p.phone) : "") + '</small><br><span class="biw-pill">' + esc(sub) + "</span></div>" +
      (admin ? '<div class="biw-sec">Admin tools</div><div id="biw-r0">' + rows(adminItems) + "</div>" : "") +
      '<div class="biw-sec">Help & tools</div><div id="biw-r1">' + rows(helpItems) + "</div>" +
      '<div class="biw-sec">Account</div><div id="biw-r2">' + rows(accItems) + "</div>" +
      '<div class="biw-sec">Settings</div><div id="biw-r3">' + rows(setItems) + "</div>" +
      '<div class="biw-sec">Apps & support</div><div id="biw-r4">' + rows(supItems) + "</div>" +
      '<div class="biw-sec">About</div><div id="biw-r5">' + rows(about) + "</div>" +
      '<button class="biw-btn biw-danger" id="biw-lo">Log out</button><a class="biw-link" id="biw-del" style="color:#999;font-size:13px">Delete my account</a>');
    if (admin) bindRows(d, "#biw-r0", adminItems);
    bindRows(d, "#biw-r1", helpItems); bindRows(d, "#biw-r2", accItems); bindRows(d, "#biw-r3", setItems); bindRows(d, "#biw-r4", supItems);
    d.querySelector("#biw-pav").onclick = d.querySelector("#biw-chph").onclick = photoMenu;
    d.querySelector("#biw-lo").onclick = function () {
      if (!confirm("Log out? You'll need your user name and password to log in again.")) return;
      api({ action: "logout" }); logoutLocal(); closeDrawer(); location.hash = ""; showLogin();
    };
    d.querySelector("#biw-del").onclick = function () {
      var pw = prompt("This permanently deletes your account. Enter your password to confirm:");
      if (!pw) return;
      api({ action: "delete-account", password: pw }).then(function (res) {
        if (!res.ok) { if (!sessionLost(res)) toast(res.error); return; }
        logoutLocal(); store("biw-last-user", null); closeDrawer(); showLogin("Your account has been deleted.");
      });
    };
  }
  function chooseZoom() {
    var d = drawer("Dashboard text size", openDrawer, rows(ZOOMS.map(function (z) { return [store("biw-zoom") === z[0] || (!store("biw-zoom") && z[0] === 1) ? "●" : "○", z[1], Math.round(z[0] * 100) + "%", function () { store("biw-zoom", z[0]); applyZoom(); openDrawer(); }]; })));
    bindRows(d, "", ZOOMS.map(function (z) { return [0, 0, 0, function () { store("biw-zoom", z[0]); applyZoom(); openDrawer(); }]; }));
  }
  function photoMenu() {
    var inp = el("input"); inp.type = "file"; inp.accept = "image/*"; inp.className = "biw-file-in";
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      var img = new Image(), url = URL.createObjectURL(f);
      img.onload = function () {
        var c = document.createElement("canvas"), s = Math.min(img.width, img.height); c.width = c.height = 320;
        c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 320, 320);
        URL.revokeObjectURL(url);
        var data = c.toDataURL("image/jpeg", 0.82).split(",")[1];
        toast("Uploading photo…");
        api({ action: "upload-photo", photo: data }).then(function (res) {
          if (!res.ok) { if (!sessionLost(res)) toast(res.error); return; }
          saveProfile(res.profile); store("biw-photo", { v: res.profile.photoVersion, data: data });
          paintAvatar(barEl && barEl.querySelector(".biw-av")); toast("Profile photo updated"); openDrawer();
        });
      };
      img.onerror = function () { toast("Couldn't use this photo. Please choose another."); };
      img.src = url;
    };
    if (PROFILE.photoVersion && confirm("Remove your profile photo? (Cancel to choose a new one)")) {
      api({ action: "remove-photo" }).then(function (res) { if (res.ok) { saveProfile(res.profile); store("biw-photo", null); paintAvatar(barEl && barEl.querySelector(".biw-av")); openDrawer(); } });
      return;
    }
    inp.click();
  }
  function showEdit() {
    var p = PROFILE, admin = isAdmin();
    var d = drawer("Edit profile", openDrawer, '<div class="biw-f">' +
      '<label>Full name</label><input id="e-n" maxlength="40" value="' + esc(p.fullName || "") + '">' +
      '<label>Email (optional)</label><input id="e-e" type="email" maxlength="80" value="' + esc(p.email || "") + '">' +
      (admin ? '<label>State / region (optional)</label><select id="e-s"><option value=""></option>' + STATES.concat(["PAN India / HO"]).map(function (s) { return "<option" + (s === p.state ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select>"
        : '<label>Your state</label><div style="font-weight:700;padding:6px 2px">📍 ' + esc(p.state || "—") + ' 🔒</div><div class="biw-mut">Your state decides which Active retailer IDs you can see. Ask a BI admin to change it.</div>') +
      '<label>Designation (optional)</label><input id="e-d" maxlength="50" value="' + esc(p.designation || "") + '">' +
      '<div class="biw-mut" style="margin-top:10px">@' + esc(AUTH.username) + " · " + esc(p.phone || "") + "<br>User name and mobile number can't be changed.</div>" +
      '<div class="biw-msg" id="e-m"></div><button class="biw-btn biw-dark" id="e-go">Save</button></div>');
    d.querySelector("#e-go").onclick = function () {
      var prof = { fullName: d.querySelector("#e-n").value.trim(), email: d.querySelector("#e-e").value.trim(), designation: d.querySelector("#e-d").value.trim(), state: admin ? d.querySelector("#e-s").value : p.state };
      api({ action: "update-profile", profile: prof }).then(function (res) {
        var m = d.querySelector("#e-m");
        if (!res.ok) { if (!sessionLost(res)) { m.className = "biw-msg err"; m.textContent = res.error; } return; }
        saveProfile(res.profile); paintAvatar(barEl && barEl.querySelector(".biw-av")); toast("Saved"); openDrawer();
      });
    };
  }
  function showPassword() {
    var d = drawer("Change password", openDrawer, '<div class="biw-f"><label>Current password</label><input id="c-o" type="password" maxlength="64">' +
      '<label>New password (min 6 characters)</label><input id="c-n" type="password" maxlength="64"><label>Confirm new password</label><input id="c-c" type="password" maxlength="64">' +
      '<div class="biw-msg" id="c-m"></div><button class="biw-btn biw-dark" id="c-go">Change password</button></div>');
    d.querySelector("#c-go").onclick = function () {
      var m = d.querySelector("#c-m"), n = d.querySelector("#c-n").value;
      if (n.length < 6) { m.className = "biw-msg err"; m.textContent = "Password must be at least 6 characters."; return; }
      if (n !== d.querySelector("#c-c").value) { m.className = "biw-msg err"; m.textContent = "Passwords do not match."; return; }
      api({ action: "change-password", currentPassword: d.querySelector("#c-o").value, newPassword: n }).then(function (res) {
        if (!res.ok) { if (!sessionLost(res)) { m.className = "biw-msg err"; m.textContent = res.error; } return; }
        toast("Password changed. Other devices have been logged out."); openDrawer();
      });
    };
  }

  // ---------- ADMIN: registered users + insights ----------
  function showUsers(which, q) {
    var d = drawer("Registered users", openDrawer, '<div class="biw-seg"><button data-w="state">State app users</button><button data-w="admin">Admin app users</button></div>' +
      '<div class="biw-f"><input id="u-q" placeholder="Search name, user name, mobile, state" value="' + esc(q || "") + '"></div><div class="biw-mut" id="u-c" style="margin-top:8px">Loading…</div><div id="u-l"></div>');
    [].forEach.call(d.querySelectorAll("[data-w]"), function (b) { b.classList.toggle("on", b.dataset.w === which); b.onclick = function () { showUsers(b.dataset.w); }; });
    api({ action: "admin-users", which: which }).then(function (res) {
      if (!res.ok) { if (!sessionLost(res)) d.querySelector("#u-c").textContent = res.error; return; }
      var users = res.users || [];
      function draw() {
        var s = d.querySelector("#u-q").value.trim().toLowerCase();
        var list = users.filter(function (u) { return !s || [u.fullName, u.username, u.phone, u.state, u.designation].join(" ").toLowerCase().indexOf(s) >= 0; });
        d.querySelector("#u-c").textContent = "Showing " + list.length + " of " + users.length + " users";
        d.querySelector("#u-l").innerHTML = list.map(function (u, i) {
          return '<div class="biw-item"><b>' + esc(u.fullName) + '</b><br><span style="color:#8a6a1f">@' + esc(u.username) + '</span> · <a href="tel:' + esc(u.phone) + '">📞 ' + esc(u.phone) + "</a>" +
            ([u.designation, u.state].filter(Boolean).length ? '<div class="biw-mut">' + esc([u.designation, u.state].filter(Boolean).join(" · ")) + "</div>" : "") +
            '<div class="biw-mut">Joined ' + fmtTime(u.createdAt, { day: "numeric", month: "short", year: "numeric" }) + " · Last seen " + fmtTime(u.lastSeen) + "</div>" +
            '<a class="biw-link" style="text-align:left;margin-top:6px" data-u="' + i + '">📍 Change state' + (u.state ? " (" + esc(u.state) + ")" : "") + "</a></div>";
        }).join("");
        [].forEach.call(d.querySelectorAll("[data-u]"), function (a) {
          a.onclick = function () {
            var u = list[+a.dataset.u];
            var v = prompt("New state for " + u.fullName + ":\n" + STATES.join(", "), u.state || "");
            if (v == null) return;
            v = v.trim(); var match = STATES.find(function (s) { return s.toLowerCase() === v.toLowerCase(); });
            if (!match) { toast("Type a state exactly as listed."); return; }
            api({ action: "admin-set-state", which: which, target: u.username, state: match }).then(function (r2) { if (r2.ok) { toast("Saved"); showUsers(which, d.querySelector("#u-q").value); } else toast(r2.error); });
          };
        });
      }
      d.querySelector("#u-q").oninput = draw; draw();
    });
  }
  function openInsights(tab) {
    closeDrawer();
    var f = el("div", "biw-frame");
    f.innerHTML = '<div class="bar"><button class="biw-back" aria-label="Back">←</button><b style="flex:1">Admin insights</b></div><iframe title="Admin insights" src="admin.html?v=' + Date.now() + "#" + tab + '"></iframe>';
    ROOT.appendChild(f);
    f.querySelector(".biw-back").onclick = function () { f.remove(); openDrawer(); };
  }

  // ---------- SUPPORT DESK ----------
  var sdEl = null, pendingAtts = [];
  function closeSupport() { if (sdEl) { sdEl.remove(); sdEl = null; } refreshBadge(); }
  function sdShell(title, sub, back) {
    if (!sdEl) { sdEl = el("div", "biw-sd"); ROOT.appendChild(sdEl); }
    sdEl.innerHTML = '<div class="biw-sdw"><div class="biw-hero"><div class="top"><button class="bk" aria-label="Back">←</button><span class="logo"><img src="brand-logo.png" alt="vivo Business Innovation"></span><span class="sp"></span><span class="hs">🎧</span></div>' +
      "<h2>" + esc(title) + "</h2>" + (sub ? "<p>" + esc(sub) + "</p>" : "") + '</div><div class="biw-sdc"></div></div>';
    sdEl.querySelector(".bk").onclick = back;
    sdEl.scrollTop = 0;
    return sdEl.querySelector(".biw-sdc");
  }
  function topicIcon(t) { var i = TOPICS.indexOf(t); return i >= 0 ? TOPIC_ICONS[i] : "💬"; }
  var SC = { open: "#E69A00", answered: "#1E9E61", closed: "#9E9E9E" };

  function openSupport(filter) {
    filter = filter || "all";
    var c = sdShell("Support desk", isAdmin() ? "Queries from state teams. Reply to answer; the requester can rate your reply." : "Ask about the dashboard. BI admins reply here; you see your state's queries.", closeSupport);
    c.innerHTML = '<div class="biw-stats" id="sd-st"></div><div class="biw-sdb"><button class="biw-btn biw-blue" id="sd-new">＋  Raise a query</button>' +
      '<div class="biw-seg" id="sd-f"></div><div class="biw-mut" id="sd-c">Loading…</div><div id="sd-l"></div></div>';
    var F = [["all", "All"], ["mine", "My queries"], ["open", "Open"], ["answered", "Answered"], ["closed", "Closed"]];
    c.querySelector("#sd-f").innerHTML = F.map(function (x) { return '<button data-f="' + x[0] + '"' + (x[0] === filter ? ' class="on"' : "") + ">" + x[1] + "</button>"; }).join("");
    [].forEach.call(c.querySelectorAll("[data-f]"), function (b) { b.onclick = function () { openSupport(b.dataset.f); }; });
    c.querySelector("#sd-new").onclick = newTicket;
    api({ action: "support-list" }).then(function (res) {
      if (!res.ok) { if (!sessionLost(res)) c.querySelector("#sd-c").textContent = res.error; return; }
      var ts = res.tickets || [], n = { open: 0, answered: 0, closed: 0 };
      ts.forEach(function (t) { n[t.status] = (n[t.status] || 0) + 1; });
      c.querySelector("#sd-st").innerHTML = '<div style="color:#E69A00"><b>' + n.open + '</b>Open</div><div style="color:#1E9E61"><b>' + n.answered + '</b>Answered</div><div style="color:#616161"><b>' + n.closed + "</b>Closed</div>";
      var list = ts.filter(function (t) { return filter === "all" || (filter === "mine" ? t.mine : t.status === filter); });
      c.querySelector("#sd-c").textContent = list.length ? list.length + " queries · newest activity first" : "";
      c.querySelector("#sd-l").innerHTML = list.length ? list.map(function (t) {
        var lb = t.last && t.last.by, prev = t.last && t.last.text ? ((lb && lb.app === "admin" ? "🛡 " : "") + (lb ? lb.fullName + ": " : "") + t.last.text) : "";
        return '<div class="biw-tk" data-id="' + esc(t.id) + '"><div class="strip" style="background:' + (SC[t.status] || "#999") + '"></div><div class="in"><div class="h"><span class="ti">' + topicIcon(t.topic) + "</span>" +
          '<span style="color:' + (t.unread ? "#E53935" : "#3D47C8") + '">' + (t.unread ? "● " : "") + "#" + t.no + " · " + esc(t.topic) + '</span><span class="biw-st ' + esc(t.status) + '">' + esc(t.status) + "</span></div>" +
          '<div class="s">' + esc(t.subject) + '</div><div class="p">' + esc((t.by ? t.by.fullName : "") + (t.state ? " · " + t.state : "")) + "</div>" +
          (prev ? '<div class="p">' + esc(prev) + "</div>" : "") + '<div class="biw-mut" style="margin-top:4px">💬 ' + t.count + " · " + fmtTime(t.updatedAt) + (t.rating ? " · " + stars(t.rating) : "") + "</div></div></div>";
      }).join("") : '<div style="text-align:center;padding:34px 10px;color:#4A4F6A"><div style="width:84px;height:84px;border-radius:50%;background:#EEF0FF;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:40px">🎧</div>No queries here yet.</div>';
      [].forEach.call(c.querySelectorAll(".biw-tk"), function (x) { x.onclick = function () { openTicket(x.dataset.id); }; });
      refreshBadge();
    });
  }

  function attachUI(box) {
    var input = el("input"); input.type = "file"; input.className = "biw-file-in"; input.style.display = "none";
    input.accept = ".pdf,.xls,.xlsx,.csv,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt";
    var btn = el("button", "biw-attbtn", "📎  Attach file"), list = el("div");
    box.appendChild(input); box.appendChild(btn); box.appendChild(list);
    function draw() {
      list.innerHTML = pendingAtts.map(function (a, i) { return '<div class="biw-att"><span>📎 ' + esc(a.name) + " (" + Math.max(1, Math.round(a.size / 1024)) + ' KB)</span><button data-i="' + i + '">✕</button></div>'; }).join("");
      [].forEach.call(list.querySelectorAll("button"), function (b) { b.onclick = function () { pendingAtts.splice(+b.dataset.i, 1); draw(); }; });
      btn.textContent = "📎  Attach file" + (pendingAtts.length ? " (" + pendingAtts.length + "/5)" : "");
    }
    btn.onclick = function () { if (pendingAtts.length >= 5) { toast("You can attach up to 5 files."); return; } input.value = ""; input.click(); };
    input.onchange = function () {
      var f = input.files[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024) { toast("File is larger than 4 MB."); return; }
      var r = new FileReader();
      r.onload = function () {
        toast("Uploading " + f.name);
        api({ action: "support-upload", name: f.name, data: String(r.result).split(",")[1] || "" }).then(function (res) {
          if (!res.ok) { if (!sessionLost(res)) toast(res.error); return; }
          pendingAtts.push(res.att); draw();
        });
      };
      r.readAsDataURL(f);
    };
    draw();
  }

  function newTicket() {
    pendingAtts = [];
    var topic = "";
    var c = sdShell("Raise a query", "Pick a topic, describe the issue and attach a screenshot if you can.", function () { openSupport(); });
    c.innerHTML = '<div class="biw-sc"><h4>1 · Topic (dashboard section)</h4><div class="biw-chips">' + TOPICS.map(function (t, i) { return '<button data-t="' + i + '">' + TOPIC_ICONS[i] + "  " + esc(t) + "</button>"; }).join("") + "</div></div>" +
      '<div class="biw-sc biw-sdf"><h4>2 · Details</h4><label>KPI (optional)</label><select id="nt-k"><option value="">—</option>' + KPIS.map(function (k) { return "<option>" + esc(k) + "</option>"; }).join("") + "</select>" +
      "<label>State / region</label>" + (isAdmin() ? '<select id="nt-s"><option>PAN India</option>' + STATES.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("") + "</select>" : '<div style="font-weight:700;padding:4px 2px 10px">📍 ' + esc(PROFILE.state || "—") + " 🔒</div>") +
      '<label>Subject</label><input id="nt-j" maxlength="120" placeholder="e.g. Our rank looks wrong for October"><label>Details</label><textarea id="nt-d" maxlength="4000" placeholder="Describe the issue: which page, period and numbers"></textarea></div>' +
      '<div class="biw-sc"><h4>3 · Attachments (optional)</h4><div id="nt-a"></div><div class="biw-mut" style="margin-top:6px">PDF, Excel, Word, PowerPoint, CSV, text or image/screenshot · up to 4 MB each, 5 files</div></div>' +
      '<div class="biw-sdb"><div class="biw-msg" id="nt-m"></div><button class="biw-btn biw-blue" id="nt-go">Submit query</button></div>';
    [].forEach.call(c.querySelectorAll("[data-t]"), function (b) { b.onclick = function () { topic = TOPICS[+b.dataset.t]; [].forEach.call(c.querySelectorAll("[data-t]"), function (x) { x.classList.toggle("on", x === b); }); }; });
    attachUI(c.querySelector("#nt-a"));
    c.querySelector("#nt-go").onclick = function () {
      var m = c.querySelector("#nt-m"), sj = c.querySelector("#nt-j").value.trim(), dt = c.querySelector("#nt-d").value.trim();
      var err = !topic ? "Please choose a topic." : sj.length < 3 ? "Please enter a short subject." : !dt ? "Please describe your query." : "";
      if (err) { m.className = "biw-msg err"; m.textContent = err; return; }
      this.disabled = true;
      api({ action: "support-create", topic: topic, kpi: c.querySelector("#nt-k").value, state: isAdmin() ? c.querySelector("#nt-s").value : PROFILE.state,
        subject: sj, text: dt, atts: pendingAtts.map(function (a) { return a.id; }) }).then(function (res) {
        if (!res.ok) { c.querySelector("#nt-go").disabled = false; if (!sessionLost(res)) { m.className = "biw-msg err"; m.textContent = res.error; } return; }
        pendingAtts = []; toast("Query sent to BI admins"); openTicket(res.ticket.id);
      });
    };
  }

  function openTicket(id) {
    pendingAtts = [];
    var c = sdShell("Query", "", function () { openSupport(); });
    c.innerHTML = '<div class="biw-mut" style="padding:14px">Loading…</div>';
    api({ action: "support-get", id: id }).then(function (res) {
      if (!res.ok) { if (!sessionLost(res)) c.innerHTML = '<div class="biw-msg err">' + esc(res.error) + "</div>"; return; }
      var t = res.ticket, canRate = res.canRate;
      c = sdShell("#" + t.no + "  " + t.subject, topicIcon(t.topic) + " " + t.topic + (t.kpi ? " · " + t.kpi : ""), function () { openSupport(); });
      var h = '<div class="biw-sc" style="display:flex;align-items:center;gap:8px"><div style="flex:1"><b style="color:#3D47C8">📍 ' + esc(t.state || "PAN India") + '</b><div class="biw-mut">Raised by ' + esc(t.by.fullName) + " (@" + esc(t.by.username) + ") · " + fmtTime(t.createdAt) + '</div></div><span class="biw-st ' + esc(t.status) + '">' + esc(t.status) + "</span></div>";
      t.messages.forEach(function (m) {
        var adm = m.by && m.by.app === "admin", given = m.rating ? m.rating.stars : 0;
        h += '<div class="biw-bub ' + (adm ? "adm" : "usr") + '"><div class="w" style="color:' + (adm ? "#2B33A6" : "#141833") + '">' + (adm ? "🛡 BI Admin · " : "👤 ") + esc(m.by.fullName) + (!adm && m.by.state ? " · " + esc(m.by.state) : "") + "</div>" +
          (m.text ? '<div class="t">' + esc(m.text) + "</div>" : "") +
          (m.atts || []).map(function (a) { return '<a class="biw-file" data-a="' + esc(a.id) + '">📎 ' + esc(a.name) + " (" + Math.max(1, Math.round(a.size / 1024)) + " KB) ⬇</a>"; }).join("") +
          '<div class="tm">' + fmtTime(m.ts) + "</div>" + (adm && !canRate && given ? '<div style="color:#B07A00;font-weight:700;font-size:13px;margin-top:4px">⭐ Rated ' + stars(given) + " (" + given + "/5)</div>" : "") + "</div>";
        if (adm && canRate) {
          h += '<div class="biw-rate"><div class="q">' + (given ? "You rated this reply " + given + "/5 · tap to change" : "How helpful was this reply?") + '</div><div class="row">' +
            [1, 2, 3, 4, 5].map(function (s) { return '<button data-m="' + esc(m.id) + '" data-s="' + s + '" aria-label="' + s + ' stars">' + (s <= given ? "★" : "☆") + "</button>"; }).join("") +
            "</div><small>4–5★ closes the query · 1–3★ keeps it open for another reply</small></div>";
        }
      });
      h += '<div class="biw-sc biw-sdf"><h4>' + (isAdmin() ? "Write a reply" : "Add a comment") + '</h4><textarea id="tk-r" maxlength="4000" style="min-height:80px"></textarea><div id="tk-a"></div><div class="biw-msg" id="tk-m"></div>' +
        '<button class="biw-btn biw-blue" id="tk-go">' + (isAdmin() ? "Send reply" : "Send") + "</button>" +
        (isAdmin() || canRate ? '<a class="biw-link" id="tk-st" style="color:#4D5BF9">' + (t.status === "closed" ? "Reopen query" : "Mark as closed") + "</a>" : "") + "</div>";
      c.innerHTML = h;
      attachUI(c.querySelector("#tk-a"));
      [].forEach.call(c.querySelectorAll(".biw-file"), function (a) { a.onclick = function () { downloadAtt(a.dataset.a, id); }; });
      [].forEach.call(c.querySelectorAll(".biw-rate button"), function (b) {
        b.onclick = function () {
          api({ action: "support-rate", id: id, msgId: b.dataset.m, stars: +b.dataset.s }).then(function (r2) {
            if (!r2.ok) { if (!sessionLost(r2)) toast(r2.error); return; }
            toast(r2.autoClosed ? "Thanks! Rating saved and query closed." : "Thanks! Query stays open so an admin can help further.");
            openTicket(id);
          });
        };
      });
      c.querySelector("#tk-go").onclick = function () {
        var txt = c.querySelector("#tk-r").value.trim(), m = c.querySelector("#tk-m");
        if (!txt && !pendingAtts.length) { m.className = "biw-msg err"; m.textContent = "Write a message or attach a file."; return; }
        this.disabled = true;
        api({ action: "support-reply", id: id, text: txt, atts: pendingAtts.map(function (a) { return a.id; }) }).then(function (r2) {
          if (!r2.ok) { c.querySelector("#tk-go").disabled = false; if (!sessionLost(r2)) { m.className = "biw-msg err"; m.textContent = r2.error; } return; }
          pendingAtts = []; openTicket(id);
        });
      };
      var stl = c.querySelector("#tk-st");
      if (stl) stl.onclick = function () { api({ action: "support-status", id: id, status: t.status === "closed" ? "open" : "closed" }).then(function (r2) { if (r2.ok) openTicket(id); else toast(r2.error); }); };
      refreshBadge();
    });
  }
  function downloadAtt(aid, ticketId) {
    toast("Downloading…");
    api({ action: "support-att", id: aid, ticketId: ticketId }).then(function (res) {
      if (!res.ok) { if (!sessionLost(res)) toast(res.error); return; }
      var bin = atob(res.data), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var a = document.createElement("a"); a.__biwOwn = true;
      a.href = URL.createObjectURL(new Blob([u8], { type: res.mime || "application/octet-stream" })); a.download = res.name || "attachment";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    });
  }

  // ---------- go ----------
  function boot() {
    mount(); applyZoom();
    if (AUTH && AUTH.token) startSession(false);
    else showLogin();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
