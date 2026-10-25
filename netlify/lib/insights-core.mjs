// Performance insights: cached snapshot of the dashboard data, goals, alert rules + alerts, AI review-deck narrative,
// retailer health lists, notice board, BI calendar, festive centre, launch calendar, market data, translations, My Day.
// Storage:
//   insnap                 { at, snap }                    cached snapshot (3 h)
//   insret:<slug>          { at, rows }                    retailer health list per state
//   insgoal:<slug>         goal for a state
//   config:insrules        alert thresholds
//   insseen:<app>:<key>    { ids:[] }                      alerts already seen
//   insdeck:<slug>:<per>   { at, snapAt, ai }              AI narrative for a review deck
import "../../insights-engine.js";
import { loadKE } from "./autorep-core.mjs";
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { randomBytes, createHash } from "node:crypto";
const E = globalThis.INSENG;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "na";
const SNAP_TTL = 3 * 3600000;
const okDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? String(d) : "");
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");

export async function getSnapshot(store, env, { fetchImpl = fetch, now = () => Date.now(), force = false } = {}) {
  const c = await store.get("insnap");
  if (c && c.snap && !force && now() - c.at < SNAP_TTL) return c;
  const r = await fetchImpl((env.SITE_URL || "") + "/index.html?v=" + now());
  if (!r.ok) { if (c && c.snap) return c; throw new Error("couldn't read the dashboard (" + r.status + ")"); }
  const D = loadKE(await r.text());
  const snap = E.snapshot(D, { lists: true });
  const lists = snap.lists; delete snap.lists;
  const at = now();
  await store.set("insnap", { at, snap });
  for (const st of Object.keys(lists)) await store.set(`insret:${slug(st)}`, { at, state: st, rows: lists[st] });
  return { at, snap };
}
export const cachedSnapshot = async (store) => { const c = await store.get("insnap"); return c && c.snap ? c : null; };
async function goalsList(store, pool) { return (await pool(await store.list("insgoal:"), 30, (k) => store.get(k))).filter(Boolean); }
function cleanRules(r) { const d = E.DEF_RULES, n = (v, def, lo, hi) => { const x = Number(v); return isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def; }; r = r || {}; return { rankDrop: n(r.rankDrop, d.rankDrop, 1, 20), belowPan: n(r.belowPan, d.belowPan, 1, 6), scoreDrop: n(r.scoreDrop, d.scoreDrop, 1, 50), kpiBelow: n(r.kpiBelow, d.kpiBelow, 5, 100), dormantPct: n(r.dormantPct, d.dormantPct, 5, 100), atriskPct: n(r.atriskPct, d.atriskPct, 1, 100), off: Array.isArray(r.off) ? r.off.map((x) => str(x, 40)).slice(0, 20) : [] }; }
export async function alertsFor(store, pool, snap, app, rec) {
  const rules = cleanRules(await store.get("config:insrules"));
  const all = E.alerts(snap, rules, await goalsList(store, pool)).filter((a) => !rules.off.includes(a.type));
  return app === "admin" ? all : all.filter((a) => a.state === rec.state);
}
// ---------- rule-based narrative (used when AI isn't available) ----------
function ruleNarrative(d) {
  const ks = d.kpis.filter((k) => k.me != null), byGap = ks.slice().sort((a, b) => (a.me - (a.pan || 0)) - (b.me - (b.pan || 0)));
  const strong = ks.filter((k) => k.pan != null && k.me >= k.pan).sort((a, b) => (b.me - b.pan) - (a.me - a.pan)).slice(0, 3);
  const weak = byGap.filter((k) => k.pan == null || k.me < k.pan || k.me * 100 < d.targetPct).slice(0, 3);
  const mv = d.prevRank ? d.prevRank - d.rank : 0;
  return {
    headline: d.state + " is #" + d.rank + " of " + d.of + (mv > 0 ? ", up " + mv : mv < 0 ? ", down " + -mv : "") + " — score " + d.score,
    summary: d.state + " scored " + d.score + " in " + d.period + " (PAN India " + d.panScore + "). " + (strong.length ? "Strongest: " + strong.map((k) => k.name).join(", ") + ". " : "") + (weak.length ? "Biggest gaps: " + weak.map((k) => k.name).join(", ") + "." : ""),
    strengths: strong.map((k) => ({ kpi: k.name, point: Math.round(k.me * 1000) / 10 + "% vs PAN " + Math.round((k.pan || 0) * 1000) / 10 + "%" })),
    gaps: weak.map((k) => ({ kpi: k.name, issue: Math.round(k.me * 1000) / 10 + "% vs PAN " + Math.round((k.pan || 0) * 1000) / 10 + "% and peer median " + Math.round((k.peer || 0) * 1000) / 10 + "%", cause: "Review retailer coverage and follow-up for this KPI." })),
    actions: weak.map((k, i) => ({ action: (d.lib[k.k] || [])[0] || "Plan the steps to improve " + k.name, kpi: k.name, owner: "State BI team", due: d.dueDates[i % d.dueDates.length], impact: "Close the gap to PAN on " + k.name })),
    targets: weak.map((k) => ({ kpi: k.name, now: Math.round(k.me * 1000) / 10 + "%", target: Math.min(100, Math.round(Math.max(k.pan || 0, k.me + 0.05) * 1000) / 10) + "%" })),
    message: "Focus this month on " + (weak[0] ? weak[0].name : "your weakest KPI") + " — small daily follow-ups move the rank fastest.",
    by: "rules"
  };
}
function deckData(snap, st, perIdx, goal, alerts, lib, targetPct) {
  const M = snap.months, p = M[perIdx == null || perIdx < 0 ? M.length - 1 : perIdx], prev = M[M.indexOf(p) - 1];
  const r = p && p.rows[st]; if (!r) return null;
  const pr = E.peers(Object.assign({}, snap, { months: M.slice(0, M.indexOf(p) + 1) }), st);
  const peerMed = {}; (pr ? pr.rows : []).forEach((x) => { peerMed[x.k] = x.median; });
  const of = Object.keys(p.rows).filter((s) => p.rows[s].score != null).length;
  const due = new Date(Date.parse(snap.asOf + "T00:00:00Z") + 14 * 864e5).toISOString().slice(0, 10), due2 = new Date(Date.parse(snap.asOf + "T00:00:00Z") + 28 * 864e5).toISOString().slice(0, 10);
  return {
    state: st, period: p.label, partial: p.partial, rank: r.rank, of, score: r.score, prevRank: prev && prev.rows[st] ? prev.rows[st].rank : null, prevScore: prev && prev.rows[st] ? prev.rows[st].score : null, panScore: p.pan.score,
    kpis: E.KPIS.filter((k) => k[0] !== "new" || r.new).map((k) => ({ k: k[0], name: k[1], me: r[k[0]], pan: p.pan[k[0]], peer: peerMed[k[0]], prev: prev && prev.rows[st] ? prev.rows[st][k[0]] : null })),
    weekly: snap.weeks.map((w) => ({ label: w.label, score: w.rows[st] ? w.rows[st].score : null, rank: w.rows[st] ? w.rows[st].rank : null, pan: w.pan.score })),
    peers: pr ? { band: pr.band, rankInGroup: pr.rankInGroup, size: pr.group.length, group: pr.order } : null,
    seg: snap.seg[st] || null, goal: goal ? Object.assign({ targetRank: goal.targetRank, targetScore: goal.targetScore, by: goal.by }, E.goalProgress(snap, goal) || {}) : null,
    alerts: alerts.filter((a) => a.state === st).slice(0, 8).map((a) => a.title + " — " + a.detail), lib, targetPct, dueDates: [due, due2], asOf: snap.asOf
  };
}
async function aiNarrative(store, env, aiFetch, d) {
  const keys = await aiKeys(store, env || {});
  if (!keys.groq) return null;
  const pct = (v) => (v == null ? "—" : Math.round(v * 1000) / 10 + "%");
  const facts = {
    state: d.state, period: d.period + (d.partial ? " (month to date)" : ""), rank: d.rank + " of " + d.of, previousRank: d.prevRank, score: d.score, previousScore: d.prevScore, panIndiaScore: d.panScore,
    kpis: d.kpis.map((k) => ({ kpi: k.name, state: pct(k.me), panIndia: pct(k.pan), similarSizeStatesMedian: pct(k.peer), lastMonth: pct(k.prev) })),
    weeklyScore: d.weekly.filter((w) => w.score != null).map((w) => w.label + ": " + w.score + " (rank " + w.rank + ")"),
    peerGroup: d.peers ? d.peers.band + " states, #" + d.peers.rankInGroup + " of " + d.peers.size : "",
    retailers: d.seg ? { total: d.seg.total, champions: d.seg.champion, active: d.seg.active, atRisk: d.seg.atrisk, dormant: d.seg.dormant + d.seg.never } : null,
    goal: d.goal ? { target: d.goal.targetRank ? "rank " + d.goal.targetRank : "score " + d.goal.targetScore, by: d.goal.by, status: d.goal.status, neededPerWeek: d.goal.needWeekly } : null,
    alerts: d.alerts, suggestedActions: Object.fromEntries(Object.entries(d.lib || {}).map(([k, v]) => [E.KN[k] || k, (v || []).slice(0, 3)])), kpiTargetPercent: d.targetPct, dueDateOptions: d.dueDates
  };
  const prompt = `You are a senior business-intelligence analyst at vivo India preparing a monthly performance review for one state's BI team.
Use ONLY the facts below. Be specific with numbers. Write in simple business English for field managers.
Return JSON only with this shape:
{"headline":"one line (max 14 words)","summary":"2-3 sentences on how the month went and why",
"strengths":[{"kpi":"","point":"why it is strong, with numbers"}],
"gaps":[{"kpi":"","issue":"gap with numbers vs PAN / similar states","cause":"most likely reason, practical"}],
"actions":[{"action":"concrete step the state team can do","kpi":"","owner":"State BI team / ASMs / Distributors / HO","due":"YYYY-MM-DD from dueDateOptions","impact":"expected result"}],
"targets":[{"kpi":"","now":"x%","target":"y% for next month (realistic)"}],
"risks":["short risk"],"message":"one motivating line for the team"}
Give 2-3 strengths, 2-4 gaps, 4-6 actions, 3-4 targets.
FACTS:
${JSON.stringify(facts)}`;
  const r = await groqJSON(keys.groq, prompt, aiFetch, { validate: (x) => x && x.headline && Array.isArray(x.actions) && x.actions.length });
  if (!r.ok) return { error: String(r.error || "AI failed").slice(0, 200) };
  const a = r.data, clip = (v, n) => str(v, n);
  const arr = (v, n) => (Array.isArray(v) ? v : []).slice(0, n);
  return { headline: clip(a.headline, 140), summary: clip(a.summary, 700), strengths: arr(a.strengths, 4).map((x) => ({ kpi: clip(x.kpi, 40), point: clip(x.point, 240) })), gaps: arr(a.gaps, 5).map((x) => ({ kpi: clip(x.kpi, 40), issue: clip(x.issue, 240), cause: clip(x.cause, 240) })),
    actions: arr(a.actions, 7).map((x) => ({ action: clip(x.action, 240), kpi: clip(x.kpi, 40), owner: clip(x.owner, 60), due: okDate(x.due) || d.dueDates[0], impact: clip(x.impact, 160) })), targets: arr(a.targets, 5).map((x) => ({ kpi: clip(x.kpi, 40), now: clip(x.now, 20), target: clip(x.target, 40) })),
    risks: arr(a.risks, 4).map((x) => clip(x, 160)), message: clip(a.message, 200), by: "ai", model: r.model };
}

export async function insightsAction(b, ctx) {
  const { store, t, app, rec, key, pool, env = {} } = ctx;
  const isAdmin = app === "admin";
  const siteFetch = ctx.siteFetch || fetch;
  const snapOr = async (force) => { try { return await getSnapshot(store, env, { fetchImpl: siteFetch, now: () => t, force: force && isAdmin }); } catch (e) { return { error: e.message }; } };
  const canState = (st) => isAdmin || st === rec.state;

  if (b.action === "ins-snapshot") {
    const s = await snapOr(!!b.force); if (s.error) return json(502, { ok: false, error: "Couldn't read the dashboard data: " + s.error });
    const goals = await goalsList(store, pool), rules = cleanRules(await store.get("config:insrules"));
    return json(200, { ok: true, at: s.at, snap: s.snap, goals: isAdmin ? goals : goals.filter((g) => g.state === rec.state), rules, myState: rec.state || "", admin: isAdmin });
  }
  if (b.action === "ins-retailers") {
    const st = isAdmin ? str(b.state, 40) : rec.state; if (!st) return json(400, { ok: false, error: "Choose a state." });
    let x = await store.get(`insret:${slug(st)}`); if (!x) { await snapOr(false); x = await store.get(`insret:${slug(st)}`); }
    return json(200, { ok: true, state: st, rows: (x && x.rows) || [], at: x && x.at });
  }
  if (b.action === "ins-goal-set") {
    const st = isAdmin ? str(b.state, 40) : rec.state; if (!st || !canState(st)) return json(403, { ok: false, error: "You can set the goal for your own state." });
    const by = okDate(b.by); if (!by) return json(400, { ok: false, error: "Choose the target date." });
    const tr = Math.round(Number(b.targetRank) || 0), ts = Number(b.targetScore) || 0;
    if (!tr && !ts) return json(400, { ok: false, error: "Set a target rank or a target score." });
    const s = await snapOr(false), cur = s.snap && s.snap.months[s.snap.months.length - 1], row = cur && cur.rows[st];
    const g = { state: st, targetRank: tr > 0 ? Math.min(40, tr) : null, targetScore: !tr && ts > 0 ? Math.min(100, ts) : null, by, note: str(b.note, 200), at: t, setBy: rec.fullName || rec.username, base: row ? { score: row.score, rank: row.rank, period: cur.label } : null };
    await store.set(`insgoal:${slug(st)}`, g);
    await ctx.logEvent(store, t, app, rec, "goal-set", { device: st + " → " + (g.targetRank ? "#" + g.targetRank : g.targetScore), ver: "" });
    return json(200, { ok: true, goal: g });
  }
  if (b.action === "ins-goal-delete") {
    const st = isAdmin ? str(b.state, 40) : rec.state; if (!canState(st)) return json(403, { ok: false, error: "Not allowed." });
    await store.delete(`insgoal:${slug(st)}`); return json(200, { ok: true });
  }
  if (b.action === "ins-rules") {
    if (!isAdmin) return json(403, { ok: false, error: "Only HO admins change alert rules." });
    const r = cleanRules(b.save || (await store.get("config:insrules"))); if (b.save) await store.set("config:insrules", Object.assign(r, { by: rec.fullName, at: t }));
    return json(200, { ok: true, rules: r });
  }
  if (b.action === "ins-alerts") {
    const s = await snapOr(false); if (s.error) return json(502, { ok: false, error: s.error });
    const list = await alertsFor(store, pool, s.snap, app, rec), seenK = `insseen:${app}:${key}`, seen = ((await store.get(seenK)) || { ids: [] }).ids;
    if (b.markSeen) await store.set(seenK, { ids: [...new Set(list.map((a) => a.id).concat(seen))].slice(0, 800) });
    return json(200, { ok: true, alerts: list.map((a) => Object.assign({}, a, { fresh: !seen.includes(a.id) })), asOf: s.snap.asOf });
  }
  if (b.action === "ins-deck") {   // AI narrative for one state's review deck (cached per data version)
    const st = isAdmin ? str(b.state, 40) : rec.state; if (!st || !canState(st)) return json(403, { ok: false, error: "You can make the deck for your own state." });
    const s = await snapOr(false); if (s.error) return json(502, { ok: false, error: s.error });
    const per = Number.isFinite(Number(b.period)) ? Number(b.period) : s.snap.months.length - 1;
    const goal = await store.get(`insgoal:${slug(st)}`), alerts = await alertsFor(store, pool, s.snap, "admin", rec);
    const cc = (await store.get("config:centre")) || {}, lib = cc.actionLib || {}, targetPct = (cc.thresholds && cc.thresholds.good) || 80;
    const d = deckData(s.snap, st, per, goal, alerts, lib, targetPct); if (!d) return json(404, { ok: false, error: "No data for " + st + " in this period." });
    const ck = `insdeck:${slug(st)}:${per}`, c = await store.get(ck);
    let ai = c && c.snapAt === s.at && !b.fresh ? c.ai : null, aiErr = "";
    if (!ai && b.ai !== false) {
      const day = `insdeckn:${new Date(t + 5.5 * 3600000).toISOString().slice(0, 10)}`, used = ((await store.get(day)) || { n: 0 }).n;
      if (used < 300) { const x = await aiNarrative(store, env, ctx.aiFetch, d); if (x && !x.error) { ai = x; await store.set(ck, { at: t, snapAt: s.at, ai }); await store.set(day, { n: used + 1 }); } else aiErr = x ? x.error : "AI isn't set up (add the free Groq key in AI & research keys)."; }
      else aiErr = "Daily AI limit reached — using the built-in analysis.";
    }
    return json(200, { ok: true, data: d, ai: ai || ruleNarrative(d), aiError: ai ? "" : aiErr, at: s.at });
  }
  return null;
}
