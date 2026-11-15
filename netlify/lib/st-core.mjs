// BI & design studio — dashboards from Excel/CSV, slide decks, creatives and task boards.
// Storage:
//   std:<kind>:<userKey>:<id>   a user's saved dashboard / deck / design  { id, kind, title, doc, shared, state, by, at, upd }
//   stb:<id>                    a task board { id, title, cols[], cards[], scope: "ho" | state name, by, at, upd, rev }
import { randomBytes } from "node:crypto";
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").slice(0, n);
const KINDS = ["dash", "deck", "design"];
const nid = (t) => t.toString(36).toUpperCase() + randomBytes(2).toString("hex");
const parse = (s) => { try { return JSON.parse(String(s).replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "")); } catch (e) { return null; } };

export async function stAction(b, ctx) {
  const { store, t, app, rec, key, pool, env = {}, askAI, aiFetch } = ctx;
  const uk = app + ":" + key, by = rec.fullName || rec.username || "", isHO = app === "admin", myState = rec.state || "";

  // ---------- saved dashboards / decks / designs ----------
  if (b.action === "st-list") {
    const kind = KINDS.includes(b.kind) ? b.kind : "dash";
    const all = (await pool(await store.list("std:" + kind + ":"), 30, (k) => store.get(k))).filter(Boolean);
    const rows = all.filter((d) => d.owner === uk || (d.shared && (isHO || d.app === "admin" || d.state === myState))).sort((x, y) => (y.upd || y.at) - (x.upd || x.at)).slice(0, 100)
      .map((d) => ({ id: d.id, title: d.title, by: d.by, mine: d.owner === uk, shared: !!d.shared, upd: d.upd || d.at, thumb: d.thumb || "", owner: d.owner }));
    return J(200, { ok: true, rows });
  }
  if (b.action === "st-get") {
    const kind = KINDS.includes(b.kind) ? b.kind : "dash", d = await store.get(`std:${kind}:${str(b.owner, 80) || uk}:${str(b.id, 20)}`);
    if (!d || !(d.owner === uk || (d.shared && (isHO || d.app === "admin" || d.state === myState)))) return J(404, { ok: false, error: "Not found" });
    return J(200, { ok: true, d: { id: d.id, title: d.title, doc: d.doc, shared: !!d.shared, mine: d.owner === uk, by: d.by } });
  }
  if (b.action === "st-save") {
    const kind = KINDS.includes(b.kind) ? b.kind : "dash", body = JSON.stringify(b.doc || {});
    if (body.length > 2600000) return J(413, { ok: false, error: "Too big to save (limit about 2.5 MB). Use less data or smaller pictures." });
    const id = str(b.id, 20) || nid(t), k = `std:${kind}:${uk}:${id}`, old = await store.get(k);
    const d = { id, kind, owner: uk, app, state: myState, by, title: str(b.title, 80) || "Untitled", doc: b.doc || {}, shared: !!b.shared, thumb: String(b.thumb || "").slice(0, 60000), at: old ? old.at : t, upd: t };
    await store.set(k, d); return J(200, { ok: true, id });
  }
  if (b.action === "st-del") { await store.delete(`std:${KINDS.includes(b.kind) ? b.kind : "dash"}:${uk}:${str(b.id, 20)}`); return J(200, { ok: true }); }

  // ---------- task boards ----------
  const canBoard = (x) => isHO || x.scope === myState || x.owner === uk;
  if (b.action === "st-boards") {
    const L = (await pool(await store.list("stb:"), 30, (k) => store.get(k))).filter((x) => x && canBoard(x)).sort((x, y) => (y.upd || y.at) - (x.upd || x.at));
    return J(200, { ok: true, rows: L.map((x) => ({ id: x.id, title: x.title, scope: x.scope, by: x.by, upd: x.upd, n: x.cards.length, done: x.cards.filter((c) => c.col === x.cols[x.cols.length - 1]).length, mine: x.cards.filter((c) => c.who && by && c.who.toLowerCase() === by.toLowerCase() && c.col !== x.cols[x.cols.length - 1]).length })), me: by, isHO, myState });
  }
  if (b.action === "st-board") { const x = await store.get("stb:" + str(b.id, 20)); return x && canBoard(x) ? J(200, { ok: true, b: x, me: by }) : J(404, { ok: false, error: "Board not found" }); }
  if (b.action === "st-board-save") {   // whole board, with a revision check so two people don't overwrite each other
    const n = b.b || {}, id = str(n.id, 20), old = id ? await store.get("stb:" + id) : null;
    if (id && (!old || !canBoard(old))) return J(404, { ok: false, error: "Board not found" });
    if (old && +b.rev !== (old.rev || 0)) return J(409, { ok: false, error: "Someone else changed this board — it has been reloaded.", b: old });
    const cols = (Array.isArray(n.cols) ? n.cols : []).map((c) => str(c, 30)).filter(Boolean).slice(0, 8);
    if (cols.length < 2) return J(400, { ok: false, error: "A board needs at least two columns" });
    const cards = (Array.isArray(n.cards) ? n.cards : []).slice(0, 400).map((c) => ({ id: str(c.id, 16) || nid(t) + randomBytes(1).toString("hex"), title: str(c.title, 140), desc: txt(c.desc, 1500), who: str(c.who, 60), due: /^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : "", prio: ["high", "med", "low"].includes(c.prio) ? c.prio : "med", label: str(c.label, 30), col: cols.includes(c.col) ? c.col : cols[0], at: +c.at || t, notes: (Array.isArray(c.notes) ? c.notes : []).slice(-30).map((m) => ({ by: str(m.by, 60), at: +m.at || t, text: txt(m.text, 500) })) })).filter((c) => c.title);
    const x = { id: old ? old.id : "B" + nid(t), title: str(n.title, 80) || "Board", cols, cards, scope: old ? old.scope : isHO ? (n.scope && n.scope !== "ho" ? str(n.scope, 40) : "ho") : myState, owner: old ? old.owner : uk, by: old ? old.by : by, at: old ? old.at : t, upd: t, rev: (old ? old.rev || 0 : 0) + 1 };
    await store.set("stb:" + x.id, x); return J(200, { ok: true, b: x });
  }
  if (b.action === "st-board-del") { const x = await store.get("stb:" + str(b.id, 20)); if (!x || !(isHO || x.owner === uk)) return J(403, { ok: false, error: "Only the board's creator or HO can delete it" }); await store.delete("stb:" + x.id); return J(200, { ok: true }); }

  // ---------- AI ----------
  if (b.action === "st-ai") {
    if (!askAI) return J(400, { ok: false, error: "AI is not set up yet." });
    const mode = b.mode, p = txt(b.prompt, 1500), data = txt(b.data, 9000);
    let q, sys = "You help vivo India's Business Innovation team (smartphone sales, dealers, schemes, promoters). Be specific and practical. Reply with JSON only.", max = 2500;
    if (mode === "insights") { sys = "You are a business analyst for vivo India's sales team. Use only the numbers given; do not invent numbers."; q = "Write 5–7 short bullet insights from this dashboard data (what is high, low, changing, concentrated) and 3 recommended actions. Plain text bullets starting with •."; }
    else if (mode === "widgets") q = `The user uploaded a table. Columns with types and sample values are given. Suggest a dashboard. Reply JSON: {"title":"…","widgets":[{"type":"kpi|bar|line|pie|table","title":"…","dim":"category or date column (not for kpi)","measure":"numeric column or *count*","agg":"sum|avg|count|max|min"}]} with 3-4 kpi widgets first, then 4-6 charts (line only with a date column; pie only for a column with few distinct values). Use exact column names.${p ? " The user wants: " + p : ""}`;
    else if (mode === "deck") { max = 5000; q = `Make a presentation. Reply JSON: {"title":"…","slides":[{"layout":"title|section|bullets|two|kpi|chart|quote|closing","title":"…","sub":"…","bullets":["…"],"left":["…"],"right":["…"],"kpis":[{"label":"…","value":"…"}],"chart":{"type":"bar|line|pie","labels":["…"],"values":[1,2]},"notes":"speaker note"}]}. ${Math.max(4, Math.min(15, +b.n || 8))} slides, first "title", last "closing"; bullets max 5 per slide, each under 14 words; use kpi and chart slides where numbers help (only numbers given by the user or clearly marked as example). Topic: ${p}`; }
    else if (mode === "design") q = `Write copy for a ${str(b.kindName, 40) || "poster"}. Reply JSON: {"headline":"max 6 words","sub":"max 12 words","body":"max 22 words","cta":"max 4 words","badge":"max 3 words"}. Brief: ${p}`;
    else if (mode === "board") q = `Break this goal into a task board. Reply JSON: {"title":"…","cards":[{"title":"short task","desc":"one line","prio":"high|med|low","label":"one word area","days":number of days from today it is due}]} with 8-14 tasks in a sensible order. Goal: ${p}`;
    else return J(400, { ok: false, error: "Unknown AI mode" });
    const r = await askAI(env, q, data || p, [], aiFetch, { system: sys, label: mode === "insights" || mode === "widgets" ? "DATA" : "BRIEF", json: mode !== "insights", maxTokens: max });
    if (!r.ok) return J(502, { ok: false, error: r.error || "AI didn't answer — try again." });
    if (mode === "insights") return J(200, { ok: true, text: String(r.text).slice(0, 3000) });
    const j = parse(r.text); if (!j) return J(502, { ok: false, error: "The AI answer wasn't readable — try again." });
    return J(200, { ok: true, out: j });
  }
  return J(400, { ok: false, error: "Unknown action" });
}
