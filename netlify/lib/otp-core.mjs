// OTP logic for the vivo BI apps. Kept separate from the Netlify wrapper so it can be tested.
// SMS is sent through "SMS Gateway for Android" (cloud mode) running on your own phone.
import { createHash, randomInt } from "node:crypto";

const OTP_TTL_MS = 5 * 60 * 1000;      // OTP valid for 5 minutes
const MAX_VERIFY_TRIES = 5;            // wrong OTP entries allowed per code
const SEND_WINDOW_MS = 15 * 60 * 1000; // rate-limit window
const MAX_SENDS_PER_WINDOW = 3;        // OTPs per number per 15 minutes
const MAX_SENDS_PER_DAY = 8;           // OTPs per number per day

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const hashOtp = (phone, otp) => createHash("sha256").update(phone + ":" + otp).digest("hex");

// Accepts 10-digit Indian mobile numbers, with or without +91 / 0 prefix.
export function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2)
    : d.length === 11 && d.startsWith("0") ? d.slice(1)
    : d;
  return /^[6-9]\d{9}$/.test(ten) ? "+91" + ten : null;
}

export async function sendViaGateway(env, phone, text, fetchImpl = fetch) {
  if (!env.SMSGATE_USER || !env.SMSGATE_PASS) {
    return { ok: false, error: "SMS gateway is not set up yet. Please contact the admin." };
  }
  const auth = Buffer.from(env.SMSGATE_USER + ":" + env.SMSGATE_PASS).toString("base64");
  const res = await fetchImpl("https://api.sms-gate.app/3rdparty/v1/messages", {
    method: "POST",
    headers: { authorization: "Basic " + auth, "content-type": "application/json" },
    body: JSON.stringify({ phoneNumbers: [phone], textMessage: { text }, ttl: 300 }),
  });
  if (res.status >= 200 && res.status < 300) return { ok: true };
  return { ok: false, error: "Could not send OTP right now (gateway " + res.status + "). Please try again." };
}

// store: { get(key) -> object|null, set(key, object), delete(key) }
export async function handle(req, { store, env, send = sendViaGateway, now = () => Date.now() }) {
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });
  if (req.headers.get("x-bi-app") !== "1") return json(403, { ok: false, error: "Not allowed" });

  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "Bad request" }); }

  const phone = normalizePhone(body.phone);
  if (!phone) return json(400, { ok: false, error: "Enter a valid 10-digit mobile number." });
  const t = now();

  if (body.action === "send") {
    const rl = (await store.get("rl:" + phone)) || { sends: [] };
    const day = rl.sends.filter((s) => t - s < 24 * 3600 * 1000);
    const recent = day.filter((s) => t - s < SEND_WINDOW_MS);
    if (recent.length >= MAX_SENDS_PER_WINDOW || day.length >= MAX_SENDS_PER_DAY) {
      return json(429, { ok: false, error: "Too many OTP requests. Please try again after some time." });
    }
    const otp = String(randomInt(0, 1000000)).padStart(6, "0");
    const sent = await send(env, phone, otp + " is your vivo BI app login OTP. Valid for 5 minutes. Do not share it with anyone.");
    if (!sent.ok) return json(502, { ok: false, error: sent.error });
    await store.set("otp:" + phone, { hash: hashOtp(phone, otp), exp: t + OTP_TTL_MS, tries: 0 });
    day.push(t);
    await store.set("rl:" + phone, { sends: day });
    return json(200, { ok: true, phone, expiresInSec: OTP_TTL_MS / 1000 });
  }

  if (body.action === "verify") {
    const otp = String(body.otp || "").replace(/\D/g, "");
    const rec = await store.get("otp:" + phone);
    if (!rec || t > rec.exp) {
      if (rec) await store.delete("otp:" + phone);
      return json(400, { ok: false, error: "OTP expired. Please request a new one." });
    }
    if (rec.hash === hashOtp(phone, otp)) {
      await store.delete("otp:" + phone);
      return json(200, { ok: true, phone });
    }
    rec.tries += 1;
    if (rec.tries >= MAX_VERIFY_TRIES) {
      await store.delete("otp:" + phone);
      return json(400, { ok: false, error: "Too many wrong attempts. Please request a new OTP." });
    }
    await store.set("otp:" + phone, rec);
    return json(400, { ok: false, error: "Incorrect OTP. " + (MAX_VERIFY_TRIES - rec.tries) + " attempts left." });
  }

  return json(400, { ok: false, error: "Unknown action" });
}
