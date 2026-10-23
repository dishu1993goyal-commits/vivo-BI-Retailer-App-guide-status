// Netlify Function: POST /api/auth — accounts for the vivo BI apps.
// actions: signup-check, signup, login, reset-check, reset  (see ../lib/auth-core.mjs)
import { getStore } from "@netlify/blobs";
import { handle } from "../lib/auth-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = {
    get: (k) => blobs.get(k, { type: "json" }),
    set: (k, v) => blobs.setJSON(k, v),
    delete: (k) => blobs.delete(k),
    list: async (prefix) => {
      const keys = [];
      for await (const page of blobs.list({ prefix, paginate: true })) {
        for (const x of page.blobs) keys.push(x.key);
      }
      return keys;
    },
  };
  try {
    return await handle(req, { store, env: { GEMINI_API_KEY: Netlify.env.get("GEMINI_API_KEY"), GEMINI_MODEL: Netlify.env.get("GEMINI_MODEL"),
      BREVO_API_KEY: Netlify.env.get("BREVO_API_KEY"), OTP_FROM_EMAIL: Netlify.env.get("OTP_FROM_EMAIL"), OTP_FROM_NAME: Netlify.env.get("OTP_FROM_NAME"),
      WA_NUMBER: Netlify.env.get("WA_NUMBER"), WA_VERIFY_TOKEN: Netlify.env.get("WA_VERIFY_TOKEN"), WA_APP_SECRET: Netlify.env.get("WA_APP_SECRET"),
      WA_TOKEN: Netlify.env.get("WA_TOKEN"), WA_PHONE_ID: Netlify.env.get("WA_PHONE_ID"), WA_WABA_ID: Netlify.env.get("WA_WABA_ID") } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Server error, please try again." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/auth" };
