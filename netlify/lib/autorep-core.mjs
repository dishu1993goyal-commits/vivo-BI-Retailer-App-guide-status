// Scheduled auto-reports (#5): a daily or weekly summary for each state, built from the same KPI engine and data
// as the dashboard (read from the published index.html), plus field activity (visits, disputes, hygiene).
// Delivered in the apps (badge + Reports → Auto-reports) and by email (Brevo) to state users with an email.
// Storage:
//   config:autorep        { enabled, freq:"daily"|"weekly", weekday:1, hour:9, email:true, lastRunAt, lastRunKey }
//   autorep:<runId>       { id, at, period:{label,f,t}, pan:{...}, states:{<state>: report}, by }
//   autorepread:<app>:<key> { at }
//   autojob:<id>          one-time ticket for the background function
import vm from "node:vm";
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const istNow = (t) => new Date(t + 5.5 * 3600000);
const KNAME = { app: "Retailer App usage", sales: "Sales achievement", visit: "Customer visit efficiency", comp: "Competition / support desk", vnotice: "v-Notice", new: "New implementation" };
const pct = (v) => (v == null ? "—" : Math.round(v * 1000) / 10 + "%");

// ---- read the dashboard data + KPI engine from the published site ----
export function loadKE(html) {
  const tag = '<script type="application/json" id="dd">';
  const d0 = html.indexOf(tag), d1 = html.indexOf("</script>", d0);
  const e0 = html.indexOf('<script id="s-eng">'), e1 = html.indexOf("</script>", e0);
  if (d0 < 0 || e0 < 0) throw new Error("dashboard data not found in index.html");
  const D = JSON.parse(html.slice(d0 + tag.length, d1));
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(html.slice(e0 + '<script id="s-eng">'.length, e1) + ";module.exports = KE;", sandbox, { timeout: 20000 });
  return { KE: sandbox.module.exports, RAW: D.rawlog[0], SETUP: D.setup[0] };
}
const monthStart = (d) => d.slice(0, 8) + "01";
const prevMonth = (m) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1; if (mo < 1) { mo = 12; y--; } return y + "-" + String(mo).padStart(2, "0"); };
const lastDay = (m) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return m + "-" + String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0"); };

export function buildReport({ KE, RAW, SETUP }, extras = {}) {
  const sp = KE.span(RAW); if (!sp) throw new Error("no data in dashboard");
  const m = sp.t.slice(0, 7), f = monthStart(sp.t), to = sp.t;
  const cur = KE.scorePeriod(RAW, SETUP, f, to, "Total");
  let prev = null; const pm = prevMonth(m);
  if (RAW.days.some((d) => d.slice(0, 7) === pm)) prev = KE.scorePeriod(RAW, SETUP, pm + "-01", lastDay(pm), "Total");
  const rows = cur.kpi_state.filter((r) => r.state && r.code !== "PAN");
  const pan = cur.kpi_state.find((r) => r.code === "PAN") || {};
  const prevRank = {}; if (prev) prev.kpi_state.forEach((r) => { if (r.code !== "PAN") prevRank[r.state] = r.rank; });
  const kpis = Object.keys(KNAME).filter((k) => rows.some((r) => r[k] != null && (cur.cfg && cur.cfg.w ? true : true)));
  const counts = {}; cur.kpi_counts.forEach((c) => { const s = counts[c.state] = counts[c.state] || { visits: 0, sd_raised: 0, sd_closed: 0, comp_n: 0 }; s.visits += c.visits || 0; s.sd_raised += c.sd_raised || 0; s.sd_closed += c.sd_closed || 0; s.comp_n += c.comp_n || 0; });
  const top = rows.slice().sort((a, b) => a.rank - b.rank).slice(0, 5).map((r) => ({ state: r.state, rank: r.rank, score: Math.round(r.score * 10) / 10 }));
  const states = {};
  rows.forEach((r) => {
    const ks = kpis.filter((k) => r[k] != null && !(k === "new" && !r[k]));
    const weakest = ks.slice().sort((a, b) => (r[a] || 0) - (r[b] || 0))[0];
    states[r.state] = { state: r.state, rank: r.rank, of: rows.length, score: Math.round(r.score * 10) / 10, prevRank: prevRank[r.state] || null, change: prevRank[r.state] ? prevRank[r.state] - r.rank : null,
      kpis: ks.map((k) => ({ k, name: KNAME[k], ach: r[k], rank: r["rank_" + k] || null })), weakest: weakest ? { k: weakest, name: KNAME[weakest], ach: r[weakest] } : null,
      counts: counts[r.state] || null, field: (extras.field || {})[r.state] || null };
  });
  return { period: { label: KE.monthLabel ? (() => { try { return KE.monthLabel(m); } catch (e) { return m; } })() : m, month: m, f, t: to }, pan: { score: Math.round((pan.score || 0) * 10) / 10, top }, states };
}

function emailHtml(r, state, link) {
  const s = r.states[state]; if (!s) return "";
  const arrow = s.change == null ? "" : s.change > 0 ? ` <span style="color:#1E9E61">▲ ${s.change}</span>` : s.change < 0 ? ` <span style="color:#E05757">▼ ${-s.change}</span>` : " (no change)";
  const kpiRows = s.kpis.map((k) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${k.name}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${pct(k.ach)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${k.rank ? "#" + k.rank : ""}</td></tr>`).join("");
  const fd = s.field;
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e3e5f0;border-radius:14px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#1F2340,#4D5BF9);color:#fff;padding:16px 18px"><div style="font-size:11px;letter-spacing:.15em;opacity:.85">VIVO BUSINESS INNOVATION · AUTO-REPORT</div><div style="font-size:20px;font-weight:800;margin-top:4px">${state} — ${r.period.label}</div><div style="font-size:12px;opacity:.85">Data up to ${r.period.t}</div></div>
  <div style="padding:16px 18px;color:#1F2340"><div style="display:flex;gap:10px"><div style="flex:1;background:#F5F6FF;border-radius:10px;padding:10px"><div style="font-size:11px;color:#6B7090">State rank</div><div style="font-size:22px;font-weight:800">#${s.rank}<span style="font-size:12px;font-weight:600;color:#6B7090"> of ${s.of}</span>${arrow}</div></div>
  <div style="flex:1;background:#F5F6FF;border-radius:10px;padding:10px"><div style="font-size:11px;color:#6B7090">BI KPI score</div><div style="font-size:22px;font-weight:800">${s.score}</div></div></div>
  ${s.weakest ? `<p style="background:#FFF4E5;border-radius:10px;padding:10px;font-size:13px;margin:12px 0">Focus this week: <b>${s.weakest.name}</b> is at ${pct(s.weakest.ach)} — your lowest KPI.</p>` : ""}
  <table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#F5F6FF"><th style="text-align:left;padding:6px 8px">KPI</th><th style="text-align:right;padding:6px 8px">Achievement</th><th style="text-align:right;padding:6px 8px">Rank</th></tr>${kpiRows}</table>
  ${fd ? `<p style="font-size:13px;margin:12px 0 0">Field this week: ${fd.visits} market visits (${fd.valid} valid) · ${fd.disputesOpen} open disputes · ${fd.hygienePending} IMEIs pending action</p>` : ""}
  <p style="font-size:12px;color:#6B7090;margin-top:12px">Top states: ${r.pan.top.map((x) => "#" + x.rank + " " + x.state).join(" · ")}</p>
  <p style="text-align:center;margin:16px 0 4px"><a href="${link}" style="background:#4D5BF9;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700">Open the dashboard</a></p></div></div>`;
}

async function fieldStats(store, t) {
  const out = {}, since = t - 7 * 86400000;
  const ym = (x) => istNow(x).toISOString().slice(0, 7).replace("-", "");
  const months = [...new Set([ym(t), ym(since)])];
  for (const mo of months) for (const k of await store.list(`visit:${mo}:`)) { const v = await store.get(k); if (!v || v.in.t < since) continue; const s = out[v.state] = out[v.state] || { visits: 0, valid: 0, disputesOpen: 0, hygienePending: 0 }; s.visits++; if (v.valid) s.valid++; }
  for (const k of await store.list("disp:")) { const d = await store.get(k); if (d && !["Resolved", "Closed"].includes(d.status)) { const s = out[d.state] = out[d.state] || { visits: 0, valid: 0, disputesOpen: 0, hygienePending: 0 }; s.disputesOpen++; } }
  for (const k of await store.list("hygr:")) { const c = await store.get(k); if (!c) continue; const s = out[c.state] = out[c.state] || { visits: 0, valid: 0, disputesOpen: 0, hygienePending: 0 }; s.hygienePending += c.rows.filter((r) => r.status === "Pending").length; }
  return out;
}

// Generates and delivers one run. deps: { fetchImpl (to read the site), mailFetch, env, now }
export async function runAutoReport(store, env, { fetchImpl = fetch, mailFetch = fetch, now = () => Date.now(), by = "auto" } = {}) {
  const t = now();
  const r0 = await fetchImpl((env.SITE_URL || "") + "/index.html?v=" + t);
  if (!r0.ok) throw new Error("couldn't read the dashboard (" + r0.status + ")");
  const rep = buildReport(loadKE(await r0.text()), { field: await fieldStats(store, t) });
  const id = t.toString(36) + randomBytes(3).toString("hex");
  const run = Object.assign({ id, at: t, by }, rep);
  await store.set(`autorep:${id}`, run);
  // keep the last 60 runs
  const ks = (await store.list("autorep:")).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - 60))) await store.delete(k);
  const cfg = (await store.get("config:autorep")) || {};
  let emailed = 0, emailErr = "";
  const ec = await store.get("config:email");
  const mailEnv = { key: env.BREVO_API_KEY || (ec && ec.apiKey), from: env.OTP_FROM_EMAIL || (ec && ec.from), name: env.OTP_FROM_NAME || (ec && ec.name) || "vivo BI Dashboard" };
  if (cfg.email !== false && mailEnv.key && mailEnv.from) {
    const users = [];
    for (const k of await store.list("user:state:")) { const u = await store.get(k); if (u && !u.disabled && u.email && u.state && rep.states[u.state]) users.push(u); }
    for (const u of users.slice(0, 300)) {
      try {
        const rr = await mailFetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": mailEnv.key },
          body: JSON.stringify({ sender: { name: mailEnv.name, email: mailEnv.from }, to: [{ email: u.email, name: u.fullName }], subject: `${u.state}: rank #${rep.states[u.state].rank} — BI auto-report ${rep.period.label}`, htmlContent: emailHtml(rep, u.state, (env.SITE_URL || "") + "/") }) });
        if (rr.ok) emailed++; else emailErr = "Brevo " + rr.status;
      } catch (e) { emailErr = e.message; }
    }
  }
  run.emailed = emailed; run.emailErr = emailErr;
  await store.set(`autorep:${id}`, run);
  cfg.lastRunAt = t; cfg.lastRunId = id; cfg.lastEmailed = emailed; cfg.lastError = emailErr;
  await store.set("config:autorep", cfg);
  return run;
}

// Called hourly by the scheduler: is a run due now (IST)?
export function isDue(cfg, t) {
  if (!cfg || cfg.enabled === false) return false;
  const d = istNow(t), hour = Number(cfg.hour != null ? cfg.hour : 9);
  if (d.getUTCHours() !== hour) return false;
  if (cfg.freq === "weekly" && d.getUTCDay() !== Number(cfg.weekday != null ? cfg.weekday : 1)) return false;
  const last = cfg.lastRunAt ? istNow(cfg.lastRunAt).toISOString().slice(0, 13) : "";
  return last !== d.toISOString().slice(0, 13);
}

export async function autorepAction(b, ctx) {
  const { store, t, app, rec, key } = ctx;
  const isAdmin = app === "admin";
  const readK = `autorepread:${app}:${key}`;
  const latestIds = async (n) => (await store.list("autorep:")).sort().reverse().slice(0, n);
  const forMe = (run) => { if (isAdmin) return run; const mine = run.states[rec.state || ""]; return Object.assign({}, run, { states: mine ? { [rec.state]: mine } : {} }); };

  if (b.action === "autorep-config") {
    const cfg = Object.assign({ enabled: false, freq: "daily", weekday: 1, hour: 9, email: true }, (await store.get("config:autorep")) || {});
    if (b.set) {
      if (!isAdmin) return json(403, { ok: false, error: "Only admins." });
      const s = b.set;
      Object.assign(cfg, { enabled: s.enabled === true, freq: s.freq === "weekly" ? "weekly" : "daily", weekday: Math.max(0, Math.min(6, Number(s.weekday) || 0)), hour: Math.max(0, Math.min(23, Number(s.hour) || 0)), email: s.email !== false, updatedBy: rec.fullName, updatedAt: t });
      await store.set("config:autorep", cfg);
    }
    return json(200, { ok: true, config: cfg });
  }
  if (b.action === "autorep-run") {   // admin: generate now (in the background function)
    if (!isAdmin) return json(403, { ok: false, error: "Only admins." });
    const id = t.toString(36) + randomBytes(4).toString("hex");
    await store.set(`autojob:${id}`, { at: t, by: rec.fullName });
    try {
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 5000);
      try { await (ctx.jobFetch || fetch)((ctx.env.SITE_URL || "") + "/.netlify/functions/autorep-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: id }), signal: ac.signal }); }
      catch (e) { if (e.name !== "AbortError") throw e; } finally { clearTimeout(tm); }
    } catch (e) { await store.delete(`autojob:${id}`); return json(500, { ok: false, error: "Couldn't start: " + e.message }); }
    return json(200, { ok: true, started: true });
  }
  if (b.action === "autorep-list") {
    const runs = [];
    for (const k of await latestIds(Math.min(30, Number(b.limit) || 14))) { const r = await store.get(k); if (r) runs.push(forMe(r)); }
    const rd = (await store.get(readK)) || { at: 0 };
    if (b.markRead !== false) await store.set(readK, { at: t });
    return json(200, { ok: true, runs, lastRead: rd.at, myState: rec.state || "" });
  }
  if (b.action === "autorep-notify") {
    const ids = await latestIds(1); if (!ids.length) return json(200, { ok: true, fresh: 0 });
    const r = await store.get(ids[0]), rd = (await store.get(readK)) || { at: 0 };
    return json(200, { ok: true, fresh: r && r.at > rd.at && (isAdmin || r.states[rec.state || ""]) ? 1 : 0 });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

export async function runAutoJob(store, env, jobId, deps) {
  const k = `autojob:${String(jobId || "").replace(/[^a-z0-9]/gi, "")}`, j = await store.get(k);
  if (!j) return { ok: false };
  await store.delete(k);
  try { const r = await runAutoReport(store, env, Object.assign({ by: j.by }, deps)); return { ok: true, id: r.id }; }
  catch (e) { const cfg = (await store.get("config:autorep")) || {}; cfg.lastError = e.message; cfg.lastErrorAt = Date.now(); await store.set("config:autorep", cfg); return { ok: false, error: e.message }; }
}
