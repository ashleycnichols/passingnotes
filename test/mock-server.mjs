// Local test server: serves the app and fakes the Supabase backend in memory.
// Run: node test/mock-server.mjs  then open http://localhost:5174
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 5174);
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const db = { scenes: [], participants: [], characters: [], links: [], posts: [] };
let clock = Date.now();
const now = () => new Date((clock = Math.max(clock + 1, Date.now()))).toISOString();
const pub = (c) => { const { owner_key, ...rest } = c; return rest; };
const subs = new Map(); // sceneId -> Set(res)

function emit(sceneId, ev) {
  for (const res of subs.get(sceneId) || []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
}
function emitAll(ev) {
  for (const set of subs.values()) for (const res of set) res.write(`data: ${JSON.stringify(ev)}\n\n`);
}

const api = {
  getSceneBySlug: (slug) => db.scenes.find((s) => s.slug === slug) || null,
  getScenesBySlugs: (slugs) => db.scenes.filter((s) => slugs.includes(s.slug)),
  getScenesByIds: (ids) => db.scenes.filter((s) => ids.includes(s.id)),
  createScene(scene) {
    if (db.scenes.some((s) => s.slug === scene.slug)) throw new Error('duplicate key value violates unique constraint');
    const row = { id: randomUUID(), theme: 'paper', font: 'lora', created_at: now(), updated_at: now(), last_post_at: null, ...scene };
    db.scenes.push(row);
    return row;
  },
  updateScene(id, patch) {
    const s = db.scenes.find((x) => x.id === id);
    Object.assign(s, patch, { updated_at: now() });
    emit(id, { type: 'scene', row: s });
    return s;
  },
  joinScene(sceneId, deviceId, playerName) {
    if (!db.scenes.some((s) => s.id === sceneId)) return 'missing';
    if (db.participants.some((p) => p.scene_id === sceneId && p.device_id === deviceId)) return 'already';
    if (db.participants.filter((p) => p.scene_id === sceneId).length >= 10) return 'full';
    db.participants.push({ id: randomUUID(), scene_id: sceneId, device_id: deviceId, player_name: playerName || null, joined_at: now() });
    emit(sceneId, { type: 'participants' });
    return 'joined';
  },
  getParticipants: (sceneId) => db.participants.filter((p) => p.scene_id === sceneId),
  setPlayerName(sceneId, deviceId, name) {
    db.participants.filter((p) => p.scene_id === sceneId && p.device_id === deviceId).forEach((p) => (p.player_name = name || null));
    emit(sceneId, { type: 'participants' });
  },
  getRoster: (sceneIds) =>
    db.links.filter((l) => sceneIds.includes(l.scene_id)).map((l) => {
      const c = db.characters.find((x) => x.id === l.character_id);
      return c && { ...pub(c), link_id: l.id, scene_id: l.scene_id, added_by_device: l.added_by_device, added_at: l.added_at };
    }).filter(Boolean),
  getCharacters: (ids) => db.characters.filter((c) => ids.includes(c.id)).map(pub),
  createCharacter(c) {
    db.characters.push({ created_at: now(), updated_at: now(), ...c });
  },
  updateCharacter(id, key, f) {
    const c = db.characters.find((x) => x.id === id && x.owner_key === key);
    if (!c) throw new Error('This device does not hold the key for that character.');
    Object.assign(c, f, { updated_at: now() });
  },
  deleteCharacter(id, key) {
    const c = db.characters.find((x) => x.id === id && x.owner_key === key && !x.deleted_at);
    if (!c) throw new Error('This device does not hold the key for that character.');
    c.deleted_at = now();
    const scenes = db.links.filter((l) => l.character_id === id).map((l) => l.scene_id);
    db.links = db.links.filter((l) => l.character_id !== id);
    scenes.forEach((s) => emit(s, { type: 'roster' }));
  },
  savePushSubscription(deviceId, endpoint, p256dh, auth, characterIds) {
    db.push = (db.push || []).filter((x) => x.endpoint !== endpoint);
    db.push.push({ deviceId, endpoint, p256dh, auth, characterIds });
  },
  removePushSubscription(endpoint) {
    db.push = (db.push || []).filter((x) => x.endpoint !== endpoint);
  },
  getScenesForViewer: (views) => db.scenes.filter((s) => s.view_slug && views.includes(s.view_slug)).map(({ slug, ...rest }) => rest),
  ensureViewSlug(sceneId) {
    const s = db.scenes.find((x) => x.id === sceneId);
    if (!s.view_slug) s.view_slug = 'r' + randomUUID().replace(/-/g, '').slice(0, 11);
    return s.view_slug;
  },
  deleteScene(sceneId, deviceId) {
    const s = db.scenes.find((x) => x.id === sceneId && x.created_by_device === deviceId);
    if (!s) return false;
    emit(sceneId, { type: 'sceneDeleted' });
    db.scenes = db.scenes.filter((x) => x.id !== sceneId);
    db.posts = db.posts.filter((p) => p.scene_id !== sceneId);
    db.participants = db.participants.filter((p) => p.scene_id !== sceneId);
    db.links = db.links.filter((l) => l.scene_id !== sceneId);
    return true;
  },
  listUniverses() {
    const m = new Map();
    [...db.scenes, ...db.characters].forEach((x) => {
      const n = (x.universe || '').trim();
      if (n && !m.has(n.toLowerCase())) m.set(n.toLowerCase(), n);
    });
    return [...m.values()];
  },
  reclaimCharacter(id, sceneId) {
    if (!db.links.some((l) => l.character_id === id && l.scene_id === sceneId)) return null;
    return db.characters.find((c) => c.id === id)?.owner_key || null;
  },
  verifyKey: (id, key) => db.characters.some((c) => c.id === id && c.owner_key === key),
  addToScene(sceneId, characterId, deviceId) {
    if (db.links.some((l) => l.scene_id === sceneId && l.character_id === characterId)) return;
    db.links.push({ id: randomUUID(), scene_id: sceneId, character_id: characterId, added_by_device: deviceId, added_at: now() });
    emit(sceneId, { type: 'roster' });
  },
  removeFromScene(sceneId, characterId) {
    db.links = db.links.filter((l) => !(l.scene_id === sceneId && l.character_id === characterId));
    emit(sceneId, { type: 'roster' });
  },
  getSceneIdsForCharacters: (ids) => db.links.filter((l) => ids.includes(l.character_id)).map((l) => ({ scene_id: l.scene_id, character_id: l.character_id })),
  getPosts(sceneId, channel, { before, limit = 50 } = {}) {
    let list = db.posts.filter((p) => p.scene_id === sceneId && p.channel === channel);
    if (before) list = list.filter((p) => p.created_at < before);
    return list.sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-limit);
  },
  getAllPosts: (sceneId, channels) => db.posts.filter((p) => p.scene_id === sceneId && channels.includes(p.channel)).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  getMentions: (sceneIds, ids) => db.posts.filter((p) => sceneIds.includes(p.scene_id) && p.channel === 'ooc' && p.ref_post_id && (p.tagged_character_ids || []).some((t) => ids.includes(t))),
  getLatestChapter: (sceneId) => db.posts.filter((p) => p.scene_id === sceneId && p.kind === 'chapter').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null,
  getLatestPost: (sceneId) => db.posts.filter((p) => p.scene_id === sceneId && p.channel === 'story').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null,
  createPost(p) {
    const row = { id: randomUUID(), created_at: now(), updated_at: now(), tagged_character_ids: [], ...p };
    db.posts.push(row);
    if (row.channel === 'story') db.scenes.find((s) => s.id === row.scene_id).last_post_at = row.created_at;
    emit(row.scene_id, { type: 'post', row });
    return row;
  },
  updatePost(id, patch) {
    const p = db.posts.find((x) => x.id === id);
    Object.assign(p, patch, { updated_at: now() });
    emit(p.scene_id, { type: 'post', row: p });
    return p;
  },
  deletePost(id) {
    const gone = db.posts.filter((p) => p.id === id || p.ref_post_id === id).map((p) => p.id);
    db.posts = db.posts.filter((p) => !gone.includes(p.id));
    gone.forEach((g) => emitAll({ type: 'postDeleted', id: g }));
  },
  uploadPhoto: (_id, dataUrl) => dataUrl,
  broadcast(sceneId, ev) {
    emit(sceneId, ev);
  },
  __reset() {
    Object.keys(db).forEach((k) => (db[k] = []));
  },
  __dump: () => db,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const fn = url.pathname.slice(5);
      let body = '';
      for await (const chunk of req) body += chunk;
      const args = body ? JSON.parse(body) : [];
      await new Promise((r) => setTimeout(r, 15));
      try {
        const data = await api[fn](...args);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: data ?? null }));
      } catch (e) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (url.pathname === '/events') {
      const scene = url.searchParams.get('scene');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': hi\n\n');
      if (!subs.has(scene)) subs.set(scene, new Set());
      subs.get(scene).add(res);
      req.on('close', () => subs.get(scene).delete(res));
      return;
    }
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(`window.PN_CONFIG = { appName: 'Passing Notes', mock: 'http://localhost:${PORT}', vapidPublicKey: 'BLKEZ_b5DGTyNjzG67xIWA7g5SJ8TJmZaWW4ssuBaEY_K8d8DPZRP1nxp__oIv9czMNGe9m2953aj99S0IIV1aI' };`);
      return;
    }
    const path = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!path.startsWith(ROOT)) throw new Error('nope');
    const file = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, () => console.log(`Mock app on http://localhost:${PORT}`));
