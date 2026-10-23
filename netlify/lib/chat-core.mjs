// One-to-one chat between registered users. State users can message admins; admins can message anyone.
// Storage (Netlify Blobs):
//   chatconv:<cid>              conversation meta { cid, a, b, names, lastTs, lastText, lastFrom, unread:{id:n}, atts:[...] }
//   chatmsg:<cid>:<ts>-<rand>   one message per blob (no lost messages when both sides send at once)
//   chatread:<userId>           { <cid>: lastReadAt }
import { createHash, randomBytes } from "node:crypto";

export const CHAT_TOPICS = ["General", "Rankings", "Growth", "Retailer IDs", "Improvement areas", "Data mismatch",
  "Overview", "Trends", "Retailer app usage", "Active retailers", "Schemes & payout", "Action plan", "Support desk KPI"];

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
export const convId = (x, y) => createHash("sha256").update([x, y].sort().join("|")).digest("hex").slice(0, 24);
const pad = (t) => String(t).padStart(14, "0");

export async function chatAction(b, ctx) {
  const { store, t, app, rec, key, pool, userKey } = ctx;
  const me = app + ":" + key;
  const meInfo = { id: me, app, username: rec.username, fullName: rec.fullName, state: rec.state || "" };
  const readKey = (id) => `chatread:${id}`;

  async function peerOf(id) {
    const m = /^(admin|state):(.+)$/.exec(String(id || ""));
    if (!m) return null;
    const k = userKey(m[2]) || m[2];
    const u = await store.get(`user:${m[1]}:${k}`);
    if (!u) return null;
    return { id: m[1] + ":" + k, app: m[1], username: u.username, fullName: u.fullName, state: u.state || "", designation: u.designation || "",
      disabled: !!u.disabled, lastSeen: u.lastSeen || 0 };
  }
  const allowed = (p) => p && p.id !== me && (app === "admin" || p.app === "admin");
  const myConvs = async () => {
    const ks = store.list ? await store.list("chatconv:") : [];
    return (await pool(ks, 40, (k) => store.get(k))).filter((c) => c && (c.a === me || c.b === me));
  };

  if (b.action === "chat-contacts") {
    const out = [];
    for (const which of app === "admin" ? ["admin", "state"] : ["admin"]) {
      const ks = await store.list(`user:${which}:`);
      (await pool(ks, 40, (k) => store.get(k))).forEach((u) => {
        if (!u || u.disabled) return;
        const id = which + ":" + userKey(u.username);
        if (id === me) return;
        out.push({ id, app: which, username: u.username, fullName: u.fullName, state: u.state || "", designation: u.designation || "", lastSeen: u.lastSeen || 0 });
      });
    }
    out.sort((x, y) => (x.app === y.app ? 0 : x.app === "admin" ? -1 : 1) || String(x.state).localeCompare(String(y.state)) || String(x.fullName).localeCompare(String(y.fullName)));
    return json(200, { ok: true, contacts: out, topics: CHAT_TOPICS });
  }

  if (b.action === "chat-list" || b.action === "chat-notify") {
    const convs = await myConvs();
    const read = (await store.get(readKey(me))) || {};
    const list = convs.map((c) => {
      const peer = c.a === me ? c.pb : c.pa;
      const unread = c.lastFrom !== me && c.lastTs > (read[c.cid] || 0) ? Math.max(1, (c.unread && c.unread[me]) || 1) : 0;
      return { cid: c.cid, peer, lastTs: c.lastTs, lastText: c.lastText, lastFrom: c.lastFrom, lastTopic: c.lastTopic || "", unread };
    }).sort((x, y) => y.lastTs - x.lastTs);
    if (b.action === "chat-notify") {
      const un = list.filter((c) => c.unread);
      return { unread: un.reduce((a, c) => a + c.unread, 0), chats: un.length,
        latest: un[0] ? { peer: un[0].peer, text: String(un[0].lastText).slice(0, 120), ts: un[0].lastTs, topic: un[0].lastTopic } : null };
    }
    return json(200, { ok: true, chats: list, me: meInfo, topics: CHAT_TOPICS });
  }

  const peer = await peerOf(b.peer);
  if (!allowed(peer)) return json(403, { ok: false, error: app === "state" ? "State users can message BI admins." : "User not found." });
  const cid = convId(me, peer.id);
  const cKey = `chatconv:${cid}`;

  if (b.action === "chat-get") {
    const ks = (await store.list(`chatmsg:${cid}:`)).sort();
    const since = Number(b.since) || 0;
    const pick = since ? ks.filter((k) => Number(k.split(":")[2].split("-")[0]) > since) : ks.slice(-300);
    const messages = (await pool(pick, 40, (k) => store.get(k))).filter(Boolean).sort((x, y) => x.ts - y.ts);
    const read = (await store.get(readKey(me))) || {};
    const conv = await store.get(cKey);
    if (conv && (messages.length || !since) && conv.lastTs > (read[cid] || 0)) {
      read[cid] = t; await store.set(readKey(me), read);
      if (conv.unread && conv.unread[me]) { conv.unread[me] = 0; await store.set(cKey, conv); }
    }
    const peerRead = ((await store.get(readKey(peer.id))) || {})[cid] || 0;
    return json(200, { ok: true, peer, messages, peerRead, total: ks.length, me: meInfo, topics: CHAT_TOPICS });
  }

  if (b.action === "chat-send") {
    const text = str(b.text, 2000);
    const atts = [];
    for (const id of (Array.isArray(b.atts) ? b.atts : []).slice(0, 5)) {
      const a = await store.get(`att:${String(id).replace(/[^a-z0-9]/gi, "")}`);
      if (a && a.by && a.by.app === app && userKey(a.by.username) === key) atts.push({ id: a.id, name: a.name, mime: a.mime, size: a.size });
    }
    if (!text && !atts.length) return json(400, { ok: false, error: "Type a message." });
    if (peer.disabled) return json(400, { ok: false, error: "This account is disabled." });
    const topic = CHAT_TOPICS.includes(b.topic) ? b.topic : "General";
    const c = b.ctx && typeof b.ctx === "object" ? b.ctx : {};
    const cx = {};
    ["state", "period", "kpi", "ids", "page", "shown", "expected"].forEach((k) => { const v = str(c[k], k === "ids" ? 300 : 80); if (v) cx[k] = v; });
    const msg = { id: t.toString(36) + randomBytes(3).toString("hex"), cid, from: me, fromName: rec.fullName, ts: t, text, topic, ctx: cx, atts };
    await store.set(`chatmsg:${cid}:${pad(t)}-${randomBytes(2).toString("hex")}`, msg);
    const conv = (await store.get(cKey)) || { cid, a: me, b: peer.id, unread: {}, atts: [], createdAt: t };
    const pa = conv.a === me ? meInfo : { id: peer.id, app: peer.app, username: peer.username, fullName: peer.fullName, state: peer.state };
    const pb = conv.a === me ? { id: peer.id, app: peer.app, username: peer.username, fullName: peer.fullName, state: peer.state } : meInfo;
    Object.assign(conv, { pa, pb, lastTs: t, lastText: text || ("📎 " + atts.map((a) => a.name).join(", ")), lastFrom: me, lastTopic: topic });
    conv.unread = conv.unread || {}; conv.unread[peer.id] = (conv.unread[peer.id] || 0) + 1;
    conv.atts = (conv.atts || []).concat(atts.map((a) => a.id)).slice(-500);
    await store.set(cKey, conv);
    const read = (await store.get(readKey(me))) || {}; read[cid] = t; await store.set(readKey(me), read);
    return json(200, { ok: true, message: msg });
  }

  if (b.action === "chat-att") {
    const conv = await store.get(cKey);
    const id = String(b.id || "").replace(/[^a-z0-9]/gi, "");
    if (!conv || !(conv.atts || []).includes(id)) return json(403, { ok: false, error: "You can't open this file." });
    const a = await store.get(`att:${id}`);
    if (!a) return json(404, { ok: false, error: "File not found." });
    return json(200, { ok: true, name: a.name, mime: a.mime, data: a.data });
  }

  return json(400, { ok: false, error: "Unknown action" });
}
