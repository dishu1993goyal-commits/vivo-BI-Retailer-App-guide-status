// Survey management: admins build and publish surveys, state users answer them.
// Storage (Netlify Blobs):
//   survey:<id>             survey definition + counters
//   resp:<id>:<userKey>     one response per state user (editable while the survey is open, if allowed)
//   survopen:<app>:<userKey> { <surveyId>: lastOpenedAt }  (drives "new survey" notifications)
import { randomBytes } from "node:crypto";

export const Q_TYPES = ["short", "long", "single", "multi", "dropdown", "yesno", "rating", "scale", "nps",
  "number", "date", "email", "phone", "file", "section"];
export const CATEGORIES = ["Feedback", "Data collection", "Training", "Poll", "Audit / checklist", "Other"];
const CHOICE = ["single", "multi", "dropdown", "yesno"];
const MAX_Q = 60, MAX_OPT = 50, MAX_FILES = 5;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const idOk = (v) => /^[a-z0-9]{2,20}$/i.test(String(v || ""));
const cleanId = (v) => String(v || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);
const sKey = (id) => `survey:${cleanId(id)}`;
const rPrefix = (id) => `resp:${cleanId(id)}:`;

// Effective status: a live survey past its deadline is closed.
export function statusOf(s, t) { return s.status === "live" && s.closesAt && t > s.closesAt ? "closed" : s.status; }
const forState = (s, state) => !s.audience || !s.audience.length || (state && s.audience.includes(state));

// Cleans a survey coming from the builder. Returns { survey } or { error }.
export function sanitizeSurvey(inp, old) {
  const s = inp || {};
  const title = str(s.title, 120);
  if (title.length < 3) return { error: "Give the survey a title (at least 3 characters)." };
  const qsIn = Array.isArray(s.questions) ? s.questions.slice(0, MAX_Q) : [];
  const seen = new Set(), questions = [];
  for (const q of qsIn) {
    if (!q || !Q_TYPES.includes(q.type)) continue;
    let id = idOk(q.id) && !seen.has(q.id) ? String(q.id) : "q" + randomBytes(4).toString("hex");
    seen.add(id);
    const o = { id, type: q.type, title: str(q.title, 300), help: str(q.help, 400), required: q.type !== "section" && q.required === true };
    if (q.type !== "section" && !o.title) return { error: `Question ${questions.length + 1} needs a question text.` };
    if (q.type === "single" || q.type === "multi" || q.type === "dropdown") {
      const opts = [];
      (Array.isArray(q.options) ? q.options : []).forEach((x) => { const v = str(x, 120); if (v && !opts.includes(v) && opts.length < MAX_OPT) opts.push(v); });
      if (opts.length < 2) return { error: `"${o.title.slice(0, 40)}" needs at least 2 options.` };
      o.options = opts;
      o.other = q.other === true && q.type !== "dropdown";
      if (q.type === "multi") {
        const mn = Math.max(0, Math.min(opts.length, parseInt(q.minSel, 10) || 0));
        const mx = Math.max(0, Math.min(opts.length + (o.other ? 1 : 0), parseInt(q.maxSel, 10) || 0));
        if (mn) o.minSel = mn; if (mx && mx >= mn) o.maxSel = mx;
      }
      if (q.shuffle === true) o.shuffle = true;
    }
    if (q.type === "yesno") o.options = ["Yes", "No"];
    if (q.type === "scale") {
      o.min = parseInt(q.min, 10) === 0 ? 0 : 1;
      o.max = Math.max(o.min + 2, Math.min(10, parseInt(q.max, 10) || 5));
      o.lo = str(q.lo, 40); o.hi = str(q.hi, 40);
    }
    if (q.type === "nps") { o.lo = str(q.lo, 40) || "Not likely"; o.hi = str(q.hi, 40) || "Very likely"; }
    if (q.type === "number") {
      if (q.min !== "" && q.min != null && isFinite(+q.min)) o.min = +q.min;
      if (q.max !== "" && q.max != null && isFinite(+q.max)) o.max = +q.max;
      if (o.min != null && o.max != null && o.max < o.min) return { error: `"${o.title.slice(0, 40)}": maximum is below minimum.` };
      o.unit = str(q.unit, 20);
      o.integer = q.integer === true;
    }
    if (q.type === "short" || q.type === "long") o.placeholder = str(q.placeholder, 80);
    if (q.type === "file") o.maxFiles = Math.max(1, Math.min(MAX_FILES, parseInt(q.maxFiles, 10) || 1));
    // Skip logic: show this question only when an earlier choice question has one of these answers.
    if (q.showIf && q.showIf.q && Array.isArray(q.showIf.any)) {
      const parent = questions.find((p) => p.id === q.showIf.q);
      if (parent && parent.options) {
        const any = q.showIf.any.map((v) => str(v, 120)).filter((v) => parent.options.includes(v));
        if (any.length) o.showIf = { q: parent.id, any };
      }
    }
    questions.push(o);
  }
  if (!questions.some((q) => q.type !== "section")) return { error: "Add at least one question." };
  const audience = [];
  (Array.isArray(s.audience) ? s.audience : []).forEach((x) => { const v = str(x, 40); if (v && !audience.includes(v) && audience.length < 80) audience.push(v); });
  const closesAt = Number(s.closesAt) > 0 ? Math.floor(Number(s.closesAt)) : 0;
  return {
    survey: Object.assign({}, old || {}, {
      title, description: str(s.description, 1500), category: CATEGORIES.includes(s.category) ? s.category : "Feedback",
      questions, audience, closesAt,
      anonymous: s.anonymous === true, allowEdit: s.allowEdit !== false,
      thankYou: str(s.thankYou, 300), color: /^#[0-9a-f]{6}$/i.test(String(s.color || "")) ? s.color : "#4D5BF9",
    }),
  };
}

// Which questions are shown for a set of answers (skip logic).
export function visibleIds(survey, answers) {
  const vis = new Set();
  for (const q of survey.questions) {
    if (q.showIf) {
      if (!vis.has(q.showIf.q)) continue;
      const a = answers[q.showIf.q];
      const vals = Array.isArray(a) ? a : a == null ? [] : [a];
      if (!vals.some((v) => q.showIf.any.includes(v))) continue;
    }
    vis.add(q.id);
  }
  return vis;
}

const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

// Validates answers. Returns { answers } or { error, q }.
export async function cleanAnswers(survey, raw, attLookup) {
  const inp = raw && typeof raw === "object" ? raw : {};
  const out = {};
  // First pass on choice answers so skip logic can be evaluated.
  const pre = {};
  for (const q of survey.questions) if (CHOICE.includes(q.type)) pre[q.id] = inp[q.id];
  const vis = visibleIds(survey, pre);
  for (const q of survey.questions) {
    if (q.type === "section" || !vis.has(q.id)) continue;
    let v = inp[q.id];
    const bad = (m) => ({ error: `${q.title.slice(0, 60)}: ${m}`, q: q.id });
    if (empty(v)) { if (q.required) return { error: `Please answer: ${q.title.slice(0, 80)}`, q: q.id }; continue; }
    switch (q.type) {
      case "short": v = str(v, 500); break;
      case "long": v = str(v, 5000); break;
      case "email": v = str(v, 80).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return bad("enter a valid email."); break;
      case "phone": { const d = String(v).replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""); if (!/^[6-9]\d{9}$/.test(d)) return bad("enter a valid 10-digit mobile number."); v = d; break; }
      case "date": v = str(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return bad("choose a date."); break;
      case "number": {
        const n = Number(String(v).replace(/,/g, ""));
        if (!isFinite(n)) return bad("enter a number.");
        if (q.integer && !Number.isInteger(n)) return bad("enter a whole number.");
        if (q.min != null && n < q.min) return bad(`must be at least ${q.min}.`);
        if (q.max != null && n > q.max) return bad(`must be at most ${q.max}.`);
        v = n; break;
      }
      case "rating": { const n = Math.round(Number(v)); if (!(n >= 1 && n <= 5)) return bad("choose 1 to 5 stars."); v = n; break; }
      case "nps": { const n = Math.round(Number(v)); if (!(n >= 0 && n <= 10)) return bad("choose 0 to 10."); v = n; break; }
      case "scale": { const n = Math.round(Number(v)); if (!(n >= q.min && n <= q.max)) return bad(`choose ${q.min} to ${q.max}.`); v = n; break; }
      case "yesno": case "dropdown": case "single": {
        v = str(v, 200);
        if (!q.options.includes(v)) { if (!q.other) return bad("choose one of the options."); v = "Other: " + v.replace(/^Other:\s*/i, "").slice(0, 190); }
        break;
      }
      case "multi": {
        const arr = (Array.isArray(v) ? v : [v]).map((x) => str(x, 200)).filter(Boolean);
        const res = [];
        for (const x of arr) {
          if (q.options.includes(x)) { if (!res.includes(x)) res.push(x); }
          else if (q.other && !res.some((y) => y.startsWith("Other: "))) res.push("Other: " + x.replace(/^Other:\s*/i, "").slice(0, 190));
          else return bad("choose from the options.");
        }
        if (q.minSel && res.length < q.minSel) return bad(`choose at least ${q.minSel}.`);
        if (q.maxSel && res.length > q.maxSel) return bad(`choose at most ${q.maxSel}.`);
        if (!res.length) { if (q.required) return { error: `Please answer: ${q.title.slice(0, 80)}`, q: q.id }; continue; }
        v = res; break;
      }
      case "file": {
        const ids = (Array.isArray(v) ? v : [v]).slice(0, q.maxFiles || 1);
        const atts = [];
        for (const x of ids) { const a = await attLookup(typeof x === "object" && x ? x.id : x); if (a) atts.push(a); }
        if (!atts.length) { if (q.required) return { error: `Please attach a file: ${q.title.slice(0, 80)}`, q: q.id }; continue; }
        v = atts; break;
      }
    }
    out[q.id] = v;
  }
  return { answers: out };
}

// ---------- Actions ----------
// ctx: { store, t, app, rec, key, who, sameUser, userKey, pool, logEvent, askAI, env, aiFetch, b }
export async function surveyAction(b, ctx) {
  const { store, t, app, rec, key, pool } = ctx;
  const me = ctx.who(app, rec);
  const isAdmin = app === "admin";
  const openKey = `survopen:${app}:${key}`;

  const listSurveys = async () => {
    const ks = store.list ? await store.list("survey:") : [];
    return (await pool(ks, 30, (k) => store.get(k))).filter(Boolean).sort((a, c) => (c.publishedAt || c.updatedAt) - (a.publishedAt || a.updatedAt));
  };
  const stateUsers = async () => {
    const ks = store.list ? await store.list("user:state:") : [];
    return (await pool(ks, 40, (k) => store.get(k))).filter((u) => u && !u.disabled);
  };
  const targetsOf = (s, users) => users.filter((u) => forState(s, u.state));
  const summary = (s) => ({
    id: s.id, title: s.title, description: s.description, category: s.category, status: statusOf(s, t), rawStatus: s.status,
    audience: s.audience, closesAt: s.closesAt, anonymous: s.anonymous, allowEdit: s.allowEdit, color: s.color,
    questions: s.questions.filter((q) => q.type !== "section").length, createdAt: s.createdAt, updatedAt: s.updatedAt,
    publishedAt: s.publishedAt || 0, remindedAt: s.remindedAt || 0, createdBy: s.createdBy, count: s.count || 0, lastRespAt: s.lastRespAt || 0,
  });
  // A state user should be told about a survey when it was published or re-announced after they last opened it.
  const announcedAt = (s) => Math.max(s.publishedAt || 0, s.remindedAt || 0);

  if (b.action === "survey-list" || b.action === "survey-notify") {
    const all = await listSurveys();
    const opened = (await store.get(openKey)) || {};
    if (isAdmin) {
      const users = await stateUsers();
      const list = all.map((s) => Object.assign(summary(s), { targets: targetsOf(s, users).length, unseen: (s.lastRespAt || 0) > (opened[s.id] || 0) && (s.count || 0) > 0 }));
      if (b.action === "survey-notify") {
        return { newResponses: list.filter((s) => s.unseen).length, live: list.filter((s) => s.status === "live").length };
      }
      return json(200, { ok: true, surveys: list, categories: CATEGORIES, types: Q_TYPES });
    }
    const mine = all.filter((s) => s.status !== "draft" && s.publishedAt && forState(s, rec.state));
    const out = await pool(mine, 20, async (s) => {
      const r = await store.get(rPrefix(s.id) + key);
      return Object.assign(summary(s), { responded: !!r, submittedAt: r ? r.submittedAt : 0, updatedRespAt: r ? r.updatedAt : 0,
        isNew: !r && announcedAt(s) > (opened[s.id] || 0) });
    });
    // Hide long-closed surveys the user never answered (older than 60 days).
    const vis = out.filter((s) => s.status === "live" || s.responded || t - (s.closesAt || s.updatedAt) < 60 * 86400000);
    if (b.action === "survey-notify") {
      const pend = vis.filter((s) => s.status === "live" && !s.responded);
      return { pending: pend.length, newCount: pend.filter((s) => s.isNew).length,
        surveys: pend.map((s) => ({ id: s.id, title: s.title, closesAt: s.closesAt, isNew: s.isNew, announcedAt: Math.max(s.publishedAt, s.remindedAt) })) };
    }
    return json(200, { ok: true, surveys: vis });
  }

  if (b.action === "survey-save") {
    if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can create surveys." });
    const old = b.survey && b.survey.id ? await store.get(sKey(b.survey.id)) : null;
    const r = sanitizeSurvey(b.survey, old);
    if (r.error) return json(400, { ok: false, error: r.error });
    const s = r.survey;
    if (!old) Object.assign(s, { id: t.toString(36) + randomBytes(3).toString("hex"), status: "draft", createdAt: t, createdBy: rec.username, count: 0 });
    s.updatedAt = t; s.updatedBy = rec.username;
    if (b.publish === true && s.status !== "live") {
      s.status = "live"; if (!s.publishedAt) s.publishedAt = t; else s.remindedAt = t;
    }
    if (s.closesAt && s.closesAt < t && b.publish === true) return json(400, { ok: false, error: "The closing date is in the past." });
    await store.set(sKey(s.id), s);
    if (b.publish === true) await ctx.logEvent(store, t, app, rec, "survey-published", { device: s.title.slice(0, 60), ver: "" });
    return json(200, { ok: true, survey: s });
  }

  const s = b.id ? await store.get(sKey(b.id)) : null;
  if (!s) return json(404, { ok: false, error: "Survey not found." });
  if (!isAdmin && (s.status === "draft" || !s.publishedAt || !forState(s, rec.state))) return json(404, { ok: false, error: "Survey not found." });

  if (b.action === "survey-get") {
    const opened = (await store.get(openKey)) || {};
    opened[s.id] = t; await store.set(openKey, opened);
    const mine = isAdmin ? null : await store.get(rPrefix(s.id) + key);
    return json(200, { ok: true, survey: Object.assign({}, s, { status: statusOf(s, t) }), response: mine });
  }

  if (b.action === "survey-respond") {
    if (isAdmin) return json(403, { ok: false, error: "Surveys are answered by state users." });
    if (statusOf(s, t) !== "live") return json(400, { ok: false, error: "This survey is closed." });
    const rk = rPrefix(s.id) + key;
    const old = await store.get(rk);
    if (old && !s.allowEdit) return json(409, { ok: false, error: "You have already answered this survey." });
    const lookup = async (id) => {
      const a = await store.get(`att:${cleanId(id)}`);
      return a && ctx.sameUser(a.by, me) ? { id: a.id, name: a.name, mime: a.mime, size: a.size } : null;
    };
    const r = await cleanAnswers(s, b.answers, lookup);
    if (r.error) return json(400, { ok: false, error: r.error, q: r.q });
    const startedAt = Number(b.startedAt) > 0 && Number(b.startedAt) <= t ? Number(b.startedAt) : 0;
    const resp = { sid: s.id, by: Object.assign({}, me, { phone: rec.phone || "", designation: rec.designation || "" }), answers: r.answers,
      submittedAt: old ? old.submittedAt : t, updatedAt: t, edits: old ? (old.edits || 0) + 1 : 0,
      dur: old ? old.dur : startedAt ? Math.min(t - startedAt, 6 * 3600000) : 0, device: str(b.device, 60), via: str(b.via, 10) };
    await store.set(rk, resp);
    // Re-read before bumping the counter to keep it close under concurrent submits.
    const fresh = (await store.get(sKey(s.id))) || s;
    if (!old) fresh.count = (fresh.count || 0) + 1;
    fresh.lastRespAt = t;
    await store.set(sKey(s.id), fresh);
    if (!old) await ctx.logEvent(store, t, app, rec, "survey-response", { device: s.title.slice(0, 60), ver: "" });
    return json(200, { ok: true, response: resp, thankYou: s.thankYou || "" });
  }

  // ---------- Admin only from here ----------
  if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can do this." });

  if (b.action === "survey-status") {
    const want = b.status;
    if (want === "delete") {
      const ks = await store.list(rPrefix(s.id));
      await pool(ks, 30, (k) => store.delete(k));
      await store.delete(sKey(s.id));
      return json(200, { ok: true, deleted: true });
    }
    if (want === "closed") { s.status = "closed"; s.closedAt = t; if (s.closesAt && s.closesAt > t) s.closesAt = 0; }
    else if (want === "live") {
      if (s.closesAt && s.closesAt < t) { const extra = Number(b.closesAt) > t ? Number(b.closesAt) : 0; s.closesAt = extra; }
      if (!s.publishedAt) s.publishedAt = t; s.status = "live";
    } else return json(400, { ok: false, error: "Unknown status." });
    s.updatedAt = t;
    await store.set(sKey(s.id), s);
    return json(200, { ok: true, survey: s });
  }

  if (b.action === "survey-remind") {
    if (statusOf(s, t) !== "live") return json(400, { ok: false, error: "Only a live survey can be re-announced." });
    s.remindedAt = t; s.reminders = (s.reminders || 0) + 1;
    await store.set(sKey(s.id), s);
    return json(200, { ok: true, survey: s });
  }

  if (b.action === "survey-results") {
    const ks = await store.list(rPrefix(s.id));
    let responses = (await pool(ks, 40, (k) => store.get(k))).filter(Boolean).sort((a, c) => a.submittedAt - c.submittedAt);
    const users = await stateUsers();
    const answered = new Set(responses.map((r) => ctx.userKey(r.by.username)));
    const targets = targetsOf(s, users).map((u) => ({ username: s.anonymous ? "" : u.username, fullName: s.anonymous ? "" : u.fullName,
      phone: s.anonymous ? "" : u.phone, state: u.state || "", responded: answered.has(ctx.userKey(u.username)), lastSeen: u.lastSeen || 0 }));
    if (s.anonymous) responses = responses.map((r) => Object.assign({}, r, { by: { app: "state", state: r.by.state, username: "", fullName: "Anonymous" } }));
    const opened = (await store.get(openKey)) || {};
    opened[s.id] = t; await store.set(openKey, opened);
    return json(200, { ok: true, survey: Object.assign({}, s, { status: statusOf(s, t) }), responses, targets });
  }

  if (b.action === "survey-ai") {
    if (!ctx.env.GEMINI_API_KEY) return json(400, { ok: false, error: "AI is not set up yet." });
    const ck = `ai:${new Date(t + 19800000).toISOString().slice(0, 10)}:${app}:${key}`;
    const used = ((await store.get(ck)) || { n: 0 }).n;
    if (used >= 40) return json(429, { ok: false, error: "Daily AI limit reached." });
    const sys = `You are a survey analyst for vivo India's Business Innovation (BI) team. State BI teams answered an internal survey.
Write a crisp analysis for the HO admin in plain text (no markdown tables), under 220 words:
1) "Key findings:" 3-5 bullets ("- ") quoting exact numbers/percentages from the data.
2) "Concerns:" 1-3 bullets (low scores, states lagging, repeated complaints in text answers).
3) "Recommended actions:" 2-4 specific bullets.
Use only the SURVEY DATA. Do not add disclaimers or notes. Reply in Hindi only if the question is in Hindi.`;
    const r = await ctx.askAI(ctx.env, String(b.question || "Summarise the results and what we should do next.").slice(0, 400),
      String(b.context || "").slice(0, 14000), [], ctx.aiFetch, { system: sys, label: "SURVEY DATA" });
    if (r.ok) await store.set(ck, { n: used + 1 });
    return json(r.ok ? 200 : 502, r);
  }

  return json(400, { ok: false, error: "Unknown action" });
}
