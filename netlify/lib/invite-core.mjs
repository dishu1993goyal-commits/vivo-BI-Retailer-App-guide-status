// Import users (#15): an admin imports a template (role, name, vChat ID, state, mobile, email). Each person gets an email with
// a "Finish registration" link (verify with an email code + set a password) and the app download links.
// The account is created when they finish. State rows are also added to the vChat directory; admin emails are added
// to the allowed admin list.
// Storage: invite:<token> { token, role, name, vchatId, state, mobile, email, status:"sent"|"opened"|"done"|"cancelled", createdAt, exp, sentAt, sends, by, doneAt, username, mailError }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
export const INVITE_DAYS = 14;
const APK = { state: "https://github.com/dishu1993goyal-commits/vivo-BI-Retailer-App-guide-status/releases/latest/download/vivo-BI-States.apk",
  admin: "https://github.com/dishu1993goyal-commits/vivo-BI-Retailer-App-guide-status/releases/latest/download/vivo-BI-Dashboard.apk" };

export async function sendInviteMail(env, inv, site, mailFetch = fetch) {
  if (!env.BREVO_API_KEY || !env.OTP_FROM_EMAIL) return { ok: false, error: "Email sending isn't set up (Account security → Email code)." };
  const link = site + "/invite.html#" + inv.token;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e3e5f0;border-radius:14px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#1F2340,#4D5BF9);color:#fff;padding:18px"><div style="font-size:11px;letter-spacing:.15em;opacity:.85">VIVO BUSINESS INNOVATION</div><div style="font-size:21px;font-weight:800;margin-top:6px">You're invited to the BI KPI Dashboard</div></div>
  <div style="padding:18px;color:#1F2340;font-size:14px;line-height:1.5"><p style="margin:0 0 10px">Hi ${inv.name},</p>
  <p style="margin:0 0 12px">An account has been set up for you as <b>${inv.role === "admin" ? "HO admin" : "State BI — " + inv.state}</b>${inv.vchatId ? " (vChat ID <b>" + inv.vchatId + "</b>)" : ""}. Finish your registration in 1 minute: confirm this email with a code and choose your password.</p>
  <p style="text-align:center;margin:18px 0"><a href="${link}" style="background:#4D5BF9;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">Finish registration</a></p>
  <p style="margin:0 0 6px;font-weight:700">Then use it on:</p>
  <p style="margin:0 0 4px">🌐 Web: <a href="${site}/" style="color:#4D5BF9">${site.replace(/^https?:\/\//, "")}</a></p>
  <p style="margin:0 0 12px">📱 Android app: <a href="${APK[inv.role] || APK.state}" style="color:#4D5BF9">Download ${inv.role === "admin" ? "vivo BI Dashboard" : "vivo BI States"} (APK)</a></p>
  <p style="color:#6B7090;font-size:12px;margin:0">This link works for ${INVITE_DAYS} days and only for ${inv.email}. If you weren't expecting it, ignore this email.</p></div></div>`;
  const r = await mailFetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": env.BREVO_API_KEY },
    body: JSON.stringify({ sender: { name: env.OTP_FROM_NAME || "vivo BI Dashboard", email: env.OTP_FROM_EMAIL }, to: [{ email: inv.email, name: inv.name }], subject: "Finish your vivo BI Dashboard registration", htmlContent: html }) });
  if (r.ok) return { ok: true };
  const j = await r.json().catch(() => ({}));
  return { ok: false, error: "Brevo " + r.status + (j.message ? ": " + String(j.message).slice(0, 80) : "") };
}

// Admin side (session actions): inv-import, inv-list, inv-resend, inv-cancel
export async function inviteAdminAction(b, ctx) {
  const { store, t, app, rec, pool, env, normalizePhone, normEmail, vKey } = ctx;
  if (app !== "admin") return json(403, { ok: false, error: "Only BI admins can import users." });
  const site = env.SITE_URL || "";
  const all = async () => (await pool(await store.list("invite:"), 40, (k) => store.get(k))).filter(Boolean);

  if (b.action === "inv-import") {
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 1000);
    const invites = await all();
    const out = { created: 0, emailed: 0, skipped: [], errors: [] };
    const dir = (await store.get("vchatdir")) || { rows: {} };
    const auth = Object.assign({}, (await store.get("config:auth")) || {});
    auth.adminEmails = auth.adminEmails || [];
    let dirChanged = false, authChanged = false;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], line = i + 2;
      const role = /admin|ho/i.test(String(r.role || "")) ? "admin" : "state";
      const name = str(r.name, 60), email = normEmail(r.email), mob = normalizePhone(r.mobile), state = str(r.state, 40), vchatId = str(r.vchatId, 40);
      if (!name || !email) { out.skipped.push(line + ": name and email are required"); continue; }
      if (role === "state" && (!state || !vchatId || !mob)) { out.skipped.push(line + ": state users need vChat ID, state and mobile"); continue; }
      if (await store.get(`email:${role}:${email}`)) { out.skipped.push(line + ": " + email + " already has an account"); continue; }
      if (invites.some((x) => x.email === email && x.role === role && ["sent", "opened"].includes(x.status) && x.exp > t)) { out.skipped.push(line + ": " + email + " already invited (use Resend)"); continue; }
      if (role === "state") {
        const k = vKey(vchatId);
        if (await store.get(`vchat:${k}`)) { out.skipped.push(line + ": vChat ID " + vchatId + " is already registered"); continue; }
        dir.rows[k] = { vchatId, state, name, mobile: mob.slice(3) }; dirChanged = true;
      } else if (!auth.adminEmails.includes(email)) { auth.adminEmails.push(email); authChanged = true; }
      const token = randomBytes(12).toString("hex");
      const inv = { token, role, name, vchatId: role === "state" ? vchatId : "", state: role === "state" ? state : "", mobile: mob ? mob.slice(3) : "", email, status: "sent", createdAt: t, exp: t + INVITE_DAYS * 86400000, by: rec.fullName, sends: 0 };
      if (b.send !== false) {
        const m = await sendInviteMail(env, inv, site, ctx.mailFetch);
        if (m.ok) { inv.sentAt = t; inv.sends = 1; out.emailed++; } else { inv.mailError = m.error; out.errors.push(email + ": " + m.error); }
      }
      await store.set(`invite:${token}`, inv); out.created++;
    }
    if (dirChanged) { dir.importedAt = dir.importedAt || t; dir.importedBy = dir.importedBy || rec.username; await store.set("vchatdir", dir); }
    if (authChanged) await store.set("config:auth", auth);
    await ctx.logEvent(store, t, app, rec, "users-imported", { device: out.created + " invites", ver: "" });
    return json(200, Object.assign({ ok: true }, out, { errors: out.errors.slice(0, 20), skipped: out.skipped.slice(0, 60) }));
  }
  if (b.action === "inv-list") {
    const rows = (await all()).map((x) => Object.assign({}, x, { token: undefined, id: x.token, expired: x.exp < t && x.status !== "done" })).sort((a, b) => b.createdAt - a.createdAt);
    return json(200, { ok: true, invites: rows, emailReady: !!(env.BREVO_API_KEY && env.OTP_FROM_EMAIL) });
  }
  if (b.action === "inv-resend" || b.action === "inv-cancel") {
    const k = `invite:${String(b.id || "").replace(/[^a-f0-9]/g, "")}`, inv = await store.get(k);
    if (!inv) return json(404, { ok: false, error: "Invite not found." });
    if (inv.status === "done") return json(400, { ok: false, error: "This person has already registered." });
    if (b.action === "inv-cancel") { inv.status = "cancelled"; await store.set(k, inv); return json(200, { ok: true }); }
    inv.exp = t + INVITE_DAYS * 86400000; inv.status = "sent";
    const m = await sendInviteMail(env, inv, site, ctx.mailFetch);
    if (!m.ok) { inv.mailError = m.error; await store.set(k, inv); return json(502, { ok: false, error: m.error }); }
    inv.sentAt = t; inv.sends = (inv.sends || 0) + 1; inv.mailError = ""; await store.set(k, inv);
    return json(200, { ok: true });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
