// Claim a character link, restore a backup, device settings, and "How it works".
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getApi } from '../api.js';
import { addMyCharacter, backupPayload, getState, rememberScene, restoreFrom, update, useStore, storageWorks } from '../store.js';
import { go } from '../router.js';
import { Avatar, Icon, Segmented, toast, errMsg } from '../ui.jsx';
import { baseUrl, copyText, decodeData, encodeData, isIOS, isStandalone, isUuid, shareOrCopy, inAppBrowser, canPromptInstall, onInstallChange, promptInstall } from '../util.js';
import { TEXT_SIZES } from '../look.js';
import { usePushStatus, enablePush, disablePush } from '../push.js';

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

      <HomeScreenSection />
      <NotificationsSection />

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
        <p>Your characters live in this browser, not in an account. Adding the app to your Home Screen and keeping a backup link are the two best ways to never lose them.</p>
      </section>

      <button className="link-btn center-block" onClick={() => go('/how')}>How it works</button>
      <button className="link-btn center-block muted-link" onClick={() => go('/stats')}>Usage stats (owner)</button>
    </Shell>
  );
}

export function HowItWorks() {
  return (
    <Shell title="How it works" back="/">
      <div className="prose">
        <h2>No accounts</h2>
        <p>There are no logins. This device remembers which characters are yours and which scenes you’ve joined. Add the app to your Home Screen and keep a backup link (in Settings) so you never lose them.</p>
        <h2>Scenes are invite-only</h2>
        <p>Scenes are never listed or searchable. The invite link is the only way in, and each scene holds up to 10 characters. A separate read-only link lets friends read along without joining.</p>
        <h2>Built on trust</h2>
        <p>This is a friendly space for people who know each other. Anyone with a scene’s link can join it, so share links only with people you’d invite to the table, and don’t write anything you’d be upset to see passed around.</p>
        <h2>Writing together</h2>
        <p>Pick who you’re writing as from the avatar next to the text box: one of your characters, or the <strong>Narrator</strong> to set the scene. The <strong>OOC</strong> tab is for chatting as yourself, and it stays out of the story export.</p>
        <h2>Tags</h2>
        <p>Type <strong>@</strong> to tag a character. Their name shows in their colour, their player gets a note in OOC chat, and they can edit that post too, so they can adjust their own character’s lines.</p>
        <h2>Chapters</h2>
        <p>Start a new chapter from the scene menu when the story moves on, or tap any post and choose “Chapter starts here”. Earlier chapters fold away and open again with a tap.</p>
        <h2>Formatting</h2>
        <p>Wrap text in <code>*single stars*</code> for <em>italics</em> and <code>**double stars**</code> for <strong>bold</strong>, or use the buttons above the keyboard.</p>
        <h2>Another device</h2>
        <p>Open a character and choose “Use on another device” to send it to yourself. To move everything at once, use the backup link in Settings. Lost a character on a new phone? Open the scene and tap “This is mine” next to it.</p>
      </div>
    </Shell>
  );
}

// Shown once per device, on whatever page someone first lands on.
export function WelcomeIntro({ onDone }) {
  const appName = window.PN_CONFIG?.appName || 'Passing Notes';
  const points = [
    { icon: 'feather', title: 'Write a story together', text: 'Start a scene, invite friends with a link, and take turns writing as your characters or the Narrator.' },
    { icon: 'users', title: 'No accounts', text: 'This device remembers your characters and scenes. Add the app to your Home Screen so nothing gets lost.' },
    { icon: 'link', title: 'Invite-only', text: 'Scenes are never listed or searchable. Only people with the link can join or read along.' },
    { icon: 'chat', title: 'Built on trust', text: 'Anyone with a scene’s link can join, so share it only with people you’d invite to the table.' },
  ];
  return (
    <div className="sheet-backdrop intro-backdrop">
      <div className="sheet intro" role="dialog" aria-modal="true" aria-label={`Welcome to ${appName}`}>
        <div className="intro-head">
          <img src="icons/icon-192.png" alt="" width="64" height="64" />
          <h2>Welcome to {appName}</h2>
        </div>
        <ul className="intro-points">
          {points.map((p) => (
            <li key={p.title}>
              <span className="intro-icon"><Icon name={p.icon} size={20} /></span>
              <div><strong>{p.title}</strong><p>{p.text}</p></div>
            </li>
          ))}
        </ul>
        <div className="intro-actions">
          <button className="btn ghost" onClick={() => { onDone(); go('/how'); }}>How it works</button>
          <button className="btn primary" onClick={onDone} autoFocus>Got it</button>
        </div>
      </div>
    </div>
  );
}

export function HomeScreenSection() {
  const canInstall = useSyncExternalStore(onInstallChange, canPromptInstall);
  const app = inAppBrowser();
  const url = baseUrl();
  return (
    <section className="settings-block" id="home-screen">
      <div className="hs-head">
        <img src="icons/icon-192.png" alt="" width="56" height="56" className="hs-icon" />
        <div>
          <h2>Add to Home Screen</h2>
          <p className="muted small">Opens full screen like an app, and keeps your characters saved.</p>
        </div>
      </div>
      {isStandalone() ? (
        <p className="ok-box"><Icon name="check" size={16} /> You’re using the Home Screen app. All set.</p>
      ) : app ? (
        <>
          <p className="warning">You’re inside {app}’s built-in browser. It keeps its own separate storage, so open the app in Safari (or Chrome) first, then add it from there.</p>
          <ol className="steps">
            <li>Tap the <strong>•••</strong> or <Icon name="share" size={16} /> menu in {app}.</li>
            <li>Choose <strong>Open in Safari</strong> (or Open in browser).</li>
            <li>Come back to Settings there and follow the steps.</li>
          </ol>
          <button className="btn" onClick={async () => { await copyText(url); toast('Link copied. Paste it into Safari.'); }}><Icon name="copy" size={18} /> Copy link to paste into Safari</button>
        </>
      ) : canInstall ? (
        <button className="btn primary block" onClick={async () => { if (await promptInstall()) toast('Added to your Home Screen'); }}>
          <Icon name="plus" size={18} /> Add to Home Screen
        </button>
      ) : isIOS() ? (
        <ol className="steps">
          <li>Tap the <strong>Share</strong> button <span className="key"><Icon name="share" size={16} /></span> in Safari’s toolbar. In Chrome it’s at the top right.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong> <span className="key"><Icon name="plus" size={16} /></span>. If you don’t see it, tap <strong>View More</strong> or <strong>Edit Actions</strong> first.</li>
          <li>Tap <strong>Add</strong>. Open Passing Notes from the new icon from now on.</li>
        </ol>
      ) : (
        <ol className="steps">
          <li>Open your browser menu (<strong>⋮</strong> or <strong>•••</strong>).</li>
          <li>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li>
        </ol>
      )}
    </section>
  );
}

function NotificationsSection() {
  const [status, setStatus] = usePushStatus();
  const [busy, setBusy] = useState(false);
  if (!status || status === 'unsupported') return null;
  const run = async (fn) => {
    setBusy(true);
    try {
      setStatus(await fn());
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-block" id="notifications">
      <h2>Tag notifications</h2>
      <p className="muted small">Get a notification on this device when someone tags one of your characters.</p>
      {status === 'needs-install' && (
        <p className="warning">On iPhone, notifications only work from the Home Screen app. Add it to your Home Screen (above), open it from the new icon, then turn this on.</p>
      )}
      {status === 'denied' && (
        <p className="warning">Notifications are blocked for this site. Turn them back on in your phone or browser settings for Passing Notes, then come back here.</p>
      )}
      {status === 'off' && (
        <button className="btn primary block" disabled={busy} onClick={() => run(enablePush)}><Icon name="chat" size={18} /> Notify me when I’m tagged</button>
      )}
      {status === 'on' && (
        <>
          <p className="ok-box"><Icon name="check" size={16} /> On for this device. You’ll hear about tags on any of your characters.</p>
          <button className="btn small" disabled={busy} onClick={() => run(disablePush)}>Turn off</button>
        </>
      )}
    </section>
  );
}
