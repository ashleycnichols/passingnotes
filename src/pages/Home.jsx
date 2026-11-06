import { useEffect, useMemo, useRef, useState } from 'react';
import { getApi } from '../api.js';
import { useStore, update, setSceneHidden, getState } from '../store.js';
import { go } from '../router.js';
import { Avatar, Icon, Segmented, Sheet, toast, errMsg } from '../ui.jsx';
import { timeAgo, universeKey, sceneUrl, copyText, slugFromInput, isIOS, isStandalone } from '../util.js';
import { firstLine } from '../text.jsx';
import { readableColor, chromeSurface } from '../look.js';
import { CharacterForm, ShareCharacterSheet } from '../components/Characters.jsx';

export default function Home() {
  const myScenes = useStore((s) => s.myScenes);
  const myChars = useStore((s) => s.myCharacters);
  const filter = useStore((s) => s.homeFilter);
  const grouped = useStore((s) => s.homeGrouped);
  const dismissedTip = useStore((s) => s.dismissedInstallTip);
  const [tab, setTab] = useState('scenes');
  const [scenes, setScenes] = useState(null);
  const [roster, setRoster] = useState([]);
  const [latest, setLatest] = useState({});
  const [showHidden, setShowHidden] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [err, setErr] = useState(null);

  const slugs = myScenes.map((s) => s.slug).join(',');
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const api = await getApi();
        const list = await api.getScenesBySlugs(slugs ? slugs.split(',') : []);
        if (!live) return;
        setScenes(list);
        const ids = list.map((s) => s.id);
        const [r, l] = await Promise.all([
          api.getRoster(ids),
          Promise.all(ids.map((id) => api.getLatestPost(id).then((p) => [id, p]))),
        ]);
        if (!live) return;
        setRoster(r);
        setLatest(Object.fromEntries(l));
      } catch (e) {
        if (live) {
          setErr(errMsg(e));
          setScenes((s) => s || []);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [slugs]);

  const meta = useMemo(() => Object.fromEntries(myScenes.map((s) => [s.slug, s])), [myScenes]);
  const rosterBy = useMemo(() => {
    const m = {};
    roster.forEach((c) => (m[c.scene_id] = m[c.scene_id] || []).push(c));
    return m;
  }, [roster]);
  const charsById = useMemo(() => Object.fromEntries(roster.map((c) => [c.id, c])), [roster]);

  const visible = (scenes || [])
    .filter((s) => !!meta[s.slug]?.hidden === showHidden)
    .sort((a, b) => (b.last_post_at || b.created_at).localeCompare(a.last_post_at || a.created_at));

  const universes = useMemo(() => {
    const m = new Map();
    visible.forEach((s) => {
      const k = universeKey(s.universe);
      if (k && !m.has(k)) m.set(k, s.universe.trim());
    });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [visible]);
  const hasNone = visible.some((s) => !universeKey(s.universe));

  const filtered = visible.filter((s) => {
    if (filter === 'all') return true;
    if (filter === '__none') return !universeKey(s.universe);
    return universeKey(s.universe) === filter;
  });

  const hiddenCount = (scenes || []).filter((s) => meta[s.slug]?.hidden).length;
  const setFilter = (f) => update((s) => (s.homeFilter = f));

  const showTip = isIOS() && !isStandalone() && !dismissedTip && myScenes.length > 0;

  const card = (s) => {
    const rs = rosterBy[s.id] || [];
    const lp = latest[s.id];
    const lc = lp?.character_id ? charsById[lp.character_id] : null;
    const unread = lp && (!meta[s.slug]?.lastOpenedAt || lp.created_at > meta[s.slug].lastOpenedAt) && lp.author_device_id !== getState().deviceId;
    return (
      <li key={s.id}>
        <a className="scene-card" href={`#/s/${s.slug}`}>
          <div className="scene-card-top">
            <h3>
              {unread && <span className="dot" aria-label="New posts" />}
              {s.title}
            </h3>
            <button className="icon-btn small" aria-label={`Options for ${s.title}`}
              onClick={(e) => { e.preventDefault(); setMenuFor(s); }}>
              <Icon name="more" />
            </button>
          </div>
          {s.universe && <div className="universe-label">{s.universe}</div>}
          {lp ? (
            <p className="preview">
              {lp.kind === 'narrator' ? <span className="who muted">Narrator: </span> : lc ? <span className="who" style={{ color: readableColor(lc.color, chromeSurface()) }}>{lc.name}: </span> : null}
              {firstLine(lp.body, charsById)}
            </p>
          ) : (
            <p className="preview muted">No posts yet</p>
          )}
          <div className="scene-card-foot">
            <span className="avatars">
              {rs.slice(0, 5).map((c) => <Avatar key={c.id} c={c} size={26} />)}
              {rs.length > 5 && <span className="more-count">+{rs.length - 5}</span>}
            </span>
            <span className="muted small">{timeAgo(s.last_post_at || s.created_at)}</span>
          </div>
        </a>
      </li>
    );
  };

  const groups = () => {
    const m = new Map();
    filtered.forEach((s) => {
      const k = universeKey(s.universe) || '__none';
      if (!m.has(k)) m.set(k, { name: s.universe?.trim() || 'No universe', list: [] });
      m.get(k).list.push(s);
    });
    return [...m.values()].sort((a, b) => (a.name === 'No universe') - (b.name === 'No universe') || a.name.localeCompare(b.name));
  };

  return (
    <div className="page home">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="feather" size={18} /></span>
          <span>{window.PN_CONFIG?.appName || 'Passing Notes'}</span>
        </div>
        <button className="icon-btn" onClick={() => go('/settings')} aria-label="Settings">
          <Icon name="settings" />
        </button>
      </header>

      <main className="content">
        <Segmented value={tab} onChange={setTab} label="Home sections"
          options={[{ value: 'scenes', label: 'Scenes' }, { value: 'characters', label: 'My characters' }]} />

        {showTip && (
          <div className="tip">
            <p><strong>Add to Home Screen:</strong> tap Share, then “Add to Home Screen”. It keeps your characters saved on this iPhone.</p>
            <button className="icon-btn small" aria-label="Dismiss tip" onClick={() => update((s) => (s.dismissedInstallTip = true))}><Icon name="close" size={16} /></button>
          </div>
        )}

        {tab === 'scenes' ? (
          <>
            <div className="home-actions">
              <button className="btn primary grow" onClick={() => go('/new')}><Icon name="plus" size={18} /> Start a scene</button>
              <button className="btn" onClick={() => setJoinOpen(true)}><Icon name="link" size={18} /> Join</button>
            </div>

            {err && <p className="error-box">{err}</p>}

            {scenes === null ? (
              <ul className="scene-list">{[0, 1, 2].map((i) => <li key={i}><div className="scene-card skeleton" /></li>)}</ul>
            ) : visible.length === 0 && !showHidden ? (
              <div className="empty">
                <Icon name="book" size={36} stroke={1.5} />
                <h2>No scenes yet</h2>
                <p className="muted">Start a scene and send the link to your friends, or join with a link someone sent you.</p>
              </div>
            ) : (
              <>
                {(universes.length > 0 || hasNone) && !showHidden && (
                  <div className="filter-row">
                    <div className="chips scroll">
                      <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All</button>
                      {universes.map(([k, name]) => (
                        <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{name}</button>
                      ))}
                      {hasNone && universes.length > 0 && (
                        <button className={`chip${filter === '__none' ? ' on' : ''}`} onClick={() => setFilter('__none')}>No universe</button>
                      )}
                    </div>
                    {universes.length > 0 && (
                      <button className={`chip icon${grouped ? ' on' : ''}`} aria-pressed={grouped} title="Group by universe"
                        onClick={() => update((s) => (s.homeGrouped = !s.homeGrouped))}>Group</button>
                    )}
                  </div>
                )}
                {showHidden && (
                  <div className="section-head">
                    <h2>Hidden scenes</h2>
                    <button className="btn ghost small" onClick={() => setShowHidden(false)}>Done</button>
                  </div>
                )}
                {grouped && !showHidden ? (
                  groups().map((g) => (
                    <details key={g.name} className="universe-group" open>
                      <summary>{g.name} <span className="muted small">{g.list.length}</span></summary>
                      <ul className="scene-list">{g.list.map(card)}</ul>
                    </details>
                  ))
                ) : (
                  <ul className="scene-list">{filtered.map(card)}</ul>
                )}
                {filtered.length === 0 && <p className="muted center">Nothing here.</p>}
              </>
            )}
            {!showHidden && hiddenCount > 0 && (
              <button className="link-btn center-block" onClick={() => setShowHidden(true)}>Hidden scenes ({hiddenCount})</button>
            )}
          </>
        ) : (
          <MyCharacters ids={myChars.map((c) => c.id)} />
        )}
      </main>

      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.title || ''}>
        {menuFor && (
          <div className="menu-list">
            <button onClick={async () => { await copyText(sceneUrl(menuFor.slug)); toast('Invite link copied'); setMenuFor(null); }}>
              <Icon name="link" /> Copy invite link
            </button>
            <button onClick={() => { setSceneHidden(menuFor.slug, !meta[menuFor.slug]?.hidden); setMenuFor(null); }}>
              <Icon name="eyeOff" /> {meta[menuFor.slug]?.hidden ? 'Show in my list' : 'Hide from my list'}
            </button>
          </div>
        )}
      </Sheet>

      <JoinSheet open={joinOpen} onClose={() => setJoinOpen(false)} />
    </div>
  );
}

function JoinSheet({ open, onClose }) {
  const [v, setV] = useState('');
  const slug = slugFromInput(v);
  return (
    <Sheet open={open} onClose={onClose} title="Join with a link"
      footer={<button className="btn primary" disabled={!slug} onClick={() => { onClose(); go(`/s/${slug}`); }}>Open scene</button>}>
      <label className="field">
        <span>Paste the invite link</span>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="https://…#/s/…" autoFocus inputMode="url" />
      </label>
      {v && !slug && <p className="muted small">That doesn’t look like a scene link.</p>}
    </Sheet>
  );
}

function MyCharacters({ ids }) {
  const [chars, setChars] = useState(null);
  const [sceneMap, setSceneMap] = useState({});
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [tick, setTick] = useState(0);
  const key = ids.join(',');
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    (async () => {
      try {
        const api = await getApi();
        const list = await api.getCharacters(ids);
        const links = await api.getSceneIdsForCharacters(ids);
        const scenes = await api.getScenesByIds([...new Set(links.map((l) => l.scene_id))]);
        const byId = Object.fromEntries(scenes.map((s) => [s.id, s]));
        const m = {};
        links.forEach((l) => byId[l.scene_id] && (m[l.character_id] = m[l.character_id] || []).push(byId[l.scene_id]));
        if (!live.current) return;
        setChars(list);
        setSceneMap(m);
      } catch (e) {
        toast(errMsg(e), 'error');
        setChars([]);
      }
    })();
    return () => {
      live.current = false;
    };
  }, [key, tick]);

  if (chars === null) return <div className="char-grid">{[0, 1].map((i) => <div key={i} className="char-card skeleton" />)}</div>;
  if (!chars.length) {
    return (
      <div className="empty">
        <Icon name="users" size={36} stroke={1.5} />
        <h2>No characters on this device</h2>
        <p className="muted">Characters you create in a scene are saved here so you can bring them to the next one. To move characters from another device, open a share or backup link here.</p>
      </div>
    );
  }
  const groups = new Map();
  chars.forEach((c) => {
    const k = universeKey(c.universe) || '__none';
    if (!groups.has(k)) groups.set(k, { name: c.universe?.trim() || 'No universe', list: [] });
    groups.get(k).list.push(c);
  });
  const sorted = [...groups.values()].sort((a, b) => (a.name === 'No universe') - (b.name === 'No universe') || a.name.localeCompare(b.name));
  return (
    <>
      {sorted.map((g) => (
        <section key={g.name} className="char-group">
          <h2 className="group-title">{g.name}</h2>
          <ul className="char-list">
            {g.list.sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
              <li key={c.id} className="char-row">
                <Avatar c={c} size={44} />
                <div className="char-info">
                  <strong>{c.name}</strong>
                  <span className="muted small">
                    {(sceneMap[c.id] || []).length ? (sceneMap[c.id] || []).map((s) => s.title).join(', ') : 'Not in any scene'}
                  </span>
                </div>
                <div className="row-actions">
                  <button className="icon-btn small" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Icon name="edit" size={18} /></button>
                  <button className="icon-btn small" aria-label={`Use ${c.name} on another device`} onClick={() => setSharing(c)}><Icon name="share" size={18} /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <CharacterForm open={!!editing} character={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick((t) => t + 1); }} />
      <ShareCharacterSheet character={sharing} onClose={() => setSharing(null)} />
    </>
  );
}
