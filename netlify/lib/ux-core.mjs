// UI/UX studio. Describe an app or website → AI designs the screens (wireframe or high-fidelity) as a component tree →
// edit, click through as a prototype, share for user testing, AI UX review, export to Figma (plugin) / HTML / PNG.
//   ux:d:<ownerKey>:<id>  { id, owner, by, title, doc, at, upd, share: { token, tasks:[{id,text,goal}], on } }
//   ux:tok:<token>        { owner, id }                       public prototype link
//   ux:r:<id>:<ts+rand>   one tester's session { at, name, tasks:[{id, ok, ms, taps, path[], gaveUp}], ease, note }
import { randomBytes } from "node:crypto";
import { readImages } from "./schemecalc-core.mjs";
import { aiKeys } from "./aff-core.mjs";
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const txt = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").slice(0, n);
const parse = (s) => { try { return JSON.parse(String(s).replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "")); } catch (e) { return null; } };
const col = (v, d) => (/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(String(v || "").trim()) ? String(v).trim() : d);
const num = (v, lo, hi, d) => { const n = Math.round(+v); return isFinite(n) && v !== "" && v != null ? Math.max(lo, Math.min(hi, n)) : d; };
const pick = (v, L, d) => (L.includes(v) ? v : d);
const TYPES = ["col", "row", "card", "text", "button", "input", "image", "icon", "list", "nav", "tabbar", "chips", "toggle", "check", "divider", "spacer", "stat", "progress", "avatar", "badge", "table", "chart", "grid"];
const CONT = { col: 1, row: 1, card: 1, grid: 1 };

export function cleanDoc(d) {
  d = d && typeof d === "object" ? d : {};
  const th = d.theme || {}, ids = {}, screens = (Array.isArray(d.screens) ? d.screens : []).slice(0, 20);
  screens.forEach((s, i) => { let id = str(s && s.id, 24).replace(/[^\w-]/g, "") || "s" + (i + 1); while (ids[id]) id += "x"; ids[id] = 1; s.__id = id; });
  let count = 0;
  const node = (n, depth) => {
    if (!n || typeof n !== "object" || depth > 12 || count > 600) return null; count++;
    const t = pick(n.t || n.type, TYPES, "text"), o = { t };
    if (n.link && ids[str(n.link, 24)]) o.link = str(n.link, 24);
    if (n.name) o.name = str(n.name, 40);
    if (CONT[t]) {
      o.gap = num(n.gap, 0, 64, t === "row" ? 8 : 10); o.pad = num(n.pad, 0, 64, t === "card" ? 14 : 0);
      o.align = pick(n.align, ["start", "center", "end", "stretch"], t === "row" ? "center" : "stretch"); o.justify = pick(n.justify, ["start", "center", "end", "between"], "start");
      if (n.bg) o.bg = col(n.bg, undefined); if (n.radius != null) o.radius = num(n.radius, 0, 48, 0); if (n.border) o.border = col(n.border, undefined);
      o.w = n.w === "hug" || n.w === "fill" ? n.w : n.w != null && isFinite(+n.w) ? num(n.w, 16, 1600, undefined) : undefined; if (n.h != null && isFinite(+n.h)) o.h = num(n.h, 8, 1600, undefined);
      if (t === "grid") o.cols = num(n.cols, 2, 6, 2);
      if (n.scroll) o.scroll = true; if (n.shadow) o.shadow = true;
      o.children = (Array.isArray(n.children) ? n.children : []).slice(0, 60).map((c) => node(c, depth + 1)).filter(Boolean);
      Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]);
      return o;
    }
    const tx = (k, len) => { if (n[k] != null && n[k] !== "") o[k] = txt(n[k], len); };
    switch (t) {
      case "text": tx("text", 600); o.size = num(n.size, 9, 64, 14); o.weight = num(n.weight, 300, 900, 400); if (n.color) o.color = col(n.color, undefined); o.align = pick(n.align, ["left", "center", "right"], "left"); if (n.muted) o.muted = true; break;
      case "button": tx("text", 60); o.variant = pick(n.variant, ["primary", "secondary", "ghost", "danger"], "primary"); tx("icon", 8); if (n.full) o.full = true; break;
      case "input": tx("label", 60); tx("placeholder", 80); o.kind = pick(n.kind, ["text", "password", "search", "select", "date", "number", "textarea"], "text"); break;
      case "image": o.h = num(n.h, 24, 900, 160); tx("label", 60); o.radius = num(n.radius, 0, 48, 12); break;
      case "icon": tx("name", 8); o.size = num(n.size, 12, 96, 24); break;
      case "list": o.items = (Array.isArray(n.items) ? n.items : []).slice(0, 30).map((x) => ({ title: str(x && x.title, 80), sub: str(x && x.sub, 120), icon: str(x && x.icon, 8), right: str(x && x.right, 30), link: x && x.link && ids[str(x.link, 24)] ? str(x.link, 24) : undefined })).filter((x) => x.title); break;
      case "nav": tx("title", 60); if (n.back) o.back = true; o.actions = (Array.isArray(n.actions) ? n.actions : []).slice(0, 3).map((a) => str(a, 8)); break;
      case "tabbar": o.items = (Array.isArray(n.items) ? n.items : []).slice(0, 5).map((x) => ({ icon: str(x && x.icon, 8), label: str(x && x.label, 16), link: x && x.link && ids[str(x.link, 24)] ? str(x.link, 24) : undefined })); o.active = num(n.active, 0, 4, 0); break;
      case "chips": o.items = (Array.isArray(n.items) ? n.items : []).slice(0, 12).map((x) => str(x, 24)).filter(Boolean); o.active = num(n.active, 0, 11, 0); break;
      case "toggle": case "check": tx("label", 80); o.on = !!n.on; break;
      case "spacer": o.h = num(n.h, 2, 200, 16); break;
      case "stat": tx("label", 40); tx("value", 24); tx("delta", 16); break;
      case "progress": o.value = num(n.value, 0, 100, 50); tx("label", 60); break;
      case "avatar": tx("name", 40); o.size = num(n.size, 20, 120, 40); break;
      case "badge": tx("text", 24); if (n.color) o.color = col(n.color, undefined); break;
      case "table": o.cols = (Array.isArray(n.cols) ? n.cols : []).slice(0, 6).map((x) => str(x, 24)); o.rows = (Array.isArray(n.rows) ? n.rows : []).slice(0, 12).map((r) => (Array.isArray(r) ? r : []).slice(0, 6).map((x) => str(x, 40))); break;
      case "chart": o.kind = pick(n.kind, ["bar", "line", "pie"], "bar"); o.values = (Array.isArray(n.values) ? n.values : []).slice(0, 12).map((v) => Math.max(0, +v || 0)); if (!o.values.length) o.values = [4, 7, 5, 9, 6]; tx("label", 60); o.h = num(n.h, 60, 400, 140); break;
    }
    return o;
  };
  const out = screens.map((s) => ({ id: s.__id, name: str(s.name, 50) || s.__id, bg: col(s.bg, undefined), children: (Array.isArray(s.children) ? s.children : []).slice(0, 60).map((c) => node(c, 1)).filter(Boolean) }));
  out.forEach((s) => Object.keys(s).forEach((k) => s[k] === undefined && delete s[k]));
  if (!out.length) out.push({ id: "home", name: "Home", children: [{ t: "nav", title: "Home" }, { t: "text", text: "Start designing", size: 20, weight: 700 }] });
  const sids = out.map((s) => s.id), IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const V = d.video && typeof d.video === "object" && Array.isArray(d.video.frames) ? { name: str(d.video.name, 80), dur: num(d.video.dur, 0, 36000, 0), w: num(d.video.w, 0, 8000, 0), h: num(d.video.h, 0, 8000, 0),
    frames: d.video.frames.slice(0, 24).map((f) => ({ t: Math.max(0, Math.min(36000, +f.t || 0)), src: IMG.test(String(f.src || "")) && String(f.src).length < 60000 ? String(f.src) : "", screen: sids.includes(str(f.screen, 24)) ? str(f.screen, 24) : "", what: str(f.what, 200) })).filter((f) => f.src) } : null;
  const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, 30).map((x) => ({ screen: sids.includes(str(x && x.screen, 24)) ? str(x.screen, 24) : "", frame: x && x.frame != null && isFinite(+x.frame) ? num(x.frame, 0, 23, 0) : -1, title: str(x && x.title, 90), action: str(x && x.action, 300), why: str(x && x.why, 300), tip: str(x && x.tip, 200) })).filter((x) => x.title || x.action);
  return {
    title: str(d.title, 80) || "Untitled design", platform: pick(d.platform, ["mobile", "web", "tablet"], "mobile"), style: pick(d.style, ["wireframe", "hifi"], "hifi"),
    theme: { primary: col(th.primary, "#4D5BF9"), bg: col(th.bg, "#F5F6FA"), surface: col(th.surface, "#FFFFFF"), text: col(th.text, "#141833"), muted: col(th.muted, "#6B7090"), radius: num(th.radius, 0, 28, 14), font: pick(th.font, ["Inter", "Roboto", "Poppins", "Noto Sans"], "Inter") },
    screens: out, ...(steps.length ? { steps } : {}), ...(V && V.frames.length ? { video: V } : {})
  };
}
// what the AI reads: the design without the picture data of an imported video
const forAI = (doc) => JSON.stringify(Object.assign({}, doc, { video: doc.video ? { name: doc.video.name, frames: doc.video.frames.map((f, i) => ({ i, t: f.t, screen: f.screen, what: f.what })) } : undefined }));
const keepExtras = (from, to) => { if (from.video && !to.video) to.video = from.video; if (from.steps && !to.steps) to.steps = from.steps; return cleanDoc(to); };

// Key frames of a screen recording → what each one shows (shared with Tool manuals). frames: data-URL JPEGs (≤3 per call)
export async function seeFrames(ctx, frames, opt) {
  opt = opt || {};
  const imgs = (Array.isArray(frames) ? frames : []).filter((u) => /^data:image\/(jpeg|png|webp);base64,/.test(String(u)) && String(u).length < 1500000).slice(0, 3);
  if (!imgs.length) return { ok: false, error: "No frames to read." };
  const base = num(opt.offset, 0, 99, 0), times = Array.isArray(opt.times) ? opt.times : [];
  const prompt = `These ${imgs.length} picture(s) are key frames, in time order, from a screen recording / demo video of ${opt.about ? str(opt.about, 200) : "an app or website"} (frame numbers ${imgs.map((_, i) => base + i).join(", ")}${times.length ? "; seconds into the video: " + times.slice(0, imgs.length).join(", ") : ""}).
For EACH picture, read the screen carefully: its title, every visible label, button, field, tab, list row, number and message (exact words), and how it is laid out from top to bottom.
Then say what the person in the recording is doing on it (what they tap, type or choose next, if you can tell) and why.
Reply with ONLY JSON: {"frames":[{"i":frame number,"screen":"short screen name","kind":"screen|popup|menu|loading|home|other","platform":"mobile|web|tablet","texts":["exact visible words"],"layout":"top-to-bottom description: header, sections, cards, lists, buttons, tab bar","action":"what the user does here","why":"the purpose of this step in one short sentence","colours":"main colours seen"}]}`;
  const keys = await aiKeys(ctx.store, ctx.env || {});
  const v = await readImages(keys, ctx.env || {}, imgs, ctx.aiFetch, prompt, { json: true, timeout: 45000, maxModels: 3, accept: (t) => /"frames"\s*:/.test(t) });
  if (!v.ok) return { ok: false, error: "The AI couldn't read the frames right now — try again. (" + String(v.error || "").slice(0, 120) + ")" };
  const j = parse(v.text); if (!j || !Array.isArray(j.frames)) return { ok: false, error: "The AI answer wasn't readable — try again." };
  return { ok: true, frames: j.frames.slice(0, imgs.length).map((f, k) => ({ i: base + k, screen: str(f.screen, 60), kind: str(f.kind, 12), platform: str(f.platform, 8), texts: (Array.isArray(f.texts) ? f.texts : []).slice(0, 40).map((x) => str(x, 80)), layout: str(f.layout, 700), action: str(f.action, 300), why: str(f.why, 200), colours: str(f.colours, 120) })) };
}

const SCHEMA = `Return JSON: {"title":"…","platform":"mobile|web|tablet","style":"hifi|wireframe","theme":{"primary":"#hex","bg":"#hex","surface":"#hex","text":"#hex","muted":"#hex","radius":14,"font":"Inter|Roboto|Poppins|Noto Sans"},
"screens":[{"id":"home","name":"Home","children":[ NODE, … ]}]}
NODE types (use only these; keys exactly as shown):
 {"t":"nav","title":"…","back":false,"actions":["🔔"]}  top app bar (mobile) / header (web)
 {"t":"col"|"row","gap":10,"pad":0,"align":"start|center|end|stretch","justify":"start|center|end|between","bg":"#hex","radius":12,"w":"fill|hug|<px>","scroll":false,"children":[…]}  layout boxes
 {"t":"card","pad":14,"gap":8,"children":[…]}  surface card (white, rounded, shadow)
 {"t":"grid","cols":2,"gap":10,"children":[…]}
 {"t":"text","text":"…","size":14,"weight":400|500|600|700|800,"color":"#hex","align":"left|center|right","muted":false}
 {"t":"button","text":"…","variant":"primary|secondary|ghost|danger","icon":"➕","full":true,"link":"<screen id>"}
 {"t":"input","label":"…","placeholder":"…","kind":"text|password|search|select|date|number|textarea"}
 {"t":"image","h":160,"label":"what the picture shows","radius":12}
 {"t":"icon","name":"emoji","size":24}  {"t":"avatar","name":"Ravi K","size":40}  {"t":"badge","text":"New"}
 {"t":"list","items":[{"title":"…","sub":"…","icon":"emoji","right":"₹1,200","link":"<screen id>"}]}
 {"t":"tabbar","items":[{"icon":"🏠","label":"Home","link":"home"}],"active":0}  bottom tab bar (mobile)
 {"t":"chips","items":["All","Pending"],"active":0}  {"t":"toggle"|"check","label":"…","on":true}
 {"t":"stat","label":"Sales","value":"₹4.2 L","delta":"+12%"}  {"t":"progress","value":60,"label":"…"}
 {"t":"table","cols":["…"],"rows":[["…"]]}  {"t":"chart","kind":"bar|line|pie","values":[…],"label":"…","h":140}
 {"t":"divider"}  {"t":"spacer","h":16}
Any node may have "link":"<screen id>" — that is the prototype tap target. Every screen id used in a link must exist.
Rules: realistic content (Indian context, ₹, Indian names and places; vivo products if relevant) — never lorem ipsum. Mobile screens: nav at top, tabbar at bottom when the app has main sections, content in between; 44px+ tap targets; one primary action per screen. Web: header nav row, then content in rows / grid / cards. Wire every primary flow with links so the prototype can be clicked end to end. For "wireframe" style use greys only (theme primary #555555) and plain text — no colours.`;

export async function uxAction(b, ctx) {
  const { store, t, app, rec, key, pool, env = {}, askAI, aiFetch } = ctx;
  const ok = app + ":" + key, by = rec.fullName || rec.username || "";
  const mine = (id) => store.get("ux:d:" + ok + ":" + str(id, 24));
  if (b.action === "ux-list") {
    const L = (await pool(await store.list("ux:d:" + ok + ":"), 30, (k) => store.get(k))).filter(Boolean).sort((x, y) => y.upd - x.upd).slice(0, 100);
    return J(200, { ok: true, rows: L.map((x) => ({ id: x.id, title: x.title, platform: x.doc.platform, style: x.doc.style, screens: x.doc.screens.length, upd: x.upd, shared: !!(x.share && x.share.on) })) });
  }
  if (b.action === "ux-get") { const x = await mine(b.id); return x ? J(200, { ok: true, d: x }) : J(404, { ok: false, error: "Not found" }); }
  if (b.action === "ux-save") {
    const id = str(b.id, 24) || t.toString(36) + randomBytes(2).toString("hex"), old = await mine(id), doc = cleanDoc(b.doc);
    if (JSON.stringify(doc).length > 900000) return J(413, { ok: false, error: "Design too big to save" });
    const x = { id, owner: ok, by: old ? old.by : by, title: doc.title, doc, prompt: old ? old.prompt : txt(b.prompt, 3000), at: old ? old.at : t, upd: t, share: old ? old.share : null };
    await store.set("ux:d:" + ok + ":" + id, x); return J(200, { ok: true, id, doc });
  }
  if (b.action === "ux-del") { const x = await mine(b.id); if (x && x.share && x.share.token) await store.delete("ux:tok:" + x.share.token); await store.delete("ux:d:" + ok + ":" + str(b.id, 24)); return J(200, { ok: true }); }
  if (b.action === "ux-share") {   // make / update the public prototype + test link
    const x = await mine(b.id); if (!x) return J(404, { ok: false, error: "Save first" });
    const sh = x.share || {}; if (!sh.token) sh.token = randomBytes(12).toString("base64url");
    if (b.on !== undefined) sh.on = !!b.on;
    if (Array.isArray(b.tasks)) sh.tasks = b.tasks.slice(0, 8).map((k, i) => ({ id: str(k.id, 12) || "k" + (i + 1), text: str(k.text, 200), goal: x.doc.screens.some((s) => s.id === k.goal) ? k.goal : "" })).filter((k) => k.text);
    sh.tasks = sh.tasks || []; x.share = sh; await store.set("ux:d:" + ok + ":" + x.id, x); await store.set("ux:tok:" + sh.token, { owner: ok, id: x.id });
    return J(200, { ok: true, share: sh });
  }
  if (b.action === "ux-results") {
    const x = await mine(b.id); if (!x) return J(404, { ok: false, error: "Not found" });
    const R = (await pool(await store.list("ux:r:" + x.id + ":"), 30, (k) => store.get(k))).filter(Boolean).sort((p, q) => q.at - p.at).slice(0, 500);
    return J(200, { ok: true, rows: R, tasks: (x.share && x.share.tasks) || [] });
  }
  if (b.action === "ux-ai") {
    if (!askAI) return J(400, { ok: false, error: "AI is not set up yet." });
    let sys, q, data, max = 9000;
    if (b.mode === "make") {
      const p = txt(b.prompt, 4000); if (p.length < 12) return J(400, { ok: false, error: "Describe the app or website in a few lines" });
      sys = "You are a senior product designer. Design a complete " + (b.platform === "web" ? "responsive website (desktop width 1280)" : b.platform === "tablet" ? "tablet app (834 wide)" : "mobile app (390 wide)") + " in " + (b.style === "wireframe" ? "low-fidelity WIREFRAME style" : "polished HIGH-FIDELITY style with a clear visual hierarchy") + ". Make " + Math.max(2, Math.min(12, +b.n || 6)) + " screens covering the main user flow. " + (b.brand ? "Brand colours / style: " + str(b.brand, 200) + ". " : "") + "Reply with JSON only.\n" + SCHEMA;
      q = "Design it now."; data = p;
    } else if (b.mode === "edit") {
      const doc = cleanDoc(b.doc), p = txt(b.prompt, 1500), sid = str(b.screen, 24);
      if (p.length < 3) return J(400, { ok: false, error: "Say what to change" });
      if (sid && doc.screens.some((s) => s.id === sid)) {
        sys = "You edit ONE screen of an app design. Apply the change and return ONLY that screen as JSON {\"id\":\"" + sid + "\",\"name\":\"…\",\"children\":[…]} using the same node format. Other screen ids you may link to: " + doc.screens.map((s) => s.id).join(", ") + ". Reply with JSON only.\n" + SCHEMA + "\nCHANGE: " + p;
        q = "Edit the screen."; data = JSON.stringify({ theme: doc.theme, platform: doc.platform, style: doc.style, screen: doc.screens.find((s) => s.id === sid) }).slice(0, 14000); max = 5000;
      } else {
        sys = "You edit an app design. Apply the change and return the COMPLETE design JSON (all screens). Reply with JSON only.\n" + SCHEMA + "\nCHANGE: " + p;
        q = "Apply the change."; data = forAI(doc).slice(0, 15000);
      }
    } else if (b.mode === "review") {
      const doc = cleanDoc(b.doc);
      sys = "You are a UX reviewer. Review this app design against usability heuristics (clarity, consistency, feedback, error prevention, navigation, recognition over recall), accessibility (text size, contrast with the given colours, 44px tap targets, labels) and mobile / web best practice. Be specific: name the screen and element. Reply with JSON only: {\"score\":0-100,\"summary\":\"2 sentences\",\"strengths\":[\"…\"],\"issues\":[{\"screen\":\"<screen id>\",\"severity\":\"high|medium|low\",\"issue\":\"…\",\"fix\":\"…\"}]} with up to 12 issues, most important first.";
      q = "Review the design."; data = forAI(doc).slice(0, 15000); max = 3000;
    } else if (b.mode === "tests") {
      const doc = cleanDoc(b.doc);
      sys = "Write 3-5 usability-test tasks for this prototype, each one a realistic goal a user would have, written to the tester (\"You want to …\"), and the screen id where the task is complete. Reply with JSON only: {\"tasks\":[{\"text\":\"…\",\"goal\":\"<screen id>\"}]}. Screen ids: " + doc.screens.map((s) => s.id + " (" + s.name + ")").join(", ");
      q = "Write the tasks."; data = forAI(doc).slice(0, 12000); max = 1200;
    } else if (b.mode === "see") {   // key frames of an imported recording → descriptions (vision)
      const r = await seeFrames(ctx, b.frames, { offset: b.offset, times: b.times, about: b.about });
      return J(r.ok ? 200 : 502, r);
    } else if (b.mode === "fromvideo") {   // descriptions of the key frames → editable screens + step-by-step flow
      const F = (Array.isArray(b.seen) ? b.seen : []).slice(0, 24), plat = pick(b.platform, ["mobile", "web", "tablet"], "mobile");
      if (!F.length) return J(400, { ok: false, error: "Read the video first." });
      sys = "You are a senior product designer. Below is what each key frame of a SCREEN RECORDING of an existing " + (plat === "web" ? "website" : plat === "tablet" ? "tablet app" : "mobile app") + " shows, in time order. Recreate it as an editable, clickable design in " + (b.style === "wireframe" ? "low-fidelity WIREFRAME style" : "polished HIGH-FIDELITY style") +
        ": one design screen for each DISTINCT screen in the recording (frames showing the same screen become one screen; a pop-up or bottom sheet can be its own screen), keeping the real labels, texts, numbers, order and layout as seen — do not invent other features. Keep the colours you can see in the theme. Wire the links so the prototype follows the same path the user took in the recording.\n" +
        "ALSO return \"steps\": the step-by-step flow of the recording for a user guide, one step per meaningful user action, in order: {\"title\":\"short step title\",\"screen\":\"<screen id>\",\"frame\":<key frame number that shows it>,\"action\":\"what to do, naming the exact button / field\",\"why\":\"what it achieves\",\"tip\":\"optional UX note or tip\"}.\n" +
        "Reply with JSON only: the design object (title, platform, style, theme, screens) plus \"steps\".\n" + SCHEMA + (b.note ? "\nNOTE FROM THE DESIGNER: " + txt(b.note, 600) : "");
      q = "Recreate the recording as a design with steps."; data = JSON.stringify({ platform: plat, video: str(b.name, 80), frames: F }).slice(0, 24000); max = 12000;
    } else if (b.mode === "steps") {   // a step-by-step user flow for a design (e.g. one not made from a video)
      const doc = cleanDoc(b.doc);
      sys = "Write the step-by-step user flow of this app design for a user guide: the main journey a first-time user follows, one step per action, in order, using the exact button / field names on the screens. Reply with JSON only: {\"steps\":[{\"title\":\"short step title\",\"screen\":\"<screen id>\",\"action\":\"what to do\",\"why\":\"what it achieves\",\"tip\":\"optional tip\"}]}. Screen ids: " + doc.screens.map((s) => s.id + " (" + s.name + ")").join(", ");
      q = "Write the steps."; data = forAI(doc).slice(0, 14000); max = 2500;
    } else if (b.mode === "insight") {
      sys = "Summarise these usability-test results for the designer in plain English: what worked, where people got stuck (use the tap paths and wrong screens), and the 3 changes that would help most. Plain text, short bullets starting with •."; q = "Summarise."; data = txt(b.data, 12000); max = 1500;
    } else return J(400, { ok: false, error: "Unknown mode" });
    const r = await askAI(env, q, data, [], aiFetch, { system: sys, label: b.mode === "make" || b.mode === "fromvideo" ? "BRIEF" : "DESIGN", json: b.mode !== "insight", maxTokens: max });
    if (!r.ok) return J(502, { ok: false, error: r.error || "AI didn't answer — try again." });
    if (b.mode === "insight") return J(200, { ok: true, text: String(r.text).slice(0, 4000) });
    const j = parse(r.text); if (!j) return J(502, { ok: false, error: "The AI answer wasn't readable — try again." });
    if (b.mode === "review") return J(200, { ok: true, review: { score: num(j.score, 0, 100, 0), summary: str(j.summary, 400), strengths: (j.strengths || []).slice(0, 6).map((s) => str(s, 200)), issues: (Array.isArray(j.issues) ? j.issues : []).slice(0, 12).map((x) => ({ screen: str(x.screen, 24), severity: pick(x.severity, ["high", "medium", "low"], "medium"), issue: str(x.issue, 300), fix: str(x.fix, 300) })) } });
    if (b.mode === "steps") { const d2 = cleanDoc(Object.assign({}, cleanDoc(b.doc), { steps: (Array.isArray(j.steps) ? j.steps : []).map((x) => Object.assign({ frame: -1 }, x)) })); return J(200, { ok: true, steps: d2.steps || [] }); }
    if (b.mode === "tests") { const doc = cleanDoc(b.doc), ids = doc.screens.map((s) => s.id); return J(200, { ok: true, tasks: (Array.isArray(j.tasks) ? j.tasks : []).slice(0, 6).map((k) => ({ text: str(k.text, 200), goal: ids.includes(k.goal) ? k.goal : "" })).filter((k) => k.text) }); }
    if (b.mode === "edit" && j.children && !j.screens) { const doc = cleanDoc(b.doc), i = doc.screens.findIndex((s) => s.id === str(b.screen, 24)); if (i < 0) return J(400, { ok: false, error: "Screen not found" }); doc.screens[i] = Object.assign({}, j, { id: doc.screens[i].id }); return J(200, { ok: true, doc: cleanDoc(doc) }); }
    if (!Array.isArray(j.screens)) return J(502, { ok: false, error: "The AI answer had no screens — try again." });
    if (b.mode === "edit") return J(200, { ok: true, doc: keepExtras(cleanDoc(b.doc), j) });
    if (b.mode === "fromvideo") { j.platform = j.platform || b.platform; const F = b.seen || []; j.video = b.video ? Object.assign({}, b.video, { frames: (b.video.frames || []).map((f, i) => Object.assign({}, f, { what: str((F[i] || {}).action || (F[i] || {}).screen, 200) })) }) : undefined; const d2 = cleanDoc(j);
      // each key frame → the design screen it shows (from the steps, else by name)
      if (d2.video) d2.video.frames.forEach((f, i) => { const st = (d2.steps || []).find((x) => x.frame === i && x.screen); const nm = String((F[i] || {}).screen || "").toLowerCase(); const byName = d2.screens.find((s) => nm && s.name.toLowerCase() === nm); f.screen = (st && st.screen) || (byName && byName.id) || f.screen || ""; });
      return J(200, { ok: true, doc: d2 }); }
    return J(200, { ok: true, doc: cleanDoc(j) });
  }
  return J(400, { ok: false, error: "Unknown action" });
}

// ---- public: play a shared prototype, run a test, send results; the Figma plugin can also fetch a design by its link ----
export async function uxPublic(b, ctx) {
  const { store, t } = ctx;
  const tk = await store.get("ux:tok:" + str(b.k, 40)); if (!tk) return J(404, { ok: false, error: "This prototype link is not valid." });
  const x = await store.get("ux:d:" + tk.owner + ":" + tk.id); if (!x || !x.share || !x.share.on) return J(403, { ok: false, error: "This prototype is not shared at the moment." });
  if (b.action === "ux-p-get") return J(200, { ok: true, doc: x.doc, tasks: x.share.tasks || [], title: x.title });
  if (b.action === "ux-p-result") {
    const r = { at: t, name: str(b.name, 60), ease: num(b.ease, 0, 5, 0), note: str(b.note, 600), device: str(b.device, 40),
      tasks: (Array.isArray(b.tasks) ? b.tasks : []).slice(0, 8).map((k) => ({ id: str(k.id, 12), ok: !!k.ok, gaveUp: !!k.gaveUp, ms: num(k.ms, 0, 36e5, 0), taps: num(k.taps, 0, 999, 0), path: (Array.isArray(k.path) ? k.path : []).slice(0, 60).map((p) => str(p, 24)) })) };
    const n = (await store.list("ux:r:" + x.id + ":")).length; if (n >= 500) return J(429, { ok: false, error: "This test already has 500 results." });
    await store.set("ux:r:" + x.id + ":" + t.toString(36) + randomBytes(2).toString("hex"), r);
    return J(200, { ok: true });
  }
  return J(400, { ok: false, error: "Unknown action" });
}
