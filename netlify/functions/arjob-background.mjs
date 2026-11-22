// Netlify background function (runs up to 15 min): 🔀 AI Router long jobs (deck storylines, critiques…).
// Started only by the accounts service with a one-time job id; the page polls ar-job-get for the result (../lib/router-core.mjs).
import { getStore } from "@netlify/blobs";
import { runArJob } from "../lib/router-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k), list: async (p) => (await blobs.list({ prefix: p })).blobs.map((x) => x.key) };
  let job = ""; try { job = (await req.json()).job; } catch (e) { return; }
  if (!/^[a-f0-9]{16}$/.test(String(job || ""))) return;
  await runArJob(store, job, fetch, { GEMINI_API_KEY: Netlify.env.get("GEMINI_API_KEY"), GROQ_API_KEY: Netlify.env.get("GROQ_API_KEY") });
};
