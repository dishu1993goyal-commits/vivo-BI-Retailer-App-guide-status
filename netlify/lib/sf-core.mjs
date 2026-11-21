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
  const rg = s.regional && typeof s.regional === "object" ? s.regional : {}, map = {};
  if (rg.map && typeof rg.map === "object") Object.keys(rg.map).slice(0, 60).forEach((k) => { const v = str(rg.map[k], 8); if (LANGS[v]) map[str(k, 60)] = v; });
  return {
    regional: { on: !!rg.on, stateQ: str(rg.stateQ, 20), map },
    title: str(s.title, 140) || "Survey", description: txt(s.description, 2000), confirmation: txt(s.confirmation, 500) || "Thank you — your response has been recorded.",
    settings: { collectEmail: !!st.collectEmail, limitOne: !!st.limitOne, editAfter: !!st.editAfter, progressBar: st.progressBar !== false, shuffle: !!st.shuffle, requireLogin: !!st.requireLogin },
    sections: secs
  };
}

// ---------- regional languages ----------
export const LANGS = { en: "English", hi: "Hindi (हिंदी)", bn: "Bengali (বাংলা)", ta: "Tamil (தமிழ்)", te: "Telugu (తెలుగు)", kn: "Kannada (ಕನ್ನಡ)", ml: "Malayalam (മലയാളം)", mr: "Marathi (मराठी)", gu: "Gujarati (ગુજરાતી)", pa: "Punjabi (ਪੰਜਾਬੀ)", or: "Odia (ଓଡ଼ିଆ)", as: "Assamese (অসমীয়া)", ur: "Urdu (اردو)", kok: "Konkani (कोंकणी)", ne: "Nepali (नेपाली)" };
const SL = [[/andhra|telangana/i, "te"], [/arunachal|meghalaya|mizoram|nagaland|manipur|north ?east|\bne\b|ladakh|bhutan|lakshadweep/i, "en"], [/assam/i, "as"], [/bihar|chhattisgarh|delhi|haryana|himachal|jharkhand|madhya|rajasthan|uttar|chandigarh|andaman|\bup\b|\bmp\b|dadra|daman/i, "hi"], [/goa/i, "kok"], [/gujarat/i, "gu"], [/jammu|kashmir|j ?& ?k/i, "ur"], [/karnataka/i, "kn"], [/kerala/i, "ml"], [/maharashtra|mumbai/i, "mr"], [/odisha|orissa/i, "or"], [/punjab/i, "pa"], [/tamil|puducherry|pondicherry|chennai/i, "ta"], [/bengal|tripura|kolkata/i, "bn"], [/sikkim/i, "ne"]];
export const defaultLang = (state) => { for (const [re, l] of SL) if (re.test(state)) return l; return "en"; };
export const ALL_STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu & Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman & Nicobar", "Chandigarh", "Dadra Nagar Haveli & Daman Diu", "Lakshadweep", "Puducherry"];
const stateQOf = (s) => { const r = s.regional || {}; const q = (s.sections[0] || { questions: [] }).questions.filter((x) => x.id === r.stateQ && (x.type === "dropdown" || x.type === "single"))[0]; return q || null; };
export function langsNeeded(s) { const q = stateQOf(s); if (!q) return []; const m = (s.regional || {}).map || {}; return [...new Set(q.options.map((o) => m[o] || defaultLang(o)))].filter((l) => l !== "en"); }
// the text that a translation is made from — if it changes, the translations are out of date
export function baseText(s) { return JSON.stringify([s.sections.map((x) => [x.title, x.description, x.questions.filter((q) => !(s.regional && q.id === s.regional.stateQ)).map((q) => [q.id, q.type, q.title, q.help, q.options, q.rows, q.cols, q.scale && [q.scale.minLabel, q.scale.maxLabel]])]), s.confirmation]); }
const tHash = (s) => { let h = 0; const t = baseText(s); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h); };
function cleanTr(base, j) {   // keep the structure of the base design, only take translated text; anything missing stays in the base language
  const out = { sections: {}, q: {} }; if (!j || typeof j !== "object") return out;
  (Array.isArray(j.sections) ? j.sections : []).forEach((x) => { if (x && x.id) out.sections[str(x.id, 30)] = { title: str(x.title, 200), description: txt(x.description, 800) }; (Array.isArray(x && x.questions) ? x.questions : []).forEach((q) => { if (q && q.id) out.q[str(q.id, 30)] = q; }); });
  const Q = {}; base.sections.forEach((sec) => sec.questions.forEach((q) => { const t = out.q[q.id]; if (!t) return; const o = { title: str(t.title, 400), help: txt(t.help, 600) }; const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x) => str(x, 200)); if (q.options && same(t.options, q.options)) o.options = t.options.map((x) => str(x, 200)); if (q.rows && same(t.rows, q.rows)) o.rows = t.rows.map((x) => str(x, 150)); if (q.cols && same(t.cols, q.cols)) o.cols = t.cols.map((x) => str(x, 80)); if (q.scale && t.scale) o.scale = { minLabel: str(t.scale.minLabel, 60), maxLabel: str(t.scale.maxLabel, 60) }; Q[q.id] = o; }));
  return { sections: out.sections, q: Q, confirmation: txt(j.confirmation, 600) };
}
// one opening section with the State question, then one copy of the survey per language; answers jump to their state's copy
export function expandRegional(s, tr) {
  const sq = stateQOf(s); if (!sq) throw new Error("Choose the State question first (it must be in the first section).");
  const m = s.regional.map || {}, langOf = (o) => m[o] || defaultLang(o), langs = [...new Set(sq.options.map(langOf))];
  const head = { id: "s0rg", title: s.sections[0].title, description: s.sections[0].description, next: "", questions: [Object.assign({}, sq, { required: true, help: (sq.help ? sq.help + " · " : "") + "The form continues in your state's language.", goTo: {} })] };
  const sections = [head], map = [{ base: sq.id, lang: "" }], firstOf = {};
  const body = s.sections.map((sec, i) => Object.assign({}, sec, { questions: i === 0 ? sec.questions.filter((q) => q.id !== sq.id) : sec.questions })).filter((sec) => sec.questions.length || sec.description);
  if (!body.length) throw new Error("Add some questions after the State question.");
  const ids = body.map((x) => x.id);
  langs.forEach((L) => {
    const T = L === "en" ? null : tr[L], suf = "__" + L, tgt = (v) => (v === "SUBMIT" ? "SUBMIT" : ids.includes(v) ? v + suf : "");
    body.forEach((sec, i) => {
      const ts = T && T.sections[sec.id] || {}, last = i === body.length - 1;
      const qs = sec.questions.map((q) => {
        const tq = T && T.q[q.id] || {}, n = JSON.parse(JSON.stringify(q)); n.id = q.id + suf;
        if (tq.title) n.title = tq.title; if (tq.help) n.help = tq.help; if (tq.options) n.options = tq.options; if (tq.rows) n.rows = tq.rows; if (tq.cols) n.cols = tq.cols; if (tq.scale && n.scale) { n.scale.minLabel = tq.scale.minLabel || n.scale.minLabel; n.scale.maxLabel = tq.scale.maxLabel || n.scale.maxLabel; }
        if (q.goTo) { n.goTo = {}; Object.keys(q.goTo).forEach((o) => { const k = q.options.indexOf(o), t = tgt(q.goTo[o]); if (k >= 0 && t) n.goTo[n.options[k]] = t; }); }
        if (q.type !== "info") map.push({ base: q.id, lang: L, opts: n.options || null, bopts: q.options || null });
        return n;
      });
      sections.push({ id: sec.id + suf, title: ts.title || sec.title, description: ts.description || sec.description, next: sec.next ? tgt(sec.next) : last ? "SUBMIT" : "", questions: qs });
      if (i === 0) firstOf[L] = sec.id + suf;
    });
    if (body[body.length - 1] && !sections[sections.length - 1].next) sections[sections.length - 1].next = "SUBMIT";
  });
  // the last block's final section submits by itself; every block's last section was set to SUBMIT above
  sq.options.forEach((o) => { head.questions[0].goTo[o] = firstOf[langOf(o)]; });
  if (sq.other) head.questions[0].other = false;
  return { survey: Object.assign({}, s, { sections, regional: undefined }), map, langs };
}
// responses: one column per real question, answers in the base language
export function mergeRows(map, base, head, rows) {
  const order = [], seen = {}; base.sections.forEach((sec) => sec.questions.forEach((q) => { if (q.type !== "info" && !seen[q.id]) { seen[q.id] = 1; order.push(q); } }));
  const H = [head[0], head[1], "Language"].concat(order.map((q) => q.title));
  const R = rows.map((r) => {
    const v = {}, lang = { L: "" };
    map.forEach((m, i) => { const x = r[2 + i]; if (x === "" || x == null || v[m.base] != null) return; let y = x;
      if (m.opts && m.bopts) { const one = (a) => { const k = m.opts.indexOf(a); return k >= 0 ? m.bopts[k] : a; }; y = m.opts.indexOf(x) >= 0 ? one(x) : String(x).split(", ").map(one).join(", "); }
      v[m.base] = y; if (m.lang) lang.L = m.lang; });
    return [r[0], r[1], LANGS[lang.L] ? LANGS[lang.L].split(" (")[0] : ""].concat(order.map((q) => v[q.id] == null ? "" : v[q.id]));
  });
  return { head: H, rows: R };
}
async function translateOne(base, L, env, aiFetch, askAI) {
  const slim = { sections: base.sections.map((x) => ({ id: x.id, title: x.title, description: x.description, questions: x.questions.filter((q) => !(base.regional && q.id === base.regional.stateQ)).map((q) => { const o = { id: q.id, title: q.title }; if (q.help) o.help = q.help; if (q.options) o.options = q.options; if (q.rows) o.rows = q.rows; if (q.cols) o.cols = q.cols; if (q.scale && (q.scale.minLabel || q.scale.maxLabel)) o.scale = { minLabel: q.scale.minLabel, maxLabel: q.scale.maxLabel }; return o; }) })), confirmation: base.confirmation };
  const sys = "You translate survey forms for vivo India (smartphones) into " + LANGS[L] + " for retailers, promoters and customers. Use simple, everyday " + LANGS[L].split(" (")[0] + " in its native script — the way people in that state speak, not formal or literary. Keep brand, model and product names (vivo, V60, Y300, EMI, ABB, V-Shield), numbers and units unchanged. Translate every title, description, help text, option, row, column and scale label. Return EXACTLY the same JSON structure with the same ids and the same number of options / rows / columns in the same order. Reply with JSON only.";
  const r = await askAI(env, "Translate this survey now.", JSON.stringify(slim).slice(0, 15000), [], aiFetch, { system: sys, label: "SURVEY (JSON)", json: true, maxTokens: 8000 });
  if (!r.ok) throw new Error(r.error || "AI didn't answer");
  const j = parse(r.text); if (!j || !Array.isArray(j.sections)) throw new Error("The translation came back unreadable");
  return cleanTr(base, j);
}
// background work (translate many languages / build a big form) — runs in sfjob-background, or inline when that is not available
export async function runSfJob(store, env, id, f, askAI) {
  const job = await store.get("sf:job:" + id); if (!job || job.state !== "queued") return;
  job.state = "run"; job.at2 = Date.now(); await store.set("sf:job:" + id, job);
  const x = await store.get("sf:s:" + job.sid);
  try {
    if (!x) throw new Error("Survey not found");
    if (job.kind === "translate") {
      x.tr = x.tr || {}; const base = cleanSurvey(x.survey), h = tHash(base);
      for (let i = 0; i < job.langs.length; i++) {
        const L = job.langs[i]; job.msg = "Translating to " + LANGS[L].split(" (")[0] + " (" + (i + 1) + " of " + job.langs.length + ")…"; await store.set("sf:job:" + id, job);
        let tr = null, err = "";
        for (let a = 0; a < 2 && !tr; a++) { try { tr = await translateOne(base, L, env, f, askAI); } catch (e) { err = String(e.message || e); } }
        if (tr) { const cur = (await store.get("sf:s:" + job.sid)) || x; cur.tr = cur.tr || {}; cur.tr[L] = Object.assign(tr, { h, at: Date.now() }); await store.set("sf:s:" + job.sid, cur); job.done = (job.done || []).concat([L]); }
        else job.fail = (job.fail || []).concat([L + ": " + err.slice(0, 120)]);
      }
      job.state = "done"; job.msg = job.fail && job.fail.length ? "Some languages failed — try again" : "All languages ready";
    } else if (job.kind === "create") {
      const cfg = (await store.get("sf:cfg")) || {}, s = cleanSurvey(x.survey); let send = s, map = null;
      if (s.regional.on) { const need = langsNeeded(s), h = tHash(s), miss = need.filter((L) => !(x.tr && x.tr[L] && x.tr[L].h === h)); if (miss.length) throw new Error("Translate first — missing or out of date: " + miss.map((L) => LANGS[L].split(" (")[0]).join(", ")); const e = expandRegional(s, x.tr || {}); send = e.survey; map = e.map; }
      job.msg = "Creating the Google Form" + (map ? " in " + (new Set(map.map((m) => m.lang).filter(Boolean))).size + " languages" : "") + "…"; await store.set("sf:job:" + id, job);
      const r = await gas(cfg, { action: "create", survey: send, opts: { sheet: !!job.sheet } }, f);
      if (!r.ok) throw new Error(r.error || "Couldn't create the form");
      const cur = (await store.get("sf:s:" + job.sid)) || x;
      cur.form = { platform: "google", id: str(r.id, 120), url: str(r.url, 400), shortUrl: str(r.shortUrl, 200), editUrl: str(r.editUrl, 400), sheetUrl: str(r.sheetUrl, 400), at: Date.now(), by: job.by, warn: (r.warn || []).slice(0, 20).map((w) => str(w, 300)).concat(map ? ["The Google Sheet (if any) has one column per language for each question — use 📊 Responses here for one merged column per question, in English."] : []), map, base: map ? s : null };
      cur.upd = Date.now(); await store.set("sf:s:" + job.sid, cur);
      job.state = "done"; job.msg = "Form is live"; job.form = cur.form;
    }
  } catch (e) { job.state = "err"; job.msg = String(e.message || e).slice(0, 300); }
  job.end = Date.now(); await store.set("sf:job:" + id, job);
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

export async function gas(cfg, body, f) {
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
  if (b.action === "sf-one") { const x = await store.get("sf:s:" + str(b.id, 20)); if (!x) return J(404, { ok: false, error: "Not found" }); const sv = cleanSurvey(x.survey), h = tHash(sv), trs = {}; Object.keys(x.tr || {}).forEach((L) => { trs[L] = { fresh: x.tr[L].h === h, at: x.tr[L].at }; }); return J(200, { ok: true, s: Object.assign({}, x, { form: x.form ? Object.assign({}, x.form, { map: undefined, base: undefined, regional: !!x.form.map }) : null }), trs, need: sv.regional.on ? langsNeeded(sv) : [] }); }
  if (b.action === "sf-langs") return J(200, { ok: true, langs: LANGS, states: ALL_STATES, defaults: Object.fromEntries(ALL_STATES.map((st) => [st, defaultLang(st)])) });
  if (b.action === "sf-tr") { const x = await store.get("sf:s:" + str(b.id, 20)); const L = str(b.lang, 8); if (!x || !x.tr || !x.tr[L]) return J(404, { ok: false, error: "Not translated yet" }); try { const s1 = cleanSurvey(x.survey); const e = expandRegional(Object.assign({}, s1, { regional: Object.assign({}, s1.regional, { map: Object.fromEntries(((stateQOf(s1) || { options: [] }).options).map((o) => [o, L])) }) }), x.tr); return J(200, { ok: true, survey: Object.assign({}, e.survey, { sections: e.survey.sections.slice(1) }) }); } catch (er) { return J(400, { ok: false, error: String(er.message || er) }); } }
  if (b.action === "sf-job") { const j = await store.get("sf:job:" + str(b.job, 30)); if (!j) return J(404, { ok: false, error: "Job not found" }); if (j.state === "queued" && Date.now() - j.at > 20000) { await runSfJob(store, env, j.id, f, askAI); return J(200, { ok: true, job: await store.get("sf:job:" + j.id) }); } return J(200, { ok: true, job: { state: j.state, msg: j.msg, done: j.done || [], fail: j.fail || [], form: j.form ? Object.assign({}, j.form, { map: undefined, base: undefined }) : null } }); }
  if (b.action === "sf-translate" || (b.action === "sf-create" && b.platform !== "sm")) {
    const x = await store.get("sf:s:" + str(b.id, 20)); if (!x) return J(404, { ok: false, error: "Save the survey first" });
    const sv = cleanSurvey(x.survey);
    if (b.action === "sf-translate") { if (!askAI) return J(400, { ok: false, error: "AI is not set up yet." }); if (!sv.regional.on || !stateQOf(sv)) return J(400, { ok: false, error: "Switch on regional languages and choose the State question first" }); }
    else { if (!sv.sections.some((sec) => sec.questions.some((q) => q.type !== "info"))) return J(400, { ok: false, error: "Add at least one question" }); if (!cfg.gasUrl || !cfg.gasKey) return J(400, { ok: false, error: "Google Forms is not connected yet — HO: open Set-up." }); }
    let langs = [];
    if (b.action === "sf-translate") { const h = tHash(sv); langs = langsNeeded(sv).filter((L) => b.all || !(x.tr && x.tr[L] && x.tr[L].h === h)); if (!langs.length) return J(200, { ok: true, nothing: true }); }
    const jid = t.toString(36) + randomBytes(3).toString("hex");
    await store.set("sf:job:" + jid, { id: jid, kind: b.action === "sf-translate" ? "translate" : "create", sid: x.id, langs, sheet: !!b.sheet, by, state: "queued", at: t, msg: "Starting…" });
    const site = env.SITE_URL || env.URL;
    if (site && ctx.jobFetch) { try { await ctx.jobFetch(site + "/.netlify/functions/sfjob-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: jid }) }); } catch (e) { await runSfJob(store, env, jid, f, askAI); } }
    else await runSfJob(store, env, jid, f, askAI);
    return J(200, { ok: true, job: jid });
  }
  if (b.action === "sf-save") {
    const id = str(b.id, 20) || nid(t), old = await store.get("sf:s:" + id), sv = cleanSurvey(b.survey);
    const x = { id, title: sv.title, survey: sv, brief: old ? old.brief : txt(b.brief, 3000), by: old ? old.by : by, at: old ? old.at : t, upd: t, form: old ? old.form : null };
    x.tr = old ? old.tr : undefined;
    await store.set("sf:s:" + id, x);
    const h = tHash(sv), trs = {}; Object.keys(x.tr || {}).forEach((L) => { trs[L] = { fresh: x.tr[L].h === h, at: x.tr[L].at }; });
    return J(200, { ok: true, id, survey: sv, trs, need: sv.regional.on ? langsNeeded(sv) : [] });
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
    if (s.regional.on && b.platform === "sm") r.warn = (r.warn || []).concat(["SurveyMonkey: regional languages are not applied — the survey is in the base language only."]);
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
    if (b.action !== "sf-results") return J(200, { ok: true, closed: x.form.closed });
    let head = (r.head || []).slice(0, 2000), rows = (r.rows || []).slice(0, 3000);
    if (x.form.map && x.form.base) { const m = mergeRows(x.form.map, x.form.base, head, rows); head = m.head; rows = m.rows; }
    return J(200, { ok: true, count: r.count, closed: x.form.closed, head, rows, merged: !!x.form.map });
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
