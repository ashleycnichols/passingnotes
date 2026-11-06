import { useState } from 'react';
import { getApi } from '../api.js';
import { getState, rememberScene, rememberUniverse, useStore } from '../store.js';
import { go } from '../router.js';
import { Icon, Segmented, Sheet, toast, errMsg, UniverseInput } from '../ui.jsx';
import { makeSlug, sceneUrl, shareOrCopy, copyText, baseUrl } from '../util.js';
import { LookPicker } from '../components/Look.jsx';

export default function NewScene() {
  const universes = useStore((s) => s.recentUniverses);
  const [mode, setMode] = useState('quick');
  const [title, setTitle] = useState('');
  const [universe, setUniverse] = useState('');
  const [description, setDescription] = useState('');
  const [theme, setTheme] = useState('paper');
  const [font, setFont] = useState('lora');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const create = async (e) => {
    e?.preventDefault();
    const t = title.trim();
    if (!t) return toast('Give the scene a title', 'error');
    setBusy(true);
    try {
      const api = await getApi();
      const deviceId = getState().deviceId;
      const full = mode === 'full';
      let scene = null;
      for (let i = 0; i < 4 && !scene; i++) {
        try {
          scene = await api.createScene({
            slug: makeSlug(),
            title: t.slice(0, 120),
            universe: full ? universe.trim().slice(0, 60) || null : null,
            description: full ? description.trim().slice(0, 8000) || null : null,
            theme: full ? theme : 'paper',
            font: full ? font : 'lora',
            created_by_device: deviceId,
          });
        } catch (err) {
          if (!/duplicate|unique/i.test(err.message) || i === 3) throw err;
        }
      }
      await api.joinScene(scene.id, deviceId, getState().playerName);
      rememberScene(scene.slug);
      if (full && universe.trim()) rememberUniverse(universe.trim());
      setCreated(scene);
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <button className="icon-btn" onClick={() => go('/')} aria-label="Back"><Icon name="back" /></button>
        <h1 className="topbar-title">New scene</h1>
        <span className="icon-btn-spacer" />
      </header>
      <main className="content narrow">
        <Segmented value={mode} onChange={setMode} label="Setup type"
          options={[{ value: 'quick', label: 'Quick start' }, { value: 'full', label: 'Full setup' }]} />
        <form onSubmit={create} className="form">
          <label className="field">
            <span>Scene title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. The Midnight Library" autoFocus />
          </label>
          {mode === 'full' && (
            <>
              <label className="field">
                <span>Universe <em className="muted">(optional)</em></span>
                <UniverseInput value={universe} onChange={setUniverse} suggestions={universes} />
              </label>
              <label className="field">
                <span>Scene description <em className="muted">(optional)</em></span>
                <textarea rows={6} value={description} maxLength={8000} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Set the scene: where are we, who’s here, what has happened so far?" />
              </label>
              <LookPicker theme={theme} font={font} onTheme={setTheme} onFont={setFont} />
            </>
          )}
          {mode === 'quick' && <p className="muted small">You can add a description, universe and look later from the scene menu.</p>}
          <button className="btn primary block" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create and invite'}</button>
        </form>
      </main>
      <InviteSheet scene={created} onClose={() => go(`/s/${created.slug}`, { replace: true })} goLabel="Go to scene" />
    </div>
  );
}

export function InviteSheet({ scene, onClose, goLabel = 'Done' }) {
  if (!scene) return null;
  const url = sceneUrl(scene.slug);
  const appName = window.PN_CONFIG?.appName || 'Passing Notes';
  return (
    <Sheet open onClose={onClose} title="Invite players">
      <p className="invite-title">{scene.title}</p>
      <div className="link-box">{url}</div>
      <div className="stack">
        <button className="btn primary" onClick={async () => {
          const r = await shareOrCopy({ title: scene.title, text: `Join my scene “${scene.title}” on ${appName}`, url });
          if (r === 'copied') toast('Invite link copied');
        }}><Icon name="share" size={18} /> Share invite</button>
        <button className="btn" onClick={async () => { await copyText(url); toast('Invite link copied'); }}><Icon name="copy" size={18} /> Copy link</button>
        <button className="btn ghost" onClick={onClose}>{goLabel}</button>
      </div>
      <p className="muted small">Anyone with the link can join, up to 10 players. Paste it into Discord, Messenger, WhatsApp or anywhere else.</p>
      <ReaderLink scene={scene} />
    </Sheet>
  );
}

function ReaderLink({ scene }) {
  const [busy, setBusy] = useState(false);
  const get = async () => {
    const api = await getApi();
    return `${baseUrl()}#/r/${await api.ensureViewSlug(scene.id)}`;
  };
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn(await get());
    } catch (e) {
      toast(/ensure_view_slug|function/i.test(e.message) ? 'Read-only links need a quick database update first (the readers SQL file).' : errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="reader-invite">
      <h3 className="sheet-sub">Readers</h3>
      <p className="muted small">A separate link for people who want to read along. They can’t join, post or see OOC chat.</p>
      <div className="stack">
        <button className="btn" disabled={busy} onClick={() => run(async (url) => {
          const r = await shareOrCopy({ title: `${scene.title} (read only)`, text: `Read “${scene.title}” on ${window.PN_CONFIG?.appName || 'Passing Notes'}`, url });
          if (r === 'copied') toast('Read-only link copied');
        })}><Icon name="book" size={18} /> Share read-only link</button>
        <button className="btn ghost" disabled={busy} onClick={() => run(async (url) => { await copyText(url); toast('Read-only link copied'); })}>
          <Icon name="copy" size={18} /> Copy read-only link</button>
      </div>
    </section>
  );
}
