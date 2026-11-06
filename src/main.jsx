import { createRoot } from 'react-dom/client';
import { Component } from 'react';
import { useRoute } from './router.js';
import { isConfigured } from './api.js';
import { Toasts } from './ui.jsx';
import { registerServiceWorker, syncPush } from './push.js';
import { getState, subscribeStore, useStore, update } from './store.js';
import Home from './pages/Home.jsx';
import NewScene from './pages/NewScene.jsx';
import Scene from './pages/Scene.jsx';
import { PrintView } from './components/Export.jsx';
import { Claim, Restore, Settings, HowItWorks, WelcomeIntro } from './pages/Device.jsx';

class Boundary extends Component {
  constructor(p) {
    super(p);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <div className="page"><main className="content narrow">
          <h2>Something went wrong</h2>
          <p className="error-box">{String(this.state.err.message || this.state.err)}</p>
          <button className="btn primary" onClick={() => { location.hash = '/'; location.reload(); }}>Reload</button>
        </main></div>
      );
    }
    return this.props.children;
  }
}

function NotSetUp() {
  return (
    <div className="page"><main className="content narrow">
      <h2>Almost ready</h2>
      <p>Add your Supabase project URL and anon key to <code>config.js</code>, then reload.</p>
    </main></div>
  );
}

function App() {
  const { parts } = useRoute();
  const seenIntro = useStore((s) => s.seenIntro);
  if (!isConfigured()) return <NotSetUp />;
  const [a, rawB, c] = parts;
  const [b, query = ''] = (rawB || '').split('?');
  const jumpPost = new URLSearchParams(query).get('post');
  let page;
  if (!a) page = <Home />;
  else if (a === 'new') page = <NewScene />;
  else if (a === 's' && b && c && c.startsWith('print')) page = <PrintView slug={b} withOoc={c.includes('ooc=1')} />;
  else if (a === 's' && b) page = <Scene key={b} slug={b} jumpPost={jumpPost} />;
  else if (a === 'r' && b) page = <Scene key={`r-${b}`} viewToken={b} jumpPost={jumpPost} />;
  else if (a === 'claim') page = <Claim token={b} />;
  else if (a === 'restore') page = <Restore data={b} />;
  else if (a === 'settings') page = <Settings />;
  else if (a === 'how') page = <HowItWorks />;
  else page = <Home />;
  return (
    <Boundary key={`${a}/${b}/${c || ''}`}>
      {page}
      {!seenIntro && !['claim', 'restore', 'how'].includes(a) && !(c && c.startsWith('print')) && (
        <WelcomeIntro onDone={() => update((s) => (s.seenIntro = true))} />
      )}
      <Toasts />
    </Boundary>
  );
}

registerServiceWorker();

// Keep this device's notification registration in step with the characters it plays.
let lastChars = getState().myCharacters.map((c) => c.id).join(',');
subscribeStore(() => {
  const now = getState().myCharacters.map((c) => c.id).join(',');
  if (now === lastChars) return;
  lastChars = now;
  if ('Notification' in window && Notification.permission === 'granted') syncPush().catch(() => {});
});
if ('Notification' in window && Notification.permission === 'granted') syncPush().catch(() => {});

createRoot(document.getElementById('root')).render(<App />);
