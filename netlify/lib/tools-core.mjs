// Smart tools inside the dashboard file (voice notes, photo audit, beat planner, custom KPIs, idea box).
// The dashboard keeps each tool's data in localStorage ("bi_tl_<ns>"); tools-sync.js mirrors it here so it follows the
// user to every device (web + both apps), state teams share a beat list / visited map, HO sees every note and audit,
// and the idea box becomes one live board for all states.
// Storage:
//   tl:<ns>:<ownerKey>:<id>   { id, ns, owner, by:{fullName,username,app}, state, item, updatedAt, shared }   ns = notes | audits | kpis
//   tlmap:beatv:<scope>       { map: { RETAILERID: "yyyy-mm-dd" } }     scope = state name or "ALL"
//   tlbeat:<scope>            { value, by, at }                         uploaded vWork / visit list for the beat planner
//   tlpref:<ownerKey>         { prefs: { key: value } }
//   idea:<id>                 { id, title, category, problem, idea, benefit, state, by, at, status, voters:[], base }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const cid = (v) => String(v || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "x";
const LISTS = { notes: { max: 400, size: 60000 }, audits: { max: 80, size: 260000 }, kpis: { max: 60, size: 20000 } };
const PREF_KEYS = ["vlang", "beatw", "sostgt", "vq", "me"];
const ISTAT = ["New", "Under review", "Approved", "Implemented", "Not now"];
const ICATS = ["Process", "Reports & data", "Retailer app", "Incentive & payout", "Market hygiene", "Affordability", "Training", "Other"];
const istDay = (t) => new Date(t + 19800000).toISOString().slice(0, 10);
const ymOf = (t) => new Date(t + 19800000).toISOString().slice(0, 7).replace("-", "");
export const TOOL_IDS = ["tl", "tlv", "tlp", "tlb", "tlr", "tli", "tlk", "tls", "tld"];
//   tluse:<yyyymmdd>:<ownerKey>  { by, state, app, tools: { tlv: { opens, acts, saves, last } } }   usage per user per day

export async function toolsAction(b, ctx) {
  const { store, t, app, rec, key, pool } = ctx;
  const isAdmin = app === "admin";
  const owner = app + ":" + key;
  const by = { fullName: rec.fullName || rec.username, username: rec.username || "", app };
  const myState = rec.state || "";
  const scope = isAdmin ? "ALL" : myState || "NONE";
  // usage counter (one small record per user per day)
  async function logUse(tool, kind, n) {
    if (!TOOL_IDS.includes(tool)) return;
    const k = `tluse:${istDay(t).replace(/-/g, "")}:${owner}`, u = (await store.get(k)) || { by, state: myState || (isAdmin ? "HO" : ""), app, tools: {} };
    const x = u.tools[tool] || (u.tools[tool] = { opens: 0, acts: 0, saves: 0, last: 0 });
    x[kind] = (x[kind] || 0) + (n || 1); x.last = t; u.by = by; u.state = myState || (isAdmin ? "HO" : "");
    await store.set(k, u);
  }
  const listNs = async (ns, prefix) => (await pool(await store.list(`tl:${ns}:${prefix || ""}`), 40, (k) => store.get(k))).filter(Boolean);

  // Market visits (punch-ins) mark retailers as visited for the beat planner
  async function visitDays(sc) {
    const out = {};
    for (let i = 0; i < 4; i++) {
      const d = new Date(t + 19800000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
      const ym = d.toISOString().slice(0, 7).replace("-", "");
      const ks = await store.list(`visit:${ym}:`);
      const vs = (await pool(ks, 40, (k) => store.get(k))).filter(Boolean);
      for (const v of vs) {
        const rid = String((v.store && v.store.retailerId) || "").trim().toUpperCase().replace(/\s+/g, ""); if (!rid) continue;
        if (sc !== "ALL" && v.state !== sc) continue;
        const day = istDay(v.in && v.in.t ? v.in.t : v.createdAt || t);
        if (!out[rid] || out[rid] < day) out[rid] = day;
      }
    }
    return out;
  }

  if (b.action === "tl-pull") {
    const own = async (ns) => (await listNs(ns, owner + ":")).sort((x, y) => (y.item.at > x.item.at ? 1 : -1)).map((r) => r.item);
    const notes = await own("notes"), audits = await own("audits");
    const kpis = (await listNs("kpis")).filter((r) => r.owner === owner || r.shared).map((r) => Object.assign({}, r.item, r.owner === owner ? {} : { _shared: r.by.fullName }));
    const bv = ((await store.get(`tlmap:beatv:${scope}`)) || {}).map || {};
    const vd = await visitDays(scope);
    for (const k in vd) if (!bv[k] || bv[k] < vd[k]) bv[k] = vd[k];
    let beat = await store.get(`tlbeat:${scope}`);
    if (!beat && !isAdmin) beat = null;
    const prefs = ((await store.get(`tlpref:${owner}`)) || {}).prefs || {};
    return json(200, { ok: true, notes, audits, kpis, beatv: bv, beat: beat ? beat.value : null, beatBy: beat ? { by: beat.by, at: beat.at } : null, prefs, admin: isAdmin, state: myState, now: t });
  }

  if (b.action === "tl-push") {
    const ns = String(b.ns || "");
    if (LISTS[ns]) {
      const L = LISTS[ns]; let saved = 0; const refused = [];
      for (const it of (Array.isArray(b.upserts) ? b.upserts : []).slice(0, 200)) {
        const id = cid(it && it.id); if (!id) continue;
        const raw = JSON.stringify(it); if (raw.length > L.size) { refused.push(id); continue; }
        const k = `tl:${ns}:${owner}:${id}`;
        const old = await store.get(k);
        await store.set(k, { id, ns, owner, by, state: myState || (isAdmin ? "HO" : ""), item: it, updatedAt: t, createdAt: old ? old.createdAt : t, shared: ns === "kpis" && isAdmin });
        saved++;
      }
      if (saved) await logUse({ notes: "tlv", audits: "tlp", kpis: "tlk" }[ns], "saves", saved);
      for (const id0 of (Array.isArray(b.deletes) ? b.deletes : []).slice(0, 500)) { const id = cid(id0); if (id) await store.delete(`tl:${ns}:${owner}:${id}`); }
      // keep the newest N per user
      const mine = (await store.list(`tl:${ns}:${owner}:`));
      if (mine.length > L.max) {
        const rows = (await pool(mine, 40, (k) => store.get(k))).filter(Boolean).sort((x, y) => (y.item.at > x.item.at ? 1 : -1));
        for (const r of rows.slice(L.max)) await store.delete(`tl:${ns}:${owner}:${r.id}`);
      }
      return json(200, { ok: true, saved, refused });
    }
    if (ns === "beatv") {
      const k = `tlmap:beatv:${scope}`, cur = (await store.get(k)) || { map: {} };
      Object.entries(b.map || {}).slice(0, 20000).forEach(([rid, d]) => { const r = str(rid, 40).toUpperCase(), day = str(d, 10); if (r && /^\d{4}-\d\d-\d\d$/.test(day) && (!cur.map[r] || cur.map[r] < day)) cur.map[r] = day; });
      await store.set(k, cur);
      return json(200, { ok: true });
    }
    if (ns === "beat") {
      if (b.value == null) { await store.delete(`tlbeat:${scope}`); return json(200, { ok: true }); }
      const raw = JSON.stringify(b.value); if (raw.length > 4500000) return json(413, { ok: false, error: "The list is too large to share." });
      await store.set(`tlbeat:${scope}`, { value: b.value, by: by.fullName, byUser: by, at: t });
      await logUse("tlb", "saves");
      return json(200, { ok: true });
    }
    if (ns === "prefs") {
      const k = `tlpref:${owner}`, cur = (await store.get(k)) || { prefs: {} };
      Object.entries(b.value || {}).forEach(([pk, v]) => { if (PREF_KEYS.includes(pk) && JSON.stringify(v).length < 20000) cur.prefs[pk] = v; });
      await store.set(k, cur);
      return json(200, { ok: true });
    }
    return json(400, { ok: false, error: "Unknown data." });
  }

  // opened a tool / used it (upload, export, share) — sent by tools-sync.js
  if (b.action === "tl-use") { await logUse(String(b.tool || ""), b.kind === "acts" ? "acts" : "opens"); return json(200, { ok: true }); }

  // ---- HO / master: who uses the smart tools, every state's KPIs and beat plans ----
  if (b.action === "tl-activity") {
    if (!isAdmin) return json(403, { ok: false, error: "Admins only." });
    const days = Math.max(1, Math.min(120, Number(b.days) || 30)), rows = [];
    for (let i = 0; i < days; i++) {
      const d = istDay(t - i * 864e5).replace(/-/g, "");
      const recs = (await pool(await store.list(`tluse:${d}:`), 40, (k) => store.get(k))).filter(Boolean);
      recs.forEach((u) => Object.entries(u.tools || {}).forEach(([tool, x]) => rows.push({ day: d, by: u.by, state: u.state, app: u.app, tool, opens: x.opens || 0, acts: x.acts || 0, saves: x.saves || 0, last: x.last || 0 })));
    }
    return json(200, { ok: true, rows, days });
  }
  if (b.action === "tl-kpis-all") {
    if (!isAdmin) return json(403, { ok: false, error: "Admins only." });
    const rows = (await listNs("kpis")).map((r) => ({ by: r.by, state: r.state, shared: !!r.shared, updatedAt: r.updatedAt, item: r.item })).sort((x, y) => y.updatedAt - x.updatedAt);
    return json(200, { ok: true, rows });
  }
  if (b.action === "tl-beats") {   // one row per state that uploaded a list or has visited marks
    if (!isAdmin) return json(403, { ok: false, error: "Admins only." });
    const scopes = new Set();
    (await store.list("tlbeat:")).forEach((k) => scopes.add(k.slice(7)));
    (await store.list("tlmap:beatv:")).forEach((k) => scopes.add(k.slice(12)));
    const d7 = istDay(t - 7 * 864e5), d30 = istDay(t - 30 * 864e5), out = [];
    for (const sc of scopes) {
      const bt = await store.get(`tlbeat:${sc}`), bv = Object.assign({}, ((await store.get(`tlmap:beatv:${sc}`)) || {}).map || {});
      const vd = await visitDays(sc); for (const k in vd) if (!bv[k] || bv[k] < vd[k]) bv[k] = vd[k];
      const ids = bt && bt.value && bt.value.rows ? Object.keys(bt.value.rows) : [];
      const inList = (k) => !ids.length || ids.includes(k);
      const vals = Object.entries(bv).filter(([k]) => inList(k)).map(([, v]) => v);
      out.push({ scope: sc, list: bt ? { name: bt.value.name || "", n: bt.value.n || ids.length, at: bt.at, by: bt.by, towns: ids.length ? new Set(ids.map((k) => bt.value.rows[k].town || "")).size : 0, geo: !!(bt.value.cols && bt.value.cols.geo) } : null,
        visited: vals.length, v7: vals.filter((v) => v >= d7).length, v30: vals.filter((v) => v >= d30).length });
    }
    return json(200, { ok: true, rows: out.sort((x, y) => String(x.scope).localeCompare(String(y.scope))) });
  }
  if (b.action === "tl-beat-get") {
    if (!isAdmin) return json(403, { ok: false, error: "Admins only." });
    const sc = str(b.scope, 60), bt = await store.get(`tlbeat:${sc}`), bv = Object.assign({}, ((await store.get(`tlmap:beatv:${sc}`)) || {}).map || {});
    const vd = await visitDays(sc); for (const k in vd) if (!bv[k] || bv[k] < vd[k]) bv[k] = vd[k];
    return json(200, { ok: true, list: bt ? bt.value : null, by: bt ? bt.by : "", at: bt ? bt.at : 0, visited: bv });
  }

  // Team view: HO sees every state; a state user sees their own state's team
  if (b.action === "tl-team") {
    const ns = b.ns === "audits" ? "audits" : "notes";
    let rows = await listNs(ns);
    if (!isAdmin) rows = rows.filter((r) => r.state && r.state === myState);
    else if (b.state) rows = rows.filter((r) => r.state === str(b.state, 40));
    if (b.from) rows = rows.filter((r) => String(r.item.at || "") >= str(b.from, 10));
    rows.sort((x, y) => (y.item.at > x.item.at ? 1 : -1));
    const out = rows.slice(0, 2000).map((r) => { const it = Object.assign({}, r.item); if (ns === "audits" && !b.thumbs) delete it.thumb; return { by: r.by, state: r.state, item: it, mine: r.owner === owner }; });
    return json(200, { ok: true, rows: out, total: rows.length });
  }
  if (b.action === "tl-thumb") {
    const r = (await listNs("audits")).find((x) => x.id === cid(b.id));
    if (!r || (!isAdmin && r.state !== myState && r.owner !== owner)) return json(404, { ok: false, error: "Not found." });
    return json(200, { ok: true, thumb: r.item.thumb || "" });
  }

  // Idea box: same protocol as the optional Google-Sheet board in the dashboard file (list / add / vote / status)
  if (b.action === "tl-ideas") {
    const all = async () => (await pool(await store.list("idea:"), 40, (k) => store.get(k))).filter(Boolean);
    const out = (rows) => ({ ok: true, ideas: rows.sort((x, y) => (y.at > x.at ? 1 : -1)).map((x) => ({ id: x.id, title: x.title, category: x.category, problem: x.problem, idea: x.idea, benefit: x.benefit, state: x.state, by: x.by, at: x.at, status: x.status, votes: (x.base || 0) + (x.voters || []).length, mine: (x.voters || []).includes(owner) })) });
    const op = String(b.op || "list");
    if (op === "add") {
      const x = b.idea || {};
      const title = str(x.t || x.title, 140), idea = str(x.s || x.idea, 2000);
      if (!title || !idea) return json(400, { ok: false, error: "Add a title and your idea." });
      const id = cid(x.id) || t.toString(36) + randomBytes(3).toString("hex");
      if (await store.get(`idea:${id}`)) return json(200, out(await all()));
      await logUse("tld", "saves");
      await store.set(`idea:${id}`, { id, title, idea, category: ICATS.includes(x.c || x.category) ? x.c || x.category : "Other", problem: str(x.p || x.problem, 2000), benefit: str(x.b || x.benefit, 1000),
        state: isAdmin ? str(x.st || x.state, 40) || "HO" : myState, by: str(x.by, 60) || by.fullName, byUser: owner, at: new Date(t).toISOString(), status: "New", voters: [], base: 0 });
      return json(200, out(await all()));
    }
    if (op === "vote") {
      const k = `idea:${cid(b.id)}`, x = await store.get(k);
      if (!x) return json(404, { ok: false, error: "Idea not found." });
      x.voters = (x.voters || []).filter((v) => v !== owner); if (b.up !== false) x.voters.push(owner);
      await logUse("tld", "acts");
      await store.set(k, x);
      return json(200, out(await all()));
    }
    if (op === "status") {
      if (!isAdmin) return json(403, { ok: false, error: "Only HO admins can change the status." });
      const k = `idea:${cid(b.id)}`, x = await store.get(k);
      if (!x) return json(404, { ok: false, error: "Idea not found." });
      if (ISTAT.includes(b.status)) x.status = b.status;
      await store.set(k, x);
      return json(200, out(await all()));
    }
    if (op === "delete") {
      const k = `idea:${cid(b.id)}`, x = await store.get(k);
      if (!x || (!isAdmin && x.byUser !== owner)) return json(403, { ok: false, error: "Not allowed." });
      await store.delete(k);
      return json(200, out(await all()));
    }
    return json(200, out(await all()));
  }
  return json(400, { ok: false, error: "Unknown action" });
}
