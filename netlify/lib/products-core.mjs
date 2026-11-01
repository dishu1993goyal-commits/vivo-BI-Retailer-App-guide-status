// Product hub + AI recommendation. The vivo model list and prices come from the Affordability catalog (affcat/affm);
// HO adds launch info, images, videos and highlights (prod:<slug>); AI fills specifications and a competitor
// comparison on demand (prodai:<slug>). The recommendation assistant matches catalog models to a customer's answers.
// Storage:  prod:<slug> { launch, mrp, highlights[], videos[], images[], note, by, at }
//           prodai:<slug> { at, data }        config:advis { questions:[…] }
import { groqJSON, aiKeys, slugify, nameKey } from "./aff-core.mjs";
import { createHash, randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const okUrl = (u) => /^https:\/\/[^\s"'<>]{6,600}$/i.test(String(u || "")) ? String(u) : "";
const okImg = (u) => /^(https:\/\/|\/api\/auth\?img=)[^\s"'<>]{4,600}$/i.test(String(u || "")) ? String(u) : "";
const minPrice = (m) => { const ps = (m && m.variants || []).map((v) => v.price).filter(Boolean); return ps.length ? Math.min(...ps) : null; };

export const ADVIS_QUESTIONS = [
  { id: "budget", q: "What is the customer's budget?", type: "one", opts: ["Under ₹15,000", "₹15,000 – ₹25,000", "₹25,000 – ₹40,000", "₹40,000 – ₹70,000", "Above ₹70,000"] },
  { id: "use", q: "What will they use the phone for most? (choose up to 3)", type: "many", max: 3, opts: ["Gaming & performance", "Photography & selfies", "Long battery / heavy use", "Big bright screen / video", "Everyday & social apps", "Premium design & status"] },
  { id: "camera", q: "How important is the camera?", type: "one", opts: ["Very important", "Nice to have", "Not a priority"] },
  { id: "who", q: "Who is it for?", type: "one", opts: ["Young / student", "Professional", "Family / parent", "Content creator", "First smartphone"] }
];
function cleanQ(a) { return (Array.isArray(a) ? a : ADVIS_QUESTIONS).slice(0, 8).map((x, i) => ({ id: str(x.id, 20).replace(/[^a-z0-9_]/gi, "") || "q" + i, q: str(x.q, 160) || "Question", type: x.type === "many" ? "many" : "one", max: Math.max(1, Math.min(4, Number(x.max) || 3)), opts: (Array.isArray(x.opts) ? x.opts : []).slice(0, 8).map((o) => str(o, 80)).filter(Boolean) })).filter((x) => x.opts.length); }

export async function productsAction(b, ctx) {
  const { store, t, app, rec, pool, env = {} } = ctx, isAdmin = app === "admin", f = ctx.aiFetch || fetch;
  const cat = async () => (await store.get("affcat")) || { models: [] };
  const aiRun = async (prompt, validate, ck) => {
    const k = "prodai:" + createHash("sha1").update(ck || prompt).digest("hex").slice(0, 20), hit = ck ? await store.get(k) : null;
    if (hit && t - hit.at < 20 * 864e5) return { ok: true, data: hit.data, cached: true };
    const keys = await aiKeys(store, env); if (!keys.groq) return { ok: false, error: "AI key not set (Affordability → Data → Groq key)." };
    const r = await groqJSON(keys.groq, prompt, f, { validate });
    if (r.ok && ck) await store.set(k, { at: t, data: r.data });
    return r;
  };

  if (b.action === "phub-list") {
    const c = await cat(), models = await pool(c.models.slice(0, 200), 30, async (x) => { const m = await store.get(`affm:${x.slug}`), ho = await store.get(`prod:${x.slug}`); return { slug: x.slug, name: x.name, series: x.series || "", price: minPrice(m), img: (ho && (ho.images || [])[0]) || "", launch: ho ? ho.launch : "", hasHO: !!ho }; });
    const series = {}; models.forEach((m) => { if (m.series) series[m.series] = (series[m.series] || 0) + 1; });
    return json(200, { ok: true, models: models.sort((a, c2) => (c2.price || 0) - (a.price || 0)), series: Object.keys(series).sort(), updatedAt: c.updatedAt || 0 });
  }
  if (b.action === "phub-get") {
    const slug = slugify(b.slug); if (!slug) return json(400, { ok: false, error: "Choose a product." });
    const c = await cat(), base = c.models.find((x) => x.slug === slug) || { slug, name: str(b.name, 60) || slug, series: "" };
    const m = await store.get(`affm:${slug}`), ho = await store.get(`prod:${slug}`), ai = await store.get(`prodai:spec:${slug}`);
    return json(200, { ok: true, product: { slug, name: base.name, series: base.series || "", variants: (m && m.variants) || [], colours: (m && m.colours) || [], price: minPrice(m),
      launch: ho ? ho.launch : "", mrp: ho ? ho.mrp : 0, highlights: ho ? ho.highlights || [] : [], videos: ho ? ho.videos || [] : [], images: ho ? ho.images || [] : [], note: ho ? ho.note : "",
      spec: ai ? ai.data : null } });
  }
  if (b.action === "phub-ai") {   // AI specifications + competitor comparison for a model
    const slug = slugify(b.slug), c = await cat(), base = c.models.find((x) => x.slug === slug); if (!base) return json(404, { ok: false, error: "Model not found." });
    const m = await store.get(`affm:${slug}`), price = minPrice(m);
    const prompt = `You are a vivo India product expert briefing retail staff. Give the key specifications and a competitor comparison for the phone "${base.name}"${price ? ` (around ₹${price})` : ""}.
Use well-known facts; if unsure of an exact figure, give the typical value for this model and mark it approximate in "note". Keep it India-market.
Return JSON only: {"tagline":"one line","specs":[{"label":"Display","value":""},{"label":"Processor","value":""},{"label":"Rear camera","value":""},{"label":"Front camera","value":""},{"label":"Battery & charging","value":""},{"label":"RAM & storage","value":""},{"label":"OS","value":""},{"label":"Other highlights","value":""}],"strengths":["",""],"bestFor":"one line on the ideal buyer","competitors":[{"brand":"","model":"","price":"₹","vs":"one line: how this vivo compares / what vivo does better"}],"pitch":"2-3 sentence sales pitch for the retailer","note":""}`;
    const r = await aiRun(prompt, (d) => d && Array.isArray(d.specs), "spec|" + slug + "|" + base.name);
    if (!r.ok) return json(200, { ok: false, error: r.error });
    if (!r.cached) await store.set(`prodai:spec:${slug}`, { at: t, data: r.data });
    return json(200, { ok: true, spec: r.data });
  }
  if (b.action === "advis-questions") { const cfg = await store.get("config:advis"); return json(200, { ok: true, questions: cleanQ(cfg && cfg.questions) }); }
  if (b.action === "advis-ask") {   // recommend vivo models from the answers
    const c = await cat(), list = await pool(c.models.slice(0, 120), 30, async (x) => { const m = await store.get(`affm:${x.slug}`); return { slug: x.slug, name: x.name, series: x.series || "", price: minPrice(m) }; });
    const avail = list.map((x) => ({ name: x.name, series: x.series, price: x.price || undefined }));
    const answers = str(JSON.stringify(b.answers || {}), 2000);
    if (!avail.length) return json(200, { ok: false, error: "The product catalogue isn't ready yet — open Affordability once to load it." });
    const prompt = `You are a vivo India sales assistant helping a retailer pick the right vivo phone for a customer. From ONLY the MODELS list, recommend the 2-3 best matches for the customer's ANSWERS.
Each model may include an approx price ₹; where it is missing, use the typical current India price you know for that exact model. Respect the customer's budget band. Prefer models whose strengths fit the stated usage (gaming→performance, photography→camera, battery, screen, etc.). Never invent a model not in the list.
Return JSON only: {"picks":[{"name":"exact model name","why":"2 sentences on why it fits this customer","highlight":"one standout feature","price":"₹"}],"tip":"one upsell/cross-sell line for the retailer"}
MODELS: ${JSON.stringify(avail)}
ANSWERS: ${answers}`;
    const r = await aiRun(prompt, (d) => d && Array.isArray(d.picks) && d.picks.length);
    if (!r.ok) return json(200, { ok: false, error: r.error });
    const names = {}; avail.forEach((x) => { names[nameKey(x.name)] = x; });
    const picks = r.data.picks.slice(0, 3).map((p) => { const hit = names[nameKey(p.name)]; return hit ? { name: hit.name, slug: slugify(hit.name), why: str(p.why, 300), highlight: str(p.highlight, 100), price: hit.price || 0, priceText: str(p.price, 24) } : null; }).filter(Boolean);
    try { await ctx.logEvent(store, t, app, rec, "advis-ask", { device: picks.map((p) => p.name).join(", ").slice(0, 55), ver: "" }); } catch (e) { }
    return json(200, { ok: true, picks, tip: str(r.data.tip, 200) });
  }

  if (!isAdmin) return json(403, { ok: false, error: "Only HO admins can edit products." });
  if (b.action === "phub-save") {
    const slug = slugify(b.slug); if (!slug) return json(400, { ok: false, error: "Choose a product." });
    const x = b.data || {}, d = { launch: str(x.launch, 40), mrp: Math.max(0, Number(x.mrp) || 0), note: str(x.note, 600),
      highlights: (Array.isArray(x.highlights) ? x.highlights : []).slice(0, 10).map((h) => str(h, 120)).filter(Boolean),
      videos: (Array.isArray(x.videos) ? x.videos : []).slice(0, 10).map((v) => okUrl(v)).filter(Boolean),
      images: (Array.isArray(x.images) ? x.images : []).slice(0, 12).map((i) => okImg(i)).filter(Boolean), by: rec.fullName || rec.username, at: t };
    await store.set(`prod:${slug}`, d); return json(200, { ok: true });
  }
  if (b.action === "advis-save") { await store.set("config:advis", { questions: cleanQ(b.questions), by: rec.fullName, at: t }); return json(200, { ok: true, questions: cleanQ(b.questions) }); }
  return json(400, { ok: false, error: "Unknown action." });
}
