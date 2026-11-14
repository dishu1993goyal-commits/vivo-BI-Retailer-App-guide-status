// Photo contest by web link (retail team)
//   HO sets up a contest: what to shoot, which photos are acceptable, questions to answer, scoring criteria, the
//   eligibility cut-off for the next round. State employees open ONE web link (no app login), fill their details,
//   answer the questions and upload photos. HO sees every entry with its photos, AI-scores them against the criteria,
//   marks next round / winners with awards, exports Excel with the photos in the rows, and publishes results on the
//   same link. A voucher code is shown only to that person, after they enter their employee ID and mobile number.
// Storage:
//   pcc:<cid>          contest
//   pctok:<token>      { cid }
//   pce:<cid>:<eid>    entry          pcid:<cid>:<empId>  { eid } (one entry per employee per contest)
//   pci:<imgId>        { cid, eid, mime, data(base64 ≤ 1.6 MB), thumb(base64), w, h, ow, oh }
import { randomBytes } from "node:crypto";
import { STATES } from "./cmp-core.mjs";
import { readImages } from "./schemecalc-core.mjs";
import { aiKeys } from "./aff-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const tok = () => randomBytes(10).toString("hex");
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const phoneOf = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const empOf = (v) => str(v, 30).toUpperCase().replace(/\s+/g, "");
export const PC_STATUS = { uploading: "Upload not finished", submitted: "Submitted", eligible: "Eligible — next round", not_eligible: "Not eligible", round2: "In the final round", winner: "Winner 🏆", runner: "Runner-up", special: "Special mention", rejected: "Not selected" };
const AWARDED = ["winner", "runner", "special"];
const B64 = /^[A-Za-z0-9+/=]+$/;

function cleanContest(c, old, t) {
  const o = old || { id: "K" + nid(t).toUpperCase().slice(-6), token: tok(), at: t, status: "draft" };
  const crit = (Array.isArray(c.criteria) ? c.criteria : []).slice(0, 8).map((x) => ({ name: str(x.name, 50), weight: Math.max(0, Math.min(100, +x.weight || 0)), hint: str(x.hint, 200) })).filter((x) => x.name && x.weight);
  const qs = (Array.isArray(c.questions) ? c.questions : []).slice(0, 12).map((q, i) => ({ id: str(q.id, 12) || "q" + (i + 1) + nid(t).slice(-3), q: str(q.q, 200), type: ["text", "long", "choice", "number"].includes(q.type) ? q.type : "text", options: (Array.isArray(q.options) ? q.options : String(q.options || "").split(/\n|,/)).map((x) => str(x, 60)).filter(Boolean).slice(0, 10), req: q.req !== false, score: !!q.score })).filter((q) => q.q);
  const ph = c.photos || {};
  return Object.assign(o, {
    title: str(c.title, 100) || "Photo contest", desc: txt(c.desc, 1500), rules: txt(c.rules, 2500), banner: str(c.banner, 40),
    start: +c.start || 0, end: +c.end || 0, states: (Array.isArray(c.states) ? c.states : []).filter((s) => STATES.includes(s)),
    ask: { phone: c.ask ? c.ask.phone !== false : true, email: c.ask ? !!c.ask.email : false, store: c.ask ? !!c.ask.store : false, designation: c.ask ? !!c.ask.designation : true },
    photos: { min: Math.max(1, Math.min(10, +ph.min || 1)), max: Math.max(1, Math.min(10, +ph.max || 3)), minPx: Math.max(0, Math.min(4000, +ph.minPx || 0)), orient: ["any", "portrait", "landscape", "square"].includes(ph.orient) ? ph.orient : "any", accept: txt(ph.accept, 1200), reject: txt(ph.reject, 800), model: str(ph.model, 80) },
    questions: qs, criteria: crit.length ? crit : [{ name: "Creativity", weight: 30, hint: "" }, { name: "Photo quality (focus, light, composition)", weight: 30, hint: "" }, { name: "vivo phone / brand clearly shown", weight: 25, hint: "" }, { name: "Fits the theme", weight: 15, hint: "" }],
    cutoff: Math.max(0, Math.min(100, +c.cutoff || 60)), answersWeight: Math.max(0, Math.min(50, +c.answersWeight || 0)),
    resultsMsg: txt(c.resultsMsg, 800), showBoard: c.showBoard !== false,
  });
}
const pubContest = (c) => ({ id: c.id, title: c.title, desc: c.desc, rules: c.rules, start: c.start, end: c.end, states: c.states, ask: c.ask, photos: { min: c.photos.min, max: c.photos.max, minPx: c.photos.minPx, orient: c.photos.orient, accept: c.photos.accept, reject: c.photos.reject, model: c.photos.model }, questions: c.questions.map((q) => ({ id: q.id, q: q.q, type: q.type, options: q.options, req: q.req })), status: c.status, criteria: c.criteria.map((x) => ({ name: x.name, weight: x.weight })) });
const isOpen = (c, t) => c.status === "open" && (!c.start || t >= c.start) && (!c.end || t <= c.end);

async function entriesOf(store, pool, cid) { return (await pool(await store.list("pce:" + cid + ":"), 30, (k) => store.get(k))).filter(Boolean); }
const total = (c, e) => { const ai = e.ai ? e.ai.total : null, ho = e.hoScore; return ho != null && ho !== "" ? +ho : ai; };
const pubEntry = (e) => ({ id: e.id, at: e.at, name: e.name, empId: e.empId, phone: e.phone, email: e.email, state: e.state, store: e.store, designation: e.designation, answers: e.answers, photos: e.photos, photoInfo: e.photoInfo, status: e.status, ai: e.ai, hoScore: e.hoScore, note: e.note, award: e.award, voucher: e.voucher ? "••••" + String(e.voucher).slice(-3) : "", hasVoucher: !!e.voucher, seenResult: e.seenResult || 0, edits: e.edits || 0 });

async function aiScore(ctx, c, e) {
  const { store, env, aiFetch } = ctx;
  const imgs = [];
  for (const id of (e.photos || []).slice(0, 5)) { const p = await store.get("pci:" + id); if (p) imgs.push("data:" + p.mime + ";base64," + p.data); }
  if (!imgs.length) return { ok: false, error: "No photos" };
  const qa = c.questions.map((q) => `Q: ${q.q}\nA: ${(e.answers || {})[q.id] || "-"}`).join("\n");
  const prompt = `You are judging an internal vivo India employee photo contest: "${c.title}". ${c.desc || ""}
What is acceptable: ${c.photos.accept || "any good photo that fits the theme"}.
${c.photos.reject ? "Not acceptable (score low and mark not eligible): " + c.photos.reject + "." : ""}
${c.photos.model ? "The photo should feature: " + c.photos.model + "." : ""}
There are ${imgs.length} photo(s) from one participant. Score each criterion from 0 to 10 for the participant's set (best photo counts most):
${c.criteria.map((x, i) => `${i + 1}. ${x.name}${x.hint ? " — " + x.hint : ""}`).join("\n")}
${c.answersWeight && qa ? "Also score their answers to the questions from 0 to 10 for thoughtfulness and relevance:\n" + qa : ""}
Also check: is any photo a screenshot, a downloaded/advertisement image, heavily edited, or a photo of a screen? Is a vivo phone/brand visible?
Reply ONLY with JSON: {"scores":[${c.criteria.map(() => "n").join(",")}],${c.answersWeight && qa ? '"answers":n,' : ""}"acceptable":true|false,"vivoVisible":true|false,"looksCopied":true|false,"best":photo number 1-${imgs.length},"comment":"one or two sentences the judges can read"}`;
  const keys = await aiKeys(store, env || {});
  const v = await readImages(keys, env, imgs, aiFetch, prompt, { timeout: 30000, maxModels: 3, accept: (t) => /"scores"\s*:/.test(t) });
  if (!v.ok) return { ok: false, error: v.error.slice(0, 200) };
  let j = null; try { j = JSON.parse(String(v.text).replace(/^[^{]*/, "").replace(/[^}]*$/, "")); } catch (x) { }
  if (!j || !Array.isArray(j.scores)) return { ok: false, error: "The AI answer wasn't readable — try again" };
  const per = {}; let wsum = 0, acc = 0;
  c.criteria.forEach((x, i) => { const s = Math.max(0, Math.min(10, +j.scores[i] || 0)); per[x.name] = s; wsum += x.weight; acc += s * x.weight; });
  let tot = wsum ? (acc / wsum) * 10 : 0;   // 0-100
  if (c.answersWeight && j.answers != null) { const a = Math.max(0, Math.min(10, +j.answers || 0)) * 10; tot = tot * (1 - c.answersWeight / 100) + a * (c.answersWeight / 100); per["Answers"] = Math.round(a) / 10; }
  if (j.looksCopied === true) tot = Math.min(tot, 25);
  if (j.acceptable === false) tot = Math.min(tot, c.cutoff - 1);
  e.ai = { total: Math.round(tot), per, acceptable: j.acceptable !== false, vivoVisible: j.vivoVisible !== false, looksCopied: j.looksCopied === true, best: Math.max(1, Math.min(imgs.length, +j.best || 1)), comment: str(j.comment, 300), at: ctx.t, model: v.model };
  if (e.status === "submitted") e.status = e.ai.total >= c.cutoff && e.ai.acceptable ? "eligible" : "not_eligible";
  await store.set(`pce:${c.id}:${e.id}`, e);
  return { ok: true, ai: e.ai, status: e.status };
}
async function mail(ctx, to, subject, html) {
  const { env = {}, mailFetch } = ctx;
  if (!to || !env.BREVO_API_KEY || !env.OTP_FROM_EMAIL) return { ok: false };
  try { const r = await (mailFetch || fetch)("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": env.BREVO_API_KEY }, body: JSON.stringify({ sender: { name: env.OTP_FROM_NAME || "vivo BI", email: env.OTP_FROM_EMAIL }, to: [{ email: to }], subject, htmlContent: html }) }); return { ok: r.ok }; } catch (e) { return { ok: false }; }
}

// ======================= HO =======================
export async function pcAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx;
  if (app !== "admin") return json(403, { ok: false, error: "Only HO admins manage contests. State users take part through the contest link." });
  const by = rec.fullName || rec.username || "", site = (ctx.env && ctx.env.SITE_URL) || "";
  const getC = async (id) => store.get("pcc:" + str(id, 20));
  if (b.action === "pc-list") {
    const L = (await pool(await store.list("pcc:"), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at);
    const out = [];
    for (const c of L) { const es = await store.list("pce:" + c.id + ":"); out.push({ id: c.id, title: c.title, status: c.status, start: c.start, end: c.end, at: c.at, entries: es.length, link: site + "/contest.html?k=" + c.token }); }
    return json(200, { ok: true, rows: out, statuses: PC_STATUS, states: STATES });
  }
  if (b.action === "pc-get") { const c = await getC(b.id); return c ? json(200, { ok: true, c, link: site + "/contest.html?k=" + c.token }) : json(404, { ok: false, error: "Contest not found" }); }
  if (b.action === "pc-save") {
    const old = b.id ? await getC(b.id) : null;
    if (b.id && !old) return json(404, { ok: false, error: "Contest not found" });
    const c = cleanContest(b.c || {}, old, t); c.by = c.by || by; c.upd = t;
    if (b.status && ["draft", "open", "closed", "results"].includes(b.status)) { c.status = b.status; if (b.status === "results") c.resultsAt = t; }
    await store.set("pcc:" + c.id, c); await store.set("pctok:" + c.token, { cid: c.id });
    return json(200, { ok: true, c, link: site + "/contest.html?k=" + c.token });
  }
  if (b.action === "pc-delete") {
    const c = await getC(b.id); if (!c) return json(404, { ok: false, error: "Contest not found" });
    for (const e of await entriesOf(store, pool, c.id)) { for (const p of e.photos || []) await store.delete("pci:" + p); await store.delete(`pce:${c.id}:${e.id}`); await store.delete(`pcid:${c.id}:${e.empId}`); }
    await store.delete("pctok:" + c.token); await store.delete("pcc:" + c.id);
    return json(200, { ok: true });
  }
  const c = await getC(b.cid); if (!c) return json(404, { ok: false, error: "Contest not found" });
  if (b.action === "pc-entries") {
    const L = (await entriesOf(store, pool, c.id)).sort((x, y) => (total(c, y) || -1) - (total(c, x) || -1) || x.at - y.at).map(pubEntry);
    return json(200, { ok: true, rows: L, c });
  }
  if (b.action === "pc-thumbs") {   // small pictures for the list / Excel, in batches
    const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 40), out = {};
    for (const id of ids) { const p = await store.get("pci:" + str(id, 30)); if (p && p.cid === c.id) out[id] = { m: "image/jpeg", d: p.thumb, w: p.w, h: p.h }; }
    return json(200, { ok: true, thumbs: out });
  }
  if (b.action === "pc-img") { const p = await store.get("pci:" + str(b.id, 30)); return p && p.cid === c.id ? json(200, { ok: true, mime: p.mime, data: p.data, ow: p.ow, oh: p.oh }) : json(404, { ok: false, error: "Photo not found" }); }
  if (b.action === "pc-ai") {
    const e = await store.get(`pce:${c.id}:${str(b.eid, 20)}`); if (!e) return json(404, { ok: false, error: "Entry not found" });
    const r = await aiScore(ctx, c, e);
    return json(r.ok ? 200 : 502, r.ok ? Object.assign({ ok: true }, r) : { ok: false, error: r.error });
  }
  if (b.action === "pc-mark") {   // [{ eid, status?, hoScore?, note?, award?, voucher? }]
    let n = 0;
    for (const u of (Array.isArray(b.updates) ? b.updates : []).slice(0, 500)) {
      const e = await store.get(`pce:${c.id}:${str(u.eid, 20)}`); if (!e) continue;
      if (u.status && PC_STATUS[u.status] && u.status !== "uploading") e.status = u.status;
      if (u.hoScore !== undefined) e.hoScore = u.hoScore === "" || u.hoScore == null ? null : Math.max(0, Math.min(100, Math.round(+u.hoScore || 0)));
      if (u.note !== undefined) e.note = txt(u.note, 300);
      if (u.award !== undefined) e.award = str(u.award, 120);
      if (u.voucher !== undefined && !String(u.voucher).startsWith("••••")) e.voucher = str(u.voucher, 80);
      e.markBy = by; e.markAt = t; await store.set(`pce:${c.id}:${e.id}`, e); n++;
    }
    return json(200, { ok: true, n });
  }
  if (b.action === "pc-notify") {   // publish results on the link + one e-mail to each awarded person who gave an e-mail (no codes in e-mails)
    c.status = "results"; c.resultsAt = t; await store.set("pcc:" + c.id, c);
    let sent = 0;
    if (b.mail) for (const e of await entriesOf(store, pool, c.id)) {
      if (!AWARDED.includes(e.status) || !e.email || e.mailedResult) continue;
      const r = await mail(ctx, e.email, `${c.title} — results`, `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;padding:18px"><h2>🎉 Congratulations, ${escH(e.name)}!</h2><p>You are a <b>${escH(PC_STATUS[e.status])}</b> in <b>${escH(c.title)}</b>${e.award ? " — award: <b>" + escH(e.award) + "</b>" : ""}.</p><p>Open the contest link and enter your employee ID and mobile number to see your result${e.voucher ? " and your voucher" : ""}:</p><p><a href="${site}/contest.html?k=${c.token}" style="background:#4D5BF9;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:700">See my result</a></p></div>`);
      if (r.ok) { e.mailedResult = t; await store.set(`pce:${c.id}:${e.id}`, e); sent++; }
    }
    return json(200, { ok: true, sent });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// ======================= public link =======================
export async function pcPublic(b, ctx) {
  const { store, t, pool } = ctx;
  const ix = await store.get("pctok:" + String(b.k || "").replace(/[^a-f0-9]/g, ""));
  const c = ix ? await store.get("pcc:" + ix.cid) : null;
  if (!c || c.status === "draft") return json(404, { ok: false, error: "This contest link isn't active." });
  if (b.action === "pc-p-info") {
    const out = { ok: true, c: pubContest(c), open: isOpen(c, t), now: t, states: STATES };
    if (c.status === "results" && c.showBoard) {
      const es = (await entriesOf(store, pool, c.id)).filter((e) => AWARDED.includes(e.status)).sort((x, y) => AWARDED.indexOf(x.status) - AWARDED.indexOf(y.status) || (total(c, y) || 0) - (total(c, x) || 0));
      out.board = es.map((e) => ({ name: e.name, state: e.state, status: PC_STATUS[e.status], award: e.award || "" }));
      out.resultsMsg = c.resultsMsg;
    }
    return json(200, out);
  }
  const emp = empOf(b.empId), ph = phoneOf(b.phone);
  const mineE = async () => { const m = emp ? await store.get(`pcid:${c.id}:${emp}`) : null; const e = m ? await store.get(`pce:${c.id}:${m.eid}`) : null; return e; };
  if (b.action === "pc-p-me") {   // "my entry / my result": employee ID + mobile must match
    const e = await mineE();
    if (!e || (e.phone && e.phone !== ph) || (!e.phone && !ph)) return json(404, { ok: false, error: "No entry found for this employee ID and mobile number." });
    const res = c.status === "results";
    if (res && AWARDED.includes(e.status)) { e.seenResult = e.seenResult || t; await store.set(`pce:${c.id}:${e.id}`, e); }
    return json(200, { ok: true, e: { id: e.id, name: e.name, at: e.at, status: res ? e.status : e.status === "uploading" ? "uploading" : "submitted", statusName: res ? PC_STATUS[e.status] : e.status === "uploading" ? PC_STATUS.uploading : "Submitted — results not out yet", award: res ? e.award || "" : "", voucher: res && AWARDED.includes(e.status) ? e.voucher || "" : "", photos: (e.photos || []).length, answers: e.answers, designation: e.designation, store: e.store, state: e.state, email: e.email }, canEdit: isOpen(c, t) });
  }
  if (!isOpen(c, t)) return json(403, { ok: false, error: c.end && t > c.end ? "Entries closed on " + new Date(c.end + 19800000).toISOString().slice(0, 16).replace("T", " ") + "." : "Entries are not open right now." });
  if (b.action === "pc-p-submit") {   // details + answers → entry (photos follow one by one)
    if (b.hp) return json(200, { ok: true });
    const d = b.d || {};
    const name = str(d.name, 80), state = STATES.find((s) => low(s) === low(d.state)) || "";
    if (!name || !emp) return json(400, { ok: false, error: "Enter your name and employee ID" });
    if (!state) return json(400, { ok: false, error: "Choose your state" });
    if (c.states.length && !c.states.includes(state)) return json(403, { ok: false, error: "This contest is for: " + c.states.join(", ") });
    if (c.ask.phone && !ph) return json(400, { ok: false, error: "Enter your 10-digit mobile number" });
    const answers = {};
    for (const q of c.questions) {
      let a = txt((d.answers || {})[q.id], q.type === "long" ? 1500 : 300);
      if (q.type === "choice" && a && !q.options.includes(a)) a = "";
      if (q.type === "number" && a && isNaN(+a)) return json(400, { ok: false, error: "“" + q.q + "” needs a number" });
      if (q.req && !a) return json(400, { ok: false, error: "Answer: " + q.q });
      answers[q.id] = a;
    }
    const n = Math.max(0, Math.floor(+b.nPhotos || 0));
    if (n < c.photos.min || n > c.photos.max) return json(400, { ok: false, error: `Add ${c.photos.min === c.photos.max ? c.photos.min : c.photos.min + "–" + c.photos.max} photo(s)` });
    let e = await mineE();
    if (e && e.phone && ph && e.phone !== ph) return json(403, { ok: false, error: "This employee ID already has an entry with another mobile number. Ask HO if this is a mistake." });
    const fresh = !e;
    if (fresh) e = { id: "E" + nid(t).toUpperCase().slice(-7), at: t, empId: emp, edits: 0 };
    else { for (const p of e.photos || []) await store.delete("pci:" + p); e.edits = (e.edits || 0) + 1; e.ai = null; e.hoScore = null; }
    Object.assign(e, { name, phone: ph, email: c.ask.email ? (String(d.email || "").trim().toLowerCase().match(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/) || [""])[0] : "", state, store: c.ask.store ? str(d.store, 80) : "", designation: c.ask.designation ? str(d.designation, 60) : "", answers, photos: [], photoInfo: [], need: n, up: tok(), status: "uploading", upd: t });
    await store.set(`pce:${c.id}:${e.id}`, e); await store.set(`pcid:${c.id}:${emp}`, { eid: e.id });
    return json(200, { ok: true, eid: e.id, up: e.up, resubmitted: !fresh });
  }
  if (b.action === "pc-p-photo") {
    const e = await store.get(`pce:${c.id}:${str(b.eid, 20)}`);
    if (!e || !b.up || e.up !== String(b.up)) return json(403, { ok: false, error: "Upload not allowed — submit the form again" });
    if ((e.photos || []).length >= e.need) return json(400, { ok: false, error: "All photos are already uploaded" });
    const data = String(b.data || ""), th = String(b.thumb || "");
    if (!B64.test(data) || data.length > 1700000 || !B64.test(th) || th.length > 120000) return json(400, { ok: false, error: "That photo is too big — try again" });
    const id = e.id + "-" + nid(t).slice(-6);
    const w = Math.round(+b.w || 0), h = Math.round(+b.h || 0), ow = Math.round(+b.ow || w), oh = Math.round(+b.oh || h);
    await store.set("pci:" + id, { cid: c.id, eid: e.id, mime: b.mime === "image/png" ? "image/png" : "image/jpeg", data, thumb: th, w, h, ow, oh, name: str(b.name, 80), at: t });
    e.photos.push(id); e.photoInfo.push({ ow, oh, name: str(b.name, 80), size: Math.round(+b.size || 0) });
    if (e.photos.length >= e.need) { e.status = "submitted"; e.done = t; delete e.up; }
    await store.set(`pce:${c.id}:${e.id}`, e);
    return json(200, { ok: true, done: e.status === "submitted", n: e.photos.length });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
