// AI Scheme Assistant: a retailer/user uploads a scheme policy (the page extracts its text) and AI turns it into a
// clear brief — targets, slabs, focus models, actions, and which numbers to enter. The user then types their daily /
// monthly sales value & volume and focus-model sales, and AI works out progress, what's left to hit each slab, and the
// likely payout. HO can publish a parsed scheme so every retailer sees it without re-uploading.
// Storage:  scha:<id> { id, title, data, by, at, published }      schaai:<hash> { at, data }
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { createHash, randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");

function cleanScheme(d) {
  d = d && typeof d === "object" ? d : {};
  const arr = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => str(typeof x === "object" ? x.text || JSON.stringify(x) : x, m)).filter(Boolean);
  return {
    title: str(d.title, 120) || "Scheme", period: str(d.period, 60), summary: str(d.summary, 600),
    targets: (Array.isArray(d.targets) ? d.targets : []).slice(0, 12).map((x) => ({ metric: str(x && x.metric, 80), value: str(x && x.value, 40), unit: str(x && x.unit, 24) })).filter((x) => x.metric),
    slabs: (Array.isArray(d.slabs) ? d.slabs : []).slice(0, 20).map((x) => ({ label: str(x && x.label, 60), condition: str(x && x.condition, 120), payout: str(x && x.payout, 80) })).filter((x) => x.condition || x.payout),
    focusModels: arr(d.focusModels, 20, 50), actions: arr(d.actions, 12, 200),
    inputs: (Array.isArray(d.inputs) ? d.inputs : []).slice(0, 10).map((x) => ({ key: str(x && x.key, 30).replace(/[^a-z0-9_]/gi, "") || "v", label: str(x && x.label, 80), unit: str(x && x.unit, 24) })).filter((x) => x.label),
    incentiveNote: str(d.incentiveNote, 300)
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

  if (b.action === "scha-parse") {   // scheme text (extracted on the page) → structured brief
    const text = str(b.text, 15000); if (text.length < 30) return json(400, { ok: false, error: "The file had no readable scheme text." });
    const prompt = `You explain vivo India sales-scheme / incentive policies to retailers in simple terms. Read the SCHEME TEXT and extract it.
Return JSON only:
{"title":"short name","period":"the scheme period/dates if stated","summary":"3-4 plain sentences: who it is for and how the incentive works",
"targets":[{"metric":"what is measured e.g. V-series units sold","value":"the target number/amount","unit":"units/₹/%"}],
"slabs":[{"label":"Slab 1","condition":"e.g. 5-9 units","payout":"e.g. ₹1500/unit"}],
"focusModels":["model names the scheme focuses on"],
"actions":["clear step the retailer should take to achieve it"],
"inputs":[{"key":"short_key","label":"number the retailer should enter to track progress e.g. V-series units sold so far","unit":"units/₹"}],
"incentiveNote":"one line on how/when the payout is given"}
Use only what the text supports; do not invent slabs or numbers. If the scheme is unit-slab based, list every slab.
SCHEME TEXT:
${text}`;
    const r = await ai(prompt, (d) => d && (d.summary || (d.slabs && d.slabs.length)), "parse|" + text.slice(0, 4000));
    if (!r.ok) return json(200, { ok: false, error: r.error });
    return json(200, { ok: true, scheme: cleanScheme(r.data) });
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
