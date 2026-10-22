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
    fullName: rec ? rec.fullName : "", phone: rec ? rec.phone : "",
    device: clip(b.device, 60), ver: clip(b.ver, 20),
  });
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

// store: { get(key) -> object|null, set(key, object), delete(key) }
export async function handle(req, { store, now = () => Date.now(), tcFetch = fetch }) {
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
    if (await store.get(uKeyOf(key))) return json(409, { ok: false, error: "This user name is taken. Please choose another." });
    if (await store.get(pKeyOf(phone))) {
      return json(409, { ok: false, error: "This mobile number already has an account. Use Login, or Forgot password." });
    }
    if (b.action === "signup-check") return json(200, { ok: true });

    if (b.phoneVerified !== true) return json(400, { ok: false, error: "Mobile number is not verified." });
    const username = String(b.username).trim().replace(/\s+/g, " ");
    const rec = {
      username, fullName: name, phone, ...hashPassword(b.password),
      createdAt: t, fails: 0, lockUntil: 0, sessions: [],
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
    "remove-photo", "logout", "delete-account", "admin-users", "admin-logs"];
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

    // ---------- Admin app only ----------
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
      const keys = await store.list(`log:${date}:` + (only ? only + ":" : ""));
      const logs = [];
      keys.sort((x, y) => Number(y.split(":")[3].split("-")[0]) - Number(x.split(":")[3].split("-")[0]));
      for (const k of keys.slice(0, LOG_KEEP)) { const e = await store.get(k); if (e) logs.push(e); }
      logs.sort((x, y) => y.ts - x.ts);
      return json(200, { ok: true, date, logs, total: keys.length });
    }

    if (b.action === "update-profile") {
      const p = b.profile || {};
      const fullName = String(p.fullName ?? rec.fullName).trim();
      if (fullName.length < 2) return json(400, { ok: false, error: "Please enter your full name." });
      const email = String(p.email ?? rec.email ?? "").trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { ok: false, error: "Enter a valid email address." });
      const vals = { fullName, email, state: String(p.state ?? rec.state ?? "").trim(), designation: String(p.designation ?? rec.designation ?? "").trim() };
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
