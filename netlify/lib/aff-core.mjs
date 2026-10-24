// Affordability Corner: vivo models, variants, colours, market price and running offers
// (EMI by partner, exchange, upgrade, V-Shield, ABB), gathered by Gemini from Google + vivo.com.
// Nobody imports data. Research runs in a Netlify background function (it takes 20-60 s);
// results are cached so each model is researched at most once a day.
//
// Storage (bi-users store):
//   affcat                 { models:[...], updatedAt, sources:[], error?, errorAt? }
//   affm:<slug>            { slug, name, variants, colours, emi, exchange, upgrade, vshield, abb, other, notes, sources, updatedAt, error?, errorAt? }
//   afflock:<slug|catalog> { at, job }          research in progress (stale after LOCK_MS)
//   affjob:<id>            { kind:"catalog"|"model", slug, name, by, at }   one-time ticket for the background function
//   affcap:<yyyy-mm-dd>    { n }                AI research runs today
//   affr:<slug>:<id>       field / HO offer report { id, slug, model, state, kind, partner, scheme, details, validTill, photo, by, at, verified, verifiedBy }
//   affhide:<slug>         { <offerKey>: { by, at } }  AI offers an admin marked as wrong
import { randomBytes, createHash } from "node:crypto";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
export const slugify = (s) => String(s || "").toLowerCase().replace(/^vivo\s+/, "").replace(/\+/g, " plus").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const DAY = 86400000;
export const MODEL_TTL = DAY, CATALOG_TTL = 3 * DAY, LOCK_MS = 4 * 60000;
const KINDS = ["emi", "exchange", "upgrade", "vshield", "abb", "cashback", "other"];
export const PARTNERS = ["Bajaj Finserv", "Pine Labs", "HDB Financial", "TVS Credit", "Home Credit", "IDFC FIRST Bank", "HDFC Bank", "ICICI Bank", "SBI Card", "Axis Bank", "Kotak Bank", "OneCard", "Benow", "Innoviti", "Paytm", "Mswipe", "Razorpay", "vivo"];
const RESEARCH_MODELS = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
const istDay = (t) => new Date(t + 5.5 * 3600000).toISOString().slice(0, 10);
export const offerKey = (kind, o) => createHash("sha1").update(kind + "|" + String(o.partner || "") + "|" + String(o.scheme || "") + "|" + String(o.details || o.plan || "")).digest("hex").slice(0, 12);

// ---------- Gemini with Google Search + URL reading ----------
function parseJSON(text) {
  let t = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch (e) { }
  try { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1")); } catch (e) { return null; }
}
export async function researchJSON(env, prompt, fetchImpl = fetch) {
  if (!env || !env.GEMINI_API_KEY) return { ok: false, error: "AI is not set up (GEMINI_API_KEY missing)." };
  const models = env.GEMINI_RESEARCH_MODEL ? [env.GEMINI_RESEARCH_MODEL, ...RESEARCH_MODELS] : RESEARCH_MODELS;
  const toolSets = [[{ google_search: {} }, { url_context: {} }], [{ google_search: {} }]];
  let last = "";
  for (const m of models) {
    for (const tools of toolSets) {
      const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools, generationConfig: { temperature: 0.15, maxOutputTokens: 12000 } });
      let r, j;
      try {
        r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body });
        j = await r.json().catch(() => ({}));
      } catch (e) { last = "network: " + e.message; continue; }
      if (r.ok) {
        const cand = (j.candidates || [])[0] || {};
        const text = ((cand.content || {}).parts || []).map((p) => p.text || "").join("");
        const data = parseJSON(text);
        if (!data) { last = "unreadable answer"; break; }
        const gm = cand.groundingMetadata || {};
        const sources = [];
        (gm.groundingChunks || []).forEach((c) => { const w = c.web || {}; if (w.uri && sources.length < 15 && !sources.some((s) => s.title === w.title)) sources.push({ title: str(w.title, 80) || "source", url: str(w.uri, 600) }); });
        ((cand.urlContextMetadata || cand.url_context_metadata || {}).urlMetadata || []).forEach((u) => { const url = u.retrievedUrl || u.retrieved_url; if (url && sources.length < 18) sources.push({ title: url.replace(/^https?:\/\//, "").slice(0, 60), url }); });
        return { ok: true, data, sources, model: m, queries: (gm.webSearchQueries || []).slice(0, 8) };
      }
      last = r.status + (j.error && j.error.message ? ": " + j.error.message.slice(0, 140) : "");
      if (r.status === 401 || r.status === 403) return { ok: false, error: "AI key rejected (" + last + ")" };
      if (r.status !== 400) break;   // 429/5xx: next model; 400: maybe the tool combo → try google_search only
    }
  }
  return { ok: false, error: "AI research failed (" + last + ")" };
}

// ---------- cleaning AI output ----------
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 ? Math.round(n) : null; };
const url = (v) => /^https?:\/\//i.test(String(v || "")) ? str(v, 600) : "";
function cleanVariants(a) {
  return (Array.isArray(a) ? a : []).slice(0, 12).map((v) => ({ ram: str(v.ram, 12), storage: str(v.storage, 12), mrp: num(v.mrp), price: num(v.price), priceSource: str(v.priceSource || v.source, 80), colours: (Array.isArray(v.colours || v.colors) ? (v.colours || v.colors) : []).slice(0, 10).map((c) => str(c, 40)).filter(Boolean) }))
    .filter((v) => v.ram || v.storage || v.price);
}
function cleanOffers(a, kind) {
  return (Array.isArray(a) ? a : []).slice(0, 25).map((o) => {
    const x = { partner: str(o.partner || o.bank || o.provider, 60), type: str(o.type, 40), scheme: str(o.scheme, 20), tenures: (Array.isArray(o.tenures) ? o.tenures : []).slice(0, 8).map((t) => str(t, 6)).filter(Boolean), noCost: o.noCost === true || /no.?cost|\/0$/i.test(String(o.scheme || "")),
      benefit: str(o.benefit || o.cashback || o.upto || o.price, 80), plan: str(o.plan, 60), details: str(o.details || o.description, 400), validTill: str(o.validTill || o.valid, 30), channel: str(o.channel, 40), source: url(o.source || o.url) };
    x.key = offerKey(kind, x);
    return x;
  }).filter((o) => o.details || o.partner || o.benefit);
}
export function cleanModel(d, base) {
  const m = { slug: base.slug, name: str(d.name || base.name, 60), series: str(d.series || base.series, 20), launched: str(d.launched, 20), url: url(d.url) || base.url || "",
    variants: cleanVariants(d.variants), colours: (Array.isArray(d.colours || d.colors) ? (d.colours || d.colors) : []).slice(0, 12).map((c) => str(c, 40)).filter(Boolean),
    notes: str(d.notes, 600), highlights: (Array.isArray(d.highlights) ? d.highlights : []).slice(0, 6).map((h) => str(h, 80)).filter(Boolean) };
  KINDS.forEach((k) => { m[k] = cleanOffers(d[k], k); });
  if (!m.colours.length) m.colours = [...new Set(m.variants.flatMap((v) => v.colours))];
  return m;
}
const sRank = (s) => { const i = ["X", "V", "S", "T", "Y"].indexOf(String(s || "").toUpperCase()); return i < 0 ? 9 : i; };
export function cleanCatalog(d) {
  const seen = {};
  return (Array.isArray(d && d.models) ? d.models : []).slice(0, 120).map((x) => {
    const name = str(x.name, 60); if (!name) return null;
    const slug = slugify(x.slug || name); if (!slug || seen[slug]) return null; seen[slug] = 1;
    const variants = cleanVariants(x.variants);
    const prices = variants.map((v) => v.price).filter(Boolean);
    return { slug, name: /^vivo/i.test(name) ? name : "vivo " + name, series: str(x.series, 20) || (name.replace(/^vivo\s+/i, "").match(/^[A-Za-z]+/) || [""])[0].toUpperCase(), launched: str(x.launched, 20),
      variants, colours: (Array.isArray(x.colours || x.colors) ? (x.colours || x.colors) : []).slice(0, 12).map((c) => str(c, 40)).filter(Boolean), startPrice: prices.length ? Math.min(...prices) : null, url: url(x.url) };
  }).filter(Boolean).sort((a, b) => sRank(a.series) - sRank(b.series) || a.series.localeCompare(b.series) || (b.startPrice || 0) - (a.startPrice || 0));
}

// ---------- prompts ----------
function pageText(html, n) { return String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").slice(0, n); }
async function grab(u, fetchImpl) { try { const r = await fetchImpl(u, { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) vivoBI/1.0", "accept-language": "en-IN" } }); return r.ok ? await r.text() : ""; } catch (e) { return ""; } }
export function catalogPrompt(today, storeText) {
  return `Today is ${today}. You are building a price list for vivo India's sales team.
Using Google Search, https://www.vivo.com/in/products?choose=all and https://shop.vivo.com/in/products/phone (text copied below), list EVERY vivo smartphone currently on sale in India (X, V, S, T, Y series and any others; skip models no longer sold).
For each model give all RAM+storage variants with MRP and current best selling price in India (vivo e-store, Amazon.in, Flipkart or retail), and the colours.
Return ONLY one JSON object, no prose:
{"models":[{"name":"vivo V70","slug":"v70","series":"V","launched":"2026-03","url":"https://www.vivo.com/in/products/v70","colours":["Authentic Black"],"variants":[{"ram":"8GB","storage":"256GB","mrp":65999,"price":59999}]}]}
Rules: prices are whole rupees (numbers, no symbols); never invent values — leave a field out if unknown.
VIVO E-STORE TEXT:
${storeText || "(could not be loaded — use Google Search)"}`;
}
export function modelPrompt(today, name, slug, pageTxt) {
  return `Today is ${today}. Research the CURRENT offers in India for the smartphone "${name}" for vivo's sales and BI teams.
Look at https://www.vivo.com/in/products/${slug}, https://shop.vivo.com/in/ (offers/No Cost EMI pages), Amazon.in, Flipkart, vivo India's official announcements and recent news, and consumer-finance partners (${PARTNERS.join(", ")}).
Find:
- every variant (RAM+storage) with MRP and current best selling price, and colours per variant;
- EMI / consumer-finance offers by partner: bank cards, NBFC (Bajaj Finserv, HDB, TVS Credit, Home Credit, IDFC FIRST), POS/EMI networks (Pine Labs, Benow, Innoviti, Paytm, Mswipe). Write the scheme in Indian consumer-durable format "tenure/advance EMIs" (e.g. 10/0, 12/0, 24/0, 8/2) when known, list tenures, whether it is No Cost, and any instant discount or cashback;
- exchange offers and upgrade bonuses; V-Shield (vivo screen/damage protection) plans and prices; ABB (assured buy-back) offers; any other running offer (launch offer, free accessory, Jio/Airtel benefit).
Return ONLY one JSON object, no prose:
{"name":"${name}","series":"V","launched":"2026-03","url":"https://www.vivo.com/in/products/${slug}","highlights":["50MP ZEISS camera"],"colours":["..."],
"variants":[{"ram":"8GB","storage":"256GB","mrp":0,"price":0,"priceSource":"vivo e-store","colours":["..."]}],
"emi":[{"partner":"HDFC Bank","type":"Bank card","scheme":"12/0","tenures":["6","9","12"],"noCost":true,"benefit":"₹4,000 instant discount","details":"...","validTill":"2026-10-31","channel":"Online + offline retail","source":"https://..."}],
"exchange":[{"partner":"vivo","benefit":"Up to ₹5,000 extra","details":"...","validTill":"","channel":"","source":""}],
"upgrade":[],"vshield":[{"plan":"1 year screen damage","benefit":"₹999","details":"...","source":""}],"abb":[],"cashback":[],"other":[],
"notes":"what could not be confirmed"}
Rules: only offers that are running now or recently announced with a future end date; numbers in whole rupees; never invent — if unsure, say so in notes and leave it out; include a source URL for each offer when you have one.
VIVO PRODUCT PAGE TEXT:
${pageTxt || "(not loaded — use Google Search and URL reading)"}`;
}

// ---------- background job ----------
export async function runJob(store, env, jobId, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const job = await store.get(`affjob:${String(jobId || "").replace(/[^a-z0-9]/gi, "")}`);
  if (!job) return { ok: false, error: "no such job" };
  await store.delete(`affjob:${jobId}`);
  const t = now(), today = new Date(t + 5.5 * 3600000).toISOString().slice(0, 10);
  const lockK = `afflock:${job.kind === "catalog" ? "catalog" : job.slug}`;
  try {
    if (job.kind === "catalog") {
      const [p1, p2] = await Promise.all([grab("https://shop.vivo.com/in/products/phone", fetchImpl), grab("https://shop.vivo.com/in/products/phone?page=2", fetchImpl)]);
      const r = await researchJSON(env, catalogPrompt(today, (pageText(p1, 14000) + " " + pageText(p2, 8000)).trim()), fetchImpl);
      const old = (await store.get("affcat")) || {};
      if (!r.ok) { await store.set("affcat", Object.assign(old, { error: r.error, errorAt: now() })); return r; }
      const models = cleanCatalog(r.data);
      if (models.length < 3) { await store.set("affcat", Object.assign(old, { error: "AI returned too few models — try again later.", errorAt: now() })); return { ok: false, error: "too few models" }; }
      await store.set("affcat", { models, updatedAt: now(), sources: r.sources, model: r.model, by: job.by || "auto" });
      return { ok: true, n: models.length };
    }
    const html = await grab(`https://www.vivo.com/in/products/${job.slug}`, fetchImpl);
    const r = await researchJSON(env, modelPrompt(today, job.name, job.slug, pageText(html, 9000)), fetchImpl);
    const old = (await store.get(`affm:${job.slug}`)) || null;
    if (!r.ok) { await store.set(`affm:${job.slug}`, Object.assign(old || { slug: job.slug, name: job.name }, { error: r.error, errorAt: now() })); return r; }
    const m = cleanModel(r.data, { slug: job.slug, name: job.name, series: job.series, url: `https://www.vivo.com/in/products/${job.slug}` });
    m.updatedAt = now(); m.sources = r.sources; m.queries = r.queries; m.aiModel = r.model; m.by = job.by || "auto";
    await store.set(`affm:${job.slug}`, m);
    // keep the catalog's prices in step with the fresher model research
    const cat = await store.get("affcat");
    if (cat && cat.models && m.variants.length) {
      const c = cat.models.find((x) => x.slug === job.slug);
      if (c) { c.variants = m.variants.map((v) => ({ ram: v.ram, storage: v.storage, mrp: v.mrp, price: v.price, colours: v.colours })); const ps = m.variants.map((v) => v.price).filter(Boolean); if (ps.length) c.startPrice = Math.min(...ps); if (m.colours.length) c.colours = m.colours; await store.set("affcat", cat); }
    }
    return { ok: true };
  } finally {
    await store.delete(lockK);
  }
}

// Creates a job ticket and kicks the background function. Returns { started } or { reason }.
export async function startJob(ctx, kind, model, { force = false } = {}) {
  const { store, t, rec, env } = ctx;
  const lockK = `afflock:${kind === "catalog" ? "catalog" : model.slug}`;
  const lock = await store.get(lockK);
  if (lock && t - lock.at < LOCK_MS) return { started: false, running: true };
  const capK = `affcap:${istDay(t)}`, cap = (await store.get(capK)) || { n: 0 }, max = Number(env.AFF_DAILY_CAP || 150);
  if (cap.n >= max) return { started: false, reason: `Daily AI research limit (${max}) reached — showing the last saved data.` };
  if (!force && kind === "model") { const m = await store.get(`affm:${model.slug}`); if (m && m.errorAt && t - m.errorAt < 20 * 60000 && !m.updatedAt) return { started: false, reason: m.error }; }
  const id = t.toString(36) + randomBytes(6).toString("hex");
  await store.set(`affjob:${id}`, { kind, slug: model && model.slug, name: model && model.name, series: model && model.series, by: rec ? rec.fullName : "auto", at: t });
  await store.set(lockK, { at: t, job: id });
  await store.set(capK, { n: cap.n + 1 });
  try {
    const kick = ctx.jobFetch || fetch;
    const base = env.SITE_URL || "";
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null, tm = ac ? setTimeout(() => ac.abort(), 5000) : 0;
    try {
      const r = await kick(base + "/.netlify/functions/aff-refresh-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: id }), signal: ac ? ac.signal : undefined });
      if (r && r.status && r.status >= 400) throw new Error("status " + r.status);
    } catch (e) { if (!(e && e.name === "AbortError")) throw e; }   // slow ack: the job is still queued
    finally { clearTimeout(tm); }
  } catch (e) {
    await store.delete(lockK); await store.delete(`affjob:${id}`);
    return { started: false, reason: "Couldn't start the AI research (" + e.message + ")." };
  }
  return { started: true, job: id };
}

// ---------- session actions ----------
export async function affAction(b, ctx) {
  const { store, t, app, rec, pool, sameUser, who } = ctx;
  const isAdmin = app === "admin";
  const me = who(app, rec);
  const running = async (k) => { const l = await store.get(`afflock:${k}`); return !!(l && t - l.at < LOCK_MS); };

  if (b.action === "aff-catalog") {
    const cat = (await store.get("affcat")) || { models: [] };
    let start = null;
    if ((!cat.updatedAt || t - cat.updatedAt > CATALOG_TTL) && !(await running("catalog"))) start = await startJob(ctx, "catalog", null);
    const cap = (await store.get(`affcap:${istDay(t)}`)) || { n: 0 };
    return json(200, { ok: true, models: cat.models || [], updatedAt: cat.updatedAt || 0, sources: cat.sources || [], error: cat.error && (!cat.updatedAt || cat.errorAt > cat.updatedAt) ? cat.error : "",
      refreshing: (start && start.started) || (await running("catalog")), note: start && start.reason ? start.reason : "", partners: PARTNERS, kinds: KINDS, capUsed: cap.n, capMax: Number(ctx.env.AFF_DAILY_CAP || 150), state: rec.state || "", now: t });
  }

  if (b.action === "aff-model") {
    const slug = slugify(b.slug); if (!slug) return json(400, { ok: false, error: "Choose a model." });
    const cat = (await store.get("affcat")) || { models: [] };
    const base = cat.models.find((x) => x.slug === slug) || { slug, name: str(b.name, 60) || slug, series: "" };
    const m = await store.get(`affm:${slug}`);
    let start = null;
    if ((!m || !m.updatedAt || t - m.updatedAt > MODEL_TTL) && !(await running(slug))) start = await startJob(ctx, "model", base);
    const hidden = (await store.get(`affhide:${slug}`)) || {};
    const rks = await store.list(`affr:${slug}:`);
    const reports = (await pool(rks, 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => (y.verified - x.verified) || y.at - x.at);
    return json(200, { ok: true, base, model: m || null, hidden, reports, refreshing: (start && start.started) || (await running(slug)), note: start && start.reason ? start.reason : "", now: t });
  }

  if (b.action === "aff-many") {   // compare: cached data only (starts research for stale ones)
    const slugs = (Array.isArray(b.slugs) ? b.slugs : []).slice(0, 4).map(slugify).filter(Boolean);
    const cat = (await store.get("affcat")) || { models: [] };
    const out = [];
    for (const slug of slugs) {
      const base = cat.models.find((x) => x.slug === slug) || { slug, name: slug };
      const m = await store.get(`affm:${slug}`);
      let refreshing = await running(slug);
      if (!refreshing && (!m || !m.updatedAt || t - m.updatedAt > MODEL_TTL)) { const s = await startJob(ctx, "model", base); refreshing = !!s.started; }
      const rks = await store.list(`affr:${slug}:`);
      out.push({ slug, base, model: m || null, hidden: (await store.get(`affhide:${slug}`)) || {}, reports: (await pool(rks, 20, (k) => store.get(k))).filter(Boolean), refreshing });
    }
    return json(200, { ok: true, items: out, now: t });
  }

  if (b.action === "aff-states") {   // state-wise: all field/HO reports (optionally for one model)
    const slug = b.slug ? slugify(b.slug) : "";
    const rks = await store.list(slug ? `affr:${slug}:` : "affr:");
    const reports = (await pool(rks, 40, (k) => store.get(k))).filter((r) => r && (!r.validTill || r.validTill >= istDay(t - 7 * DAY)));
    return json(200, { ok: true, reports: reports.sort((x, y) => y.at - x.at).slice(0, 2000), now: t });
  }

  if (b.action === "aff-report-add") {
    const slug = slugify(b.slug); if (!slug) return json(400, { ok: false, error: "Choose a model." });
    const kind = KINDS.includes(b.kind) ? b.kind : "other";
    const details = str(b.details, 400);
    if (details.length < 5) return json(400, { ok: false, error: "Describe the offer (what the customer gets)." });
    const state = isAdmin ? str(b.state, 40) || "All India" : rec.state || "";
    if (!state) return json(400, { ok: false, error: "Your profile has no state." });
    let photo = "";
    if (b.photo) { const c = String(b.photo).replace(/[^a-z0-9]/gi, ""); const f = await store.get(`att:${c}`); if (f && sameUser(f.by, me) && /^image\//.test(f.mime)) photo = c; }
    const cat = (await store.get("affcat")) || { models: [] };
    const base = cat.models.find((x) => x.slug === slug);
    const id = t.toString(36) + randomBytes(3).toString("hex");
    const r = { id, slug, model: base ? base.name : str(b.model, 60) || slug, state, kind, partner: str(b.partner, 60), scheme: str(b.scheme, 20), benefit: str(b.benefit, 80), details, variant: str(b.variant, 30),
      validTill: /^\d{4}-\d{2}-\d{2}$/.test(String(b.validTill || "")) ? b.validTill : "", photo, by: Object.assign({}, me, { state: rec.state || "" }), at: t, verified: isAdmin, verifiedBy: isAdmin ? rec.fullName : "", official: isAdmin };
    await store.set(`affr:${slug}:${id}`, r);
    await ctx.logEvent(store, t, app, rec, "offer-reported", { device: (r.model + " · " + (r.partner || kind)).slice(0, 60), ver: "" });
    return json(200, { ok: true, report: r });
  }

  if (b.action === "aff-report-delete" || b.action === "aff-report-verify") {
    const k = `affr:${slugify(b.slug)}:${String(b.id || "").replace(/[^a-z0-9]/gi, "")}`;
    const r = await store.get(k);
    if (!r) return json(404, { ok: false, error: "Not found." });
    if (b.action === "aff-report-delete") {
      if (!isAdmin && !sameUser(r.by, me)) return json(403, { ok: false, error: "You can delete only your own reports." });
      await store.delete(k); return json(200, { ok: true });
    }
    if (!isAdmin) return json(403, { ok: false, error: "Only admins can verify offers." });
    r.verified = b.verified !== false; r.verifiedBy = r.verified ? rec.fullName : ""; r.verifiedAt = t;
    await store.set(k, r); return json(200, { ok: true, report: r });
  }

  if (b.action === "aff-photo") {   // photo attached to an offer report (any signed-in user)
    const k = `affr:${slugify(b.slug)}:${String(b.id || "").replace(/[^a-z0-9]/gi, "")}`, r = await store.get(k);
    if (!r || !r.photo) return json(404, { ok: false, error: "Not found." });
    const f = await store.get(`att:${r.photo}`);
    return f ? json(200, { ok: true, mime: f.mime, data: f.data }) : json(404, { ok: false, error: "Not found." });
  }

  if (!isAdmin) return json(403, { ok: false, error: "Only BI admins can do this." });

  if (b.action === "aff-refresh") {
    if (b.catalog) { const s = await startJob(ctx, "catalog", null, { force: true }); return json(200, { ok: true, ...s }); }
    const slug = slugify(b.slug); if (!slug) return json(400, { ok: false, error: "Choose a model." });
    const cat = (await store.get("affcat")) || { models: [] };
    const base = cat.models.find((x) => x.slug === slug) || { slug, name: str(b.name, 60) || slug };
    const s = await startJob(ctx, "model", base, { force: true });
    return json(200, { ok: true, ...s });
  }

  if (b.action === "aff-hide") {
    const slug = slugify(b.slug), key = String(b.key || "").replace(/[^a-f0-9]/g, "").slice(0, 12);
    if (!slug || !key) return json(400, { ok: false, error: "Bad request." });
    const h = (await store.get(`affhide:${slug}`)) || {};
    if (b.hidden === false) delete h[key]; else h[key] = { by: rec.fullName, at: t };
    await store.set(`affhide:${slug}`, h);
    return json(200, { ok: true, hidden: h });
  }

  if (b.action === "aff-status") {
    const cat = (await store.get("affcat")) || { models: [] };
    const rows = await pool(cat.models, 30, async (c) => { const m = await store.get(`affm:${c.slug}`); return { slug: c.slug, name: c.name, series: c.series, updatedAt: m ? m.updatedAt || 0 : 0, error: m && m.error && (!m.updatedAt || m.errorAt > m.updatedAt) ? m.error : "", offers: m ? KINDS.reduce((a, k) => a + (m[k] || []).length, 0) : 0, refreshing: await running(c.slug) }; });
    const cap = (await store.get(`affcap:${istDay(t)}`)) || { n: 0 };
    return json(200, { ok: true, catalog: { updatedAt: cat.updatedAt || 0, count: cat.models.length, error: cat.error || "", errorAt: cat.errorAt || 0, refreshing: await running("catalog"), sources: cat.sources || [] }, models: rows, capUsed: cap.n, capMax: Number(ctx.env.AFF_DAILY_CAP || 150) });
  }

  if (b.action === "aff-refresh-stale") {   // refresh up to N oldest models
    const cat = (await store.get("affcat")) || { models: [] };
    const n = Math.min(20, Math.max(1, Number(b.n) || 8));
    const rows = await pool(cat.models, 30, async (c) => { const m = await store.get(`affm:${c.slug}`); return { c, at: m ? m.updatedAt || 0 : 0 }; });
    const todo = rows.filter((r) => t - r.at > 6 * 3600000).sort((x, y) => x.at - y.at).slice(0, n);
    let started = 0, reason = "";
    for (const r of todo) { const s = await startJob(ctx, "model", r.c, { force: true }); if (s.started) started++; else if (s.reason) { reason = s.reason; break; } }
    return json(200, { ok: true, started, reason });
  }

  return json(400, { ok: false, error: "Unknown action" });
}

// Daily refresh (scheduled function): catalog if stale + the oldest models.
export async function dailyRefresh(store, env, { now = () => Date.now(), jobFetch = fetch, n = 12 } = {}) {
  const t = now(), ctx = { store, t, rec: { fullName: "auto" }, env, jobFetch };
  const cat = (await store.get("affcat")) || { models: [] };
  const out = { catalog: null, models: 0 };
  if (!cat.updatedAt || t - cat.updatedAt > CATALOG_TTL) out.catalog = await startJob(ctx, "catalog", null);
  const rows = [];
  for (const c of cat.models || []) { const m = await store.get(`affm:${c.slug}`); rows.push({ c, at: m ? m.updatedAt || 0 : 0 }); }
  for (const r of rows.filter((x) => t - x.at > MODEL_TTL).sort((x, y) => x.at - y.at).slice(0, n)) { const s = await startJob(ctx, "model", r.c); if (s.started) out.models++; else if (s.reason) break; }
  return out;
}
