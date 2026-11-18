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
    else if (b.action === "ping") out = { ok: true, account: Session.getEffectiveUser().getEmail(), version: 3 };
    else if (b.action === "create") out = createForm(b.survey || {}, b.opts || {});
    else if (b.action === "results") out = results(b.id, +b.max || 3000);
    else if (b.action === "accepting") { var f = FormApp.openById(b.id); f.setAcceptingResponses(!!b.on); if (b.msg) f.setCustomClosedFormMessage(String(b.msg)); out = { ok: true, on: f.isAcceptingResponses() }; }
    else out = { ok: false, error: "Unknown action" };
  } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return ContentService.createTextOutput(JSON.stringify({ ok: true, hello: "vivo BI Google Forms connector" })).setMimeType(ContentService.MimeType.JSON); }

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
  if (t === "single" || t === "yesno") { it = form.addMultipleChoiceItem().setTitle(title).setChoiceValues(optionList(q)); if (q.other && t === "single") it.showOtherOption(true); }
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
