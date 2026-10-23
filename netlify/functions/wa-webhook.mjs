// Netlify Function: /api/whatsapp — Meta WhatsApp webhook for "Verify on WhatsApp".
// Users send "VERIFY <code>" to the company WhatsApp number; Meta forwards it here.
import { getStore } from "@netlify/blobs";
import { handleWebhook } from "../lib/wa-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = { get: (k) => blobs.get(k, { type: "json" }), set: (k, v) => blobs.setJSON(k, v), delete: (k) => blobs.delete(k) };
  try {
    return await handleWebhook(req, { store, env: { WA_VERIFY_TOKEN: Netlify.env.get("WA_VERIFY_TOKEN"), WA_APP_SECRET: Netlify.env.get("WA_APP_SECRET") } });
  } catch (e) {
    return new Response("OK", { status: 200 });   // never make Meta retry forever
  }
};

export const config = { path: "/api/whatsapp" };
