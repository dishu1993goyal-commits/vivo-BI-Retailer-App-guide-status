// 🧑‍🏫 The animated AI presenter (same figures as Tool manuals): draws on a canvas, points at a spot, gestures, lips follow the voice.
// BIPresenter.draw(g, { x, y (feet), s, style: priya|arjun|vee|…, pose: idle|point|wave|present|thumb, tx, ty, mouth 0..1, expr, blink, t })
(function () {
  "use strict";
  if (window.BIPresenter) return;
  var CSSF = "'Segoe UI','Noto Sans','Noto Sans Devanagari','Noto Sans SC','Microsoft YaHei','Nirmala UI',system-ui,sans-serif";
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // ---------- 🧑‍🏫 animated AI presenter: points at the highlighted element, gestures, expressions, lips follow the voice ----------
  var PRESETS = { priya: { n: "Priya", human: true, long: true, skin: "#E2B08F", skin2: "#C98F6E", hair: "#1E130E", coat: "#1E3A8A", coat2: "#14285F", shirt: "#F8FAFC", lip: "#B5545F", eye: "#3B2414", acc: "#D4A017" },
    arjun: { n: "Arjun", human: true, skin: "#C99273", skin2: "#A5725A", hair: "#16100C", coat: "#334155", coat2: "#1E2533", shirt: "#EEF2FF", tie: "#B91C1C", lip: "#9A5B55", eye: "#2A1A10", beard: true }, vee: { n: "Vee", skin: "#F2C6A0", hair: "#2B1B14", long: true, coat: "#4D5BF9", shirt: "#FFFFFF" }, dev: { n: "Dev", skin: "#C98E62", hair: "#1A1410", long: false, coat: "#2B33A6", shirt: "#EAF0FF", beard: true }, robo: { n: "Robo", robot: true, coat: "#7A4CFF", shirt: "#E9E4FF" } };
  // o: {x, y (feet), s, style, pose: idle|point|wave|present|thumb, tx, ty, mouth 0..1, expr: smile|explain|excited|happy, blink, t}
  // a human-looking presenter (waist-up, shaded face, eyes, lips that move with the voice, natural arm gestures)
  function drawHuman(g, o, P) {
    var s = o.s || 1, t = o.t || 0, sway = Math.sin(t / 700) * 1.6, br = Math.sin(t / 900) * 1.4, ex = o.expr || "smile";
    var W = function (x, y) { return [o.x + (x + sway) * s, o.y + y * s]; }, L = function (x, y) { return [(x - o.x) / s - sway, (y - o.y) / s]; };
    var lg = function (x0, y0, x1, y1, a, b) { var q = g.createLinearGradient(x0, y0, x1, y1); q.addColorStop(0, a); q.addColorStop(1, b); return q; };
    g.save(); g.translate(o.x + sway * s, o.y); g.scale(s, s); g.lineCap = "round"; g.lineJoin = "round";
    var sh = -270 + br, hy = sh - 122, look = o.tx != null ? Math.max(-1, Math.min(1, L(o.tx, o.ty)[0] / 420)) : 0.25;
    // long hair behind the shoulders
    if (P.long) { g.fillStyle = P.hair; g.beginPath(); g.moveTo(-60, hy - 40); g.bezierCurveTo(-104, hy + 40, -96, sh + 30, -78, sh + 62); g.lineTo(78, sh + 62); g.bezierCurveTo(96, sh + 30, 104, hy + 40, 60, hy - 40); g.closePath(); g.fill(); }
    // torso
    g.fillStyle = lg(-120, sh, 120, 0, P.coat, P.coat2); g.beginPath(); g.moveTo(-30, sh - 16); g.bezierCurveTo(-82, sh - 12, -114, sh + 2, -122, sh + 46); g.lineTo(-108, 0); g.lineTo(108, 0); g.lineTo(122, sh + 46); g.bezierCurveTo(114, sh + 2, 82, sh - 12, 30, sh - 16); g.closePath(); g.fill();
    g.fillStyle = P.shirt; g.beginPath(); g.moveTo(-28, sh - 16); g.lineTo(0, sh + 78); g.lineTo(28, sh - 16); g.closePath(); g.fill();
    // neck (with chin shadow)
    g.fillStyle = lg(0, sh - 62, 0, sh, P.skin2, P.skin); g.beginPath(); g.moveTo(-19, sh - 66); g.lineTo(-21, sh - 10); g.quadraticCurveTo(0, sh + 26, 21, sh - 10); g.lineTo(19, sh - 66); g.closePath(); g.fill();
    if (P.tie) { g.fillStyle = P.shirt; g.beginPath(); g.moveTo(-22, sh - 14); g.lineTo(-4, sh + 6); g.lineTo(-14, sh + 14); g.closePath(); g.moveTo(22, sh - 14); g.lineTo(4, sh + 6); g.lineTo(14, sh + 14); g.closePath(); g.fill(); g.fillStyle = P.tie; g.beginPath(); g.moveTo(-8, sh - 4); g.lineTo(8, sh - 4); g.lineTo(6, sh + 10); g.lineTo(-6, sh + 10); g.closePath(); g.fill(); g.beginPath(); g.moveTo(-6, sh + 10); g.lineTo(6, sh + 10); g.lineTo(11, sh + 70); g.lineTo(0, sh + 82); g.lineTo(-11, sh + 70); g.closePath(); g.fill(); }
    else { g.strokeStyle = P.acc || "#D4A017"; g.lineWidth = 2; g.beginPath(); g.arc(0, sh - 34, 30, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke(); g.fillStyle = P.acc || "#D4A017"; g.beginPath(); g.arc(0, sh - 4, 4, 0, Math.PI * 2); g.fill(); }
    // lapels + buttons + badge
    g.fillStyle = "rgba(0,0,0,.22)"; [-1, 1].forEach(function (d) { g.beginPath(); g.moveTo(d * 28, sh - 16); g.lineTo(d * 56, sh + 34); g.lineTo(d * 30, sh + 44); g.lineTo(d * 2, sh + 118); g.lineTo(0, sh + 78); g.closePath(); g.fill(); });
    g.fillStyle = "rgba(255,255,255,.55)"; [sh + 140, sh + 190].forEach(function (y) { g.beginPath(); g.arc(6, y, 4, 0, Math.PI * 2); g.fill(); });
    g.fillStyle = "#fff"; rr(g, -92, sh + 66, 52, 22, 6); g.fill(); g.fillStyle = P.coat2; g.font = "800 11px " + CSSF; g.textAlign = "center"; g.fillText("AI · " + P.n, -66, sh + 81); g.textAlign = "left";
    // arms: sleeve (upper arm + forearm) and a hand with fingers
    var limb = function (sx, sy, a1, a2, hand) {
      var l1 = 108, l2 = 96, ex1 = sx + Math.cos(a1) * l1, ey1 = sy + Math.sin(a1) * l1, hx = ex1 + Math.cos(a2) * l2, hy2 = ey1 + Math.sin(a2) * l2;
      g.strokeStyle = P.coat2; g.lineWidth = 38; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex1, ey1); g.stroke(); g.strokeStyle = P.coat; g.lineWidth = 32; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex1, ey1); g.lineTo(hx - Math.cos(a2) * 10, hy2 - Math.sin(a2) * 10); g.stroke();
      g.strokeStyle = P.shirt; g.lineWidth = 26; g.beginPath(); g.moveTo(hx - Math.cos(a2) * 12, hy2 - Math.sin(a2) * 12); g.lineTo(hx - Math.cos(a2) * 6, hy2 - Math.sin(a2) * 6); g.stroke();
      g.fillStyle = P.skin; g.save(); g.translate(hx, hy2); g.rotate(a2); g.beginPath(); g.ellipse(8, 0, 15, 13, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = P.skin; var fing = function (ang, len, w) { g.lineWidth = w; g.beginPath(); g.moveTo(14, 0); g.lineTo(14 + Math.cos(ang) * len, Math.sin(ang) * len); g.stroke(); };
      var tipL = null;
      if (hand === "point") { fing(0, 30, 8); [0.5, 0.8, 1.1].forEach(function (a) { fing(a, 9, 8); }); fing(-0.9, 12, 7); tipL = [14 + 34, 0]; }
      else if (hand === "open") { [-0.45, -0.15, 0.15, 0.45].forEach(function (a) { fing(a, 22, 7); }); fing(-1.2, 14, 7); }
      else if (hand === "thumb") { [0.2, 0.5, 0.8, 1.1].forEach(function (a) { fing(a, 8, 9); }); var up = -Math.PI / 2 - a2; g.lineWidth = 9; g.beginPath(); g.moveTo(8, 0); g.lineTo(8 + Math.cos(up) * 28, Math.sin(up) * 28); g.stroke(); }
      else { [0.1, 0.35, 0.6].forEach(function (a) { fing(a, 12, 7); }); }
      g.strokeStyle = "rgba(0,0,0,.12)"; g.lineWidth = 1.2; g.beginPath(); g.ellipse(8, 0, 15, 13, 0, 0, Math.PI * 2); g.stroke(); g.restore();
      return tipL ? [hx + Math.cos(a2) * tipL[0], hy2 + Math.sin(a2) * tipL[0]] : [hx, hy2];
    };
    limb(-108, sh + 34, Math.PI / 2 + 0.16, Math.PI / 2 + 0.04, "rest");
    var tip = null, pose = o.pose || "idle";
    if (pose === "point" && o.tx != null) { var lt = L(o.tx, o.ty), ang = Math.atan2(lt[1] - (sh + 34), lt[0] - 108); ang = Math.max(-1.2, Math.min(0.85, ang)); tip = limb(108, sh + 34, ang + 0.5, ang, "point"); }
    else if (pose === "wave") limb(108, sh + 34, -0.15, -1.5 + Math.sin(t / 150) * 0.32, "open");
    else if (pose === "present") limb(108, sh + 34, 0.55, -0.12 + Math.sin(t / 520) * 0.07, "open");
    else if (pose === "thumb") limb(108, sh + 34, 0.75, -1.05, "thumb");
    else limb(108, sh + 34, Math.PI / 2 - 0.16, Math.PI / 2 - 0.04, "rest");
    // head
    g.save(); g.translate(0, hy); g.rotate(look * 0.05 + Math.sin(t / 1100) * 0.022 + (ex === "explain" ? 0.025 : 0));
    g.fillStyle = P.skin2; [-1, 1].forEach(function (d) { g.beginPath(); g.ellipse(d * 55, 6, 9, 15, 0, 0, Math.PI * 2); g.fill(); });
    if (!P.tie) { g.fillStyle = P.acc || "#D4A017"; [-1, 1].forEach(function (d) { g.beginPath(); g.arc(d * 56, 24, 3.5, 0, Math.PI * 2); g.fill(); }); }
    var fg = g.createRadialGradient(-14, -14, 10, 0, 6, 86); fg.addColorStop(0, P.skin); fg.addColorStop(1, P.skin2);
    g.fillStyle = fg; g.beginPath(); g.moveTo(0, -76); g.bezierCurveTo(-46, -76, -60, -36, -56, 4); g.bezierCurveTo(-52, 46, -26, 80, 0, 82); g.bezierCurveTo(26, 80, 52, 46, 56, 4); g.bezierCurveTo(60, -36, 46, -76, 0, -76); g.closePath(); g.fill();
    if (P.beard) { g.fillStyle = "rgba(30,20,14,.28)"; g.beginPath(); g.moveTo(-50, 22); g.bezierCurveTo(-44, 62, -22, 82, 0, 83); g.bezierCurveTo(22, 82, 44, 62, 50, 22); g.bezierCurveTo(34, 46, 14, 50, 0, 50); g.bezierCurveTo(-14, 50, -34, 46, -50, 22); g.closePath(); g.fill(); }
    // hair
    g.fillStyle = P.hair; g.beginPath();
    if (P.long) { g.moveTo(-60, 18); g.bezierCurveTo(-70, -60, -40, -96, 4, -94); g.bezierCurveTo(48, -94, 70, -62, 62, 10); g.bezierCurveTo(56, -22, 44, -44, 26, -52); g.bezierCurveTo(4, -40, -26, -40, -46, -30); g.bezierCurveTo(-54, -16, -56, 0, -60, 18); }
    else { g.moveTo(-58, -2); g.bezierCurveTo(-64, -60, -36, -94, 6, -92); g.bezierCurveTo(46, -92, 66, -64, 58, -4); g.bezierCurveTo(54, -34, 46, -48, 34, -54); g.bezierCurveTo(10, -46, -24, -50, -44, -40); g.bezierCurveTo(-52, -30, -54, -18, -58, -2); }
    g.closePath(); g.fill();
    // eyebrows
    var bry = ex === "excited" ? -36 : ex === "explain" ? -31 : -29; g.strokeStyle = P.hair; g.lineWidth = P.long ? 4 : 5.5;
    [-1, 1].forEach(function (d) { g.beginPath(); g.moveTo(d * 36, bry + 4 + (ex === "explain" && d > 0 ? -3 : 0)); g.quadraticCurveTo(d * 24, bry - 3 + (ex === "explain" && d > 0 ? -3 : 0), d * 10, bry + 1); g.stroke(); });
    // eyes
    [-1, 1].forEach(function (d) { var x = d * 22, y = -10;
      if (o.blink) { g.strokeStyle = "#2B1B14"; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x - 11, y); g.quadraticCurveTo(x, y + 4, x + 11, y); g.stroke(); return; }
      g.fillStyle = "#FBFAF7"; g.beginPath(); g.moveTo(x - 12, y); g.quadraticCurveTo(x, y - (ex === "excited" ? 11 : 9), x + 12, y); g.quadraticCurveTo(x, y + 7, x - 12, y); g.fill();
      g.save(); g.clip(); g.fillStyle = P.eye; g.beginPath(); g.arc(x + look * 4, y, 6, 0, Math.PI * 2); g.fill(); g.fillStyle = "#0c0705"; g.beginPath(); g.arc(x + look * 4, y, 2.8, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.arc(x + look * 4 + 2, y - 2, 1.4, 0, Math.PI * 2); g.fill(); g.restore();
      g.strokeStyle = "#1c120d"; g.lineWidth = P.long ? 3 : 2.2; g.beginPath(); g.moveTo(x - 12, y); g.quadraticCurveTo(x, y - (ex === "excited" ? 11 : 9), x + 12, y); g.stroke();
      if (P.long) { g.lineWidth = 1.6; g.beginPath(); g.moveTo(x + d * 11, y - 1); g.lineTo(x + d * 15, y - 4); g.stroke(); } });
    // nose
    g.strokeStyle = "rgba(90,50,30,.35)"; g.lineWidth = 2; g.beginPath(); g.moveTo(-2, -4); g.quadraticCurveTo(-8, 16, -6, 22); g.stroke(); g.beginPath(); g.arc(-5, 24, 3, 0.2, 2.6); g.arc(5, 24, 3, 0.5, 2.9); g.stroke();
    if (ex === "happy" || ex === "excited") { g.fillStyle = "rgba(230,90,90,.16)"; g.beginPath(); g.ellipse(-34, 18, 12, 7, 0, 0, Math.PI * 2); g.ellipse(34, 18, 12, 7, 0, 0, Math.PI * 2); g.fill(); }
    // mouth: opens with the voice
    var m = Math.max(0, Math.min(1, o.mouth || 0)), smile = ex === "happy" || ex === "excited" ? 6 : ex === "explain" ? 2 : 4, mw = 17 + m * 2, my = 44;
    if (m > 0.08) { var oh = 3 + m * 13; g.fillStyle = "#4A1717"; g.beginPath(); g.moveTo(-mw, my); g.quadraticCurveTo(0, my - 5 + smile * 0.3, mw, my); g.quadraticCurveTo(0, my + oh + smile, -mw, my); g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.moveTo(-mw + 4, my); g.quadraticCurveTo(0, my - 3, mw - 4, my); g.lineTo(mw - 5, my + 3); g.quadraticCurveTo(0, my + 1, -mw + 5, my + 3); g.closePath(); g.fill(); g.strokeStyle = P.lip; g.lineWidth = 3.5; g.beginPath(); g.moveTo(-mw, my); g.quadraticCurveTo(0, my + oh + smile + 1, mw, my); g.stroke(); g.lineWidth = 3; g.beginPath(); g.moveTo(-mw, my); g.quadraticCurveTo(-mw / 2, my - 4, 0, my - 2); g.quadraticCurveTo(mw / 2, my - 4, mw, my); g.stroke(); }
    else { g.fillStyle = P.lip; g.beginPath(); g.moveTo(-17, my); g.quadraticCurveTo(-8, my - 5, 0, my - 3); g.quadraticCurveTo(8, my - 5, 17, my); g.quadraticCurveTo(0, my + smile + 5, -17, my); g.fill(); g.strokeStyle = "rgba(70,20,20,.55)"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-16, my); g.quadraticCurveTo(0, my + smile * 0.6, 16, my); g.stroke(); }
    g.restore(); g.restore();
    if (tip && o.tx != null) { var tw = W(tip[0], tip[1]); g.save(); g.strokeStyle = "rgba(255,90,60,.75)"; g.setLineDash([4, 7]); g.lineWidth = 3; g.beginPath(); g.moveTo(tw[0], tw[1]); g.lineTo(o.tx, o.ty); g.stroke(); g.setLineDash([]); g.fillStyle = "rgba(255,90,60,.9)"; g.beginPath(); g.arc(o.tx, o.ty, 5 + Math.sin(t / 120) * 1.5, 0, Math.PI * 2); g.fill(); g.restore(); }
  }
  function drawPresenter(g, o) {
    if (PRESETS[o.style] && PRESETS[o.style].human) return drawHuman(g, o, PRESETS[o.style]);
    var P = PRESETS[o.style] || PRESETS.vee, s = o.s || 1, t = o.t || 0, sway = Math.sin(t / 650) * 2.2;
    g.save(); g.translate(o.x + sway * s, o.y); g.scale(s, s);
    var W = function (x, y) { return [o.x + (x + sway) * s, o.y + y * s]; };   // local → canvas
    var L = function (x, y) { return [(x - o.x) / s - sway, (y - o.y) / s]; };   // canvas → local
    // shadow + body
    g.fillStyle = "rgba(20,22,40,.18)"; g.beginPath(); g.ellipse(0, -4, 95, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = P.coat; rr(g, -88, -268, 176, 262, 46); g.fill();
    g.fillStyle = P.shirt; g.beginPath(); g.moveTo(-30, -268); g.lineTo(0, -205); g.lineTo(30, -268); g.closePath(); g.fill();
    if (!P.robot) { g.fillStyle = "#E64B4B"; g.beginPath(); g.moveTo(-7, -258); g.lineTo(7, -258); g.lineTo(4, -215); g.lineTo(0, -208); g.lineTo(-4, -215); g.closePath(); g.fill(); }
    g.fillStyle = "#fff"; rr(g, 26, -205, 44, 26, 7); g.fill(); g.fillStyle = P.coat; g.font = "900 13px " + CSSF; g.textAlign = "center"; g.fillText("AI", 48, -187);
    // arms: the far one hangs, the near one does the gesture
    var arm = function (sx, sy, a1, a2, l1, l2, hand) { var ex = sx + Math.cos(a1) * l1, ey = sy + Math.sin(a1) * l1, hx = ex + Math.cos(a2) * l2, hy = ey + Math.sin(a2) * l2; g.strokeStyle = P.coat; g.lineCap = "round"; g.lineWidth = 30; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.lineTo(hx, hy); g.stroke(); g.fillStyle = P.robot ? "#C9C2F2" : P.skin; g.beginPath(); g.arc(hx, hy, 15, 0, Math.PI * 2); g.fill();
      if (hand === "point") { g.strokeStyle = P.robot ? "#C9C2F2" : P.skin; g.lineWidth = 9; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(a2) * 22, hy + Math.sin(a2) * 22); g.stroke(); return [hx + Math.cos(a2) * 26, hy + Math.sin(a2) * 26]; }
      if (hand === "thumb") { g.strokeStyle = P.robot ? "#C9C2F2" : P.skin; g.lineWidth = 9; g.beginPath(); g.moveTo(hx, hy - 6); g.lineTo(hx, hy - 30); g.stroke(); }
      if (hand === "open") { g.strokeStyle = P.robot ? "#C9C2F2" : P.skin; g.lineWidth = 6; [-0.5, -0.17, 0.17, 0.5].forEach(function (d) { g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(a2 + d) * 22, hy + Math.sin(a2 + d) * 22); g.stroke(); }); }
      return [hx, hy]; };
    arm(-78, -240, Math.PI / 2 + 0.12, Math.PI / 2 + 0.05, 78, 70, "");
    var tip = null, pose = o.pose || "idle";
    if (pose === "point" && o.tx != null) { var lt = L(o.tx, o.ty), ang = Math.atan2(lt[1] - (-240), lt[0] - 78); ang = Math.max(-1.25, Math.min(0.9, ang)); tip = arm(78, -240, ang + 0.25, ang, 76, 78, "point"); }
    else if (pose === "wave") { var w = Math.sin(t / 140) * 0.35; arm(78, -240, -0.35, -1.45 + w, 74, 66, "open"); }
    else if (pose === "present") { arm(78, -240, 0.35, -0.2 + Math.sin(t / 500) * 0.06, 76, 72, "open"); }
    else if (pose === "thumb") { arm(78, -240, 0.55, -1.1, 70, 52, "thumb"); }
    else arm(78, -240, Math.PI / 2 - 0.12, Math.PI / 2 - 0.05, 78, 70, "");
    // head (tilts slightly toward where it looks)
    var look = o.tx != null ? Math.max(-1, Math.min(1, (L(o.tx, o.ty)[0]) / 400)) : 0.3, hy = -330, ex = o.expr || "smile";
    g.save(); g.translate(0, hy); g.rotate(look * 0.06 + Math.sin(t / 900) * 0.02);
    if (P.robot) {
      g.strokeStyle = "#7A4CFF"; g.lineWidth = 5; g.beginPath(); g.moveTo(0, -62); g.lineTo(0, -84); g.stroke(); g.fillStyle = "#FFB020"; g.beginPath(); g.arc(0, -88, 8 + Math.sin(t / 200) * 1.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#E9E4FF"; rr(g, -66, -62, 132, 118, 34); g.fill(); g.fillStyle = "#1E1740"; rr(g, -54, -48, 108, 88, 24); g.fill();
      var eh = o.blink ? 2 : (ex === "excited" ? 18 : 14); g.fillStyle = "#5CF2D6"; [-24, 24].forEach(function (x) { g.beginPath(); g.ellipse(x + look * 6, -12, 11, eh / 2 + 1, 0, 0, Math.PI * 2); g.fill(); });
      g.strokeStyle = "#5CF2D6"; g.lineWidth = 4; g.beginPath(); var mo = o.mouth || 0; for (var k = -28; k <= 28; k += 4) { var yy = 20 + (ex === "happy" || ex === "smile" ? (k * k) / 160 - 5 : 0) + Math.sin(k / 3 + t / 60) * mo * 9; if (k === -28) g.moveTo(k, yy); else g.lineTo(k, yy); } g.stroke();
    } else {
      g.fillStyle = P.skin; g.fillRect(-16, 28, 32, 42);
      if (P.long) { g.fillStyle = P.hair; rr(g, -70, -50, 140, 140, 60); g.fill(); }
      g.fillStyle = P.skin; g.beginPath(); g.ellipse(0, 0, 56, 64, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(-56, 6, 10, 0, Math.PI * 2); g.arc(56, 6, 10, 0, Math.PI * 2); g.fill();
      g.fillStyle = P.hair; g.beginPath(); g.ellipse(0, -36, 60, 36, 0, Math.PI, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(-58, -30); g.quadraticCurveTo(-10, P.long ? -2 : -14, 30, -38); g.quadraticCurveTo(50, -40, 58, -26); g.lineTo(58, -40); g.lineTo(-58, -40); g.closePath(); g.fill();
      if (P.beard) { g.fillStyle = "rgba(26,20,16,.35)"; g.beginPath(); g.ellipse(0, 40, 40, 22, 0, 0, Math.PI); g.fill(); }
      var br = ex === "excited" ? -30 : ex === "explain" ? -24 : -22; g.strokeStyle = P.hair; g.lineWidth = 4.5; g.lineCap = "round";
      [-1, 1].forEach(function (d) { g.beginPath(); g.moveTo(d * 30, br + (ex === "explain" ? d * 2 : 0)); g.lineTo(d * 12, br - (ex === "excited" ? 4 : 1)); g.stroke(); });
      [-21, 21].forEach(function (x) { if (o.blink) { g.strokeStyle = "#2B1B14"; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 8, -6); g.lineTo(x + 8, -6); g.stroke(); return; } g.fillStyle = "#fff"; g.beginPath(); g.ellipse(x, -6, 10, ex === "excited" ? 11 : 9, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = "#2B1B14"; g.beginPath(); g.arc(x + look * 4, -5, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.arc(x + look * 4 + 2, -7, 1.6, 0, Math.PI * 2); g.fill(); });
      if (ex === "happy" || ex === "excited") { g.fillStyle = "rgba(255,110,110,.28)"; g.beginPath(); g.ellipse(-34, 14, 10, 6, 0, 0, Math.PI * 2); g.ellipse(34, 14, 10, 6, 0, 0, Math.PI * 2); g.fill(); }
      var m = Math.max(0, Math.min(1, o.mouth || 0)); g.fillStyle = "#8C2F2F"; g.strokeStyle = "#8C2F2F"; g.lineWidth = 3.5;
      if (m > 0.08) { g.beginPath(); g.ellipse(0, 26, 13 + m * 3, 3 + m * 11, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.fillRect(-8, 26 - (3 + m * 11) + 1, 16, 3); }
      else { g.beginPath(); g.arc(0, ex === "explain" ? 22 : 16, ex === "happy" || ex === "excited" ? 16 : 12, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); }
    }
    g.restore();
    g.fillStyle = "#fff"; rr(g, -48, 6, 96, 24, 12); g.fill(); g.fillStyle = "#1B1D2E"; g.font = "800 13px " + CSSF; g.textAlign = "center"; g.fillText(P.n + " · AI guide", 0, 23); g.textAlign = "left";
    g.restore();
    if (tip && o.tx != null) { var tw = W(tip[0], tip[1]); g.save(); g.strokeStyle = "rgba(255,90,60,.75)"; g.setLineDash([4, 7]); g.lineWidth = 3; g.beginPath(); g.moveTo(tw[0], tw[1]); g.lineTo(o.tx, o.ty); g.stroke(); g.setLineDash([]); g.fillStyle = "rgba(255,90,60,.9)"; g.beginPath(); g.arc(o.tx, o.ty, 5 + Math.sin(t / 120) * 1.5, 0, Math.PI * 2); g.fill(); g.restore(); }
  }
  // ---------- 🎙️ AI voice-over: one clip per group of scenes, made on the server (cached), three at a time ----------
  window.BIPresenter = { PRESETS: PRESETS, draw: drawPresenter, rr: rr };
})();
