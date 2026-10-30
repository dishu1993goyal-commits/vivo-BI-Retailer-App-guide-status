// One-Page Studio: AI writes slide content (bullets, stats, flows, charts, insights) for a chosen focus area
// from the dashboard data the page sends. Numbers come only from that data; results are cached.
// Storage:  dsai:<hash>   { at, slides }
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { createHash } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const TYPES = ["bullets", "stats", "flow", "timeline", "table", "chart", "two", "quote"];
const CH = ["bar", "column", "line", "doughnut", "pie"];
const num = (v) => { const n = Number(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };

export function cleanSlides(d) {
  const out = [];
  (Array.isArray(d && d.slides) ? d.slides : []).slice(0, 6).forEach((s) => {
    if (!s || typeof s !== "object") return;
    const type = TYPES.includes(s.type) ? s.type : "bullets";
    const o = { type, title: str(s.title, 80) || "Highlights", sub: str(s.sub || s.subtitle, 120), insight: str(s.insight, 200) };
    o.bullets = (Array.isArray(s.bullets) ? s.bullets : []).slice(0, 7).map((b) => str(typeof b === "object" ? (b.text || b.t || "") : b, 160)).filter(Boolean);
    o.stats = (Array.isArray(s.stats) ? s.stats : []).slice(0, 4).map((x) => ({ v: str(x && (x.v ?? x.value), 14), l: str(x && (x.l || x.label), 40) })).filter((x) => x.v && x.l);
    o.steps = (Array.isArray(s.steps) ? s.steps : []).slice(0, 7).map((x) => ({ t: str(x && (x.t || x.title), 34), s: str(x && (x.s || x.sub || x.detail), 70) })).filter((x) => x.t);
    o.rows = (Array.isArray(s.rows) ? s.rows : []).slice(0, 9).map((r) => (Array.isArray(r) ? r : []).slice(0, 5).map((c) => str(c, 60)));
    if (s.chart && typeof s.chart === "object" && Array.isArray(s.chart.labels)) {
      const labels = s.chart.labels.slice(0, 12).map((l) => str(l, 24));
      const series = (Array.isArray(s.chart.series) ? s.chart.series : []).slice(0, 3).map((x) => ({ name: str(x && x.name, 30) || "Value", values: labels.map((_, i) => num(((x && x.values) || [])[i])) }));
      if (labels.length && series.length) o.chart = { type: CH.includes(s.chart.type) ? s.chart.type : "bar", labels, series, unit: str(s.chart.unit, 8) };
    }
    if (type === "flow" && o.steps.length < 2) o.type = "bullets";
    if (type === "stats" && !o.stats.length) o.type = "bullets";
    if (type === "table" && o.rows.length < 2) o.type = "bullets";
    if ((type === "chart" || type === "two") && !o.chart) o.type = "bullets";
    if (o.type === "bullets" && !o.bullets.length && !o.insight) return;
    out.push(o);
  });
  return out;
}

export async function deckAction(b, ctx) {
  const { store, t, app, rec } = ctx;
  if (b.action === "ds-ua") {   // App usability lab: AI picks the fairest formula from the computed comparison
    const data = String(typeof b.data === "string" ? b.data : JSON.stringify(b.data || {})).slice(0, 16000);
    if (data.length < 50) return json(400, { ok: false, error: "Run the comparison first." });
    const key = "dsua:" + createHash("sha1").update(data).digest("hex").slice(0, 20);
    const hit = await store.get(key); if (hit && !b.fresh && t - hit.at < 24 * 3600000) return json(200, { ok: true, advice: hit.advice, cached: true });
    const keys = await aiKeys(store, ctx.env || {}); if (!keys.groq) return json(200, { ok: false, error: "AI key not set (Affordability → Data → Groq key)." });
    const prompt = `You are advising vivo India's HO Business Innovation team on a fair KPI for Retailer App usability across Indian states.
State BI teams complain the current method (unique app users per feature ÷ eligible retailers reported by each state) is unfair: small states vs big states, hard terrain, inactive or virtual retailers with under 5 units a month, unregistered retailers, states disabling IDs or under-reporting eligible counts.
Below are several candidate formulas computed on the same data, with fairness diagnostics: size_bias = correlation of the score with log(state size) (closer to 0 is fairer), gaming = how much a state can lift its score by under-reporting eligible retailers or disabling inactive IDs (0 = cannot), spread, rank_moves vs current.
Recommend ONE formula (or a blend) that is transparent, fair to small and large states, hard to game and simple to explain. Use only the numbers given.
Return JSON only: {"best":"<option id>","title":"","why":["",""],"how_to_calculate":"one plain sentence","data_needed":[""],"risks":[""],"rollout":["step 1",""],"tweaks":[""],"verdicts":[{"id":"","verdict":"one short line"}]}
DATA:
${data}`;
    const r = await groqJSON(keys.groq, prompt, ctx.aiFetch || fetch, { validate: (d) => d && d.best && Array.isArray(d.why) });
    if (!r.ok) return json(200, { ok: false, error: r.error });
    const L = (v, n, m) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => str(typeof x === "object" ? JSON.stringify(x) : x, m)).filter(Boolean);
    const d = r.data, advice = { best: str(d.best, 20), title: str(d.title, 100), why: L(d.why, 6, 240), how: str(d.how_to_calculate, 300), data: L(d.data_needed, 6, 160), risks: L(d.risks, 5, 200), rollout: L(d.rollout, 6, 200), tweaks: L(d.tweaks, 5, 200), verdicts: (Array.isArray(d.verdicts) ? d.verdicts : []).slice(0, 8).map((x) => ({ id: str(x && x.id, 20), v: str(x && x.verdict, 160) })) };
    await store.set(key, { at: t, advice });
    return json(200, { ok: true, advice });
  }
  if (b.action !== "ds-ai") return json(400, { ok: false, error: "Unknown action." });
  const focus = str(b.focus, 80), scope = str(b.scope, 40) || "PAN India", period = str(b.period, 40), tone = ["crisp", "detailed", "professional"].includes(b.tone) ? b.tone : "professional";
  if (app !== "admin" && scope !== "PAN India" && rec.state && scope !== rec.state) return json(403, { ok: false, error: "You can make decks for your state and PAN India." });
  const data = String(typeof b.data === "string" ? b.data : JSON.stringify(b.data || {})).slice(0, 14000);
  if (!focus || data.length < 20) return json(400, { ok: false, error: "Nothing to write about yet." });
  const n = Math.max(1, Math.min(5, Number(b.slides) || 2));
  const key = "dsai:" + createHash("sha1").update(JSON.stringify([focus, scope, period, tone, n, str(b.extra, 300), data])).digest("hex").slice(0, 20);
  const hit = await store.get(key); if (hit && !b.fresh && t - hit.at < 12 * 3600000) return json(200, { ok: true, slides: hit.slides, cached: true });
  const keys = await aiKeys(store, ctx.env || {}); if (!keys.groq) return json(200, { ok: false, error: "AI key not set (ask HO: Affordability → Data → Groq key)." });
  const prompt = `You are a senior BI analyst at vivo India (Business Innovation team) writing PowerPoint slides for management.
Focus area: "${focus}". Scope: ${scope}. Period: ${period || "latest"}. Tone: ${tone}.${b.extra ? " Extra instructions: " + str(b.extra, 300) : ""}
Write ${n} slide(s) for this focus. Use ONLY facts and numbers present in DATA — never invent numbers, names or dates. Keep text short (slide bullets, max 16 words each).
Pick the best slide type for the content:
- "stats": 2-4 headline numbers {v,l} + insight
- "bullets": 3-6 bullets + insight
- "flow": process / plan as 3-6 steps {t,s} (use when DATA has steps, stages or a sequence)
- "timeline": milestones as steps {t: when, s: what}
- "table": rows (first row = header), max 6 rows x 4 columns
- "chart": chart {type: bar|column|line|doughnut, labels:[], series:[{name, values:[]}], unit} built only from DATA numbers + insight
- "two": bullets on the left + chart on the right
Every slide needs a title (max 8 words) and an "insight" (one sentence: so what / what to do next).
Return JSON only: {"slides":[{"type":"","title":"","sub":"","bullets":[],"stats":[],"steps":[],"rows":[],"chart":null,"insight":""}]}
DATA:
${data}`;
  const r = await groqJSON(keys.groq, prompt, ctx.aiFetch || fetch, { validate: (d) => cleanSlides(d).length > 0 });
  if (!r.ok) return json(200, { ok: false, error: r.error });
  const slides = cleanSlides(r.data);
  await store.set(key, { at: t, slides });
  return json(200, { ok: true, slides });
}
