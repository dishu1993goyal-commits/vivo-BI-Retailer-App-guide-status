// Monthly one-pager report — built from the dashboard's Monthly summary page (BIMSUM.digest) and insights (BIPRO.insights).
// Editable on the page (click any text), themes, layouts, page sizes, a custom banner; PNG / PDF download.
// Settings are kept per device (localStorage). Loaded on demand by the dashboard tab "Monthly one-pager".
(function () {
  if (window.BIOP) return;
  var KEY = 'bi-op-cfg-v1';
  var TH = {
    vivo: {n: 'vivo blue', bg: '#F3F5FF', card: '#FFFFFF', ink: '#14183A', sub: '#5E6487', acc: '#415FFF', acc2: '#7A4CFF', line: '#E3E7F7'},
    studio: {n: 'Black & gold', bg: '#F7F3E8', card: '#FFFFFF', ink: '#111111', sub: '#6B6657', acc: '#C9A227', acc2: '#111111', line: '#ECE3C8'},
    midnight: {n: 'Midnight', bg: '#0E1020', card: '#181B30', ink: '#F4F1E6', sub: '#A9A6C0', acc: '#E6C35C', acc2: '#7A4CFF', line: '#2A2E48'},
    emerald: {n: 'Emerald', bg: '#EFF8F4', card: '#FFFFFF', ink: '#10261D', sub: '#557066', acc: '#0E9F6E', acc2: '#0B7A8C', line: '#D5EBE2'},
    sunset: {n: 'Sunset', bg: '#FFF5EF', card: '#FFFFFF', ink: '#2A1610', sub: '#7A5F55', acc: '#F0602A', acc2: '#D6336C', line: '#F6DDD0'},
    royal: {n: 'Royal purple', bg: '#F5F2FF', card: '#FFFFFF', ink: '#1E1240', sub: '#6A5F8A', acc: '#6D3BEB', acc2: '#C2389B', line: '#E4DCFA'},
    mono: {n: 'Print (black & white)', bg: '#FFFFFF', card: '#FFFFFF', ink: '#111111', sub: '#555555', acc: '#111111', acc2: '#666666', line: '#DDDDDD'}
  };
  var FONTS = {sans: ["Clean sans", "'Segoe UI','Noto Sans','Noto Sans Devanagari',system-ui,sans-serif"], serif: ['Classic serif', "Georgia,'Times New Roman','Noto Serif',serif"], round: ['Rounded', "'Nunito','Varela Round','Segoe UI',system-ui,sans-serif"], cond: ['Condensed', "'Roboto Condensed','Arial Narrow','Segoe UI',sans-serif"]};
  var BL = {banner: 'Banner', kpis: 'Key indicators', insights: 'Insights', analysis: 'Analysis & state ranking', status: 'All projects status', done: 'Work done this month', next: 'Next month plan', photos: 'Photos from the field', notes: 'Message / notes'};
  var IC = {kpis: '📊', insights: '💡', analysis: '📈', status: '🗂️', done: '✅', next: '🗓️', photos: '📷', notes: '✍️'};
  var ORDER = ['banner', 'kpis', 'insights', 'analysis', 'status', 'done', 'next', 'photos', 'notes'];
  var LAY = {
    two: {n: 'Two columns', sp: {kpis: 6, insights: 3, analysis: 3, status: 6, done: 3, next: 3, photos: 6, notes: 6}},
    classic: {n: 'Classic — one column', sp: {}},
    exec: {n: 'Executive — KPIs, then 2/3 + 1/3', o: ['banner', 'kpis', 'insights', 'status', 'done', 'analysis', 'next', 'notes', 'photos'], sp: {kpis: 6, insights: 4, status: 2, done: 4, analysis: 2, next: 6, notes: 6, photos: 6}},
    magazine: {n: 'Magazine — side column', o: ['banner', 'kpis', 'insights', 'status', 'analysis', 'done', 'next', 'photos', 'notes'], sp: {kpis: 2, insights: 4, status: 2, analysis: 4, done: 3, next: 3, photos: 6, notes: 6}},
    grid: {n: 'Compact grid — 3 across', sp: {kpis: 6, insights: 2, analysis: 2, status: 2, done: 2, next: 2, photos: 2, notes: 6}}
  };
  var PAGE = {a4p: ['A4 portrait', 794, 1123], a4l: ['A4 landscape', 1123, 794], slide: ['Slide 16:9', 1280, 720], poster: ['Long poster (WhatsApp)', 1080, 0]};
  var SPAN = [[6, 'Full width'], [4, '⅔ width'], [3, '½ width'], [2, '⅓ width']];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); };
  function def() { return {theme: 'vivo', acc: '', font: 'sans', layout: 'two', page: 'a4p', dens: 'normal', blocks: ORDER.map(function (k) { return {k: k, on: k !== 'photos', sp: k === 'banner' ? 6 : (LAY.two.sp[k] || 6)}; }), banner: {img: '', title: '', sub: '', align: 'left', h: 150, dark: 40, logo: true}, edits: {}, notes: 'Thank you to every state team for this month’s work. Focus for next month: close the gaps shown above and keep all project updates current on the dashboard.'}; }
  function load() { try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && c.blocks) { var d = def(); ORDER.forEach(function (k) { if (!c.blocks.some(function (b) { return b.k === k; })) c.blocks.push({k: k, on: false, sp: 6}); }); c.banner = Object.assign(d.banner, c.banner || {}); c.edits = c.edits || {}; return Object.assign(d, c); } } catch (e) {} return def(); }
  var C = load(), saveT = 0;
  function save() { clearTimeout(saveT); saveT = setTimeout(function () { try { localStorage.setItem(KEY, JSON.stringify(C)); } catch (e) { try { var c2 = Object.assign({}, C, {banner: Object.assign({}, C.banner, {img: ''})}); localStorage.setItem(KEY, JSON.stringify(c2)); } catch (x) {} } }, 300); }
  function digest() { try { return window.BIMSUM && BIMSUM.digest ? BIMSUM.digest() : null; } catch (e) { console.error(e); return null; } }
  function insights() { var L = []; try { if (window.BIPRO && BIPRO.insights) L = BIPRO.insights(6) || []; } catch (e) {} return L; }
  function kfmt(v) { if (v == null || !isFinite(v)) return '–'; var x = Math.abs(v) <= 1.5 ? v * 100 : v; return (Math.round(x * 10) / 10) + '%'; }

  // ---------- content of each block (from the Monthly summary data) ----------
  var G = null, INS = [];
  function T() { var t = Object.assign({}, TH[C.theme] || TH.vivo); if (C.acc) t.acc = C.acc; return t; }
  function pill(t, c) { return '<span style="display:inline-block;font-size:.72em;font-weight:700;padding:2px 8px;border-radius:99px;background:' + c + '22;color:' + c + ';white-space:nowrap">' + esc(t) + '</span>'; }
  var STC = {live: '#16A06A', pilot: '#C98A00', risk: '#D4563B', upcoming: '#5B7BD5', done: '#6B6B6B'};
  function body(k) {
    var t = T(), M = G || {};
    if (k === 'kpis') {
      var L = (M.tiles || []).slice(0, 8);
      if (!L.length && M.kpis) L = M.kpis.slice(0, 8).map(function (x) { return {l: x.sh || x.n, v: kfmt(x.v), s: x.nat != null ? 'PAN India ' + kfmt(x.nat) : ''}; });
      if (!L.length) return '<p style="color:' + t.sub + '">No indicators for this period yet.</p>';
      return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">' + L.map(function (x) { var dl = x.dl ? '<div style="font-size:.78em;font-weight:700;color:' + (/up|good|pos/.test(x.dl.c || '') ? '#16A06A' : /down|bad|neg/.test(x.dl.c || '') ? '#D4563B' : t.sub) + '">' + esc(x.dl.t) + '</div>' : ''; return '<div style="background:' + t.bg + ';border-radius:12px;padding:10px 12px;border-left:4px solid ' + t.acc + '"><div style="font-size:.8em;color:' + t.sub + ';line-height:1.25">' + esc(x.l) + '</div><div style="font-size:1.55em;font-weight:800;margin-top:2px">' + esc(x.v) + '</div>' + (x.s ? '<div style="font-size:.76em;color:' + t.sub + '">' + esc(x.s) + '</div>' : '') + dl + '</div>'; }).join('') + '</div>';
    }
    if (k === 'insights') {
      var I = INS.slice(0, 6).map(function (x) { return {ic: x.c === 'good' || x.c === 'ok' ? '✅' : x.c === 'bad' || x.c === 'risk' ? '⚠️' : '💡', t: x.t, d: x.d}; });
      if (M.focus && M.focus.k) I.push({ic: '🎯', t: 'Focus KPI: ' + M.focus.k + (M.focus.v != null ? ' at ' + kfmt(M.focus.v) : ''), d: M.focus.second ? 'Next: ' + M.focus.second : ''});
      if (M.push && M.push.length) I.push({ic: '🚀', t: 'Close to the top 5: ' + M.push.map(function (r) { return r.state + ' (−' + Math.round(r.gap * 10) / 10 + ')'; }).join(', '), d: ''});
      if (!I.length && M.top5 && M.top5.length) I.push({ic: '🏆', t: M.top5[0].state + ' leads with a score of ' + Math.round(M.top5[0].score * 10) / 10, d: ''});
      if (!I.length) return '<p style="color:' + t.sub + '">No insights yet for this period.</p>';
      return '<ul style="list-style:none;margin:0;padding:0;display:grid;gap:8px">' + I.slice(0, 7).map(function (x) { return '<li style="display:flex;gap:8px;line-height:1.35"><span>' + x.ic + '</span><span><b>' + esc(x.t) + '</b>' + (x.d ? '<br><span style="color:' + t.sub + ';font-size:.9em">' + esc(x.d) + '</span>' : '') + '</span></li>'; }).join('') + '</ul>';
    }
    if (k === 'analysis') {
      var h = '';
      if (M.top5 && M.top5.length) h += '<div style="font-weight:700;font-size:.85em;color:' + t.sub + ';margin-bottom:6px">TOP 5 STATES' + (M.pan != null ? ' · PAN India ' + Math.round(M.pan * 10) / 10 : '') + '</div>' + M.top5.map(function (r) { var w = Math.max(4, Math.min(100, r.score)); return '<div style="margin:6px 0;font-size:.92em"><div style="display:flex;align-items:center;gap:6px"><b style="color:' + t.acc + '">#' + r.rank + '</b><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.state) + '</span><b>' + Math.round(r.score * 10) / 10 + '</b>' + (r.ch ? '<span style="font-size:.8em;color:' + (r.ch > 0 ? '#16A06A' : '#D4563B') + '">' + (r.ch > 0 ? '▲' : '▼') + Math.abs(r.ch) + '</span>' : '') + '</div><div style="height:6px;border-radius:9px;background:' + t.line + ';overflow:hidden;margin-top:3px"><i style="display:block;height:100%;width:' + w + '%;background:linear-gradient(90deg,' + t.acc + ',' + t.acc2 + ')"></i></div></div>'; }).join('');
      if (M.kpis && M.kpis.length) h += '<table style="width:100%;border-collapse:collapse;font-size:.8em;margin-top:12px;table-layout:fixed"><tr style="color:' + t.sub + ';text-align:right"><th style="text-align:left;padding:5px 3px;font-weight:600;width:40%">KPI</th><th style="padding:5px 3px;font-weight:600">Value</th><th style="padding:5px 3px;font-weight:600">Top 5</th><th style="padding:5px 3px;font-weight:600">Low 5</th></tr>' + M.kpis.slice(0, 8).map(function (x) { return '<tr style="text-align:right;border-top:1px solid ' + t.line + '"><td style="text-align:left;padding:5px 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(x.sh || x.n) + '</td><td style="padding:5px 3px;font-weight:700">' + kfmt(x.v) + '</td><td style="padding:5px 3px">' + kfmt(x.t5) + '</td><td style="padding:5px 3px">' + kfmt(x.b5) + '</td></tr>'; }).join('') + '</table>';
      return h || '<p style="color:' + t.sub + '">Rankings appear when KPI data is loaded for this period.</p>';
    }
    if (k === 'status') {
      var P = (M.projects || []).slice(0, 10);
      var chips = (M.status || []).map(function (x) { var c = STC[x.k] || t.acc; return '<div style="flex:1;min-width:80px;background:' + c + '14;border-radius:12px;padding:8px 10px;text-align:center"><div style="font-size:1.5em;font-weight:800;color:' + c + '">' + x.n + '</div><div style="font-size:.78em;color:' + t.sub + '">' + esc(x.l) + '</div></div>'; }).join('');
      return (chips ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' + chips + '</div>' : '') + (P.length ? P.map(function (p) { var c = STC[p.stage] || t.acc; return '<div style="padding:6px 0;border-top:1px solid ' + t.line + ';font-size:.9em"><div style="line-height:1.3"><b>' + esc(p.name) + '</b>' + (p.tgt ? '<span style="color:' + t.sub + ';font-size:.85em"> · go-live ' + esc(p.tgt) + '</span>' : '') + '</div><div style="display:flex;align-items:center;gap:8px;margin-top:4px">' + (p.pr != null ? '<span style="flex:1;height:7px;border-radius:9px;background:' + t.line + ';overflow:hidden"><i style="display:block;height:100%;width:' + Math.max(0, Math.min(100, p.pr)) + '%;background:' + c + '"></i></span><span style="font-size:.85em;min-width:30px;text-align:right">' + Math.round(p.pr) + '%</span>' : '<span style="flex:1"></span>') + pill(p.st, c) + '</div></div>'; }).join('') : '<p style="color:' + t.sub + '">No projects for this period.</p>');
    }
    if (k === 'done') { var D = (M.done || []).slice(0, 8); return D.length ? '<ol style="margin:0;padding-left:1.2em;display:grid;gap:7px">' + D.map(function (d) { return '<li style="line-height:1.35"><b>' + esc(d.name) + '</b> ' + pill(d.st, STC[d.stage] || t.acc) + '<br><span style="color:' + t.sub + ';font-size:.92em">' + esc(d.txt) + '</span></li>'; }).join('') + '</ol>' : '<p style="color:' + t.sub + '">No updates recorded for ' + esc(M.month || 'this month') + ' yet.</p>'; }
    if (k === 'next') { var N = (M.next || []).slice(0, 8); return N.length ? '<ol style="margin:0;padding-left:1.2em;display:grid;gap:7px">' + N.map(function (d) { return '<li style="line-height:1.35"><b>' + esc(d.name) + '</b>' + (d.tgt ? ' <span style="font-size:.8em;color:' + t.acc + ';font-weight:700">· by ' + esc(d.tgt) + '</span>' : '') + '<br><span style="color:' + t.sub + ';font-size:.92em">' + esc(d.txt) + '</span></li>'; }).join('') + '</ol>' : '<p style="color:' + t.sub + '">Add next-month plans on the Monthly summary page (Key Projects & Plans).</p>'; }
    if (k === 'photos') { var F = (M.photos || []).slice(0, 6); return F.length ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' + F.map(function (p) { return '<figure style="margin:0"><img src="' + esc(p.d) + '" style="width:100%;height:120px;object-fit:cover;border-radius:10px;display:block"><figcaption style="font-size:.75em;color:' + t.sub + ';margin-top:3px">' + esc(p.cap || '') + '</figcaption></figure>'; }).join('') + '</div>' : '<p style="color:' + t.sub + '">No photos for this period.</p>'; }
    if (k === 'notes') return '<p style="margin:0;line-height:1.5">' + esc(C.notes) + '</p>';
    return '';
  }
  function bannerHtml() {
    var t = T(), b = C.banner, M = G || {}, title = b.title || 'BI Monthly Report · ' + (M.month || ''), sub = b.sub || (M.title && M.title !== M.month ? M.title + ' · ' : '') + 'vivo Business Innovation';
    var bg = b.img ? 'linear-gradient(90deg,rgba(0,0,0,' + (b.dark / 100) + '),rgba(0,0,0,' + (b.dark / 200) + ')),url(' + b.img + ') center/cover' : 'linear-gradient(120deg,' + t.acc + ',' + t.acc2 + ')';
    return '<section data-b="banner" style="grid-column:span 6;position:relative;border-radius:18px;overflow:hidden;min-height:' + b.h + 'px;background:' + bg + ';color:#fff;display:flex;flex-direction:column;justify-content:center;padding:22px 28px;text-align:' + b.align + '">' +
      (b.logo ? '<img src="/brand-logo.png" alt="" style="position:absolute;top:14px;' + (b.align === 'right' ? 'left' : 'right') + ':18px;height:34px;border-radius:8px;background:#fff;padding:3px 6px">' : '') +
      '<div class="op-ed" data-e="banner:t" style="font-size:2em;font-weight:800;line-height:1.15;text-shadow:0 2px 10px rgba(0,0,0,.25)">' + (C.edits['banner:t'] != null ? C.edits['banner:t'] : esc(title)) + '</div><div class="op-ed" data-e="banner:s" style="font-size:1.05em;opacity:.92;margin-top:6px">' + (C.edits['banner:s'] != null ? C.edits['banner:s'] : esc(sub)) + '</div></section>';
  }
  function pageHtml() {
    var t = T(), pg = PAGE[C.page] || PAGE.a4p, fs = C.dens === 'compact' ? 12 : C.dens === 'roomy' ? 15 : 13.5, gap = C.dens === 'compact' ? 10 : C.dens === 'roomy' ? 18 : 14;
    var h = '<div id="op-page" style="width:' + pg[1] + 'px;' + (pg[2] ? 'min-height:' + pg[2] + 'px;' : '') + 'box-sizing:border-box;background:' + t.bg + ';color:' + t.ink + ';font-family:' + FONTS[C.font][1] + ';font-size:' + fs + 'px;padding:' + (gap + 8) + 'px;display:grid;grid-template-columns:repeat(6,1fr);gap:' + gap + 'px;align-content:start;grid-auto-flow:row dense">';
    C.blocks.forEach(function (bk) {
      if (!bk.on) return; if (bk.k === 'banner') { h += bannerHtml(); return; }
      var ti = C.edits[bk.k + ':t'] != null ? C.edits[bk.k + ':t'] : esc((IC[bk.k] || '') + ' ' + (bk.k === 'done' ? 'Work done · ' + ((G && G.month) || 'this month') : bk.k === 'next' ? 'Plan for ' + ((G && G.nextM) || 'next month') : BL[bk.k]));
      h += '<section data-b="' + bk.k + '" style="grid-column:span ' + bk.sp + ';background:' + t.card + ';border-radius:16px;padding:' + (gap + 2) + 'px;border:1px solid ' + t.line + ';box-shadow:0 4px 14px rgba(20,24,51,.05);min-width:0"><h3 class="op-ed" data-e="' + bk.k + ':t" style="margin:0 0 10px;font-size:1.12em;font-weight:800;color:' + t.ink + ';display:flex;gap:6px;align-items:center;border-bottom:2px solid ' + t.acc + ';padding-bottom:6px">' + ti + '</h3><div class="op-ed" data-e="' + bk.k + '">' + (C.edits[bk.k] != null ? C.edits[bk.k] : body(bk.k)) + '</div></section>';
    });
    return h + '<div style="grid-column:span 6;display:flex;justify-content:space-between;font-size:.78em;color:' + t.sub + ';padding:2px 4px"><span>vivo Business Innovation · Monthly one-pager</span><span>' + esc((G && G.title) || '') + '</span></div></div>';
  }

  // ---------- page ----------
  var W = null, EDIT = false;
  var CSS = '<style id="op-css">.op{display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start}.op-ctl{background:#fff;border:1px solid #e6e2d4;border-radius:16px;padding:12px;position:sticky;top:8px;max-height:calc(100vh - 30px);overflow:auto}.op-ctl h4{margin:12px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8a8573}.op-ctl h4:first-child{margin-top:0}.op-ctl label{display:block;font-size:12px;color:#5d584a;margin:6px 0 2px}.op-ctl input[type=text],.op-ctl select,.op-ctl textarea{width:100%;box-sizing:border-box;border:1px solid #d9d3bf;border-radius:9px;padding:7px 9px;font:inherit;font-size:13px;background:#fff}.op-ctl input[type=range]{width:100%}.op-sw{display:flex;flex-wrap:wrap;gap:6px}.op-sw button{width:34px;height:34px;border-radius:10px;border:2px solid transparent;cursor:pointer}.op-sw button.on{border-color:#111;box-shadow:0 0 0 2px #fff inset}.op-row{display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid #f1ecdc;font-size:13px}.op-row b{flex:1;font-weight:600}.op-row select{width:auto!important;padding:3px 4px!important;font-size:12px!important}.op-row button,.op-btn{border:1px solid #d9d3bf;background:#fff;border-radius:8px;padding:3px 8px;cursor:pointer;font-size:12px}.op-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.op-bar .op-btn{padding:8px 12px;font-size:13px;font-weight:600}.op-bar .dk{background:#111;color:#e6cf86;border-color:#111}.op-stage{overflow:hidden;border-radius:12px;background:#e9e6dc;padding:10px}.op-stage>div{transform-origin:0 0}.op-editing .op-ed{outline:1px dashed rgba(65,95,255,.45);outline-offset:3px;border-radius:4px;cursor:text}.op-editing .op-ed:focus{outline:2px solid #415FFF;background:rgba(65,95,255,.04)}.op-hint{font-size:11.5px;color:#7a7462;margin-top:6px}@media(max-width:860px){.op{grid-template-columns:1fr}.op-ctl{position:static;max-height:none}}</style>';
  function ctlHtml() {
    var sel = function (id, cur, opts) { return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
    var b = C.banner;
    return '<h4>Theme & look</h4><div class="op-sw">' + Object.keys(TH).map(function (k) { var t = TH[k]; return '<button type="button" data-th="' + k + '" title="' + esc(t.n) + '" class="' + (C.theme === k ? 'on' : '') + '" style="background:linear-gradient(135deg,' + t.acc + ' 0 50%,' + t.bg + ' 50%)"></button>'; }).join('') + '</div>' +
      '<label>Accent colour</label><div style="display:flex;gap:6px"><input type="color" id="op-acc" value="' + (C.acc || T().acc) + '" style="flex:1;height:32px;border:1px solid #d9d3bf;border-radius:9px;padding:2px"><button class="op-btn" id="op-acc0" type="button">Theme colour</button></div>' +
      '<label>Font</label>' + sel('op-font', C.font, Object.keys(FONTS).map(function (k) { return [k, FONTS[k][0]]; })) +
      '<h4>Layout</h4><label>Arrangement</label>' + sel('op-lay', C.layout, Object.keys(LAY).map(function (k) { return [k, LAY[k].n]; })) +
      '<label>Page size</label>' + sel('op-pg', C.page, Object.keys(PAGE).map(function (k) { return [k, PAGE[k][0]]; })) +
      '<label>Spacing</label>' + sel('op-dn', C.dens, [['compact', 'Compact'], ['normal', 'Normal'], ['roomy', 'Roomy']]) +
      '<h4>Banner</h4><label>Title</label><input type="text" id="op-bt" value="' + esc(b.title) + '" placeholder="BI Monthly Report · ' + esc((G && G.month) || '') + '"><label>Subtitle</label><input type="text" id="op-bs" value="' + esc(b.sub) + '" placeholder="vivo Business Innovation">' +
      '<label>Background picture</label><div style="display:flex;gap:6px"><input type="file" id="op-bi" accept="image/*" style="flex:1;font-size:12px">' + (b.img ? '<button class="op-btn" id="op-bx" type="button">Remove</button>' : '') + '</div>' +
      '<label>Text position</label>' + sel('op-ba', b.align, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]) +
      '<label>Height <b id="op-bhv">' + b.h + '</b> px</label><input type="range" id="op-bh" min="90" max="320" value="' + b.h + '">' +
      (b.img ? '<label>Darken picture <b id="op-bdv">' + b.dark + '</b>%</label><input type="range" id="op-bd" min="0" max="80" value="' + b.dark + '">' : '') +
      '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="op-bl"' + (b.logo ? ' checked' : '') + '> Show vivo BI logo</label>' +
      '<h4>Sections · show, size, order</h4>' + C.blocks.map(function (bk, i) { var ed = Object.keys(C.edits).some(function (e) { return e === bk.k || e.indexOf(bk.k + ':') === 0; }); return '<div class="op-row"><input type="checkbox" data-on="' + i + '"' + (bk.on ? ' checked' : '') + '><b>' + (IC[bk.k] || '🖼️') + ' ' + esc(BL[bk.k]) + '</b>' + (bk.k !== 'banner' ? '<select data-sp="' + i + '">' + SPAN.map(function (s) { return '<option value="' + s[0] + '"' + (bk.sp === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>' : '') + '<button type="button" data-up="' + i + '" title="Move up">↑</button><button type="button" data-dn="' + i + '" title="Move down">↓</button>' + (ed ? '<button type="button" data-rs="' + bk.k + '" title="Undo my text edits in this section">↺</button>' : '') + '</div>'; }).join('') +
      '<h4>Message / notes</h4><textarea id="op-nt" rows="3">' + esc(C.notes) + '</textarea>' +
      '<div class="op-hint">Data comes from the Monthly summary page — its period, state filter and project selection. Change them there, then tap ↻ Refresh data.</div>';
  }
  function fit() { if (!W) return; var st = W.querySelector('.op-stage'), pg = W.querySelector('#op-page'); if (!st || !pg) return; var inner = st.firstChild, avail = st.clientWidth - 20, s = Math.min(1, avail / pg.offsetWidth); inner.style.transform = 'scale(' + s + ')'; inner.style.width = pg.offsetWidth + 'px'; st.style.height = (pg.offsetHeight * s + 20) + 'px'; }
  function paint() {
    var st = W.querySelector('.op-stage'); st.innerHTML = '<div>' + pageHtml() + '</div>';
    var pg = st.querySelector('#op-page'); pg.classList.toggle('op-editing', EDIT);
    [].forEach.call(pg.querySelectorAll('.op-ed'), function (el) { el.contentEditable = EDIT ? 'true' : 'false'; el.oninput = function () { C.edits[el.dataset.e] = el.innerHTML; save(); var k = el.dataset.e.split(':')[0], r = W.querySelector('[data-rs="' + k + '"]'); if (!r) drawCtl(); }; });
    [].forEach.call(pg.querySelectorAll('img'), function (im) { if (!im.complete) im.onload = fit; });
    fit();
  }
  function drawCtl() {
    var c = W.querySelector('.op-ctl'), y = c.scrollTop; c.innerHTML = ctlHtml(); c.scrollTop = y;
    var on = function (id, ev, fn) { var e = c.querySelector('#' + id); if (e) e[ev] = fn; };
    var up = function () { save(); paint(); };
    [].forEach.call(c.querySelectorAll('[data-th]'), function (b) { b.onclick = function () { C.theme = b.dataset.th; C.acc = ''; save(); drawCtl(); paint(); }; });
    on('op-acc', 'oninput', function () { C.acc = this.value; up(); }); on('op-acc0', 'onclick', function () { C.acc = ''; save(); drawCtl(); paint(); });
    on('op-font', 'onchange', function () { C.font = this.value; up(); });
    on('op-lay', 'onchange', function () { var L = LAY[this.value]; C.layout = this.value; if (L.o) C.blocks.sort(function (a, b) { return L.o.indexOf(a.k) - L.o.indexOf(b.k); }); C.blocks.forEach(function (bk) { if (bk.k !== 'banner') bk.sp = L.sp[bk.k] || 6; }); save(); drawCtl(); paint(); });
    on('op-pg', 'onchange', function () { C.page = this.value; up(); }); on('op-dn', 'onchange', function () { C.dens = this.value; up(); });
    on('op-bt', 'oninput', function () { C.banner.title = this.value; delete C.edits['banner:t']; up(); }); on('op-bs', 'oninput', function () { C.banner.sub = this.value; delete C.edits['banner:s']; up(); });
    on('op-ba', 'onchange', function () { C.banner.align = this.value; up(); });
    on('op-bh', 'oninput', function () { C.banner.h = +this.value; c.querySelector('#op-bhv').textContent = this.value; up(); });
    on('op-bd', 'oninput', function () { C.banner.dark = +this.value; c.querySelector('#op-bdv').textContent = this.value; up(); });
    on('op-bl', 'onchange', function () { C.banner.logo = this.checked; up(); });
    on('op-bx', 'onclick', function () { C.banner.img = ''; save(); drawCtl(); paint(); });
    on('op-bi', 'onchange', function () { var f = this.files && this.files[0]; if (!f) return; var fr = new FileReader(); fr.onload = function () { var im = new Image(); im.onload = function () { var s = Math.min(1, 1600 / im.width), cv = document.createElement('canvas'); cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); C.banner.img = cv.toDataURL('image/jpeg', 0.82); C.blocks.forEach(function (bk) { if (bk.k === 'banner') bk.on = true; }); save(); drawCtl(); paint(); }; im.src = fr.result; }; fr.readAsDataURL(f); });
    on('op-nt', 'oninput', function () { C.notes = this.value; delete C.edits.notes; up(); });
    [].forEach.call(c.querySelectorAll('[data-on]'), function (x) { x.onchange = function () { C.blocks[+x.dataset.on].on = x.checked; up(); }; });
    [].forEach.call(c.querySelectorAll('[data-sp]'), function (x) { x.onchange = function () { C.blocks[+x.dataset.sp].sp = +x.value; up(); }; });
    var mv = function (i, d) { var j = i + d; if (j < 0 || j >= C.blocks.length) return; var t = C.blocks[i]; C.blocks[i] = C.blocks[j]; C.blocks[j] = t; save(); drawCtl(); paint(); };
    [].forEach.call(c.querySelectorAll('[data-up]'), function (x) { x.onclick = function () { mv(+x.dataset.up, -1); }; });
    [].forEach.call(c.querySelectorAll('[data-dn]'), function (x) { x.onclick = function () { mv(+x.dataset.dn, 1); }; });
    [].forEach.call(c.querySelectorAll('[data-rs]'), function (x) { x.onclick = function () { var k = x.dataset.rs; Object.keys(C.edits).forEach(function (e) { if (e === k || e.indexOf(k + ':') === 0) delete C.edits[e]; }); save(); drawCtl(); paint(); }; });
  }
  function libJs(src, test) { return new Promise(function (res, rej) { if (test()) return res(); var s = document.createElement('script'); s.src = src; s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  function dl(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
  function snap(jpg) {
    var was = EDIT; EDIT = false; paint(); var pg = W.querySelector('#op-page');
    return libJs('/vendor/html-to-image.js', function () { return !!window.htmlToImage; }).then(function () { var o = {pixelRatio: 2, width: pg.offsetWidth, height: pg.offsetHeight, style: {transform: 'none'}, cacheBust: false, backgroundColor: T().bg}; return jpg ? htmlToImage.toJpeg(pg, Object.assign(o, {quality: 0.88})) : htmlToImage.toPng(pg, o); }).then(function (png) { if (was) { EDIT = true; paint(); } return {png: png, w: pg.offsetWidth, h: pg.offsetHeight}; });
  }
  function fname(ext) { return 'BI_OnePager_' + String((G && G.month) || 'report').replace(/[^\w]+/g, '_') + '.' + ext; }
  function say(t) { var s = W && W.querySelector('#op-st'); if (s) s.textContent = t; }
  function render(w) {
    W = w; G = digest(); INS = insights();
    if (!document.getElementById('op-css')) document.head.insertAdjacentHTML('beforeend', CSS);
    var head = '<div style="margin:4px 0 14px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a8573">Communicate</div><h2 style="margin:2px 0 4px">📄 Monthly one-pager</h2><div style="color:#6b6657;font-size:14px;max-width:60rem">A one-page report built from the Monthly summary: key indicators, insights, analysis, every project’s status, this month’s work and next month’s plan — with your banner. Click any text on the page to edit it, pick a theme and layout, then download PNG or PDF.</div></div>';
    if (!G) { w.innerHTML = head + '<div style="background:#fff;border:1px solid #e6e2d4;border-radius:16px;padding:18px">The Monthly summary hasn’t loaded yet. <button class="op-btn" id="op-ms" type="button">Open Monthly summary</button> once, then come back here.</div>'; var b0 = w.querySelector('#op-ms'); if (b0) b0.onclick = function () { if (window.BIPRO) BIPRO.open('pro_ms'); }; return; }
    w.innerHTML = head + '<div class="op"><div class="op-ctl"></div><div><div class="op-bar"><button class="op-btn" id="op-ed" type="button">✏️ Edit text on the page</button><button class="op-btn dk" id="op-png" type="button">⬇ PNG</button><button class="op-btn dk" id="op-pdf" type="button">⬇ PDF</button><button class="op-btn" id="op-rf" type="button">↻ Refresh data</button><button class="op-btn" id="op-rst" type="button">Reset</button><span id="op-st" style="align-self:center;font-size:12.5px;color:#6b6657"></span></div><div class="op-stage"></div></div></div>';
    drawCtl(); paint();
    var eb = w.querySelector('#op-ed'); eb.onclick = function () { EDIT = !EDIT; eb.textContent = EDIT ? '✓ Done editing' : '✏️ Edit text on the page'; eb.classList.toggle('dk', EDIT); paint(); say(EDIT ? 'Click any heading, number or sentence on the page and type.' : 'Edits saved on this device.'); };
    w.querySelector('#op-png').onclick = function () { say('Making PNG…'); snap().then(function (r) { return fetch(r.png).then(function (x) { return x.blob(); }); }).then(function (b) { dl(b, fname('png')); say('✅ PNG downloaded'); }).catch(function (e) { say('❌ ' + (e.message || e)); }); };
    w.querySelector('#op-pdf').onclick = function () { say('Making PDF…'); Promise.all([snap(true), libJs('/vendor/jspdf/jspdf.umd.min.js', function () { return !!(window.jspdf && window.jspdf.jsPDF); })]).then(function (x) { var r = x[0], P = new window.jspdf.jsPDF({orientation: r.w > r.h ? 'landscape' : 'portrait', unit: 'px', format: [r.w, r.h], hotfixes: ['px_scaling']}); P.addImage(r.png, 'JPEG', 0, 0, r.w, r.h); dl(P.output('blob'), fname('pdf')); say('✅ PDF downloaded'); }).catch(function (e) { say('❌ ' + (e.message || e)); }); };
    w.querySelector('#op-rf').onclick = function () { G = digest(); INS = insights(); drawCtl(); paint(); say('Data refreshed from the Monthly summary' + (Object.keys(C.edits).length ? ' — sections you edited keep your text (↺ to undo)' : '')); };
    w.querySelector('#op-rst').onclick = function () { if (this.dataset.sure) { C = def(); save(); drawCtl(); paint(); say('Reset to the default design'); delete this.dataset.sure; this.textContent = 'Reset'; } else { this.dataset.sure = 1; this.textContent = 'Tap again to reset everything'; } };
    if (!window.__opRs) { window.__opRs = 1; window.addEventListener('resize', function () { fit(); }); }
  }
  window.BIOP = {render: render};
})();
