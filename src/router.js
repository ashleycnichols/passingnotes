import { useEffect, useState } from 'react';

function parse() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  return { path: h, parts };
}

export function useRoute() {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => {
      setR(parse());
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function go(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = path;
  }
  window.scrollTo(0, 0);
}
