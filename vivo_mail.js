/* vivo BI · read IMEI unblock request mails in Outlook on the web (outlook.office.com), after the person has signed in themselves.
   It searches with the set-up words, opens each conversation in the list and copies sender, time, subject and text.
   Nothing is sent, moved, deleted or marked. Called about once a second: window.__biMailRun(job) where
   job = { id, mode: "mail", q: "unblock OR unflag …", max, days }.
   Returns JSON { s: you|run|done|err|stopped, msg, pct, mails: [{ key, from, fromName, at, subject, text }] }
   Reply mode: job.reply = { from, subject, text } → finds that mail, presses Reply all and types the text. It NEVER presses Send —
   the person reads the draft and sends it. */
(function () {
  var W = window, D = document, KEY = "__bimail", EM = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  function vis(e) { try { var r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; var s = getComputedStyle(e); return s.visibility !== "hidden" && s.display !== "none"; } catch (x) { return false; } }
  function txt(e) { return String((e && (e.innerText || e.textContent)) || "").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
  function tap(e) { try { e.scrollIntoView({ block: "center" }); } catch (x) { } ["mousedown", "mouseup"].forEach(function (t) { try { e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: W })); } catch (x) { } }); e.click(); }
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(S) { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }
  function out(o) { return JSON.stringify(o); }
  function when(s) {   // Outlook header dates: "Thu 19-11-2026 10:45", "Mon 11/16/2026 6:05 PM", "19 November 2026 10:45", "Yesterday 18:02", "10:45"
    s = String(s || ""); var now = new Date(), m;
    if ((m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i))) { var a = +m[1], b = +m[2], day = b > 12 ? b : a, mon = b > 12 ? a : b, h = +m[4]; if (m[6]) h = h % 12 + (/pm/i.test(m[6]) ? 12 : 0); return new Date(+m[3], mon - 1, day, h, +m[5]).getTime(); }
    if ((m = s.match(/\b(\d{1,2})[-\/.](\d{1,2})\b(?![-\/.]\d)/)) && !/:/.test(s.slice(m.index - 1, m.index))) { var dd = new Date(now.getFullYear(), +m[2] - 1, +m[1]); if (dd - now > 864e5) dd.setFullYear(dd.getFullYear() - 1); return dd.getTime(); }
    if ((m = s.match(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+(\d{1,2}):(\d{2})/i))) { var wd = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(m[1].slice(0, 3).toLowerCase()), d2 = new Date(now); d2.setHours(+m[2], +m[3], 0, 0); while (d2.getDay() !== wd || d2 > now) d2.setDate(d2.getDate() - 1); return d2.getTime(); }
    var t = Date.parse(s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*/i, "")); if (!isNaN(t)) return t;
    if ((m = s.match(/(yesterday|today)?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i))) { var d0 = new Date(now); if (/yesterday/i.test(m[1] || "")) d0.setDate(d0.getDate() - 1); var hh = +m[2] % 12 + (/pm/i.test(m[4] || "") ? 12 : 0); if (!m[4]) hh = +m[2]; d0.setHours(hh, +m[3], 0, 0); return d0.getTime(); }
    return 0;
  }
  function searchBox() { return [].filter.call(D.querySelectorAll("#topSearchInput,input[aria-label*='Search' i],input[placeholder*='Search' i]"), vis)[0] || null; }
  var KW = /unblock|unflag|release|roll\s*back|unbock/i;
  var ROWDATE = /\b(mon|tue|wed|thu|fri|sat|sun)\b|\d{1,2}[-\/.]\d{1,2}|\d{1,2}:\d{2}|yesterday|today/i;
  function inPane(e) { return !!(e.closest("#ReadingPaneContainerId,[aria-label='Message body'],[aria-label='Reading Pane'],[contenteditable=true]") || e.querySelector("[aria-label='Message body']")); }
  function rowOk(e, needKw) { if (!vis(e) || inPane(e)) return false; var r = e.getBoundingClientRect(), t = txt(e); return r.height >= 38 && r.height <= 360 && r.width > 160 && t.length > 12 && t.length < 900 && (!needKw || KW.test(t)) && (ROWDATE.test(t) || EM.test(t)); }
  function items() {
    var L = [].filter.call(D.querySelectorAll("[role=listbox] [role=option],div[data-convid],[role=option],[role=row],[role=listitem],[data-item-index],[aria-posinset]"), function (e) { return rowOk(e, false) || (/option/.test(e.getAttribute("role") || "") && vis(e) && !inPane(e) && txt(e).length > 8); });
    L = L.filter(function (e) { return !L.some(function (o) { return o !== e && e.contains(o); }); });
    if (L.length) return L;
    // no roles Outlook recognises: the smallest boxes that look like a mail row
    var C = [].filter.call(D.querySelectorAll("div,li,a"), function (e) { return rowOk(e, true); });
    C = C.filter(function (e) { return !C.some(function (o) { return o !== e && e.contains(o) && o.getBoundingClientRect().height >= 38 && EM.test(txt(o)) === EM.test(txt(e)); }); });
    return C.filter(function (e) { return !C.some(function (o) { return o !== e && o.contains(e); }); });
  }
  function idOf(e) { return e.getAttribute("data-convid") || e.getAttribute("data-item-id") || txt(e).replace(/\s+/g, " ").slice(0, 160); }
  function diag() {   // what the page looks like, so the list can be found if Outlook changes
    var roles = {}; [].forEach.call(D.querySelectorAll("[role]"), function (e) { if (vis(e)) { var r = e.getAttribute("role"); roles[r] = (roles[r] || 0) + 1; } });
    var hit = [].filter.call(D.querySelectorAll("span,div,mark"), function (e) { return vis(e) && KW.test(txt(e)) && txt(e).length < 120 && !e.children.length; })[0], chain = [];
    for (var e = hit, k = 0; e && e !== D.body && k < 12; e = e.parentElement, k++) { var r = e.getBoundingClientRect(); chain.push(e.tagName.toLowerCase() + (e.getAttribute("role") ? "[role=" + e.getAttribute("role") + "]" : "") + (e.id ? "#" + e.id.slice(0, 30) : "") + (e.getAttribute("aria-label") ? "[aria=" + e.getAttribute("aria-label").slice(0, 40) + "]" : "") + " " + Math.round(r.width) + "x" + Math.round(r.height)); }
    return "w=" + innerWidth + " roles=" + JSON.stringify(roles) + " chain=" + chain.join(" < ");
  }
  // does this list row (sender + subject + first line) match the set-up? Only matching rows are opened.
  function rowMatch(t, F) {
    t = String(t || "").toLowerCase(); var subj = KW.test(t), snd = !F.senders.length || F.senders.some(function (x) { var k = x.replace(/^@/, ""); return k && t.indexOf(k) >= 0; });
    return F.mode === "either" ? (subj || (F.senders.length && snd)) : F.mode === "sender" ? snd : F.mode === "subject" ? subj : subj && snd;
  }
  function searching() { var sb = searchBox(); return (sb && sb.value && sb.value.trim().length > 1) || /\b(top results|all results|results)\b/i.test(txt(D.body).slice(0, 3000)); }
  function backToList() {
    var b = [].filter.call(D.querySelectorAll("button,[role=button]"), function (e) { var a = (e.getAttribute("aria-label") || e.getAttribute("title") || txt(e)).trim(); return vis(e) && /^(back|go back|close|back to (message )?list|close reading pane)$/i.test(a); })[0];
    if (b) tap(b); else history.back();
  }
  function wide() {   // ask Outlook for its computer layout (list + reading pane side by side)
    try { var m = D.querySelector("meta[name=viewport]"); if (!m) { m = D.createElement("meta"); m.name = "viewport"; D.head.appendChild(m); } if (!/width=1[0-9]{3}/.test(m.content)) { m.content = "width=1366"; W.dispatchEvent(new Event("resize")); } } catch (e) { }
  }
  function pane() { return D.querySelector("#ReadingPaneContainerId,[aria-label='Reading Pane'],[data-app-section='ConversationContainer']") || [].filter.call(D.querySelectorAll("[role=main]"), vis)[0] || null; }
  function bodies(p) { return [].filter.call(p.querySelectorAll("[aria-label='Message body'],div[role=document]"), function (b) { return vis(b) && !b.parentElement.closest("[aria-label='Message body'],div[role=document]"); }); }
  function readPane(subject, fallbackAt, p0) {
    var p = p0 || pane(); if (!p) return [];
    var out = [], B = bodies(p);
    B.forEach(function (b) {
      var box = b, head = "";
      for (var i = 0; i < 8 && box.parentElement && box !== p; i++) { box = box.parentElement; head = txt(box).replace(txt(b), ""); if (EM.test(head)) break; }
      var from = (head.match(EM) || [""])[0].toLowerCase(), nm = (head.split(/\n/).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^(to|cc|from)\b/i.test(x); })[0] || "").replace(/<.*$/, "").trim();
      var dl = head.match(/(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+[^\n]{6,30}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}\s+\d{1,2}:\d{2}(\s*[AP]M)?|(yesterday|today)\s+\d{1,2}:\d{2}(\s*[AP]M)?/i);
      var at = (dl && when(dl[0])) || fallbackAt || Date.now();
      out.push({ key: (from + "|" + at + "|" + subject).slice(0, 200), from: from, fromName: nm.slice(0, 60), at: at, subject: subject, text: txt(b).slice(0, 6000) });
    });
    return out;
  }
  function expandAll(p) {   // open collapsed messages of the conversation (only "expand" toggles, never other buttons)
    var n = 0; [].forEach.call(p.querySelectorAll("[aria-expanded='false']"), function (e) { if (n < 8 && vis(e) && EM.test(txt(e) + " " + (e.getAttribute("aria-label") || "")) && !/^(more|reply|forward|menu)/i.test(e.getAttribute("aria-label") || "")) { tap(e); n++; } }); return n;
  }

  W.__biMailRun = function (job) {
    try {
      var S = load();
      if (job && job.mode === "mail" && job.reply && (!S || S.id !== job.id)) { var R0 = job.reply, sj = String(R0.subject || "").replace(/^((re|fw|fwd)\s*:\s*)+/i, "").replace(/["]/g, "").slice(0, 80); S = { id: job.id, reply: R0, q: (R0.from ? "from:" + R0.from + " " : "") + (sj ? '"' + sj + '"' : ""), st: "search", tick: 0, seen: {} }; save(S); }
      if (job && job.kw && job.kw.length) { try { KW = new RegExp(job.kw.map(function (k) { return String(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"); }).join("|"), "i"); } catch (e) { } }
      if (job && job.mode === "mail" && !job.reply && (!S || S.id !== job.id)) { S = { flt: { mode: job.match || "both", senders: (job.senders || []).map(function (x) { return String(x).toLowerCase().trim(); }).filter(Boolean) }, research: 0, id: job.id, q: String(job.q || "unblock"), max: Math.min(300, job.max || 60), since: Date.now() - (job.days || 7) * 864e5, st: "search", done0: {}, mails: [], seen: {}, cur: null, tick: 0, idle: 0 }; save(S); }
      if (!S) return out({ s: "err", msg: "No job" });
      if (S.done) return out(S.done);
      var fin = function (s, msg) { S.done = { s: s, mode: "mail", id: S.id, msg: msg, mails: S.mails }; save(S); return out(S.done); };
      if (job && job.stop) return fin("stopped", "Stopped — " + S.mails.length + " mails read");
      if (/login\.(microsoftonline|live|microsoft)\.com|login\.windows\.net|adfs|sso/i.test(location.hostname) || [].some.call(D.querySelectorAll("input[type=password]"), vis)) return out({ s: "you", msg: "Sign in to Outlook yourself (vivo e-mail, password, approval). The app reads the mails after that." });
      if (!/outlook\.(office|office365|live|cloud\.microsoft)/i.test(location.hostname + location.href)) return out({ s: "you", msg: "Open Outlook on the web (outlook.office.com) and sign in." });
      S.tick++; save(S); if (S.tick === 1 || S.tick % 10 === 0) wide();
      var pct = S.reply ? 50 : Math.min(99, Math.round(S.mails.length / S.max * 100));
      if (S.st === "search") {
        var sb = searchBox(); if (!sb) { save(S); return out({ s: "run", pct: 0, msg: "Waiting for Outlook to load…" }); }
        tap(sb); var P = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"); P.set.call(sb, S.q); sb.dispatchEvent(new Event("input", { bubbles: true }));
        ["keydown", "keypress", "keyup"].forEach(function (t) { sb.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })); });
        S.st = "list"; S.t0 = S.tick; save(S); return out({ s: "run", pct: 0, msg: "Searching: " + S.q });
      }
      if (S.reply && S.st === "list") {
        if (S.tick - S.t0 < 3) return out({ s: "run", pct: 20, msg: "Finding the mail…" });
        var L1 = items(); if (!L1.length) { if (S.tick - S.t0 > 25) return fin("err", "Couldn't find that mail in Outlook"); return out({ s: "run", pct: 20, msg: "Finding the mail…" }); }
        tap(L1[0]); S.st = "rpane"; S.t0 = S.tick; save(S); return out({ s: "run", pct: 40, msg: "Opening the mail…" });
      }
      if (S.reply && S.st === "rpane") {
        var p1 = pane(), rb = p1 && [].filter.call(p1.querySelectorAll("button,[role=button],[role=menuitem]"), function (e) { return vis(e) && /^reply all$/i.test((e.getAttribute("aria-label") || txt(e)).trim()); }).pop();
        if (!rb) rb = [].filter.call(D.querySelectorAll("button,[role=button]"), function (e) { return vis(e) && /^reply all$/i.test((e.getAttribute("aria-label") || txt(e)).trim()); })[0];
        if (!rb) { if (S.tick - S.t0 > 15) return fin("err", "Couldn't find Reply all — reply yourself; the text is ready to paste"); return out({ s: "run", pct: 50, msg: "Opening the mail…" }); }
        tap(rb); S.st = "type"; S.t0 = S.tick; save(S); return out({ s: "run", pct: 60, msg: "Reply all…" });
      }
      if (S.reply && S.st === "type") {
        var ed = [].filter.call(D.querySelectorAll("div[contenteditable=true][aria-label*='Message body' i],div[contenteditable=true][role=textbox]"), vis)[0];
        if (!ed) { if (S.tick - S.t0 > 15) return fin("err", "The reply box didn't open — reply yourself; the text is ready to paste"); return out({ s: "run", pct: 70, msg: "Opening the reply…" }); }
        ed.focus(); try { var sel = W.getSelection(), rg = D.createRange(); rg.setStart(ed, 0); rg.collapse(true); sel.removeAllRanges(); sel.addRange(rg); } catch (e) { }
        var ok = false; try { ok = D.execCommand("insertText", false, S.reply.text); } catch (e) { }
        if (!ok) { var div = D.createElement("div"); div.innerText = S.reply.text; ed.insertBefore(div, ed.firstChild); ed.dispatchEvent(new Event("input", { bubbles: true })); }
        S.st = "ready"; save(S);
      }
      if (S.reply && S.st === "ready") return out({ s: "you", msg: "Reply is ready. Read it and tap Send yourself, then go back to the app. (Nothing is sent by the app.)" });
      if (S.st === "back") { if (items().length || S.tick - S.t0 > 4) { S.st = "list"; S.t0 = S.tick - 3; save(S); } else { if (S.tick - S.t0 === 2) backToList(); return out({ s: "run", pct: pct, msg: "Back to the list…" }); } }
      if (S.st === "list") {
        if (S.tick - S.t0 < 3) return out({ s: "run", pct: 0, msg: "Searching…" });
        var L = items();
        if (!L.length) {
          if (/we didn.t find anything|no results|nothing found|didn't find/i.test(txt(D.body).slice(0, 20000))) return fin("done", "No matching mails");
          if (S.tick - S.t0 > 45) { S.done = { s: "err", mode: "mail", id: S.id, msg: "Couldn't read the mail list on this Outlook screen", diag: diag(), mails: S.mails }; save(S); return out(S.done); }
          if (S.tick - S.t0 === 20) wide();
          return out({ s: "run", pct: 0, msg: "Waiting for the results list…" });
        }
        if (!searching() && S.research < 15) { S.research++; S.st = "search"; save(S); return out({ s: "run", pct: pct, msg: "Searching again…" }); }   // Outlook left the search (e.g. after Back)
        var nx = null;
        for (var q = 0; q < L.length && !nx; q++) {
          var e1 = L[q], id1 = idOf(e1); if (S.seen[id1]) continue;
          if (S.flt && !rowMatch(txt(e1), S.flt)) { S.seen[id1] = 1; S.skipped = (S.skipped || 0) + 1; continue; }   // other sender / subject — not opened
          var d1 = when((txt(e1).match(/(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+\d{1,2}[-\/.]\d{1,2}([-\/.]\d{2,4})?|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}|(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+\d{1,2}:\d{2}|\b\d{1,2}:\d{2}\s*(am|pm)?\b/i) || [""])[0]);
          if (d1 && d1 < S.since) { S.seen[id1] = 1; S.older = (S.older || 0) + 1; continue; }   // older than the period — not opened
          nx = e1;
        }
        if (!nx) {   // load more by scrolling the list
          var sc = L[L.length - 1]; while (sc && sc !== D.body && !(sc.scrollHeight > sc.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
          if (sc && sc !== D.body) sc.scrollTop = sc.scrollTop + sc.clientHeight * 0.9; else W.scrollBy(0, innerHeight * 0.9);
          S.idle++; save(S);
          if (S.idle > 5) return fin("done", "Read " + S.mails.length + " mails" + (S.skipped ? " · " + S.skipped + " other mails not opened" : "") + (S.older ? " · " + S.older + " older ones skipped" : ""));
          return out({ s: "run", pct: pct, msg: "Loading more mails…" });
        }
        S.idle = 0; S.seen[idOf(nx)] = 1; S.cur = { subj: txt(nx).slice(0, 300), row: txt(nx), t0: S.tick, exp: 0 }; tap(nx); S.st = "read"; save(S);
        return out({ s: "run", pct: pct, msg: "Opening a matching mail · " + S.mails.length + " read" + (S.skipped ? " · " + S.skipped + " other mails skipped" : "") });
      }
      if (S.st === "read") {
        var p = pane(); if (!p || !bodies(p).length) { p = D.body; if (!bodies(p).length) { if (S.tick - S.cur.t0 > 12) { S.st = items().length ? "list" : "back"; S.t0 = S.tick; save(S); } return out({ s: "run", pct: pct, msg: "Opening the mail…" }); } }
        if (!S.cur.exp) { S.cur.exp = 1; if (expandAll(p)) { save(S); return out({ s: "run", pct: pct, msg: "Opening every message in the conversation…" }); } }
        var subjEl = p.querySelector("[role=heading],h1,h2,[id*='Subject'],[class*='subject' i]"), subject = (subjEl ? txt(subjEl) : S.cur.subj).slice(0, 200);
        var got = readPane(subject, 0, p), old = 0, rowFrom = (S.cur.row.match(EM) || [""])[0].toLowerCase();
        got.forEach(function (m) { if (!m.from) { var t1 = p.querySelector("[title*='@']"); m.from = t1 ? ((t1.getAttribute("title").match(EM) || [""])[0]).toLowerCase() : rowFrom; m.key = (m.from + "|" + m.at + "|" + subject).slice(0, 200); } });
        got.forEach(function (m) { if (m.at && m.at < S.since) { old++; return; } if (!S.done0[m.key]) { S.done0[m.key] = 1; S.mails.push(m); } });
        if (got.length && old === got.length) S.oldRun = (S.oldRun || 0) + 1; else S.oldRun = 0;
        if (items().length) S.st = "list"; else { S.st = "back"; S.t0 = S.tick; }
        save(S);
        if (S.mails.length >= S.max) return fin("done", "Read " + S.mails.length + " mails (limit)");
        if (S.oldRun >= 6) return fin("done", "Read " + S.mails.length + " mails (reached older mails)");
        return out({ s: "run", pct: pct, msg: S.mails.length + " mails read" });
      }
      return out({ s: "run", pct: pct, msg: "Working…" });
    } catch (e) { return out({ s: "err", msg: String(e && e.message || e) }); }
  };
})();
