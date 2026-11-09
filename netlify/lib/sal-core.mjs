// Salary & incentives for state sales employees. HO sets company-wide structures / plans; each state can add its own.
// Monthly: attendance + sales + adjustments → Calculate (draft) → Publish → employees see the break-up and payslips
// through their own secure link (checked with the last 4 digits of their mobile). Salary credit: 1st of next month,
// incentive: 15 days later (configurable). The engine is salcalc-core.mjs (same file the page uses).
//   sal:cfg:HO | sal:cfg:<state>   {structures, plans, settings}
//   sal:emp:<state> {list}   sal:in:<state>:<yyyy-mm> {att, sales, adj}   sal:run:<state>:<yyyy-mm> {status, rows}
//   sallink:<token> {state, code, fails, lockUntil}
import { randomBytes } from "node:crypto";
import { STRUCTURES, PLANS, compute, evalExpr, easyRule, easyText, EASY_FIELDS, RULE_TYPES } from "./salcalc-core.mjs";
import { parseLoose } from "./man-core.mjs";
import { STATES } from "./cmp-core.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const code = (v) => String(v || "").trim().replace(/[^A-Za-z0-9_\-\/]/g, "").slice(0, 30);
const mon = (v) => (/^\d{4}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const skey = (s) => String(s || "").replace(/[^A-Za-z0-9 &\-]/g, "").trim().slice(0, 50);
const clone = (o) => JSON.parse(JSON.stringify(o));
const SIZE = 400000;

// the HO library starts as a copy of the ready-made structures and plans
function seedHO() { return { structures: STRUCTURES.map((x) => Object.assign(clone(x), { id: "ho-" + x.id, scope: "HO" })), plans: PLANS.map((x) => Object.assign(clone(x), { id: "ho-" + x.id, scope: "HO" })), settings: { salDay: 1, incDelay: 15 } }; }
const cleanEmp = (x, state) => ({ code: code(x.code), name: str(x.name, 80), state, city: str(x.city, 60), role: str(x.role, 60) || "Sales promoter", doj: str(x.doj, 10), mobile: String(x.mobile || "").replace(/\D/g, "").slice(-10), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x.email || "").trim()) ? String(x.email).trim().toLowerCase().slice(0, 80) : "", gross: num(x.gross), ctc: num(x.ctc), dailyRate: num(x.dailyRate), ti: num(x.ti), insurance: num(x.insurance), otherAnnual: num(x.otherAnnual), struct: str(x.struct, 40), plan: str(x.plan, 40), uan: str(x.uan, 20), pan: str(x.pan, 12).toUpperCase(), bank: String(x.bank || "").replace(/\D/g, "").slice(-4), ifsc: str(x.ifsc, 15).toUpperCase(), store: str(x.store, 80), active: x.active !== false && !/^(no|inactive|left|0)$/i.test(String(x.active)) });

export async function salAction(b, ctx) {
  const { store, t, app, rec } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "";
  const myState = isHO ? "" : skey(rec.state);
  const stOf = (s) => (isHO ? skey(s) : myState);
  const getCfg = async (scope) => { const k = "sal:cfg:" + (scope || "HO"); let c = await store.get(k); if (!c && scope === "HO") { c = seedHO(); await store.set(k, c); } return c || { structures: [], plans: [], settings: {} }; };
  const merged = async (state) => { const H = await getCfg("HO"), S = state ? await getCfg(state) : { structures: [], plans: [], settings: {} };
    return { structures: H.structures.concat(S.structures || []), plans: H.plans.concat(S.plans || []), settings: Object.assign({ salDay: 1, incDelay: 15 }, H.settings || {}, S.settings || {}), hoSettings: H.settings || {} }; };
  const emps = async (state) => (await store.get("sal:emp:" + state)) || { list: [] };

  if (b.action === "sal-boot") {
    const L = await store.list("sal:emp:"), states = isHO ? [...new Set(STATES.concat(L.map((k) => k.slice(8))))].sort() : [myState];
    return json(200, { ok: true, me: { isHO, state: myState, name: by }, states, cfg: await merged(isHO ? skey(b.state) : myState) });
  }
  if (b.action === "sal-cfg-get") return json(200, { ok: true, cfg: await merged(stOf(b.state)) });
  if (b.action === "sal-cfg-save") {   // HO edits the HO library; a state edits only its own additions
    const scope = isHO && (!b.scope || b.scope === "HO") ? "HO" : stOf(b.scope || b.state); if (!scope) return json(400, { ok: false, error: "Pick the state." });
    const C = await getCfg(scope), pre = scope === "HO" ? "ho-" : "st-";
    const fix = (L) => (Array.isArray(L) ? L : []).slice(0, 40).map((x) => Object.assign(clone(x), { id: String(x.id || "").startsWith(pre) ? String(x.id).slice(0, 40) : pre + (Date.now().toString(36) + randomBytes(2).toString("hex")), scope, name: str(x.name, 100) || "Untitled", by, at: t }));
    if (b.structures) C.structures = fix(b.structures); if (b.plans) C.plans = fix(b.plans);
    if (b.settings) C.settings = { salDay: Math.max(1, Math.min(28, num(b.settings.salDay) || 1)), incDelay: Math.max(0, Math.min(60, num(b.settings.incDelay) || 15)) };
    if (JSON.stringify(C).length > SIZE) return json(400, { ok: false, error: "Too many rules — keep each library under 40 items." });
    await store.set("sal:cfg:" + scope, C); return json(200, { ok: true, cfg: await merged(scope === "HO" ? skey(b.state) : scope) });
  }

  // ---------- employees ----------
  if (b.action === "sal-emp-list") { const st = stOf(b.state); if (!st) return json(400, { ok: false, error: "Pick the state." }); return json(200, { ok: true, list: (await emps(st)).list }); }
  if (b.action === "sal-emp-save") {
    const st = stOf(b.state || (b.emp || {}).state); if (!st) return json(400, { ok: false, error: "Pick the state." });
    const E = await emps(st), e = cleanEmp(b.emp || {}, st); if (!e.code || !e.name) return json(400, { ok: false, error: "Employee code and name are needed." });
    const old = E.list.find((x) => x.code === e.code); if (old) e.token = old.token; E.list = E.list.filter((x) => x.code !== e.code).concat([e]);
    await store.set("sal:emp:" + st, E); return json(200, { ok: true, emp: e });
  }
  if (b.action === "sal-emp-import") {
    const st = stOf(b.state); if (!st) return json(400, { ok: false, error: "Pick the state." });
    const E = await emps(st), M = {}; E.list.forEach((x) => { M[x.code] = x; }); let n = 0;
    (b.rows || []).slice(0, 5000).forEach((x) => { const e = cleanEmp(x, st); if (!e.code || !e.name) return; const o = M[e.code]; if (o) { e.token = o.token; ["struct", "plan"].forEach((k) => { if (!e[k]) e[k] = o[k]; }); } M[e.code] = e; n++; });
    E.list = Object.values(M); if (JSON.stringify(E).length > 4000000) return json(400, { ok: false, error: "Too many employees for one state." });
    await store.set("sal:emp:" + st, E); return json(200, { ok: true, n, total: E.list.length });
  }
  if (b.action === "sal-emp-del") { const st = stOf(b.state), E = await emps(st); const e = E.list.find((x) => x.code === code(b.code)); if (!e) return json(404, { ok: false, error: "Not found." }); e.active = false; await store.set("sal:emp:" + st, E); return json(200, { ok: true }); }

  // ---------- monthly inputs ----------
  if (b.action === "sal-in-get") { const st = stOf(b.state), m = mon(b.month); if (!st || !m) return json(400, { ok: false, error: "Pick state and month." }); return json(200, { ok: true, inp: (await store.get(`sal:in:${st}:${m}`)) || { att: {}, sales: {}, adj: {} } }); }
  if (b.action === "sal-in-save") {   // merge rows of any of the three sheets
    const st = stOf(b.state), m = mon(b.month); if (!st || !m) return json(400, { ok: false, error: "Pick state and month." });
    const run = await store.get(`sal:run:${st}:${m}`); if (run && run.status === "published") return json(400, { ok: false, error: "This month is published — unpublish it first to change inputs." });
    const k = `sal:in:${st}:${m}`, I = (await store.get(k)) || { att: {}, sales: {}, adj: {} };
    const A = (o) => ({ present: num(o.present), paidLeave: num(o.paidLeave), weekOff: num(o.weekOff), holiday: num(o.holiday), lop: num(o.lop), fieldDays: num(o.fieldDays), extraDays: num(o.extraDays) });
    const S = (o) => { const fin = {}, models = {}, vars = {}; Object.keys(o.fin || {}).slice(0, 30).forEach((f) => { if (num(o.fin[f])) fin[str(f, 40)] = num(o.fin[f]); }); Object.keys(o.models || {}).slice(0, 80).forEach((f) => { if (num(o.models[f])) models[str(f, 40)] = num(o.models[f]); }); Object.keys(o.vars || {}).slice(0, 20).forEach((f) => { const kk = String(f).replace(/\W+/g, "_").slice(0, 30); if (kk) vars[kk] = num(o.vars[f]); });
      return { target: num(o.target), units: num(o.units), value: num(o.value), valueTarget: num(o.valueTarget), vshield: num(o.vshield), emi: num(o.emi), fin, models, vars }; };
    const D = (o) => ({ advance: num(o.advance), otherDed: num(o.otherDed), services: num(o.services), arrears: num(o.arrears), otherEarn: num(o.otherEarn), tds: num(o.tds), incDed: num(o.incDed), remark: str(o.remark, 120) });
    let n = 0; [["att", A], ["sales", S], ["adj", D]].forEach(([sh, fn]) => { const R = b[sh]; if (!R) return; if (b.replace) I[sh] = {}; Object.keys(R).slice(0, 5000).forEach((c) => { const cc = code(c); if (cc) { I[sh][cc] = fn(R[c] || {}); n++; } }); });
    I.at = t; I.by = by; if (JSON.stringify(I).length > 4000000) return json(400, { ok: false, error: "Too much data for one month." });
    await store.set(k, I); return json(200, { ok: true, n });
  }

  // ---------- calculate / publish ----------
  if (b.action === "sal-run") {
    const st = stOf(b.state), m = mon(b.month); if (!st || !m) return json(400, { ok: false, error: "Pick state and month." });
    const old = await store.get(`sal:run:${st}:${m}`); if (old && old.status === "published") return json(400, { ok: false, error: "Already published — unpublish to recalculate." });
    const [E, I, C] = await Promise.all([emps(st), store.get(`sal:in:${st}:${m}`), merged(st)]), inp = I || { att: {}, sales: {}, adj: {} };
    const SM = {}, PM = {}; C.structures.forEach((x) => { SM[x.id] = x; }); C.plans.forEach((x) => { PM[x.id] = x; });
    const rows = {}, warn = [];
    E.list.filter((e) => e.active !== false).forEach((e) => { const s = SM[e.struct], p = PM[e.plan]; if (!s) warn.push(e.code + ": no salary structure"); if (!p) warn.push(e.code + ": no incentive plan");
      try { const r = compute(e, s, p, { att: inp.att[e.code], sales: inp.sales[e.code], adj: inp.adj[e.code] }, m, C.settings); r.emp = { code: e.code, name: e.name, role: e.role, city: e.city, store: e.store, doj: e.doj, uan: e.uan, pan: e.pan ? e.pan.slice(0, 2) + "XXXXX" + e.pan.slice(-3) : "", bank: e.bank, ifsc: e.ifsc, gross: e.gross, ti: e.ti }; r.structName = s ? s.name : ""; r.planName = p ? p.name : ""; r.planSnap = p ? clone(p) : null; rows[e.code] = r; }
      catch (x) { warn.push(e.code + ": " + x.message); } });
    const R = Object.values(rows), tot = { n: R.length, gross: R.reduce((a, r) => a + (r.salary ? r.salary.gross : 0), 0), salNet: R.reduce((a, r) => a + (r.salary ? r.salary.net : 0), 0), incNet: R.reduce((a, r) => a + (r.incentive ? r.incentive.net : 0), 0), ded: R.reduce((a, r) => a + (r.salary ? r.salary.totalDed : 0), 0), employer: R.reduce((a, r) => a + (r.salary ? r.salary.employer.reduce((x, y) => x + y.amt, 0) : 0), 0) };
    const run = { state: st, month: m, status: "draft", at: t, by, rows, tot, warn: warn.slice(0, 100), settings: C.settings };
    if (JSON.stringify(run).length > 4500000) return json(400, { ok: false, error: "Too many employees to calculate at once." });
    await store.set(`sal:run:${st}:${m}`, run); return json(200, { ok: true, run });
  }
  if (b.action === "sal-run-get") { const st = stOf(b.state), m = mon(b.month); return json(200, { ok: true, run: (await store.get(`sal:run:${st}:${m}`)) || null }); }
  if (b.action === "sal-months") { const st = stOf(b.state), L = await store.list(`sal:run:${st}:`), out = []; for (const k of L.slice(-24)) { const r = await store.get(k); if (r) out.push({ month: r.month, status: r.status, n: r.tot.n, salNet: r.tot.salNet, incNet: r.tot.incNet, at: r.pubAt || r.at }); } return json(200, { ok: true, months: out.sort((a, c) => (a.month < c.month ? 1 : -1)) }); }
  if (b.action === "sal-publish") {
    const st = stOf(b.state), m = mon(b.month), k = `sal:run:${st}:${m}`, r = await store.get(k); if (!r) return json(400, { ok: false, error: "Calculate first." });
    r.status = b.undo ? "draft" : "published"; if (!b.undo) { r.pubAt = t; r.pubBy = by; } await store.set(k, r); return json(200, { ok: true, status: r.status });
  }
  // 📣 after publishing: each employee gets an e-mail with their payslip PDF and / or a WhatsApp message with their pay link
  if (b.action === "sal-notify-info") {
    const ec = await store.get("config:email"), wa = (await store.get("config:wa")) || {}, pk = wa.provider === "periskope";
    return json(200, { ok: true, mail: !!((ctx.env && ctx.env.BREVO_API_KEY && ctx.env.OTP_FROM_EMAIL) || (ec && ec.apiKey && ec.from)), wa: pk ? !!(wa.pkKey && wa.pkPhone) : !!(wa.token && wa.phoneId && wa.template), provider: pk ? "periskope" : "meta", gap: pk ? wa.pkGap || 30 : 0, daily: pk ? wa.pkDaily || 40 : 0 });
  }
  if (b.action === "sal-notify") {
    const st = stOf(b.state), m = mon(b.month), k = `sal:run:${st}:${m}`, r = await store.get(k); if (!r) return json(400, { ok: false, error: "Calculate first." });
    if (r.status !== "published") return json(400, { ok: false, error: "Publish the month first." });
    const E = await emps(st), e = E.list.find((x) => x.code === code(b.code)), row = r.rows[code(b.code)]; if (!e || !row) return json(404, { ok: false, error: "Employee not in this month." });
    if (!e.token) { e.token = randomBytes(12).toString("hex"); await store.set("sallink:" + e.token, { state: st, code: e.code, at: t }); await store.set("sal:emp:" + st, E); }
    const origin = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(String(b.origin || "")) ? b.origin : (ctx.env && (ctx.env.SITE_URL || ctx.env.URL)) || "";
    const link = origin + "/salary.html#me=" + e.token, ML = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], mT = ML[+m.slice(5) - 1] + " " + m.slice(0, 4);
    const sal = row.salary ? Math.round(row.salary.net) : 0, inc = row.incentive ? Math.round(row.incentive.net) : 0, rs = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
    const via = Array.isArray(b.via) ? b.via : ["mail", "wa"], out = { code: e.code, name: e.name, mail: null, wa: null };
    if (via.includes("mail")) {
      if (!e.email) out.mail = { ok: false, error: "No e-mail saved" };
      else {
        let env = ctx.env || {}; if (!env.BREVO_API_KEY || !env.OTP_FROM_EMAIL) { const ec = await store.get("config:email"); if (ec && ec.apiKey && ec.from) env = Object.assign({}, env, { BREVO_API_KEY: ec.apiKey, OTP_FROM_EMAIL: ec.from }); }
        if (!env.BREVO_API_KEY) out.mail = { ok: false, error: "E-mail isn't set up on the server" };
        else {
          const pdf = String(b.pdf || "").replace(/^data:application\/pdf;base64,/, ""), att = /^[A-Za-z0-9+/=]+$/.test(pdf) && pdf.length > 200 && pdf.length < 2600000 ? [{ content: pdf, name: `Payslip_${m}_${e.code}.pdf` }] : undefined;
          const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#1b1d2e"><div style="background:#2B33A6;color:#fff;padding:16px 18px;border-radius:12px 12px 0 0"><b style="font-size:18px">Your pay for ${mT}</b><div style="font-size:12px;opacity:.85">vivo sales team · ${st}</div></div><div style="border:1px solid #e6e8f2;border-top:0;padding:16px 18px;border-radius:0 0 12px 12px;font-size:14px;line-height:1.6">Hi ${e.name},<br><br>${row.salary ? `Net salary: <b>${rs(sal)}</b> (credited on ${row.credit && row.credit.salary || "the 1st"})<br>` : ""}${row.incentive ? `Net incentive: <b>${rs(inc)}</b> (credited on ${row.credit && row.credit.incentive || "the 16th"})<br>` : ""}<br>Your payslip${att ? " is attached" : ""}. See every line of how it was worked out here:<br><a href="${link}" style="display:inline-block;margin-top:8px;background:#2B33A6;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:700">Open my pay details</a><div style="font-size:12px;color:#6b7090;margin-top:10px">The page asks for the last 4 digits of your registered mobile.</div></div></div>`;
          try { const res = await (ctx.mailFetch || fetch)("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": env.BREVO_API_KEY }, body: JSON.stringify({ sender: { name: "vivo Payroll", email: env.OTP_FROM_EMAIL }, to: [{ email: e.email, name: e.name }], subject: `Your payslip · ${mT}`, htmlContent: html, attachment: att }) });
            out.mail = res.ok ? { ok: true } : { ok: false, error: "E-mail " + res.status };
          } catch (er) { out.mail = { ok: false, error: String(er.message || er).slice(0, 100) }; }
        }
      }
    }
    if (via.includes("wa")) {
      const c = (await store.get("config:wa")) || {}, PK = c.provider === "periskope", to = e.mobile && e.mobile.length === 10 ? "91" + e.mobile : "";
      if (!to) out.wa = { ok: false, error: "No mobile number" };
      else if (PK ? !(c.pkKey && c.pkPhone) : !(c.token && c.phoneId && c.template)) out.wa = { ok: false, error: "WhatsApp isn't set up (Retailer payouts → ⚙️ WhatsApp settings)" };
      else {
        const dayKey = "wapk:day:" + new Date(t + 5.5 * 36e5).toISOString().slice(0, 10), used = PK ? (((await store.get(dayKey)) || {}).n || 0) : 0;
        if (PK && used >= (c.pkDaily || 40)) out.wa = { ok: false, error: "Today's safe WhatsApp limit is reached — the rest go tomorrow" };
        else {
          const text = `Hi ${e.name}, your pay for ${mT} is published ✅\n${row.salary ? "Net salary: " + rs(sal) + "\n" : ""}${row.incentive ? "Net incentive: " + rs(inc) + "\n" : ""}Payslip & full breakup: ${link}\n(Enter the last 4 digits of your mobile.)`;
          try {
            const res = PK ? await (ctx.waFetch || fetch)("https://api.periskope.app/v1/message/send", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + c.pkKey, "x-phone": c.pkPhone }, body: JSON.stringify({ chat_id: to + "@c.us", message: text }) })
              : await (ctx.waFetch || fetch)(`https://graph.facebook.com/v21.0/${c.phoneId}/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + c.token }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: c.template, language: { code: c.lang || "en" }, components: [{ type: "body", parameters: (c.vars || "name,amount,month,link").split(",").map((v) => ({ type: "text", text: String({ name: e.name, amount: (sal + inc).toLocaleString("en-IN"), month: mT, link, schemes: "Salary & incentive", rid: e.code }[v] || "-") })) }] } }) });
            out.wa = res.ok ? { ok: true } : { ok: false, error: "WhatsApp " + res.status };
            if (res.ok && PK) await store.set(dayKey, { n: used + 1, at: t });
          } catch (er) { out.wa = { ok: false, error: String(er.message || er).slice(0, 100) }; }
        }
      }
    }
    r.notified = r.notified || {}; r.notified[e.code] = Object.assign({}, r.notified[e.code], out.mail && out.mail.ok ? { mail: t } : {}, out.wa && out.wa.ok ? { wa: t } : {}); await store.set(k, r);
    return json(200, Object.assign({ ok: true }, out));
  }
  // ✨ AI writes a rule / formula from plain words
  if (b.action === "sal-ai-rule") {
    const text = String(b.text || "").trim().slice(0, 600); if (text.length < 6) return json(400, { ok: false, error: "Describe the rule in a sentence." });
    const fields = EASY_FIELDS.map((f) => f[0] + " = " + f[1]).join("; ");
    const sys = b.kind === "expr"
      ? `You write payroll formulas for an Indian sales team. Names you can use: gross, ctc, basic (if defined), paidDays, monthDays, basisDays, lopDays, presentDays, fieldDays, extraDays, dailyRate, ti, insurance. Functions: min max round floor ceil abs if(c,a,b) pct(x,p) percent(a,b) above(x,limit) below(x,limit) cap(x,max) atleast(x,min) per(x,every,amt) slab(x, upto1, v1, …, else). Operators + - * / ( ) < <= > >= == != and or not, cond ? a : b. Reply ONLY JSON {"expr":"…","explain":"one simple sentence"}.`
      : `You turn an incentive rule written in plain words into JSON for a sales incentive tool. Prefer a SIMPLE rule: {"type":"easy","n":"short name","pay":"fixed|perUnit|pct|every","amt":number,"of":"field","every":number,"conds":[{"f":"field","op":">=|>|<=|<|==|!=","v":number}],"max":number}. Fields: ${fields}. For slabs use {"type":"slab","n":"","on_":"ach|units","mode":"perUnit|fixed|pctTI","base":"all|above","slabs":[[from,to,value]]} (to = 999999999 for no limit). Only if nothing else fits use {"type":"formula","n":"","expr":"…"} with the same field names and functions min max round if(c,a,b) pct percent above per slab. Reply ONLY JSON {"rule":{…},"explain":"one simple sentence"}.`;
    const r = await ctx.askAI(ctx.env, text, "", [], ctx.aiFetch, { system: sys, label: "RULE", maxTokens: 700, json: true, raw: true });
    const j = r.ok ? parseLoose(r.text) : null; if (!j) return json(200, { ok: false, error: r.error || "The AI reply couldn't be read — try saying it another way." });
    const V = { units: 42, target: 40, ach: 105, aboveTarget: 2, value: 777000, valueTarget: 700000, vshield: 13, vsAttach: 31, emi: 17, emiAttach: 40, paidDays: 30, presentDays: 26, fieldDays: 24, lopDays: 0, ti: 5000, gross: 18000, ctc: 21000, basic: 9000, monthDays: 31, basisDays: 31, extraDays: 0, dailyRate: 700, insurance: 250 };
    if (b.kind === "expr") { try { evalExpr(j.expr, V); } catch (er) { return json(200, { ok: false, error: "The AI formula didn't work (" + er.message + ") — try again." }); } return json(200, { ok: true, expr: String(j.expr).slice(0, 400), explain: String(j.explain || "").slice(0, 300) }); }
    const ru = j.rule || j; if (!ru || !RULE_TYPES[ru.type]) return json(200, { ok: false, error: "The AI didn't return a usable rule — try again." });
    if (ru.type === "formula") { try { evalExpr(ru.expr, V); } catch (er) { return json(200, { ok: false, error: "The AI formula didn't work (" + er.message + ")." }); } }
    ru.id = "r" + t.toString(36).slice(-5); ru.on = true; ru.n = String(ru.n || text).slice(0, 60);
    return json(200, { ok: true, rule: ru, explain: String(j.explain || (ru.type === "easy" ? easyText(ru) : "")).slice(0, 300) });
  }
  // employee links: one secure link each (re-used), opened with the last 4 digits of their mobile
  if (b.action === "sal-links") {
    const st = stOf(b.state), E = await emps(st), only = Array.isArray(b.codes) ? b.codes.map(code) : null, out = []; let ch = false;
    for (const e of E.list) { if (e.active === false || (only && !only.includes(e.code))) continue; if (!e.token) { e.token = randomBytes(12).toString("hex"); ch = true; await store.set("sallink:" + e.token, { state: st, code: e.code, at: t }); } out.push({ code: e.code, name: e.name, mobile: e.mobile, token: e.token }); }
    if (ch) await store.set("sal:emp:" + st, E); return json(200, { ok: true, links: out });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// ---------- employee view (no login): secure link + last 4 digits of the registered mobile ----------
export async function salPublic(b, ctx) {
  const { store, t } = ctx, tok = String(b.token || "").replace(/[^a-f0-9]/g, "").slice(0, 40);
  const L = tok ? await store.get("sallink:" + tok) : null; if (!L) return json(404, { ok: false, error: "This link isn't valid — ask your state BI team for a new one." });
  if (L.lockUntil && L.lockUntil > t) return json(429, { ok: false, error: "Too many wrong tries — try again in an hour." });
  const E = (await store.get("sal:emp:" + L.state)) || { list: [] }, e = E.list.find((x) => x.code === L.code); if (!e || e.active === false) return json(404, { ok: false, error: "This link is no longer active." });
  const pin = String(b.pin || "").replace(/\D/g, "");
  if (!e.mobile || pin !== e.mobile.slice(-4)) { L.fails = (L.fails || 0) + 1; if (L.fails >= 8) { L.lockUntil = t + 36e5; L.fails = 0; } await store.set("sallink:" + tok, L); return json(403, { ok: false, need: "pin", error: pin ? "That doesn't match — enter the last 4 digits of your registered mobile." : "Enter the last 4 digits of your registered mobile." }); }
  if (L.fails) { L.fails = 0; await store.set("sallink:" + tok, L); }
  const keys = (await store.list(`sal:run:${L.state}:`)).slice(-12), months = [];
  for (const k of keys) { const r = await store.get(k); if (r && r.status === "published" && r.rows[e.code]) months.push(Object.assign({}, r.rows[e.code], { pubAt: r.pubAt })); }
  return json(200, { ok: true, emp: { code: e.code, name: e.name, role: e.role, state: L.state, city: e.city, store: e.store, doj: e.doj }, months: months.sort((a, c) => (a.month < c.month ? 1 : -1)) });
}
