// Netlify background function (runs up to 15 min): AI web research for the Competition analysis tool.
// Started only by the accounts service after it records a job (../lib/cmp-core.mjs).
import { getStore } from "@netlify/blobs";
import { runCmpJob } from "../lib/cmp-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k), list: async (p) => { const out = []; for await (const pg of blobs.list({ prefix: p, paginate: true })) pg.blobs.forEach((x) => out.push(x.key)); return out; } };
  let job = ""; try { job = (await req.json()).job; } catch (e) { return; }
  if (job !== "cmp") return;
  await runCmpJob(store, { GEMINI_API_KEY: Netlify.env.get("GEMINI_API_KEY"), GEMINI_RESEARCH_MODEL: Netlify.env.get("GEMINI_RESEARCH_MODEL"), GROQ_API_KEY: Netlify.env.get("GROQ_API_KEY"), TAVILY_API_KEY: Netlify.env.get("TAVILY_API_KEY") });
};
