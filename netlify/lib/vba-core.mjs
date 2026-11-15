// Builds xl/vbaProject.bin (the macros inside an .xlsm) from plain VBA source, following Microsoft's
// [MS-OVBA] (VBA project structure + compression) and [MS-CFB] (compound file) specifications.
// The _VBA_PROJECT stream is written with version 0xFFFF, so Excel ignores the (absent) compiled cache and
// compiles the modules from the source text on first open.
import { randomBytes } from "node:crypto";

// ---------------- MS-OVBA 2.4.1 compression ----------------
function compressChunk(src, start, end) {
  const out = [];
  let cur = start;
  while (cur < end) {
    const flagPos = out.length; out.push(0); let flags = 0;
    for (let bit = 0; bit < 8 && cur < end; bit++) {
      const diff = cur - start;
      let bitCount = 4; while ((1 << bitCount) < diff) bitCount++;
      const maxLen = (0xFFFF >> bitCount) + 3;
      let bestLen = 0, bestOff = 0;
      const lim = Math.min(maxLen, end - cur);
      if (diff > 0 && lim >= 3) {
        for (let cand = cur - 1; cand >= start; cand--) {
          let l = 0; while (l < lim && src[cand + l] === src[cur + l]) l++;
          if (l > bestLen) { bestLen = l; bestOff = cur - cand; if (l === lim) break; }
        }
      }
      if (bestLen >= 3) {
        const tok = ((bestOff - 1) << (16 - bitCount)) | (bestLen - 3);
        out.push(tok & 0xFF, (tok >> 8) & 0xFF); flags |= 1 << bit; cur += bestLen;
      } else { out.push(src[cur]); cur++; }
    }
    out[flagPos] = flags;
  }
  return out;
}
export function ovbaCompress(buf) {
  const src = buf instanceof Uint8Array ? buf : Buffer.from(buf);
  const out = [0x01];
  for (let pos = 0; pos < src.length; pos += 4096) {
    const end = Math.min(src.length, pos + 4096);
    const data = compressChunk(src, pos, end);
    if (data.length + 2 <= 4098) {
      const hdr = 0xB000 | ((data.length + 2 - 3) & 0x0FFF);
      out.push(hdr & 0xFF, hdr >> 8, ...data);
    } else if (end - pos === 4096) {
      out.push(0xFF, 0x3F); for (let i = pos; i < end; i++) out.push(src[i]);   // raw chunk
    } else throw new Error("chunk cannot be compressed");
  }
  return Buffer.from(out);
}
export function ovbaDecompress(buf) {   // used by the self-test
  const out = []; let p = 1;
  if (buf[0] !== 1) throw new Error("bad signature");
  while (p < buf.length) {
    const hdr = buf[p] | (buf[p + 1] << 8), size = (hdr & 0x0FFF) + 3, flag = hdr & 0x8000, endc = p + size; p += 2;
    const start = out.length;
    if (!flag) { for (let i = 0; i < 4096; i++) out.push(buf[p + i]); p += 4096; continue; }
    while (p < endc) {
      const fl = buf[p++];
      for (let bit = 0; bit < 8 && p < endc; bit++) {
        if (fl & (1 << bit)) {
          const tok = buf[p] | (buf[p + 1] << 8); p += 2;
          const diff = out.length - start; let bc = 4; while ((1 << bc) < diff) bc++;
          const len = (tok & (0xFFFF >> bc)) + 3, off = (tok >> (16 - bc)) + 1;
          for (let i = 0; i < len; i++) out.push(out[out.length - off]);
        } else out.push(buf[p++]);
      }
    }
  }
  return Buffer.from(out);
}

// ---------------- MS-OVBA 2.4.3 data encryption (CMG / DPB / GC in the PROJECT stream) ----------------
function encryptHex(projectId, data) {
  const seed = randomBytes(1)[0], version = 2;
  let projKey = 0; for (const ch of Buffer.from(projectId, "latin1")) projKey = (projKey + ch) & 0xFF;
  const out = [seed, seed ^ version, seed ^ projKey];
  let unenc1 = projKey, enc1 = seed ^ projKey, enc2 = seed ^ version;
  const put = (b) => { const e = b ^ ((enc2 + unenc1) & 0xFF); out.push(e); enc2 = enc1; enc1 = e; unenc1 = b; };
  const ignored = (seed & 6) / 2;
  for (let i = 0; i < ignored; i++) put(randomBytes(1)[0]);
  const len = data.length; [len & 0xFF, (len >> 8) & 0xFF, (len >> 16) & 0xFF, (len >> 24) & 0xFF].forEach(put);
  for (const b of data) put(b);
  return Buffer.from(out).toString("hex").toUpperCase();
}

// ---------------- dir stream records ----------------
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const rec = (id, data) => Buffer.concat([u16(id), u32(data.length), data]);
const mbcs = (s) => Buffer.from(s, "latin1");
const utf16 = (s) => Buffer.from(s, "utf16le");

function dirStream(modules) {
  const parts = [];
  // PROJECTINFORMATION
  parts.push(rec(0x0001, u32(3)));                 // SysKind: 64-bit Windows (also opens in 32-bit Office)
  parts.push(rec(0x004A, u32(3)));                 // PROJECTCOMPATVERSION
  parts.push(rec(0x0002, u32(0x0409)));            // LCID
  parts.push(rec(0x0014, u32(0x0409)));            // LCIDINVOKE
  parts.push(rec(0x0003, u16(1252)));              // CODEPAGE
  parts.push(rec(0x0004, mbcs("VBAProject")));     // NAME
  parts.push(rec(0x0005, Buffer.alloc(0)), rec(0x0040, Buffer.alloc(0)));   // DOCSTRING + unicode
  parts.push(rec(0x0006, Buffer.alloc(0)), rec(0x003D, Buffer.alloc(0)));   // HELPFILEPATH 1 + 2
  parts.push(rec(0x0007, u32(0)));                 // HELPCONTEXT
  parts.push(rec(0x0008, u32(0)));                 // LIBFLAGS
  parts.push(Buffer.concat([u16(0x0009), u32(4), u32(1), u16(0)]));   // VERSION (Reserved = 4, major, minor)
  parts.push(rec(0x000C, Buffer.alloc(0)), rec(0x003C, Buffer.alloc(0)));   // CONSTANTS + unicode
  // PROJECTREFERENCES: stdole (OLE Automation)
  const ref = (name, libid) => {
    const lib = mbcs(libid);
    return Buffer.concat([rec(0x0016, mbcs(name)), rec(0x003E, utf16(name)),
      u16(0x000D), u32(4 + lib.length + 4 + 2), u32(lib.length), lib, u32(0), u16(0)]);
  };
  parts.push(ref("stdole", "*\\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\\Windows\\System32\\stdole2.tlb#OLE Automation"));
  // PROJECTMODULES
  parts.push(rec(0x000F, u16(modules.length)));
  parts.push(rec(0x0013, u16(0xFFFF)));            // PROJECTCOOKIE
  for (const m of modules) {
    parts.push(rec(0x0019, mbcs(m.name)), rec(0x0047, utf16(m.name)));
    parts.push(rec(0x001A, mbcs(m.name)), rec(0x0032, utf16(m.name)));     // stream name
    parts.push(rec(0x001C, Buffer.alloc(0)), rec(0x0048, Buffer.alloc(0)));   // docstring
    parts.push(rec(0x0031, u32(0)));               // MODULEOFFSET: source starts at 0 (no compiled cache)
    parts.push(rec(0x001E, u32(0)));               // HELPCONTEXT
    parts.push(rec(0x002C, u16(0xFFFF)));          // COOKIE
    parts.push(Buffer.concat([u16(m.doc ? 0x0022 : 0x0021), u32(0)]));      // MODULETYPE (document / procedural)
    parts.push(Buffer.concat([u16(0x002B), u32(0)]));                       // module terminator
  }
  parts.push(Buffer.concat([u16(0x0010), u32(0)]));                         // dir terminator
  return Buffer.concat(parts);
}

const DOC_ATTR = {
  workbook: "0{00020819-0000-0000-C000-000000000046}",
  sheet: "0{00020820-0000-0000-C000-000000000046}",
};
// Windows-1252 code points 0x80-0x9F (so “ ” ‘ ’ – — • … € ™ survive in MsgBox texts and comments)
const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F, 0x00B7: 0xB7 };
function moduleSource(m) {
  let head = `Attribute VB_Name = "${m.name}"\r\n`;
  if (m.doc) head += `Attribute VB_Base = "${DOC_ATTR[m.doc]}"\r\nAttribute VB_GlobalNameSpace = False\r\nAttribute VB_Creatable = False\r\nAttribute VB_PredeclaredId = True\r\nAttribute VB_Exposed = True\r\nAttribute VB_TemplateDerived = False\r\nAttribute VB_Customizable = True\r\n`;
  const body = String(m.code || "").replace(/\r\n|\r|\n/g, "\r\n").replace(/^\s*Attribute VB_\w+ = .*\r\n/gm, "");
  // VBA source is stored in the project's code page (1252); characters outside it become "?"
  const text = head + body + (body.endsWith("\r\n") ? "" : "\r\n");
  const out = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[i] = c < 128 || (c >= 160 && c < 256) ? c : (CP1252[c] || 0x3F); }
  return out;
}

function projectStream(modules, id) {
  let s = `ID="${id}"\r\n`;
  for (const m of modules) s += m.doc ? `Document=${m.name}/&H00000000\r\n` : `Module=${m.name}\r\n`;
  s += `Name="VBAProject"\r\nHelpContextID="0"\r\nVersionCompatible32="393222000"\r\n`;
  s += `CMG="${encryptHex(id, Buffer.alloc(4))}"\r\nDPB="${encryptHex(id, Buffer.from([0]))}"\r\nGC="${encryptHex(id, Buffer.from([0xFF]))}"\r\n\r\n`;
  s += `[Host Extender Info]\r\n&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000\r\n\r\n[Workspace]\r\n`;
  for (const m of modules) s += `${m.name}=0, 0, 0, 0, C\r\n`;
  return Buffer.from(s, "latin1");
}
function projectWm(modules) {
  const parts = [];
  for (const m of modules) parts.push(mbcs(m.name), Buffer.from([0]), utf16(m.name), Buffer.from([0, 0]));
  parts.push(Buffer.from([0, 0]));
  return Buffer.concat(parts);
}

// ---------------- MS-CFB writer (version 3, 512-byte sectors, mini stream for small streams) ----------------
const FREE = 0xFFFFFFFF, END = 0xFFFFFFFE, FATSECT = 0xFFFFFFFD, NOSTREAM = 0xFFFFFFFF;
function cfb(tree) {
  // tree: { name, children:[ {name, data} | {name, children} ] }
  const entries = [];   // { name, type, data, children(idx[]), left, right, child, start, size }
  const add = (node, type) => {
    const e = { name: node.name, type, data: node.data || null, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, start: type === 1 ? 0 : END, size: 0 };
    const idx = entries.length; entries.push(e);
    if (node.children) {
      const kids = node.children.map((c) => add(c, c.children ? 1 : 2));
      kids.sort((a, b) => { const A = entries[a].name.toUpperCase(), B = entries[b].name.toUpperCase(); return A.length - B.length || (A < B ? -1 : A > B ? 1 : 0); });
      // balanced binary search tree from the sorted siblings (all nodes black)
      const build = (lo, hi) => { if (lo > hi) return NOSTREAM; const mid = (lo + hi) >> 1, n = kids[mid]; entries[n].left = build(lo, mid - 1); entries[n].right = build(mid + 1, hi); return n; };
      e.child = build(0, kids.length - 1);
    }
    return idx;
  };
  add(tree, 5);
  // mini stream: every stream < 4096 bytes
  const mini = [], miniFat = [];
  const big = [];
  for (const e of entries) {
    if (e.type !== 2) continue;
    e.size = e.data.length;
    if (e.size < 4096) {
      if (e.size === 0) { e.start = END; continue; }
      const n = Math.ceil(e.size / 64); e.start = mini.length;
      for (let i = 0; i < n; i++) { mini.push(e.data.subarray(i * 64, i * 64 + 64)); miniFat.push(i === n - 1 ? END : e.start + i + 1); }
    } else big.push(e);
  }
  const miniData = Buffer.concat(mini.map((c) => { const b = Buffer.alloc(64); c.copy(b); return b; }));
  const sect = (n) => Math.ceil(n / 512);
  const nDir = sect(entries.length * 128), nMiniFat = sect(miniFat.length * 4), nMini = sect(miniData.length);
  const nBig = big.reduce((a, e) => a + sect(e.size), 0);
  let nFat = 1;
  while (nFat * 128 < nFat + nDir + nMiniFat + nMini + nBig) nFat++;
  if (nFat > 109) throw new Error("VBA project too large");
  const fat = [];
  let s = 0;
  for (let i = 0; i < nFat; i++) fat[s++] = FATSECT;
  const chain = (n) => { const first = s; for (let i = 0; i < n; i++) { fat[s] = i === n - 1 ? END : s + 1; s++; } return n ? first : END; };
  const dirStart = chain(nDir), miniFatStart = chain(nMiniFat), miniStart = chain(nMini);
  for (const e of big) e.start = chain(sect(e.size));
  const root = entries[0]; root.start = miniData.length ? miniStart : END; root.size = miniData.length;
  const total = s;
  while (fat.length < nFat * 128) fat.push(FREE);
  // header
  const hdr = Buffer.alloc(512, 0);
  Buffer.from("D0CF11E0A1B11AE1", "hex").copy(hdr, 0);
  hdr.writeUInt16LE(0x003E, 24); hdr.writeUInt16LE(0x0003, 26); hdr.writeUInt16LE(0xFFFE, 28); hdr.writeUInt16LE(9, 30); hdr.writeUInt16LE(6, 32);
  hdr.writeUInt32LE(0, 40); hdr.writeUInt32LE(nFat, 44); hdr.writeUInt32LE(dirStart, 48); hdr.writeUInt32LE(0, 52); hdr.writeUInt32LE(4096, 56);
  hdr.writeUInt32LE(nMiniFat ? miniFatStart : END, 60); hdr.writeUInt32LE(nMiniFat, 64); hdr.writeUInt32LE(END, 68); hdr.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) hdr.writeUInt32LE(i < nFat ? i : FREE, 76 + i * 4);
  const body = Buffer.alloc(total * 512, 0);
  for (let i = 0; i < nFat * 128; i++) body.writeUInt32LE(fat[i] === undefined ? FREE : fat[i], i * 4);
  // directory
  const dirBuf = Buffer.alloc(nDir * 512, 0);
  for (let i = 0; i < nDir * 4; i++) {
    const o = i * 128, e = entries[i];
    if (!e) { dirBuf.writeUInt32LE(NOSTREAM, o + 68); dirBuf.writeUInt32LE(NOSTREAM, o + 72); dirBuf.writeUInt32LE(NOSTREAM, o + 76); continue; }
    const nm = Buffer.from(e.name, "utf16le"); nm.copy(dirBuf, o); dirBuf.writeUInt16LE(nm.length + 2, o + 64);
    dirBuf[o + 66] = e.type; dirBuf[o + 67] = 1;
    dirBuf.writeUInt32LE(e.left, o + 68); dirBuf.writeUInt32LE(e.right, o + 72); dirBuf.writeUInt32LE(e.child, o + 76);
    dirBuf.writeUInt32LE(e.type === 1 ? 0 : e.start, o + 116); dirBuf.writeUInt32LE(e.type === 1 ? 0 : e.size, o + 120);
  }
  dirBuf.copy(body, dirStart * 512);
  if (nMiniFat) { const mf = Buffer.alloc(nMiniFat * 512, 0xFF); miniFat.forEach((v, i) => mf.writeUInt32LE(v, i * 4)); mf.copy(body, miniFatStart * 512); }
  if (nMini) miniData.copy(body, miniStart * 512);
  for (const e of big) e.data.copy(body, e.start * 512);
  return Buffer.concat([hdr, body]);
}

/**
 * modules: [{ name: "ThisWorkbook", doc: "workbook", code }, { name: "Sheet1", doc: "sheet", code }, { name: "Module1", code }]
 * Document modules must match the workbook / sheet codeNames in the .xlsm.
 */
export function buildVbaProject(modules) {
  for (const m of modules) if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(m.name)) throw new Error("Bad module name: " + m.name);
  const id = "{" + [8, 4, 4, 4, 12].map((n) => randomBytes(n / 2).toString("hex").toUpperCase()).join("-") + "}";
  const vbaKids = [
    { name: "_VBA_PROJECT", data: Buffer.from([0xCC, 0x61, 0xFF, 0xFF, 0x00, 0x00, 0x00]) },
    { name: "dir", data: ovbaCompress(dirStream(modules)) },
    ...modules.map((m) => ({ name: m.name, data: ovbaCompress(moduleSource(m)) })),
  ];
  return cfb({ name: "Root Entry", children: [
    { name: "PROJECT", data: projectStream(modules, id) },
    { name: "PROJECTwm", data: projectWm(modules) },
    { name: "VBA", children: vbaKids },
  ] });
}
