// Shared building blocks: icons, sheets, avatars, toasts.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { initials } from './util.js';
import { textOn } from './look.js';

const P = {
  back: 'M15 18l-6-6 6-6',
  share: 'M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  send: 'M5 12h14M13 6l6 6-6 6',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M5 12l5 5L20 7',
  edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3zM13.5 6.5l3 3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  link: 'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1',
  download: 'M12 4v12M6 10l6 6 6-6M4 20h16',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 002 2h13',
  chat: 'M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z',
  eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10 10 0 0112 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.5 8 3.2 10 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.3-1',
  users: 'M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1a4 4 0 00-3-3.9M16 4.1a3.5 3.5 0 010 6.8',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  feather: 'M20 4c-6 0-11 4-12 11l-3 5M8 15h6M10 11h7',
};

export function Icon({ name, size = 20, stroke = 2, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}

export function Avatar({ c, size = 36, ring = false }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (!c) return <span className="avatar" style={style} />;
  if (c.photo_url) {
    return (
      <span className={`avatar${ring ? ' ring' : ''}`} style={{ ...style, '--ring': c.color }}>
        <img src={c.photo_url} alt={c.name} loading="lazy" />
      </span>
    );
  }
  return (
    <span className={`avatar${ring ? ' ring' : ''}`} role="img" aria-label={c.name}
      style={{ ...style, background: c.color, color: textOn(c.color), '--ring': c.color }}>
      {initials(c.name)}
    </span>
  );
}

export function Sheet({ open, onClose, title, children, wide = false, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!document.querySelector('.sheet-backdrop + .sheet-backdrop')) document.body.classList.remove('sheet-open');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, body, confirmLabel = 'Delete', danger = true, onConfirm, onCancel }) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }>
      {body && <p className="muted">{body}</p>}
    </Sheet>
  );
}

// ---- toasts ----------------------------------------------------------------
let toasts = [];
const tl = new Set();
export function toast(msg, kind = 'info') {
  const id = Math.random().toString(36).slice(2);
  toasts = [...toasts, { id, msg, kind }];
  tl.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    tl.forEach((l) => l());
  }, kind === 'error' ? 5000 : 2600);
}
export function Toasts() {
  const list = useSyncExternalStore((l) => (tl.add(l), () => tl.delete(l)), () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
      ))}
    </div>
  );
}

export function errMsg(e) {
  const m = (e && e.message) || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No connection. Check your internet and try again.';
  return m;
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}>
          {o.label}
          {o.dot && <span className="dot" aria-label="new" />}
        </button>
      ))}
    </div>
  );
}

export function UniverseInput({ value, onChange, suggestions, id }) {
  const [focus, setFocus] = useState(false);
  const q = (value || '').trim().toLowerCase();
  const list = suggestions.filter((s) => s.toLowerCase() !== q && (!q || s.toLowerCase().includes(q))).slice(0, 6);
  return (
    <div className="universe-input">
      <input id={id} value={value} maxLength={60} placeholder="e.g. Witchard Universe" autoComplete="off"
        onChange={(e) => onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
      {focus && list.length > 0 && (
        <div className="chips suggest">
          {list.map((s) => (
            <button type="button" key={s} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(s)}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
