import { createRoot } from 'react-dom/client';
import { Component } from 'react';
import { useRoute } from './router.js';
import { isConfigured } from './api.js';
import { Toasts } from './ui.jsx';
import Home from './pages/Home.jsx';
import NewScene from './pages/NewScene.jsx';
import Scene from './pages/Scene.jsx';
import { PrintView } from './components/Export.jsx';
import { Claim, Restore, Settings, HowItWorks } from './pages/Device.jsx';

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
  if (!isConfigured()) return <NotSetUp />;
  const [a, b, c] = parts;
  let page;
  if (!a) page = <Home />;
  else if (a === 'new') page = <NewScene />;
  else if (a === 's' && b && c && c.startsWith('print')) page = <PrintView slug={b} withOoc={c.includes('ooc=1')} />;
  else if (a === 's' && b) page = <Scene key={b} slug={b} />;
  else if (a === 'claim') page = <Claim token={b} />;
  else if (a === 'restore') page = <Restore data={b} />;
  else if (a === 'settings') page = <Settings />;
  else if (a === 'how') page = <HowItWorks />;
  else page = <Home />;
  return (
    <Boundary key={parts.join('/')}>
      {page}
      <Toasts />
    </Boundary>
  );
}

createRoot(document.getElementById('root')).render(<App />);
