// Competition analysis: an information package on each competitor brand (strategy, price-band portfolio, consumer
// offers, distributor & retailer schemes, recent / upcoming launches, news, regional strength) and the market
// (tentative brand shares by quarter & month, price-band leaders, state-wise leaders) researched from the web by AI
// in a background job — plus vivo's own field intel and counter-share uploads (offline channel), which are real data.
//   cmpcfg          { extra:[{ slug, name }] }
//   cmpb:<slug>     { brand, slug, data, sources, model, at }
//   cmpmkt          { data, sources, model, at }
//   cmpjob          { status:"running"|"done"|"error", at, list:[slug|"market"], done:[], stage, errors:[] }
//   cmpi:<id>       field intel { id, brand, kind, state, area, details, value, validTill, by, byState, at, verified, vBy }
//   cmpcs           counter share { rows:[{ m, st, ar, br, u, pb }], updatedAt }
import { randomBytes } from "node:crypto";
import { research } from "./aff-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,%\s]/g, "")); return isFinite(n) ? n : 0; };
export const BRANDS = [["samsung", "Samsung"], ["apple", "Apple (iPhone)"], ["oppo", "OPPO"], ["realme", "realme"], ["xiaomi", "Xiaomi (Redmi, POCO)"], ["oneplus", "OnePlus"], ["motorola", "Motorola"], ["nothing", "Nothing (CMF)"], ["google", "Google Pixel"], ["transsion", "Transsion (Infinix, Tecno, itel)"], ["lava", "Lava"], ["honor", "Honor"]];
export const BANDS = ["Under ₹10k", "₹10–15k", "₹15–20k", "₹20–30k", "₹30–45k", "₹45k+"];
export const INTEL_KINDS = ["Consumer offer", "Distributor scheme", "Retailer scheme", "Price change", "New launch", "Promoter / display", "Counter share note", "Other"];
const slugify = (s) => low(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
async function brands(store) { const c = (await store.get("cmpcfg")) || {}; return BRANDS.map((b) => ({ slug: b[0], name: b[1] })).concat((c.extra || []).filter((x) => x && x.slug)); }
const MON = () => new Date(Date.now() + 19800000).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

function brandTask(name) {
  const when = MON(), short = name.split(" (")[0];
  return { queries: [`${short} India smartphone market share ${when}`, `${short} upcoming phone launch India`, `${short} smartphone bank offer EMI exchange offer India`, `${short} retailer margin distributor scheme India mobile`, `${short} India offline strategy smartphones`],
    validate: (d) => d && typeof d === "object" && (d.overview || d.launchesRecent || d.priceBands),
    prompt: `vivo competition intelligence — research the smartphone brand ${name} in India as of ${when}, using web search (news, brand sites, Counterpoint / IDC / Canalys reports, trade media like ETTelecom, 91mobiles, Gadgets360, MySmartPrice, and retail trade sources).
Return ONE JSON object only:
{"overview":"3-4 sentences on its India position","shareEst":"latest India market share estimate with source and period, e.g. '17% (Counterpoint, Q2 2026)' or ''","strategy":["5-7 bullets: channel focus online/offline, price bands pushed, marketing, retail expansion, financing"],"strengths":["…"],"weaknesses":["…"],
"priceBands":{${BANDS.map((b) => `"${b}":{"position":"leader|strong|present|weak|absent","models":["key models"]}`).join(",")}},
"launchesRecent":[{"model":"","date":"YYYY-MM or YYYY-MM-DD","price":"₹ starting price","highlights":"short"}],
"launchesUpcoming":[{"model":"","expected":"month / quarter","priceExpected":"","notes":""}],
"affordability":[{"type":"EMI|bank cashback|exchange|upgrade|insurance|other","partner":"bank / NBFC / platform","details":"what the customer gets","validTill":"YYYY-MM-DD or ''"}],
"channelSchemes":[{"level":"distributor|retailer|promoter","details":"margin, slab, incentive, display or sell-out scheme as reported","period":"","source":"where reported"}],
"regions":[{"region":"state or region of India","strength":"high|medium|low","note":""}],
"monthly":[{"month":"YYYY-MM","shareEst":number}],
"news":[{"date":"YYYY-MM-DD","title":"","summary":"one line","url":""}]}
Only use facts found in search results; leave a list empty rather than inventing. Shares and channel-scheme figures are estimates — say so in the text. Up to 8 items per list.` };
}
function marketTask(list) {
  const when = MON();
  return { queries: [`India smartphone market share brands ${when} Counterpoint`, `India smartphone shipments quarter IDC Canalys brand share`, `India smartphone price segment leader premium mid-range budget share`, `India smartphone brand share by state region offline`],
    validate: (d) => d && typeof d === "object" && (d.quarters || d.priceBands || d.summary),
    prompt: `vivo competition intelligence — the India smartphone market as of ${when}, using web search (Counterpoint, IDC, Canalys, CMR, techARC reports and news). Brands of interest: vivo, ${list.join(", ")}.
Return ONE JSON object only:
{"summary":"5-6 sentences: who leads, trends, offline vs online, premiumisation","quarters":[{"period":"Q1 2026","source":"Counterpoint|IDC|Canalys","shares":{"brand":percent}}],
"monthly":[{"month":"YYYY-MM","shares":{"brand":percent}}],
"priceBands":[{"band":"one of ${BANDS.join(" / ")}","leader":"brand","shares":{"brand":percent},"note":""}],
"states":[{"state":"Indian state","leader":"brand","shares":{"brand":percent},"note":"why / channel"}],
"trends":["6-8 bullets on market trends, financing, channel, launches"],
"vivoPosition":"3-4 sentences on where vivo stands and is exposed"}
Quarters: last 4-6 quarters you can find. Monthly: last 6-12 months — use reported monthly figures where found, otherwise estimate from the quarterly numbers and mark it in "summary". Price bands and states: tentative estimates from reports, retail trade news and known channel strength (cover the 15-20 biggest states). Percent numbers only (no % sign). Never invent sources.` };
}
// background worker (netlify/functions/intel-background.mjs)
export async function runCmpJob(store, env, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const job = await store.get("cmpjob"); if (!job || job.status !== "running") return;
  const B = await brands(store), stage = async (s) => { job.stage = s; job.beat = now(); await store.set("cmpjob", job); };
  for (const target of job.list) {
    if (job.done.includes(target)) continue;
    try {
      if (target === "market") {
        await stage("Researching the market…");
        const r = await research(store, env, marketTask(B.map((b) => b.name.split(" (")[0])), { fetchImpl, now, onStage: (s) => stage("Market: " + s) });
        if (!r.ok) throw new Error(r.error);
        await store.set("cmpmkt", { data: r.data, sources: (r.sources || []).slice(0, 20), model: r.model, grounded: !!r.grounded, at: now() });
      } else {
        const b = B.find((x) => x.slug === target); if (!b) { job.done.push(target); continue; }
        await stage("Researching " + b.name + "…");
        const r = await research(store, env, brandTask(b.name), { fetchImpl, now, onStage: (s) => stage(b.name + ": " + s) });
        if (!r.ok) throw new Error(b.name + ": " + r.error);
        await store.set(`cmpb:${b.slug}`, { brand: b.name, slug: b.slug, data: r.data, sources: (r.sources || []).slice(0, 20), model: r.model, grounded: !!r.grounded, at: now() });
      }
    } catch (e) { job.errors = (job.errors || []).concat([String(e.message || e).slice(0, 200)]).slice(-10); if (/quota/i.test(String(e.message))) { job.done.push(target); break; } }
    job.done.push(target); await store.set("cmpjob", job);
  }
  job.status = job.errors && job.errors.length && job.errors.length >= job.list.length ? "error" : "done"; job.stage = ""; job.end = now(); await store.set("cmpjob", job);
}

export async function cmpAction(b, ctx) {
  const { store, t, app, rec, pool, env = {} } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "", myState = isHO ? "" : str(rec.state, 40);
  if (b.action === "cmp-get") {
    const B = await brands(store), docs = await pool(B, 10, (x) => store.get(`cmpb:${x.slug}`));
    let job = await store.get("cmpjob"); if (job && job.status === "running" && t - (job.beat || job.at) > 16 * 60e3) { job.status = "error"; job.errors = (job.errors || []).concat(["Timed out — try again."]); await store.set("cmpjob", job); }
    const intel = (await pool(await store.list("cmpi:"), 30, (k) => store.get(k))).filter(Boolean).sort((a, c) => c.at - a.at);
    return json(200, { ok: true, isHO, myState, bands: BANDS, kinds: INTEL_KINDS, brands: B.map((x, i) => Object.assign({}, x, { doc: docs[i] || null })), market: (await store.get("cmpmkt")) || null, job: job ? { status: job.status, stage: job.stage, list: job.list, done: job.done, errors: job.errors || [], at: job.at, end: job.end || 0 } : null, intel: intel.slice(0, 400), intelCount: intel.length });
  }
  if (b.action === "cmp-refresh") {   // AI web research in the background
    const job0 = await store.get("cmpjob");
    if (job0 && job0.status === "running" && t - (job0.beat || job0.at) < 10 * 60e3) return json(200, { ok: true, running: true, job: job0 });
    const B = await brands(store), want = b.target === "all" ? ["market"].concat(B.map((x) => x.slug)) : [str(b.target, 30)].filter((x) => x === "market" || B.some((y) => y.slug === x));
    if (!want.length) return json(400, { ok: false, error: "Pick a brand." });
    if (!isHO && want.length > 1) return json(403, { ok: false, error: "Only HO admins can refresh everything at once." });
    if (!isHO) { const d = want[0] === "market" ? await store.get("cmpmkt") : await store.get(`cmpb:${want[0]}`); if (d && t - d.at < 12 * 36e5) return json(400, { ok: false, error: "Refreshed less than 12 hours ago — HO can refresh sooner." }); }
    const job = { status: "running", at: t, beat: t, list: want, done: [], stage: "Starting…", errors: [], by };
    await store.set("cmpjob", job);
    try { await (ctx.jobFetch || fetch)((env.SITE_URL || "") + "/.netlify/functions/intel-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: "cmp" }) }); }
    catch (e) { job.status = "error"; job.errors = ["Couldn't start the research worker."]; await store.set("cmpjob", job); return json(500, { ok: false, error: job.errors[0] }); }
    return json(200, { ok: true, job });
  }
  if (b.action === "cmp-brand-add") {
    if (!isHO) return json(403, { ok: false, error: "HO only." });
    const name = str(b.name, 50), slug = slugify(name); if (!slug) return json(400, { ok: false, error: "Brand name?" });
    const c = (await store.get("cmpcfg")) || { extra: [] }; if (!(await brands(store)).some((x) => x.slug === slug)) c.extra.push({ slug, name }); await store.set("cmpcfg", c); return json(200, { ok: true, slug });
  }
  if (b.action === "cmp-intel-add") {
    const x = b.item || {}, brand = str(x.brand, 50); if (!brand) return json(400, { ok: false, error: "Which brand?" });
    const details = txt(x.details, 1500); if (details.length < 5) return json(400, { ok: false, error: "Describe what you saw." });
    const it = { id: t.toString(36) + randomBytes(2).toString("hex"), brand, kind: INTEL_KINDS.includes(x.kind) ? x.kind : "Other", state: isHO ? str(x.state, 40) : myState, area: str(x.area, 60), model: str(x.model, 60), details, value: str(x.value, 80), validTill: /^\d{4}-\d{2}-\d{2}$/.test(x.validTill || "") ? x.validTill : "", by, byState: myState || "HO", at: t, verified: isHO, vBy: isHO ? by : "" };
    await store.set(`cmpi:${it.id}`, it); return json(200, { ok: true, item: it });
  }
  if (b.action === "cmp-intel-verify" || b.action === "cmp-intel-delete") {
    const it = await store.get(`cmpi:${str(b.id, 30)}`); if (!it) return json(404, { ok: false, error: "Not found." });
    if (b.action === "cmp-intel-delete") { if (!isHO && it.by !== by) return json(403, { ok: false, error: "Not yours." }); await store.delete(`cmpi:${it.id}`); return json(200, { ok: true }); }
    if (!isHO) return json(403, { ok: false, error: "HO verifies field intel." });
    it.verified = b.verified !== false; it.vBy = by; await store.set(`cmpi:${it.id}`, it); return json(200, { ok: true, item: it });
  }
  if (b.action === "cmp-cs-import") {   // counter share: month, state, area, brand, units, price band
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 30000).map((x) => ({ m: str(x.m, 7), st: str(x.state, 40) || myState, ar: str(x.area, 60), br: str(x.brand, 40), u: num(x.units), pb: str(x.band, 20) })).filter((r) => /^\d{4}-\d{2}$/.test(r.m) && r.st && r.br && (isHO || low(r.st) === low(myState)));
    if (!rows.length) return json(400, { ok: false, error: "No valid rows (Month, State, Brand, Units)." });
    const old = (await store.get("cmpcs")) || { rows: [] }, key = new Set(rows.map((r) => r.m + "|" + low(r.st)));
    const all = old.rows.filter((r) => !key.has(r.m + "|" + low(r.st))).concat(rows).slice(-60000);
    await store.set("cmpcs", { rows: all, updatedAt: t }); return json(200, { ok: true, saved: rows.length });
  }
  if (b.action === "cmp-cs-get") { const c = (await store.get("cmpcs")) || { rows: [] }; return json(200, { ok: true, rows: c.rows.filter((r) => isHO || low(r.st) === low(myState) || b.all), updatedAt: c.updatedAt || 0 }); }
  if (b.action === "cmp-ask") {
    const B = await brands(store), ctxData = { market: ((await store.get("cmpmkt")) || {}).data || null, brands: {} };
    for (const x of B) { const d = await store.get(`cmpb:${x.slug}`); if (d) ctxData.brands[x.name] = { shareEst: d.data.shareEst, strategy: (d.data.strategy || []).slice(0, 5), priceBands: d.data.priceBands, upcoming: (d.data.launchesUpcoming || []).slice(0, 4), offers: (d.data.affordability || []).slice(0, 4), channelSchemes: (d.data.channelSchemes || []).slice(0, 4), at: new Date(d.at).toISOString().slice(0, 10) }; }
    ctxData.fieldIntel = (await pool(await store.list("cmpi:"), 30, (k) => store.get(k))).filter(Boolean).sort((a, c) => c.at - a.at).slice(0, 60).map((i) => [i.brand, i.kind, i.state, i.area, i.model, i.details, i.value, i.verified ? "verified" : "unverified"].filter(Boolean).join(" | "));
    const cs = (await store.get("cmpcs")) || { rows: [] }; if (cs.rows.length) { const last = cs.rows.map((r) => r.m).sort().pop(), agg = {}; cs.rows.filter((r) => r.m === last).forEach((r) => { const k = r.st + "|" + r.br; agg[k] = (agg[k] || 0) + r.u; }); ctxData.counterShare = { month: last, unitsByStateBrand: agg }; }
    const r = await ctx.askAI(env, str(b.q, 500), "DATA: " + JSON.stringify(ctxData).slice(0, 22000), (b.history || []).slice(-6), ctx.aiFetch, { system: "You are vivo India's competition analyst. Answer from DATA (AI web research — estimates, field intel from vivo staff, and counter-share uploads which are real). Say which numbers are estimates. Be specific: brands, price bands, states, models, offers. Give actions for vivo where useful. Plain text, • bullets, under 14 lines.", label: "COMPETE" });
    return json(200, r.ok ? { ok: true, answer: r.text } : { ok: false, error: r.error });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
