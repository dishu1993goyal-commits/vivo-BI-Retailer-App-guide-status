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

// Free OpenStreetMap search, run here on the server (phones' WebViews can't always reach the map servers directly):
// Nominatim (name search) and Overpass (map features) in parallel, each with a short time limit; cached 7 days.
const OSMRX = { "": "vivo", exclusive: "vivo", authorized: "vivo", service: "vivo", reliance: "Reliance Digital|Reliance Smart|JioMart Digital|My Jio", croma: "Croma", vijaysales: "Vijay Sales" };
const NOMQ = { "": "vivo", exclusive: "vivo", authorized: "vivo", service: "vivo service", general: "mobile phone shop", reliance: "Reliance Digital", croma: "Croma", vijaysales: "Vijay Sales" };
const UA = "vivoBI-StoreLocator/1.0 (vivo Business Innovation dashboard)";
async function osmLive(o, ctx) {
  const { store, t } = ctx, f = ctx.aiFetch || fetch, { ty, city, state, q } = o; let { lat, lng } = o;
  const ck = "storeosm:" + createHash("sha1").update([ty, lat != null ? lat.toFixed(2) + "," + lng.toFixed(2) : "", city, state, q].join("|")).digest("hex").slice(0, 20), hit = await store.get(ck);
  if (hit && t - hit.at < 7 * 864e5 && hit.items.length) return json(200, { ok: true, provider: "osm", items: hit.items, cached: true, googleError: o.googleError });
  const timed = async (url, opt, ms) => { const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms); try { const r = await f(url, Object.assign({ signal: ac.signal }, opt)); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); } finally { clearTimeout(tm); } };
  const nom = (params) => timed("https://nominatim.openstreetmap.org/search?" + new URLSearchParams(Object.assign({ format: "jsonv2", countrycodes: "in", addressdetails: "1", extratags: "1", limit: "40" }, params)), { headers: { "user-agent": UA, accept: "application/json" } }, params.limit === "1" ? 3000 : 5000);
  const errs = [];
  if (lat == null && city) { try { const g = await nom({ q: [city, state, "India"].filter(Boolean).join(", "), limit: "1" }); if (g[0]) { lat = +g[0].lat; lng = +g[0].lon; } } catch (e) { errs.push("place lookup: " + e.message); } }
  const near = lat != null, d = near ? 0.25 : 0;
  // 1) Nominatim name search
  const pNom = nom(Object.assign({ q: NOMQ[ty] + (!near && state ? ", " + state : "") }, near ? { viewbox: [lng - d, lat + d, lng + d, lat - d].join(","), bounded: "1" } : {}))
    .then((L) => L.filter((x) => ["shop", "office", "craft", "amenity"].includes(x.category) || /mobile_phone|electronics/.test(x.type || "")).map((x) => { const a = x.address || {}; return { name: str(x.name || (x.display_name || "").split(",")[0], 80), lat: +x.lat, lng: +x.lon,
      address: str([a.house_number, a.road, a.neighbourhood || a.suburb].filter(Boolean).join(", ") || (x.display_name || "").split(",").slice(1, 4).join(","), 300), city: str(a.city || a.town || a.village || a.county || a.state_district, 60), state: str(a.state, 60), pincode: str(a.postcode, 12), phone: str((x.extratags || {}).phone || (x.extratags || {})["contact:phone"], 40) }; }))
    .catch((e) => { errs.push("Nominatim " + e.message); return []; });
  // 2) Overpass map features (two mirrors)
  const sel = ty === "general" ? '["shop"="mobile_phone"]' : '["name"~"' + OSMRX[ty] + '",i]';
  const area = !near && state ? '(area["name"="' + state.replace(/"/g, "") + '"]["admin_level"="4"];area["name:en"="' + state.replace(/"/g, "") + '"]["admin_level"="4"];)->.s;' : "";
  const oq = "[out:json][timeout:5];" + area + "(nwr" + sel + (near ? "(around:20000," + lat + "," + lng + ")" : "(area.s)") + ";);out center tags 80;";
  const pOv = (near || area) ? Promise.any(["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"].map((u) => timed(u, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA }, body: "data=" + encodeURIComponent(oq) }, 5500)))
    .then((j) => (j.elements || []).map((e) => { const g = e.tags || {}, la = e.lat != null ? e.lat : e.center && e.center.lat, lo = e.lon != null ? e.lon : e.center && e.center.lon; if (la == null || !(g.name || g.brand)) return null; if (ty !== "general" && !(g.shop || g.craft || g.office || g.amenity)) return null;
      return { name: str(g.name || g.brand, 80), lat: +la, lng: +lo, address: str([g["addr:housenumber"], g["addr:street"], g["addr:suburb"] || g["addr:place"]].filter(Boolean).join(", "), 300), city: str(g["addr:city"] || g["addr:district"], 60), state: str(g["addr:state"] || (!near ? state : ""), 60), pincode: str(g["addr:postcode"], 12), phone: str(g.phone || g["contact:phone"], 40) }; }).filter(Boolean))
    .catch((e) => { errs.push("Overpass " + ((e.errors || [e]).map((x) => x.message).join("/"))); return []; }) : Promise.resolve([]);
  const [a1, a2] = await Promise.all([pNom, pOv]);
  const rx = ty && ty !== "general" ? new RegExp(OSMRX[ty], "i") : ty === "" ? /vivo/i : null, seen = {}, items = [];
  for (const x of a2.concat(a1)) {
    if (!x.name || !isFinite(x.lat) || !isFinite(x.lng)) continue; if (rx && !rx.test(x.name)) continue;
    const k = low(x.name).replace(/[^a-z]/g, "").slice(0, 14) + (Math.round(x.lat * 500) + "," + Math.round(x.lng * 500)); if (seen[k]) { const y = seen[k]; ["address", "city", "state", "pincode", "phone"].forEach((f2) => { if (!y[f2] && x[f2]) y[f2] = x[f2]; }); continue; } seen[k] = x;
    const type = ty || (/care|service/i.test(x.name) ? "service" : /exclusive|brand store/i.test(x.name) ? "exclusive" : "authorized");
    items.push(Object.assign(x, { type, lat: Math.round(x.lat * 1e6) / 1e6, lng: Math.round(x.lng * 1e6) / 1e6, src: "OpenStreetMap" }));
  }
  if (!items.length && errs.length === (near || area ? 2 : 1)) return json(200, { ok: false, error: "Map search isn't reachable right now — try again in a minute. (" + errs.join("; ").slice(0, 160) + ")" });
  if (items.length) await store.set(ck, { at: t, items: items.slice(0, 80) });
  return json(200, { ok: true, provider: "osm", items: items.slice(0, 80), googleError: o.googleError, center: near ? { lat, lng } : null });
}

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
    if (!cfg.key) return osmLive({ ty, lat, lng, city, state, q }, ctx);
    const text = (q ? q + " " : "") + GQ[ty] + (city || state ? " in " + [city, state].filter(Boolean).join(", ") : "") + ", India";
    const ck = "storelive:" + createHash("sha1").update(text + "|" + (lat != null ? lat.toFixed(2) + "," + lng.toFixed(2) : "")).digest("hex").slice(0, 20), hit = await store.get(ck);
    if (hit && t - hit.at < 7 * 864e5) return json(200, { ok: true, provider: "google", items: hit.items, cached: true });
    const body = { textQuery: text, regionCode: "IN", languageCode: "en", maxResultCount: 20 };
    if (lat != null && !city && !state) body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 20000 } };
    let j = {};
    try {
      const r = await (ctx.aiFetch || fetch)("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": cfg.key, "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.googleMapsUri,places.rating,places.businessStatus,places.addressComponents" }, body: JSON.stringify(body) });
      j = await r.json().catch(() => ({}));
      if (!r.ok) return osmLive({ ty, lat, lng, city, state, q, googleError: str((j.error && j.error.message) || "Google Maps error " + r.status, 160) }, ctx);
    } catch (e) { return osmLive({ ty, lat, lng, city, state, q, googleError: "Google Maps not reachable" }, ctx); }
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
