// AI Scheme Assistant: a retailer/user uploads a scheme policy (the page extracts its text) and AI turns it into a
// clear brief — targets, slabs, focus models, actions, and which numbers to enter. The user then types their daily /
// monthly sales value & volume and focus-model sales, and AI works out progress, what's left to hit each slab, and the
// likely payout. HO can publish a parsed scheme so every retailer sees it without re-uploading.
// Storage:  scha:<id> { id, title, data, by, at, published }      schaai:<hash> { at, data }
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { readImages } from "./schemecalc-core.mjs";
import { createHash, randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");

const num = (v) => { if (v == null || String(v).trim() === "" || /^(null|-|—|na|n\/a)$/i.test(String(v).trim())) return null; const n = Number(String(v == null ? "" : v).replace(/[₹,%\s]|rs\.?|inr/gi, "")); return isFinite(n) ? n : null; };
const BASIS = ["pct", "perUnit", "flat"];
// The payout plan: every table in the circular as data, so the page can calculate the payout exactly.
//  matrix  – rows (models / series) × achievement tiers, each cell a % of sale value or ₹ per unit
//  slab    – unit slabs (e.g. 5-10 units = 3%), all units paid at the reached slab's rate
//  band    – ₹ per unit by price band (V-Shield, EOL…)
//  perUnit – one flat ₹ per unit
//  conditions – if not met, the total is multiplied by factor (e.g. 0.7 → 70% payout)
export function cleanPlan(p) {
  p = p && typeof p === "object" ? p : {};
  const comps = (Array.isArray(p.components) ? p.components : []).slice(0, 12).map((c) => {
    c = c || {}; const kind = ["matrix", "slab", "band", "perUnit"].includes(c.kind) ? c.kind : null; if (!kind) return null;
    const o = { kind, name: str(c.name, 80) || "Payout", models: str(Array.isArray(c.models) ? c.models.join(", ") : c.models, 160), note: str(c.note, 200) };
    if (kind === "matrix") {
      o.tiers = (Array.isArray(c.tiers) ? c.tiers : []).slice(0, 6).map((t) => ({ label: str(t && t.label, 30), min: Math.max(0, num(t && t.min) || 0) }));
      if (!o.tiers.length) return null;
      o.rows = (Array.isArray(c.rows) ? c.rows : []).slice(0, 60).map((r) => ({ name: str(r && r.name, 60), basis: BASIS.includes(r && r.basis) && r.basis !== "flat" ? r.basis : (BASIS.includes(c.basis) && c.basis !== "flat" ? c.basis : "perUnit"),
        values: o.tiers.map((_, i) => num(r && Array.isArray(r.values) ? r.values[i] : null)) })).filter((r) => r.name && r.values.some((v) => v != null));
      if (!o.rows.length) return null;
    }
    if (kind === "slab") {
      o.basis = BASIS.includes(c.basis) ? c.basis : "perUnit";
      o.slabs = (Array.isArray(c.slabs) ? c.slabs : []).slice(0, 15).map((z) => ({ label: str(z && z.label, 30), min: Math.max(0, num(z && z.min) || 0), max: num(z && z.max), value: num(z && z.value) || 0 })).sort((a, b2) => a.min - b2.min);
      if (!o.slabs.length) return null;
    }
    if (kind === "band") { o.bands = (Array.isArray(c.bands) ? c.bands : []).slice(0, 12).map((z) => ({ label: str(z && z.label, 50), value: num(z && z.value) || 0 })).filter((z) => z.label); if (!o.bands.length) return null; }
    if (kind === "perUnit") { o.value = num(c.value) || 0; if (!o.value) return null; }
    return o;
  }).filter(Boolean);
  const conditions = (Array.isArray(p.conditions) ? p.conditions : []).slice(0, 6).map((x) => ({ label: str(x && x.label, 160), factor: Math.max(0, Math.min(1, num(x && x.factor) == null ? 0 : num(x.factor))) })).filter((x) => x.label);
  return comps.length ? { components: comps, conditions, achLabel: str(p.achLabel, 120) || "Overall achievement vs your target" } : null;
}

function cleanScheme(d) {
  d = d && typeof d === "object" ? d : {};
  const arr = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => str(typeof x === "object" ? x.text || JSON.stringify(x) : x, m)).filter(Boolean);
  return {
    title: str(d.title, 120) || "Scheme", period: str(d.period, 60), summary: str(d.summary, 600),
    targets: (Array.isArray(d.targets) ? d.targets : []).slice(0, 12).map((x) => ({ metric: str(x && x.metric, 80), value: str(x && x.value, 40), unit: str(x && x.unit, 24) })).filter((x) => x.metric),
    slabs: (Array.isArray(d.slabs) ? d.slabs : []).slice(0, 20).map((x) => ({ label: str(x && x.label, 60), condition: str(x && x.condition, 120), payout: str(x && x.payout, 80) })).filter((x) => x.condition || x.payout),
    focusModels: arr(d.focusModels, 20, 50), actions: arr(d.actions, 12, 200),
    inputs: (Array.isArray(d.inputs) ? d.inputs : []).slice(0, 10).map((x) => ({ key: str(x && x.key, 30).replace(/[^a-z0-9_]/gi, "") || "v", label: str(x && x.label, 80), unit: str(x && x.unit, 24) })).filter((x) => x.label),
    incentiveNote: str(d.incentiveNote, 300), terms: arr(d.terms, 12, 220), plan: cleanPlan(d.plan)
  };
}

export async function schemeaiAction(b, ctx) {
  const { store, t, app, rec, pool, env = {} } = ctx, isAdmin = app === "admin", f = ctx.aiFetch || fetch;
  const ai = async (prompt, validate, ck) => {
    const k = "schaai:" + createHash("sha1").update(ck || prompt).digest("hex").slice(0, 22), hit = ck ? await store.get(k) : null;
    if (hit && t - hit.at < 14 * 864e5) return { ok: true, data: hit.data, cached: true };
    const keys = await aiKeys(store, env); if (!keys.groq) return { ok: false, error: "AI key not set (Affordability → Data → Groq key)." };
    const r = await groqJSON(keys.groq, prompt, f, { validate });
    if (r.ok && ck) await store.set(k, { at: t, data: r.data });
    return r;
  };

  if (b.action === "scha-parse") {   // scheme text (extracted on the page) or photos → structured brief + exact payout plan
    let text = String(b.text == null ? "" : b.text).slice(0, 20000), via = "", visionError = "";
    const imgs = (Array.isArray(b.images) ? b.images : []).filter((u) => /^data:image\/(jpeg|png|webp);base64,/.test(String(u)) && String(u).length < 3000000).slice(0, 4);
    if (imgs.length) {   // read the picture with a vision model — keeps table rows and columns far better than phone OCR
      const keys = await aiKeys(store, env);
      if (keys.groq) { const v = await readImages(keys, env, imgs, f); if (v.ok) { text = String(v.text).slice(0, 20000) + (text ? "\n\n(Phone OCR of the same picture, for cross-checking:)\n" + text.slice(0, 6000) : ""); via = v.model; } else visionError = str(v.error, 300); }
      else visionError = "AI key not set";
    }
    if (text.length < 30) return json(400, { ok: false, visionError, error: "The file had no readable scheme text." + (visionError ? " (AI picture reading: " + visionError + ")" : "") });
    const prompt = `You explain vivo India sales-scheme / incentive policies to retailers and turn the payout tables into exact data. Read the SCHEME TEXT (it may come from a PDF/photo, so table cells may be separated by | or spaces).
Return JSON only:
{"title":"short name","period":"the scheme period/dates if stated","summary":"3-4 plain sentences: who it is for and how the incentive works",
"targets":[{"metric":"what is measured","value":"the target number/amount","unit":"units/₹/%"}],
"slabs":[{"label":"short name","condition":"e.g. ≥100% achievement / 5-10 units / MOP < ₹15K","payout":"e.g. 6.5% / ₹1850 per unit"}],
"focusModels":["model names the scheme focuses on"],
"actions":["clear step the retailer should take to earn the most"],
"terms":["important conditions: e.g. only SIM-activated units count, no online / cross-region sales, payout excludes GST, 70% payout if monthly target missed"],
"incentiveNote":"one line on how/when the payout is given",
"plan":{"achLabel":"what achievement % means here e.g. Sell-out achievement vs monthly target",
 "components":[
  {"kind":"matrix","name":"e.g. Model wise payout","tiers":[{"label":"≥100%","min":100},{"label":"≥90%","min":90},{"label":"Basic","min":0}],
   "rows":[{"name":"X / V / S Series","basis":"pct","values":[6.5,5.5,4.5]},{"name":"Y51 Pro (8+256)","basis":"perUnit","values":[1850,1550,1250]}]},
  {"kind":"slab","name":"e.g. Y11 sell-out","models":"Y11","basis":"pct","slabs":[{"label":"Slab 1","min":5,"max":10,"value":3},{"label":"Slab 2","min":11,"max":20,"value":4},{"label":"Slab 3","min":21,"max":null,"value":5}]},
  {"kind":"band","name":"e.g. V-Shield (per plan)","bands":[{"label":"MOP below ₹15K","value":50},{"label":"MOP above ₹15K","value":100}]},
  {"kind":"perUnit","name":"e.g. Activation bonus","models":"V60","value":500}],
 "conditions":[{"label":"Monthly overall target achieved","factor":0.7}]}}
PLAN RULES — the plan is used to calculate money, so copy EVERY table and EVERY row exactly:
- A table of models/series (rows) against achievement levels (columns like ≥100%, ≥90%, Basic / Below) is ONE "matrix": tiers in the column order, "min" = the achievement % that column needs (Basic/base/others = 0). Each row's "values" follow the tier order. "basis":"pct" when the cells are % of sale value, "perUnit" when they are ₹ per unit. Include every model row, never summarise rows.
- Unit-quantity slabs (e.g. 2-5 units 1%, 6-9 units 1.5%, 10+ units 2%) are a "slab": min/max in units (max null for "and above"), "value" is the % (basis "pct"), ₹ per unit (basis "perUnit") or one lump-sum ₹ (basis "flat"). Put the model(s) it applies to in "models".
- ₹ per unit by price band or segment (V-Shield by MOP, EOL / old stock by price, etc.) is a "band".
- A single ₹ amount per unit is "perUnit".
- "conditions" only for rules that cut the whole payout: "factor" is the share still paid when the condition is NOT met (e.g. "70% payout if target not achieved" → 0.7; "no payout" → 0).
- Use plain numbers (no ₹, % or commas). Do not invent rows, slabs or numbers that are not in the text; if there is no payout table, return "plan":{"components":[]}.
SCHEME TEXT:
${text}`;
    const r = await ai(prompt, (d) => d && (d.summary || (d.slabs && d.slabs.length) || (d.plan && Array.isArray(d.plan.components))), "parse2|" + text.slice(0, 6000));
    if (!r.ok) return json(200, { ok: false, error: r.error });
    const scheme = cleanScheme(r.data);
    if (!scheme.plan && /\d\s*(%|units?|u\b|pcs|nos|rs|₹|\/-)|slab|payout|incentive|₹/i.test(text)) {   // second look, tables only
      const p2 = `Extract ONLY the payout tables from this vivo India scheme as exact data. Read every row; table cells may be separated by | or spaces, and lines may be out of order.
Return JSON only: {"plan":{"achLabel":"","components":[ ... ],"conditions":[{"label":"","factor":0.7}]}}
Component shapes:
{"kind":"matrix","name":"","tiers":[{"label":"≥100%","min":100},{"label":"≥90%","min":90},{"label":"Basic","min":0}],"rows":[{"name":"model or series","basis":"pct" or "perUnit","values":[one number per tier]}]}
{"kind":"slab","name":"","models":"model names","basis":"pct" (% of sale value) or "perUnit" (₹ per unit) or "flat" (₹ once),"slabs":[{"label":"","min":units,"max":units or null,"value":number}]}
{"kind":"band","name":"","bands":[{"label":"e.g. MOP below ₹15K","value":₹ per unit}]}
{"kind":"perUnit","name":"","models":"","value":₹ per unit}
Examples: "2-5 units 1%, 6-9 units 1.5%, 10+ units 2%" → slab basis pct, slabs min 2 max 5 value 1 / min 6 max 9 value 1.5 / min 10 max null value 2. "70% payout if target not achieved" → conditions factor 0.7. Plain numbers only.
SCHEME TEXT:
${text}`;
      const r2 = await ai(p2, (d) => d && d.plan && Array.isArray(d.plan.components) && d.plan.components.length, "plan2|" + text.slice(0, 6000));
      if (r2.ok) scheme.plan = cleanPlan(r2.data.plan);
    }
    return json(200, { ok: true, scheme, via, visionError, read: text.slice(0, 5000) });
  }
  if (b.action === "scha-calc") {   // user's numbers + the scheme → progress, what's left, projected payout
    const scheme = cleanScheme(b.scheme), inputs = b.inputs && typeof b.inputs === "object" ? b.inputs : {};
    if (!scheme.summary && !scheme.slabs.length) return json(400, { ok: false, error: "Parse a scheme first." });
    const inStr = Object.entries(inputs).slice(0, 20).map(([k, v]) => `${str(k, 40)}: ${str(String(v), 40)}`).join("; ");
    const prompt = `You help a vivo retailer see where they stand on this sales scheme. Using the SCHEME and the retailer's CURRENT NUMBERS, work it out.
Return JSON only:
{"status":"one line: which slab they are in now and the payout they currently qualify for",
"currentPayout":"₹ amount they qualify for right now (0 if below the first slab)",
"nextSlab":{"label":"","needMore":"what more is needed to reach it e.g. 3 more V-series units","extraPayout":"the extra ₹ if reached"},
"projection":"one line projecting month-end if they keep the current daily pace",
"breakdown":[{"label":"","value":""}],
"advice":["2-4 concrete, specific actions to maximise the payout, referencing the focus models and numbers"]}
Do the arithmetic carefully from the slabs; never invent payout figures beyond the scheme. If a needed number is missing, say what to enter.
SCHEME: ${JSON.stringify(scheme)}
CURRENT NUMBERS: ${inStr || "(none entered yet)"}`;
    const r = await ai(prompt, (d) => d && (d.status || d.advice));
    if (!r.ok) return json(200, { ok: false, error: r.error });
    const d = r.data;
    return json(200, { ok: true, result: { status: str(d.status, 300), currentPayout: str(d.currentPayout, 40), nextSlab: d.nextSlab && typeof d.nextSlab === "object" ? { label: str(d.nextSlab.label, 60), needMore: str(d.nextSlab.needMore, 160), extraPayout: str(d.nextSlab.extraPayout, 60) } : null, projection: str(d.projection, 240), breakdown: (Array.isArray(d.breakdown) ? d.breakdown : []).slice(0, 12).map((x) => ({ label: str(x && x.label, 80), value: str(x && x.value, 80) })).filter((x) => x.label), advice: (Array.isArray(d.advice) ? d.advice : []).slice(0, 6).map((x) => str(x, 240)).filter(Boolean) } });
  }
  if (b.action === "scha-list") {
    const L = (await pool((await store.list("scha:")).sort().reverse().slice(0, 80), 20, (k) => store.get(k))).filter((x) => x && (isAdmin || x.published)).sort((a, c) => c.at - a.at);
    return json(200, { ok: true, items: L.map((x) => ({ id: x.id, title: x.title, period: x.data ? x.data.period : "", at: x.at, by: x.by, published: x.published })) });
  }
  if (b.action === "scha-get") { const x = await store.get(`scha:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); if (!x || (!isAdmin && !x.published)) return json(404, { ok: false, error: "Not found." }); return json(200, { ok: true, item: { id: x.id, title: x.title, scheme: x.data, published: x.published } }); }

  if (!isAdmin) return json(403, { ok: false, error: "Only HO admins publish schemes." });
  if (b.action === "scha-save") {
    const id = str(b.id, 30).replace(/[^a-z0-9]/gi, "") || nid(t), data = cleanScheme(b.scheme);
    const old = (await store.get(`scha:${id}`)) || {};
    await store.set(`scha:${id}`, { id, title: str(b.title, 120) || data.title, data, by: rec.fullName || rec.username, at: old.at || t, updatedAt: t, published: b.published !== false });
    return json(200, { ok: true, id });
  }
  if (b.action === "scha-delete") { await store.delete(`scha:${str(b.id, 30).replace(/[^a-z0-9]/gi, "")}`); return json(200, { ok: true }); }
  return json(400, { ok: false, error: "Unknown action." });
}
