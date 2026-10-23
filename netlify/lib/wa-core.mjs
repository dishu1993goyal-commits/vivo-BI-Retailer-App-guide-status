// "Verify on WhatsApp": the user sends "VERIFY <code>" from their own WhatsApp to the company number.
// Meta delivers that incoming message to our webhook (free — we never send anything), and the sender's
// number proves the user owns that mobile.
// Storage: wav:<code> { code, sh, phone, purpose, app, exp, status: pending|verified|mismatch, from }
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const WA_TTL = 15 * 60 * 1000;
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no 0/O/1/I/L to avoid typing mix-ups
const PURPOSES = ["signup", "link", "reset"];
export const waReady = (env) => !!(env && env.WA_NUMBER && env.WA_VERIFY_TOKEN && env.WA_APP_SECRET);
export const digits10 = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };

function newCode() { const b = randomBytes(6); let s = ""; for (let i = 0; i < 6; i++) s += ALPHA[b[i] % ALPHA.length]; return s; }

// Starts a verification for a mobile number. phone: 10 digits (already checked by the caller).
export async function waStart(store, env, t, { app, purpose, phone, device }) {
  if (!waReady(env)) return { error: "WhatsApp verification is not set up yet." };
  if (!PURPOSES.includes(purpose)) return { error: "Unknown purpose." };
  const p = digits10(phone);
  if (!/^[6-9]\d{9}$/.test(p)) return { error: "Enter a valid 10-digit mobile number." };
  // Light rate limit per number: 8 starts per hour.
  const rk = `warl:${p}`, rl = ((await store.get(rk)) || { s: [] }).s.filter((x) => t - x < 3600000);
  if (rl.length >= 8) return { error: "Too many attempts for this number. Please try again in an hour." };
  rl.push(t); await store.set(rk, { s: rl });
  let code = newCode();
  for (let i = 0; i < 3 && (await store.get(`wav:${code}`)); i++) code = newCode();
  const secret = randomBytes(16).toString("hex");
  await store.set(`wav:${code}`, { code, sh: sha256(secret), phone: p, purpose, app, exp: t + WA_TTL, status: "pending", at: t, device: String(device || "").slice(0, 60) });
  const num = String(env.WA_NUMBER).replace(/\D/g, "");
  const text = `VERIFY ${code}`;
  return { code, secret, text, waNumber: num, waLink: `https://wa.me/${num}?text=${encodeURIComponent(text)}`, expiresIn: WA_TTL };
}

export async function waStatus(store, t, { code, secret }) {
  const k = `wav:${String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  const v = await store.get(k);
  if (!v || v.sh !== sha256(secret)) return { status: "missing" };
  if (v.status === "pending" && t > v.exp) return { status: "expired" };
  return { status: v.status, from: v.status === "mismatch" ? "******" + String(v.from || "").slice(-4) : undefined };
}

// Used by sign-up / link / reset: true only for a verified, unexpired code for exactly this number + purpose. One-time.
export async function waConsume(store, t, { code, secret, phone, purpose, app }) {
  const k = `wav:${String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  const v = await store.get(k);
  if (!v || v.sh !== sha256(secret)) return "Please verify your mobile on WhatsApp first.";
  if (v.status !== "verified") return v.status === "mismatch" ? "The WhatsApp message came from a different number. Send it from the WhatsApp on your own mobile." : "Please verify your mobile on WhatsApp first.";
  if (t > v.verifiedAt + WA_TTL) return "Verification expired. Please verify again.";
  if (v.purpose !== purpose || v.app !== app || v.phone !== digits10(phone)) return "This WhatsApp verification was for a different number. Please verify again.";
  await store.delete(k);
  return null;
}

// ---------- Webhook (Meta → us) ----------
export function checkSignature(env, raw, header) {
  if (!env.WA_APP_SECRET) return false;
  const want = "sha256=" + createHmac("sha256", env.WA_APP_SECRET).update(raw).digest("hex");
  const got = String(header || "");
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function handleWebhook(req, { store, env, now = () => Date.now() }) {
  const url = new URL(req.url);
  if (req.method === "GET") {   // Meta's one-time "Verify and save" check
    const ok = url.searchParams.get("hub.mode") === "subscribe" && env.WA_VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === env.WA_VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("", { status: 405 });
  const raw = await req.text();
  if (!checkSignature(env, raw, req.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  let body; try { body = JSON.parse(raw); } catch { return new Response("", { status: 200 }); }
  const t = now();
  for (const e of body.entry || []) for (const ch of e.changes || []) {
    const val = ch.value || {};
    for (const m of val.messages || []) {
      const text = m.type === "text" ? (m.text && m.text.body) || "" : m.type === "button" ? (m.button && m.button.text) || "" : "";
      const hit = /VERIFY\s*[:#-]?\s*([A-Z0-9]{6})/i.exec(text);
      if (!hit) continue;
      const k = `wav:${hit[1].toUpperCase()}`;
      const v = await store.get(k);
      if (!v || v.status === "verified" || t > v.exp) continue;
      const from = digits10(m.from);
      if (from && from === v.phone) Object.assign(v, { status: "verified", verifiedAt: t, from });
      else Object.assign(v, { status: "mismatch", from });
      await store.set(k, v);
      await store.set(`walog:${t}-${randomBytes(2).toString("hex")}`, { t, code: v.code, purpose: v.purpose, app: v.app, ok: v.status === "verified", phone: v.phone.slice(-4), from: from.slice(-4) });
    }
  }
  return new Response("OK", { status: 200 });
}

// ---------- Admin: one-time connect of the company number (register + subscribe), needs WA_TOKEN ----------
export async function waConnect(env, pin, fetchImpl = fetch) {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) return { ok: false, error: "Add WA_TOKEN and WA_PHONE_ID in Netlify first." };
  const H = { "content-type": "application/json", authorization: "Bearer " + env.WA_TOKEN };
  const out = {};
  const r1 = await fetchImpl(`https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/register`, { method: "POST", headers: H, body: JSON.stringify({ messaging_product: "whatsapp", pin: String(pin || "").replace(/\D/g, "").slice(0, 6) }) });
  const j1 = await r1.json().catch(() => ({}));
  out.register = r1.ok ? "ok" : (j1.error && j1.error.message) || "HTTP " + r1.status;
  if (env.WA_WABA_ID) {
    const r2 = await fetchImpl(`https://graph.facebook.com/v21.0/${env.WA_WABA_ID}/subscribed_apps`, { method: "POST", headers: H });
    const j2 = await r2.json().catch(() => ({}));
    out.subscribe = r2.ok ? "ok" : (j2.error && j2.error.message) || "HTTP " + r2.status;
  }
  return { ok: out.register === "ok" && (!env.WA_WABA_ID || out.subscribe === "ok"), ...out };
}
