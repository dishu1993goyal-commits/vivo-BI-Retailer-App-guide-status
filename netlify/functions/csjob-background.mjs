// Netlify background function (runs up to 15 min): Circular studio — build a lesson's Google Form quiz.
// Started only by the accounts service with a one-time job id; the page polls cs-job for the result (../lib/lx-core.mjs).
import { getStore } from "@netlify/blobs";
import { runCsJob } from "../lib/lx-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k) };
  let job = ""; try { job = (await req.json()).job; } catch (e) { return; }
  await runCsJob(store, job, fetch);
};
