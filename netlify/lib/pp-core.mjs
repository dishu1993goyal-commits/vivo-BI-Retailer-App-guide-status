// vivo portal · product permissions (HO). The clicking happens on the HO user's own device (app or browser bookmark);
// the server only remembers the role list read from the portal, the last job typed and a history of runs.
//   pp:cfg          { roles[], lastRoles[], lastModels[], exact }
//   pp:run:<id>     { id, at, by, dry, read, state, roles[], models[], res[], log[] }
//   pp:perm:<role>  latest READ of one role: { role, at, by, run, filter[], total, cols[], rows[][] }  (rows = products already ticked)
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const list = (a, n, len) => [...new Set((Array.isArray(a) ? a : []).map((x) => str(x, len)).filter(Boolean))].slice(0, n);
const num = (v) => Math.max(0, Math.min(99999, Math.round(+v || 0)));

export async function ppAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx;
  if (app !== "admin") return J(403, { ok: false, error: "Only HO can use this tool" });
  if (b.action === "pp-get") {
    const cfg = (await store.get("pp:cfg")) || {};
    const runs = (await pool(await store.list("pp:run:"), 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 40)
      .map((r) => ({ id: r.id, at: r.at, by: r.by, dry: r.dry, read: !!r.read, state: r.state, roles: r.roles.length, models: r.models.length, ticked: r.res.reduce((a, x) => a + x.ticked, 0), listed: r.read ? r.res.reduce((a, x) => a + x.already, 0) : 0, failed: r.res.reduce((a, x) => a + x.failed, 0) }));
    return J(200, { ok: true, cfg: { roles: cfg.roles || [], lastRoles: cfg.lastRoles || [], lastModels: cfg.lastModels || [], exact: !!cfg.exact }, runs });
  }
  if (b.action === "pp-draft") {   // remember what was typed, so the next launch starts from it
    const cfg = (await store.get("pp:cfg")) || {};
    cfg.lastRoles = list(b.roles, 80, 60); cfg.lastModels = list(b.models, 200, 60); cfg.exact = !!b.exact;
    await store.set("pp:cfg", cfg); return J(200, { ok: true });
  }
  if (b.action === "pp-log") {
    const id = str(b.id, 24); if (!/^[A-Za-z0-9_-]{4,24}$/.test(id)) return J(400, { ok: false, error: "Bad run id" });
    const s = b.status || {}, old = await store.get("pp:run:" + id), READ = !!(s.read || b.read);
    const run = {
      id, at: old ? old.at : t, by: old ? old.by : rec.fullName || rec.username || "", dry: !!(s.dry || b.dry), read: READ, state: ["done", "stopped", "err"].includes(s.s) ? s.s : "stopped", msg: str(s.msg, 300),
      roles: list(b.roles, 80, 60), models: list(b.models, 200, 60),
      res: (Array.isArray(s.res) ? s.res : []).slice(0, 4000).map((x) => ({ role: str(x.role, 60), model: str(x.model, 60), found: num(x.found), ticked: num(x.ticked), already: num(x.already), failed: num(x.failed), states: num(x.states), note: str(x.note, 240), names: list(x.names, READ ? 5000 : 120, 80),
        cols: READ ? (Array.isArray(x.cols) ? x.cols : []).slice(0, 10).map((v) => str(v, 40)) : undefined,
        rows: READ ? (Array.isArray(x.rows) ? x.rows : []).slice(0, 5000).map((r) => (Array.isArray(r) ? r : []).slice(0, 10).map((v) => str(v, 80))) : undefined })),
      log: (Array.isArray(s.log) ? s.log : []).slice(-250).map((x) => str(x, 240))
    };
    if (!run.roles.length) run.roles = [...new Set(run.res.map((x) => x.role))]; if (!run.models.length) run.models = [...new Set(run.res.map((x) => x.model))];
    await store.set("pp:run:" + id, run);
    if (READ && run.state === "done") {   // keep the latest list per role (only roles read without a problem)
      const by = {};
      run.res.forEach((x) => { (by[x.role] = by[x.role] || []).push(x); });
      for (const role of Object.keys(by)) {
        const L = by[role]; if (L.some((x) => x.failed)) continue;
        const seen = new Set(), rows = [];
        L.forEach((x) => x.rows.forEach((r) => { const k = r.join("|"); if (!seen.has(k)) { seen.add(k); rows.push(r); } }));
        await store.set("pp:perm:" + role.toLowerCase().slice(0, 60), { role, at: run.at, by: run.by, run: id, filter: run.models.length && !L.every((x) => x.model === "(all products)") ? run.models : [], total: L.reduce((a, x) => a + x.found, 0), cols: (L[0] && L[0].cols) || [], rows });
      }
    }
    const pr = list(s.roles, 200, 60);
    if (pr.length) { const cfg = (await store.get("pp:cfg")) || {}; cfg.roles = pr; await store.set("pp:cfg", cfg); }
    return J(200, { ok: true, run });
  }
  if (b.action === "pp-perms") {   // the latest permission list of every role read so far
    const perms = (await pool(await store.list("pp:perm:"), 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => x.role.localeCompare(y.role));
    return J(200, { ok: true, perms });
  }
  if (b.action === "pp-pdel") { await store.delete("pp:perm:" + str(b.role, 60).toLowerCase()); return J(200, { ok: true }); }
  if (b.action === "pp-run") { const r = await store.get("pp:run:" + str(b.id, 24)); return r ? J(200, { ok: true, run: r }) : J(404, { ok: false, error: "Run not found" }); }
  if (b.action === "pp-del") { await store.delete("pp:run:" + str(b.id, 24)); return J(200, { ok: true }); }
  return J(400, { ok: false, error: "Unknown action" });
}
