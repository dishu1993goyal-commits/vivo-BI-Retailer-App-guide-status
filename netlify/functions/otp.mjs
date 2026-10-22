// Netlify Function: POST /api/otp  {action: "send"|"verify", phone, otp}
// Needs Netlify environment variables SMSGATE_USER and SMSGATE_PASS
// (username/password from the SMS Gateway for Android app, Cloud server mode).
import { getStore } from "@netlify/blobs";
import { handle } from "../lib/otp-core.mjs";

export default async (req) => {
  const blobs = getStore({ name: "bi-otp", consistency: "strong" });
  const store = {
    get: (k) => blobs.get(k, { type: "json" }),
    set: (k, v) => blobs.setJSON(k, v),
    delete: (k) => blobs.delete(k),
  };
  const env = {
    SMSGATE_USER: Netlify.env.get("SMSGATE_USER"),
    SMSGATE_PASS: Netlify.env.get("SMSGATE_PASS"),
  };
  try {
    return await handle(req, { store, env });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Server error, please try again." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/otp" };
