// Netlify background function (runs up to 15 min): AI research for the Affordability Corner.
// Called only by the accounts service with a one-time job ticket (see ../lib/aff-core.mjs).
import { getStore } from "@netlify/blobs";
import { runJob } from "../lib/aff-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k) };
  let job = "";
  try { job = (await req.json()).job; } catch (e) { return; }
  await runJob(store, { GEMINI_API_KEY: Netlify.env.get("GEMINI_API_KEY"), GEMINI_RESEARCH_MODEL: Netlify.env.get("GEMINI_RESEARCH_MODEL") }, job);
};
