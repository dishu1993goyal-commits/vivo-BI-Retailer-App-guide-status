// vivo BI site ⇄ helper: the KPI Dashboard page asks for a vWork run; the result comes back here.
(function () {
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || typeof e.data !== "object") return;
    if (e.data.biVw === "ping") window.postMessage({ biVwExt: chrome.runtime.getManifest().version }, "*");
    if (e.data.biVw === "run" && e.data.job) chrome.runtime.sendMessage({ t: "run", job: e.data.job, url: e.data.url }, function (r) { window.postMessage({ biVwAck: r || { ok: false } }, "*"); });
    if (e.data.biVw === "stop") chrome.runtime.sendMessage({ t: "stop" });
  });
  chrome.runtime.onMessage.addListener(function (m) {
    if (m && m.t === "result") window.postMessage({ biVwResult: m.r }, "*");
    if (m && m.t === "status") window.postMessage({ biVwStatus: m.r }, "*");
  });
  window.postMessage({ biVwExt: chrome.runtime.getManifest().version }, "*");
})();
