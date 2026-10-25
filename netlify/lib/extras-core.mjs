// Dashboard banners (admins edit), India map settings (admins), Face records (everyone; master sees all).
// Storage:
//   config:banners        { builtins:{fold|bi|v80:{on,link,newTab}}, items:[{id,img,link,title,newTab,on,from,to}], order:[ids], by, at }
//   pubimg:<id>           { mime, b64, at }   public banner pictures, served by GET /api/auth?img=<id>
//   config:statemap       { regions:{<map region>:[dashboard states]}, by, at }
//   face:<id>             { id, name, role, refId, store, city, notes, state, consent, desc[128], by{app,username,name,state}, at, upd }
//   facep:<id>            { data }   face photo (jpeg data URL)
//   facelog:<id>          { id, person, name, role, at, by, state, lat, lng, score, note, photo }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const rid = (t) => t.toString(36) + randomBytes(4).toString("hex");
const BUILTIN = ["fold", "bi", "v80"];
const okLink = (u) => { u = str(u, 600); return /^(https:\/\/|#|t:)[^\s"'<>]*$/i.test(u) ? u : ""; };
const okImg = (u) => { u = str(u, 600); return /^(https:\/\/[^\s"'<>]+|\/api\/auth\?img=[a-z0-9]+)$/i.test(u) ? u : ""; };
const okDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? d : "");
export function cleanBanners(c) {
  c = c && typeof c === "object" ? c : {};
  const builtins = {};
  BUILTIN.forEach((k) => { const b = (c.builtins && c.builtins[k]) || {}; builtins[k] = { on: b.on !== false, link: okLink(b.link), newTab: !!b.newTab, title: str(b.title, 80) }; });
  const items = (Array.isArray(c.items) ? c.items : []).slice(0, 20).map((x) => ({ id: str(x.id, 24).replace(/[^a-z0-9]/gi, "") || randomBytes(4).toString("hex"), img: okImg(x.img), link: okLink(x.link), title: str(x.title, 80), newTab: x.newTab !== false && /^https/i.test(String(x.link || "")), on: x.on !== false, from: okDate(x.from), to: okDate(x.to) })).filter((x) => x.img);
  const ids = BUILTIN.map((k) => "b:" + k).concat(items.map((x) => x.id));
  const order = (Array.isArray(c.order) ? c.order : []).filter((x, i, a) => ids.includes(x) && a.indexOf(x) === i);
  ids.forEach((x) => { if (!order.includes(x)) order.push(x); });
  return { builtins, items, order, by: c.by ? str(c.by, 60) : undefined, at: Number(c.at) || undefined };
}
// ---- public (no login): banner list + banner pictures ----
export async function extrasPublic(b, store) {
  if (b.action === "bnr-get") return json(200, { ok: true, banners: cleanBanners(await store.get("config:banners")) });
  return null;
}
export async function servePublicImage(id, store) {
  const im = await store.get(`pubimg:${String(id || "").replace(/[^a-z0-9]/gi, "").slice(0, 40)}`);
  if (!im || !im.b64) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(im.b64, "base64"), { status: 200, headers: { "content-type": im.mime || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}
const FACE_ROLES = ["Retailer", "Promoter / VBA", "Sales team", "Distributor", "Visitor", "Staff", "Other"];
export async function extrasAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx;
  const isAdmin = app === "admin", isMaster = isAdmin && rec.master === true;
  const me = { app, username: rec.username, name: rec.fullName || rec.username, state: rec.state || (isAdmin ? "HO" : "") };
  const mineK = (x) => x && x.by && x.by.app === app && String(x.by.username).toLowerCase() === String(rec.username).toLowerCase();

  // ---------- banners ----------
  if (b.action === "bnr-save") {
    if (!isAdmin) return json(403, { ok: false, error: "Only HO admins change banners." });
    const c = Object.assign(cleanBanners(b.banners), { by: me.name, at: t });
    await store.set("config:banners", c);
    await ctx.logEvent(store, t, app, rec, "banners-save", { device: c.items.length + " custom banners", ver: "" });
    return json(200, { ok: true, banners: c });
  }
  if (b.action === "bnr-upload") {
    if (!isAdmin) return json(403, { ok: false, error: "Only HO admins upload banners." });
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ""));
    if (!m) return json(400, { ok: false, error: "Choose a JPG, PNG or WebP picture." });
    if (m[2].length > 2200000) return json(413, { ok: false, error: "The picture is too large (max about 1.5 MB)." });
    const id = rid(t); await store.set(`pubimg:${id}`, { mime: m[1], b64: m[2], at: t, by: me.name });
    return json(200, { ok: true, url: "/api/auth?img=" + id });
  }

  // ---------- India map ----------
  if (b.action === "map-config") {
    if (!isAdmin) return json(403, { ok: false, error: "The state map is for HO admins." });
    if (b.save) {
      const regions = {}; Object.entries(b.save.regions || {}).slice(0, 60).forEach(([k, v]) => { const kk = str(k, 60); if (kk) regions[kk] = (Array.isArray(v) ? v : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 8); });
      const c = { regions, by: me.name, at: t }; await store.set("config:statemap", c); return json(200, { ok: true, config: c });
    }
    return json(200, { ok: true, config: (await store.get("config:statemap")) || { regions: null } });
  }

  // ---------- face records ----------
  if (/^face-/.test(b.action)) {
    const canSee = (x) => isMaster || mineK(x);
    const cleanDesc = (d) => (Array.isArray(d) && d.length === 128 && d.every((v) => typeof v === "number" && isFinite(v) && Math.abs(v) < 2) ? d.map((v) => Math.round(v * 10000) / 10000) : null);
    const okPhoto = (p) => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(String(p || "")) && String(p).length < 420000 ? String(p) : "";
    if (b.action === "face-enrol") {
      if (b.consent !== true) return json(400, { ok: false, error: "Ask the person and tick that they agree to be photographed for records." });
      const name = str(b.name, 80); if (!name) return json(400, { ok: false, error: "Enter the person's name." });
      const desc = cleanDesc(b.desc), photo = okPhoto(b.photo);
      if (!desc || !photo) return json(400, { ok: false, error: "No clear face was captured. Take the photo again, facing the camera." });
      let id = str(b.id, 30).replace(/[^a-z0-9]/g, ""), old = id ? await store.get(`face:${id}`) : null;
      if (old && !(mineK(old) || isMaster)) return json(403, { ok: false, error: "You can only update people you registered." });
      if (!old) id = rid(t);
      const x = Object.assign(old || { id, by: me, at: t }, { name, role: FACE_ROLES.includes(b.role) ? b.role : "Other", refId: str(b.refId, 40), store: str(b.store, 80), city: str(b.city, 40), notes: str(b.notes, 300), state: str(b.state, 40) || me.state, consent: true, desc, upd: t });
      await store.set(`face:${id}`, x); await store.set(`facep:${id}`, { data: photo });
      await ctx.logEvent(store, t, app, rec, "face-enrol", { device: name, ver: "" });
      return json(200, { ok: true, person: Object.assign({}, x) });
    }
    if (b.action === "face-list") {   // people this user can match against (master: everyone, or only own with mine:true)
      const all = (await pool(await store.list("face:"), 40, (k) => store.get(k))).filter(Boolean);
      const rows = all.filter((x) => (b.mine || !isMaster ? mineK(x) : true)).sort((a, c) => (c.upd || c.at) - (a.upd || a.at));
      return json(200, { ok: true, master: isMaster, people: rows.slice(0, 3000).map((x) => ({ id: x.id, name: x.name, role: x.role, refId: x.refId, store: x.store, city: x.city, notes: x.notes, state: x.state, at: x.at, upd: x.upd, by: x.by, desc: x.desc, mine: mineK(x) })) });
    }
    if (b.action === "face-photo") {
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).slice(0, 30).map((x) => str(x, 30).replace(/[^a-z0-9]/g, "")).filter(Boolean), out = {};
      for (const id of ids) { const x = await store.get(`face:${id}`) || await store.get(`facelog:${id}`); if (x && (canSee(x) || (x.by && mineK(x)))) { const p = id.length && (await store.get(`facep:${id}`)); out[id] = (p && p.data) || x.photo || ""; } }
      return json(200, { ok: true, photos: out });
    }
    if (b.action === "face-checkin") {
      let person = null; if (b.person) { person = await store.get(`face:${str(b.person, 30).replace(/[^a-z0-9]/g, "")}`); if (person && !canSee(person)) person = null; }
      const id = rid(t), lat = Number(b.lat), lng = Number(b.lng);
      const x = { id, person: person ? person.id : "", name: person ? person.name : str(b.name, 80) || "Unknown person", role: person ? person.role : "", refId: person ? person.refId : "", store: person ? person.store : str(b.store, 80), at: t, by: me, state: me.state,
        lat: isFinite(lat) && Math.abs(lat) <= 90 ? Math.round(lat * 1e5) / 1e5 : null, lng: isFinite(lng) && Math.abs(lng) <= 180 ? Math.round(lng * 1e5) / 1e5 : null, score: Math.max(0, Math.min(1, Number(b.score) || 0)), note: str(b.note, 200), photo: okPhoto(b.photo).length < 90000 ? okPhoto(b.photo) : "" };
      await store.set(`facelog:${id}`, x);
      return json(200, { ok: true, log: Object.assign({}, x, { photo: undefined }) });
    }
    if (b.action === "face-logs") {
      const from = Date.parse(b.from || "") || t - 31 * 864e5, to = (Date.parse(b.to || "") || t) + 864e5;
      const all = (await pool(await store.list("facelog:"), 40, (k) => store.get(k))).filter((x) => x && x.at >= from && x.at < to && (b.mine || !isMaster ? mineK(x) : true));
      return json(200, { ok: true, logs: all.sort((a, c) => c.at - a.at).slice(0, 3000).map((x) => Object.assign({}, x, { photo: undefined, hasPhoto: !!x.photo })) });
    }
    if (b.action === "face-delete") {
      const id = str(b.id, 30).replace(/[^a-z0-9]/g, ""), k = b.log ? `facelog:${id}` : `face:${id}`, x = await store.get(k);
      if (!x) return json(404, { ok: false, error: "Not found." });
      if (!(mineK(x) || isMaster)) return json(403, { ok: false, error: "Only the person who added it or a master admin can delete it." });
      await store.delete(k); if (!b.log) await store.delete(`facep:${id}`);
      await ctx.logEvent(store, t, app, rec, b.log ? "face-log-delete" : "face-delete", { device: x.name || "", ver: "" });
      return json(200, { ok: true });
    }
  }
  return json(400, { ok: false, error: "Unknown action." });
}
