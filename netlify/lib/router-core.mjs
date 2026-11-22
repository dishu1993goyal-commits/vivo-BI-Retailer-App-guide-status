// 🔀 AI Router — one place for the free AI keys of many providers. Every AI tool asks the router; it picks the right model for the
// job (think / fast / vision), skips providers that hit their free limit, rotates keys and falls back down the chain.
//   config:airouter  { prov: { [id]: { keys:[…], acct, on, conf, models:{think,fast,vision}, found:[…], checked, status } }, order:[…] }
//   airouter:use:<day> { [id]: { ok, err, lim, ms } }          arjob:<id> { req, by, at, st, res }   (long jobs run in arjob-background)
// Keys are write-only: pages only ever see the last 4 characters.
import { randomBytes } from "node:crypto";

const J = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

export const PROVIDERS = [
  { id: "gemini", name: "Google Gemini (AI Studio)", kind: "gemini", base: "https://generativelanguage.googleapis.com/v1beta", signup: "https://aistudio.google.com/apikey",
    how: "Sign in with a Google account → Get API key → Create API key.", best: "Long context, writing, pictures (vision)", vision: true,
    def: { think: ["gemini-3.5-flash", "gemini-2.5-flash"], fast: ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"], vision: ["gemini-3.5-flash", "gemini-2.5-flash"] } },
  { id: "groq", name: "Groq", kind: "oai", base: "https://api.groq.com/openai/v1", signup: "https://console.groq.com/keys",
    how: "Sign up (Google / e-mail) → API Keys → Create API Key.", best: "Very fast answers", vision: true,
    def: { think: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"], fast: ["openai/gpt-oss-20b", "llama-3.1-8b-instant"], vision: ["meta-llama/llama-4-scout-17b-16e-instruct"] } },
  { id: "cerebras", name: "Cerebras", kind: "oai", base: "https://api.cerebras.ai/v1", signup: "https://cloud.cerebras.ai",
    how: "Sign up → API Keys → Generate API key.", best: "Very fast, big daily allowance",
    def: { think: ["gpt-oss-120b", "qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b"], fast: ["llama3.1-8b", "gpt-oss-120b"] } },
  { id: "openrouter", name: "OpenRouter (free models)", kind: "oai", base: "https://openrouter.ai/api/v1", signup: "https://openrouter.ai/settings/keys",
    how: "Sign up → Keys → Create Key. Only models ending in “:free” are used.", best: "Many free models behind one key", vision: true, freeOnly: true,
    def: { think: ["deepseek/deepseek-chat-v3-0324:free", "meta-llama/llama-3.3-70b-instruct:free"], fast: ["meta-llama/llama-3.3-70b-instruct:free"], vision: ["google/gemma-3-27b-it:free"] } },
  { id: "github", name: "GitHub Models", kind: "oai", base: "https://models.github.ai/inference", signup: "https://github.com/settings/personal-access-tokens",
    how: "GitHub account → Settings → Developer settings → Fine-grained token with the “Models: read” permission.", best: "GPT-class models, good writing", vision: true,
    def: { think: ["openai/gpt-4.1", "openai/gpt-4o"], fast: ["openai/gpt-4.1-mini"], vision: ["openai/gpt-4.1", "openai/gpt-4o"] } },
  { id: "mistral", name: "Mistral", kind: "oai", base: "https://api.mistral.ai/v1", signup: "https://console.mistral.ai/api-keys",
    how: "Sign up → choose the free “Experiment” plan → API Keys → Create new key.", best: "Good writing, European hosting", vision: true,
    def: { think: ["mistral-medium-latest", "mistral-large-latest"], fast: ["mistral-small-latest"], vision: ["mistral-small-latest", "pixtral-12b-2409"] } },
  { id: "sambanova", name: "SambaNova", kind: "oai", base: "https://api.sambanova.ai/v1", signup: "https://cloud.sambanova.ai/apis",
    how: "Sign up → APIs → Generate API key.", best: "Fast large open models",
    def: { think: ["DeepSeek-V3-0324", "Meta-Llama-3.3-70B-Instruct"], fast: ["Meta-Llama-3.1-8B-Instruct"] } },
  { id: "nvidia", name: "NVIDIA NIM", kind: "oai", base: "https://integrate.api.nvidia.com/v1", signup: "https://build.nvidia.com",
    how: "Sign in → pick any model → Get API Key.", best: "Many open models",
    def: { think: ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-v3.1"], fast: ["meta/llama-3.1-8b-instruct"] } },
  { id: "cloudflare", name: "Cloudflare Workers AI", kind: "oai", base: "https://api.cloudflare.com/client/v4/accounts/{acct}/ai/v1", acct: true, signup: "https://dash.cloudflare.com/profile/api-tokens",
    how: "Sign up → My Profile → API Tokens → “Workers AI” template. Also copy your Account ID (dashboard right side).", best: "Daily free allowance, also image models",
    def: { think: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], fast: ["@cf/meta/llama-3.1-8b-instruct"] } },
];
const PBY = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));
const TASK_ORDER = {   // who is tried first for each kind of job (the HO order in the page overrides)
  think: ["gemini", "github", "cerebras", "groq", "mistral", "openrouter", "sambanova", "nvidia", "cloudflare"],
  fast: ["groq", "cerebras", "gemini", "sambanova", "mistral", "github", "openrouter", "nvidia", "cloudflare"],
  vision: ["gemini", "github", "groq", "mistral", "openrouter"],
};
const PREF = {   // picking from the models a provider says it has
  think: [/gpt-oss-120b/, /qwen-?3.*235b/i, /deepseek[-/]?(v3|chat|r1)/i, /gpt-4\.1(?!-mini|-nano)/, /gpt-4o(?!-mini)/, /gemini-[\d.]+-flash(?!-lite|.*(image|tts|live|audio))/, /mistral-(medium|large)/, /llama-4-maverick/i, /llama-3\.3-70b/i, /gpt-oss/],
  fast: [/gpt-oss-20b/, /8b-instant|llama-?3\.1-8b/i, /flash-lite/, /4\.1-mini|4o-mini/, /mistral-small/, /gpt-oss-120b/, /70b/i],
  vision: [/gemini-[\d.]+-flash(?!.*(image|tts|live|audio))/, /llama-4-(scout|maverick)/i, /gpt-4\.1(?!-nano)/, /gpt-4o/, /pixtral|mistral-small/, /gemma-3/, /vl\b|vision/i],
};
export const TASKS = ["think", "fast", "vision"];

const mask = (k) => (k ? "•••• " + String(k).slice(-4) : "");
function day() { const d = new Date(Date.now() + 5.5 * 3600e3); return d.toISOString().slice(0, 10); }

// ---------- config ----------
export async function loadRouter(store, env = {}) {
  const c = (await store.get("config:airouter")) || {}, legacy = (await store.get("config:aikeys")) || {};
  const prov = {};
  PROVIDERS.forEach((p) => { const x = (c.prov || {})[p.id] || {}; prov[p.id] = { keys: Array.isArray(x.keys) ? x.keys.filter(Boolean) : [], acct: x.acct || "", on: x.on !== false, conf: !!x.conf, models: x.models || {}, found: x.found || [], checked: x.checked || 0, status: x.status || "" }; });
  // keys the app already had (Netlify settings / Affordability → AI keys) take part too
  const extra = { groq: [env.GROQ_API_KEY, legacy.groq], gemini: [env.GEMINI_API_KEY, legacy.gemini] };
  Object.keys(extra).forEach((id) => extra[id].forEach((k) => { if (k && prov[id].keys.indexOf(k) < 0) { prov[id].keys.push(k); (prov[id].fixed = prov[id].fixed || []).push(k); } }));
  const custom = PROVIDERS.some((p) => (((c.prov || {})[p.id] || {}).keys || []).length);
  return { prov, order: Array.isArray(c.order) ? c.order.filter((id) => PBY[id]) : [], custom };
}
function publicCfg(cfg, use) {
  return PROVIDERS.map((p) => { const x = cfg.prov[p.id]; return { id: p.id, name: p.name, signup: p.signup, how: p.how, best: p.best, vision: !!p.vision, acctNeeded: !!p.acct, acct: x.acct ? mask(x.acct) : "",
    keys: x.keys.filter((k) => !(x.fixed || []).includes(k)).map(mask), fixed: (x.fixed || []).length, on: x.on, conf: x.conf, models: x.models, found: (x.found || []).slice(0, 60), checked: x.checked, status: x.status, pick: pickModels(p, x), use: (use || {})[p.id] || null }; });
}
function pickModels(p, x) {
  const o = {};
  TASKS.forEach((t) => {
    if (t === "vision" && !p.vision) return;
    const set = (x.models || {})[t]; if (set) { o[t] = [set]; return; }
    let ids = (x.found || []).filter((id) => !p.freeOnly || /:free$/.test(id)), out = [];
    PREF[t].forEach((re) => { ids.forEach((id) => { if (re.test(id) && out.indexOf(id) < 0) out.push(id); }); });
    o[t] = out.length ? out.slice(0, 2) : (p.def[t] || p.def.think || []).slice(0, 2);
  });
  return o;
}

// ---------- calling ----------
const COOL = {};   // provider → time it may be used again (free-tier limit hit)
function withTimeout(f, url, init, ms) {
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null, t = ac ? setTimeout(() => ac.abort(), ms) : null;
  return f(url, Object.assign({}, init, ac ? { signal: ac.signal } : {})).finally(() => t && clearTimeout(t));
}
function oaiMessages(rq) {
  const m = [];
  if (rq.system) m.push({ role: "system", content: rq.system });
  (rq.messages || [{ role: "user", content: rq.prompt || "" }]).forEach((x, i, all) => {
    const last = i === all.length - 1, imgs = last && rq.images && rq.images.length ? rq.images : null;
    m.push({ role: x.role === "assistant" || x.role === "model" ? "assistant" : "user", content: imgs ? [{ type: "text", text: String(x.content) }].concat(imgs.map((u) => ({ type: "image_url", image_url: { url: u } }))) : String(x.content) });
  });
  return m;
}
async function callOne(p, key, acct, model, rq, f, ms) {
  const t0 = Date.now();
  if (p.kind === "gemini") {
    const contents = (rq.messages || [{ role: "user", content: rq.prompt || "" }]).map((x, i, all) => {
      const parts = [{ text: String(x.content) }];
      if (i === all.length - 1 && rq.images) rq.images.forEach((u) => { const m = /^data:([^;]+);base64,(.+)$/.exec(u); if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } }); });
      return { role: x.role === "assistant" || x.role === "model" ? "model" : "user", parts };
    });
    const body = { contents, generationConfig: Object.assign({ temperature: rq.temperature != null ? rq.temperature : 0.5, maxOutputTokens: rq.maxTokens || 2000 }, rq.json ? { responseMimeType: "application/json" } : {}) };
    if (rq.system) body.systemInstruction = { parts: [{ text: rq.system }] };
    const r = await withTimeout(f, `${p.base}/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) }, ms);
    const j = await r.json().catch(() => ({}));
    const text = r.ok ? ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || "").join("").trim() : "";
    return { status: r.status, text, err: j.error && j.error.message, ms: Date.now() - t0 };
  }
  const base = p.base.replace("{acct}", encodeURIComponent(acct || "")), hdr = { "content-type": "application/json", authorization: "Bearer " + key };
  if (p.id === "openrouter") { hdr["HTTP-Referer"] = "https://vivo-business-innovation-dashboard-22.netlify.app"; hdr["X-Title"] = "vivo BI"; }
  const body = { model, messages: oaiMessages(rq), temperature: rq.temperature != null ? rq.temperature : 0.5, max_tokens: rq.maxTokens || 2000 };
  if (rq.json) body.response_format = { type: "json_object" };
  if (/gpt-oss/.test(model)) body.reasoning_effort = "low";
  let r = await withTimeout(f, base + "/chat/completions", { method: "POST", headers: hdr, body: JSON.stringify(body) }, ms);
  if (r.status === 400 && (body.response_format || body.reasoning_effort)) { delete body.response_format; delete body.reasoning_effort; r = await withTimeout(f, base + "/chat/completions", { method: "POST", headers: hdr, body: JSON.stringify(body) }, ms); }
  const j = await r.json().catch(() => ({}));
  const text = r.ok ? String((((j.choices || [])[0] || {}).message || {}).content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() : "";
  return { status: r.status, text, err: j.error && (j.error.message || j.error), ms: Date.now() - t0 };
}
function chain(cfg, task, sensitive) {
  const pref = TASK_ORDER[task] || TASK_ORDER.think, order = cfg.order.length ? cfg.order.concat(pref.filter((x) => cfg.order.indexOf(x) < 0)) : pref;
  return order.filter((id) => { const p = PBY[id], x = cfg.prov[id]; return p && x && x.on && x.keys.length && (!p.acct || x.acct) && (task !== "vision" || p.vision) && (!sensitive || x.conf); });
}
// rq: { task, system, prompt | messages[{role,content}], images[dataURL], json, maxTokens, temperature, sensitive }
export async function routerChat(cfg, rq, f = fetch, opts = {}) {
  const task = TASKS.indexOf(rq.task) >= 0 ? rq.task : rq.images && rq.images.length ? "vision" : "think";
  const ids = chain(cfg, task, rq.sensitive), deadline = Date.now() + (opts.budgetMs || 60000), tried = [];
  if (!ids.length) return { ok: false, error: rq.sensitive ? "No AI provider is marked “OK for confidential work” in 🔀 AI Router." : task === "vision" ? "No AI provider that can read pictures has a key yet (🔀 AI Router)." : "No AI keys yet — add them in 🔀 AI Router.", none: true };
  for (const id of ids) {
    if ((COOL[id] || 0) > Date.now()) { tried.push(id + ": resting (free limit)"); continue; }
    const p = PBY[id], x = cfg.prov[id], models = pickModels(p, x)[task] || [], keys = x.keys.slice(), start = Math.floor(Date.now() / 60000) % keys.length;
    let limited = 0, bad = 0;
    for (const model of models) {
      if (bad >= keys.length) break;   // every key refused: other models won't help
      for (let k = 0; k < keys.length; k++) {
        const left = deadline - Date.now(); if (left < 1500) return { ok: false, error: "AI took too long (" + tried.join("; ") + ")", tried };
        const key = keys[(start + k) % keys.length];
        let res; try { res = await callOne(p, key, x.acct, model, rq, f, Math.min(opts.callMs || 45000, left - 500)); } catch (e) { res = { status: 0, err: e && e.name === "AbortError" ? "timed out" : String(e && e.message || e) }; }
        if (opts.log) try { await opts.log(id, res); } catch (e) { }
        if (res.status === 200 && res.text) return { ok: true, text: res.text, provider: id, model, ms: res.ms, tried };
        tried.push(id + "/" + model + ": " + (res.status || "") + " " + String(res.err || (res.status === 200 ? "empty answer" : "")).slice(0, 80));
        if (res.status === 429) { limited++; continue; }          // this key is at its limit: next key
        if (res.status === 401 || res.status === 403) { bad++; continue; }   // bad key: next key
        break;                                                    // model problem: next model
      }
      if (limited >= keys.length) { COOL[id] = Date.now() + 90000; break; }
    }
  }
  return { ok: false, error: "Every AI provider is busy or at its free limit right now (" + tried.slice(-4).join("; ") + ")", tried };
}
export function makeLog(store) {
  return async (id, res) => {
    const k = "airouter:use:" + day(), u = (await store.get(k)) || {}, x = u[id] || (u[id] = { ok: 0, err: 0, lim: 0, ms: 0 });
    if (res.status === 200 && res.text) { x.ok++; x.ms += res.ms || 0; } else if (res.status === 429) x.lim++; else x.err++;
    x.last = res.status === 200 ? "ok" : String(res.status || "") + " " + String(res.err || "").slice(0, 60); x.at = Date.now();
    await store.set(k, u);
  };
}

// ---------- discovery: which models does this key give? ----------
async function discover(p, key, acct, f) {
  try {
    if (p.kind === "gemini") { const r = await withTimeout(f, p.base + "/models?pageSize=200", { headers: { "x-goog-api-key": key } }, 9000); const j = await r.json().catch(() => ({})); if (!r.ok) return { status: r.status, err: j.error && j.error.message };
      return { status: 200, ids: (j.models || []).filter((m) => (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0).map((m) => String(m.name).replace(/^models\//, "")) }; }
    if (p.id === "github") { const r = await withTimeout(f, "https://models.github.ai/catalog/models", { headers: { authorization: "Bearer " + key, accept: "application/json" } }, 9000); const j = await r.json().catch(() => ([])); if (!r.ok) return { status: r.status, err: j.message };
      return { status: 200, ids: (Array.isArray(j) ? j : []).map((m) => m.id).filter(Boolean) }; }
    if (p.id === "cloudflare") return { status: 200, ids: [] };
    const r = await withTimeout(f, p.base.replace("{acct}", encodeURIComponent(acct || "")) + "/models", { headers: { authorization: "Bearer " + key } }, 9000), j = await r.json().catch(() => ({}));
    if (!r.ok) return { status: r.status, err: j.error && (j.error.message || j.error) };
    let ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
    if (p.freeOnly) ids = ids.filter((id) => /:free$/.test(id));
    return { status: 200, ids };
  } catch (e) { return { status: 0, err: String(e && e.message || e) }; }
}

// ---------- page actions ----------
//   ar-get / ar-save / ar-key-add / ar-key-del / ar-check (HO) · ar-chat (any signed-in user, short jobs) · ar-job / ar-job-get (long jobs, run in the background)
export async function arAction(b, ctx) {
  const { store, app, rec } = ctx, ho = app === "admin", a = b.action, f = ctx.aiFetch || fetch, by = rec.fullName || rec.username || "";
  const cfg = await loadRouter(store, ctx.env || {});
  if (a === "ar-chat" || a === "ar-job") {
    const rq = cleanReq(b.req); if (!rq) return J(400, { ok: false, error: "Bad request" });
    const dk = "airouter:user:" + day() + ":" + app + ":" + (rec.username || ""), n = ((await store.get(dk)) || 0) + 1;
    if (n > (ho ? 600 : 150)) return J(200, { ok: false, error: "Daily AI limit reached for your account." });
    await store.set(dk, n);
    if (a === "ar-chat") { const r = await routerChat(cfg, rq, f, { budgetMs: 22000, callMs: 15000, log: makeLog(store) }); return J(200, Object.assign({ ok: r.ok }, r.ok ? { text: r.text, provider: r.provider, model: r.model } : { error: r.error, none: r.none })); }
    const id = randomBytes(8).toString("hex");
    await store.set("arjob:" + id, { req: rq, by, app, at: Date.now(), st: "queued" });
    if (ctx.jobFetch && ctx.siteUrl) { try { await ctx.jobFetch(ctx.siteUrl + "/.netlify/functions/arjob-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: id }) }); } catch (e) { } }
    else { runArJob(store, id, f, ctx.env || {}); }   // tests / local: run here
    return J(200, { ok: true, job: id });
  }
  if (a === "ar-job-get") { const j = await store.get("arjob:" + String(b.job || "").replace(/[^a-f0-9]/g, "")); if (!j) return J(200, { ok: false, error: "Job not found" }); return J(200, { ok: true, st: j.st, res: j.res || null }); }
  if (a === "ar-status") { const ids = PROVIDERS.filter((p) => cfg.prov[p.id].keys.length && cfg.prov[p.id].on).map((p) => p.id); return J(200, { ok: true, providers: ids, vision: ids.some((id) => PBY[id].vision), conf: ids.some((id) => cfg.prov[id].conf) }); }
  if (!ho) return J(403, { ok: false, error: "Only HO can change the AI Router" });
  const raw = (await store.get("config:airouter")) || {}; raw.prov = raw.prov || {};
  const P = (id) => raw.prov[id] || (raw.prov[id] = {});
  if (a === "ar-get") { const use = (await store.get("airouter:use:" + day())) || {}; return J(200, { ok: true, providers: publicCfg(cfg, use), order: cfg.order, tasks: TASKS, day: day() }); }
  const id = String(b.id || ""); if (a !== "ar-save-order" && !PBY[id]) return J(400, { ok: false, error: "Unknown provider" });
  if (a === "ar-key-add") {
    const k = String(b.key || "").trim(); if (!/^[\x21-\x7e]{12,400}$/.test(k)) return J(200, { ok: false, error: "That doesn't look like an API key" });
    const x = P(id); x.keys = (x.keys || []).filter((y) => y !== k).concat([k]).slice(-6); if (b.acct) x.acct = String(b.acct).trim().slice(0, 80);
    await store.set("config:airouter", raw); return J(200, { ok: true });
  }
  if (a === "ar-key-del") { const x = P(id), i = +b.i; x.keys = (x.keys || []).filter((y, j) => j !== i); await store.set("config:airouter", raw); return J(200, { ok: true }); }
  if (a === "ar-save") {
    const x = P(id);
    if (b.on != null) x.on = !!b.on; if (b.conf != null) x.conf = !!b.conf; if (b.acct) x.acct = String(b.acct).trim().slice(0, 80);
    if (b.models && typeof b.models === "object") { x.models = {}; TASKS.forEach((t) => { const m = String(b.models[t] || "").trim().slice(0, 120); if (m) x.models[t] = m; }); }
    await store.set("config:airouter", raw); return J(200, { ok: true });
  }
  if (a === "ar-save-order") { raw.order = (Array.isArray(b.order) ? b.order : []).filter((x) => PBY[x]); await store.set("config:airouter", raw); return J(200, { ok: true }); }
  if (a === "ar-check") {   // test every key of the provider + list its models
    const p = PBY[id], x = cfg.prov[id]; if (!x.keys.length) return J(200, { ok: false, error: "Add a key first" });
    if (p.acct && !x.acct) return J(200, { ok: false, error: "Add the Account ID too" });
    const d = await discover(p, x.keys[0], x.acct, f), out = [];
    const xr = P(id); if (d.status === 200 && d.ids && d.ids.length) xr.found = d.ids.slice(0, 300);
    const pick = pickModels(p, Object.assign({}, x, { found: xr.found || x.found }));
    for (let i = 0; i < x.keys.length; i++) {
      const r = await callOne(p, x.keys[i], x.acct, (pick.fast || pick.think)[0], { prompt: "Reply with the single word: ready", maxTokens: 20, temperature: 0 }, f, 12000).catch((e) => ({ status: 0, err: e.message }));
      out.push({ key: mask(x.keys[i]), ok: r.status === 200 && !!r.text, status: r.status, err: r.status === 200 ? "" : String(r.err || "").slice(0, 120), ms: r.ms });
    }
    xr.checked = Date.now(); xr.status = out.every((o) => o.ok) ? "ok" : out.some((o) => o.ok) ? "some" : "fail";
    await store.set("config:airouter", raw);
    return J(200, { ok: true, keys: out, models: (xr.found || []).length, pick });
  }
  return J(400, { ok: false, error: "Unknown action" });
}
function cleanReq(q) {
  if (!q || typeof q !== "object") return null;
  const rq = { task: TASKS.indexOf(q.task) >= 0 ? q.task : "think", system: String(q.system || "").slice(0, 20000), json: !!q.json, sensitive: !!q.sensitive,
    maxTokens: Math.min(8000, Math.max(50, +q.maxTokens || 2000)), temperature: q.temperature != null ? Math.min(1.2, Math.max(0, +q.temperature)) : undefined };
  if (Array.isArray(q.messages)) rq.messages = q.messages.slice(-20).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 60000) }));
  else rq.prompt = String(q.prompt || "").slice(0, 60000);
  if (Array.isArray(q.images)) rq.images = q.images.filter((u) => /^data:image\/(png|jpe?g|webp);base64,/.test(u) && u.length < 3_000_000).slice(0, 6);
  if (rq.images && rq.images.length) rq.task = "vision";
  return rq;
}
export async function runArJob(store, id, f = fetch, env = {}) {
  const k = "arjob:" + id, j = await store.get(k); if (!j || j.st === "done") return;
  j.st = "running"; await store.set(k, j);
  const cfg = await loadRouter(store, env);
  const r = await routerChat(cfg, j.req, f, { budgetMs: 600000, callMs: 120000, log: makeLog(store) });
  j.st = "done"; j.res = r.ok ? { ok: true, text: r.text, provider: r.provider, model: r.model } : { ok: false, error: r.error }; j.done = Date.now();
  await store.set(k, j);
}
