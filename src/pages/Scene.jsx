import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getApi } from '../api.js';
import { getState, update, useStore, rememberScene, rememberUniverse, addMyCharacter } from '../store.js';
import { go } from '../router.js';
import { Avatar, Confirm, Icon, Segmented, Sheet, toast, errMsg, UniverseInput } from '../ui.jsx';
import { encodeTags } from '../text.jsx';
import { themeOf, themeStyle, readableColor, TEXT_SIZES } from '../look.js';
import { universeKey, inAppBrowser } from '../util.js';
import Feed from '../components/Feed.jsx';
import Composer from '../components/Composer.jsx';
import { CharacterForm, ShareCharacterSheet } from '../components/Characters.jsx';
import { ExportSheet } from '../components/Export.jsx';
import { LookPicker } from '../components/Look.jsx';
import { InviteSheet } from './NewScene.jsx';

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

export default function Scene({ slug }) {
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
  const [descOpen, setDescOpen] = useState(!seenDesc);
  const [online, setOnline] = useState(navigator.onLine);

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
  const joined = participants.some((p) => p.device_id === deviceId);
  const full = !joined && participants.length >= MAX_PLAYERS;
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
        const s = await api.getSceneBySlug(slug);
        if (!alive) return;
        if (!s) {
          setScene(null);
          return;
        }
        setScene(s);
        const parts = await api.getParticipants(s.id);
        if (!alive) return;
        setParticipants(parts);
        if (parts.some((p) => p.device_id === getState().deviceId)) rememberScene(slug);
        await Promise.all([loadRoster(s.id), loadLatest(s.id, true)]);
        sub.current = api.subscribeScene(s.id, {
          onPost: (row) => {
            const ch = row.channel;
            setPosts((prev) => ({ ...prev, [ch]: merge(prev[ch], [row]) }));
            const mine = row.author_device_id === getState().deviceId;
            if (ch !== viewRef.current) {
              if (!mine) setUnread((u) => ({ ...u, [ch]: true }));
            } else if (nearBottom() || mine) {
              requestAnimationFrame(() => scrollToBottom(true));
            } else {
              setNewPill(true);
            }
          },
          onPostDeleted: (id) => setPosts((prev) => ({ story: prev.story.filter((p) => p.id !== id), ooc: prev.ooc.filter((p) => p.id !== id) })),
          onRoster: () => loadRoster(s.id),
          onRosterDelete: () => loadRoster(s.id),
          onParticipants: () => loadParticipants(s.id),
          onScene: (row) => setScene((cur) => ({ ...cur, ...row })),
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

  const send = async (text) => {
    const api = await getApi();
    const { body, tagged } = encodeTags(text, roster);
    const ooc = view === 'ooc';
    const row = {
      scene_id: scene.id,
      channel: view,
      kind: ooc ? 'player' : identity === 'narrator' ? 'narrator' : 'character',
      character_id: ooc || identity === 'narrator' ? null : identity,
      author_device_id: deviceId,
      body,
      tagged_character_ids: tagged,
    };
    try {
      const saved = await api.createPost(row);
      setPosts((prev) => ({ ...prev, [view]: merge(prev[view], [saved]) }));
      requestAnimationFrame(() => scrollToBottom(true));
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

  const editPost = async (p, body, tagged) => {
    const api = await getApi();
    const saved = await api.updatePost(p.id, { body, tagged_character_ids: tagged });
    setPosts((prev) => ({ ...prev, [p.channel]: merge(prev[p.channel], [saved]) }));
  };

  const deletePost = async (p) => {
    try {
      const api = await getApi();
      await api.deletePost(p.id);
      setPosts((prev) => ({ ...prev, [p.channel]: prev[p.channel].filter((x) => x.id !== p.id) }));
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
  const list = posts[view];
  const identityChar = identity && identity !== 'narrator' ? charsById[identity] : null;
  const savedNotHere = myChars.map((c) => c.id).filter((id) => !roster.some((r) => r.id === id));

  return (
    <div className={`page scene-page${theme.dark ? ' dark' : ''}`} style={themeStyle(scene.theme, scene.font, textSize)}>
      <header className="scene-header">
        <div className="scene-header-row">
          <button className="icon-btn" onClick={() => go('/')} aria-label="Back to my scenes"><Icon name="back" /></button>
          <div className="scene-titles">
            <h1>{scene.title}</h1>
            {scene.universe && <span className="universe-label">{scene.universe}</span>}
          </div>
          <button className="icon-btn" onClick={() => setSheet('invite')} aria-label="Invite players"><Icon name="share" /></button>
          <button className="icon-btn" onClick={() => setSheet('menu')} aria-label="Scene menu"><Icon name="more" /></button>
        </div>
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
        <div className="view-toggle">
          <Segmented value={view} onChange={setView} label="Story or out-of-character chat"
            options={[{ value: 'story', label: 'Story', dot: unread.story }, { value: 'ooc', label: 'OOC chat', dot: unread.ooc }]} />
        </div>
      </header>

      {!online && <div className="offline-bar">You’re offline. New posts will appear when you reconnect.</div>}

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
          onPickIdentity={() => setSheet('identity')} onSend={send}
          placeholder={`Chat as ${playerName || 'yourself'}…`} />
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
      )}

      {/* ---- sheets ---- */}
      {sheet === 'invite' && <InviteSheet scene={scene} onClose={() => setSheet(null)} />}

      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title="Scene">
        <div className="menu-list">
          <button onClick={() => setSheet('roster')}><Icon name="users" /> Who’s in the scene</button>
          {joined && <button onClick={() => setSheet('addChar')}><Icon name="plus" /> Add a character</button>}
          <button onClick={() => setSheet('settings')}><Icon name="settings" /> Scene settings and look</button>
          <button onClick={() => setSheet('export')}><Icon name="download" /> Export scene</button>
          <button onClick={() => setSheet('text')}><Icon name="book" /> Text size</button>
          {joined && view === 'ooc' && <button onClick={() => setSheet('name')}><Icon name="edit" /> Change my OOC name</button>}
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
                  {!mine && (
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
        <p className="muted small">{participants.length} of {MAX_PLAYERS} players have joined. Lost access to your character on a new phone? Tap “This is mine” next to it.</p>
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

      <ExportSheet open={sheet === 'export'} onClose={() => setSheet(null)} scene={scene} charsById={charsById} playersByDevice={playersByDevice} />

      <CharacterForm open={!!charForm} character={charForm?.character || null} scene={charForm?.character ? null : scene}
        onClose={() => setCharForm(null)} onSaved={(c) => characterSaved(c, !charForm?.character)} />
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
    getApi().then((api) => api.getCharacters(ids)).then((l) => alive && setChars(l)).catch(() => alive && setChars([]));
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
