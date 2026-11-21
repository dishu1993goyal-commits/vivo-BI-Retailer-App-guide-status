// One-tool links (HO). A link opens exactly ONE tool page for whoever has it; the server refuses every other
// tool, report and dashboard call for sessions made from a link.
//   tlk:<id>          { id, hash (sha256 of the secret part), page, name, label, view: "state"|"ho", state, write, ask, pin (scrypt), max, exp, off,
//                       by, at, opens, devices:[{ n, m, at, last }], bad:{ h:<hour>, n } }
//   lnkuser:<lnk_id>  the link's own login record { username, app, state, fullName, linkOnly: id, sessions[] } — kept apart from real users
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { LINK_CATALOG } from "./link-catalog.mjs";
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const COMMON = ["me", "ping", "logout", "acc-mine", "tl-use", "cust-get", "theme-get"];
// action names that change something — blocked unless the link allows changes
const WRITE = /-(add|set|save|edit|del|delete|remove|hide|refresh|keys|upload|import|bulk|create|update|upd|verify|reset|config|cfg|send|approve|reject|publish|close|accept|submit|respond|claim|pay|push|release|move|assign|freeze|setup|call|mark|pw|order|fmt|short|origin|share|gform|gres)(-|$)/;
export const isWrite = (a, b) => {
  // "…-cfg" / "…-setup" calls only READ the settings unless they carry something to save
  if (/-(cfg|config|setup)$/.test(a) && b && !["save", "cfg", "keys", "set", "newKey", "del", "url", "gasUrl", "smToken"].some((k) => b[k] !== undefined && b[k] !== false && b[k] !== "")) return false;
  return WRITE.test(a) || /^(support-upload|cust-save|cust-delete|cust-release|cxx-save|tl-push)$/.test(a);
};

export const linkPages = (L) => (Array.isArray(L.pages) && L.pages.length ? L.pages : [L.page]).filter((p) => LINK_CATALOG[p]);
const toolNames = (L) => linkPages(L).map((p) => LINK_CATALOG[p].name).join(", ");
export function linkAllows(L, action, b) {
  if (COMMON.includes(action)) return true;
  if (!linkPages(L).some((p) => LINK_CATALOG[p].acts.includes(action))) return false;
  return L.write || !isWrite(action, b);
}
// called for every logged-in request made with a link session
export async function linkGate(store, t, rec, action, app, b) {
  const L = await store.get("tlk:" + rec.linkOnly);
  if (!L || L.off || (L.exp && t > L.exp) || app !== rec.app) return J(401, { ok: false, loggedOut: true, linkEnded: true, error: "This link has expired or was switched off. Ask the person who sent it for a new one." });
  if (!linkAllows(L, action, b)) return J(403, { ok: false, linkBlocked: true, error: "This link only opens " + toolNames(L) + (isWrite(action) && linkPages(L).some((p) => LINK_CATALOG[p].acts.includes(action)) ? (L.demo ? " as a demo — changes are not allowed." : " to view — changes are not allowed.") : ".") });
  return null;
}

const hashPin = (p, salt = randomBytes(8).toString("hex")) => salt + ":" + scryptSync(String(p), salt, 32).toString("hex");
const pinOk = (p, h) => { try { const [s, x] = String(h).split(":"); const a = scryptSync(String(p), s, 32), b = Buffer.from(x, "hex"); return a.length === b.length && timingSafeEqual(a, b); } catch (e) { return false; } };
const pubLink = (L, origin) => ({ id: L.id, page: L.page, pages: linkPages(L), tabs: L.tabs || {}, demo: !!L.demo, short: L.short || "", tool: toolNames(L) || L.page, icon: linkPages(L).length > 1 ? "🧰" : (LINK_CATALOG[L.page] || {}).icon || "🔗", label: L.label, view: L.view, state: L.state, write: !!L.write, ask: !!L.ask, pin: !!L.pin, max: L.max, exp: L.exp || 0, off: !!L.off, by: L.by, at: L.at, opens: L.opens || 0, devices: (L.devices || []).length, url: L.url || "" });

export async function tlkAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx;
  if (app !== "admin") return J(403, { ok: false, error: "Only HO can make tool links" });
  if (rec.linkOnly) return J(403, { ok: false, error: "Not allowed" });
  const by = rec.fullName || rec.username || "";
  if (b.action === "tlk-cat") return J(200, { ok: true, origin: ((await store.get("cfg:share")) || {}).origin || "", tools: Object.keys(LINK_CATALOG).map((p) => ({ page: p, id: LINK_CATALOG[p].id, icon: LINK_CATALOG[p].icon, name: LINK_CATALOG[p].name, ho: LINK_CATALOG[p].ho, tabs: LINK_CATALOG[p].tabs || [], writes: LINK_CATALOG[p].acts.filter(isWrite).length })).sort((x, y) => x.name.localeCompare(y.name)) });
  if (b.action === "tlk-origin") {   // the address shared links start with (your own domain once it is connected in Netlify)
    let o = String(b.origin || "").trim().replace(/\/+$/, "");
    if (o && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(o)) return J(400, { ok: false, error: "Type it like https://bi.yourdomain.in" });
    await store.set("cfg:share", { origin: o, by, at: t }); return J(200, { ok: true, origin: o });
  }
  if (b.action === "tlk-short") {   // optional short link (is.gd) so the message doesn't show the long address
    const u = String(b.url || ""); if (!/^https:\/\/[\w.-]+\/[\w./#?=&%-]*$/.test(u) || u.length > 600) return J(400, { ok: false, error: "Bad link" });
    try { const r = await (ctx.aiFetch || fetch)("https://is.gd/create.php?format=simple&url=" + encodeURIComponent(u)); const x = (await r.text()).trim(); if (!/^https:\/\/is\.gd\/\w+$/.test(x)) return J(502, { ok: false, error: "The short-link service refused: " + x.slice(0, 120) }); return J(200, { ok: true, short: x }); }
    catch (e) { return J(502, { ok: false, error: "Couldn't reach the short-link service" }); }
  }
  if (b.action === "tlk-list") {
    const L = (await pool(await store.list("tlk:"), 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 300);
    return J(200, { ok: true, rows: L.map((x) => pubLink(x)) });
  }
  if (b.action === "tlk-create") {
    const pages = [...new Set((Array.isArray(b.pages) && b.pages.length ? b.pages : [b.page]).map((p) => str(p, 60)).filter((p) => LINK_CATALOG[p]))].slice(0, 20);
    if (!pages.length) return J(400, { ok: false, error: "Choose a tool" });
    const c = LINK_CATALOG[pages[0]], anyHo = pages.some((p) => LINK_CATALOG[p].ho);
    const tabs = {}; Object.keys(b.tabs || {}).forEach((p) => { if (!pages.includes(p)) return; const known = (LINK_CATALOG[p].tabs || []).map((x) => x[0]), sel = (Array.isArray(b.tabs[p]) ? b.tabs[p] : []).map((x) => str(x, 20)).filter((x) => known.includes(x)); if (sel.length && sel.length < known.length) tabs[p] = sel; });
    const view = anyHo || b.view === "ho" ? "ho" : "state", state = view === "state" ? str(b.state, 40) : "";
    if (view === "state" && !state) return J(400, { ok: false, error: "Choose the state whose data the link shows" });
    const days = Math.max(0, Math.min(365, Math.round(+b.days || 0))), pin = str(b.pin, 12);
    if (pin && !/^\d{4,8}$/.test(pin)) return J(400, { ok: false, error: "PIN must be 4–8 digits" });
    const id = t.toString(36) + randomBytes(3).toString("hex"), secret = randomBytes(18).toString("base64url");
    const origin = /^https:\/\/[\w.-]+$/.test(String(b.origin || "")) ? b.origin : "";
    const L = { id, hash: sha(secret), page: pages[0], pages, tabs, demo: !!b.demo, label: str(b.label, 80) || "Shared link", view, state, write: !b.demo && !!b.write, ask: b.ask !== false, pin: pin ? hashPin(pin) : "", max: Math.max(1, Math.min(500, Math.round(+b.max || 25))), exp: days ? t + days * 864e5 : 0, off: false, by, byKey: rec.username, at: t, opens: 0, devices: [] };
    L.url = origin ? origin + "/open.html#" + id + "." + secret : "";
    await store.set("tlk:" + id, L);
    return J(200, { ok: true, link: pubLink(L), url: "/open.html#" + id + "." + secret });
  }
  const L = await store.get("tlk:" + str(b.id, 30)); if (!L) return J(404, { ok: false, error: "Link not found" });
  if (b.action === "tlk-set") {
    if (b.off !== undefined) L.off = !!b.off;
    if (b.short !== undefined) L.short = /^https:\/\/is\.gd\/\w+$/.test(String(b.short)) ? String(b.short) : "";
    if (b.write !== undefined) L.write = !L.demo && !!b.write;
    if (b.days !== undefined) { const d = Math.max(0, Math.min(365, Math.round(+b.days || 0))); L.exp = d ? t + d * 864e5 : 0; }
    if (b.max !== undefined) L.max = Math.max(1, Math.min(500, Math.round(+b.max || 25)));
    await store.set("tlk:" + L.id, L);
    if (L.off) await store.delete("lnkuser:lnk_" + L.id);   // signs out every device at once
    return J(200, { ok: true, link: pubLink(L) });
  }
  if (b.action === "tlk-devices") return J(200, { ok: true, devices: (L.devices || []).slice().reverse() });
  if (b.action === "tlk-del") { await store.delete("tlk:" + L.id); await store.delete("lnkuser:lnk_" + L.id); return J(200, { ok: true }); }
  return J(400, { ok: false, error: "Unknown action" });
}

// ---- no login: the link page asks what the link opens, then signs the device in ----
export async function tlkPublic(b, ctx) {
  const { store, t } = ctx;
  const m = /^([a-z0-9]{6,20})\.([\w-]{20,40})$/.exec(String(b.k || "").trim()); if (!m) return J(400, { ok: false, error: "This link is not complete — copy the whole link again." });
  const L = await store.get("tlk:" + m[1]);
  if (!L || L.hash !== sha(m[2])) return J(404, { ok: false, error: "This link is not valid." });
  if (L.off) return J(403, { ok: false, error: "This link was switched off by the sender." });
  if (L.exp && t > L.exp) return J(403, { ok: false, error: "This link has expired. Ask the sender for a new one." });
  const c = LINK_CATALOG[L.page] || {};
  const P = linkPages(L), tools = P.map((p) => ({ page: p, name: LINK_CATALOG[p].name, icon: LINK_CATALOG[p].icon, tabs: (L.tabs || {})[p] || [], all: (LINK_CATALOG[p].tabs || []).map((x) => x[0]) }));
  if (b.action === "tlk-p-info") return J(200, { ok: true, tool: toolNames(L), icon: P.length > 1 ? "🧰" : c.icon, tools, demo: !!L.demo, label: L.label, ask: !!L.ask, pin: !!L.pin, view: L.view, state: L.state, write: !!L.write });
  if (b.action === "tlk-p-join") {
    const hr = Math.floor(t / 36e5); if (!L.bad || L.bad.h !== hr) L.bad = { h: hr, n: 0 };
    if (L.bad.n >= 10) return J(429, { ok: false, error: "Too many wrong PINs. Try again in an hour." });
    if (L.pin && !pinOk(str(b.pin, 12), L.pin)) { L.bad.n++; await store.set("tlk:" + L.id, L); return J(403, { ok: false, field: "pin", error: "Wrong PIN" }); }
    const n = str(b.name, 60), mob = str(b.mobile, 15).replace(/\D/g, "").slice(-10);
    if (L.ask && (n.length < 2 || !/^[6-9]\d{9}$/.test(mob))) return J(400, { ok: false, error: "Enter your name and 10-digit mobile number" });
    if ((L.devices || []).length >= L.max) return J(403, { ok: false, error: "This link has been opened on the most devices allowed. Ask the sender." });
    const uname = "lnk_" + L.id, k = "lnkuser:" + uname;
    const u = (await store.get(k)) || { username: uname, app: L.view === "ho" ? "admin" : "state", state: L.state, fullName: L.label, linkOnly: L.id, vchatId: "LINK", createdAt: t, sessions: [] };
    u.app = L.view === "ho" ? "admin" : "state"; u.state = L.state;
    const token = randomBytes(32).toString("hex"); u.sessions = [{ h: sha(token), at: t }].concat(u.sessions || []).slice(0, 500);
    await store.set(k, u);
    L.devices = (L.devices || []).concat([{ n: n || "—", m: mob, at: t }]).slice(-500); L.opens = (L.opens || 0) + 1;
    await store.set("tlk:" + L.id, L);
    return J(200, { ok: true, app: u.app, username: uname, token, page: P[0], pages: P, tools, demo: !!L.demo, tool: toolNames(L), label: L.label });
  }
  return J(400, { ok: false, error: "Unknown action" });
}
