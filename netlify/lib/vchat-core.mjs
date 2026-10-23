// vChat directory: the admin-imported list of allowed state users (vChat ID, state, name, vChat mobile).
// State users sign up and log in with their vChat ID; one account per vChat ID.
// Storage:
//   vchatdir            { rows: { <idKey>: { vchatId, state, name, mobile } }, importedAt, importedBy }
//   vchat:<idKey>       { key }   → the state account registered with this vChat ID
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

export const vKey = (id) => String(id || "").trim().toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9._@-]/g, "").slice(0, 40);
// Access code = first 4 letters of the vChat name (small letters) + last 4 digits of the vChat mobile.
export const accessCodeFor = (name, mobile) => String(name || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 4) + String(mobile || "").replace(/\D/g, "").slice(-4);

export async function directory(store) { return (await store.get("vchatdir")) || { rows: {} }; }

// Checks a state user's vChat details. Returns { row } or { error, field }.
export async function checkVchat(store, normalizePhone, { vchatId, phone, accessCode }, opts = {}) {
  const k = vKey(vchatId);
  if (!k) return { error: "Enter your vChat ID.", field: "vchatId" };
  const row = (await directory(store)).rows[k];
  if (!row) return { error: "This vChat ID doesn't exist in the allowed list. Check it, or ask your BI admin.", field: "vchatId" };
  const taken = await store.get(`vchat:${k}`);
  if (taken && taken.key !== opts.ownKey) return { error: "An account is already registered with this vChat ID. Log in, or use Forgot password.", field: "vchatId", taken: true };
  if (opts.lookupOnly) return { row, key: k };
  const ph = normalizePhone(phone);
  if (!ph) return { error: "Enter your 10-digit vChat registered mobile number.", field: "phone" };
  if (ph !== normalizePhone(row.mobile)) return { error: "This mobile number doesn't match the one registered with this vChat ID.", field: "phone" };
  if (String(accessCode || "").trim().toLowerCase() !== accessCodeFor(row.name, row.mobile)) return { error: "Wrong access code. Tap ⓘ to see how to make it.", field: "accessCode" };
  return { row, key: k, phone: ph };
}

export async function vchatAdminAction(b, ctx) {
  const { store, t, app, rec, pool, normalizePhone, logEvent } = ctx;
  if (app !== "admin") return json(403, { ok: false, error: "Only BI admins can manage the vChat directory." });
  const dir = await directory(store);

  if (b.action === "vdir-get") {
    const ks = await store.list("vchat:");
    const links = {};
    await pool(ks, 40, async (k) => {
      const v = await store.get(k);
      if (!v) return;
      const u = await store.get(`user:state:${v.key}`);
      if (u) links[k.slice(6)] = { username: u.username, fullName: u.fullName, createdAt: u.createdAt || 0, lastSeen: u.lastSeen || 0, disabled: !!u.disabled };
    });
    const rows = Object.keys(dir.rows).map((k) => Object.assign({}, dir.rows[k], { reg: links[k] || null }))
      .sort((x, y) => String(x.state).localeCompare(String(y.state)) || String(x.name).localeCompare(String(y.name)));
    // State accounts not linked to any vChat ID yet (made before this rule).
    const uks = await store.list("user:state:");
    const unlinked = (await pool(uks, 40, (k) => store.get(k))).filter((u) => u && !u.vchatId)
      .map((u) => ({ username: u.username, fullName: u.fullName, phone: u.phone, state: u.state || "", createdAt: u.createdAt || 0, disabled: !!u.disabled }));
    return json(200, { ok: true, rows, importedAt: dir.importedAt || 0, importedBy: dir.importedBy || "", unlinked });
  }

  if (b.action === "vdir-import") {
    const inRows = Array.isArray(b.rows) ? b.rows.slice(0, 5000) : [];
    const clean = {}, bad = [];
    inRows.forEach((r, i) => {
      const id = str(r && r.vchatId, 40), k = vKey(id), state = str(r && r.state, 40), name = str(r && r.name, 60), mob = normalizePhone(r && r.mobile);
      if (!k || !state || !name || !mob) { bad.push(i + 2); return; }
      clean[k] = { vchatId: id, state, name, mobile: mob.slice(3) };
    });
    if (!Object.keys(clean).length) return json(400, { ok: false, error: "No valid rows. Each row needs vChat ID, state, name and a 10-digit mobile number." });
    const rows = b.mode === "merge" ? Object.assign({}, dir.rows, clean) : clean;
    await store.set("vchatdir", { rows, importedAt: t, importedBy: rec.username });
    await logEvent(store, t, app, rec, "vchat-imported", { device: Object.keys(clean).length + " rows", ver: "" });
    return json(200, { ok: true, imported: Object.keys(clean).length, total: Object.keys(rows).length, skipped: bad.slice(0, 50), skippedCount: bad.length });
  }

  if (b.action === "vdir-upsert") {
    const id = str(b.vchatId, 40), k = vKey(id), state = str(b.state, 40), name = str(b.name, 60), mob = normalizePhone(b.mobile);
    if (!k || !state || !name || !mob) return json(400, { ok: false, error: "Fill vChat ID, state, name and a valid 10-digit mobile." });
    if (b.oldId && vKey(b.oldId) !== k) delete dir.rows[vKey(b.oldId)];
    dir.rows[k] = { vchatId: id, state, name, mobile: mob.slice(3) };
    dir.importedAt = dir.importedAt || t; await store.set("vchatdir", dir);
    return json(200, { ok: true });
  }

  if (b.action === "vdir-delete") {
    const k = vKey(b.vchatId);
    if (!dir.rows[k]) return json(404, { ok: false, error: "Not in the list." });
    delete dir.rows[k]; await store.set("vchatdir", dir);
    return json(200, { ok: true });
  }

  // Frees a vChat ID so it can be registered again (e.g. the wrong person took it). The account is disabled.
  if (b.action === "vdir-unlink") {
    const k = vKey(b.vchatId), v = await store.get(`vchat:${k}`);
    if (!v) return json(404, { ok: false, error: "No account uses this vChat ID." });
    const u = await store.get(`user:state:${v.key}`);
    if (u) {
      delete u.vchatId; u.disabled = true; u.sessions = []; u.disabledAt = t; u.disabledBy = rec.username; u.disabledReason = "vChat ID released by admin";
      await store.set(`user:state:${v.key}`, u);
      await logEvent(store, t, "state", u, "disabled", { device: "by " + rec.username, ver: "" });
    }
    await store.delete(`vchat:${k}`);
    return json(200, { ok: true });
  }

  return json(400, { ok: false, error: "Unknown action" });
}
