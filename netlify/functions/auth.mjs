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
  };
  try {
    return await handle(req, { store });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Server error, please try again." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/auth" };
