// Netlify background function (runs up to 15 min): 🎬 AI work on imported screen recordings — UI/UX studio rebuild,
// Tool manuals script, Video explainer presenter script and translations. Started by the accounts service with a one-time
// job id; the page polls vx-job-get for progress and the result (../lib/vx-core.mjs).
import { getStore } from "@netlify/blobs";
import { runVxJob } from "../lib/vx-core.mjs";
import { askAI } from "../lib/auth-core.mjs";
import { loadRouter, makeLog } from "../lib/router-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k), list: async (p) => (await blobs.list({ prefix: p })).blobs.map((x) => x.key) };
  let job = ""; try { job = (await req.json()).job; } catch (e) { return; }
  if (!/^[a-f0-9]{16}$/.test(String(job || ""))) return;
  let env = { GEMINI_API_KEY: Netlify.env.get("GEMINI_API_KEY"), GROQ_API_KEY: Netlify.env.get("GROQ_API_KEY"), GEMINI_MODEL: Netlify.env.get("GEMINI_MODEL"), SARVAM_API_KEY: Netlify.env.get("SARVAM_API_KEY") };
  if (!env.GROQ_API_KEY) { try { const k = ((await store.get("config:aikeys")) || {}).groq; if (k) env.GROQ_API_KEY = k; } catch (e) { } }
  try { env = Object.assign({}, env, { __AIR: await loadRouter(store, env), __AIRLOG: makeLog(store), __AIRFETCH: fetch }); } catch (e) { }
  await runVxJob(store, job, { askAI, aiFetch: fetch, env });
};
