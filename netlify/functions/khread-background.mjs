// Netlify background function (runs up to 15 min): Shop Khata's AI reading of a list photo, voice note, pack or bill photo.
// Started only by the accounts service with a one-time job ticket; the phone polls for the result (../lib/kh-core.mjs).
import { getStore } from "@netlify/blobs";
import { runKhJob } from "../lib/kh-core.mjs";
import { askAI } from "../lib/auth-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k) };
  let job = ""; try { job = (await req.json()).job; } catch (e) { return; }
  const env = { GEMINI_API_KEY: Netlify.env.get("GEMINI_API_KEY"), GEMINI_MODEL: Netlify.env.get("GEMINI_MODEL"), GROQ_API_KEY: Netlify.env.get("GROQ_API_KEY"), TAVILY_API_KEY: Netlify.env.get("TAVILY_API_KEY"),
    SARVAM_API_KEY: Netlify.env.get("SARVAM_API_KEY"), BREVO_API_KEY: Netlify.env.get("BREVO_API_KEY"), OTP_FROM_EMAIL: Netlify.env.get("OTP_FROM_EMAIL"), SITE_URL: Netlify.env.get("URL") };
  await runKhJob(store, env, job, fetch, askAI);
};
