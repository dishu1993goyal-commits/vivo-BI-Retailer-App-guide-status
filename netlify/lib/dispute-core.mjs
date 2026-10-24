// Disputes (#6): data/report disputes about the dashboard and HTML report files — raise → assign → resolve,
// with a turnaround-time (TAT) timer per priority.
// Storage:
//   disp:<id>        { id, no, title, category, page, shown, expected, detail, state, priority, status, by, assignee, createdAt, dueAt,
//                      firstResponseAt, resolvedAt, closedAt, breached, atts:[], log:[{t, by, kind, text, atts}], rating }
//   dispseq          { n }
//   config:disputes  { tat: { P1:4, P2:24, P3:72 }, categories:[...] }
//   dispread:<app>:<key>  { <id>: ts }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
export const DISPUTE_CATS = ["Dashboard data mismatch", "HTML / report file issue", "Payout calculation", "Retailer ID mapping", "Ranking / score", "Other"];
export const STATUSES = ["Open", "Assigned", "In progress", "Waiting for state", "Resolved", "Closed"];
export const DEFAULT_TAT = { P1: 4, P2: 24, P3: 72 };
const H = 3600000;

export function tatState(d, t) {
  if (["Resolved", "Closed"].includes(d.status)) { const used = (d.resolvedAt || d.closedAt || t) - d.createdAt; return { done: true, usedH: Math.round(used / H * 10) / 10, met: (d.resolvedAt || d.closedAt) <= d.dueAt }; }
  return { done: false, leftMs: d.dueAt - t, breached: t > d.dueAt };
}

export async function disputeAction(b, ctx) {
  const { store, t, app, rec, key, pool, who, sameUser } = ctx;
  const isAdmin = app === "admin", me = who(app, rec);
  const cfg = Object.assign({ tat: DEFAULT_TAT }, (await store.get("config:disputes")) || {});
  const canSee = (d) => isAdmin || d.state === (rec.state || "") || sameUser(d.by, me);
  const readK = `dispread:${app}:${key}`;
  const out = (d, reads) => Object.assign({}, d, { tat: tatState(d, t), unread: !!(reads && d.updatedAt > (reads[d.id] || 0) && !(d.log.length && sameUser(d.log[d.log.length - 1].by, me))) });
  const get = async (id) => store.get(`disp:${String(id || "").replace(/[^a-z0-9]/gi, "")}`);
  const attIds = async (ids) => { const o = []; for (const id of (Array.isArray(ids) ? ids : []).slice(0, 5)) { const c = String(id).replace(/[^a-z0-9]/gi, ""); const f = await store.get(`att:${c}`); if (f && sameUser(f.by, me)) o.push({ id: c, name: f.name, mime: f.mime }); } return o; };

  if (b.action === "disp-config") {
    if (b.set) {
      if (!isAdmin) return json(403, { ok: false, error: "Only admins can change TAT." });
      const tat = {}; ["P1", "P2", "P3"].forEach((p) => { const n = Number((b.set.tat || {})[p]); tat[p] = isFinite(n) && n > 0 && n <= 720 ? n : DEFAULT_TAT[p]; });
      await store.set("config:disputes", { tat, by: rec.fullName, at: t });
      return json(200, { ok: true, tat });
    }
    const admins = isAdmin ? (await pool(await store.list("user:admin:"), 40, (k) => store.get(k))).filter((u) => u && !u.disabled).map((u) => ({ username: u.username, fullName: u.fullName })) : [];
    return json(200, { ok: true, tat: cfg.tat, categories: DISPUTE_CATS, statuses: STATUSES, admins });
  }

  if (b.action === "disp-list") {
    const reads = (await store.get(readK)) || {};
    const rows = (await pool(await store.list("disp:"), 40, (k) => store.get(k))).filter((d) => d && canSee(d)).map((d) => out(d, reads)).sort((x, y) => y.updatedAt - x.updatedAt);
    return json(200, { ok: true, disputes: rows.map((d) => Object.assign({}, d, { log: undefined, logCount: d.log.length })), now: t });
  }

  if (b.action === "disp-get") {
    const d = await get(b.id); if (!d || !canSee(d)) return json(404, { ok: false, error: "Not found." });
    const reads = (await store.get(readK)) || {}; reads[d.id] = t; await store.set(readK, reads);
    return json(200, { ok: true, dispute: out(d, null), now: t });
  }

  if (b.action === "disp-create") {
    const title = str(b.title, 120), detail = str(b.detail, 3000);
    if (title.length < 5) return json(400, { ok: false, error: "Give the dispute a short title." });
    if (detail.length < 10) return json(400, { ok: false, error: "Describe the issue (what you see and what you expected)." });
    const pr = ["P1", "P2", "P3"].includes(b.priority) ? b.priority : "P2";
    const seq = ((await store.get("dispseq")) || { n: 0 }).n + 1; await store.set("dispseq", { n: seq });
    const id = t.toString(36) + randomBytes(3).toString("hex");
    const d = { id, no: seq, title, detail, category: DISPUTE_CATS.includes(b.category) ? b.category : "Other", page: str(b.page, 80), shown: str(b.shown, 60), expected: str(b.expected, 60), period: str(b.period, 40),
      state: isAdmin ? str(b.state, 40) || "HO" : rec.state || "", priority: pr, status: "Open", by: me, assignee: null, createdAt: t, updatedAt: t, dueAt: t + cfg.tat[pr] * H, atts: await attIds(b.atts),
      log: [{ t, by: me, kind: "created", text: "Raised (" + pr + ", TAT " + cfg.tat[pr] + " h)" }] };
    await store.set(`disp:${id}`, d);
    await ctx.logEvent(store, t, app, rec, "dispute-raised", { device: "#" + seq + " " + title.slice(0, 40), ver: "" });
    return json(200, { ok: true, dispute: out(d, null) });
  }

  if (b.action === "disp-update") {
    const d = await get(b.id); if (!d || !canSee(d)) return json(404, { ok: false, error: "Not found." });
    const text = str(b.text, 2000), atts = await attIds(b.atts);
    let changed = false;
    if (b.assignee !== undefined) {
      if (!isAdmin) return json(403, { ok: false, error: "Only admins assign disputes." });
      const u = b.assignee ? await store.get(`user:admin:${ctx.userKey(b.assignee)}`) : null;
      d.assignee = u ? { app: "admin", username: u.username, fullName: u.fullName } : null;
      if (d.status === "Open" && d.assignee) d.status = "Assigned";
      d.log.push({ t, by: me, kind: "assign", text: d.assignee ? "Assigned to " + d.assignee.fullName : "Unassigned" }); changed = true;
    }
    if (b.priority && ["P1", "P2", "P3"].includes(b.priority) && b.priority !== d.priority) {
      if (!isAdmin) return json(403, { ok: false, error: "Only admins change priority." });
      d.priority = b.priority; d.dueAt = d.createdAt + cfg.tat[b.priority] * H; d.log.push({ t, by: me, kind: "priority", text: "Priority " + b.priority + " (TAT " + cfg.tat[b.priority] + " h)" }); changed = true;
    }
    if (b.status && STATUSES.includes(b.status) && b.status !== d.status) {
      const reopen = ["Resolved", "Closed"].includes(d.status) && !["Resolved", "Closed"].includes(b.status);
      if (!isAdmin && !(b.status === "Closed" && d.status === "Resolved") && !reopen) return json(403, { ok: false, error: "Only admins change the status (you can close or reopen a resolved dispute)." });
      if (b.status === "Resolved" && !text && !isAdmin) return json(400, { ok: false, error: "Add a resolution note." });
      if (b.status === "Resolved") d.resolvedAt = t;
      if (b.status === "Closed") d.closedAt = t;
      if (reopen) { d.resolvedAt = null; d.closedAt = null; d.reopened = (d.reopened || 0) + 1; }
      d.log.push({ t, by: me, kind: "status", text: (reopen ? "Reopened → " : "Status → ") + b.status }); d.status = b.status; changed = true;
    }
    if (b.rating) { const r = Math.max(1, Math.min(5, Number(b.rating) || 0)); if (r && sameUser(d.by, me)) { d.rating = r; d.log.push({ t, by: me, kind: "rating", text: "Rated " + r + "/5" }); changed = true; } }
    if (text || atts.length) {
      d.log.push({ t, by: me, kind: "comment", text, atts }); changed = true;
      if (isAdmin && !d.firstResponseAt && !sameUser(d.by, me)) d.firstResponseAt = t;
      if (isAdmin && d.status === "Assigned") d.status = "In progress";
    }
    if (!changed) return json(400, { ok: false, error: "Nothing to update." });
    d.breached = d.breached || (d.resolvedAt || t) > d.dueAt;
    d.updatedAt = t;
    d.log = d.log.slice(-200);
    await store.set(`disp:${d.id}`, d);
    return json(200, { ok: true, dispute: out(d, null) });
  }

  if (b.action === "disp-att") {   // attachment of a dispute this user can see
    const d = await get(b.dispute); if (!d || !canSee(d)) return json(404, { ok: false, error: "Not found." });
    const id = String(b.id || "").replace(/[^a-z0-9]/gi, "");
    if (!d.atts.some((a) => a.id === id) && !d.log.some((l) => (l.atts || []).some((a) => a.id === id))) return json(404, { ok: false, error: "Not found." });
    const f = await store.get(`att:${id}`);
    return f ? json(200, { ok: true, name: f.name, mime: f.mime, data: f.data }) : json(404, { ok: false, error: "Not found." });
  }

  if (b.action === "disp-notify") {
    const reads = (await store.get(readK)) || {};
    const rows = (await pool(await store.list("disp:"), 40, (k) => store.get(k))).filter((d) => d && canSee(d));
    const unread = rows.filter((d) => d.updatedAt > (reads[d.id] || 0) && !(d.log.length && sameUser(d.log[d.log.length - 1].by, me))).length;
    const mine = isAdmin ? rows.filter((d) => d.assignee && sameUser(d.assignee, me) && !["Resolved", "Closed"].includes(d.status)).length : 0;
    return json(200, { ok: true, unread, assignedOpen: mine, breached: rows.filter((d) => !["Resolved", "Closed"].includes(d.status) && t > d.dueAt).length });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
