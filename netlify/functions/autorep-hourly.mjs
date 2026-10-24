// Scheduled every hour: starts the auto-report run when it is due (daily or weekly, at the admin's chosen IST hour).
import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { isDue } from "../lib/autorep-core.mjs";

export default async () => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
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
