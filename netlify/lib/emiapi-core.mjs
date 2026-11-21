// EMI API tester (HO only) — a Postman-like screen for vivo's EMI Business APIs (retail-emi/business/*)
//   The request is signed and sent from the server, because the gateway secret must never reach a browser or phone:
//   gwSignature = Base64(invokerName) + "@#" + timestamp + "@#" + SHA256Hex(secret + timestamp + body)
// Storage:
//   eapicfg        { envs: { prod|uat: { url, invoker, company, base:{ imei, model, dealer, scheme, amount } } } }
//   eapikeys       { prod|uat: { secret, password } }  — write-only: never returned to any screen
//   eapilog:<id>   one call (password masked, secret never stored)
import { createHash, randomBytes } from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const ENVS = ["prod", "uat"];
// All vivo IMEI business APIs (POST /retail-emi/business/<name>). fields = vivo's signing order (docFields = order printed in the document, if different); opt = optional; bool = true/false
export const EAPI_ENDPOINTS = {
  queryInstallment: { biz: "Installment (EMI)", name: "Query Installment (GetIMEIInfoWithNoBlock_NEW)", desc: "VALIDATION ONLY — checks whether the IMEI can take an installment (model match, the company's agency rights, the store incl. cross-store rules). Nothing is blocked.", fields: ["companyName", "password", "imei", "modelName", "dealerCode"] },
  processInstallment: { biz: "Installment (EMI)", name: "Process Installment (GetIMEIInfo_NEW)", desc: "VALIDATION + BLOCKING — validates the IMEI and, on success, blocks it for this partner's installment (EMI).", fields: ["companyName", "password", "imei", "modelName", "scheme", "financeAmount", "dealerCode"], changes: true },
  releaseInstallment: { biz: "Installment (EMI)", name: "Release Installment (UpdateImeiInfo)", desc: "UNBLOCK — releases (unblocks) an IMEI blocked by Process Installment, e.g. after loan closure or cancellation.", fields: ["companyName", "password", "imei"], changes: true },
  queryTradeIn: { biz: "Trade-in", name: "Query Trade-In (GetIMEIInfoWithNoBlock_NEW)", desc: "Check whether an IMEI already has an active trade-in record. specialBusinessList returns pending special discounts (5 = student, 6 = corporate).", fields: ["companyName", "password", "imei", "modelName", "dealerCode"], docFields: ["imei", "modelName", "companyName", "password", "dealerCode"], opt: ["dealerCode"] },
  processTradeIn: { biz: "Trade-in", name: "Process Trade-In (Flag02)", desc: "Apply a trade-in — non-retail channel, cross-store check skipped.", fields: ["companyName", "password", "imei", "oldPhoneBrand", "oldPhoneModel", "modelName", "dealerCode"], opt: ["oldPhoneBrand", "oldPhoneModel", "dealerCode"], changes: true },
  processTradeInRetail: { biz: "Trade-in", name: "Process Trade-In Retail (GetImeiInfo_Retailer)", desc: "Apply a trade-in — retail channel, cross-store sales check applied.", fields: ["companyName", "password", "imei", "oldPhoneBrand", "oldPhoneModel", "modelName", "dealerCode"], opt: ["oldPhoneBrand", "oldPhoneModel", "dealerCode"], changes: true },
  processServiceProtection: { biz: "Service protection", name: "Process Service Protection (GetIMEIActivation)", desc: "Apply service protection (service plan) on an IMEI. erpCode is no longer accepted.", fields: ["companyName", "password", "imei", "dealerCode", "plan"], opt: ["dealerCode", "plan"], changes: true },
  processBuyback: { biz: "ABB (assured buyback)", name: "Process Buyback (GetImeiSoldStatus)", desc: "Apply buyback (ABB) for an IMEI.", fields: ["companyName", "password", "imei", "modelName"], docFields: ["companyName", "password", "modelName", "imei"], changes: true },
  studentAuthentication: { biz: "Student authentication", name: "Student Authentication", desc: "Authenticate a student for the student discount. body order (from vivo's developer): imei, isRocketIdAuthenticated, companyName, password; isRocketIdAuthenticated (true / false) is required.", fields: ["imei", "isRocketIdAuthenticated", "companyName", "password"], order: ["imei", "isRocketIdAuthenticated", "companyName", "password"], bool: ["isRocketIdAuthenticated"], changes: true },
  enterpriseDiscount: { biz: "Enterprise discount", name: "Enterprise Discount", desc: "Apply the enterprise (corporate) discount on an IMEI. After success the query APIs return 6 in specialBusinessList.", fields: ["imei"], changes: true },
};
const DEF_ENV = {
  prod: { url: "https://in-vwork.vivo.xyz/gw/04", invoker: "emi-company-consumer", company: "Benow" },
  uat: { url: "", invoker: "", company: "" },
};
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const FMTS = ["compact|ok", "doc|ok", "asis|ok", "sorted|ok", "compact|nobody", "compact|imeionly", "compact|secs", "compact|upper", "asis|nobody", "sorted|upper"];
// vivo's gateway signs the body in this field order (confirmed by vivo IT) — keep it, whatever order the fields were typed in
export const VIVO_ORDER = ["companyName", "password", "imei", "oldPhoneBrand", "oldPhoneModel", "modelName", "scheme", "financeAmount", "dealerCode", "plan", "isRocketIdAuthenticated"];
const vivoOrder = (o) => o && typeof o === "object" && !Array.isArray(o) ? VIVO_ORDER.filter((k) => k in o).concat(Object.keys(o).filter((k) => !VIVO_ORDER.includes(k))).reduce((a, k) => { a[k] = o[k]; return a; }, {}) : o;
const docOrder = (o, ep) => { const F = (EAPI_ENDPOINTS[ep] || {}).docFields || (EAPI_ENDPOINTS[ep] || {}).fields || []; return o && typeof o === "object" && !Array.isArray(o) ? F.filter((k) => k in o).concat(Object.keys(o).filter((k) => !F.includes(k))).reduce((a, k) => { a[k] = o[k]; return a; }, {}) : o; };
const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : o && typeof o === "object" ? Object.keys(o).sort().reduce((a, k) => { a[k] = sortKeys(o[k]); return a; }, {}) : o;
// pasted from e-mail / WhatsApp: drop invisible characters (zero-width, non-breaking spaces, BOM) and outer spaces
const cleanKey = (v) => String(v || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\u00A0/g, " ").trim();
const jsonEsc = (s) => JSON.stringify(String(s)).slice(1, -1);

async function cfgOf(store) {
  const c = (await store.get("eapicfg")) || {};
  c.envs = c.envs || {};
  ENVS.forEach((e) => { c.envs[e] = Object.assign({}, DEF_ENV[e], c.envs[e] || {}); c.envs[e].base = c.envs[e].base || {}; });
  return c;
}

export async function emiApiAction(b, ctx) {
  const { store, t, app, rec, apiFetch = fetch } = ctx;
  if (app !== "admin") return json(403, { ok: false, error: "The EMI API tester is for HO admins only." });
  const by = rec.fullName || rec.username || "";
  const cfg = await cfgOf(store), keys = (await store.get("eapikeys")) || {};
  // a "fingerprint" so HO can check the saved value is the right one without it ever being shown
  const fp = (v) => v ? { len: [...v].length, head: [...v].slice(0, 2).join(""), tail: [...v].slice(-2).join(""), odd: /[^\x21-\x7E]/.test(v) } : null;
  const keyInfo = () => Object.fromEntries(ENVS.map((e) => [e, { secret: !!(keys[e] && keys[e].secret), password: !!(keys[e] && keys[e].password), sfp: fp(keys[e] && keys[e].secret), pfp: fp(keys[e] && keys[e].password) }]));

  if (b.action === "eapi-cfg") {
    if (b.save) {
      const c = b.cfg || {};
      for (const e of ENVS) {
        const x = (c.envs || {})[e]; if (!x) continue;
        const url = str(x.url, 300).replace(/\/+$/, "");
        if (url && !/^https?:\/\/[^\s/]+[^\s]*$/i.test(url)) return json(400, { ok: false, error: "The " + (e === "prod" ? "Production" : "UAT") + " URL must start with https://" });
        const base = x.base || {};
        const old = cfg.envs[e] || {};
        cfg.envs[e] = { url, invoker: str(x.invoker, 120), company: str(x.company, 120), fmt: FMTS.includes(x.fmt) ? x.fmt : (old.fmt || "compact|ok"),
          base: { imei: str(base.imei, 20), model: str(base.model, 80), dealer: str(base.dealer, 60), scheme: str(base.scheme, 80), amount: str(base.amount, 20), oldBrand: str(base.oldBrand, 60), oldModel: str(base.oldModel, 80), plan: str(base.plan, 80) } };
        const k = (b.keys || {})[e] || {};
        keys[e] = keys[e] || {};
        if (typeof k.secret === "string" && cleanKey(k.secret)) keys[e].secret = cleanKey(k.secret).slice(0, 300);
        if (typeof k.password === "string" && cleanKey(k.password)) keys[e].password = cleanKey(k.password).slice(0, 200);
        if (k.clear) keys[e] = {};
      }
      await store.set("eapicfg", cfg); await store.set("eapikeys", keys);
    }
    return json(200, { ok: true, cfg, keys: keyInfo(), endpoints: EAPI_ENDPOINTS });
  }

  // ---- IMEI test data: many test IMEIs per environment with their details, picked from a list instead of typed
  //   eapiimei:<env>  { rows: [{ id, imei, model, dealer, scheme, amount, oldBrand, oldModel, plan, partner, label, note, last:{ ep, t, ok, msg, at } }] }
  // ---- partner mails: who gets the test pack (To per company, one common Cc list) and what goes in it
  //   eapimail { from, cc:[], to:{ "<company lower>": [emails] }, subject, note }
  if (b.action === "eapi-mailcfg") {
    const M = (await store.get("eapimail")) || { from: "", cc: [], to: {}, subject: "", note: "" };
    if (b.save) {
      const em = (v) => String(v || "").trim().toLowerCase().slice(0, 120), ok = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      const x = b.cfg || {}, list = (a, n) => [...new Set((Array.isArray(a) ? a : String(a || "").split(/[,;\s]+/)).map(em).filter(ok))].slice(0, n);
      if (x.from !== undefined) M.from = ok(em(x.from)) ? em(x.from) : "";
      if (x.cc !== undefined) M.cc = list(x.cc, 15);
      if (x.to) Object.keys(x.to).slice(0, 300).forEach((c) => { const k = String(c).trim().toLowerCase().slice(0, 120); if (!k) return; const v = list(x.to[c], 6); if (v.length) M.to[k] = v; else delete M.to[k]; });
      if (x.subject !== undefined) M.subject = str(x.subject, 200);
      if (x.note !== undefined) M.note = String(x.note || "").slice(0, 3000);
      M.upd = t; M.by = by; await store.set("eapimail", M);
    }
    return json(200, { ok: true, cfg: M });
  }
  if (b.action === "eapi-mailpack") {   // everything a partner mail needs; secrets are only sent to HO's own screen to put in the draft
    const e = ENVS.includes(b.env) ? b.env : "prod", E = cfg.envs[e] || {}, K = keys[e] || {}, PW = (await store.get("eapipw:" + e)) || {};
    const pwOf = (c) => { const k = Object.keys(PW).find((x) => x.toLowerCase() === String(c).toLowerCase()); return k ? PW[k] : String(E.company || "").toLowerCase() === String(c).toLowerCase() ? K.password || "" : ""; };
    const comps = (Array.isArray(b.companies) ? b.companies : []).slice(0, 50).map((c) => str(c, 120)).filter(Boolean);
    const docs = (await Promise.all((await store.list("eapidoc:")).map((k) => store.get(k)))).filter((d) => d && d.done && d.biz === "Installment (EMI)").sort((x, y) => String(y.version || "").localeCompare(String(x.version || ""), undefined, { numeric: true }) || (y.upd || y.at) - (x.upd || x.at));
    const doc = docs.find((d) => d.env === (e === "prod" ? "Production" : "UAT")) || docs.find((d) => !d.env || /both|all/i.test(d.env)) || docs[0] || null;
    return json(200, { ok: true, env: e, url: E.url || "", invoker: E.invoker || "", secret: K.secret || "", companies: comps.map((c) => ({ company: c, password: pwOf(c) })), doc: doc ? { id: doc.id, name: doc.name, title: doc.title, version: doc.version, mime: doc.mime, size: doc.size } : null, mail: (await store.get("eapimail")) || { from: "", cc: [], to: {} } });
  }
  if (/^eapi-imei-/.test(b.action)) {
    const e = ENVS.includes(b.env) ? b.env : "uat", key = "eapiimei:" + e, D = (await store.get(key)) || { rows: [] };
    const IF = { imei: 20, imei2: 20, model: 80, dealer: 60, scheme: 80, amount: 20, oldBrand: 60, oldModel: 80, plan: 80, partner: 80, label: 120, note: 300 };
    const clean = (x) => { const o = {}; Object.keys(IF).forEach((k) => { o[k] = str(x && x[k], IF[k]); }); o.imei = o.imei.replace(/[\s'"]/g, ""); o.imei2 = o.imei2.replace(/[\s'"]/g, ""); return o; };
    // partner logins: company name → password, per environment. Write-only: passwords are never sent back to a screen.
    const pwKey = "eapipw:" + e, PW = (await store.get(pwKey)) || {};
    const pwInfo = () => Object.keys(PW).sort().map((c) => ({ company: c, len: PW[c].length }));
    if (b.action === "eapi-imei-list") return json(200, { ok: true, rows: D.rows, logins: pwInfo() });
    if (b.action === "eapi-imei-pw") {   // { creds: [{ company, password }] } add / change; { del: company } remove
      if (b.del) delete PW[cleanKey(b.del)];
      for (const x of (Array.isArray(b.creds) ? b.creds : []).slice(0, 500)) { const c = cleanKey(x && x.company).slice(0, 120), pw = cleanKey(x && x.password).slice(0, 200); if (c && pw) PW[c] = pw; }
      await store.set(pwKey, PW); return json(200, { ok: true, logins: pwInfo() });
    }
    if (b.action === "eapi-imei-save") {   // add / update by IMEI (replace: true = the list becomes exactly these rows)
      const inRows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 5000).map(clean).filter((x) => x.imei);
      if (!inRows.length) return json(400, { ok: false, error: "No IMEIs to save" });
      const old = b.replace ? [] : D.rows, byI = new Map(old.map((x) => [x.imei, x])); let added = 0, updated = 0;
      for (const x of inRows) { const o = byI.get(x.imei); if (o) { Object.assign(o, x); updated++; } else { byI.set(x.imei, Object.assign({ id: t.toString(36) + randomBytes(3).toString("hex") }, x)); added++; } }
      D.rows = [...byI.values()].slice(0, 5000); D.upd = t; D.by = by;
      await store.set(key, D); return json(200, { ok: true, rows: D.rows, added, updated });
    }
    if (b.action === "eapi-imei-del") { const ids = new Set((b.ids || []).map(String)); D.rows = D.rows.filter((x) => !ids.has(x.id)); await store.set(key, D); return json(200, { ok: true, rows: D.rows }); }
    if (b.action === "eapi-imei-mark") {   // remember the last test result next to the IMEI
      const r = D.rows.find((x) => x.imei === str(b.imei, 20)); if (!r) return json(200, { ok: true });
      r.last = { ep: str(b.ep, 40), ok: !!b.ok, msg: str(b.msg, 160), at: t }; await store.set(key, D); return json(200, { ok: true });
    }
    return json(400, { ok: false, error: "Unknown action" });
  }
  if (b.action === "eapi-call") {
    const e = ENVS.includes(b.env) ? b.env : "prod", E = cfg.envs[e], K = keys[e] || {};
    const ep = EAPI_ENDPOINTS[b.ep] ? b.ep : null;
    if (!ep) return json(400, { ok: false, error: "Choose an API" });
    if (!E.url) return json(400, { ok: false, error: "Add the " + (e === "prod" ? "Production" : "UAT") + " URL in Set-up first." });
    if (!E.invoker || !K.secret) return json(400, { ok: false, error: "Add the invoker name and secret for " + (e === "prod" ? "Production" : "UAT") + " in Set-up first." });
    // {{companyName}} / {{password}} are filled from Set-up, so the password never has to be typed on the test screen
    let raw = String(b.raw == null ? "" : b.raw).slice(0, 20000);
    // b.cred = a partner's company name from the IMEI list: use that partner's saved password instead of Set-up's
    let coName = E.company || "", pwd = K.password || "";
    if (b.cred) { const P = (await store.get("eapipw:" + e)) || {}, c = cleanKey(b.cred).slice(0, 120); if (!P[c]) return json(400, { ok: false, error: "No password saved for “" + c + "” on " + (e === "prod" ? "Production" : "UAT") + ". Add it in 📱 IMEI data → Partner logins." }); coName = c; pwd = P[c]; }
    raw = raw.replace(/\{\{\s*companyName\s*\}\}/g, jsonEsc(coName)).replace(/\{\{\s*password\s*\}\}/g, jsonEsc(pwd));
    // body layout + how the signature is built. "ok" = this environment's saved format (found with "Find the right signature").
    const ef = String(b.fmt || E.fmt || "compact|ok").split("|"), bodyMode = ["asis", "compact", "sorted", "doc"].includes(ef[0]) ? ef[0] : "compact";
    let sig = str(b.sig, 20) || "ok";
    if (sig === "ok") sig = ["ok", "nobody", "imeionly", "secs", "upper", "query"].includes(ef[1]) ? ef[1] : "ok";
    if (bodyMode !== "asis") { try { const o = JSON.parse(raw); const eo = (cfg.order || {})[ep] || EAPI_ENDPOINTS[ep].order; raw = JSON.stringify(bodyMode === "sorted" ? sortKeys(o) : bodyMode === "doc" ? docOrder(o, ep) : eo && eo.length && o && typeof o === "object" && !Array.isArray(o) ? eo.filter((k) => k in o).concat(Object.keys(vivoOrder(o)).filter((k) => !eo.includes(k))).reduce((a, k) => { a[k] = o[k]; return a; }, {}) : vivoOrder(o)); } catch (x) { } }
    let ts = t, secret = K.secret, inv = E.invoker, signed = raw, upper = false;
    if (sig === "nobody") signed = "";
    if (sig === "secs") ts = Math.floor(t / 1000);
    if (sig === "upper") upper = true;
    if (sig === "oldts") ts = t - 15 * 60000;
    if (sig === "futurets") ts = t + 15 * 60000;
    if (sig === "badsecret") secret = K.secret + "x";
    if (sig === "badinvoker") inv = "unknown-invoker";
    if (sig === "tamper") signed = raw + " ";
    if (sig === "imeionly") { try { signed = String(JSON.parse(raw).imei || ""); } catch (x) { signed = ""; } }
    const hash = upper ? sha(secret + ts + signed).toUpperCase() : sha(secret + ts + signed);
    const gw = b64(inv) + "@#" + ts + "@#" + hash;
    const headers = { "Content-Type": "application/json" };
    if (sig !== "none") headers.gwSignature = sig === "garbage" ? "not-a-signature" : gw;
    const url = E.url + "/retail-emi/business/" + ep;
    const t0 = Date.now(); let status = 0, text = "", err = "", rh = {};
    try {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 9000);
      const r = await apiFetch(url, { method: "POST", headers, body: raw, signal: ac.signal });
      clearTimeout(to);
      status = r.status; text = (await r.text()).slice(0, 30000);
      try { r.headers.forEach((v, k) => { if (Object.keys(rh).length < 25) rh[k] = String(v).slice(0, 200); }); } catch (x) { }
    } catch (x) { err = x && x.name === "AbortError" ? "No reply from the vivo gateway within 9 seconds" : "Could not reach the vivo gateway: " + String((x && (x.cause && x.cause.code || x.message)) || x).slice(0, 160); }
    const ms = Date.now() - t0;
    let res = null; try { res = JSON.parse(text); } catch (x) { }
    const mask = (s) => pwd ? String(s).split(jsonEsc(pwd)).join("••••••") : String(s);
    const d = (res && res.data) || {};
    const log = { id: t.toString(36) + randomBytes(2).toString("hex"), at: t, by, env: e, ep, label: str(b.label, 120), sig, url, status, ms, err,
      req: mask(raw), sigShown: b64(inv) + "@#" + ts + "@#" + hash.slice(0, 12) + "…", fmt: bodyMode + "|" + sig, sigFull: headers.gwSignature || "", ts, inv, bodyBytes: Buffer.byteLength(raw, "utf8"), signedBytes: Buffer.byteLength(signed, "utf8"),
      signFail: status === 403 || /sign\s+is\s+not\s+pass|check\s+sign|signature/i.test(text) && !(res && res.code === 200), resp: mask(text).slice(0, 12000),
      code: res && res.code, errorCode: res && res.errorCode || "", message: res && res.message || "", success: res ? !!res.success : null,
      processStatus: d.processStatus === undefined ? null : d.processStatus, errorMessage: d.errorMessage || "", traceId: res && res.traceId || "" };
    await store.set("eapilog:" + log.id, log);
    return json(200, { ok: true, call: log, headers: rh, rawFull: raw, sent: { url, headers: { "Content-Type": "application/json", gwSignature: headers.gwSignature ? log.sigShown : "(not sent)" } } });
  }

  if (b.action === "eapi-fmt") {   // save the signature format that the gateway accepted
    const e = ENVS.includes(b.env) ? b.env : "uat";
    if (!FMTS.includes(b.fmt)) return json(400, { ok: false, error: "Unknown format" });
    cfg.envs[e].fmt = b.fmt; await store.set("eapicfg", cfg);
    return json(200, { ok: true, cfg, keys: keyInfo() });
  }
  if (b.action === "eapi-order") {   // the field order the gateway accepted for one API (found with "Find the field order")
    if (!EAPI_ENDPOINTS[b.ep]) return json(400, { ok: false, error: "Choose an API" });
    cfg.order = cfg.order || {};
    const o = (Array.isArray(b.order) ? b.order : []).map((k) => str(k, 40)).filter((k) => /^\w+$/.test(k)).slice(0, 20);
    if (o.length) cfg.order[b.ep] = o; else delete cfg.order[b.ep];
    await store.set("eapicfg", cfg);
    return json(200, { ok: true, cfg, keys: keyInfo() });
  }
  if (b.action === "eapi-sigcalc") {   // check the signature maths against an example from vivo IT, using the saved secret
    const e = ENVS.includes(b.env) ? b.env : "uat", E = cfg.envs[e], K = keys[e] || {};
    if (!K.secret) return json(400, { ok: false, error: "No secret saved for " + (e === "prod" ? "Production" : "UAT") });
    const ts = String(b.ts || "").replace(/\D/g, "").slice(0, 16) || String(t);
    const body = String(b.body == null ? "" : b.body).slice(0, 20000).replace(/\{\{\s*password\s*\}\}/g, jsonEsc(K.password || "")).replace(/\{\{\s*companyName\s*\}\}/g, jsonEsc(E.company || ""));
    const inv = str(b.invoker, 120) || E.invoker, h = sha(K.secret + ts + body);
    return json(200, { ok: true, ts, hash: h, gw: b64(inv) + "@#" + ts + "@#" + h, invB64: b64(inv), bodyBytes: Buffer.byteLength(body, "utf8") });
  }
  if (b.action === "eapi-log") {
    const ks = (await store.list("eapilog:")).sort().reverse().slice(0, 200);
    const rows = (await Promise.all(ks.map((k) => store.get(k)))).filter(Boolean).sort((a, b2) => b2.at - a.at);
    return json(200, { ok: true, rows });
  }
  if (b.action === "eapi-log-clear") {
    for (const k of await store.list("eapilog:")) await store.delete(k);
    return json(200, { ok: true });
  }
  if (/^eapi-doc/.test(b.action)) return docAction(b, ctx, by);
  return json(400, { ok: false, error: "Unknown action" });
}

// ======================= API documents (business-wise) + partner link =======================
//   eapidoc:<id>        { id, biz, title, version, env, notes, name, mime, size, chunks, published, at, by, upd, done }
//   eapidocb:<id>:<n>   { d: base64 piece ≤ 1.4 MB }
//   eapidoclink         { token, on, ref }   — read-only partner page: published documents + the English API reference
export const DOC_BIZ = ["Installment (EMI)", "Trade-in", "Service protection", "ABB (assured buyback)", "Student authentication", "Enterprise discount", "All businesses / general"];
const DOC_MIME = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/msword|application\/vnd\.ms-excel|text\/plain|application\/json|application\/zip|image\/(png|jpeg))$/;
async function docLink(store) { let l = await store.get("eapidoclink"); if (!l) { l = { token: randomBytes(12).toString("hex"), on: false, ref: true }; await store.set("eapidoclink", l); } return l; }
const docPub = (d) => ({ id: d.id, biz: d.biz, title: d.title, version: d.version, env: d.env, notes: d.notes, name: d.name, mime: d.mime, size: d.size, chunks: d.chunks, published: !!d.published, at: d.at, upd: d.upd, by: d.by });
// the business-wise documents made by vivo BI (v1.0) are bundled with the function and added once, published
const SEED = [["Installment", "Installment (EMI)"], ["Trade-in", "Trade-in"], ["Service-protection", "Service protection"], ["ABB-Buyback", "ABB (assured buyback)"], ["Student-authentication", "Student authentication"], ["Enterprise-discount", "Enterprise discount"]];
const SEED_VER = "v1.2", SEED_FLAG = "eapidocseed4";   // a new SEED_VER replaces the earlier ready-made files (files HO uploaded are never touched)
async function seedDocs(store, t, env) {
  if (await store.get(SEED_FLAG)) return 0;
  const fs = await import("node:fs"), path = await import("node:path");
  let here = ""; try { here = path.dirname(new URL(import.meta.url).pathname); } catch (e) { }
  const dirs = [env.SEED_DIR, here && path.join(here, "../seed/apidocs"), path.join(process.cwd(), "netlify/seed/apidocs"), path.join(process.cwd(), "../netlify/seed/apidocs"), "/var/task/netlify/seed/apidocs"].filter(Boolean);
  const dir = dirs.find((d) => { try { return fs.existsSync(path.join(d, "vivo_Installment_API_Documentation_" + SEED_VER + ".pdf")); } catch (e) { return false; } });
  if (!dir) return 0;
  for (const k of await store.list("eapidoc:")) { const d = await store.get(k); if (d && d.seed) { for (let i = 0; i < (d.chunks || 8); i++) await store.delete(`eapidocb:${d.id}:${i}`); await store.delete(k); } }
  let n = 0;
  for (const [key, biz] of SEED) for (const [ext, mime, kind] of [["pdf", "application/pdf", "PDF"], ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word"]]) {
    const name = `vivo_${key}_API_Documentation_${SEED_VER}.${ext}`; let buf; try { buf = fs.readFileSync(path.join(dir, name)); } catch (e) { continue; }
    const b64s = buf.toString("base64"), parts = []; for (let i = 0; i < b64s.length; i += 1400000) parts.push(b64s.slice(i, i + 1400000));
    const id = "D" + (t + n).toString(36).toUpperCase() + randomBytes(2).toString("hex");
    for (let i = 0; i < parts.length; i++) await store.set(`eapidocb:${id}:${i}`, { d: parts[i] });
    await store.set("eapidoc:" + id, { id, at: t + n, upd: t + n, by: "vivo BI team", done: true, seed: name, name, mime, size: buf.length, chunks: parts.length, biz, title: biz.replace(/ \(.*\)/, (m) => m) + " API Documentation (" + kind + ")", version: SEED_VER + " · 17 Nov 2026", env: "both", notes: "UAT and Production endpoints, gwSignature authentication, request fields in vivo's order, success rule (code 200 + processStatus true), sample requests / responses, error scenarios, UAT vs Production differences and a UAT testing checklist.", published: true });
    n++;
  }
  await store.set(SEED_FLAG, { at: t, n });
  return n;
}
async function docAction(b, ctx, by) {
  const { store, t, pool, env = {} } = ctx;
  if (b.action === "eapi-doc-list") {
    try { await seedDocs(store, t, env); } catch (e) { }
    const L = (await pool(await store.list("eapidoc:"), 20, (k) => store.get(k))).filter((d) => d && d.done).sort((x, y) => (y.upd || y.at) - (x.upd || x.at)).map(docPub);
    const l = await docLink(store);
    return json(200, { ok: true, rows: L, biz: DOC_BIZ, link: { on: l.on, ref: l.ref !== false, url: (env.SITE_URL || "") + "/emiapi.html?d=" + l.token } });
  }
  if (b.action === "eapi-doc-up") {   // file in pieces; the last piece carries the details
    const n = Math.max(0, Math.floor(+b.n || 0)), total = Math.max(1, Math.min(8, Math.floor(+b.total || 1))), data = String(b.data || "");
    if (!/^[A-Za-z0-9+/=]*$/.test(data) || data.length > 1500000 || n >= total) return json(400, { ok: false, error: "That file piece is too big" });
    let id = str(b.id, 20).replace(/[^A-Za-z0-9]/g, "");
    if (!id) { if (n !== 0) return json(400, { ok: false, error: "Start the upload again" }); id = "D" + t.toString(36).toUpperCase() + randomBytes(2).toString("hex"); await store.set("eapidoc:" + id, { id, at: t, by, done: false }); }
    const d = await store.get("eapidoc:" + id); if (!d) return json(404, { ok: false, error: "Document not found" });
    const replacing = d.done && n === 0;
    await store.set(`eapidocb:${id}:${n}`, { d: data });
    if (n === total - 1) {
      const old = d.chunks || 0;
      Object.assign(d, { name: str(b.name, 140) || "document", mime: DOC_MIME.test(b.mime) ? b.mime : "application/octet-stream", size: Math.round(+b.size || 0), chunks: total, upd: t, done: true, ver: (d.ver || 0) + (d.done ? 1 : 0) });
      for (let i = total; i < old; i++) await store.delete(`eapidocb:${id}:${i}`);
      if (!replacing && b.meta) Object.assign(d, cleanDocMeta(b.meta, d));
      await store.set("eapidoc:" + id, d);
    }
    return json(200, { ok: true, id });
  }
  if (b.action === "eapi-doc-save") {
    const d = await store.get("eapidoc:" + str(b.id, 20)); if (!d || !d.done) return json(404, { ok: false, error: "Document not found" });
    Object.assign(d, cleanDocMeta(b.meta || {}, d), { upd: t, updBy: by }); await store.set("eapidoc:" + d.id, d);
    return json(200, { ok: true, d: docPub(d) });
  }
  if (b.action === "eapi-doc-file") {
    const d = await store.get("eapidoc:" + str(b.id, 20)); if (!d || !d.done) return json(404, { ok: false, error: "Document not found" });
    const n = Math.max(0, Math.min(d.chunks - 1, Math.floor(+b.n || 0))), p = await store.get(`eapidocb:${d.id}:${n}`);
    return json(200, { ok: true, n, total: d.chunks, data: (p && p.d) || "", name: d.name, mime: d.mime });
  }
  if (b.action === "eapi-doc-del") {
    const d = await store.get("eapidoc:" + str(b.id, 20)); if (!d) return json(404, { ok: false, error: "Document not found" });
    for (let i = 0; i < (d.chunks || 8); i++) await store.delete(`eapidocb:${d.id}:${i}`);
    await store.delete("eapidoc:" + d.id); return json(200, { ok: true });
  }
  if (b.action === "eapi-doc-link") {
    const l = await docLink(store);
    if (b.on !== undefined) l.on = !!b.on; if (b.ref !== undefined) l.ref = !!b.ref; if (b.renew) l.token = randomBytes(12).toString("hex");
    await store.set("eapidoclink", l);
    return json(200, { ok: true, link: { on: l.on, ref: l.ref !== false, url: (env.SITE_URL || "") + "/emiapi.html?d=" + l.token } });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
function cleanDocMeta(m, d) {
  return { biz: DOC_BIZ.includes(m.biz) ? m.biz : d.biz || DOC_BIZ[0], title: str(m.title, 140) || d.title || d.name || "API document", version: str(m.version, 40), env: ["", "uat", "prod", "both"].includes(m.env) ? m.env : d.env || "", notes: String(m.notes == null ? d.notes || "" : m.notes).slice(0, 1500), published: m.published === undefined ? !!d.published : !!m.published };
}
// partner page (no login): only published documents + the English API reference
export async function emiDocPublic(b, ctx) {
  const { store, pool } = ctx;
  const l = await store.get("eapidoclink");
  if (!l || !l.on || String(b.d || "").replace(/[^a-f0-9]/g, "") !== l.token) return json(403, { ok: false, error: "This document link is closed. Ask vivo for the current link." });
  const pubs = (await pool(await store.list("eapidoc:"), 20, (k) => store.get(k))).filter((d) => d && d.done && d.published);
  if (b.action === "eapi-p-docs") return json(200, { ok: true, rows: pubs.sort((x, y) => (y.upd || y.at) - (x.upd || x.at)).map((d) => { const o = docPub(d); delete o.by; return o; }), biz: DOC_BIZ, ref: l.ref !== false, endpoints: l.ref !== false ? EAPI_ENDPOINTS : null });
  if (b.action === "eapi-p-doc") {
    const d = pubs.find((x) => x.id === String(b.id || "")); if (!d) return json(404, { ok: false, error: "Document not found" });
    const n = Math.max(0, Math.min(d.chunks - 1, Math.floor(+b.n || 0))), p = await store.get(`eapidocb:${d.id}:${n}`);
    return json(200, { ok: true, n, total: d.chunks, data: (p && p.d) || "", name: d.name, mime: d.mime });
  }
  return json(400, { ok: false, error: "Unknown action" });
}
