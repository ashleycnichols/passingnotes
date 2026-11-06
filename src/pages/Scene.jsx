import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getApi } from '../api.js';
import { getState, update, useStore, rememberScene, rememberUniverse, addMyCharacter, forgetScene, rememberRead, forgetRead } from '../store.js';
import { go } from '../router.js';
import { Avatar, Confirm, Icon, Segmented, Sheet, toast, errMsg, UniverseInput, useMedia } from '../ui.jsx';
import { encodeTags, firstLine } from '../text.jsx';
import { themeOf, themeStyle, readableColor, TEXT_SIZES } from '../look.js';
import { universeKey, inAppBrowser } from '../util.js';
import Feed from '../components/Feed.jsx';
import Composer from '../components/Composer.jsx';
import { CharacterForm, ShareCharacterSheet } from '../components/Characters.jsx';
import { ExportSheet } from '../components/Export.jsx';
import { LookPicker } from '../components/Look.jsx';
import { InviteSheet } from './NewScene.jsx';
import { usePushStatus, enablePush, disablePush } from '../push.js';

const PAGE = 50;
const MAX_PLAYERS = 10;

function merge(list, rows) {
  const m = new Map(list.map((p) => [p.id, p]));
  rows.forEach((r) => m.set(r.id, { ...m.get(r.id), ...r }));
  return [...m.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function nearBottom() {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
}

function scrollToBottom(smooth = false) {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

export default function Scene({ slug: playerSlug, viewToken, jumpPost }) {
  // Readers arrive with a read-only link: they can read along but never join or post.
  const reader = !!viewToken;
  const slug = playerSlug || `r-${viewToken}`;
  const selfPath = reader ? `/r/${viewToken}` : `/s/${slug}`;
  const deviceId = useStore((s) => s.deviceId);
  const myChars = useStore((s) => s.myCharacters);
  const textSize = useStore((s) => s.textSize);
  const lastIdentity = useStore((s) => s.lastIdentity[slug]);
  const seenDesc = useStore((s) => !!s.seenDescription[slug]);
  const playerName = useStore((s) => s.playerName);

  const [scene, setScene] = useState(undefined);
  const [loadErr, setLoadErr] = useState(null);
  const [roster, setRoster] = useState([]);
  const [extraChars, setExtraChars] = useState({});
  const [participants, setParticipants] = useState([]);
  const [posts, setPosts] = useState({ story: [], ooc: [] });
  const [more, setMore] = useState({ story: false, ooc: false });
  const [view, setView] = useState('story');
  const [unread, setUnread] = useState({ story: false, ooc: false });
  const [newPill, setNewPill] = useState(false);
  const [sheet, setSheet] = useState(null); // 'invite' | 'join' | 'roster' | 'settings' | 'export' | 'identity' | 'menu' | 'name'
  const [charForm, setCharForm] = useState(null); // { character? }
  const [sharing, setSharing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [reclaiming, setReclaiming] = useState(null);
  const [chapterEdit, setChapterEdit] = useState(null); // a chapter post being renamed
  const [chapterBefore, setChapterBefore] = useState(null); // insert a chapter break just before this post
  const [descOpen, setDescOpen] = useState(!seenDesc);
  const [online, setOnline] = useState(navigator.onLine);
  const desktop = useMedia('(min-width: 1100px)');
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;
  useEffect(() => {
    if (desktop) setView('story');
  }, [desktop]);

  const sub = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sceneRef = useRef(null);
  sceneRef.current = scene;

  const theme = themeOf(scene?.theme);
  const colorFor = useCallback((c) => readableColor(c, theme.bg), [theme.bg]);

  const charsById = useMemo(() => {
    const m = { ...extraChars };
    roster.forEach((c) => (m[c.id] = c));
    return m;
  }, [roster, extraChars]);
  const myIds = useMemo(() => new Set(myChars.map((c) => c.id)), [myChars]);
  const myInScene = roster.filter((c) => myIds.has(c.id));
  const joined = !reader && participants.some((p) => p.device_id === deviceId);
  const full = !reader && !joined && participants.length >= MAX_PLAYERS;
  const playersByDevice = useMemo(() => Object.fromEntries(participants.map((p) => [p.device_id, p])), [participants]);
  const rosterByDevice = useMemo(() => {
    const m = {};
    roster.forEach((c) => (m[c.added_by_device] = m[c.added_by_device] || []).push(c));
    return m;
  }, [roster]);

  const identity = useMemo(() => {
    if (!joined) return null;
    if (lastIdentity === 'narrator') return 'narrator';
    if (lastIdentity && myInScene.some((c) => c.id === lastIdentity)) return lastIdentity;
    return myInScene[0]?.id || 'narrator';
  }, [joined, lastIdentity, myInScene]);
  const setIdentity = (id) => update((s) => (s.lastIdentity = { ...s.lastIdentity, [slug]: id }));

  // ---- loading -------------------------------------------------------------
  const loadRoster = useCallback(async (sceneId) => {
    const api = await getApi();
    setRoster(await api.getRoster([sceneId]));
  }, []);
  const loadParticipants = useCallback(async (sceneId) => {
    const api = await getApi();
    setParticipants(await api.getParticipants(sceneId));
  }, []);
  const loadLatest = useCallback(async (sceneId, first = false) => {
    const api = await getApi();
    const [s, o] = await Promise.all([api.getPosts(sceneId, 'story', { limit: PAGE }), api.getPosts(sceneId, 'ooc', { limit: PAGE })]);
    const wasNear = nearBottom();
    setPosts((prev) => (first ? { story: s, ooc: o } : { story: merge(prev.story, s), ooc: merge(prev.ooc, o) }));
    if (first) setMore({ story: s.length === PAGE, ooc: o.length === PAGE });
    if (first || wasNear) requestAnimationFrame(() => scrollToBottom());
  }, []);

  useEffect(() => {
    let alive = true;
    setScene(undefined);
    (async () => {
      try {
        const api = await getApi();
        const s = reader ? (await api.getScenesForViewer([viewToken]))[0] || null : await api.getSceneBySlug(slug);
        if (!alive) return;
        if (!s) {
          setScene(null);
          return;
        }
        setScene(s);
        const parts = await api.getParticipants(s.id);
        if (!alive) return;
        setParticipants(parts);
        if (reader) rememberRead(viewToken);
        else if (parts.some((p) => p.device_id === getState().deviceId)) rememberScene(slug);
        await Promise.all([loadRoster(s.id), loadLatest(s.id, true)]);
        sub.current = api.subscribeScene(s.id, {
          onPost: (row) => {
            const ch = row.channel;
            setPosts((prev) => ({ ...prev, [ch]: merge(prev[ch], [row]) }));
            const mine = row.author_device_id === getState().deviceId;
            const owned = new Set(getState().myCharacters.map((c) => c.id));
            const pingsMe = ch === 'ooc' && row.ref_post_id && (row.tagged_character_ids || []).some((id) => owned.has(id));
            const visible = ch === viewRef.current || (desktopRef.current && ch === 'ooc');
            if (pingsMe && !mine && visible) toast('You were tagged. Tap “Go to post” to see it.');
            if (desktopRef.current && ch === 'ooc') return;
            if (ch !== viewRef.current) {
              if (!mine) setUnread((u) => ({ ...u, [ch]: pingsMe || u[ch] === 'mention' ? 'mention' : true }));
            } else if (nearBottom() || mine) {
              requestAnimationFrame(() => scrollToBottom(true));
            } else {
              setNewPill(true);
            }
          },
          onPostDeleted: (id) => setPosts((prev) => ({ story: prev.story.filter((p) => p.id !== id), ooc: prev.ooc.filter((p) => p.id !== id && p.ref_post_id !== id) })),
          onRoster: () => loadRoster(s.id),
          onRosterDelete: () => loadRoster(s.id),
          onParticipants: () => loadParticipants(s.id),
          onScene: (row) => setScene((cur) => ({ ...cur, ...row })),
          onSceneDeleted: () => {
            if (reader) forgetRead(viewToken);
            else forgetScene(slug);
            toast('This scene was deleted by its creator.');
            go('/', { replace: true });
          },
          onStatus: (st) => {
            if (st === 'SUBSCRIBED') loadLatest(s.id);
          },
        });
      } catch (e) {
        if (alive) setLoadErr(errMsg(e));
      }
    })();
    return () => {
      alive = false;
      sub.current?.close();
      sub.current = null;
    };
  }, [slug, loadRoster, loadLatest, loadParticipants]);

  // Catch up when the phone wakes up or the connection returns.
  useEffect(() => {
    const refresh = () => {
      const s = sceneRef.current;
      if (!s || document.visibilityState !== 'visible') return;
      loadLatest(s.id);
      loadRoster(s.id);
      loadParticipants(s.id);
    };
    const on = () => { setOnline(true); refresh(); };
    const off = () => setOnline(false);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [loadLatest, loadRoster, loadParticipants]);

  // Fetch characters that have posts but have since left the roster.
  useEffect(() => {
    const missing = [...new Set([...posts.story, ...posts.ooc].map((p) => p.character_id).filter((id) => id && !charsById[id]))];
    if (!missing.length) return;
    getApi().then((api) => api.getCharacters(missing)).then((list) => {
      if (list.length) setExtraChars((m) => ({ ...m, ...Object.fromEntries(list.map((c) => [c.id, c])) }));
    }).catch(() => {});
  }, [posts, charsById]);

  // Keep this device's OOC name on its participant row in sync.
  useEffect(() => {
    const me = participants.find((p) => p.device_id === deviceId);
    if (!scene || !me || !playerName || me.player_name === playerName) return;
    getApi().then((api) => api.setPlayerName(scene.id, deviceId, playerName)).catch(() => {});
  }, [participants, playerName, deviceId, scene]);

  useEffect(() => {
    if (scene && !seenDesc && scene.description) update((s) => (s.seenDescription = { ...s.seenDescription, [slug]: true }));
  }, [scene, seenDesc, slug]);

  useEffect(() => {
    const onScroll = () => nearBottom() && setNewPill(false);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    setUnread((u) => ({ ...u, [view]: false }));
    setNewPill(false);
    requestAnimationFrame(() => scrollToBottom());
  }, [view]);

  // ---- actions ---------------------------------------------------------------
  const join = async (characterId) => {
    try {
      const api = await getApi();
      const r = await api.joinScene(scene.id, deviceId, getState().playerName);
      if (r === 'full') return toast('This scene is full (10 players).', 'error');
      if (r === 'missing') return toast('This scene no longer exists.', 'error');
      rememberScene(slug);
      if (characterId) {
        await api.addToScene(scene.id, characterId, deviceId);
        setIdentity(characterId);
      }
      await Promise.all([loadParticipants(scene.id), loadRoster(scene.id)]);
      setSheet(null);
      return true;
    } catch (e) {
      toast(errMsg(e), 'error');
      return false;
    }
  };

  const send = async (text, ch = view) => {
    const api = await getApi();
    const { body, tagged } = encodeTags(text, roster);
    const ooc = ch === 'ooc';
    const row = {
      scene_id: scene.id,
      channel: ch,
      kind: ooc ? 'player' : identity === 'narrator' ? 'narrator' : 'character',
      character_id: ooc || identity === 'narrator' ? null : identity,
      author_device_id: deviceId,
      body,
      tagged_character_ids: tagged,
    };
    try {
      const saved = await api.createPost(row);
      setPosts((prev) => ({ ...prev, [ch]: merge(prev[ch], [saved]) }));
      if (!ooc) requestAnimationFrame(() => scrollToBottom(true));
      if (!ooc) await ping(saved, tagged);
    } catch (e) {
      toast(errMsg(e), 'error');
      throw e;
    }
  };

  const saveName = async (n) => {
    update((s) => (s.playerName = n.slice(0, 40)));
    try {
      const api = await getApi();
      await api.setPlayerName(scene.id, deviceId, n.slice(0, 40));
      await loadParticipants(scene.id);
      setSheet(null);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  // Honour system: anyone can take over a character in this scene. Everyone sees a note in OOC.
  const reclaim = async (c) => {
    try {
      const api = await getApi();
      if (!joined) {
        const r = await api.joinScene(scene.id, deviceId, getState().playerName);
        if (r === 'full') return toast('This scene is full (10 players).', 'error');
        rememberScene(slug);
      }
      const key = await api.reclaimCharacter(c.id, scene.id);
      if (!key) return toast('That character is no longer in this scene.', 'error');
      addMyCharacter(c.id, key);
      setIdentity(c.id);
      const note = await api.createPost({
        scene_id: scene.id, channel: 'ooc', kind: 'player', character_id: null, author_device_id: deviceId,
        body: `@[${c.name}](${c.id}) was reclaimed on a new device.`, tagged_character_ids: [c.id],
      });
      setPosts((prev) => ({ ...prev, ooc: merge(prev.ooc, [note]) }));
      await loadParticipants(scene.id);
      setSheet(null);
      toast(`You’re playing ${c.name} on this device`);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const canEdit = useCallback(
    (p) => p.author_device_id === deviceId
      || (p.channel === 'story' && p.character_id && myIds.has(p.character_id))
      || (p.channel === 'story' && (p.tagged_character_ids || []).some((id) => myIds.has(id))),
    [deviceId, myIds],
  );

  // Drop a note in OOC chat so the players of tagged characters notice.
  const ping = async (post, taggedIds) => {
    const owned = new Set(getState().myCharacters.map((c) => c.id));
    const targets = [...new Set(taggedIds)].filter((id) => !owned.has(id) && id !== post.character_id && charsById[id]);
    if (!targets.length) return;
    const by = post.kind === 'narrator' ? 'The Narrator' : charsById[post.character_id] ? `@[${charsById[post.character_id].name}](${post.character_id})` : 'Someone';
    const names = targets.map((id) => `@[${charsById[id].name}](${id})`);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    try {
      const api = await getApi();
      const note = await api.createPost({
        scene_id: scene.id, channel: 'ooc', kind: 'player', character_id: null, author_device_id: deviceId,
        body: `${by} tagged ${list} in the story.`, tagged_character_ids: targets, ref_post_id: post.id,
      });
      setPosts((prev) => ({ ...prev, ooc: merge(prev.ooc, [note]) }));
    } catch {
      // The story post went through; a missing ping is not worth an error.
    }
  };

  const editPost = async (p, body, tagged) => {
    const api = await getApi();
    const saved = await api.updatePost(p.id, { body, tagged_character_ids: tagged });
    setPosts((prev) => ({ ...prev, [p.channel]: merge(prev[p.channel], [saved]) }));
    if (p.channel === 'story') {
      const before = new Set(p.tagged_character_ids || []);
      await ping(saved, tagged.filter((id) => !before.has(id)));
    }
  };

  // Opened from a notification: jump to the tagged post once the story has loaded.
  const jumped = useRef(false);
  useEffect(() => {
    if (!jumpPost || jumped.current || !posts.story.length) return;
    jumped.current = true;
    history.replaceState(null, '', `#${selfPath}`);
    jumpTo(jumpPost);
  }, [jumpPost, posts.story.length]);

  const chapters = posts.story.filter((p) => p.kind === 'chapter');
  const saveChapter = async (title, existing, before) => {
    try {
      const api = await getApi();
      if (existing) {
        const saved = await api.updatePost(existing.id, { body: title });
        setPosts((prev) => ({ ...prev, story: merge(prev.story, [saved]) }));
      } else {
        const row = {
          scene_id: scene.id, channel: 'story', kind: 'chapter', character_id: null, author_device_id: deviceId, body: title, tagged_character_ids: [],
        };
        // Going back in time: slot the break in a millisecond before the chosen post.
        if (before) row.created_at = new Date(Date.parse(before.created_at) - 1).toISOString();
        const saved = await api.createPost(row);
        setPosts((prev) => ({ ...prev, story: merge(prev.story, [saved]) }));
        if (before) window.dispatchEvent(new CustomEvent('pn:reveal', { detail: before.id }));
        else requestAnimationFrame(() => scrollToBottom(true));
      }
      setChapterEdit(null);
      setChapterBefore(null);
      setSheet(null);
    } catch (e) {
      toast(/kind_check|violates check/i.test(e.message) ? 'Chapters need a quick database update first (the chapters SQL file).' : errMsg(e), 'error');
    }
  };

  const deleteScene = async () => {
    try {
      const api = await getApi();
      const ok = await api.deleteScene(scene.id, deviceId);
      if (!ok) return toast('Only the device that created this scene can delete it.', 'error');
      forgetScene(slug);
      toast(`Deleted “${scene.title}”`);
      go('/', { replace: true });
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const jumpTo = (postId) => {
    setView('story');
    window.dispatchEvent(new CustomEvent('pn:reveal', { detail: postId }));
    setTimeout(() => {
      const el = document.getElementById(`post-${postId}`);
      if (!el) return toast('That post is further back. Tap “Load earlier” to find it.');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1800);
    }, 120);
  };

  const deletePost = async (p) => {
    try {
      const api = await getApi();
      await api.deletePost(p.id);
      setPosts((prev) => ({ story: prev.story.filter((x) => x.id !== p.id), ooc: prev.ooc.filter((x) => x.id !== p.id && x.ref_post_id !== p.id) }));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const loadEarlier = async () => {
    const list = posts[view];
    if (!list.length) return;
    const api = await getApi();
    const before = list[0].created_at;
    const h0 = document.documentElement.scrollHeight;
    const y0 = window.scrollY;
    const older = await api.getPosts(scene.id, view, { before, limit: PAGE });
    setPosts((prev) => ({ ...prev, [view]: merge(prev[view], older) }));
    setMore((m) => ({ ...m, [view]: older.length === PAGE }));
    requestAnimationFrame(() => window.scrollTo(0, y0 + document.documentElement.scrollHeight - h0));
  };

  const characterSaved = async (c, isNew) => {
    setCharForm(null);
    await loadRoster(scene.id);
    if (isNew) setIdentity(c.id);
    sub.current?.broadcastCharacter(c.id);
    if (!isNew) setExtraChars((m) => ({ ...m, [c.id]: { ...m[c.id], ...c } }));
  };

  const addExisting = async (id) => {
    try {
      const api = await getApi();
      await api.addToScene(scene.id, id, deviceId);
      await loadRoster(scene.id);
      setIdentity(id);
      setSheet(null);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  // ---- render ----------------------------------------------------------------
  if (loadErr) {
    return (
      <div className="page"><main className="content narrow">
        <p className="error-box">{loadErr}</p>
        <button className="btn" onClick={() => location.reload()}>Try again</button>
      </main></div>
    );
  }
  if (scene === undefined) {
    return <div className="page"><div className="loading-scene"><span className="spinner" /> Opening scene…</div></div>;
  }
  if (scene === null) {
    return (
      <div className="page"><main className="content narrow empty">
        <Icon name="book" size={36} stroke={1.5} />
        <h2>This scene doesn’t exist or the link is wrong</h2>
        <p className="muted">Check the link with whoever sent it.</p>
        <button className="btn primary" onClick={() => go('/')}>Go home</button>
      </main></div>
    );
  }

  const ctx = { charsById, colorFor, roster };
  const storyById = Object.fromEntries(posts.story.map((p) => [p.id, p]));
  const list = posts[view];
  const identityChar = identity && identity !== 'narrator' ? charsById[identity] : null;
  const savedNotHere = myChars.map((c) => c.id).filter((id) => !roster.some((r) => r.id === id));
  const JOIN_BAR = reader ? (
    <div className="join-bar reader-bar">
      <p><Icon name="book" size={16} /> You’re reading along. To write in this scene, ask a player for an invite link.</p>
    </div>
  ) : (
        <div className="join-bar">
      {full ? (
        <p>This scene is full (10 players). You can still read along.</p>
      ) : (
        <>
          {inAppBrowser() && <p className="small inapp-note">You’re in {inAppBrowser()}’s browser, which forgets your characters. For best results, open this link in Safari or Chrome.</p>}
          <button className="btn primary block" onClick={() => setSheet('join')}>Join this scene</button>
        </>
      )}
    </div>
  );

  return (
    <div className={`page scene-page${theme.dark ? ' dark' : ''}${desktop ? ' desktop' : ''}`} style={themeStyle(scene.theme, scene.font, textSize)}>
      <header className="scene-header">
        <div className="scene-header-row">
          <button className="icon-btn" onClick={() => go('/')} aria-label="Back to my scenes"><Icon name="back" /></button>
          <div className="scene-titles">
            <h1>{scene.title}</h1>
            {scene.universe && <span className="universe-label">{scene.universe}</span>}
          </div>
          {reader ? <span className="reader-pill">Reading</span> : (
            <button className="icon-btn" onClick={() => setSheet('invite')} aria-label="Invite players"><Icon name="share" /></button>
          )}
          <button className="icon-btn" onClick={() => setSheet('menu')} aria-label="Scene menu"><Icon name="more" /></button>
        </div>
        {!desktop && (<>
        <div className="roster-strip">
          <button className="roster-strip-inner" onClick={() => setSheet('roster')} aria-label="Who's in the scene">
            {roster.length === 0 && <span className="muted small">No characters yet</span>}
            {roster.map((c) => (
              <span key={c.id} className="roster-chip">
                <Avatar c={c} size={24} />
                <span style={{ color: colorFor(c.color) }}>{c.name}</span>
              </span>
            ))}
          </button>
          {joined && (
            <button className="chip add-char" onClick={() => setSheet('addChar')}><Icon name="plus" size={14} /> Character</button>
          )}
        </div>
        {!reader && <div className="view-toggle">
          <Segmented value={view} onChange={setView} label="Story or out-of-character chat"
            options={[{ value: 'story', label: 'Story', dot: unread.story }, { value: 'ooc', label: 'OOC chat', dot: unread.ooc }]} />
        </div>}
        </>)}
      </header>

      {!online && <div className="offline-bar">You’re offline. New posts will appear when you reconnect.</div>}

      {desktop ? (
        <div className={`desk-grid${reader ? ' reader' : ''}`}>
          <aside className="desk-left">
            <section className="desk-card">
              <h3 className="desk-h">The scene</h3>
              {scene.description ? <div className="desc-text">{scene.description}</div> : (
                <p className="muted small">No description yet. <button className="link-btn" onClick={() => setSheet('settings')}>Add one</button></p>
              )}
            </section>
            {(chapters.length > 0 || joined) && (
              <section className="desk-card">
                <h3 className="desk-h">Chapters</h3>
                {chapters.length > 0 ? (
                  <ol className="desk-chapters">
                    {posts.story[0]?.kind !== 'chapter' && <li><button onClick={() => jumpTo(posts.story[0].id)}>Beginning</button></li>}
                    {chapters.map((c) => <li key={c.id}><button onClick={() => jumpTo(c.id)}>{c.body}</button></li>)}
                  </ol>
                ) : <p className="muted small">One long chapter so far.</p>}
                {joined && <button className="btn small block" onClick={() => { setChapterEdit(null); setChapterBefore(null); setSheet('chapter'); }}><Icon name="plus" size={16} /> New chapter</button>}
              </section>
            )}
            <section className="desk-card">
              <h3 className="desk-h">Who’s in <span className="muted small">{participants.length} of {MAX_PLAYERS} players</span></h3>
              {roster.length === 0 && <p className="muted small">No characters yet.</p>}
              <ul className="desk-roster">
                {roster.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => setSheet('roster')}>
                      <Avatar c={c} size={30} />
                      <span className="grow left desk-roster-text">
                        <strong style={{ color: colorFor(c.color) }}>{c.name}</strong>
                        <span className="muted small">{myIds.has(c.id) ? 'You' : playersByDevice[c.added_by_device]?.player_name || ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="stack tight">
                {joined && <button className="btn small" onClick={() => setSheet('addChar')}><Icon name="plus" size={16} /> Add a character</button>}
                {!reader && <button className="btn small" onClick={() => setSheet('invite')}><Icon name="share" size={16} /> Invite players</button>}
              </div>
            </section>
          </aside>

          <main className="desk-center">
            {more.story && <button className="btn ghost small center-block" onClick={loadEarlier}>Load earlier</button>}
            <Feed posts={posts.story} channel="story" ctx={ctx} canEdit={canEdit} onEdit={editPost} onDelete={(p) => setConfirmDel(p)}
              storyById={storyById} myIds={myIds} onJump={jumpTo} slug={slug} onChapterEdit={(c) => { setChapterBefore(null); setChapterEdit(c); setSheet('chapter'); }}
          onChapterHere={joined ? (p) => { setChapterEdit(null); setChapterBefore(p); setSheet('chapter'); } : null}
              participantsByDevice={playersByDevice} rosterByDevice={rosterByDevice}
              emptyText="The stage is yours. Write the opening line, or post as Narrator to set the scene." />
            <div className="desk-composer">
              {joined ? (
                <Composer docked large slug={slug} channel="story" identity={identity} identityChar={identityChar} roster={roster} colorFor={colorFor}
                  onPickIdentity={() => setSheet('identity')} onSend={(t) => send(t, 'story')} />
              ) : JOIN_BAR}
            </div>
            {newPill && (
              <button className="new-pill" onClick={() => { scrollToBottom(true); setNewPill(false); }}>New posts ↓</button>
            )}
          </main>

          {!reader && <aside className="desk-right">
            <OocPanel posts={posts.ooc} ctx={ctx} canEdit={canEdit} onEdit={editPost} onDelete={(p) => setConfirmDel(p)}
              storyById={storyById} myIds={myIds} onJump={jumpTo} participantsByDevice={playersByDevice} rosterByDevice={rosterByDevice}>
              {!joined ? (
                <p className="muted small center">Join the scene to chat.</p>
              ) : !playerName ? (
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); const n = e.currentTarget.elements.pn.value.trim(); if (n) saveName(n); }}>
                  <input name="pn" maxLength={40} placeholder="Your name for OOC chat" aria-label="Your name for OOC chat" />
                  <button className="btn primary">Start</button>
                </form>
              ) : (
                <Composer docked slug={slug} channel="ooc" roster={roster} colorFor={colorFor} onSend={(t) => send(t, 'ooc')}
                  placeholder={`Chat as ${playerName}…`} />
              )}
            </OocPanel>
          </aside>}
        </div>
      ) : (
        <>
      <main className={`scene-main ${view}`}>
        {view === 'story' && scene.description && (
          <section className={`desc-card${descOpen ? ' open' : ''}`}>
            <button className="desc-toggle" onClick={() => setDescOpen(!descOpen)} aria-expanded={descOpen}>
              <span>Scene description</span>
              <Icon name="back" size={16} className="chev" />
            </button>
            {descOpen && <div className="desc-text">{scene.description}</div>}
          </section>
        )}
        {more[view] && <button className="btn ghost small center-block" onClick={loadEarlier}>Load earlier</button>}
        <Feed posts={list} channel={view} ctx={ctx} canEdit={canEdit} onEdit={editPost} onDelete={(p) => setConfirmDel(p)}
          storyById={storyById} myIds={myIds} onJump={jumpTo} slug={slug} onChapterEdit={(c) => { setChapterBefore(null); setChapterEdit(c); setSheet('chapter'); }}
          onChapterHere={joined ? (p) => { setChapterEdit(null); setChapterBefore(p); setSheet('chapter'); } : null}
          participantsByDevice={playersByDevice} rosterByDevice={rosterByDevice}
          emptyText={view === 'story' ? 'The stage is yours. Write the opening line, or post as Narrator to set the scene.' : 'Out-of-character chat lives here. Plans, questions, “brb”.'} />
        <div className="feed-spacer" />
      </main>

      {newPill && (
        <button className="new-pill" onClick={() => { scrollToBottom(true); setNewPill(false); }}>New posts ↓</button>
      )}

      {joined && view === 'ooc' && !playerName ? (
        <div className="join-bar">
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); const n = e.currentTarget.elements.pn.value.trim(); if (n) saveName(n); }}>
            <input name="pn" maxLength={40} placeholder="Your name for OOC chat" aria-label="Your name for OOC chat" />
            <button className="btn primary">Start chatting</button>
          </form>
        </div>
      ) : joined ? (
        <Composer slug={slug} channel={view} identity={identity} identityChar={identityChar} roster={roster} colorFor={colorFor}
          onPickIdentity={() => setSheet('identity')} onSend={(t) => send(t)}
          placeholder={`Chat as ${playerName || 'yourself'}…`} />
      ) : (
        JOIN_BAR
      )}

        </>
      )}

      {/* ---- sheets ---- */}
      {sheet === 'invite' && <InviteSheet scene={scene} onClose={() => setSheet(null)} />}

      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title="Scene">
        <div className="menu-list">
          <button onClick={() => setSheet('roster')}><Icon name="users" /> Who’s in the scene</button>
          {joined && <button onClick={() => setSheet('addChar')}><Icon name="plus" /> Add a character</button>}
          {joined && <button onClick={() => { setChapterEdit(null); setChapterBefore(null); setSheet('chapter'); }}><Icon name="book" /> Start a new chapter</button>}
          {!reader && <button onClick={() => setSheet('settings')}><Icon name="settings" /> Scene settings and look</button>}
          <button onClick={() => setSheet('export')}><Icon name="download" /> Export scene</button>
          <button onClick={() => setSheet('text')}><Icon name="book" /> Text size</button>
          {joined && (view === 'ooc' || desktop) && <button onClick={() => setSheet('name')}><Icon name="edit" /> Change my OOC name</button>}
          {!reader && <NotifyMenuItem onNeedsSettings={() => { setSheet(null); go('/settings'); }} />}
          {!reader && scene.created_by_device === deviceId && (
            <button className="danger-text" onClick={() => setSheet('delete')}><Icon name="trash" /> Delete scene</button>
          )}
        </div>
      </Sheet>

      <Sheet open={sheet === 'text'} onClose={() => setSheet(null)} title="Text size (this device)">
        <Segmented value={textSize} onChange={(v) => update((s) => (s.textSize = v))} label="Text size"
          options={Object.keys(TEXT_SIZES).map((k) => ({ value: k, label: k.toUpperCase() }))} />
      </Sheet>

      <Sheet open={sheet === 'roster'} onClose={() => setSheet(null)} title="Who’s in the scene">
        {roster.length === 0 ? <p className="muted">No characters yet.</p> : (
          <ul className="char-list">
            {roster.map((c) => {
              const mine = myIds.has(c.id);
              return (
                <li key={c.id} className="char-row">
                  <Avatar c={c} size={40} />
                  <div className="char-info">
                    <strong style={{ color: colorFor(c.color) }}>{c.name}</strong>
                    <span className="muted small">{mine ? 'You' : playersByDevice[c.added_by_device]?.player_name || ''}</span>
                  </div>
                  {!mine && !reader && (
                    <button className="btn ghost small" onClick={() => { setSheet(null); setReclaiming(c); }}>This is mine</button>
                  )}
                  {mine && (
                    <div className="row-actions">
                      <button className="icon-btn small" aria-label={`Edit ${c.name}`} onClick={() => { setSheet(null); setCharForm({ character: c }); }}><Icon name="edit" size={18} /></button>
                      <button className="icon-btn small" aria-label={`Use ${c.name} on another device`} onClick={() => setSharing(c)}><Icon name="share" size={18} /></button>
                      <button className="icon-btn small" aria-label={`Remove ${c.name} from this scene`} onClick={() => setConfirmDel({ removeChar: c })}><Icon name="trash" size={18} /></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted small">{participants.length} of {MAX_PLAYERS} players have joined.{reader ? '' : ' Lost access to your character on a new phone? Tap “This is mine” next to it.'}</p>
      </Sheet>

      <Sheet open={sheet === 'identity'} onClose={() => setSheet(null)} title="Posting as">
        <div className="menu-list">
          {myInScene.map((c) => (
            <button key={c.id} className={identity === c.id ? 'on' : ''} onClick={() => { setIdentity(c.id); setSheet(null); }}>
              <Avatar c={c} size={30} /> <span style={{ color: colorFor(c.color) }}>{c.name}</span>
              {identity === c.id && <Icon name="check" className="end" />}
            </button>
          ))}
          <button className={identity === 'narrator' ? 'on' : ''} onClick={() => { setIdentity('narrator'); setSheet(null); }}>
            <span className="narrator-badge">N</span> Narrator / GM
            {identity === 'narrator' && <Icon name="check" className="end" />}
          </button>
          <button onClick={() => setSheet('addChar')}><Icon name="plus" /> Add a character</button>
          <button onClick={() => { setChapterEdit(null); setChapterBefore(null); setSheet('chapter'); }}><Icon name="book" /> Start a new chapter</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'addChar'} onClose={() => setSheet(null)} title="Add a character">
        <AddCharacterPicker ids={savedNotHere} sceneUniverse={scene.universe} onPick={addExisting}
          onNew={() => { setSheet(null); setCharForm({}); }} />
      </Sheet>

      <Sheet open={sheet === 'join'} onClose={() => setSheet(null)} title={`Join “${scene.title}”`}>
        <h3 className="sheet-sub">Who’s in the scene</h3>
        {roster.length ? (
          <div className="avatar-row">
            {roster.map((c) => <span key={c.id} className="roster-chip"><Avatar c={c} size={28} /><span style={{ color: colorFor(c.color) }}>{c.name}</span></span>)}
          </div>
        ) : <p className="muted small">Nobody yet. You’re first.</p>}
        <h3 className="sheet-sub">Who are you playing?</h3>
        <AddCharacterPicker ids={myChars.map((c) => c.id)} sceneUniverse={scene.universe} onPick={(id) => join(id)}
          onNew={async () => { if (await join(null)) setCharForm({}); }} />
        <button className="link-btn center-block" onClick={() => join(null)}>Just join for now</button>
        {roster.length > 0 && (
          <button className="link-btn center-block" onClick={() => setSheet('roster')}>Already playing here on another device? Reclaim your character</button>
        )}
      </Sheet>

      <Sheet open={sheet === 'settings'} onClose={() => setSheet(null)} title="Scene settings">
        <SceneSettings scene={scene} onSaved={(s) => { setScene(s); setSheet(null); }} />
      </Sheet>

      <Sheet open={sheet === 'name'} onClose={() => setSheet(null)} title="Your name in OOC chat">
        <PlayerNameForm initial={playerName} onSave={saveName} />
      </Sheet>

      <Confirm open={!!reclaiming} title={`Is ${reclaiming?.name || ''} your character?`} confirmLabel="Yes, it’s mine" danger={false}
        body={`This device will be able to post and edit as ${reclaiming?.name || ''}. Everyone will see a note in OOC chat. Only do this for your own character.`}
        onCancel={() => setReclaiming(null)}
        onConfirm={() => { const c = reclaiming; setReclaiming(null); reclaim(c); }} />

      <Sheet open={sheet === 'chapter'} onClose={() => { setSheet(null); setChapterEdit(null); setChapterBefore(null); }}
        title={chapterEdit ? 'Rename chapter' : chapterBefore ? 'Start a chapter here' : 'Start a new chapter'}>
        <ChapterForm key={chapterEdit?.id || chapterBefore?.id || 'new'} existing={chapterEdit} before={chapterBefore} ctx={{ charsById }}
          defaultTitle={`Chapter ${(chapterBefore ? chapters.filter((c) => c.created_at < chapterBefore.created_at).length : chapters.length) + 2}: `}
          onSave={(t) => saveChapter(t, chapterEdit, chapterBefore)}
          onRemove={chapterEdit ? () => { const c = chapterEdit; setSheet(null); setChapterEdit(null); deletePost(c); } : null} />
      </Sheet>

      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete this scene?">
        <DeleteSceneForm scene={scene} onExport={() => setSheet('export')} onDelete={deleteScene} />
      </Sheet>

      <ExportSheet open={sheet === 'export'} onClose={() => setSheet(null)} scene={scene} canPrint={!reader} charsById={charsById} playersByDevice={playersByDevice} />

      <CharacterForm open={!!charForm} character={charForm?.character || null} scene={charForm?.character ? null : scene}
        onClose={() => setCharForm(null)} onSaved={(c) => characterSaved(c, !charForm?.character)}
        onDeleted={async (c) => { setCharForm(null); setExtraChars((m) => ({ ...m, [c.id]: { ...c, deleted_at: new Date().toISOString() } })); await loadRoster(scene.id); sub.current?.broadcastCharacter(c.id); }} />
      <ShareCharacterSheet character={sharing} onClose={() => setSharing(null)} />

      <Confirm open={!!confirmDel && !confirmDel.removeChar} title="Delete this post?" body="This can’t be undone."
        onCancel={() => setConfirmDel(null)} onConfirm={() => { deletePost(confirmDel); setConfirmDel(null); }} />
      <Confirm open={!!confirmDel?.removeChar} title={`Remove ${confirmDel?.removeChar?.name || ''} from this scene?`}
        body="Their posts stay. The character stays saved on this device." confirmLabel="Remove"
        onCancel={() => setConfirmDel(null)}
        onConfirm={async () => {
          const c = confirmDel.removeChar;
          setConfirmDel(null);
          try {
            const api = await getApi();
            await api.removeFromScene(scene.id, c.id);
            setExtraChars((m) => ({ ...m, [c.id]: c }));
            await loadRoster(scene.id);
          } catch (e) {
            toast(errMsg(e), 'error');
          }
        }} />
    </div>
  );
}

function AddCharacterPicker({ ids, sceneUniverse, onPick, onNew }) {
  const [chars, setChars] = useState(null);
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    getApi().then((api) => api.getCharacters(ids)).then((l) => alive && setChars(l.filter((c) => !c.deleted_at))).catch(() => alive && setChars([]));
    return () => { alive = false; };
  }, [key]);
  const uk = universeKey(sceneUniverse);
  const sorted = (chars || []).slice().sort((a, b) => (universeKey(b.universe) === uk) - (universeKey(a.universe) === uk) || a.name.localeCompare(b.name));
  return (
    <div className="menu-list">
      <button className="primary-row" onClick={onNew}><Icon name="plus" /> Create a new character</button>
      {chars === null && ids.length > 0 && <p className="muted small">Loading your characters…</p>}
      {sorted.map((c) => (
        <button key={c.id} onClick={() => onPick(c.id)}>
          <Avatar c={c} size={30} />
          <span className="grow left">{c.name}</span>
          {c.universe && <span className="muted small">{c.universe}</span>}
        </button>
      ))}
    </div>
  );
}

function SceneSettings({ scene, onSaved }) {
  const universes = useStore((s) => s.recentUniverses);
  const [title, setTitle] = useState(scene.title);
  const [universe, setUniverse] = useState(scene.universe || '');
  const [description, setDescription] = useState(scene.description || '');
  const [theme, setTheme] = useState(scene.theme);
  const [font, setFont] = useState(scene.font);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim()) return toast('The scene needs a title', 'error');
    setBusy(true);
    try {
      const api = await getApi();
      const s = await api.updateScene(scene.id, {
        title: title.trim().slice(0, 120), universe: universe.trim().slice(0, 60) || null,
        description: description.trim().slice(0, 8000) || null, theme, font,
      });
      rememberUniverse(universe);
      onSaved(s);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form">
      <label className="field"><span>Title</span><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>Universe</span><UniverseInput value={universe} onChange={setUniverse} suggestions={universes} /></label>
      <label className="field"><span>Scene description</span>
        <textarea rows={5} value={description} maxLength={8000} onChange={(e) => setDescription(e.target.value)}
          placeholder="Set the scene: where are we, who’s here, what has happened so far?" />
      </label>
      <LookPicker theme={theme} font={font} onTheme={setTheme} onFont={setFont} />
      <p className="muted small">Changes apply for everyone in the scene.</p>
      <button className="btn primary block" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

function PlayerNameForm({ initial, onSave }) {
  const [v, setV] = useState(initial || '');
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim().slice(0, 40)); }}>
      <p className="muted">OOC chat is you, not your character. What should people call you?</p>
      <label className="field"><span>Your name</span><input value={v} maxLength={40} onChange={(e) => setV(e.target.value)} autoFocus /></label>
      <button className="btn primary block" disabled={!v.trim()}>Save</button>
    </form>
  );
}

function OocPanel({ posts, children, ...feed }) {
  const ref = useRef(null);
  const atBottom = useRef(true);
  const count = posts.length;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const last = posts[posts.length - 1];
    if (atBottom.current || last?.author_device_id === getState().deviceId) el.scrollTop = el.scrollHeight;
  }, [count]);
  return (
    <div className="ooc-panel">
      <h3 className="desk-h ooc-panel-h">OOC chat</h3>
      <div className="ooc-scroll" ref={ref}
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <Feed posts={posts} channel="ooc" {...feed} emptyText="Out-of-character chat lives here. Plans, questions, “brb”." />
      </div>
      <div className="ooc-foot">{children}</div>
    </div>
  );
}

function DeleteSceneForm({ scene, onExport, onDelete }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toLowerCase() === 'delete';
  return (
    <form className="form" onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); await onDelete(); setBusy(false); }}>
      <p>This removes “{scene.title}” for everyone: every story post, all OOC chat, and the invite link. It can’t be undone.</p>
      <p className="muted small">Characters stay saved on each player’s device and can join other scenes.</p>
      <button type="button" className="btn block" onClick={onExport}><Icon name="download" size={18} /> Export the story first</button>
      <label className="field" style={{ marginTop: 16 }}>
        <span>Type DELETE to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder="DELETE" />
      </label>
      <button className="btn danger block" disabled={!ok || busy}>{busy ? 'Deleting…' : 'Delete scene for everyone'}</button>
    </form>
  );
}

function NotifyMenuItem({ onNeedsSettings }) {
  const [status, setStatus] = usePushStatus();
  if (!status || status === 'unsupported') return null;
  if (status === 'on') {
    return <button onClick={async () => setStatus(await disablePush())}><Icon name="check" /> Tag notifications on (tap to turn off)</button>;
  }
  if (status === 'needs-install' || status === 'denied') {
    return <button onClick={onNeedsSettings}><Icon name="chat" /> Get notified when I’m tagged…</button>;
  }
  return (
    <button onClick={async () => {
      try {
        const s = await enablePush();
        setStatus(s);
        if (s === 'on') toast('You’ll get a notification when someone tags your characters.');
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    }}><Icon name="chat" /> Notify me when I’m tagged</button>
  );
}

function ChapterForm({ existing, before, ctx, defaultTitle, onSave, onRemove }) {
  const [title, setTitle] = useState(existing ? existing.body : defaultTitle);
  const [busy, setBusy] = useState(false);
  return (
    <form className="form" onSubmit={async (e) => { e.preventDefault(); const t = title.trim(); if (!t) return; setBusy(true); await onSave(t.slice(0, 120)); setBusy(false); }}>
      {before ? (
        <p className="muted">The new chapter will start with this post, and everything after it moves into the chapter:<br />
          <em>“{firstLine(before.body, ctx.charsById, 70)}”</em></p>
      ) : !existing && <p className="muted">Earlier chapters fold away so everyone can focus on what’s happening now. Anyone can open them again.</p>}
      <label className="field"><span>Chapter title</span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Chapter 2: The Library" />
      </label>
      <button className="btn primary block" disabled={busy || !title.trim()}>{existing ? 'Save' : 'Start chapter'}</button>
      {onRemove && <button type="button" className="link-btn danger-text center-block" onClick={onRemove}>Remove this chapter break</button>}
    </form>
  );
}
