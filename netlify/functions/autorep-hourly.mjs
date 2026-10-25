// Scheduled every hour: starts the auto-report run when it is due (daily or weekly, at the admin's chosen IST hour).
import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { isDue } from "../lib/autorep-core.mjs";
import { runReminders } from "../lib/insights-core.mjs";

export default async () => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  // BI calendar reminders (9 AM IST)
  try {
    const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k),
      list: async (prefix) => { const keys = []; for await (const page of blobs.list({ prefix, paginate: true })) for (const x of page.blobs) keys.push(x.key); return keys; } };
    await runReminders(store, { BREVO_API_KEY: Netlify.env.get("BREVO_API_KEY"), OTP_FROM_EMAIL: Netlify.env.get("OTP_FROM_EMAIL"), OTP_FROM_NAME: Netlify.env.get("OTP_FROM_NAME") });
  } catch (e) { }
  const cfg = await blobs.get("config:autorep", { type: "json" });
  const t = Date.now();
  if (!isDue(cfg, t)) return new Response("not due");
  cfg.lastRunAt = t; await blobs.setJSON("config:autorep", cfg);   // claim this hour
  const id = t.toString(36) + randomBytes(4).toString("hex");
  await blobs.setJSON(`autojob:${id}`, { at: t, by: "schedule" });
  const ac = new AbortController(); setTimeout(() => ac.abort(), 8000);
  try { await fetch(Netlify.env.get("URL") + "/.netlify/functions/autorep-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: id }), signal: ac.signal }); } catch (e) { }
  return new Response("started");
};

export const config = { schedule: "0 * * * *" };
