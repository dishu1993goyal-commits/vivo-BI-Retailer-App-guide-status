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
  function sessionLost(res) {
    if (res && res.needsLink && AUTH && AUTH.app === "state") { PROFILE.linkRequired = true; showLinkVchat(); return true; }
    if (res && res.loggedOut) { logoutLocal(); showLogin(res.disabled ? res.error : "You were logged out (password changed or reset). Please log in again.", !!res.disabled); return true; }
    return false;
  }

  // ---------- styles (match the dashboard: black + gold) ----------
  var CSS = "" +
    "#biw-root{font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;color:#111}" +
    "#biw-root *{box-sizing:border-box}" +
    ".biw-bar{position:fixed;top:12px;right:12px;z-index:2147482000;display:flex;align-items:center;gap:4px;background:#0b0b0c;border:1px solid #c9a227;border-radius:99px;padding:4px;box-shadow:0 6px 18px rgba(0,0,0,.25)}" +
    ".biw-bar button{position:relative;border:0;background:transparent;color:#e6cf86;width:38px;height:38px;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}" +
    ".biw-bar button:hover{background:#1f1f22}" +
    ".biw-bar .biw-apps{background:#c9a227;color:#0b0b0c;font-size:21px;font-weight:800}.biw-bar .biw-apps:hover{background:#e6cf86}" +
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
    ".biw-svpop{background:#fbf9f3;border:1px solid #c9a227;border-radius:20px;padding:22px 20px 16px;max-width:360px;width:calc(100% - 32px);text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.4);animation:biwIn .25s ease-out}" +
    ".biw-svpop .ic{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#e6cf86,#c9a227);display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 10px}" +
    ".biw-svpop h3{margin:6px 0 6px;font:600 20px Georgia,serif;color:#111}" +
    ".biw-qr{margin-top:16px;border-top:1px solid #eadfc4;padding-top:14px;text-align:center}" +
    ".biw-qr .box{width:196px;height:196px;margin:8px auto 4px;background:#fff;border:1px solid #eadfc4;border-radius:14px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;cursor:pointer}" +
    ".biw-qr .box svg{width:176px;height:176px}" +
    ".biw-qr .box .ov2{position:absolute;inset:0;background:rgba(251,249,243,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:13px;color:#5c4300;padding:10px;gap:6px}" +
    ".biw-qr ol{text-align:left;font-size:12.5px;color:#6b6657;margin:8px auto 0;padding-left:20px;max-width:300px;line-height:1.5}" +
    "@media(min-width:820px){.biw-lcard.wide{max-width:780px;display:flex;gap:26px;align-items:stretch}.biw-lcard.wide .lf{flex:1}.biw-lcard.wide .biw-qr{width:300px;border-top:0;border-left:1px solid #eadfc4;padding:6px 0 0 24px;margin-top:0}}" +
    ".biw-frame{position:fixed;inset:0;z-index:2147482700;background:#F3F4F9;display:flex;flex-direction:column}" +
    ".biw-frame .bar{background:#0b0b0c;color:#e6cf86;display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:2px solid #c9a227}" +
    ".biw-frame iframe{flex:1;border:0;width:100%}" +
    "@media(max-width:560px){html.biw-web .rp .top .sbfoot2{display:none!important}.biw-bar{top:13px;right:8px;padding:3px}.biw-bar button{width:31px;height:32px;font-size:15px}.biw-av{width:29px;height:29px}}";
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
  function showLogin(info, isError) {
    mount(); lock();
    if (barEl) { barEl.remove(); barEl = null; }
    if (loginEl) loginEl.remove();
    var role = store("biw-lt") === "master" ? "master" : store("biw-role") || "state";
    loginEl = el("div", "biw-login");
    loginEl.innerHTML =
      '<div class="biw-lcard biw-f wide"><div class="lf">' +
      '<div class="biw-logo"><img src="brand-logo.png" alt="vivo Business Innovation"></div>' +
      '<h1>BI KPI <em>Dashboard</em></h1><p>Log in with your app user name and password</p>' +
      '<div class="biw-seg"><button data-r="state">State user</button><button data-r="admin">Admin user</button><button data-r="master">Master admin</button></div>' +
      '<label>User name</label><input id="biw-u" autocomplete="username" maxlength="40">' +
      '<label>Password</label><input id="biw-p" type="password" autocomplete="current-password" maxlength="64">' +
      '<label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="biw-sp" style="width:auto"> Show password</label>' +
      '<div class="biw-msg" id="biw-lm"></div>' +
      '<button class="biw-btn biw-dark" id="biw-go">Log in</button>' +
      '<a class="biw-link" id="biw-fg">Forgot password?</a><a class="biw-link" id="biw-su"><b>New user? Sign up</b></a>' +
      '<div class="biw-note" style="font-size:12px">Prefer the mobile app? <a href="' + APP_LINKS.state + '">State app</a> · <a href="' + APP_LINKS.admin + '">Admin app</a> — same login works on both.</div>' +
      '</div><div class="biw-qr"><b style="font-size:15px">Log in with QR code</b><div class="biw-mut">No password needed</div><div class="box" id="biw-qrb"><div class="ov2">Loading…</div></div>' +
      '<ol><li>Open the <b>vivo BI</b> app on your phone (State or Admin)</li><li>Tap your <b>profile photo → 🔳 Scan web login QR</b></li><li>Point the camera at this code and tap <b>Allow</b></li></ol></div>' +
      "</div>";
    ROOT.appendChild(loginEl);
    var u = loginEl.querySelector("#biw-u"), p = loginEl.querySelector("#biw-p"), m = loginEl.querySelector("#biw-lm"), go = loginEl.querySelector("#biw-go");
    u.value = store("biw-last-user") || "";
    var ulab = loginEl.querySelector("#biw-u").previousElementSibling;
    function setRole(r) {
      role = r; [].forEach.call(loginEl.querySelectorAll("[data-r]"), function (b) { b.classList.toggle("on", b.dataset.r === r); });
      ulab.textContent = r === "state" ? "vChat ID" : r === "master" ? "Admin user name" : "User name";
      u.value = (r === "state" ? store("biw-last-vchat") : store("biw-last-user")) || ""; u.placeholder = r === "state" ? "Your vChat ID" : "";
    }
    [].forEach.call(loginEl.querySelectorAll("[data-r]"), function (b) { b.onclick = function () { setRole(b.dataset.r); }; });
    setRole(role);
    loginEl.querySelector("#biw-sp").onchange = function () { p.type = this.checked ? "text" : "password"; };
    if (info) { m.className = "biw-msg " + (isError ? "err" : "ok"); m.textContent = info; }
    else if (store("biw-pwreq")) { m.className = "biw-msg ok"; m.innerHTML = '⏳ Password reset request sent. <a style="color:#8a6a1f;font-weight:700;cursor:pointer" id="biw-rs">Check status</a>'; m.querySelector("#biw-rs").onclick = function () { showForgot(); }; }
    function doLogin() {
      if (!u.value.trim() || !p.value) { m.className = "biw-msg err"; m.textContent = role === "state" ? "Enter your vChat ID and password." : "Enter your user name and password."; return; }
      go.disabled = true; go.textContent = "Logging in…";
      var idv = u.value.trim();
      var app = role === "master" ? "admin" : role;
      api({ app: app, action: "login", username: idv, vchatId: role === "state" ? idv : undefined, password: p.value, loginAs: role === "master" ? "master" : undefined }, false).then(function (res) {
        go.disabled = false; go.textContent = "Log in";
        if (!res.ok) {
          m.className = "biw-msg err"; m.textContent = res.error || "Login failed.";
          if (res.notMaster && res.canClaim) { var pw = p.value; m.innerHTML = esc(res.error) + '<br><a style="font-weight:700;cursor:pointer;text-decoration:underline" id="biw-claim">🔑 Become the first master admin (setup code)</a>'; m.querySelector("#biw-claim").onclick = function () { showClaim(idv, pw); }; }
          p.value = ""; return;
        }
        finishLogin(res, role);
      });
    }
    function finishLogin(res, role) {
        var app = role === "master" ? "admin" : role;
        AUTH = { app: app, username: res.username, token: res.token };
        store("biw-auth", AUTH); store("biw-role", app); store("biw-lt", role === "master" ? "master" : null); store("biw-last-user", res.username);
        if (role === "state" && res.profile && res.profile.vchatId) store("biw-last-vchat", res.profile.vchatId);
        saveProfile(res.profile); store("biw-pwreq", null);
        if (loginEl) { loginEl.remove(); loginEl = null; }
        if (role === "master") toast("Master admin · tap ✏️ Customize on any screen, or open Studio");
        startSession(true);
    }
    function showClaim(user, pass) {
      var c = authCard('<h1>Master <em>admin</em> setup</h1><p>One-time step: the first master admin activates access with the setup code. After that, masters add other masters in Studio → Masters.</p>' +
        '<label>Admin user name</label><input id="biw-cu" maxlength="40" autocomplete="username"><label>Admin password</label><input id="biw-cp" type="password" maxlength="64" autocomplete="current-password">' +
        '<label>Setup code</label><input id="biw-cc" maxlength="40" placeholder="VBI-MASTER-…" style="text-transform:uppercase;letter-spacing:1px"><div class="biw-msg" id="biw-cm"></div>' +
        '<button class="biw-btn biw-dark" id="biw-cgo">Activate master admin</button><a class="biw-link" id="biw-cbk">← Back to login</a>');
      c.querySelector("#biw-cu").value = user || ""; c.querySelector("#biw-cp").value = pass || "";
      c.querySelector("#biw-cbk").onclick = function () { showLogin(); };
      c.querySelector("#biw-cgo").onclick = function () {
        var b = this; b.disabled = true;
        api({ app: "admin", action: "master-claim", username: c.querySelector("#biw-cu").value.trim(), password: c.querySelector("#biw-cp").value, code: c.querySelector("#biw-cc").value.trim() }, false).then(function (res) {
          b.disabled = false;
          if (!res.ok) return msg(c, "#biw-cm", res.error || "Couldn't activate.");
          toast("You're now the master admin 👑"); finishLogin(res, "master");
        });
      };
      setTimeout(function () { c.querySelector(user ? "#biw-cc" : "#biw-cu").focus(); }, 50);
    }
    go.onclick = doLogin;
    p.onkeydown = function (e) { if (e.key === "Enter") doLogin(); };
    loginEl.querySelector("#biw-su").onclick = function () { showSignup(role === "master" ? "admin" : role); };
    loginEl.querySelector("#biw-fg").onclick = function () { showForgot(role === "master" ? "admin" : role); };
    if (window.matchMedia && matchMedia("(max-width:600px)").matches) loginEl.querySelector(".biw-qr").style.display = "none"; else startQr(loginEl);
    setTimeout(function () { (u.value ? p : u).focus(); }, 50);
  }

  // ---------- QR login (scan with the app) ----------
  var qrLib = null, qrTimer = 0;
  function loadQrLib() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLib) qrLib = new Promise(function (res, rej) { var s = el("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"; s.onload = res; s.onerror = function () { qrLib = null; rej(); }; document.head.appendChild(s); });
    return qrLib;
  }
  function startQr(owner) {
    var box = owner.querySelector("#biw-qrb"); if (!box) return;
    var tries = 0, cur = null;
    clearTimeout(qrTimer);
    function overlay(html, click) { var o = box.querySelector(".ov2"); if (!o) { o = el("div", "ov2"); box.appendChild(o); } o.innerHTML = html; box.onclick = click || null; }
    function fresh() {
      if (!owner.isConnected) return;
      tries++; overlay("Loading…");
      Promise.all([loadQrLib(), api({ app: "state", action: "qr-create", device: browserName() + " · " + (/Windows/.test(navigator.userAgent) ? "Windows" : /Mac/.test(navigator.userAgent) ? "Mac" : /Android/.test(navigator.userAgent) ? "Android" : /iPhone|iPad/.test(navigator.userAgent) ? "iOS" : "Computer") }, false)]).then(function (r) {
        var res = r[1]; if (!owner.isConnected) return;
        if (!res.ok) { overlay("Couldn't load QR code.<br><b>Tap to retry</b>", fresh); return; }
        cur = res;
        var q = window.qrcode(0, "M"); q.addData(location.origin + "/qr?c=" + res.id); q.make();
        box.innerHTML = q.createSvgTag(4, 0);
        box.onclick = null;
        poll();
      }).catch(function () { overlay("Couldn't load QR code.<br><b>Tap to retry</b>", fresh); });
    }
    function poll() {
      qrTimer = setTimeout(function () {
        if (!owner.isConnected || !cur) return;
        if (document.visibilityState !== "visible") { poll(); return; }
        api({ app: "state", action: "qr-poll", id: cur.id, secret: cur.secret }, false).then(function (res) {
          if (!owner.isConnected) return;
          if (res.ok && res.status === "pending") { poll(); return; }
          if (res.ok && res.status === "approved") {
            AUTH = { app: res.app, username: res.username, token: res.token };
            store("biw-auth", AUTH); store("biw-role", res.app); store("biw-last-user", res.username); saveProfile(res.profile);
            if (loginEl) { loginEl.remove(); loginEl = null; }
            toast("Logged in as " + (res.fullName || res.username)); startSession(true); return;
          }
          if (res.expired && tries < 6) { fresh(); return; }
          overlay((res.disabled || res.rejected ? esc(res.error) : "QR code expired.") + "<br><b>Tap to get a new code</b>", function () { tries = 0; fresh(); });
          if (res.disabled) { var m = owner.querySelector("#biw-lm"); if (m) { m.className = "biw-msg err"; m.textContent = res.error; } }
        });
      }, 2000);
    }
    fresh();
  }
  // ---------- SIGN UP (web: email code instead of Truecaller) ----------
  function authCard(html) {
    mount(); lock();
    if (loginEl) loginEl.remove();
    loginEl = el("div", "biw-login");
    loginEl.innerHTML = '<div class="biw-lcard biw-f"><div class="biw-logo"><img src="brand-logo.png" alt="vivo Business Innovation"></div>' + html + "</div>";
    ROOT.appendChild(loginEl);
    return loginEl;
  }
  function roleSeg(c, role, onChange) {
    function set(r) { role = r; [].forEach.call(c.querySelectorAll("[data-r]"), function (b) { b.classList.toggle("on", b.dataset.r === r); }); onChange(r); }
    [].forEach.call(c.querySelectorAll("[data-r]"), function (b) { b.onclick = function () { set(b.dataset.r); }; });
    set(role);
  }
  function msg(c, id, text, ok) { var m = c.querySelector(id); m.className = "biw-msg " + (ok ? "ok" : "err"); m.textContent = text; }

  function showSignup(role) {
    role = role || "state";
    if (role === "state") return showStateSignup();
    var c = authCard('<h1>Create <em>account</em></h1><p>Create your admin account.</p>' +
      '<div class="biw-seg"><button data-r="state">State user</button><button data-r="admin">Admin user</button></div>' +
      '<label>Full name</label><input id="s-n" maxlength="40" autocomplete="name">' +
      '<label>Choose a user name (for login)</label><input id="s-u" maxlength="30" autocomplete="username">' +
      '<label>Mobile number</label><div style="display:flex;gap:8px;align-items:center"><span style="font-weight:600">+91</span><input id="s-ph" inputmode="numeric" maxlength="10" placeholder="10-digit mobile"></div>' +
      '<label id="s-el">Email (optional)</label><div style="display:flex;gap:8px"><input id="s-e" type="email" maxlength="80" autocomplete="email" placeholder="name@example.com" style="flex:1"><button type="button" id="s-es" class="biw-btn biw-gold" style="display:none;width:auto;margin:0;padding:0 14px;white-space:nowrap">Send code</button></div>' +
      '<div id="s-ecw" style="display:none"><label>Code sent to your email</label><input id="s-ec" inputmode="numeric" maxlength="6" placeholder="6-digit code" style="letter-spacing:6px;text-align:center;font-size:18px"><div class="biw-mut" id="s-ecm" style="margin-top:4px"></div></div>' +
      '<div id="s-stw"><label>Your state</label><select id="s-st"><option value="">Select your state</option>' + STATES.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("") + "</select></div>" +
      '<label>Create password (min 6 characters)</label><input id="s-p" type="password" maxlength="64" autocomplete="new-password">' +
      '<label>Confirm password</label><input id="s-p2" type="password" maxlength="64" autocomplete="new-password">' +
      '<div id="s-acw"><label>Access code (from your BI admin)</label><input id="s-ac" type="password" maxlength="64"></div>' +
      '<div class="biw-note" id="s-adn" style="display:none;font-size:12.5px">Admin sign-up is by invitation: use the email a BI admin added under <b>Allowed admin emails</b>, then verify it with the code we email you.</div>' +
      '<div class="biw-msg" id="s-m"></div><button class="biw-btn biw-dark" id="s-go">Create account</button>' +
      '<a class="biw-link" id="s-back">Already have an account? Log in</a>');
    roleSeg(c, role, function (r) { if (r === "state") { showStateSignup(); return; } role = r; c.querySelector("#s-stw").style.display = "none"; });
    var em = bindEmailCode(c, "admin");
    var go = c.querySelector("#s-go");
    go.onclick = function () {
      var v = { fullName: c.querySelector("#s-n").value.trim(), username: c.querySelector("#s-u").value.trim(), phone: c.querySelector("#s-ph").value.replace(/\D/g, ""),
        email: c.querySelector("#s-e").value.trim(), state: role === "state" ? c.querySelector("#s-st").value : "", password: c.querySelector("#s-p").value,
        accessCode: c.querySelector("#s-ac").value.trim() };
      var err = v.fullName.length < 2 ? "Please enter your full name." : v.username.length < 3 ? "User name must be at least 3 characters." :
        !/^[6-9]\d{9}$/.test(v.phone) ? "Enter a valid 10-digit mobile number." :
        v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ? "Enter a valid email address, or leave it empty." :
        role === "state" && !v.state ? "Please select your state." : v.password.length < 6 ? "Password must be at least 6 characters." :
        v.password !== c.querySelector("#s-p2").value ? "Passwords do not match." : !v.accessCode && !em.byEmail() ? "Enter the access code from your BI admin." : em.problem(v.email);
      if (err) { msg(c, "#s-m", err); return; }
      if (!v.email) delete v.email;
      if (em.on()) v.emailOtp = em.code();
      if (em.byEmail()) delete v.accessCode;
      go.disabled = true; go.textContent = "Creating account…";
      api(Object.assign({ app: role, action: "signup", via: "web" }, v), false).then(function (res) {
        go.disabled = false; go.textContent = "Create account";
        if (!res.ok) { msg(c, "#s-m", res.error); return; }
        AUTH = { app: role, username: res.username, token: res.token };
        store("biw-auth", AUTH); store("biw-role", role); store("biw-last-user", res.username); saveProfile(res.profile);
        loginEl.remove(); loginEl = null; toast("Account created. Welcome, " + (res.fullName || "") + "!");
        startSession(true);
      });
    };
    c.querySelector("#s-back").onclick = function () { showLogin(); };
  }

  // Email code helper for sign-up forms (#s-e, #s-es, #s-ecw, #s-ec, #s-ecm, #s-m).
  function bindEmailCode(c, role) {
    var on = false, byEmail = false, sentTo = "", es = c.querySelector("#s-es");
    api({ app: role, action: "auth-config" }, false).then(function (r) {
      on = !!(r && r.emailOtp); byEmail = !!(r && r.adminEmailSignup); if (!c.isConnected) return;
      if (byEmail && c.querySelector("#s-acw")) { c.querySelector("#s-acw").style.display = "none"; c.querySelector("#s-adn").style.display = ""; }
      if (!on) return;
      es.style.display = ""; var l = c.querySelector("#s-el"); if (l) l.textContent = "Email";
    });
    es.onclick = function () {
      var e = c.querySelector("#s-e").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { msg(c, "#s-m", "Enter a valid email address first."); return; }
      es.disabled = true; es.textContent = "Sending…";
      api({ app: role, action: "email-otp-send", email: e, purpose: "signup" }, false).then(function (r) {
        es.disabled = false; es.textContent = "Resend";
        if (!r.ok) { msg(c, "#s-m", r.error); return; }
        sentTo = e.toLowerCase(); c.querySelector("#s-ecw").style.display = ""; c.querySelector("#s-ecm").textContent = "Code sent to " + e + " — check inbox and spam. Valid for 10 minutes.";
        msg(c, "#s-m", "", true); c.querySelector("#s-ec").focus();
      });
    };
    c.querySelector("#s-e").addEventListener("input", function () { if (sentTo && this.value.trim().toLowerCase() !== sentTo) { sentTo = ""; c.querySelector("#s-ecw").style.display = "none"; es.textContent = "Send code"; } });
    return {
      on: function () { return on; },
      byEmail: function () { return byEmail; },
      code: function () { return c.querySelector("#s-ec").value.trim(); },
      problem: function (email) {
        if (!on) return "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return "Enter your email address.";
        if (!sentTo) return "Tap Send code to verify your email.";
        if (!/^\d{6}$/.test(c.querySelector("#s-ec").value.trim())) return "Enter the 6-digit code from your email.";
        return "";
      }
    };
  }

  // ---------- STATE USERS: sign up with vChat ID (admin's allowed list decides the state) ----------
  var CODE_INFO = '<div class="biw-note" id="ac-info" style="display:none;margin-top:6px">🔑 <b>Access code</b> = first 4 letters of your name as on vChat (small letters, no spaces) + last 4 digits of your vChat registered mobile.<br>Example: <b>Ravi Kumar</b>, mobile 98765 4<b>3210</b> → <b>ravi3210</b></div>';
  function codeField(id) { return '<label style="display:flex;align-items:center;gap:6px">Access code <button type="button" id="' + id + '-i" title="How to make the access code" style="border:1px solid #c9a227;background:#fff7e0;color:#8a6a1f;border-radius:50%;width:22px;height:22px;font:700 13px Georgia,serif;cursor:pointer;padding:0">i</button></label><input id="' + id + '" maxlength="20" autocomplete="off" autocapitalize="none" placeholder="e.g. ravi3210">' + CODE_INFO; }
  function bindCodeInfo(c, id) { c.querySelector("#" + id + "-i").onclick = function () { var b = c.querySelector("#ac-info"); b.style.display = b.style.display === "none" ? "" : "none"; }; }
  // vChat ID box: looks the ID up and fills the (locked) state.
  function bindVchat(c, onState) {
    var inp = c.querySelector("#v-id"), st = c.querySelector("#v-st"), info = c.querySelector("#v-msg"), last = "", seq = 0;
    var look = function () {
      var v = inp.value.trim(); if (v === last) return; last = v; st.value = ""; onState(null);
      if (!v) { info.textContent = ""; return; }
      var my = ++seq; info.className = "biw-msg"; info.textContent = "Checking vChat ID…";
      api({ app: "state", action: "vchat-lookup", vchatId: v }, false).then(function (r) {
        if (my !== seq) return;
        if (!r.ok) { info.className = "biw-msg err"; info.textContent = r.error; return; }
        st.value = r.state; info.className = "biw-msg ok"; info.textContent = "✓ vChat ID found"; onState(r.state);
      });
    };
    var tmr = 0; inp.oninput = function () { clearTimeout(tmr); st.value = ""; onState(null); tmr = setTimeout(look, 600); };
    inp.onblur = look;
    return look;
  }
  function showStateSignup() {
    var okState = null;
    var c = authCard('<h1>Create <em>account</em></h1><p>State users sign up with their vChat ID.</p>' +
      '<div class="biw-seg"><button data-r="state">State user</button><button data-r="admin">Admin user</button></div>' +
      '<label>vChat ID</label><input id="v-id" maxlength="40" autocomplete="off" autocapitalize="none" placeholder="Your vChat ID"><div class="biw-msg" id="v-msg" style="text-align:left;margin-top:4px"></div>' +
      '<label>State (from vChat)</label><input id="v-st" readonly placeholder="Filled automatically from your vChat ID" style="background:#f3efe3;color:#5c4300;font-weight:600">' +
      '<label>Choose a user name</label><input id="s-u" maxlength="30" autocomplete="username">' +
      '<label>Create password (min 6 characters)</label><input id="s-p" type="password" maxlength="64" autocomplete="new-password">' +
      '<label>Confirm password</label><input id="s-p2" type="password" maxlength="64" autocomplete="new-password">' +
      '<label>vChat registered mobile number</label><div style="display:flex;gap:8px;align-items:center"><span style="font-weight:600">+91</span><input id="s-ph" inputmode="numeric" maxlength="10" placeholder="10-digit mobile"></div>' +
      '<label>Email</label><div style="display:flex;gap:8px"><input id="s-e" type="email" maxlength="80" autocomplete="email" placeholder="name@example.com" style="flex:1"><button type="button" id="s-es" class="biw-btn biw-gold" style="display:none;width:auto;margin:0;padding:0 14px;white-space:nowrap">Send code</button></div>' +
      '<div id="s-ecw" style="display:none"><label>Code sent to your email</label><input id="s-ec" inputmode="numeric" maxlength="6" placeholder="6-digit code" style="letter-spacing:6px;text-align:center;font-size:18px"><div class="biw-mut" id="s-ecm" style="margin-top:4px"></div></div>' +
      codeField("s-ac") +
      '<div class="biw-msg" id="s-m"></div><button class="biw-btn biw-dark" id="s-go">Create account</button>' +
      '<a class="biw-link" id="s-back">Already have an account? Log in</a>');
    roleSeg(c, "state", function (r) { if (r === "admin") showSignup("admin"); });
    var look = bindVchat(c, function (st) { okState = st; });
    bindCodeInfo(c, "s-ac");
    // Email code (free, via Brevo) when switched on.
    var emailOtp = false, sentTo = "";
    api({ app: "state", action: "auth-config" }, false).then(function (r) { emailOtp = !!(r && r.emailOtp); if (emailOtp && c.isConnected) c.querySelector("#s-es").style.display = ""; });
    var es = c.querySelector("#s-es");
    es.onclick = function () {
      var em = c.querySelector("#s-e").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { msg(c, "#s-m", "Enter a valid email address first."); return; }
      es.disabled = true; es.textContent = "Sending…";
      api({ app: "state", action: "email-otp-send", email: em, purpose: "signup" }, false).then(function (r) {
        es.disabled = false; es.textContent = "Resend";
        if (!r.ok) { msg(c, "#s-m", r.error); return; }
        sentTo = em.toLowerCase(); c.querySelector("#s-ecw").style.display = ""; c.querySelector("#s-ecm").textContent = "Code sent to " + em + " — check inbox and spam. Valid for 10 minutes.";
        msg(c, "#s-m", "", true); c.querySelector("#s-ec").focus();
      });
    };
    c.querySelector("#s-e").addEventListener("input", function () { if (sentTo && this.value.trim().toLowerCase() !== sentTo) { sentTo = ""; c.querySelector("#s-ecw").style.display = "none"; es.textContent = "Send code"; } });
    var go = c.querySelector("#s-go");
    go.onclick = function () {
      look();
      var v = { vchatId: c.querySelector("#v-id").value.trim(), username: c.querySelector("#s-u").value.trim(), password: c.querySelector("#s-p").value,
        phone: c.querySelector("#s-ph").value.replace(/\D/g, ""), email: c.querySelector("#s-e").value.trim(), accessCode: c.querySelector("#s-ac").value.trim() };
      var err = !v.vchatId ? "Enter your vChat ID." : !okState ? "Enter a vChat ID from the allowed list (the state fills in automatically)." :
        v.username.length < 3 ? "User name must be at least 3 characters." : v.password.length < 6 ? "Password must be at least 6 characters." :
        v.password !== c.querySelector("#s-p2").value ? "Passwords do not match." : !/^[6-9]\d{9}$/.test(v.phone) ? "Enter your 10-digit vChat registered mobile number." :
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ? "Enter a valid email address." :
        emailOtp && !sentTo ? "Tap Send code to verify your email." : emailOtp && !/^\d{6}$/.test(c.querySelector("#s-ec").value.trim()) ? "Enter the 6-digit code from your email." :
        !v.accessCode ? "Enter the access code (tap i to see how)." : "";
      if (err) { msg(c, "#s-m", err); return; }
      if (emailOtp) v.emailOtp = c.querySelector("#s-ec").value.trim();
      go.disabled = true; go.textContent = "Creating account…";
      api(Object.assign({ app: "state", action: "signup", via: "web" }, v), false).then(function (res) {
        go.disabled = false; go.textContent = "Create account";
        if (!res.ok) { msg(c, "#s-m", res.error); var f = { vchatId: "#v-id", username: "#s-u", password: "#s-p", phone: "#s-ph", email: "#s-e", accessCode: "#s-ac", emailOtp: "#s-ec" }[res.field]; if (f) c.querySelector(f).focus(); return; }
        AUTH = { app: "state", username: res.username, token: res.token };
        store("biw-auth", AUTH); store("biw-role", "state"); store("biw-last-vchat", v.vchatId); saveProfile(res.profile);
        loginEl.remove(); loginEl = null; toast("Account created. Welcome, " + (res.fullName || "") + "!");
        startSession(true);
      });
    };
    c.querySelector("#s-back").onclick = function () { showLogin(); };
  }
  // Older state accounts (made before vChat sign-up) link their vChat ID once.
  function showLinkVchat() {
    var okState = null;
    var c = authCard('<h1>Link your <em>vChat ID</em></h1><p>One-time step: confirm your vChat details to keep using the dashboard. Your state comes from vChat.</p>' +
      '<label>vChat ID</label><input id="v-id" maxlength="40" autocomplete="off" autocapitalize="none"><div class="biw-msg" id="v-msg" style="text-align:left;margin-top:4px"></div>' +
      '<label>State (from vChat)</label><input id="v-st" readonly placeholder="Filled automatically" style="background:#f3efe3;color:#5c4300;font-weight:600">' +
      '<label>vChat registered mobile number</label><div style="display:flex;gap:8px;align-items:center"><span style="font-weight:600">+91</span><input id="l-ph" inputmode="numeric" maxlength="10"></div>' +
      codeField("l-ac") + '<div class="biw-msg" id="l-m"></div><button class="biw-btn biw-dark" id="l-go">Link vChat ID</button><a class="biw-link" id="l-out">Log out</a>');
    var look = bindVchat(c, function (st) { okState = st; });
    bindCodeInfo(c, "l-ac");
    c.querySelector("#l-out").onclick = function () { api({ action: "logout" }); logoutLocal(); showLogin(); };
    var go = c.querySelector("#l-go");
    go.onclick = function () {
      look();
      if (!okState) return msg(c, "#l-m", "Enter a vChat ID from the allowed list.");
      go.disabled = true;
      api({ action: "vchat-link", vchatId: c.querySelector("#v-id").value.trim(), phone: c.querySelector("#l-ph").value, accessCode: c.querySelector("#l-ac").value.trim() }).then(function (r) {
        go.disabled = false;
        if (!r.ok) { if (!sessionLost(r)) msg(c, "#l-m", r.error); return; }
        r.profile.linkRequired = false; saveProfile(r.profile); store("biw-last-vchat", r.profile.vchatId);
        loginEl.remove(); loginEl = null; toast("vChat ID linked. Next time log in with your vChat ID."); startSession(true);
      });
    };
  }

  // ---------- FORGOT PASSWORD ----------
  // Forgot password: the user chooses a new password and a BI admin approves the request.
  function showForgot(role, forceRequest) {
    var pend = store("biw-pwreq");
    if (pend && pend.reqId) return showResetStatus(pend);
    role = role || store("biw-role") || "state";
    if (!forceRequest) {
      var cw = authCard('<h1>Forgot <em>password?</em></h1><div class="biw-note">Checking…</div>');
      api({ app: role, action: "auth-config" }, false).then(function (r) { if (!cw.isConnected) return; if (r && r.emailOtp) showForgotEmail(role); else showForgot(role, true); });
      return;
    }
    var c = authCard('<h1>Forgot <em>password?</em></h1><p>Choose a new password. A BI admin checks the request (usually by calling you) and approves it.</p>' +
      '<div class="biw-seg"><button data-r="state">State user</button><button data-r="admin">Admin user</button></div>' +
      '<label>vChat ID, user name or mobile number</label><input id="f-u" maxlength="40" autocomplete="username">' +
      '<label>New password (min 6 characters)</label><input id="f-p" type="password" maxlength="64" autocomplete="new-password">' +
      '<label>Confirm new password</label><input id="f-p2" type="password" maxlength="64" autocomplete="new-password">' +
      '<label>Message for the admin (optional)</label><input id="f-n" maxlength="200" placeholder="e.g. Changed my phone">' +
      '<div class="biw-msg" id="f-m"></div><button class="biw-btn biw-dark" id="f-go">Send reset request</button><a class="biw-link" id="f-back">Back to log in</a>');
    c.querySelector("#f-u").value = store("biw-last-user") || "";
    roleSeg(c, role, function (r) { if (r !== role && !forceRequest) { showForgot(r); return; } role = r; });
    c.querySelector("#f-back").onclick = function () { showLogin(); };
    var go = c.querySelector("#f-go");
    go.onclick = function () {
      var u = c.querySelector("#f-u").value.trim(), p = c.querySelector("#f-p").value;
      if (!u) return msg(c, "#f-m", "Enter your vChat ID, user name or mobile number.");
      if (p.length < 6) return msg(c, "#f-m", "Password must be at least 6 characters.");
      if (p !== c.querySelector("#f-p2").value) return msg(c, "#f-m", "Passwords don't match.");
      go.disabled = true; go.textContent = "Sending…";
      api({ app: role, action: "reset-request", username: u, newPassword: p, note: c.querySelector("#f-n").value, via: "web", device: browserName() }, false).then(function (r) {
        go.disabled = false; go.textContent = "Send reset request";
        if (!r.ok) return msg(c, "#f-m", r.error || "Couldn't send the request.");
        var q = { app: role, username: r.username, reqId: r.reqId, at: Date.now() };
        store("biw-pwreq", q); store("biw-role", role); store("biw-last-user", r.username);
        showResetStatus(q);
      });
    };
  }
  function showResetStatus(q) {
    var c = authCard('<h1>Reset <em>request</em></h1><div id="r-box"><div class="biw-note">Checking…</div></div>' +
      '<button class="biw-btn biw-dark" id="r-chk">Check status</button><a class="biw-link" id="r-new">Send a new request</a><a class="biw-link" id="f-back">Back to log in</a>');
    c.querySelector("#f-back").onclick = function () { showLogin(); };
    c.querySelector("#r-new").onclick = function () { store("biw-pwreq", null); showForgot(q.app, true); };
    var check = function () {
      api({ app: q.app, action: "reset-status", username: q.username, reqId: q.reqId }, false).then(function (r) {
        var box = c.querySelector("#r-box"); if (!box) return;
        if (!r.ok) { store("biw-pwreq", null); box.innerHTML = '<div class="biw-note">This request is no longer available. Send a new one if you still need it.</div>'; return; }
        if (r.status === "approved") {
          store("biw-pwreq", null);
          box.innerHTML = '<div class="biw-note" style="background:#e9f7ef;border-color:#a8dcbc;color:#1d6b43">✅ Approved' + (r.decidedAt ? " " + fmtTime(r.decidedAt) : "") + ". Log in as <b>" + esc(r.username) + "</b> with the new password you chose.</div>";
          c.querySelector("#r-chk").textContent = "Go to log in"; c.querySelector("#r-chk").onclick = function () { showLogin("Request approved — log in with your new password."); };
          c.querySelector("#r-new").style.display = "none";
        } else if (r.status === "rejected") {
          store("biw-pwreq", null);
          box.innerHTML = '<div class="biw-note" style="background:#fdecec;border-color:#f2c4c4;color:#8c2f22">✕ Not approved' + (r.reason ? ": " + esc(r.reason) : "") + ". Your password is unchanged. Contact your BI admin or send a new request.</div>";
        } else box.innerHTML = '<div class="biw-note">⏳ Waiting for a BI admin to approve the new password for <b>' + esc(r.username) + "</b> (sent " + fmtTime(q.at) + "). The admin may call you to confirm.</div>";
      });
    };
    c.querySelector("#r-chk").onclick = check; check();
  }

  // (email-code password reset, kept for later if an email service is added)
  function showForgotEmail(role) {
    role = role || "state";
    var c = authCard('<h1>Reset <em>password</em></h1><p>We\'ll email a code to the address on your account.</p>' +      '<div class="biw-seg"><button data-r="state">State user</button><button data-r="admin">Admin user</button></div>' +
      '<label>Account email</label><input id="f-e" type="email" maxlength="80" autocomplete="email">' +
      '<div id="f-step2" style="display:none"><label>Code sent to your email</label><input id="f-otp" inputmode="numeric" maxlength="6" style="letter-spacing:6px;text-align:center;font-size:20px">' +
      '<label>New password (min 6 characters)</label><input id="f-p" type="password" maxlength="64"><label>Confirm new password</label><input id="f-p2" type="password" maxlength="64"></div>' +
      '<div class="biw-msg" id="f-m"></div><button class="biw-btn biw-dark" id="f-go">Send code</button>' +
      '<a class="biw-link" id="f-req">No access to that email? Ask an admin instead</a><a class="biw-link" id="f-back">Back to log in</a>');
    roleSeg(c, role, function (r) { if (r !== role) { showForgot(r); return; } role = r; });
    c.querySelector("#f-req").onclick = function () { showForgot(role, true); };
    var sent = false, go = c.querySelector("#f-go");
    go.onclick = function () {
      var email = c.querySelector("#f-e").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg(c, "#f-m", "Enter a valid email address."); return; }
      if (!sent) {
        go.disabled = true; go.textContent = "Sending…";
        api({ app: role, action: "email-otp-send", email: email, purpose: "reset" }, false).then(function (res) {
          go.disabled = false;
          if (!res.ok) { go.textContent = "Send code"; msg(c, "#f-m", res.error); return; }
          sent = true; c.querySelector("#f-step2").style.display = ""; go.textContent = "Save new password";
          msg(c, "#f-m", "Code sent. Check inbox and spam.", true);
        });
        return;
      }
      var pw = c.querySelector("#f-p").value;
      if (pw.length < 6) { msg(c, "#f-m", "Password must be at least 6 characters."); return; }
      if (pw !== c.querySelector("#f-p2").value) { msg(c, "#f-m", "Passwords do not match."); return; }
      go.disabled = true;
      api({ app: role, action: "reset-email", email: email, otp: c.querySelector("#f-otp").value, newPassword: pw }, false).then(function (res) {
        go.disabled = false;
        if (!res.ok) { msg(c, "#f-m", res.error); return; }
        store("biw-role", role); store("biw-last-user", res.username); if (res.vchatId) store("biw-last-vchat", res.vchatId);
        showLogin(res.vchatId ? "Password changed. Log in with your vChat ID " + res.vchatId + "." : "Password changed. Your user name is " + res.username + ". Please log in.");
      });
    };
    c.querySelector("#f-back").onclick = function () { showLogin(); };
  }

  function logoutLocal() { AUTH = null; PROFILE = {}; store("biw-auth", null); store("biw-profile", null); store("biw-photo", null); store("biw-lt", null); if (window.CUST && window.CUST.reauth) window.CUST.reauth(); }
  // Master-admin customizations (labels / hidden items) also apply on the dashboard itself.
  function custLoad() {
    if (window.CUST && window.CUST.reauth) { window.CUST.reauth(); return; }
    window.CUST_PAGE = "dashboard";
    var s = el("script"); s.src = "/cust.js?v=64"; document.head.appendChild(s);
  }

  // ---------- SESSION START ----------
  function startSession(fresh) {
    mount();
    var go = function () {
      if (AUTH.app === "state") {
        if (PROFILE.linkRequired) { showLinkVchat(); return; }
        if (!PROFILE.state) { askState(); return; }
        applyStateLock(PROFILE.state);
      }
      unlock(); buildBar(); refreshBadge(); syncPhoto(); custLoad();
    };
    if (fresh) { go(); return; }
    // Check the saved session (also records the visit in the access log).
    api({ action: "ping" }).then(function (res) {
      if (!res.ok) { if (res.loggedOut) { logoutLocal(); showLogin(res.disabled ? res.error : "", !!res.disabled); } else { go(); } return; }
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
  var barEl = null, badgeEl = null, svBadgeEl = null, chBadgeEl = null, PWREQ = 0;
  function buildBar() {
    if (barEl) barEl.remove();
    barEl = el("div", "biw-bar");
    barEl.innerHTML = '<button title="Search" aria-label="Search">🔍</button><button title="BI Assistant" aria-label="BI Assistant">💬</button>' +
      '<button title="All tools" aria-label="All tools" class="biw-apps">⊞<span class="biw-badge" id="biw-tb"></span></button>' +
      '<button title="Profile" aria-label="Profile & settings"><span class="biw-av"></span></button>';
    var b = barEl.querySelectorAll("button");
    b[0].onclick = function () { assistant("openSearch"); };
    b[1].onclick = function () { assistant("openChat"); };
    b[2].onclick = function () { openTool("hub"); };
    b[3].onclick = function () { openDrawer(); };
    badgeEl = null; svBadgeEl = null; chBadgeEl = barEl.querySelector("#biw-tb");
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
  function setBadge(el, n) { if (!el) return; el.textContent = n > 9 ? "9+" : n; el.style.display = n > 0 ? "flex" : "none"; }
  function refreshBadge() {
    if (!AUTH) return;
    api({ action: "notify" }).then(function (res) {
      if (!res.ok) { sessionLost(res); return; }
      var sv = res.surveys || {}, dp = res.disputes || {};
      var total = (res.supportUnread || 0) + (isAdmin() ? (sv.newResponses || 0) : (sv.pending || 0)) + ((res.chat && res.chat.unread) || 0) + (dp.unread || 0) + (dp.assigned || 0) +
        (res.hygiene || 0 ? 1 : 0) + (res.quizNew || 0) + (res.pollNew || 0) + (res.autorep || 0) + (res.matrix && res.matrix.pending ? 1 : 0);
      setBadge(chBadgeEl, total);
      if (isAdmin()) {
        var pr = res.pwreq || 0;
        if (pr > PWREQ && !document.querySelector(".biw-frame,.biw-ov")) toast("🛡️ " + pr + " password reset request" + (pr > 1 ? "s" : "") + " waiting — Profile → Account security");
        PWREQ = pr; var av = barEl && barEl.querySelector(".biw-av"); if (av) av.parentNode.style.boxShadow = pr ? "0 0 0 2px #e53935" : "";
      }
      if (!isAdmin()) { surveyPopup(sv.surveys || []); matrixPopup(res.matrix); }
    });
  }
  // Feature usability matrix shared (or re-announced) and this state hasn't confirmed its row yet.
  function matrixPopup(mx) {
    if (!mx || !mx.pending || document.querySelector(".biw-frame,.biw-sd,.biw-ov,.biw-login")) return;
    var seen = store("biw-mxseen") || {};
    if (seen[mx.id] === mx.announcedAt) return;
    seen[mx.id] = mx.announcedAt; store("biw-mxseen", seen);
    var ov = el("div", "biw-ov"); ov.style.alignItems = "center"; ov.style.justifyContent = "center";
    ov.innerHTML = '<div class="biw-svpop"><div class="ic">🧩</div><div class="biw-eyebrow" style="color:#8a6a1f">Feature usability</div><h3>' + esc(mx.title) + "</h3>" +
      '<div class="biw-mut">Please tick the features your state uses and confirm your row.</div><button class="biw-btn biw-dark" id="mx-go">Update my state</button><a class="biw-link" id="mx-later">Later</a></div>';
    ROOT.appendChild(ov);
    ov.querySelector("#mx-go").onclick = function () { ov.remove(); openTool("matrix"); };
    ov.querySelector("#mx-later").onclick = function () { ov.remove(); };
  }
  // New (or re-announced) survey: show a card once per announcement on this browser.
  function surveyPopup(list) {
    if (document.querySelector(".biw-frame,.biw-sd,.biw-ov,.biw-login")) return;
    var shown = store("biw-svseen") || {};
    var s = list.filter(function (x) { return x.isNew && shown[x.id] !== x.announcedAt; })[0];
    if (!s) return;
    shown[s.id] = s.announcedAt; store("biw-svseen", shown);
    var ov = el("div", "biw-ov"); ov.style.alignItems = "center"; ov.style.justifyContent = "center";
    ov.innerHTML = '<div class="biw-svpop"><div class="ic">📋</div><div class="biw-eyebrow" style="color:#8a6a1f">New survey from BI admin</div><h3>' + esc(s.title) + "</h3>" +
      (s.closesAt ? '<div class="biw-mut">Please answer by ' + fmtTime(s.closesAt) + "</div>" : '<div class="biw-mut">It takes only a few minutes.</div>') +
      (list.length > 1 ? '<div class="biw-mut" style="margin-top:4px">' + list.length + " surveys are waiting for you</div>" : "") +
      '<button class="biw-btn biw-dark" id="sv-go">Answer now</button><a class="biw-link" id="sv-later">Later</a></div>';
    ROOT.appendChild(ov);
    ov.querySelector("#sv-go").onclick = function () { ov.remove(); openSurveys("#s=" + s.id); };
    ov.querySelector("#sv-later").onclick = function () { ov.remove(); };
  }
  // ---------- SURVEYS, MESSAGES, FEATURE MATRIX (shared pages, also used by the apps) ----------
  var svFrame = null;
  var TOOLS = { directory: ["directory.html", "vChat directory", "vChat directory"], security: ["security.html", "Account security", "Account security"], survey: ["survey.html", "Surveys", "Survey manager"], chat: ["chat.html", "Messages", "Messages"], matrix: ["matrix.html", "Feature usability", "Feature usability"], visits: ["visits.html", "Market visits", "Market visits"], knowledge: ["knowledge.html", "Knowledge", "Knowledge"], affordability: ["affordability.html", "Affordability Corner", "Affordability Corner"],
    hub: ["hub.html", "All tools", "All tools"], reports: ["reports.html", "Reports", "Reports"], help: ["help.html", "Help centre", "Help centre"], disputes: ["disputes.html", "Disputes", "Disputes"],
    hygiene: ["hygiene.html", "Market hygiene", "Market hygiene"], engage: ["engage.html", "Engage", "Engage"], schemes: ["schemes.html", "Schemes & payout", "Schemes & payout"], admintools: ["admin-tools.html", "Admin tools", "Admin tools"],
    tool: ["tool.html", "Tool", "Tool"], fieldnotes: ["fieldnotes.html", "Team notes & audits", "Team notes & audits"], toolactivity: ["toolactivity.html", "Smart tools activity", "Smart tools activity"], schemecalc: ["schemecalc.html", "Scheme payout calculator", "Scheme payout calculator"], mailer: ["mailer.html", "Reports from HO", "Email reports to states"], config: ["config.html", "Configuration centre", "Configuration centre"], hygcheck: ["hygcheck.html", "IMEI hygiene check", "IMEI hygiene check"], sheetjoin: ["sheetjoin.html", "Sheet joiner", "Sheet joiner"], targetsplit: ["targetsplit.html", "Target splitter", "Target splitter"], guide: ["guide.html", "Guide & manual", "Guide & manual"], statemap: ["statemap.html", "India state map", "India state map"], faces: ["faces.html", "Face records", "Face records"], reviewdeck: ["reviewdeck.html", "Monthly review deck", "Monthly review deck"], insights: ["insights.html", "Performance insights", "Performance insights"], business: ["business.html", "Business centre", "Business centre"], calendar: ["calendar.html", "Notices & BI calendar", "Notices & BI calendar"], myday: ["myday.html", "My Day", "My Day"], deckstudio: ["deckstudio.html", "One-Page Studio", "One-Page Studio"], pmail: ["pmail.html", "Personal mailer", "Personal mailer"], applab: ["applab.html", "App usability lab", "App usability lab"], portals: ["portals.html", "Partner portals", "Partner portals"], rewards: ["rewards.html", "Rewards & recognition", "Rewards & recognition"], newsletter: ["newsletter.html", "BI newsletter", "BI newsletter"], appguide: ["appguide.html", "App guide assistant", "App guide assistant"], geolocate: ["geolocate.html", "Email geo-locator", "Email geo-locator"], access: ["access.html", "Access control", "Access control · Master admin"], studio: ["studio.html", "Studio", "Studio · Master admin"] };
  function toolByFile(file) { for (var k in TOOLS) if (TOOLS[k][0] === file) return k; return null; }
  function openSurveys(hash) { openTool("survey", hash); }
  function openTool(name, hash, title) {
    closeDrawer();
    if (svFrame) svFrame.remove();
    var fromHub = !!(svFrame && svFrame.dataset.tool === "hub" && name !== "hub");
    var tl = TOOLS[name] || [name, name, name], f = el("div", "biw-frame"); svFrame = f; f.dataset.tool = name;
    f.innerHTML = '<div class="bar"><button class="biw-back" aria-label="Back">←</button><b style="flex:1">' + esc(title || (isAdmin() ? tl[2] : tl[1])) + '</b></div><iframe allow="geolocation; camera; microphone; clipboard-write; autoplay" title="' + tl[1] + '" src="' + tl[0] + "?v=" + Date.now() + (hash || "#list") + '"></iframe>';
    ROOT.appendChild(f);
    var ifr = f.querySelector("iframe");
    f.querySelector(".biw-back").onclick = function () {
      var w = ifr.contentWindow, handled = false;
      try { var fn = w && (w.__pageBack || w.__surveyBack); handled = fn && fn(); } catch (e) { }
      if (!handled) { f.remove(); svFrame = null; refreshBadge(); if (fromHub) openTool("hub"); }
    };
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.biSurvey) refreshBadge();
    if (e.data.biOpen) { var o = e.data.biOpen, k = toolByFile(String(o.file || "")); if (k) openTool(k, String(o.hash || "#list"), k === "tool" && o.title ? String(o.title).slice(0, 60) : ""); }
    if (e.data.biNative) {   // hub tiles for screens that live in the dashboard itself
      var n = e.data.biNative; if (svFrame) { svFrame.remove(); svFrame = null; }
      if (/^dash:[A-Za-z0-9_=~-]+$/.test(n)) { location.hash = n.slice(5); window.scrollTo(0, 0); return; }
      if (n === "support") openSupport(); else if (n === "users") showUsers("state"); else if (n === "logs") openInsights("logs"); else if (n === "supportReport") openInsights("support");
      else if (n === "calculator") assistant("openCalculator");
    }
  });
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
    var adminItems = [["🪪", "vChat directory", "", function () { openTool("directory"); }], ["🛡️", "Account security", PWREQ ? PWREQ + " reset request" + (PWREQ > 1 ? "s" : "") : "", function () { openTool("security"); }], ["👥", "Registered users", "", function () { showUsers("state"); }], ["📊", "Access logs & insights", "", function () { openInsights("logs"); }], ["🎧", "Support desk report", "", function () { openInsights("support"); }]];
    var helpItems = [["📍", "Market visits", admin ? "Team tracker & scorecard" : "Punch in / out at stores", function () { openTool("visits"); }], ["💳", "Affordability Corner", "Prices, EMI, exchange, V-Shield, ABB", function () { openTool("affordability"); }], ["📚", "Knowledge", "BI, AI, dashboards, Power BI", function () { openTool("knowledge"); }], ["✉️", "Messages", "", function () { openTool("chat"); }], ["🧩", "Feature usability", "", function () { openTool("matrix"); }], ["📋", admin ? "Survey manager" : "Surveys", "", function () { openSurveys(); }], ["🎧", "Support desk", "", function () { closeDrawer(); openSupport(); }], ["🧾", "Payout calculator", "", function () { closeDrawer(); assistant("openCalculator"); }], ["💬", "BI Assistant", "", function () { closeDrawer(); assistant("openChat"); }]];
    var toolItems = [["⊞", "All tools", admin ? "Field, reports, engage, help, admin" : "Field, reports, engage, help", function () { openTool("hub"); }]];
    if (p.master) toolItems.push(["🧩", "Studio", "Customize, build tools, release, access", function () { openTool("studio"); }], ["✏️", "Customize this dashboard", "Rename / hide labels here", function () { closeDrawer(); if (window.CUST) window.CUST.edit(true); }]);
    var accItems = [["👤", "Edit profile", p.email || "", showEdit], ["🔒", "Change password", "", showPassword]];
    var setItems = [["🔠", "Dashboard text size", zoomLabel(), chooseZoom], ["🔄", "Refresh dashboard", "", function () { location.reload(); }]];
    var supItems = [["📲", "Get the State app", "APK", function () { location.href = APP_LINKS.state; }], admin ? ["📲", "Get the Admin app", "APK", function () { location.href = APP_LINKS.admin; }] : null,
      ["🔗", "Copy dashboard link", "", function () { try { navigator.clipboard.writeText(location.origin + "/"); toast("Link copied"); } catch (e) { toast(location.origin); } }],
      ["🛡️", "Privacy policy", "", function () { window.open("privacy.html", "_blank"); }], ["📄", "Terms of service", "", function () { window.open("terms.html", "_blank"); }]];
    var about = [["ℹ️", "Version", "Web · " + (window.BIAssist ? "assistant " + window.BIAssist.version : "latest"), null], p.createdAt ? ["📅", "Member since", fmtTime(p.createdAt, { day: "numeric", month: "short", year: "numeric" }), null] : null];
    var sub = (p.master ? "👑 Master admin" : admin ? "Admin" : "State user") + (p.designation ? " · " + p.designation : "") + (p.state ? " · " + p.state : "");
    var d = drawer("Profile", null,
      '<div class="biw-prof"><div class="biw-av" id="biw-pav">' + (ph && ph.data ? '<img alt="" src="data:image/jpeg;base64,' + ph.data + '">' : esc(initials(p.fullName || AUTH.username))) + "</div>" +
      '<a class="biw-link" id="biw-chph" style="color:#e6cf86;margin:0 0 6px">📷 Change photo</a><b>' + esc(p.fullName || AUTH.username) + "</b><small>@" + esc(AUTH.username) + (p.phone ? " · " + esc(p.phone) : "") + '</small><br><span class="biw-pill">' + esc(sub) + "</span></div>" +
      '<div class="biw-sec">Tools</div><div id="biw-r1">' + rows(toolItems) + "</div>" +
      '<div class="biw-sec">Account</div><div id="biw-r2">' + rows(accItems) + "</div>" +
      '<div class="biw-sec">Settings</div><div id="biw-r3">' + rows(setItems) + "</div>" +
      '<div class="biw-sec">Apps & support</div><div id="biw-r4">' + rows(supItems) + "</div>" +
      '<div class="biw-sec">About</div><div id="biw-r5">' + rows(about) + "</div>" +
      '<button class="biw-btn biw-danger" id="biw-lo">Log out</button><a class="biw-link" id="biw-del" style="color:#999;font-size:13px">Delete my account</a>');
    bindRows(d, "#biw-r1", toolItems); bindRows(d, "#biw-r2", accItems); bindRows(d, "#biw-r3", setItems); bindRows(d, "#biw-r4", supItems);
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
          return '<div class="biw-item"' + (u.disabled ? ' style="opacity:.75;border-color:#efc6bf"' : "") + '><b>' + esc(u.fullName) + "</b>" +
            (u.disabled ? ' <span style="background:#FDECEC;color:#b3402f;border-radius:99px;padding:2px 8px;font-size:11px;font-weight:700">🚫 Disabled</span>' : "") + '<br><span style="color:#8a6a1f">@' + esc(u.username) + '</span> · <a href="tel:' + esc(u.phone) + '">📞 ' + esc(u.phone) + "</a>" +
            ([u.designation, u.state].filter(Boolean).length ? '<div class="biw-mut">' + esc([u.designation, u.state].filter(Boolean).join(" · ")) + "</div>" : "") +
            '<div class="biw-mut">Joined ' + fmtTime(u.createdAt, { day: "numeric", month: "short", year: "numeric" }) + " · Last seen " + fmtTime(u.lastSeen) + "</div>" +
            (u.disabled ? '<div class="biw-mut" style="color:#b3402f">Disabled by ' + esc(u.disabledBy || "admin") + " · " + fmtTime(u.disabledAt) + (u.disabledReason ? " · " + esc(u.disabledReason) : "") + "</div>" : "") +
            '<div style="display:flex;gap:16px;margin-top:6px"><a class="biw-link" style="margin:0" data-u="' + i + '">📍 Change state' + (u.state ? " (" + esc(u.state) + ")" : "") + "</a>" +
            (which === "state" ? '<a class="biw-link" style="margin:0;color:' + (u.disabled ? "#2e7d5b" : "#b3402f") + '" data-d="' + i + '">' + (u.disabled ? "✅ Enable account" : "🚫 Disable account") + "</a>" : "") + "</div></div>";
        }).join("");
        [].forEach.call(d.querySelectorAll("[data-d]"), function (a) {
          a.onclick = function () {
            var u = list[+a.dataset.d], off = !u.disabled, reason = "";
            if (off) {
              reason = prompt("Disable " + u.fullName + " (@" + u.username + ")? They'll be logged out of the app and web and can't log in until you enable them.\n\nReason (optional):", "");
              if (reason === null) return;
            } else if (!confirm("Enable " + u.fullName + " (@" + u.username + ") again?")) return;
            api({ action: "admin-set-disabled", target: u.username, disabled: off, reason: reason }).then(function (r2) {
              if (r2.ok) { toast(off ? "Account disabled" : "Account enabled"); showUsers(which, d.querySelector("#u-q").value); } else toast(r2.error);
            });
          };
        });
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
