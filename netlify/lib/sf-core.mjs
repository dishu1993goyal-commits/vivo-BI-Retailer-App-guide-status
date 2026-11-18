// Survey / poll creator (HO). Describe a survey → AI drafts the full design → HO reviews → one tap creates it
// in Google Forms (through the HO's own Apps Script connector) or SurveyMonkey (private-app token) and returns the share link.
//   sf:cfg          { gasUrl, gasKey, smToken, account, at }      keys never leave the server after set-up
//   sf:s:<id>       { id, title, survey, brief, by, at, upd, form: { platform, id, url, shortUrl, editUrl, sheetUrl, at, warn[] } }
import { randomBytes } from "node:crypto";
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const TYPES = ["short", "paragraph", "number", "email", "phone", "single", "yesno", "multi", "dropdown", "scale", "grid", "checkgrid", "date", "time", "info"];
const CHOICE = ["single", "yesno", "multi", "dropdown"];
const parse = (s) => { try { return JSON.parse(String(s).replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "")); } catch (e) { return null; } };
const nid = (t) => t.toString(36).toUpperCase() + randomBytes(2).toString("hex");

// the one place that decides what a valid survey design looks like (AI output and the editor both pass through it)
export function cleanSurvey(s) {
  s = s && typeof s === "object" ? s : {};
  const st = s.settings || {}, list = (a, n, len) => (Array.isArray(a) ? a : []).map((x) => str(x, len)).filter(Boolean).filter((x, i, A) => A.indexOf(x) === i).slice(0, n);
  const used = {}; let qn = 0;
  const secs = (Array.isArray(s.sections) ? s.sections : []).slice(0, 20).map((x, i) => {
    let id = str(x.id, 20).replace(/[^\w-]/g, "") || "s" + (i + 1); while (used[id]) id += "x"; used[id] = 1;
    return { id, title: str(x.title, 140) || "Section " + (i + 1), description: txt(x.description, 600), next: str(x.next, 20), questions: Array.isArray(x.questions) ? x.questions : [] };
  });
  if (!secs.length) secs.push({ id: "s1", title: "Section 1", description: "", next: "", questions: [] });
  const ids = secs.map((x) => x.id), target = (v) => (v === "NEXT" || v === "SUBMIT" || ids.includes(v) ? v : "");
  secs.forEach((sec) => {
    sec.next = target(sec.next) === "NEXT" ? "" : target(sec.next);
    sec.questions = sec.questions.slice(0, 60).map((q) => {
      if (qn >= 150) return null; qn++;
      const type = TYPES.includes(q.type) ? q.type : q.type === "radio" || q.type === "mcq" ? "single" : q.type === "checkbox" ? "multi" : q.type === "text" ? "short" : "short";
      const o = { id: str(q.id, 20).replace(/[^\w-]/g, "") || "q" + qn, type, title: str(q.title, 300) || "Question", help: txt(q.help, 500), required: !!q.required };
      if (CHOICE.includes(type)) {
        o.options = type === "yesno" ? (list(q.options, 2, 120).length === 2 ? list(q.options, 2, 120) : ["Yes", "No"]) : list(q.options, 50, 160);
        if (!o.options.length) o.options = ["Option 1", "Option 2"];
        if (type !== "dropdown" && type !== "yesno") o.other = !!q.other;
        if (type !== "multi" && q.goTo && typeof q.goTo === "object") { const g = {}; o.options.forEach((op) => { const t = target(str(q.goTo[op], 20)); if (t && t !== "NEXT") g[op] = t; }); if (Object.keys(g).length) o.goTo = g; }
        if (type === "multi" && q.validation) { const v = {}; if (+q.validation.max > 0) v.max = Math.min(o.options.length, Math.round(+q.validation.max)); if (+q.validation.min > 0) v.min = Math.round(+q.validation.min); if (Object.keys(v).length) o.validation = v; }
      }
      if (type === "scale") { const sc = q.scale || {}, mx = Math.max(2, Math.min(10, Math.round(+sc.max || 5))); o.scale = { min: +sc.min === 0 ? 0 : 1, max: mx, minLabel: str(sc.minLabel, 40), maxLabel: str(sc.maxLabel, 40) }; }
      if (type === "grid" || type === "checkgrid") { o.rows = list(q.rows, 20, 120); o.cols = list(q.cols, 10, 60); if (!o.rows.length) o.rows = ["Row 1"]; if (!o.cols.length) o.cols = ["Column 1", "Column 2"]; }
      if (type === "number" && q.validation) { const v = {}; if (q.validation.min !== "" && q.validation.min != null && isFinite(+q.validation.min)) v.min = +q.validation.min; if (q.validation.max !== "" && q.validation.max != null && isFinite(+q.validation.max)) v.max = +q.validation.max; if (Object.keys(v).length) o.validation = v; }
      if ((type === "short" || type === "paragraph") && q.validation && +q.validation.maxLen > 0) o.validation = { maxLen: Math.min(5000, Math.round(+q.validation.maxLen)) };
      if (type === "info") o.required = false;
      return o;
    }).filter(Boolean);
  });
  return {
    title: str(s.title, 140) || "Survey", description: txt(s.description, 2000), confirmation: txt(s.confirmation, 500) || "Thank you — your response has been recorded.",
    settings: { collectEmail: !!st.collectEmail, limitOne: !!st.limitOne, editAfter: !!st.editAfter, progressBar: st.progressBar !== false, shuffle: !!st.shuffle, requireLogin: !!st.requireLogin },
    sections: secs
  };
}

const SCHEMA = `JSON shape (exactly):
{"title":"…","description":"1-3 sentences shown at the top: purpose, who should answer, time needed, how data is used","confirmation":"thank-you message",
 "settings":{"collectEmail":false,"limitOne":false,"progressBar":true,"shuffle":false},
 "sections":[{"id":"s1","title":"…","description":"optional","next":"NEXT | SUBMIT | <section id>  (where to go when this section ends; NEXT = following section)",
   "questions":[{"id":"q1","type":"short|paragraph|number|email|phone|single|yesno|multi|dropdown|scale|grid|checkgrid|date|time|info","title":"question text","help":"optional hint","required":true,
     "options":["for single / yesno / multi / dropdown"],"other":false,
     "goTo":{"<option text>":"<section id> | SUBMIT"}  (ONLY on single / yesno / dropdown, for conditional logic),
     "scale":{"min":1,"max":5,"minLabel":"…","maxLabel":"…"},"rows":["grid rows"],"cols":["grid columns"],
     "validation":{"min":0,"max":100} for number, {"max":2} for multi (pick at most), {"maxLen":300} for short/paragraph}]}]}
Rules: question types — single = radio (one answer), multi = checkboxes, dropdown for long lists (states, models), yesno = Yes/No, scale = 1-5 or 1-10 rating, grid = rate several items on the same scale, number for counts/amounts, phone = Indian 10-digit mobile, info = a note with no answer.
Conditional logic: when later questions apply only to some people, put them in their own section and use goTo on the deciding question; a branch section that should not continue into the next branch must set "next" to the section where the paths meet (or SUBMIT). goTo targets must be ids of sections that come AFTER the question's section.
Keep it answerable on a phone: short clear wording, options mutually exclusive and complete (add "Other" via "other":true or "Not applicable" where needed), required only where the answer is essential.`;

async function gas(cfg, body, f) {
  if (!cfg.gasUrl || !cfg.gasKey) return { ok: false, error: "Google Forms is not connected yet — HO: open Set-up." };
  let r, t;
  try { r = await f(cfg.gasUrl, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ key: cfg.gasKey }, body)), redirect: "follow" }); t = await r.text(); }
  catch (e) { return { ok: false, error: "Couldn't reach the Google connector: " + String(e.message || e).slice(0, 160) }; }
  const j = parse(t);
  if (!j || typeof j !== "object") return { ok: false, error: /accounts\.google|ServiceLogin|sign in/i.test(t) ? "Google asked for a login — in Apps Script the deployment must be: Execute as Me · Who has access: Anyone." : /not found|404/i.test(t) || (r && r.status === 404) ? "The connector URL is not valid any more — deploy again and paste the new Web app URL." : "The Google connector gave an unexpected answer (HTTP " + (r ? r.status : "?") + ")." };
  return j;
}

// ---- SurveyMonkey (private app token) ----
function smQuestion(q) {
  const h = [{ heading: q.title + (q.help ? "\n" + q.help : "") }], req = q.required ? { required: { text: "This question requires an answer.", type: "all", amount: "0" } } : {};
  const ch = (a) => a.map((x) => ({ text: x }));
  switch (q.type) {
    case "single": case "yesno": return Object.assign({ family: "single_choice", subtype: "vertical", headings: h, answers: Object.assign({ choices: ch(q.options) }, q.other ? { other: { text: "Other (please specify)", num_chars: 100, num_lines: 1 } } : {}) }, req);
    case "dropdown": return Object.assign({ family: "single_choice", subtype: "menu", headings: h, answers: { choices: ch(q.options) } }, req);
    case "multi": return Object.assign({ family: "multiple_choice", subtype: "vertical", headings: h, answers: Object.assign({ choices: ch(q.options) }, q.other ? { other: { text: "Other (please specify)", num_chars: 100, num_lines: 1 } } : {}) }, req);
    case "scale": { const a = []; for (let i = q.scale.min; i <= q.scale.max; i++) a.push(String(i)); h[0].heading += q.scale.minLabel || q.scale.maxLabel ? `\n(${q.scale.min} = ${q.scale.minLabel || "lowest"}, ${q.scale.max} = ${q.scale.maxLabel || "highest"})` : ""; return Object.assign({ family: "single_choice", subtype: "horiz", headings: h, answers: { choices: ch(a) } }, req); }
    case "grid": case "checkgrid": return Object.assign({ family: "matrix", subtype: q.type === "grid" ? "single" : "multi", headings: h, answers: { rows: ch(q.rows), choices: ch(q.cols) } }, req);
    case "date": case "time": return Object.assign({ family: "datetime", subtype: q.type === "date" ? "date_only" : "time_only", headings: h, answers: { rows: [{ text: q.type === "date" ? "Date" : "Time" }] } }, req);
    case "paragraph": return Object.assign({ family: "open_ended", subtype: "essay", headings: h }, req);
    case "info": return { family: "presentation", subtype: "descriptive_text", headings: h };
    default: {
      const o = Object.assign({ family: "open_ended", subtype: "single", headings: h }, req);
      if (q.type === "number") o.validation = Object.assign({ type: "integer", text: "Please enter a number." }, q.validation && q.validation.min != null ? { min: q.validation.min } : { min: 0 }, q.validation && q.validation.max != null ? { max: q.validation.max } : { max: 1000000000 });
      if (q.type === "email") o.validation = { type: "email", text: "Please enter a valid e-mail." };
      if (q.type === "phone") o.validation = { type: "integer", min: 6000000000, max: 9999999999, text: "Enter a 10-digit mobile number." };
      return o;
    }
  }
}
async function smCreate(token, s, f) {
  const H = { authorization: "Bearer " + token, "content-type": "application/json" }, base = "https://api.surveymonkey.com/v3";
  const call = async (path, body) => { const r = await f(base + path, { method: "POST", headers: H, body: JSON.stringify(body) }); const j = parse(await r.text()) || {}; if (!r.ok) { const e = j.error || {}; throw new Error((e.message || "HTTP " + r.status) + (e.name ? " (" + e.name + ")" : "")); } return j; };
  const pages = s.sections.map((sec) => ({ title: sec.title, description: sec.description, questions: sec.questions.map(smQuestion) }));
  if (s.description) pages[0].description = (s.description + (pages[0].description ? "\n\n" + pages[0].description : "")).slice(0, 2000);
  const sv = await call("/surveys", { title: s.title, pages });
  const col = await call("/surveys/" + sv.id + "/collectors", { type: "weblink", name: "BI link", thank_you_message: s.confirmation });
  const warn = [];
  if (s.sections.some((x) => x.next) || s.sections.some((x) => x.questions.some((q) => q.goTo))) warn.push("SurveyMonkey: the conditional jumps (skip logic) are not set through its API — add them in SurveyMonkey's designer if needed. Until then every respondent sees every page.");
  if (s.settings.collectEmail || s.settings.limitOne) warn.push("SurveyMonkey: e-mail collection / one response per person are set on the collector in SurveyMonkey, not here.");
  return { ok: true, id: String(sv.id), url: col.url || "", shortUrl: "", editUrl: sv.edit_url || "https://www.surveymonkey.com/create/?sm=" + sv.id, sheetUrl: "", warn };
}

export async function sfAction(b, ctx) {
  const { store, t, app, rec, pool, env = {}, askAI, aiFetch } = ctx;
  if (app !== "admin") return J(403, { ok: false, error: "Only HO can use this tool" });
  const f = aiFetch || fetch, by = rec.fullName || rec.username || "", cfg = (await store.get("sf:cfg")) || {};
  const pub = () => ({ google: !!(cfg.gasUrl && cfg.gasKey), account: cfg.account || "", gasUrl: cfg.gasUrl ? cfg.gasUrl.replace(/(\/s\/.{6}).*(.{6}\/exec)$/, "$1…$2") : "", hasKey: !!cfg.gasKey, sm: !!cfg.smToken, ai: !!askAI });

  if (b.action === "sf-get") {
    const L = (await pool(await store.list("sf:s:"), 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => (y.upd || y.at) - (x.upd || x.at)).slice(0, 150)
      .map((x) => ({ id: x.id, title: x.title, by: x.by, at: x.at, upd: x.upd, form: x.form ? { platform: x.form.platform, url: x.form.url, shortUrl: x.form.shortUrl, at: x.form.at, closed: !!x.form.closed, count: x.form.count || 0 } : null, q: (x.survey.sections || []).reduce((a, s) => a + s.questions.length, 0) }));
    return J(200, { ok: true, cfg: pub(), rows: L });
  }
  if (b.action === "sf-one") { const x = await store.get("sf:s:" + str(b.id, 20)); return x ? J(200, { ok: true, s: x }) : J(404, { ok: false, error: "Not found" }); }
  if (b.action === "sf-save") {
    const id = str(b.id, 20) || nid(t), old = await store.get("sf:s:" + id), sv = cleanSurvey(b.survey);
    const x = { id, title: sv.title, survey: sv, brief: old ? old.brief : txt(b.brief, 3000), by: old ? old.by : by, at: old ? old.at : t, upd: t, form: old ? old.form : null };
    await store.set("sf:s:" + id, x); return J(200, { ok: true, id, survey: sv });
  }
  if (b.action === "sf-del") { await store.delete("sf:s:" + str(b.id, 20)); return J(200, { ok: true }); }

  if (b.action === "sf-setup") {   // HO connects Google Forms / SurveyMonkey
    if (b.newKey) { cfg.gasKey = "bi_" + randomBytes(18).toString("base64url"); cfg.account = ""; await store.set("sf:cfg", cfg); return J(200, { ok: true, key: cfg.gasKey, cfg: pub() }); }
    if (b.gasUrl !== undefined) {
      const u = str(b.gasUrl, 300);
      if (u && !/^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[\w-]{20,}\/exec$/.test(u)) return J(400, { ok: false, error: "Paste the Web app URL that ends with /exec (from Deploy → Manage deployments)." });
      cfg.gasUrl = u; cfg.account = "";
    }
    if (b.smToken !== undefined) cfg.smToken = str(b.smToken, 400).replace(/^bearer\s+/i, "");
    cfg.at = t; await store.set("sf:cfg", cfg);
    let test = null;
    if (cfg.gasUrl && cfg.gasKey && (b.test || b.gasUrl)) { test = await gas(cfg, { action: "ping" }, f); if (test.ok) { cfg.account = str(test.account, 120); await store.set("sf:cfg", cfg); } }
    return J(200, { ok: true, cfg: pub(), test });
  }

  if (b.action === "sf-create") {   // build the real form
    const x = await store.get("sf:s:" + str(b.id, 20)); if (!x) return J(404, { ok: false, error: "Save the survey first" });
    const s = cleanSurvey(x.survey), qs = s.sections.reduce((a, sec) => a + sec.questions.filter((q) => q.type !== "info").length, 0);
    if (!qs) return J(400, { ok: false, error: "Add at least one question" });
    let r;
    if (b.platform === "sm") { if (!cfg.smToken) return J(400, { ok: false, error: "SurveyMonkey is not connected — HO: open Set-up." }); try { r = await smCreate(cfg.smToken, s, f); } catch (e) { r = { ok: false, error: "SurveyMonkey: " + String(e.message || e).slice(0, 240) }; } }
    else r = await gas(cfg, { action: "create", survey: s, opts: { sheet: !!b.sheet } }, f);
    if (!r.ok) return J(502, { ok: false, error: r.error || "Couldn't create the form" });
    x.form = { platform: b.platform === "sm" ? "sm" : "google", id: str(r.id, 120), url: str(r.url, 400), shortUrl: str(r.shortUrl, 200), editUrl: str(r.editUrl, 400), sheetUrl: str(r.sheetUrl, 400), at: t, by, warn: (r.warn || []).slice(0, 20).map((w) => str(w, 300)) };
    x.upd = t; await store.set("sf:s:" + x.id, x);
    return J(200, { ok: true, form: x.form });
  }
  if (b.action === "sf-results" || b.action === "sf-accepting") {
    const x = await store.get("sf:s:" + str(b.id, 20)); if (!x || !x.form) return J(404, { ok: false, error: "This survey has no form yet" });
    if (x.form.platform !== "google") return J(400, { ok: false, error: "For SurveyMonkey, see the responses in SurveyMonkey." });
    const r = await gas(cfg, b.action === "sf-results" ? { action: "results", id: x.form.id, max: 3000 } : { action: "accepting", id: x.form.id, on: !!b.on, msg: b.on ? "" : "This survey is closed. Thank you." }, f);
    if (!r.ok) return J(502, { ok: false, error: r.error || "Couldn't reach the form" });
    if (b.action === "sf-results") { x.form.count = +r.count || 0; x.form.closed = r.accepting === false; } else x.form.closed = !r.on;
    await store.set("sf:s:" + x.id, x);
    return J(200, b.action === "sf-results" ? { ok: true, count: r.count, closed: x.form.closed, head: (r.head || []).slice(0, 200), rows: (r.rows || []).slice(0, 3000) } : { ok: true, closed: x.form.closed });
  }

  if (b.action === "sf-ai") {
    if (!askAI) return J(400, { ok: false, error: "AI is not set up yet." });
    const lang = b.lang === "hi" ? "Write everything in simple Hindi (Devanagari)." : b.lang === "both" ? "Write every title, option and description bilingually: English first, then Hindi in Devanagari after ' / ' (e.g. 'State / राज्य'). Keep each short." : "Write in simple Indian English.";
    let sys, q, data, max = 7000;
    if (b.mode === "refine") {
      const cur = cleanSurvey(b.survey), ask = txt(b.prompt, 1200); if (ask.length < 3) return J(400, { ok: false, error: "Say what to change" });
      sys = "You edit a survey design for vivo India's sales Business Innovation team. Apply the user's change and return the COMPLETE updated design (keep everything else and keep existing ids). Reply with JSON only.\n" + SCHEMA + "\n" + lang + "\n\nCHANGE REQUESTED: " + ask;
      q = "Apply the change and return the full JSON."; data = JSON.stringify(cur).slice(0, 14000);
    } else {
      const brief = txt(b.prompt, 4000); if (brief.length < 15) return J(400, { ok: false, error: "Describe the survey in a few lines" });
      const len = b.len === "short" ? "a quick poll: 1 section, 2-5 questions" : b.len === "long" ? "a detailed survey: 3-6 sections, 15-30 questions" : "a standard survey: 2-4 sections, 8-15 questions";
      sys = "You design surveys and polls for vivo India (smartphones) — audiences include retailers / dealers, in-store promoters, sales staff, distributors and customers. Turn the brief into a complete, ready-to-publish survey: every question, every option, required flags, validation and conditional logic. Make it " + len + " unless the brief clearly asks otherwise. " + (b.anon ? "Responses are anonymous: do not ask for name, phone or e-mail and set collectEmail false." : "Ask for identifying details (name, store / firm, state, mobile) only if the brief needs them.") + " Reply with JSON only.\n" + SCHEMA + "\n" + lang + "\n\nAUDIENCE: " + (str(b.audience, 80) || "as described in the brief");
      q = "Design the survey now."; data = brief;
    }
    const r = await askAI(env, q, data, [], aiFetch, { system: sys, label: b.mode === "refine" ? "CURRENT SURVEY" : "BRIEF", json: true, maxTokens: max });
    if (!r.ok) return J(502, { ok: false, error: r.error || "AI didn't answer — try again." });
    const j = parse(r.text); if (!j || !Array.isArray(j.sections)) return J(502, { ok: false, error: "The AI answer wasn't readable — try again." });
    return J(200, { ok: true, survey: cleanSurvey(j) });
  }
  return J(400, { ok: false, error: "Unknown action" });
}
