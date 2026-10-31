// Netlify background function (runs up to 15 min): makes a free presenter video on a Hugging Face Space
// for the App guide. Called only by the accounts service with a one-time job ticket (see ../lib/appguide-core.mjs).
import { getStore } from "@netlify/blobs";
import { runHfJob } from "../lib/appguide-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k) };
  let job = ""; try { job = (await req.json()).job; } catch (e) { return; }
  await runHfJob(store, {}, job);
};
