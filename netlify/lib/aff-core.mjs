import { cleanExtra } from "./master-core.mjs";
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
// Same phone however it's written: "vivo T5x 5G" = "T5x" ; "Y31 5G" = "vivo Y31".
export const nameKey = (s) => String(s || "").toLowerCase().replace(/^vivo\s+/, "").replace(/\b5g\b/g, "").replace(/[^a-z0-9+]/g, "");
export const slugify = (s) => String(s || "").toLowerCase().replace(/^vivo\s+/, "").replace(/\+/g, " plus").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const DAY = 86400000;
export const MODEL_TTL = 3 * DAY, CATALOG_TTL = 7 * DAY, LOCK_MS = 4 * 60000, START_MS = 2 * 60000, RETRY_MS = 15 * 60000;
// A lock is alive while the worker keeps sending heartbeats, or while we're still waiting for it to pick the job up.
export const lockAlive = (l, t) => !!l && (l.startedAt ? t - (l.beat || l.startedAt) < LOCK_MS : t - l.at < START_MS);
// Clears a dead lock and records why (so the page shows a reason instead of spinning).
async function reapLock(store, t, key) {
  const lk = `afflock:${key}`, l = await store.get(lk);
  if (!l || lockAlive(l, t)) return l && lockAlive(l, t) ? l : null;
  await store.delete(lk);
  const why = l.startedAt ? "The AI research stopped without finishing (last step: " + (l.stage || "?") + ")." : "The background research worker didn't start. Check that the latest site deploy finished on Netlify.";
  const dk = key === "catalog" ? "affcat" : `affm:${key}`, d = (await store.get(dk)) || (key === "catalog" ? { models: [] } : { slug: key });
  d.error = why; d.errorAt = t; await store.set(dk, d);
  return null;
}
const KINDS = ["emi", "exchange", "upgrade", "vshield", "abb", "cashback", "other"];
export const PARTNERS = ["Bajaj Finserv", "Pine Labs", "HDB Financial", "TVS Credit", "Home Credit", "IDFC FIRST Bank", "HDFC Bank", "ICICI Bank", "SBI Card", "Axis Bank", "Kotak Bank", "OneCard", "Benow", "Innoviti", "Paytm", "Mswipe", "Razorpay", "vivo"];
const RESEARCH_MODELS = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-flash-lite-latest"];
const istDay = (t) => new Date(t + 5.5 * 3600000).toISOString().slice(0, 10);
export const offerKey = (kind, o) => createHash("sha1").update(kind + "|" + String(o.partner || "") + "|" + String(o.scheme || "") + "|" + String(o.details || o.plan || "")).digest("hex").slice(0, 12);

// ---------- Gemini with Google Search + URL reading ----------
// Rebuilds a JSON object from an answer that was cut off (keeps every complete item).
function salvage(t) {
  const stack = [], marks = []; let inS = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inS) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inS = false; continue; }
    if (c === '"') inS = true; else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") { stack.pop(); if (c === "}" && stack[stack.length - 1] === "[") marks.push([i, stack.slice()]); }
  }
  for (let k = marks.length - 1; k >= 0 && k >= marks.length - 400; k--) {
    const [i, st] = marks[k];
    try { return JSON.parse(t.slice(0, i + 1) + st.slice().reverse().map((x) => (x === "[" ? "]" : "}")).join("")); } catch (e) { }
  }
  return null;
}
export function parseJSON(text) {
  let t = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{"); if (a < 0) return null;
  t = t.slice(a);
  const b = t.lastIndexOf("}");
  if (b > 0) {
    const whole = t.slice(0, b + 1);
    try { return JSON.parse(whole); } catch (e) { }
    try { return JSON.parse(whole.replace(/,\s*([}\]])/g, "$1")); } catch (e) { }
  }
  return salvage(t);
}
// opts: { noToolsLast: true } also tries a plain call using only the page text in the prompt; onStage(msg) for progress.
export async function researchJSON(env, prompt, fetchImpl = fetch, opts = {}) {
  if (!env || !env.GEMINI_API_KEY) return { ok: false, error: "AI is not set up (GEMINI_API_KEY missing)." };
  const models = env.GEMINI_RESEARCH_MODEL ? [env.GEMINI_RESEARCH_MODEL, ...RESEARCH_MODELS] : RESEARCH_MODELS;
  const toolSets = [[{ google_search: {} }, { url_context: {} }], [{ google_search: {} }]];
  const tries = [];
  if (!opts.plainOnly) models.forEach((m) => toolSets.forEach((tools) => tries.push([m, tools])));
  else ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"].forEach((m) => tries.push([m, null]));
  if (opts.noToolsLast) ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"].forEach((m) => tries.push([m, null]));
  const errs = [], badModel = {}; let quota = 0;
  for (const [m, tools] of tries) {
    if (badModel[m]) continue;
    if (quota >= 2) return { ok: false, quota: true, error: "Gemini's free quota is used up for today (429).", tried: errs };
    if (opts.onStage) await opts.onStage((tools ? "Searching Google" : "Reading vivo.com text") + " with " + m);
    const gen = { temperature: 0.15, maxOutputTokens: 32000 };
    const body = JSON.stringify(Object.assign({ contents: [{ role: "user", parts: [{ text: tools || opts.plainOnly ? prompt : prompt + "\n\nYou have no web access now: use ONLY the page text above; leave out anything it doesn't show." }] }], generationConfig: gen }, tools ? { tools } : {}));
    let r, j;
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null, tm = ac ? setTimeout(() => ac.abort(), opts.timeoutMs || 110000) : 0;
    try {
      r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body, signal: ac ? ac.signal : undefined });
      j = await r.json().catch(() => ({}));
    } catch (e) { errs.push(m + ": " + (e.name === "AbortError" ? "timed out" : "network " + e.message)); continue; }
    finally { clearTimeout(tm); }
    if (r.ok) {
      const cand = (j.candidates || [])[0] || {};
      const text = ((cand.content || {}).parts || []).map((p) => p.text || "").join("");
      const data = parseJSON(text);
      if (!data) { errs.push(m + (tools ? "" : " (no tools)") + ": unreadable answer (" + (cand.finishReason || "no text") + ", " + text.length + " chars)"); continue; }
      if (opts.validate && !opts.validate(data)) { errs.push(m + (tools ? "" : " (no tools)") + ": answer had no usable items"); continue; }
      const gm = cand.groundingMetadata || {};
      const sources = [];
      (gm.groundingChunks || []).forEach((c) => { const w = c.web || {}; if (w.uri && sources.length < 15 && !sources.some((s) => s.title === w.title)) sources.push({ title: str(w.title, 80) || "source", url: str(w.uri, 600) }); });
      ((cand.urlContextMetadata || cand.url_context_metadata || {}).urlMetadata || []).forEach((u) => { const url = u.retrievedUrl || u.retrieved_url; if (url && sources.length < 18) sources.push({ title: url.replace(/^https?:\/\//, "").slice(0, 60), url }); });
      return { ok: true, data, sources, model: m, grounded: !!tools, truncated: cand.finishReason === "MAX_TOKENS", queries: (gm.webSearchQueries || []).slice(0, 8), tried: errs };
    }
    const msg = r.status + (j.error && j.error.message ? " " + j.error.message.slice(0, 160) : "");
    errs.push(m + (tools ? "" : " (no tools)") + ": " + msg);
    if (r.status === 401 || (r.status === 403 && /key|permission|API_KEY/i.test(msg))) return { ok: false, error: "The Gemini API key was rejected: " + msg, tried: errs };
    if (r.status === 429 && /exceeded your current quota|RESOURCE_EXHAUSTED/i.test(msg)) quota++;
    if (r.status === 404) badModel[m] = 1;          // model name not available for this key
    else if (r.status === 429 && /day|daily|PerDay/i.test(msg) && tools) { /* grounding quota for this model: try the next */ }
  }
  return { ok: false, error: ("AI research failed. " + errs.map((e) => e.slice(0, 110)).join(" | ")).slice(0, 900), tried: errs };
}

// ---------- other free research sources (when Gemini's quota is used up) ----------
// Tavily: web search API (free plan, no card). Groq: fast LLM API (free plan, no card) that turns search results into JSON.
export async function tavilySearch(key, query, fetchImpl = fetch, { max = 6, depth = "basic" } = {}) {
  try {
    const r = await fetchImpl("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({ query, search_depth: depth, max_results: max, include_answer: false, include_raw_content: false, country: "india" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: "Tavily " + r.status + " " + String((j.detail && (j.detail.error || j.detail)) || j.error || j.message || "").slice(0, 120) };
    return { ok: true, results: (j.results || []).map((x) => ({ title: str(x.title, 120), url: str(x.url, 500), content: str(x.content, 1400) })).filter((x) => x.url) };
  } catch (e) { return { ok: false, error: "Tavily network " + e.message }; }
}
const GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
export async function groqJSON(key, prompt, fetchImpl = fetch, { validate, browse = false } = {}) {
  const errs = [];
  for (const m of browse ? ["openai/gpt-oss-120b", "openai/gpt-oss-20b"] : GROQ_MODELS) {
    const body = { model: m, messages: [{ role: "system", content: "You are a careful research assistant for vivo India's sales team. Reply with ONE JSON object only." }, { role: "user", content: prompt }], temperature: 0.1, max_completion_tokens: 8000 };
    if (browse) { body.tools = [{ type: "browser_search" }]; body.tool_choice = "required"; body.reasoning_effort = "low"; } else { body.response_format = { type: "json_object" }; if (/gpt-oss/.test(m)) body.reasoning_effort = "low"; }
    try {
      const r = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const msg = r.status + " " + String((j.error && j.error.message) || "").slice(0, 120); errs.push("Groq " + m + ": " + msg); if (r.status === 401) break; continue; }
      const text = (((j.choices || [])[0] || {}).message || {}).content || "";
      const data = parseJSON(text);
      if (!data) { errs.push("Groq " + m + ": unreadable answer"); continue; }
      if (validate && !validate(data)) { errs.push("Groq " + m + ": answer had no usable items"); continue; }
      const urls = browse ? [...new Set(text.match(/https?:\/\/[^\s)\]"'<>]+/g) || [])].slice(0, 12).map((u) => ({ title: u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0], url: u })) : [];
      return { ok: true, data, model: "groq/" + m, sources: urls };
    } catch (e) { errs.push("Groq " + m + ": network " + e.message); }
  }
  return { ok: false, error: errs.join(" | ") };
}
export async function aiKeys(store, env) {
  const c = (await store.get("config:aikeys")) || {};
  return { groq: env.GROQ_API_KEY || c.groq || "", tavily: env.TAVILY_API_KEY || c.tavily || "" };
}
// Tries every available source in turn. task: { prompt, queries:[...], pageText, validate }
export async function research(store, env, task, { fetchImpl = fetch, now = () => Date.now(), onStage = async () => { } } = {}) {
  const keys = await aiKeys(store, env), day = istDay(now()), errs = [];
  const qk = `aiq:gemini:${day}`;
  const geminiOut = async () => !!(await store.get(qk));
  // 1) Tavily web search → Groq (or Gemini without tools) writes the JSON
  if (keys.tavily && task.queries && task.queries.length) {
    const results = [], seen = {};
    for (const q of task.queries) {
      await onStage("Searching the web: " + q.slice(0, 60));
      const r = await tavilySearch(keys.tavily, q, fetchImpl);
      if (!r.ok) { errs.push(r.error); if ([401, 403, 429, 432, 433].includes(r.status)) break; continue; }
      r.results.forEach((x) => { if (!seen[x.url] && results.length < 18) { seen[x.url] = 1; results.push(x); } });
    }
    if (results.length) {
      const ctxText = results.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n${x.content}`).join("\n\n").slice(0, 22000);
      const p2 = task.prompt + "\n\nWEB SEARCH RESULTS (use these as your sources; put the matching URL in each item's \"source\"):\n" + ctxText;
      const sources = results.slice(0, 15).map((x) => ({ title: x.title.slice(0, 80) || x.url, url: x.url }));
      if (keys.groq) {
        await onStage("Groq is reading " + results.length + " search results");
        const g = await groqJSON(keys.groq, p2, fetchImpl, { validate: task.validate });
        if (g.ok) return { ok: true, data: g.data, sources, model: "Tavily + " + g.model, grounded: true, tried: errs };
        errs.push(g.error);
      }
      if (env.GEMINI_API_KEY && !(await geminiOut())) {
        const r = await researchJSON(env, p2, fetchImpl, { plainOnly: true, validate: task.validate, onStage });
        if (r.ok) return Object.assign(r, { sources, model: "Tavily + " + r.model, grounded: true, tried: errs });
        if (r.quota) await store.set(qk, { at: now() });
        errs.push(r.error);
      }
    } else if (!errs.length) errs.push("Tavily: no results");
  }
  // 2) Groq with its own browser search
  if (keys.groq) {
    await onStage("Groq web search");
    const g = await groqJSON(keys.groq, task.prompt, fetchImpl, { validate: task.validate, browse: true });
    if (g.ok) return { ok: true, data: g.data, sources: g.sources, model: g.model + " (browser search)", grounded: true, tried: errs };
    errs.push(g.error);
  }
  // 3) Gemini with Google Search (skipped for the rest of the day once its quota is used up)
  if (env.GEMINI_API_KEY && !(await geminiOut())) {
    const r = await researchJSON(env, task.prompt, fetchImpl, { validate: task.validate, onStage, timeoutMs: task.timeoutMs });
    if (r.ok) return Object.assign(r, { tried: errs });
    if (r.quota) await store.set(qk, { at: now() });
    errs.push(r.error);
  } else if (env.GEMINI_API_KEY) errs.push("Gemini skipped: its free quota is used up for today");
  // 4) vivo.com page text only (no web search)
  if (task.pageText && task.pageText.length > 300 && keys.groq) {
    await onStage("Reading vivo.com text with Groq");
    const g = await groqJSON(keys.groq, task.prompt + "\n\nYou have no web access: use ONLY the page text above; leave out anything it doesn't show.", fetchImpl, { validate: task.validate });
    if (g.ok) return { ok: true, data: g.data, sources: [], model: g.model + " (vivo.com text only)", grounded: false, tried: errs };
    errs.push(g.error);
  }
  if (!keys.tavily && !keys.groq) errs.push("No free research keys saved yet (admin: Data tab → Research sources)");
  return { ok: false, error: ("Research failed. " + errs.map((e) => String(e).slice(0, 140)).join(" | ")).slice(0, 900), tried: errs };
}

// ---------- vivo e-store listing read directly (no AI) ----------
// Listing text looks like: "V70 8GB+256GB Authentic Black ₹59,999 ₹65,999" (one card per model).
export function parseStoreListing(text) {
  const out = [], seen = {};
  const re = /((?:vivo\s+)?(?:[A-Z]\s)?[A-Z][A-Za-z0-9]{0,8}\d[A-Za-z0-9]{0,4}(?:\s(?:Pro\+?|Ultra|Lite|FE|Elite|Plus|Prime|Neo|Max|\d{2,3}W|5G|4G))*)\s+(\d{1,2})\s?GB\s?\+\s?(\d{1,4})\s?(GB|TB)\s+([A-Za-z][A-Za-z ]{2,28}?)\s+(?:₹|Rs\.?|INR)\s?([\d,]{4,9})(?:\s+(?:MRP\s*)?(?:₹|Rs\.?|INR)\s?([\d,]{4,9}))?/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].replace(/^vivo\s+/i, "").trim();
    const k = nameKey(name), price = num(m[6]), mrp = num(m[7]);
    const v = { ram: m[2] + "GB", storage: m[3] + m[4], price: price && mrp ? Math.min(price, mrp) : price, mrp: price && mrp ? Math.max(price, mrp) : null, colours: [m[5].trim()], priceSource: "vivo e-store" };
    if (!seen[k]) { seen[k] = { name: "vivo " + name, variants: [] }; out.push(seen[k]); }
    if (!seen[k].variants.some((x) => x.ram === v.ram && x.storage === v.storage)) seen[k].variants.push(v);
  }
  return out;
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
    if (!x || typeof x !== "object") return null;
    const name = str(x.name || x.n, 60); if (!name) return null;
    const slug = slugify(x.slug || name), nk = "k:" + nameKey(name); if (!slug || seen[slug] || seen[nk]) return null; seen[slug] = 1; seen[nk] = 1;
    const variants = cleanVariants((x.variants || x.v || []).map((v) => Array.isArray(v) ? { ram: v[0], storage: v[1], mrp: v[2], price: v[3] } : v));
    if (!x.series && x.s) x.series = x.s;
    if (!x.colours && x.c) x.colours = x.c;
    const prices = variants.map((v) => v.price).filter(Boolean);
    return { slug, name: /^vivo/i.test(name) ? name : "vivo " + name, series: str(x.series, 20) || (name.replace(/^vivo\s+/i, "").match(/^[A-Za-z]+/) || [""])[0].toUpperCase(), launched: str(x.launched, 20),
      variants, colours: (Array.isArray(x.colours || x.colors) ? (x.colours || x.colors) : []).slice(0, 12).map((c) => str(c, 40)).filter(Boolean), startPrice: prices.length ? Math.min(...prices) : null, url: url(x.url) };
  }).filter(Boolean).sort((a, b) => sRank(a.series) - sRank(b.series) || a.series.localeCompare(b.series) || (b.startPrice || 0) - (a.startPrice || 0));
}

// ---------- prompts ----------
function pageText(html, n) { return String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").slice(0, n); }
async function grab(u, fetchImpl) { try { const r = await fetchImpl(u, { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) vivoBI/1.0", "accept-language": "en-IN" } }); return r.ok ? await r.text() : ""; } catch (e) { return ""; } }
// ---------- phone photos & banners from vivo.com (vivo's own image server) ----------
//   affimg:<slug>  { slug, at, src, phone, colours:[{name,url}], images:[url], banners:[url], set:{phone,banners} (HO override) }
//   affimgs        { <slug>: phoneUrl }  small index for thumbnails in the model list
const IMG_TTL = 7 * DAY;
const IMG_RE = /(?:https?:)?\/\/[a-z0-9.-]*vivo(?:fs)?\.com\/[^"'\s)<>\\]+?\.(?:png|jpe?g|webp)(?:\?[^"'\s)<>\\]*)?/gi;
const absU = (u) => { u = String(u || "").replace(/&amp;/g, "&").trim(); if (u.startsWith("//")) u = "https:" + u; return /^https:\/\/[a-z0-9.-]*vivo(fs)?\.com\//i.test(u) ? u.slice(0, 500) : ""; };
const tsOf = (u) => { const m = /\/(1[5-9]\d{11})\//.exec(u); return m ? +m[1] : 0; };
export function extractImages(html, colours) {
  html = String(html || "").replace(/\\\//g, "/");
  const out = [], seen = {}, cols = [], add = (u) => { u = absU(u); if (u && !seen[u] && !/logo|icon|favicon|sprite|qrcode|qr-code/i.test(u)) { seen[u] = 1; out.push(u); } return u; };
  const og = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)/i.exec(html);
  const ogU = og ? add(og[1]) : "";
  const cl = (colours || []).map((c) => String(c).toLowerCase()).filter(Boolean);
  (html.match(/<img\b[^>]*>/gi) || []).forEach((tag) => {
    const a = (k) => { const m = new RegExp("\\s" + k + "\\s*=\\s*[\"']([^\"']*)", "i").exec(tag); return m ? m[1] : ""; };
    const u = add(a("data-src") || a("data-original") || a("src") || (a("srcset").split(/[\s,]+/)[0]));
    const alt = (a("alt") || a("title")).toLowerCase().trim();
    if (u && alt && cl.some((c) => alt.includes(c) || c.includes(alt)) && !cols.some((x) => x.url === u)) cols.push({ name: cl.find((c) => alt.includes(c) || c.includes(alt)), url: u });
  });
  (html.match(IMG_RE) || []).forEach(add);
  // product pictures are uploaded with the launch; site-wide assets are much older — keep the recent ones
  const maxTs = Math.max(0, ...out.map(tsOf));
  const fresh = out.filter((u) => !maxTs || !tsOf(u) || tsOf(u) >= maxTs - 400 * DAY);
  return { og: ogU, colours: cols, images: fresh.slice(0, 40) };
}
function vivoSlugs(slug, url) {
  const m = /vivo\.com\/in\/products\/(?:param\/)?([a-z0-9-]+)/i.exec(String(url || ""));
  return [...new Set([m && m[1], slug, slug.replace(/-5g$/, ""), slug.replace(/-5g$/, "") + "-5g"].filter(Boolean))].slice(0, 4);
}
export async function fetchModelImages(slug, { url, colours, fetchImpl = fetch, mainHtml = "" } = {}) {
  for (const vs of vivoSlugs(slug, url)) {
    const [par, main] = await Promise.all([grab(`https://www.vivo.com/in/products/param/${vs}`, fetchImpl), mainHtml && vs === slug ? Promise.resolve(mainHtml) : grab(`https://www.vivo.com/in/products/${vs}`, fetchImpl)]);
    if (par.length < 500 && main.length < 500) continue;
    const P = extractImages(par, colours), M = extractImages(main, colours);
    const colourImgs = P.colours.length ? P.colours : M.colours;
    const phone = (colourImgs[0] && colourImgs[0].url) || P.images[0] || M.og || "";
    const banners = [M.og].concat(M.images).filter((u, i, a) => u && a.indexOf(u) === i && !colourImgs.some((c) => c.url === u)).slice(0, 14);
    if (phone || banners.length) return { src: vs, phone, colours: colourImgs.slice(0, 12), images: P.images.slice(0, 12), banners };
  }
  return null;
}
export async function saveModelImages(store, slug, r, t) {
  const old = (await store.get(`affimg:${slug}`)) || {};
  const rec = Object.assign({ slug }, r || { phone: old.phone || "", colours: old.colours || [], images: old.images || [], banners: old.banners || [], failed: true }, { at: t, set: old.set });
  await store.set(`affimg:${slug}`, rec);
  const ph = (rec.set && rec.set.phone) || rec.phone;
  if (ph) { const idx = (await store.get("affimgs")) || {}; if (idx[slug] !== ph) { idx[slug] = ph; await store.set("affimgs", idx); } }
  return rec;
}
// Starter list (from vivo.com/in and shop.vivo.com/in, Oct 2026) so the page works before/without AI; AI research adds prices and new models.
export const SEED = [["vivo X Fold6", "X", "x-fold6"], ["vivo X300 Ultra", "X", "x300-ultra"], ["vivo X300 Pro", "X", "x300-pro"], ["vivo X300", "X", "x300"], ["vivo X300 FE", "X", "x300-fe"],
  ["vivo V80", "V", "v80"], ["vivo V70 Elite", "V", "v70-elite"], ["vivo V70", "V", "v70"], ["vivo S2", "S", "s2"], ["vivo S2 FE", "S", "s2-fe"],
  ["vivo T5 5G", "T", "t5-5g"], ["vivo T5x 5G", "T", "t5x"], ["vivo T5 Lite 44W 5G", "T", "t5-lite-44w-5g"], ["vivo T5e", "T", "t5e"],
  ["vivo Y51 Pro 5G", "Y", "y51-pro-5g"], ["vivo Y400 5G", "Y", "y400-5g"], ["vivo Y31t 5G", "Y", "y31t-5g"], ["vivo Y31 5G", "Y", "y31-5g"], ["vivo Y21 5G", "Y", "y21-5g"], ["vivo Y11 5G", "Y", "y11-5g"], ["vivo Y05", "Y", "y05"]];
export function seedCatalog() { return cleanCatalog({ models: SEED.map((x) => ({ name: x[0], series: x[1], slug: x[2] })) }).map((m) => Object.assign(m, { seed: true })); }
export const CAT_GROUPS = [["X", "X series (flagships and X Fold)"], ["V", "V series"], ["ST", "S series and T series"], ["Y", "Y series and any other vivo phones"]];
export function catalogPrompt(today, storeText, group) {
  const g = group || ["", "all series (X, V, S, T, Y and others)"];
  return `Today is ${today}. You are building a price list for vivo India's sales team.
Using Google Search, https://www.vivo.com/in/products?choose=all and https://shop.vivo.com/in/products/phone (text copied below), list EVERY vivo ${g[1]} smartphone currently on sale in India (skip models no longer sold).
For each model give all RAM+storage variants with MRP and current best selling price in India (vivo e-store, Amazon.in, Flipkart or retail), and the colours.
Return ONLY one JSON object, no prose:
{"models":[{"n":"vivo V70","s":"V","v":[["8GB","256GB",65999,59999],["12GB","256GB",69999,63999]],"c":["Authentic Black","Pearl White"]}]}
Keys: n = model name, s = series letter, v = variants as [RAM, storage, MRP, best price], c = colours.
Rules: keep it compact (no other keys, no spaces needed); prices are whole rupees (numbers, no symbols; use 0 if unknown); never invent models.
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
  const lock0 = (await store.get(lockK)) || { at: t, job: jobId };
  const beat = async (stage) => { lock0.startedAt = lock0.startedAt || now(); lock0.beat = now(); lock0.stage = stage; await store.set(lockK, lock0); };
  const deadline = t + 12 * 60000;
  const ropts = { noToolsLast: true, onStage: async (msg) => { if (now() > deadline) throw new Error("took too long"); await beat(msg); } };
  await beat("Started");
  try {
    if (job.kind === "catalog") {
      await beat("Reading vivo e-store");
      const [p1, p2] = await Promise.all([grab("https://shop.vivo.com/in/products/phone", fetchImpl), grab("https://shop.vivo.com/in/products/phone?page=2", fetchImpl)]);
      const storeText = (pageText(p1, 14000) + " " + pageText(p2, 8000)).trim();
      const listed = parseStoreListing(storeText);   // no AI needed for the e-store's own list
      const month = new Date(t + 5.5 * 3600000).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
      // One series at a time: smaller answers, and a used-up quota is noticed before the next call.
      const results = [];
      for (const g of CAT_GROUPS) {
        try {
          results.push(await research(store, env, { prompt: catalogPrompt(today, storeText, g), queries: [`vivo ${g[1].replace(/ and any other vivo phones/, "")} smartphones price list India ${month}`], pageText: storeText, validate: (d) => cleanCatalog(d).length >= 1 },
            { fetchImpl, now, onStage: async (msg) => { if (now() > deadline) throw new Error("took too long"); await beat(g[0] + ": " + msg); } }));
        } catch (e) { results.push({ ok: false, error: "research " + e.message }); }
      }
      const old = (await store.get("affcat")) || {};
      const byslug = {}, keyToSlug = {};
      (old.models && old.models.length ? old.models : seedCatalog()).forEach((m) => { byslug[m.slug] = m; keyToSlug[nameKey(m.name)] = m.slug; });
      let found = 0; const diag = [], srcs = [];
      listed.forEach((x) => {
        const k = nameKey(x.name), slug = keyToSlug[k] || slugify(x.name); keyToSlug[k] = slug;
        const o = byslug[slug] || { slug, name: x.name, series: (x.name.replace(/^vivo\s+/i, "").match(/^[A-Za-z]+/) || [""])[0].toUpperCase().slice(0, 1), variants: [], colours: [] };
        const vs = (o.variants || []).slice();
        x.variants.forEach((v) => { const e = vs.find((y) => y.ram === v.ram && y.storage === v.storage); if (e) { e.price = v.price || e.price; e.mrp = v.mrp || e.mrp; e.priceSource = "vivo e-store"; } else vs.push(v); });
        byslug[slug] = Object.assign({}, o, { variants: vs, colours: [...new Set((o.colours || []).concat(x.variants.flatMap((v) => v.colours)))], seed: false });
      });
      diag.push("vivo e-store page: " + (storeText.length > 300 ? listed.length + " models read" : "could not be read"));
      results.forEach((r, i) => {
        const g = CAT_GROUPS[i][0];
        if (!r.ok) { diag.push(g + ": " + r.error); return; }
        const ms = cleanCatalog(r.data); found += ms.length;
        ms.forEach((m) => { const k = nameKey(m.name); if (keyToSlug[k] && keyToSlug[k] !== m.slug) m.slug = keyToSlug[k]; else keyToSlug[k] = m.slug; const o = byslug[m.slug]; byslug[m.slug] = Object.assign({}, o || {}, m, { seed: false, variants: m.variants.length ? m.variants : (o ? o.variants : []), colours: m.colours.length ? m.colours : (o ? o.colours : []) }); });
        (r.sources || []).forEach((x) => { if (srcs.length < 15) srcs.push(x); });
        diag.push(g + ": " + ms.length + " models via " + r.model + (r.grounded ? "" : " (no Google)"));
      });
      const models = cleanCatalog({ models: Object.values(byslug) }).map((m) => { const o = byslug[m.slug]; return Object.assign(m, { seed: !!(o && o.seed) }); });
      if (!found && !listed.length) { await store.set("affcat", Object.assign(old, { models, error: "Research found no models. " + diag.join(" | "), errorAt: now(), diag })); return { ok: false, error: "no models" }; }
      try {
        await beat("Getting phone photos");
        const need = [];
        for (const m of models) { const im = await store.get(`affimg:${m.slug}`); if (!im || (!im.phone && now() - im.at > DAY) || now() - im.at > IMG_TTL) need.push(m); }
        const q = need.slice(0, 40); let k = 0;
        await Promise.all(Array.from({ length: 6 }, async () => { while (k < q.length) { const m = q[k++]; if (now() > deadline) return; try { await saveModelImages(store, m.slug, await fetchModelImages(m.slug, { url: m.url, colours: m.colours, fetchImpl }), now()); } catch (e) { } } }));
        diag.push("photos: " + q.length + " models checked");
      } catch (e) { diag.push("photos: " + e.message); }
      await store.set("affcat", { models, updatedAt: now(), sources: srcs, by: job.by || "auto", diag, error: results.some((r) => !r.ok) ? "Some series failed: " + diag.filter((d) => !/ models via /.test(d)).join(" | ") : "", errorAt: results.some((r) => !r.ok) ? now() : 0 });
      return { ok: true, n: models.length };
    }
    await beat("Reading vivo.com page");
    const html = await grab(`https://www.vivo.com/in/products/${job.slug}`, fetchImpl);
    let r;
    const nm = job.name.replace(/^vivo\s+/i, "");
    try {
      r = await research(store, env, { prompt: modelPrompt(today, job.name, job.slug, pageText(html, 9000)), pageText: pageText(html, 9000), timeoutMs: 150000,
        queries: [`vivo ${nm} price in India bank offer no cost EMI`, `vivo ${nm} exchange offer upgrade bonus V-Shield`, `vivo ${nm} Bajaj Finserv Pine Labs EMI cashback offer`],
        validate: (d) => (Array.isArray(d.variants) && d.variants.length) || KINDS.some((k) => Array.isArray(d[k]) && d[k].length) }, { fetchImpl, now, onStage: ropts.onStage });
    } catch (e) { r = { ok: false, error: "research " + e.message }; }
    const old = (await store.get(`affm:${job.slug}`)) || null;
    if (!r.ok) { await store.set(`affm:${job.slug}`, Object.assign(old || { slug: job.slug, name: job.name }, { error: r.error, errorAt: now() })); return r; }
    const m = cleanModel(r.data, { slug: job.slug, name: job.name, series: job.series, url: `https://www.vivo.com/in/products/${job.slug}` });
    m.updatedAt = now(); m.sources = r.sources; m.queries = r.queries; m.aiModel = r.model; m.grounded = r.grounded; m.by = job.by || "auto";
    if (!r.grounded) m.notes = ("Web search was not available, so this is from the vivo.com page only. " + (m.notes || "")).slice(0, 600);
    await store.set(`affm:${job.slug}`, m);
    try { const im = await fetchModelImages(job.slug, { url: m.url, colours: m.colours, fetchImpl, mainHtml: html }); if (im) await saveModelImages(store, job.slug, im, now()); } catch (e) { }
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
  if (lockAlive(lock, t)) return { started: false, running: true };
  const capK = `affcap:${istDay(t)}`, cap = (await store.get(capK)) || { n: 0 }, max = Number(env.AFF_DAILY_CAP || 150);
  if (cap.n >= max) return { started: false, reason: `Daily AI research limit (${max}) reached — showing the last saved data.` };
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
const TPL_TYPES = ["text", "number", "date", "select", "textarea", "kind", "variant", "photo"];
export function cleanTpl(x) {
  if (!x || !Array.isArray(x.fields)) return null;
  const seen = {}, fields = [];
  x.fields.slice(0, 40).forEach((f) => {
    if (!f || typeof f !== "object") return;
    const id = String(f.id || "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30); if (!id || seen[id]) return; seen[id] = 1;
    const o = { id, label: str(f.label, 40) || id, type: TPL_TYPES.includes(f.type) ? f.type : "text", req: !!f.req, on: f.on !== false };
    if (o.type === "select") o.opts = (Array.isArray(f.opts) ? f.opts : String(f.opts || "").split(",")).map((v) => str(v, 40)).filter(Boolean).slice(0, 30);
    if (f.ph) o.ph = str(f.ph, 60);
    fields.push(o);
  });
  return fields.length ? { v: 1, name: str(x.name, 40) || "Offer report", fields } : null;
}
export async function affAction(b, ctx) {
  const { store, t, app, rec, pool, sameUser, who } = ctx;
  const isAdmin = app === "admin";
  const me = who(app, rec);
  const running = async (k) => !!(await reapLock(store, t, k));
  const stageOf = async (k) => { const l = await store.get(`afflock:${k}`); return l && lockAlive(l, t) ? { stage: l.stage || (l.startedAt ? "Working" : "Waiting for the research worker"), since: l.at } : null; };

  if (b.action === "aff-catalog") {
    await reapLock(store, t, "catalog");
    let cat = await store.get("affcat");
    if (!cat || !cat.models || !cat.models.length) { cat = Object.assign(cat || {}, { models: seedCatalog(), seeded: true }); await store.set("affcat", cat); }
    let start = null;
    const backoff = cat.errorAt && t - cat.errorAt < RETRY_MS && (!cat.updatedAt || cat.errorAt > cat.updatedAt);
    if ((!cat.updatedAt || t - cat.updatedAt > CATALOG_TTL) && !backoff && !(await running("catalog"))) start = await startJob(ctx, "catalog", null);
    const cat2 = (await store.get("affcat")) || cat;
    const cap = (await store.get(`affcap:${istDay(t)}`)) || { n: 0 };
    const refreshing = (start && start.started) || (await running("catalog"));
    return json(200, { ok: true, models: cat2.models || [], thumbs: (await store.get("affimgs")) || {}, updatedAt: cat2.updatedAt || 0, sources: cat2.sources || [], error: cat2.error && (!cat2.updatedAt || cat2.errorAt > cat2.updatedAt) ? cat2.error : "", errorAt: cat2.errorAt || 0,
      refreshing, progress: refreshing ? await stageOf("catalog") : null, retryAt: backoff ? cat.errorAt + RETRY_MS : 0, note: start && start.reason ? start.reason : "", partners: PARTNERS, kinds: KINDS, capUsed: cap.n, capMax: Number(ctx.env.AFF_DAILY_CAP || 150), state: rec.state || "", now: t });
  }

  if (b.action === "aff-model") {
    const slug = slugify(b.slug); if (!slug) return json(400, { ok: false, error: "Choose a model." });
    const cat = (await store.get("affcat")) || { models: [] };
    const base = cat.models.find((x) => x.slug === slug) || { slug, name: str(b.name, 60) || slug, series: "" };
    await reapLock(store, t, slug);
    const m = await store.get(`affm:${slug}`);
    let start = null;
    const mBack = m && m.errorAt && t - m.errorAt < RETRY_MS && (!m.updatedAt || m.errorAt > m.updatedAt);
    if ((!m || !m.updatedAt || t - m.updatedAt > MODEL_TTL) && !mBack && !(await running(slug))) start = await startJob(ctx, "model", base);
    const hidden = (await store.get(`affhide:${slug}`)) || {};
    const rks = await store.list(`affr:${slug}:`);
    const reports = (await pool(rks, 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => (y.verified - x.verified) || y.at - x.at);
    const mRef = (start && start.started) || (await running(slug));
    return json(200, { ok: true, base, model: (await store.get(`affm:${slug}`)) || null, ho: (await store.get(`affho:${slug}`)) || null, hidden, reports, refreshing: mRef, progress: mRef ? await stageOf(slug) : null, note: start && start.reason ? start.reason : "", now: t });
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
      out.push({ slug, base, model: m || null, ho: (await store.get(`affho:${slug}`)) || null, hidden: (await store.get(`affhide:${slug}`)) || {}, reports: (await pool(rks, 20, (k) => store.get(k))).filter(Boolean), refreshing });
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
      validTill: /^\d{4}-\d{2}-\d{2}$/.test(String(b.validTill || "")) ? b.validTill : "", photo, extra: cleanExtra(b.extra), by: Object.assign({}, me, { state: rec.state || "" }), at: t, verified: isAdmin, verifiedBy: isAdmin ? rec.fullName : "", official: isAdmin };
    await store.set(`affr:${slug}:${id}`, r);
    await ctx.logEvent(store, t, app, rec, "offer-reported", { device: (r.model + " · " + (r.partner || kind)).slice(0, 60), ver: "" });
    return json(200, { ok: true, report: r });
  }

  if (b.action === "aff-tpl-get") return json(200, { ok: true, template: (await store.get("config:afftpl")) || null });
  if (b.action === "aff-tpl-set") {
    if (!isAdmin) return json(403, { ok: false, error: "Only admins can publish the default template." });
    if (b.template === null) { await store.delete("config:afftpl"); return json(200, { ok: true, template: null }); }
    const tpl = cleanTpl(b.template); if (!tpl) return json(400, { ok: false, error: "The template has no fields." });
    tpl.by = rec.fullName || rec.username; tpl.at = t;
    await store.set("config:afftpl", tpl); return json(200, { ok: true, template: tpl });
  }
  if (b.action === "aff-report-bulk") {   // CSV import: many reports at once
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 300);
    if (!rows.length) return json(400, { ok: false, error: "No rows to import." });
    const cat = (await store.get("affcat")) || { models: [] }, out = [], bad = [];
    const find = (n) => { const k = nameKey(n), sl = slugify(n); return cat.models.find((m) => m.slug === sl || nameKey(m.name) === k) || cat.models.find((m) => k && (nameKey(m.name).startsWith(k) || k.startsWith(nameKey(m.name)))); };
    for (let i = 0; i < rows.length; i++) {
      const x = rows[i] || {}, base = find(x.model);
      if (!base) { bad.push({ row: i + 2, error: "Model not found: " + str(x.model, 40) }); continue; }
      const details = str(x.details, 400) || [str(x.partner, 60), str(x.scheme, 20), str(x.benefit, 80)].filter(Boolean).join(" · ");
      if (details.length < 5) { bad.push({ row: i + 2, error: "Offer details missing" }); continue; }
      const state = isAdmin ? str(x.state, 40) || "All India" : rec.state || "";
      if (!state) { bad.push({ row: i + 2, error: "No state" }); continue; }
      const id = (t + i).toString(36) + randomBytes(3).toString("hex");
      const r = { id, slug: base.slug, model: base.name, state, kind: KINDS.includes(x.kind) ? x.kind : "other", partner: str(x.partner, 60), scheme: str(x.scheme, 20), benefit: str(x.benefit, 80), details, variant: str(x.variant, 30),
        validTill: /^\d{4}-\d{2}-\d{2}$/.test(String(x.validTill || "")) ? x.validTill : "", photo: "", extra: cleanExtra(x.extra), by: Object.assign({}, me, { state: rec.state || "" }), at: t + i, verified: isAdmin, verifiedBy: isAdmin ? rec.fullName : "", official: isAdmin, bulk: true };
      await store.set(`affr:${base.slug}:${id}`, r); out.push(r);
    }
    if (out.length) await ctx.logEvent(store, t, app, rec, "offer-reported", { device: ("CSV import · " + out.length + " offers").slice(0, 60), ver: "" });
    return json(200, { ok: true, added: out.length, errors: bad.slice(0, 50), reports: out });
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

  if (b.action === "aff-keys") {   // free research sources: Groq + Tavily keys (stored server-side, never sent back)
    const c = (await store.get("config:aikeys")) || {};
    if (b.clear === "groq" || b.clear === "tavily") delete c[b.clear];
    const g = str(b.groq, 120), tv = str(b.tavily, 120);
    if (g) { if (!/^gsk_[A-Za-z0-9]{20,}$/.test(g)) return json(400, { ok: false, error: "That doesn't look like a Groq key (it starts with gsk_)." }); c.groq = g; }
    if (tv) { if (!/^tvly-[A-Za-z0-9-_]{10,}$/.test(tv)) return json(400, { ok: false, error: "That doesn't look like a Tavily key (it starts with tvly-)." }); c.tavily = tv; }
    c.by = rec.fullName; c.at = t;
    await store.set("config:aikeys", c);
    return json(200, { ok: true });
  }

  if (b.action === "aff-keys-test") {
    const k = await aiKeys(store, ctx.env), f = ctx.aiFetch || fetch, out = {};
    if (k.tavily) { const r = await tavilySearch(k.tavily, "vivo V70 price in India", f, { max: 2 }); out.tavily = r.ok ? "✓ working (" + r.results.length + " results)" : "✗ " + r.error; } else out.tavily = "not set";
    if (k.groq) {
      try {
        const r = await f("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + k.groq }, body: JSON.stringify({ model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "Reply with the JSON {\"ok\":true}" }], response_format: { type: "json_object" }, max_completion_tokens: 300 }) });
        const j = await r.json().catch(() => ({})); out.groq = r.ok ? "✓ working" : "✗ " + r.status + " " + String((j.error && j.error.message) || "").slice(0, 120);
      } catch (e) { out.groq = "✗ network " + e.message; }
    } else out.groq = "not set";
    return json(200, { ok: true, result: out });
  }

  if (b.action === "aff-images") {   // phone photos + banners for one model (fetched from vivo.com and cached for 7 days)
    const slug = slugify(b.slug); if (!slug) return json(400, { ok: false, error: "Choose a model." });
    let im = await store.get(`affimg:${slug}`);
    if (b.set) {   // HO: set or clear own pictures (links from vivo.com or any https image)
      if (!isAdmin) return json(403, { ok: false, error: "Only HO admins change photos." });
      const ok = (u) => /^https:\/\/[^\s"'<>]+$/i.test(String(u || "").trim()) ? String(u).trim().slice(0, 500) : "";
      const set = b.set === "clear" ? undefined : { phone: ok(b.set.phone), banners: (Array.isArray(b.set.banners) ? b.set.banners : String(b.set.banners || "").split(/\s+/)).map(ok).filter(Boolean).slice(0, 8), by: rec.fullName, at: t };
      im = Object.assign(im || { slug, phone: "", colours: [], images: [], banners: [], at: 0 }, { set });
      await store.set(`affimg:${slug}`, im);
      const idx = (await store.get("affimgs")) || {}; const ph = (set && set.phone) || im.phone; if (ph) idx[slug] = ph; else delete idx[slug]; await store.set("affimgs", idx);
      return json(200, { ok: true, images: im });
    }
    const stale = !im || t - (im.at || 0) > IMG_TTL || (im.failed && t - im.at > 6 * 3600000) || (b.force && isAdmin);
    if (stale) {
      const cat = (await store.get("affcat")) || { models: [] }, base = cat.models.find((x) => x.slug === slug) || {}, m = (await store.get(`affm:${slug}`)) || {};
      let r = null; try { r = await fetchModelImages(slug, { url: m.url || base.url, colours: (m.colours && m.colours.length ? m.colours : base.colours) || [], fetchImpl: ctx.imgFetch || fetch }); } catch (e) { }
      im = await saveModelImages(store, slug, r, t);
    }
    return json(200, { ok: true, images: im });
  }

  if (b.action === "aff-model-edit") {   // HO sets official prices / variants / colours (shown instead of researched ones)
    const slug = slugify(b.slug); if (!slug) return json(400, { ok: false, error: "Choose a model." });
    if (b.clear) { await store.delete(`affho:${slug}`); return json(200, { ok: true, ho: null }); }
    const variants = cleanVariants(b.variants).map((v) => Object.assign(v, { priceSource: "HO" }));
    if (!variants.length) return json(400, { ok: false, error: "Add at least one variant with a price." });
    const ho = { variants, colours: (Array.isArray(b.colours) ? b.colours : []).slice(0, 12).map((c) => str(c, 40)).filter(Boolean), by: rec.fullName, at: t };
    await store.set(`affho:${slug}`, ho);
    const cat = await store.get("affcat");
    if (cat && cat.models) { const c = cat.models.find((x) => x.slug === slug); if (c) { c.variants = variants; c.startPrice = Math.min(...variants.map((v) => v.price).filter(Boolean)) || c.startPrice; if (ho.colours.length) c.colours = ho.colours; await store.set("affcat", cat); } }
    return json(200, { ok: true, ho });
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
    const kc = (await store.get("config:aikeys")) || {}, k = await aiKeys(store, ctx.env);
    const providers = { groq: k.groq ? "…" + k.groq.slice(-4) : "", tavily: k.tavily ? "…" + k.tavily.slice(-4) : "", savedBy: kc.by || "", gemini: !ctx.env.GEMINI_API_KEY ? "not set" : (await store.get(`aiq:gemini:${istDay(t)}`)) ? "free quota used up today" : "available" };
    return json(200, { ok: true, providers, catalog: { updatedAt: cat.updatedAt || 0, count: cat.models.length, error: cat.error || "", errorAt: cat.errorAt || 0, diag: cat.diag || [], refreshing: await running("catalog"), sources: cat.sources || [] }, models: rows, capUsed: cap.n, capMax: Number(ctx.env.AFF_DAILY_CAP || 150) });
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
export async function dailyRefresh(store, env, { now = () => Date.now(), jobFetch = fetch, n = 5 } = {}) {
  const t = now(), ctx = { store, t, rec: { fullName: "auto" }, env, jobFetch };
  const cat = (await store.get("affcat")) || { models: [] };
  const out = { catalog: null, models: 0 };
  if (!cat.updatedAt || t - cat.updatedAt > CATALOG_TTL) out.catalog = await startJob(ctx, "catalog", null);
  const rows = [];
  for (const c of cat.models || []) { const m = await store.get(`affm:${c.slug}`); rows.push({ c, at: m ? m.updatedAt || 0 : 0 }); }
  for (const r of rows.filter((x) => t - x.at > MODEL_TTL).sort((x, y) => x.at - y.at).slice(0, n)) { const s = await startJob(ctx, "model", r.c); if (s.started) out.models++; else if (s.reason) break; }
  return out;
}
