// Keep installed copies (especially iPhone Home Screen apps) on the latest version.
// version.json is written by the build; we fetch it past every cache and reload when it's newer.
import { useSyncExternalStore } from 'react';

export const APP_VERSION = __APP_VERSION__;
const TRIED = 'passingnotes:update-tried';

let pending = null;
const listeners = new Set();
const setPending = (v) => { pending = v; listeners.forEach((l) => l()); };

async function latest() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { v } = await r.json();
    return Number(v) > APP_VERSION ? Number(v) : null;
  } catch {
    return null;
  }
}

export function applyUpdate(v = pending) {
  if (!v) return;
  try {
    if (sessionStorage.getItem(TRIED) === String(v)) return; // never loop if a cache still serves the old app
    sessionStorage.setItem(TRIED, String(v));
  } catch { /* storage blocked: still try once */ }
  // A new URL skips any cached copy of the page.
  location.replace(`${location.pathname}?v=${v}${location.hash}`);
}

const busy = () => {
  const a = document.activeElement;
  return (!!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) || !!document.querySelector('.sheet-backdrop');
};

export function startUpdateChecks() {
  // Tidy the ?v= left by an update, keeping the page where it was.
  if (location.search) history.replaceState(null, '', `${location.pathname}${location.hash}`);
  latest().then((v) => v && applyUpdate(v)); // just opened: update straight away
  const onShow = () => {
    if (document.visibilityState !== 'visible') return;
    latest().then((v) => {
      if (!v) return;
      if (busy()) setPending(v);
      else applyUpdate(v);
    });
  };
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('pageshow', (e) => e.persisted && onShow());
}

export function usePendingUpdate() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => pending);
}
