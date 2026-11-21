// Affordability & partner tools (one module):
//   bp-  Bundle Pair Engine (HO)        bp:cfg { win, before, samePartner, okOnly, iotWords[] }   bp:run:<id> { id, name, at, by, stats, pairs[], unp[], amb[] }
//   ph-  Partner Integration Hub (HO)   ph:p:<id> partner   ph:st:<id>:<yyyy-mm-dd> { calls, ok, err, apis:{ ep:{calls,err} } } from imported gateway logs
//   ap-  Affordability penetration      ap:data { at, by, months[], ms:[[month,state,model,sales,emi]], mp:[[month,state,partner,emi]], st:[[state,store,name,sales,emi]], storeMonth }
//   cr-  Data-to-creative presets       cr:p:<id> { id, name, tpl, theme, fields, by, at }
// The pairing, offer maths and creatives run on the device; the server keeps settings, results and shared data.
import { randomBytes } from "node:crypto";
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, n);
const list = (a, n) => (Array.isArray(a) ? a : []).slice(0, n);
const nid = (t) => t.toString(36) + randomBytes(3).toString("hex");
const num = (v) => { const x = +v; return isFinite(x) ? x : 0; };
const parse = (s) => { try { return JSON.parse(String(s).replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "")); } catch (e) { return null; } };
const STAGES = ["lead", "docs", "uat_creds", "uat_test", "uat_signoff", "prod_creds", "prod_live", "paused"];
const API_LIST = ["queryInstallment", "processInstallment", "releaseInstallment", "queryTradeIn", "processTradeIn", "processTradeInRetail", "processServiceProtection", "processBuyback", "studentAuthentication", "enterpriseDiscount"];

export async function bzAction(b, ctx) {
  const { store, t, app, rec, pool } = ctx, ho = app === "admin", by = rec.fullName || rec.username || "", a = b.action;
  const hoOnly = () => J(403, { ok: false, error: "Only HO can use this" });

  // ---------------- Bundle Pair Engine ----------------
  if (/^bp-/.test(a)) {
    if (!ho) return hoOnly();
    if (a === "bp-cfg") {
      const old = (await store.get("bp:cfg")) || { win: 30, before: false, samePartner: true, okOnly: true, iotWords: ["watch", "buds", "tws", "pad", "tab", "band", "earphone", "earbuds", "airpod", "speaker", "charger"] };
      if (b.save) { const c = b.cfg || {}; Object.assign(old, { win: Math.max(1, Math.min(1440, Math.round(num(c.win) || 30))), before: !!c.before, samePartner: c.samePartner !== false, okOnly: c.okOnly !== false, iotWords: list(c.iotWords, 60).map((x) => str(x, 40).toLowerCase()).filter(Boolean) }); await store.set("bp:cfg", old); }
      return J(200, { ok: true, cfg: old });
    }
    if (a === "bp-save") {
      const id = nid(t), cut = (arr, n) => list(arr, n).map((r) => (Array.isArray(r) ? r.slice(0, 20).map((v) => (typeof v === "number" ? v : str(v, 80))) : []));
      const x = { id, name: str(b.name, 100) || "Pairing run", at: t, by, cfg: b.cfg || {}, stats: Object.fromEntries(Object.entries(b.stats || {}).slice(0, 30).map(([k, v]) => [str(k, 30), num(v)])), head: list(b.head, 20).map((h) => str(h, 40)), pairs: cut(b.pairs, 4000), unp: cut(b.unp, 2000), amb: cut(b.amb, 1000) };
      if (JSON.stringify(x).length > 4800000) return J(413, { ok: false, error: "Too big to keep — download the Excel instead" });
      await store.set("bp:run:" + id, x); return J(200, { ok: true, id });
    }
    if (a === "bp-list") { const R = (await pool(await store.list("bp:run:"), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 100); return J(200, { ok: true, rows: R.map((x) => ({ id: x.id, name: x.name, at: x.at, by: x.by, stats: x.stats })) }); }
    if (a === "bp-get") { const x = await store.get("bp:run:" + str(b.id, 20)); return x ? J(200, { ok: true, run: x }) : J(404, { ok: false, error: "Not found" }); }
    if (a === "bp-del") { await store.delete("bp:run:" + str(b.id, 20)); return J(200, { ok: true }); }
  }

  // ---------------- Partner Integration Hub ----------------
  if (/^ph-/.test(a)) {
    if (!ho) return hoOnly();
    const clean = (p, old) => ({
      id: old ? old.id : nid(t), name: str(p.name, 80), company: str(p.company, 120), type: str(p.type, 40), spoc: str(p.spoc, 80), phone: str(p.phone, 20), email: str(p.email, 120), tech: str(p.tech, 160),
      apis: list(p.apis, 30).map((x) => str(x, 40)).filter((x) => API_LIST.includes(x)), stage: STAGES.includes(p.stage) ? p.stage : "lead",
      dates: Object.fromEntries(STAGES.map((s) => [s, num((p.dates || {})[s]) || (old && old.dates ? old.dates[s] || 0 : 0)])),
      checks: Object.fromEntries(Object.entries(p.checks || {}).slice(0, 40).map(([k, v]) => [str(k, 40), !!v])),
      notes: list(p.notes, 200).map((n) => ({ t: num(n.t) || t, by: str(n.by, 60), x: txt(n.x, 600) })).filter((n) => n.x),
      target: num(p.target) || 0, by: old ? old.by : by, at: old ? old.at : t, upd: t
    });
    if (a === "ph-list") {
      const P = (await pool(await store.list("ph:p:"), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name));
      const since = t - 30 * 864e5, keys = await store.list("ph:st:"), S = {};
      const recent = keys.filter((k) => Date.parse(k.slice(-10)) >= since - 864e5);
      (await pool(recent, 30, (k) => store.get(k).then((v) => [k, v]))).forEach(([k, v]) => { if (!v) return; const pid = k.split(":")[2], s = S[pid] = S[pid] || { calls: 0, err: 0, last: "" }; s.calls += v.calls; s.err += v.err; if (k.slice(-10) > s.last) s.last = k.slice(-10); });
      return J(200, { ok: true, rows: P.map((p) => Object.assign({}, p, { s30: S[p.id] || null })), stages: STAGES, apis: API_LIST });
    }
    if (a === "ph-save") { const old = b.id ? await store.get("ph:p:" + str(b.id, 20)) : null; const p = clean(b.p || {}, old); if (!p.name) return J(400, { ok: false, error: "Type the partner name" }); if (old && old.stage !== p.stage && !p.dates[p.stage]) p.dates[p.stage] = t; if (!old) p.dates[p.stage] = p.dates[p.stage] || t; await store.set("ph:p:" + p.id, p); return J(200, { ok: true, p }); }
    if (a === "ph-del") { const id = str(b.id, 20); for (const k of await store.list("ph:st:" + id + ":")) await store.delete(k); await store.delete("ph:p:" + id); return J(200, { ok: true }); }
    if (a === "ph-get") {
      const p = await store.get("ph:p:" + str(b.id, 20)); if (!p) return J(404, { ok: false, error: "Not found" });
      const days = (await pool(await store.list("ph:st:" + p.id + ":"), 30, (k) => store.get(k).then((v) => v && Object.assign({ d: k.slice(-10) }, v)))).filter(Boolean).sort((x, y) => (x.d < y.d ? -1 : 1)).slice(-120);
      // tests from the EMI API tester: requests made with this partner's company name
      const co = (p.company || p.name).toLowerCase(), T = {};
      const logs = (await pool((await store.list("eapilog:")).slice(-3000), 40, (k) => store.get(k))).filter(Boolean);
      logs.forEach((l) => { let c = ""; try { c = String(JSON.parse(l.req).companyName || "").toLowerCase(); } catch (e) { const m = /"companyName"\s*:\s*"([^"]*)"/.exec(l.req || ""); c = m ? m[1].toLowerCase() : ""; } if (c !== co) return; const ok = l.processStatus === true && (l.code == null || String(l.code) === "200"); const k = l.env + "|" + l.ep, x = T[k] = T[k] || { env: l.env, ep: l.ep, n: 0, ok: 0, last: 0, lastMsg: "", codes: {} }; x.n++; if (ok) x.ok++; if (!ok && l.errorCode) x.codes[l.errorCode] = (x.codes[l.errorCode] || 0) + 1; if (l.at > x.last) { x.last = l.at; x.lastMsg = (ok ? "✓ " : "✗ ") + (l.message || l.errorMessage || l.err || "").slice(0, 120); } });
      const imeis = {}; for (const e of ["uat", "prod"]) { const D = (await store.get("eapiimei:" + e)) || { rows: [] }; imeis[e] = D.rows.filter((r) => String(r.partner || "").toLowerCase() === co).length; }
      const logins = {}; for (const e of ["uat", "prod"]) { const P = (await store.get("eapipw:" + e)) || {}; logins[e] = Object.keys(P).some((c) => c.toLowerCase() === co); }
      return J(200, { ok: true, p, days, tests: Object.values(T).sort((x, y) => (x.env + x.ep < y.env + y.ep ? -1 : 1)), imeis, logins });
    }
    if (a === "ph-stats") {   // { rows: [[partnerId, yyyy-mm-dd, api, calls, errors]] } from an imported gateway log (aggregated on the device)
      const add = {}; list(b.rows, 20000).forEach((r) => { const id = str(r[0], 20), d = str(r[1], 10); if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return; const k = id + ":" + d, x = add[k] = add[k] || { calls: 0, ok: 0, err: 0, apis: {} }; const c = Math.round(num(r[3])), e = Math.round(num(r[4])); x.calls += c; x.err += e; x.ok += c - e; const ep = str(r[2], 40) || "—", y = x.apis[ep] = x.apis[ep] || { calls: 0, err: 0 }; y.calls += c; y.err += e; });
      const ks = Object.keys(add); await pool(ks, 20, (k) => store.set("ph:st:" + k, add[k])); return J(200, { ok: true, days: ks.length });
    }
  }

  // ---------------- Affordability penetration ----------------
  if (/^ap-/.test(a)) {
    if (a === "ap-get") {
      const D = await store.get("ap:data"); if (!D) return J(200, { ok: true, data: null });
      if (ho) return J(200, { ok: true, data: D });
      const st = String(rec.state || "");
      return J(200, { ok: true, data: Object.assign({}, D, { ms: D.ms.filter((r) => r[1] === st), mp: D.mp.filter((r) => r[1] === st), st: D.st.filter((r) => r[0] === st), mine: st }) });
    }
    if (!ho) return hoOnly();
    if (a === "ap-save") {
      const ms = list(b.ms, 60000).map((r) => [str(r[0], 7), str(r[1], 40), str(r[2], 60), num(r[3]), num(r[4])]).filter((r) => /^\d{4}-\d{2}$/.test(r[0]));
      const mp = list(b.mp, 30000).map((r) => [str(r[0], 7), str(r[1], 40), str(r[2], 60), num(r[3])]).filter((r) => /^\d{4}-\d{2}$/.test(r[0]));
      const st = list(b.st, 8000).map((r) => [str(r[0], 40), str(r[1], 40), str(r[2], 80), num(r[3]), num(r[4])]);
      if (!ms.length) return J(400, { ok: false, error: "No rows with a month (YYYY-MM) found" });
      const D = { at: t, by, months: [...new Set(ms.map((r) => r[0]))].sort(), ms, mp, st, storeMonth: str(b.storeMonth, 7), file: str(b.file, 120) };
      if (JSON.stringify(D).length > 4800000) return J(413, { ok: false, error: "Too much data — upload fewer months or fewer models" });
      await store.set("ap:data", D); return J(200, { ok: true, months: D.months.length });
    }
    if (a === "ap-ai") {
      if (!ctx.askAI) return J(400, { ok: false, error: "AI is not set up yet." });
      const sys = 'You are a senior BI analyst for vivo India affordability (EMI / consumer finance). From the summary numbers, write sharp insights for the sales and affordability teams. Use only the numbers given; quote them. Reply with JSON only: {"headline":"one line","insights":["5-7 specific findings: where penetration is high/low, which partner is gaining or losing share, which models under-use EMI, store gaps"],"actions":["4-6 concrete actions with the state / partner / model named"]}';
      const r = await ctx.askAI(ctx.env || {}, "Follow the instructions and answer now.", txt(b.summary, 9000), [], ctx.aiFetch, { system: sys, label: "SUMMARY", json: true, maxTokens: 1500 });
      if (!r.ok) return J(502, { ok: false, error: r.error || "AI didn't answer" });
      const j = parse(r.text); if (!j) return J(502, { ok: false, error: "The AI answer wasn't readable — try again." });
      return J(200, { ok: true, ai: { headline: str(j.headline, 200), insights: list(j.insights, 8).map((x) => str(x, 300)), actions: list(j.actions, 8).map((x) => str(x, 300)) } });
    }
  }

  // ---------------- Data-to-creative presets ----------------
  if (/^cr-/.test(a)) {
    if (a === "cr-list") { const R = (await pool(await store.list("cr:p:"), 20, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.at - x.at); return J(200, { ok: true, rows: R }); }
    if (!ho) return hoOnly();
    if (a === "cr-save") { const id = str(b.id, 20) || nid(t), x = { id, name: str(b.name, 80) || "Design", tpl: str(b.tpl, 30), theme: str(b.theme, 30), size: str(b.size, 12), fields: Object.fromEntries(Object.entries(b.fields || {}).slice(0, 40).map(([k, v]) => [str(k, 30), txt(v, 400)])), logo: /^data:image\/(png|jpeg|webp);base64,/.test(String(b.logo || "")) && String(b.logo).length < 400000 ? b.logo : "", by, at: t }; await store.set("cr:p:" + id, x); return J(200, { ok: true, id }); }
    if (a === "cr-del") { await store.delete("cr:p:" + str(b.id, 20)); return J(200, { ok: true }); }
  }
  return J(400, { ok: false, error: "Unknown action" });
}
