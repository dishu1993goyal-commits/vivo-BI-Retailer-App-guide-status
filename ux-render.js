/* vivo BI · UI/UX studio — turns a design (screens of component nodes) into HTML.
   Used by the studio editor, the shared prototype player and the HTML export. No dependencies. */
(function (root) {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var W = { mobile: 390, tablet: 834, web: 1280 }, H = { mobile: 844, tablet: 1112, web: 800 };
  function css(sc) {   // sc = CSS scope selector
    return sc + "{font-family:var(--uxf),system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--uxt);background:var(--uxbg);position:relative;overflow:hidden;display:flex;flex-direction:column;box-sizing:border-box}" +
      sc + " *{box-sizing:border-box}" + sc + " .ux-body{flex:1;overflow:auto;display:flex;flex-direction:column;gap:12px;padding:14px}" + sc + ".web .ux-body{padding:24px 48px}" +
      sc + " .ux-n{position:relative;flex-shrink:0}" + sc + " [style*='flex-direction:row']>.ux-n{flex-shrink:1;min-width:0}" + sc + " [data-l]{cursor:pointer}" + sc + ".play [data-l]:active{opacity:.75}" +
      sc + " .ux-nav{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--uxs);box-shadow:0 1px 0 rgba(0,0,0,.06);min-height:52px}" + sc + " .ux-nav b{flex:1;font-size:17px}" + sc + ".web .ux-nav{padding:14px 48px}" +
      sc + " .ux-tab{display:flex;background:var(--uxs);box-shadow:0 -1px 0 rgba(0,0,0,.08);padding:6px 4px 10px}" + sc + " .ux-tab div{flex:1;text-align:center;font-size:11px;color:var(--uxm)}" + sc + " .ux-tab div i{display:block;font-style:normal;font-size:20px}" + sc + " .ux-tab div.on{color:var(--uxp);font-weight:700}" +
      sc + " .ux-card{background:var(--uxs);border-radius:var(--uxr);box-shadow:0 2px 10px rgba(20,24,51,.07)}" +
      sc + " .ux-btn{border:0;border-radius:calc(var(--uxr) - 2px);padding:12px 16px;font:600 14px inherit;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--uxp);color:#fff}" + sc + " .ux-btn.secondary{background:transparent;color:var(--uxp);box-shadow:inset 0 0 0 1.5px var(--uxp)}" + sc + " .ux-btn.ghost{background:transparent;color:var(--uxp)}" + sc + " .ux-btn.danger{background:#D93B3B}" + sc + " .ux-btn.full{width:100%}" +
      sc + " .ux-in label{display:block;font-size:12px;font-weight:600;color:var(--uxm);margin-bottom:4px}" + sc + " .ux-in div{border:1.5px solid rgba(0,0,0,.12);background:var(--uxs);border-radius:calc(var(--uxr) - 4px);padding:11px 12px;font-size:14px;color:var(--uxm);display:flex;justify-content:space-between;min-height:44px}" +
      sc + " .ux-img{background:repeating-linear-gradient(45deg,rgba(0,0,0,.05) 0 10px,rgba(0,0,0,.08) 10px 20px);display:flex;align-items:center;justify-content:center;color:var(--uxm);font-size:12px;text-align:center;padding:8px}" +
      sc + " .ux-li{display:flex;align-items:center;gap:12px;padding:12px 2px;border-bottom:1px solid rgba(0,0,0,.06)}" + sc + " .ux-li:last-child{border-bottom:0}" + sc + " .ux-li .ic{width:38px;height:38px;border-radius:12px;background:color-mix(in srgb,var(--uxp) 12%,transparent);display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 38px}" + sc + " .ux-li .tx{flex:1;min-width:0}" + sc + " .ux-li .tx b{display:block;font-size:14px;font-weight:600}" + sc + " .ux-li .tx small{color:var(--uxm);font-size:12px}" + sc + " .ux-li .rt{font-size:13px;font-weight:600}" +
      sc + " .ux-chips{display:flex;gap:6px;overflow:auto}" + sc + " .ux-chips span{border-radius:99px;padding:7px 12px;font-size:12.5px;white-space:nowrap;background:var(--uxs);box-shadow:inset 0 0 0 1px rgba(0,0,0,.1)}" + sc + " .ux-chips span.on{background:var(--uxp);color:#fff;box-shadow:none}" +
      sc + " .ux-tg{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px;min-height:40px}" + sc + " .ux-tg i{width:42px;height:24px;border-radius:99px;background:#C9CCDA;position:relative}" + sc + " .ux-tg i:after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff}" + sc + " .ux-tg i.on{background:var(--uxp)}" + sc + " .ux-tg i.on:after{left:21px}" + sc + " .ux-ck{width:20px;height:20px;border-radius:6px;box-shadow:inset 0 0 0 2px #C9CCDA;display:inline-block}" + sc + " .ux-ck.on{background:var(--uxp);box-shadow:none}" +
      sc + " .ux-stat{background:var(--uxs);border-radius:var(--uxr);padding:12px;box-shadow:0 2px 10px rgba(20,24,51,.06)}" + sc + " .ux-stat small{color:var(--uxm);font-size:12px}" + sc + " .ux-stat b{display:block;font-size:22px;margin-top:2px}" + sc + " .ux-stat em{font-style:normal;font-size:12px;color:#1E9E61;font-weight:600}" + sc + " .ux-stat em.neg{color:#D93B3B}" +
      sc + " .ux-pg{height:8px;border-radius:9px;background:rgba(0,0,0,.08);overflow:hidden}" + sc + " .ux-pg i{display:block;height:100%;background:var(--uxp)}" +
      sc + " .ux-av{border-radius:50%;background:color-mix(in srgb,var(--uxp) 18%,#fff);color:var(--uxp);display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:0 0 auto}" +
      sc + " .ux-bd{display:inline-block;border-radius:99px;padding:3px 9px;font-size:11px;font-weight:700;background:color-mix(in srgb,var(--uxp) 14%,#fff);color:var(--uxp)}" +
      sc + " table.ux-tb{width:100%;border-collapse:collapse;font-size:12.5px}" + sc + " table.ux-tb th{text-align:left;color:var(--uxm);font-weight:600;padding:7px 6px;border-bottom:1px solid rgba(0,0,0,.1)}" + sc + " table.ux-tb td{padding:7px 6px;border-bottom:1px solid rgba(0,0,0,.05)}" +
      sc + " hr.ux-hr{border:0;border-top:1px solid rgba(0,0,0,.08);margin:2px 0;width:100%}" +
      sc + " .ux-sel{outline:2px solid #FF4D9D!important;outline-offset:2px}" + sc + ".edit .ux-n:hover{outline:1px dashed rgba(255,77,157,.6);outline-offset:1px}" +
      sc + ".wire{filter:grayscale(1)}";
  }
  function vars(d) { var t = d.theme || {}; return "--uxp:" + t.primary + ";--uxbg:" + t.bg + ";--uxs:" + t.surface + ";--uxt:" + t.text + ";--uxm:" + t.muted + ";--uxr:" + t.radius + "px;--uxf:'" + t.font + "'"; }
  function chart(n, p) {
    var v = n.values, mx = Math.max.apply(null, v.concat([1])), w = 300, h = n.h || 140, s = "";
    if (n.kind === "pie") { var tot = v.reduce(function (a, b) { return a + b; }, 0) || 1, a0 = -Math.PI / 2, C = ["var(--uxp)", "#F5A623", "#1E9E61", "#D93B3B", "#00A3BF", "#9152E0", "#7A7F99"]; v.forEach(function (x, i) { var fr = x / tot, a1 = a0 + fr * 6.2832, r = h / 2 - 6, cx = w / 2, cy = h / 2; if (fr >= .999) s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + C[i % 7] + '"/>'; else if (fr > 0) s += '<path d="M' + cx + " " + cy + "L" + (cx + r * Math.cos(a0)) + " " + (cy + r * Math.sin(a0)) + "A" + r + " " + r + " 0 " + (fr > .5 ? 1 : 0) + " 1 " + (cx + r * Math.cos(a1)) + " " + (cy + r * Math.sin(a1)) + 'Z" fill="' + C[i % 7] + '"/>'; a0 = a1; }); }
    else if (n.kind === "line") { var pts = v.map(function (x, i) { return (10 + i * (w - 20) / Math.max(1, v.length - 1)) + "," + (h - 10 - x / mx * (h - 24)); }).join(" "); s = '<polyline points="' + pts + '" fill="none" stroke="var(--uxp)" stroke-width="3" stroke-linejoin="round"/>'; }
    else { var bw = (w - 20) / v.length; v.forEach(function (x, i) { var bh = x / mx * (h - 24); s += '<rect x="' + (10 + i * bw + bw * .15) + '" y="' + (h - 10 - bh) + '" width="' + bw * .7 + '" height="' + bh + '" rx="4" fill="var(--uxp)"/>'; }); }
    return '<div class="ux-n" data-p="' + p + '"' + (n.label ? "" : "") + ">" + (n.label ? '<div style="font-size:12px;color:var(--uxm);margin-bottom:4px">' + esc(n.label) + "</div>" : "") + '<svg viewBox="0 0 ' + w + " " + h + '" style="width:100%;height:' + h + 'px">' + s + "</svg></div>";
  }
  function node(n, p, d) {
    var L = n.link ? ' data-l="' + esc(n.link) + '"' : "", A = ' class="ux-n' + "" + '" data-p="' + p + '"' + L;
    var kids = function () { return (n.children || []).map(function (c, i) { return node(c, p + "." + i, d); }).join(""); };
    switch (n.t) {
      case "col": case "row": case "card": case "grid": {
        var st = (n.t === "grid" ? "display:grid;grid-template-columns:repeat(" + (n.cols || 2) + ",minmax(0,1fr));" : "display:flex;flex-direction:" + (n.t === "row" ? "row" : "column") + ";") + "gap:" + n.gap + "px;padding:" + n.pad + "px;" +
          (n.t !== "grid" ? "align-items:" + ({ start: "flex-start", end: "flex-end", center: "center", stretch: "stretch" })[n.align] + ";justify-content:" + ({ start: "flex-start", end: "flex-end", center: "center", between: "space-between" })[n.justify] + ";" : "") +
          (n.bg ? "background:" + n.bg + ";" : "") + (n.radius != null ? "border-radius:" + n.radius + "px;" : "") + (n.border ? "border:1px solid " + n.border + ";" : "") + (n.w === "fill" ? "flex:1;min-width:0;" : n.w === "hug" ? "flex:0 0 auto;" : n.w ? "width:" + n.w + "px;max-width:100%;" : "") + (n.h ? "min-height:" + n.h + "px;" : "") + (n.scroll ? (n.t === "row" ? "overflow-x:auto;" : "overflow-y:auto;") : "") + (n.shadow ? "box-shadow:0 2px 10px rgba(20,24,51,.08);" : "");
        return '<div class="ux-n' + (n.t === "card" ? " ux-card" : "") + '" data-p="' + p + '"' + L + ' style="' + st + '">' + kids() + "</div>";
      }
      case "text": return '<div' + A + ' style="font-size:' + n.size + "px;font-weight:" + n.weight + ";text-align:" + n.align + ";line-height:1.35;" + (n.color ? "color:" + n.color + ";" : n.muted ? "color:var(--uxm);" : "") + 'white-space:pre-wrap">' + esc(n.text) + "</div>";
      case "button": return '<button' + A.replace('class="ux-n', 'class="ux-n ux-btn ' + n.variant + (n.full ? " full" : "")) + ">" + (n.icon ? "<span>" + esc(n.icon) + "</span>" : "") + esc(n.text || "Button") + "</button>";
      case "input": return '<div' + A.replace('class="ux-n', 'class="ux-n ux-in') + ">" + (n.label ? "<label>" + esc(n.label) + "</label>" : "") + "<div" + (n.kind === "textarea" ? ' style="min-height:84px"' : "") + "><span>" + (n.kind === "search" ? "🔍 " : "") + esc(n.placeholder || "") + "</span><span>" + (({ select: "▾", date: "📅", password: "👁" })[n.kind] || "") + "</span></div></div>";
      case "image": return '<div' + A.replace('class="ux-n', 'class="ux-n ux-img') + ' style="height:' + n.h + "px;border-radius:" + n.radius + 'px">🖼 ' + esc(n.label || "Image") + "</div>";
      case "icon": return '<div' + A + ' style="font-size:' + n.size + 'px;line-height:1">' + esc(n.name || "⭐") + "</div>";
      case "list": return '<div' + A + ">" + (n.items || []).map(function (it, i) { return '<div class="ux-li"' + (it.link ? ' data-l="' + esc(it.link) + '"' : "") + ">" + (it.icon ? '<div class="ic">' + esc(it.icon) + "</div>" : "") + '<div class="tx"><b>' + esc(it.title) + "</b>" + (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</div>" + (it.right ? '<div class="rt">' + esc(it.right) + "</div>" : "") + (it.link ? '<span style="color:var(--uxm)">›</span>' : "") + "</div>"; }).join("") + "</div>";
      case "nav": return '<div' + A.replace('class="ux-n', 'class="ux-n ux-nav') + ">" + (n.back ? '<span data-back="1" style="font-size:20px;cursor:pointer">←</span>' : "") + "<b>" + esc(n.title || "") + "</b>" + (n.actions || []).map(function (a) { return '<span style="font-size:19px">' + esc(a) + "</span>"; }).join("") + "</div>";
      case "tabbar": return '<div' + A.replace('class="ux-n', 'class="ux-n ux-tab') + ">" + (n.items || []).map(function (it, i) { return '<div class="' + (i === n.active ? "on" : "") + '"' + (it.link ? ' data-l="' + esc(it.link) + '"' : "") + "><i>" + esc(it.icon || "•") + "</i>" + esc(it.label) + "</div>"; }).join("") + "</div>";
      case "chips": return '<div' + A.replace('class="ux-n', 'class="ux-n ux-chips') + ">" + (n.items || []).map(function (c, i) { return '<span class="' + (i === n.active ? "on" : "") + '">' + esc(c) + "</span>"; }).join("") + "</div>";
      case "toggle": return '<div' + A.replace('class="ux-n', 'class="ux-n ux-tg') + "><span>" + esc(n.label) + '</span><i class="' + (n.on ? "on" : "") + '"></i></div>';
      case "check": return '<div' + A.replace('class="ux-n', 'class="ux-n ux-tg') + ' style="justify-content:flex-start"><span class="ux-ck ' + (n.on ? "on" : "") + '"></span><span>' + esc(n.label) + "</span></div>";
      case "divider": return '<hr' + A.replace('class="ux-n', 'class="ux-n ux-hr') + ">";
      case "spacer": return '<div' + A + ' style="height:' + n.h + 'px"></div>';
      case "stat": return '<div' + A.replace('class="ux-n', 'class="ux-n ux-stat') + "><small>" + esc(n.label) + "</small><b>" + esc(n.value) + "</b>" + (n.delta ? '<em class="' + (/^-|−/.test(n.delta) ? "neg" : "") + '">' + esc(n.delta) + "</em>" : "") + "</div>";
      case "progress": return '<div' + A + ">" + (n.label ? '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--uxm);margin-bottom:5px"><span>' + esc(n.label) + "</span><span>" + n.value + "%</span></div>" : "") + '<div class="ux-pg"><i style="width:' + n.value + '%"></i></div></div>';
      case "avatar": var ini = String(n.name || "?").split(" ").map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase(); return '<span' + A.replace('class="ux-n', 'class="ux-n ux-av') + ' style="width:' + n.size + "px;height:" + n.size + "px;font-size:" + Math.round(n.size * .38) + 'px">' + esc(ini) + "</span>";
      case "badge": return '<span' + A.replace('class="ux-n', 'class="ux-n ux-bd') + (n.color ? ' style="background:' + n.color + ';color:#fff"' : "") + ">" + esc(n.text) + "</span>";
      case "table": return '<div' + A + ' style="overflow:auto"><table class="ux-tb"><tr>' + (n.cols || []).map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr>" + (n.rows || []).map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table></div>";
      case "chart": return chart(n, p);
    }
    return "";
  }
  // split a screen into the fixed top bar, the scrolling body and the fixed tab bar
  function screen(d, s, mode) {
    var kids = s.children || [], top = [], body = [], bot = [];
    kids.forEach(function (n, i) { var h = node(n, String(i), d); if (n.t === "nav" && !body.length && !bot.length) top.push(h); else if (n.t === "tabbar") bot.push(h); else body.push(h); });
    var cls = "ux-screen " + (d.platform || "mobile") + (d.style === "wireframe" ? " wire" : "") + (mode ? " " + mode : "");
    return '<div class="' + cls + '" data-s="' + esc(s.id) + '" style="' + vars(d) + ";" + (s.bg ? "--uxbg:" + s.bg + ";" : "") + "width:" + W[d.platform || "mobile"] + "px;height:" + H[d.platform || "mobile"] + 'px">' + top.join("") + '<div class="ux-body">' + body.join("") + "</div>" + bot.join("") + "</div>";
  }
  function get(d, path, sid) { var s = d.screens.filter(function (x) { return x.id === sid; })[0]; if (!s) return null; var parts = String(path).split("."), n = { children: s.children }, par = null, idx = -1; for (var i = 0; i < parts.length; i++) { par = n; idx = +parts[i]; n = (n.children || [])[idx]; if (!n) return null; } return { node: n, parent: par, index: idx }; }
  // standalone clickable HTML prototype (export)
  function exportHtml(d) {
    var first = d.screens[0].id, all = d.screens.map(function (s) { return screen(d, s, "play"); }).join("");
    return "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + esc(d.title) + "</title><style>body{margin:0;background:#E9EBF5;display:flex;justify-content:center;align-items:flex-start;min-height:100vh;padding:20px 0}" + css(".ux-screen") + ".ux-screen{display:none;border-radius:" + (d.platform === "web" ? 10 : 36) + "px;box-shadow:0 12px 40px rgba(0,0,0,.25)}.ux-screen.cur{display:flex}@media(max-width:600px){body{padding:0}.ux-screen{border-radius:0;width:100vw!important;height:100vh!important;box-shadow:none}}</style></head><body>" + all +
      "<script>(function(){var h=[];function go(id,b){var c=document.querySelector('.ux-screen.cur');if(c&&!b)h.push(c.getAttribute('data-s'));[].forEach.call(document.querySelectorAll('.ux-screen'),function(s){s.classList.toggle('cur',s.getAttribute('data-s')===id)});}go('" + esc(first) + "');document.addEventListener('click',function(e){var b=e.target.closest('[data-back]');if(b&&h.length){go(h.pop(),1);return}var l=e.target.closest('[data-l]');if(l)go(l.getAttribute('data-l'))})})()<\/script></body></html>";
  }
  root.UXR = { css: css, screen: screen, get: get, exportHtml: exportHtml, W: W, H: H, esc: esc };
})(typeof window !== "undefined" ? window : this);
