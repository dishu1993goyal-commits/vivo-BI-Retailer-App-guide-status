// BI growth tools (one module, five tools):
//   lh-  Learning Hub        lesson:<id> { id, title, topic, model, video, points[], body, questions[{q,options[],correct,why}], passPct, states[], status, createdAt, by }
//                            attempts are written as qatt:lh<id>:<app:key> — the SAME shape Engage quizzes use, so the leaderboard & rewards count them
//                            lview:<id>:<app:key> { at }  (opened the lesson)
//   ls-  Lost-sale tracker   lost:<day>:<id> { id, d, at, user{}, state, store, model, band, reason, comp, fin, note, follow }
//   lt-  New-launch tracker  launch:<id> { id, model, aliases[], date, states[], plan{state:units}, checklist[{k,label}], status, by, at }
//                            launchst:<id>:<state> { vals{k:{done,total}}, note, by, at }   · sell-out comes from the sell-out data (sales-core)
//   mp-  Promoter planner    mp:<month> { month, rows[{code,name,store,storeCode,state,city,doj,dol,units,value,days}], stores[{storeCode,store,state,units}], by, at }
//   cv-  Customer voice      cvs:<code> { code, store, city, state, by, at }   (one QR per store)
//                            cvr:<day>:<id> { id, d, at, code, store, state, rating, nps, tags[], comment, model, phone, name, callback, status, note, doneBy, doneAt }
//                            cv-p-*  = public (customer, no login): open the store's page / send a rating
import { randomBytes } from "node:crypto";
import { loadSales, nk } from "./sales-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return isFinite(n) ? n : 0; };
const cid = (v) => String(v || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
const newId = (t) => t.toString(36) + randomBytes(3).toString("hex");
const ist = (t) => new Date(t + 19800000).toISOString().slice(0, 10);
const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const okMonth = (s) => /^\d{4}-\d{2}$/.test(String(s || ""));
const r1 = (n) => Math.round(n * 10) / 10;
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const top = (o, n = 12) => Object.keys(o).map((k) => ({ name: k, n: o[k] })).sort((a, b) => b.n - a.n).slice(0, n);
const aiJson = (text) => { try { const m = /\{[\s\S]*\}/.exec(text || ""); return m ? JSON.parse(m[0]) : null; } catch (e) { return null; } };

export const LOST_REASONS = ["Price too high", "Finance / EMI not approved", "Model or colour not in stock", "Chose a competitor", "Wanted a feature we don't have", "Exchange value too low", "Just browsing / will come later", "Offer or scheme not attractive", "Service or brand concern", "Other"];
export const LOST_BANDS = ["Below ₹10k", "₹10k–15k", "₹15k–20k", "₹20k–30k", "₹30k–45k", "Above ₹45k"];
export const DEF_CHECK = [["stock", "Stores with stock placed"], ["display", "Stores with display / branding live"], ["demo", "Stores with a live demo unit"], ["trained", "Promoters trained & certified"], ["scheme", "Stores briefed on launch scheme"]];
export const CV_TAGS = ["Staff was helpful", "Good demo", "Fair price", "Quick billing", "Long wait", "Staff not helpful", "Model not available", "Price / offer issue", "After-sales worry"];

export async function bixAction(b, ctx) {
  const { store, t, app, rec, key, who, pool, env } = ctx, isHO = app === "admin", me = who(app, rec), uid = app + ":" + key, myState = isHO ? "" : str(rec.state, 40), today = ist(t);
  const listAll = async (prefix) => (await pool(await store.list(prefix), 30, (k) => store.get(k))).filter(Boolean);
  const inState = (st) => isHO || !myState || low(st) === low(myState);
  const a = b.action;

  // ============================ 📚 LEARNING HUB ============================
  if (/^lh-/.test(a)) {
    const cleanQ = (L) => (Array.isArray(L) ? L : []).slice(0, 12).map((q) => ({ q: str(q.q, 240), options: (Array.isArray(q.options) ? q.options : []).slice(0, 5).map((o) => str(o, 140)).filter(Boolean), correct: Math.max(0, Math.min(4, Math.round(num(q.correct)))), why: str(q.why, 240) })).filter((q) => q.q && q.options.length >= 2 && q.correct < q.options.length);
    const pub = (l, full) => ({ id: l.id, title: l.title, topic: l.topic, model: l.model, video: l.video, mins: l.mins, points: l.points, body: full ? l.body : undefined, states: l.states, status: l.status, createdAt: l.createdAt, by: l.by, passPct: l.passPct, pts: l.pts, nq: l.questions.length,
      questions: full ? l.questions.map((q) => ({ q: q.q, options: q.options })) : undefined });
    if (a === "lh-list") {
      const L = (await listAll("lesson:")).filter((l) => (isHO || l.status === "live") && (isHO || !l.states.length || l.states.some((s) => low(s) === low(myState))));
      const mine = {}; await pool(L, 20, async (l) => { const at = await store.get(`qatt:lh${l.id}:${uid}`), v = await store.get(`lview:${l.id}:${uid}`); mine[l.id] = { seen: !!v, pct: at ? at.pct : null, passed: !!(at && at.passed), certNo: at ? at.certNo : "" }; });
      return json(200, { ok: true, isHO, me, items: L.sort((x, y) => y.createdAt - x.createdAt).map((l) => Object.assign(pub(l), { mine: mine[l.id] })) });
    }
    if (a === "lh-get") { const l = await store.get(`lesson:${cid(b.id)}`); if (!l || (!isHO && l.status !== "live")) return json(404, { ok: false, error: "Lesson not found." });
      if (!(await store.get(`lview:${l.id}:${uid}`))) await store.set(`lview:${l.id}:${uid}`, { at: t, user: me });
      const at = await store.get(`qatt:lh${l.id}:${uid}`);
      return json(200, { ok: true, lesson: Object.assign(pub(l, true), isHO ? { answers: l.questions.map((q) => ({ correct: q.correct, why: q.why })) } : {}), mine: at ? { pct: at.pct, passed: at.passed, score: at.score, total: at.total, certNo: at.certNo, at: at.at } : null }); }
    if (a === "lh-save") {
      if (!isHO) return json(403, { ok: false, error: "Only HO can add lessons." });
      const x = b.lesson || {}, id = cid(x.id) || newId(t), old = await store.get(`lesson:${id}`);
      const video = str(x.video, 300); if (video && !/^https:\/\//i.test(video)) return json(400, { ok: false, error: "Video link must start with https://" });
      const l = { id, title: str(x.title, 120), topic: ["launch", "app", "dashboard", "selling", "process"].includes(x.topic) ? x.topic : "launch", model: str(x.model, 60), video, mins: Math.max(1, Math.min(30, Math.round(num(x.mins)) || 2)),
        points: (Array.isArray(x.points) ? x.points : String(x.points || "").split("\n")).map((p) => str(p, 200)).filter(Boolean).slice(0, 10), body: txt(x.body, 4000), questions: cleanQ(x.questions), passPct: Math.max(40, Math.min(100, Math.round(num(x.passPct)) || 70)), pts: Math.max(0, Math.min(500, Math.round(num(x.pts)) || 20)),
        states: (Array.isArray(x.states) ? x.states : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 40), status: x.status === "live" ? "live" : "draft", createdAt: old ? old.createdAt : t, updatedAt: t, by: old ? old.by : (me.fullName || me.username) };
      if (!l.title) return json(400, { ok: false, error: "Give the lesson a title." });
      if (l.status === "live" && !l.questions.length) return json(400, { ok: false, error: "Add at least one quiz question before publishing." });
      await store.set(`lesson:${id}`, l); return json(200, { ok: true, id });
    }
    if (a === "lh-delete") { if (!isHO) return json(403, { ok: false, error: "Only HO can delete lessons." }); const id = cid(b.id); for (const k of await store.list(`qatt:lh${id}:`)) await store.delete(k); for (const k of await store.list(`lview:${id}:`)) await store.delete(k); await store.delete(`lesson:${id}`); return json(200, { ok: true }); }
    if (a === "lh-ai") {   // draft key points + quiz from pasted material
      if (!isHO) return json(403, { ok: false, error: "Only HO can add lessons." });
      const src = txt(b.text, 9000), title = str(b.title, 120); if (src.length < 40 && !title) return json(400, { ok: false, error: "Paste the product note / feature text (or at least a title) first." });
      const sys = 'You write 2-minute micro-training for mobile-phone promoters in India. Reply with ONE JSON object only: {"title":"","points":["5-7 short selling points a promoter can say to a customer, plain words"],"questions":[{"q":"","options":["","","",""],"correct":0,"why":"one line"}]}. Exactly 5 questions, 4 options each, "correct" is the 0-based index. Use only facts from the material; never invent specs or prices.';
      const r = await ctx.askAI(env, "Write the lesson.", "TITLE: " + title + "\nMATERIAL:\n" + src, [], ctx.aiFetch, { system: sys, label: "LEARN" });
      if (!r.ok) return json(200, { ok: false, error: r.error });
      const j = aiJson(r.text); if (!j || !Array.isArray(j.questions)) return json(200, { ok: false, error: "AI couldn't draft this — try again with more text." });
      return json(200, { ok: true, draft: { title: str(j.title || title, 120), points: (j.points || []).map((p) => str(p, 200)).filter(Boolean).slice(0, 10), questions: cleanQ(j.questions) } });
    }
    if (a === "lh-submit") {
      const l = await store.get(`lesson:${cid(b.id)}`); if (!l || l.status !== "live") return json(404, { ok: false, error: "Lesson not found." });
      const ans = (Array.isArray(b.answers) ? b.answers : []).map((x) => Math.round(num(x))), total = l.questions.length; let score = 0; l.questions.forEach((q, i) => { if (ans[i] === q.correct) score++; });
      const pct = total ? Math.round(score / total * 100) : 0, passed = pct >= l.passPct, k = `qatt:lh${l.id}:${uid}`, prev = await store.get(k);
      const best = !prev || pct > prev.pct;
      const rec2 = best ? { quiz: "lh" + l.id, lesson: l.title, user: me, answers: ans, score, total, pct, passed, at: t, secs: Math.max(0, Math.round(num(b.secs))), tries: (prev ? prev.tries || 1 : 0) + 1, lhPts: score * 2 + (passed ? l.pts : 0), certNo: passed ? (prev && prev.certNo) || "LH-" + today.replace(/-/g, "").slice(2) + "-" + randomBytes(2).toString("hex").toUpperCase() : "" } : Object.assign(prev, { tries: (prev.tries || 1) + 1 });
      await store.set(k, rec2);
      return json(200, { ok: true, score, total, pct, passed, passPct: l.passPct, best: rec2.pct, certNo: rec2.certNo, pts: passed ? l.pts : 0, review: l.questions.map((q, i) => ({ q: q.q, yours: ans[i], correct: q.correct, options: q.options, why: q.why })) });
    }
    if (a === "lh-report") {   // who has done what — HO sees all, a state sees itself
      const L = (await listAll("lesson:")).filter((l) => l.status === "live"), users = {}, byLesson = [];
      for (const l of L) { const atts = (await listAll(`qatt:lh${l.id}:`)).filter((x) => inState(x.user && x.user.state)), views = (await listAll(`lview:${l.id}:`)).filter((x) => inState(x.user && x.user.state));
        byLesson.push({ id: l.id, title: l.title, topic: l.topic, opened: views.length, attempted: atts.length, passed: atts.filter((x) => x.passed).length, avg: atts.length ? Math.round(atts.reduce((s, x) => s + x.pct, 0) / atts.length) : null });
        atts.forEach((x) => { const u = x.user || {}, kk = (u.app || "") + ":" + (u.username || ""); const o = users[kk] || (users[kk] = { name: u.fullName || u.username, state: u.state || "HO", done: 0, passed: 0, sum: 0, last: 0 }); o.done++; if (x.passed) o.passed++; o.sum += x.pct; if (x.at > o.last) o.last = x.at; }); }
      const people = Object.values(users).map((o) => ({ name: o.name, state: o.state, done: o.done, passed: o.passed, avg: Math.round(o.sum / o.done), last: o.last })).sort((x, y) => y.passed - x.passed || y.avg - x.avg), st = {};
      people.forEach((p) => { const o = st[p.state] || (st[p.state] = { name: p.state, people: 0, passed: 0, sum: 0 }); o.people++; o.passed += p.passed; o.sum += p.avg; });
      return json(200, { ok: true, lessons: L.length, byLesson, people: people.slice(0, 300), byState: Object.values(st).map((o) => ({ name: o.name, people: o.people, passed: o.passed, avg: Math.round(o.sum / o.people) })).sort((x, y) => y.passed - x.passed) });
    }
  }

  // ============================ 🚪 LOST-SALE TRACKER ============================
  if (/^ls-/.test(a)) {
    if (a === "ls-meta") return json(200, { ok: true, reasons: LOST_REASONS, bands: LOST_BANDS, isHO, myState, me });
    if (a === "ls-add") {
      const x = b.entry || {}, d = okDate(x.d) && x.d <= today ? x.d : today, reason = LOST_REASONS.includes(x.reason) ? x.reason : "";
      if (!reason) return json(400, { ok: false, error: "Pick the main reason." });
      const e = { id: newId(t), d, at: t, user: me, state: str(isHO ? x.state : myState || x.state, 40), store: str(x.store, 80), city: str(x.city, 40), model: str(x.model, 60), band: LOST_BANDS.includes(x.band) ? x.band : "", reason, comp: str(x.comp, 60), compModel: str(x.compModel, 60), fin: str(x.fin, 60), note: str(x.note, 300), follow: !!x.follow, n: Math.max(1, Math.min(50, Math.round(num(x.n)) || 1)) };
      if (!e.model && !e.band) return json(400, { ok: false, error: "Enter the model the customer asked for, or the price band." });
      await store.set(`lost:${d}:${e.id}`, e); return json(200, { ok: true, id: e.id });
    }
    if (a === "ls-delete") { const d = str(b.d, 10), id = cid(b.id), e = await store.get(`lost:${d}:${id}`); if (e && (isHO || (e.user.app === me.app && e.user.username === me.username))) await store.delete(`lost:${d}:${id}`); return json(200, { ok: true }); }
    const from = okDate(b.from) ? b.from : ist(t - 29 * 864e5), to = okDate(b.to) ? b.to : today;
    const load = async () => { const keys = (await store.list("lost:")).filter((k) => { const d = k.slice(5, 15); return d >= from && d <= to; }); return (await pool(keys, 30, (k) => store.get(k))).filter((e) => e && inState(e.state) && (!b.state || low(e.state) === low(b.state))); };
    if (a === "ls-list") { const L = await load(), mineOnly = b.mine ? L.filter((e) => e.user.app === me.app && e.user.username === me.username) : L; return json(200, { ok: true, items: mineOnly.sort((x, y) => y.at - x.at).slice(0, 500) }); }
    if (a === "ls-summary" || a === "ls-ai") {
      const L = await load(), R = {}, S = {}, M = {}, C = {}, B = {}, F = {}, ST = {}, day = {}, RM = {}; let n = 0, follow = 0;
      L.forEach((e) => { const k = e.n || 1; n += k; inc(R, e.reason, k); if (e.state) inc(S, e.state, k); if (e.model) inc(M, e.model, k); if (e.comp) inc(C, e.comp + (e.compModel ? " " + e.compModel : ""), k); if (e.band) inc(B, e.band, k); if (e.fin) inc(F, e.fin, k); if (e.store) inc(ST, e.store + (e.city ? ", " + e.city : ""), k); inc(day, e.d, k); if (e.follow) follow++;
        if (e.model) { const o = RM[e.model] || (RM[e.model] = {}); inc(o, e.reason, k); } });
      const sum = { from, to, n, entries: L.length, follow, reasons: top(R, 12), states: top(S, 40), models: top(M, 15), competitors: top(C, 12), bands: LOST_BANDS.map((x) => ({ name: x, n: B[x] || 0 })), finance: top(F, 8), stores: top(ST, 15), days: Object.keys(day).sort().map((d) => ({ d, n: day[d] })),
        modelReasons: top(M, 8).map((m) => ({ model: m.name, n: m.n, top: top(RM[m.name], 3) })), people: new Set(L.map((e) => e.user.app + ":" + e.user.username)).size };
      if (a === "ls-summary") return json(200, { ok: true, sum, isHO, myState });
      if (!L.length) return json(200, { ok: false, error: "No lost-sale entries in these dates yet." });
      const sys = 'You are a senior sales analyst at vivo India. From lost-sale logs (walk-ins who did not buy), reply with ONE JSON object only: {"summary":"3-4 lines","actions":[{"team":"Product|Pricing & schemes|Finance partners|Supply|Training|Marketing","action":"","why":"cite the number"}],"watch":["..."]}. 5-7 actions, most valuable first. Use only the numbers given.';
      const notes = L.filter((e) => e.note).slice(0, 60).map((e) => e.reason + ": " + e.note);
      const r = await ctx.askAI(env, "What should each team do about these lost sales?", "DATA: " + JSON.stringify(Object.assign({}, sum, { days: undefined })).slice(0, 9000) + "\nNOTES: " + JSON.stringify(notes).slice(0, 4000), [], ctx.aiFetch, { system: sys, label: "LOST" });
      if (!r.ok) return json(200, { ok: false, error: r.error });
      const j = aiJson(r.text); return json(200, { ok: true, ai: j && j.summary ? j : { summary: str(r.text, 2500), actions: [], watch: [] } });
    }
  }

  // ============================ 🚀 NEW-LAUNCH TRACKER ============================
  if (/^lt-/.test(a)) {
    const sellOut = async (L) => {   // units of the launch model per state since launch day, from the sell-out data
      const names = new Set([L.model].concat(L.aliases || []).map(nk)), to = ist(Date.parse(L.date + "T00:00:00Z") + 29 * 864e5), out = {}, days = {};
      let S; try { S = await loadSales(store, pool, { fromM: L.date.slice(0, 7), toM: to.slice(0, 7) }); } catch (e) { S = { rows: [] }; }
      (S.rows || []).forEach((r) => { if (!names.has(nk(r.mo))) return; if (r.d) { if (r.d < L.date || r.d > to) return; inc(out, r.st || "—", r.u); inc(days, r.d, r.u); } else { const m0 = Date.parse(r.m + "-01T00:00:00Z"), m1 = Date.UTC(+r.m.slice(0, 4), +r.m.slice(5, 7), 0), lo = Math.max(m0, Date.parse(L.date + "T00:00:00Z")), hi = Math.min(m1, Date.parse(to + "T00:00:00Z")); if (hi >= lo) inc(out, r.st || "—", r.u * ((hi - lo) / 864e5 + 1) / ((m1 - m0) / 864e5 + 1)); } });
      return { byState: out, days, daily: Object.keys(days).length > 0 };
    };
    const view = async (L, withSell) => {
      const sts = await listAll(`launchst:${L.id}:`), bySt = {}; sts.forEach((x) => { bySt[low(x.state)] = x; });
      const so = withSell ? await sellOut(L) : { byState: {}, days: {}, daily: false }, soLow = {}; Object.keys(so.byState).forEach((k) => { soLow[low(k)] = so.byState[k]; });
      const dayN = Math.max(0, Math.min(30, Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(L.date + "T00:00:00Z")) / 864e5) + 1));
      const states = L.states.map((s) => { const x = bySt[low(s)] || { vals: {} }, plan = num((L.plan || {})[s]), sold = Math.round(soLow[low(s)] || 0); let done = 0, tot = 0;
        const items = L.checklist.map((c) => { const v = x.vals[c.k] || {}, d = num(v.done), tt = num(v.total); if (tt > 0) { done += Math.min(d, tt) / tt; tot++; } return { k: c.k, label: c.label, done: d, total: tt, pct: tt > 0 ? Math.round(Math.min(d, tt) / tt * 100) : null }; });
        return { state: s, items, ready: tot ? Math.round(done / tot * 100) : null, plan, sold, ach: plan ? Math.round(sold / plan * 100) : null, pace: plan && dayN ? Math.round(sold / (plan * Math.min(dayN, 30) / 30) * 100) : null, note: x.note || "", by: x.by || "", at: x.at || 0 }; }).filter((s) => inState(s.state));
      const P = states.reduce((s, x) => s + x.plan, 0), SO = states.reduce((s, x) => s + x.sold, 0), rd = states.filter((x) => x.ready != null);
      return { id: L.id, model: L.model, aliases: L.aliases, date: L.date, status: L.status, checklist: L.checklist, dayN, states, plan: P, sold: SO, ach: P ? Math.round(SO / P * 100) : null, ready: rd.length ? Math.round(rd.reduce((s, x) => s + x.ready, 0) / rd.length) : null, days: so.daily ? Object.keys(so.days).sort().map((d) => ({ d, u: Math.round(so.days[d]) })) : [], hasSell: Object.keys(so.byState).length > 0, by: L.by };
    };
    if (a === "lt-list") { const L = (await listAll("launch:")).filter((x) => isHO || x.states.some((s) => low(s) === low(myState))).sort((x, y) => String(y.date).localeCompare(String(x.date))); return json(200, { ok: true, isHO, myState, items: await pool(L.slice(0, 30), 6, (x) => view(x, true)), defCheck: DEF_CHECK }); }
    if (a === "lt-get") { const L = await store.get(`launch:${cid(b.id)}`); if (!L) return json(404, { ok: false, error: "Launch not found." }); return json(200, { ok: true, isHO, myState, item: await view(L, true), plan: isHO ? L.plan : undefined }); }
    if (a === "lt-save") {
      if (!isHO) return json(403, { ok: false, error: "Only HO can set up a launch." });
      const x = b.launch || {}, id = cid(x.id) || newId(t), old = await store.get(`launch:${id}`), plan = {};
      const states = (Array.isArray(x.states) ? x.states : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 45);
      states.forEach((s) => { const v = num((x.plan || {})[s]); if (v > 0) plan[s] = Math.round(v); });
      const checklist = (Array.isArray(x.checklist) ? x.checklist : []).map((c) => ({ k: cid(c.k) || cid(str(c.label, 20).toLowerCase()) || newId(t), label: str(c.label, 80) })).filter((c) => c.label).slice(0, 12);
      const L = { id, model: str(x.model, 60), aliases: (Array.isArray(x.aliases) ? x.aliases : String(x.aliases || "").split(",")).map((s) => str(s, 60)).filter(Boolean).slice(0, 8), date: okDate(x.date) ? x.date : "", states, plan, checklist: checklist.length ? checklist : DEF_CHECK.map((c) => ({ k: c[0], label: c[1] })), status: x.status === "closed" ? "closed" : "live", by: old ? old.by : (me.fullName || me.username), at: old ? old.at : t, updatedAt: t };
      if (!L.model || !L.date) return json(400, { ok: false, error: "Enter the model and the launch date." }); if (!states.length) return json(400, { ok: false, error: "Pick at least one state." });
      await store.set(`launch:${id}`, L); return json(200, { ok: true, id });
    }
    if (a === "lt-delete") { if (!isHO) return json(403, { ok: false, error: "Only HO can delete a launch." }); const id = cid(b.id); for (const k of await store.list(`launchst:${id}:`)) await store.delete(k); await store.delete(`launch:${id}`); return json(200, { ok: true }); }
    if (a === "lt-update") {   // a state reports its readiness numbers
      const L = await store.get(`launch:${cid(b.id)}`); if (!L) return json(404, { ok: false, error: "Launch not found." });
      const state = L.states.find((s) => low(s) === low(isHO ? b.state : myState)); if (!state) return json(403, { ok: false, error: "This launch isn't for your state." });
      const vals = {}; L.checklist.forEach((c) => { const v = (b.vals || {})[c.k] || {}; vals[c.k] = { done: Math.max(0, Math.round(num(v.done))), total: Math.max(0, Math.round(num(v.total))) }; });
      await store.set(`launchst:${L.id}:${low(state).replace(/[^a-z0-9]/g, "")}`, { state, vals, note: str(b.note, 300), by: me.fullName || me.username, at: t });
      return json(200, { ok: true });
    }
  }

  // ============================ 🧑‍💼 PROMOTER PRODUCTIVITY & MANPOWER PLANNER ============================
  if (/^mp-/.test(a)) {
    if (a === "mp-months") { const ks = (await store.list("mp:")).map((k) => k.slice(3)).filter(okMonth).sort().reverse(); return json(200, { ok: true, months: ks, isHO, myState }); }
    if (a === "mp-upload") {
      if (!isHO && !myState) return json(403, { ok: false, error: "Not allowed." });
      const month = str(b.month, 7); if (!okMonth(month)) return json(400, { ok: false, error: "Pick the month." });
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 60000).map((r) => ({ code: str(r.code, 30), name: str(r.name, 60), store: str(r.store, 80), storeCode: str(r.storeCode, 30), state: str(isHO ? r.state : myState, 40), city: str(r.city, 40), doj: okDate(r.doj) ? r.doj : "", dol: okDate(r.dol) ? r.dol : "", units: Math.max(0, num(r.units)), value: Math.max(0, num(r.value)), days: Math.max(0, Math.min(31, num(r.days))) })).filter((r) => (r.name || r.code) && r.state);
      const stores = (Array.isArray(b.stores) ? b.stores : []).slice(0, 80000).map((r) => ({ storeCode: str(r.storeCode, 30), store: str(r.store, 80), state: str(isHO ? r.state : myState, 40), city: str(r.city, 40), units: Math.max(0, num(r.units)) })).filter((r) => (r.store || r.storeCode) && r.state);
      if (!rows.length) return json(400, { ok: false, error: "No promoter rows found — use the sample file's columns." });
      const old = (await store.get(`mp:${month}`)) || { rows: [], stores: [] };
      const keepR = isHO ? [] : old.rows.filter((r) => low(r.state) !== low(myState)), keepS = isHO ? (stores.length ? [] : old.stores || []) : (old.stores || []).filter((r) => low(r.state) !== low(myState));
      await store.set(`mp:${month}`, { month, rows: keepR.concat(rows), stores: keepS.concat(stores), by: me.fullName || me.username, at: t });
      return json(200, { ok: true, rows: rows.length, stores: stores.length });
    }
    if (a === "mp-delete") { if (!isHO) return json(403, { ok: false, error: "Only HO can delete a month." }); await store.delete(`mp:${str(b.month, 7)}`); return json(200, { ok: true }); }
    if (a === "mp-view") {
      const month = str(b.month, 7), X = await store.get(`mp:${month}`); if (!X) return json(404, { ok: false, error: "No data for this month — upload the promoter sheet first." });
      const cost = Math.max(0, num(b.cost)) || 18000, marginUnit = Math.max(0, num(b.margin)) || 600, minUnits = Math.max(1, num(b.minUnits) || 25);
      const rows = X.rows.filter((r) => inState(r.state) && (!b.state || low(r.state) === low(b.state))), stores = (X.stores || []).filter((r) => inState(r.state) && (!b.state || low(r.state) === low(b.state)));
      const mEnd = month + "-31", act = rows.filter((r) => !r.dol || r.dol > mEnd), left = rows.filter((r) => r.dol && r.dol.slice(0, 7) === month), joined = rows.filter((r) => r.doj && r.doj.slice(0, 7) === month);
      const pd = (r) => (r.days > 0 ? r.units / r.days * 26 : r.units);   // units per full month (26 working days)
      const P = rows.map((r) => Object.assign({}, r, { rate: r1(pd(r)), perDay: r.days > 0 ? r1(r.units / r.days) : null })), sorted = P.map((r) => r.rate).sort((x, y) => x - y), q = (f) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : 0), med = q(0.5), p25 = q(0.25), p75 = q(0.75);
      const ST = {}; P.forEach((r) => { const o = ST[r.state] || (ST[r.state] = { name: r.state, hc: 0, units: 0, value: 0, zero: 0, left: 0, rates: [] }); o.hc++; o.units += r.units; o.value += r.value; if (!r.units) o.zero++; if (r.dol && r.dol.slice(0, 7) === month) o.left++; o.rates.push(r.rate); });
      const byState = Object.values(ST).map((o) => { o.rates.sort((x, y) => x - y); return { name: o.name, hc: o.hc, units: Math.round(o.units), value: Math.round(o.value), perHead: r1(o.units / o.hc), median: o.rates[Math.floor(o.rates.length / 2)] || 0, zero: o.zero, attr: o.hc ? r1(o.left / o.hc * 100) : 0 }; }).sort((x, y) => y.perHead - x.perHead);
      // store level: how many promoters per store, and stores with sales but nobody
      const SM = {}; const sk = (r) => low(r.storeCode || r.store) + "|" + low(r.state);
      rows.forEach((r) => { if (!(r.storeCode || r.store)) return; const o = SM[sk(r)] || (SM[sk(r)] = { store: r.store || r.storeCode, storeCode: r.storeCode, state: r.state, city: r.city, hc: 0, punits: 0, units: 0 }); if (!r.dol || r.dol > mEnd) o.hc++; o.punits += r.units; });
      stores.forEach((r) => { const o = SM[sk(r)] || (SM[sk(r)] = { store: r.store || r.storeCode, storeCode: r.storeCode, state: r.state, city: r.city, hc: 0, punits: 0, units: 0 }); o.units = r.units; if (!o.store) o.store = r.store; });
      const SL = Object.values(SM).map((o) => Object.assign(o, { total: Math.max(o.units, o.punits) }));
      const payback = (extra) => (extra * marginUnit > 0 ? r1(cost / (extra * marginUnit)) : null);
      const uncovered = SL.filter((o) => o.hc === 0 && o.total >= minUnits).map((o) => { const extra = Math.round(o.total * 0.25); return { store: o.store, state: o.state, city: o.city, units: Math.round(o.total), extra, gain: Math.round(extra * marginUnit - cost), payback: payback(extra) }; }).sort((x, y) => y.units - x.units).slice(0, 80);
      const overload = SL.filter((o) => o.hc > 0 && o.total / o.hc > Math.max(p75 * 1.5, med * 2) && o.total / o.hc >= minUnits).map((o) => { const per = o.total / o.hc, extra = Math.round(Math.min(per * 0.3, med)); return { store: o.store, state: o.state, city: o.city, hc: o.hc, units: Math.round(o.total), perHead: r1(per), extra, gain: Math.round(extra * marginUnit - cost), payback: payback(extra) }; }).sort((x, y) => y.perHead - x.perHead).slice(0, 60);
      const lowP = P.filter((r) => (!r.dol || r.dol > mEnd) && r.days >= 10 && r.rate < Math.min(p25, med * 0.5)).sort((x, y) => x.rate - y.rate).slice(0, 100).map((r) => ({ name: r.name, code: r.code, store: r.store, state: r.state, units: r.units, days: r.days, rate: r.rate }));
      const topP = P.slice().sort((x, y) => y.rate - x.rate).slice(0, 25).map((r) => ({ name: r.name, code: r.code, store: r.store, state: r.state, units: r.units, days: r.days, rate: r.rate }));
      return json(200, { ok: true, month, by: X.by, at: X.at, isHO, assume: { cost, margin: marginUnit, minUnits }, kpi: { hc: rows.length, active: act.length, joined: joined.length, left: left.length, attr: rows.length ? r1(left.length / rows.length * 100) : 0, units: Math.round(rows.reduce((s, r) => s + r.units, 0)), perHead: rows.length ? r1(rows.reduce((s, r) => s + r.units, 0) / rows.length) : 0, median: med, p25, p75, zero: P.filter((r) => !r.units).length, stores: SL.length, storesNoPromoter: SL.filter((o) => o.hc === 0).length, hasStores: stores.length > 0 },
        byState, uncovered, overload, low: lowP, top: topP });
    }
  }

  // ============================ 💬 CUSTOMER VOICE (staff side) ============================
  if (/^cv-/.test(a)) {
    if (a === "cv-stores") { const L = (await listAll("cvs:")).filter((s) => inState(s.state)).sort((x, y) => y.at - x.at); return json(200, { ok: true, isHO, myState, tags: CV_TAGS, items: L.slice(0, 3000) }); }
    if (a === "cv-store-save") {
      const rows = (Array.isArray(b.stores) ? b.stores : [b.store || {}]).slice(0, 2000), out = [];
      for (const x of rows) { const state = str(isHO ? x.state : myState || x.state, 40), name = str(x.store, 80); if (!name || !state) continue;
        const code = cid(x.code) && (await store.get(`cvs:${cid(x.code)}`)) ? cid(x.code) : randomBytes(5).toString("hex"), old = await store.get(`cvs:${code}`);
        if (old && !inState(old.state)) continue;
        const s = { code, store: name, city: str(x.city, 40), state, storeCode: str(x.storeCode, 30), by: old ? old.by : (me.fullName || me.username), at: old ? old.at : t }; await store.set(`cvs:${code}`, s); out.push(s); }
      if (!out.length) return json(400, { ok: false, error: "Enter the store name and state." });
      return json(200, { ok: true, items: out });
    }
    if (a === "cv-store-delete") { const s = await store.get(`cvs:${cid(b.code)}`); if (s && inState(s.state)) await store.delete(`cvs:${s.code}`); return json(200, { ok: true }); }
    const from = okDate(b.from) ? b.from : ist(t - 29 * 864e5), to = okDate(b.to) ? b.to : today;
    const load = async () => { const keys = (await store.list("cvr:")).filter((k) => { const d = k.slice(4, 14); return d >= from && d <= to; }); return (await pool(keys, 30, (k) => store.get(k))).filter((e) => e && inState(e.state) && (!b.state || low(e.state) === low(b.state))); };
    if (a === "cv-summary") {
      const L = await load(), S = {}, ST = {}, T = {}, day = {}; let sum = 0, pro = 0, det = 0, npsN = 0;
      L.forEach((e) => { sum += e.rating; if (e.nps != null) { npsN++; if (e.nps >= 9) pro++; else if (e.nps <= 6) det++; }
        const o = S[e.state] || (S[e.state] = { name: e.state, n: 0, sum: 0, low: 0 }); o.n++; o.sum += e.rating; if (e.rating <= 2) o.low++;
        const k = e.store + "|" + e.state, p = ST[k] || (ST[k] = { store: e.store, state: e.state, n: 0, sum: 0, low: 0 }); p.n++; p.sum += e.rating; if (e.rating <= 2) p.low++;
        (e.tags || []).forEach((g) => inc(T, g)); const dd = day[e.d] || (day[e.d] = { n: 0, sum: 0 }); dd.n++; dd.sum += e.rating; });
      const stores = Object.values(ST).map((p) => ({ store: p.store, state: p.state, n: p.n, avg: r1(p.sum / p.n), low: p.low }));
      return json(200, { ok: true, isHO, myState, from, to, n: L.length, avg: L.length ? r1(sum / L.length) : null, nps: npsN ? Math.round((pro - det) / npsN * 100) : null, dist: [1, 2, 3, 4, 5].map((k) => L.filter((e) => e.rating === k).length), open: L.filter((e) => e.callback && e.status !== "done").length,
        byState: Object.values(S).map((o) => ({ name: o.name, n: o.n, avg: r1(o.sum / o.n), low: o.low })).sort((x, y) => y.n - x.n), best: stores.filter((p) => p.n >= 3).sort((x, y) => y.avg - x.avg).slice(0, 10), worst: stores.filter((p) => p.n >= 3).sort((x, y) => x.avg - y.avg).slice(0, 10), tags: top(T, 12), days: Object.keys(day).sort().map((d) => ({ d, n: day[d].n, avg: r1(day[d].sum / day[d].n) })) });
    }
    if (a === "cv-list") { const L = await load(), f = b.filter === "callback" ? L.filter((e) => e.callback && e.status !== "done") : b.filter === "low" ? L.filter((e) => e.rating <= 2) : L; return json(200, { ok: true, items: f.sort((x, y) => y.at - x.at).slice(0, 400) }); }
    if (a === "cv-done") { const k = `cvr:${str(b.d, 10)}:${cid(b.id)}`, e = await store.get(k); if (!e || !inState(e.state)) return json(404, { ok: false, error: "Not found." }); e.status = b.reopen ? "open" : "done"; e.note = str(b.note, 300); e.doneBy = me.fullName || me.username; e.doneAt = t; await store.set(k, e); return json(200, { ok: true }); }
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// ---- customer side (no login): open a store's rating page / send one rating ----
export async function bixPublic(b, ctx) {
  const { store, t } = ctx, code = cid(b.s), s = code ? await store.get(`cvs:${code}`) : null;
  if (!s) return json(404, { ok: false, error: "This rating link is no longer active." });
  if (b.action === "cv-p-open") return json(200, { ok: true, store: s.store, city: s.city, tags: CV_TAGS });
  if (b.action === "cv-p-send") {
    if (b.hp) return json(200, { ok: true });   // honeypot field filled → a bot; pretend it worked
    const d = ist(t), cnt = (await store.get(`cvc:${code}:${d}`)) || { n: 0 };
    if (cnt.n >= 200) return json(429, { ok: false, error: "Too many ratings for this store today — please try tomorrow." });
    const rating = Math.round(num(b.rating)); if (!(rating >= 1 && rating <= 5)) return json(400, { ok: false, error: "Please tap the stars to rate." });
    const phone = String(b.phone || "").replace(/\D/g, "").slice(-10), callback = !!b.callback && phone.length === 10;
    if (b.callback && phone.length !== 10) return json(400, { ok: false, error: "Enter your 10-digit mobile number so the team can call you." });
    const e = { id: newId(t), d, at: t, code, store: s.store, city: s.city, state: s.state, rating, nps: b.nps === "" || b.nps == null ? null : Math.max(0, Math.min(10, Math.round(num(b.nps)))), tags: (Array.isArray(b.tags) ? b.tags : []).filter((x) => CV_TAGS.includes(x)).slice(0, 6), comment: str(b.comment, 500), model: str(b.model, 60),
      name: callback ? str(b.name, 50) : "", phone: callback ? phone : "", callback, status: callback || rating <= 2 ? "open" : "none" };
    await store.set(`cvr:${d}:${e.id}`, e); cnt.n++; await store.set(`cvc:${code}:${d}`, cnt);
    return json(200, { ok: true });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
