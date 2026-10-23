// Knowledge section: built-in articles live in knowledge.html; admins can add their own articles with pictures.
// Storage: kbart:<id> { id, title, category, summary, body, images:[attId], pinned, createdBy, updatedAt }
//          kbread:<app>:<userKey> { <articleId>: readAt }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const cid = (v) => String(v || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
export const KB_CATEGORIES = ["BI reports", "AI for BI", "Dashboards", "Power BI", "KPIs & charts", "SOPs & payout", "Market hygiene", "Other"];

export async function kbAction(b, ctx) {
  const { store, t, app, rec, key, pool, sameUser, who } = ctx;
  const isAdmin = app === "admin";
  const readKey = `kbread:${app}:${key}`;

  if (b.action === "kb-list") {
    const ks = await store.list("kbart:");
    const arts = (await pool(ks, 30, (k) => store.get(k))).filter(Boolean)
      .map((a) => ({ id: a.id, title: a.title, category: a.category, summary: a.summary, pinned: !!a.pinned, updatedAt: a.updatedAt, createdBy: a.createdBy, images: (a.images || []).length }))
      .sort((x, y) => (y.pinned - x.pinned) || y.updatedAt - x.updatedAt);
    return json(200, { ok: true, articles: arts, read: (await store.get(readKey)) || {}, categories: KB_CATEGORIES });
  }
  if (b.action === "kb-read") {
    const id = cid(b.id); if (!id) return json(400, { ok: false, error: "Bad id." });
    const r = (await store.get(readKey)) || {}; r[id] = t; await store.set(readKey, r);
    return json(200, { ok: true });
  }
  if (b.action === "kb-get") {
    const a = await store.get(`kbart:${cid(b.id)}`);
    return a ? json(200, { ok: true, article: a }) : json(404, { ok: false, error: "Article not found." });
  }
  if (b.action === "kb-att") {
    const a = await store.get(`kbart:${cid(b.article)}`), id = String(b.id || "").replace(/[^a-z0-9]/gi, "");
    if (!a || !(a.images || []).includes(id)) return json(403, { ok: false, error: "Not found." });
    const f = await store.get(`att:${id}`);
    return f ? json(200, { ok: true, name: f.name, mime: f.mime, data: f.data }) : json(404, { ok: false, error: "Not found." });
  }
  if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can edit the Knowledge section." });
  if (b.action === "kb-save") {
    const a0 = b.article || {};
    const old = a0.id ? await store.get(`kbart:${cid(a0.id)}`) : null;
    const title = str(a0.title, 140);
    if (title.length < 3) return json(400, { ok: false, error: "Give the article a title." });
    const body = str(a0.body, 30000);
    if (body.length < 10) return json(400, { ok: false, error: "Write the article text." });
    const me = who(app, rec), images = [];
    for (const id of (Array.isArray(a0.images) ? a0.images : []).slice(0, 12)) {
      const c = String(id).replace(/[^a-z0-9]/gi, "");
      if ((old && (old.images || []).includes(c))) { images.push(c); continue; }
      const f = await store.get(`att:${c}`); if (f && sameUser(f.by, me) && /^image\//.test(f.mime)) images.push(c);
    }
    const a = Object.assign({}, old || { id: "a" + t.toString(36) + randomBytes(2).toString("hex"), createdAt: t, createdBy: rec.fullName }, {
      title, body, images, category: KB_CATEGORIES.includes(a0.category) ? a0.category : "Other", summary: str(a0.summary, 300), pinned: a0.pinned === true, updatedAt: t, updatedBy: rec.fullName });
    await store.set(`kbart:${a.id}`, a);
    return json(200, { ok: true, article: a });
  }
  if (b.action === "kb-delete") { await store.delete(`kbart:${cid(b.id)}`); return json(200, { ok: true }); }
  return json(400, { ok: false, error: "Unknown action" });
}
