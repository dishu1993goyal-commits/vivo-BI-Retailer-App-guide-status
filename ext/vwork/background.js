// Runs the vivo BI vWork helper (vivo_vw.js) inside the person's own vWork tab, about once a second, and hands the result
// back to the BI page that asked. The person logs in to vWork themselves; nothing is saved, released or changed in vWork.
const OK_VW = u => /^https:\/\/in-vwork\.vivo\.xyz\//.test(u) || /^http:\/\/localhost(:\d+)?\//.test(u);
let RUN = null;   // { job, biTab, vwTab, first, code, ticks }
async function latestCode(origin) {
  try { const r = await fetch(origin + "/vivo_vw.js?v=" + Date.now(), { cache: "no-store" }); if (r.ok) { const t = await r.text(); if (t.includes("__biVwRun")) return t; } } catch (e) { }
  return null;
}
async function inject(tabId, code) {
  // newest helper from the BI site; if vWork's page rules block it, the copy inside this extension
  if (code) { try { await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: c => { if (window.__biVwRun) return; const s = document.createElement("script"); s.textContent = c; (document.head || document.documentElement).appendChild(s); s.remove(); }, args: [code] }); } catch (e) { } }
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: () => !!window.__biVwRun }).catch(() => [{}]);
  if (!result) await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["vivo_vw.js"] }).catch(() => { });
}
function b64(buf) { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768)); return btoa(s); }
async function send(r, final) {
  if (!RUN) return;
  try { await chrome.tabs.sendMessage(RUN.biTab, { t: final ? "result" : "status", r }); } catch (e) { }
  chrome.action.setBadgeText({ text: final ? "" : r.s === "login" || r.s === "you" ? "!" : "…" }).catch(() => { });
  if (final) { const bt = RUN.biTab; RUN = null; try { await chrome.tabs.update(bt, { active: true }); const t = await chrome.tabs.get(bt); await chrome.windows.update(t.windowId, { focused: true }); } catch (e) { } }
}
async function tick() {
  if (!RUN) return;
  const R0 = RUN;
  try {
    let tab; try { tab = await chrome.tabs.get(R0.vwTab); } catch (e) { return send({ s: "stopped", mode: "vw", id: R0.job.id, rep: R0.job.rep, msg: "The vWork tab was closed" }, true); }
    if (tab.status === "complete" && OK_VW(tab.url || "")) {
      await inject(R0.vwTab, R0.code);
      const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: R0.vwTab }, world: "MAIN", func: j => window.__biVwRun ? window.__biVwRun(j) : null, args: [R0.first ? R0.job : null] }).catch(() => [{}]);
      if (result) {
        R0.first = false; let r = {}; try { r = JSON.parse(result); } catch (e) { }
        if (r.s === "grab" && r.url && !R0.grabbing) {   // vWork's export file: download it here and hand it to the BI page
          R0.grabbing = true;
          try { const res = await fetch(r.url, { credentials: OK_VW(r.url) ? "include" : "omit" }); if (!res.ok) throw new Error("vWork answered " + res.status); const buf = await res.arrayBuffer(); if (buf.byteLength > 60 * 1048576) throw new Error("File over 60 MB");
            return send({ s: "done", mode: "vw", id: R0.job.id, rep: R0.job.rep, from: R0.job.from, to: R0.job.to, file: true, fname: r.fname || "", b64: b64(buf), msg: "Downloaded " + (r.fname || "the report") }, true);
          } catch (e) { return send({ s: "err", mode: "vw", id: R0.job.id, rep: R0.job.rep, msg: "Download failed: " + e.message }, true); }
        }
        if (r.s === "done" || r.s === "err" || r.s === "stopped") return send(r, true);
        if (r.s) send(r, false);
      }
    }
    if (++R0.ticks > 2400) return send({ s: "err", mode: "vw", id: R0.job.id, rep: R0.job.rep, msg: "vWork took too long" }, true);
  } catch (e) { }
  if (RUN === R0) setTimeout(tick, 1000);
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    if (m.t === "stop") { if (RUN) send({ s: "stopped", mode: "vw", id: RUN.job.id, rep: RUN.job.rep, msg: "Stopped" }, true); return reply({ ok: true }); }
    if (m.t !== "run" || !m.job || !sender.tab) return reply({ ok: false });
    const url = OK_VW(m.url || "") ? m.url : "https://in-vwork.vivo.xyz/vwork/";
    const host = new URL(url).origin;
    // reuse an open vWork tab (already logged in), otherwise open one
    let tabs = await chrome.tabs.query({ url: host + "/*" }), tab = tabs[0];
    if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
    else tab = await chrome.tabs.create({ url, index: sender.tab.index + 1 });
    RUN = { job: m.job, biTab: sender.tab.id, vwTab: tab.id, first: true, code: await latestCode(new URL(sender.tab.url).origin), ticks: 0 };
    reply({ ok: true, reused: !!tabs[0] });
    setTimeout(tick, 1500);
  })();
  return true;
});
