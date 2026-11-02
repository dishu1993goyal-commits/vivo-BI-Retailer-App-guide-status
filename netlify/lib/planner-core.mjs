// Payout target planner (reverse of the scheme assistant): the page reads several scheme letters into payout rules
// (same format as the scheme assistant, via scha-parse), the user sets the payout they want, and the page works out the
// sales needed (volume, value, model-wise — prices from the Affordability catalog). Here: AI writes the retailer's
// action plan from those numbers, and plans are saved per user so web and both apps show the same list.
// Storage:  plnu:<app>:<userKey> { plans:[{ id, title, at, updatedAt, data }] }   (max 40 plans per user)
import { groqJSON, aiKeys } from "./aff-core.mjs";
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const num = (v) => { const n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const arr = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => str(typeof x === "object" && x ? x.text || JSON.stringify(x) : x, m)).filter(Boolean);

export async function plannerAction(b, ctx) {
  const { store, t, app, rec, env = {} } = ctx, f = ctx.aiFetch || fetch;
  const uk = `plnu:${app}:${ctx.key || rec.username}`;

  if (b.action === "pln-ai") {   // AI action plan for the retailer, from the scheme rules + the worked-out targets
    const keys = await aiKeys(store, env); if (!keys.groq) return json(200, { ok: false, error: "AI key not set (Affordability → Data → Groq key)." });
    const p = b.plan || {}, schemes = (Array.isArray(b.schemes) ? b.schemes : []).slice(0, 8).map((s) => ({ title: str(s && s.title, 100), period: str(s && s.period, 60), summary: str(s && s.summary, 500), terms: arr(s && s.terms, 10, 200), actions: arr(s && s.actions, 8, 200), focusModels: arr(s && s.focusModels, 12, 50) }));
    const items = (Array.isArray(p.items) ? p.items : []).slice(0, 60).map((x) => ({ item: str(x && x.label, 80), scheme: str(x && x.scheme, 80), units: num(x && x.units), price: num(x && x.price), saleValue: num(x && x.value), payout: num(x && x.payout) })).filter((x) => x.units > 0);
    if (!items.length) return json(400, { ok: false, error: "Work out the plan first (no units planned)." });
    const ctxt = { targetPayout: num(p.target), plannedPayout: num(p.payout), achievementAssumed: num(p.ach), totalUnits: num(p.units), totalSaleValue: num(p.value), daysLeft: Math.max(1, Math.min(31, Math.round(num(p.daysLeft) || 30))), month: str(p.month, 20), retailer: str(p.retailer, 120), notes: str(p.notes, 300) };
    const prompt = `You are a vivo India sales coach. A retailer wants to earn a target scheme payout. Using the SCHEMES (rules & terms) and the PLAN (units of each model / slab already worked out to reach that payout), write a practical action plan the retailer can follow day by day.
Be specific with numbers from the PLAN (units, ₹ values, days left), name the models, and respect every scheme condition (activation, V-Work upload, V-Shield, achievement %, no online / cross-territory sales). Indian retail context, simple English.
Return JSON only:
{"headline":"one motivating line with the target","summary":"2-3 sentences: what must be sold and by when",
"daily":{"units":number per day,"value":₹ per day,"note":"one line"},
"weeks":[{"label":"Week 1 (dates)","units":number,"value":number,"focus":["models / slabs to push this week"],"actions":["2-4 concrete actions"]}],
"modelPlan":[{"model":"","units":number,"pitch":"one line on how to sell it to customers","addOn":"V-Shield / accessory / exchange / EMI tip"}],
"tactics":["4-6 store tactics: display, demos, EMI & exchange offers, follow-ups, staff incentives"],
"watchouts":["3-5 scheme conditions to follow so the payout is not lost or cut"],
"checklist":["4-6 daily habits, e.g. upload every sale on V-Work the same day"]}
SCHEMES: ${JSON.stringify(schemes)}
PLAN: ${JSON.stringify(Object.assign(ctxt, { items }))}`;
    const r = await groqJSON(keys.groq, prompt, f, { validate: (d) => d && (Array.isArray(d.weeks) || Array.isArray(d.tactics)) });
    if (!r.ok) return json(200, { ok: false, error: r.error });
    const d = r.data, A = (a, n, m) => arr(a, n, m);
    const out = { headline: str(d.headline, 200), summary: str(d.summary, 600),
      daily: d.daily && typeof d.daily === "object" ? { units: num(d.daily.units), value: num(d.daily.value), note: str(d.daily.note, 200) } : null,
      weeks: (Array.isArray(d.weeks) ? d.weeks : []).slice(0, 6).map((w) => ({ label: str(w && w.label, 60), units: num(w && w.units), value: num(w && w.value), focus: A(w && w.focus, 6, 80), actions: A(w && w.actions, 6, 220) })),
      modelPlan: (Array.isArray(d.modelPlan) ? d.modelPlan : []).slice(0, 15).map((m) => ({ model: str(m && m.model, 60), units: num(m && m.units), pitch: str(m && m.pitch, 220), addOn: str(m && m.addOn, 160) })).filter((m) => m.model),
      tactics: A(d.tactics, 8, 220), watchouts: A(d.watchouts, 8, 220), checklist: A(d.checklist, 8, 200), model: r.model || "", at: t };
    try { await ctx.logEvent(store, t, app, rec, "pln-ai", { device: str(ctxt.targetPayout, 20), ver: "" }); } catch (e) { }
    return json(200, { ok: true, plan: out });
  }
  if (b.action === "pln-list") { const d = (await store.get(uk)) || { plans: [] }; return json(200, { ok: true, items: d.plans.map((x) => ({ id: x.id, title: x.title, at: x.at, updatedAt: x.updatedAt, target: x.data && x.data.target, schemes: ((x.data && x.data.schemes) || []).map((s) => s.title) })) }); }
  if (b.action === "pln-get") { const d = (await store.get(uk)) || { plans: [] }, x = d.plans.find((y) => y.id === str(b.id, 30)); return x ? json(200, { ok: true, item: x }) : json(404, { ok: false, error: "Not found." }); }
  if (b.action === "pln-save") {
    let data = b.data; try { const s = JSON.stringify(data || {}); if (s.length > 400000) return json(400, { ok: false, error: "Plan too large to save." }); data = JSON.parse(s); } catch (e) { return json(400, { ok: false, error: "Bad plan." }); }
    const d = (await store.get(uk)) || { plans: [] }, id = str(b.id, 30).replace(/[^a-z0-9]/gi, ""), i = id ? d.plans.findIndex((y) => y.id === id) : -1;
    const x = { id: i >= 0 ? id : t.toString(36) + randomBytes(3).toString("hex"), title: str(b.title, 120) || "Payout plan", at: i >= 0 ? d.plans[i].at : t, updatedAt: t, data };
    if (i >= 0) d.plans[i] = x; else d.plans.unshift(x);
    d.plans = d.plans.slice(0, 40); await store.set(uk, d); return json(200, { ok: true, id: x.id });
  }
  if (b.action === "pln-delete") { const d = (await store.get(uk)) || { plans: [] }; d.plans = d.plans.filter((y) => y.id !== str(b.id, 30)); await store.set(uk, d); return json(200, { ok: true }); }
  return json(400, { ok: false, error: "Unknown action." });
}
