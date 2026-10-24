// Ops tools: module on/off per state (#12), help centre — FAQ + "Ask your guides" AI (#2), escalation matrix (#3),
// process flowcharts (#4) — and official schemes & slabs for the payout calculator (#14).
// Storage:
//   config:modules         { <moduleId>: { mode:"all"|"off"|"states", states:[...] }, updatedBy, updatedAt }
//   config:help            { vchatLink: "vchat://chat?id={id}" }
//   faq:<id>               { id, q, a, category, order, updatedAt, by }
//   esc:<id>               { id, state, issue, level, name, role, phone, vchatId, email, hours }
//   flow:<id>              { id, title, icon, summary, steps:[{type:"step"|"decision", title, detail, owner, tat, yes, no}], updatedAt }
//   scheme:<id>            { id, name, month, kind:"units"|"value", method:"retro"|"incremental", slabs:[{from,rate,bonus}], targets:{<state>:n}, notes, active }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const cid = (v) => String(v || "").replace(/[^a-z0-9]/gi, "").slice(0, 30);
const numOr = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };

export const MODULES = [
  ["visits", "Market visits"], ["affordability", "Affordability Corner"], ["hygiene", "Market hygiene"],
  ["reports", "Report builder"], ["autoreports", "Auto-reports"], ["leaderboard", "Leaderboard & recognition"], ["matrix", "Feature usability"],
  ["quiz", "Quizzes & certificates"], ["polls", "Polls"], ["wall", "Best-practice wall"], ["surveys", "Surveys"], ["chat", "Messages"],
  ["help", "FAQ & Ask AI"], ["flows", "Process flowcharts"], ["contacts", "Escalation contacts"], ["knowledge", "Knowledge"], ["schemes", "Schemes & payout calculator"],
  ["disputes", "Disputes"], ["support", "Support desk"]];

export async function modulesFor(store, app, rec) {
  const c = (await store.get("config:modules")) || {};
  const out = {};
  MODULES.forEach(([id]) => {
    const m = c[id] || { mode: "all" };
    out[id] = app === "admin" ? true : m.mode === "off" ? false : m.mode === "states" ? (m.states || []).includes(rec.state || "") : true;
  });
  return out;
}
export async function moduleOn(store, id, app, rec) { return app === "admin" || (await modulesFor(store, app, rec))[id] !== false; }
export const offMsg = () => json(403, { ok: false, error: "This tool isn't switched on for your state yet.", moduleOff: true });

// ---- built-in content (admins can edit/replace) ----
export const DEFAULT_FAQ = [
  ["Scores", "How is the BI KPI score calculated?", "Each KPI's achievement is capped at 100% and multiplied by its weight, then all KPIs are added: Score = Σ min(achievement, 100%) × weight. Retailer App usage has the biggest weight, then sales achievement, customer visit efficiency, competition/support desk and v-Notice."],
  ["Scores", "How is the state rank decided?", "States are ranked by total BI KPI score for the selected period (highest = rank 1). Ties share the better rank. Each KPI also has its own rank, shown in Rankings."],
  ["Retailer app", "How is Retailer App usage % calculated?", "For each feature (scheme announcement, scheme payout, announcements & notifications, app visits) it is: retailers who used the feature ÷ eligible retailers. The app KPI combines these features with their weights."],
  ["Payout", "How is scheme payout calculated?", "Achievement % = Achieved ÷ Target × 100. The slab is the highest slab whose 'From %' is at or below your achievement. Retro: all units × that slab's rate (+ bonus). Incremental: each band is paid at its own rate. Below the first slab, payout is 0."],
  ["Payout", "How many more units do I need for the next slab?", "Units needed = ceil(next slab From % × Target ÷ 100) − Achieved. The payout calculator shows this automatically."],
  ["Support desk", "What is TAT %?", "TAT % = queries closed within the turnaround time ÷ queries raised in the period. Closure % = closed ÷ raised; Escalation % = escalated ÷ raised."],
  ["Visits", "When is a market visit valid?", "A visit is valid when you stay at least the minimum time (default 10 min), punch out within the allowed distance of the punch-in spot (default 300 m) and add the minimum photos (default 1). HO can change these in Market visits → Rules."],
  ["Data", "My numbers look wrong — what do I do?", "Raise a Dispute (All tools → Disputes) with the page, the number shown and the number you expect. It is assigned to HO with a turnaround timer, and you can follow it until it is resolved."],
  ["Hygiene", "What is IMEI pre-activation?", "Activating a handset's IMEI before it is actually sold to a customer (for example to claim schemes). HO uploads suspicious IMEIs in Market hygiene; the state team checks each one and records the action taken."]];
export const DEFAULT_FLOWS = [
  { id: "imei", icon: "🧼", title: "IMEI pre-activation handling", summary: "From a suspicious IMEI to closure with the dealer", steps: [
    { type: "step", title: "HO uploads suspicious IMEIs", detail: "Market hygiene → Upload. Each IMEI is assigned to its state automatically.", owner: "HO BI", tat: "Day 0" },
    { type: "step", title: "State team reviews the list", detail: "Check activation date vs. sale date, dealer stock and customer invoice.", owner: "State BI", tat: "2 days" },
    { type: "decision", title: "Is it a genuine customer sale?", yes: "Mark 'Genuine sale – cleared' with invoice photo", no: "Go to next step" },
    { type: "step", title: "Speak to the dealer", detail: "Explain the policy, record the dealer's response.", owner: "State BI / ASM", tat: "3 days" },
    { type: "decision", title: "Repeat case for this dealer?", yes: "Escalate to HO and sales head", no: "Mark 'Dealer warned'" },
    { type: "step", title: "Record action & evidence", detail: "Status, remark and photo in Market hygiene. Dealer hygiene score updates.", owner: "State BI", tat: "Same day" },
    { type: "step", title: "HO review & closure", detail: "HO checks the actions and closes the batch.", owner: "HO BI", tat: "Weekly" }] },
  { id: "payout", icon: "💰", title: "Payout dispute process", summary: "When a retailer or team disputes a scheme payout", steps: [
    { type: "step", title: "Collect the details", detail: "Retailer ID, scheme, month, payout received vs expected, proof.", owner: "State BI", tat: "Day 0" },
    { type: "step", title: "Check with the payout calculator", detail: "All tools → Payout calculator. Use the official scheme slabs.", owner: "State BI", tat: "Same day" },
    { type: "decision", title: "Does the calculation match the payout?", yes: "Explain the calculation to the retailer and close", no: "Raise a Dispute (category: Payout calculation)" },
    { type: "step", title: "HO investigates", detail: "Checks sell-out data, eligibility and slab mapping.", owner: "HO BI", tat: "As per priority TAT" },
    { type: "step", title: "Correction & communication", detail: "Approved differences go to the next payout cycle; the dispute is resolved with notes.", owner: "HO / Finance", tat: "Next cycle" }] },
  { id: "onboard", icon: "🆕", title: "New retailer onboarding in vWork", summary: "Getting a new retailer live on vWork and the Retailer App", steps: [
    { type: "step", title: "Collect KYC & store details", detail: "GST/PAN, owner details, store address, bank details.", owner: "Sales / State BI", tat: "Day 0" },
    { type: "step", title: "Create the retailer in vWork", detail: "Enter details and map to distributor and territory.", owner: "Distributor / DMS team", tat: "1 day" },
    { type: "decision", title: "Retailer ID generated?", yes: "Continue", no: "Fix the missing fields and resubmit" },
    { type: "step", title: "Activate Retailer App", detail: "Install the app, log in with the retailer ID, set up notifications.", owner: "State BI", tat: "2 days" },
    { type: "step", title: "Train the retailer", detail: "Scheme announcements, payout status, IMEI activation, support desk.", owner: "State BI / VBA", tat: "First week" },
    { type: "step", title: "Confirm first activity", detail: "Check the retailer appears as active in the dashboard next refresh.", owner: "State BI", tat: "2 weeks" }] }];

export async function opsAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx;
  const isAdmin = app === "admin";
  const listOf = async (prefix) => (await pool(await store.list(prefix), 40, (k) => store.get(k))).filter(Boolean);
  const adminOnly = () => json(403, { ok: false, error: "Only BI admins can change this." });

  // ---------- modules (#12) ----------
  if (b.action === "mod-get") {
    const c = (await store.get("config:modules")) || {};
    return json(200, { ok: true, modules: MODULES.map(([id, name]) => ({ id, name, mode: (c[id] || {}).mode || "all", states: (c[id] || {}).states || [] })), mine: await modulesFor(store, app, rec), updatedBy: c.updatedBy || "", updatedAt: c.updatedAt || 0 });
  }
  if (b.action === "mod-set") {
    if (!isAdmin) return adminOnly();
    const c = (await store.get("config:modules")) || {};
    (Array.isArray(b.modules) ? b.modules : []).forEach((m) => {
      if (!MODULES.some(([id]) => id === m.id)) return;
      c[m.id] = { mode: ["all", "off", "states"].includes(m.mode) ? m.mode : "all", states: (Array.isArray(m.states) ? m.states : []).slice(0, 60).map((s) => str(s, 40)) };
    });
    c.updatedBy = rec.fullName; c.updatedAt = t;
    await store.set("config:modules", c);
    return json(200, { ok: true });
  }

  // ---------- FAQ (#2) ----------
  if (b.action === "faq-list") {
    let rows = await listOf("faq:");
    if (!rows.length && !(await store.get("config:faqseeded"))) rows = DEFAULT_FAQ.map((f, i) => ({ id: "d" + i, category: f[0], q: f[1], a: f[2], order: i, builtIn: true }));
    const hc = (await store.get("config:help")) || {};
    return json(200, { ok: true, faq: rows.sort((x, y) => (x.order || 0) - (y.order || 0)), vchatLink: hc.vchatLink || "" });
  }
  if (b.action === "faq-save") {
    if (!isAdmin) return adminOnly();
    // first edit copies the built-in FAQ so admins own the full list
    if (!(await store.get("config:faqseeded"))) { for (let i = 0; i < DEFAULT_FAQ.length; i++) { const f = DEFAULT_FAQ[i]; await store.set(`faq:d${i}`, { id: "d" + i, category: f[0], q: f[1], a: f[2], order: i }); } await store.set("config:faqseeded", { at: t }); }
    const q = str(b.q, 200), a = str(b.a, 3000);
    if (q.length < 5 || a.length < 5) return json(400, { ok: false, error: "Write the question and the answer." });
    const id = cid(b.id) || nid(t);
    const old = (await store.get(`faq:${id}`)) || {};
    await store.set(`faq:${id}`, { id, q, a, category: str(b.category, 40) || "General", order: numOr(b.order, old.order != null ? old.order : 999), updatedAt: t, by: rec.fullName });
    return json(200, { ok: true, id });
  }
  if (b.action === "faq-delete") {
    if (!isAdmin) return adminOnly();
    if (!(await store.get("config:faqseeded"))) { for (let i = 0; i < DEFAULT_FAQ.length; i++) { const f = DEFAULT_FAQ[i]; await store.set(`faq:d${i}`, { id: "d" + i, category: f[0], q: f[1], a: f[2], order: i }); } await store.set("config:faqseeded", { at: t }); }
    await store.delete(`faq:${cid(b.id)}`); return json(200, { ok: true });
  }
  if (b.action === "help-config") {
    if (!isAdmin) return adminOnly();
    await store.set("config:help", { vchatLink: str(b.vchatLink, 200), by: rec.fullName, at: t });
    return json(200, { ok: true });
  }
  // Ask AI using only our FAQ, knowledge articles and process flows (simple keyword retrieval → AI).
  if (b.action === "faq-ask") {
    if (!(await moduleOn(store, "help", app, rec))) return offMsg();
    const q = str(b.question, 400);
    if (q.length < 4) return json(400, { ok: false, error: "Type your question." });
    let faq = await listOf("faq:"); if (!faq.length) faq = DEFAULT_FAQ.map((f) => ({ category: f[0], q: f[1], a: f[2] }));
    const arts = await listOf("kbart:");
    let flows = await listOf("flow:"); if (!flows.length) flows = DEFAULT_FLOWS;
    const docs = [].concat(
      faq.map((f) => ({ title: "FAQ: " + f.q, text: f.a })),
      arts.map((a) => ({ title: "Guide: " + a.title, text: (a.summary ? a.summary + "\n" : "") + a.body })),
      flows.map((f) => ({ title: "Process: " + f.title, text: f.steps.map((s, i) => (i + 1) + ". " + s.title + (s.detail ? " — " + s.detail : "") + (s.yes ? " (Yes: " + s.yes + "; No: " + s.no + ")" : "") + (s.owner ? " [" + s.owner + (s.tat ? ", " + s.tat : "") + "]" : "")).join("\n") })),
      (Array.isArray(b.builtin) ? b.builtin : []).slice(0, 12).map((d) => ({ title: "Guide: " + str(d.title, 120), text: str(d.text, 4000) })));
    const words = q.toLowerCase().split(/[^a-z0-9%]+/).filter((w) => w.length > 2 && !["how", "what", "the", "and", "for", "are", "why", "who", "does", "with", "this", "that", "from", "into", "can"].includes(w));
    const scored = docs.map((d) => { const txt = (d.title + " " + d.text).toLowerCase(); let s = 0; words.forEach((w) => { if (txt.includes(w)) s += d.title.toLowerCase().includes(w) ? 3 : 1; }); return { d, s }; }).sort((x, y) => y.s - x.s);
    const top = scored.filter((x) => x.s > 0).slice(0, 6).map((x) => x.d);
    const context = top.map((d) => "### " + d.title + "\n" + d.text.slice(0, 2500)).join("\n\n");
    const sys = `You are the help assistant for vivo India's BI team apps. Answer ONLY from the GUIDES below. If the guides don't cover it, say so in one line and suggest raising a Dispute or asking HO. Be short and practical: 2-5 sentences or a few "- " bullets, show formulas when asked "how is X calculated". Reply in Hindi if the user writes in Hindi. No disclaimers.`;
    if (!top.length) return json(200, { ok: true, answer: "", sources: [], noMatch: true });
    const r = await ctx.askAI(ctx.env, q, context, [], ctx.aiFetch, { system: sys, label: "GUIDES" });
    return json(200, { ok: true, answer: r.ok ? r.text : "", aiError: r.ok ? "" : r.error, sources: top.map((d) => d.title).slice(0, 4), fallback: r.ok ? null : top.slice(0, 2).map((d) => ({ title: d.title, text: d.text.slice(0, 600) })) });
  }

  // ---------- escalation matrix (#3) ----------
  if (b.action === "esc-list") {
    if (!(await moduleOn(store, "contacts", app, rec))) return offMsg();
    const hc = (await store.get("config:help")) || {};
    return json(200, { ok: true, rows: (await listOf("esc:")).sort((x, y) => String(x.state).localeCompare(String(y.state)) || String(x.issue).localeCompare(String(y.issue)) || (x.level - y.level)), vchatLink: hc.vchatLink || "", myState: rec.state || "" });
  }
  if (b.action === "esc-save" || b.action === "esc-import") {
    if (!isAdmin) return adminOnly();
    const clean = (r) => ({ state: str(r.state, 40) || "All India", issue: str(r.issue, 60) || "General", level: Math.max(1, Math.min(5, numOr(r.level, 1))), name: str(r.name, 60), role: str(r.role, 60),
      phone: String(r.phone || "").replace(/[^\d+]/g, "").slice(0, 15), vchatId: str(r.vchatId, 40), email: str(r.email, 80), hours: str(r.hours, 40) });
    if (b.action === "esc-save") {
      const r = clean(b.row || {}); if (!r.name) return json(400, { ok: false, error: "Enter the contact's name." });
      const id = cid((b.row || {}).id) || nid(t); await store.set(`esc:${id}`, Object.assign(r, { id }));
      return json(200, { ok: true, id });
    }
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 2000).map(clean).filter((r) => r.name);
    if (!rows.length) return json(400, { ok: false, error: "No valid rows (each needs at least a name)." });
    if (b.replace) for (const k of await store.list("esc:")) await store.delete(k);
    let i = 0; for (const r of rows) { const id = nid(t + i++); await store.set(`esc:${id}`, Object.assign(r, { id })); }
    return json(200, { ok: true, imported: rows.length });
  }
  if (b.action === "esc-delete") { if (!isAdmin) return adminOnly(); await store.delete(`esc:${cid(b.id)}`); return json(200, { ok: true }); }

  // ---------- process flowcharts (#4) ----------
  if (b.action === "flow-list") {
    if (!(await moduleOn(store, "flows", app, rec))) return offMsg();
    const rows = await listOf("flow:");
    const del = (await store.get("config:flowsdel")) || {};
    const builtIn = DEFAULT_FLOWS.filter((f) => !rows.some((r) => r.id === f.id) && !del[f.id]).map((f) => Object.assign({ builtIn: true }, f));
    return json(200, { ok: true, flows: rows.concat(builtIn).sort((x, y) => String(x.title).localeCompare(String(y.title))) });
  }
  if (b.action === "flow-save") {
    if (!isAdmin) return adminOnly();
    const f = b.flow || {}, title = str(f.title, 100);
    if (title.length < 3) return json(400, { ok: false, error: "Give the process a title." });
    const steps = (Array.isArray(f.steps) ? f.steps : []).slice(0, 40).map((s) => ({ type: s.type === "decision" ? "decision" : "step", title: str(s.title, 120), detail: str(s.detail, 500), owner: str(s.owner, 60), tat: str(s.tat, 40), yes: str(s.yes, 160), no: str(s.no, 160) })).filter((s) => s.title);
    if (!steps.length) return json(400, { ok: false, error: "Add at least one step." });
    const id = cid(f.id) || nid(t);
    await store.set(`flow:${id}`, { id, title, icon: str(f.icon, 4) || "🔀", summary: str(f.summary, 200), steps, updatedAt: t, by: rec.fullName });
    return json(200, { ok: true, id });
  }
  if (b.action === "flow-delete") {
    if (!isAdmin) return adminOnly();
    const id = cid(b.id); await store.delete(`flow:${id}`);
    if (DEFAULT_FLOWS.some((f) => f.id === id)) { const d = (await store.get("config:flowsdel")) || {}; d[id] = t; await store.set("config:flowsdel", d); }
    return json(200, { ok: true });
  }

  // ---------- schemes & slabs (#14) ----------
  if (b.action === "scheme-list") {
    if (!(await moduleOn(store, "schemes", app, rec))) return offMsg();
    const rows = (await listOf("scheme:")).filter((s) => isAdmin || s.active !== false).sort((x, y) => String(y.month).localeCompare(String(x.month)) || String(x.name).localeCompare(String(y.name)));
    return json(200, { ok: true, schemes: rows, myState: rec.state || "" });
  }
  if (b.action === "scheme-save") {
    if (!isAdmin) return adminOnly();
    const s = b.scheme || {}, name = str(s.name, 100);
    if (name.length < 3) return json(400, { ok: false, error: "Give the scheme a name." });
    const slabs = (Array.isArray(s.slabs) ? s.slabs : []).slice(0, 12).map((x) => ({ from: numOr(x.from, NaN), rate: numOr(x.rate, NaN), bonus: numOr(x.bonus, 0) })).filter((x) => isFinite(x.from) && isFinite(x.rate)).sort((a, b) => a.from - b.from);
    if (!slabs.length) return json(400, { ok: false, error: "Add at least one slab (From % and rate)." });
    const targets = {}; Object.entries(s.targets || {}).slice(0, 60).forEach(([k, v]) => { const n = Number(v); if (isFinite(n) && n > 0) targets[str(k, 40)] = n; });
    const id = cid(s.id) || nid(t);
    await store.set(`scheme:${id}`, { id, name, month: /^\d{4}-\d{2}$/.test(String(s.month || "")) ? s.month : "", kind: s.kind === "value" ? "value" : "units", method: s.method === "incremental" ? "incremental" : "retro",
      slabs, targets, notes: str(s.notes, 600), active: s.active !== false, updatedAt: t, by: rec.fullName });
    return json(200, { ok: true, id });
  }
  if (b.action === "scheme-delete") { if (!isAdmin) return adminOnly(); await store.delete(`scheme:${cid(b.id)}`); return json(200, { ok: true }); }

  return json(400, { ok: false, error: "Unknown action" });
}
