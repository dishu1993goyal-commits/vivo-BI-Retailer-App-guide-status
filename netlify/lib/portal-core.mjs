// Partner portals: HO lists partner websites (EMI, upgrade, V-Shield …) with an icon; users open them inside the app.
// Sign-in options per portal:  "remember" — the site's own cookies keep the user signed in;
//   "autofill" — the user saves their partner login on their own phone (encrypted there; never sent here);
//   "api" — the partner gives vivo a single-sign-on API: this server asks it for a one-time login link for the user.
// Storage:  config:portals { items:[…] }   config:portalkeys { <id>: secret }   ptid:<app>:<key> { <portalId>: partnerUserId }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const HOST = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const okUrl = (u) => /^https:\/\/[^\s"'<>]+$/i.test(String(u || "")) && String(u).length < 600;
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ""; } };

export function cleanPortal(x) {
  x = x && typeof x === "object" ? x : {};
  const id = str(x.id, 30).replace(/[^A-Za-z0-9_-]/g, "") || Math.random().toString(36).slice(2, 10);
  const url = okUrl(x.url) ? str(x.url, 600) : "";
  const S = x.sso && typeof x.sso === "object" ? x.sso : {};
  const F = x.fill && typeof x.fill === "object" ? x.fill : {};
  return {
    id, name: str(x.name, 40) || "Partner", url, home: okUrl(x.home) ? str(x.home, 600) : "", icon: /^(https:\/\/|\/api\/auth\?img=)[^\s"'<>]{4,500}$/.test(String(x.icon || "")) ? str(x.icon, 500) : "", emoji: str(x.emoji, 8),
    cat: str(x.cat, 30) || "Partners", desc: str(x.desc, 120), color: /^#[0-9a-f]{6}$/i.test(x.color || "") ? x.color : "",
    hosts: (Array.isArray(x.hosts) ? x.hosts : String(x.hosts || "").split(/[\s,;]+/)).map((h) => str(h, 80).toLowerCase()).filter((h) => HOST.test(h)).slice(0, 10),
    who: ["all", "state", "admin"].includes(x.who) ? x.who : "all", states: (Array.isArray(x.states) ? x.states : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 60),
    mode: ["remember", "autofill", "api"].includes(x.mode) ? x.mode : "remember", desktop: !!x.desktop, on: x.on !== false,
    fill: { us: str(F.us, 120), ps: str(F.ps, 120), ss: str(F.ss, 120), auto: F.auto !== false, two: !!F.two, idLabel: str(F.idLabel, 40) },
    sso: { method: S.method === "GET" ? "GET" : "POST", url: okUrl(S.url) ? str(S.url, 600) : "", headers: str(S.headers, 1500), body: str(S.body, 2000), path: str(S.path, 120) || "url", idLabel: str(S.idLabel, 40) }
  };
}
const fillIn = (tpl, v) => String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (v[k] == null ? "" : String(v[k])));
const jsonFill = (tpl, v) => String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => JSON.stringify(v[k] == null ? "" : String(v[k])).slice(1, -1));
const dig = (o, p) => String(p || "").split(".").reduce((a, k) => (a == null ? a : a[k]), o);

export async function portalAction(b, ctx) {
  const { store, t, app, rec, key } = ctx, isAdmin = app === "admin";
  const cfg = async () => ((await store.get("config:portals")) || { items: [] });
  const visible = (p) => p.on && p.url && (isAdmin || (p.who !== "admin" && (!p.states.length || p.states.includes(rec.state || ""))));
  const pub = (p) => { const o = Object.assign({}, p); delete o.sso; o.sso = p.mode === "api" ? { idLabel: p.sso.idLabel } : undefined; return o; };
  const idK = `ptid:${app}:${key}`;

  if (b.action === "pt-list") {
    const c = await cfg(), ids = (await store.get(idK)) || {}, keys = isAdmin ? (await store.get("config:portalkeys")) || {} : {};
    const items = isAdmin && b.all ? c.items.map((p) => Object.assign({}, p, { hasKey: !!keys[p.id] })) : c.items.filter(visible).map(pub);
    return json(200, { ok: true, items, myIds: ids, by: c.by || "", at: c.at || 0 });
  }
  if (b.action === "pt-myid") {   // the user's own ID at a partner (not a password) — used for SSO links
    const ids = (await store.get(idK)) || {}, pid = str(b.id, 30);
    if (!pid) return json(400, { ok: false, error: "Choose a partner." });
    if (b.value) ids[pid] = str(b.value, 80); else delete ids[pid];
    await store.set(idK, ids); return json(200, { ok: true, myIds: ids });
  }
  if (b.action === "pt-sso") {   // one-time login link from the partner's SSO API
    const c = await cfg(), p = c.items.find((x) => x.id === b.id);
    if (!p || !visible(p)) return json(404, { ok: false, error: "Partner not found." });
    if (p.mode !== "api" || !p.sso.url) return json(400, { ok: false, error: "This partner has no sign-in API set up." });
    const secret = ((await store.get("config:portalkeys")) || {})[p.id] || "", ids = (await store.get(idK)) || {};
    const v = { username: rec.username, vchatId: rec.vchatId || "", email: rec.email || "", phone: rec.phone || rec.mobile || "", state: rec.state || "", name: rec.fullName || rec.username, partnerId: ids[p.id] || "", key: secret, ts: String(t) };
    if (/\{\{\s*partnerId\s*\}\}/.test(p.sso.url + p.sso.body + p.sso.headers) && !v.partnerId) return json(400, { ok: false, error: "Add your " + (p.sso.idLabel || "partner ID") + " first (⋮ on the tile).", needId: true });
    let headers = { "content-type": "application/json", accept: "application/json" };
    try { if (p.sso.headers) headers = Object.assign(headers, JSON.parse(jsonFill(p.sso.headers, v))); } catch (e) { return json(500, { ok: false, error: "The partner's header settings aren't valid JSON." }); }
    const url = fillIn(p.sso.url, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encodeURIComponent(x)])));
    try {
      const r = await (ctx.aiFetch || fetch)(url, { method: p.sso.method, headers, body: p.sso.method === "POST" ? jsonFill(p.sso.body || "{}", v) : undefined, redirect: "manual" });
      let link = r.headers.get("location") || "";
      if (!link) { const d = await r.json().catch(() => ({})); if (!r.ok) return json(502, { ok: false, error: "Partner sign-in failed (" + r.status + ")" + (d.message ? ": " + String(d.message).slice(0, 120) : "") }); link = String(dig(d, p.sso.path) || ""); }
      const h = hostOf(link), allowed = [hostOf(p.url)].concat(p.hosts.map((x) => x.replace(/^\*\./, "")));
      if (!/^https:\/\//i.test(link) || !allowed.some((a) => h === a || h.endsWith("." + a))) return json(502, { ok: false, error: "The partner didn't return a valid login link." });
      await ctx.logEvent(store, t, app, rec, "portal-sso", { device: p.name.slice(0, 40), ver: "" });
      return json(200, { ok: true, url: link });
    } catch (e) { return json(502, { ok: false, error: "Couldn't reach the partner: " + String(e.message || e).slice(0, 100) }); }
  }
  if (!isAdmin) return json(403, { ok: false, error: "Only HO admins can change partner portals." });
  if (b.action === "pt-save") {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 80).map(cleanPortal).filter((p) => p.url);
    const seen = {}; items.forEach((p) => { while (seen[p.id]) p.id += "x"; seen[p.id] = 1; });
    await store.set("config:portals", { items, by: rec.fullName || rec.username, at: t });
    return json(200, { ok: true, items });
  }
  if (b.action === "pt-key") {   // the partner's SSO secret: write-only
    const keys = (await store.get("config:portalkeys")) || {}, pid = str(b.id, 30);
    if (!pid) return json(400, { ok: false, error: "Choose a partner." });
    if (b.secret) keys[pid] = str(b.secret, 2000); else delete keys[pid];
    await store.set("config:portalkeys", keys); return json(200, { ok: true, hasKey: !!keys[pid] });
  }
  return json(400, { ok: false, error: "Unknown action." });
}
