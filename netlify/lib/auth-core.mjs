// Account logic for the vivo BI apps (Admin and State). Kept separate from the Netlify
// wrapper so it can be tested. Passwords are stored only as salted scrypt hashes.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { surveyAction } from "./survey-core.mjs";
import { chatAction } from "./chat-core.mjs";
import { visitAction } from "./visit-core.mjs";
import { kbAction } from "./kb-core.mjs";
import { affAction } from "./aff-core.mjs";
import { opsAction, modulesFor, moduleOn } from "./ops-core.mjs";
import { disputeAction } from "./dispute-core.mjs";
import { hygieneAction } from "./hygiene-core.mjs";
import { engageAction } from "./engage-core.mjs";
import { autorepAction } from "./autorep-core.mjs";
import { inviteAdminAction, INVITE_DAYS } from "./invite-core.mjs";
import { toolsAction } from "./tools-core.mjs";
import { schemeCalcAction } from "./schemecalc-core.mjs";
import { masterAction, MASTER_SETUP_SHA256, roleOf } from "./master-core.mjs";
import { matrixAction } from "./matrix-core.mjs";
import { vKey, checkVchat, vchatAdminAction, directory, accessCodeFor } from "./vchat-core.mjs";

// SHA-256 of the sign-up access codes (vivoBI@2026 for admin, vivoState@2026 for state).
const ACCESS_CODE_SHA256 = {
  admin: "e90006efb1935ad651efa74b10b58270650d34be833a320228eef0437dad2403",
  state: "3577b5f173d6ace1cbff153510cb8b3eef4003706b6ba05152056b0e5268f376",
};
// Truecaller Client IDs (public; also inside the apps).
const TC_CLIENT_ID = {
  admin: "ch5mnecr-j4xvppaykjcunml3rhj_orhqkvravmrq4e",
  state: "va-4qf3ljrl36tfbtkc3ogxl6rnoazvbjuw6nqcgs4s",
};
const TC_TOKEN_URL = "https://oauth-account-noneu.truecaller.com/v1/token";
const TC_USERINFO_URL = "https://oauth-account-noneu.truecaller.com/v1/userinfo";
const MAX_LOGIN_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2)
    : d.length === 11 && d.startsWith("0") ? d.slice(1)
    : d;
  return /^[6-9]\d{9}$/.test(ten) ? "+91" + ten : null;
}

// User name shown as typed; matched ignoring case and extra spaces.
export function userKey(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  if (n.length < 3 || n.length > 30 || !/^[A-Za-z0-9 ._-]+$/.test(n)) return null;
  return n.toLowerCase();
}

export function passwordProblem(pw) {
  const p = String(pw || "");
  if (p.length < 6) return "Password must be at least 6 characters.";
  if (p.length > 64) return "Password is too long.";
  return null;
}

function hashPassword(pw, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(String(pw), salt, 32).toString("hex") };
}

function checkPassword(pw, rec) {
  const a = Buffer.from(scryptSync(String(pw), rec.salt, 32).toString("hex"));
  const b = Buffer.from(rec.hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

const maskPhone = (p) => p.slice(0, 3) + " ******" + p.slice(-4);

const QR_TTL = 3 * 60 * 1000;          // web QR login code lifetime
const MAX_SESSIONS = 8;               // phones + browsers a user can stay logged in on at once
const MAX_PHOTO_BASE64 = 300 * 1024;  // ~220 KB JPEG
const PROFILE_LIMITS = { fullName: 40, email: 80, state: 40, designation: 50 };

// Creates a login session; only its hash is stored.
function newSession(rec, t) {
  const token = randomBytes(32).toString("hex");
  rec.sessions = [{ h: sha256(token), at: t }, ...(rec.sessions || [])].slice(0, MAX_SESSIONS);
  return token;
}

// ---------- Access log ----------
const LOG_KEEP = 2000;  // max entries returned per day
// Date in India (UTC+5:30) so "today" matches the admin's day.
export function istDate(t) { return new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10); }
const clip = (v, n) => String(v || "").slice(0, n);
async function logEvent(store, t, app, rec, event, b) {
  if (!store.list) return;   // logging needs a listable store
  const key = `log:${istDate(t)}:${app}:${t}-${randomBytes(3).toString("hex")}`;
  await store.set(key, {
    ts: t, app, event, username: rec ? rec.username : clip(b.username, 30),
    fullName: rec ? rec.fullName : "", phone: rec ? rec.phone : "", state: rec ? (rec.state || "") : "",
    device: clip(b.device, 60), ver: clip(b.ver, 20),
  });
}

// Runs fn over items with limited parallelism.
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// All log events of one IST day. Past days are compacted into one blob so ranges load fast.
async function readLogDay(store, date, today) {
  const packed = await store.get(`logday:${date}`);
  const keys = await store.list(`log:${date}:`);
  let events = packed ? packed.events : [];
  if (keys.length) {
    const fresh = (await pool(keys, 40, (k) => store.get(k))).filter(Boolean);
    events = events.concat(fresh);
    if (date < today) {
      await store.set(`logday:${date}`, { events });
      await pool(keys, 40, (k) => store.delete(k));
    }
  }
  return events;
}

function dayList(from, to, max) {
  const out = []; let d = new Date(from + "T00:00:00Z"); const end = new Date(to + "T00:00:00Z");
  while (d <= end && out.length < max) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  return out;
}

// ---------- Email OTP (web sign-up / forgot password), sent with Brevo's free plan ----------
const EOTP_TTL = 10 * 60 * 1000, EOTP_TRIES = 5;
export function normEmail(e) { const v = String(e || "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 80 ? v : null; }
export async function sendEmailOtp(env, to, code, purpose, fetchImpl = fetch) {
  if (!env.BREVO_API_KEY || !env.OTP_FROM_EMAIL) return { ok: false, error: "Email OTP is not set up yet. Please contact your BI admin." };
  const what = purpose === "reset" ? "reset your password" : "create your account";
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:420px;margin:auto;border:1px solid #eadfc4;border-radius:14px;overflow:hidden">
    <div style="background:#0b0b0c;color:#c9a227;padding:14px 18px;font-size:12px;letter-spacing:.18em">VIVO BUSINESS INNOVATION</div>
    <div style="padding:20px 18px;color:#111"><p style="margin:0 0 10px">Use this code to ${what} on the BI KPI Dashboard:</p>
    <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#0b0b0c;background:#fbf9f3;border:1px dashed #c9a227;border-radius:10px;text-align:center;padding:12px">${code}</div>
    <p style="color:#6b6657;font-size:13px">The code is valid for 10 minutes. Don't share it with anyone. If you didn't ask for it, ignore this email.</p></div></div>`;
  const r = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": env.BREVO_API_KEY },
    body: JSON.stringify({ sender: { name: env.OTP_FROM_NAME || "vivo BI Dashboard", email: env.OTP_FROM_EMAIL }, to: [{ email: to }],
      subject: code + " is your vivo BI Dashboard code", htmlContent: html }) });
  if (r.ok) return { ok: true };
  const j = await r.json().catch(() => ({}));
  return { ok: false, error: "Couldn't send the email (" + r.status + (j.message ? ": " + String(j.message).slice(0, 100) : "") + "). Please try again." };
}
async function findByEmail(store, app, email) {
  const idx = await store.get(`email:${app}:${email}`);
  if (idx) { const u = await store.get(`user:${app}:${idx.key}`); if (u && normEmail(u.email) === email) return { key: idx.key, rec: u }; }
  if (!store.list) return null;
  for (const k of await store.list(`user:${app}:`)) { const u = await store.get(k); if (u && normEmail(u.email) === email) return { key: k.split(":").slice(2).join(":"), rec: u }; }
  return null;
}

// ---------- Free AI (Google Gemini free tier) ----------
const AI_DAILY_LIMIT = 40;   // questions per user per day
const AI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-3.6-flash"];
const AI_SYSTEM = `You are "BI Assistant" inside vivo India's Business Innovation (BI) KPI Dashboard apps. Users are vivo state BI teams and HO admins who drive retailer adoption of the vivo Retailer App (vChat / Retailer Workplace) and state KPIs.

HOW TO ANSWER
- Start with a direct, specific answer in one or two sentences. No generic textbook openings.
- Then 3-5 short bullet points ("- ") with concrete, India-specific reasons or steps. Name real drivers (channels, price bands, schemes, retailer margins, festive seasons, model launches, offline vs online, Tier-2/3 towns).
- End with a line "For your state:" (or "For the team:" for HO admins) that links the answer to the DASHBOARD DATA: use the user's state rank, score and weakest KPI from the data, and say what to do this month. Skip this line only if the data is unrelated.
- Do NOT add disclaimers, notes about data sources, research firms, or "figures vary/change" lines. Never write "Note:". Only say you are unsure if the user asks for an exact figure you don't have.
- Keep it under ~170 words, plain text, Indian number format (lakh/crore, Rs). Reply in Hindi if the user writes in Hindi.

DASHBOARD FACTS
- Use ONLY the DASHBOARD DATA for scores, ranks and KPI %; quote exact numbers and the period. If something isn't in the data, say it briefly and answer from knowledge.
- BI KPI score = sum of min(achievement,100%) x weight. KPIs: Retailer App usage (largest weight; features: scheme announcement, scheme payout, announcements & notifications, app visits), sales target achievement, customer visit efficiency, competition management or support desk, v-Notice utilization, and in some quarters new retailer implementation.
- Scheme payout: Achievement% = Achieved/Target x 100; slab = highest slab whose From% <= achievement; below the first slab payout is 0. Retro: units x Rs/unit (or value x %) + bonus. Incremental: each band between thresholds (From% x Target/100) paid at its own rate, + bonus. Next slab units = ceil(NextFrom% x Target/100) - Achieved.

GENERAL MARKET QUESTIONS
- Answer confidently from general knowledge about the Indian smartphone market (vivo, Samsung, Xiaomi, OPPO, realme, Apple etc.): offline retail depth, promoter and retailer network, mid-range pricing, camera and design focus, local manufacturing, financing/EMI, festive demand, component and currency costs. Stay factual and balanced; don't disparage competitors; never invent vivo internal numbers.`;

// Removes generic disclaimer lines ("Note: figures vary by IDC/Canalys…") the model may still add.
export function cleanAI(t) {
  return t.split("\n").filter((l) => !/^\s*[-*•]?\s*(\*\*|_)?\s*(note|disclaimer)\b/i.test(l) &&
    !/(IDC|Canalys|Counterpoint|research firms?)[^\n]*(vary|varies|change|differ|estimate)/i.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Groq (free plan, no card, ~1,000 requests/day per model) is tried first; Gemini is the backup.
export const GROQ_CHAT_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
async function askGroq(key, system, contents, fetchImpl) {
  const messages = [{ role: "system", content: system }].concat(contents.map((c) => ({ role: c.role === "model" ? "assistant" : "user", content: c.parts[0].text })));
  let last = "";
  for (const m of GROQ_CHAT_MODELS) {
    const body = { model: m, messages, temperature: 0.6, max_completion_tokens: 1800 };
    if (/gpt-oss|qwen3/.test(m)) body.reasoning_effort = /qwen/.test(m) ? "none" : "low";
    try {
      let r = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify(body) });
      if (r.status === 400 && body.reasoning_effort) { delete body.reasoning_effort; r = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify(body) }); }
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        let text = String((((j.choices || [])[0] || {}).message || {}).content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (text) text = cleanAI(text);
        if (text) return { ok: true, text, model: "groq/" + m };
        last = "empty answer"; continue;
      }
      last = r.status + (j.error && j.error.message ? ": " + j.error.message.slice(0, 100) : "");
      if (r.status === 401) break;
    } catch (e) { last = "network " + e.message; }
  }
  return { ok: false, error: last };
}

export async function askAI(env, question, context, history, fetchImpl = fetch, opts = {}) {
  if (!env || (!env.GEMINI_API_KEY && !env.GROQ_API_KEY)) return { ok: false, error: "AI is not set up yet.", notConfigured: true };
  const contents = [];
  (Array.isArray(history) ? history : []).slice(-6).forEach((h) => {
    if (h && h.q) contents.push({ role: "user", parts: [{ text: String(h.q).slice(0, 600) }] });
    if (h && h.a) contents.push({ role: "model", parts: [{ text: String(h.a).slice(0, 1200) }] });
  });
  contents.push({ role: "user", parts: [{ text: (opts.label || "DASHBOARD DATA") + ":\n" + String(context || "").slice(0, 14000) + "\n\nQUESTION: " + String(question).slice(0, 800) }] });
  let groqErr = "";
  if (env.GROQ_API_KEY) {
    const g = await askGroq(env.GROQ_API_KEY, opts.system || AI_SYSTEM, contents, fetchImpl);
    if (g.ok) return g;
    groqErr = "Groq " + g.error;
    if (!env.GEMINI_API_KEY) return { ok: false, error: "AI is busy right now (" + groqErr + "). Showing built-in answers." };
  }
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: opts.system || AI_SYSTEM }] }, contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 900 } });
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...AI_MODELS] : AI_MODELS;
  let last = "";
  for (const m of models) {
    const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      let text = (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("").trim();
      if (text) text = cleanAI(text);
      if (text) return { ok: true, text, model: m };
      last = "empty answer"; continue;
    }
    last = r.status + (j.error && j.error.message ? ": " + j.error.message.slice(0, 120) : "");
    if (r.status === 400 || r.status === 401 || r.status === 403) break;   // bad key: other models won't help
  }
  return { ok: false, error: "AI is busy right now (" + [groqErr, last].filter(Boolean).join("; ") + "). Showing built-in answers." };
}

function publicProfile(rec) {
  return {
    username: rec.username, fullName: rec.fullName, phone: rec.phone,
    email: rec.email || "", state: rec.state || "", designation: rec.designation || "",
    createdAt: rec.createdAt || 0, photoVersion: rec.photoVersion || 0, vchatId: rec.vchatId || "", master: !!rec.master,
  };
}

// Truecaller one-tap login: swap the app's authorization code for the user's verified number.
export async function truecallerPhone(app, code, codeVerifier, fetchImpl = fetch) {
  const form = new URLSearchParams({
    grant_type: "authorization_code", client_id: TC_CLIENT_ID[app],
    code: String(code || ""), code_verifier: String(codeVerifier || ""),
  });
  const t = await fetchImpl(TC_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const tj = await t.json().catch(() => ({}));
  if (!t.ok || !tj.access_token) {
    return { ok: false, error: "Truecaller could not confirm the login (" + t.status + (tj.error ? ": " + tj.error : "") + "). Please try again." };
  }
  const u = await fetchImpl(TC_USERINFO_URL, { headers: { authorization: "Bearer " + tj.access_token } });
  const uj = await u.json().catch(() => ({}));
  const phone = normalizePhone(uj.phone_number || uj.phoneNumber || "");
  if (!u.ok || !phone) return { ok: false, error: "Truecaller did not share an Indian mobile number (" + u.status + ")." };
  const name = [uj.given_name, uj.family_name].filter(Boolean).join(" ");
  return { ok: true, phone, name };
}

// ---------- Support desk ----------
export const SUPPORT_TOPICS = ["Overview", "Rankings", "Trends", "Retailer app usage", "Active retailers", "Support desk KPI",
  "Action plan", "KPI framework / calculation", "Sales target", "Customer visit", "Competition", "v-Notice",
  "Schemes & payout", "Data mismatch", "App issue", "Other"];
const MAX_ATT_BYTES = 4 * 1024 * 1024;          // 4 MB per file
const ATT_TYPES = { pdf: "application/pdf", xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain" };

function who(app, rec) { return { app, username: rec.username, fullName: rec.fullName, state: rec.state || "" }; }
const sameUser = (a, b) => a && b && a.app === b.app && userKey(a.username) === userKey(b.username);

async function supportAction(b, { store, t, app, rec, key }) {
  const me = who(app, rec);
  const readKey = `sread:${app}:${key}`;
  const tKey = (id) => `ticket:${String(id).replace(/[^a-z0-9]/gi, "")}`;
  const listTickets = async () => {
    const keys = store.list ? await store.list("ticket:") : [];
    const out = [];
    for (const k of keys) { const x = await store.get(k); if (x) out.push(x); }
    return out.sort((a, c) => c.updatedAt - a.updatedAt);
  };
  // State users see their own queries and queries about their state; admins see everything.
  const canSee = (tk) => app === "admin" || sameUser(tk.by, me) ||
    (!!rec.state && (tk.state === rec.state || (tk.by && tk.by.state === rec.state)));
  const isUnread = (tk, reads) => {
    const last = tk.messages[tk.messages.length - 1];
    const actor = tk.lastActBy || (last && last.by);
    return actor && !sameUser(actor, me) && (reads[tk.id] || 0) < tk.updatedAt;
  };
  const cleanAtts = async (ids) => {
    const out = [];
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 5)) {
      const a = await store.get(`att:${String(id).replace(/[^a-z0-9]/gi, "")}`);
      if (a && sameUser(a.by, me)) out.push({ id: a.id, name: a.name, mime: a.mime, size: a.size });
    }
    return out;
  };

  if (b.action === "support-upload") {
    const name = String(b.name || "file").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (!ATT_TYPES[ext]) return json(400, { ok: false, error: "This file type isn't allowed. Use PDF, Excel, Word, PowerPoint, CSV, TXT or an image." });
    const data = String(b.data || "");
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) return json(400, { ok: false, error: "Invalid file." });
    const size = Math.floor(data.length * 3 / 4);
    if (size > MAX_ATT_BYTES) return json(400, { ok: false, error: "File is larger than 4 MB." });
    const id = t.toString(36) + randomBytes(5).toString("hex");
    await store.set(`att:${id}`, { id, name, mime: ATT_TYPES[ext], size, data, by: me, at: t });
    return json(200, { ok: true, att: { id, name, mime: ATT_TYPES[ext], size } });
  }

  if (b.action === "support-att") {
    const a = await store.get(`att:${String(b.id || "").replace(/[^a-z0-9]/gi, "")}`);
    if (!a) return json(404, { ok: false, error: "Attachment not found." });
    if (app !== "admin" && !sameUser(a.by, me)) {
      // State users may open an attachment only from a query they can see.
      const owner = b.ticketId ? await store.get(tKey(b.ticketId)) : null;
      const inTicket = owner && owner.messages.some((m) => (m.atts || []).some((x) => x.id === a.id));
      if (!inTicket || !canSee(owner)) return json(403, { ok: false, error: "You can't open this file." });
    }
    return json(200, { ok: true, name: a.name, mime: a.mime, data: a.data });
  }

  if (b.action === "support-unread") {
    const reads = (await store.get(readKey)) || {};
    const n = (await listTickets()).filter((tk) => canSee(tk) && isUnread(tk, reads)).length;
    return json(200, { ok: true, unread: n });
  }

  if (b.action === "support-list") {
    const reads = (await store.get(readKey)) || {};
    const tickets = (await listTickets()).filter(canSee).map((tk) => {
      const last = tk.messages[tk.messages.length - 1] || {};
      return { id: tk.id, no: tk.no, topic: tk.topic, subject: tk.subject, status: tk.status, state: tk.state,
        by: tk.by, createdAt: tk.createdAt, updatedAt: tk.updatedAt, count: tk.messages.length,
        last: { by: last.by, text: String(last.text || "").slice(0, 120), ts: last.ts },
        mine: sameUser(tk.by, me), unread: isUnread(tk, reads),
        rating: tk.messages.filter((m) => m.rating).map((m) => m.rating.stars).pop() || 0 };
    });
    return json(200, { ok: true, tickets, topics: SUPPORT_TOPICS });
  }

  if (b.action === "support-create") {
    const subject = String(b.subject || "").trim().slice(0, 120);
    const text = String(b.text || "").trim().slice(0, 4000);
    if (subject.length < 3) return json(400, { ok: false, error: "Please enter a short subject." });
    if (!text) return json(400, { ok: false, error: "Please describe your query." });
    const topic = SUPPORT_TOPICS.includes(b.topic) ? b.topic : "Other";
    const counter = ((await store.get("ticket-counter")) || { n: 100 }).n + 1;
    await store.set("ticket-counter", { n: counter });
    const id = t.toString(36) + randomBytes(3).toString("hex");
    // A state user's query is always about their own state.
    const tState = app === "state" && me.state ? me.state : String(b.state || me.state || "").slice(0, 40);
    const tk = { id, no: counter, topic, kpi: String(b.kpi || "").slice(0, 60), state: tState,
      subject, status: "open", by: me, createdAt: t, updatedAt: t,
      messages: [{ id: "m" + t.toString(36), ts: t, by: me, text, atts: await cleanAtts(b.atts), rating: null }] };
    await store.set(tKey(id), tk);
    return json(200, { ok: true, ticket: tk });
  }

  const tk = b.id ? await store.get(tKey(b.id)) : null;
  if (!tk || !canSee(tk)) return json(404, { ok: false, error: "Query not found." });

  if (b.action === "support-get") {
    const reads = (await store.get(readKey)) || {};
    reads[tk.id] = t;
    await store.set(readKey, reads);
    return json(200, { ok: true, ticket: tk, canRate: sameUser(tk.by, me) });
  }

  if (b.action === "support-reply") {
    const text = String(b.text || "").trim().slice(0, 4000);
    const atts = await cleanAtts(b.atts);
    if (!text && !atts.length) return json(400, { ok: false, error: "Write a reply or attach a file." });
    tk.messages.push({ id: "m" + t.toString(36) + randomBytes(2).toString("hex"), ts: t, by: me, text, atts, rating: null });
    tk.updatedAt = t;
    tk.lastActBy = me;
    tk.status = app === "admin" ? "answered" : (sameUser(tk.by, me) ? "open" : tk.status);
    await store.set(tKey(tk.id), tk);
    const reads = (await store.get(readKey)) || {}; reads[tk.id] = t; await store.set(readKey, reads);
    return json(200, { ok: true, ticket: tk });
  }

  if (b.action === "support-rate") {
    if (!sameUser(tk.by, me)) return json(403, { ok: false, error: "Only the person who raised this query can rate replies." });
    const m = tk.messages.find((x) => x.id === b.msgId);
    if (!m || m.by.app !== "admin") return json(400, { ok: false, error: "You can rate admin replies only." });
    const stars = Math.round(Number(b.stars));
    if (!(stars >= 1 && stars <= 5)) return json(400, { ok: false, error: "Choose 1 to 5 stars." });
    m.rating = { stars, ts: t, by: me };
    // More than 3 stars closes the query; 3 or fewer keeps it open for another reply.
    tk.status = stars > 3 ? "closed" : "open";
    tk.updatedAt = t;
    tk.lastActBy = me;        // admins see the new rating as unread
    await store.set(tKey(tk.id), tk);
    return json(200, { ok: true, ticket: tk, autoClosed: stars > 3 });
  }

  if (b.action === "support-status") {
    if (!(app === "admin" || sameUser(tk.by, me))) return json(403, { ok: false, error: "Not allowed." });
    tk.status = b.status === "closed" ? "closed" : "open";
    tk.updatedAt = t;
    tk.lastActBy = me;
    await store.set(tKey(tk.id), tk);
    return json(200, { ok: true, ticket: tk });
  }

  return json(400, { ok: false, error: "Unknown action" });
}

// store: { get(key) -> object|null, set(key, object), delete(key) }
let KEYCACHE = { at: 0, groq: "" };
export function _resetKeyCache() { KEYCACHE = { at: 0, groq: "" }; }
export async function handle(req, { store, now = () => Date.now(), tcFetch = fetch, env = {}, aiFetch = fetch, mailFetch = fetch, jobFetch = fetch }) {
  // The dashboard's Idea box talks to a "shared board" URL with plain GET / POST (no headers). tools-sync.js points it
  // here as /api/auth?tl=ideas&a=<app>&u=<user>&k=<token>; turn that into a normal session request.
  try {
    const u = new URL(req.url);
    if (u.searchParams.get("tl") === "ideas") {
      let body = {};
      if (req.method === "POST") { try { body = JSON.parse(await req.text()) || {}; } catch (e) { body = {}; } }
      req = new Request(u.origin + u.pathname, { method: "POST", headers: { "x-bi-app": "1", "content-type": "application/json" },
        body: JSON.stringify({ app: u.searchParams.get("a"), username: u.searchParams.get("u"), token: u.searchParams.get("k"), action: "tl-ideas", op: body.action || "list", idea: body.idea, id: body.id, up: body.up, status: body.status }) });
    }
  } catch (e) { }
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });
  if (!env.GROQ_API_KEY) {   // key saved by an admin in Affordability Corner → Data → AI keys
    if (Date.now() - KEYCACHE.at > 60000) { try { KEYCACHE = { at: Date.now(), groq: ((await store.get("config:aikeys")) || {}).groq || "" }; } catch (e) { } }
    if (KEYCACHE.groq) env = Object.assign({}, env, { GROQ_API_KEY: KEYCACHE.groq });
  }
  if (req.headers.get("x-bi-app") !== "1") return json(403, { ok: false, error: "Not allowed" });

  let b;
  try { b = await req.json(); } catch { return json(400, { ok: false, error: "Bad request" }); }
  const app = b.app === "admin" ? "admin" : b.app === "state" ? "state" : null;
  if (!app) return json(400, { ok: false, error: "Unknown app" });
  const t = now();
  const uKeyOf = (k) => `user:${app}:${k}`;
  const pKeyOf = (p) => `phone:${app}:${p}`;
  const eKeyOf = (e) => `email:${app}:${e}`;
  const otpKey = (purpose, e) => `eotp:${purpose}:${app}:${e}`;
  async function checkEmailOtp(purpose, email, code) {
    const k = otpKey(purpose, email), rec = await store.get(k);
    if (!rec || t > rec.exp) { if (rec) await store.delete(k); return "Code expired. Please request a new one."; }
    if (rec.hash !== sha256(email + ":" + String(code || "").replace(/\D/g, ""))) {
      rec.tries += 1;
      if (rec.tries >= EOTP_TRIES) { await store.delete(k); return "Too many wrong codes. Please request a new one."; }
      await store.set(k, rec); return "Incorrect code. " + (EOTP_TRIES - rec.tries) + " attempts left.";
    }
    await store.delete(k); return null;
  }

  // ---------- Admin switch: is Truecaller verification required in the apps? (default: yes) ----------
  // Older state accounts must link a vChat ID — but only once the admin has imported the vChat list.
  const linkRequired = async (r) => app === "state" && !r.vchatId && Object.keys((await directory(store)).rows).length > 0;
  const profOut = async (r) => Object.assign(publicProfile(r), { linkRequired: await linkRequired(r) });
  const authCfg = async () => Object.assign({ tcRequired: true }, (await store.get("config:auth")) || {});
  // Email code for state users: on when the Brevo key is in Netlify, unless an admin switched it off.
  // The Brevo key can come from Netlify, or be saved by an admin on the Account security page.
  if (!(env.BREVO_API_KEY && env.OTP_FROM_EMAIL)) {
    const ec = await store.get("config:email");
    if (ec && ec.apiKey && ec.from) env = Object.assign({}, env, { BREVO_API_KEY: ec.apiKey, OTP_FROM_EMAIL: ec.from, OTP_FROM_NAME: ec.name || env.OTP_FROM_NAME });
  }
  const emailReady = !!(env.BREVO_API_KEY && env.OTP_FROM_EMAIL);
  const emailOn = async () => emailReady && (await authCfg()).emailRequired !== false;
  if (b.action === "auth-config") {
    const c = await authCfg();
    // Admin sign-up: email from the allowed list + email code (no access code) whenever email sending works.
    return json(200, { ok: true, tcRequired: c.tcRequired !== false, emailOtp: app === "admin" ? emailReady : await emailOn(), adminEmailSignup: app === "admin" && emailReady });
  }

  // ---------- Forgot password by request: the user asks, a BI admin approves ----------
  if (b.action === "reset-request") {
    let key = null;
    if (app === "state") { const v = await store.get(`vchat:${vKey(b.username)}`); if (v) key = v.key; }
    if (!key) key = userKey(b.username);
    let rec = key ? await store.get(uKeyOf(key)) : null, rk = key;
    if (!rec && normalizePhone(b.username)) { const idx = await store.get(pKeyOf(normalizePhone(b.username))); if (idx) { rk = idx.key; rec = await store.get(uKeyOf(idx.key)); } }
    if (!rec) return json(404, { ok: false, error: "No account found with this user name or mobile number." });
    if (rec.disabled) return json(403, { ok: false, error: "Your account has been disabled by a BI admin. Please contact your BI admin.", disabled: true });
    const pwErr = passwordProblem(b.newPassword);
    if (pwErr) return json(400, { ok: false, error: pwErr });
    const qk = `pwreq:${app}:${rk}`;
    const old = await store.get(qk);
    const recent = ((old && old.history) || []).filter((x) => t - x < 86400000);
    if (recent.length >= 3) return json(429, { ok: false, error: "Too many requests today. Please contact your BI admin." });
    const reqId = randomBytes(12).toString("hex");
    await store.set(qk, { app, key: rk, username: rec.username, fullName: rec.fullName, phone: rec.phone, state: rec.state || "", designation: rec.designation || "",
      ...hashPassword(b.newPassword), note: clip(b.note, 200), device: clip(b.device, 60), via: clip(b.via, 10) || "app", at: t, status: "pending",
      rid: sha256(reqId), history: recent.concat([t]) });
    await logEvent(store, t, app, rec, "reset-requested", b);
    return json(200, { ok: true, reqId, username: rec.username });
  }
  if (b.action === "reset-status") {
    const key = userKey(b.username);
    const q = key ? await store.get(`pwreq:${app}:${key}`) : null;
    if (!q || q.rid !== sha256(String(b.reqId || ""))) return json(404, { ok: false, error: "Request not found." });
    return json(200, { ok: true, status: q.status, decidedAt: q.decidedAt || 0, reason: q.reason || "", username: q.username });
  }

  if (b.action === "email-otp-send") {
    const email = normEmail(b.email);
    if (!email) return json(400, { ok: false, error: "Enter a valid email address." });
    const purpose = b.purpose === "reset" ? "reset" : "signup";
    if (purpose === "reset" && !(await findByEmail(store, app, email))) return json(404, { ok: false, error: "No account uses this email. Use the app's Forgot password (Truecaller), or sign up." });
    if (purpose === "signup" && (await store.get(eKeyOf(email)))) return json(409, { ok: false, error: "This email already has an account. Log in or use Forgot password." });
    if (purpose === "signup" && app === "admin" && !((await authCfg()).adminEmails || []).includes(email)) return json(403, { ok: false, error: "This email isn't on the allowed admin list. Ask an existing BI admin to add it." });
    const rl = (await store.get(`eotprl:${email}`)) || { s: [] };
    const day = rl.s.filter((x) => t - x < 86400000), recent = day.filter((x) => t - x < 15 * 60000);
    if (recent.length >= 3 || day.length >= 8) return json(429, { ok: false, error: "Too many codes requested. Please try again later." });
    const code = String(Math.floor(100000 + (parseInt(randomBytes(4).toString("hex"), 16) % 900000)));
    const sent = await sendEmailOtp(env, email, code, purpose, mailFetch);
    if (!sent.ok) return json(502, { ok: false, error: sent.error });
    await store.set(otpKey(purpose, email), { hash: sha256(email + ":" + code), exp: t + EOTP_TTL, tries: 0 });
    day.push(t); await store.set(`eotprl:${email}`, { s: day });
    return json(200, { ok: true });
  }

  // ---------- First master admin: admin user name + password + one-time setup code ----------
  if (b.action === "master-claim") {
    if (app !== "admin") return json(400, { ok: false, error: "Use the Admin app." });
    const cm = (await store.get("config:master")) || {};
    if (cm.claimed) return json(409, { ok: false, error: "A master admin already exists. Ask them to give you master access." });
    const mk = userKey(b.username), mrec = mk ? await store.get(uKeyOf(mk)) : null;
    if (!mrec || mrec.disabled) return json(401, { ok: false, error: "User name or password is incorrect." });
    if (mrec.lockUntil && t < mrec.lockUntil) return json(429, { ok: false, error: "Too many wrong attempts. Try again later." });
    const codeOk = sha256(String(b.code || "").trim().toUpperCase()) === MASTER_SETUP_SHA256 || (env.MASTER_SETUP_CODE && String(b.code || "").trim() === env.MASTER_SETUP_CODE);
    if (!checkPassword(b.password, mrec) || !codeOk) {
      mrec.fails = (mrec.fails || 0) + 1; if (mrec.fails >= MAX_LOGIN_FAILS) { mrec.fails = 0; mrec.lockUntil = t + LOCK_MS; }
      await store.set(uKeyOf(mk), mrec);
      return json(401, { ok: false, error: "User name, password or setup code is incorrect." });
    }
    mrec.master = true; mrec.fails = 0; mrec.lastSeen = t;
    const token = newSession(mrec, t);
    await store.set(uKeyOf(mk), mrec);
    await store.set("config:master", { claimed: true, claimedBy: mrec.username, claimedAt: t });
    await logEvent(store, t, app, mrec, "master-claimed", { device: "setup code", ver: "" });
    return json(200, { ok: true, username: mrec.username, fullName: mrec.fullName, token, profile: publicProfile(mrec) });
  }

  // ---------- Invited users (#15): open the email link → verify email code → choose password ----------
  if (b.action === "invite-get" || b.action === "invite-otp" || b.action === "invite-accept") {
    const ik = `invite:${String(b.token || "").replace(/[^a-f0-9]/g, "")}`, inv = await store.get(ik);
    if (!inv || inv.status === "cancelled") return json(404, { ok: false, error: "This invitation link is not valid. Ask your BI admin to send a new one." });
    if (inv.status === "done") return json(410, { ok: false, done: true, error: "You have already finished registration. Log in with your " + (inv.role === "state" ? "vChat ID" : "user name") + ".", username: inv.username || "", role: inv.role });
    if (t > inv.exp) return json(410, { ok: false, error: "This invitation has expired. Ask your BI admin to resend it." });
    if (b.action === "invite-get") {
      if (inv.status === "sent") { inv.status = "opened"; inv.openedAt = t; await store.set(ik, inv); }
      return json(200, { ok: true, invite: { role: inv.role, name: inv.name, email: inv.email, state: inv.state, vchatId: inv.vchatId, mobile: inv.mobile ? "••••••" + inv.mobile.slice(-4) : "", exp: inv.exp } });
    }
    if (inv.role !== app) return json(400, { ok: false, error: "Wrong app for this invitation." });
    const okey = `eotp:invite:${app}:${inv.email}`;
    if (b.action === "invite-otp") {
      const rl = (await store.get(`eotprl:${inv.email}`)) || { s: [] };
      const day = rl.s.filter((x) => t - x < 86400000), recent = day.filter((x) => t - x < 15 * 60000);
      if (recent.length >= 3 || day.length >= 8) return json(429, { ok: false, error: "Too many codes requested. Please try again later." });
      const code = String(Math.floor(100000 + (parseInt(randomBytes(4).toString("hex"), 16) % 900000)));
      const sent = await sendEmailOtp(env, inv.email, code, "signup", mailFetch);
      if (!sent.ok) return json(502, { ok: false, error: sent.error });
      await store.set(okey, { hash: sha256(inv.email + ":" + code), exp: t + EOTP_TTL, tries: 0 });
      day.push(t); await store.set(`eotprl:${inv.email}`, { s: day });
      return json(200, { ok: true });
    }
    // accept
    const username = String(b.username || (inv.role === "state" ? inv.vchatId : "")).trim().replace(/\s+/g, " ");
    const ukey = userKey(username);
    if (!ukey) return json(400, { ok: false, error: "User name must be 3–30 letters/numbers (spaces, . _ - allowed).", field: "username" });
    const pwErr = passwordProblem(b.password);
    if (pwErr) return json(400, { ok: false, error: pwErr, field: "password" });
    const o = await store.get(okey);
    if (!o || t > o.exp) return json(400, { ok: false, error: "Code expired. Tap Send code again.", field: "otp" });
    if (o.hash !== sha256(inv.email + ":" + String(b.otp || "").replace(/\D/g, ""))) { o.tries += 1; if (o.tries >= EOTP_TRIES) await store.delete(okey); else await store.set(okey, o); return json(400, { ok: false, error: "Incorrect code.", field: "otp" }); }
    if (await store.get(uKeyOf(ukey))) return json(409, { ok: false, error: "This user name is taken. Please choose another.", field: "username" });
    if (await store.get(eKeyOf(inv.email))) return json(409, { ok: false, error: "This email already has an account. Log in or use Forgot password." });
    const phone = inv.mobile ? normalizePhone(inv.mobile) : null;
    if (phone && (await store.get(pKeyOf(phone)))) return json(409, { ok: false, error: "This mobile number already has an account. Ask your BI admin." });
    if (inv.role === "state" && (await store.get(`vchat:${vKey(inv.vchatId)}`))) return json(409, { ok: false, error: "This vChat ID is already registered. Ask your BI admin." });
    await store.delete(okey);
    const nrec = { username, fullName: inv.name, phone: phone || "", ...hashPassword(b.password), createdAt: t, fails: 0, lockUntil: 0, sessions: [], state: inv.state || "",
      email: inv.email, emailVerified: true, phoneVerified: false, signupVia: "invite", invitedBy: inv.by };
    if (inv.role === "state") Object.assign(nrec, { vchatId: inv.vchatId, vchatVerified: true });
    const token = newSession(nrec, t); nrec.lastSeen = t;
    await store.set(uKeyOf(ukey), nrec);
    if (phone) await store.set(pKeyOf(phone), { key: ukey });
    await store.set(eKeyOf(inv.email), { key: ukey });
    if (inv.role === "state") await store.set(`vchat:${vKey(inv.vchatId)}`, { key: ukey });
    Object.assign(inv, { status: "done", doneAt: t, username }); await store.set(ik, inv);
    await logEvent(store, t, app, nrec, "signup", { via: "invite", device: "invite", ver: "" });
    return json(200, { ok: true, username, fullName: nrec.fullName, token, profile: publicProfile(nrec) });
  }

  // Web: forgot password with an email code.
  if (b.action === "reset-email") {
    const email = normEmail(b.email);
    if (!email) return json(400, { ok: false, error: "Enter a valid email address." });
    const found = await findByEmail(store, app, email);
    if (!found) return json(404, { ok: false, error: "No account uses this email." });
    const pwErr = passwordProblem(b.newPassword);
    if (pwErr) return json(400, { ok: false, error: pwErr });
    const bad = await checkEmailOtp("reset", email, b.otp);
    if (bad) return json(400, { ok: false, error: bad });
    if (found.rec.disabled) return json(403, { ok: false, error: "Your account has been disabled by a BI admin. Please contact your BI admin.", disabled: true });
    Object.assign(found.rec, hashPassword(b.newPassword), { fails: 0, lockUntil: 0, resetAt: t, sessions: [], emailVerified: true });
    await store.set(uKeyOf(found.key), found.rec);
    await logEvent(store, t, app, found.rec, "password-reset", { device: "email code", ver: "" });
    return json(200, { ok: true, username: found.rec.username, vchatId: found.rec.vchatId || "" });
  }

  // ---------- State users: sign up with the vChat ID from the admin's allowed list ----------
  if (b.action === "vchat-lookup") {
    if (app !== "state") return json(400, { ok: false, error: "Not needed." });
    const v = await checkVchat(store, normalizePhone, { vchatId: b.vchatId }, { lookupOnly: true });
    if (v.error) return json(v.taken ? 409 : 404, { ok: false, error: v.error, field: v.field });
    return json(200, { ok: true, state: v.row.state, vchatId: v.row.vchatId });
  }
  if ((b.action === "signup-check" || b.action === "signup") && app === "state") {
    if (!b.vchatId) return json(400, { ok: false, error: "State sign-up now uses your vChat ID. Please update the app (or refresh the web page) and try again." });
    const v = await checkVchat(store, normalizePhone, b);
    if (v.error) return json(v.taken ? 409 : 400, { ok: false, error: v.error, field: v.field });
    const key = userKey(b.username);
    if (!key) return json(400, { ok: false, error: "User name must be 3–30 letters/numbers (spaces, . _ - allowed).", field: "username" });
    const pwErr = passwordProblem(b.password);
    if (pwErr) return json(400, { ok: false, error: pwErr, field: "password" });
    const email = normEmail(b.email);
    if (!email) return json(400, { ok: false, error: "Enter a valid email address.", field: "email" });
    if (await store.get(eKeyOf(email))) return json(409, { ok: false, error: "This email already has an account.", field: "email" });
    if (await store.get(uKeyOf(key))) return json(409, { ok: false, error: "This user name is taken. Please choose another.", field: "username" });
    if (await store.get(pKeyOf(v.phone))) return json(409, { ok: false, error: "This vChat mobile number already has an older account. Log in with that user name and password — you'll be asked to link your vChat ID.", field: "phone" });
    if (b.action === "signup-check") return json(200, { ok: true });
    let emailOk = false;
    if (await emailOn()) {
      if (!String(b.emailOtp || "").trim()) return json(400, { ok: false, error: "Tap Send code and enter the code we emailed you.", field: "emailOtp" });
      const bad = await checkEmailOtp("signup", email, b.emailOtp);
      if (bad) return json(400, { ok: false, error: bad, field: "emailOtp" });
      emailOk = true;
    }
    const username = String(b.username).trim().replace(/\s+/g, " ");
    const rec = { username, fullName: v.row.name, phone: v.phone, ...hashPassword(b.password), createdAt: t, fails: 0, lockUntil: 0, sessions: [],
      state: v.row.state, email, emailVerified: emailOk, phoneVerified: false, vchatId: v.row.vchatId, vchatVerified: true, signupVia: b.via === "web" ? "web" : "app" };
    const token = newSession(rec, t);
    rec.lastSeen = t;
    await store.set(uKeyOf(key), rec);
    await store.set(pKeyOf(v.phone), { key });
    await store.set(eKeyOf(email), { key });
    await store.set(`vchat:${v.key}`, { key });
    await logEvent(store, t, app, rec, "signup", b);
    return json(200, { ok: true, username, fullName: rec.fullName, token, profile: publicProfile(rec) });
  }

  // Checks done before the user spends time on mobile verification.
  if (b.action === "signup-check" || b.action === "signup") {
    const adminByEmail = app === "admin" && emailReady;
    if (adminByEmail) {
      const em = normEmail(b.email);
      if (!em) return json(400, { ok: false, error: "Enter your email address.", field: "email" });
      if (!((await authCfg()).adminEmails || []).includes(em)) return json(403, { ok: false, error: "This email isn't on the allowed admin list. Ask an existing BI admin to add it (Account security → Allowed admin emails).", field: "email" });
    } else if (sha256(String(b.accessCode || "")) !== ACCESS_CODE_SHA256[app]) {
      return json(400, { ok: false, error: "Wrong access code. Ask your BI admin for the code." });
    }
    const name = String(b.fullName || "").trim();
    if (name.length < 2) return json(400, { ok: false, error: "Please enter your full name." });
    const key = userKey(b.username);
    if (!key) return json(400, { ok: false, error: "User name must be 3–30 letters/numbers (spaces, . _ - allowed)." });
    const phone = normalizePhone(b.phone);
    if (!phone) return json(400, { ok: false, error: "Enter a valid 10-digit mobile number." });
    const pwErr = passwordProblem(b.password);
    if (pwErr) return json(400, { ok: false, error: pwErr });
    const userState = String(b.state || "").trim().slice(0, 40);
    if (app === "state" && !userState) return json(400, { ok: false, error: "Please select your state." });
    const signupEmail = b.email ? normEmail(b.email) : null;
    if (b.email && !signupEmail) return json(400, { ok: false, error: "Enter a valid email address.", field: "email" });
    const needEmailCode = app === "admin" ? emailReady : await emailOn();
    if (needEmailCode && !signupEmail) return json(400, { ok: false, error: "Enter your email address.", field: "email" });
    if (signupEmail && (await store.get(eKeyOf(signupEmail)))) return json(409, { ok: false, error: "This email already has an account. Log in or use Forgot password." });
    if (await store.get(uKeyOf(key))) return json(409, { ok: false, error: "This user name is taken. Please choose another." });
    if (await store.get(pKeyOf(phone))) {
      return json(409, { ok: false, error: "This mobile number already has an account. Use Login, or Forgot password." });
    }
    if (b.action === "signup-check") return json(200, { ok: true });

    let emailVerified = false;
    if (needEmailCode) {               // email code (free) replaces Truecaller / open web sign-up
      if (!String(b.emailOtp || "").trim()) return json(400, { ok: false, error: "Tap Send code and enter the code we emailed you.", field: "emailOtp" });
      const bad = await checkEmailOtp("signup", signupEmail, b.emailOtp);
      if (bad) return json(400, { ok: false, error: bad, field: "emailOtp" });
      emailVerified = true;
    } else if (b.emailOtp != null) {           // web sign-up: email code instead of Truecaller
      if (!signupEmail) return json(400, { ok: false, error: "Enter your email address." });
      const bad = await checkEmailOtp("signup", signupEmail, b.emailOtp);
      if (bad) return json(400, { ok: false, error: bad });
      emailVerified = true;
    } else if (b.via === "web") {
      // Web sign-up without OTP: the access code (checked above) is the gate.
    } else if (b.phoneVerified !== true && (await authCfg()).tcRequired !== false) return json(400, { ok: false, error: "Mobile number is not verified." });
    const username = String(b.username).trim().replace(/\s+/g, " ");
    const rec = {
      username, fullName: name, phone, ...hashPassword(b.password),
      createdAt: t, fails: 0, lockUntil: 0, sessions: [], state: userState,
      email: signupEmail || "", emailVerified, phoneVerified: b.phoneVerified === true && b.via !== "web",
      signupVia: emailVerified || b.via === "web" ? "web" : "app",
    };
    const token = newSession(rec, t);
    rec.lastSeen = t;
    await store.set(uKeyOf(key), rec);
    await store.set(pKeyOf(phone), { key });
    if (signupEmail) await store.set(eKeyOf(signupEmail), { key });
    await logEvent(store, t, app, rec, "signup", b);
    return json(200, { ok: true, username, fullName: name, token, profile: publicProfile(rec) });
  }

  if (b.action === "login") {
    // State users log in with their vChat ID (older accounts can still use their user name until linked).
    let key = null;
    if (app === "state" && b.vchatId) { const v = await store.get(`vchat:${vKey(b.vchatId)}`); if (v) key = v.key; }
    if (!key) key = userKey(b.username || b.vchatId);
    const rec = key ? await store.get(uKeyOf(key)) : null;
    const badLogin = app === "state" ? "vChat ID or password is incorrect." : "User name or password is incorrect.";
    if (!rec) return json(401, { ok: false, error: badLogin });
    if (rec.disabled) {
      if (!checkPassword(b.password, rec)) return json(401, { ok: false, error: badLogin });
      return json(403, { ok: false, error: "Your account has been disabled by a BI admin. Please contact your BI admin.", disabled: true });
    }
    if (rec.lockUntil && t < rec.lockUntil) {
      const mins = Math.ceil((rec.lockUntil - t) / 60000);
      return json(429, { ok: false, error: `Too many wrong attempts. Try again in ${mins} min, or use Forgot password.` });
    }
    if (!checkPassword(b.password, rec)) {
      rec.fails = (rec.fails || 0) + 1;
      if (rec.fails >= MAX_LOGIN_FAILS) { rec.fails = 0; rec.lockUntil = t + LOCK_MS; }
      await store.set(uKeyOf(key), rec);
      return json(401, { ok: false, error: badLogin });
    }
    if (b.loginAs === "master" && !(app === "admin" && rec.master)) {
      const cm = (await store.get("config:master")) || {};
      return json(403, { ok: false, notMaster: true, canClaim: !cm.claimed, error: cm.claimed ? "This account isn't a master admin. Ask a master admin to give you master access, or use the Admin tab." : "This account isn't a master admin yet. If you have the master setup code, tap “Become master admin”." });
    }
    rec.fails = 0; rec.lockUntil = 0; rec.lastSeen = t;
    const token = newSession(rec, t);
    await store.set(uKeyOf(key), rec);
    await logEvent(store, t, app, rec, b.loginAs === "master" ? "login-master" : "login", b);
    return json(200, { ok: true, username: rec.username, fullName: rec.fullName, token, profile: await profOut(rec) });
  }

  // Forgot password: check the number has an account, then (after Truecaller
  // re-verification in the app) set a new password.
  if (b.action === "reset-check" || b.action === "reset") {
    const phone = normalizePhone(b.phone);
    if (!phone) return json(400, { ok: false, error: "Enter a valid 10-digit mobile number." });
    const idx = await store.get(pKeyOf(phone));
    const rec = idx ? await store.get(uKeyOf(idx.key)) : null;
    if (!rec) return json(404, { ok: false, error: "No account found for this mobile number. Please Sign up." });
    if (rec.disabled) return json(403, { ok: false, error: "Your account has been disabled by a BI admin. Please contact your BI admin.", disabled: true });
    if (b.action === "reset-check") return json(200, { ok: true, phone: maskPhone(phone) });

    if (b.phoneVerified !== true) return json(400, { ok: false, error: "Mobile number is not verified." });
    if ((await authCfg()).tcRequired === false) return json(400, { ok: false, error: "Mobile verification is turned off. Please update the app and use Forgot password to send a reset request to your BI admin." });
    const pwErr = passwordProblem(b.newPassword);
    if (pwErr) return json(400, { ok: false, error: pwErr });
    // A reset logs the account out on every phone.
    Object.assign(rec, hashPassword(b.newPassword), { fails: 0, lockUntil: 0, resetAt: t, sessions: [] });
    await store.set(uKeyOf(idx.key), rec);
    await logEvent(store, t, app, rec, "password-reset", b);
    return json(200, { ok: true, username: rec.username });
  }

  if (b.action === "tc-exchange") {
    const r = await truecallerPhone(app, b.code, b.codeVerifier, tcFetch);
    if (!r.ok) return json(400, { ok: false, error: r.error });
    return json(200, { ok: true, phone: r.phone.slice(3), name: r.name });
  }

  // ---------- QR login for the web portal ----------
  // The web login page shows a QR code (qr-create) and waits (qr-poll); a logged-in app scans it (qr-approve).
  if (b.action === "qr-create") {
    const id = randomBytes(9).toString("hex"), secret = randomBytes(24).toString("hex");
    await store.set(`qr:${id}`, { sh: sha256(secret), exp: t + QR_TTL, status: "pending", device: clip(b.device, 60), at: t });
    if (store.list && Math.random() < 0.1) {          // tidy up expired codes now and then
      const ks = await store.list("qr:");
      await pool(ks, 20, async (k) => { const q = await store.get(k); if (!q || t > q.exp + 60000) await store.delete(k); });
    }
    return json(200, { ok: true, id, secret, ttl: QR_TTL });
  }
  if (b.action === "qr-poll") {
    const k = `qr:${String(b.id || "").replace(/[^a-f0-9]/g, "")}`;
    const q = await store.get(k);
    if (!q || q.sh !== sha256(String(b.secret || ""))) return json(404, { ok: false, expired: true, error: "This QR code has expired." });
    if (q.status === "pending") {
      if (t > q.exp) { await store.delete(k); return json(410, { ok: false, expired: true, error: "This QR code has expired." }); }
      return json(200, { ok: true, status: "pending" });
    }
    await store.delete(k);           // one-time use
    if (q.status !== "approved") return json(403, { ok: false, rejected: true, error: "Login was declined on the phone." });
    const uk = `user:${q.app}:${q.key}`;
    const u = await store.get(uk);
    if (!u) return json(404, { ok: false, error: "Account not found." });
    if (u.disabled) return json(403, { ok: false, error: "Your account has been disabled by a BI admin. Please contact your BI admin.", disabled: true });
    u.lastSeen = t;
    const token = newSession(u, t);
    await store.set(uk, u);
    await logEvent(store, t, q.app, u, "qr-login", { device: q.device || "Web browser", ver: "web" });
    return json(200, { ok: true, status: "approved", app: q.app, username: u.username, fullName: u.fullName, token, profile: publicProfile(u) });
  }

  // ---------- Actions for a logged-in user (user name + session token) ----------
  const SESSION_ACTIONS = ["me", "ping", "update-profile", "change-password", "upload-photo", "get-photo",
    "remove-photo", "logout", "delete-account", "admin-users", "admin-logs", "admin-set-state", "set-state-once",
    "support-list", "support-get", "support-create", "support-reply", "support-rate", "support-status",
    "support-upload", "support-att", "support-unread", "ai-ask", "ai-status", "admin-logs-range", "admin-support-data",
    "admin-set-disabled", "notify", "qr-approve", "survey-list", "survey-get", "survey-save", "survey-respond",
    "survey-status", "survey-remind", "survey-results", "survey-ai", "chat-contacts", "chat-list", "chat-get", "chat-send", "chat-att",
    "matrix-get", "matrix-arch", "matrix-import", "matrix-set", "matrix-freeze", "matrix-remind",
    "visit-config", "visit-stores", "visit-start", "visit-save", "visit-end", "visit-cancel", "visit-get", "visit-list", "visit-live", "visit-stats", "visit-ai-one", "visit-ai-states",
    "kb-list", "kb-read", "kb-get", "kb-att", "kb-save", "kb-delete",
    "aff-catalog", "aff-model", "aff-many", "aff-states", "aff-report-add", "aff-report-delete", "aff-report-verify", "aff-photo", "aff-refresh", "aff-hide", "aff-status", "aff-refresh-stale", "aff-keys", "aff-keys-test", "aff-model-edit",
    "admin-security", "admin-set-auth", "admin-pwreq-decide", "admin-email-test", "admin-email-config", "admin-admin-emails", "vchat-link", "vdir-get", "vdir-import", "vdir-upsert", "vdir-delete", "vdir-unlink"];
  const NEW_PREFIX = /^(mod|faq|help|esc|flow|scheme|disp|hyg|quiz|poll|wall|recog|people|engage|autorep|inv|cust|ct|cxx|master|tl|sc)-/;
  if (SESSION_ACTIONS.includes(b.action) || NEW_PREFIX.test(b.action) || b.action === "hub") {
    const key = userKey(b.username);
    const rec = key ? await store.get(uKeyOf(key)) : null;
    const th = sha256(String(b.token || ""));
    const sess = rec && (rec.sessions || []).find((x) => x.h === th);
    if (rec && rec.disabled) return json(401, { ok: false, error: "Your account has been disabled by a BI admin. Please contact your BI admin.", loggedOut: true, disabled: true });
    if (!sess) return json(401, { ok: false, error: "You have been logged out. Please log in again.", loggedOut: true });
    const save = () => store.set(uKeyOf(key), rec);
    // Older state accounts must link a vChat ID from the allowed list before using anything else.
    if (app === "state" && !rec.vchatId && !["me", "ping", "vchat-link", "logout", "delete-account", "get-photo"].includes(b.action) && await linkRequired(rec)) {
      return json(403, { ok: false, needsLink: true, error: "Please link your vChat ID to continue." });
    }
    if (b.action === "vchat-link") {
      if (app !== "state") return json(400, { ok: false, error: "Not needed." });
      if (rec.vchatId) return json(400, { ok: false, error: "Your vChat ID is already linked." });
      const v = await checkVchat(store, normalizePhone, b, { ownKey: key });
      if (v.error) return json(v.taken ? 409 : 400, { ok: false, error: v.error, field: v.field });
      if (v.phone !== rec.phone) {
        const other = await store.get(pKeyOf(v.phone));
        if (other && other.key !== key) return json(409, { ok: false, error: "This vChat mobile number is used by another account. Ask your BI admin.", field: "phone" });
        if (rec.phone) await store.delete(pKeyOf(rec.phone));
        await store.set(pKeyOf(v.phone), { key });
      }
      Object.assign(rec, { vchatId: v.row.vchatId, vchatVerified: true, state: v.row.state, fullName: v.row.name, phone: v.phone, linkedAt: t });
      await save();
      await store.set(`vchat:${v.key}`, { key });
      await logEvent(store, t, app, rec, "vchat-linked", b);
      return json(200, { ok: true, profile: publicProfile(rec) });
    }
    if (b.action.startsWith("vdir-")) return vchatAdminAction(b, { store, t, app, rec, pool, normalizePhone, logEvent });
    const surveyCtx = () => ({ store, t, app, rec, key, who, sameUser, userKey, pool, logEvent, askAI, env, aiFetch });
    const photoKey = `photo:${app}:${key}`;

    if (b.action === "me") return json(200, { ok: true, profile: await profOut(rec) });

    // App opened (or brought back after a while) by a logged-in user.
    if (b.action === "ping") {
      rec.lastSeen = t;
      // The vChat list decides a state user's state: follow it if an admin re-imported a change.
      if (app === "state" && rec.vchatId) { const row = (await directory(store)).rows[vKey(rec.vchatId)]; if (row && row.state && row.state !== rec.state) rec.state = row.state; }
      await save();
      await logEvent(store, t, app, rec, "open", b);
      return json(200, { ok: true, profile: await profOut(rec) });
    }

    if (b.action === "ai-status") return json(200, { ok: true, ai: !!(env.GEMINI_API_KEY || env.GROQ_API_KEY), provider: env.GROQ_API_KEY ? "groq" : "gemini" });
    if (b.action === "ai-ask") {
      const q = String(b.question || "").trim();
      if (!q) return json(400, { ok: false, error: "Ask a question." });
      const ck = `ai:${istDate(t)}:${app}:${key}`;
      const used = ((await store.get(ck)) || { n: 0 }).n;
      if (used >= AI_DAILY_LIMIT) return json(429, { ok: false, error: "Daily AI limit reached. Built-in answers still work." });
      const r = await askAI(env, q, b.context, b.history, aiFetch);
      if (r.ok) await store.set(ck, { n: used + 1 });
      return json(r.ok ? 200 : 502, r);
    }

    // Existing state-app users pick their state once.
    if (b.action === "set-state-once") {
      if (app !== "state") return json(400, { ok: false, error: "Not needed." });
      if (rec.state) return json(400, { ok: false, error: "Your state is already set. Ask an admin to change it." });
      const st = String(b.state || "").trim().slice(0, 40);
      if (!st) return json(400, { ok: false, error: "Please select your state." });
      rec.state = st; await save();
      return json(200, { ok: true, profile: publicProfile(rec) });
    }

    // Everything the apps / web need for badges and notifications, in one call.
    if (b.action === "notify") {
      const ctx = surveyCtx();
      const sv = await surveyAction({ action: "survey-notify" }, ctx);
      const su = await (await supportAction({ action: "support-unread" }, { store, t, app, rec, key })).json();
      const chat = await chatAction({ action: "chat-notify" }, ctx);
      const matrix = await matrixAction({ action: "matrix-notify" }, ctx);
      let pwreq = 0;
      if (app === "admin" && store.list) {
        const ks = await store.list("pwreq:");
        pwreq = (await pool(ks, 40, (k) => store.get(k))).filter((q) => q && q.status === "pending" && !(q.app === app && q.key === key)).length;
      }
      const jr = async (p) => { try { return await (await p).json(); } catch (e) { return {}; } };
      const mods = await modulesFor(store, app, rec);
      const dp = mods.disputes ? await jr(disputeAction({ action: "disp-notify" }, ctx)) : {};
      const hy = mods.hygiene ? await jr(hygieneAction({ action: "hyg-notify" }, ctx)) : {};
      const en = await jr(engageAction({ action: "engage-notify" }, ctx));
      const ar = mods.autoreports ? await jr(autorepAction({ action: "autorep-notify" }, ctx)) : {};
      return json(200, { ok: true, surveys: sv, supportUnread: su.unread || 0, chat, matrix, pwreq, modules: mods,
        disputes: { unread: dp.unread || 0, assigned: dp.assignedOpen || 0, breached: dp.breached || 0 }, hygiene: hy.pending || 0, quizNew: mods.quiz ? en.quizNew || 0 : 0, pollNew: mods.polls ? en.pollNew || 0 : 0, autorep: ar.fresh || 0 });
    }
    if (b.action === "hub") return json(200, { ok: true, modules: await modulesFor(store, app, rec), app, role: roleOf(app, rec), master: !!rec.master, state: rec.state || "", name: rec.fullName });
    {
      const MODMAP = [[/^disp-/, "disputes"], [/^hyg-/, "hygiene"], [/^quiz-/, "quiz"], [/^poll-/, "polls"], [/^wall-/, "wall"], [/^(recog|people)-/, "leaderboard"], [/^autorep-/, "autoreports"]];
      const mm = MODMAP.find((x) => x[0].test(b.action));
      if (mm && !(await moduleOn(store, mm[1], app, rec)) && !/-notify$/.test(b.action)) return json(403, { ok: false, error: "This tool isn't switched on for your state yet.", moduleOff: true });
    }
    if (/^(mod|faq|help|esc|flow|scheme)-/.test(b.action)) return opsAction(b, surveyCtx());
    if (b.action.startsWith("disp-")) return disputeAction(b, surveyCtx());
    if (b.action.startsWith("hyg-")) return hygieneAction(b, surveyCtx());
    if (/^(quiz|poll|wall|recog|people|engage)-/.test(b.action)) return engageAction(b, surveyCtx());
    if (b.action.startsWith("autorep-")) return autorepAction(b, Object.assign(surveyCtx(), { jobFetch }));
    if (/^(cust|ct|cxx|master)-/.test(b.action)) return masterAction(b, surveyCtx());
    if (b.action.startsWith("tl-")) return toolsAction(b, surveyCtx());
    if (b.action.startsWith("sc-")) return schemeCalcAction(b, surveyCtx());
    if (b.action.startsWith("inv-")) return inviteAdminAction(b, Object.assign(surveyCtx(), { normalizePhone, normEmail, vKey, mailFetch }));
    if (b.action.startsWith("survey-")) return surveyAction(b, surveyCtx());
    if (b.action.startsWith("chat-")) return chatAction(b, surveyCtx());
    if (b.action.startsWith("matrix-")) return matrixAction(b, surveyCtx());
    if (b.action.startsWith("visit-")) return visitAction(b, surveyCtx());
    if (b.action.startsWith("kb-")) return kbAction(b, surveyCtx());
    if (b.action.startsWith("aff-")) return affAction(b, Object.assign(surveyCtx(), { jobFetch }));

    // A logged-in app approves (or declines) a web login shown as a QR code.
    if (b.action === "qr-approve") {
      const k = `qr:${String(b.qrId || "").replace(/[^a-f0-9]/g, "")}`;
      const q = await store.get(k);
      if (!q || q.status !== "pending" || t > q.exp) return json(404, { ok: false, error: "This QR code has expired. Refresh the web page and scan again." });
      if (b.confirm !== true && b.decline !== true) return json(200, { ok: true, device: q.device || "Web browser", expiresIn: q.exp - t });
      Object.assign(q, b.decline === true ? { status: "declined" } : { status: "approved", app, key, approvedAt: t });
      await store.set(k, q);
      return json(200, { ok: true, approved: b.decline !== true });
    }

    // ---------- Support desk (shared by state and admin users) ----------
    if (b.action.startsWith("support-")) {
      return supportAction(b, { store, t, app, rec, key });
    }

    // ---------- Account security (admins): Truecaller switch + password reset requests ----------
    if (b.action === "admin-security" || b.action === "admin-set-auth" || b.action === "admin-pwreq-decide" || b.action === "admin-email-test" || b.action === "admin-email-config" || b.action === "admin-admin-emails") {
      if (app !== "admin") return json(403, { ok: false, error: "Only BI admins can do this." });
      if (b.action === "admin-set-auth") {
        const c = Object.assign({}, await authCfg(), { updatedBy: rec.username, updatedAt: t });
        if ("tcRequired" in b) c.tcRequired = b.tcRequired !== false;
        if ("emailRequired" in b) c.emailRequired = b.emailRequired !== false;
        await store.set("config:auth", c);
        const ev = "emailRequired" in b ? (c.emailRequired ? "email-otp-on" : "email-otp-off") : (c.tcRequired ? "truecaller-on" : "truecaller-off");
        await logEvent(store, t, app, rec, ev, { device: "by " + rec.username, ver: "" });
        return json(200, { ok: true, tcRequired: c.tcRequired !== false, emailRequired: c.emailRequired !== false });
      }
      if (b.action === "admin-admin-emails") {
        const c = await authCfg();
        let list = (c.adminEmails || []).slice();
        const add = (Array.isArray(b.add) ? b.add : [b.add]).map(normEmail).filter(Boolean);
        const rem = (Array.isArray(b.remove) ? b.remove : [b.remove]).map(normEmail).filter(Boolean);
        if (b.add && !add.length) return json(400, { ok: false, error: "Enter a valid email address." });
        add.forEach((e) => { if (!list.includes(e)) list.push(e); });
        list = list.filter((e) => !rem.includes(e)).slice(0, 200);
        await store.set("config:auth", Object.assign({}, c, { adminEmails: list, updatedBy: rec.username, updatedAt: t }));
        await logEvent(store, t, app, rec, "admin-emails", { device: (add.length ? "+" + add.join(",") : "") + (rem.length ? " -" + rem.join(",") : ""), ver: "" });
        return json(200, { ok: true, adminEmails: list });
      }
      if (b.action === "admin-email-config") {
        if (b.clear === true) { await store.delete("config:email"); return json(200, { ok: true }); }
        const key = String(b.apiKey || "").trim(), from = normEmail(b.from);
        if (!/^xkeysib-[A-Za-z0-9-]{20,}$/.test(key)) return json(400, { ok: false, error: "That doesn't look like a Brevo API key (it starts with xkeysib-)." });
        if (!from) return json(400, { ok: false, error: "Enter the sender email you confirmed in Brevo." });
        await store.set("config:email", { apiKey: key, from, name: String(b.name || "vivo BI Dashboard").slice(0, 60), savedBy: rec.username, savedAt: t });
        await logEvent(store, t, app, rec, "email-key-saved", { device: "by " + rec.username, ver: "" });
        return json(200, { ok: true });
      }
      if (b.action === "admin-email-test") {
        const to = normEmail(b.email);
        if (!to) return json(400, { ok: false, error: "Enter a valid email address." });
        const r = await sendEmailOtp(env, to, "123456", "signup", mailFetch);
        return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { ok: false, error: r.error });
      }
      if (b.action === "admin-pwreq-decide") {
        const which = b.which === "admin" ? "admin" : "state", uk = userKey(b.target);
        const qk = `pwreq:${which}:${uk}`, q = uk ? await store.get(qk) : null;
        if (!q || q.status !== "pending") return json(404, { ok: false, error: "This request was already handled." });
        if (which === app && uk === key) return json(403, { ok: false, error: "Another admin must approve your own request." });
        const u = await store.get(`user:${which}:${uk}`);
        if (!u) return json(404, { ok: false, error: "Account not found." });
        if (b.approve === true) {
          Object.assign(u, { hash: q.hash, salt: q.salt, fails: 0, lockUntil: 0, resetAt: t, sessions: [] });
          await store.set(`user:${which}:${uk}`, u);
          await logEvent(store, t, which, u, "password-reset", { device: "approved by " + rec.username, ver: "" });
        }
        Object.assign(q, { status: b.approve === true ? "approved" : "rejected", decidedAt: t, decidedBy: rec.username, reason: clip(b.reason, 200) });
        delete q.hash; delete q.salt;
        await store.set(qk, q);
        return json(200, { ok: true, status: q.status });
      }
      const ks = await store.list("pwreq:");
      const reqs = (await pool(ks, 40, (k) => store.get(k))).filter((q) => q && (q.status === "pending" || t - (q.decidedAt || q.at) < 30 * 86400000))
        .map((q) => ({ app: q.app, username: q.username, fullName: q.fullName, phone: q.phone, state: q.state, designation: q.designation, note: q.note,
          device: q.device, via: q.via, at: q.at, status: q.status, decidedAt: q.decidedAt || 0, decidedBy: q.decidedBy || "", reason: q.reason || "",
          own: q.app === app && q.key === key }))
        .sort((x, y) => (x.status === "pending" ? 0 : 1) - (y.status === "pending" ? 0 : 1) || y.at - x.at);
      const c = await authCfg();
      return json(200, { ok: true, tcRequired: c.tcRequired !== false, emailReady, emailRequired: c.emailRequired !== false, emailFrom: env.OTP_FROM_EMAIL || "",
        adminEmails: c.adminEmails || [], emailKeyEnd: env.BREVO_API_KEY ? String(env.BREVO_API_KEY).slice(-4) : "", emailSavedHere: !!(await store.get("config:email")),
        updatedBy: c.updatedBy || "", updatedAt: c.updatedAt || 0, requests: reqs });
    }

    // ---------- Admin app only ----------
    // Admins can disable / re-enable state-app accounts (disabling logs the user out everywhere).
    if (b.action === "admin-set-disabled") {
      if (app !== "admin") return json(403, { ok: false, error: "Only the admin app can do this." });
      const uk = userKey(b.target);
      const u = uk ? await store.get(`user:state:${uk}`) : null;
      if (!u) return json(404, { ok: false, error: "User not found." });
      const off = b.disabled === true;
      u.disabled = off;
      if (off) { u.sessions = []; u.disabledAt = t; u.disabledBy = rec.username; u.disabledReason = String(b.reason || "").slice(0, 120); }
      else { u.enabledAt = t; u.enabledBy = rec.username; delete u.disabledReason; }
      await store.set(`user:state:${uk}`, u);
      await logEvent(store, t, "state", u, off ? "disabled" : "enabled", { device: "by " + rec.username, ver: "" });
      return json(200, { ok: true, disabled: off });
    }

    if (b.action === "admin-set-state") {
      if (app !== "admin") return json(403, { ok: false, error: "Only the admin app can do this." });
      const which = b.which === "admin" ? "admin" : "state";
      const uk = userKey(b.target);
      const u = uk ? await store.get(`user:${which}:${uk}`) : null;
      if (!u) return json(404, { ok: false, error: "User not found." });
      u.state = String(b.state || "").trim().slice(0, 40);
      u.updatedAt = t;
      await store.set(`user:${which}:${uk}`, u);
      return json(200, { ok: true });
    }

    if (b.action === "admin-logs-range" || b.action === "admin-support-data") {
      if (app !== "admin") return json(403, { ok: false, error: "Only the admin app can see this." });
      if (!store.list) return json(500, { ok: false, error: "Not available." });
      const users = {};
      for (const which of ["state", "admin"]) {
        const ks = await store.list(`user:${which}:`);
        const us = await pool(ks, 40, (k) => store.get(k));
        us.filter(Boolean).forEach((u) => {
          users[which + ":" + userKey(u.username)] = { app: which, username: u.username, fullName: u.fullName, phone: u.phone,
            state: u.state || "", designation: u.designation || "", createdAt: u.createdAt || 0, lastSeen: u.lastSeen || 0, disabled: !!u.disabled };
        });
      }
      if (b.action === "admin-support-data") {
        const ks = await store.list("ticket:");
        const tickets = (await pool(ks, 40, (k) => store.get(k))).filter(Boolean)
          .sort((x, y) => y.createdAt - x.createdAt);
        return json(200, { ok: true, tickets, users: Object.values(users) });
      }
      const today = istDate(t);
      const okd = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
      const to = okd(b.to) ? b.to : today, from = okd(b.from) ? b.from : to;
      const days = dayList(from <= to ? from : to, from <= to ? to : from, 92);
      const perDay = await pool(days, 6, (d) => readLogDay(store, d, today));
      const logs = [];
      perDay.forEach((ev) => ev.forEach((e) => {
        const u = users[e.app + ":" + userKey(e.username)] || {};
        logs.push({ ts: e.ts, app: e.app, event: e.event, username: e.username, fullName: e.fullName || u.fullName || "",
          phone: e.phone || u.phone || "", state: e.state || u.state || "", device: e.device || "", ver: e.ver || "" });
      }));
      logs.sort((x, y) => y.ts - x.ts);
      return json(200, { ok: true, from: days[0], to: days[days.length - 1], logs, users: Object.values(users) });
    }

    if (b.action === "admin-users" || b.action === "admin-logs") {
      if (app !== "admin") return json(403, { ok: false, error: "Only the admin app can see this." });
      if (!store.list) return json(500, { ok: false, error: "Not available." });
      if (b.action === "admin-users") {
        const which = b.which === "admin" ? "admin" : "state";
        const keys = await store.list(`user:${which}:`);
        const users = [];
        for (const k of keys) {
          const u = await store.get(k);
          if (!u) continue;
          users.push({ username: u.username, fullName: u.fullName, phone: u.phone, email: u.email || "",
            state: u.state || "", designation: u.designation || "", createdAt: u.createdAt || 0,
            lastSeen: u.lastSeen || 0, loggedInPhones: (u.sessions || []).length, disabled: !!u.disabled, vchatId: u.vchatId || "",
            disabledAt: u.disabledAt || 0, disabledBy: u.disabledBy || "", disabledReason: u.disabledReason || "" });
        }
        users.sort((a, c) => (c.lastSeen || c.createdAt) - (a.lastSeen || a.createdAt));
        return json(200, { ok: true, which, users });
      }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : istDate(t);
      const only = b.which === "admin" || b.which === "state" ? b.which : null;
      const all = (await readLogDay(store, date, istDate(t))).filter((e) => !only || e.app === only);
      all.sort((x, y) => y.ts - x.ts);
      return json(200, { ok: true, date, logs: all.slice(0, LOG_KEEP), total: all.length });
    }

    if (b.action === "update-profile") {
      const p = b.profile || {};
      const fullName = String(p.fullName ?? rec.fullName).trim();
      if (fullName.length < 2) return json(400, { ok: false, error: "Please enter your full name." });
      const email = String(p.email ?? rec.email ?? "").trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { ok: false, error: "Enter a valid email address." });
      // A state-app user's state decides which retailer IDs they see, so only an admin can change it.
      const newState = app === "state" ? (rec.state || "") : String(p.state ?? rec.state ?? "").trim();
      const vals = { fullName, email, state: newState, designation: String(p.designation ?? rec.designation ?? "").trim() };
      for (const [k, max] of Object.entries(PROFILE_LIMITS)) {
        if (vals[k].length > max) return json(400, { ok: false, error: `${k} is too long.` });
      }
      const oldE = normEmail(rec.email), newE = normEmail(vals.email);
      if (newE && newE !== oldE) {
        const taken = await store.get(eKeyOf(newE));
        if (taken && taken.key !== key) return json(409, { ok: false, error: "This email is used by another account." });
      }
      Object.assign(rec, vals, { updatedAt: t });
      if (newE !== oldE) rec.emailVerified = false;
      await save();
      if (oldE && oldE !== newE) await store.delete(eKeyOf(oldE));
      if (newE) await store.set(eKeyOf(newE), { key });
      return json(200, { ok: true, profile: publicProfile(rec) });
    }

    if (b.action === "change-password") {
      if (!checkPassword(b.currentPassword, rec)) return json(400, { ok: false, error: "Current password is incorrect." });
      const pwErr = passwordProblem(b.newPassword);
      if (pwErr) return json(400, { ok: false, error: pwErr });
      // Keep this phone logged in; log out the others.
      Object.assign(rec, hashPassword(b.newPassword), { sessions: [sess], passwordChangedAt: t });
      await save();
      return json(200, { ok: true });
    }

    if (b.action === "upload-photo") {
      const data = String(b.photo || "");
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data) || data.length < 100) return json(400, { ok: false, error: "Invalid photo." });
      if (data.length > MAX_PHOTO_BASE64) return json(400, { ok: false, error: "Photo is too large." });
      await store.set(photoKey, { data, at: t });
      rec.photoVersion = t;
      await save();
      return json(200, { ok: true, profile: publicProfile(rec) });
    }

    if (b.action === "get-photo") {
      const ph = await store.get(photoKey);
      return json(200, { ok: true, photo: ph ? ph.data : "", photoVersion: rec.photoVersion || 0 });
    }

    if (b.action === "remove-photo") {
      await store.delete(photoKey);
      rec.photoVersion = 0;
      await save();
      return json(200, { ok: true, profile: publicProfile(rec) });
    }

    if (b.action === "logout") {
      rec.sessions = (rec.sessions || []).filter((x) => x.h !== th);
      await save();
      await logEvent(store, t, app, rec, "logout", b);
      return json(200, { ok: true });
    }

    if (b.action === "delete-account") {
      if (!checkPassword(b.password, rec)) return json(400, { ok: false, error: "Password is incorrect." });
      await store.delete(photoKey);
      await store.delete(pKeyOf(rec.phone));
      if (normEmail(rec.email)) await store.delete(eKeyOf(normEmail(rec.email)));
      await store.delete(uKeyOf(key));
      return json(200, { ok: true });
    }
  }

  return json(400, { ok: false, error: "Unknown action" });
}
