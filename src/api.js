// Data layer. The rest of the app only talks to these functions.
// Real mode uses Supabase. Test mode (config.mock) talks to a local test server.

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const CHAR_BASE = 'id,name,color,photo_url,universe,created_by_device,created_at,updated_at';
let CHAR_COLS = `${CHAR_BASE},deleted_at`;
// Until the character-delete migration has run, fall back to the older column list.
async function withCharCols(fn) {
  try {
    return await fn(CHAR_COLS);
  } catch (e) {
    if (CHAR_COLS !== CHAR_BASE && /deleted_at/.test(e.message || '')) {
      CHAR_COLS = CHAR_BASE;
      return fn(CHAR_COLS);
    }
    throw e;
  }
}
const BUCKET = 'character-photos';

let apiPromise = null;

export function getApi() {
  if (!apiPromise) {
    const cfg = window.PN_CONFIG || {};
    apiPromise = cfg.mock ? Promise.resolve(mockApi(cfg.mock)) : supabaseApi(cfg);
  }
  return apiPromise;
}

export function isConfigured() {
  const cfg = window.PN_CONFIG || {};
  return !!(cfg.mock || (cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('YOUR-')));
}

function check({ data, error }) {
  if (error) {
    const e = new Error(error.message || 'Something went wrong');
    e.code = error.code;
    throw e;
  }
  return data;
}

function flattenRoster(rows) {
  return (rows || [])
    .filter((r) => r.characters)
    .map((r) => ({ ...r.characters, link_id: r.id, scene_id: r.scene_id, added_by_device: r.added_by_device, added_at: r.added_at }));
}

async function supabaseApi(cfg) {
  const { createClient } = await import(/* @vite-ignore */ SUPABASE_ESM);
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  const api = {
    async getSceneBySlug(slug) {
      const rows = check(await sb.from('scenes').select('*').eq('slug', slug).limit(1));
      return rows[0] || null;
    },
    async getScenesBySlugs(slugs) {
      if (!slugs.length) return [];
      return check(await sb.from('scenes').select('*').in('slug', slugs));
    },
    async getScenesByIds(ids) {
      if (!ids.length) return [];
      return check(await sb.from('scenes').select('*').in('id', ids));
    },
    async createScene(scene) {
      return check(await sb.from('scenes').insert(scene).select('*').single());
    },
    async updateScene(id, patch) {
      return check(await sb.from('scenes').update(patch).eq('id', id).select('*').single());
    },
    async joinScene(sceneId, deviceId, playerName) {
      return check(await sb.rpc('join_scene', { p_scene_id: sceneId, p_device_id: deviceId, p_player_name: playerName || null }));
    },
    async getParticipants(sceneId) {
      return check(await sb.from('scene_participants').select('*').eq('scene_id', sceneId));
    },
    async setPlayerName(sceneId, deviceId, name) {
      check(await sb.from('scene_participants').update({ player_name: name || null }).eq('scene_id', sceneId).eq('device_id', deviceId));
    },
    async getRoster(sceneIds) {
      if (!sceneIds.length) return [];
      const rows = await withCharCols(async (cols) => check(
        await sb
          .from('scene_characters')
          .select(`id,scene_id,added_by_device,added_at,characters(${cols})`)
          .in('scene_id', sceneIds)
          .order('added_at'),
      ));
      return flattenRoster(rows);
    },
    async getCharacters(ids) {
      if (!ids.length) return [];
      return withCharCols(async (cols) => check(await sb.from('characters').select(cols).in('id', ids)));
    },
    async createCharacter(c) {
      check(await sb.from('characters').insert(c));
    },
    async updateCharacter(id, key, f) {
      const ok = check(
        await sb.rpc('update_character', {
          p_character_id: id, p_key: key, p_name: f.name, p_color: f.color, p_photo_url: f.photo_url || null, p_universe: f.universe || null,
        }),
      );
      if (!ok) throw new Error('This device does not hold the key for that character.');
    },
    async deleteCharacter(id, key) {
      const ok = check(await sb.rpc('delete_character', { p_character_id: id, p_key: key }));
      if (!ok) throw new Error('This device does not hold the key for that character.');
    },
    async savePushSubscription(deviceId, endpoint, p256dh, auth, characterIds) {
      check(await sb.rpc('save_push_subscription', {
        p_device_id: deviceId, p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_character_ids: characterIds,
      }));
    },
    async removePushSubscription(endpoint) {
      check(await sb.rpc('remove_push_subscription', { p_endpoint: endpoint }));
    },
    async getScenesForViewer(views) {
      if (!views.length) return [];
      return check(await sb.rpc('get_scenes_for_viewer', { p_views: views })) || [];
    },
    async ensureViewSlug(sceneId) {
      return check(await sb.rpc('ensure_view_slug', { p_scene_id: sceneId }));
    },
    async deleteScene(sceneId, deviceId) {
      return !!check(await sb.rpc('delete_scene', { p_scene_id: sceneId, p_device_id: deviceId }));
    },
    async listUniverses() {
      const rows = check(await sb.rpc('list_universes'));
      return (rows || []).map((r) => r.name).filter(Boolean);
    },
    async reclaimCharacter(id, sceneId) {
      return check(await sb.rpc('reclaim_character', { p_character_id: id, p_scene_id: sceneId }));
    },
    async verifyKey(id, key) {
      return !!check(await sb.rpc('verify_character_key', { p_character_id: id, p_key: key }));
    },
    async addToScene(sceneId, characterId, deviceId) {
      const res = await sb.from('scene_characters').insert({ scene_id: sceneId, character_id: characterId, added_by_device: deviceId });
      if (res.error && res.error.code !== '23505') check(res);
    },
    async removeFromScene(sceneId, characterId) {
      check(await sb.from('scene_characters').delete().eq('scene_id', sceneId).eq('character_id', characterId));
    },
    async getSceneIdsForCharacters(ids) {
      if (!ids.length) return [];
      return check(await sb.from('scene_characters').select('scene_id,character_id').in('character_id', ids));
    },
    async getPosts(sceneId, channel, { before, limit = 50 } = {}) {
      let q = sb.from('posts').select('*').eq('scene_id', sceneId).eq('channel', channel).order('created_at', { ascending: false }).limit(limit);
      if (before) q = q.lt('created_at', before);
      return check(await q).reverse();
    },
    async getAllPosts(sceneId, channels) {
      const out = [];
      let from = 0;
      for (;;) {
        const page = check(
          await sb.from('posts').select('*').eq('scene_id', sceneId).in('channel', channels).order('created_at').range(from, from + 999),
        );
        out.push(...page);
        if (page.length < 1000) break;
        from += 1000;
      }
      return out;
    },
    async getMentions(sceneIds, characterIds) {
      if (!sceneIds.length || !characterIds.length) return [];
      return check(
        await sb.from('posts').select('id,scene_id,author_device_id,created_at,tagged_character_ids')
          .in('scene_id', sceneIds).eq('channel', 'ooc').not('ref_post_id', 'is', null)
          .overlaps('tagged_character_ids', characterIds).order('created_at', { ascending: false }).limit(200),
      );
    },
    async getLatestChapter(sceneId) {
      const rows = check(
        await sb.from('posts').select('id,body,created_at').eq('scene_id', sceneId).eq('kind', 'chapter').order('created_at', { ascending: false }).limit(1),
      );
      return rows[0] || null;
    },
    async getLatestPost(sceneId) {
      const rows = check(
        await sb.from('posts').select('*').eq('scene_id', sceneId).eq('channel', 'story').order('created_at', { ascending: false }).limit(1),
      );
      return rows[0] || null;
    },
    async createPost(p) {
      return check(await sb.from('posts').insert(p).select('*').single());
    },
    async updatePost(id, patch) {
      return check(await sb.from('posts').update(patch).eq('id', id).select('*').single());
    },
    async deletePost(id) {
      check(await sb.from('posts').delete().eq('id', id));
    },
    async uploadPhoto(characterId, blob) {
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${characterId}/${Date.now().toString(36)}.${ext}`;
      check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }));
      return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    },
    subscribeScene(sceneId, h) {
      const f = `scene_id=eq.${sceneId}`;
      const ch = sb
        .channel(`scene:${sceneId}`, { config: { broadcast: { self: false } } })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: f }, (p) => h.onPost?.(p.new))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts', filter: f }, (p) => h.onPost?.(p.new))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (p) => p.old?.id && h.onPostDeleted?.(p.old.id))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scene_characters', filter: f }, () => h.onRoster?.())
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'scene_characters' }, (p) => h.onRosterDelete?.(p.old?.id))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'scene_participants', filter: f }, () => h.onParticipants?.())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'scenes', filter: `id=eq.${sceneId}` }, (p) => h.onScene?.(p.new))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'scenes' }, (p) => p.old?.id === sceneId && h.onSceneDeleted?.())
        .on('broadcast', { event: 'character' }, () => h.onRoster?.())
        .subscribe((status) => h.onStatus?.(status));
      return {
        broadcastCharacter(id) {
          ch.send({ type: 'broadcast', event: 'character', payload: { id } });
        },
        close() {
          sb.removeChannel(ch);
        },
      };
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Test mode: every call goes to a tiny local server, events come back over SSE.
// ---------------------------------------------------------------------------
function mockApi(base) {
  const call = async (fn, ...args) => {
    const r = await fetch(`${base}/api/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.data;
  };
  const names = [
    'getSceneBySlug', 'getScenesBySlugs', 'getScenesByIds', 'createScene', 'updateScene', 'joinScene', 'getParticipants', 'setPlayerName',
    'getRoster', 'getCharacters', 'createCharacter', 'updateCharacter', 'verifyKey', 'reclaimCharacter', 'listUniverses', 'getMentions', 'getLatestChapter', 'getScenesForViewer', 'ensureViewSlug', 'deleteScene', 'deleteCharacter', 'savePushSubscription', 'removePushSubscription', 'addToScene', 'removeFromScene',
    'getSceneIdsForCharacters', 'getPosts', 'getAllPosts', 'getLatestPost', 'createPost', 'updatePost', 'deletePost',
  ];
  const api = {};
  names.forEach((n) => (api[n] = (...a) => call(n, ...a)));
  api.uploadPhoto = async (characterId, blob) => {
    const dataUrl = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
    return call('uploadPhoto', characterId, dataUrl);
  };
  api.subscribeScene = (sceneId, h) => {
    const es = new EventSource(`${base}/events?scene=${sceneId}`);
    es.onopen = () => h.onStatus?.('SUBSCRIBED');
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'post') h.onPost?.(ev.row);
      if (ev.type === 'postDeleted') h.onPostDeleted?.(ev.id);
      if (ev.type === 'roster') h.onRoster?.();
      if (ev.type === 'participants') h.onParticipants?.();
      if (ev.type === 'scene') h.onScene?.(ev.row);
      if (ev.type === 'sceneDeleted') h.onSceneDeleted?.();
    };
    return {
      broadcastCharacter() {
        call('broadcast', sceneId, { type: 'roster' });
      },
      close() {
        es.close();
      },
    };
  };
  return api;
}
