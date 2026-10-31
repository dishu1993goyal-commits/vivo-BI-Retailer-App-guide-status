// Recognition & rewards: HO sets earning rules once (per month or quarter); points are credited automatically from the
// dashboard (rank, score, KPIs, rank gains) and from the tools (market visits, quizzes, best practices, ideas), or by hand.
// Users see a wallet (points, badges, history), redeem points for offers in a catalogue, and HO fulfils each redemption.
// Storage:
//   config:rewards                { period, rules:[…], catalog:[…], pointValue, autoRun, terms, by, at }
//   rww:<app>:<username>          { app, username, name, state, earned:[{id, rule, title, pts, period, at, badge, why}], spent, held }
//   rwr:<id>                      { id, user:{app,username,name,state}, item:{id,name,points,cat}, pts, status, code, note, at, doneAt, by }
//   rwrun:<period>                { at, by, credited, users }
import { loadKE } from "./autorep-core.mjs";
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const num = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
const low = (x) => String(x || "").trim().toLowerCase();
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
export const RULE_TYPES = {
  rank_top: { scope: "state", label: "State in the top N ranks", p: ["n"] },
  rank_up: { scope: "state", label: "State rank improved by N or more", p: ["n"] },
  score_min: { scope: "state", label: "State BI score at least X", p: ["x"] },
  kpi_min: { scope: "state", label: "A KPI achievement at least X%", p: ["kpi", "x"] },
  visits_min: { scope: "user", label: "Valid market visits at least N", p: ["n"] },
  quiz_pass: { scope: "user", label: "Each training quiz passed", p: [] },
  wall_post: { scope: "user", label: "Each best practice shared", p: [] },
  idea: { scope: "user", label: "Each app idea / requirement submitted", p: [] },
  idea_done: { scope: "user", label: "Each idea accepted / delivered", p: [] }
};
const KPIS = ["app", "sales", "visit", "comp", "vnotice", "new"];
export const DEF_RULES = [
  { id: "top5", type: "rank_top", title: "Top 5 state", n: 5, x: 0, kpi: "", pts: 500, badge: "🏆 Top 5 state", on: true },
  { id: "rise", type: "rank_up", title: "Rank climber", n: 3, x: 0, kpi: "", pts: 200, badge: "📈 Rank climber", on: true },
  { id: "app60", type: "kpi_min", title: "Retailer App champion", n: 0, x: 60, kpi: "app", pts: 300, badge: "📱 App champion", on: true },
  { id: "visits", type: "visits_min", title: "Field star", n: 20, x: 0, kpi: "", pts: 150, badge: "📍 Field star", on: true },
  { id: "quiz", type: "quiz_pass", title: "Training completed", n: 0, x: 0, kpi: "", pts: 50, badge: "🎓 Learner", on: true },
  { id: "wall", type: "wall_post", title: "Best practice shared", n: 0, x: 0, kpi: "", pts: 40, badge: "", on: true },
  { id: "idea", type: "idea", title: "Market requirement shared", n: 0, x: 0, kpi: "", pts: 20, badge: "", on: true }
];
export const DEF_CATALOG = [
  { id: "amz500", name: "Amazon Pay gift card ₹500", cat: "Shopping", brand: "Amazon", points: 500, desc: "Code sent to your wallet", stock: null, on: true },
  { id: "flip500", name: "Flipkart gift voucher ₹500", cat: "Shopping", brand: "Flipkart", points: 500, desc: "Code sent to your wallet", stock: null, on: true },
  { id: "groc300", name: "Grocery voucher ₹300 (BigBasket / Blinkit)", cat: "Grocery", brand: "", points: 300, desc: "", stock: null, on: true },
  { id: "ott3m", name: "OTT subscription — 3 months", cat: "Subscriptions", brand: "", points: 600, desc: "Choose the app when HO contacts you", stock: null, on: true },
  { id: "fuel500", name: "Fuel voucher ₹500", cat: "Travel", brand: "", points: 500, desc: "", stock: null, on: true },
  { id: "hotel", name: "Hotel / flight booking credit ₹2,000", cat: "Travel", brand: "", points: 2000, desc: "Credit on a travel app", stock: null, on: true },
  { id: "vivoacc", name: "vivo accessories coupon ₹1,000", cat: "vivo", brand: "vivo", points: 800, desc: "Use at a vivo store", stock: null, on: true }
];
export function cleanCfg(c) {
  c = c && typeof c === "object" ? c : {};
  const rules = (Array.isArray(c.rules) ? c.rules : DEF_RULES).slice(0, 40).map((r, i) => ({ id: str(r.id, 20).replace(/[^a-z0-9_-]/gi, "") || "r" + i, type: RULE_TYPES[r.type] ? r.type : "rank_top", title: str(r.title, 60) || "Reward", n: num(r.n, 5, 0, 1000), x: num(r.x, 0, 0, 1000), kpi: KPIS.includes(r.kpi) ? r.kpi : "app", pts: num(r.pts, 100, 0, 100000), badge: str(r.badge, 40), on: r.on !== false }));
  const catalog = (Array.isArray(c.catalog) ? c.catalog : DEF_CATALOG).slice(0, 100).map((x, i) => ({ id: str(x.id, 20).replace(/[^a-z0-9_-]/gi, "") || "o" + i, name: str(x.name, 80) || "Offer", cat: str(x.cat, 30) || "Other", brand: str(x.brand, 30), points: num(x.points, 100, 1, 1000000), desc: str(x.desc, 200), img: /^(https:\/\/|\/api\/auth\?img=)[^\s"'<>]{4,500}$/.test(String(x.img || "")) ? str(x.img, 500) : "", stock: x.stock === null || x.stock === "" || x.stock === undefined ? null : num(x.stock, 0, 0, 100000), on: x.on !== false }));
  return { period: c.period === "quarter" ? "quarter" : "month", rules, catalog, pointValue: num(c.pointValue, 1, 0, 1000), autoRun: c.autoRun !== false, terms: str(c.terms, 1500), minRedeem: num(c.minRedeem, 0, 0, 100000), by: c.by || "", at: c.at || 0 };
}
// period id: "2026-10" (month) or "2026-Q4"
export function periodRange(p) {
  const last = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  let m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m) { const y = +m[1], mo = +m[2]; return { f: `${m[1]}-${m[2]}-01`, t: `${m[1]}-${m[2]}-${String(last(y, mo)).padStart(2, "0")}`, months: [p] }; }
  m = /^(\d{4})-Q([1-4])$/.exec(p); if (!m) return null;
  const y = +m[1], q = +m[2], m1 = (q - 1) * 3 + 1, months = [0, 1, 2].map((k) => `${y}-${String(m1 + k).padStart(2, "0")}`);
  return { f: `${months[0]}-01`, t: `${months[2]}-${String(last(y, m1 + 2)).padStart(2, "0")}`, months };
}
export function prevPeriod(p) { let m = /^(\d{4})-(\d{2})$/.exec(p); if (m) { let y = +m[1], mo = +m[2] - 1; if (!mo) { mo = 12; y--; } return `${y}-${String(mo).padStart(2, "0")}`; } m = /^(\d{4})-Q([1-4])$/.exec(p); let y = +m[1], q = +m[2] - 1; if (!q) { q = 4; y--; } return `${y}-Q${q}`; }
export function currentPeriod(kind, t) { const d = new Date(t + 5.5 * 3600000), y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1; return kind === "quarter" ? `${y}-Q${Math.floor((mo - 1) / 3) + 1}` : `${y}-${String(mo).padStart(2, "0")}`; }
const inRange = (ts, R) => { const d = new Date(ts + 5.5 * 3600000).toISOString().slice(0, 10); return d >= R.f && d <= R.t; };

async function stateRows(D, R) {   // dashboard rows for a period, clipped to the data span
  const sp = D.KE.span(D.RAW); if (!sp) return null;
  const f = R.f < sp.f ? sp.f : R.f, t = R.t > sp.t ? sp.t : R.t; if (f > t) return null;
  const out = {}; (D.KE.scorePeriod(D.RAW, D.SETUP, f, t, "Total").kpi_state || []).forEach((r) => { if (r.state && r.code !== "PAN" && r.state !== "Total") out[r.state] = r; });
  const ord = Object.keys(out).sort((a, b) => (out[b].score || 0) - (out[a].score || 0)); ord.forEach((s, i) => { if (out[s].rank == null) out[s].rank = i + 1; });
  return out;
}
export async function runPeriod(store, pool, period, { siteFetch = fetch, env = {}, t = Date.now(), by = "auto" } = {}) {
  const cfg = cleanCfg(await store.get("config:rewards")), R = periodRange(period); if (!R) throw new Error("Bad period");
  const rules = cfg.rules.filter((r) => r.on && r.pts > 0);
  let D = null;
  if (rules.some((r) => RULE_TYPES[r.type].scope === "state")) { const res = await siteFetch((env.SITE_URL || "") + "/index.html?v=" + t); if (!res.ok) throw new Error("couldn't read the dashboard (" + res.status + ")"); D = loadKE(await res.text()); }
  const cur = D ? await stateRows(D, R) : null, prev = D ? await stateRows(D, periodRange(prevPeriod(period))) : null;
  const users = (await pool(await store.list("user:state:"), 40, (k) => store.get(k))).filter((u) => u && !u.disabled && u.username);
  const credit = {};   // userKey -> [entries]
  const add = (u, r, why, ref) => { const k = "state:" + low(u.username); (credit[k] = credit[k] || { u, list: [] }).list.push({ id: `${r.id}|${period}|${ref || ""}`, rule: r.id, title: r.title, pts: r.pts, period, at: t, badge: r.badge, why }); };
  const byState = {}; users.forEach((u) => { (byState[u.state || ""] = byState[u.state || ""] || []).push(u); });
  for (const r of rules) {
    if (RULE_TYPES[r.type].scope === "state" && cur) {
      Object.keys(cur).forEach((st) => {
        const x = cur[st], p = prev && prev[st]; let ok = false, why = "";
        if (r.type === "rank_top") { ok = x.rank <= r.n; why = st + " ranked #" + x.rank; }
        if (r.type === "rank_up") { ok = !!(p && p.rank && x.rank && p.rank - x.rank >= r.n); why = st + " rose from #" + (p && p.rank) + " to #" + x.rank; }
        if (r.type === "score_min") { ok = (x.score || 0) >= r.x; why = st + " scored " + Math.round((x.score || 0) * 10) / 10; }
        if (r.type === "kpi_min") { ok = x[r.kpi] != null && x[r.kpi] * 100 >= r.x; why = st + " " + r.kpi + " at " + Math.round((x[r.kpi] || 0) * 1000) / 10 + "%"; }
        if (ok) (byState[st] || []).forEach((u) => add(u, r, why, "st"));
      });
    }
  }
  const uKeyOf = (by) => by && by.app === "state" && by.username ? "state:" + low(by.username) : "";
  const userBy = {}; users.forEach((u) => { userBy["state:" + low(u.username)] = u; });
  const userRules = rules.filter((r) => RULE_TYPES[r.type].scope === "user");
  if (userRules.length) {
    const need = (ty) => userRules.filter((r) => r.type === ty);
    if (need("visits_min").length) {
      const cnt = {};
      for (const m of R.months) { const vs = await pool(await store.list(`visit:${m.replace("-", "")}:`), 40, (k) => store.get(k)); vs.forEach((v) => { if (v && v.valid && v.status !== "open" && v.status !== "cancelled") { const k = uKeyOf(v.by); if (k) cnt[k] = (cnt[k] || 0) + 1; } }); }
      need("visits_min").forEach((r) => Object.keys(cnt).forEach((k) => { if (cnt[k] >= r.n && userBy[k]) add(userBy[k], r, cnt[k] + " valid market visits", "v"); }));
    }
    if (need("quiz_pass").length) {
      const qs = await pool(await store.list("qatt:"), 40, (k) => store.get(k));
      qs.forEach((a) => { if (!a || !a.passed || !inRange(a.at || 0, R)) return; const k = uKeyOf(a.user); if (k && userBy[k]) need("quiz_pass").forEach((r) => add(userBy[k], r, "Passed quiz " + (a.quiz || ""), "q" + a.quiz)); });
    }
    if (need("wall_post").length) {
      const ws = await pool(await store.list("wall:"), 40, (k) => store.get(k));
      ws.forEach((w) => { if (!w || !inRange(w.createdAt || 0, R)) return; const k = uKeyOf(w.by); if (k && userBy[k]) need("wall_post").forEach((r) => add(userBy[k], r, "Shared: " + str(w.title, 60), "w" + w.id)); });
    }
    if (need("idea").length || need("idea_done").length) {
      const is = await pool(await store.list("idea:"), 40, (k) => store.get(k));
      is.forEach((x) => { if (!x) return; const ts = Date.parse(x.at) || x.at || 0; const k = uKeyOf(x.by); if (!k || !userBy[k]) return;
        if (inRange(ts, R)) need("idea").forEach((r) => add(userBy[k], r, "Idea: " + str(x.title, 60), "i" + x.id));
        if (/done|delivered|accepted|live|planned/i.test(x.status || "") && inRange(x.statusAt || ts, R)) need("idea_done").forEach((r) => add(userBy[k], r, "Accepted: " + str(x.title, 60), "d" + x.id)); });
    }
  }
  // write: replace this period's automatic entries for every state user, keep manual awards and other periods
  let credited = 0, touched = 0;
  for (const u of users) {
    const k = "state:" + low(u.username), wk = `rww:${k.replace(":", ":")}`, w = (await store.get(wk)) || { app: "state", username: u.username, earned: [], spent: 0, held: 0 };
    const before = JSON.stringify(w.earned);
    w.earned = (w.earned || []).filter((e) => e.manual || e.period !== period);
    const fresh = (credit[k] && credit[k].list) || [];
    const seen = {}; fresh.forEach((e) => { if (!seen[e.id]) { seen[e.id] = 1; w.earned.push(e); credited += e.pts; } });
    w.name = u.fullName || u.username; w.state = u.state || "";
    if (JSON.stringify(w.earned) !== before || !w.name) { await store.set(wk, w); touched++; }
  }
  await store.set(`rwrun:${period}`, { at: t, by, credited, users: touched });
  return { period, credited, users: touched };
}
export async function runRewardsAuto(store, env, { siteFetch = fetch, now = () => Date.now() } = {}) {   // on the 2nd of a month (IST, 6 AM), credit the period that just ended
  const t = now(), cfg = cleanCfg(await store.get("config:rewards"));
  if (!cfg.autoRun || !(await store.get("config:rewards"))) return null;
  const d = new Date(t + 5.5 * 3600000); if (d.getUTCDate() !== 2 || d.getUTCHours() !== 6) return null;
  const p = prevPeriod(currentPeriod(cfg.period, t)); if (cfg.period === "quarter" && (d.getUTCMonth() % 3) !== 0) return null;
  if (await store.get(`rwrun:${p}`)) return null;
  const pool = async (keys, n, fn) => { const out = []; for (let i = 0; i < keys.length; i += n) out.push(...(await Promise.all(keys.slice(i, i + n).map(fn)))); return out; };
  return runPeriod(store, pool, p, { siteFetch, env, t, by: "auto" });
}

export async function rewardsAction(b, ctx) {
  const { store, t, app, rec, pool, env = {} } = ctx, isAdmin = app === "admin";
  const cfgRaw = await store.get("config:rewards"), cfg = cleanCfg(cfgRaw);
  const myK = `rww:${app}:${low(rec.username)}`;
  const bal = (w) => { const e = (w.earned || []).reduce((a, x) => a + (x.pts || 0), 0); return { earned: e, spent: w.spent || 0, held: w.held || 0, balance: e - (w.spent || 0) - (w.held || 0) }; };
  if (b.action === "rw-wallet") {
    const w = (await store.get(myK)) || { earned: [] }, reds = (await pool(await store.list("rwr:"), 40, (k) => store.get(k))).filter((r) => r && r.user.app === app && low(r.user.username) === low(rec.username)).sort((a, c) => c.at - a.at);
    const badges = {}; (w.earned || []).forEach((e) => { if (e.badge) badges[e.badge] = (badges[e.badge] || 0) + 1; });
    const lb = (await pool(await store.list("rww:state:"), 40, (k) => store.get(k))).filter(Boolean).map((x) => ({ name: x.name || x.username, state: x.state, pts: (x.earned || []).filter((e) => e.period === currentPeriod(cfg.period, t) || e.period === prevPeriod(currentPeriod(cfg.period, t))).reduce((a, e) => a + e.pts, 0), all: (x.earned || []).reduce((a, e) => a + e.pts, 0) })).sort((a, c) => c.all - a.all).slice(0, 10);
    return json(200, { ok: true, wallet: Object.assign(bal(w), { earnedList: (w.earned || []).slice().sort((a, c) => c.at - a.at).slice(0, 200), badges }), redemptions: reds.slice(0, 100), catalog: cfg.catalog.filter((x) => x.on), rules: cfg.rules.filter((r) => r.on).map((r) => ({ title: r.title, type: r.type, label: RULE_TYPES[r.type].label, n: r.n, x: r.x, kpi: r.kpi, pts: r.pts, badge: r.badge })), period: cfg.period, current: currentPeriod(cfg.period, t), pointValue: cfg.pointValue, terms: cfg.terms, minRedeem: cfg.minRedeem, leaderboard: lb, configured: !!cfgRaw });
  }
  if (b.action === "rw-redeem") {
    const item = cfg.catalog.find((x) => x.id === b.item && x.on); if (!item) return json(404, { ok: false, error: "Offer not available." });
    const w = (await store.get(myK)) || { app, username: rec.username, earned: [], spent: 0, held: 0 }, B = bal(w);
    if (B.balance < item.points) return json(400, { ok: false, error: "Not enough points — you need " + (item.points - B.balance) + " more." });
    if (cfg.minRedeem && B.earned < cfg.minRedeem) return json(400, { ok: false, error: "Redemption opens after you earn " + cfg.minRedeem + " points." });
    if (item.stock !== null) { const used = (await pool(await store.list("rwr:"), 40, (k) => store.get(k))).filter((r) => r && r.item.id === item.id && r.status !== "rejected").length; if (used >= item.stock) return json(400, { ok: false, error: "This offer is out of stock." }); }
    const id = nid(t), r = { id, user: { app, username: rec.username, name: rec.fullName || rec.username, state: rec.state || "", email: rec.email || "" }, item: { id: item.id, name: item.name, points: item.points, cat: item.cat }, pts: item.points, status: "pending", code: "", note: str(b.note, 300), at: t };
    w.held = (w.held || 0) + item.points; w.name = w.name || rec.fullName; w.state = w.state || rec.state || "";
    await store.set(myK, w); await store.set(`rwr:${id}`, r);
    await ctx.logEvent(store, t, app, rec, "reward-redeem", { device: item.name.slice(0, 50), ver: "" });
    return json(200, { ok: true, redemption: r, wallet: bal(w) });
  }
  if (!isAdmin) return json(403, { ok: false, error: "Only HO admins manage rewards." });
  if (b.action === "rw-config") {
    if (b.save) { const c = cleanCfg(b.save); c.by = rec.fullName || rec.username; c.at = t; await store.set("config:rewards", c); return json(200, { ok: true, config: c }); }
    const runs = (await pool(await store.list("rwrun:"), 20, async (k) => Object.assign({ period: k.slice(6) }, await store.get(k)))).sort((a, c) => c.at - a.at).slice(0, 12);
    return json(200, { ok: true, config: cfg, types: RULE_TYPES, runs, current: currentPeriod(cfg.period, t), configured: !!cfgRaw });
  }
  if (b.action === "rw-run") {
    const p = str(b.period, 10); if (!periodRange(p)) return json(400, { ok: false, error: "Choose a month (2026-10) or quarter (2026-Q4)." });
    try { const r = await runPeriod(store, pool, p, { siteFetch: ctx.siteFetch || fetch, env, t, by: rec.fullName || rec.username }); return json(200, Object.assign({ ok: true }, r)); } catch (e) { return json(500, { ok: false, error: String(e.message || e) }); }
  }
  if (b.action === "rw-award") {   // manual points: pilot projects, special work …
    const pts = num(b.pts, 0, -100000, 100000), why = str(b.why, 160); if (!pts || !why) return json(400, { ok: false, error: "Add points and a reason." });
    const targets = []; const us = (await pool(await store.list("user:state:"), 40, (k) => store.get(k))).filter((u) => u && !u.disabled);
    const ids = (Array.isArray(b.users) ? b.users : String(b.users || "").split(/[\s,;]+/)).map(low).filter(Boolean), sts = (Array.isArray(b.states) ? b.states : []).map(low);
    us.forEach((u) => { if (ids.includes(low(u.username)) || ids.includes(low(u.vchatId)) || ids.includes(low(u.email)) || sts.includes(low(u.state))) targets.push(u); });
    if (!targets.length) return json(400, { ok: false, error: "No matching state users." });
    for (const u of targets) { const k = `rww:state:${low(u.username)}`, w = (await store.get(k)) || { app: "state", username: u.username, earned: [], spent: 0, held: 0 }; w.name = u.fullName || u.username; w.state = u.state || ""; w.earned.push({ id: "m" + nid(t), rule: "manual", title: str(b.title, 60) || "Special recognition", pts, period: currentPeriod(cfg.period, t), at: t, badge: str(b.badge, 40), why, manual: true, by: rec.fullName }); await store.set(k, w); }
    return json(200, { ok: true, users: targets.length });
  }
  if (b.action === "rw-redemptions") return json(200, { ok: true, items: (await pool(await store.list("rwr:"), 40, (k) => store.get(k))).filter(Boolean).sort((a, c) => (a.status === "pending" ? 0 : 1) - (c.status === "pending" ? 0 : 1) || c.at - a.at).slice(0, 500) });
  if (b.action === "rw-fulfil") {
    const k = `rwr:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`, r = await store.get(k); if (!r) return json(404, { ok: false, error: "Not found." });
    if (r.status !== "pending") return json(400, { ok: false, error: "Already " + r.status + "." });
    const wk = `rww:${r.user.app}:${low(r.user.username)}`, w = (await store.get(wk)) || { earned: [], spent: 0, held: 0 };
    w.held = Math.max(0, (w.held || 0) - r.pts);
    if (b.reject) { r.status = "rejected"; } else { r.status = "fulfilled"; w.spent = (w.spent || 0) + r.pts; r.code = str(b.code, 300); }
    r.note = str(b.note, 300) || r.note; r.doneAt = t; r.by = rec.fullName || rec.username;
    await store.set(wk, w); await store.set(k, r);
    return json(200, { ok: true, redemption: r });
  }
  if (b.action === "rw-wallets") {
    const ws = (await pool(await store.list("rww:"), 40, (k) => store.get(k))).filter(Boolean).map((w) => Object.assign({ name: w.name || w.username, username: w.username, state: w.state, badges: [...new Set((w.earned || []).map((e) => e.badge).filter(Boolean))] }, bal(w)));
    return json(200, { ok: true, wallets: ws.sort((a, c) => c.earned - a.earned) });
  }
  return json(400, { ok: false, error: "Unknown action." });
}
