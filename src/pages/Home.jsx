import { useEffect, useMemo, useRef, useState } from 'react';
import { getApi } from '../api.js';
import { useStore, update, setSceneHidden, getState, forgetMyCharacter } from '../store.js';
import { go } from '../router.js';
import { Avatar, Icon, Segmented, Sheet, toast, errMsg, useMedia } from '../ui.jsx';
import { timeAgo, universeKey, sceneUrl, copyText, slugFromInput, isIOS, isStandalone, inAppBrowser } from '../util.js';
import { firstLine } from '../text.jsx';
import { readableColor, chromeSurface, themeOf, themeStyle } from '../look.js';
import { CharacterForm, ShareCharacterSheet } from '../components/Characters.jsx';

const DOTS = ['#05878A', '#DD9933', '#5A175D', '#074E67', '#67074E', '#2b8a3e'];
function universeDot(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DOTS[h % DOTS.length];
}

export default function Home() {
  const myScenes = useStore((s) => s.myScenes);
  const myChars = useStore((s) => s.myCharacters);
  const filter = useStore((s) => s.homeFilter);
  const grouped = useStore((s) => s.homeGrouped);
  const dismissedTip = useStore((s) => s.dismissedInstallTip);
  const desktop = useMedia('(min-width: 1000px)');
  const [tab, setTab] = useState('scenes');
  const [scenes, setScenes] = useState(null);
  const [roster, setRoster] = useState([]);
  const [latest, setLatest] = useState({});
  const [chapter, setChapter] = useState({});
  const [mentions, setMentions] = useState([]);
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
        const [r, l, ch] = await Promise.all([
          api.getRoster(ids),
          Promise.all(ids.map((id) => api.getLatestPost(id).then((p) => [id, p]))),
          Promise.all(ids.map((id) => api.getLatestChapter(id).then((p) => [id, p]).catch(() => [id, null]))),
        ]);
        if (!live) return;
        setRoster(r);
        setLatest(Object.fromEntries(l));
        setChapter(Object.fromEntries(ch));
        api.getMentions(ids, getState().myCharacters.map((c) => c.id)).then((m) => live && setMentions(m)).catch(() => {});
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
      if (!k) return;
      if (!m.has(k)) m.set(k, { name: s.universe.trim(), count: 0 });
      m.get(k).count++;
    });
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [visible]);
  const noneCount = visible.filter((s) => !universeKey(s.universe)).length;

  const filtered = visible.filter((s) => {
    if (filter === 'all') return true;
    if (filter === '__none') return !universeKey(s.universe);
    return universeKey(s.universe) === filter;
  });

  const hiddenCount = (scenes || []).filter((s) => meta[s.slug]?.hidden).length;
  const setFilter = (f) => update((s) => (s.homeFilter = f));
  const app = inAppBrowser();
  const showTip = (isIOS() || !!app) && !isStandalone() && !dismissedTip && myScenes.length > 0;

  const info = (s) => {
    const lp = latest[s.id];
    const seen = meta[s.slug]?.lastOpenedAt;
    const me = getState().deviceId;
    return {
      lp,
      lc: lp?.character_id ? charsById[lp.character_id] : null,
      rs: rosterBy[s.id] || [],
      unread: !!lp && (!seen || lp.created_at > seen) && lp.author_device_id !== me,
      tagged: mentions.some((m) => m.scene_id === s.id && m.author_device_id !== me && (!seen || m.created_at > seen)),
      chapter: chapter[s.id],
    };
  };

  const preview = (s, d, max = 110) => {
    const bg = themeOf(s.theme).bg;
    if (!d.lp) return <span className="muted-on-theme">No posts yet. Write the opening line.</span>;
    if (d.lp.kind === 'chapter') return <><span className="who muted-on-theme">New chapter: </span>{d.lp.body}</>;
    return (
      <>
        {d.lp.kind === 'narrator' ? <span className="who muted-on-theme">Narrator: </span>
          : d.lc ? <span className="who" style={{ color: readableColor(d.lc.color, bg) }}>{d.lc.name}: </span> : null}
        {firstLine(d.lp.body, charsById, max)}
      </>
    );
  };

  const optionsBtn = (s) => (
    <button className="icon-btn small card-more" aria-label={`Options for ${s.title}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuFor(s); }}>
      <Icon name="more" />
    </button>
  );

  const card = (s) => {
    const d = info(s);
    return (
      <li key={s.id}>
        <a className="scene-card themed" href={`#/s/${s.slug}`} style={themeStyle(s.theme, s.font)}>
          <div className="scene-card-top">
            <span className="card-kicker">{s.universe || 'No universe'}{d.chapter ? ` · ${d.chapter.body}` : ''}</span>
            {optionsBtn(s)}
          </div>
          <h3 className="card-title">{d.unread && <span className="dot" aria-label="New posts" />}{s.title}</h3>
          <p className="preview">{preview(s, d)}</p>
          <div className="scene-card-foot">
            <span className="avatars">
              {d.rs.slice(0, 5).map((c) => <Avatar key={c.id} c={c} size={24} />)}
              {d.rs.length > 5 && <span className="more-count">+{d.rs.length - 5}</span>}
            </span>
            {d.tagged ? <span className="tagged-badge">@ You were tagged</span> : <span className="card-time">{timeAgo(s.last_post_at || s.created_at)}</span>}
          </div>
        </a>
      </li>
    );
  };

  const hero = (s) => {
    const d = info(s);
    return (
      <a className="continue-card" href={`#/s/${s.slug}`} style={themeStyle(s.theme, s.font)}>
        <div className="continue-main">
          <span className="card-kicker">{s.universe || 'Pick up where you left off'}{d.chapter ? ` · ${d.chapter.body}` : ''}</span>
          <h2 className="continue-title">{s.title}</h2>
          <p className="continue-line">{preview(s, d, 160)}</p>
          {(d.tagged || d.unread) && (
            <span className="continue-flags">
              {d.tagged && <span className="tagged-badge">@ You were tagged</span>}
              {d.unread && !d.tagged && <span className="new-badge">New posts</span>}
            </span>
          )}
        </div>
        <div className="continue-side">
          <span className="avatars">{d.rs.slice(0, 6).map((c) => <Avatar key={c.id} c={c} size={30} />)}</span>
          <span className="continue-btn">Continue <Icon name="send" size={16} /></span>
          <span className="card-time">{timeAgo(s.last_post_at || s.created_at)}</span>
        </div>
        {optionsBtn(s)}
      </a>
    );
  };

  const groups = (list) => {
    const m = new Map();
    list.forEach((s) => {
      const k = universeKey(s.universe) || '__none';
      if (!m.has(k)) m.set(k, { name: s.universe?.trim() || 'No universe', list: [] });
      m.get(k).list.push(s);
    });
    return [...m.values()].sort((a, b) => (a.name === 'No universe') - (b.name === 'No universe') || a.name.localeCompare(b.name));
  };

  const heroScene = !showHidden && filter === 'all' && visible.length > 0 ? visible[0] : null;
  const gridList = heroScene && visible.length > 1 ? filtered.filter((s) => s.id !== heroScene.id) : heroScene ? [] : filtered;

  const scenesView = (
    <>
      {!desktop && (visible.length > 0 || showHidden || hiddenCount > 0) && (
        <div className="home-actions">
          <button className="btn primary grow" onClick={() => go('/new')}><Icon name="plus" size={18} /> Start a scene</button>
          <button className="btn" onClick={() => setJoinOpen(true)}><Icon name="link" size={18} /> Join</button>
        </div>
      )}
      {err && <p className="error-box">{err}</p>}
      {scenes === null ? (
        <ul className="scene-grid">{[0, 1, 2].map((i) => <li key={i}><div className="scene-card skeleton" /></li>)}</ul>
      ) : visible.length === 0 && !showHidden ? (
        <div className="empty welcome">
          <img src="icons/icon-192.png" alt="" width="88" height="88" className="welcome-logo" />
          <h2>Write a story together</h2>
          <p className="muted">Start a scene, send the link to your friends, and take turns writing as your characters. No sign-up.</p>
          <div className="home-actions center-actions">
            <button className="btn primary" onClick={() => go('/new')}><Icon name="plus" size={18} /> Start a scene</button>
            <button className="btn" onClick={() => setJoinOpen(true)}><Icon name="link" size={18} /> Join with a link</button>
          </div>
        </div>
      ) : (
        <>
          {heroScene && (
            <section className="home-section">
              <h2 className="section-label">Pick up where you left off</h2>
              {hero(heroScene)}
            </section>
          )}
          {!desktop && (universes.length > 0) && !showHidden && (
            <div className="filter-row">
              <div className="chips scroll">
                <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All</button>
                {universes.map(([k, u]) => (
                  <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{u.name}</button>
                ))}
                {noneCount > 0 && <button className={`chip${filter === '__none' ? ' on' : ''}`} onClick={() => setFilter('__none')}>No universe</button>}
              </div>
              <button className={`chip icon${grouped ? ' on' : ''}`} aria-pressed={grouped} onClick={() => update((s) => (s.homeGrouped = !s.homeGrouped))}>Group</button>
            </div>
          )}
          {showHidden ? (
            <div className="section-head">
              <h2>Hidden scenes</h2>
              <button className="btn ghost small" onClick={() => setShowHidden(false)}>Done</button>
            </div>
          ) : gridList.length > 0 && (
            <div className="section-head">
              <h2 className="section-label">{filter === 'all' ? (heroScene ? 'All scenes' : 'Scenes') : filter === '__none' ? 'No universe' : universes.find(([k]) => k === filter)?.[1].name || 'Scenes'}</h2>
              {desktop && universes.length > 0 && (
                <button className={`chip icon${grouped ? ' on' : ''}`} aria-pressed={grouped} onClick={() => update((s) => (s.homeGrouped = !s.homeGrouped))}>Group by universe</button>
              )}
            </div>
          )}
          {grouped && !showHidden ? (
            groups(gridList).map((g) => (
              <details key={g.name} className="universe-group" open>
                <summary>{g.name} <span className="muted small">{g.list.length}</span></summary>
                <ul className="scene-grid">{g.list.map(card)}</ul>
              </details>
            ))
          ) : (
            <ul className="scene-grid">{(showHidden ? filtered : gridList).map(card)}</ul>
          )}
          {filter !== 'all' && filtered.length === 0 && <p className="muted center">Nothing here.</p>}
        </>
      )}
      {!showHidden && hiddenCount > 0 && (
        <button className="link-btn center-block" onClick={() => setShowHidden(true)}>Hidden scenes ({hiddenCount})</button>
      )}
    </>
  );

  const tips = (
    <>
      {app && (
        <div className="tip warn">
          <p><strong>You’re in {app}’s browser.</strong> It forgets your characters when it closes. Open this page in Safari or Chrome to keep them. <button className="link-btn" onClick={() => go('/settings')}>How</button></p>
        </div>
      )}
      {showTip && !app && (
        <div className="tip">
          <p><strong>Add to Home Screen</strong> so it opens like an app and keeps your characters saved. <button className="link-btn" onClick={() => go('/settings')}>Show me how</button></p>
          <button className="icon-btn small" aria-label="Dismiss tip" onClick={() => update((s) => (s.dismissedInstallTip = true))}><Icon name="close" size={16} /></button>
        </div>
      )}
    </>
  );

  const sheets = (
    <>
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
    </>
  );

  const appName = window.PN_CONFIG?.appName || 'Passing Notes';

  if (desktop) {
    return (
      <div className="page home home-desktop">
        <aside className="home-side">
          <div className="brand"><img className="brand-logo" src="icons/icon-192.png" alt="" width="34" height="34" /><span>{appName}</span></div>
          <button className="btn primary block" onClick={() => go('/new')}><Icon name="plus" size={18} /> Start a scene</button>
          <button className="btn block" onClick={() => setJoinOpen(true)}><Icon name="link" size={18} /> Join with a link</button>
          <nav className="side-nav" aria-label="Home sections">
            <button className={tab === 'scenes' ? 'on' : ''} onClick={() => setTab('scenes')}><Icon name="book" size={18} /> Scenes</button>
            <button className={tab === 'characters' ? 'on' : ''} onClick={() => setTab('characters')}><Icon name="users" size={18} /> My characters</button>
            <button onClick={() => go('/settings')}><Icon name="settings" size={18} /> Settings</button>
          </nav>
          {tab === 'scenes' && (universes.length > 0 || noneCount > 0) && (
            <div className="side-universes">
              <h3 className="side-label">Universes</h3>
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
                <span className="u-dot" style={{ background: 'var(--muted)' }} /> All scenes <span className="u-count">{visible.length}</span>
              </button>
              {universes.map(([k, u]) => (
                <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  <span className="u-dot" style={{ background: universeDot(k) }} /> <span className="u-name">{u.name}</span> <span className="u-count">{u.count}</span>
                </button>
              ))}
              {noneCount > 0 && universes.length > 0 && (
                <button className={filter === '__none' ? 'on' : ''} onClick={() => setFilter('__none')}>
                  <span className="u-dot" style={{ background: 'var(--border)' }} /> No universe <span className="u-count">{noneCount}</span>
                </button>
              )}
            </div>
          )}
        </aside>
        <main className="home-main">
          {tips}
          {tab === 'scenes' ? scenesView : <MyCharacters ids={myChars.map((c) => c.id)} />}
        </main>
        {sheets}
      </div>
    );
  }

  return (
    <div className="page home">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="icons/icon-192.png" alt="" width="32" height="32" />
          <span>{appName}</span>
        </div>
        <button className="icon-btn" onClick={() => go('/settings')} aria-label="Settings"><Icon name="settings" /></button>
      </header>
      <main className="content">
        <Segmented value={tab} onChange={setTab} label="Home sections"
          options={[{ value: 'scenes', label: 'Scenes' }, { value: 'characters', label: 'My characters' }]} />
        {tips}
        {tab === 'scenes' ? scenesView : <MyCharacters ids={myChars.map((c) => c.id)} />}
      </main>
      {sheets}
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
        list.filter((c) => c.deleted_at).forEach((c) => forgetMyCharacter(c.id));
        setChars(list.filter((c) => !c.deleted_at));
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

  if (chars === null) return <div className="char-grid">{[0, 1, 2].map((i) => <div key={i} className="char-card skeleton" />)}</div>;
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
  const bg = chromeSurface();
  return (
    <>
      {sorted.map((g) => (
        <section key={g.name} className="char-group">
          <h2 className="section-label">{g.name}</h2>
          <ul className="char-grid">
            {g.list.sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
              <li key={c.id} className="char-card" style={{ '--char': c.color }}>
                <Avatar c={c} size={84} ring />
                <strong className="char-card-name" style={{ color: readableColor(c.color, bg) }}>{c.name}</strong>
                <span className="muted small char-card-scenes">
                  {(sceneMap[c.id] || []).length ? (sceneMap[c.id] || []).map((s) => s.title).join(', ') : 'Not in any scene yet'}
                </span>
                <div className="char-card-actions">
                  <button className="btn small" onClick={() => setEditing(c)}><Icon name="edit" size={16} /> Edit</button>
                  <button className="icon-btn small" aria-label={`Use ${c.name} on another device`} onClick={() => setSharing(c)}><Icon name="share" size={18} /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <CharacterForm open={!!editing} character={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick((t) => t + 1); }}
        onDeleted={() => { setEditing(null); setTick((t) => t + 1); }} />
      <ShareCharacterSheet character={sharing} onClose={() => setSharing(null)} />
    </>
  );
}
