// Scheduled daily (06:00 IST): keeps Affordability Corner prices and offers fresh without anyone importing data.
import { getStore } from "@netlify/blobs";
import { dailyRefresh } from "../lib/aff-core.mjs";

export default async () => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k) };
  await dailyRefresh(store, { SITE_URL: Netlify.env.get("URL"), AFF_DAILY_CAP: Netlify.env.get("AFF_DAILY_CAP") });
  return new Response("ok");
};

export const config = { schedule: "30 0 * * *" };
