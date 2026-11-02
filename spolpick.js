/* Scheme policies picker, shared by the scheme tools (payout calculator, scheme assistant, retailer payouts, target planner).
 * SPOLPICK.open({ api, multi, title }) → Promise<[{ id, title, text, assistant, files }]>  (empty array if cancelled)
 * SPOLPICK.fromUrl() → the policy id passed as ?spol=<id> when a tool is opened from the Scheme policies dashboard. */
(function () {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var ST = { ongoing: ["Ongoing", "#E6F4EA", "#13693F"], upcoming: ["Upcoming", "#EEF0FF", "#3346C9"], expired: ["Expired", "#F1F2F6", "#6B7090"] };
  function open(o) {
    var api = o.api, multi = !!o.multi;
    return new Promise(function (resolve) {
      var ov = document.createElement("div"); ov.className = "ov";
      ov.innerHTML = '<div class="sheet"><h3>📜 ' + esc(o.title || "Choose from Scheme policies") + '</h3><div class="muted" style="font-size:13px">' + (multi ? "Tick one or more published scheme letters." : "Pick a published scheme letter.") + '</div><input class="tx" id="spq" placeholder="Search scheme or model" style="margin-top:8px"><div id="spl" style="max-height:52vh;overflow:auto;margin-top:6px"><div class="loading"><div class="spin"></div></div></div>' +
        '<div class="acts">' + (multi ? '<button class="act" id="spok" style="justify-content:center;background:var(--brand);color:#fff">Use selected</button>' : "") + '<button class="act" id="spx" style="justify-content:center;background:none;color:var(--mut)">Cancel</button></div></div>';
      document.body.appendChild(ov);
      var items = [], sel = {}, done = false;
      var finish = function (ids) {
        if (done) return; done = true;
        if (!ids.length) { ov.remove(); return resolve([]); }
        ov.querySelector("#spl").innerHTML = '<div class="loading"><div class="spin"></div>Loading the scheme letters…</div>';
        api({ action: "spol-pick", ids: ids }).then(function (r) { ov.remove(); resolve(r && r.ok ? r.items : []); if (!r || !r.ok) alertMsg(r && r.error); });
      };
      var alertMsg = function (m) { if (m && window.console) console.warn(m); };
      var paint = function () {
        var q = (ov.querySelector("#spq").value || "").toLowerCase(), L = items.filter(function (x) { return !q || (x.title + " " + (x.models || []).join(" ")).toLowerCase().indexOf(q) >= 0; });
        ov.querySelector("#spl").innerHTML = L.length ? L.map(function (x) { var s = ST[x.status] || ST.expired; return '<label class="act" style="display:flex;gap:10px;align-items:center;cursor:pointer" data-id="' + x.id + '">' + (multi ? '<input type="checkbox" data-c="' + x.id + '"' + (sel[x.id] ? " checked" : "") + ' style="width:20px;height:20px;flex:none">' : "<span>📜</span>") + '<span style="flex:1;min-width:0;text-align:left"><b style="display:block">' + esc(x.title) + '</b><span style="font-size:11.5px;color:var(--mut)">' + esc(x.dateFrom || "") + " → " + esc(x.dateTo || "") + ((x.models || []).length ? " · " + esc(x.models.slice(0, 4).join(", ")) : "") + '</span></span><span style="font-size:10.5px;font-weight:800;border-radius:99px;padding:2px 8px;background:' + s[1] + ";color:" + s[2] + '">' + s[0] + "</span></label>"; }).join("") : '<div class="muted" style="padding:16px;text-align:center">No published scheme letters' + (q ? " match" : " for you yet") + ".</div>";
        [].forEach.call(ov.querySelectorAll("[data-id]"), function (el) { el.onclick = function (e) { if (multi) { var c = el.querySelector("[data-c]"); if (e.target !== c) c.checked = !c.checked; sel[el.dataset.id] = c.checked; e.preventDefault(); } else finish([el.dataset.id]); }; });
      };
      ov.querySelector("#spq").oninput = paint;
      ov.querySelector("#spx").onclick = function () { finish([]); };
      ov.onclick = function (e) { if (e.target === ov) finish([]); };
      if (multi) ov.querySelector("#spok").onclick = function () { finish(Object.keys(sel).filter(function (k) { return sel[k]; })); };
      api({ action: "spol-pick" }).then(function (r) { items = (r && r.ok && r.items) || []; paint(); });
    });
  }
  function fromUrl() { try { return new URLSearchParams(location.search).get("spol") || ""; } catch (e) { return ""; } }
  window.SPOLPICK = { open: open, fromUrl: fromUrl, version: 1 };
})();
