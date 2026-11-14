// Promoter referrals & hiring (HR)
//   Anyone in the vivo state / sales team refers a candidate (in the app, on the portal, or by the public referral link
//   for people without an app login) and uploads the CV. The state HR team sees its state's candidates, gets an AI
//   fit-score against the role, moves them through the stages and books an online interview (meeting link).
//   The candidate gets a private status link with the interview time and the "Join" button.
// Storage:
//   hrcfg            { roles:[{ id, name, jd }], hr:[{ state, emails:[] }], hoHr:[], link:{ token, on }, mail }
//   hrc:<id>         candidate (see newCand)
//   hrcvb:<id>:<n>   CV file, base64 pieces (≤ 1.4 MB each)
//   hrph:<phone>     id of the open candidate with this phone (duplicate check)
import { randomBytes } from "node:crypto";
import { STATES } from "./cmp-core.mjs";
import { readImages } from "./schemecalc-core.mjs";
import { aiKeys } from "./aff-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const tok = () => randomBytes(12).toString("hex");
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const emails = (v) => (Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map(low).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)).slice(0, 15);
const phoneOf = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
export const HR_STAGES = { new: "New", shortlisted: "Shortlisted", interview: "Interview booked", selected: "Selected", joined: "Joined", hold: "On hold", rejected: "Not selected", withdrawn: "Withdrawn" };
const OPEN = ["new", "shortlisted", "interview", "selected", "hold"];
const DEF_ROLES = [
  { id: "promoter", name: "Promoter (in-store)", jd: "In-store promoter for vivo smartphones at a retail counter. Explains features, demonstrates phones, closes sales, meets monthly targets, keeps the display neat, logs sales in the app. Needs: good communication in the local language (Hindi/English a plus), customer-friendly attitude, basic smartphone knowledge, retail or sales experience preferred, 12th pass or above, ready for store timings and weekends." },
  { id: "srpromoter", name: "Senior promoter", jd: "Experienced in-store promoter who also guides 2–3 promoters at a large store. Needs 2+ years of mobile retail sales, strong closing and upselling (finance / EMI, accessories), target track record, team guidance, product training ability." },
  { id: "isd", name: "ISD / counter sales executive", jd: "In-shop demonstrator for multi-brand stores: drives vivo share at the counter, handles finance (EMI) customers, competitor comparisons, daily sales reporting. Needs sales experience, persuasion, numeracy, smartphone apps knowledge." },
  { id: "fse", name: "Field sales executive (FSE)", jd: "Covers a beat of 30–60 retailers on two-wheeler: order taking, stock and display checks, scheme communication, collections, new retailer onboarding. Needs field sales / distribution experience, own two-wheeler and licence, local market knowledge, smartphone reporting." },
  { id: "tl", name: "Team leader (promoters)", jd: "Leads 10–25 promoters in a territory: hiring, attendance, training, store coverage, sell-out targets, reporting to the area manager. Needs 3+ years in mobile retail with team handling, strong numbers and people skills." },
  { id: "trainer", name: "Product trainer", jd: "Trains promoters and retailer staff on vivo phones and selling skills, runs launch trainings, checks knowledge with quizzes. Needs presentation skills, product depth, local language fluency, travel readiness." },
];

async function cfgOf(store) {
  const c = (await store.get("hrcfg")) || {};
  if (!Array.isArray(c.roles) || !c.roles.length) c.roles = DEF_ROLES.map((r) => Object.assign({}, r));
  c.hr = Array.isArray(c.hr) ? c.hr : [];
  c.hoHr = Array.isArray(c.hoHr) ? c.hoHr : [];
  if (!c.link) { c.link = { token: tok(), on: true }; await store.set("hrcfg", c); }   // keep the first link stable
  if (c.mail === undefined) c.mail = true;
  return c;
}
async function mail(ctx, to, cc, subject, html) {
  const { env = {}, mailFetch } = ctx;
  to = [...new Set(to)]; if (!to.length) return { ok: false, error: "No e-mail set" };
  if (!env.BREVO_API_KEY || !env.OTP_FROM_EMAIL) return { ok: false, error: "E-mail isn't set up" };
  try {
    const body = { sender: { name: env.OTP_FROM_NAME || "vivo BI", email: env.OTP_FROM_EMAIL }, to: to.map((e) => ({ email: e })), subject, htmlContent: html };
    const ccs = [...new Set((cc || []).filter((e) => !to.includes(e)))]; if (ccs.length) body.cc = ccs.map((e) => ({ email: e }));
    const r = await (mailFetch || fetch)("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": env.BREVO_API_KEY }, body: JSON.stringify(body) });
    return r.ok ? { ok: true } : { ok: false, error: "Brevo " + r.status };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 80) }; }
}
const shell = (title, inner) => `<div style="font-family:Segoe UI,Arial,sans-serif;background:#F3F4FA;padding:18px"><div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:20px;color:#1B1D2E"><div style="font-size:12px;color:#6B7090;font-weight:700">vivo · HR</div><h2 style="margin:6px 0 12px;font-size:19px">${escH(title)}</h2>${inner}</div></div>`;
const btn = (href, label) => `<p style="text-align:center;margin:16px 0"><a href="${href}" style="background:#4D5BF9;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">${escH(label)}</a></p>`;
const fmtT = (t) => new Date(t + 19800000).toISOString().replace("T", " ").slice(0, 16) + " IST";

function hrStatesOf(cfg, rec, isHO) {
  if (isHO) return STATES.slice();
  const me = [low(rec.email), low(rec.username)].filter(Boolean);
  return cfg.hr.filter((h) => (h.emails || []).some((e) => me.includes(low(e)))).map((h) => h.state);
}
function cleanCand(b, cfg, t) {
  const role = cfg.roles.find((r) => r.id === b.role) || cfg.roles[0];
  return {
    name: str(b.name, 80), phone: phoneOf(b.phone), email: (emails(b.email)[0] || ""), city: str(b.city, 60),
    state: STATES.find((s) => low(s) === low(b.state)) || "", role: role.id, roleName: role.name, exp: Math.max(0, Math.min(40, +b.exp || 0)),
    current: str(b.current, 80), langs: str(b.langs, 80), edu: str(b.edu, 60), notes: txt(b.notes, 600), at: t,
  };
}
async function createCand(ctx, cfg, b, ref) {
  const { store, t } = ctx;
  const c = cleanCand(b, cfg, t);
  if (!c.name) return json(400, { ok: false, error: "Enter the candidate's name" });
  if (!c.phone) return json(400, { ok: false, error: "Enter the candidate's 10-digit mobile number" });
  if (!c.state) return json(400, { ok: false, error: "Choose the state" });
  const dup = await store.get("hrph:" + c.phone);
  if (dup) { const o = await store.get("hrc:" + dup.id); if (o && OPEN.includes(o.stage)) return json(409, { ok: false, error: "This candidate (" + c.phone + ") is already referred and is " + HR_STAGES[o.stage].toLowerCase() + " in " + o.state + "." }); }
  const id = "C" + nid(t).toUpperCase().slice(-7);
  Object.assign(c, { id, ref, stage: "new", hist: [{ at: t, by: ref.name || "", stage: "new", note: "Referred" + (ref.via === "link" ? " by link" : "") }], token: tok(), up: tok(), cv: null, ai: null, iv: null });
  await store.set("hrc:" + id, c); await store.set("hrph:" + c.phone, { id }); await store.set("hrtok:" + c.token, { id });
  // tell the state HR (and HO HR in CC)
  if (cfg.mail !== false) {
    const h = cfg.hr.find((x) => x.state === c.state);
    const to = emails((h && h.emails) || []), cc = emails(cfg.hoHr);
    await mail(ctx, to.length ? to : cc, to.length ? cc : [], `New referral: ${c.name} · ${c.roleName} · ${c.state}`, shell("New candidate referred",
      `<p><b>${escH(c.name)}</b> (${escH(c.phone)}) was referred for <b>${escH(c.roleName)}</b> in ${escH(c.city ? c.city + ", " : "")}${escH(c.state)} by ${escH(ref.name || "a team member")}.</p><p>Experience: ${c.exp} yr · ${escH(c.current || "")}</p>${btn((ctx.env.SITE_URL || "") + "/hire.html#c=" + id, "Open in the HR tool")}`));
  }
  return json(200, { ok: true, id, up: c.up, token: c.token });
}
// CV upload: base64 pieces; the last piece carries the file name, type and the text the browser read out of it
async function cvPiece(ctx, c, b) {
  const { store } = ctx;
  const n = Math.max(0, Math.floor(+b.n || 0)), total = Math.max(1, Math.min(4, Math.floor(+b.total || 1)));
  const data = String(b.data || "");
  if (!/^[A-Za-z0-9+/=]*$/.test(data) || data.length > 1500000) return json(400, { ok: false, error: "That file piece is too big" });
  if (n >= total) return json(400, { ok: false, error: "Bad piece" });
  await store.set(`hrcvb:${c.id}:${n}`, { d: data });
  if (n === total - 1) {
    const mime = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword|image\/(jpeg|png|webp))$/.test(b.mime) ? b.mime : "application/octet-stream";
    c.cv = { name: str(b.fname, 120) || "cv", mime, size: Math.round(+b.size || 0), chunks: total, text: txt(b.text, 16000), at: ctx.t };
    await store.set("hrc:" + c.id, c);
  }
  return json(200, { ok: true });
}
async function cvData(store, c) {
  if (!c.cv) return "";
  let s = ""; for (let i = 0; i < c.cv.chunks; i++) { const p = await store.get(`hrcvb:${c.id}:${i}`); s += (p && p.d) || ""; }
  return s;
}
const AI_SYS = "You are an experienced HR recruiter for vivo India's retail sales team (promoters, ISDs, field sales). You judge candidates fairly on job-relevant evidence only. Never use or infer religion, caste, gender, age, marital status, looks or health. Reply with JSON only.";
async function aiScreen(ctx, cfg, c) {
  const { store, env, askAI, aiFetch } = ctx;
  const role = cfg.roles.find((r) => r.id === c.role) || { name: c.roleName, jd: "" };
  let cvText = (c.cv && c.cv.text) || "";
  if (!cvText && c.cv && /^image\//.test(c.cv.mime)) {   // photo of a CV: read it first
    const keys = await aiKeys(store, env || {});
    const v = await readImages(keys, env, ["data:" + c.cv.mime + ";base64," + (await cvData(store, c))], aiFetch, "This is a photo of a job applicant's CV / resume. Write out all of its text, line by line. Text only.", { timeout: 25000, maxModels: 2 });
    if (v.ok) { cvText = v.text.slice(0, 16000); c.cv.text = cvText; }
  }
  const prof = `Candidate (from the referral form): name ${c.name}; city ${c.city || "-"}, ${c.state}; experience ${c.exp} years; current/last job ${c.current || "-"}; education ${c.edu || "-"}; languages ${c.langs || "-"}; referrer's note: ${c.notes || "-"}.\nCV TEXT:\n${cvText || "(no CV text available — judge only from the form, and say so)"}`;
  const q = `Score this candidate for the role "${role.name}". Job description: ${role.jd}\nReply ONLY with JSON: {"score": 0-100, "fit": "strong|good|possible|weak", "summary": "2 sentences", "strengths": ["…"], "concerns": ["…"], "questions": ["3-5 interview questions to check the concerns"], "suggestedRole": "best matching role name from: ${cfg.roles.map((r) => r.name).join(" / ")}"}`;
  if (!askAI) return { ok: false, error: "AI is not set up yet." };
  const r = await askAI(env, q, prof, [], aiFetch, { system: AI_SYS, label: "CANDIDATE", json: true });
  if (!r.ok) return { ok: false, error: r.error || "AI didn't answer" };
  let j = null; try { j = JSON.parse(String(r.text).replace(/^[^{]*/, "").replace(/[^}]*$/, "")); } catch (e) { }
  if (!j || isNaN(+j.score)) return { ok: false, error: "AI answer wasn't readable — try again" };
  const arr = (a, n) => (Array.isArray(a) ? a : []).map((x) => str(x, 220)).filter(Boolean).slice(0, n);
  c.ai = { score: Math.max(0, Math.min(100, Math.round(+j.score))), fit: ["strong", "good", "possible", "weak"].includes(j.fit) ? j.fit : "", summary: str(j.summary, 500), strengths: arr(j.strengths, 6), concerns: arr(j.concerns, 6), questions: arr(j.questions, 6), suggestedRole: str(j.suggestedRole, 60), at: ctx.t, model: r.model || "", noCv: !cvText };
  await store.set("hrc:" + c.id, c);
  return { ok: true, ai: c.ai };
}
const forRef = (c) => ({ id: c.id, name: c.name, role: c.roleName, state: c.state, at: c.at, stage: c.stage, stageName: HR_STAGES[c.stage], cv: !!c.cv });
const meetLink = (t) => "https://meet.jit.si/vivo-interview-" + randomBytes(6).toString("hex");

export async function hrAction(b, ctx) {
  const { store, t, app, rec, pool, key } = ctx;
  const isHO = app === "admin", cfg = await cfgOf(store), myStates = hrStatesOf(cfg, rec, isHO), isHR = isHO || myStates.length > 0;
  const by = rec.fullName || rec.username || "", refKey = app + ":" + key;
  const all = async () => (await pool(await store.list("hrc:"), 30, (k) => store.get(k))).filter(Boolean);
  const mine = (c) => isHO || myStates.includes(c.state);
  const getC = async (id) => { const c = await store.get("hrc:" + str(id, 20)); return c && mine(c) ? c : null; };

  if (b.action === "hr-me") return json(200, { ok: true, isHO, isHR, hrStates: myStates, roles: cfg.roles.map((r) => ({ id: r.id, name: r.name })), states: STATES, stages: HR_STAGES, myState: rec.state || "", link: isHO ? cfg.link : null });
  if (b.action === "hr-refer") {
    return createCand(ctx, cfg, b.c || {}, { name: by, phone: phoneOf(rec.phone || rec.mobile), empId: str((b.c || {}).refEmp, 30), key: refKey, via: app, state: rec.state || "" });
  }
  if (b.action === "hr-cv") {   // referrer (own referral) or HR uploads the CV
    const c = await store.get("hrc:" + str(b.id, 20));
    if (!c || !(c.ref.key === refKey || mine(c))) return json(404, { ok: false, error: "Candidate not found" });
    return cvPiece(ctx, c, b);
  }
  if (b.action === "hr-my") {
    const L = (await all()).filter((c) => c.ref && c.ref.key === refKey).sort((x, y) => y.at - x.at).map(forRef);
    return json(200, { ok: true, rows: L });
  }
  if (!isHR) return json(403, { ok: false, error: "Only the HR team can see candidates." });

  if (b.action === "hr-list") {
    const L = (await all()).filter(mine).sort((x, y) => y.at - x.at).map((c) => ({ id: c.id, at: c.at, name: c.name, phone: c.phone, email: c.email, city: c.city, state: c.state, role: c.role, roleName: c.roleName, exp: c.exp, current: c.current, langs: c.langs, edu: c.edu, stage: c.stage, ref: { name: c.ref.name, via: c.ref.via, empId: c.ref.empId, phone: c.ref.phone }, cv: c.cv ? { name: c.cv.name, mime: c.cv.mime, size: c.cv.size, hasText: !!c.cv.text } : null, ai: c.ai ? { score: c.ai.score, fit: c.ai.fit, summary: c.ai.summary } : null, iv: c.iv ? { at: c.iv.at, link: c.iv.link, result: c.iv.result } : null }));
    return json(200, { ok: true, rows: L });
  }
  if (b.action === "hr-get") {
    const c = await getC(b.id); if (!c) return json(404, { ok: false, error: "Candidate not found" });
    const o = Object.assign({}, c); delete o.up; if (o.cv) o.cv = Object.assign({}, o.cv, { text: undefined, hasText: !!c.cv.text });
    return json(200, { ok: true, c: o, statusLink: (ctx.env.SITE_URL || "") + "/hire.html?c=" + c.token });
  }
  if (b.action === "hr-cv-file") {
    const c = await getC(b.id); if (!c || !c.cv) return json(404, { ok: false, error: "No CV uploaded" });
    return json(200, { ok: true, name: c.cv.name, mime: c.cv.mime, data: await cvData(store, c) });
  }
  if (b.action === "hr-ai") {
    const c = await getC(b.id); if (!c) return json(404, { ok: false, error: "Candidate not found" });
    const r = await aiScreen(ctx, cfg, c);
    return json(r.ok ? 200 : 502, r.ok ? { ok: true, ai: r.ai } : { ok: false, error: r.error });
  }
  if (b.action === "hr-stage") {
    const c = await getC(b.id); if (!c) return json(404, { ok: false, error: "Candidate not found" });
    const st = HR_STAGES[b.stage] ? b.stage : null; if (!st) return json(400, { ok: false, error: "Choose a stage" });
    c.stage = st; c.hist.push({ at: t, by, stage: st, note: txt(b.note, 400) });
    if (b.rating !== undefined && c.iv) { c.iv.rating = Math.max(0, Math.min(5, +b.rating || 0)); c.iv.result = txt(b.note, 400); }
    if (!OPEN.includes(st)) { const ph = await store.get("hrph:" + c.phone); if (ph && ph.id === c.id) await store.delete("hrph:" + c.phone); }
    await store.set("hrc:" + c.id, c);
    let mailed = null;
    if (b.tell && c.email && ["selected", "rejected", "joined", "shortlisted"].includes(st)) {
      const msg = { selected: "Congratulations — you have been selected. Our HR team will contact you with the next steps.", rejected: "Thank you for your time. We are not moving ahead with your application for now.", joined: "Welcome to the vivo team!", shortlisted: "You have been shortlisted. We will share the interview details soon." }[st];
      mailed = await mail(ctx, [c.email], [], `vivo · ${c.roleName} · ${HR_STAGES[st]}`, shell(HR_STAGES[st], `<p>Dear ${escH(c.name)},</p><p>${msg}</p>${btn((ctx.env.SITE_URL || "") + "/hire.html?c=" + c.token, "See your status")}`));
    }
    return json(200, { ok: true, stage: st, mailed });
  }
  if (b.action === "hr-iv") {   // book / change / cancel an online interview
    const c = await getC(b.id); if (!c) return json(404, { ok: false, error: "Candidate not found" });
    if (b.cancel) { c.iv = null; c.stage = "shortlisted"; c.hist.push({ at: t, by, stage: "shortlisted", note: "Interview cancelled" }); await store.set("hrc:" + c.id, c); return json(200, { ok: true }); }
    const at = +b.at; if (!(at > t - 3600e3)) return json(400, { ok: false, error: "Choose the interview date and time" });
    let link = str(b.link, 300);
    if (link && !/^https:\/\//i.test(link)) return json(400, { ok: false, error: "The meeting link must start with https://" });
    if (!link) link = (c.iv && c.iv.link && /meet\.jit\.si/.test(c.iv.link)) ? c.iv.link : meetLink(t);
    c.iv = { at, link, mins: Math.max(10, Math.min(120, +b.mins || 20)), by, byEmail: low(rec.email), notes: txt(b.notes, 400), bookedAt: t };
    c.stage = "interview"; c.hist.push({ at: t, by, stage: "interview", note: "Interview " + fmtT(at) });
    await store.set("hrc:" + c.id, c);
    const statusLink = (ctx.env.SITE_URL || "") + "/hire.html?c=" + c.token;
    let mailed = null;
    if (c.email) mailed = await mail(ctx, [c.email], emails(rec.email), `vivo interview · ${c.roleName} · ${fmtT(at)}`, shell("Your vivo interview", `<p>Dear ${escH(c.name)},</p><p>Your online interview for <b>${escH(c.roleName)}</b> is on <b>${fmtT(at)}</b> (about ${c.iv.mins} minutes).</p><p>Open the link a few minutes early on your phone or laptop and allow the camera and microphone.</p>${btn(link, "Join the interview")}<p style="font-size:12px;color:#6B7090">Your application status: <a href="${statusLink}">${statusLink}</a></p>`));
    const wa = `Hello ${c.name}, your vivo interview for ${c.roleName} is on ${fmtT(at)}. Join here: ${link}  (status: ${statusLink})`;
    return json(200, { ok: true, iv: c.iv, mailed, wa, phone: c.phone });
  }
  if (b.action === "hr-cfg") {
    if (!isHO) return json(403, { ok: false, error: "Only HO admins change the HR set-up." });
    if (b.save) {
      const c = b.cfg || {};
      const roles = (Array.isArray(c.roles) ? c.roles : []).slice(0, 20).map((r, i) => ({ id: str(r.id, 20).replace(/[^a-z0-9]/gi, "").toLowerCase() || "r" + nid(t + i), name: str(r.name, 60), jd: txt(r.jd, 1500) })).filter((r) => r.name);
      if (roles.length) cfg.roles = roles;
      cfg.hr = (Array.isArray(c.hr) ? c.hr : []).filter((h) => STATES.includes(h.state)).map((h) => ({ state: h.state, emails: emails(h.emails) })).filter((h) => h.emails.length);
      cfg.hoHr = emails(c.hoHr); cfg.mail = c.mail !== false;
      if (c.linkOn !== undefined) cfg.link.on = !!c.linkOn;
      if (c.newLink) cfg.link.token = tok();
      await store.set("hrcfg", cfg);
    }
    return json(200, { ok: true, cfg });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// public: referral link (no login) and the candidate's own status link
export async function hrPublic(b, ctx) {
  const { store, t } = ctx, cfg = await cfgOf(store);
  if (b.action === "hr-p-status") {
    const tk = String(b.c || "").replace(/[^a-f0-9]/g, "");
    const ix = tk ? await store.get("hrtok:" + tk) : null, c = ix ? await store.get("hrc:" + ix.id) : null;
    if (c && c.token === tk) return json(200, { ok: true, name: c.name, role: c.roleName, state: c.state, stage: c.stage, stageName: HR_STAGES[c.stage], iv: c.iv && c.stage === "interview" ? { at: c.iv.at, link: c.iv.link, mins: c.iv.mins } : null });
    return json(404, { ok: false, error: "This link isn't valid." });
  }
  const rtok = String(b.r || "").replace(/[^a-f0-9]/g, "");
  if (!cfg.link.on || rtok !== cfg.link.token) return json(403, { ok: false, error: "This referral link is closed. Ask your HR team for the new link." });
  if (b.action === "hr-p-info") return json(200, { ok: true, roles: cfg.roles.map((r) => ({ id: r.id, name: r.name })), states: STATES });
  if (b.action === "hr-p-refer") {
    // light flood guard for the open link
    const hk = "hrrate:" + new Date(t).toISOString().slice(0, 13); const h = (await store.get(hk)) || { n: 0 };
    if (h.n > 120) return json(429, { ok: false, error: "Too many referrals right now — try again in an hour." });
    if (b.hp) return json(200, { ok: true, id: "x" });   // honeypot
    const c = b.c || {}, rn = str(c.refName, 60);
    if (!rn) return json(400, { ok: false, error: "Enter your own name (the referrer)" });
    const r = await createCand(ctx, cfg, c, { name: rn, phone: phoneOf(c.refPhone), empId: str(c.refEmp, 30), key: "link", via: "link" });
    if (r.status === 200) { h.n++; await store.set(hk, h); }
    return r;
  }
  if (b.action === "hr-p-cv") {
    const c = await store.get("hrc:" + str(b.id, 20));
    if (!c || !b.up || c.up !== String(b.up) || c.cv) return json(403, { ok: false, error: "Upload not allowed" });
    return cvPiece(ctx, c, b);
  }
  return json(400, { ok: false, error: "Unknown action" });
}
