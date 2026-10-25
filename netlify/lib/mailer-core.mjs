// Report mailer + configuration centre.
// HO admins build a ranking / growth comparison / action plan / custom report on the page, then push it to states:
// by email (Brevo) to the state BI users of each state + mailing lists + extra addresses, and always into the
// "Reports from HO" inbox in both apps and on the web (so it reaches users without an email too).
// Storage:
//   config:centre            { lists:[{id,name,emails[],states[]}], senderName, replyTo, signature, cc[], thresholds:{good,warn},
//                              actionLib:{kpi:[text]}, tools:{tdsPct, preActDays, bulkPerDay, notActDays} }
//   mlrep:<id>               { id, at, by, subject, type, intro, states:{<state>:html}, common, attachName, sent:{...} }
//   mlread:<app>:<key>       { at }   last time the user opened the inbox
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const emails = (v) => [...new Set((Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL.test(e)))].slice(0, 200);
const num = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
export const KPI_KEYS = ["app", "sales", "visit", "comp", "vnotice", "new", "sa", "sp", "an", "av"];
export const DEFAULT_ACTIONS = {
  app: ["Run a Retailer App training call with low-usage retailers this week", "Ask ASMs to check the app on every market visit and help retailers log in", "Share the scheme payout screen video in retailer groups"],
  sales: ["Review the gap to target retailer-wise and push the top 20 gap retailers", "Plan weekend activations with promoters in high-footfall stores", "Check stock availability of fast-moving models with distributors"],
  visit: ["Fix the beat plan so every priority store is visited at least twice a month", "Close visits properly in the app (punch in/out) — check invalid visits daily", "Pair new team members with a senior on market visits"],
  comp: ["Close open support tickets within TAT — review pending ones every morning", "Capture competition activity on every visit", "Escalate tickets older than 3 days to the state head"],
  vnotice: ["Make sure every retailer reads and acknowledges v-Notices within 24 hours", "Follow up retailers who haven't opened the latest v-Notice"],
  new: ["Complete the new implementation checklist with each distributor", "Share a short how-to with the field team and confirm it is live"],
  sa: ["Re-share the current scheme announcement and confirm retailers have seen it"], sp: ["Show retailers where to check scheme payout in the app"],
  an: ["Push announcements to retailers who haven't opened them"], av: ["Encourage retailers to log customer visits in the app"]
};
export function cleanCentre(c) {
  c = c || {};
  const lists = (Array.isArray(c.lists) ? c.lists : []).slice(0, 60).map((l) => ({ id: str(l.id, 20) || randomBytes(4).toString("hex"), name: str(l.name, 60) || "List", emails: emails(l.emails), states: (Array.isArray(l.states) ? l.states : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 40) })).filter((l) => l.emails.length || l.name);
  const actionLib = {};
  KPI_KEYS.forEach((k) => { const a = c.actionLib && c.actionLib[k]; actionLib[k] = (Array.isArray(a) ? a : DEFAULT_ACTIONS[k]).map((x) => str(x, 200)).filter(Boolean).slice(0, 12); });
  const th = c.thresholds || {}, tl = c.tools || {};
  const good = num(th.good, 80, 1, 100), warn = Math.min(good, num(th.warn, 50, 0, 100));
  return { lists, senderName: str(c.senderName, 60), replyTo: EMAIL.test(str(c.replyTo, 120)) ? str(c.replyTo, 120) : "", signature: str(c.signature, 600), cc: emails(c.cc).slice(0, 10),
    thresholds: { good, warn }, actionLib,
    tools: { tdsPct: num(tl.tdsPct, 0, 0, 40), preActDays: num(tl.preActDays, 1, 0, 60), bulkPerDay: num(tl.bulkPerDay, 10, 2, 1000), notActDays: num(tl.notActDays, 30, 1, 365) } };
}
// email HTML is built by admins on the page; strip anything active before storing/sending it
export function safeHtml(h) {
  return String(h || "").slice(0, 400000)
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|base|style)[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, "")
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|base|input|button)[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript|data:text)[^"']*\2/gi, '$1="#"');
}
const TYPES = { ranking: "🏆 Ranking", growth: "📈 Growth comparison", plan: "🗒️ Action plan", custom: "📄 Report" };

export async function mailerAction(b, ctx) {
  const { store, t, app, rec, key, env = {}, mailFetch = fetch, pool } = ctx;
  const isAdmin = app === "admin";
  const centre = async () => cleanCentre(await store.get("config:centre"));
  const mailEnv = () => ({ key: env.BREVO_API_KEY, from: env.OTP_FROM_EMAIL, name: env.OTP_FROM_NAME });
  const readK = `mlread:${app}:${key}`;
  const reps = async () => (await pool((await store.list("mlrep:")).sort().reverse().slice(0, 80), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at);
  const mine = (r) => isAdmin || !!(r.states && r.states[rec.state || ""]) || (r.allStates && !!rec.state);

  if (b.action === "ml-config") {   // read (everyone gets thresholds/tools; admins get everything) or save (admins)
    if (b.save) {
      if (!isAdmin) return json(403, { ok: false, error: "Only HO admins change settings." });
      const c = cleanCentre(b.save);
      await store.set("config:centre", c);
      await ctx.logEvent(store, t, app, rec, "config-centre", { device: c.lists.length + " lists", ver: "" });
      return json(200, { ok: true, config: c });
    }
    const c = await centre(), me = mailEnv();
    if (!isAdmin) return json(200, { ok: true, config: { thresholds: c.thresholds, tools: c.tools, actionLib: c.actionLib } });
    return json(200, { ok: true, config: c, emailReady: !!(me.key && me.from), sender: me.from || "" });
  }

  if (b.action === "ml-recipients") {   // who would get it, per state (admin)
    if (!isAdmin) return json(403, { ok: false, error: "Only HO admins send reports." });
    const by = {}, noEmail = {};
    const us = await pool(await store.list("user:state:"), 40, (k) => store.get(k));
    us.forEach((u) => { if (!u || u.disabled || !u.state) return; if (u.email) (by[u.state] = by[u.state] || []).push(u.email.toLowerCase()); else noEmail[u.state] = (noEmail[u.state] || 0) + 1; });
    const counts = {}; Object.keys(by).forEach((s) => { counts[s] = [...new Set(by[s])].length; });
    const me = mailEnv();
    return json(200, { ok: true, counts, noEmail, lists: (await centre()).lists.map((l) => ({ id: l.id, name: l.name, n: l.emails.length, states: l.states })), emailReady: !!(me.key && me.from), myEmail: rec.email || "" });
  }

  if (b.action === "ml-send") {
    if (!isAdmin) return json(403, { ok: false, error: "Only HO admins send reports." });
    const subject = str(b.subject, 160), type = TYPES[b.type] ? b.type : "custom";
    if (!subject) return json(400, { ok: false, error: "Add a subject." });
    const per = {}; Object.entries(b.perState && typeof b.perState === "object" ? b.perState : {}).slice(0, 60).forEach(([s, h]) => { const st = str(s, 40); if (st) per[st] = safeHtml(h); });
    const common = safeHtml(b.common);
    const states = (Array.isArray(b.states) ? b.states : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 60);
    if (!common && !Object.keys(per).length) return json(400, { ok: false, error: "The report is empty." });
    if (JSON.stringify(per).length + common.length > 2500000) return json(413, { ok: false, error: "The report is too large to send. Choose fewer states or rows." });
    const c = await centre();
    // recipients: state users with an email (per state), lists tagged to a state, then untagged lists + extra + cc (common copy)
    const toState = {};
    if (b.stateUsers !== false && states.length) {
      const us = await pool(await store.list("user:state:"), 40, (k) => store.get(k));
      us.forEach((u) => { if (u && !u.disabled && u.email && states.includes(u.state)) (toState[u.state] = toState[u.state] || new Set()).add(u.email.toLowerCase()); });
    }
    const general = new Set(emails(b.extra));
    (Array.isArray(b.lists) ? b.lists : []).forEach((id) => { const l = c.lists.find((x) => x.id === id); if (!l) return; if (l.states.length) l.states.filter((s) => states.includes(s)).forEach((s) => l.emails.forEach((e) => (toState[s] = toState[s] || new Set()).add(e))); else l.emails.forEach((e) => general.add(e)); });
    if (b.ccMe && rec.email) general.add(String(rec.email).toLowerCase());
    const cc = b.useCc === false ? [] : c.cc;
    let att = null;
    if (b.attachment && b.attachment.b64) {
      const b64 = String(b.attachment.b64).replace(/^data:[^,]*,/, "");
      if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length > 3500000) return json(400, { ok: false, error: "The attachment is too large (max about 2.5 MB)." });
      att = { name: str(b.attachment.name, 80).replace(/[^\w .()-]/g, "_") || "report.xlsx", content: b64 };
    }
    const id = t.toString(36) + randomBytes(3).toString("hex");
    const totalTo = Object.values(toState).reduce((a, s) => a + s.size, 0) + general.size;
    if (totalTo > 400) return json(400, { ok: false, error: "Too many recipients in one send (" + totalTo + "). Split it by states." });
    const me = mailEnv(), ready = !!(me.key && me.from);
    const sent = { emails: 0, failed: 0, errors: [], byState: {}, general: 0, emailReady: ready };
    const wrap = (inner) => inner + (c.signature ? '<div style="font:13px/1.5 Arial,sans-serif;color:#444;margin-top:18px;white-space:pre-line">' + c.signature.replace(/[<>&]/g, (x) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[x])) + "</div>" : "");
    const send = async (to, html, subj) => {
      if (!ready || !to.length) return false;
      const body = { sender: { name: c.senderName || me.name || "vivo BI", email: me.from }, to: to.map((e) => ({ email: e })), subject: subj, htmlContent: wrap(html) };
      if (to.length > 1) { body.to = [{ email: to[0] }]; body.bcc = to.slice(1).map((e) => ({ email: e })); }
      if (cc.length) body.cc = cc.filter((e) => !to.includes(e)).map((e) => ({ email: e }));
      if (body.cc && !body.cc.length) delete body.cc;
      if (c.replyTo) body.replyTo = { email: c.replyTo };
      if (att) body.attachment = [att];
      try {
        const r = await mailFetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": me.key }, body: JSON.stringify(body) });
        if (r.ok) { sent.emails += to.length; return true; }
        let m = ""; try { m = (await r.json()).message || ""; } catch (e) { }
        sent.failed += to.length; if (sent.errors.length < 5) sent.errors.push("Brevo " + r.status + (m ? ": " + String(m).slice(0, 120) : "")); return false;
      } catch (e) { sent.failed += to.length; if (sent.errors.length < 5) sent.errors.push(String(e.message || e).slice(0, 120)); return false; }
    };
    for (const s of states) {
      const to = [...(toState[s] || [])]; sent.byState[s] = to.length;
      if (to.length) await send(to, per[s] || common, subject.includes("{state}") ? subject.replace(/\{state\}/g, s) : subject + " — " + s);
    }
    if (general.size) { sent.general = general.size; await send([...general], common || per[states[0]] || Object.values(per)[0], subject.replace(/\{state\}/g, "All states")); }
    const repStates = {}; states.forEach((s) => { repStates[s] = per[s] || common; });
    await store.set(`mlrep:${id}`, { id, at: t, by: { name: rec.fullName || rec.username, username: rec.username }, subject: subject.replace(/\{state\}/g, "").replace(/\s+—\s*$/, "").trim(), type, intro: str(b.intro, 600), states: repStates, common, attachName: att ? att.name : "", sent });
    const ks = (await store.list("mlrep:")).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - 150))) await store.delete(k);
    await ctx.logEvent(store, t, app, rec, "report-mail", { device: TYPES[type] + " · " + states.length + " states · " + sent.emails + " emails", ver: "" });
    return json(200, { ok: true, id, sent, inbox: states.length });
  }

  if (b.action === "ml-list") {   // admins: sent log; state users: their inbox
    const all = (await reps()).filter(mine);
    const last = ((await store.get(readK)) || {}).at || 0;
    return json(200, { ok: true, items: all.map((r) => ({ id: r.id, at: r.at, by: r.by && r.by.name, subject: r.subject, type: r.type, typeLabel: TYPES[r.type], states: Object.keys(r.states || {}), attach: !!r.attachName, sent: isAdmin ? r.sent : undefined, fresh: r.at > last })) });
  }
  if (b.action === "ml-get") {
    const r = await store.get(`mlrep:${str(b.id, 40).replace(/[^a-z0-9]/g, "")}`);
    if (!r || !mine(r)) return json(404, { ok: false, error: "Report not found." });
    const st = isAdmin ? str(b.state, 40) || Object.keys(r.states || {})[0] : rec.state;
    return json(200, { ok: true, item: { id: r.id, at: r.at, by: r.by && r.by.name, subject: r.subject, typeLabel: TYPES[r.type], state: st, html: (r.states && r.states[st]) || r.common, states: isAdmin ? Object.keys(r.states || {}) : [st], sent: isAdmin ? r.sent : undefined } });
  }
  if (b.action === "ml-seen") { await store.set(readK, { at: t }); return json(200, { ok: true }); }
  if (b.action === "ml-delete") {
    if (!isAdmin) return json(403, { ok: false, error: "Only HO admins." });
    await store.delete(`mlrep:${str(b.id, 40).replace(/[^a-z0-9]/g, "")}`); return json(200, { ok: true });
  }
  if (b.action === "ml-notify") {
    const last = ((await store.get(readK)) || {}).at || 0;
    const ks = (await store.list("mlrep:")).sort().reverse().slice(0, 30);
    let n = 0; for (const k of ks) { const r = await store.get(k); if (r && r.at > last && mine(r) && !(r.by && r.by.username === rec.username && isAdmin)) n++; }
    return json(200, { ok: true, fresh: n });
  }
  return json(400, { ok: false, error: "Unknown action." });
}
