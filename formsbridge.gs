/**
 * vivo BI — Google Forms connector (Apps Script web app).
 * Paste into https://script.google.com (New project), then Deploy → New deployment → Web app,
 * Execute as: Me · Who has access: Anyone. Copy the Web app URL into the BI tool's Set-up.
 * The BI tool sends a survey design; this script creates the form in YOUR Google account,
 * publishes it and returns the share link. Only requests carrying the key below are accepted.
 */
var BI_KEY = "@@KEY@@";

function doPost(e) {
  var out;
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!b.key || b.key !== BI_KEY) out = { ok: false, error: "Wrong key — copy the script again from the BI tool's Set-up." };
    else if (b.action === "ping") out = { ok: true, account: Session.getEffectiveUser().getEmail(), version: 5 };
    else if (b.action === "site") { if (!/^https:\/\/[\w.-]+$/.test(String(b.site || ""))) out = { ok: false, error: "Bad site" }; else { PropertiesService.getScriptProperties().setProperty("BI_SITE", String(b.site)); out = { ok: true }; } }
    else if (b.action === "create") out = createForm(b.survey || {}, b.opts || {});
    else if (b.action === "results") out = results(b.id, +b.max || 3000);
    else if (b.action === "accepting") { var f = FormApp.openById(b.id); f.setAcceptingResponses(!!b.on); if (b.msg) f.setCustomClosedFormMessage(String(b.msg)); out = { ok: true, on: f.isAcceptingResponses() }; }
    else out = { ok: false, error: "Unknown action" };
  } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function tryDo(f) { try { return f(); } catch (e) { return null; } }

function createForm(s, opts) {
  var warn = [], form = tryDo(function () { return FormApp.create(s.title || "Survey", false); }) || FormApp.create(s.title || "Survey");
  if (s.description) form.setDescription(s.description);
  if (s.confirmation) form.setConfirmationMessage(s.confirmation);
  var st = s.settings || {};
  form.setProgressBar(st.progressBar !== false);
  if (st.shuffle) form.setShuffleQuestions(true);
  if (st.collectEmail) { if (!tryDo(function () { form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED); return 1; })) tryDo(function () { form.setCollectEmail(true); return 1; }); }
  if (st.limitOne) { if (!tryDo(function () { form.setLimitOneResponsePerUser(true); return 1; })) warn.push("One response per person could not be set."); }
  if (st.editAfter) tryDo(function () { form.setAllowResponseEdits(true); return 1; });
  if (st.isQuiz) form.setIsQuiz(true);
  tryDo(function () { form.setRequireLogin(!!st.requireLogin); return 1; });   // Workspace accounts only

  var secs = s.sections || [], pages = {}, items = [], firstId = secs.length ? secs[0].id : "";
  secs.forEach(function (sec, si) {
    if (si > 0) { var pb = form.addPageBreakItem().setTitle(sec.title || ("Section " + (si + 1))); if (sec.description) pb.setHelpText(sec.description); pages[sec.id] = pb; }
    else if (sec.title && secs.length > 1) { var h = form.addSectionHeaderItem().setTitle(sec.title); if (sec.description) h.setHelpText(sec.description); }
    (sec.questions || []).forEach(function (q) { var it = addQuestion(form, q, warn); if (it) items.push({ q: q, it: it, sec: si }); });
  });
  // branching: needs every page to exist first
  var nav = function (target) {
    if (!target || target === "NEXT") return FormApp.PageNavigationType.CONTINUE;
    if (target === "SUBMIT") return FormApp.PageNavigationType.SUBMIT;
    if (target === firstId) return FormApp.PageNavigationType.RESTART;
    return pages[target] || null;
  };
  items.forEach(function (x) {
    var q = x.q; if (!q.goTo || (q.type !== "single" && q.type !== "dropdown" && q.type !== "yesno")) return;
    var opts2 = optionList(q), it = x.it;
    var ch = opts2.map(function (o) { var t = nav(q.goTo[o]); if (t === null) { warn.push("“" + q.title + "”: section for “" + o + "” not found"); t = FormApp.PageNavigationType.CONTINUE; } return it.createChoice(o, t); });
    it.setChoices(ch);
    if (q.other && q.type !== "dropdown") it.showOtherOption(true);
  });
  secs.forEach(function (sec, si) {   // where to go after a section ends (set on the NEXT page break)
    if (!sec.next || sec.next === "NEXT" || si + 1 >= secs.length) return;
    var pb = pages[secs[si + 1].id], t = nav(sec.next);
    if (t === null) { warn.push("Section “" + sec.title + "”: next section not found"); return; }
    pb.setGoToPage(t);
  });
  var sheetUrl = "";
  if (opts.sheet) tryDo(function () { var ss = SpreadsheetApp.create((s.title || "Survey") + " (responses)"); form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId()); sheetUrl = ss.getUrl(); return 1; });
  if (!tryDo(function () { form.setPublished(true); return 1; })) { /* older accounts: forms are published on creation */ }
  form.setAcceptingResponses(true);
  var url = tryDo(function () { return form.getPublishedUrl(); }) || "", shortUrl = tryDo(function () { return form.shortenFormUrl(url); }) || "";
  return { ok: true, id: form.getId(), url: url, shortUrl: shortUrl, editUrl: form.getEditUrl(), sheetUrl: sheetUrl, items: items.length, warn: warn };
}

function optionList(q) { if (q.type === "yesno") return (q.options && q.options.length ? q.options : ["Yes", "No"]); return (q.options || []).filter(function (o) { return String(o).trim(); }); }

function addQuestion(form, q, warn) {
  var it, t = q.type, title = q.title || "Question";
  if (t === "info") { it = form.addSectionHeaderItem().setTitle(title); if (q.help) it.setHelpText(q.help); return null; }
  if ((t === "single" || t === "yesno") && q.correct != null && tryDo(function () { return form.isQuiz(); })) {   // quiz question: right answer, points and feedback → score shown after submit
    it = form.addMultipleChoiceItem().setTitle(title);
    var mc = it; it.setChoices(optionList(q).map(function (o) { return mc.createChoice(o, String(o) === String(q.correct)); }));
    tryDo(function () { it.setPoints(+q.points || 1); return 1; });
    if (q.why) tryDo(function () { var fb = FormApp.createFeedback().setText(String(q.why).slice(0, 500)).build(); it.setFeedbackForCorrect(fb); it.setFeedbackForIncorrect(fb); return 1; });
  }
  else if (t === "single" || t === "yesno") { it = form.addMultipleChoiceItem().setTitle(title).setChoiceValues(optionList(q)); if (q.other && t === "single") it.showOtherOption(true); }
  else if (t === "multi") {
    it = form.addCheckboxItem().setTitle(title).setChoiceValues(optionList(q)); if (q.other) it.showOtherOption(true);
    var v = q.validation || {};
    if (v.max) it.setValidation(FormApp.createCheckboxValidation().requireSelectAtMost(+v.max).build());
    else if (v.min) it.setValidation(FormApp.createCheckboxValidation().requireSelectAtLeast(+v.min).build());
  }
  else if (t === "dropdown") it = form.addListItem().setTitle(title).setChoiceValues(optionList(q));
  else if (t === "scale") { var sc = q.scale || {}; it = form.addScaleItem().setTitle(title).setBounds(sc.min === 0 ? 0 : 1, Math.max(2, Math.min(10, +sc.max || 5))); if (sc.minLabel || sc.maxLabel) it.setLabels(sc.minLabel || "", sc.maxLabel || ""); }
  else if (t === "grid" || t === "checkgrid") { it = (t === "grid" ? form.addGridItem() : form.addCheckboxGridItem()).setTitle(title).setRows(q.rows && q.rows.length ? q.rows : ["Row 1"]).setColumns(q.cols && q.cols.length ? q.cols : ["Column 1"]); }
  else if (t === "date") it = form.addDateItem().setTitle(title);
  else if (t === "time") it = form.addTimeItem().setTitle(title);
  else if (t === "paragraph") { it = form.addParagraphTextItem().setTitle(title); var pv = q.validation || {}; if (pv.maxLen) it.setValidation(FormApp.createParagraphTextValidation().requireTextLengthLessThanOrEqualTo(+pv.maxLen).build()); }
  else {   // short, number, email, phone
    it = form.addTextItem().setTitle(title);
    var tv = q.validation || {}, vb = FormApp.createTextValidation();
    if (t === "number") { if (tv.min != null && tv.min !== "" && tv.max != null && tv.max !== "") vb.requireNumberBetween(+tv.min, +tv.max); else if (tv.min != null && tv.min !== "") vb.requireNumberGreaterThanOrEqualTo(+tv.min); else if (tv.max != null && tv.max !== "") vb.requireNumberLessThanOrEqualTo(+tv.max); else vb.requireNumber(); it.setValidation(vb.setHelpText("Please enter a number").build()); }
    else if (t === "email") it.setValidation(vb.requireTextIsEmail().setHelpText("Please enter a valid e-mail").build());
    else if (t === "phone") it.setValidation(vb.requireTextMatchesPattern("^[6-9][0-9]{9}$").setHelpText("Enter a 10-digit mobile number").build());
    else if (tv.maxLen) it.setValidation(vb.requireTextLengthLessThanOrEqualTo(+tv.maxLen).build());
  }
  if (q.help) it.setHelpText(q.help);
  if (q.required && it.setRequired) it.setRequired(true);
  return it;
}

function results(id, max) {
  var f = FormApp.openById(id), its = f.getItems().filter(function (i) { var k = i.getType(); return k !== FormApp.ItemType.PAGE_BREAK && k !== FormApp.ItemType.SECTION_HEADER && k !== FormApp.ItemType.IMAGE && k !== FormApp.ItemType.VIDEO; });
  var head = ["Submitted at", "E-mail"].concat(its.map(function (i) { return i.getTitle(); }));
  var R = f.getResponses(), rows = [], from = Math.max(0, R.length - max);
  for (var r = from; r < R.length; r++) {
    var resp = R[r], m = {};
    resp.getItemResponses().forEach(function (x) { var v = x.getResponse(); m[x.getItem().getId()] = Array.isArray(v) ? v.map(function (y) { return Array.isArray(y) ? y.join("/") : y; }).join(", ") : String(v); });
    rows.push([Utilities.formatDate(resp.getTimestamp(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"), tryDo(function () { return resp.getRespondentEmail(); }) || ""].concat(its.map(function (i) { return m[i.getId()] || ""; })));
  }
  return { ok: true, count: R.length, accepting: f.isAcceptingResponses(), head: head, rows: rows };
}

// ======================= v5: timed lesson quiz on a Google address (script.google.com) =======================
// People open  <this web app URL>?k=<lesson code>. The page talks only to this script; the script talks to the BI server
// in the background, so the BI site's address never shows to them. The timer is measured by the BI server.
function doGet(e) {
  var k = String((e && e.parameter && e.parameter.k) || "");
  if (!/^[\w-]{8,40}$/.test(k)) return ContentService.createTextOutput(JSON.stringify({ ok: true, hello: "vivo BI Google Forms connector", version: 5 })).setMimeType(ContentService.MimeType.JSON);
  return HtmlService.createHtmlOutput(quizHtml_().replace("@@K@@", k)).setTitle("Lesson & quiz").addMetaTag("viewport", "width=device-width, initial-scale=1");
}
function biCall_(body) {
  var site = PropertiesService.getScriptProperties().getProperty("BI_SITE");
  if (!site) return { ok: false, error: "This quiz link is not ready yet — ask the person who shared it." };
  body.app = "state";
  try {
    var r = UrlFetchApp.fetch(site + "/api/auth", { method: "post", contentType: "application/json", headers: { "X-BI-App": "1" }, payload: JSON.stringify(body), muteHttpExceptions: true });
    return JSON.parse(r.getContentText());
  } catch (err) { return { ok: false, error: "Couldn't load — check your internet and try again." }; }
}
function qGet(k) { return JSON.stringify(biCall_({ action: "cs-p-get", k: String(k) })); }
function qStart(k) { return JSON.stringify(biCall_({ action: "cs-p-start", k: String(k) })); }
function qDone(k, json) { var p = JSON.parse(json); p.action = "cs-p-done"; p.k = String(k); p.via = "google"; return JSON.stringify(biCall_(p)); }
function quizHtml_() {
  return '<!doctype html><html><head><base target="_top"><meta charset="utf-8"><style>' +
    'body{margin:0;font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F4F5FB;color:#12163A}.w{max-width:720px;margin:0 auto;padding:14px}' +
    '.c{background:#fff;border-radius:16px;padding:16px;margin-top:12px;box-shadow:0 1px 6px rgba(20,24,51,.07)}h1{font-size:21px;margin:0 0 4px}h3{margin:0 0 6px;font-size:16px}' +
    'label{display:block;font-size:13px;font-weight:700;margin:12px 0 4px}input,select{width:100%;box-sizing:border-box;border:1px solid #D5D9EE;border-radius:10px;padding:11px;font:inherit}' +
    '.b{display:block;width:100%;border:0;border-radius:12px;padding:13px;font:700 15px inherit;background:#4D5BF9;color:#fff;cursor:pointer;margin-top:14px}.b.g{background:#EEF0FF;color:#3346C9}' +
    '.st{display:flex;gap:6px;margin-top:6px}.st span{flex:1;text-align:center;font-size:12px;font-weight:800;padding:6px;border-radius:99px;background:#E8EAF4;color:#666}.st span.on{background:#4D5BF9;color:#fff}' +
    '.t{position:sticky;top:0;z-index:3;display:flex;gap:8px;align-items:center;background:#12163A;color:#fff;border-radius:12px;padding:10px 14px;margin-top:12px;font-weight:700}.t .sp{flex:1}.t.late{background:#B42318}' +
    '.q{border-top:1px solid #EEF0F6;padding:12px 0}.q b{display:block;margin-bottom:6px}.q label{font-weight:500;display:flex;gap:8px;align-items:flex-start;border:1px solid #E3E6F3;border-radius:10px;padding:9px;margin:6px 0;cursor:pointer}' +
    '.q label input{width:auto;margin-top:3px}.ok{background:#E6F4EA!important;border-color:#13693F!important}.bad{background:#FDECEC!important;border-color:#B42318!important}.why{font-size:13px;color:#555;margin-top:4px}' +
    '.big{font-size:34px;font-weight:800;text-align:center}.mut{color:#666;font-size:13px}ul{padding-left:20px;margin:6px 0}.e{color:#B42318;font-size:13px;margin-top:8px}.fl{background:#F7F8FC;border-radius:10px;padding:10px;margin-top:8px}' +
    '</style></head><body><div class="w" id="v"><div class="c">Loading…</div></div><script>' +
    'var K="@@K@@",L=null,X=null,me={},ans=[],ST=null,T0=0,LIM=0,tk=null,sent=false,lang="en";' +
    'function $(i){return document.getElementById(i)}function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}' +
    'function call(fn,a,b){return new Promise(function(res){var r=google.script.run.withSuccessHandler(function(x){try{res(JSON.parse(x))}catch(e){res({ok:false,error:"Error"})}}).withFailureHandler(function(){res({ok:false,error:"Couldn\'t connect — try again."})});b===undefined?r[fn](a):r[fn](a,b)})}' +
    'function mm(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+":"+("0"+s%60).slice(-2)}' +
    'function steps(n){return\'<div class="st">\'+["1 · Details","2 · Read","3 · Quiz","4 · Result"].map(function(x,i){return\'<span class="\'+(i===n?"on":"")+\'">\'+x+"</span>"}).join("")+"</div>"}' +
    'function learn(){var h=\'<div class="c"><h3>📖 Case study</h3>\'+esc(X.summary).split(/\\n+/).map(function(p){return"<p>"+p+"</p>"}).join("")+"</div>";' +
    'if(X.keypoints&&X.keypoints.length)h+=\'<div class="c"><h3>📌 Remember</h3><ul>\'+X.keypoints.map(function(k){return"<li>"+esc(k)+"</li>"}).join("")+"</ul></div>";' +
    'if(X.cards&&X.cards.length)h+=\'<div class="c"><h3>📚 Lessons</h3>\'+X.cards.map(function(c){return"<p><b>"+esc(c.title)+"</b><br>"+esc(c.body)+"</p>"}).join("")+"</div>";' +
    'if(X.flash&&X.flash.length)h+=\'<div class="c"><h3>🃏 Flash cards</h3>\'+X.flash.map(function(f){return\'<div class="fl"><b>Q: \'+esc(f.q)+"</b><br>A: "+esc(f.a)+"</div>"}).join("")+"</div>";return h}' +
    'function who(){var V=$("v"),ls=Object.keys(L.l.langs);V.innerHTML=steps(0)+\'<div class="c"><h1>\'+esc(L.l.title)+\'</h1><div class="mut">Read the lesson, then take a short timed quiz.</div><label>Your name</label><input id="n"><label>State</label><select id="s"><option value="">Choose…</option>\'+L.states.map(function(s){return"<option>"+esc(s)+"</option>"}).join("")+\'</select><label>Mobile (optional)</label><input id="m" inputmode="numeric" maxlength="10">\'+(ls.length>1?\'<label>Language</label><select id="lg">\'+ls.map(function(x){return\'<option value="\'+x+\'">\'+esc(L.langNames[x]||x)+"</option>"}).join("")+"</select>":"")+\'<button class="b" id="go">Start</button><div class="e" id="er"></div></div>\';' +
    '$("go").onclick=function(){var n=$("n").value.trim(),s=$("s").value,m=$("m").value.trim();if(n.length<2||!s){$("er").textContent="Type your name and choose your state";return}if(m&&!/^[6-9]\\d{9}$/.test(m)){$("er").textContent="Mobile must be 10 digits";return}me={name:n,state:s,phone:m};if($("lg"))lang=$("lg").value;X=L.l.langs[lang];read()}}' +
    'function read(){$("v").innerHTML=steps(1)+learn()+\'<div class="c"><div class="mut">The timer starts when you open the questions. Reading time is not counted.</div><button class="b" id="q">I have read it — start the quiz ⏱</button></div>\';scrollTo(0,0);$("q").onclick=quiz}' +
    'function quiz(){ans=[];sent=false;ST=null;LIM=0;T0=Date.now();call("qStart",K).then(function(r){if(r.ok){ST=r.st;LIM=r.limitPerQ?r.limitPerQ*X.quiz.length:0}});' +
    '$("v").innerHTML=steps(2)+\'<div class="t" id="t">⏱ 0:00</div><div class="c"><h3>✅ Quiz · \'+X.quiz.length+" questions</h3>"+X.quiz.map(function(q,i){return\'<div class="q"><b>\'+(i+1)+". "+esc(q.q)+"</b>"+q.options.map(function(o,j){return\'<label><input type="radio" name="q\'+i+\'" value="\'+j+\'"> \'+esc(o)+"</label>"}).join("")+"</div>"}).join("")+\'<button class="b" id="sb">Submit answers</button><div class="e" id="er"></div></div>\';scrollTo(0,0);' +
    '[].forEach.call(document.querySelectorAll(".q input"),function(x){x.onchange=function(){ans[+x.name.slice(1)]=+x.value}});' +
    '$("sb").onclick=function(){var miss=X.quiz.map(function(q,i){return ans[i]==null?i+1:0}).filter(Boolean);if(miss.length){$("er").textContent="Answer question "+miss.join(", ")+" first";return}send(false)};' +
    'clearInterval(tk);tk=setInterval(function(){var el=$("t");if(!el)return clearInterval(tk);var e=(Date.now()-T0)/1000,n=ans.filter(function(v){return v!=null}).length;el.innerHTML="⏱ "+mm(e)+(LIM?" / "+mm(LIM):"")+\'<span class="sp"></span>✏️ \'+n+"/"+X.quiz.length+" answered";el.className="t"+(LIM&&LIM-e<=30?" late":"");if(LIM&&e>=LIM&&!sent){send(true)}},500)}' +
    'function send(to){if(sent)return;sent=true;var b=$("sb");if(b){b.disabled=true;b.textContent="Checking…"}call("qDone",K,JSON.stringify({name:me.name,state:me.state,phone:me.phone,lang:lang,answers:ans,st:ST,timeout:to})).then(function(r){if(!r.ok){sent=false;if(b){b.disabled=false;b.textContent="Submit answers"}$("er").textContent=r.error||"Couldn\'t submit";return}clearInterval(tk);done(r,to)})}' +
    'function done(r,to){var secs=r.secs!=null?r.secs:Math.round((Date.now()-T0)/1000);$("v").innerHTML=steps(3)+\'<div class="c"><div class="big">\'+r.score+" of "+r.total+\' correct</div><div class="mut" style="text-align:center">⏱ Time taken \'+mm(secs)+(to?" · time ran out":"")+\'</div><button class="b g" id="rt">↺ Try again</button></div><div class="c"><h3>🧾 Your answers</h3>\'+X.quiz.map(function(q,i){var a=r.answers[i];return\'<div class="q"><b>\'+(ans[i]===a?"✅ ":"❌ ")+(i+1)+". "+esc(q.q)+"</b>"+q.options.map(function(o,j){return\'<label class="\'+(j===a?"ok":j===ans[i]?"bad":"")+\'">\'+esc(o)+(j===ans[i]?" ← your answer":"")+"</label>"}).join("")+(r.why&&r.why[i]?\'<div class="why">💡 \'+esc(r.why[i])+"</div>":"")+"</div>"}).join("")+"</div>"+learn();scrollTo(0,0);$("rt").onclick=read}' +
    'call("qGet",K).then(function(r){if(!r.ok){$("v").innerHTML=\'<div class="c">\'+esc(r.error)+"</div>";return}L=r;lang=Object.keys(r.l.langs)[0];if(r.l.langs.en)lang="en";X=r.l.langs[lang];who()});' +
    '</script></body></html>';
}
