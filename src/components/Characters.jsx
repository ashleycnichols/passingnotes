import { useEffect, useRef, useState } from 'react';
import { getApi } from '../api.js';
import { addMyCharacter, forgetMyCharacter, keyFor, useStore, getState, rememberUniverse } from '../store.js';
import { Avatar, Confirm, Icon, Sheet, toast, errMsg, UniverseInput } from '../ui.jsx';
import { PALETTE } from '../look.js';
import { uuid, baseUrl, shareOrCopy, copyText } from '../util.js';

export function loadImage(file) {
  const url = URL.createObjectURL(file);
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res({ img: i, url });
    i.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('Could not read that image. Try a JPEG or PNG.'));
    };
    i.src = url;
  });
}

// Best guess at a head-and-shoulders square: faces in portraits sit in the upper part of the frame.
export function defaultCrop(w, h) {
  const ratio = h / w;
  if (ratio > 1.6) {
    const side = w * 0.62; // full-body art: tighter, near the top
    return { side, x: (w - side) / 2, y: h * 0.04 };
  }
  if (ratio > 1.05) {
    const side = w * 0.92; // portrait: full width, from just below the top
    return { side, x: (w - side) / 2, y: Math.min(h * 0.04, h - side) };
  }
  const side = Math.min(w, h) * 0.9; // square or landscape: centred, nudged up
  return { side, x: (w - side) / 2, y: Math.max(0, (h - side) * 0.3) };
}

export function clampCrop(c, w, h) {
  const side = Math.min(Math.max(c.side, 40), Math.min(w, h));
  return { side, x: Math.min(Math.max(c.x, 0), w - side), y: Math.min(Math.max(c.y, 0), h - side) };
}

export async function renderCrop(img, crop, size = 400) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
  const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
  let blob = await toBlob('image/webp', 0.8);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85);
  return blob;
}

// Drag to move, slider / pinch / scroll to zoom. Starts on the head-and-shoulders guess.
export function PhotoCropper({ source, onCancel, onDone }) {
  const VIEW = 260;
  const { img } = source;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const maxSide = Math.min(w, h);
  const [crop, setCrop] = useState(() => clampCrop(defaultCrop(w, h), w, h));
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const k = VIEW / crop.side;

  const zoomTo = (side, cx = crop.x + crop.side / 2, cy = crop.y + crop.side / 2) =>
    setCrop(clampCrop({ side, x: cx - side / 2, y: cy - side / 2 }, w, h));

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), side: crop.side };
    }
  };
  const onMove = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomTo(pinch.current.side * (pinch.current.dist / Math.max(d, 1)));
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setCrop((c) => clampCrop({ ...c, x: c.x - dx / (VIEW / c.side), y: c.y - dy / (VIEW / c.side) }, w, h));
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const zoom = maxSide / crop.side; // 1 = widest
  const [busy, setBusy] = useState(false);

  return (
    <Sheet open onClose={onCancel} title="Frame the portrait"
      footer={
        <>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { onDone(await renderCrop(img, crop)); } finally { setBusy(false); } }}>Use photo</button>
        </>
      }>
      <div className="cropper">
        <div className="crop-view" style={{ width: VIEW, height: VIEW }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onWheel={(e) => zoomTo(crop.side * (e.deltaY > 0 ? 1.08 : 0.92))}>
          <img src={source.url} alt="" draggable={false}
            style={{ width: w * k, height: h * k, transform: `translate(${-crop.x * k}px, ${-crop.y * k}px)` }} />
          <div className="crop-ring" aria-hidden="true" />
        </div>
        <label className="crop-zoom">
          <span className="muted small">Zoom</span>
          <input type="range" min="1" max="4" step="0.01" value={zoom} aria-label="Zoom"
            onChange={(e) => zoomTo(maxSide / Number(e.target.value))} />
        </label>
        <p className="muted small center">Drag to move. Pinch or use the slider to zoom. Aim for head and shoulders.</p>
        <button type="button" className="link-btn center-block" onClick={() => setCrop(clampCrop(defaultCrop(w, h), w, h))}>Reset framing</button>
      </div>
    </Sheet>
  );
}

export function CharacterForm({ open, character, scene, onClose, onSaved, onDeleted }) {
  const universes = useStore((s) => s.recentUniverses);
  const editing = !!character;
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[7]);
  const [universe, setUniverse] = useState('');
  const [photo, setPhoto] = useState(null); // { blob, preview } | 'remove' | null
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef(null);

  const remove = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      const api = await getApi();
      await api.deleteCharacter(character.id, keyFor(character.id));
      forgetMyCharacter(character.id);
      toast(`Deleted ${character.name}`);
      onDeleted?.(character);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setName(character?.name || '');
    setColor(character?.color || PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    setUniverse(character ? character.universe || '' : scene?.universe || '');
    setPhoto(null);
    setBusy(false);
    setCropSource(null);
    setLastSource(null);
  }, [open, character, scene]);

  const [cropSource, setCropSource] = useState(null); // { img, url } while framing
  const [lastSource, setLastSource] = useState(null); // keep the original so it can be re-framed
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const src = await loadImage(f);
      setLastSource(src);
      setCropSource(src);
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const shownPhoto = photo === 'remove' ? null : photo?.preview || character?.photo_url || null;
  const previewChar = { name: name || '?', color, photo_url: shownPhoto };

  const save = async () => {
    const n = name.trim();
    if (!n) return toast('Give your character a name', 'error');
    setBusy(true);
    try {
      const api = await getApi();
      const id = character?.id || uuid();
      let photoUrl = photo === 'remove' ? null : character?.photo_url || null;
      if (photo && photo !== 'remove') photoUrl = await api.uploadPhoto(id, photo.blob);
      const fields = { name: n.slice(0, 60), color, photo_url: photoUrl, universe: universe.trim().slice(0, 60) || null };
      if (editing) {
        const key = keyFor(id);
        if (!key) throw new Error('This character belongs to another device.');
        await api.updateCharacter(id, key, fields);
      } else {
        const key = uuid();
        await api.createCharacter({ id, owner_key: key, ...fields, created_by_device: getState().deviceId });
        addMyCharacter(id, key);
        if (scene) await api.addToScene(scene.id, id, getState().deviceId);
      }
      rememberUniverse(fields.universe);
      onSaved?.({ id, ...fields });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title={editing ? `Edit ${character.name}` : 'New character'}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : editing ? 'Save' : 'Create character'}</button>
        </>
      }>
      <div className="char-form-top">
        <button type="button" className="photo-pick" onClick={() => fileRef.current?.click()} aria-label="Choose photo">
          <Avatar c={previewChar} size={84} />
          <span className="photo-badge"><Icon name="upload" size={14} /></span>
        </button>
        <div className="grow">
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Character name" autoFocus={!editing} />
          </label>
          <div className="photo-links">
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>{shownPhoto ? 'Change photo' : 'Upload photo'}</button>
            {photo && photo !== 'remove' && lastSource && <button type="button" className="link-btn" onClick={() => setCropSource(lastSource)}>Adjust</button>}
            {shownPhoto && <button type="button" className="link-btn" onClick={() => setPhoto('remove')}>Remove</button>}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      </div>

      <div className="field">
        <span>Colour</span>
        <div className="swatches" role="radiogroup" aria-label="Character colour">
          {PALETTE.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`swatch${color === c ? ' on' : ''}`}
              style={{ background: c }} onClick={() => setColor(c)}>
              {color === c && <Icon name="check" size={16} />}
            </button>
          ))}
          <label className={`swatch custom${!PALETTE.includes(color) ? ' on' : ''}`} style={!PALETTE.includes(color) ? { background: color } : undefined} title="Custom colour">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom colour" />
            {PALETTE.includes(color) && <Icon name="plus" size={16} />}
          </label>
        </div>
      </div>

      <label className="field">
        <span>Universe <em className="muted">(optional)</em></span>
        <UniverseInput value={universe} onChange={setUniverse} suggestions={universes} />
      </label>
      {editing && keyFor(character.id) && (
        <button type="button" className="link-btn danger-text delete-char" onClick={() => setConfirmDelete(true)} disabled={busy}>
          <Icon name="trash" size={16} /> Delete this character
        </button>
      )}
      {cropSource && (
        <PhotoCropper source={cropSource} onCancel={() => setCropSource(null)}
          onDone={(blob) => { setPhoto({ blob, preview: URL.createObjectURL(blob) }); setCropSource(null); }} />
      )}
      <Confirm open={confirmDelete} title={`Delete ${character?.name || ''}?`} confirmLabel="Delete character"
        body="They’ll leave every scene and disappear from your characters on every device. Their past posts stay in the story under their name. This can’t be undone."
        onCancel={() => setConfirmDelete(false)} onConfirm={remove} />
    </Sheet>
  );
}

export function ShareCharacterSheet({ character, onClose }) {
  if (!character) return null;
  const key = keyFor(character.id);
  const url = `${baseUrl()}#/claim/${character.id}.${key}`;
  return (
    <Sheet open onClose={onClose} title={`Use ${character.name} on another device`}>
      <p>Open this link on your other phone or laptop. That device will be able to post and edit as {character.name}.</p>
      <p className="warning">Anyone with this link can play this character. Only send it to yourself.</p>
      <div className="stack">
        <button className="btn primary" onClick={async () => {
          const r = await shareOrCopy({ title: character.name, text: `My character ${character.name}`, url });
          if (r === 'copied') toast('Link copied');
        }}><Icon name="share" size={18} /> Share link</button>
        <button className="btn" onClick={async () => { await copyText(url); toast('Link copied'); }}><Icon name="copy" size={18} /> Copy link</button>
      </div>
    </Sheet>
  );
}
