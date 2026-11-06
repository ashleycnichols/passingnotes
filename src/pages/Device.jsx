// Claim a character link, restore a backup, device settings, and "How it works".
import { useEffect, useState } from 'react';
import { getApi } from '../api.js';
import { addMyCharacter, backupPayload, getState, rememberScene, restoreFrom, update, useStore, storageWorks } from '../store.js';
import { go } from '../router.js';
import { Avatar, Icon, Segmented, toast, errMsg } from '../ui.jsx';
import { baseUrl, copyText, decodeData, encodeData, isIOS, isStandalone, isUuid, shareOrCopy } from '../util.js';
import { TEXT_SIZES } from '../look.js';

function Shell({ title, children, back = '/' }) {
  return (
    <div className="page">
      <header className="topbar">
        <button className="icon-btn" onClick={() => go(back)} aria-label="Back"><Icon name="back" /></button>
        <h1 className="topbar-title">{title}</h1>
        <span className="icon-btn-spacer" />
      </header>
      <main className="content narrow">{children}</main>
    </div>
  );
}

export function Claim({ token }) {
  const [state, setState] = useState({ status: 'working' });
  useEffect(() => {
    // Take the secret out of the address bar straight away.
    history.replaceState(null, '', `${location.pathname}#/claim`);
    (async () => {
      const [id, key] = (token || '').split('.');
      if (!isUuid(id) || !isUuid(key)) return setState({ status: 'bad' });
      try {
        const api = await getApi();
        if (!(await api.verifyKey(id, key))) return setState({ status: 'bad' });
        addMyCharacter(id, key);
        const [c] = await api.getCharacters([id]);
        const links = await api.getSceneIdsForCharacters([id]);
        const scenes = await api.getScenesByIds([...new Set(links.map((l) => l.scene_id))]);
        const deviceId = getState().deviceId;
        for (const s of scenes) {
          const r = await api.joinScene(s.id, deviceId, getState().playerName);
          if (r === 'joined' || r === 'already') rememberScene(s.slug);
        }
        setState({ status: 'ok', character: c, scenes });
      } catch (e) {
        setState({ status: 'error', msg: errMsg(e) });
      }
    })();
  }, [token]);
  return (
    <Shell title="Add a character">
      {state.status === 'working' && <p className="muted center"><span className="spinner" /> Checking the link…</p>}
      {state.status === 'bad' && (
        <div className="empty"><h2>This link doesn’t work</h2><p className="muted">Ask for a fresh link from the device that has the character.</p>
          <button className="btn" onClick={() => go('/')}>Go home</button></div>
      )}
      {state.status === 'error' && <p className="error-box">{state.msg}</p>}
      {state.status === 'ok' && (
        <div className="empty">
          <Avatar c={state.character} size={84} />
          <h2>You can now play {state.character?.name} on this device</h2>
          {state.scenes.length > 0 ? (
            <div className="menu-list">
              {state.scenes.map((s) => (
                <button key={s.id} onClick={() => go(`/s/${s.slug}`)}><Icon name="book" /> {s.title}</button>
              ))}
            </div>
          ) : <p className="muted">They aren’t in any scenes yet.</p>}
          <button className="btn" onClick={() => go('/')}>Go home</button>
        </div>
      )}
    </Shell>
  );
}

export function Restore({ data }) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    history.replaceState(null, '', `${location.pathname}#/restore`);
    try {
      const d = decodeData(data || '');
      if (d.v !== 1) throw new Error('bad');
      setRes(restoreFrom(d));
    } catch {
      setRes({ bad: true });
    }
  }, [data]);
  return (
    <Shell title="Restore">
      {res?.bad && <div className="empty"><h2>This backup link doesn’t work</h2><p className="muted">Make sure you copied the whole link.</p></div>}
      {res && !res.bad && (
        <div className="empty">
          <Icon name="check" size={40} />
          <h2>Restored {res.chars} {res.chars === 1 ? 'character' : 'characters'} and {res.scenes} {res.scenes === 1 ? 'scene' : 'scenes'}</h2>
          <p className="muted">Anything already on this device was kept.</p>
          <button className="btn primary" onClick={() => go('/')}>Go to my scenes</button>
        </div>
      )}
    </Shell>
  );
}

export function Settings() {
  const playerName = useStore((s) => s.playerName);
  const textSize = useStore((s) => s.textSize);
  const counts = useStore((s) => `${s.myCharacters.length}|${s.myScenes.length}`);
  const [name, setName] = useState(playerName);
  const [nc, ns] = counts.split('|');
  const backupUrl = () => `${baseUrl()}#/restore/${encodeData(backupPayload())}`;
  return (
    <Shell title="Settings">
      {!storageWorks() && <p className="error-box">This browser is blocking storage (private mode?). Your characters won’t be remembered after you close it.</p>}

      <section className="settings-block">
        <h2>Your name in OOC chat</h2>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); update((s) => (s.playerName = name.trim().slice(0, 40))); toast('Saved'); }}>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <button className="btn">Save</button>
        </form>
        <p className="muted small">Used for new scenes. You can change it per scene from the OOC menu.</p>
      </section>

      <section className="settings-block">
        <h2>Text size</h2>
        <Segmented value={textSize} onChange={(v) => update((s) => (s.textSize = v))} label="Text size"
          options={Object.keys(TEXT_SIZES).map((k) => ({ value: k, label: k.toUpperCase() }))} />
      </section>

      <section className="settings-block">
        <h2>Back up this device</h2>
        <p>This device holds {nc} {nc === '1' ? 'character' : 'characters'} and {ns} {ns === '1' ? 'scene' : 'scenes'}. A backup link copies all of them to another browser or phone.</p>
        <p className="warning">Anyone with the backup link can play your characters. Keep it to yourself, for example in your notes app or an email to yourself.</p>
        <div className="stack">
          <button className="btn primary" onClick={async () => {
            const r = await shareOrCopy({ title: 'Passing Notes backup', text: 'My Passing Notes backup link', url: backupUrl() });
            update((s) => (s.lastBackupAt = new Date().toISOString()));
            if (r === 'copied') toast('Backup link copied');
          }}><Icon name="share" size={18} /> Share backup link</button>
          <button className="btn" onClick={async () => { await copyText(backupUrl()); update((s) => (s.lastBackupAt = new Date().toISOString())); toast('Backup link copied'); }}>
            <Icon name="copy" size={18} /> Copy backup link</button>
        </div>
      </section>

      <section className="settings-block">
        <h2>Keeping things saved</h2>
        <p>Your characters live in this browser, not in an account.{isIOS() && !isStandalone() ? ' On iPhone, add the app to your Home Screen (Share, then Add to Home Screen) so Safari doesn’t clear it after a few weeks away.' : ''} Keep a backup link somewhere safe.</p>
      </section>

      <button className="link-btn center-block" onClick={() => go('/how')}>How it works</button>
    </Shell>
  );
}

export function HowItWorks() {
  return (
    <Shell title="How it works" back="/settings">
      <div className="prose">
        <h2>No accounts</h2>
        <p>There are no logins. This device remembers which characters are yours and which scenes you’ve joined.</p>
        <h2>Link-only scenes</h2>
        <p>Scenes are never listed anywhere. The invite link is the only way in, and each scene holds up to 10 players.</p>
        <h2>Trust-based editing</h2>
        <p>You can edit or delete your own posts. Tag someone’s character with <strong>@Name</strong> and their player can edit that post too, so they can adjust their character’s lines. Tagged names show in the character’s colour.</p>
        <h2>Narrator and OOC</h2>
        <p>Anyone can post as Narrator to set the scene. The OOC tab is for chat as yourself, and it stays out of the story export.</p>
        <h2>Formatting</h2>
        <p>Wrap text in <code>*single stars*</code> for <em>italics</em> and <code>**double stars**</code> for <strong>bold</strong>, or use the buttons above the keyboard.</p>
        <h2>Another device</h2>
        <p>Open a character and choose “Use on another device” to send its link to yourself. To move everything at once, use the backup link in Settings.</p>
      </div>
    </Shell>
  );
}
