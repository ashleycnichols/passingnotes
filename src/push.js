// Web push: "notify me when I'm tagged". Works on Android/desktop browsers,
// and on iPhone only from the Home Screen app.
import { useEffect, useState } from 'react';
import { getApi } from './api.js';
import { getState } from './store.js';
import { isIOS, isStandalone } from './util.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const enabled = () => window.PN_CONFIG?.notifications === true && !!window.PN_CONFIG?.vapidPublicKey;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.navigate) location.href = e.data.navigate;
  });
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// 'needs-install' | 'unsupported' | 'denied' | 'off' | 'on'
export async function pushStatus() {
  if (!enabled()) return 'unsupported';
  if (!supported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (!window.PN_CONFIG?.vapidPublicKey) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await currentSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function syncPush(sub) {
  if (!enabled()) return;
  const s = sub || (await currentSubscription());
  if (!s) return;
  const j = s.toJSON();
  const api = await getApi();
  await api.savePushSubscription(getState().deviceId, j.endpoint, j.keys.p256dh, j.keys.auth, getState().myCharacters.map((c) => c.id));
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('sw.js'));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(window.PN_CONFIG.vapidPublicKey) });
  await syncPush(sub);
  return 'on';
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    const api = await getApi();
    await api.removePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
  return 'off';
}

export function usePushStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    pushStatus().then((s) => live && setStatus(s));
    return () => { live = false; };
  }, []);
  return [status, setStatus];
}
