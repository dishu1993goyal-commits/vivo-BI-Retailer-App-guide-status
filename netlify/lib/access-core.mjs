// Access control (master admin): switch any tool, admin setting, dashboard tab, filter or report on/off
// for all state users, all admins, particular states or particular users — by hand or from Excel.
// Storage:
//   config:access   { r: { <featureId>: { st, ad, only:[state], xs:[state], allow:[user], deny:[user] } }, by, at }
//   config:acccat   { tabs:[[id,label]], at }   dashboard tabs found by the dashboard itself (newer files may add tabs)
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const FID = /^(tool|adm|tab|flt|rep):[a-z0-9_-]{1,40}$/;
const low = (x) => String(x || "").trim().toLowerCase();
const uniq = (a) => a.filter((x, i) => x && a.findIndex((y) => low(y) === low(x)) === i);
const list = (v, n = 3000) => uniq((Array.isArray(v) ? v : String(v || "").split(/[\n,;]+/)).map((u) => str(u, 60))).slice(0, n);

export function cleanRule(x) {
  x = x && typeof x === "object" ? x : {};
  return { st: x.st !== false, ad: x.ad !== false, only: list(x.only, 60), xs: list(x.xs, 60), allow: list(x.allow), deny: list(x.deny) };
}
const isDefault = (r) => r.st && r.ad && !r.only.length && !r.xs.length && !r.allow.length && !r.deny.length;

export function allowedFor(rule, app, rec) {
  if (!rule) return true;
  if (app === "admin" && rec.master) return true;
  const ids = [rec.username, rec.vchatId, rec.email].filter(Boolean).map(low), has = (l) => (l || []).some((u) => ids.includes(low(u)));
  if (has(rule.deny)) return false;
  if (has(rule.allow)) return true;
  if (app === "admin") return rule.ad !== false;
  const st = low(rec.state);
  if (rule.st === false) return (rule.only || []).some((s) => low(s) === st);
  return !(rule.xs || []).some((s) => low(s) === st);
}
export async function deniedFor(store, app, rec) {
  const c = (await store.get("config:access")) || { r: {} };
  return { deny: Object.keys(c.r || {}).filter((id) => !allowedFor(c.r[id], app, rec)), at: c.at || 0 };
}

const YES = /^(y|yes|allow|allowed|on|1|true|give|grant|access|enable|enabled|show)$/i, NO = /^(n|no|deny|denied|off|0|false|remove|remove access|block|blocked|disable|disabled|hide|revoke)$/i, RESET = /^(reset|clear|default)$/i;
export function applyRow(c, fid, who, access) {
  const r = c.r[fid] = cleanRule(c.r[fid]), w = str(who, 80), a = String(access == null ? "" : access).trim();
  const yes = YES.test(a), no = NO.test(a), reset = RESET.test(a);
  if (!yes && !no && !reset) return "Access must be Yes or No";
  const wl = low(w).replace(/\s+/g, " ");
  if (/^(all|everyone|all users)$/.test(wl)) { r.st = r.ad = !no; if (reset) { r.st = r.ad = true; } }
  else if (/^(all )?state( users)?$|^all states?$/.test(wl)) { r.st = !no; if (reset) { r.st = true; r.only = []; r.xs = []; } }
  else if (/^(all )?admins?( users)?$/.test(wl)) r.ad = !no;
  else if (/^state\s*[:=-]/.test(wl)) {
    const s = w.replace(/^state\s*[:=-]\s*/i, "").trim(); if (!s) return "State name missing";
    r.xs = r.xs.filter((x) => low(x) !== low(s)); r.only = r.only.filter((x) => low(x) !== low(s));
    if (no) r.xs.push(s); else if (yes && r.st === false) { r.st = true; r.only.push(s); } else if (yes && r.only.length) r.only.push(s);
  } else {
    if (!w) return "User missing";
    r.allow = r.allow.filter((x) => low(x) !== wl); r.deny = r.deny.filter((x) => low(x) !== wl);
    if (yes) r.allow.push(w); else if (no) r.deny.push(w);
  }
  if (isDefault(r)) delete c.r[fid];
  return "";
}

export async function accessAction(b, ctx) {
  const { store, t, app, rec } = ctx;
  const master = app === "admin" && rec.master === true;
  if (b.action === "acc-mine") return json(200, Object.assign({ ok: true, master }, await deniedFor(store, app, rec)));
  if (b.action === "acc-cat") {   // the dashboard reports the tabs it has (admins only)
    if (app !== "admin") return json(200, { ok: true });
    const tabs = (Array.isArray(b.tabs) ? b.tabs : []).slice(0, 60).map((x) => [str(x && x[0], 30).replace(/[^a-z0-9_-]/gi, "").toLowerCase(), str(x && x[1], 50)]).filter((x) => x[0] && x[1]);
    if (tabs.length) await store.set("config:acccat", { tabs, at: t });
    return json(200, { ok: true });
  }
  if (!master) return json(403, { ok: false, error: "Only a master admin can manage access." });
  if (b.action === "acc-get") {
    const c = (await store.get("config:access")) || { r: {} }, cat = (await store.get("config:acccat")) || { tabs: [] };
    return json(200, { ok: true, rules: c.r || {}, by: c.by || "", at: c.at || 0, tabs: cat.tabs || [] });
  }
  if (b.action === "acc-set") {   // replace rules for the features sent (null = back to default)
    const c = (await store.get("config:access")) || { r: {} }; c.r = c.r || {};
    Object.entries(b.rules && typeof b.rules === "object" ? b.rules : {}).slice(0, 600).forEach(([id, r]) => { if (!FID.test(id)) return; if (r === null) { delete c.r[id]; return; } const x = cleanRule(r); if (isDefault(x)) delete c.r[id]; else c.r[id] = x; });
    if (b.replace) Object.keys(c.r).forEach((id) => { if (!(id in (b.rules || {}))) delete c.r[id]; });
    c.by = rec.fullName || rec.username; c.at = t; await store.set("config:access", c);
    return json(200, { ok: true, rules: c.r, at: t });
  }
  if (b.action === "acc-import") {   // rows of { feature, who, access }
    const c = (await store.get("config:access")) || { r: {} }; c.r = c.r || {};
    const names = b.names && typeof b.names === "object" ? b.names : {}, out = { applied: 0, errors: [] };
    (Array.isArray(b.rows) ? b.rows : []).slice(0, 10000).forEach((x, i) => {
      const f = str(x && x.feature, 80), fid = FID.test(f) ? f : names[low(f)];
      if (!fid || !FID.test(fid)) { out.errors.push({ row: x && x.row || i + 2, error: "Unknown feature: " + f }); return; }
      const e = applyRow(c, fid, x.who, x.access);
      if (e) out.errors.push({ row: x.row || i + 2, error: e }); else out.applied++;
    });
    if (b.dry) return json(200, Object.assign({ ok: true, dry: true }, out, { errors: out.errors.slice(0, 100) }));
    c.by = rec.fullName || rec.username; c.at = t; await store.set("config:access", c);
    return json(200, Object.assign({ ok: true, rules: c.r }, out, { errors: out.errors.slice(0, 100) }));
  }
  return json(400, { ok: false, error: "Unknown action." });
}
