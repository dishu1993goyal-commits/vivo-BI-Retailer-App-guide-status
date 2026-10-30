// Personal mailer: HO imports an Excel matrix (first column = user ID) plus each user's own attachment(s), and sends every
// user their own row by email in one click. Emails go ONLY to the address registered on that user's account (looked up
// here, never taken from the page unless HO allows the Email-column fallback). Row data and files are not stored — only
// a delivery log (who, when, sent / failed) is kept.
// Storage:  pmlog:<id>   { id, at, by, subject, total, rows:[{id, name, to, files, status, error, at}] }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const low = (x) => String(x || "").trim().toLowerCase();
const mask = (e) => { const [u, d] = String(e || "").split("@"); return d ? u.slice(0, 2) + "•••@" + d : ""; };
const OKEXT = /\.(pdf|png|jpe?g|gif|xlsx|xls|csv|docx?|pptx?|txt|zip)$/i;

async function directory(store, pool) {   // every registered user, findable by username, vChat ID, email or phone
  const idx = {};
  for (const app of ["state", "admin"]) {
    const us = await pool(await store.list(`user:${app}:`), 40, (k) => store.get(k));
    us.forEach((u) => { if (!u || !u.username) return; const x = { app, name: u.fullName || u.username, username: u.username, state: u.state || "", email: u.email || "", disabled: !!u.disabled };
      [u.username, u.vchatId, u.email, u.phone, u.mobile].filter(Boolean).forEach((k) => { const kk = low(k); if (!idx[kk] || (idx[kk].disabled && !x.disabled)) idx[kk] = x; }); });
  }
  return idx;
}

export async function pmailAction(b, ctx) {
  const { store, t, app, rec, env = {}, pool } = ctx, mailFetch = ctx.mailFetch || fetch;
  if (app !== "admin") return json(403, { ok: false, error: "Only HO admins can send personal mails." });
  const me = { key: env.BREVO_API_KEY, from: env.OTP_FROM_EMAIL, name: env.OTP_FROM_NAME };

  if (b.action === "pm-match") {   // which IDs are registered and have an email
    const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 5000).map((x) => str(x, 80));
    const idx = await directory(store, pool);
    const out = ids.map((id) => { const u = idx[low(id)]; return u ? { id, found: true, name: u.name, app: u.app, state: u.state, email: mask(u.email), hasEmail: EMAIL.test(u.email), disabled: u.disabled } : { id, found: false }; });
    return json(200, { ok: true, users: out, emailReady: !!(me.key && me.from), myEmail: mask(rec.email) });
  }

  if (b.action === "pm-send") {   // a few users per call (the page loops) — each gets their own email + attachments
    if (!me.key || !me.from) return json(400, { ok: false, error: "Email isn't set up on the server (BREVO_API_KEY / OTP_FROM_EMAIL)." });
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 10);
    if (!items.length) return json(400, { ok: false, error: "Nothing to send." });
    const idx = await directory(store, pool), c = (await store.get("config:centre")) || {};
    const logId = str(b.log, 24).replace(/[^a-z0-9]/gi, "") || (t.toString(36) + randomBytes(3).toString("hex"));
    const log = (await store.get(`pmlog:${logId}`)) || { id: logId, at: t, by: rec.fullName || rec.username, subject: str(b.subjectTpl, 160), total: Number(b.total) || items.length, rows: [] };
    const results = [];
    for (const it of items) {
      const id = str(it.id, 80), u = idx[low(id)], r = { id, name: u ? u.name : "", files: 0, at: t };
      let to = "";
      if (b.test) to = rec.email || "";
      else if (u && !u.disabled && EMAIL.test(u.email)) to = u.email;
      else if (b.allowColumn && EMAIL.test(str(it.fallback, 120))) to = str(it.fallback, 120);
      if (!to) { r.status = "skipped"; r.error = !u ? "User ID not registered" : u.disabled ? "User is disabled" : "No registered email"; results.push(r); if (!b.test) log.rows.push(r); continue; }
      const att = [];
      let bad = "";
      (Array.isArray(it.files) ? it.files : []).slice(0, 10).forEach((f) => { const name = str(f && f.name, 100).replace(/[^\w .()-]/g, "_"), b64 = String((f && f.b64) || "").replace(/^data:[^,]*,/, ""); if (!name || !OKEXT.test(name)) { bad = "File type not allowed: " + name; return; } if (!/^[A-Za-z0-9+/=]+$/.test(b64)) { bad = "Unreadable file: " + name; return; } att.push({ name, content: b64 }); });
      const size = att.reduce((a, x) => a + x.content.length, 0);
      if (bad || size > 5800000) { r.status = "failed"; r.error = bad || "Attachments too large (max about 4 MB per user)"; results.push(r); if (!b.test) log.rows.push(r); continue; }
      const body = { sender: { name: c.senderName || me.name || "vivo BI", email: me.from }, to: [{ email: to, name: u ? u.name : undefined }], subject: (b.test ? "[TEST] " : "") + (str(it.subject, 200) || "Your details"), htmlContent: String(it.html || "").slice(0, 300000) || "<p>Please find your details attached.</p>" };
      if (c.replyTo) body.replyTo = { email: c.replyTo };
      if (att.length) body.attachment = att;
      try {
        const res = await mailFetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": me.key }, body: JSON.stringify(body) });
        if (res.ok) { r.status = "sent"; r.files = att.length; }
        else { let m = ""; try { m = (await res.json()).message || ""; } catch (e) { } r.status = "failed"; r.error = "Email service " + res.status + (m ? ": " + String(m).slice(0, 120) : ""); }
      } catch (e) { r.status = "failed"; r.error = String(e.message || e).slice(0, 120); }
      r.to = mask(to); results.push(r); if (!b.test) log.rows.push(r);
    }
    if (!b.test) {
      const seen = {}; log.rows = log.rows.reverse().filter((x) => (seen[low(x.id)] ? false : (seen[low(x.id)] = 1))).reverse();   // a retry replaces the earlier result
      log.updated = t; await store.set(`pmlog:${logId}`, log);
      const ks = (await store.list("pmlog:")).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - 100))) await store.delete(k);
    }
    const n = results.filter((x) => x.status === "sent").length;
    if (n && !b.test) await ctx.logEvent(store, t, app, rec, "personal-mail", { device: n + " sent", ver: "" });
    return json(200, { ok: true, log: logId, results });
  }

  if (b.action === "pm-logs") {
    const L = (await pool((await store.list("pmlog:")).sort().reverse().slice(0, 50), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at);
    return json(200, { ok: true, logs: L.map((l) => ({ id: l.id, at: l.at, by: l.by, subject: l.subject, total: l.total, sent: l.rows.filter((r) => r.status === "sent").length, failed: l.rows.filter((r) => r.status !== "sent").length })) });
  }
  if (b.action === "pm-log") { const l = await store.get(`pmlog:${str(b.id, 24).replace(/[^a-z0-9]/gi, "")}`); return l ? json(200, { ok: true, log: l }) : json(404, { ok: false, error: "Not found." }); }
  return json(400, { ok: false, error: "Unknown action." });
}
