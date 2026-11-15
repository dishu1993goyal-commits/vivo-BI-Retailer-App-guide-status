// Netlify Function: /api/v1/* — the public REST API for partners (see ../lib/oa-core.mjs). Every call needs an API key.
import { getStore } from "@netlify/blobs";
import { oaHttp } from "../lib/oa-core.mjs";

const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; };
export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const store = {
    get: (k) => blobs.get(k, { type: "json" }),
    set: (k, v) => blobs.setJSON(k, v),
    delete: (k) => blobs.delete(k),
    list: async (prefix) => { const keys = []; for await (const page of blobs.list({ prefix, paginate: true })) for (const x of page.blobs) keys.push(x.key); return keys; },
  };
  try { return await oaHttp(req, { store, pool }); }
  catch (e) { return new Response(JSON.stringify({ ok: false, error: "Server error, please try again." }), { status: 500, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }); }
};

export const config = { path: ["/api/v1", "/api/v1/*"] };
