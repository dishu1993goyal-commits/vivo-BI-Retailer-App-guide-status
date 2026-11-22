/* vivo BI creative engine — offer newsletters, posters, social posts and status creatives in the style of the BI promotion mailers.
   One content spec (hero, stats, benefits, steps, screens, callout, CTA…) → HTML in any of 4 formats × 7 themes.
   Text is the person's (or the AI's, checked); pictures are the person's own. Exported as PNG / JPG / PDF by the page. */
(function () {
  "use strict";
  var FONT = "'Inter','Roboto','Segoe UI',Arial,sans-serif", SERIF = "Georgia,'Times New Roman',serif";
  var TH = {
    magenta: { name: "Magenta pop", hero: "linear-gradient(135deg,#FF6B4A 0%,#FF2D8F 55%,#8E3BFF 100%)", ink: "#fff", acc: "#FFE14D", tag: "#FF4E6A", chip: "rgba(255,255,255,.22)", sec: "#E8335F", head: "#2A0F2E", num: "#E8335F", cta: "linear-gradient(135deg,#FF6B4A,#FF2D8F 60%,#8E3BFF)", soft: "#FFF1F5", call: "#FFE9E0" },
    royal: { name: "Royal blue", hero: "linear-gradient(160deg,#3D5BFF 0%,#2F45E8 60%,#5B3CF0 100%)", ink: "#fff", acc: "#FFE14D", tag: "#1B2A8C", chip: "rgba(255,255,255,.2)", sec: "#3F5BFF", head: "#101533", num: "#3F5BFF", cta: "linear-gradient(135deg,#3D5BFF,#5B3CF0)", soft: "#EEF1FF", call: "#E6EBFF" },
    sunset: { name: "Sunset orange", hero: "linear-gradient(160deg,#FF9A3D 0%,#FF6A3D 45%,#FF4E8A 100%)", ink: "#fff", acc: "#3A1408", tag: "#C2410C", chip: "rgba(255,255,255,.25)", sec: "#EA580C", head: "#2B1206", num: "#F97316", cta: "linear-gradient(135deg,#FF9A3D,#FF4E8A)", soft: "#FFF4EC", call: "#FFEDE0", stat: ["#F97316", "#3A1408", "#F97316"] },
    midnight: { name: "Midnight neon", hero: "linear-gradient(160deg,#1B1446 0%,#24185C 55%,#2E1D73 100%)", ink: "#fff", acc: "#C6F432", tag: "#C6F432", tagInk: "#1B1446", chip: "rgba(255,255,255,.12)", sec: "#7C5CFF", head: "#120E33", num: "#1B1446", numInk: "#C6F432", cta: "linear-gradient(135deg,#1B1446,#2E1D73)", soft: "#F1EEFF", call: "#1B1446", callInk: "#fff", darkSteps: true },
    fresh: { name: "Fresh green", hero: "linear-gradient(160deg,#EAF8EE 0%,#D3F2DC 100%)", ink: "#0F3D2A", acc: "#1F8A43", tag: "#1F6B3A", chip: "#fff", chipInk: "#0F3D2A", sec: "#1F8A43", head: "#0F3D2A", num: "#2E9D4A", cta: "linear-gradient(135deg,#1F8A43,#7CC242)", soft: "#EAF8EE", call: "#E3F5E8", card: "#F0FAF2" },
    corporate: { name: "Corporate maroon", hero: "linear-gradient(160deg,#7A1A2A 0%,#5A0F1D 60%,#3A0A14 100%)", ink: "#fff", acc: "#F5C04A", tag: "#3A0A14", chip: "rgba(255,255,255,.14)", sec: "#8A1C2C", head: "#3A0A14", num: "#8A1C2C", cta: "linear-gradient(135deg,#7A1A2A,#3A0A14)", soft: "#FBF1F2", call: "#F9EDE4", serif: true, darkBen: "#3A0A14" },
    vivo: { name: "vivo blue", hero: "linear-gradient(160deg,#415FFF 0%,#3F5BFF 50%,#7B61FF 100%)", ink: "#fff", acc: "#9DF0FF", tag: "#14205B", chip: "rgba(255,255,255,.2)", sec: "#3F5BFF", head: "#14205B", num: "#14205B", cta: "linear-gradient(135deg,#14205B,#3F5BFF)", soft: "#EEF1FF", call: "#EEF1FF" }
  };
  var FMT = {
    newsletter: { name: "Newsletter / mailer", w: 1080, h: 0, hint: "Long page for e-mail, WhatsApp and the Retailer App" },
    post: { name: "Square post", w: 1080, h: 1080, hint: "Instagram / Facebook / WhatsApp" },
    story: { name: "Story / status", w: 1080, h: 1920, hint: "WhatsApp status, Instagram story" },
    poster: { name: "A4 poster", w: 1240, h: 1754, hint: "Print for the store" }
  };
  var SEQ = 0;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function L(a) { return (a || []).filter(function (x) { return x && (typeof x === "string" ? x.trim() : (x.title || x.text || x.value || x.img)); }); }

  function css(t, F) {
    var hf = t.serif ? SERIF : FONT;
    return "<style>.cr{font-family:" + FONT + ";color:" + t.head + ";background:#fff;width:" + F.w + "px;" + (F.h ? "height:" + F.h + "px;overflow:hidden;display:flex;flex-direction:column;" : "") + "box-sizing:border-box;position:relative}" +
      ".cr *{box-sizing:border-box}.cr .hero{background:" + t.hero + ";color:" + t.ink + ";padding:64px 64px 56px;position:relative;overflow:hidden}" +
      ".cr .hero:after{content:'';position:absolute;right:-180px;top:-160px;width:520px;height:520px;border-radius:50%;background:rgba(255,255,255,.08)}" +
      ".cr .brand{font:800 44px/1 " + FONT + ";letter-spacing:-1.5px;opacity:.96}" +
      ".cr .tag{display:inline-block;margin-top:22px;background:" + t.tag + ";color:" + (t.tagInk || "#fff") + ";font:800 20px/1 " + FONT + ";letter-spacing:2.4px;padding:11px 20px;border-radius:99px;text-transform:uppercase}" +
      ".cr h1{font:800 110px/1.0 " + hf + ";letter-spacing:-3px;margin:26px 0 0}.cr h1 .a{display:block;color:" + t.acc + "}" +
      ".cr .sub{font:400 32px/1.4 " + FONT + ";margin-top:26px;opacity:.95;max-width:900px}" +
      ".cr .chips{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}.cr .chips span{background:" + t.chip + ";color:" + (t.chipInk || t.ink) + ";border:1px solid rgba(255,255,255,.35);font:600 24px/1 " + FONT + ";padding:14px 20px;border-radius:99px}" +
      ".cr .himg{margin-top:40px;background:#fff;border-radius:28px;padding:18px;box-shadow:0 18px 40px rgba(0,0,0,.18);position:relative;z-index:1}.cr .himg img{display:block;width:100%;border-radius:18px;object-fit:cover}" +
      ".cr .sec{padding:56px 64px 0}.cr .k{font:800 20px/1 " + FONT + ";letter-spacing:3px;color:" + t.sec + ";text-transform:uppercase}.cr h2{font:800 54px/1.1 " + hf + ";margin:12px 0 28px;color:" + t.head + ";letter-spacing:-1px}" +
      ".cr .stats{display:grid;gap:16px;padding:44px 64px 0}.cr .stat{border-radius:24px;padding:26px 18px;text-align:center;color:#fff}.cr .stat b{display:block;font:800 72px/1 " + FONT + "}.cr .stat span{display:block;font:600 22px/1.3 " + FONT + ";margin-top:10px;opacity:.95}" +
      ".cr .ben{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.cr .bc{background:" + (t.card || "#fff") + ";border:1px solid #ECEEF5;border-radius:22px;padding:26px 22px;box-shadow:0 6px 18px rgba(20,24,51,.06)}" +
      ".cr .bc i{font-style:normal;font-size:50px;display:block}.cr .bc b{display:block;font:700 28px/1.2 " + FONT + ";margin-top:14px;color:" + t.head + "}.cr .bc span{display:block;font:400 22px/1.4 " + FONT + ";color:#5B6075;margin-top:8px}" +
      ".cr .bendark{background:" + (t.darkBen || "#000") + ";margin:0 -64px;padding:44px 40px}.cr .bendark .bc{background:transparent;border:0;box-shadow:none;text-align:center;border-right:1px solid rgba(255,255,255,.12);border-radius:0}.cr .bendark .bc:nth-child(3n){border-right:0}.cr .bendark .bc b{color:" + t.acc + "}.cr .bendark .bc span{color:rgba(255,255,255,.8)}" +
      ".cr .st{display:flex;align-items:stretch;background:#fff;border:1px solid #ECEEF5;border-radius:22px;margin-bottom:16px;overflow:hidden;box-shadow:0 6px 18px rgba(20,24,51,.06)}" +
      ".cr .st .n{flex:0 0 110px;background:" + t.num + ";color:" + (t.numInk || "#fff") + ";font:800 50px/1 " + FONT + ";display:flex;align-items:center;justify-content:center;clip-path:polygon(0 0,82% 0,100% 50%,82% 100%,0 100%)}" +
      ".cr .st .tx{flex:1;padding:24px 22px}.cr .st b{display:block;font:700 30px/1.2 " + FONT + ";color:" + t.head + "}.cr .st span{display:block;font:400 23px/1.35 " + FONT + ";color:#5B6075;margin-top:6px}.cr .st i{font-style:normal;font-size:46px;align-self:center;padding:0 26px}" +
      ".cr .stg{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.cr .stg .c{background:" + t.head + ";border-radius:22px;padding:26px;color:#fff;position:relative}.cr .stg .c em{font:800 56px/1 " + FONT + ";font-style:normal;color:" + t.acc + "}.cr .stg .c b{display:block;font:700 28px/1.2 " + FONT + ";margin-top:14px}.cr .stg .c span{display:block;font:400 22px/1.35 " + FONT + ";opacity:.75;margin-top:6px}.cr .stg .c i{position:absolute;right:22px;top:22px;font-style:normal;font-size:40px}" +
      ".cr .bn{margin:56px 64px 0;border-radius:28px;overflow:hidden;box-shadow:0 14px 34px rgba(20,24,51,.14)}.cr .bn img{display:block;width:100%}" +
      ".cr .scr{display:flex;justify-content:center;gap:26px;align-items:flex-end}.cr .ph{width:260px;text-align:center}.cr .ph div{border:10px solid #15172A;border-radius:38px;overflow:hidden;background:#15172A;box-shadow:0 14px 30px rgba(20,24,51,.2)}.cr .ph:nth-child(2) div{transform:translateY(-24px)}.cr .ph img{display:block;width:100%;aspect-ratio:9/19.5;object-fit:cover;object-position:top}.cr .ph span{display:block;font:600 22px/1.2 " + FONT + ";margin-top:14px;color:#5B6075}" +
      ".cr .elig{display:flex;flex-wrap:wrap;gap:14px}.cr .elig span{border:2px solid " + t.num + ";color:" + t.head + ";border-radius:16px;padding:16px 20px;font:600 24px/1.2 " + FONT + "}" +
      ".cr .call{display:flex;gap:20px;align-items:center;margin:48px 64px 0;background:" + t.call + ";color:" + (t.callInk || t.head) + ";border-radius:22px;padding:26px 30px}.cr .call i{font-style:normal;font-size:46px}.cr .call b{display:block;font:700 28px/1.2 " + FONT + "}.cr .call span{display:block;font:400 22px/1.35 " + FONT + ";opacity:.8;margin-top:4px}" +
      ".cr .cta{background:" + t.cta + ";color:#fff;text-align:center;padding:60px 64px 46px;margin-top:56px}.cr .cta .brand{font-size:38px}.cr .cta h3{font:800 50px/1.15 " + hf + ";margin:18px 0 0}.cr .cta p{font:400 25px/1.4 " + FONT + ";opacity:.92;margin:14px 0 0}.cr .cta .chips{justify-content:center}.cr .tnc{font:400 18px/1.4 " + FONT + ";opacity:.75;margin-top:26px}" +
      ".cr>*{flex-shrink:0}" + (F.h ? ".cr .hero{flex:1 0 auto;display:flex;flex-direction:column}.cr .hero .himg{margin-top:auto;align-self:stretch}.cr .hero .chips{margin-bottom:34px}.cr .hero>*{align-self:flex-start}.cr .hero>.himg{align-self:stretch}.cr .cta{margin-top:0!important}.cr .sec{padding-bottom:44px}" : "") + "</style>";
  }
  function hero(s, t, o) {
    o = o || {};
    var h = '<div class="hero"' + (o.pad ? ' style="padding:' + o.pad + '"' : "") + '><div class="brand">' + esc(s.brand || "vivo") + "</div>" + (s.tag ? '<div class="tag">' + esc(s.tag) + "</div>" : "") +
      '<h1 style="font-size:' + (o.h1 || 110) + 'px">' + esc(s.h1 || "") + (s.h2 ? '<span class="a">' + esc(s.h2) + "</span>" : "") + "</h1>" +
      (s.sub && !o.noSub ? '<div class="sub" style="font-size:' + (o.sub || 32) + 'px">' + esc(s.sub) + "</div>" : "") +
      (L(s.chips).length && o.chips !== 0 ? '<div class="chips">' + L(s.chips).slice(0, o.chips || 4).map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + "</div>" : "") +
      (o.img ? '<div class="himg"><img src="' + o.img + '" style="max-height:' + (o.imgH || 560) + 'px"></div>' : "") + "</div>";
    return h;
  }
  function stats(s, t, n) {
    var a = L(s.stats).slice(0, n || 3); if (!a.length) return "";
    var cols = t.stat || [t.num, t.head, t.num];
    return '<div class="stats" style="grid-template-columns:repeat(' + a.length + ',1fr)">' + a.map(function (q, i) { return '<div class="stat" style="background:' + cols[i % cols.length] + '"><b>' + esc(q.value) + "</b><span>" + esc(q.label) + "</span></div>"; }).join("") + "</div>";
  }
  function head(sec) { return (sec.kicker ? '<div class="k">' + esc(sec.kicker) + "</div>" : "") + (sec.title ? "<h2>" + esc(sec.title) + "</h2>" : ""); }
  function benefits(s, t, n, cols) {
    var b = s.benefits || {}, a = L(b.items).slice(0, n || 6); if (!a.length) return "";
    var dark = t.darkBen;
    return '<div class="sec">' + head(b) + '<div class="ben' + (dark ? " bendark" : "") + '" style="grid-template-columns:repeat(' + (cols || (a.length === 4 ? 2 : 3)) + ',1fr)">' + a.map(function (q) { return '<div class="bc"><i>' + esc(q.emoji || "✨") + "</i><b>" + esc(q.title) + "</b>" + (q.text ? "<span>" + esc(q.text) + "</span>" : "") + "</div>"; }).join("") + "</div></div>";
  }
  function steps(s, t, n, grid) {
    var b = s.steps || {}, a = L(b.items).slice(0, n || 8); if (!a.length) return "";
    if (grid || t.darkSteps) return '<div class="sec">' + head(b) + '<div class="stg">' + a.map(function (q, i) { return '<div class="c"><em>' + String(i + 1).padStart(2, "0") + "</em>" + (q.emoji ? "<i>" + esc(q.emoji) + "</i>" : "") + "<b>" + esc(q.title) + "</b>" + (q.text ? "<span>" + esc(q.text) + "</span>" : "") + "</div>"; }).join("") + "</div></div>";
    return '<div class="sec">' + head(b) + a.map(function (q, i) { return '<div class="st"><div class="n">' + (i + 1) + '</div><div class="tx"><b>' + esc(q.title) + "</b>" + (q.text ? "<span>" + esc(q.text) + "</span>" : "") + "</div>" + (q.emoji ? "<i>" + esc(q.emoji) + "</i>" : "") + "</div>"; }).join("") + "</div>";
  }
  function screens(s, IM) {
    var b = s.screens || {}, a = L(b.items).filter(function (q) { return q.img && IM[q.img]; }).slice(0, 3); if (!a.length) return "";
    return '<div class="sec">' + head(b) + '<div class="scr">' + a.map(function (q) { return '<div class="ph"><div><img src="' + IM[q.img].url + '"></div>' + (q.label ? "<span>" + esc(q.label) + "</span>" : "") + "</div>"; }).join("") + "</div></div>";
  }
  function elig(s) { var b = s.eligibility || {}, a = L(b.items); if (!a.length) return ""; return '<div class="sec">' + head(b) + '<div class="elig">' + a.slice(0, 6).map(function (x) { return "<span>✔ " + esc(x) + "</span>"; }).join("") + "</div></div>"; }
  function callout(s) { var c = s.callout; if (!c || !c.title) return ""; return '<div class="call"><i>' + esc(c.emoji || "💡") + "</i><div><b>" + esc(c.title) + "</b>" + (c.text ? "<span>" + esc(c.text) + "</span>" : "") + "</div></div>"; }
  function cta(s, o) { o = o || {}; var c = s.cta || {}; return '<div class="cta"' + (o.style ? ' style="' + o.style + '"' : "") + '><div class="brand">' + esc(s.brand || "vivo") + "</div>" + (c.title ? "<h3" + (o.h3 ? ' style="font-size:' + o.h3 + 'px"' : "") + ">" + esc(c.title) + "</h3>" : "") + (c.sub && !o.noSub ? "<p>" + esc(c.sub) + "</p>" : "") + (L(c.chips).length && !o.noChips ? '<div class="chips">' + L(c.chips).slice(0, 3).map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div>" : "") + (s.tnc ? '<div class="tnc">' + esc(s.tnc) + "</div>" : "") + "</div>"; }
  function banner(s, IM) { return s.banner && IM[s.banner] ? '<div class="bn"><img src="' + IM[s.banner].url + '"></div>' : ""; }

  function render(s, fmt, theme, IM, lv) {
    IM = IM || {}; lv = lv || 0; var t = TH[theme || s.theme] || TH.magenta, F = FMT[fmt] || FMT.newsletter, img = s.hero && IM[s.hero] ? IM[s.hero].url : "";
    var cls = "cr" + (++SEQ), o = [css(t, F).replace(/\.cr\b/g, "." + cls), '<div class="' + cls + '">'];
    if (F === FMT.newsletter) {
      o.push(hero(s, t, { img: img }), stats(s, t), benefits(s, t), steps(s, t), banner(s, IM), screens(s, IM), elig(s), callout(s), cta(s));
    } else if (F === FMT.post) {   // levels make it fit: smaller picture → no subtitle → no CTA chips → no picture
      o.push(hero(s, t, { pad: "50px 60px 36px", h1: img && lv < 4 ? 80 : 104, sub: 27, chips: 3, img: lv < 4 ? img : "", imgH: [300, 240, 200, 170][Math.min(3, lv)], noSub: lv >= 2 }));
      o.push(cta(s, { style: "padding:28px 60px 26px;margin-top:0", h3: 38, noSub: true, noChips: lv >= 3 }));
    } else if (F === FMT.story) {
      o.push(hero(s, t, { pad: lv ? "70px 64px 50px" : "90px 64px 56px", h1: lv ? 100 : 116, sub: lv ? 28 : 32, img: img, imgH: lv >= 3 ? 380 : 520, noSub: lv === 2 || lv === 3 || lv >= 5, chips: lv === 3 ? 0 : 4 }));
      var ben = L((s.benefits || {}).items).length;
      if (lv < 4) o.push(ben ? benefits(s, t, 3, 3) : steps(s, t, 3));
      o.push(cta(s, { style: "margin-top:40px", h3: 46 }));
    } else {   // A4 poster
      var hasB = L((s.benefits || {}).items).length;
      o.push(hero(s, t, { pad: lv >= 3 ? "54px 70px 36px" : "64px 70px 46px", h1: lv >= 2 ? 96 : 112, img: img, imgH: [380, 380, 300, 240, 380, 380][lv], noSub: lv >= 2 && lv < 4, chips: lv === 3 ? 0 : 4 }), lv >= 1 ? "" : stats(s, t), lv >= 4 ? "" : hasB ? benefits(s, t, 3, 3) : steps(s, t, 4, true));
      o.push(cta(s, { style: "padding:44px 64px 36px" }));
    }
    o.push("</div>");
    return o.join("");
  }
  // draw into a host element; fixed sizes step down until everything fits (measured after the pictures load). Returns a Promise of the root element.
  function mount(host, s, fmt, theme, IM) {
    var F = FMT[fmt] || FMT.newsletter;
    var loaded = function (el) { return Promise.all([].map.call(el.querySelectorAll("img"), function (im) { return im.complete && im.naturalWidth ? 1 : new Promise(function (r) { im.onload = im.onerror = r; setTimeout(r, 4000); }); })); };
    var go = function (lv) {
      host.innerHTML = render(s, fmt, theme, IM, lv); var el = host.querySelector("div[class^=cr]");
      return loaded(el).then(function () { if (!F.h || lv >= 5 || el.scrollHeight <= el.clientHeight * 1.003 + 1) return el; return go(lv + 1); });
    };
    return go(0);
  }
  function texts(s) {   // every visible word, for the numbers check
    var a = [s.tag, s.h1, s.h2, s.sub, s.tnc].concat(L(s.chips), L(s.stats).map(function (q) { return q.value + " " + q.label; }));
    ["benefits", "steps"].forEach(function (k) { var b = s[k] || {}; a.push(b.title); L(b.items).forEach(function (q) { a.push(q.title, q.text); }); });
    if (s.eligibility) a = a.concat(L(s.eligibility.items));
    if (s.callout) a.push(s.callout.title, s.callout.text);
    if (s.cta) a = a.concat([s.cta.title, s.cta.sub], L(s.cta.chips));
    return a.filter(Boolean);
  }
  var SCHEMA = '{"theme":"magenta|royal|sunset|midnight|fresh|corporate|vivo","brand":"vivo","tag":"FOR STUDENTS (2-3 words)","h1":"first headline line (1-2 words)","h2":"second line in the accent colour (1-3 words)","sub":"one sentence, max 18 words","chips":["emoji + 2-3 words", "… (3)"],' +
    '"stats":[{"value":"6","label":"Easy steps"}] (0-3, only real numbers),"benefits":{"kicker":"BENEFITS","title":"Why you will love it","items":[{"emoji":"🎓","title":"2-4 words","text":"max 9 words"}] (3 or 6)},' +
    '"steps":{"kicker":"HOW TO AVAIL","title":"Get your offer in N easy steps","items":[{"title":"2-4 words","text":"max 9 words","emoji":"📱"}] (3-6)},"screens":{"kicker":"INSIDE THE APP","title":"What you will see"},' +
    '"eligibility":{"kicker":"ELIGIBILITY","title":"Who can avail","items":["…"]} (optional),"callout":{"emoji":"💼","title":"cross-sell line","text":"…"} (optional),"cta":{"title":"Visit your nearest vivo store today","sub":"one line","chips":["📲 Share on WhatsApp"]},"tnc":"*T&C apply. …"}';
  window.BICREATIVE = { TH: TH, FMT: FMT, render: render, mount: mount, texts: texts, SCHEMA: SCHEMA };
})();
