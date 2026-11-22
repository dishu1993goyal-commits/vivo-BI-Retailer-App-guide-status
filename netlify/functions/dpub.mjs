// Netlify Function: GET /api/dpub?have=<version> — the latest published dashboard data (gzip JSON) for the dashboard,
// the apps and the report tools. 204 when the caller already has this version. Written by HO through the Dashboard updater.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const blobs = getStore({ name: "bi-users", consistency: "strong" });
  const meta = await blobs.get("dpub:meta", { type: "json" });
  const u = new URL(req.url), have = u.searchParams.get("have") || "";
  const base = { "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" };
  if (u.searchParams.get("meta")) return new Response(JSON.stringify(meta || null), { headers: Object.assign({ "Content-Type": "application/json" }, base) });
  if (!meta) return new Response(null, { status: 204, headers: base });
  if (have && have === meta.ver) return new Response(null, { status: 204, headers: Object.assign({ ETag: '"' + meta.ver + '"' }, base) });
  const inm = req.headers.get("if-none-match"); if (inm && inm.replace(/"/g, "") === meta.ver) return new Response(null, { status: 304, headers: Object.assign({ ETag: '"' + meta.ver + '"' }, base) });
  const buf = await blobs.get("dpub:data", { type: "arrayBuffer" });
  if (!buf) return new Response(null, { status: 204, headers: base });
  return new Response(buf, { headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip", ETag: '"' + meta.ver + '"', "X-Dpub-Ver": meta.ver }, base) });
};

export const config = { path: "/api/dpub" };
