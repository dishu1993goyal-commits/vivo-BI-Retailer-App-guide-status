// Scheme payout calculator: read a scheme circular with AI, save schemes (own + official ones set up by master admins),
// and market-visit counts per retailer for the calculator's eligibility rules. The payout maths runs in the page.
// Storage:
//   sc:<id>   { id, owner, by, state, official, status:"draft"|"released", audience:{roles,users,states}, scheme, createdAt, updatedAt }
import { randomBytes } from "node:crypto";
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { inAudience } from "./master-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const cid = (v) => String(v || "").replace(/[^a-z0-9]/gi, "").slice(0, 30);
const num = (v, d = 0) => { const n = Number(String(v == null ? "" : v).replace(/[₹,%\s]/g, "")); return isFinite(n) ? n : d; };
const RULE_TYPES = ["ach_slab", "unit_slab", "flat_unit", "value_pct", "kicker", "model_rate", "reward", "price_band", "penalty", "multiplier", "gate", "formula"];
const WHEN = ["always", "achieved", "notAchieved"];

// ---- rule cleaning (same shape the page uses) ----
function cleanSlabs(a, keys) {
  return (Array.isArray(a) ? a : []).slice(0, 30).map((s) => { const o = {}; keys.forEach((k) => { o[k] = s[k] === null || s[k] === "" || s[k] === undefined ? null : num(s[k], null); }); return o; })
    .filter((s) => s[keys[0]] != null).sort((x, y) => x[keys[0]] - y[keys[0]]);
}
export function cleanRule(r, isMaster, allowed) {
  r = r || {};
  const type = RULE_TYPES.includes(r.type) ? r.type : null; if (!type) return null;
  const expr = str(r.expr, 400).replace(/[^a-zA-Z0-9_+\-*/().,<>=!?: &|%]/g, "");
  if (type === "formula" && !isMaster && !(allowed && allowed.has(expr))) return null;   // custom formulas: only master admins write them
  const o = { id: cid(r.id) || randomBytes(4).toString("hex"), type, label: str(r.label, 80), models: (Array.isArray(r.models) ? r.models : String(r.models || "").split(/[,\n]/)).map((m) => str(m, 40)).filter(Boolean).slice(0, 40), off: r.off === true };
  if (type === "ach_slab") { o.pay = r.pay === "fixed" ? "fixed" : "perUnit"; o.slabs = cleanSlabs(r.slabs, ["from", "to", "amount"]); }
  if (type === "unit_slab") { o.mode = r.mode === "incremental" ? "incremental" : "retro"; o.slabs = cleanSlabs(r.slabs, ["from", "to", "rate"]); }
  if (type === "flat_unit") { o.rate = num(r.rate); o.when = WHEN.includes(r.when) ? r.when : "always"; }
  if (type === "value_pct") { o.pct = num(r.pct); o.when = WHEN.includes(r.when) ? r.when : "always"; }
  if (type === "kicker") { o.rate = num(r.rate); }
  if (type === "penalty") { o.amount = Math.abs(num(r.amount)); o.per = r.per === "shortUnit" ? "shortUnit" : r.per === "vsShortUnit" ? "vsShortUnit" : "fixed"; o.when = ["notAchieved", "vshieldShort", "either", "both"].includes(r.when) ? r.when : "notAchieved"; o.minAch = num(r.minAch, 100); }
  if (type === "multiplier") { o.minAch = num(r.minAch, 100); o.factor = num(r.factor, 1); o.maxAch = r.maxAch == null || r.maxAch === "" ? null : num(r.maxAch, null); }
  if (type === "price_band") {
    o.bands = (Array.isArray(r.bands) ? r.bands : []).slice(0, 15).map((b) => ({ min: Math.max(0, num(b && b.min)), max: b && b.max != null && b.max !== "" ? num(b.max) : null, rate: num(b && b.rate), label: str(b && b.label, 30) })).sort((x, y) => x.min - y.min);
    o.excludeModels = (Array.isArray(r.excludeModels) ? r.excludeModels : String(r.excludeModels || "").split(/[,\n]/)).map((x) => str(x, 30)).filter(Boolean).slice(0, 20);
    if (r.scale && typeof r.scale === "object") o.scale = { tiers: (r.scale.tiers || []).slice(0, 10).map((t) => ({ units: num(t.units), vs: num(t.vs), pct: num(t.pct) })).sort((x, y) => x.units - y.units),
      attach: (r.scale.attach || []).slice(0, 10).map((a) => ({ pct: num(a.pct), add: num(a.add) })).sort((x, y) => x.pct - y.pct), noVsCut: Math.max(0, Math.min(100, num(r.scale.noVsCut))) };
  }
  if (type === "reward") { o.consume = r.consume !== false; o.slabs = (Array.isArray(r.slabs) ? r.slabs : []).slice(0, 20).map((z) => ({ from: num(z && z.from, null), qty: Math.max(1, num(z && z.qty, 1)), item: str(z && z.item, 80) || "Gift", value: Math.max(0, num(z && z.value)) })).filter((z) => z.from != null && z.from > 0).sort((x, y) => x.from - y.from); }
  if (type === "model_rate") { o.minAch = num(r.minAch, 100); o.rates = (Array.isArray(r.rates) ? r.rates : []).slice(0, 60).map((x) => ({ model: str(x && x.model, 40), rate: num(x && x.rate), when: ["always", "modelAchieved", "achieved", "notAchieved"].includes(x && x.when) ? x.when : "always" })).filter((x) => x.model); }
  if (type === "gate") { o.minUnits = Math.max(0, num(r.minUnits)); o.allModels = r.allModels === true; o.active = r.active === true; o.appDays = num(r.appDays); o.features = num(r.features); o.mvisits = num(r.mvisits); o.vsPct = num(r.vsPct); o.effect = r.effect === "reduce" ? "reduce" : "zero"; o.reducePct = num(r.reducePct, 50); }
  if (type === "formula") { o.expr = expr; }
  return o;
}
export function cleanScheme(s, isMaster, allowed) {
  s = s || {};
  return { name: str(s.name, 120) || "Untitled scheme", period: /^\d{4}-\d{2}$/.test(String(s.period || "")) ? s.period : "", audience: s.audience === "vba" ? "vba" : "retailer",
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(s.dateFrom || "")) ? s.dateFrom : "", dateTo: /^\d{4}-\d{2}-\d{2}$/.test(String(s.dateTo || "")) ? s.dateTo : "",
    basis: ["upload", "activation", "both", "either"].includes(s.basis) ? s.basis : "both", targetType: ["value", "both", "either"].includes(s.targetType) ? s.targetType : "units",
    models: (Array.isArray(s.models) ? s.models : []).slice(0, 60).map((m) => ({ name: str(m && m.name, 40), target: Math.max(0, num(m && m.target)) })).filter((m) => m.name),
    excludePartners: (Array.isArray(s.excludePartners) ? s.excludePartners : String(s.excludePartners || "").split(/[,\n]/)).map((x) => str(x, 40)).filter(Boolean).slice(0, 20),
    tdsPct: Math.max(0, Math.min(40, num(s.tdsPct))), minAch: Math.max(0, num(s.minAch)), belowMin: s.belowMin === "prorata" ? "prorata" : "zero", cap: Math.max(0, num(s.cap)), extraCols: (Array.isArray(s.extraCols) ? s.extraCols : []).map((x) => str(x, 30)).filter(Boolean).slice(0, 6),
    rules: (Array.isArray(s.rules) ? s.rules : []).slice(0, 25).map((r) => cleanRule(r, isMaster, allowed)).filter(Boolean), notes: (Array.isArray(s.notes) ? s.notes : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 12),
    source: s.source && typeof s.source === "object" ? { file: str(s.source.file, 120), text: str(s.source.text, 30000) } : null };
}

const PROMPT = `Read this vivo India scheme circular (dealer / retailer / VBA incentive) and turn it into payout rules.
Return ONE JSON object:
{"name": scheme name, "period": "YYYY-MM" or "", "dateFrom": "YYYY-MM-DD" or "" (first day sales count), "dateTo": "YYYY-MM-DD" or "" (last day), "audience": "retailer" or "vba",
 "basis": which sales count — "upload" (sales uploaded), "activation" (activated), "both" (uploaded AND activated in the same month), "either",
 "targetType": "units" (volume), "value" (₹ sale value), "both" (must reach both) or "either" (volume or value),
 "models": [{"name":"model name e.g. V80","target":units target for that model}] when targets or payouts are given per model,
 "excludePartners": [EMI / finance partner names whose IMEIs are NOT counted],
 "minAch": minimum achievement % to get any payout (0 if none), "tdsPct": TDS % deducted (e.g. 10 for 194R) or 0, "belowMin": "zero" or "prorata", "cap": maximum payout per retailer in ₹ (0 if none),
 "rules": [ one or more of:
   {"type":"ach_slab","label":"...","pay":"perUnit" (₹ per unit) or "fixed" (one amount),"slabs":[{"from":achievement % lower bound,"to":upper % or null,"amount":₹}]},
   {"type":"unit_slab","label":"...","mode":"retro" (all units at the reached band's rate) or "incremental" (each band at its own rate),"slabs":[{"from":units,"to":units or null,"rate":₹ per unit}]},
   {"type":"flat_unit","label":"...","rate":₹ per unit,"when":"always"|"achieved"|"notAchieved"},
   {"type":"value_pct","label":"...","pct":% of sale value,"when":"always"|"achieved"|"notAchieved"},
   {"type":"kicker","label":"...","rate":₹ per unit sold above target},
   {"type":"price_band","label":"e.g. Discount or Additional incentive","bands":[{"min":lowest handset price ₹,"max":highest ₹ or null,"rate":₹ per unit}],"excludeModels":["series / brands paid nothing, e.g. T series, iQOO"],"scale":{"tiers":[{"units":minimum units,"vs":minimum V-Shield plans,"pct":% of this incentive paid}],"attach":[{"pct":V-Shield attachment % reached,"add":extra % of this incentive}],"noVsCut":% cut if no V-Shield sold}} — for payouts by handset price band (Below 15K, 15K–19.99K…); add "scale" only to the incentive whose % depends on units / V-Shield,
   {"type":"gate","minUnits":minimum units sold to get any payout},
   {"type":"reward","label":"...","consume":true if the units used for the gift are NOT also paid in cash (e.g. "12 units = 1 phone + 2 × ₹4,000"),"slabs":[{"from":units needed,"qty":number of gifts,"item":"gift name e.g. vivo V80 (8GB+128GB)","value":₹ value if stated else 0}]} — for phones / products / vouchers given as rewards,
   {"type":"model_rate","label":"...","rates":[{"model":"V80","rate":₹ per unit,"when":"always"|"modelAchieved" (only if that model's target is met)|"achieved" (only if the overall target is met)}]} — use this when the payout differs by model,
   {"type":"penalty","label":"...","amount":₹,"per":"fixed"|"shortUnit" (per unit short of target)|"vsShortUnit" (per V-Shield plan short),"when":"notAchieved"|"vshieldShort"|"either"|"both","minAch":% that counts as achieved},
   {"type":"multiplier","label":"...","minAch":%,"maxAch":% or null,"factor":e.g. 1.2}
 ] — add "models":["model names"] to a rule only when it applies to specific models,
 "notes": [short notes on anything you could not turn into a rule, or anything unclear]}
Slabs written as "1 Unit / 2-4 Unit / ≥5 Unit → ₹ per unit" are a unit_slab with "from" 1, 2, 5 (mode "retro" unless the circular says each band is paid at its own rate). "V80 Series" or "Model Series V80" means the rule has "models":["V80"]. Use the worked examples in the circular to check your rules. If benefits are calculated on activations, basis is "activation".
Use numbers only (no ₹ or % signs). Percent values like 100 mean 100%. If a value is not in the text, leave it out — do not invent rules.`;

const OCR_ASK = "This is a vivo India scheme circular / poster (it may be a phone screenshot or photo). Transcribe ALL the text exactly: headings, dates, every table row (cells separated by |, keep merged cells by repeating them), examples, terms & conditions, and amounts with ₹. If a table is cut off at the edge, write what is visible. No commentary.";
// Image → text. Groq's vision models change over time, so the list is read from Groq; Gemini is the fallback.
async function readImages(keys, env, images, fetchImpl) {
  const errs = [];
  const ask = async (label, fn) => { try { const t = await fn(); if (t && t.trim().length > 20) return t; errs.push(label + ": empty answer"); } catch (e) { errs.push(label + ": " + e.message); } return null; };
  // 1) Groq: only models it lists right now that can see images
  if (keys.groq) {
    let ids = [];
    try { const r = await fetchImpl("https://api.groq.com/openai/v1/models", { headers: { authorization: "Bearer " + keys.groq } }); const j = await r.json().catch(() => ({})); ids = (j.data || []).filter((m) => m.active !== false).map((m) => m.id).filter(Boolean); } catch (e) { }
    const vis = ids.filter((id) => /(llama-4|scout|maverick|vision|[-_/]vl|vl[-_]|llava|gemma-?3|pixtral|qwen.*(vl|omni)|kimi.*vl|glm.*v)/i.test(id) && !/guard|whisper|tts|embed|playai|orpheus/i.test(id)).slice(0, 4);
    if (!vis.length) errs.push("Groq: no picture-reading model available right now");
    for (const m of vis) {
      const t = await ask("Groq " + m.split("/").pop(), async () => {
        const content = [{ type: "text", text: OCR_ASK }].concat(images.slice(0, 5).map((u) => ({ type: "image_url", image_url: { url: u } })));
        const r = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + keys.groq }, body: JSON.stringify({ model: m, messages: [{ role: "user", content }], temperature: 0, max_completion_tokens: 6000 }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status + " " + String((j.error && j.error.message) || "").slice(0, 80));
        return (((j.choices || [])[0] || {}).message || {}).content || "";
      });
      if (t) return { ok: true, text: t, model: "groq/" + m };
    }
  }
  // 2) Gemini: ask Google which models exist for this key (names change as models are retired)
  if (env && env.GEMINI_API_KEY) {
    let names = [];
    try {
      const r = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) errs.push("Gemini list: " + r.status + " " + String((j.error && j.error.message) || "").slice(0, 80));
      names = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/i.test(m.name) && !/embed|tts|image-gen|imagen|live|audio|thinking-exp|learnlm|robotics|computer-use/i.test(m.name)).map((m) => m.name.replace(/^models\//, ""));
    } catch (e) { errs.push("Gemini list: " + e.message); }
    const ver = (n) => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
    names.sort((a, b) => (/flash/.test(b) - /flash/.test(a)) || (/lite/.test(a) - /lite/.test(b)) || (ver(b) - ver(a)) || (/preview|exp/.test(a) - /preview|exp/.test(b)));
    const pick = [...new Set([env.GEMINI_MODEL].filter(Boolean).concat(names))].slice(0, 4);
    if (!pick.length) errs.push("Gemini: no model available for this key");
    for (const m of pick) {
      const t = await ask("Gemini " + m, async () => {
        const parts = [{ text: OCR_ASK }].concat(images.slice(0, 5).map((u) => { const mm = /^data:(image\/[a-z]+);base64,(.+)$/.exec(u); return { inline_data: { mime_type: mm[1], data: mm[2] } }; }));
        const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, maxOutputTokens: 8000 } }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status + " " + String((j.error && j.error.message) || "").slice(0, 80));
        return (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("") || "";
      });
      if (t) return { ok: true, text: t, model: "gemini/" + m };
    }
  } else errs.push("Gemini: no key");
  return { ok: false, error: errs.join(" | ") };
}

export async function schemeCalcAction(b, ctx) {
  const { store, t, app, rec, key, pool, env, aiFetch } = ctx;
  const isAdmin = app === "admin", isMaster = isAdmin && rec.master === true;
  const owner = app + ":" + key;
  const by = { fullName: rec.fullName || rec.username, username: rec.username || "", app };
  const all = async () => (await pool(await store.list("sc:"), 40, (k) => store.get(k))).filter(Boolean);
  const canSee = (x) => x.owner === owner || isMaster || (x.official && x.status === "released" && inAudience(x, app, rec));

  if (b.action === "sc-parse") {
    const keys = await aiKeys(store, env || {});
    if (!keys.groq) return json(400, { ok: false, error: "AI isn't set up yet. An admin can add the free Groq key in Affordability Corner → Data → AI keys." });
    let text = str(b.text, 60000);
    let ocr = false;
    if (!text && Array.isArray(b.images) && b.images.length) {
      const imgs = b.images.filter((u) => /^data:image\/(jpeg|png|webp);base64,/.test(String(u)) && String(u).length < 3000000).slice(0, 5);
      if (!imgs.length) return json(400, { ok: false, error: "Couldn't read the picture — try a clearer photo or a screenshot." });
      const v = await readImages(keys, env, imgs, aiFetch);
      if (!v.ok) return json(502, { ok: false, visionFailed: true, error: "Online picture reading isn't available right now (" + v.error.slice(0, 300) + ")." });
      text = str(v.text, 60000); ocr = v.model || true;
    }
    if (text.length < 20) return json(400, { ok: false, error: "No text found in the file." });
    const r = await groqJSON(keys.groq, PROMPT + "\n\nCIRCULAR:\n" + text.slice(0, 45000), aiFetch, { validate: (d) => d && Array.isArray(d.rules) });
    if (!r.ok) return json(502, { ok: false, error: "AI couldn't turn the circular into rules (" + String(r.error).slice(0, 200) + "). You can still set the rules by hand.", text, ocr });
    const sc = cleanScheme(Object.assign({}, r.data, { source: { file: b.fileName, text } }), false);
    return json(200, { ok: true, scheme: sc, text, ocr, model: r.model });
  }

  if (b.action === "sc-list") {
    const rows = (await all()).filter(canSee).sort((x, y) => (y.official - x.official) || y.updatedAt - x.updatedAt)
      .map((x) => ({ id: x.id, mine: x.owner === owner, by: x.by, state: x.state, official: !!x.official, status: x.status, audience: isMaster ? x.audience : undefined, updatedAt: x.updatedAt, scheme: Object.assign({}, x.scheme, { source: x.scheme.source ? { file: x.scheme.source.file } : null }) }));
    return json(200, { ok: true, rows, master: isMaster });
  }
  if (b.action === "sc-get") {
    const x = await store.get(`sc:${cid(b.id)}`);
    if (!x || !canSee(x)) return json(404, { ok: false, error: "Not found." });
    return json(200, { ok: true, item: { id: x.id, mine: x.owner === owner, official: !!x.official, status: x.status, scheme: x.scheme, by: x.by } });
  }
  if (b.action === "sc-save") {
    const id0 = cid(b.id), old = id0 ? await store.get(`sc:${id0}`) : null;
    const editOfficial = old && old.official;
    if (old && old.owner !== owner && !(editOfficial && isMaster)) return json(403, { ok: false, error: "This scheme belongs to someone else — save a copy instead." });
    // formulas a master already put in an official scheme may be kept in copies
    const allowed = new Set();
    if (!isMaster) (await all()).filter((y) => y.official || (old && y.id === old.id)).forEach((y) => (y.scheme.rules || []).forEach((r) => { if (r.type === "formula") allowed.add(r.expr); }));
    const sch = cleanScheme(b.scheme, isMaster, allowed);
    const official = isMaster ? b.official === true : false;
    const id = old ? old.id : t.toString(36) + randomBytes(3).toString("hex");
    const x = { id, owner: old ? old.owner : owner, by: old ? old.by : by, state: old ? old.state : rec.state || (isAdmin ? "HO" : ""), official, status: official ? (old && old.official ? old.status : "draft") : "private",
      audience: old ? old.audience || { roles: [], users: [], states: [] } : { roles: [], users: [], states: [] }, scheme: sch, createdAt: old ? old.createdAt : t, updatedAt: t, editedBy: by.fullName };
    await store.set(`sc:${id}`, x);
    return json(200, { ok: true, id, status: x.status });
  }
  if (b.action === "sc-release") {
    if (!isMaster) return json(403, { ok: false, error: "Only master admins can release official schemes." });
    const x = await store.get(`sc:${cid(b.id)}`); if (!x) return json(404, { ok: false, error: "Not found." });
    x.official = true; x.status = b.status === "draft" ? "draft" : "released";
    const a = b.audience || {};
    x.audience = { roles: (a.roles || []).filter((r) => ["state", "admin", "master"].includes(r)), users: (a.users || []).map((u) => str(u, 60)).filter(Boolean).slice(0, 2000), states: (a.states || []).map((s) => str(s, 40)).filter(Boolean) };
    x.updatedAt = t; await store.set(`sc:${x.id}`, x);
    return json(200, { ok: true, status: x.status });
  }
  if (b.action === "sc-delete") {
    const x = await store.get(`sc:${cid(b.id)}`); if (!x) return json(200, { ok: true });
    if (x.owner !== owner && !(x.official && isMaster)) return json(403, { ok: false, error: "Not allowed." });
    await store.delete(`sc:${x.id}`); return json(200, { ok: true });
  }
  // market visits (punch-ins) per retailer ID for a month — used by eligibility rules
  if (b.action === "sc-visits") {
    const ym = /^\d{4}-\d{2}$/.test(String(b.month || "")) ? b.month.replace("-", "") : new Date(t + 19800000).toISOString().slice(0, 7).replace("-", "");
    const st = isAdmin ? str(b.state, 40) : rec.state || "";
    const vs = (await pool(await store.list(`visit:${ym}:`), 40, (k) => store.get(k))).filter(Boolean);
    const out = {};
    vs.forEach((v) => { if (st && v.state !== st) return; const rid = String((v.store && v.store.retailerId) || "").trim().toUpperCase().replace(/\s+/g, ""); if (rid) out[rid] = (out[rid] || 0) + 1; });
    return json(200, { ok: true, visits: out });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
