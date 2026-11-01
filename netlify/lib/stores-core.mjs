// Store locator: HO maintains a directory of vivo outlets (exclusive stores, authorized / general-trade dealers,
// service centres, national key accounts — Reliance Digital, Croma, Vijay Sales) with GPS; users find the nearest on a map, or browse PAN India state-wise. Geocoding is done on
// the admin's device (Nominatim) when a store is added, so only lat/lng reach the server.
// Storage:  store:<id> { id, name, type, address, city, state, pincode, lat, lng, phone, hours, by, at }
import { allowedFor } from "./access-core.mjs";
import { randomBytes, createHash } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
export const STORE_TYPES = { exclusive: "vivo Exclusive Store", authorized: "Authorized dealer", general: "General trade", service: "Service centre", reliance: "Reliance Digital", croma: "Croma", vijaysales: "Vijay Sales" };
const typeOf = (x) => { const k = low(x).replace(/[^a-z]/g, ""); if (STORE_TYPES[k]) return k; if (/reliance|jio/.test(k)) return "reliance"; if (/croma/.test(k)) return "croma"; if (/vijay/.test(k)) return "vijaysales"; if (/exclusive|ves|brandstore/.test(k)) return "exclusive"; if (/service|care/.test(k)) return "service"; if (/general|gt/.test(k)) return "general"; return "authorized"; };
// Live map search (Google Places when HO has added a key; otherwise the page searches OpenStreetMap itself).
const GQ = { "": "vivo mobile store", exclusive: "vivo exclusive store", authorized: "vivo authorised mobile store", general: "mobile phone shop", service: "vivo service center", reliance: "Reliance Digital", croma: "Croma store", vijaysales: "Vijay Sales store" };
const GNAME = { exclusive: /vivo/i, service: /vivo/i, reliance: /reliance|jio/i, croma: /croma/i, vijaysales: /vijay\s*sales/i };
const num = (v, lo, hi) => { const n = Number(v); return isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1e6) / 1e6 : null; };
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
function cleanStore(x, t, by) {
  const lat = num(x.lat, -90, 90), lng = num(x.lng, -180, 180);
  return { id: str(x.id, 30).replace(/[^a-z0-9]/gi, "") || nid(t), name: str(x.name, 80) || "Store", type: typeOf(x.type), address: str(x.address, 300), city: str(x.city, 60), state: str(x.state, 60), pincode: str(x.pincode, 12), lat, lng, phone: str(x.phone, 40), hours: str(x.hours, 80), by: by || str(x.by, 60), at: Number(x.at) || t };
}
const dist = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, dLat = (c - a) * r, dLng = (d - b) * r, h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
const pub = (s) => ({ id: s.id, name: s.name, type: s.type, address: s.address, city: s.city, state: s.state, pincode: s.pincode, lat: s.lat, lng: s.lng, phone: s.phone, hours: s.hours });

export async function storesAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx, isAdmin = app === "admin";
  const all = async () => (await pool((await store.list("store:")).slice(0, 5000), 60, (k) => store.get(k))).filter(Boolean);

  if (b.action === "store-list") {   // browse: filter by state/type/text
    const st = low(str(b.state, 60)), ty = str(b.type, 20), q = low(str(b.q, 60));
    let L = await all();
    if (st) L = L.filter((s) => low(s.state) === st);
    if (STORE_TYPES[ty]) L = L.filter((s) => s.type === ty);
    if (q) L = L.filter((s) => (s.name + " " + s.city + " " + s.address + " " + s.pincode).toLowerCase().includes(q));
    const states = {}, types = {}; (await all()).forEach((s) => { if (s.state) states[s.state] = (states[s.state] || 0) + 1; types[s.type] = (types[s.type] || 0) + 1; });
    return json(200, { ok: true, items: L.sort((a, c) => (a.state || "").localeCompare(c.state || "") || (a.city || "").localeCompare(c.city || "")).slice(0, 1500).map(pub), total: L.length, states: Object.keys(states).sort().map((s) => ({ state: s, n: states[s] })), types });
  }
  if (b.action === "store-near") {   // nearest to the user's GPS
    const lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180); if (lat == null || lng == null) return json(400, { ok: false, error: "Location not available." });
    const ty = str(b.type, 20);
    let L = (await all()).filter((s) => s.lat != null && s.lng != null && (!STORE_TYPES[ty] || s.type === ty));
    L = L.map((s) => Object.assign(pub(s), { km: Math.round(dist(lat, lng, s.lat, s.lng) * 10) / 10 })).sort((a, c) => a.km - c.km).slice(0, 60);
    return json(200, { ok: true, items: L, you: { lat, lng } });
  }
  if (b.action === "store-live") {   // find stores anywhere on the map — real places with address + GPS (never AI-invented)
    const ty = STORE_TYPES[b.type] ? b.type : "", lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180), city = str(b.city, 60), state = str(b.state, 60), q = str(b.q, 80);
    if (lat == null && !city && !state && !q) return json(400, { ok: false, error: "Choose a state / city or use your location." });
    const cfg = (await store.get("config:gmaps")) || {};
    if (!cfg.key) return json(200, { ok: true, provider: "osm" });   // free OpenStreetMap search runs on the device
    const text = (q ? q + " " : "") + GQ[ty] + (city || state ? " in " + [city, state].filter(Boolean).join(", ") : "") + ", India";
    const ck = "storelive:" + createHash("sha1").update(text + "|" + (lat != null ? lat.toFixed(2) + "," + lng.toFixed(2) : "")).digest("hex").slice(0, 20), hit = await store.get(ck);
    if (hit && t - hit.at < 7 * 864e5) return json(200, { ok: true, provider: "google", items: hit.items, cached: true });
    const body = { textQuery: text, regionCode: "IN", languageCode: "en", maxResultCount: 20 };
    if (lat != null && !city && !state) body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 20000 } };
    let j = {};
    try {
      const r = await (ctx.aiFetch || fetch)("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": cfg.key, "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.googleMapsUri,places.rating,places.businessStatus,places.addressComponents" }, body: JSON.stringify(body) });
      j = await r.json().catch(() => ({}));
      if (!r.ok) return json(200, { ok: true, provider: "osm", googleError: str((j.error && j.error.message) || "Google Maps error " + r.status, 160) });
    } catch (e) { return json(200, { ok: true, provider: "osm", googleError: "Google Maps not reachable" }); }
    const comp = (p, kind) => ((p.addressComponents || []).find((c) => (c.types || []).includes(kind)) || {}).longText || "";
    let items = (j.places || []).filter((p) => p.location && p.businessStatus !== "CLOSED_PERMANENTLY").map((p) => ({ name: str(p.displayName && p.displayName.text, 80), type: ty || (/vivo/i.test((p.displayName || {}).text || "") ? "authorized" : "general"), address: str(p.formattedAddress, 300),
      city: str(comp(p, "locality") || comp(p, "administrative_area_level_3"), 60), state: str(comp(p, "administrative_area_level_1"), 60), pincode: str(comp(p, "postal_code"), 12), lat: num(p.location.latitude, -90, 90), lng: num(p.location.longitude, -180, 180), phone: str(p.nationalPhoneNumber, 40), rating: Number(p.rating) || 0, maps: str(p.googleMapsUri, 300) }));
    if (GNAME[ty]) items = items.filter((x) => GNAME[ty].test(x.name));
    await store.set(ck, { at: t, items });
    return json(200, { ok: true, provider: "google", items });
  }
  if (!isAdmin) return json(403, { ok: false, error: "Only HO admins can edit the store directory." });
  const rule = ((await store.get("config:access")) || { r: {} }).r || {};
  if (!allowedFor(rule["tool:stores"], app, rec)) return json(403, { ok: false, error: "You are not authorised to edit stores (Access control)." });
  const by = rec.fullName || rec.username;

  if (b.action === "store-gkey") {   // Google Maps (Places API) key — write-only, never sent back to any device
    if (b.clear) { await store.delete("config:gmaps"); return json(200, { ok: true, set: false }); }
    if (b.key !== undefined) { const k = str(b.key, 120); if (!/^[A-Za-z0-9_\-]{20,120}$/.test(k)) return json(400, { ok: false, error: "That doesn't look like a Google API key." }); await store.set("config:gmaps", { key: k, by, at: t }); }
    const c = await store.get("config:gmaps"); return json(200, { ok: true, set: !!(c && c.key), by: c ? c.by : "", at: c ? c.at : 0 });
  }
  if (b.action === "store-save") {
    const s = cleanStore(b.store || {}, t, by); if (!s.name || (!s.address && s.lat == null)) return json(400, { ok: false, error: "Add a name and an address or GPS." });
    await store.set(`store:${s.id}`, s); return json(200, { ok: true, store: pub(s) });
  }
  if (b.action === "store-import") {
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 3000); if (!rows.length) return json(400, { ok: false, error: "No rows." });
    let n = 0; for (const x of rows) { const s = cleanStore(x, t, by); if (!s.name) continue; await store.set(`store:${s.id}`, s); n++; }
    return json(200, { ok: true, added: n });
  }
  if (b.action === "store-delete") { const id = str(b.id, 30).replace(/[^a-z0-9]/gi, ""); if (id) await store.delete(`store:${id}`); return json(200, { ok: true }); }
  if (b.action === "store-clear") { for (const k of await store.list("store:")) await store.delete(k); return json(200, { ok: true }); }
  return json(400, { ok: false, error: "Unknown action." });
}
