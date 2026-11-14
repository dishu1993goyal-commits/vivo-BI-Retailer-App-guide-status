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
export const EAPI_ENDPOINTS = {
  queryInstallment: { name: "Query Installment (GetIMEIInfoWithNoBlock_NEW)", fields: ["imei", "modelName", "companyName", "password", "dealerCode"] },
  processInstallment: { name: "Process Installment (GetIMEIInfo_NEW)", fields: ["companyName", "password", "imei", "modelName", "scheme", "financeAmount", "dealerCode"], changes: true },
  releaseInstallment: { name: "Release Installment (UpdateImeiInfo)", fields: ["companyName", "password", "imei"], changes: true },
};
const DEF_ENV = {
  prod: { url: "https://in-vwork.vivo.xyz/gw/04", invoker: "emi-company-consumer", company: "Benow" },
  uat: { url: "", invoker: "", company: "" },
};
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const FMTS = ["compact|ok", "asis|ok", "sorted|ok", "compact|nobody", "compact|imeionly", "compact|secs", "compact|upper", "asis|nobody", "sorted|upper"];
const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : o && typeof o === "object" ? Object.keys(o).sort().reduce((a, k) => { a[k] = sortKeys(o[k]); return a; }, {}) : o;
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
  const keyInfo = () => Object.fromEntries(ENVS.map((e) => [e, { secret: !!(keys[e] && keys[e].secret), password: !!(keys[e] && keys[e].password) }]));

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
          base: { imei: str(base.imei, 20), model: str(base.model, 80), dealer: str(base.dealer, 60), scheme: str(base.scheme, 80), amount: str(base.amount, 20) } };
        const k = (b.keys || {})[e] || {};
        keys[e] = keys[e] || {};
        if (typeof k.secret === "string" && k.secret.trim()) keys[e].secret = k.secret.trim().slice(0, 300);
        if (typeof k.password === "string" && k.password.trim()) keys[e].password = k.password.trim().slice(0, 200);
        if (k.clear) keys[e] = {};
      }
      await store.set("eapicfg", cfg); await store.set("eapikeys", keys);
    }
    return json(200, { ok: true, cfg, keys: keyInfo(), endpoints: EAPI_ENDPOINTS });
  }

  if (b.action === "eapi-call") {
    const e = ENVS.includes(b.env) ? b.env : "prod", E = cfg.envs[e], K = keys[e] || {};
    const ep = EAPI_ENDPOINTS[b.ep] ? b.ep : null;
    if (!ep) return json(400, { ok: false, error: "Choose an API" });
    if (!E.url) return json(400, { ok: false, error: "Add the " + (e === "prod" ? "Production" : "UAT") + " URL in Set-up first." });
    if (!E.invoker || !K.secret) return json(400, { ok: false, error: "Add the invoker name and secret for " + (e === "prod" ? "Production" : "UAT") + " in Set-up first." });
    // {{companyName}} / {{password}} are filled from Set-up, so the password never has to be typed on the test screen
    let raw = String(b.raw == null ? "" : b.raw).slice(0, 20000);
    raw = raw.replace(/\{\{\s*companyName\s*\}\}/g, jsonEsc(E.company || "")).replace(/\{\{\s*password\s*\}\}/g, jsonEsc(K.password || ""));
    // body layout + how the signature is built. "ok" = this environment's saved format (found with "Find the right signature").
    const ef = String(b.fmt || E.fmt || "compact|ok").split("|"), bodyMode = ["asis", "compact", "sorted"].includes(ef[0]) ? ef[0] : "compact";
    let sig = str(b.sig, 20) || "ok";
    if (sig === "ok") sig = ["ok", "nobody", "imeionly", "secs", "upper", "query"].includes(ef[1]) ? ef[1] : "ok";
    if (bodyMode !== "asis") { try { const o = JSON.parse(raw); raw = JSON.stringify(bodyMode === "sorted" ? sortKeys(o) : o); } catch (x) { } }
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
    const mask = (s) => K.password ? String(s).split(jsonEsc(K.password)).join("••••••") : String(s);
    const d = (res && res.data) || {};
    const log = { id: t.toString(36) + randomBytes(2).toString("hex"), at: t, by, env: e, ep, label: str(b.label, 120), sig, url, status, ms, err,
      req: mask(raw), sigShown: b64(inv) + "@#" + ts + "@#" + hash.slice(0, 12) + "…", fmt: bodyMode + "|" + sig,
      signFail: status === 403 || /sign\s+is\s+not\s+pass|check\s+sign|signature/i.test(text) && !(res && res.code === 200), resp: mask(text).slice(0, 12000),
      code: res && res.code, errorCode: res && res.errorCode || "", message: res && res.message || "", success: res ? !!res.success : null,
      processStatus: d.processStatus === undefined ? null : d.processStatus, errorMessage: d.errorMessage || "", traceId: res && res.traceId || "" };
    await store.set("eapilog:" + log.id, log);
    return json(200, { ok: true, call: log, headers: rh, sent: { url, headers: { "Content-Type": "application/json", gwSignature: headers.gwSignature ? log.sigShown : "(not sent)" } } });
  }

  if (b.action === "eapi-fmt") {   // save the signature format that the gateway accepted
    const e = ENVS.includes(b.env) ? b.env : "uat";
    if (!FMTS.includes(b.fmt)) return json(400, { ok: false, error: "Unknown format" });
    cfg.envs[e].fmt = b.fmt; await store.set("eapicfg", cfg);
    return json(200, { ok: true, cfg, keys: keyInfo() });
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
  return json(400, { ok: false, error: "Unknown action" });
}
