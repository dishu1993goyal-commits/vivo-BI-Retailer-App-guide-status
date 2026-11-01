// Netlify background function (runs up to 15 min): AI web search for stores the free map doesn't list, then
// places each address on the map. Called only by the accounts service with a one-time job ticket (../lib/stores-core.mjs).
import { getStore } from "@netlify/blobs";
import { runStoreJob } from "../lib/stores-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k) };
  let job = ""; try { job = (await req.json()).job; } catch (e) { return; }
  await runStoreJob(store, { GEMINI_API_KEY: Netlify.env.get("GEMINI_API_KEY"), GEMINI_RESEARCH_MODEL: Netlify.env.get("GEMINI_RESEARCH_MODEL"), GROQ_API_KEY: Netlify.env.get("GROQ_API_KEY"), TAVILY_API_KEY: Netlify.env.get("TAVILY_API_KEY") }, job);
};
