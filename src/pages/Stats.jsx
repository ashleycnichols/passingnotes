// Private usage stats for the app owner. Protected by the passcode set in the usage_stats migration.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getApi } from '../api.js';
import { go } from '../router.js';
import { Icon, errMsg } from '../ui.jsx';
import { timeAgo } from '../util.js';

const CODE_KEY = 'passingnotes:stats-code';
const readCode = () => { try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; } };
const saveCode = (c) => { try { c ? localStorage.setItem(CODE_KEY, c) : localStorage.removeItem(CODE_KEY); } catch { /* ignore */ } };
const fmt = (n) => Number(n || 0).toLocaleString();

export default function Stats() {
  const [code, setCode] = useState(readCode);
  const [draft, setDraft] = useState('');
  const [data, setData] = useState(null);
  const [state, setState] = useState(code ? 'loading' : 'locked'); // locked | loading | ready | wrong | error
  const [err, setErr] = useState('');

  const load = useCallback(async (c) => {
    setState('loading');
    try {
      const api = await getApi();
      const d = await api.usageStats(c);
      if (!d) {
        saveCode('');
        setCode('');
        setState('wrong');
        return;
      }
      saveCode(c);
      setCode(c);
      setData(d);
      setState('ready');
    } catch (e) {
      setErr(/usage_stats|function/i.test(e.message) ? 'The stats need a quick database update first (the usage stats SQL file).' : errMsg(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (code) load(code);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <header className="topbar">
        <button className="icon-btn" onClick={() => go('/settings')} aria-label="Back"><Icon name="back" /></button>
        <h1 className="topbar-title">Usage</h1>
        {state === 'ready' ? (
          <button className="icon-btn" onClick={() => load(code)} aria-label="Refresh"><Icon name="refresh" /></button>
        ) : <span className="icon-btn-spacer" />}
      </header>
      <main className="content stats">
        {(state === 'locked' || state === 'wrong') && (
          <form className="form stats-lock" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) load(draft.trim()); }}>
            <h2>Owner stats</h2>
            <p className="muted">Enter the passcode you set in the usage stats SQL file. This device will remember it.</p>
            <label className="field"><span>Passcode</span>
              <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} name="pn-stats-passcode" data-1p-ignore data-lpignore="true" />
            </label>
            {state === 'wrong' && <p className="error-box">That passcode didn’t work.</p>}
            <button className="btn primary block" disabled={!draft.trim()}>Show stats</button>
          </form>
        )}
        {state === 'loading' && <p className="muted center"><span className="spinner" /> Counting…</p>}
        {state === 'error' && <p className="error-box">{err}</p>}
        {state === 'ready' && data && <Report d={data} onLock={() => { saveCode(''); setCode(''); setData(null); setDraft(''); setState('locked'); }} />}
      </main>
    </div>
  );
}

function Change({ now, prev }) {
  const diff = (now || 0) - (prev || 0);
  if (!prev && !now) return <span className="stat-change">No change</span>;
  if (diff === 0) return <span className="stat-change">Same as the week before</span>;
  return <span className={`stat-change ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '▲' : '▼'} {fmt(Math.abs(diff))} vs the week before</span>;
}

function Report({ d, onLock }) {
  const t = d.totals || {};
  const l = d.last7 || {};
  const p = d.prev7 || {};
  return (
    <>
      <p className="muted small stats-updated">Updated {new Date(d.generated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>

      <section className="stats-section">
        <h2 className="section-label">All time</h2>
        <div className="stat-grid">
          <Tile label="Scenes" value={t.scenes} hero />
          <Tile label="Characters" value={t.characters} hero />
          <Tile label="Players" value={t.players} note="devices that joined a scene" hero />
          <Tile label="Story posts" value={t.story_posts} hero />
        </div>
        <div className="stat-grid small">
          <Tile label="OOC messages" value={t.ooc_posts} />
          <Tile label="Chapters" value={t.chapters} />
          <Tile label="Universes" value={t.universes} />
          <Tile label="Read-only links" value={t.reader_links} />
        </div>
      </section>

      <section className="stats-section">
        <h2 className="section-label">Last 7 days</h2>
        <div className="stat-grid five">
          <Tile label="New scenes" value={l.new_scenes} change={<Change now={l.new_scenes} prev={p.new_scenes} />} />
          <Tile label="New characters" value={l.new_characters} change={<Change now={l.new_characters} prev={p.new_characters} />} />
          <Tile label="Story posts" value={l.story_posts} change={<Change now={l.story_posts} prev={p.story_posts} />} />
          <Tile label="Active scenes" value={l.active_scenes} change={<Change now={l.active_scenes} prev={p.active_scenes} />} />
          <Tile label="Active writers" value={l.active_writers} change={<Change now={l.active_writers} prev={p.active_writers} />} />
        </div>
      </section>

      <section className="stats-section">
        <h2 className="section-label">Story posts per day, last 30 days</h2>
        <DailyChart days={d.daily || []} />
      </section>

      <div className="stats-two">
        <section className="stats-section">
          <h2 className="section-label">Most active scenes, last 30 days</h2>
          {(d.top_scenes || []).length ? (
            <table className="stats-table">
              <thead><tr><th>Scene</th><th className="num">Posts</th><th className="num">Players</th><th>Last post</th></tr></thead>
              <tbody>
                {d.top_scenes.map((s, i) => (
                  <tr key={i}>
                    <td><strong>{s.title}</strong>{s.universe && <span className="muted small"> · {s.universe}</span>}</td>
                    <td className="num">{fmt(s.posts_30d)}</td>
                    <td className="num">{fmt(s.players)}</td>
                    <td className="muted">{timeAgo(s.last_post_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No story posts in the last 30 days.</p>}
        </section>
        <section className="stats-section">
          <h2 className="section-label">Universes</h2>
          {(d.universes || []).length ? (
            <table className="stats-table">
              <thead><tr><th>Universe</th><th className="num">Scenes</th><th className="num">Posts</th></tr></thead>
              <tbody>
                {d.universes.map((u) => (
                  <tr key={u.name}><td>{u.name}</td><td className="num">{fmt(u.scenes)}</td><td className="num">{fmt(u.posts)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No universes yet.</p>}
        </section>
      </div>

      <p className="muted small stats-note">No accounts means these count devices, not people: someone playing on a phone and a laptop counts twice. Posts exclude chapter breaks and tag pings.</p>
      <button className="link-btn center-block" onClick={onLock}>Forget passcode on this device</button>
    </>
  );
}

function Tile({ label, value, note, change, hero }) {
  return (
    <div className={`stat-tile${hero ? ' hero' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{fmt(value)}</span>
      {note && <span className="stat-note">{note}</span>}
      {change}
    </div>
  );
}

function DailyChart({ days }) {
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const [W, setW] = useState(680);
  // Draw at the real on-screen width so axis text stays a readable size on phones.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const fit = () => setW(Math.max(280, Math.round(el.clientWidth)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 200;
  const padL = 32;
  const padB = 24;
  const padT = 10;
  const max = Math.max(1, ...days.map((x) => x.posts));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const n = days.length || 1;
  const slot = (W - padL) / n;
  const bw = Math.max(4, slot - 2);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const label = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const total = days.reduce((a, x) => a + x.posts, 0);
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="chart-wrap">
      <div ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Story posts per day for the last 30 days, ${fmt(total)} in total`}
        onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={padL} x2={W} y1={y(step * i)} y2={y(step * i)} className="chart-grid" />
            <text x={padL - 6} y={y(step * i) + 4} textAnchor="end" className="chart-axis">{step * i}</text>
          </g>
        ))}
        {days.map((dd, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const yy = y(dd.posts);
          const hgt = Math.max(0, H - padB - yy);
          const r = Math.min(4, bw / 2, hgt);
          return (
            <g key={dd.day} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={padL + i * slot} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              {hgt > 0 && (
                <path className={`chart-bar${hover === i ? ' on' : ''}`}
                  d={`M${x},${H - padB} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${H - padB} Z`} />
              )}
            </g>
          );
        })}
        {days.map((dd, i) => (n - 1 - i) % 7 === 0 && (
          <text key={`l${dd.day}`} x={i === n - 1 ? W - 2 : padL + i * slot + slot / 2} y={H - 6} textAnchor={i === n - 1 ? 'end' : 'middle'} className="chart-axis">{i === n - 1 ? 'Today' : label(dd.day)}</text>
        ))}
      </svg>
      </div>
      <div className="chart-readout" aria-live="polite">
        {h ? <><strong>{label(h.day)}</strong>: {fmt(h.posts)} {h.posts === 1 ? 'post' : 'posts'}{h.scenes ? `, ${h.scenes} new ${h.scenes === 1 ? 'scene' : 'scenes'}` : ''}</>
          : <>{fmt(total)} story posts in 30 days. Hover or tap a bar for the day.</>}
      </div>
      <details className="chart-table">
        <summary>Show as a table</summary>
        <table className="stats-table">
          <thead><tr><th>Day</th><th className="num">Story posts</th><th className="num">New scenes</th></tr></thead>
          <tbody>{[...days].reverse().map((dd) => <tr key={dd.day}><td>{label(dd.day)}</td><td className="num">{dd.posts}</td><td className="num">{dd.scenes}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
