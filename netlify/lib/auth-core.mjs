// Account logic for the vivo BI apps (Admin and State). Kept separate from the Netlify
// wrapper so it can be tested. Passwords are stored only as salted scrypt hashes.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// SHA-256 of the sign-up access codes (vivoBI@2026 for admin, vivoState@2026 for state).
const ACCESS_CODE_SHA256 = {
  admin: "e90006efb1935ad651efa74b10b58270650d34be833a320228eef0437dad2403",
  state: "3577b5f173d6ace1cbff153510cb8b3eef4003706b6ba05152056b0e5268f376",
};
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

// store: { get(key) -> object|null, set(key, object), delete(key) }
export async function handle(req, { store, now = () => Date.now() }) {
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
    await store.set(uKeyOf(key), {
      username, fullName: name, phone, ...hashPassword(b.password),
      createdAt: t, fails: 0, lockUntil: 0,
    });
    await store.set(pKeyOf(phone), { key });
    return json(200, { ok: true, username, fullName: name });
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
    if (rec.fails || rec.lockUntil) { rec.fails = 0; rec.lockUntil = 0; await store.set(uKeyOf(key), rec); }
    return json(200, { ok: true, username: rec.username, fullName: rec.fullName });
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
    Object.assign(rec, hashPassword(b.newPassword), { fails: 0, lockUntil: 0, resetAt: t });
    await store.set(uKeyOf(idx.key), rec);
    return json(200, { ok: true, username: rec.username });
  }

  return json(400, { ok: false, error: "Unknown action" });
}
