// Background function: builds and sends one auto-report run (reads the dashboard data from the published site).
import { getStore } from "@netlify/blobs";
import { runAutoJob } from "../lib/autorep-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k),
    list: async (prefix) => { const keys = []; for await (const page of blobs.list({ prefix, paginate: true })) for (const x of page.blobs) keys.push(x.key); return keys; } };
  let job = ""; try { job = (await req.json()).job; } catch (e) { return; }
  await runAutoJob(store, { SITE_URL: Netlify.env.get("URL"), BREVO_API_KEY: Netlify.env.get("BREVO_API_KEY"), OTP_FROM_EMAIL: Netlify.env.get("OTP_FROM_EMAIL"), OTP_FROM_NAME: Netlify.env.get("OTP_FROM_NAME") }, job, {});
};
