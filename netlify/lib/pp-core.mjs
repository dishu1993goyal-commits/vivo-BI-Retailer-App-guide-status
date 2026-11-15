// vivo portal · product permissions (HO). The clicking happens on the HO user's own device (app or browser bookmark);
// the server only remembers the role list read from the portal, the last job typed and a history of runs.
//   pp:cfg          { roles[], lastRoles[], lastModels[], exact }
//   pp:run:<id>     { id, at, by, dry, state, roles[], models[], res[], log[] }
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
      .map((r) => ({ id: r.id, at: r.at, by: r.by, dry: r.dry, state: r.state, roles: r.roles.length, models: r.models.length, ticked: r.res.reduce((a, x) => a + x.ticked, 0), failed: r.res.reduce((a, x) => a + x.failed, 0) }));
    return J(200, { ok: true, cfg: { roles: cfg.roles || [], lastRoles: cfg.lastRoles || [], lastModels: cfg.lastModels || [], exact: !!cfg.exact }, runs });
  }
  if (b.action === "pp-draft") {   // remember what was typed, so the next launch starts from it
    const cfg = (await store.get("pp:cfg")) || {};
    cfg.lastRoles = list(b.roles, 80, 60); cfg.lastModels = list(b.models, 200, 60); cfg.exact = !!b.exact;
    await store.set("pp:cfg", cfg); return J(200, { ok: true });
  }
  if (b.action === "pp-log") {
    const id = str(b.id, 24); if (!/^[A-Za-z0-9_-]{4,24}$/.test(id)) return J(400, { ok: false, error: "Bad run id" });
    const s = b.status || {}, old = await store.get("pp:run:" + id);
    const run = {
      id, at: old ? old.at : t, by: old ? old.by : rec.fullName || rec.username || "", dry: !!(s.dry || b.dry), state: ["done", "stopped", "err"].includes(s.s) ? s.s : "stopped", msg: str(s.msg, 300),
      roles: list(b.roles, 80, 60), models: list(b.models, 200, 60),
      res: (Array.isArray(s.res) ? s.res : []).slice(0, 4000).map((x) => ({ role: str(x.role, 60), model: str(x.model, 60), found: num(x.found), ticked: num(x.ticked), already: num(x.already), failed: num(x.failed), states: num(x.states), note: str(x.note, 240), names: list(x.names, 120, 60) })),
      log: (Array.isArray(s.log) ? s.log : []).slice(-250).map((x) => str(x, 240))
    };
    if (!run.roles.length) run.roles = [...new Set(run.res.map((x) => x.role))]; if (!run.models.length) run.models = [...new Set(run.res.map((x) => x.model))];
    await store.set("pp:run:" + id, run);
    const pr = list(s.roles, 200, 60);
    if (pr.length) { const cfg = (await store.get("pp:cfg")) || {}; cfg.roles = pr; await store.set("pp:cfg", cfg); }
    return J(200, { ok: true, run });
  }
  if (b.action === "pp-run") { const r = await store.get("pp:run:" + str(b.id, 24)); return r ? J(200, { ok: true, run: r }) : J(404, { ok: false, error: "Run not found" }); }
  if (b.action === "pp-del") { await store.delete("pp:run:" + str(b.id, 24)); return J(200, { ok: true }); }
  return J(400, { ok: false, error: "Unknown action" });
}
