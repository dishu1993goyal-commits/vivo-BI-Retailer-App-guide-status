// IMEI unblock (finance rollback) — 5-step flow
//   1 · State raises IMEIs (one by one / Excel, any number of finance partners)                    → ho_review
//   2 · HO SPOC is told (portal badge + e-mail with a link to this tool)
//   3 · HO SPOC checks activation and marks each IMEI "unblocking required?" (screen or Excel)       → with_partner | not_required
//       → every partner gets ONE e-mail with only its own IMEIs (all states together) + a secure link (no portal login)
//   4 · Partner marks each IMEI Unblocked / Still blocked (screen or Excel)                          → unblocked | partner_failed
//       → HO SPOC gets an e-mail
//   5 · HO SPOC's final check (screen or Excel): "unblock on the vivo portal?"                        → vivo_queue | closed
//       → queued IMEIs go into an unblock run in the vivo portal's own Excel format; the run is uploaded to the
//         vivo portal (by the app's runner, or by HO with the ready file) and its success / failure is recorded
//                                                                                                    → vivo_unblocked | vivo_failed
//       → each partner gets the final status of its IMEIs (and the state user who raised them)
// Storage:
//   iubcfg          { partners:[{ id, name, emails, cc, token, active, tatHours }], hoEmails, hoCc, autoMail, mailState, vivoCols:[{ h, v }] }
//   iubb:<id>       batch (one partner, one state, one raise) { id, pid, partner, state, by, byKey, byEmail, at, reason, items:[…], mails:[…] }
//   iubopen:<imei>  { batch } — open request for this IMEI (stops duplicates)
//   iubrun:<id>     unblock run { id, at, by, items:[{ batch, imei }], round:[{ batch, imei }], status: queued|done, result, resAt, resBy, via, mailed }
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const IUB_STATUS = {
  ho_review: "With HO — check activation", not_required: "Unblocking not required (closed)", with_partner: "With partner",
  unblocked: "Partner: unblocked — HO final check", partner_failed: "Partner: still blocked — HO final check",
  vivo_queue: "Queued — unblock on vivo portal", vivo_unblocked: "Unblocked on vivo portal ✅", vivo_failed: "vivo portal unblock failed",
  closed: "Closed — no vivo unblock needed", withdrawn: "Withdrawn", ho_unblocked: "Unblocked by HO", ho_failed: "Failed (final)",
};
// what a partner may see (it never saw ho_review / not_required / withdrawn items)
const P_SEES = ["with_partner", "unblocked", "partner_failed", "vivo_queue", "vivo_unblocked", "vivo_failed", "closed", "ho_unblocked", "ho_failed"];
const FINAL = ["not_required", "vivo_unblocked", "closed", "withdrawn", "ho_unblocked", "ho_failed"];
const AT_FINAL = ["unblocked", "partner_failed", "vivo_failed"];   // waiting for HO's final check
const DEFAULT_PARTNERS = ["Bajaj Finserv", "Pine Labs", "HDB Financial Services", "TVS Credit", "Home Credit", "IDFC FIRST Bank", "Benow", "Innoviti", "Samsung Finance+ / DMI", "HDFC Bank (Consumer Durable)"];
export const VIVO_COL_SOURCES = { imei: "IMEI", model: "Model", partner: "Finance partner", state: "State", batch: "Request ID", remark: "HO remark", date: "Today's date", fixed: "Fixed text" };
export function imeiOk(s) { s = String(s || ""); if (!/^\d{15}$/.test(s)) return false; let sum = 0; for (let i = 0; i < 15; i++) { let d = +s[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; }
const emails = (v) => (Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map((e) => low(e)).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)).slice(0, 15);
const day = (t) => new Date(t + 19800000).toISOString().slice(0, 10);

async function cfgOf(store) {
  const c = (await store.get("iubcfg")) || { partners: DEFAULT_PARTNERS.map((n, i) => ({ id: "p" + (i + 1), name: n, emails: [], cc: [], token: randomBytes(16).toString("hex"), active: true, tatHours: 48 })), hoEmails: [], autoMail: true };
  c.hoCc = c.hoCc || []; if (c.mailState === undefined) c.mailState = true;
  if (!Array.isArray(c.vivoCols) || !c.vivoCols.length) c.vivoCols = [{ h: "IMEI", v: "imei" }];
  return c;
}
const linkOf = (env, p) => (env.SITE_URL || "") + "/imeiunblock.html?p=" + p.token;
const hoLink = (env, tab) => (env.SITE_URL || "") + "/imeiunblock.html#" + (tab || "verify");
async function mail(ctx, to, cc, subject, html, csv) {
  const { env, mailFetch } = ctx;
  if (!to.length) return { ok: false, error: "No e-mail set" };
  if (!env.BREVO_API_KEY || !env.OTP_FROM_EMAIL) return { ok: false, error: "E-mail isn't set up" };
  try {
    const body = { sender: { name: env.OTP_FROM_NAME || "vivo BI", email: env.OTP_FROM_EMAIL }, to: to.map((e) => ({ email: e })), subject, htmlContent: html };
    const ccs = (cc || []).filter((e) => !to.includes(e)); if (ccs.length) body.cc = ccs.map((e) => ({ email: e }));
    if (csv) body.attachment = [{ name: csv.name, content: Buffer.from("﻿" + csv.text, "utf8").toString("base64") }];
    const r = await (mailFetch || fetch)("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": env.BREVO_API_KEY }, body: JSON.stringify(body) });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({})); return { ok: false, error: "Brevo " + r.status + (j.message ? ": " + String(j.message).slice(0, 80) : "") };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 80) }; }
}
const shell = (title, inner) => `<div style="font-family:Segoe UI,Arial,sans-serif;background:#F3F4FA;padding:18px"><div style="max-width:680px;margin:auto;background:#fff;border-radius:14px;padding:20px;color:#1B1D2E"><div style="font-size:12px;color:#6B7090;font-weight:700;letter-spacing:.4px">VIVO INDIA · IMEI UNBLOCK</div><h2 style="margin:6px 0 12px;font-size:19px">${escH(title)}</h2>${inner}<p style="color:#8A8FA8;font-size:11.5px;margin:16px 0 0">Automatic e-mail from vivo BI. Please do not reply to this address; use the button to open the list.</p></div></div>`;
const table = (rows, cols) => `<table style="border-collapse:collapse;width:100%;font-size:12.5px;margin-top:8px"><tr>${cols.map((c) => `<th style="background:#EEF0FF;text-align:left;padding:6px;border:1px solid #E1E3EE">${escH(c[0])}</th>`).join("")}</tr>${rows.slice(0, 200).map((r) => `<tr>${cols.map((c) => `<td style="padding:6px;border:1px solid #E1E3EE">${escH(c[1](r))}</td>`).join("")}</tr>`).join("")}</table>${rows.length > 200 ? `<p style="font-size:12px">…and ${rows.length - 200} more — see the attachment / link.</p>` : ""}`;
const btn = (href, label) => `<p style="text-align:center;margin:16px 0"><a href="${href}" style="background:#4D5BF9;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">${escH(label)}</a></p>`;
const csvOf = (rows) => rows.map((r) => r.map((x) => /[",\n]/.test(String(x)) ? '"' + String(x).replace(/"/g, '""') + '"' : String(x == null ? "" : x)).join(",")).join("\r\n");
const logMail = (x, m, to, kind) => { x.mails = (x.mails || []).concat([{ at: Date.now(), to, kind, ok: m.ok, error: m.error || "" }]).slice(-40); };
const counts = (L, key) => L.reduce((o, x) => { const k = key(x); o[k] = (o[k] || 0) + 1; return o; }, {});

// ---- the e-mails of each step ----
async function mailHoNew(ctx, cfg, rows, state, by) {   // step 2
  const byP = counts(rows, (x) => x.partner);
  const html = shell(`${rows.length} IMEI${rows.length === 1 ? "" : "s"} to check — ${state}`, `<p style="margin:0">${escH(by)} (${escH(state)}) has raised IMEIs for finance rollback / unblocking: ${Object.keys(byP).map((k) => `<b>${escH(k)}</b> ${byP[k]}`).join(" · ")}.</p><p>Please check whether each IMEI is already activated and mark <b>Unblocking required: Yes / No</b> (on screen or by Excel). Every partner then gets its own IMEIs automatically.</p>${btn(hoLink(ctx.env, "verify"), "Open IMEI unblock — HO check")}${table(rows, [["Partner", (x) => x.partner], ["IMEI", (x) => x.imei], ["Model", (x) => x.model], ["Retailer", (x) => [x.rname, x.rid].filter(Boolean).join(" · ")], ["Customer / note", (x) => [x.customer, x.note].filter(Boolean).join(" · ")]])}`);
  const csv = { name: `IMEI_unblock_${state.replace(/\W+/g, "_")}_${day(Date.now())}.csv`, text: csvOf([["Request", "Partner", "IMEI", "Model", "Retailer ID", "Retailer", "Customer", "Note", "State", "Unblocking required (Yes/No)", "HO remark"]].concat(rows.map((x) => [x.batch, x.partner, x.imei, x.model, x.rid, x.rname, x.customer, x.note, state, "", ""]))) };
  return mail(ctx, cfg.hoEmails, cfg.hoCc, `IMEI unblock — ${rows.length} IMEIs from ${state} to check`, html, csv);
}
async function mailPartnerNew(ctx, p, rows) {   // after step 3 — one mail per partner, its IMEIs only
  const html = shell(`${rows.length} IMEI${rows.length === 1 ? "" : "s"} for rollback / unblocking`, `<p style="margin:0">Dear ${escH(p.name)} team,</p><p>vivo requests rollback / unblocking of the IMEIs below. Please try to unblock each one from your side and update the result — <b>Unblocked</b> or <b>Still blocked</b> (with a remark) — on the secure link, one by one or by uploading the attached sheet back.</p>${btn(linkOf(ctx.env, p), "Open the list & update status")}${table(rows, [["IMEI", (x) => x.imei], ["Model", (x) => x.model], ["State", (x) => x.state], ["Retailer", (x) => [x.rname, x.rid].filter(Boolean).join(" · ")], ["Customer / note", (x) => [x.customer, x.note].filter(Boolean).join(" · ")]])}<p style="font-size:12px;color:#6B7090">Target turnaround: ${p.tatHours || 48} hours. The link shows only ${escH(p.name)}'s IMEIs.</p>`);
  const csv = { name: `vivo_IMEI_unblock_${p.name.replace(/\W+/g, "_")}_${day(Date.now())}.csv`, text: csvOf([["Request", "IMEI", "Model", "State", "Retailer ID", "Retailer", "Customer", "Note", "Status (Unblocked / Still blocked)", "Remark"]].concat(rows.map((x) => [x.batch, x.imei, x.model, x.state, x.rid, x.rname, x.customer, x.note, "", ""]))) };
  return mail(ctx, p.emails, p.cc, `vivo IMEI unblock — ${rows.length} IMEIs for ${p.name}`, html, csv);
}
async function mailHoPartnerUpdate(ctx, cfg, p, rows) {   // after step 4
  const ok = rows.filter((x) => x.status === "unblocked").length, no = rows.length - ok;
  const html = shell(`${p.name} updated ${rows.length} IMEI${rows.length === 1 ? "" : "s"}`, `<p style="margin:0"><b>${ok}</b> unblocked · <b>${no}</b> still blocked. Please do the final check: mark which IMEIs need unblocking on the vivo portal.</p>${btn(hoLink(ctx.env, "final"), "Open IMEI unblock — final check")}${table(rows, [["IMEI", (x) => x.imei], ["Model", (x) => x.model], ["State", (x) => x.state], ["Partner result", (x) => (x.status === "unblocked" ? "Unblocked" : "Still blocked")], ["Partner remark", (x) => x.pRemark]])}`);
  return mail(ctx, cfg.hoEmails, cfg.hoCc, `IMEI unblock — ${p.name} updated ${rows.length} IMEIs`, html);
}
const finalWord = (s) => ({ vivo_unblocked: "Unblocked on vivo portal", vivo_failed: "vivo portal unblock failed — try again", vivo_queue: "Unblocking on vivo portal", closed: "Closed — no vivo unblock needed", not_required: "Unblocking not required" }[s] || IUB_STATUS[s] || s);
async function mailPartnerFinal(ctx, cfg, p, rows) {   // after step 5
  const bad = rows.filter((x) => x.status === "vivo_failed").length;
  const html = shell(`Final status of ${rows.length} IMEI${rows.length === 1 ? "" : "s"}`, `<p style="margin:0">Dear ${escH(p.name)} team, vivo HO has completed the final check of these IMEIs.${bad ? ` <b>${bad}</b> could not be unblocked on the vivo portal — please inform / escalate to your ground team to try again.` : ""}</p>${btn(linkOf(ctx.env, p), "Open your list")}${table(rows, [["IMEI", (x) => x.imei], ["Model", (x) => x.model], ["State", (x) => x.state], ["Your update", (x) => (x.pAt ? (x.pRes === "unblocked" ? "Unblocked" : "Still blocked") : "")], ["Final status", (x) => finalWord(x.status)], ["vivo remark", (x) => x.fRemark || x.uRemark || ""]])}`);
  return mail(ctx, p.emails, p.cc.concat(cfg.hoEmails), `vivo IMEI unblock — final status, ${rows.length} IMEIs (${p.name})`, html, { name: `vivo_IMEI_final_${p.name.replace(/\W+/g, "_")}_${day(Date.now())}.csv`, text: csvOf([["IMEI", "Model", "State", "Your update", "Final status", "vivo remark"]].concat(rows.map((x) => [x.imei, x.model, x.state, x.pAt ? (x.pRes === "unblocked" ? "Unblocked" : "Still blocked") : "", finalWord(x.status), x.fRemark || x.uRemark || ""]))) });
}
async function mailState(ctx, to, rows, title) {
  return mail(ctx, [to], [], `IMEI unblock — ${title}`, shell(title, `${table(rows, [["IMEI", (x) => x.imei], ["Partner", (x) => x.partner], ["Status", (x) => finalWord(x.status)], ["Remark", (x) => x.fRemark || x.uRemark || x.vRemark || x.pRemark || ""]])}${btn(hoLink(ctx.env, "list"), "Open IMEI unblock")}`));
}

// ---------- partner side: secure link, no login, only its own IMEIs ----------
export async function iubPublic(b, ctx) {
  const { store, t, pool } = ctx, tok = str(b.p, 40).replace(/[^a-f0-9]/g, ""), cfg = await cfgOf(store), p = tok ? cfg.partners.find((x) => x.token === tok) : null;
  if (!p || p.active === false) return json(404, { ok: false, error: "This link isn't valid any more. Please ask your vivo contact for the latest link." });
  const mine = (await pool(await store.list("iubb:"), 30, (k) => store.get(k))).filter((x) => x && x.pid === p.id);
  const canEdit = (it) => it.status === "with_partner" || it.status === "unblocked" || it.status === "partner_failed";
  if (b.action === "iub-p-list") {
    const since = t - 45 * 864e5, rows = [];
    mine.forEach((x) => x.items.forEach((it) => { if (!P_SEES.includes(it.status)) return; if (it.status === "with_partner" || (it.uAt || it.fAt || it.pAt || it.sAt || x.at) > since) rows.push({ batch: x.id, imei: it.imei, model: it.model, rid: it.rid, rname: it.rname, customer: it.customer, note: it.note, state: x.state, reason: x.reason, at: it.sAt || x.at, status: it.status, edit: canEdit(it), pRemark: it.pRemark || "", pAt: it.pAt || 0, fRemark: FINAL.includes(it.status) || it.status === "vivo_failed" ? it.fRemark || it.uRemark || "" : "", fAt: it.uAt || it.fAt || 0 }); }));
    const statuses = {}; P_SEES.forEach((k) => { statuses[k] = k === "unblocked" ? "You: unblocked — with vivo" : k === "partner_failed" ? "You: still blocked — with vivo" : finalWord(k); });
    return json(200, { ok: true, partner: p.name, tatHours: p.tatHours || 48, now: t, statuses, rows: rows.sort((a, c) => (a.status === "with_partner" ? 0 : 1) - (c.status === "with_partner" ? 0 : 1) || a.at - c.at) });
  }
  if (b.action === "iub-p-update") {
    const ups = (Array.isArray(b.updates) ? b.updates : []).slice(0, 5000), who = str(b.name, 60) || p.name, touched = new Map(), done = [];
    for (const u of ups) {
      const im = str(u.imei, 15), x = mine.find((y) => y.id === str(u.batch, 30)) || mine.find((y) => y.items.some((it) => it.imei === im && canEdit(it)));
      if (!x) continue; const it = x.items.find((y) => y.imei === im); if (!it || !canEdit(it)) continue;
      const st = u.status === "unblocked" ? "unblocked" : u.status === "partner_failed" ? "partner_failed" : ""; if (!st) continue;
      it.status = st; it.pRes = st; it.pAt = t; it.pBy = who; it.pRemark = str(u.remark, 300); touched.set(x.id, x); done.push(Object.assign({ state: x.state, batch: x.id }, it));
    }
    for (const x of touched.values()) await store.set(`iubb:${x.id}`, x);
    let m = null;
    if (done.length && cfg.autoMail !== false) {
      m = await mailHoPartnerUpdate(ctx, cfg, p, done);
      for (const x of touched.values()) { logMail(x, m, cfg.hoEmails.join(", "), "partner-update→HO"); await store.set(`iubb:${x.id}`, x); }
    }
    return json(200, { ok: true, updated: done.length, mailed: !!(m && m.ok) });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// ---------- staff (state users + HO) ----------
export async function iubAction(b, ctx) {
  const { store, t, app, rec, pool, env = {} } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "", myState = isHO ? "" : str(rec.state, 40);
  const seeState = (s) => isHO || low(s) === low(myState);
  const cfg = await cfgOf(store), pOf = (id) => cfg.partners.find((p) => p.id === id);
  const allB = async () => (await pool(await store.list("iubb:"), 30, (k) => store.get(k))).filter((x) => x && seeState(x.state));
  const saveCfg = async () => { await store.set("iubcfg", cfg); };
  const hoOnly = () => json(403, { ok: false, error: "Only the vivo HO SPOC can do this." });
  const auto = cfg.autoMail !== false;

  if (b.action === "iub-notify") {
    if (!isHO) return json(200, { ok: true, n: 0 });
    let n = 0; (await allB()).forEach((x) => x.items.forEach((it) => { if (it.status === "ho_review" || AT_FINAL.includes(it.status) || it.status === "vivo_queue") n++; }));
    return json(200, { ok: true, n });
  }
  if (b.action === "iub-me") return json(200, { ok: true, isHO, state: myState, statuses: IUB_STATUS, hoSet: !!cfg.hoEmails.length, partners: cfg.partners.filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name, hasEmail: !!p.emails.length, tatHours: p.tatHours || 48 })), vivoCols: cfg.vivoCols });
  if (b.action === "iub-cfg") {
    if (!isHO) return json(403, { ok: false, error: "Only HO admins manage the e-mail set-up." });
    if (b.save) {
      const c = b.cfg || {}, old = new Map(cfg.partners.map((p) => [p.id, p]));
      cfg.partners = (Array.isArray(c.partners) ? c.partners : []).slice(0, 40).map((p, i) => { const o = old.get(p.id) || {}; return { id: o.id || "p" + nid(t + i), name: str(p.name, 60), emails: emails(p.emails), cc: emails(p.cc), token: o.token || randomBytes(16).toString("hex"), active: p.active !== false, tatHours: Math.max(1, Math.min(720, Number(p.tatHours) || 48)) }; }).filter((p) => p.name);
      cfg.hoEmails = emails(c.hoEmails); cfg.hoCc = emails(c.hoCc); cfg.autoMail = c.autoMail !== false; cfg.mailState = c.mailState !== false;
      const vc = (Array.isArray(c.vivoCols) ? c.vivoCols : []).slice(0, 20).map((x) => ({ h: str(x.h, 60), v: VIVO_COL_SOURCES[x.v] ? x.v : "fixed", f: str(x.f, 80) })).filter((x) => x.h);
      if (vc.some((x) => x.v === "imei")) cfg.vivoCols = vc;
      await saveCfg();
    }
    return json(200, { ok: true, sources: VIVO_COL_SOURCES, cfg: Object.assign({}, cfg, { partners: cfg.partners.map((p) => Object.assign({}, p, { link: linkOf(env, p) })) }) });
  }
  if (b.action === "iub-token") {
    if (!isHO) return hoOnly();
    const p = pOf(str(b.pid, 30)); if (!p) return json(404, { ok: false, error: "Partner not found." });
    p.token = randomBytes(16).toString("hex"); await saveCfg(); return json(200, { ok: true, link: linkOf(env, p) });
  }
  if (b.action === "iub-lookup") {   // fill model / retailer / financier from the Retailer portal's IMEI upload
    const L = (Array.isArray(b.imeis) ? b.imeis : []).slice(0, 3000).map((x) => str(x, 15)), out = {};
    await pool(L, 20, async (i) => { const w = await store.get(`rtimei:${i}`); if (!w) return; const il = (await store.get(`rtil:${w.rid}`)) || { items: [] }, x = il.items.find((y) => y.i === i), m = (await store.get(`rtl:${w.rid}`)) || {}; if (x) out[i] = { model: x.m, rid: w.rid, rname: m.name || "", financier: x.fp || "", financed: !!x.fin, state: m.state || "" }; });
    const open = {}; await pool(L, 20, async (i) => { const o = await store.get(`iubopen:${i}`); if (o) open[i] = o.batch; });
    return json(200, { ok: true, found: out, open });
  }

  // ---- step 1: raise (items can belong to several partners) → HO check ----
  if (b.action === "iub-raise") {
    const state = isHO ? str(b.state, 40) : myState; if (!state) return json(400, { ok: false, error: "Choose the state." });
    const seen = new Set(), groups = new Map(), skipped = [];
    for (const x of (Array.isArray(b.items) ? b.items : []).slice(0, 3000)) {
      const imei = String(x.imei || "").replace(/\D/g, ""), p = pOf(str(x.pid || b.pid, 30));
      if (!imeiOk(imei)) { skipped.push({ imei, why: "not a valid IMEI" }); continue; }
      if (!p || p.active === false) { skipped.push({ imei, why: "no finance partner" }); continue; }
      if (seen.has(imei)) continue; seen.add(imei);
      const o = await store.get(`iubopen:${imei}`); if (o) { skipped.push({ imei, why: "already open in request " + o.batch }); continue; }
      if (!groups.has(p.id)) groups.set(p.id, []);
      groups.get(p.id).push({ imei, model: str(x.model, 50), rid: str(x.rid, 40).toUpperCase(), rname: str(x.rname, 80), customer: str(x.customer, 80), note: str(x.note, 200), status: "ho_review" });
    }
    if (!groups.size) return json(400, { ok: false, error: "No new valid IMEIs to send.", skipped });
    const batches = [], rows = [];
    let k = 0;
    for (const [pid, items] of groups) {
      const p = pOf(pid), x = { id: "IUB" + nid(t + k++).toUpperCase().slice(-7), pid, partner: p.name, state, by, byKey: app + ":" + rec.username, byEmail: low(rec.email), at: t, reason: str(b.reason, 200), items, mails: [] };
      for (const it of items) { await store.set(`iubopen:${it.imei}`, { batch: x.id }); rows.push(Object.assign({ batch: x.id, partner: p.name }, it)); }
      batches.push(x);
    }
    let m = { ok: false, error: "Auto e-mail is off" };
    if (auto) m = cfg.hoEmails.length ? await mailHoNew(ctx, cfg, rows, state, by) : { ok: false, error: "No HO SPOC e-mail set (Settings)" };
    for (const x of batches) { logMail(x, m, cfg.hoEmails.join(", "), "raised→HO"); await store.set(`iubb:${x.id}`, x); }
    return json(200, { ok: true, batches: batches.map((x) => ({ id: x.id, partner: x.partner, n: x.items.length })), count: rows.length, skipped, mail: m });
  }

  // ---- step 3: HO check — unblocking required? → partners e-mailed (one mail each, its own IMEIs) ----
  if (b.action === "iub-ho-verify") {
    if (!isHO) return hoOnly();
    const ups = (Array.isArray(b.updates) ? b.updates : []).slice(0, 5000), touched = new Map(), toP = new Map(), closed = [];
    for (const u of ups) {
      const x = touched.get(str(u.batch, 30)) || await store.get(`iubb:${str(u.batch, 30)}`); if (!x) continue;
      const it = x.items.find((y) => y.imei === str(u.imei, 15)); if (!it || it.status !== "ho_review") continue;
      const req = u.req === true || u.req === "yes"; if (u.req !== true && u.req !== false && u.req !== "yes" && u.req !== "no") continue;
      it.vAt = t; it.vBy = by; it.vRemark = str(u.remark, 300);
      if (req) { it.status = "with_partner"; it.sAt = t; if (!toP.has(x.pid)) toP.set(x.pid, []); toP.get(x.pid).push(Object.assign({ batch: x.id, state: x.state }, it)); }
      else { it.status = "not_required"; await store.delete(`iubopen:${it.imei}`); closed.push({ x, it }); }
      touched.set(x.id, x);
    }
    const mails = [];
    if (auto) for (const [pid, rows] of toP) {
      const p = pOf(pid); if (!p) continue; const m = await mailPartnerNew(ctx, p, rows); mails.push({ partner: p.name, n: rows.length, ok: m.ok, error: m.error || "" });
      for (const r of rows) { const x = touched.get(r.batch); if (x && !x.mails.some((q) => q.at === t && q.kind === "HO→partner")) logMail(x, m, p.emails.join(", "), "HO→partner"); }
    }
    if (auto && cfg.mailState !== false) {   // tell the state user which IMEIs were closed as "not required"
      const byU = new Map(); closed.forEach(({ x, it }) => { if (!x.byEmail) return; if (!byU.has(x.byEmail)) byU.set(x.byEmail, []); byU.get(x.byEmail).push(Object.assign({ partner: x.partner }, it)); });
      for (const [to, rows] of byU) await mailState(ctx, to, rows, `${rows.length} IMEI${rows.length === 1 ? "" : "s"} — unblocking not required`);
    }
    for (const x of touched.values()) await store.set(`iubb:${x.id}`, x);
    return json(200, { ok: true, toPartners: [...toP.values()].reduce((a, r) => a + r.length, 0), notRequired: closed.length, mails });
  }

  // ---- step 5: HO final check — unblock on the vivo portal? → unblock run (vivo Excel format) ----
  if (b.action === "iub-ho-final") {
    if (!isHO) return hoOnly();
    const ups = (Array.isArray(b.updates) ? b.updates : []).slice(0, 5000), touched = new Map(), queue = [], round = [];
    for (const u of ups) {
      const x = touched.get(str(u.batch, 30)) || await store.get(`iubb:${str(u.batch, 30)}`); if (!x) continue;
      const it = x.items.find((y) => y.imei === str(u.imei, 15)); if (!it || !AT_FINAL.includes(it.status)) continue;
      if (u.req !== true && u.req !== false && u.req !== "yes" && u.req !== "no") continue;
      const req = u.req === true || u.req === "yes";
      it.fAt = t; it.fBy = by; it.fRemark = str(u.remark, 300);
      if (req) { it.status = "vivo_queue"; queue.push({ batch: x.id, imei: it.imei }); }
      else { it.status = "closed"; await store.delete(`iubopen:${it.imei}`); }
      round.push({ batch: x.id, imei: it.imei }); touched.set(x.id, x);
    }
    if (!round.length) return json(400, { ok: false, error: "Nothing to update — choose Yes or No for IMEIs waiting for the final check." });
    const run = { id: "RUN" + nid(t).toUpperCase().slice(-6), at: t, by, items: queue, round, status: queue.length ? "queued" : "done", result: queue.length ? "" : "none", mailed: false };
    for (const it of touched.values()) for (const z of it.items) if (z.status === "vivo_queue" && queue.some((q) => q.batch === it.id && q.imei === z.imei)) z.run = run.id;
    for (const x of touched.values()) await store.set(`iubb:${x.id}`, x);
    await store.set(`iubrun:${run.id}`, run);
    let mailed = null; if (!queue.length) mailed = await roundMails(run);
    return json(200, { ok: true, run: { id: run.id, queued: queue.length, closed: round.length - queue.length }, mailed });
  }
  // send each partner the final status of its IMEIs in this round (+ the state users)
  async function roundMails(run) {
    if (run.mailed || !auto) return { sent: 0 };
    const byB = new Map(); for (const r of run.round) { if (!byB.has(r.batch)) byB.set(r.batch, await store.get(`iubb:${r.batch}`)); }
    const toP = new Map(), toU = new Map();
    for (const r of run.round) { const x = byB.get(r.batch); if (!x) continue; const it = x.items.find((y) => y.imei === r.imei); if (!it) continue; const row = Object.assign({ state: x.state, partner: x.partner }, it);
      if (!toP.has(x.pid)) toP.set(x.pid, []); toP.get(x.pid).push(row);
      if (x.byEmail && cfg.mailState !== false) { if (!toU.has(x.byEmail)) toU.set(x.byEmail, []); toU.get(x.byEmail).push(row); } }
    let sent = 0; const res = [];
    for (const [pid, rows] of toP) { const p = pOf(pid); if (!p) continue; const m = await mailPartnerFinal(ctx, cfg, p, rows); res.push({ partner: p.name, n: rows.length, ok: m.ok, error: m.error || "" }); if (m.ok) sent++;
      for (const x of byB.values()) if (x && x.pid === pid) logMail(x, m, p.emails.join(", "), "final→partner"); }
    for (const [to, rows] of toU) await mailState(ctx, to, rows, `final status of ${rows.length} IMEI${rows.length === 1 ? "" : "s"}`);
    for (const x of byB.values()) if (x) await store.set(`iubb:${x.id}`, x);
    run.mailed = t; await store.set(`iubrun:${run.id}`, run);
    return { sent, partners: res };
  }
  if (b.action === "iub-runs") {
    if (!isHO) return hoOnly();
    const L = (await pool(await store.list("iubrun:"), 30, (k) => store.get(k))).filter(Boolean).sort((a, c) => c.at - a.at).slice(0, 60);
    return json(200, { ok: true, runs: L.map((r) => ({ id: r.id, at: r.at, by: r.by, n: r.items.length, round: r.round.length, status: r.status, result: r.result, resAt: r.resAt, resBy: r.resBy, via: r.via, mailed: r.mailed, failed: r.failed || 0 })), vivoCols: cfg.vivoCols });
  }
  if (b.action === "iub-run-file") {   // the rows for the vivo portal's unblock Excel, in the configured column format
    if (!isHO) return hoOnly();
    const run = await store.get(`iubrun:${str(b.id, 20)}`); if (!run) return json(404, { ok: false, error: "Run not found." });
    const rows = [], bm = new Map();
    for (const r of run.items) { if (!bm.has(r.batch)) bm.set(r.batch, await store.get(`iubb:${r.batch}`)); const x = bm.get(r.batch); const it = x && x.items.find((y) => y.imei === r.imei); if (!it || it.status !== "vivo_queue" || it.run !== run.id) continue;
      rows.push(cfg.vivoCols.map((c) => ({ imei: it.imei, model: it.model, partner: x.partner, state: x.state, batch: x.id, remark: it.fRemark || "", date: day(t), fixed: c.f || "" })[c.v] || "")); }
    return json(200, { ok: true, headers: cfg.vivoCols.map((c) => c.h), rows, run: { id: run.id, status: run.status } });
  }
  // the result of uploading a run to the vivo portal: success → unblocked; failure → failed; or a list of the IMEIs that failed
  if (b.action === "iub-run-result") {
    if (!isHO) return hoOnly();
    const run = await store.get(`iubrun:${str(b.id, 20)}`); if (!run) return json(404, { ok: false, error: "Run not found." });
    const failSet = new Set((Array.isArray(b.failed) ? b.failed : []).map((i) => String(i).replace(/\D/g, "")).filter(Boolean)), allFail = b.result === "failure";
    if (b.result !== "success" && b.result !== "failure" && b.result !== "partial") return json(400, { ok: false, error: "Say whether the vivo portal showed success or failure." });
    const bm = new Map(); let ok = 0, bad = 0;
    for (const r of run.items) { if (!bm.has(r.batch)) bm.set(r.batch, await store.get(`iubb:${r.batch}`)); const x = bm.get(r.batch); const it = x && x.items.find((y) => y.imei === r.imei); if (!it || it.status !== "vivo_queue") continue;
      const fail = allFail || failSet.has(it.imei); it.status = fail ? "vivo_failed" : "vivo_unblocked"; it.uAt = t; it.uBy = by + (b.via === "app" ? " (app)" : ""); it.uRemark = str(b.remark, 300) || (fail ? "vivo portal showed failure" : "");
      if (!fail) await store.delete(`iubopen:${it.imei}`); if (fail) bad++; else ok++; }
    for (const x of bm.values()) if (x) await store.set(`iubb:${x.id}`, x);
    run.status = "done"; run.result = bad && ok ? "partial" : bad ? "failure" : "success"; run.failed = bad; run.resAt = t; run.resBy = by; run.via = b.via === "app" ? "app" : "manual";
    await store.set(`iubrun:${run.id}`, run);
    const mailed = await roundMails(run);
    return json(200, { ok: true, unblocked: ok, failed: bad, mailed });
  }
  if (b.action === "iub-run-mail") {   // send the final mails now without waiting for the run
    if (!isHO) return hoOnly();
    const run = await store.get(`iubrun:${str(b.id, 20)}`); if (!run) return json(404, { ok: false, error: "Run not found." });
    run.mailed = false; return json(200, Object.assign({ ok: true }, await roundMails(run)));
  }

  if (b.action === "iub-list") {
    const L = await allB(), q = low(b.q), rows = [], stage = b.stage || "";
    const inStage = (s) => !stage || (stage === "verify" ? s === "ho_review" : stage === "partner" ? s === "with_partner" : stage === "final" ? AT_FINAL.includes(s) : stage === "queue" ? s === "vivo_queue" : stage === "closed" ? FINAL.includes(s) : stage === "open" ? !FINAL.includes(s) : s === stage);
    L.forEach((x) => x.items.forEach((it) => { if (!inStage(it.status)) return; if (b.pid && x.pid !== b.pid) return; if (b.state && low(x.state) !== low(b.state)) return; if (q && !(it.imei + " " + it.model + " " + it.rname + " " + it.rid + " " + x.id + " " + x.partner).toLowerCase().includes(q)) return; rows.push(Object.assign({ batch: x.id, partner: x.partner, pid: x.pid, state: x.state, by: x.by, at: x.at, reason: x.reason }, it)); }));
    const S = { total: 0, by: {}, partners: {}, states: {} };
    L.forEach((x) => x.items.forEach((it) => {
      S.total++; S.by[it.status] = (S.by[it.status] || 0) + 1;
      const P = S.partners[x.partner] || (S.partners[x.partner] = { partner: x.partner, pid: x.pid, total: 0, pending: 0, overdue: 0, ok: 0, failed: 0, vivoOk: 0, vivoFail: 0, tatSum: 0, tatN: 0 });
      const tat = (pOf(x.pid) || {}).tatHours || 48; P.total++;
      if (it.status === "with_partner") { P.pending++; if (t - (it.sAt || x.at) > tat * 36e5) P.overdue++; }
      if (it.pRes === "unblocked") P.ok++; if (it.pRes === "partner_failed") P.failed++; if (it.status === "vivo_unblocked") P.vivoOk++; if (it.status === "vivo_failed") P.vivoFail++;
      if (it.pAt && it.sAt) { P.tatSum += (it.pAt - it.sAt) / 36e5; P.tatN++; }
      const Z = S.states[x.state] || (S.states[x.state] = { state: x.state, total: 0, open: 0, done: 0 }); Z.total++; if (FINAL.includes(it.status)) Z.done++; else Z.open++;
    }));
    const partners = Object.values(S.partners).map((P) => Object.assign(P, { avgTat: P.tatN ? Math.round(P.tatSum / P.tatN * 10) / 10 : null, okRate: P.ok + P.failed ? Math.round(P.ok / (P.ok + P.failed) * 100) : null }));
    return json(200, { ok: true, rows: rows.sort((a, c) => c.at - a.at).slice(0, 5000), count: rows.length, stats: { total: S.total, by: S.by, partners, states: Object.values(S.states) }, statuses: IUB_STATUS, now: t, states: [...new Set(L.map((x) => x.state))].sort() });
  }
  if (b.action === "iub-batch") {
    const x = await store.get(`iubb:${str(b.id, 30)}`); if (!x || !seeState(x.state)) return json(404, { ok: false, error: "Not found." });
    return json(200, { ok: true, batch: x, link: isHO && pOf(x.pid) ? linkOf(env, pOf(x.pid)) : "" });
  }
  if (b.action === "iub-remind") {   // e-mail a partner all its pending IMEIs again
    if (!isHO) return hoOnly();
    const p = pOf(str(b.pid, 30)); if (!p) return json(404, { ok: false, error: "Partner not found." });
    const items = []; (await allB()).filter((x) => x.pid === p.id).forEach((x) => x.items.forEach((it) => { if (it.status === "with_partner") items.push(Object.assign({ batch: x.id, state: x.state }, it)); }));
    if (!items.length) return json(400, { ok: false, error: "Nothing pending with " + p.name + "." });
    const r = await mailPartnerNew(ctx, p, items); return json(200, { ok: r.ok, error: r.error, count: items.length });
  }
  if (b.action === "iub-cancel") {   // withdraw IMEIs not yet unblocked (raised by mistake)
    const x = await store.get(`iubb:${str(b.id, 30)}`); if (!x || !seeState(x.state)) return json(404, { ok: false, error: "Not found." });
    if (!isHO && x.byKey !== app + ":" + rec.username) return json(403, { ok: false, error: "Only the person who raised it or HO can withdraw." });
    const im = new Set((b.imeis || []).map((i) => str(i, 15))); let n = 0;
    for (const it of x.items) if ((it.status === "ho_review" || it.status === "with_partner") && (!im.size || im.has(it.imei))) { it.status = "withdrawn"; it.fAt = t; it.fBy = by; it.fRemark = "Withdrawn by vivo"; n++; await store.delete(`iubopen:${it.imei}`); }
    await store.set(`iubb:${x.id}`, x); return json(200, { ok: true, withdrawn: n });
  }
  if (b.action === "iub-ai") {
    const L = await allB(), P = {};
    L.forEach((x) => x.items.forEach((it) => { const z = P[x.partner] || (P[x.partner] = { partner: x.partner, total: 0, hoCheck: 0, withPartner: 0, unblockedByPartner: 0, stillBlocked: 0, vivoQueue: 0, vivoUnblocked: 0, vivoFailed: 0, closed: 0, hoursWaiting: [] }); z.total++;
      if (it.status === "ho_review") z.hoCheck++; if (it.status === "with_partner") { z.withPartner++; z.hoursWaiting.push(Math.round((t - (it.sAt || x.at)) / 36e5)); } if (it.pRes === "unblocked") z.unblockedByPartner++; if (it.pRes === "partner_failed") z.stillBlocked++; if (it.status === "vivo_queue") z.vivoQueue++; if (it.status === "vivo_unblocked") z.vivoUnblocked++; if (it.status === "vivo_failed") z.vivoFailed++; if (it.status === "closed" || it.status === "not_required") z.closed++; }));
    const data = Object.values(P).map((z) => Object.assign(z, { hoursWaiting: z.hoursWaiting.sort((a, c) => c - a).slice(0, 10) }));
    const reasons = {}; L.forEach((x) => x.items.forEach((it) => { if (it.pRemark && it.pRes === "partner_failed") reasons[it.pRemark.toLowerCase()] = (reasons[it.pRemark.toLowerCase()] || 0) + 1; }));
    const r = await ctx.askAI(env, "Summarise this IMEI unblock (finance rollback) status for vivo " + (isHO ? "HO" : myState) + ": where IMEIs are stuck (HO check, partner, final check, vivo portal), which partners are slow or failing, common failure reasons, and 4 concrete next actions.", "DATA: " + JSON.stringify({ partners: data, failureReasons: reasons }).slice(0, 9000), [], ctx.aiFetch, { system: "You are a vivo India operations analyst. Use only DATA. Plain text, • bullets, under 12 lines, specific numbers.", label: "IUB" });
    return json(200, r.ok ? { ok: true, answer: r.text } : { ok: false, error: r.error });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
