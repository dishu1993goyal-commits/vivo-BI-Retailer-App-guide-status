// IMEI unblock (finance rollback): state teams raise partner-wise IMEI rollback requests; each affordability partner
// (Bajaj Finserv, Pine Labs, …) gets an automatic e-mail with the list and a secure web link (no portal login — only
// their own IMEIs) where they mark each IMEI Unblocked / Not unblocked. Their update lands on this server, so the
// portal shows it at once. Unsuccessful cases go to vivo HO, who retries from their side and sets the final status;
// the partner SPOC and the state user get a final e-mail.
// Storage:
//   iubcfg          { partners:[{ id, name, emails:[], cc:[], token, active, tatHours }], hoEmails:[], autoMail }
//   iubb:<id>       batch { id, pid, partner, state, by, byKey, byEmail, at, reason, items:[{ imei, model, rid, rname, customer, note, status, pAt, pBy, pRemark, hAt, hBy, hRemark }], mails:[{ at, to, kind, ok, error }] }
//   iubopen:<imei>  { batch }   — open (not final) request for this IMEI, to stop duplicates
// Item status: with_partner → unblocked ✅ | partner_failed → (HO) ho_unblocked ✅ | ho_failed ❌
import { randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const low = (x) => String(x || "").trim().toLowerCase();
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const IUB_STATUS = { with_partner: "With partner", unblocked: "Unblocked by partner", partner_failed: "Not unblocked — with HO", ho_unblocked: "Unblocked by HO", ho_failed: "Failed (final)" };
const FINAL = ["unblocked", "ho_unblocked", "ho_failed"];
const DEFAULT_PARTNERS = ["Bajaj Finserv", "Pine Labs", "HDB Financial Services", "TVS Credit", "Home Credit", "IDFC FIRST Bank", "Benow", "Innoviti", "Samsung Finance+ / DMI", "HDFC Bank (Consumer Durable)"];
export function imeiOk(s) { s = String(s || ""); if (!/^\d{15}$/.test(s)) return false; let sum = 0; for (let i = 0; i < 15; i++) { let d = +s[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; }
const emails = (v) => (Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map((e) => low(e)).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)).slice(0, 10);

async function cfgOf(store) {
  const c = (await store.get("iubcfg")) || null;
  if (c) return c;
  return { partners: DEFAULT_PARTNERS.map((n, i) => ({ id: "p" + (i + 1), name: n, emails: [], cc: [], token: randomBytes(16).toString("hex"), active: true, tatHours: 48 })), hoEmails: [], autoMail: true };
}
const linkOf = (env, p) => (env.SITE_URL || "") + "/imeiunblock.html?p=" + p.token;
async function mail(ctx, to, cc, subject, html, csv) {
  const { env, mailFetch } = ctx;
  if (!to.length) return { ok: false, error: "No e-mail set for this partner" };
  if (!env.BREVO_API_KEY || !env.OTP_FROM_EMAIL) return { ok: false, error: "E-mail isn't set up" };
  try {
    const body = { sender: { name: env.OTP_FROM_NAME || "vivo BI", email: env.OTP_FROM_EMAIL }, to: to.map((e) => ({ email: e })), subject, htmlContent: html };
    if (cc && cc.length) body.cc = cc.map((e) => ({ email: e }));
    if (csv) body.attachment = [{ name: csv.name, content: Buffer.from("﻿" + csv.text, "utf8").toString("base64") }];
    const r = await (mailFetch || fetch)("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "api-key": env.BREVO_API_KEY }, body: JSON.stringify(body) });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({})); return { ok: false, error: "Brevo " + r.status + (j.message ? ": " + String(j.message).slice(0, 80) : "") };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 80) }; }
}
const shell = (title, inner) => `<div style="font-family:Segoe UI,Arial,sans-serif;background:#F3F4FA;padding:18px"><div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:20px;color:#1B1D2E"><div style="font-size:12px;color:#6B7090;font-weight:700;letter-spacing:.4px">VIVO INDIA · IMEI UNBLOCK</div><h2 style="margin:6px 0 12px;font-size:19px">${escH(title)}</h2>${inner}<p style="color:#8A8FA8;font-size:11.5px;margin:16px 0 0">Automatic e-mail from vivo BI. Please do not reply to this address; use the link to update the status.</p></div></div>`;
const table = (rows, cols) => `<table style="border-collapse:collapse;width:100%;font-size:12.5px;margin-top:8px"><tr>${cols.map((c) => `<th style="background:#EEF0FF;text-align:left;padding:6px;border:1px solid #E1E3EE">${escH(c[0])}</th>`).join("")}</tr>${rows.slice(0, 200).map((r) => `<tr>${cols.map((c) => `<td style="padding:6px;border:1px solid #E1E3EE">${escH(c[1](r))}</td>`).join("")}</tr>`).join("")}</table>${rows.length > 200 ? `<p style="font-size:12px">…and ${rows.length - 200} more (see the attachment / link).</p>` : ""}`;
const btn = (href, label) => `<p style="text-align:center;margin:16px 0"><a href="${href}" style="background:#4D5BF9;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">${escH(label)}</a></p>`;
const csvOf = (rows) => rows.map((r) => r.map((x) => /[",\n]/.test(String(x)) ? '"' + String(x).replace(/"/g, '""') + '"' : String(x == null ? "" : x)).join(",")).join("\r\n");

async function mailPartnerNew(ctx, p, batch) {
  const items = batch.items.filter((x) => x.status === "with_partner");
  const html = shell(`${items.length} IMEI${items.length === 1 ? "" : "s"} for rollback / unblocking`, `<p style="margin:0">Dear ${escH(p.name)} team,</p><p>vivo ${escH(batch.state)} has requested rollback / unblocking of the IMEIs below${batch.reason ? " — reason: <b>" + escH(batch.reason) + "</b>" : ""}. Please initiate the rollback and update the result for each IMEI on the secure link (Unblocked / Not unblocked, with a remark).</p>${btn(linkOf(ctx.env, p), "Open the list & update status")}${table(items, [["IMEI", (x) => x.imei], ["Model", (x) => x.model], ["Retailer", (x) => [x.rname, x.rid].filter(Boolean).join(" · ")], ["Customer / note", (x) => [x.customer, x.note].filter(Boolean).join(" · ")]])}<p style="font-size:12px;color:#6B7090">Request ${escH(batch.id)} · raised by ${escH(batch.by)} on ${new Date(batch.at + 19800000).toISOString().slice(0, 10)}. Target turnaround: ${p.tatHours || 48} hours. The link shows only ${escH(p.name)}'s IMEIs.</p>`);
  const csv = { name: `vivo_IMEI_unblock_${batch.id}.csv`, text: csvOf([["Request", "IMEI", "Model", "Retailer ID", "Retailer", "Customer", "Note", "State", "Status (Unblocked / Not unblocked)", "Remark"]].concat(items.map((x) => [batch.id, x.imei, x.model, x.rid, x.rname, x.customer, x.note, batch.state, "", ""]))) };
  return mail(ctx, p.emails, p.cc, `vivo IMEI unblock request ${batch.id} — ${items.length} IMEIs (${batch.state})`, html, csv);
}

// ---------- partner side: secure link, no login ----------
export async function iubPublic(b, ctx) {
  const { store, t, pool } = ctx, tok = str(b.p, 40).replace(/[^a-f0-9]/g, ""), cfg = await cfgOf(store), p = tok ? cfg.partners.find((x) => x.token === tok) : null;
  if (!p || p.active === false) return json(404, { ok: false, error: "This link isn't valid any more. Please ask your vivo contact for the latest link." });
  const mine = (await pool(await store.list("iubb:"), 30, (k) => store.get(k))).filter((x) => x && x.pid === p.id);
  if (b.action === "iub-p-list") {
    const since = t - 45 * 864e5, rows = [];
    mine.forEach((x) => x.items.forEach((it) => { if (it.status === "with_partner" || (it.pAt || it.hAt || x.at) > since) rows.push({ batch: x.id, imei: it.imei, model: it.model, rid: it.rid, rname: it.rname, customer: it.customer, note: it.note, state: x.state, reason: x.reason, at: x.at, status: it.status, pRemark: it.pRemark || "", pAt: it.pAt || 0, hRemark: it.status === "ho_unblocked" || it.status === "ho_failed" ? it.hRemark || "" : "", hAt: it.hAt || 0 }); }));
    return json(200, { ok: true, partner: p.name, tatHours: p.tatHours || 48, now: t, statuses: IUB_STATUS, rows: rows.sort((a, c) => (a.status === "with_partner" ? 0 : 1) - (c.status === "with_partner" ? 0 : 1) || a.at - c.at) });
  }
  if (b.action === "iub-p-update") {
    const ups = (Array.isArray(b.updates) ? b.updates : []).slice(0, 3000), who = str(b.name, 60) || p.name; let n = 0; const touched = new Map();
    for (const u of ups) {
      const x = mine.find((y) => y.id === str(u.batch, 30)) || mine.find((y) => y.items.some((it) => it.imei === str(u.imei, 15) && it.status === "with_partner"));
      if (!x) continue; const it = x.items.find((y) => y.imei === str(u.imei, 15)); if (!it || it.status !== "with_partner") continue;
      const st = u.status === "unblocked" ? "unblocked" : u.status === "partner_failed" ? "partner_failed" : ""; if (!st) continue;
      it.status = st; it.pAt = t; it.pBy = who; it.pRemark = str(u.remark, 300); n++; touched.set(x.id, x);
      if (st === "unblocked") await store.delete(`iubopen:${it.imei}`);
    }
    for (const x of touched.values()) {
      await store.set(`iubb:${x.id}`, x);
      if (x.byEmail && cfg.autoMail !== false) {   // let the state user know
        const done = x.items.filter((it) => it.pAt === t);
        const r = await mail(ctx, [x.byEmail], [], `${p.name} updated ${done.length} IMEI${done.length === 1 ? "" : "s"} — request ${x.id}`, shell(`${p.name} has updated your IMEI unblock request`, `${table(done, [["IMEI", (i) => i.imei], ["Model", (i) => i.model], ["Result", (i) => IUB_STATUS[i.status]], ["Remark", (i) => i.pRemark]])}<p style="font-size:12.5px">Not-unblocked IMEIs go to vivo HO automatically for the next step.</p>${btn((ctx.env.SITE_URL || "") + "/imeiunblock.html", "Open IMEI unblock")}`));
        x.mails = (x.mails || []).concat([{ at: t, to: x.byEmail, kind: "partner-update", ok: r.ok, error: r.error || "" }]).slice(-30); await store.set(`iubb:${x.id}`, x);
      }
    }
    return json(200, { ok: true, updated: n });
  }
  return json(400, { ok: false, error: "Unknown action" });
}

// ---------- staff (state users + HO) ----------
export async function iubAction(b, ctx) {
  const { store, t, app, rec, pool, env = {} } = ctx, isHO = app === "admin", by = rec.fullName || rec.username || "", myState = isHO ? "" : str(rec.state, 40);
  const seeState = (s) => isHO || low(s) === low(myState);
  const cfg = await cfgOf(store), pOf = (id) => cfg.partners.find((p) => p.id === id);
  const all = async () => (await pool(await store.list("iubb:"), 30, (k) => store.get(k))).filter((x) => x && seeState(x.state));
  const saveCfg = async () => { await store.set("iubcfg", cfg); };

  if (b.action === "iub-me") return json(200, { ok: true, isHO, state: myState, statuses: IUB_STATUS, partners: cfg.partners.filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name, hasEmail: !!p.emails.length, tatHours: p.tatHours || 48 })) });
  if (b.action === "iub-cfg") {
    if (!isHO) return json(403, { ok: false, error: "Only HO admins manage partners." });
    if (b.save) {
      const c = b.cfg || {}, old = new Map(cfg.partners.map((p) => [p.id, p]));
      cfg.partners = (Array.isArray(c.partners) ? c.partners : []).slice(0, 40).map((p, i) => { const o = old.get(p.id) || {}; return { id: o.id || "p" + nid(t + i), name: str(p.name, 60), emails: emails(p.emails), cc: emails(p.cc), token: o.token || randomBytes(16).toString("hex"), active: p.active !== false, tatHours: Math.max(1, Math.min(720, Number(p.tatHours) || 48)) }; }).filter((p) => p.name);
      cfg.hoEmails = emails(c.hoEmails); cfg.autoMail = c.autoMail !== false; await saveCfg();
    }
    return json(200, { ok: true, cfg: Object.assign({}, cfg, { partners: cfg.partners.map((p) => Object.assign({}, p, { link: linkOf(env, p) })) }) });
  }
  if (b.action === "iub-token") {   // new link for a partner (old one stops working)
    if (!isHO) return json(403, { ok: false, error: "HO only." });
    const p = pOf(str(b.pid, 30)); if (!p) return json(404, { ok: false, error: "Partner not found." });
    p.token = randomBytes(16).toString("hex"); await saveCfg(); return json(200, { ok: true, link: linkOf(env, p) });
  }
  if (b.action === "iub-lookup") {   // fill model / retailer / financier from the Retailer portal's IMEI upload
    const L = (Array.isArray(b.imeis) ? b.imeis : []).slice(0, 2000).map((x) => str(x, 15)), out = {};
    await pool(L, 20, async (i) => { const w = await store.get(`rtimei:${i}`); if (!w) return; const il = (await store.get(`rtil:${w.rid}`)) || { items: [] }, x = il.items.find((y) => y.i === i), m = (await store.get(`rtl:${w.rid}`)) || {}; if (x) out[i] = { model: x.m, rid: w.rid, rname: m.name || "", financier: x.fp || "", financed: !!x.fin, state: m.state || "" }; });
    const open = {}; await pool(L, 20, async (i) => { const o = await store.get(`iubopen:${i}`); if (o) open[i] = o.batch; });
    return json(200, { ok: true, found: out, open });
  }
  if (b.action === "iub-raise") {
    const p = pOf(str(b.pid, 30)); if (!p || p.active === false) return json(400, { ok: false, error: "Choose the finance partner." });
    const state = isHO ? str(b.state, 40) : myState; if (!state) return json(400, { ok: false, error: "Choose the state." });
    const seen = new Set(), items = [], skipped = [];
    for (const x of (Array.isArray(b.items) ? b.items : []).slice(0, 2000)) {
      const imei = String(x.imei || "").replace(/\D/g, "");
      if (!imeiOk(imei)) { skipped.push({ imei, why: "not a valid IMEI" }); continue; }
      if (seen.has(imei)) continue; seen.add(imei);
      const o = await store.get(`iubopen:${imei}`); if (o) { skipped.push({ imei, why: "already open in request " + o.batch }); continue; }
      items.push({ imei, model: str(x.model, 50), rid: str(x.rid, 40).toUpperCase(), rname: str(x.rname, 80), customer: str(x.customer, 80), note: str(x.note, 200), status: "with_partner" });
    }
    if (!items.length) return json(400, { ok: false, error: "No new valid IMEIs to send.", skipped });
    const x = { id: "IUB" + nid(t).toUpperCase().slice(-7), pid: p.id, partner: p.name, state, by, byKey: app + ":" + rec.username, byEmail: low(rec.email), at: t, reason: str(b.reason, 200), items, mails: [] };
    for (const it of items) await store.set(`iubopen:${it.imei}`, { batch: x.id });
    let m = { ok: false, error: "Auto e-mail is off" };
    if (cfg.autoMail !== false) m = await mailPartnerNew(ctx, p, x);
    x.mails.push({ at: t, to: p.emails.join(", "), kind: "new", ok: m.ok, error: m.error || "" });
    await store.set(`iubb:${x.id}`, x);
    return json(200, { ok: true, batch: x, skipped, mail: m, link: linkOf(env, p) });
  }
  if (b.action === "iub-list") {
    const L = await all(), q = low(b.q), rows = [];
    L.forEach((x) => x.items.forEach((it) => { if (b.status && (b.status === "open" ? FINAL.includes(it.status) : it.status !== b.status)) return; if (b.pid && x.pid !== b.pid) return; if (b.state && low(x.state) !== low(b.state)) return; if (q && !(it.imei + " " + it.model + " " + it.rname + " " + it.rid + " " + x.id).toLowerCase().includes(q)) return; rows.push(Object.assign({ batch: x.id, partner: x.partner, pid: x.pid, state: x.state, by: x.by, at: x.at, reason: x.reason }, it)); }));
    // stats over everything visible
    const S = { total: 0, by: {}, partners: {}, states: {} };
    L.forEach((x) => x.items.forEach((it) => {
      S.total++; S.by[it.status] = (S.by[it.status] || 0) + 1;
      const P = S.partners[x.partner] || (S.partners[x.partner] = { partner: x.partner, pid: x.pid, total: 0, pending: 0, overdue: 0, ok: 0, failed: 0, hoOk: 0, hoFailed: 0, tatSum: 0, tatN: 0 });
      const tat = (pOf(x.pid) || {}).tatHours || 48; P.total++;
      if (it.status === "with_partner") { P.pending++; if (t - x.at > tat * 36e5) P.overdue++; }
      if (it.status === "unblocked") P.ok++; if (it.status === "partner_failed") P.failed++; if (it.status === "ho_unblocked") P.hoOk++; if (it.status === "ho_failed") P.hoFailed++;
      if (it.pAt) { P.tatSum += (it.pAt - x.at) / 36e5; P.tatN++; }
      const Z = S.states[x.state] || (S.states[x.state] = { state: x.state, total: 0, open: 0, done: 0 }); Z.total++; if (FINAL.includes(it.status)) Z.done++; else Z.open++;
    }));
    const partners = Object.values(S.partners).map((P) => Object.assign(P, { avgTat: P.tatN ? Math.round(P.tatSum / P.tatN * 10) / 10 : null, okRate: P.ok + P.failed ? Math.round(P.ok / (P.ok + P.failed) * 100) : null }));
    return json(200, { ok: true, rows: rows.sort((a, c) => c.at - a.at).slice(0, 3000), count: rows.length, stats: { total: S.total, by: S.by, partners, states: Object.values(S.states) }, statuses: IUB_STATUS, now: t, states: [...new Set(L.map((x) => x.state))].sort() });
  }
  if (b.action === "iub-batch") {
    const x = await store.get(`iubb:${str(b.id, 30)}`); if (!x || !seeState(x.state)) return json(404, { ok: false, error: "Not found." });
    return json(200, { ok: true, batch: x, link: isHO && pOf(x.pid) ? linkOf(env, pOf(x.pid)) : "" });
  }
  if (b.action === "iub-ho-update") {   // HO's own attempt on cases the partner couldn't unblock (or any open case)
    if (!isHO) return json(403, { ok: false, error: "Only vivo HO admins can set the final status." });
    const ups = (Array.isArray(b.updates) ? b.updates : []).slice(0, 3000), touched = new Map(); let n = 0;
    for (const u of ups) {
      const x = touched.get(str(u.batch, 30)) || await store.get(`iubb:${str(u.batch, 30)}`); if (!x) continue;
      const it = x.items.find((y) => y.imei === str(u.imei, 15)); if (!it || FINAL.includes(it.status) && it.status !== "ho_failed") continue;
      const st = u.status === "ho_unblocked" ? "ho_unblocked" : u.status === "ho_failed" ? "ho_failed" : ""; if (!st) continue;
      it.status = st; it.hAt = t; it.hBy = by; it.hRemark = str(u.remark, 300); n++; touched.set(x.id, x); await store.delete(`iubopen:${it.imei}`);
    }
    const mails = [];
    for (const x of touched.values()) {
      const done = x.items.filter((it) => it.hAt === t), p = pOf(x.pid);
      if (cfg.autoMail !== false && b.notify !== false) {
        const html = shell(`Final status — request ${x.id}`, `<p style="margin:0">vivo HO has completed the follow-up on these IMEIs${p ? " (" + escH(p.name) + ")" : ""}:</p>${table(done, [["IMEI", (i) => i.imei], ["Model", (i) => i.model], ["Partner result", (i) => i.pRemark || "Not unblocked"], ["Final status", (i) => IUB_STATUS[i.status]], ["HO remark", (i) => i.hRemark]])}`);
        if (p) { const r = await mail(ctx, p.emails, p.cc.concat(cfg.hoEmails), `vivo IMEI unblock — final status, request ${x.id}`, html); x.mails.push({ at: t, to: p.emails.join(", "), kind: "final", ok: r.ok, error: r.error || "" }); mails.push(r); }
        if (x.byEmail) { const r = await mail(ctx, [x.byEmail], [], `IMEI unblock — final status, request ${x.id}`, html); x.mails.push({ at: t, to: x.byEmail, kind: "final-state", ok: r.ok, error: r.error || "" }); }
      }
      await store.set(`iubb:${x.id}`, x);
    }
    return json(200, { ok: true, updated: n, mailed: mails.filter((m) => m.ok).length });
  }
  if (b.action === "iub-remind") {   // e-mail a partner all their pending IMEIs again
    const p = pOf(str(b.pid, 30)); if (!p) return json(404, { ok: false, error: "Partner not found." });
    const L = (await all()).filter((x) => x.pid === p.id), items = [];
    L.forEach((x) => x.items.forEach((it) => { if (it.status === "with_partner") items.push(Object.assign({ batch: x.id, state: x.state, at: x.at }, it)); }));
    if (!items.length) return json(400, { ok: false, error: "Nothing pending with " + p.name + "." });
    const html = shell(`Reminder: ${items.length} IMEI${items.length === 1 ? "" : "s"} waiting for rollback`, `<p style="margin:0">Dear ${escH(p.name)} team, these IMEIs are still waiting for your update:</p>${btn(linkOf(env, p), "Open the list & update status")}${table(items, [["IMEI", (i) => i.imei], ["Model", (i) => i.model], ["State", (i) => i.state], ["Raised", (i) => new Date(i.at + 19800000).toISOString().slice(0, 10)], ["Hours waiting", (i) => Math.round((t - i.at) / 36e5)]])}`);
    const r = await mail(ctx, p.emails, p.cc, `Reminder — ${items.length} vivo IMEIs pending rollback`, html, { name: "vivo_IMEI_pending.csv", text: csvOf([["Request", "IMEI", "Model", "State", "Status (Unblocked / Not unblocked)", "Remark"]].concat(items.map((i) => [i.batch, i.imei, i.model, i.state, "", ""]))) });
    return json(200, { ok: r.ok, error: r.error, count: items.length });
  }
  if (b.action === "iub-resend") {
    const x = await store.get(`iubb:${str(b.id, 30)}`); if (!x || !seeState(x.state)) return json(404, { ok: false, error: "Not found." });
    const p = pOf(x.pid); if (!p) return json(404, { ok: false, error: "Partner not found." });
    const r = await mailPartnerNew(ctx, p, x); x.mails.push({ at: t, to: p.emails.join(", "), kind: "resend", ok: r.ok, error: r.error || "" }); await store.set(`iubb:${x.id}`, x);
    return json(200, { ok: r.ok, error: r.error });
  }
  if (b.action === "iub-cancel") {   // withdraw IMEIs still with the partner (raised by mistake)
    const x = await store.get(`iubb:${str(b.id, 30)}`); if (!x || !seeState(x.state)) return json(404, { ok: false, error: "Not found." });
    if (!isHO && x.byKey !== app + ":" + rec.username) return json(403, { ok: false, error: "Only the person who raised it or HO can withdraw." });
    const im = new Set((b.imeis || []).map((i) => str(i, 15))); let n = 0;
    for (const it of x.items) if (it.status === "with_partner" && (!im.size || im.has(it.imei))) { it.status = "ho_failed"; it.hAt = t; it.hBy = by; it.hRemark = "Withdrawn by vivo"; n++; await store.delete(`iubopen:${it.imei}`); }
    await store.set(`iubb:${x.id}`, x); return json(200, { ok: true, withdrawn: n });
  }
  if (b.action === "iub-ai") {
    const L = await all(), P = {};
    L.forEach((x) => x.items.forEach((it) => { const z = P[x.partner] || (P[x.partner] = { partner: x.partner, total: 0, pending: 0, ok: 0, notOk: 0, hoOk: 0, hoFailed: 0, hoursWaiting: [] }); z.total++; if (it.status === "with_partner") { z.pending++; z.hoursWaiting.push(Math.round((t - x.at) / 36e5)); } if (it.status === "unblocked") z.ok++; if (it.status === "partner_failed") z.notOk++; if (it.status === "ho_unblocked") z.hoOk++; if (it.status === "ho_failed") z.hoFailed++; }));
    const data = Object.values(P).map((z) => Object.assign(z, { hoursWaiting: z.hoursWaiting.sort((a, c) => c - a).slice(0, 10) }));
    const reasons = {}; L.forEach((x) => x.items.forEach((it) => { if (it.pRemark && it.status === "partner_failed") reasons[it.pRemark.toLowerCase()] = (reasons[it.pRemark.toLowerCase()] || 0) + 1; }));
    const r = await ctx.askAI(env, "Summarise this IMEI unblock (finance rollback) status for vivo " + (isHO ? "HO" : myState) + ": which partners are slow or failing, what is overdue, common failure reasons, and 4 concrete next actions.", "DATA: " + JSON.stringify({ partners: data, failureReasons: reasons }).slice(0, 9000), [], ctx.aiFetch, { system: "You are a vivo India operations analyst. Use only DATA. Plain text, • bullets, under 12 lines, specific numbers.", label: "IUB" });
    return json(200, r.ok ? { ok: true, answer: r.text } : { ok: false, error: r.error });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
