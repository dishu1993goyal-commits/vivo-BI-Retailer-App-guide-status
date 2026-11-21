// Netlify background function (runs up to 15 min): Circular studio — build a lesson's Google Form quiz.
// Started only by the accounts service with a one-time job id; the page polls cs-job for the result (../lib/lx-core.mjs).
import { getStore } from "@netlify/blobs";
import { runCsJob } from "../lib/lx-core.mjs";
import { askAI } from "../lib/auth-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k), list: async (p) => (await blobs.list({ prefix: p })).blobs.map((x) => x.key) };
  let job = ""; try { job = (await req.json()).job; } catch (e) { return; }
  const env = { GEMINI_API_KEY: Netlify.env.get("GEMINI_API_KEY"), GEMINI_MODEL: Netlify.env.get("GEMINI_MODEL"), GROQ_API_KEY: Netlify.env.get("GROQ_API_KEY"), SITE_URL: Netlify.env.get("URL") };
  await runCsJob(store, job, fetch, env, askAI);
};
