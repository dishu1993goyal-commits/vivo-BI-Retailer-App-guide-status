// Engage: quizzes & certificates (#8), leaderboard points & recognition (#9), best-practice wall (#10), polls (#11).
// Storage:
//   quiz:<id>            { id, title, topic, intro, questions:[{q, options:[], correct, why}], passPct, minutes, closesAt, status:"live"|"draft"|"closed", createdAt, by }
//   qatt:<quizId>:<userId>   { quiz, user:{app,username,fullName,state}, answers:[], score, total, pct, passed, at, secs, certNo }
//   poll:<id>            { id, question, options:[], multi, anonymous, closesAt, status, createdAt, by, states:[] }
//   pvote:<pollId>:<userId>  { choice:[i], at, state }
//   wall:<id>            { id, title, text, category, state, by, photos:[], likes:{userId:1}, comments:[{by,text,t}], featured, createdAt }
//   recog:<id>           { id, month, title, name, role, state, reason, photo, by, createdAt }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const cid = (v) => String(v || "").replace(/[^a-z0-9]/gi, "").slice(0, 30);
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
export const WALL_CATS = ["Liquidation idea", "Retailer app adoption", "Scheme execution", "Market hygiene", "Training", "Visit / beat plan", "Other"];

export async function engageAction(b, ctx) {
  const { store, t, app, rec, key, pool, who, sameUser } = ctx;
  const isAdmin = app === "admin", me = who(app, rec), uid = app + ":" + key;
  const listOf = async (p) => (await pool(await store.list(p), 40, (k) => store.get(k))).filter(Boolean);
  const adminOnly = () => json(403, { ok: false, error: "Only BI admins can do this." });
  const attOk = async (ids, max) => { const o = []; for (const id of (Array.isArray(ids) ? ids : []).slice(0, max)) { const c = cid(id); const f = await store.get(`att:${c}`); if (f && sameUser(f.by, me) && /^image\//.test(f.mime)) o.push(c); } return o; };

  // ---------------- quizzes ----------------
  if (b.action === "quiz-list") {
    const qs = (await listOf("quiz:")).filter((q) => isAdmin || q.status === "live" || q.status === "closed");
    const mine = {};
    for (const q of qs) { const a = await store.get(`qatt:${q.id}:${uid}`); if (a) mine[q.id] = { score: a.score, total: a.total, pct: a.pct, passed: a.passed, at: a.at, certNo: a.certNo }; }
    const out = qs.map((q) => { const o = Object.assign({}, q, { count: q.questions.length }); if (!isAdmin) delete o.questions; o.open = q.status === "live" && (!q.closesAt || t < q.closesAt); return o; }).sort((x, y) => y.createdAt - x.createdAt);
    return json(200, { ok: true, quizzes: out, mine, now: t });
  }
  if (b.action === "quiz-save") {
    if (!isAdmin) return adminOnly();
    const z = b.quiz || {}, title = str(z.title, 120);
    if (title.length < 3) return json(400, { ok: false, error: "Give the quiz a title." });
    const questions = (Array.isArray(z.questions) ? z.questions : []).slice(0, 50).map((q) => {
      const options = (Array.isArray(q.options) ? q.options : []).slice(0, 6).map((o) => str(o, 200)).filter(Boolean);
      return { q: str(q.q, 400), options, correct: Math.max(0, Math.min(options.length - 1, Number(q.correct) || 0)), why: str(q.why, 400) };
    }).filter((q) => q.q && q.options.length >= 2);
    if (!questions.length) return json(400, { ok: false, error: "Add at least one question with 2+ options." });
    const id = cid(z.id) || nid(t), old = (await store.get(`quiz:${id}`)) || {};
    await store.set(`quiz:${id}`, { id, title, topic: str(z.topic, 60), intro: str(z.intro, 600), questions, passPct: Math.max(10, Math.min(100, Number(z.passPct) || 60)), minutes: Math.max(0, Math.min(120, Number(z.minutes) || 0)),
      closesAt: Number(z.closesAt) || 0, status: ["live", "draft", "closed"].includes(z.status) ? z.status : "draft", createdAt: old.createdAt || t, updatedAt: t, by: old.by || rec.fullName });
    return json(200, { ok: true, id });
  }
  if (b.action === "quiz-delete") { if (!isAdmin) return adminOnly(); const id = cid(b.id); for (const k of await store.list(`qatt:${id}:`)) await store.delete(k); await store.delete(`quiz:${id}`); return json(200, { ok: true }); }
  if (b.action === "quiz-start") {   // questions without answers; one attempt per person
    const q = await store.get(`quiz:${cid(b.id)}`);
    if (!q || (q.status !== "live" && !isAdmin)) return json(404, { ok: false, error: "Quiz not available." });
    if (q.closesAt && t > q.closesAt && !isAdmin) return json(400, { ok: false, error: "This quiz has closed." });
    const prev = await store.get(`qatt:${q.id}:${uid}`);
    if (prev && !isAdmin) return json(409, { ok: false, error: "You have already taken this quiz.", attempt: prev });
    return json(200, { ok: true, quiz: { id: q.id, title: q.title, intro: q.intro, minutes: q.minutes, passPct: q.passPct, questions: q.questions.map((x) => ({ q: x.q, options: x.options })) }, startedAt: t });
  }
  if (b.action === "quiz-submit") {
    const q = await store.get(`quiz:${cid(b.id)}`);
    if (!q) return json(404, { ok: false, error: "Quiz not found." });
    const k = `qatt:${q.id}:${uid}`;
    if ((await store.get(k)) && !isAdmin) return json(409, { ok: false, error: "Already submitted." });
    const ans = (Array.isArray(b.answers) ? b.answers : []).map((x) => (x == null ? null : Number(x)));
    let score = 0; const review = q.questions.map((x, i) => { const ok = ans[i] === x.correct; if (ok) score++; return { ok, correct: x.correct, why: x.why, chosen: ans[i] }; });
    const pct = Math.round(score / q.questions.length * 100), passed = pct >= q.passPct;
    const secs = Math.max(0, Math.min(7200, Math.round((t - (Number(b.startedAt) || t)) / 1000)));
    const att = { quiz: q.id, user: me, answers: ans, score, total: q.questions.length, pct, passed, at: t, secs, certNo: passed ? "VBI-" + q.id.slice(-4).toUpperCase() + "-" + randomBytes(2).toString("hex").toUpperCase() : "" };
    if (!isAdmin) await store.set(k, att);
    return json(200, { ok: true, attempt: att, review });
  }
  if (b.action === "quiz-results") {
    const q = await store.get(`quiz:${cid(b.id)}`);
    if (!q) return json(404, { ok: false, error: "Quiz not found." });
    const atts = (await listOf(`qatt:${q.id}:`)).sort((x, y) => y.pct - x.pct || x.secs - y.secs);
    return json(200, { ok: true, quiz: { id: q.id, title: q.title, passPct: q.passPct, total: q.questions.length }, attempts: atts.map((a) => ({ user: a.user, score: a.score, total: a.total, pct: a.pct, passed: a.passed, secs: a.secs, at: a.at })) });
  }

  // ---------------- polls ----------------
  if (b.action === "poll-list") {
    const ps = (await listOf("poll:")).filter((p) => isAdmin || ((p.status === "live" || p.status === "closed") && (!p.states || !p.states.length || p.states.includes(rec.state || ""))));
    const out = [];
    for (const p of ps.sort((x, y) => y.createdAt - x.createdAt)) {
      const votes = await listOf(`pvote:${p.id}:`), mine = await store.get(`pvote:${p.id}:${uid}`);
      const counts = p.options.map(() => 0), byState = {};
      votes.forEach((v) => v.choice.forEach((c) => { if (counts[c] != null) counts[c]++; const s = byState[v.state || "HO"] = byState[v.state || "HO"] || p.options.map(() => 0); s[c]++; }));
      const open = p.status === "live" && (!p.closesAt || t < p.closesAt);
      const show = isAdmin || mine || !open;
      out.push(Object.assign({}, p, { open, voted: mine ? mine.choice : null, voters: votes.length, counts: show ? counts : null, byState: isAdmin ? byState : null }));
    }
    return json(200, { ok: true, polls: out, now: t });
  }
  if (b.action === "poll-save") {
    if (!isAdmin) return adminOnly();
    const p = b.poll || {}, question = str(p.question, 200);
    const options = (Array.isArray(p.options) ? p.options : []).slice(0, 8).map((o) => str(o, 80)).filter(Boolean);
    if (question.length < 5 || options.length < 2) return json(400, { ok: false, error: "Write the question and at least 2 options." });
    const id = cid(p.id) || nid(t), old = (await store.get(`poll:${id}`)) || {};
    await store.set(`poll:${id}`, { id, question, options, multi: p.multi === true, anonymous: p.anonymous !== false, closesAt: Number(p.closesAt) || 0, status: ["live", "draft", "closed"].includes(p.status) ? p.status : "live",
      states: (Array.isArray(p.states) ? p.states : []).slice(0, 60).map((s) => str(s, 40)), createdAt: old.createdAt || t, by: old.by || rec.fullName });
    return json(200, { ok: true, id });
  }
  if (b.action === "poll-delete") { if (!isAdmin) return adminOnly(); const id = cid(b.id); for (const k of await store.list(`pvote:${id}:`)) await store.delete(k); await store.delete(`poll:${id}`); return json(200, { ok: true }); }
  if (b.action === "poll-vote") {
    const p = await store.get(`poll:${cid(b.id)}`);
    if (!p || p.status !== "live" || (p.closesAt && t > p.closesAt)) return json(400, { ok: false, error: "This poll is closed." });
    let choice = (Array.isArray(b.choice) ? b.choice : [b.choice]).map(Number).filter((c) => c >= 0 && c < p.options.length);
    choice = [...new Set(choice)]; if (!p.multi) choice = choice.slice(0, 1);
    if (!choice.length) return json(400, { ok: false, error: "Choose an option." });
    await store.set(`pvote:${p.id}:${uid}`, { choice, at: t, state: rec.state || (isAdmin ? "HO" : ""), user: p.anonymous ? null : me });
    return json(200, { ok: true });
  }

  // ---------------- best-practice wall ----------------
  if (b.action === "wall-list") {
    const rows = (await listOf("wall:")).sort((x, y) => (y.featured ? 1 : 0) - (x.featured ? 1 : 0) || y.createdAt - x.createdAt);
    return json(200, { ok: true, posts: rows.map((p) => Object.assign({}, p, { likeCount: Object.keys(p.likes || {}).length, liked: !!(p.likes || {})[uid], likes: undefined, mine: sameUser(p.by, me) })), categories: WALL_CATS, now: t });
  }
  if (b.action === "wall-post") {
    const title = str(b.title, 120), text = str(b.text, 4000);
    if (title.length < 5 || text.length < 20) return json(400, { ok: false, error: "Add a title and describe what you did and the result (at least a few lines)." });
    const id = nid(t);
    const p = { id, title, text, result: str(b.result, 200), category: WALL_CATS.includes(b.category) ? b.category : "Other", state: isAdmin ? str(b.state, 40) || "HO" : rec.state || "", by: me, photos: await attOk(b.photos, 4), likes: {}, comments: [], featured: false, createdAt: t };
    await store.set(`wall:${id}`, p);
    await ctx.logEvent(store, t, app, rec, "best-practice", { device: title.slice(0, 50), ver: "" });
    return json(200, { ok: true, id });
  }
  if (["wall-like", "wall-comment", "wall-feature", "wall-delete"].includes(b.action)) {
    const k = `wall:${cid(b.id)}`, p = await store.get(k);
    if (!p) return json(404, { ok: false, error: "Post not found." });
    if (b.action === "wall-like") { p.likes = p.likes || {}; if (p.likes[uid]) delete p.likes[uid]; else p.likes[uid] = t; }
    if (b.action === "wall-comment") { const text = str(b.text, 600); if (text.length < 2) return json(400, { ok: false, error: "Write a comment." }); p.comments = (p.comments || []).concat([{ by: me, text, t }]).slice(-100); }
    if (b.action === "wall-feature") { if (!isAdmin) return adminOnly(); p.featured = !p.featured; }
    if (b.action === "wall-delete") { if (!isAdmin && !sameUser(p.by, me)) return json(403, { ok: false, error: "Only the author or an admin can delete." }); await store.delete(k); return json(200, { ok: true }); }
    await store.set(k, p);
    return json(200, { ok: true, likeCount: Object.keys(p.likes || {}).length, liked: !!(p.likes || {})[uid], comments: p.comments, featured: p.featured });
  }
  if (b.action === "wall-photo") {
    const p = await store.get(`wall:${cid(b.id)}`), pid = cid(b.photo);
    if (!p || !(p.photos || []).includes(pid)) return json(404, { ok: false, error: "Not found." });
    const f = await store.get(`att:${pid}`);
    return f ? json(200, { ok: true, mime: f.mime, data: f.data }) : json(404, { ok: false, error: "Not found." });
  }

  // ---------------- recognition + people points ----------------
  if (b.action === "recog-list") return json(200, { ok: true, items: (await listOf("recog:")).sort((x, y) => String(y.month).localeCompare(String(x.month)) || y.createdAt - x.createdAt) });
  if (b.action === "recog-save") {
    if (!isAdmin) return adminOnly();
    const r = b.item || {}, name = str(r.name, 80);
    if (!name) return json(400, { ok: false, error: "Enter the name." });
    const id = cid(r.id) || nid(t);
    const ph = r.photo ? (await attOk([r.photo], 1))[0] || str(r.photo, 30) : "";
    await store.set(`recog:${id}`, { id, month: /^\d{4}-\d{2}$/.test(String(r.month || "")) ? r.month : new Date(t + 5.5 * 3600000).toISOString().slice(0, 7), title: str(r.title, 60) || "Star of the month", name, role: str(r.role, 60), state: str(r.state, 40), reason: str(r.reason, 400), photo: ph, by: rec.fullName, createdAt: t });
    return json(200, { ok: true, id });
  }
  if (b.action === "recog-delete") { if (!isAdmin) return adminOnly(); await store.delete(`recog:${cid(b.id)}`); return json(200, { ok: true }); }
  if (b.action === "recog-photo") {
    const r = await store.get(`recog:${cid(b.id)}`); if (!r || !r.photo) return json(404, { ok: false, error: "No photo." });
    const f = await store.get(`att:${r.photo}`); return f ? json(200, { ok: true, mime: f.mime, data: f.data }) : json(404, { ok: false, error: "No photo." });
  }
  // People leaderboard for a month: quiz points + valid visits + best practices + likes received
  if (b.action === "people-board") {
    const month = /^\d{4}-\d{2}$/.test(String(b.month || "")) ? b.month : new Date(t + 5.5 * 3600000).toISOString().slice(0, 7);
    const inM = (ts) => new Date(ts + 5.5 * 3600000).toISOString().slice(0, 7) === month;
    const P = {}, pk = (u) => (u.app + ":" + String(u.username).toLowerCase());
    const add = (u, k, n) => { if (!u || !u.username) return; const id = pk(u); const p = P[id] = P[id] || { user: { app: u.app, username: u.username, fullName: u.fullName, state: u.state || "" }, quiz: 0, visits: 0, practices: 0, likes: 0, points: 0 }; p[k] += n; };
    (await listOf("qatt:")).filter((a) => inM(a.at)).forEach((a) => add(a.user, "quiz", a.score * 2 + (a.passed ? 5 : 0)));
    (await listOf("wall:")).filter((w) => inM(w.createdAt)).forEach((w) => { add(w.by, "practices", 1); add(w.by, "likes", Object.keys(w.likes || {}).length); });
    const vks = (await store.list(`visit:${month.replace("-", "")}:`));
    (await pool(vks, 40, (k) => store.get(k))).filter((v) => v && v.status === "closed" && v.valid).forEach((v) => add(Object.assign({ state: v.state }, v.by), "visits", 1));
    const rows = Object.values(P).map((p) => Object.assign(p, { points: p.quiz + p.visits * 3 + p.practices * 10 + p.likes * 2 })).sort((x, y) => y.points - x.points);
    return json(200, { ok: true, month, rows: rows.slice(0, 200), rule: "Points = quiz (2 per correct answer, +5 if passed) + 3 per valid market visit + 10 per best practice shared + 2 per like received" });
  }

  if (b.action === "engage-notify") {
    const qs = (await listOf("quiz:")).filter((q) => q.status === "live" && (!q.closesAt || t < q.closesAt));
    let quizNew = 0; for (const q of qs) if (!(await store.get(`qatt:${q.id}:${uid}`))) quizNew++;
    const ps = (await listOf("poll:")).filter((p) => p.status === "live" && (!p.closesAt || t < p.closesAt) && (isAdmin || !p.states || !p.states.length || p.states.includes(rec.state || "")));
    let pollNew = 0; for (const p of ps) if (!(await store.get(`pvote:${p.id}:${uid}`))) pollNew++;
    return json(200, { ok: true, quizNew: isAdmin ? 0 : quizNew, pollNew });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
