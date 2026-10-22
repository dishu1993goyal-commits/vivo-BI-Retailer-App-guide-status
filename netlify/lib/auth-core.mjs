// Account logic for the vivo BI apps (Admin and State). Kept separate from the Netlify
// wrapper so it can be tested. Passwords are stored only as salted scrypt hashes.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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

const MAX_SESSIONS = 5;               // phones a user can stay logged in on at once
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

// ---------- Free AI (Google Gemini free tier) ----------
const AI_DAILY_LIMIT = 40;   // questions per user per day
const AI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-3.6-flash"];
const AI_SYSTEM = `You are "BI Assistant", the helper inside vivo India's Business Innovation (BI) KPI Dashboard apps, used by vivo state BI teams and HO admins.
- For dashboard facts (scores, ranks, KPI %, weights) use ONLY the DASHBOARD DATA given. Quote numbers exactly; say which period they are for. If the data doesn't contain it, say so.
- KPI score = sum over KPIs of min(achievement,100%) x weight. Retailer App usage is the largest KPI.
- Scheme payout: Achievement% = Achieved/Target x 100; slab = highest slab whose From% <= achievement; below first slab payout 0. Retro: units x Rs/unit (or value x %) + bonus. Incremental: each band between thresholds (From% x Target/100) paid at its own rate, + bonus. Next slab units = ceil(NextFrom% x Target/100) - Achieved.
- For general smartphone-industry questions (brands, pricing, market share, retail trends) answer from general knowledge, briefly, balanced and factual; say figures are approximate and may be outdated; never invent vivo internal numbers; avoid disparaging competitors.
- Be practical: give clear reasons and 3-5 actionable steps for state teams when relevant.
- Keep answers short for a phone screen (under ~180 words), plain text with short bullet lines using "- ". Use Indian number formatting and Rs. Reply in Hindi if the user writes in Hindi.`;

export async function askAI(env, question, context, history, fetchImpl = fetch) {
  if (!env || !env.GEMINI_API_KEY) return { ok: false, error: "AI is not set up yet.", notConfigured: true };
  const contents = [];
  (Array.isArray(history) ? history : []).slice(-6).forEach((h) => {
    if (h && h.q) contents.push({ role: "user", parts: [{ text: String(h.q).slice(0, 600) }] });
    if (h && h.a) contents.push({ role: "model", parts: [{ text: String(h.a).slice(0, 1200) }] });
  });
  contents.push({ role: "user", parts: [{ text: "DASHBOARD DATA:\n" + String(context || "").slice(0, 14000) + "\n\nQUESTION: " + String(question).slice(0, 800) }] });
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: AI_SYSTEM }] }, contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 700 } });
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...AI_MODELS] : AI_MODELS;
  let last = "";
  for (const m of models) {
    const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const text = (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("").trim();
      if (text) return { ok: true, text, model: m };
      last = "empty answer"; continue;
    }
    last = r.status + (j.error && j.error.message ? ": " + j.error.message.slice(0, 120) : "");
    if (r.status === 400 || r.status === 401 || r.status === 403) break;   // bad key: other models won't help
  }
  return { ok: false, error: "AI is busy right now (" + last + "). Showing built-in answers." };
}

function publicProfile(rec) {
  return {
    username: rec.username, fullName: rec.fullName, phone: rec.phone,
    email: rec.email || "", state: rec.state || "", designation: rec.designation || "",
    createdAt: rec.createdAt || 0, photoVersion: rec.photoVersion || 0,
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
  const isUnread = (tk, reads) => {
    const last = tk.messages[tk.messages.length - 1];
    return last && !sameUser(last.by, me) && (reads[tk.id] || 0) < tk.updatedAt;
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
    return json(200, { ok: true, name: a.name, mime: a.mime, data: a.data });
  }

  if (b.action === "support-unread") {
    const reads = (await store.get(readKey)) || {};
    const n = (await listTickets()).filter((tk) => isUnread(tk, reads)).length;
    return json(200, { ok: true, unread: n });
  }

  if (b.action === "support-list") {
    const reads = (await store.get(readKey)) || {};
    const tickets = (await listTickets()).map((tk) => {
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
    const tk = { id, no: counter, topic, kpi: String(b.kpi || "").slice(0, 60), state: String(b.state || me.state || "").slice(0, 40),
      subject, status: "open", by: me, createdAt: t, updatedAt: t,
      messages: [{ id: "m" + t.toString(36), ts: t, by: me, text, atts: await cleanAtts(b.atts), rating: null }] };
    await store.set(tKey(id), tk);
    return json(200, { ok: true, ticket: tk });
  }

  const tk = b.id ? await store.get(tKey(b.id)) : null;
  if (!tk) return json(404, { ok: false, error: "Query not found." });

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
    m.rating = { stars, ts: t };
    await store.set(tKey(tk.id), tk);
    return json(200, { ok: true, ticket: tk });
  }

  if (b.action === "support-status") {
    if (!(app === "admin" || sameUser(tk.by, me))) return json(403, { ok: false, error: "Not allowed." });
    tk.status = b.status === "closed" ? "closed" : "open";
    tk.updatedAt = t;
    await store.set(tKey(tk.id), tk);
    return json(200, { ok: true, ticket: tk });
  }

  return json(400, { ok: false, error: "Unknown action" });
}

// store: { get(key) -> object|null, set(key, object), delete(key) }
export async function handle(req, { store, now = () => Date.now(), tcFetch = fetch, env = {}, aiFetch = fetch }) {
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });
  if (req.headers.get("x-bi-app") !== "1") return json(403, { ok: false, error: "Not allowed" });

  let b;
  try { b = await req.json(); } catch { return json(400, { ok: false, error: "Bad request" }); }
  const app = b.app === "admin" ? "admin" : b.app === "state" ? "state" : null;
  if (!app) return json(400, { ok: false, error: "Unknown app" });
  const t = now();
  const uKeyOf = (k) => `user:${app}:${k}`;
  const pKeyOf = (p) => `phone:${app}:${p}`;

  // Checks done before the user spends time on mobile verification.
  if (b.action === "signup-check" || b.action === "signup") {
    if (sha256(String(b.accessCode || "")) !== ACCESS_CODE_SHA256[app]) {
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
    if (await store.get(uKeyOf(key))) return json(409, { ok: false, error: "This user name is taken. Please choose another." });
    if (await store.get(pKeyOf(phone))) {
      return json(409, { ok: false, error: "This mobile number already has an account. Use Login, or Forgot password." });
    }
    if (b.action === "signup-check") return json(200, { ok: true });

    if (b.phoneVerified !== true) return json(400, { ok: false, error: "Mobile number is not verified." });
    const username = String(b.username).trim().replace(/\s+/g, " ");
    const rec = {
      username, fullName: name, phone, ...hashPassword(b.password),
      createdAt: t, fails: 0, lockUntil: 0, sessions: [], state: userState,
    };
    const token = newSession(rec, t);
    rec.lastSeen = t;
    await store.set(uKeyOf(key), rec);
    await store.set(pKeyOf(phone), { key });
    await logEvent(store, t, app, rec, "signup", b);
    return json(200, { ok: true, username, fullName: name, token, profile: publicProfile(rec) });
  }

  if (b.action === "login") {
    const key = userKey(b.username);
    const rec = key ? await store.get(uKeyOf(key)) : null;
    if (!rec) return json(401, { ok: false, error: "User name or password is incorrect." });
    if (rec.lockUntil && t < rec.lockUntil) {
      const mins = Math.ceil((rec.lockUntil - t) / 60000);
      return json(429, { ok: false, error: `Too many wrong attempts. Try again in ${mins} min, or use Forgot password.` });
    }
    if (!checkPassword(b.password, rec)) {
      rec.fails = (rec.fails || 0) + 1;
      if (rec.fails >= MAX_LOGIN_FAILS) { rec.fails = 0; rec.lockUntil = t + LOCK_MS; }
      await store.set(uKeyOf(key), rec);
      return json(401, { ok: false, error: "User name or password is incorrect." });
    }
    rec.fails = 0; rec.lockUntil = 0; rec.lastSeen = t;
    const token = newSession(rec, t);
    await store.set(uKeyOf(key), rec);
    await logEvent(store, t, app, rec, "login", b);
    return json(200, { ok: true, username: rec.username, fullName: rec.fullName, token, profile: publicProfile(rec) });
  }

  // Forgot password: check the number has an account, then (after Truecaller
  // re-verification in the app) set a new password.
  if (b.action === "reset-check" || b.action === "reset") {
    const phone = normalizePhone(b.phone);
    if (!phone) return json(400, { ok: false, error: "Enter a valid 10-digit mobile number." });
    const idx = await store.get(pKeyOf(phone));
    const rec = idx ? await store.get(uKeyOf(idx.key)) : null;
    if (!rec) return json(404, { ok: false, error: "No account found for this mobile number. Please Sign up." });
    if (b.action === "reset-check") return json(200, { ok: true, phone: maskPhone(phone) });

    if (b.phoneVerified !== true) return json(400, { ok: false, error: "Mobile number is not verified." });
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

  // ---------- Actions for a logged-in user (user name + session token) ----------
  const SESSION_ACTIONS = ["me", "ping", "update-profile", "change-password", "upload-photo", "get-photo",
    "remove-photo", "logout", "delete-account", "admin-users", "admin-logs", "admin-set-state", "set-state-once",
    "support-list", "support-get", "support-create", "support-reply", "support-rate", "support-status",
    "support-upload", "support-att", "support-unread", "ai-ask", "ai-status", "admin-logs-range", "admin-support-data"];
  if (SESSION_ACTIONS.includes(b.action)) {
    const key = userKey(b.username);
    const rec = key ? await store.get(uKeyOf(key)) : null;
    const th = sha256(String(b.token || ""));
    const sess = rec && (rec.sessions || []).find((x) => x.h === th);
    if (!sess) return json(401, { ok: false, error: "You have been logged out. Please log in again.", loggedOut: true });
    const save = () => store.set(uKeyOf(key), rec);
    const photoKey = `photo:${app}:${key}`;

    if (b.action === "me") return json(200, { ok: true, profile: publicProfile(rec) });

    // App opened (or brought back after a while) by a logged-in user.
    if (b.action === "ping") {
      rec.lastSeen = t;
      await save();
      await logEvent(store, t, app, rec, "open", b);
      return json(200, { ok: true, profile: publicProfile(rec) });
    }

    if (b.action === "ai-status") return json(200, { ok: true, ai: !!env.GEMINI_API_KEY });
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

    // ---------- Support desk (shared by state and admin users) ----------
    if (b.action.startsWith("support-")) {
      return supportAction(b, { store, t, app, rec, key });
    }

    // ---------- Admin app only ----------
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
            state: u.state || "", designation: u.designation || "", createdAt: u.createdAt || 0, lastSeen: u.lastSeen || 0 };
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
            lastSeen: u.lastSeen || 0, loggedInPhones: (u.sessions || []).length });
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
      Object.assign(rec, vals, { updatedAt: t });
      await save();
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
      await store.delete(uKeyOf(key));
      return json(200, { ok: true });
    }
  }

  return json(400, { ok: false, error: "Unknown action" });
}
