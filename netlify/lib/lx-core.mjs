// Five AI work tools on one module:
//   dx-  PDF / photo → Excel extractor        dx:t:<id>                    saved column templates (shared)
//   cs-  Circular studio (lesson + quiz, what changed)
//        cs:l:<id> lesson { id, title, langs:{en:{…},hi:{…}}, states:[]|["all"], pub, by, at }   cs:d:<id>:<userKey> { score, total, lang, at, name, state }
//   vg-  Process video → step-by-step guide   vg:g:<id> { id, title, lang, n, intro, by, owner, at, shared, token }   vg:i:<id>:<n> { img, title, text }   vg:tok:<token> → id
//   rpl- AI role-play trainer                 rpl:c:<id> custom scenario (HO)   rpl:s:<userKey>:<id> scored session
//   bot- Portal task recorder (storage)       bot:r:<userKey>:<id> recording   bot:x:<userKey>:<runId> run result
import { randomBytes } from "node:crypto";
import { readImages } from "./schemecalc-core.mjs";
import { aiKeys } from "./aff-core.mjs";
import { ALL_STATES, defaultLang, LANGS, gas } from "./sf-core.mjs";
import { createHash, createHmac } from "node:crypto";

// ---- quiz timing + score: the server signs the start time, so the time taken can't be faked
const SC_DEF = { secPerQ: 30, limitPerQ: 60, wAcc: 80, wTime: 20, minAcc: 50 };
async function scCfg(store) { return Object.assign({}, SC_DEF, (await store.get("cs:scorecfg")) || {}); }
async function hkey(store) { let k = await store.get("cs:hkey"); if (!k) { k = { k: randomBytes(24).toString("hex") }; await store.set("cs:hkey", k); } return k.k; }
async function startTok(store, id, who, t) { const k = await hkey(store); return t.toString(36) + "." + createHmac("sha256", k).update(id + "|" + who + "|" + t).digest("base64url").slice(0, 22); }
async function tookSecs(store, tok, id, who, t) {   // seconds from the quiz opening to submit, or null if no / bad token
  const [a, sig] = String(tok || "").split("."), st = parseInt(a, 36); if (!st || !sig) return null;
  const k = await hkey(store); if (createHmac("sha256", k).update(id + "|" + who + "|" + st).digest("base64url").slice(0, 22) !== sig) return null;
  const s = Math.round((t - st) / 1000); return s >= 0 && s < 86400 ? s : null;
}
// points out of 100: accuracy weight + speed weight (speed counts only when accuracy reaches the minimum); no time → accuracy only, scaled to 100
function points(C, score, total, secs) {
  const acc = total ? score / total : 0; if (secs == null) return Math.round(acc * 100);
  const tgt = C.secPerQ * total, lim = C.limitPerQ ? C.limitPerQ * total : 0;
  let sp = 0; if (acc * 100 >= C.minAcc) sp = secs <= tgt ? 1 : lim && lim > tgt ? Math.max(0, (lim - secs) / (lim - tgt)) : Math.min(1, tgt / secs);
  const W = (+C.wAcc || 0) + (+C.wTime || 0) || 100; return Math.round((C.wAcc * acc + C.wTime * sp) / W * 100);
}
const better = (n, o) => !o || n.points > (o.points ?? -1) || (n.points === o.points && n.score > o.score);
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const parse = (s) => { try { return JSON.parse(String(s).replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "")); } catch (e) { return null; } };
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const isImg = (s) => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]{100,}$/.test(String(s || "")) && String(s).length < 2600000;
const list = (a, n) => (Array.isArray(a) ? a : []).slice(0, n);
const LN = { en: "simple Indian English", hi: "simple Hindi (Devanagari)", bn: "Bengali", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", mr: "Marathi", gu: "Gujarati", pa: "Punjabi", or: "Odia", as: "Assamese" };

async function ai(ctx, system, data, opt) {
  const r = await ctx.askAI(ctx.env || {}, "Follow the instructions and answer now.", data, [], ctx.aiFetch, Object.assign({ system, label: "INPUT", json: true, maxTokens: 4000 }, opt || {}));
  if (!r.ok) return { ok: false, error: r.error || "AI didn't answer — try again." };
  if (opt && opt.json === false) return { ok: true, text: String(r.text || "") };
  const j = parse(r.text); return j ? { ok: true, j } : { ok: false, error: "The AI answer wasn't readable — try again." };
}
async function see(ctx, imgs, prompt, opt) {
  const keys = await aiKeys(ctx.store, ctx.env || {});
  const r = await readImages(keys, ctx.env || {}, imgs, ctx.aiFetch, prompt, Object.assign({ timeout: 40000, maxModels: 3, prefer: "gemini" }, opt || {}));
  return r.ok ? { ok: true, text: r.text } : { ok: false, error: "Couldn't read the picture: " + String(r.error || "").slice(0, 160) };
}

// ---------------- dx: PDF / photo → Excel ----------------
const cleanTable = (t) => {
  const cols = list(t && t.columns, 40).map((c) => str(c, 60)).filter(Boolean); if (!cols.length) return null;
  const rows = list(t.rows, 800).map((r) => (Array.isArray(r) ? r : cols.map((c) => r && r[c])).slice(0, cols.length).map((v) => (v == null ? "" : typeof v === "number" ? v : str(v, 300))));
  return { title: str(t.title, 80), columns: cols, rows: rows.filter((r) => r.some((v) => v !== "")) };
};
async function dx(b, ctx) {
  const { store, t, app } = ctx;
  if (b.action === "dx-tpls") { const L = (await ctx.pool(await store.list("dx:t:"), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name)); return J(200, { ok: true, rows: L }); }
  if (b.action === "dx-tpl-save") { const cols = list(b.cols, 40).map((c) => ({ name: str(c.name, 60), hint: str(c.hint, 120) })).filter((c) => c.name); if (!str(b.name, 60) || !cols.length) return J(400, { ok: false, error: "Give the template a name and at least one column" }); const id = str(b.id, 20) || nid(t); await store.set("dx:t:" + id, { id, name: str(b.name, 60), hint: txt(b.hint, 600), cols, by: ctx.by, at: t }); return J(200, { ok: true, id }); }
  if (b.action === "dx-tpl-del") { const x = await store.get("dx:t:" + str(b.id, 20)); if (x && x.by !== ctx.by && app !== "admin") return J(403, { ok: false, error: "Only its maker or HO can delete it" }); await store.delete("dx:t:" + str(b.id, 20)); return J(200, { ok: true }); }
  if (b.action !== "dx-page") return J(400, { ok: false, error: "Unknown action" });
  const cols = list(b.cols, 40).map((c) => (typeof c === "string" ? { name: str(c, 60) } : { name: str(c.name, 60), hint: str(c.hint, 120) })).filter((c) => c.name), hint = txt(b.hint, 600);
  const want = cols.length ? "Return ONE table with exactly these columns in this order: " + cols.map((c) => '"' + c.name + '"' + (c.hint ? " (" + c.hint + ")" : "")).join(", ") + ". Leave a cell empty if the page does not show it." : 'Find every table or list of records on the page and return each as a table with clear column names. Also turn key-value details (invoice no, date, totals, party name) into a one-row table called "Details".';
  const sys = "You extract data from business documents (Indian context: ₹ amounts, dates as written, GSTIN, IMEI, model names, dealer codes) into spreadsheet tables. " + want + (hint ? " User note: " + hint : "") + ' Copy values exactly; numbers without currency symbols or thousands separators (e.g. 12500.50); dates as YYYY-MM-DD when unambiguous. Do not invent rows. Reply with JSON only: {"tables":[{"title":"…","columns":["…"],"rows":[["…"]]}],"notes":"anything unclear, short"}';
  let res;
  if (isImg(b.img)) {
    const r = await see(ctx, [b.img], sys + "\n\nThe image is one page of the document.", { accept: (x) => /"tables"/.test(x) });
    if (r.ok) { const j = parse(r.text); if (j) res = { ok: true, j }; }
    if (!res) { const r2 = await see(ctx, [b.img], "Write out ALL text on this page exactly, keeping each table row on its own line with cells separated by ' | '. Text only."); if (!r2.ok) return J(502, { ok: false, error: r2.error }); res = await ai(ctx, sys, r2.text.slice(0, 14000), { maxTokens: 6000 }); }
  } else {
    const tx = txt(b.text, 16000); if (tx.length < 5) return J(400, { ok: false, error: "This page has no readable text" });
    res = await ai(ctx, sys, tx, { maxTokens: 6000 });
  }
  if (!res.ok) return J(502, { ok: false, error: res.error });
  const tables = list(res.j.tables, 12).map(cleanTable).filter(Boolean);
  return J(200, { ok: true, tables, notes: str(res.j.notes, 300) });
}

// ---------------- cs: circular studio ----------------
const cleanLesson = (j) => ({
  title: str(j.title, 120) || "Lesson", summary: txt(j.summary, 14000), keypoints: list(j.keypoints, 10).map((x) => str(x, 240)).filter(Boolean),
  cards: list(j.cards, 10).map((c) => ({ title: str(c && c.title, 100), body: txt(c && c.body, 900) })).filter((c) => c.title || c.body),
  flash: list(j.flash, 14).map((c) => ({ q: str(c && c.q, 200), a: str(c && c.a, 300) })).filter((c) => c.q && c.a),
  quiz: list(j.quiz, 12).map((q) => { const o = list(q && q.options, 5).map((x) => str(x, 160)).filter(Boolean); const a = Math.round(+(q && q.answer)); return { q: str(q && q.q, 300), options: o, answer: a >= 0 && a < o.length ? a : 0, why: str(q && q.why, 300) }; }).filter((q) => q.q && q.options.length >= 2)
});
const LESSON = '{"title":"…","summary":"THE CASE STUDY: 3-6 short paragraphs separated by blank lines (see rules)","keypoints":["the 5-8 facts people must remember: dates, slabs, amounts, eligibility, how to claim"],"cards":[{"title":"…","body":"a short teaching card, 2-5 sentences or bullet lines"}],"flash":[{"q":"…","a":"…"}],"quiz":[{"q":"…","options":["…","…","…","…"],"answer":0,"why":"one line"}]}';
const canSee = (x, ho, rec) => ho || (x.pub && (x.states.includes("all") || x.states.includes(rec.state)));
async function cs(b, ctx) {
  const { store, t, app, rec, uk } = ctx, ho = app === "admin";
  if (b.action === "cs-meta") return J(200, { ok: true, langs: Object.fromEntries(Object.keys(LN).map((k) => [k, LANGS[k] || k])), states: ALL_STATES, defaults: Object.fromEntries(ALL_STATES.map((x) => [x, defaultLang(x)])), mine: defaultLang(String(rec.state || "")) });
  if (b.action === "cs-scorecfg") {
    const C = await scCfg(store);
    if (b.save) { if (!ho) return J(403, { ok: false, error: "HO only" }); const n = (v, lo, hi, d) => { v = Math.round(+v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
      const N = { secPerQ: n(b.cfg.secPerQ, 5, 600, 30), limitPerQ: n(b.cfg.limitPerQ, 0, 1200, 60), wAcc: n(b.cfg.wAcc, 0, 100, 80), wTime: n(b.cfg.wTime, 0, 100, 20), minAcc: n(b.cfg.minAcc, 0, 100, 50) };
      if (N.limitPerQ && N.limitPerQ < N.secPerQ) N.limitPerQ = N.secPerQ; await store.set("cs:scorecfg", N); return J(200, { ok: true, cfg: N }); }
    return J(200, { ok: true, cfg: C });
  }
  if (b.action === "cs-job") { const j = await store.get("cs:job:" + str(b.job, 30)); return j ? J(200, { ok: true, job: Object.assign({}, j, { input: undefined }) }) : J(404, { ok: false, error: "Job not found" }); }
  if (b.action === "cs-ocr" || b.action === "cs-lesson" || b.action === "cs-tr") {   // long AI work runs as a background job; the page polls cs-job
    const kind = b.action.slice(3), input = kind === "ocr" ? { imgs: list(b.imgs || (b.img ? [b.img] : []), 4).filter(isImg) } : kind === "lesson" ? { text: txt(b.text, 30000), audience: str(b.audience, 60), nq: +b.nq || 6 } : { lang: str(b.lang, 4), lesson: b.lesson || {} };
    if (kind === "ocr" && !input.imgs.length) return J(400, { ok: false, error: "No picture" });
    if (kind === "lesson" && input.text.length < 80) return J(400, { ok: false, error: "The circular text is too short — add more pages" });
    if (kind === "tr" && (!LN[input.lang] || input.lang === "en")) return J(400, { ok: false, error: "Choose a language" });
    return startCsJob(ctx, { kind, input });
  }
  if (b.action === "cs-diff") {
    const o = txt(b.old, 14000), n = txt(b.new, 14000); if (o.length < 40 || n.length < 40) return J(400, { ok: false, error: "Add both the old and the new circular" });
    const sys = 'You compare two versions of a vivo India business circular (OLD then NEW). List EVERY real change in meaning — slabs, amounts, percentages, dates / validity, eligible models, eligible partners or regions, conditions, claim process, deadlines, exclusions — and anything added or removed. Ignore pure wording or formatting changes. Quote exact values. Reply with JSON only: {"summary":"2-3 sentences: the most important changes","changes":[{"area":"e.g. Slab 2 payout","type":"changed|added|removed","before":"old value / text or empty","after":"new value / text or empty","impact":"who is affected and how, one line","important":true}],"same":["key things that did NOT change, max 5"],"check":["anything ambiguous to confirm with the circular owner"]}';
    const r = await ai(ctx, sys, "=== OLD CIRCULAR ===\n" + o + "\n\n=== NEW CIRCULAR ===\n" + n, { maxTokens: 5000, label: "CIRCULARS" }); if (!r.ok) return J(502, { ok: false, error: r.error });
    const j = r.j; return J(200, { ok: true, diff: { summary: txt(j.summary, 800), changes: list(j.changes, 60).map((c) => ({ area: str(c.area, 120), type: ["changed", "added", "removed"].includes(c.type) ? c.type : "changed", before: txt(c.before, 500), after: txt(c.after, 500), impact: str(c.impact, 300), important: !!c.important })), same: list(j.same, 8).map((x) => str(x, 200)), check: list(j.check, 8).map((x) => str(x, 240)) } });
  }
  if (b.action === "cs-save") {
    if (!ho) return J(403, { ok: false, error: "Only HO can save lessons" });
    const id = str(b.id, 20) || nid(t), old = await store.get("cs:l:" + id), langs = {};
    Object.keys(b.langs || {}).slice(0, 13).forEach((L) => { if (LN[L]) langs[L] = cleanLesson(b.langs[L]); }); if (!langs.en) return J(400, { ok: false, error: "The English lesson is missing" });
    const states = list(b.states, 40).map((s) => str(s, 40)).filter(Boolean);
    const x = { id, title: langs.en.title, langs, states: states.length ? states : ["all"], pub: !!b.pub, by: old ? old.by : ctx.by, at: old ? old.at : t, upd: t, src: txt(b.src, 20000) || (old && old.src) || "" };
    if (JSON.stringify(x).length > 4500000) return J(413, { ok: false, error: "Lesson too big" });
    await store.set("cs:l:" + id, x); return J(200, { ok: true, id });
  }
  if (b.action === "cs-list") {
    const L = (await ctx.pool(await store.list("cs:l:"), 20, (k) => store.get(k))).filter(Boolean).filter((x) => canSee(x, ho, rec)).sort((x, y) => y.upd - x.upd).slice(0, 150);
    const mine = ho ? {} : Object.fromEntries((await ctx.pool(L.map((x) => "cs:d:" + x.id + ":" + uk), 20, (k) => store.get(k))).map((d, i) => [L[i].id, d]).filter((p) => p[1]));
    const counts = {}; if (ho) for (const x of L) counts[x.id] = (await store.list("cs:d:" + x.id + ":")).length;
    return J(200, { ok: true, rows: L.map((x) => ({ id: x.id, title: x.title, langs: Object.keys(x.langs), states: x.states, pub: x.pub, by: x.by, upd: x.upd, n: x.langs.en.quiz.length, done: counts[x.id], mine: mine[x.id] ? { score: mine[x.id].score, total: mine[x.id].total } : null })) });
  }
  const x = await store.get("cs:l:" + str(b.id, 20)); if (!x) return J(404, { ok: false, error: "Lesson not found" });
  if (!canSee(x, ho, rec)) return J(403, { ok: false, error: "This lesson is not for your state" });
  if (b.action === "cs-get") { const d = ho ? null : await store.get("cs:d:" + x.id + ":" + uk); return J(200, { ok: true, l: Object.assign({}, x, { src: ho ? x.src : undefined, gforms: undefined, forms: ho ? Object.fromEntries(Object.entries(x.gforms || {}).map(([L, g]) => [L, g.shortUrl || g.url])) : undefined, token: ho ? x.token || "" : undefined }), mine: d }); }
  if (b.action === "cs-start") { const C = await scCfg(store); return J(200, { ok: true, st: await startTok(store, x.id, uk, t), secPerQ: C.secPerQ, limitPerQ: C.limitPerQ }); }
  if (b.action === "cs-done") {
    const L = LN[b.lang] && x.langs[b.lang] ? b.lang : "en", Q = x.langs[L].quiz, ans = list(b.answers, Q.length), score = Q.reduce((a, q, i) => a + (ans[i] != null && +ans[i] === q.answer ? 1 : 0), 0);
    const secs = await tookSecs(store, b.st, x.id, uk, t);
    if (ho) return J(200, { ok: true, test: true, score, total: Q.length, secs });
    const C = await scCfg(store), pts = points(C, score, Q.length, secs);
    const k = "cs:d:" + x.id + ":" + uk, old = await store.get(k), cur = { score, secs, points: pts };
    const keep = better(cur, old) ? cur : { score: old.score, secs: old.secs, points: old.points ?? points(C, old.score, old.total, old.secs) };
    const d = { score: keep.score, secs: keep.secs, points: keep.points, last: score, lastSecs: secs, total: Q.length, lang: L, at: t, tries: (old ? old.tries : 0) + 1, name: rec.fullName || rec.username, state: rec.state || "HO", first: old ? old.first : t };
    await store.set(k, d); return J(200, { ok: true, score, total: Q.length, secs, best: d.score });
  }
  if (b.action === "cs-stats") {
    if (!ho) return J(403, { ok: false, error: "HO only" });
    const C = await scCfg(store), P = (d) => points(C, d.score, d.total, d.secs);   // points use today's scoring settings
    const R = (await ctx.pool(await store.list("cs:d:" + x.id + ":"), 30, (k) => store.get(k))).filter(Boolean).map((d) => ({ src: "App", name: d.name, state: d.state, phone: "", score: d.score, total: d.total, secs: d.secs ?? null, points: P(d), tries: d.tries, lang: d.lang, at: d.at }));
    const W = (await ctx.pool(await store.list("cs:x:" + x.id + ":"), 30, (k) => store.get(k))).filter(Boolean).map((d) => ({ src: "Web link", name: d.name, state: d.state, phone: d.phone || "", score: d.score, total: d.total, secs: d.secs ?? null, points: P(d), tries: d.tries, lang: d.lang, at: d.at }));
    const F = []; Object.values(x.gforms || {}).concat(x.gold || []).forEach((g) => (g.rows || []).forEach((d) => F.push({ src: "Google Form", name: d.name, state: d.state, phone: d.phone, score: d.score, total: d.total, secs: null, points: P({ score: d.score, total: d.total, secs: null }), tries: 1, lang: d.lang, at: Date.parse(String(d.at).replace(" ", "T") + ":00+05:30") || 0 })));
    return J(200, { ok: true, scoring: C, rows: R.concat(W, F).sort((p, q) => q.points - p.points || q.at - p.at), forms: Object.fromEntries(Object.entries(x.gforms || {}).map(([L, g]) => [L, { url: g.shortUrl || g.url, edit: g.editUrl, pulled: g.pulled || 0, n: (g.rows || []).length, quiz: !!g.quiz }])), token: x.token || "" });
  }
  if (b.action === "cs-share") {   // public web link: anyone with it reads the case study and takes the quiz after typing name + state
    if (!ho) return J(403, { ok: false, error: "HO only" });
    if (b.on && !x.token) { x.token = randomBytes(10).toString("base64url"); await store.set("cs:tok:" + x.token, { id: x.id }); }
    if (!b.on && x.token) { await store.delete("cs:tok:" + x.token); x.token = ""; }
    await store.set("cs:l:" + x.id, x); return J(200, { ok: true, token: x.token || "" });
  }
  if (b.action === "cs-gform") {   // build a Google Form (name, state, mobile + the quiz) in one language — runs as a background job
    if (!ho) return J(403, { ok: false, error: "HO only" });
    const cfg = (await store.get("sf:cfg")) || {}; if (!cfg.gasUrl || !cfg.gasKey) return J(400, { ok: false, error: "Google Forms is not connected yet — connect it once in 📝 Survey & poll creator → Set-up." });
    return startCsJob(ctx, { kind: "form", lid: x.id, lang: x.langs[b.lang] ? b.lang : "en" });
  }
  if (b.action === "cs-gres") {   // pull Google Form answers, mark them, keep them with the lesson
    if (!ho) return J(403, { ok: false, error: "HO only" });
    const cfg = (await store.get("sf:cfg")) || {}, G = x.gforms || {}; let n = 0; const errs = [];
    for (const L of Object.keys(G)) {
      const g = G[L], r = await gas(cfg, { action: "results", id: g.id, max: 3000 }, ctx.aiFetch || fetch);
      if (!r || !r.ok) { errs.push(LN[L] ? L : "en"); continue; }
      const Q = x.langs[L].quiz, base = 5;   // Submitted at, E-mail, Name, State, Mobile, then the questions in order
      g.rows = (r.rows || []).map((row) => { const sc = Q.reduce((a, q, i) => a + (String(row[base + i] || "").trim() === q.options[q.answer] ? 1 : 0), 0); return { at: row[0], name: str(row[2], 80), state: str(row[3], 40), phone: str(row[4], 15), score: sc, total: Q.length, lang: L }; });
      g.pulled = t; n += g.rows.length;
    }
    x.gforms = G; await store.set("cs:l:" + x.id, x); return J(200, { ok: true, n, errs });
  }
  if (b.action === "cs-del") { if (!ho) return J(403, { ok: false, error: "HO only" }); if (x.token) await store.delete("cs:tok:" + x.token); for (const k of await store.list("cs:x:" + x.id + ":")) await store.delete(k); for (const k of await store.list("cs:d:" + x.id + ":")) await store.delete(k); await store.delete("cs:l:" + x.id); return J(200, { ok: true }); }
  return J(400, { ok: false, error: "Unknown action" });
}

async function startCsJob(ctx, o) {
  const t = Date.now(), jid = t.toString(36) + randomBytes(3).toString("hex");
  await ctx.store.set("cs:job:" + jid, Object.assign({ id: jid, state: "queued", at: t, msg: "Starting…" }, o));
  const site = ctx.env && (ctx.env.SITE_URL || ctx.env.URL);
  if (site && ctx.jobFetch) { try { await ctx.jobFetch(site + "/.netlify/functions/csjob-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: jid }) }); return J(200, { ok: true, job: jid }); } catch (e) { } }
  await runCsJob(ctx.store, jid, ctx.aiFetch, ctx.env, ctx.askAI);   // no background runner (local) → do it now
  return J(200, { ok: true, job: jid });
}
async function makeLesson(c, text, audience, nq) {
  nq = Math.max(3, Math.min(10, +nq || 6));
  const sys = "You turn a vivo India business circular (scheme, policy, launch, process) into a lesson for " + (audience || "retailers, promoters and the sales team") + ". Use ONLY facts from the circular — every number, date, slab, model, partner and condition must match it exactly; never invent rules or numbers. Write in simple Indian English.\n" +
    "SUMMARY = A DETAILED CASE STUDY of 600-1000 words in 6-10 paragraphs separated by a blank line. Tell a realistic story — e.g. a retailer, promoter or FSE in a named Indian town who reads this circular and applies it over a few days to real customers and orders. The story must carry EVERY rule of the circular in full: each slab with its exact range and amount, each eligible and excluded model / partner / region, the validity dates, conditions, deadlines, how and where to claim, and what happens if a rule is broken. Where the circular has a table, walk through every row inside the story. Explain WHY each rule matters. Do not leave any fact needed for the quiz outside the case study.\n" +
    "QUIZ: exactly " + nq + " questions, 4 options each, one correct, each tied to one or more paragraphs of the case study. Every answer must be fully supported by the case study, but must NOT be a copy of one of its sentences: ask the reader to APPLY the rules — calculate a payout for a new quantity, decide if a different model / date / partner qualifies, spot the mistake in a claim, choose the right next step, combine facts from two paragraphs. Wrong options must be plausible (common mistakes, the neighbouring slab, a nearby date). 'why' explains the reasoning in one or two lines and names the paragraph.\n" +
    "Also: 6-10 keypoints (the exact rules to remember), 5-8 teaching cards (title + 3-6 lines each, covering every rule) and 8-12 flash cards (question → short answer). Reply with JSON only: " + LESSON;
  const r = await ai(c, sys, text, { maxTokens: 9000, label: "CIRCULAR" });
  if (!r.ok) return r;
  const l = cleanLesson(r.j);
  if (l.summary.split(/\s+/).length < 250) {   // too thin → ask once more for a longer story
    const r2 = await ai(c, sys + "\nYour previous case study was far too short. Write the full 600-1000 word case study this time.", text, { maxTokens: 9000, label: "CIRCULAR" });
    if (r2.ok) { const l2 = cleanLesson(r2.j); if (l2.summary.length > l.summary.length && l2.quiz.length) return { ok: true, lesson: l2 }; }
  }
  return { ok: true, lesson: l };
}
async function translateLesson(c, L, lesson) {
  const base = cleanLesson(lesson || {}), out = {};
  const parts = [{ title: base.title, summary: base.summary }, { keypoints: base.keypoints, cards: base.cards }, { flash: base.flash, quiz: base.quiz.map((q) => ({ q: q.q, options: q.options, why: q.why })) }];
  for (const sub of parts) {
    const r = await ai(c, "Translate this JSON into " + LN[L] + " in the native script, using everyday words people in that state use. Keep numbers, ₹ amounts, dates, model and scheme names unchanged. Keep exactly the same JSON keys and structure, the same number of items and options, in the same order, and the same paragraph breaks. Reply with JSON only.", JSON.stringify(sub), { maxTokens: 9000, label: "JSON" });
    if (!r.ok) return r;
    Object.assign(out, r.j);
  }
  const tr = cleanLesson(Object.assign({ title: base.title }, out));
  tr.quiz = base.quiz.map((q, i) => { const x = list(out.quiz, 12)[i] || {}, o = list(x.options, 5).map((v) => str(v, 160)); return { q: str(x.q, 300) || q.q, options: o.length === q.options.length ? o : q.options, answer: q.answer, why: str(x.why, 300) || q.why }; });
  if (tr.flash.length !== base.flash.length) tr.flash = base.flash;
  if (!tr.summary) tr.summary = base.summary;
  return { ok: true, lesson: tr };
}
export async function runCsJob(store, jid, f, env, askAI) {
  const job = await store.get("cs:job:" + jid); if (!job || job.state !== "queued") return;
  const up = async (o) => { Object.assign(job, o); await store.set("cs:job:" + jid, job); };
  const c = { store, env: env || {}, aiFetch: f || fetch, askAI };
  try {
    if (job.kind === "ocr") {
      await up({ state: "run", msg: "Reading the page…" });
      const r = await see(c, job.input.imgs, "These are pages of a business circular / policy. Write out ALL the text exactly, top to bottom, page by page; keep every table as rows with cells separated by ' | '. Text only.", { accept: (x) => x.trim().length > 30, timeout: 90000 });
      return up(r.ok ? { state: "done", msg: "Ready", text: r.text.slice(0, 30000), input: null } : { state: "err", msg: r.error, input: null });
    }
    if (job.kind === "lesson") {
      await up({ state: "run", msg: "Writing the case study, lesson and quiz…" });
      const r = await makeLesson(c, job.input.text, job.input.audience, job.input.nq);
      return up(r.ok ? { state: "done", msg: "Ready", lesson: r.lesson, input: null } : { state: "err", msg: r.error, input: null });
    }
    if (job.kind === "tr") {
      await up({ state: "run", msg: "Translating into " + (LANGS[job.input.lang] || job.input.lang) + "…" });
      const r = await translateLesson(c, job.input.lang, job.input.lesson);
      return up(r.ok ? { state: "done", msg: "Ready", lesson: r.lesson, input: null } : { state: "err", msg: r.error, input: null });
    }
    // Google Form: details → read-first pages (case study, remember, lesson, flash cards) → quiz scored by Google
    await up({ state: "run", msg: "Building the Google Form…" });
    const x = await store.get("cs:l:" + job.lid), cfg = (await store.get("sf:cfg")) || {}; if (!x) return up({ state: "err", msg: "Lesson not found" });
    const L = job.lang, X = x.langs[L] || x.langs.en, paras = X.summary.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const ping = await gas(cfg, { action: "ping" }, f || fetch), quizOk = ping && ping.ok && +ping.version >= 4;
    const info = (title, help) => ({ id: "i" + Math.random().toString(36).slice(2, 8), type: "info", title, help: String(help || "").slice(0, 4000) });
    const caseItems = []; let chunk = "", n = 1;
    paras.forEach((p) => { if ((chunk + "\n\n" + p).length > 3500 && chunk) { caseItems.push(info("📖 Case study — part " + n++, chunk)); chunk = p; } else chunk = chunk ? chunk + "\n\n" + p : p; });
    if (chunk) caseItems.push(info(caseItems.length ? "📖 Case study — part " + n : "📖 Case study", chunk));
    const learn = caseItems.concat(
      X.keypoints.length ? [info("📌 Remember", X.keypoints.map((k) => "• " + k).join("\n"))] : [],
      X.cards.map((cd, i) => info("📚 Lesson " + (i + 1) + ": " + cd.title, cd.body)),
      X.flash.length ? [info("🃏 Flash cards", X.flash.map((fl) => "Q: " + fl.q + "\nA: " + fl.a).join("\n\n"))] : []);
    const survey = {
      title: X.title + " — lesson & quiz", description: "1) Fill in your details.  2) Read the case study, key points, lessons and flash cards carefully.  3) Answer the quiz — every answer comes from what you read." + (quizOk ? " Your score is shown right after you submit." : ""),
      confirmation: "Thank you! " + (quizOk ? "Tap “View score” to see your result and the right answers." : "Your answers are recorded."), settings: { progressBar: true, isQuiz: quizOk },
      sections: [
        { id: "s1", title: "Your details", questions: [{ id: "n", type: "short", title: "Your name", required: true }, { id: "st", type: "dropdown", title: "State", options: ALL_STATES.concat(["Other"]), required: true }, { id: "ph", type: "phone", title: "Mobile number (optional)" }] },
        { id: "s2", title: "Read carefully", description: "Read everything on this page before you go to the quiz.", questions: learn },
        { id: "s3", title: "Quiz", description: "Choose one answer for each question. Scroll back to re-read the case study if you need to.", questions: X.quiz.map((q, i) => ({ id: "q" + i, type: "single", title: (i + 1) + ". " + q.q, options: q.options, required: true, correct: quizOk ? q.options[q.answer] : undefined, points: 1, why: q.why })) }]
    };
    const r = await gas(cfg, { action: "create", survey, opts: {} }, f || fetch);
    if (!r || !r.ok) return up({ state: "err", msg: (r && r.error) || "Google didn't answer" });
    x.gforms = x.gforms || {}; const oldF = x.gforms[L]; x.gforms[L] = { id: r.id, url: r.url, shortUrl: r.shortUrl, editUrl: r.editUrl, at: Date.now(), rows: [], quiz: quizOk };
    if (oldF && (oldF.rows || []).length) { x.gold = x.gold || []; x.gold.push(Object.assign({}, oldF, { lang: L })); x.gold = x.gold.slice(-6); }   // answers of a rebuilt form stay in Who finished
    await store.set("cs:l:" + x.id, x);
    await up({ state: "done", msg: quizOk ? "Ready" : "Ready — update the Google connector to show scores in the form", url: r.shortUrl || r.url, edit: r.editUrl, quiz: quizOk });
  } catch (e) { await up({ state: "err", msg: String(e.message || e).slice(0, 200), input: null }); }
}
export async function csPublic(b, { store, t }) {
  const k = str(b.k, 40), tk = k ? await store.get("cs:tok:" + k) : null, x = tk ? await store.get("cs:l:" + tk.id) : null;
  if (!x || x.token !== k) return J(404, { ok: false, error: "This lesson link is not valid or was switched off." });
  if (b.action === "cs-p-get") {
    const langs = {}; Object.keys(x.langs).forEach((L) => { const X = x.langs[L]; langs[L] = { title: X.title, summary: X.summary, keypoints: X.keypoints, cards: X.cards, flash: X.flash, quiz: X.quiz.map((q) => ({ q: q.q, options: q.options })) }; });
    return J(200, { ok: true, l: { title: x.title, langs }, states: ALL_STATES, langNames: Object.fromEntries(Object.keys(x.langs).map((L) => [L, LANGS[L] || L])) });
  }
  if (b.action === "cs-p-start") { const C = await scCfg(store); return J(200, { ok: true, st: await startTok(store, x.id, "pub", t), secPerQ: C.secPerQ, limitPerQ: C.limitPerQ }); }
  if (b.action === "cs-p-done") {
    const name = str(b.name, 80), state = str(b.state, 40), phone = str(b.phone, 15).replace(/\D/g, "");
    if (name.length < 2 || !state) return J(400, { ok: false, error: "Type your name and choose your state" });
    if ((await store.list("cs:x:" + x.id + ":")).length > 20000) return J(429, { ok: false, error: "This quiz is full" });
    const L = x.langs[b.lang] ? b.lang : "en", X = x.langs[L], Q = X.quiz, ans = list(b.answers, Q.length);
    if (!b.timeout && (ans.length < Q.length || ans.some((a) => a == null))) return J(400, { ok: false, error: "Answer every question" });
    const score = Q.reduce((a, q, i) => a + (ans[i] != null && +ans[i] === q.answer ? 1 : 0), 0), secs = await tookSecs(store, b.st, x.id, "pub", t);
    const pid = createHash("sha256").update(name.toLowerCase() + "|" + state + "|" + phone).digest("hex").slice(0, 16), key = "cs:x:" + x.id + ":" + pid, old = await store.get(key);
    const C = await scCfg(store), cur = { score, secs, points: points(C, score, Q.length, secs) }, keep = better(cur, old) ? cur : { score: old.score, secs: old.secs, points: old.points ?? points(C, old.score, old.total, old.secs) };
    await store.set(key, { name, state, phone, score: keep.score, secs: keep.secs, points: keep.points, last: score, lastSecs: secs, total: Q.length, lang: L, at: t, tries: (old ? old.tries : 0) + 1 });
    return J(200, { ok: true, score, total: Q.length, secs, answers: Q.map((q) => q.answer), why: Q.map((q) => q.why), keypoints: X.keypoints });
  }
  return J(400, { ok: false, error: "Unknown action" });
}

// ---------------- vg: process video → guide ----------------
async function vg(b, ctx) {
  const { store, t, app, uk } = ctx, ho = app === "admin";
  if (b.action === "vg-steps") {
    const frames = list(b.frames, 6).filter(isImg); if (!frames.length) return J(400, { ok: false, error: "No frames" });
    const L = LN[b.lang] ? b.lang : "en", from = Math.max(0, Math.round(+b.from || 0));
    const p = "These " + frames.length + " screenshots (in order, numbered " + from + " to " + (from + frames.length - 1) + ") are taken from a screen recording of someone doing a task" + (b.what ? ": " + str(b.what, 200) : "") + ". " + (b.prev ? 'The step before these was: "' + str(b.prev, 200) + '". ' : "") + "For EACH screenshot write the instruction a new user needs at that point — what to tap / type / choose and where it is on the screen (e.g. 'Tap Set Product Permission at the top'), naming buttons and fields exactly as shown. Never copy passwords, OTPs or personal numbers seen on screen. If a screenshot shows nothing new compared with the previous one, mark it skip. Write in " + LN[L] + '. Reply with JSON only: {"steps":[{"frame":' + from + ',"title":"short action, max 8 words","text":"1-3 sentences","skip":false}]}';
    const r = await see(ctx, frames, p, { accept: (x) => /"steps"/.test(x), timeout: 55000 });
    if (!r.ok) return J(502, { ok: false, error: r.error });
    const j = parse(r.text); if (!j) return J(502, { ok: false, error: "The AI answer wasn't readable — try again." });
    return J(200, { ok: true, steps: list(j.steps, 12).map((s, i) => { const f = Math.round(+s.frame); return { frame: f >= from && f < from + frames.length ? f : from + i, title: str(s.title, 90), text: txt(s.text, 600), skip: !!s.skip }; }) });
  }
  if (b.action === "vg-intro") { const r = await ai(ctx, "Write a title and a 2-sentence introduction for a step-by-step guide made from these steps (who it is for, what it achieves) in " + (LN[b.lang] || LN.en) + '. Reply with JSON only: {"title":"…","intro":"…"}', txt(b.steps, 6000), { maxTokens: 600 }); return r.ok ? J(200, { ok: true, title: str(r.j.title, 100), intro: txt(r.j.intro, 500) }) : J(502, { ok: false, error: r.error }); }
  if (b.action === "vg-save") {
    // texts first; the pictures follow one by one with vg-img (one request can't carry 40 screenshots)
    const steps = list(b.steps, 80).filter((s) => s && (s.title || s.text)); if (!steps.length) return J(400, { ok: false, error: "No steps" });
    const id = str(b.id, 20) || nid(t), old = await store.get("vg:g:" + id); if (old && old.owner !== uk && !ho) return J(403, { ok: false, error: "Only its maker can change it" });
    for (let i = 0; i < steps.length; i++) await store.set("vg:i:" + id + ":" + i, { img: isImg(steps[i].img) ? steps[i].img : "", title: str(steps[i].title, 90), text: txt(steps[i].text, 800) });
    for (let i = steps.length; old && i < old.n; i++) await store.delete("vg:i:" + id + ":" + i);
    const g = { id, title: str(b.title, 100) || "Guide", intro: txt(b.intro, 600), lang: LN[b.lang] ? b.lang : "en", n: steps.length, by: old ? old.by : ctx.by, owner: old ? old.owner : uk, at: old ? old.at : t, upd: t, shared: old ? old.shared : true, token: old ? old.token : "" };
    await store.set("vg:g:" + id, g); return J(200, { ok: true, id });
  }
  if (b.action === "vg-list") { const L = (await ctx.pool(await store.list("vg:g:"), 20, (k) => store.get(k))).filter(Boolean).filter((g) => g.owner === uk || g.shared).sort((x, y) => y.upd - x.upd).slice(0, 200); return J(200, { ok: true, rows: L.map((g) => ({ id: g.id, title: g.title, n: g.n, by: g.by, upd: g.upd, mine: g.owner === uk, lang: g.lang, pub: !!g.token })) }); }
  const g = await store.get("vg:g:" + str(b.id, 20)); if (!g) return J(404, { ok: false, error: "Guide not found" });
  if (b.action === "vg-get") { if (g.owner !== uk && !g.shared && !ho) return J(403, { ok: false, error: "Not shared" }); const steps = await ctx.pool(Array.from({ length: g.n }, (_, i) => "vg:i:" + g.id + ":" + i), 10, (k) => store.get(k)); return J(200, { ok: true, g: Object.assign({}, g, { steps: steps.filter(Boolean) }), mine: g.owner === uk }); }
  if (g.owner !== uk && !ho) return J(403, { ok: false, error: "Only its maker can change it" });
  if (b.action === "vg-img") {
    const i = Math.round(+b.i); if (!(i >= 0 && i < g.n) || !isImg(b.img)) return J(400, { ok: false, error: "Bad picture" });
    const k = "vg:i:" + g.id + ":" + i, s = (await store.get(k)) || { title: "", text: "" }; s.img = b.img; await store.set(k, s); return J(200, { ok: true });
  }
  if (b.action === "vg-del") { for (let i = 0; i < g.n; i++) await store.delete("vg:i:" + g.id + ":" + i); if (g.token) await store.delete("vg:tok:" + g.token); await store.delete("vg:g:" + g.id); return J(200, { ok: true }); }
  if (b.action === "vg-share") { if (b.team !== undefined) g.shared = !!b.team; if (b.pub !== undefined) { if (b.pub && !g.token) { g.token = randomBytes(12).toString("base64url"); await store.set("vg:tok:" + g.token, { id: g.id }); } if (!b.pub && g.token) { await store.delete("vg:tok:" + g.token); g.token = ""; } } await store.set("vg:g:" + g.id, g); return J(200, { ok: true, shared: g.shared, token: g.token }); }
  return J(400, { ok: false, error: "Unknown action" });
}
export async function vgPublic(b, { store }) {
  const k = str(b.k, 40), tk = k ? await store.get("vg:tok:" + k) : null; if (!tk) return J(404, { ok: false, error: "This guide link is not valid or was switched off." });
  const g = await store.get("vg:g:" + tk.id); if (!g || g.token !== k) return J(404, { ok: false, error: "This guide link is not valid or was switched off." });
  const steps = []; for (let i = 0; i < g.n; i++) { const s = await store.get("vg:i:" + g.id + ":" + i); if (s) steps.push(s); }
  return J(200, { ok: true, g: { title: g.title, intro: g.intro, lang: g.lang, by: g.by, upd: g.upd, steps } });
}

// ---------------- rpl: AI role-play trainer ----------------
const cleanSc = (s) => ({ id: str(s && s.id, 24), title: str(s && s.title, 80), who: str(s && s.who, 60), you: str(s && s.you, 120), persona: txt(s && s.persona, 1200), goal: txt(s && s.goal, 400), opener: str(s && s.opener, 300), level: ["easy", "medium", "hard"].includes(s && s.level) ? s.level : "medium" });
async function rpl(b, ctx) {
  const { store, t, app, uk, rec } = ctx, ho = app === "admin";
  if (b.action === "rpl-cust") { const L = (await ctx.pool(await store.list("rpl:c:"), 20, (k) => store.get(k))).filter(Boolean); return J(200, { ok: true, rows: L }); }
  if (b.action === "rpl-cust-save") { if (!ho) return J(403, { ok: false, error: "Only HO can add situations" }); const s = cleanSc(b.sc); if (!s.title || !s.persona) return J(400, { ok: false, error: "Add a title and who the AI plays" }); s.id = s.id || "c" + nid(t); await store.set("rpl:c:" + s.id, Object.assign(s, { by: ctx.by, at: t })); return J(200, { ok: true, id: s.id }); }
  if (b.action === "rpl-cust-del") { if (!ho) return J(403, { ok: false, error: "HO only" }); await store.delete("rpl:c:" + str(b.id, 24)); return J(200, { ok: true }); }
  const sc = cleanSc(b.sc), L = LN[b.lang] ? b.lang : "en", hist = list(b.history, 40).map((m) => ({ r: m.r === "me" ? "me" : "ai", t: txt(m.t, 800) })).filter((m) => m.t);
  const convo = hist.map((m) => (m.r === "me" ? "TRAINEE" : "YOU") + ": " + m.t).join("\n");
  if (b.action === "rpl-say") {
    if (!sc.persona) return J(400, { ok: false, error: "Choose a situation" });
    const level = { easy: "Be fairly easy to convince if the trainee is polite and clear.", medium: "Push back realistically; agree only when your concerns are answered well.", hard: "Be tough and sceptical; raise several objections; only agree to an excellent pitch." }[sc.level];
    const sys = "ROLE-PLAY for sales training at vivo India. You play: " + sc.persona + " The trainee is " + (sc.you || "a vivo salesperson") + ". Stay in character as a real person in an Indian phone store / dealer shop; never mention you are an AI or give coaching. Reply in " + LN[L] + (L === "en" ? " (Hinglish is fine if that is how the trainee writes)" : "") + ", 1-3 short spoken sentences. " + level + " Use realistic details (prices in ₹, competitor brands, EMI, exchange). If the conversation has clearly ended (you agree to buy / sign up, or you walk away), end your reply with [END].";
    const r = await ai(ctx, sys, convo || "(The trainee has not spoken yet. Start the conversation with: " + (sc.opener || "a natural opening line") + ")", { json: false, maxTokens: 300, label: "CONVERSATION SO FAR" });
    if (!r.ok) return J(502, { ok: false, error: r.error });
    let say = String(r.text).replace(/^(YOU|AI|Customer|Retailer)\s*:\s*/i, "").trim(); const end = /\[END\]/i.test(say); say = say.replace(/\[END\]/gi, "").trim().slice(0, 600);
    return J(200, { ok: true, say, end });
  }
  if (b.action === "rpl-score") {
    if (hist.filter((m) => m.r === "me").length < 2) return J(400, { ok: false, error: "Talk a bit more before scoring (at least 2 replies)" });
    const sys = "You are a vivo India sales trainer. Score the TRAINEE in this role-play. Situation: " + sc.title + ". Goal for the trainee: " + (sc.goal || "handle the conversation and close") + ". Judge only the trainee's lines. Reply in " + LN[L] + ' with JSON only: {"score":0-100,"result":"closed|progress|lost","parts":{"opening":0-20,"needs":0-20,"product":0-20,"objections":0-20,"closing":0-20},"good":["specific things done well, quote them"],"improve":["specific, actionable"],"better":[{"said":"a trainee line","try":"a better way to say it"}],"summary":"2 sentences"}';
    const r = await ai(ctx, sys, convo, { maxTokens: 1500, label: "TRANSCRIPT" }); if (!r.ok) return J(502, { ok: false, error: r.error });
    const j = r.j, pt = j.parts || {}, P = {}; ["opening", "needs", "product", "objections", "closing"].forEach((k) => { P[k] = Math.max(0, Math.min(20, Math.round(+pt[k] || 0))); });
    const out = { score: Math.max(0, Math.min(100, Math.round(+j.score || Object.values(P).reduce((a, x) => a + x, 0)))), result: ["closed", "progress", "lost"].includes(j.result) ? j.result : "progress", parts: P, good: list(j.good, 6).map((x) => str(x, 240)), improve: list(j.improve, 6).map((x) => str(x, 240)), better: list(j.better, 4).map((x) => ({ said: str(x && x.said, 200), try: str(x && x.try, 240) })), summary: str(j.summary, 400) };
    const id = nid(t); await store.set("rpl:s:" + uk + ":" + id, { id, sc: sc.id, title: sc.title, score: out.score, result: out.result, at: t, name: rec.fullName || rec.username, state: rec.state || "HO", turns: hist.length, lang: L });
    return J(200, { ok: true, r: out });
  }
  if (b.action === "rpl-mine") { const R = (await ctx.pool(await store.list("rpl:s:" + uk + ":"), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 100); return J(200, { ok: true, rows: R }); }
  if (b.action === "rpl-board") { const R = (await ctx.pool(await store.list("rpl:s:"), 30, (k) => store.get(k))).filter(Boolean).filter((x) => ho || x.state === rec.state); const best = {}; R.forEach((x) => { const k = x.name + "|" + x.state + "|" + x.sc; if (!best[k] || x.score > best[k].score) best[k] = x; }); return J(200, { ok: true, rows: Object.values(best).sort((x, y) => y.score - x.score).slice(0, 300), total: R.length }); }
  return J(400, { ok: false, error: "Unknown action" });
}

// ---------------- bot: portal task recorder (storage only; the clicking happens on the user's own device) ----------------
export const botHostOk = (u) => { try { const x = new URL(u), h = x.hostname.toLowerCase(); return x.protocol === "https:" && /(^|\.)vivo\.(xyz|com|com\.cn|in)$/.test(h); } catch (e) { return false; } };
const cleanStep = (s) => {
  const a = ["click", "type", "select", "pause", "wait", "check", "page"].includes(s && s.a) ? s.a : "click", sel = s && s.sel && typeof s.sel === "object" ? s.sel : {};
  const S = {}; ["tag", "id", "name", "ph", "aria", "text", "label", "type", "role", "css", "near"].forEach((k) => { if (sel[k] != null && sel[k] !== "") S[k] = str(sel[k], k === "css" ? 400 : 120); }); if (sel.idx != null) S.idx = Math.max(0, Math.min(500, Math.round(+sel.idx || 0)));
  const o = { a, sel: S };
  if (a === "type" || a === "select") { o.v = txt(s.v, 400); if (s.col) o.col = str(s.col, 60); if (s.secret) { o.secret = true; o.v = ""; } }
  if (a === "check") o.on = !!s.on;
  if (a === "wait") o.ms = Math.max(200, Math.min(60000, Math.round(+s.ms || 1000)));
  if (s && s.say) o.say = str(s.say, 160);
  if (s && s.page) o.page = str(s.page, 300);
  return o;
};
async function bot(b, ctx) {
  const { store, t, uk } = ctx;
  if (b.action === "bot-list") { const R = (await ctx.pool(await store.list("bot:r:" + uk + ":"), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.upd - x.upd); return J(200, { ok: true, rows: R.map((x) => ({ id: x.id, name: x.name, url: x.url, n: x.steps.length, cols: [...new Set(x.steps.map((s) => s.col).filter(Boolean))], upd: x.upd, runs: x.runs || 0 })) }); }
  if (b.action === "bot-get") { const x = await store.get("bot:r:" + uk + ":" + str(b.id, 20)); return x ? J(200, { ok: true, r: x }) : J(404, { ok: false, error: "Not found" }); }
  if (b.action === "bot-save") {
    const url = str(b.url, 400); if (!botHostOk(url)) return J(400, { ok: false, error: "Only vivo portal addresses (https://….vivo.xyz) can be used" });
    const steps = list(b.steps, 300).map(cleanStep); if (!steps.length) return J(400, { ok: false, error: "No steps were recorded" });
    const id = str(b.id, 20) || nid(t), old = await store.get("bot:r:" + uk + ":" + id);
    const x = { id, name: str(b.name, 80) || "Recording", url, steps, at: old ? old.at : t, upd: t, runs: old ? old.runs || 0 : 0, note: txt(b.note, 600) };
    await store.set("bot:r:" + uk + ":" + id, x); return J(200, { ok: true, id });
  }
  if (b.action === "bot-del") { await store.delete("bot:r:" + uk + ":" + str(b.id, 20)); return J(200, { ok: true }); }
  if (b.action === "bot-log") {
    const id = str(b.run, 30); if (!/^[A-Za-z0-9_-]{4,30}$/.test(id)) return J(400, { ok: false, error: "Bad run id" });
    const s = b.status || {}, x = { id, rec: str(b.rec, 20), name: str(b.name, 80), at: t, state: ["done", "stopped", "err"].includes(s.s) ? s.s : "stopped", msg: str(s.msg, 300), rows: Math.round(+s.rows || 0), res: list(s.res, 3000).map((r) => ({ row: Math.round(+r.row || 0), ok: !!r.ok, msg: str(r.msg, 200) })) };
    const k = "bot:x:" + uk + ":" + id, had = await store.get(k);
    await store.set(k, x);
    if (x.rec && !had) { const r = await store.get("bot:r:" + uk + ":" + x.rec); if (r) { r.runs = (r.runs || 0) + 1; await store.set("bot:r:" + uk + ":" + r.id, r); } }
    return J(200, { ok: true });
  }
  if (b.action === "bot-runs") { const R = (await ctx.pool(await store.list("bot:x:" + uk + ":"), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 60); return J(200, { ok: true, rows: R }); }
  return J(400, { ok: false, error: "Unknown action" });
}

export async function lxAction(b, ctx) {
  const c = Object.assign({}, ctx, { by: ctx.rec.fullName || ctx.rec.username || "", uk: ctx.app + ":" + ctx.key });
  const a = b.action, needAI = /^(dx-page|cs-(ocr|lesson|tr|diff)|vg-(steps|intro)|rpl-(say|score))$/.test(a);
  if (needAI && !ctx.askAI) return J(400, { ok: false, error: "AI is not set up yet." });
  if (/^dx-/.test(a)) return dx(b, c);
  if (/^cs-/.test(a)) return cs(b, c);
  if (/^vg-/.test(a)) return vg(b, c);
  if (/^rpl-/.test(a)) return rpl(b, c);
  if (/^bot-/.test(a)) return ctx.app === "admin" ? bot(b, c) : J(403, { ok: false, error: "Only HO can use the portal task recorder" });
  return J(400, { ok: false, error: "Unknown action" });
}
