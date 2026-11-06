import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Avatar, Icon } from '../ui.jsx';
import { mentionQuery } from '../text.jsx';
import { getDraft, setDraft } from '../store.js';

// Wrap the selected text in a textarea with markers (for Bold / Italic buttons).
export function wrapSelection(ta, marker, value, setValue) {
  const { selectionStart: a, selectionEnd: b } = ta;
  const sel = value.slice(a, b);
  const next = value.slice(0, a) + marker + (sel || '') + marker + value.slice(b);
  flushSync(() => setValue(next));
  ta.focus();
  const start = a + marker.length;
  ta.setSelectionRange(start, start + sel.length);
}

function autoGrow(ta, maxFrac = 0.4) {
  if (!ta) return;
  ta.style.height = 'auto';
  const max = Math.round((window.visualViewport?.height || window.innerHeight) * maxFrac);
  ta.style.height = `${Math.min(ta.scrollHeight + 2, max)}px`;
  ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
}

// The @ suggestion list + formatting buttons, shared by the composer and the inline editor.
export function TextTools({ taRef, value, setValue, roster, colorFor, showFormat, children }) {
  const [mq, setMq] = useState(null);
  const update = () => {
    const ta = taRef.current;
    if (!ta) return;
    setMq(mentionQuery(ta.value, ta.selectionStart));
  };
  useEffect(update, [value]);
  const q = mq?.query?.toLowerCase() ?? null;
  const matches = q === null ? [] : roster.filter((c) => c.name.toLowerCase().startsWith(q) && c.name.toLowerCase() !== q.trimEnd()).slice(0, 6);
  const choose = (c) => {
    const ta = taRef.current;
    const caret = ta.selectionStart;
    const next = value.slice(0, mq.start) + `@${c.name} ` + value.slice(caret);
    flushSync(() => {
      setValue(next);
      setMq(null);
    });
    ta.focus();
    const pos = mq.start + c.name.length + 2;
    ta.setSelectionRange(pos, pos);
  };
  return (
    <div className="text-tools" onKeyUp={update} onClick={update}>
      {matches.length > 0 && (
        <div className="mentions" role="listbox" aria-label="Tag a character">
          {matches.map((c) => (
            <button type="button" key={c.id} role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(c)}>
              <Avatar c={c} size={24} />
              <span style={{ color: colorFor(c.color) }}>{c.name}</span>
            </button>
          ))}
        </div>
      )}
      {showFormat && (
        <div className="format-bar">
          <button type="button" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection(taRef.current, '**', value, setValue)}><b>B</b></button>
          <button type="button" aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection(taRef.current, '*', value, setValue)}><i>I</i></button>
          <button type="button" aria-label="Tag a character" onMouseDown={(e) => e.preventDefault()} onClick={() => {
            const ta = taRef.current;
            const a = ta.selectionStart;
            const pre = a > 0 && !/\s/.test(value[a - 1]) ? ' @' : '@';
            flushSync(() => setValue(value.slice(0, a) + pre + value.slice(a)));
            ta.focus();
            ta.setSelectionRange(a + pre.length, a + pre.length);
            update();
          }}>@</button>
          {children}
        </div>
      )}
    </div>
  );
}

export default function Composer({ slug, channel, identity, identityChar, onPickIdentity, roster, colorFor, onSend, disabled, placeholder, docked = false, large = false }) {
  const [value, setValueRaw] = useState(() => getDraft(slug, channel));
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const taRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    setValueRaw(getDraft(slug, channel));
  }, [slug, channel]);

  const setValue = (v) => {
    setValueRaw(v);
    setDraft(slug, channel, v);
  };

  useLayoutEffect(() => autoGrow(taRef.current, large ? 0.45 : 0.4), [value, large]);

  // Keep the composer above the on-screen keyboard and tell the page how tall we are.
  useEffect(() => {
    if (docked) return undefined;
    const el = wrapRef.current;
    const vv = window.visualViewport;
    const place = () => {
      const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      el.style.transform = kb > 0 ? `translateY(${-kb}px)` : '';
      document.documentElement.style.setProperty('--composer-h', `${el.offsetHeight}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      ro.disconnect();
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      document.documentElement.style.setProperty('--composer-h', '0px');
    };
  }, [docked]);

  const send = async () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    setBusy(true);
    try {
      await onSend(text);
      setValue('');
    } catch {
      // keep the text so nothing is lost
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && channel === 'ooc') {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  const ooc = channel === 'ooc';
  const label = ooc ? placeholder : identity === 'narrator' ? 'Write as Narrator…' : identityChar ? `Write as ${identityChar.name}…` : 'Choose who you’re writing as';

  return (
    <div className={`composer${ooc ? ' ooc' : ''}${docked ? ' docked' : ''}${large ? ' large' : ''}`} ref={wrapRef}>
      <TextTools taRef={taRef} value={value} setValue={setValue} roster={roster} colorFor={colorFor} showFormat={!ooc && (focused || large)}>
        {large && (
          <button type="button" className="as-name" onClick={onPickIdentity} aria-label="Change who you are posting as">
            <span className="muted">Posting as</span>
            <strong style={identityChar ? { color: colorFor(identityChar.color) } : undefined}>
              {identity === 'narrator' ? 'Narrator' : identityChar ? identityChar.name : 'Choose…'}
            </strong>
            <Icon name="back" size={14} className="chev-down" />
          </button>
        )}
        <span className="muted small hint-desktop">{ooc ? 'Enter to send' : 'Ctrl/⌘ + Enter to post'}</span>
      </TextTools>
      <div className="composer-row">
        {!ooc && (
          <button type="button" className="as-chip" onClick={onPickIdentity} aria-label="Change who you are posting as (character or Narrator)">
            <span className="as-chip-caret" aria-hidden="true"><Icon name="back" size={10} stroke={3} /></span>
            {identity === 'narrator' ? (
              <span className="narrator-badge" aria-hidden="true">N</span>
            ) : identityChar ? (
              <Avatar c={identityChar} size={30} />
            ) : (
              <span className="avatar empty-av"><Icon name="plus" size={16} /></span>
            )}
          </button>
        )}
        <textarea ref={taRef} rows={1} value={value} disabled={disabled} placeholder={label} aria-label={label}
          enterKeyHint={ooc ? 'send' : 'enter'}
          onChange={(e) => setValue(e.target.value)} onKeyDown={onKey}
          onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} />
        <button type="button" className="send-btn" onMouseDown={(e) => e.preventDefault()} onClick={send}
          disabled={!value.trim() || busy || disabled || (!ooc && !identity)} aria-label="Send">
          {large ? <span className="send-label">Post</span> : <Icon name="send" size={20} />}
        </button>
      </div>
    </div>
  );
}
