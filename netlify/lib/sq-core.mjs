// Agile BI SQL helper (HO). vivo IT's Agile BI needs SQL for every dataset; this tool keeps the list of
// tables + their columns and lets AI write / fix / explain StarRocks SQL in plain English.
//   sq:cols:<table>      { table, cols:[{ n, t, c }], at, by }      columns as pasted from Agile BI
//   sq:q:<userKey>:<id>  { id, title, sql, note, at }               a user's saved queries
import { randomBytes } from "node:crypto";
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").slice(0, n);
const DB = "app_vwork_indwarehouse";
export const SQ_TABLES = [
  ["ta_vk_vbm_query_detail", "VBM query detail", "VBM查询明细", "VBM documents / queries: number, title, creator, status, handler"],
  ["tf_vk_delivery_inbound", "Inbound orders (stock received)", "入库单", "Stock coming in to an agency / store"],
  ["tf_vk_delivery_outbound", "Outbound orders (stock sent)", "出库单", "Stock going out from an agency / store"],
  ["v_td_vk_agency", "Agencies (distributors)", "代理商", "Master list of agencies"],
  ["v_td_vk_employee", "Employee details", "人员明细", "Master list of employees / sales team"],
  ["v_td_vk_pricing", "Product pricing", "产品定价", "Price of each product"],
  ["v_td_vk_product", "Product master", "产品主数据", "Master list of products / models"],
  ["v_td_vk_product_material", "Product → material codes", "产品主数据 → 物料", "Material (SKU / colour / memory) codes under each product"],
  ["v_td_vk_retailer", "Retailers", "零售商", "Master list of retailers (dealers)"],
  ["v_td_vk_store", "Stores", "门店", "Master list of stores (outlets)"],
  ["v_tf_vk_competitors_report", "Competitor tracking — uploads", "竞品追踪 → 上传历史", "Competitor sales reported by the field"],
  ["v_tf_vk_competitors_setting", "Competitor tracking — settings", "竞品追踪 → 竞品设置", "Which competitor brands / models are tracked"],
  ["v_tf_vk_d_sale_active_detail", "Sales detail — activation (system)", "进销存明细 → 销售→后台", "Sell-out counted by the back end (activation)"],
  ["v_tf_vk_d_sale_report_detail", "Sales detail — reported", "进销存明细 → 销售→上报", "Sell-out reported by stores / promoters"]
];
const TN = SQ_TABLES.map((x) => x[0]);
const parse = (s) => { try { return JSON.parse(String(s).replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "")); } catch (e) { return null; } };
const safeSql = (s) => { const q = txt(s, 34000).trim().replace(/;+\s*$/, ""); return /^\s*(select|with)\b/i.test(q) && !/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|replace\s+into|merge)\b/i.test(q.replace(/'[^']*'/g, "''")) ? q : ""; };

export async function sqAction(b, ctx) {
  const { store, t, app, rec, key, pool, env = {}, askAI, aiFetch } = ctx;
  if (app !== "admin") return J(403, { ok: false, error: "Only HO can use this tool" });
  const uk = app + ":" + key, by = rec.fullName || rec.username || "";
  const allCols = async () => { const M = {}; (await pool(TN, 14, (n) => store.get("sq:cols:" + n))).forEach((c) => { if (c && c.cols && c.cols.length) M[c.table] = c; }); return M; };

  if (b.action === "sq-get") {
    const M = await allCols(), mine = (await pool(await store.list("sq:q:" + uk + ":"), 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 100);
    return J(200, { ok: true, db: DB, tables: SQ_TABLES.map((x) => ({ name: x[0], en: x[1], zh: x[2], about: x[3], cols: M[x[0]] ? M[x[0]].cols : [], at: M[x[0]] ? M[x[0]].at : 0 })), saved: mine, ai: !!askAI });
  }
  if (b.action === "sq-cols") {   // { sets: { table: [{n,t,c}] } }
    const sets = b.sets && typeof b.sets === "object" ? b.sets : {}; let n = 0;
    for (const tb of Object.keys(sets)) {
      const name = String(tb).toLowerCase().replace(/^.*\./, ""); if (!TN.includes(name)) continue;
      const seen = {}, cols = (Array.isArray(sets[tb]) ? sets[tb] : []).map((c) => ({ n: str(c.n, 64).replace(/[^\w]/g, ""), t: str(c.t, 30).toLowerCase(), c: str(c.c, 80) })).filter((c) => c.n && !seen[c.n] && (seen[c.n] = 1)).slice(0, 300);
      if (!cols.length) { await store.delete("sq:cols:" + name); continue; }
      await store.set("sq:cols:" + name, { table: name, cols, at: t, by }); n++;
    }
    return J(200, { ok: true, saved: n });
  }
  if (b.action === "sq-save") {
    const sql = txt(b.sql, 34000).trim(); if (!sql) return J(400, { ok: false, error: "Nothing to save" });
    const id = str(b.id, 20) || t.toString(36).toUpperCase() + randomBytes(2).toString("hex");
    await store.set(`sq:q:${uk}:${id}`, { id, title: str(b.title, 90) || "Query", sql, note: txt(b.note, 800), at: t }); return J(200, { ok: true, id });
  }
  if (b.action === "sq-del") { await store.delete(`sq:q:${uk}:${str(b.id, 20)}`); return J(200, { ok: true }); }

  if (b.action === "sq-ai") {
    if (!askAI) return J(400, { ok: false, error: "AI is not set up yet." });
    const M = await allCols(), mode = b.mode, pick = (Array.isArray(b.tables) ? b.tables : []).filter((n) => TN.includes(n));
    const use = pick.length ? pick : TN;
    let schema = SQ_TABLES.filter((x) => use.includes(x[0])).map((x) => {
      const c = M[x[0]];
      return DB + "." + x[0] + " — " + x[1] + " (" + x[2] + "). " + x[3] + "\n  " + (c ? "COLUMNS: " + c.cols.map((k) => k.n + (k.t ? ":" + k.t : "") + (k.c ? "[" + k.c + "]" : "")).join(", ") : "COLUMNS: NOT KNOWN YET");
    }).join("\n");
    if (schema.length > 13500) schema = SQ_TABLES.filter((x) => use.includes(x[0])).map((x) => { const c = M[x[0]]; return DB + "." + x[0] + " — " + x[1] + "\n  " + (c ? "COLUMNS: " + c.cols.map((k) => k.n + (k.c ? "[" + k.c.slice(0, 18) + "]" : "")).join(", ") : "COLUMNS: NOT KNOWN YET"); }).join("\n").slice(0, 13500);
    const base = "You write SQL for vivo India's Agile BI tool. Database engine: StarRocks (MySQL-style syntax; use date_format, date_trunc, datediff, ifnull, count(distinct …)). The user knows no SQL and is on the sales Business Innovation team. RULES: only SELECT statements. Always write tables with the full name " + DB + ".table_name and give short aliases. Use ONLY tables and columns listed under TABLES, spelled exactly; the text in [brackets] is the column's meaning (often Chinese). Columns listed under a table are exact — use them as spelled. If a table you need shows COLUMNS: NOT KNOWN YET (or a needed column is missing), STILL write the full query using the most likely vWork warehouse column names (lower snake_case, e.g. imei, model_name, product_code, brand_name, state_name, city_name, agency_code, agency_name, store_code, store_name, retailer_code, employee_code, qty, active_date / sale_date / report_date, create_time, status, price), put EVERY such guessed column in \"guessed\" as table.column, and list the table in \"need\". Never guess when the real column list is given. Give result columns clear English names with AS. A dataset should be aggregated or limited to the needed columns and a sensible date range, not select * on a big table. Reply with JSON only.";
    let sys, q, ctxText = schema, max = 2200;
    if (mode === "write") { sys = base + ' JSON shape: {"title":"short name for the dataset","sql":"the query, formatted on several lines","explain":"3-5 short plain-English sentences: what it returns and how","uses":["table_name"],"chart":"which chart to build in Agile BI with which column as dimension and which as value","checks":["things the user should verify, e.g. an assumed status value or join key"],"need":["table_name whose columns are needed first"],"guessed":["table.column names you guessed"]}'; q = txt(b.q, 700); if (q.length < 6) return J(400, { ok: false, error: "Describe what you want to see" }); }
    else if (mode === "fix") { const sql = txt(b.sql, 6000), err = txt(b.err, 1200); if (!sql) return J(400, { ok: false, error: "Paste the SQL" }); sys = base + ' The user ran a query in Agile BI and got an error or a wrong result. Correct it. JSON shape: {"title":"","sql":"corrected query","explain":"what was wrong and what changed, in plain English","uses":[],"chart":"","checks":[],"need":[]}'; ctxText = ("SQL:\n" + sql + "\n\nERROR OR PROBLEM:\n" + (err || "(not given)") + "\n\nTABLES:\n" + schema).slice(0, 13900); q = "Fix this query."; }
    else if (mode === "explain") { const sql = txt(b.sql, 7000); if (!sql) return J(400, { ok: false, error: "Paste the SQL" }); sys = "You explain SQL (StarRocks) to a sales manager who knows no SQL. Reply with JSON only: {\"explain\":\"plain English, step by step, max 8 short sentences\",\"checks\":[\"risks or things to verify\"]}"; ctxText = ("SQL:\n" + sql + "\n\nTABLES:\n" + schema).slice(0, 13900); q = "Explain this query."; }
    else if (mode === "ideas") { sys = base.replace("Reply with JSON only.", "") + ' Suggest useful datasets / dashboards the sales BI team can build from the tables whose columns are known. Reply with JSON only: {"ideas":[{"title":"…","ask":"the plain-English request the user can send to get the SQL, max 25 words","why":"one line"}]} with 8 ideas.'; q = "Suggest ideas."; max = 1800; }
    else return J(400, { ok: false, error: "Unknown mode" });
    const r = await askAI(env, q, ctxText, mode === "write" ? b.history : [], aiFetch, { system: sys, label: mode === "fix" || mode === "explain" ? "INPUT" : "TABLES", json: true, maxTokens: mode === "write" || mode === "fix" ? Math.max(max, 3000) : max });
    if (!r.ok) return J(502, { ok: false, error: r.error || "AI didn't answer — try again." });
    const j = parse(r.text); if (!j) return J(502, { ok: false, error: "The AI answer wasn't readable — try again." });
    if (mode === "ideas") return J(200, { ok: true, ideas: (Array.isArray(j.ideas) ? j.ideas : []).slice(0, 10).map((x) => ({ title: str(x.title, 70), ask: str(x.ask, 240), why: str(x.why, 140) })).filter((x) => x.ask) });
    const list = (a, n, len) => (Array.isArray(a) ? a : []).map((x) => str(x, len)).filter(Boolean).slice(0, n);
    if (mode === "explain") return J(200, { ok: true, out: { explain: txt(j.explain, 1500), checks: list(j.checks, 6, 200) } });
    let sql = safeSql(j.sql || ""); const need = list(j.need, 14, 60).map((n) => n.replace(/^.*\./, "")).filter((n) => TN.includes(n));
    // a column the AI used that is not in the saved list is flagged, never silently accepted
    const warn = [];
    if (sql) {
      const used = TN.filter((n) => new RegExp("\\b" + n + "\\b", "i").test(sql));
      used.forEach((n) => { if (!M[n] && !need.includes(n)) need.push(n); });
      if (j.sql && !sql) warn.push("The AI returned something that is not a plain SELECT, so it was dropped.");
      const other = (sql.match(new RegExp(DB + "\\.(\\w+)", "gi")) || []).map((x) => x.split(".")[1].toLowerCase()).filter((n) => !TN.includes(n));
      if (other.length) { warn.push("It used a table that is not in your list: " + [...new Set(other)].join(", ")); }
    } else if (j.sql) warn.push("The AI returned something that is not a plain SELECT, so it was dropped.");
    return J(200, { ok: true, out: { title: str(j.title, 80), sql, explain: txt(j.explain, 1500), uses: list(j.uses, 14, 60), chart: str(j.chart, 300), checks: list(j.checks, 8, 220).concat(warn), need, guessed: list(j.guessed, 40, 80) } });
  }
  return J(400, { ok: false, error: "Unknown action" });
}
