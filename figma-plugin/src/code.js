// vivo BI · UI import — builds the screens of a BI UI/UX studio design as Figma frames (auto-layout, text, prototype links).
figma.showUI(__html__, { width: 340, height: 300 });
var W = { mobile: 390, tablet: 834, web: 1280 }, H = { mobile: 844, tablet: 1112, web: 800 };
function rgb(hex, a) { hex = String(hex || "#000000").replace("#", ""); if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join(""); var n = parseInt(hex.slice(0, 6), 16); return { type: "SOLID", color: { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 }, opacity: a == null ? 1 : a }; }
function mix(hex, a) { return rgb(hex, a); }
var FONT = "Inter", STY = { 300: "Light", 400: "Regular", 500: "Medium", 600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black" };
async function fonts(fam) {
  var ok = true;
  for (var w of [400, 500, 600, 700]) { try { await figma.loadFontAsync({ family: fam, style: STY[w] }); } catch (e) { ok = false; } }
  if (!ok && fam !== "Inter") return fonts("Inter");
  FONT = fam; try { await figma.loadFontAsync({ family: FONT, style: "Extra Bold" }); } catch (e) { } try { await figma.loadFontAsync({ family: FONT, style: "Light" }); } catch (e) { }
}
function fontFor(w) { var s = STY[Math.round((w || 400) / 100) * 100] || "Regular"; return { family: FONT, style: ["Light", "Regular", "Medium", "Semi Bold", "Bold", "Extra Bold"].indexOf(s) >= 0 ? s : "Regular" }; }
var T, LINKS = [], BACKS = [];
function box(name, dir, o) {
  var f = figma.createFrame(); f.name = name; f.layoutMode = dir === "row" ? "HORIZONTAL" : "VERTICAL"; f.fills = []; f.clipsContent = false;
  f.itemSpacing = o && o.gap != null ? o.gap : 0; var p = o && o.pad || 0; f.paddingLeft = f.paddingRight = f.paddingTop = f.paddingBottom = p;
  f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "AUTO"; return f;
}
function text(str, size, weight, color, align) {
  var t = figma.createText(); t.fontName = fontFor(weight); t.characters = String(str == null ? "" : str); t.fontSize = size || 14; t.fills = [rgb(color || T.text)];
  if (align) t.textAlignHorizontal = { left: "LEFT", center: "CENTER", right: "RIGHT" }[align] || "LEFT"; return t;
}
function fill(n) { try { n.layoutSizingHorizontal = "FILL"; } catch (e) { try { n.layoutAlign = "STRETCH"; } catch (e2) { } } if (n.type === "TEXT") try { n.textAutoResize = "HEIGHT"; } catch (e) { } }
function add(parent, n, stretch) { parent.appendChild(n); if (stretch !== false) fill(n); return n; }
function build(n, parent) {
  var f, t = n.t;
  if (t === "col" || t === "row" || t === "card" || t === "grid") {
    f = box(t === "card" ? "Card" : t === "row" ? "Row" : t === "grid" ? "Grid" : "Column", t === "row" ? "row" : "col", { gap: n.gap, pad: n.pad });
    if (t === "grid") { f.layoutMode = "HORIZONTAL"; f.layoutWrap = "WRAP"; f.counterAxisSpacing = n.gap; }
    if (t === "card") { f.fills = [rgb(T.surface)]; f.cornerRadius = T.radius; f.effects = [{ type: "DROP_SHADOW", color: { r: .08, g: .1, b: .2, a: .08 }, offset: { x: 0, y: 2 }, radius: 10, spread: 0, visible: true, blendMode: "NORMAL" }]; }
    if (n.bg) f.fills = [rgb(n.bg)]; if (n.radius != null) f.cornerRadius = n.radius; if (n.border) f.strokes = [rgb(n.border)];
    if (t !== "grid") { f.counterAxisAlignItems = { start: "MIN", center: "CENTER", end: "MAX", stretch: "MIN" }[n.align] || "MIN"; f.primaryAxisAlignItems = { start: "MIN", center: "CENTER", end: "MAX", between: "SPACE_BETWEEN" }[n.justify] || "MIN"; }
    add(parent, f, true);
    (n.children || []).forEach(function (c) { var k = build(c, f); if (k && t === "row") { try { k.layoutSizingHorizontal = c.w === "fill" || c.t === "text" || c.t === "col" || c.t === "card" ? "FILL" : "HUG"; } catch (e) { } } if (k && t === "grid") { try { k.layoutSizingHorizontal = "FIXED"; k.resize(Math.max(40, ((parent.width || 360) - 28 - n.gap * ((n.cols || 2) - 1)) / (n.cols || 2)), k.height); } catch (e) { } } if (k && t !== "row" && t !== "grid" && n.align !== "stretch" && (c.t === "button" || c.t === "badge" || c.t === "avatar" || c.t === "icon")) { try { k.layoutSizingHorizontal = "HUG"; } catch (e) { } } });
    if (n.h) { try { f.minHeight = n.h; } catch (e) { } }
  } else if (t === "text") { f = add(parent, text(n.text, n.size, n.weight, n.color || (n.muted ? T.muted : T.text), n.align)); }
  else if (t === "button") {
    f = box("Button", "row", { gap: 6 }); f.paddingLeft = f.paddingRight = 16; f.paddingTop = f.paddingBottom = 12; f.cornerRadius = Math.max(0, T.radius - 2); f.primaryAxisAlignItems = "CENTER"; f.counterAxisAlignItems = "CENTER"; f.minHeight = 44;
    var c = n.variant === "danger" ? "#D93B3B" : T.primary;
    if (n.variant === "primary" || n.variant === "danger") f.fills = [rgb(c)]; else if (n.variant === "secondary") { f.strokes = [rgb(c)]; f.strokeWeight = 1.5; }
    if (n.icon) f.appendChild(text(n.icon, 14, 600, n.variant === "primary" || n.variant === "danger" ? "#FFFFFF" : c));
    f.appendChild(text(n.text || "Button", 14, 600, n.variant === "primary" || n.variant === "danger" ? "#FFFFFF" : c));
    add(parent, f, !!n.full || parent.layoutMode === "VERTICAL"); if (!n.full && parent.layoutMode === "VERTICAL") { try { f.layoutSizingHorizontal = "HUG"; } catch (e) { } }
  } else if (t === "input") {
    f = box("Input", "col", { gap: 4 }); add(parent, f);
    if (n.label) add(f, text(n.label, 12, 600, T.muted));
    var fl = box("Field", "row", { pad: 12 }); fl.fills = [rgb(T.surface)]; fl.strokes = [rgb("#000000", .12)]; fl.strokeWeight = 1.5; fl.cornerRadius = Math.max(0, T.radius - 4); fl.minHeight = n.kind === "textarea" ? 84 : 44; fl.primaryAxisAlignItems = "SPACE_BETWEEN";
    add(f, fl); add(fl, text((n.kind === "search" ? "🔍 " : "") + (n.placeholder || ""), 14, 400, T.muted), false); var ic = { select: "▾", date: "📅", password: "👁" }[n.kind]; if (ic) fl.appendChild(text(ic, 14, 400, T.muted));
  } else if (t === "image") { f = figma.createRectangle(); f.name = "Image · " + (n.label || ""); f.fills = [rgb("#000000", .07)]; f.cornerRadius = n.radius || 0; parent.appendChild(f); fill(f); f.resize(Math.max(40, f.width || 300), n.h || 160); try { f.layoutSizingVertical = "FIXED"; } catch (e) { } }
  else if (t === "icon") { f = add(parent, text(n.name || "⭐", n.size || 24, 400), false); }
  else if (t === "nav") {
    f = box("Top bar", "row", { gap: 10, pad: 14 }); f.fills = [rgb(T.surface)]; f.counterAxisAlignItems = "CENTER"; f.minHeight = 52; add(parent, f);
    if (n.back) { var bk = text("←", 20, 400); f.appendChild(bk); BACKS.push(bk); }
    var tt = text(n.title || "", 17, 700); f.appendChild(tt); try { tt.layoutSizingHorizontal = "FILL"; } catch (e) { }
    (n.actions || []).forEach(function (a) { f.appendChild(text(a, 19, 400)); });
  } else if (t === "tabbar") {
    f = box("Tab bar", "row", { pad: 6 }); f.fills = [rgb(T.surface)]; f.paddingBottom = 10; add(parent, f);
    (n.items || []).forEach(function (it, i) { var c2 = box(it.label || "Tab", "col", { gap: 2 }); c2.counterAxisAlignItems = "CENTER"; f.appendChild(c2); try { c2.layoutSizingHorizontal = "FILL"; } catch (e) { } c2.appendChild(text(it.icon || "•", 20, 400)); c2.appendChild(text(it.label || "", 11, i === n.active ? 700 : 400, i === n.active ? T.primary : T.muted)); if (it.link) LINKS.push([c2, it.link]); });
  } else if (t === "list") {
    f = box("List", "col", {}); add(parent, f);
    (n.items || []).forEach(function (it) { var r = box(it.title, "row", { gap: 12 }); r.paddingTop = r.paddingBottom = 12; r.counterAxisAlignItems = "CENTER"; add(f, r); if (it.icon) { var ic2 = box("icon", "row", {}); ic2.resize(38, 38); ic2.primaryAxisSizingMode = "FIXED"; ic2.counterAxisSizingMode = "FIXED"; ic2.primaryAxisAlignItems = "CENTER"; ic2.counterAxisAlignItems = "CENTER"; ic2.cornerRadius = 12; ic2.fills = [rgb(T.primary, .12)]; ic2.appendChild(text(it.icon, 18, 400)); r.appendChild(ic2); } var tx = box("text", "col", { gap: 2 }); r.appendChild(tx); try { tx.layoutSizingHorizontal = "FILL"; } catch (e) { } add(tx, text(it.title, 14, 600)); if (it.sub) add(tx, text(it.sub, 12, 400, T.muted)); if (it.right) r.appendChild(text(it.right, 13, 600)); if (it.link) { r.appendChild(text("›", 16, 400, T.muted)); LINKS.push([r, it.link]); } });
  } else if (t === "chips") { f = box("Chips", "row", { gap: 6 }); add(parent, f); (n.items || []).forEach(function (c3, i) { var ch = box(c3, "row", {}); ch.paddingLeft = ch.paddingRight = 12; ch.paddingTop = ch.paddingBottom = 7; ch.cornerRadius = 99; ch.fills = [rgb(i === n.active ? T.primary : T.surface)]; if (i !== n.active) ch.strokes = [rgb("#000000", .1)]; ch.appendChild(text(c3, 12.5, 500, i === n.active ? "#FFFFFF" : T.text)); f.appendChild(ch); }); }
  else if (t === "toggle" || t === "check") { f = box(t, "row", { gap: 10 }); f.counterAxisAlignItems = "CENTER"; f.primaryAxisAlignItems = t === "toggle" ? "SPACE_BETWEEN" : "MIN"; add(parent, f); var k2 = figma.createRectangle(); k2.resize(t === "toggle" ? 42 : 20, t === "toggle" ? 24 : 20); k2.cornerRadius = t === "toggle" ? 12 : 6; k2.fills = [rgb(n.on ? T.primary : "#C9CCDA")]; if (t === "check") f.appendChild(k2); f.appendChild(text(n.label, 14, 400)); if (t === "toggle") f.appendChild(k2); }
  else if (t === "divider") { f = figma.createRectangle(); f.resize(300, 1); f.fills = [rgb("#000000", .08)]; parent.appendChild(f); fill(f); }
  else if (t === "spacer") { f = figma.createFrame(); f.fills = []; f.resize(10, n.h || 16); parent.appendChild(f); }
  else if (t === "stat") { f = box("Stat", "col", { gap: 2, pad: 12 }); f.fills = [rgb(T.surface)]; f.cornerRadius = T.radius; add(parent, f); add(f, text(n.label, 12, 400, T.muted)); add(f, text(n.value, 22, 700)); if (n.delta) add(f, text(n.delta, 12, 600, /^-|−/.test(n.delta) ? "#D93B3B" : "#1E9E61")); }
  else if (t === "progress") { f = box("Progress", "col", { gap: 5 }); add(parent, f); if (n.label) add(f, text(n.label + " · " + n.value + "%", 12, 400, T.muted)); var tr = box("track", "row", {}); tr.fills = [rgb("#000000", .08)]; tr.cornerRadius = 9; tr.resize(300, 8); add(f, tr); tr.primaryAxisSizingMode = "FIXED"; tr.counterAxisSizingMode = "FIXED"; try { tr.layoutSizingVertical = "FIXED"; } catch (e) { } var bar = figma.createRectangle(); bar.fills = [rgb(T.primary)]; bar.cornerRadius = 9; tr.appendChild(bar); bar.resize(Math.max(1, 300 * n.value / 100), 8); }
  else if (t === "avatar") { f = figma.createEllipse(); f.resize(n.size || 40, n.size || 40); f.fills = [rgb(T.primary, .18)]; f.name = "Avatar · " + (n.name || ""); parent.appendChild(f); }
  else if (t === "badge") { f = box("Badge", "row", {}); f.paddingLeft = f.paddingRight = 9; f.paddingTop = f.paddingBottom = 3; f.cornerRadius = 99; f.fills = [rgb(n.color || T.primary, n.color ? 1 : .14)]; f.appendChild(text(n.text, 11, 700, n.color ? "#FFFFFF" : T.primary)); parent.appendChild(f); }
  else if (t === "table") { f = box("Table", "col", {}); add(parent, f); [n.cols].concat(n.rows || []).forEach(function (r, ri) { var rr = box("row", "row", { gap: 6 }); rr.paddingTop = rr.paddingBottom = 7; add(f, rr); (r || []).forEach(function (c4) { var cell = text(c4, 12.5, ri ? 400 : 600, ri ? T.text : T.muted); rr.appendChild(cell); try { cell.layoutSizingHorizontal = "FILL"; } catch (e) { } }); }); }
  else if (t === "chart") { f = box("Chart · " + (n.label || n.kind), "col", { gap: 4 }); add(parent, f); if (n.label) add(f, text(n.label, 12, 400, T.muted)); var area = box("bars", "row", { gap: 6 }); area.counterAxisAlignItems = "MAX"; add(f, area); var mx = Math.max.apply(null, n.values.concat([1])); n.values.forEach(function (v) { var b = figma.createRectangle(); b.cornerRadius = 4; b.fills = [rgb(T.primary)]; b.resize(18, Math.max(2, v / mx * ((n.h || 140) - 30))); area.appendChild(b); try { b.layoutSizingHorizontal = "FILL"; } catch (e) { } }); }
  else return null;
  if (f && n.link) LINKS.push([f, n.link]);
  return f;
}
figma.ui.onmessage = async function (m) {
  if (m.type !== "build") return;
  try {
    var d = m.doc; T = d.theme || {}; T.primary = T.primary || "#4D5BF9"; T.bg = T.bg || "#F5F6FA"; T.surface = T.surface || "#FFFFFF"; T.text = T.text || "#141833"; T.muted = T.muted || "#6B7090"; T.radius = T.radius == null ? 14 : T.radius;
    await fonts(T.font || "Inter"); LINKS = []; BACKS = [];
    var wire = d.style === "wireframe"; if (wire) { T.primary = "#555555"; }
    var x0 = 0, frames = {}, all = [], pw = W[d.platform] || 390, ph = H[d.platform] || 844;
    figma.viewport.scrollAndZoomIntoView([]);
    var start = figma.viewport.center; x0 = Math.round(start.x);
    for (var i = 0; i < d.screens.length; i++) {
      var s = d.screens[i], sf = figma.createFrame(); sf.name = s.name; sf.resize(pw, ph); sf.x = x0 + i * (pw + 80); sf.y = Math.round(start.y); sf.fills = [rgb(s.bg || T.bg)]; sf.layoutMode = "VERTICAL"; sf.primaryAxisSizingMode = "FIXED"; sf.counterAxisSizingMode = "FIXED"; sf.clipsContent = true;
      figma.ui.postMessage({ type: "status", text: "Building " + (i + 1) + " of " + d.screens.length + ": " + s.name });
      var kids = s.children || [], topN = [], bodyN = [], botN = [];
      kids.forEach(function (n) { if (n.t === "nav" && !bodyN.length && !botN.length) topN.push(n); else if (n.t === "tabbar") botN.push(n); else bodyN.push(n); });
      topN.forEach(function (n) { build(n, sf); });
      var body = box("Content", "col", { gap: 12, pad: d.platform === "web" ? 24 : 14 }); if (d.platform === "web") body.paddingLeft = body.paddingRight = 48; sf.appendChild(body); fill(body); try { body.layoutSizingVertical = "FILL"; } catch (e) { body.layoutGrow = 1; }
      bodyN.forEach(function (n) { build(n, body); });
      botN.forEach(function (n) { build(n, sf); });
      frames[s.id] = sf; all.push(sf);
    }
    var nav = function (id) { return { type: "NODE", destinationId: frames[id].id, navigation: "NAVIGATE", transition: { type: "SMART_ANIMATE", easing: { type: "EASE_OUT" }, duration: 0.25 }, preserveScrollPosition: false }; };
    var linked = 0;
    for (var L of LINKS) { if (!frames[L[1]]) continue; var r = [{ trigger: { type: "ON_CLICK" }, actions: [nav(L[1])] }]; try { if (L[0].setReactionsAsync) await L[0].setReactionsAsync(r); else L[0].reactions = r; linked++; } catch (e) { try { L[0].reactions = [{ trigger: { type: "ON_CLICK" }, action: nav(L[1]) }]; linked++; } catch (e2) { } } }
    for (var b of BACKS) { try { var rb = [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "BACK" }] }]; if (b.setReactionsAsync) await b.setReactionsAsync(rb); else b.reactions = rb; } catch (e) { } }
    try { figma.currentPage.flowStartingPoints = [{ nodeId: all[0].id, name: d.title || "Prototype" }]; } catch (e) { }
    figma.currentPage.selection = all; figma.viewport.scrollAndZoomIntoView(all);
    figma.ui.postMessage({ type: "status", text: "✅ Built " + all.length + " screens, " + linked + " prototype links. Press ▶ Present to click through." });
    figma.notify("vivo BI: " + all.length + " screens built");
  } catch (e) { figma.ui.postMessage({ type: "status", text: "⚠ " + (e && e.message || e) }); }
};
