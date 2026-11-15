// Excel macro builder — describe what you need, answer the tool's questions, get a macro-enabled .xlsm with sample
// data, a Settings sheet and one-click buttons. The macros come from tested, hand-written blocks (xm-lib.mjs); AI picks
// and configures them, can tailor the sample data and may add a custom macro (shown clearly as AI-written).
// Storage:  xmt:<user>:<id>  saved templates (the plan, not the file — files are rebuilt on download)
import { randomBytes } from "node:crypto";
import zlib from "node:zlib";
import { buildVbaProject } from "./vba-core.mjs";
import { CORE, BLOCKS, BLOCK_IDS } from "./xm-lib.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").slice(0, n);
const xe = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colL = (n) => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// ---------------- minimal ZIP writer (deflate) ----------------
const CRCT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRCT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8"), comp = zlib.deflateRawSync(data), name = Buffer.from(f.name, "utf8"), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---------------- plan → sheets + modules ----------------
const BAD_VBA = /\b(Shell|Kill|RmDir|DeleteFile|DeleteFolder|URLDownloadToFile|WScript|powershell|cmd\.exe|Declare\s+(PtrSafe\s+)?(Function|Sub)|RegWrite|RegDelete|SendKeys|Environ|ADODB\.Stream|XMLHTTP|WinHttp)\b/i;
const serial = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso)); return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000) : null; };

export function cleanPlan(p) {
  p = p || {};
  const blocks = (Array.isArray(p.blocks) ? p.blocks : []).filter((b, i, a) => BLOCKS[b] && a.indexOf(b) === i).slice(0, 5);
  const settings = {}; Object.keys(p.settings || {}).slice(0, 40).forEach((k) => { settings[str(k, 40)] = txt(p.settings[k], 300); });
  let data = null;
  if (p.data && Array.isArray(p.data.cols) && p.data.cols.length) {
    const cols = p.data.cols.slice(0, 30).map((c) => [str(Array.isArray(c) ? c[0] : c, 40), ["text", "number", "money", "date", "long", "path", "email", "phone"].includes(Array.isArray(c) ? c[1] : "") ? c[1] : "text"]).filter((c) => c[0]);
    const rows = (Array.isArray(p.data.rows) ? p.data.rows : []).slice(0, 200).map((r) => (Array.isArray(r) ? r : []).slice(0, cols.length).map((v) => typeof v === "number" ? v : txt(v, 300)));
    if (cols.length) data = { sheet: str(p.data.sheet, 31) || "Data", cols, rows };
  }
  const custom = (Array.isArray(p.custom) ? p.custom : []).slice(0, 4).map((c) => {
    const name = str(c.name, 30).replace(/[^A-Za-z0-9_]/g, ""), code = txt(c.code, 12000);
    if (!/^[A-Za-z]/.test(name) || !new RegExp("\\bSub\\s+" + name + "\\b", "i").test(code)) return null;
    if (BAD_VBA.test(code)) return { name, label: str(c.label, 50) || name, blocked: true, code: "" };
    return { name, label: str(c.label, 50) || name, code, help: str(c.help, 200) };
  }).filter(Boolean);
  return { title: str(p.title, 80) || (blocks.length ? BLOCKS[blocks[0]].name : "Excel macro template"), desc: txt(p.desc, 600), blocks, settings, data, custom, steps: (Array.isArray(p.steps) ? p.steps : []).slice(0, 8).map((s) => str(s, 200)).filter(Boolean) };
}

function assemble(plan) {
  const sheets = [], settings = [], macros = [], modules = [];
  const sheetBy = {};
  for (const id of plan.blocks) {
    const B = BLOCKS[id];
    for (const s of B.sheets) {
      if (!sheetBy[s.name]) { sheetBy[s.name] = { name: s.name, cols: s.cols.map((c) => c.slice()), rows: s.rows.map((r) => r.slice()), note: s.note }; sheets.push(sheetBy[s.name]); }
      else { const t = sheetBy[s.name]; s.cols.forEach((c) => { if (!t.cols.some((x) => x[0].toLowerCase() === c[0].toLowerCase())) { const at = t.cols.findIndex((x) => x[0] === "Status"); if (at >= 0) { t.cols.splice(at, 0, c.slice()); t.rows.forEach((r) => r.splice(at, 0, "")); } else t.cols.push(c.slice()); } }); }
    }
    for (const st of B.settings) if (!settings.some((x) => x[0] === st[0])) settings.push(st.slice());
    for (const m of B.macros) if (!macros.some((x) => x[0] === m[0])) macros.push([m[0], m[1], B.name]);
    modules.push({ name: "m" + id.charAt(0).toUpperCase() + id.slice(1), code: B.code });
  }
  // AI / user sample data for a sheet: must keep the headers the macros need (those named in settings stay as they are)
  if (plan.data) {
    const t = sheetBy[plan.data.sheet];
    const widths = { text: 16, number: 10, money: 13, date: 12, long: 44, path: 44, email: 28, phone: 15 };
    const sh = { name: plan.data.sheet, cols: plan.data.cols.map((c) => [c[0], c[1], Math.max(widths[c[1]] || 16, Math.min(40, c[0].length + 3))]), rows: plan.data.rows, note: t ? t.note : "Paste your raw data here (row 1 = headers)." };
    if (t) { const need = t.cols.filter((c) => /^(Status|Old name|New name|To|Subject|Message|Phone|File path)$/.test(c[0]) && !sh.cols.some((x) => x[0].toLowerCase() === c[0].toLowerCase())); need.forEach((c) => { sh.cols.push(c.slice()); sh.rows.forEach((r) => r.push("")); }); Object.assign(t, sh); }
    else { sheetBy[sh.name] = sh; sheets.push(sh); }
  }
  for (const k of Object.keys(plan.settings)) { const s = settings.find((x) => x[0].toLowerCase() === k.toLowerCase()); if (s) s[1] = plan.settings[k]; else settings.push([k, plan.settings[k], ""]); }
  const cust = plan.custom.filter((c) => !c.blocked);
  if (cust.length) { modules.push({ name: "mCustom", code: "Option Explicit\n' ===== Written by AI for this template — read it before relying on it =====\n\n" + cust.map((c) => c.code.replace(/^\s*Option Explicit\s*$/gim, "")).join("\n\n") + "\n" }); cust.forEach((c) => macros.push([c.name, "✨ " + c.label, "AI-written"])); }
  return { sheets, settings, macros, modules };
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts><fonts count="7"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF2B33A6"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF5B6080"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF8A5300"/><name val="Calibri"/></font><font><sz val="8"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4D5BF9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF0FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF4E5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9DCEB"/></left><right style="thin"><color rgb="FFD9DCEB"/></right><top style="thin"><color rgb="FFD9DCEB"/></top><bottom style="thin"><color rgb="FFD9DCEB"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="5" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
// style ids: 1 header · 2 text · 3 date · 4 number · 5 title · 6 muted · 7 button · 8 settings key · 9 note · 10 hidden tiny
const cell = (ref, v, s) => v === "" || v == null ? (s ? `<c r="${ref}" s="${s}"/>` : "") : typeof v === "number" ? `<c r="${ref}" s="${s || 0}"><v>${v}</v></c>` : `<c r="${ref}" s="${s || 0}" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
function sheetXml(o) {
  // o: { code, cols:[width], rows:[{ht, cells:[[col, value, style]]}], freeze, merges:[], links:[{ref, loc}], filter }
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr codeName="${o.code}"/><sheetViews><sheetView workbookViewId="0"${o.grid === false ? ' showGridLines="0"' : ""}>${o.freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ""}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>`;
  if (o.cols && o.cols.length) x += "<cols>" + o.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>";
  x += "<sheetData>" + o.rows.map((r, ri) => r && r.cells.length ? `<row r="${ri + 1}"${r.ht ? ` ht="${r.ht}" customHeight="1"` : ""}>${r.cells.map((c) => cell(colL(c[0]) + (ri + 1), c[1], c[2])).join("")}</row>` : "").join("") + "</sheetData>";
  if (o.filter) x += `<autoFilter ref="${o.filter}"/>`;
  if (o.merges && o.merges.length) x += `<mergeCells count="${o.merges.length}">` + o.merges.map((m) => `<mergeCell ref="${m}"/>`).join("") + "</mergeCells>";
  if (o.links && o.links.length) x += "<hyperlinks>" + o.links.map((l) => `<hyperlink ref="${l.ref}" location="${xe(l.loc)}" display="${xe(l.text)}"/>`).join("") + "</hyperlinks>";
  return x + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>';
}

export function buildXlsm(planIn) {
  const plan = cleanPlan(planIn), A = assemble(plan);
  if (!A.macros.length) throw new Error("Choose at least one macro block");
  const out = [];   // { name, xml, module }
  // ----- Start sheet -----
  const rows = [];
  const put = (r, cells, ht) => { rows[r - 1] = { cells, ht }; };
  put(1, [[1, plan.title, 5]], 30);
  put(2, [[1, plan.desc || "Macro-enabled template built with the vivo BI Excel macro builder.", 6]], 34);
  put(3, [[1, "⚠ First: click “Enable Content” in the yellow bar at the top. (If Excel blocks the file: right-click it in the folder → Properties → tick Unblock → OK, then open it again.)", 9]], 32);
  const steps = plan.steps.length ? plan.steps : ["Replace the sample rows on the data sheet(s) with your own data — keep the header row.", "Check the Settings sheet (folders, column names, send mode).", "Click a button below. Results and any problems are written in the Status column and on the Log sheet."];
  put(5, [[1, "How to use", 8]]);
  steps.forEach((s, i) => put(6 + i, [[1, (i + 1) + ". " + s, 2]], 30));
  let r = 7 + steps.length;
  put(r, [[1, "One-click actions", 8]]); r++;
  const links = [], merges = ["B1:F1", "B2:F2", "B3:F3"];
  steps.forEach((s, i) => merges.push(`B${6 + i}:F${6 + i}`));
  A.macros.forEach((m) => { put(r, [[1, m[1], 7], [2, "", 7], [3, m[2] === "AI-written" ? "AI-written macro — test it on a copy first" : "from: " + m[2], 6], [7, m[0], 10]], 30); links.push({ ref: "B" + r, loc: "'Start'!B" + r, text: m[1] }); merges.push(`B${r}:C${r}`); r += 2; });
  put(r, [[1, "Sheets in this file: " + ["Settings"].concat(A.sheets.map((s) => s.name), ["Log"]).join(" · "), 6]]);
  out.push({ name: "Start", module: "Private Sub Worksheet_FollowHyperlink(ByVal Target As Hyperlink)\n    RunFromStart Target.Range.Row\nEnd Sub\n", xml: { cols: [3, 30, 14, 46, 12, 12, 4, 4], rows: rows.map((x) => x || { cells: [] }), merges, links, grid: false } });
  // ----- Settings -----
  out.push({ name: "Settings", xml: { cols: [26, 44, 70], freeze: true, rows: [{ cells: [[0, "Setting", 1], [1, "Value", 1], [2, "What it does", 1]] }].concat(A.settings.map((s) => ({ cells: [[0, s[0], 8], [1, /^\d+$/.test(String(s[1])) ? +s[1] : s[1], 2], [2, s[2] || "", 6]] }))) } });
  // ----- block sheets -----
  for (const s of A.sheets) {
    const sty = { date: 3, number: 4, money: 4 };
    const rws = [{ ht: 22, cells: s.cols.map((c, i) => [i, c[0], 1]) }].concat(s.rows.map((row) => ({ cells: s.cols.map((c, i) => { let v = row[i]; if (c[1] === "date") { const d = serial(v); if (d != null) v = d; } else if ((c[1] === "number" || c[1] === "money") && v !== "" && v != null && !isNaN(+v)) v = +v; return [i, v == null ? "" : v, sty[c[1]] || 2]; }) })));
    out.push({ name: s.name, xml: { cols: s.cols.length ? s.cols.map((c) => c[2] || 16) : [22], freeze: s.cols.length > 0, rows: rws, filter: s.cols.length && s.rows.length ? `A1:${colL(s.cols.length - 1)}${s.rows.length + 1}` : null } });
  }
  out.push({ name: "Log", xml: { cols: [20, 22, 50, 40], freeze: true, rows: [{ cells: [[0, "When", 1], [1, "Action", 1], [2, "Detail", 1], [3, "Result", 1]] }] } });
  out.forEach((s, i) => { s.code = "Sheet" + (i + 1); s.xml.code = s.code; });
  // ----- VBA project -----
  const mods = [{ name: "ThisWorkbook", doc: "workbook", code: "Private Sub Workbook_Open()\n    On Error Resume Next\n    MakeButtons\n    ThisWorkbook.Worksheets(\"Start\").Activate\nEnd Sub\n" }]
    .concat(out.map((s) => ({ name: s.code, doc: "sheet", code: s.module || "" })), [{ name: "vbiCore", code: CORE }], A.modules);
  const vba = buildVbaProject(mods);
  // ----- package -----
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>${out.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(plan.title)}</dc:title><dc:creator>vivo BI Excel macro builder</dc:creator></cp:coreProperties>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr codeName="ThisWorkbook"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>${out.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${out.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${out.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${out.length + 2}" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>` },
    { name: "xl/styles.xml", data: STYLES },
    ...out.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.xml) })),
    { name: "xl/vbaProject.bin", data: vba },
  ];
  const vbaText = mods.filter((m) => !m.doc || m.code).map((m) => `' ==================== ${m.name} ====================\n` + m.code).join("\n\n");
  return { buf: zip(files), plan, sheets: out.map((s) => s.name), macros: A.macros.map((m) => ({ name: m[0], label: m[1], from: m[2] })), settings: A.settings, vba: vbaText, blocked: plan.custom.filter((c) => c.blocked).map((c) => c.label) };
}

// ---------------- AI: turn the conversation into questions or a plan ----------------
const CATALOG = BLOCK_IDS.map((id) => { const B = BLOCKS[id]; return `- "${id}": ${B.name} — ${B.desc} Sheets: ${B.sheets.map((s) => s.name + (s.cols.length ? " [" + s.cols.map((c) => c[0]).join(", ") + "]" : "")).join("; ")}. Settings: ${B.settings.map((s) => s[0] + " (default " + (s[1] || "empty") + ")").join(", ")}.`; }).join("\n");
const SYS = `You design macro-enabled Excel templates for vivo India's Business Innovation team (sales, dealers, schemes, IMEI, promoters). You never write the standard macros yourself: you choose from tested building blocks and configure them.
BLOCKS:
${CATALOG}
Reply with ONE JSON object only, in one of two shapes:
1) {"ask":[{"q":"short question","options":["2-4 short choices"]}]} — when something important is unclear (max 3 questions, only what changes the template: which data, split by what, send by e-mail or WhatsApp, Excel or PDF…). Do not ask if the user already said it, and never ask more than twice in a conversation.
2) {"plan":{"title":"…","desc":"one sentence","blocks":["block ids, most important first, max 4"],"settings":{"Setting name":"value"},"data":{"sheet":"Data","cols":[["Header","text|number|money|date|long|path|email|phone"]],"rows":[[…]]},"steps":["3-5 short steps for the user"],"custom":[{"name":"MacroName","label":"Button text","help":"what it does","code":"Public Sub MacroName()\\n…\\nEnd Sub"}]}}
Rules for a plan: "data" is optional — include it when the user described their own columns; give 12-20 realistic Indian sample rows; dates as YYYY-MM-DD; for the dashboard block set the settings "Group 1", "Group 2", "Value column", "Qty column", "Date column", "Count column" to headers that exist in your data; for split set "Split by". Keep headers that macros need: Rename[Old name,New name,Status], Mail list[To,Subject,Message,Status], WhatsApp[Phone,Message,Status], Files[File path,Status]. "custom" only when no block can do a needed step: plain VBA for Excel on Windows, one Public Sub per item, Option Explicit style (declare all variables), may call helpers Setting("key"), ColOf(ws,"Header"), NeedCol, LastRow(ws,col), LastDataRow(ws), FolderPath, EnsureFolder, SafeName, FillPattern, FillRow, LogLine, SpeedOn, SpeedOff, PickFolder; never use Shell, Kill, API Declares, SendKeys or internet downloads.`;

export async function xmAction(b, ctx) {
  const { store, t, app, rec, key, env = {}, askAI, aiFetch } = ctx;
  const uk = app + ":" + key, by = rec.fullName || rec.username || "";
  if (b.action === "xm-blocks") return json(200, { ok: true, blocks: BLOCK_IDS.map((id) => ({ id, name: BLOCKS[id].name, icon: BLOCKS[id].icon, desc: BLOCKS[id].desc, macros: BLOCKS[id].macros.map((m) => m[1]), sheets: BLOCKS[id].sheets.map((s) => s.name) })) });
  if (b.action === "xm-chat") {
    const msgs = (Array.isArray(b.messages) ? b.messages : []).slice(-12).map((m) => (m.role === "ai" ? "TOOL: " : "USER: ") + txt(m.text, 1500));
    if (!msgs.length) return json(400, { ok: false, error: "Describe what you need" });
    if (!askAI) return json(400, { ok: false, error: "AI is not set up yet — use the ready templates." });
    const asked = msgs.filter((m) => /^TOOL: \?/.test(m)).length;
    const r = await askAI(env, asked >= 2 ? "You have asked enough. Reply now with the {\"plan\":…} JSON for this request." : "Reply with the JSON: either {\"ask\":[…]} if something important is unclear, or the {\"plan\":…}.", msgs.join("\n"), [], aiFetch, { system: SYS, label: "CONVERSATION", json: true, maxTokens: 6000 });
    if (!r.ok) return json(502, { ok: false, error: r.error || "AI didn't answer — try again, or use a ready template." });
    let j = null; try { j = JSON.parse(String(r.text).replace(/^[^{]*/, "").replace(/[^}]*$/, "")); } catch (e) { }
    if (j && Array.isArray(j.ask) && j.ask.length && asked < 2) return json(200, { ok: true, ask: j.ask.slice(0, 3).map((q) => ({ q: str(q.q, 200), options: (Array.isArray(q.options) ? q.options : []).map((o) => str(o, 60)).filter(Boolean).slice(0, 4) })).filter((q) => q.q) });
    if (j && j.plan) { const plan = cleanPlan(j.plan); if (plan.blocks.length || plan.custom.some((c) => !c.blocked)) return json(200, { ok: true, plan, blocked: plan.custom.filter((c) => c.blocked).map((c) => c.label) }); }
    return json(502, { ok: false, error: "I couldn't turn that into a template. Say it in a little more detail, or pick a ready template." });
  }
  if (b.action === "xm-build") {
    let res; try { res = buildXlsm(b.plan); } catch (e) { return json(400, { ok: false, error: String(e.message || e) }); }
    const name = (res.plan.title.replace(/[^\w \-]+/g, "").trim().replace(/\s+/g, "_") || "Macro_template") + ".xlsm";
    if (b.save) { const id = str(b.id, 20) || "T" + t.toString(36).toUpperCase() + randomBytes(2).toString("hex"); await store.set(`xmt:${uk}:${id}`, { id, at: t, by, plan: res.plan, chat: (Array.isArray(b.chat) ? b.chat : []).slice(-12).map((m) => ({ role: m.role === "ai" ? "ai" : "user", text: txt(m.text, 1500) })) }); }
    return json(200, { ok: true, name, b64: res.buf.toString("base64"), sheets: res.sheets, macros: res.macros, settings: res.settings, vba: res.vba, blocked: res.blocked, plan: res.plan });
  }
  if (b.action === "xm-list") {
    const L = (await Promise.all((await store.list(`xmt:${uk}:`)).map((k) => store.get(k)))).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, 60);
    return json(200, { ok: true, rows: L.map((x) => ({ id: x.id, at: x.at, title: x.plan.title, desc: x.plan.desc, blocks: x.plan.blocks, plan: x.plan, chat: x.chat || [] })) });
  }
  if (b.action === "xm-del") { await store.delete(`xmt:${uk}:${str(b.id, 20)}`); return json(200, { ok: true }); }
  return json(400, { ok: false, error: "Unknown action" });
}
