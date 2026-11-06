// Everything this device remembers. No accounts: this IS your identity.
import { useSyncExternalStore } from 'react';
import { uuid, universeKey } from './util.js';

const KEY = 'passingnotes:v1';

function blank() {
  return {
    deviceId: uuid(),
    playerName: '',
    myCharacters: [], // [{ id, key }]
    myScenes: [], // [{ slug, lastOpenedAt, hidden }]
    recentUniverses: [],
    lastIdentity: {}, // slug -> characterId | 'narrator'
    drafts: {}, // `${slug}:${channel}` -> text
    seenDescription: {}, // slug -> true
    textSize: 'm',
    homeFilter: 'all',
    homeGrouped: false,
    dismissedInstallTip: false,
    lastBackupAt: null,
    openChapters: {}, // slug -> { chapterKey: true/false }
  };
}

let memoryFallback = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...blank(), ...JSON.parse(raw) };
  } catch { /* storage blocked */ }
  return null;
}

let state = load();
if (!state) {
  state = blank();
  save();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    memoryFallback = state;
  }
}

const listeners = new Set();

export function getState() {
  return state;
}

export function update(fn) {
  const next = { ...state };
  fn(next);
  state = next;
  save();
  listeners.forEach((l) => l());
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const subscribeStore = subscribe;

// Other tabs on the same device stay in sync.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  const fresh = load();
  if (fresh) {
    state = fresh;
    listeners.forEach((l) => l());
  }
});

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export function storageWorks() {
  return memoryFallback === null;
}

// ---- convenience mutations -------------------------------------------------

export function ownsCharacter(id) {
  return state.myCharacters.some((c) => c.id === id);
}

export function keyFor(id) {
  return state.myCharacters.find((c) => c.id === id)?.key || null;
}

export function addMyCharacter(id, key) {
  update((s) => {
    if (!s.myCharacters.some((c) => c.id === id)) s.myCharacters = [...s.myCharacters, { id, key }];
  });
}

export function forgetMyCharacter(id) {
  update((s) => {
    s.myCharacters = s.myCharacters.filter((c) => c.id !== id);
  });
}

export function rememberScene(slug) {
  update((s) => {
    const now = new Date().toISOString();
    const existing = s.myScenes.find((x) => x.slug === slug);
    if (existing) {
      s.myScenes = s.myScenes.map((x) => (x.slug === slug ? { ...x, lastOpenedAt: now } : x));
    } else {
      s.myScenes = [...s.myScenes, { slug, lastOpenedAt: now, hidden: false }];
    }
  });
}

export function forgetScene(slug) {
  update((s) => {
    s.myScenes = s.myScenes.filter((x) => x.slug !== slug);
  });
}

export function setSceneHidden(slug, hidden) {
  update((s) => {
    s.myScenes = s.myScenes.map((x) => (x.slug === slug ? { ...x, hidden } : x));
  });
}

export function rememberUniverse(u) {
  const name = (u || '').trim();
  if (!name) return;
  update((s) => {
    const k = universeKey(name);
    s.recentUniverses = [name, ...s.recentUniverses.filter((x) => universeKey(x) !== k)].slice(0, 30);
  });
}

export function setDraft(slug, channel, text) {
  const k = `${slug}:${channel}`;
  update((s) => {
    const d = { ...s.drafts };
    if (text) d[k] = text;
    else delete d[k];
    s.drafts = d;
  });
}

export function getDraft(slug, channel) {
  return state.drafts[`${slug}:${channel}`] || '';
}

export function backupPayload() {
  return {
    v: 1,
    c: state.myCharacters,
    s: state.myScenes.map(({ slug, hidden }) => ({ slug, hidden })),
    p: state.playerName,
    u: state.recentUniverses,
  };
}

export function restoreFrom(data) {
  let chars = 0;
  let scenes = 0;
  update((s) => {
    const mine = new Set(s.myCharacters.map((c) => c.id));
    const addC = (data.c || []).filter((c) => c && c.id && c.key && !mine.has(c.id));
    chars = addC.length;
    s.myCharacters = [...s.myCharacters, ...addC];
    const have = new Set(s.myScenes.map((x) => x.slug));
    const addS = (data.s || []).filter((x) => x && x.slug && !have.has(x.slug));
    scenes = addS.length;
    s.myScenes = [...s.myScenes, ...addS.map((x) => ({ slug: x.slug, hidden: !!x.hidden, lastOpenedAt: null }))];
    if (!s.playerName && data.p) s.playerName = data.p;
    const seen = new Set(s.recentUniverses.map(universeKey));
    s.recentUniverses = [...s.recentUniverses, ...(data.u || []).filter((u) => !seen.has(universeKey(u)))];
  });
  return { chars, scenes };
}
